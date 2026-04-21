// Normalize symlinks inside bundled vendor/ code-server tree before signing.
//
// Why this exists:
//   Our vendored code-server install contains symlinks (most notably
//   `node_modules.asar` → `node_modules`, plus various `node_modules/.bin`
//   entries that npm and code-server's postinstall create). When
//   electron-builder assembles the Windows NSIS installer, the signing
//   stage (signtool) and the NSIS packager refuse to process symlinks:
//   they either follow them and double-count files or abort with
//   "file not found" / "cannot sign symlink" errors. The historical
//   symptom was a Windows build failing at the signing step with
//   `ERROR: SignerSign() failed`.
//
// What this script does:
//   Walks `appOutDir`/**/vendor/code-server (after electron-builder has
//   copied app resources into the staging dir, before the packager
//   signs or compresses them) and replaces every symlink with a real
//   copy of its target. For directories the copy is recursive; for
//   files it's a plain copyFile. Broken symlinks are simply deleted —
//   they can't be signed and weren't useful to begin with.
//
// Safety:
//   Only operates under the vendor/ path inside appOutDir. Never
//   touches the source tree; the source still uses symlinks for
//   efficient development.

import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * @param {string} root Absolute path to a directory that may contain symlinks.
 * @returns {Promise<{replaced: number, removed: number}>}
 */
async function normalizeTree(root) {
  let replaced = 0;
  let removed = 0;

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err && err.code === "ENOENT") return;
      throw err;
    }

    for (const entry of entries) {
      const abs = path.join(dir, entry.name);

      if (entry.isSymbolicLink()) {
        let targetStat;
        try {
          targetStat = await fs.stat(abs); // follows the link
        } catch {
          // Broken symlink — delete outright.
          await fs.unlink(abs);
          removed += 1;
          continue;
        }

        const realTarget = await fs.realpath(abs);
        await fs.unlink(abs);

        if (targetStat.isDirectory()) {
          await fs.cp(realTarget, abs, { recursive: true, dereference: true, force: true });
        } else {
          await fs.copyFile(realTarget, abs);
        }
        replaced += 1;
        continue;
      }

      if (entry.isDirectory()) {
        await walk(abs);
      }
    }
  }

  await walk(root);
  return { replaced, removed };
}

/**
 * electron-builder beforePack hook.
 *
 * @param {{appOutDir: string, packager: any}} context
 */
export default async function beforePack(context) {
  const appOutDir = context?.appOutDir;
  if (!appOutDir) return;

  // electron-builder copies `files` entries into `resources/app.asar` or
  // `resources/app/` depending on asar config. We unpack `vendor/**`
  // (see electron-builder.yml `asarUnpack`), so the on-disk vendor tree
  // lives at `resources/app.asar.unpacked/vendor/`. We also handle the
  // non-asar fallback.
  const candidates = [
    path.join(appOutDir, "resources", "app.asar.unpacked", "vendor"),
    path.join(appOutDir, "resources", "app", "vendor"),
  ];

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }
    const { replaced, removed } = await normalizeTree(candidate);
    // eslint-disable-next-line no-console
    console.log(
      `[normalizeVendorSymlinks] ${candidate}: replaced ${replaced} symlinks, removed ${removed} broken links`,
    );
  }
}
