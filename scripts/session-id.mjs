import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, basename, join } from 'node:path';

// Repo root: git toplevel, else bounded .git upward walk, else this script's parent.
function resolveRoot() {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (top) return top;
  } catch { /* fall through */ }
  let dir = process.cwd();
  for (let i = 0; i < 40; i++) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // this script lives at <root>/scripts/session-id.mjs (dev checkout) or
  // <root>/.claude/scripts/session-id.mjs (deployed project).
  const parent = join(dirname(fileURLToPath(import.meta.url)), '..');
  return basename(parent) === '.claude' ? join(parent, '..') : parent;
}

function emit(id) { process.stdout.write(id + '\n'); }

// A cache value is adoptable only if it is a single non-empty token with no interior
// whitespace/control chars and a sane length. Atomic temp+rename already prevents torn
// writes, so this is defense-in-depth against ever emitting a truncated/garbage id.
const looksValid = (v) => !!v && v.length <= 200 && !/\s/.test(v);

function main() {
  // Empty or whitespace-only env var is treated as unset: trim → '' → falsy → fall through.
  const env = (process.env.CLAUDE_CODE_SESSION_ID || '').trim();
  if (env) return emit(env);                       // primary path: cacheless, unique per session

  const dir = join(resolveRoot(), '.conductor');
  const cache = join(dir, 'session-id');

  try {
    const cached = readFileSync(cache, 'utf8').trim();
    if (looksValid(cached)) return emit(cached);
  } catch { /* absent or unreadable -> generate */ }

  const id = randomUUID();
  const tmp = join(dir, `session-id.${process.pid}.tmp`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(tmp, id + '\n');
    renameSync(tmp, cache);                         // atomic publish
  } catch {
    // Any write-side failure is caught here: a read-only/permission-denied shared
    // dir (EACCES/EPERM on mkdir or write), or a rename race (EEXIST on POSIX,
    // EPERM/EACCES from a Windows AV/reader lock on the target). Re-read and adopt
    // the winner if one landed; otherwise fall through to the in-memory UUID.
    try {
      const won = readFileSync(cache, 'utf8').trim();
      if (looksValid(won)) { try { unlinkSync(tmp); } catch {} return emit(won); }
    } catch { /* still nothing on disk / dir unreadable */ }
    try { unlinkSync(tmp); } catch {}               // best-effort temp cleanup; a locked temp is left, swept by post-compact
  }
  emit(id);
}

main();
