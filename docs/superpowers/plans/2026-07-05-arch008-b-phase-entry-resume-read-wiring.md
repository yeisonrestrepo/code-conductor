# Phase-Entry Resume Read Wiring (ARCH-008-B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire phase entry (`cc-spec`/`cc-plan`/`cc-implement`) to restore agent context across branch switches and rollbacks by reading the DB snapshot for the current git commit, falling back to the handoff file.

**Architecture:** One new zero-dependency script, `scripts/resume-read.mjs`, resolves the full-length git hash, prefers a valid `conductor-db get-snapshot` blob (DB wins), else binds the fail-open handoff file, printing a fixed `RESUME_HIT` block on a hit / zero bytes on a miss / exit 4 on a corrupt handoff. The six phase-entry command mirrors collapse their ad-hoc read blocks into a single call to it. `snap-validate.mjs`'s `sys.c` ceiling widens to accept SHA-256; the `post-compact` hooks sweep the new validation temp.

**Tech Stack:** Node ≥14 ESM (`.mjs`, zero-dep), `node:sqlite` (via ARCH-008-A flag probe, isolated to the `conductor-db` sub-call), vitest, bash + PowerShell command/hook mirrors.

## Global Constraints

- Zero-dependency scripts; `resume-read.mjs` runs flag-free on any Node ≥14 (the `--experimental-sqlite` probe is confined to the `conductor-db` sub-call).
- Node-14 syntax only: no `||=`/`&&=`/`??=` (Node ≥15), no `Array.prototype.at` (≥16.6), no `structuredClone` (≥17), no top-level `await`, no `Error.cause`. `??` and `?.` are permitted.
- Fail-open everywhere: `resume-read` never crashes or hangs phase entry; only a **readable + non-empty + invalid** handoff halts (exit 4); every other condition degrades to a clean miss (exit 3, zero bytes on stdout).
- Every spawned Node child uses `process.execPath` (never the string `'node'`); `git` alone is located via PATH. Every `spawnSync`/`execFileSync` passes `env: process.env` explicitly. Every fs read/write/append passes `'utf8'`; every `spawnSync` passes `{ encoding: 'utf8' }`.
- All paths are `join(root, …)` (root-relative), root resolved by a three-tier git-independent chain (git toplevel → bounded `.git` walk → script-parent).
- `docs/` and `.claude/` are gitignored → commit those with `git add -f`. `scripts/`, `tests/`, `global/` (n/a here), the root manifests, and `project-template/` are tracked normally.
- BUG-003 invariant: all state updates to tracking files (`AGENT-READABLE BACKLOG.md`) are surgical single-line edits, one checkbox/field at a time - never a bulk rewrite.
- TDD: one task = one commit, strict red→green. The pre-commit gate runs `vitest run` and must stay green (351 baseline + the new resume-read and 64-char validator tests).
- Every commit message ends with a trailing line: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- **Create** `scripts/resume-read.mjs` - the resume reader. Single responsibility: resolve hash → prefer valid DB blob → else bind handoff file → print `RESUME_HIT`/nothing/halt. ~120 lines.
- **Create** `tests/scripts/resume-read.test.js` - hermetic vitest suite using real temp git repos (mirrors the `snap-build`/`snap-validate` harness conventions).
- **Create** `tests/helpers/sqlite.js` - shared `sqliteAvailable()`/`dbFlags()` probe, imported by suites instead of inline-duplicating the `node:sqlite` capability check.
- **Modify** `scripts/snap-validate.mjs` - widen the `sys.c` regex only (`{7,40}`→`{7,64}`).
- **Modify** `tests/unit/snap-validate.test.js` - add a 64-char accept case; retarget the 41-char reject to 65-char.
- **Modify** six command mirrors (`.claude/commands/` + `project-template/.claude/commands/` × `cc-spec`/`cc-plan`/`cc-implement`) - replace the phase-entry read block with the canonical `resume-read.mjs` capture; remove the legacy `.md` path.
- **Modify** four hooks (`.claude/hooks/` + `project-template/.claude/hooks/` × `post-compact.sh`/`.ps1`) - one added sweep line for `resume-validate.*.tmp.json`.
- **Modify** release files (`VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`) - v1.22.0 closeout, gated last.

---

### Task 1: Widen `snap-validate.mjs` `sys.c` ceiling to accept SHA-256

**Files:**
- Modify: `scripts/snap-validate.mjs:31`
- Test: `tests/unit/snap-validate.test.js:317-332`

**Interfaces:**
- Consumes: nothing (independent companion change; do first).
- Produces: `snap-validate.mjs` accepts a 64-char lowercase-hex `sys.c` (exit 0); still rejects 65-char and non-hex. `resume-read.mjs` (Tasks 2-3) relies on this so a SHA-256 handoff/blob never halts.

- [X] [T-001] **Widen `sys.c` regex and cover 64-char SHA-256**

- [X] [T-001-A] **Step 1: Add the failing 64-char accept test and retarget the reject boundary**

In `tests/unit/snap-validate.test.js`, replace the existing `rejects a 41-char sys.c hash` block (lines 327-332) with a 64-char accept case followed by a 65-char reject case:

```js
  it('accepts a 64-char sys.c hash (SHA-256 object id)', () => {
    const long = { ...VALID, sys: { ...VALID.sys, c: 'a'.repeat(64) } }
    expect(run(fixture(j(long))).status).toBe(0)
  })

  it('rejects a 65-char sys.c hash', () => {
    const bad = { ...VALID, sys: { ...VALID.sys, c: 'a'.repeat(65) } }
    const r = run(fixture(j(bad)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: invalid sys.c format\n')
  })
```

- [X] [T-001-B] **Step 2: Run the new tests to verify the 64-char case fails**

Run: `npx vitest run tests/unit/snap-validate.test.js -t "64-char sys.c"`
Expected: FAIL - status is `1` (current regex `{7,40}` rejects 64 chars), assertion `expect(...).toBe(0)` fails.

- [X] [T-001-C] **Step 3: Widen the regex**

In `scripts/snap-validate.mjs:31`, change only the `sys.c` length ceiling:

```js
if (!/^[0-9a-f]{7,64}$/.test(snap.sys.c)) err('invalid sys.c format'); if (!/^[a-zA-Z0-9._-]+$/.test(snap.sys.s)) err('invalid chars in sys.s');
```

- [X] [T-001-D] **Step 4: Run the full validator suite to verify green**

Run: `npx vitest run tests/unit/snap-validate.test.js`
Expected: PASS - 64-char accepts (exit 0), 65-char rejects (exit 1), 40-char and sentinel regressions still pass.

- [X] [T-001-E] **Step 5: Commit**

```bash
git add scripts/snap-validate.mjs tests/unit/snap-validate.test.js
git commit -m "feat(ARCH-008-B): widen snap-validate sys.c ceiling to 64 for SHA-256

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `resume-read.mjs` core - root/hash resolve, emitter, trace, legacy sweep, handoff-file branch

**Files:**
- Create: `scripts/resume-read.mjs`
- Test: `tests/scripts/resume-read.test.js`

**Interfaces:**
- Consumes: `scripts/snap-validate.mjs` (via `process.execPath`, exit-code verdict) from Task 1.
- Produces: an executable that resolves the git hash, sweeps a legacy `.md`, and binds the handoff file. `queryDb(hash)` is a stub returning `null` here (Task 3 fills it). Exit contract: `0` hit (stdout `RESUME_HIT` block), `3` miss (zero bytes), `4` halt (readable + non-empty + invalid handoff). Exit-code mapping is exhaustive: `0` = a valid DB or handoff hit; `3` = a clean miss, covering no handoff, an unreadable handoff (EACCES/EIO), an empty or whitespace-only handoff (checked before validation and best-effort deleted), a hash-stale handoff, a sentinel or non-full-hash DB bypass, a DB degrade, and any uncaught startup error; `4` = a handoff that is readable and non-empty but structurally invalid (malformed JSON, or a schema/version failure). Only `4` halts; `3` and every other code proceed fresh. Prints via a drain-callback so stdout is never truncated. Task 3 replaces the `queryDb` stub in place; Task 4 consumes the exit codes and stdout block from the command mirrors.

- [ ] [T-002] **Build the resume-read core and its file-branch test suite**

- [ ] [T-002-A] **Step 1: Write the failing test suite**

Create `tests/scripts/resume-read.test.js`:

```js
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../scripts/resume-read.mjs', import.meta.url));
const HANDOFF_REL = '.claude/memory/session-snapshot.json';
const LEGACY_REL = '.claude/memory/session-snapshot.md';

const repos = [];
afterEach(() => { while (repos.length) { try { rmSync(repos.pop(), { recursive: true, force: true }); } catch {} } });

// A real one-commit git repo so `git rev-parse HEAD` yields a deterministic, controllable hash.
function mkRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'resume-'));
  repos.push(dir);
  const g = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  g(['init', '-q']);
  g(['config', 'user.email', 't@t.t']);
  g(['config', 'user.name', 'T']);
  writeFileSync(join(dir, 'f'), 'x', 'utf8');
  g(['add', '.']);
  g(['commit', '-q', '-m', 'init']);
  const head = g(['rev-parse', 'HEAD']).trim();
  mkdirSync(join(dir, '.claude', 'memory'), { recursive: true });
  return { dir, head };
}
function run(dir) {
  return spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8', env: process.env });
}
function writeHandoff(dir, obj) { writeFileSync(join(dir, HANDOFF_REL), JSON.stringify(obj) + '\n', 'utf8'); }
function snap(head, extra = {}) {
  return { v: 1, sys: { ph: 'plan', c: head, s: 'my-spec' }, ops: { n: ['do a', 'do b'], f: [] }, mem: { d: [], x: [] }, ...extra };
}

describe('resume-read.mjs core (file branch)', () => {
  it('total miss: no DB, no handoff → exit 3, zero bytes on stdout', () => {
    const { dir } = mkRepo();
    const r = run(dir);
    expect(r.status).toBe(3);
    expect(r.stdout).toBe('');
  });

  it('valid, hash-matching handoff → binds, unlinks, exit 0, RESUME_HIT block', () => {
    const { dir, head } = mkRepo();
    writeHandoff(dir, snap(head));
    const r = run(dir);
    expect(r.status).toBe(0);
    const lines = r.stdout.split('\n');
    expect(lines[0]).toBe('RESUME_HIT');
    expect(lines).toContain('source: file');
    expect(lines).toContain('commit: ' + head);
    expect(lines).toContain('phase: plan');
    expect(lines).toContain('spec: my-spec');
    expect(lines).toContain('version: 1');
    expect(lines).toContain('prose: none');
    expect(lines).toContain('pending:');
    expect(lines).toContain('- do a');
    expect(lines).toContain('- do b');
    expect(existsSync(join(dir, HANDOFF_REL))).toBe(false); // unlinked after bind
  });

  it('v2 handoff with pr → prose: available', () => {
    const { dir, head } = mkRepo();
    writeHandoff(dir, snap(head, { v: 2, pr: 'a note' }));
    const r = run(dir);
    expect(r.status).toBe(0);
    expect(r.stdout.split('\n')).toContain('prose: available');
  });

  it('readable + non-empty + invalid handoff → exit 4, file left on disk', () => {
    const { dir } = mkRepo();
    writeFileSync(join(dir, HANDOFF_REL), '{ not valid json', 'utf8');
    const r = run(dir);
    expect(r.status).toBe(4);
    expect(r.stdout).toBe('');
    expect(existsSync(join(dir, HANDOFF_REL))).toBe(true);
  });

  it('empty handoff → degrade to miss (exit 3), file deleted, no halt', () => {
    const { dir } = mkRepo();
    writeFileSync(join(dir, HANDOFF_REL), '   \n', 'utf8');
    const r = run(dir);
    expect(r.status).toBe(3);
    expect(r.stdout).toBe('');
    expect(existsSync(join(dir, HANDOFF_REL))).toBe(false);
  });

  it('valid but hash-stale handoff → not bound, deleted, exit 3', () => {
    const { dir } = mkRepo();
    writeHandoff(dir, snap('b'.repeat(40))); // sys.c != current HEAD
    const r = run(dir);
    expect(r.status).toBe(3);
    expect(r.stdout).toBe('');
    expect(existsSync(join(dir, HANDOFF_REL))).toBe(false);
  });

  it('legacy .md is swept unread (best-effort), does not bind', () => {
    const { dir } = mkRepo();
    writeFileSync(join(dir, LEGACY_REL), '# old handoff', 'utf8');
    const r = run(dir);
    expect(r.status).toBe(3);
    expect(existsSync(join(dir, LEGACY_REL))).toBe(false);
  });

  it('writes an ISO-timestamped resume: trace line to .conductor/last-write.log', () => {
    const { dir, head } = mkRepo();
    writeHandoff(dir, snap(head));
    run(dir);
    const log = readFileSync(join(dir, '.conductor', 'last-write.log'), 'utf8');
    expect(log).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z resume: file-bind\+unlink$/m);
  });

  it('uses only Node-14-compatible syntax (no ||=/&&=/??=/.at(/structuredClone)', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src).not.toMatch(/\|\|=|&&=|\?\?=/);
    expect(src).not.toMatch(/\.at\(/);
    expect(src).not.toMatch(/structuredClone/);
  });
});
```

- [ ] [T-002-B] **Step 2: Run the suite to verify it fails**

Run: `npx vitest run tests/scripts/resume-read.test.js`
Expected: FAIL - every test errors because `scripts/resume-read.mjs` does not exist yet (`Cannot find module`).

- [ ] [T-002-C] **Step 3: Write the resume-read core**

Create `scripts/resume-read.mjs` (the `queryDb` stub is replaced in Task 3):

```js
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
```

- [ ] [T-002-D] **Step 4: Run the suite to verify green**

Run: `npx vitest run tests/scripts/resume-read.test.js`
Expected: PASS - all core file-branch cases green (miss, bind+unlink, v2 prose, invalid halt, empty degrade, hash-stale, legacy sweep, trace line, Node-14 syntax).

- [ ] [T-002-E] **Step 5: Commit**

```bash
git add scripts/resume-read.mjs tests/scripts/resume-read.test.js
git commit -m "feat(ARCH-008-B): add resume-read core with handoff-file branch

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `resume-read.mjs` DB branch - get-snapshot precedence, gate, temp-validate, branch-switch

**Files:**
- Modify: `scripts/resume-read.mjs` (replace the `queryDb` stub; add `probeSqliteFlags` + `validateBlob`)
- Test: `tests/scripts/resume-read.test.js` (append a `describe` block)

**Interfaces:**
- Consumes: `scripts/conductor-db.mjs` `get-snapshot <hash>` (ARCH-008-S1, non-destructive `SELECT … ORDER BY id DESC LIMIT 1`) via `process.execPath` + Node-flag probe; `scripts/snap-validate.mjs` (exit-code verdict) via a `.conductor/resume-validate.<pid>.tmp.json` temp.
- Produces: a `queryDb(hash)` that returns a validated snap object on a DB hit or `null` to fall through. On a hit `main` deletes the handoff (superseded). The DB is best-effort: any degrade (Node <22.5, `node:sqlite` absent, timeout, non-zero exit, empty output, invalid blob, sentinel/non-full hash) falls through to the file branch, never a halt. The DB-blob validation temp `.conductor/resume-validate.<pid>.tmp.json` (pid-unique via `process.pid`, so concurrent phase entries never collide) is created and removed inside a `try/finally` in `validateBlob`, so it is cleaned immediately on every normal or throwing return; the Task 5 post-compact sweep is only a belt-and-suspenders reclaim for a hard SIGKILL landing in the sub-second validation window.

- [ ] [T-003] **Add the DB precedence branch and its tests**

- [ ] [T-003-A] **Step 1: Write the failing DB tests**

First centralize the SQLite-capability probe in a shared helper so it is defined once, not re-inlined in each suite. Create `tests/helpers/sqlite.js`:

```js
import { spawnSync } from 'node:child_process';

// Shared across test suites: probe whether this Node can open node:sqlite and
// which launch flags it needs. Centralized here so no suite duplicates the probe.
export function dbFlags() {
  const opts = { encoding: 'utf8', timeout: 2000, env: process.env };
  if (spawnSync(process.execPath, ['--no-warnings', '-e', "require('node:sqlite')"], opts).status === 0) return [];
  if (spawnSync(process.execPath, ['--experimental-sqlite', '--no-warnings', '-e', "require('node:sqlite')"], opts).status === 0) {
    return ['--experimental-sqlite', '--no-warnings'];
  }
  return null;
}

export function sqliteAvailable() { return dbFlags() !== null; }
```

Then append the DB suite to `tests/scripts/resume-read.test.js` (after the core `describe`), importing the shared helper rather than re-inlining the probe. These tests self-skip when the local Node cannot open `node:sqlite`, so they never falsely fail on an old runtime:

```js
import { sqliteAvailable, dbFlags } from '../helpers/sqlite.js';
const DB = fileURLToPath(new URL('../../scripts/conductor-db.mjs', import.meta.url));
// Store a snapshot blob for a hash via the real conductor-db writer, into the repo's .conductor/cache.db.
function dbStore(dir, hash, obj) {
  const args = dbFlags().concat([DB, 'snapshot', hash]);
  const r = spawnSync(process.execPath, args, { cwd: dir, input: JSON.stringify(obj), encoding: 'utf8', env: process.env });
  expect(r.status).toBe(0);
}

describe.runIf(sqliteAvailable())('resume-read.mjs DB branch', () => {
  it('DB hit + valid blob → source: db, deletes handoff, exit 0', () => {
    const { dir, head } = mkRepo();
    dbStore(dir, head, snap(head, { sys: { ph: 'impl', c: head, s: 'db-spec' }, ops: { n: ['db pending'], f: [] } }));
    writeHandoff(dir, snap(head)); // present but superseded
    const r = run(dir);
    expect(r.status).toBe(0);
    const lines = r.stdout.split('\n');
    expect(lines[0]).toBe('RESUME_HIT');
    expect(lines).toContain('source: db');
    expect(lines).toContain('phase: impl');
    expect(lines).toContain('spec: db-spec');
    expect(lines).toContain('- db pending');
    expect(existsSync(join(dir, HANDOFF_REL))).toBe(false); // handoff deleted as superseded
    expect(existsSync(join(dir, '.conductor', 'cache.db'))).toBe(true); // non-destructive read
  });

  it('DB miss + valid handoff → falls through to file branch (source: file)', () => {
    const { dir, head } = mkRepo();
    writeHandoff(dir, snap(head));
    const r = run(dir);
    expect(r.status).toBe(0);
    expect(r.stdout.split('\n')).toContain('source: file');
  });

  it('branch-switch isolation: context stored at A is restored at A, absent at B', () => {
    const { dir, head } = mkRepo(); // commit A = head
    const g = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    dbStore(dir, head, snap(head, { sys: { ph: 'plan', c: head, s: 'branch-a' } }));
    // switch to a NEW commit B with no stored snapshot
    g(['checkout', '-q', '-b', 'other']);
    writeFileSync(join(dir, 'f2'), 'y', 'utf8');
    g(['add', '.']);
    g(['commit', '-q', '-m', 'B']);
    const rB = run(dir);
    expect(rB.status).toBe(3); // miss at B - no leak from A
    // switch back to A → restored
    g(['checkout', '-q', '-']);
    const rA = run(dir);
    expect(rA.status).toBe(0);
    expect(rA.stdout.split('\n')).toContain('spec: branch-a');
  });

  it('non-destructive: two successive reads at the same commit both hit', () => {
    const { dir, head } = mkRepo();
    dbStore(dir, head, snap(head, { sys: { ph: 'plan', c: head, s: 's' } }));
    expect(run(dir).status).toBe(0);
    expect(run(dir).status).toBe(0);
  });
});
```

- [ ] [T-003-B] **Step 2: Run the DB tests to verify they fail**

Run: `npx vitest run tests/scripts/resume-read.test.js -t "DB branch"`
Expected: FAIL (when `node:sqlite` is available) - `queryDb` still returns `null`, so the DB-hit test gets `source: file` (or exit 3), not `source: db`; the branch-switch test's restore assertion fails. (On a Node without `node:sqlite`, the block is skipped via `describe.runIf` - that is expected, not a failure.)

- [ ] [T-003-C] **Step 3: Replace the `queryDb` stub with the real DB branch**

In `scripts/resume-read.mjs`, replace exactly this stub line:

```js
// DB branch - replaced in Task 3. For now every hash falls through to the file branch.
function queryDb(hash) { return null; }
```

with the full DB implementation plus its two helpers:

```js
// Probe how to launch node:sqlite. Returns [] (no flag), ['--experimental-sqlite','--no-warnings'], or null (unavailable).
function probeSqliteFlags() {
  const opts = { encoding: 'utf8', timeout: 2000, env: process.env };
  if (spawnSync(process.execPath, ['--no-warnings', '-e', "require('node:sqlite')"], opts).status === 0) return [];
  if (spawnSync(process.execPath, ['--experimental-sqlite', '--no-warnings', '-e', "require('node:sqlite')"], opts).status === 0) {
    return ['--experimental-sqlite', '--no-warnings'];
  }
  return null;
}

// Validate an in-memory blob by bridging it through the path-only snap-validate via a pid-unique temp.
function validateBlob(blob) {
  const tmp = join(COND, 'resume-validate.' + process.pid + '.tmp.json');
  try { mkdirSync(COND, { recursive: true }); writeFileSync(tmp, blob, 'utf8'); }
  catch { return false; } // FS write error → blob unusable, degrade
  try {
    const r = spawnSync(process.execPath, [VALIDATE, tmp], { encoding: 'utf8', env: process.env });
    return r.status === 0;
  } finally { tryUnlink(tmp); }
}

// DB branch - returns a validated snap object on a hit, or null to fall through to the file branch.
function queryDb(hash) {
  if (!/^([0-9a-f]{40}|[0-9a-f]{64})$/.test(hash)) {
    trace(hash === SENTINEL ? 'sentinel-bypass' : 'nonfull-hash-bypass');
    return null;
  }
  const flags = probeSqliteFlags();
  if (flags === null) return null; // Node <22.5 or node:sqlite absent → degrade
  const args = flags.concat([CONDUCTOR_DB, 'get-snapshot', hash]);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 5000, env: process.env });
  if (r.status !== 0 || !r.stdout) return null; // timeout/kill/non-zero/empty → miss
  const blob = r.stdout.trim();
  if (blob === '') return null;
  if (!validateBlob(blob)) { trace('db-invalid degrade'); return null; }
  const snap = parseJson(blob);
  if (snap === undefined) { trace('db-invalid degrade'); return null; }
  return snap;
}
```

- [ ] [T-003-D] **Step 4: Run the full resume-read suite to verify green**

Run: `npx vitest run tests/scripts/resume-read.test.js`
Expected: PASS - core file-branch cases still green; DB-hit binds `source: db` and deletes the handoff; branch-switch restores at A, misses at B; two successive reads both hit (non-destructive). (DB block skipped only if the runner's Node lacks `node:sqlite`.)

- [ ] [T-003-E] **Step 5: Commit**

```bash
git add scripts/resume-read.mjs tests/scripts/resume-read.test.js
git commit -m "feat(ARCH-008-B): add DB get-snapshot precedence branch to resume-read

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Rewire the six phase-entry command mirrors to call `resume-read.mjs`

**Files:**
- Modify: `.claude/commands/cc-spec.md`, `project-template/.claude/commands/cc-spec.md`
- Modify: `.claude/commands/cc-plan.md`, `project-template/.claude/commands/cc-plan.md`
- Modify: `.claude/commands/cc-implement.md`, `project-template/.claude/commands/cc-implement.md`

**Interfaces:**
- Consumes: `scripts/resume-read.mjs` (exit codes 0/3/4, `RESUME_HIT` stdout block) from Tasks 2-3.
- Produces: each command's phase-entry section replaced by the canonical resume block below; the legacy `.md` handoff path removed from all three. These are agent-interpreted prose files with no unit test - verification is by inspection plus the full suite staying green (no `.mjs`/`.test.js` change here).

**Canonical replacement block** (identical text substituted into all six files, replacing whatever phase-entry section currently opens the file - `## Phase entry - Destructive Read Invariant` in `cc-spec`, `## Phase entry - Handoff enforcement` + `## Phase entry - Destructive Read Invariant` in `cc-plan`, and the JSON `## Phase entry - Handoff enforcement` + `## Phase entry - Destructive Read Invariant` in `cc-implement`):

````markdown
## Phase entry - Resume Read

Before doing anything else, restore any stored context for the current commit by running `scripts/resume-read.mjs`. It resolves the current git hash, prefers a valid DB snapshot (`conductor-db get-snapshot`), falls back to the `.claude/memory/session-snapshot.json` handoff file, and prints a `RESUME_HIT` block on a hit / nothing on a miss. Capture its stdout **and** its exit code with the canonical per-platform form (each first probes for `node` and treats its absence as a clean miss, never an error):

- **Unix / Git Bash:**
  ```sh
  if command -v node >/dev/null 2>&1; then
    resume_out="$(node scripts/resume-read.mjs 2>>.conductor/last-write.log)"; resume_rc=$?
  else resume_rc=3; resume_out=""; fi
  ```
- **PowerShell:**
  ```powershell
  if (Get-Command node -ErrorAction SilentlyContinue) {
    $__eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
      $__nap = $PSNativeCommandUseErrorActionPreference; $PSNativeCommandUseErrorActionPreference = $false
    }
    try {
      $resume_out = node scripts/resume-read.mjs 2>> .conductor/last-write.log; $resume_rc = $LASTEXITCODE
    } catch { $resume_rc = 3; $resume_out = "" }
    finally {
      $ErrorActionPreference = $__eap
      if (Test-Path variable:__nap) { $PSNativeCommandUseErrorActionPreference = $__nap }
    }
  } else { $resume_rc = 3; $resume_out = "" }
  ```

Branch on `resume_rc` - **only `0` and `4` are meaningful; every other code proceeds fresh:**

- **`0`** → parse the captured block and adopt it as this phase's starting context, then echo one banner to the user: `> Resumed from stored snapshot @ <commit> (phase: <phase>)`, appending ` (checkpoint prose available)` when the block reports `prose: available`. Parsing (the command owns normalization): split on `\n`; strip a trailing `\r` from every line; drop leading/trailing wholly-blank lines; require `lines[0].trim() === 'RESUME_HIT'` (anything else = miss); `key: value` lines split on the first `': '` (both sides trimmed); the `pending:` block is every subsequent `^\s*-\s+` line up to the first blank line or EOF, each item trimmed. Unknown keys are ignored. In PowerShell, `node …` binds `string[]` for multi-line output - normalize with `$lines = @($resume_out)`; a `$null`/empty capture with `resume_rc = 3` is a miss.
- **`4`** → **operational halt.** Do not run this phase's normal work. Emit exactly: `SNAP_INVALID: corrupt handoff at .claude/memory/session-snapshot.json - inspect or remove it, then re-run.` and enter standby awaiting user action. The corrupt file is left on disk (the script did not delete it).
- **`3` or any other code** → **proceed fresh** (clean miss, bypass, degrade, absent `node`, or any unexpected runtime code). Ignore the capture.

`resume-read.mjs` writes its own trace lines to `.conductor/last-write.log` via `appendFileSync`; the `2>>` redirect above only sinks the incidental exit-4 halt reason away from the UI - it is not the trace channel.

---
````

- [ ] [T-004] **Rewire all six command mirrors**

- [ ] [T-004-A] **Step 1: Replace the phase-entry block in `.claude/commands/cc-spec.md`**

Read lines 1-14, then replace the block spanning `## Phase entry - Destructive Read Invariant` through its closing `---` (currently lines 5-14, ending at the `---` on line 14) with the canonical Resume Read block above (preserve the YAML frontmatter on lines 1-3 and the blank line 4). Use `git add -f` at commit (`.claude/` is gitignored).

- [ ] [T-004-B] **Step 2: Replace the phase-entry block in `project-template/.claude/commands/cc-spec.md`**

Apply the identical replacement to the template mirror (same source shape as T-004-A).

- [ ] [T-004-C] **Step 3: Replace the phase-entry block in `.claude/commands/cc-plan.md`**

Replace the two sections `## Phase entry - Handoff enforcement` and `## Phase entry - Destructive Read Invariant` (lines 5 through the `---` closing the Destructive Read Invariant section) with the single canonical Resume Read block. The turn-count handoff-enforcement gate is removed - `resume-read.mjs` no longer depends on turn count.

- [ ] [T-004-D] **Step 4: Replace the phase-entry block in `project-template/.claude/commands/cc-plan.md`**

Apply the identical replacement to the template mirror.

- [ ] [T-004-E] **Step 5: Replace the phase-entry block in `.claude/commands/cc-implement.md`**

Replace both the `## Phase entry - Handoff enforcement` gate and the full JSON `## Phase entry - Destructive Read Invariant` procedure (steps 1-4, the `snap-validate` invocation, the legacy `.md` fallback) with the single canonical Resume Read block. The exit-4 halt contract this block specifies is the same `SNAP_INVALID` gate `cc-implement` used before - now sourced from `resume-read`'s exit code.

- [ ] [T-004-F] **Step 6: Replace the phase-entry block in `project-template/.claude/commands/cc-implement.md`**

Apply the identical replacement to the template mirror.

- [ ] [T-004-G] **Step 7: Verify no legacy `.md` handoff reference and no orphaned turn-count gate remains**

Run:
```bash
grep -rn "session-snapshot.md\|turn count exceeds 5\|Destructive Read Invariant" .claude/commands/cc-spec.md .claude/commands/cc-plan.md .claude/commands/cc-implement.md project-template/.claude/commands/cc-spec.md project-template/.claude/commands/cc-plan.md project-template/.claude/commands/cc-implement.md
grep -rln "resume-read.mjs" .claude/commands project-template/.claude/commands
```
Expected: the first grep returns **nothing** (all legacy read blocks removed); the second lists all six rewired command files.

- [ ] [T-004-H] **Step 8: Run the full suite (regression guard)**

Run: `npm test`
Expected: PASS - 351 baseline + Task 1/2/3 additions; command-file edits touch no test.

- [ ] [T-004-I] **Step 9: Commit**

```bash
git add -f .claude/commands/cc-spec.md .claude/commands/cc-plan.md .claude/commands/cc-implement.md
git add project-template/.claude/commands/cc-spec.md project-template/.claude/commands/cc-plan.md project-template/.claude/commands/cc-implement.md
git commit -m "feat(ARCH-008-B): wire phase-entry commands to resume-read.mjs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Extend the four `post-compact` hooks to sweep `resume-validate.*.tmp.json`

**Files:**
- Modify: `.claude/hooks/post-compact.sh:31`, `project-template/.claude/hooks/post-compact.sh`
- Modify: `.claude/hooks/post-compact.ps1:35`, `project-template/.claude/hooks/post-compact.ps1`

**Interfaces:**
- Consumes: the `.conductor/resume-validate.<pid>.tmp.json` temp naming from Task 3.
- Produces: each hook removes any leaked validation temp at the compaction boundary (the belt-and-suspenders reclaim for the no-signal-listener design). One added line beside the existing `session-id.*.tmp` sweep; no test (hooks are exercised only by the compact lifecycle) - verified by inspection.

- [ ] [T-005] **Add the validation-temp sweep to all four hooks**

- [ ] [T-005-A] **Step 1: Extend `.claude/hooks/post-compact.sh`**

After line 31 (`rm -f "${_cond}"/session-id.*.tmp 2>/dev/null`), add:

```sh
  rm -f "${_cond}"/resume-validate.*.tmp.json 2>/dev/null
```

- [ ] [T-005-B] **Step 2: Extend `project-template/.claude/hooks/post-compact.sh`**

Apply the identical one-line addition to the template mirror (same anchor).

- [ ] [T-005-C] **Step 3: Extend `.claude/hooks/post-compact.ps1`**

After line 35 (`Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $cond 'session-id.*.tmp')`), add:

```powershell
  Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $cond 'resume-validate.*.tmp.json')
```

- [ ] [T-005-D] **Step 4: Extend `project-template/.claude/hooks/post-compact.ps1`**

Apply the identical one-line addition to the template mirror (same anchor).

- [ ] [T-005-E] **Step 5: Restore executable bits on the shell hooks**

Editing the `.sh` hooks in place preserves their mode, but assert the executable bit explicitly so a fresh checkout, or a filesystem that dropped it, still runs them on Unix-like systems (a no-op on native Windows):

```bash
chmod +x .claude/hooks/post-compact.sh project-template/.claude/hooks/post-compact.sh
```

- [ ] [T-005-F] **Step 6: Verify all four hooks sweep the temp**

Run:
```bash
grep -rln "resume-validate.\*.tmp.json" .claude/hooks project-template/.claude/hooks
```
Expected: all four hook files listed.

- [ ] [T-005-G] **Step 7: Commit**

```bash
git add -f .claude/hooks/post-compact.sh .claude/hooks/post-compact.ps1
git add project-template/.claude/hooks/post-compact.sh project-template/.claude/hooks/post-compact.ps1
git commit -m "feat(ARCH-008-B): sweep resume-validate temp in post-compact hooks

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Release closeout - v1.22.0 + backlog flips (gated, last)

**Files:**
- Modify: `VERSION`, `package.json:3`, `package-lock.json:3,8`
- Modify: `CHANGELOG.md:3` (prepend a new entry)
- Modify: `AGENT-READABLE BACKLOG.md:85,105` (surgical checkbox flips)

**Interfaces:**
- Consumes: all prior tasks complete and green.
- Produces: version 1.22.0 across the manifests, a `[1.22.0]` CHANGELOG entry tagged `[ARCH-008-B]`, and both `[ARCH-008-B]` and the umbrella `[ARCH-008]` checkboxes flipped to `[X]` (all three sub-specs now shipped). Surgical single-line edits per BUG-003 - never a bulk rewrite.

- [ ] [T-006] **Ship v1.22.0 and close the ARCH-008 umbrella**

- [ ] [T-006-A] **Step 1: Bump `VERSION`**

Replace the sole line `1.21.0` with `1.22.0`.

- [ ] [T-006-B] **Step 2: Bump `package.json`**

At line 3, change `"version": "1.21.0",` → `"version": "1.22.0",`.

- [ ] [T-006-C] **Step 3: Bump `package-lock.json`**

Change both `"version": "1.21.0",` occurrences (lines 3 and 8 - the root and the root-package node) to `"version": "1.22.0",`. Leave all dependency versions untouched.

- [ ] [T-006-D] **Step 4: Prepend the CHANGELOG entry**

Insert immediately before line 3 (`## [1.21.0] - 2026-07-04`):

```markdown
## [1.22.0] - 2026-07-05

### Added
- `[ARCH-008-B]` Phase-entry resume-read wiring: `scripts/resume-read.mjs` restores agent context across branch switches and rollbacks by reading the DB snapshot for the current git commit (DB wins), falling back to the `.claude/memory/session-snapshot.json` handoff. The `cc-spec`/`cc-plan`/`cc-implement` phase-entry blocks (both mirrors) now call it; a hit prints a `RESUME_HIT` block, a miss proceeds fresh, a corrupt handoff halts (exit 4). Completes the `[ARCH-008]` milestone (S1 schema → A writers → B readers).

### Changed
- `scripts/snap-validate.mjs`: `sys.c` length ceiling widened `{7,40}`→`{7,64}` to accept SHA-256 (64-char) commit hashes.
- `post-compact` hooks (both mirrors): also sweep leaked `.conductor/resume-validate.*.tmp.json` validation temps.

```

- [ ] [T-006-E] **Step 5: Flip the `[ARCH-008-B]` checkbox (surgical)**

At `AGENT-READABLE BACKLOG.md:105`, change `### [ ] \`[ARCH-008-B]\`` → `### [X] \`[ARCH-008-B]\`` (single-line edit).

- [ ] [T-006-F] **Step 6: Flip the umbrella `[ARCH-008]` checkbox (surgical)**

At `AGENT-READABLE BACKLOG.md:85`, change `### [ ] \`[ARCH-008]\`` → `### [X] \`[ARCH-008]\`` (single-line edit; all three sub-specs are now `[X]`).

- [ ] [T-006-G] **Step 7: Verify versions and flips**

Run:
```bash
cat VERSION; grep -m1 '"version"' package.json; grep -n "ARCH-008\b\|ARCH-008-B" "AGENT-READABLE BACKLOG.md" | head; grep -n "## \[1.22.0\]" CHANGELOG.md
npm test
```
Expected: `1.22.0` in VERSION and package.json; both backlog lines show `[X]`; the CHANGELOG entry present; the full suite green.

- [ ] [T-006-H] **Step 8: Commit**

```bash
git add VERSION package.json package-lock.json CHANGELOG.md
git add -f "AGENT-READABLE BACKLOG.md"
git commit -m "chore(ARCH-008-B): release v1.22.0, close ARCH-008 umbrella

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Test List

- [ ] Unit - `snap-validate.mjs` accepts 64-char `sys.c`, rejects 65-char (T-001)
- [ ] Unit - `resume-read.mjs` total miss → exit 3, zero stdout bytes (T-002)
- [ ] Unit - valid hash-matching handoff → bind + unlink + `RESUME_HIT` (T-002)
- [ ] Unit - v2 `pr` → `prose: available` (T-002)
- [ ] Unit - invalid handoff → exit 4, file retained (T-002)
- [ ] Unit - empty/whitespace handoff → exit 3 degrade + delete, no halt (T-002)
- [ ] Unit - hash-stale handoff → exit 3 degrade + delete (T-002)
- [ ] Unit - legacy `.md` swept unread (T-002)
- [ ] Unit - trace line is ISO-timestamped `resume:` (T-002)
- [ ] Unit - Node-14 syntax assertion (T-002)
- [ ] Integration - DB hit + valid blob → `source: db`, deletes handoff, non-destructive (T-003)
- [ ] Integration - DB miss + valid handoff → falls through to `source: file` (T-003)
- [ ] Integration - **branch-switch**: stored-at-A restored at A, absent at B (T-003)
- [ ] Integration - two successive same-commit reads both hit (non-destructive) (T-003)
- [ ] Inspection - six commands call `resume-read.mjs`, no legacy `.md`/turn-count gate (T-004)
- [ ] Inspection - four hooks sweep `resume-validate.*.tmp.json` (T-005)
- [ ] Regression - full `npm test` green after each task
- [ ] E2E - n/a (no UI)

## Commit Order

1. **T-001** - snap-validate `sys.c` widen (+tests)
2. **T-002** - resume-read core + file branch (+tests)
3. **T-003** - resume-read DB precedence branch (+tests, branch-switch)
4. **T-004** - six command mirrors rewired
5. **T-005** - four post-compact hooks sweep
6. **T-006** - release v1.22.0 + backlog flips (gated last)

One commit per task; the pre-commit gate must be green at every commit.

## Identified Risks

- **Truncated stdout on a pipe** - mitigated by the drain-callback exit (`process.stdout.write(out, () => process.exit(code))`); the `RESUME_HIT` block is small (bounded by SNAP caps), so this is belt-and-suspenders, not the ~64 KiB failure ARCH-008-A hit.
- **`git rev-parse HEAD` real hash vs fixture `sys.c`** - tests use real one-commit temp repos and read the actual HEAD into the fixture snapshot, so hash-match is controllable and the branch-switch test is genuine (not mocked).
- **`node:sqlite` absent on the CI/local runner** - the DB `describe` block self-skips via `describe.runIf(sqliteAvailable())`, so Task 3 tests never falsely fail on Node <22.5; the file-branch behavior (the common same-session path) is fully covered without the DB.
- **PowerShell `string[]` capture / caller-global `Stop`** - the canonical block normalizes with `@($resume_out)` and locally forces `$ErrorActionPreference='Continue'` (+ disables native-error mapping on 7.3+), restored in `finally`; verified by inspection (no PS test host here).
- **Command-file edits silently drift** - the T-004-G grep gate proves the legacy `.md`/turn-count blocks are gone and all six files reference `resume-read.mjs` before committing.
- **BUG-003 bulk-edit violation on the backlog** - T-006-E/F are two independent single-line checkbox flips; do not rewrite the surrounding block.
- **Plan-vs-reality deviation** - if any step diverges from this plan during execution (e.g. an existing command block has a different shape than mapped), surface it immediately with a `[BUG]` tag rather than silently absorbing it.
