#!/usr/bin/env node
/**
 * Cross-platform protocol handler validation.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

function arg(flag) {
  const ix = process.argv.indexOf(flag);
  if (ix === -1) return undefined;
  return process.argv[ix + 1];
}

const scheme = arg("--scheme") || "omni";

function validateWindows() {
  const regPath = `HKCU\\Software\\Classes\\${scheme}\\shell\\open\\command`;
  const r = spawnSync("reg", ["query", regPath], { encoding: "utf8" });
  if (r.status !== 0) {
    process.stderr.write(`Protocol not registered or command key missing: ${scheme}\n${r.stderr ?? ""}`);
    process.exit(1);
  }
  const out = r.stdout ?? "";
  const match = out.match(/\(Default\)\s+REG_[^ ]+\s+(.*)/i);
  const command = match?.[1]?.trim();
  if (!command) {
    process.stderr.write("Protocol command is empty.\n");
    process.exit(1);
  }
  process.stdout.write(`Protocol registration looks valid.\nScheme: ${scheme}\nCommand: ${command}\n`);
}

function validateLinux() {
  const desktopFile = path.join(os.homedir(), ".local", "share", "applications", `omni-${scheme}.desktop`);
  if (!existsSync(desktopFile)) {
    process.stderr.write(`Desktop entry missing: ${desktopFile}\n`);
    process.exit(1);
  }
  const r = spawnSync("xdg-mime", ["query", "default", `x-scheme-handler/${scheme}`], { encoding: "utf8" });
  const handler = (r.stdout ?? "").trim();
  process.stdout.write(`Desktop entry: ${desktopFile}\nMIME handler: ${handler || "(unknown — xdg-mime not available)"}\n`);
}

function validateMac() {
  // Best-effort: ask Launch Services.
  const r = spawnSync(
    "/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister",
    ["-dump"],
    { encoding: "utf8" },
  );
  if (r.status !== 0 || !(r.stdout ?? "").includes(scheme + ":")) {
    process.stderr.write(
      `Scheme "${scheme}" is not visible to Launch Services. For packaged builds, verify Info.plist CFBundleURLTypes.\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`Scheme ${scheme} registered with Launch Services.\n`);
}

if (process.platform === "win32") validateWindows();
else if (process.platform === "darwin") validateMac();
else validateLinux();
