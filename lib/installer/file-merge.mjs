import {
  existsSync, lstatSync, statSync, realpathSync, readFileSync,
  writeFileSync, copyFileSync, renameSync, unlinkSync,
} from 'node:fs';
import { utcStamp, pruneBackups } from './settings.mjs';

const BACKUP_SUFFIX = '.installer-backup.';
const MAX_BACKUPS = 5;
// Advice per warning code; the default fits every sentinel-count warning.
const WARNING_ADVICE = {
  CLAUDE_MD_UNCLOSED_FENCE: 'close the code fence that runs to the end of the file and re-run',
};

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
  // Retention is best effort: once the copy exists, a failed prune must not make the
  // caller report "could not back it up" for a backup that is sitting on disk.
  try { pruneBackups(realPath, BACKUP_SUFFIX, MAX_BACKUPS); } catch { /* best effort */ }
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

export function mergeFileInto(templatePath, targetPath, mergeFn, { now = new Date(), warn, onBackup } = {}) {
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
  // Defence in depth for a damaged or hand-edited package. The bundled ignore
  // template used to vanish here for real — npm strips any file named
  // `.gitignore` from a tarball — which is why it now ships undotted and is
  // mapped on deploy. Nothing bundled is expected to be absent any more; an
  // absent template is skipped rather than aborting the whole install.
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
  const { text, changed, warning, notice } = mergeFn(templateText, hostText);
  if (warning) {
    emit(`code-conductor: skipping ${targetPath} — ${warning}; ${WARNING_ADVICE[warning] || 'fix the cc:managed markers and re-run'}`);
    return 'skipped-warning';
  }
  if (!changed) return 'unchanged';
  const status = backupThenWrite(target.realPath, targetPath, text, hostText.trim() !== '', { now, emit, onBackup });
  if (status === 'merged' && notice) emit(`code-conductor: ${notice}`);
  return status;
}

// Backup first, and a failed backup stops the write: an unrecoverable overwrite is
// worse than a skipped file. The path is reported the moment the copy exists, so the
// person running the installer learns where it is even if the write then fails.
function backupThenWrite(realPath, targetPath, text, needsBackup, { now, emit, onBackup }) {
  let backup = null;
  if (needsBackup) {
    try { backup = backupFile(realPath, now); } catch (err) {
      emit(`code-conductor: skipping ${targetPath} — could not back it up (${err.code || err.message}); nothing was written`);
      return 'skipped-backup-failed';
    }
    if (onBackup) onBackup(backup);
  }
  try { writeAtomic(realPath, text); } catch (err) {
    emit(`code-conductor: could not write ${targetPath} (${err.code || err.message}); it is unchanged${backup ? `, and its backup is ${backup}` : ''}`);
    return 'write-failed';
  }
  return 'merged';
}
