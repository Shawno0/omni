#!/usr/bin/env node
/**
 * Cross-platform `omnicontext://` (or custom scheme) protocol registration.
 * - Windows: writes HKCU\Software\Classes\{scheme} via reg.exe
 * - macOS:   no-op at install time (handled via Info.plist CFBundleURLTypes
 *            in packaged builds). Prints guidance for dev installs.
 * - Linux:   installs a ~/.local/share/applications/omni.desktop entry with
 *            MimeType=x-scheme-handler/{scheme} and runs update-desktop-database
 *            if available.
 *
 * Usage:
 *   node ./scripts/registerProtocol.mjs [--scheme omni] [--exec /path/to/bin] [--unregister]
 */
import { spawnSync, execSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptRoot = path.dirname(scriptPath);
const desktopRoot = path.dirname(scriptRoot);
const repoRoot = path.resolve(desktopRoot, "..", "..");

function arg(flag) {
  const ix = process.argv.indexOf(flag);
  if (ix === -1) return undefined;
  return process.argv[ix + 1];
}

const scheme = arg("--scheme") || "omni";
const unregister = process.argv.includes("--unregister");
const execOverride = arg("--exec");

function defaultExecutablePath() {
  const candidates =
    process.platform === "win32"
      ? [
          path.join(desktopRoot, "out", "win-unpacked", "Omni.exe"),
          path.join(desktopRoot, "out", "Omni.exe"),
        ]
      : process.platform === "darwin"
        ? [path.join(desktopRoot, "out", "mac", "Omni.app", "Contents", "MacOS", "Omni")]
        : [path.join(desktopRoot, "out", "linux-unpacked", "omni"), path.join(desktopRoot, "out", "omni")];
  for (const c of candidates) if (existsSync(c)) return c;

  // dev fallback: `electron apps/desktop`
  const electronCmd =
    process.platform === "win32"
      ? path.join(repoRoot, "node_modules", ".bin", "electron.cmd")
      : path.join(repoRoot, "node_modules", ".bin", "electron");
  if (existsSync(electronCmd)) {
    return `"${electronCmd}" "${desktopRoot}"`;
  }
  throw new Error("No executable found. Pass --exec <path> to this script.");
}

function registerWindows(effectivePath) {
  const regPath = `HKCU\\Software\\Classes\\${scheme}`;
  const run = (args) => {
    const r = spawnSync("reg", args, { stdio: "inherit" });
    if (r.status !== 0) throw new Error(`reg ${args.join(" ")} failed (${r.status})`);
  };
  if (unregister) {
    spawnSync("reg", ["delete", regPath, "/f"], { stdio: "inherit" });
    process.stdout.write(`Removed protocol registration: ${scheme}\n`);
    return;
  }
  run(["add", regPath, "/ve", "/d", "URL:Omni Link", "/f"]);
  run(["add", regPath, "/v", "URL Protocol", "/t", "REG_SZ", "/d", "", "/f"]);
  run(["add", `${regPath}\\DefaultIcon`, "/ve", "/d", effectivePath, "/f"]);
  run(["add", `${regPath}\\shell\\open\\command`, "/ve", "/d", `${effectivePath} "%1"`, "/f"]);
  process.stdout.write(`Registered protocol: ${scheme}\nCommand: ${effectivePath} "%1"\n`);
}

function registerLinux(effectivePath) {
  const appsDir = path.join(os.homedir(), ".local", "share", "applications");
  mkdirSync(appsDir, { recursive: true });
  const desktopFile = path.join(appsDir, `omni-${scheme}.desktop`);
  if (unregister) {
    if (existsSync(desktopFile)) unlinkSync(desktopFile);
    process.stdout.write(`Removed protocol registration: ${scheme}\n`);
    return;
  }
  const contents = [
    "[Desktop Entry]",
    "Name=Omni",
    "Comment=Omni workspace supervisor",
    `Exec=${effectivePath} %u`,
    "Terminal=false",
    "Type=Application",
    "Categories=Development;",
    `MimeType=x-scheme-handler/${scheme};`,
    "",
  ].join("\n");
  writeFileSync(desktopFile, contents, "utf8");
  // Best-effort registry refresh
  spawnSync("update-desktop-database", [appsDir], { stdio: "ignore" });
  spawnSync("xdg-mime", ["default", path.basename(desktopFile), `x-scheme-handler/${scheme}`], { stdio: "ignore" });
  process.stdout.write(`Registered protocol: ${scheme}\nDesktop file: ${desktopFile}\n`);
}

function registerMac() {
  if (unregister) {
    process.stdout.write(
      "macOS protocol registration is driven by the packaged app's Info.plist CFBundleURLTypes; nothing to unregister for dev installs.\n",
    );
    return;
  }
  process.stdout.write(
    [
      "macOS protocol registration is performed by the packaged app via CFBundleURLTypes.",
      "For dev (unpackaged) testing use:",
      "  open -a Electron --args <desktopRoot> 'omni://test'",
      "Scheme:  " + scheme,
    ].join("\n") + "\n",
  );
}

function main() {
  const effectivePath = execOverride || defaultExecutablePath();
  if (process.platform === "win32") registerWindows(effectivePath);
  else if (process.platform === "darwin") registerMac();
  else registerLinux(effectivePath);
}

try {
  main();
} catch (err) {
  process.stderr.write(`[registerProtocol][error] ${err?.message ?? err}\n`);
  process.exit(1);
}
