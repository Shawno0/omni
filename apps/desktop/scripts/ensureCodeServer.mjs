#!/usr/bin/env node
/**
 * Cross-platform replacement for ensureCodeServer.ps1.
 * Downloads / updates the bundled code-server runtime, installs its
 * declared dependencies, rebuilds native modules if needed, and applies
 * known security patches.
 *
 * Usage:
 *   node ./scripts/ensureCodeServer.mjs            # idempotent sync
 *   node ./scripts/ensureCodeServer.mjs --force    # force reinstall
 */
import { createRequire } from "node:module";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdirSync, rmSync, existsSync, readFileSync, copyFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";

const require = createRequire(import.meta.url);

const FALLBACK_VERSION = "4.108.2";
const SECURITY_PATCHES = ["qs@6.15.0", "basic-ftp@5.2.0"];
const CRITICAL_NATIVE_PACKAGES = new Set(["@vscode/windows-registry"]);

const scriptPath = fileURLToPath(import.meta.url);
const scriptRoot = path.dirname(scriptPath);
const desktopRoot = path.dirname(scriptRoot);
const vendorRoot = path.join(desktopRoot, "vendor");
const runtimeRoot = path.join(vendorRoot, "code-server");
const entryPath = path.join(runtimeRoot, "out", "node", "entry.js");
const loggerPackage = path.join(runtimeRoot, "node_modules", "@coder", "logger", "package.json");
const runtimePackageJsonPath = path.join(runtimeRoot, "package.json");

const forceRefresh = process.argv.includes("--force") || process.argv.includes("-f");

function log(message) {
  process.stdout.write(`[ensureCodeServer] ${message}\n`);
}

function warn(message) {
  process.stdout.write(`[ensureCodeServer][warn] ${message}\n`);
}

function runNpm(args, cwd) {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCmd, args, { cwd, stdio: "inherit", env: process.env });
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
}

function runNpmCaptured(args, cwd) {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCmd, args, { cwd, env: process.env, encoding: "utf8" });
  if (result.status !== 0) {
    return null;
  }
  return (result.stdout ?? "").trim();
}

function getCurrentVersion() {
  if (!existsSync(runtimePackageJsonPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(runtimePackageJsonPath, "utf8"));
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

function getLatestVersion() {
  const latest = runNpmCaptured(["view", "code-server", "version", "--silent"]);
  if (!latest) return null;
  return latest.replace(/["']/g, "").trim() || null;
}

function parseVersion(version) {
  const normalized = version.split("-")[0];
  const parts = normalized.split(".").map((v) => Number.parseInt(v, 10) || 0);
  while (parts.length < 4) parts.push(0);
  return parts;
}

function compareVersion(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 4; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

async function downloadFile(url, destination) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${response.status} ${response.statusText} ${url}`);
  }
  await pipeline(response.body, createWriteStream(destination));
}

function extractTarball(tarball, destination) {
  mkdirSync(destination, { recursive: true });
  const result = spawnSync("tar", ["-xzf", tarball, "-C", destination], { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`tar extraction failed for ${tarball}`);
  }
}

function removeDir(target, label) {
  if (!existsSync(target)) return;
  try {
    rmSync(target, { recursive: true, force: true });
  } catch (err) {
    throw new Error(`RUNTIME_LOCKED: Unable to replace ${label} at ${target}. Close running Omni/Electron instances and retry. ${err?.message ?? err}`);
  }
}

function copyRecursive(src, dst) {
  mkdirSync(dst, { recursive: true });
  const result = spawnSync(
    process.platform === "win32" ? "robocopy" : "cp",
    process.platform === "win32"
      ? [src, dst, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NC", "/NS", "/NP"]
      : ["-R", src + "/.", dst + "/"],
    { stdio: "inherit" },
  );
  // robocopy uses 0-7 for success; cp uses 0
  if (process.platform === "win32") {
    if ((result.status ?? 0) >= 8) throw new Error(`robocopy failed (${result.status})`);
  } else if (result.status !== 0) {
    throw new Error(`cp failed (${result.status})`);
  }
}

async function installCodeServerVersion(version) {
  const tarball = path.join(vendorRoot, `code-server-${version}.tgz`);
  const extractRoot = path.join(vendorRoot, "_extract");
  const extractPackageRoot = path.join(extractRoot, "package");

  if (existsSync(extractRoot)) rmSync(extractRoot, { recursive: true, force: true });

  const url = `https://registry.npmjs.org/code-server/-/code-server-${version}.tgz`;
  log(`downloading ${url}`);
  await downloadFile(url, tarball);

  log("extracting archive");
  extractTarball(tarball, extractRoot);

  if (!existsSync(extractPackageRoot)) {
    throw new Error(`Extracted package directory not found: ${extractPackageRoot}`);
  }

  removeDir(runtimeRoot, "code-server runtime");
  copyRecursive(extractPackageRoot, runtimeRoot);

  rmSync(extractRoot, { recursive: true, force: true });
  rmSync(tarball, { force: true });

  if (!existsSync(entryPath)) {
    throw new Error(`code-server entry not found after extraction: ${entryPath}`);
  }

  log("installing runtime dependencies");
  runNpm(["install", "--omit=dev", "--ignore-scripts"], runtimeRoot);
}

function getMissingManifestPackages(manifestPath) {
  if (!existsSync(manifestPath)) throw new Error(`Manifest not found: ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const nodeModulesRoot = path.join(runtimeRoot, "node_modules");
  const missing = [];
  const deps = manifest.dependencies || {};
  for (const [name, version] of Object.entries(deps)) {
    const pkgJson = path.join(nodeModulesRoot, ...name.split("/"), "package.json");
    if (!existsSync(pkgJson)) missing.push(`${name}@${version}`);
  }
  return missing;
}

function installPackagesIfMissing(manifestPaths) {
  const allMissing = new Set();
  for (const manifest of manifestPaths) {
    for (const dep of getMissingManifestPackages(manifest)) allMissing.add(dep);
  }
  if (allMissing.size === 0) return;
  const deps = Array.from(allMissing).sort();
  log(`installing missing dependencies: ${deps.join(", ")}`);
  runNpm(["install", "--omit=dev", "--ignore-scripts", ...deps], runtimeRoot);

  for (const manifest of manifestPaths) {
    const remaining = getMissingManifestPackages(manifest);
    if (remaining.length > 0) {
      throw new Error(`Missing dependencies after install for ${manifest}: ${remaining.join(", ")}`);
    }
  }
}

async function listFilesRecursive(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else out.push(full);
    }
  }
  return out;
}

async function getNativePackagesMissingBinary(manifestPath) {
  if (!existsSync(manifestPath)) return [];
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const nodeModulesRoot = path.join(runtimeRoot, "node_modules");
  const missing = [];
  for (const name of Object.keys(manifest.dependencies || {})) {
    const pkgDir = path.join(nodeModulesRoot, ...name.split("/"));
    const bindingGyp = path.join(pkgDir, "binding.gyp");
    if (!existsSync(bindingGyp)) continue;
    const files = await listFilesRecursive(pkgDir);
    const hasNode = files.some((f) => f.endsWith(".node"));
    if (!hasNode) missing.push(name);
  }
  return missing;
}

function ensureNodeGypPythonCompatibility() {
  const py = process.platform === "win32" ? "python" : "python3";
  const check = spawnSync(py, ["-c", "import distutils"], { stdio: "ignore" });
  if (check.status === 0) return;
  log("python distutils missing, installing setuptools for node-gyp compatibility");
  spawnSync(py, ["-m", "pip", "install", "--user", "setuptools"], { stdio: "inherit" });
}

async function rebuildNativePackagesIfNeeded(manifestPaths) {
  const toRebuild = new Set();
  for (const manifest of manifestPaths) {
    for (const pkg of await getNativePackagesMissingBinary(manifest)) toRebuild.add(pkg);
  }
  if (toRebuild.size === 0) return;
  const pkgs = Array.from(toRebuild).sort();
  log(`rebuilding native packages: ${pkgs.join(", ")}`);
  ensureNodeGypPythonCompatibility();
  runNpm(["rebuild", ...pkgs], runtimeRoot);

  const stillMissing = new Set();
  for (const manifest of manifestPaths) {
    for (const pkg of await getNativePackagesMissingBinary(manifest)) stillMissing.add(pkg);
  }
  if (stillMissing.size > 0) {
    const critical = Array.from(stillMissing).filter((p) => CRITICAL_NATIVE_PACKAGES.has(p));
    if (critical.length > 0) {
      throw new Error(`Critical native binaries still missing after rebuild: ${critical.join(", ")}`);
    }
    warn(`Native binaries still missing for non-critical packages: ${Array.from(stillMissing).join(", ")}`);
  }
}

function applySecurityPatches() {
  log(`applying security patches: ${SECURITY_PATCHES.join(", ")}`);
  runNpm(["install", "--omit=dev", "--ignore-scripts", ...SECURITY_PATCHES], runtimeRoot);
}

/**
 * Compile and stage the in-tree `packages/omni-bridge` extension into the
 * vendored code-server's built-in extensions dir. This replaces the old
 * "orphan TS file" arrangement — the extension now ships as part of the
 * runtime, so end-users get the Omni chat + tool-call bridge without
 * extra install steps.
 *
 * Steps:
 *   1. Run `tsc -p packages/omni-bridge/tsconfig.json` to emit dist/extension.js.
 *   2. Mirror the package.json + dist/ into
 *      vendor/code-server/lib/vscode/extensions/omni-bridge/.
 *   3. Skip silently (with a warning) if the source is missing — some
 *      developer clones may want to iterate without the bridge.
 */
function bundleOmniBridge() {
  const repoRoot = path.resolve(desktopRoot, "..", "..");
  const bridgeRoot = path.join(repoRoot, "packages", "omni-bridge");
  if (!existsSync(bridgeRoot)) {
    warn(`omni-bridge source not found at ${bridgeRoot}, skipping bundle step`);
    return;
  }

  log(`building omni-bridge extension from ${bridgeRoot}`);
  const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const build = spawnSync(npxCmd, ["tsc", "-p", "tsconfig.json"], {
    cwd: bridgeRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (build.status !== 0) {
    warn(`omni-bridge tsc build failed with exit code ${build.status ?? "unknown"}, skipping bundle`);
    return;
  }

  const distDir = path.join(bridgeRoot, "dist");
  const manifest = path.join(bridgeRoot, "package.json");
  if (!existsSync(distDir) || !existsSync(manifest)) {
    warn("omni-bridge build artefacts missing after tsc, skipping bundle");
    return;
  }

  const targetRoot = path.join(runtimeRoot, "lib", "vscode", "extensions", "omni-bridge");
  try {
    rmSync(targetRoot, { recursive: true, force: true });
    mkdirSync(targetRoot, { recursive: true });
  } catch (err) {
    warn(`failed to reset ${targetRoot}: ${err?.message ?? err}`);
    return;
  }

  // Copy package.json + dist/ tree recursively. Using a tiny bespoke walker
  // keeps us dependency-free (no cpy/fs-extra) and avoids shelling out to
  // `cp -R` on Windows.
  const copyRecursive = (src, dest) => {
    const stats = statSync(src);
    if (stats.isDirectory()) {
      mkdirSync(dest, { recursive: true });
      const entries = require("node:fs").readdirSync(src);
      for (const entry of entries) {
        copyRecursive(path.join(src, entry), path.join(dest, entry));
      }
    } else if (stats.isFile()) {
      copyFileSync(src, dest);
    }
  };

  try {
    copyFileSync(manifest, path.join(targetRoot, "package.json"));
    copyRecursive(distDir, path.join(targetRoot, "dist"));
    log(`omni-bridge bundled into ${targetRoot}`);
  } catch (err) {
    warn(`failed to copy omni-bridge into runtime: ${err?.message ?? err}`);
  }
}

async function main() {
  const runtimePresent = existsSync(entryPath) && existsSync(loggerPackage);
  const manifestPaths = [
    path.join(runtimeRoot, "package.json"),
    path.join(runtimeRoot, "lib", "vscode", "package.json"),
  ];
  const currentVersion = getCurrentVersion();
  const latestVersion = getLatestVersion();
  const targetVersion = latestVersion || FALLBACK_VERSION;

  if (latestVersion) log(`latest npm code-server: ${latestVersion}`);
  else warn(`unable to resolve latest version from npm, falling back to ${FALLBACK_VERSION}`);

  let needsInstall = !runtimePresent;
  let needsUpdate = false;
  if (runtimePresent && currentVersion) {
    needsUpdate = compareVersion(targetVersion, currentVersion) > 0;
  }
  if (forceRefresh) {
    log("force refresh requested");
    needsInstall = true;
  }
  if (runtimePresent && !currentVersion) {
    warn("runtime present but version missing/unreadable, forcing reinstall");
    needsInstall = true;
  }

  if (needsInstall || needsUpdate) {
    mkdirSync(vendorRoot, { recursive: true });
    if (needsUpdate) log(`updating runtime from ${currentVersion} to ${targetVersion}`);
    else log(`installing runtime version ${targetVersion}`);

    try {
      await installCodeServerVersion(targetVersion);
    } catch (err) {
      const message = String(err?.message ?? err);
      if (!forceRefresh && needsUpdate && message.startsWith("RUNTIME_LOCKED:")) {
        warn(`update skipped because runtime is in use. ${message}`);
        warn(`continuing with existing runtime version ${currentVersion}`);
      } else {
        throw err;
      }
    }
  } else {
    log(`code-server runtime up-to-date (${currentVersion}), verifying all declared dependencies`);
  }

  installPackagesIfMissing(manifestPaths);
  await rebuildNativePackagesIfNeeded(manifestPaths);
  applySecurityPatches();
  bundleOmniBridge();

  if (!existsSync(loggerPackage)) {
    throw new Error(`code-server dependencies missing after install: ${loggerPackage}`);
  }

  log(`ready: ${entryPath}`);
}

main().catch((err) => {
  process.stderr.write(`[ensureCodeServer][error] ${err?.stack ?? err?.message ?? err}\n`);
  process.exit(1);
});
