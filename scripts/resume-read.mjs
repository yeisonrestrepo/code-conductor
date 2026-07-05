// scripts/resume-read.mjs
// ARCH-008-B: phase-entry resume reader. Zero-dep. Node-14 syntax only.
// Exit 0 = hit (RESUME_HIT block on stdout), 3 = clean miss (zero bytes), 4 = corrupt handoff halt.
import { existsSync, readFileSync, writeFileSync, appendFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SENTINEL = '0000000';
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

let rootTier = 1; // 1 = git toplevel, 2 = .git upward walk, 3 = script-parent
function resolveRoot() {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'],
      { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'], env: process.env }).trim();
    if (top) { rootTier = 1; return top; }
  } catch {}
  let dir = process.cwd();
  for (let i = 0; i < 40; i++) {
    if (existsSync(join(dir, '.git'))) { rootTier = 2; return dir; }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  rootTier = 3;
  return join(SCRIPT_DIR, '..');
}

const root = resolveRoot();
const COND = join(root, '.conductor');
const LOG = join(COND, 'last-write.log');
const HANDOFF = join(root, '.claude/memory/session-snapshot.json');
const LEGACY_MD = join(root, '.claude/memory/session-snapshot.md');
const VALIDATE = join(SCRIPT_DIR, 'snap-validate.mjs');
const CONDUCTOR_DB = join(SCRIPT_DIR, 'conductor-db.mjs');

function trace(token) {
  try {
    mkdirSync(COND, { recursive: true });
    appendFileSync(LOG, new Date().toISOString() + ' resume: ' + token + '\n', { encoding: 'utf8', flag: 'a' });
  } catch {}
}

function tryUnlink(p) { try { unlinkSync(p); } catch {} }
function parseJson(s) { try { return JSON.parse(s); } catch { return undefined; } }

function resolveHash() {
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'],
      { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'], env: process.env }).trim().toLowerCase();
    if (/^[0-9a-f]{7,64}$/.test(out)) return out;
  } catch {}
  return SENTINEL;
}

// Validate an existing file path via snap-validate (exit-code verdict).
function validateFile(p) {
  const r = spawnSync(process.execPath, [VALIDATE, p], { encoding: 'utf8', env: process.env });
  return r.status === 0;
}

// DB branch - replaced in Task 3. For now every hash falls through to the file branch.
function queryDb(hash) { return null; }

function buildHit(source, snap, hash) {
  const proseAvail = typeof snap.pr === 'string' && snap.pr.length > 0;
  const lines = [
    'RESUME_HIT',
    'source: ' + source,
    'commit: ' + hash,
    'phase: ' + snap.sys.ph,
    'spec: ' + snap.sys.s,
    'version: ' + snap.v,
    'prose: ' + (proseAvail ? 'available' : 'none'),
    'pending:'
  ];
  const pend = (snap.ops && Array.isArray(snap.ops.n)) ? snap.ops.n : [];
  for (const item of pend) lines.push('- ' + item);
  return lines.join('\n') + '\n';
}

function main() {
  // Tier-2/tier-3 root fallbacks are diagnostically traced (git was absent or not a repo).
  if (rootTier === 2) trace('root-tier2-gitwalk');
  else if (rootTier === 3) trace('root-tier3-scriptparent');
  // Legacy .md sweep - unread, best-effort.
  if (existsSync(LEGACY_MD)) { tryUnlink(LEGACY_MD); trace('legacy-md-swept'); }

  const hash = resolveHash();

  // DB branch (authoritative when present + valid).
  const dbSnap = queryDb(hash);
  if (dbSnap) {
    if (existsSync(HANDOFF)) tryUnlink(HANDOFF); // superseded
    trace('db-hit @' + hash);
    return { code: 0, out: buildHit('db', dbSnap, hash) };
  }

  // Handoff-file branch.
  if (!existsSync(HANDOFF)) { trace('miss'); return { code: 3, out: '' }; }
  let content;
  try { content = readFileSync(HANDOFF, 'utf8'); }
  catch { trace('file-unreadable degrade'); return { code: 3, out: '' }; } // leave file on disk
  if (content.trim() === '') { trace('file-empty degrade'); tryUnlink(HANDOFF); return { code: 3, out: '' }; }
  if (!validateFile(HANDOFF)) { trace('file-invalid halt'); return { code: 4, out: '' }; } // leave on disk
  const snap = parseJson(content);
  if (snap === undefined) { trace('file-invalid halt'); return { code: 4, out: '' }; }
  if (snap.sys.c !== hash) { trace('file-stale-hash degrade'); tryUnlink(HANDOFF); return { code: 3, out: '' }; }
  // valid + hash matches → bind (content already captured), then unlink.
  const out = buildHit('file', snap, hash);
  trace('file-bind+unlink');
  tryUnlink(HANDOFF);
  return { code: 0, out: out };
}

let res;
try { res = main(); } catch { res = { code: 3, out: '' }; }
if (res.out) { process.stdout.write(res.out, () => process.exit(res.code)); }
else { process.exit(res.code); }
