#!/usr/bin/env node
/**
 * Preflight doctor: detects common machine-setup issues that block Omni's
 * native rebuilds (node-pty, @vscode/windows-registry, etc.) and prints
 * actionable install commands. Intended to be run manually (`npm run doctor`)
 * or lazily on postinstall failure.
 */
import { spawnSync } from "node:child_process";

function check(label, cmd, args, expect) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  const ok = r.status === 0 && (!expect || (r.stdout ?? "").toLowerCase().includes(expect));
  const version = (r.stdout ?? r.stderr ?? "").trim().split("\n")[0] ?? "";
  process.stdout.write(`${ok ? "✓" : "✗"}  ${label.padEnd(22)} ${ok ? version : "MISSING"}\n`);
  return ok;
}

function main() {
  process.stdout.write("Omni doctor — checking toolchain prerequisites\n");
  process.stdout.write(`platform: ${process.platform}  arch: ${process.arch}  node: ${process.version}\n\n`);

  const nodeOk = check("node", "node", ["--version"]);
  const npmOk = check("npm", process.platform === "win32" ? "npm.cmd" : "npm", ["--version"]);

  if (process.platform === "darwin") {
    const xcodeOk = check("xcode cli tools", "xcode-select", ["-p"]);
    const py = check("python3", "python3", ["--version"]);
    if (!xcodeOk) process.stdout.write("\n→ Install with: xcode-select --install\n");
    if (!py) process.stdout.write("→ Install Python 3: brew install python\n");
  } else if (process.platform === "win32") {
    check("python", "python", ["--version"]);
    process.stdout.write("\nIf native rebuilds fail, install Windows Build Tools:\n");
    process.stdout.write("  npm install --global --production windows-build-tools\n");
  } else {
    const py = check("python3", "python3", ["--version"]);
    const gcc = check("gcc", "gcc", ["--version"]);
    const make = check("make", "make", ["--version"]);
    if (!py || !gcc || !make) {
      process.stdout.write("\n→ Install with (Debian/Ubuntu): sudo apt install build-essential python3 python3-setuptools\n");
      process.stdout.write("→ Install with (Fedora):        sudo dnf install @development-tools python3\n");
    }
  }

  if (!nodeOk || !npmOk) {
    process.exitCode = 1;
    return;
  }
  process.stdout.write("\nDoctor complete.\n");
}

main();
