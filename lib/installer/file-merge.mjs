import {
  existsSync, lstatSync, statSync, realpathSync, readFileSync,
  writeFileSync, copyFileSync, renameSync, unlinkSync,
} from 'node:fs';
import { utcStamp, pruneBackups } from './settings.mjs';

const BACKUP_SUFFIX = '.installer-backup.';
const MAX_BACKUPS = 5;

// Symlinked CLAUDE.md into a dotfiles repo is a legitimate setup, so the writer
// works on the RESOLVED path: renameSync over the link itself would replace it
// with a regular file and silently detach the dotfiles checkout.
export function resolveRealTarget(p) {
  let st;
  try { st = lstatSync(p); } catch { return { realPath: p, exists: false, isDir: false, dangling: false }; }
  if (!st.isSymbolicLink()) return { realPath: p, exists: true, isDir: st.isDirectory(), dangling: false };
  let real;
  try { real = realpathSync(p); } catch { return { realPath: p, exists: true, isDir: false, dangling: true }; }
  return { realPath: real, exists: true, isDir: statSync(real).isDirectory(), dangling: false };
}

// Two installs inside the same UTC second would make copyFileSync silently
// overwrite the earlier backup, so collisions get a -1/-2 suffix. The suffix
// sorts AFTER the bare stamp, keeping pruneBackups' lexical order chronological.
export function backupFile(realPath, now = new Date()) {
  const base = `${realPath}${BACKUP_SUFFIX}${utcStamp(now)}`;
  let dst = base;
  for (let i = 1; existsSync(dst); i++) dst = `${base}-${i}`;
  copyFileSync(realPath, dst);
  pruneBackups(realPath, BACKUP_SUFFIX, MAX_BACKUPS);
  return dst;
}

// The rename is the ONLY mutation of the target, so a crash mid-write leaves the
// host file untouched. The temp file lives in the target's own directory because
// a cross-device rename would throw.
export function writeAtomic(realPath, text) {
  const tmp = `${realPath}.installer-tmp.${process.pid}`;
  try {
    writeFileSync(tmp, text, 'utf8');
    renameSync(tmp, realPath);
  } finally {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* best effort */ }
  }
}

export function mergeFileInto(templatePath, targetPath, mergeFn, { now = new Date(), warn } = {}) {
  const emit = warn || ((m) => process.stderr.write(`${m}\n`));
  const target = resolveRealTarget(targetPath);
  if (target.isDir) {
    emit(`code-conductor: skipping ${targetPath} — the target is a directory`);
    return 'skipped-dir';
  }
  // Ruling R6: writing through a dangling link would renameSync a regular file
  // over it, destroying the link. Leave it exactly as the user left it.
  if (target.dangling) {
    emit(`code-conductor: skipping ${targetPath} — it is a dangling symlink`);
    return 'skipped-dangling';
  }
  // npm strips .gitignore from every published tarball, so a bundled template
  // file can legitimately be absent at install time. The pre-1.24 copy loop
  // iterated the template dir and simply never saw it; skipping here preserves
  // that behaviour instead of aborting the install with ENOENT.
  if (!existsSync(templatePath)) {
    return 'skipped-missing';
  }
  const templateText = readFileSync(templatePath, 'utf8');
  // Ruling R7: a fresh target gets the template verbatim; mergeFn never runs, so
  // the template's own sentinels are validated by templates.test.js, not here.
  if (!target.exists) {
    writeAtomic(target.realPath, templateText);
    return 'created';
  }
  const hostText = readFileSync(target.realPath, 'utf8');
  const { text, changed, warning } = mergeFn(templateText, hostText);
  if (warning) {
    emit(`code-conductor: skipping ${targetPath} — ${warning}; fix the cc:managed markers and re-run`);
    return 'skipped-warning';
  }
  if (!changed) return 'unchanged';
  // Backup BEFORE the rewrite and let a backup/prune failure propagate: an
  // unrecoverable overwrite is worse than a failed install.
  if (hostText.trim() !== '') backupFile(target.realPath, now);
  writeAtomic(target.realPath, text);
  return 'merged';
}
