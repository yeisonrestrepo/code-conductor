# ARCH-008-A — Checkpoint/Compact Write Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execute via `/cc-implement ARCH008A` (the surgical 5-step plan-state ritual).

**Goal:** Wire `/cc-compact` and `/cc-checkpoint` to persist a `sessions` upsert and one git-hash-keyed `snapshots` row into `.conductor/cache.db` via the shipped ARCH-008-S1 subcommands, using two new zero-dep helper scripts and a backward-compatible SNAP v2 bump.

**Architecture:** Add `scripts/session-id.mjs` (resolve `$CLAUDE_CODE_SESSION_ID` → cached fallback → `crypto.randomUUID()`) and `scripts/snap-build.mjs` (single canonical serializer: strict v1 no-prose / v2 with optional top-level `pr`). Extend `scripts/snap-validate.mjs` to accept `v ∈ {1,2}` with optional `pr` and a broadened `sys.c` regex. Both commands do their existing authoritative write first, then a best-effort, synchronous, **fail-open** DB tail that resolves the id, builds the blob, and calls `conductor-db session` + `conductor-db snapshot`.

**Tech Stack:** Node ES modules (zero-dep, `crypto`/`Buffer`/`node:fs` only), `node:sqlite` via existing `conductor-db.mjs`, Vitest ^3 child-process (`spawnSync`) tests, bash + PowerShell hooks.

## Global Constraints

- Zero runtime dependencies in all scripts; `engines.node` stays `>= 20`; the two new scripts run flag-free on any Node ≥ 14 (need only `crypto`/`Buffer`/`node:fs`).
- The Node-flag probe (`--experimental-sqlite --no-warnings`, no-flag-first) gates **only** the two `conductor-db` calls; `session-id.mjs` / `snap-build.mjs` run as plain `node scripts/<name>.mjs`.
- **Fail-open everywhere:** the authoritative write (handoff `.json` / `project.md`) runs first; its failure halts the command and suppresses the DB tail; any DB-tail failure is non-fatal and never reverts or blocks the authoritative write.
- Arbitrary content (`pr` / snap JSON) travels **only via stdin**, never argv. All `conductor-db` argv scalars are double-quoted shell expansions (`"$id"`, `"$ph"`, `"$s"`, `"$c"`).
- Hash key is the **full-40 `git rev-parse HEAD`** (not `--short`), lowercased, validated `/^[0-9a-f]{7,40}$/`, `"0000000"` sentinel on non-zero/timeout/git-absent/format-mismatch. The same value is used for `sys.c`, the `sessions` hash, and the `snapshots` key.
- SNAP field caps (element-count × per-element chars): `ops.n` 3×200, `ops.f` 20×300, `mem.d` 10×300, `mem.x` 5×200. v1 blob ≤ 4096 chars; v2 blob ≤ `MAX_SNAP_BYTES = 10485760`.
- DB-tail child stdout+stderr redirect to `.conductor/last-write.log` in **append mode** (bash `>>`; PowerShell `2>&1 | Out-File -Append -Encoding utf8`), best-effort, gitignored; never to the UI, never to `/dev/null`. `.conductor/` is ensured (`mkdir`) before any redirect. On PowerShell, set `$OutputEncoding = [System.Text.UTF8Encoding]::new($false)` (no-BOM UTF-8) before piping any snapshot string to Node so multi-byte characters are not corrupted or BOM-prefixed on the wire.
- Every commit message ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. One task = one commit. BUG-003: tracking-file state changes are surgical single-line edits.
- The repo-wide `npm test` gate must stay green (current baseline 329 + new tests).

---

## File Structure

- **Create** `scripts/session-id.mjs` — session-id resolver (env → cache → generated UUID; atomic temp+rename, first-writer-wins).
- **Create** `scripts/snap-build.mjs` — canonical SNAP serializer (flat→nested map, array normalization, v1/v2 selection, raw-`pr` binary-search truncation).
- **Create** `tests/scripts/session-id.test.js`, `tests/scripts/snap-build.test.js` — Vitest `spawnSync` suites.
- **Modify** `scripts/snap-validate.mjs` — `v ∈ {1,2}`, optional `pr`, `sys.c` → `/^[0-9a-f]{7,40}$/`.
- **Modify** `tests/unit/snap-validate.test.js` — new v2 / long-hash cases; existing cases stay green.
- **Modify** `global/commands/cc-compact.md`, `global/commands/cc-checkpoint.md` — full-40 hash, snap-build pipe, fail-open DB tail.
- **Modify** `.claude/hooks/post-compact.sh`, `.claude/hooks/post-compact.ps1` + their `project-template/.claude/hooks/` mirrors — clear `.conductor/session-id` and sweep `session-id.*.tmp`.
- **Modify** `.claude/commands/cc-implement.md` + `project-template/.claude/commands/cc-implement.md` — stale `v === 1` reader comment → `v ∈ {1,2}`.
- **Modify** `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md` — release v1.21.0, flip `[ARCH-008-A]` → `[X]`.

---

## Ordered Steps

### Task 1: SNAP v2 validator

**Files:**
- Modify: `scripts/snap-validate.mjs:14,17,29`
- Test: `tests/unit/snap-validate.test.js`

**Interfaces:**
- Produces: a validator that accepts `{v:1|2, sys, ops, mem, pr?}`; `pr` optional string; `sys.c` matches `/^[0-9a-f]{7,40}$/`; `v>2` → `SNAP_ERROR: SNAP_UNKNOWN_VERSION`.
- Dependency: none.

- [X] **[T-001] SNAP v2 validator**

- [X] **[T-001-A] Step 1: Write failing tests**

Append to `tests/unit/snap-validate.test.js` (inside the top `describe`):

```js
  it('accepts a valid v2 payload with pr', () => {
    const v2 = { v: 2, sys: { ph: 'impl', c: 'abc1234', s: 'feat010' }, ops: { n: [], f: [] }, mem: { d: [], x: [] }, pr: 'checkpoint prose' }
    const r = run(fixture(j(v2)))
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
  })

  it('accepts a v2 payload without pr (pr strictly optional)', () => {
    const v2 = { ...VALID, v: 2 }
    expect(run(fixture(j(v2))).status).toBe(0)
  })

  it('rejects pr on a v1 payload as an unexpected key', () => {
    const bad = { ...VALID, pr: 'nope' }
    const r = run(fixture(j(bad)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: unexpected key: pr\n')
  })

  it('rejects a non-string pr on v2', () => {
    const bad = { ...VALID, v: 2, pr: 123 }
    const r = run(fixture(j(bad)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: pr must be a string\n')
  })

  it('rejects v > 2 with SNAP_UNKNOWN_VERSION', () => {
    const bad = { ...VALID, v: 3 }
    const r = run(fixture(j(bad)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: SNAP_UNKNOWN_VERSION\n')
  })

  it('accepts a 40-char sys.c hash', () => {
    const long = { ...VALID, sys: { ...VALID.sys, c: 'a'.repeat(40) } }
    expect(run(fixture(j(long))).status).toBe(0)
  })

  it('accepts the 0000000 sentinel and 7-char hash (regression)', () => {
    expect(run(fixture(j({ ...VALID, sys: { ...VALID.sys, c: '0000000' } }))).status).toBe(0)
    expect(run(fixture(j({ ...VALID, sys: { ...VALID.sys, c: 'abc1234' } }))).status).toBe(0)
  })

  it('rejects a 41-char sys.c hash', () => {
    const bad = { ...VALID, sys: { ...VALID.sys, c: 'a'.repeat(41) } }
    const r = run(fixture(j(bad)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: invalid sys.c format\n')
  })
```

- [X] **[T-001-B] Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/unit/snap-validate.test.js`
Expected: the 8 new cases FAIL (pr rejected on v2, v:2 rejected as unknown version, 40-char hash rejected).

- [X] **[T-001-C] Step 3: Edit the validator**

`scripts/snap-validate.mjs` line 14 — make the top-level key allow-list version-aware and validate `pr`:

```js
const topAllowed = snap.v === 2 ? ['v', 'sys', 'ops', 'mem', 'pr'] : ['v', 'sys', 'ops', 'mem'];
const topExtra = Object.keys(snap).find(k => !topAllowed.includes(k)); if (topExtra) err(`unexpected key: ${topExtra}`);
if (snap.pr !== undefined && typeof snap.pr !== 'string') err('pr must be a string');
```

`scripts/snap-validate.mjs` line 17 — accept `v ∈ {1,2}`, reject `v>2`:

```js
if (typeof snap.v !== 'number' || !Number.isInteger(snap.v) || snap.v < 1) err('v must be a positive integer'); if (snap.v > 2) err('SNAP_UNKNOWN_VERSION');
```

`scripts/snap-validate.mjs` line 29 — broaden `sys.c`:

```js
if (!/^[0-9a-f]{7,40}$/.test(snap.sys.c)) err('invalid sys.c format'); if (!/^[a-zA-Z0-9._-]+$/.test(snap.sys.s)) err('invalid chars in sys.s');
```

Note: the `pr` type check must run **after** the version is known (line 17 already parsed `snap.v`), so place the `snap.pr !== undefined` check where the version-aware top-key block sits (line 14 runs after `snap` is parsed and blocks validated; `snap.v` is readable there). Keep the 4096 `raw.length` cap (line 7) **unchanged** — it is a file-channel property, not version-conditional.

- [X] **[T-001-D] Step 4: Run the full validator suite**

Run: `npx vitest run tests/unit/snap-validate.test.js`
Expected: PASS — all pre-existing cases plus the 8 new cases green.

- [X] **[T-001-E] Step 5: Commit**

```bash
git add scripts/snap-validate.mjs tests/unit/snap-validate.test.js
git commit -m "feat(ARCH-008-A): extend snap-validate to SNAP v2 with optional pr and 7-40 char sys.c"
```

---

### Task 2: session-id resolver

**Files:**
- Create: `scripts/session-id.mjs`
- Test: `tests/scripts/session-id.test.js`

**Interfaces:**
- Produces: `node scripts/session-id.mjs` prints exactly one non-empty line and exits 0 — `$CLAUDE_CODE_SESSION_ID` if set, else cached `<root>/.conductor/session-id`, else a fresh `crypto.randomUUID()` (persisted atomically).
- Dependency: none.

- [X] **[T-002] session-id resolver**

- [X] **[T-002-A] Step 1: Write failing tests**

Create `tests/scripts/session-id.test.js`:

```js
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../scripts/session-id.mjs', import.meta.url));
const dirs = [];
function repo() { const d = mkdtempSync(join(tmpdir(), 'sid-')); dirs.push(d); mkdirSync(join(d, '.git')); return d; }
function run(cwd, env) { return spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8', env: env ?? process.env }); }
afterEach(() => { while (dirs.length) { try { rmSync(dirs.pop(), { recursive: true }); } catch {} } });

describe('session-id.mjs', () => {
  it('prints CLAUDE_CODE_SESSION_ID verbatim when set', () => {
    const cwd = repo();
    const r = run(cwd, { ...process.env, CLAUDE_CODE_SESSION_ID: 'sess-123' });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('sess-123');
    expect(existsSync(join(cwd, '.conductor', 'session-id'))).toBe(false); // env path is cacheless
  });

  it('generates and persists a UUID when env is unset', () => {
    const cwd = repo();
    const env = { ...process.env }; delete env.CLAUDE_CODE_SESSION_ID;
    const r = run(cwd, env);
    expect(r.status).toBe(0);
    const id = r.stdout.trim();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(readFileSync(join(cwd, '.conductor', 'session-id'), 'utf8').trim()).toBe(id);
  });

  it('returns the cached id on the second invocation', () => {
    const cwd = repo();
    const env = { ...process.env }; delete env.CLAUDE_CODE_SESSION_ID;
    const first = run(cwd, env).stdout.trim();
    const second = run(cwd, env).stdout.trim();
    expect(second).toBe(first);
  });

  it('prefers a pre-existing cache file over generating', () => {
    const cwd = repo();
    mkdirSync(join(cwd, '.conductor'));
    writeFileSync(join(cwd, '.conductor', 'session-id'), 'cached-xyz\n');
    const env = { ...process.env }; delete env.CLAUDE_CODE_SESSION_ID;
    expect(run(cwd, env).stdout.trim()).toBe('cached-xyz');
  });
});
```

- [X] **[T-002-B] Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/scripts/session-id.test.js`
Expected: FAIL — module not found (`scripts/session-id.mjs` does not exist).

- [X] **[T-002-C] Step 3: Write `scripts/session-id.mjs`**

```js
import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
  return join(dirname(fileURLToPath(import.meta.url)), '..');
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
```

- [X] **[T-002-D] Step 4: Run tests, verify pass**

Run: `npx vitest run tests/scripts/session-id.test.js`
Expected: PASS — all four cases green.

- [X] **[T-002-E] Step 5: Commit**

```bash
git add scripts/session-id.mjs tests/scripts/session-id.test.js
git commit -m "feat(ARCH-008-A): add zero-dep session-id resolver with atomic cache fallback"
```

---

### Task 3: snap-build serializer

**Files:**
- Create: `scripts/snap-build.mjs`
- Test: `tests/scripts/snap-build.test.js`

**Interfaces:**
- Consumes: nothing from Task 2. Produces a blob that passes the Task 1 validator (test asserts this).
- Produces: `node scripts/snap-build.mjs` reads one flat JSON object on stdin `{ph,c,s,n,f,d,x,pr?}` and prints canonical single-line SNAP JSON. v1 (`{v:1,sys,ops,mem}`) when `pr` absent/empty; v2 (`{v:2,sys,ops,mem,pr}`) otherwise. Exit non-zero with no stdout on malformed input.
- Dependency: Task 1 (tests validate output against `snap-validate.mjs`).

- [X] **[T-003] snap-build serializer**

- [X] **[T-003-A] Step 1: Write failing tests**

Create `tests/scripts/snap-build.test.js`:

```js
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../scripts/snap-build.mjs', import.meta.url));
const VALIDATOR = fileURLToPath(new URL('../../scripts/snap-validate.mjs', import.meta.url));
const MAX = 10 * 1024 * 1024;

// Every child runs in its own fresh temp cwd so no test can pollute or lock the
// active project directory (snap-build writes nothing, but this keeps the suite
// hermetic and consistent with the session-id / conductor-db suites).
const sandboxes = [];
function sandbox() { const d = mkdtempSync(join(tmpdir(), 'sb-')); sandboxes.push(d); return d; }
afterEach(() => { while (sandboxes.length) { try { rmSync(sandboxes.pop(), { recursive: true }); } catch {} } });

function build(input) {
  return spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8', cwd: sandbox() });
}
function validate(line) {
  const d = sandbox(); const p = join(d, 'session-snapshot.json');
  writeFileSync(p, line.endsWith('\n') ? line : line + '\n');
  return spawnSync(process.execPath, [VALIDATOR, p], { encoding: 'utf8', cwd: d });
}
const base = { ph: 'impl', c: 'abc1234', s: 'feat010', n: [], f: [], d: [], x: [] };

describe('snap-build.mjs', () => {
  it('emits v1 when pr is absent, and validates', () => {
    const r = build(JSON.stringify(base));
    expect(r.status).toBe(0);
    const obj = JSON.parse(r.stdout);
    expect(obj.v).toBe(1);
    expect('pr' in obj).toBe(false);
    expect(obj.sys).toEqual({ ph: 'impl', c: 'abc1234', s: 'feat010' });
    expect(validate(r.stdout.trim()).status).toBe(0);
  });

  it('emits v2 with pr when a non-empty prose string is given', () => {
    const r = build(JSON.stringify({ ...base, pr: 'checkpoint body' }));
    const obj = JSON.parse(r.stdout);
    expect(obj.v).toBe(2);
    expect(obj.pr).toBe('checkpoint body');
    expect(validate(r.stdout.trim()).status).toBe(0);
  });

  it('emits v1 when pr is empty or whitespace', () => {
    expect(JSON.parse(build(JSON.stringify({ ...base, pr: '' })).stdout).v).toBe(1);
  });

  it('normalizes arrays: dedup, cap counts, filter empties', () => {
    const r = build(JSON.stringify({ ...base, n: ['a', 'a', ' ', 'b', 'c', 'd'] }));
    expect(JSON.parse(r.stdout).ops.n).toEqual(['b', 'c', 'd']); // dedup + head-drop to 3
  });

  it('strips extraneous stdin keys from output', () => {
    const r = build(JSON.stringify({ ...base, evil: 'x', pr: 'p' }));
    const obj = JSON.parse(r.stdout);
    expect('evil' in obj).toBe(false);
    expect(Object.keys(obj).sort()).toEqual(['mem', 'ops', 'pr', 'sys', 'v']);
  });

  it('truncates an over-cap v2 pr to <= 10 MiB, still valid JSON', () => {
    const big = 'x'.repeat(MAX + 1000);
    const r = build(JSON.stringify({ ...base, pr: big }));
    expect(r.status).toBe(0);
    expect(Buffer.byteLength(r.stdout.trim(), 'utf8')).toBeLessThanOrEqual(MAX);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
    expect(JSON.parse(r.stdout).v).toBe(2);
  });

  it('does not split a surrogate pair at the truncation boundary', () => {
    // pad with emoji (surrogate pairs) so the cut can land mid-pair
    const emoji = '😀';
    const big = emoji.repeat(Math.ceil((MAX + 4000) / 4));
    const r = build(JSON.stringify({ ...base, pr: big }));
    expect(r.status).toBe(0);
    const pr = JSON.parse(r.stdout).pr;
    // last code unit must not be a lone high surrogate
    const last = pr.charCodeAt(pr.length - 1);
    expect(last >= 0xD800 && last <= 0xDBFF).toBe(false);
  });

  it('exits non-zero with no stdout on malformed stdin', () => {
    const r = build('not json');
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe('');
  });

  it('exits non-zero on empty stdin', () => {
    const r = build('');
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe('');
  });

  it('exits non-zero when a required scalar (c) is missing', () => {
    const { c, ...noC } = base;
    const r = build(JSON.stringify(noC));
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe('');
  });
});
```

- [X] **[T-003-B] Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/scripts/snap-build.test.js`
Expected: FAIL — module not found (`scripts/snap-build.mjs` does not exist).

- [X] **[T-003-C] Step 3: Write `scripts/snap-build.mjs`**

```js
import { readFileSync } from 'node:fs';

const MAX_SNAP_BYTES = 10485760;          // 10 MiB (v2)
const V1_MAX_CHARS = 4096;                // handoff-file contract (v1)
const CAPS = { n: [3, 200], f: [20, 300], d: [10, 300], x: [5, 200] };

const die = (msg) => { process.stderr.write(`SNAP_BUILD_ERROR: ${msg}\n`); process.exit(1); };
const byteLen = (s) => Buffer.byteLength(s, 'utf8');

// filter empties, dedup (first wins), Unicode-safe per-element truncation, head-drop to count cap
function normArray(raw, [cap, elemCap]) {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set(); const out = [];
  for (const item of arr) {
    if (typeof item !== 'string') continue;
    const t = item.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(Array.from(t).slice(0, elemCap).join(''));
  }
  while (out.length > cap) out.shift();
  return out;
}

// back off one unit if the boundary would keep a lone high surrogate
function surrogateSafe(str, n) {
  if (n > 0 && n <= str.length) {
    const code = str.charCodeAt(n - 1);
    if (code >= 0xD800 && code <= 0xDBFF) return n - 1;
  }
  return n;
}

let input;
try { input = readFileSync(0, 'utf8'); } catch (e) { die(`cannot read stdin: ${e.code || e.message}`); }

let obj;
try { obj = JSON.parse(input); } catch { die('malformed JSON on stdin'); }
if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) die('stdin must be a JSON object');

for (const k of ['ph', 'c', 's']) {
  if (typeof obj[k] !== 'string' || obj[k] === '') die(`missing or empty scalar: ${k}`);
}

const sys = { ph: obj.ph, c: obj.c, s: obj.s };
const ops = { n: normArray(obj.n, CAPS.n), f: normArray(obj.f, CAPS.f) };
const mem = { d: normArray(obj.d, CAPS.d), x: normArray(obj.x, CAPS.x) };
const pr = typeof obj.pr === 'string' ? obj.pr : '';

if (pr === '') {
  // ---- v1: 4096-char cap, drop oldest of mem.d / ops.f ----
  const snap = { v: 1, sys, ops, mem };
  let line = JSON.stringify(snap);
  while (line.length > V1_MAX_CHARS && (mem.d.length || ops.f.length)) {
    if (mem.d.length >= ops.f.length && mem.d.length) mem.d.shift();
    else ops.f.shift();
    line = JSON.stringify(snap);
  }
  process.stdout.write(line + '\n');
  process.exit(0);
}

// ---- v2: 10 MiB cap, truncate raw pr before serialize ----
const skeletonBytes = byteLen(JSON.stringify({ v: 2, sys, ops, mem, pr: '' }));
if (skeletonBytes > MAX_SNAP_BYTES) die('skeleton exceeds cap even without prose');

// total serialized bytes for a candidate pr value (skeleton already counts the two empty-value quotes)
const totalBytes = (val) => skeletonBytes + byteLen(JSON.stringify(val)) - 2;

let keep = pr.length;
if (totalBytes(pr) > MAX_SNAP_BYTES) {
  let lo = 0, hi = pr.length, best = 0;
  for (let i = 0; i < 64 && lo <= hi; i++) {
    const mid = (lo + hi) >> 1;
    if (totalBytes(pr.slice(0, mid)) <= MAX_SNAP_BYTES) { best = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  keep = surrogateSafe(pr, best);
  // defensive fallback if the search somehow left us over cap
  if (totalBytes(pr.slice(0, keep)) > MAX_SNAP_BYTES) {
    keep = surrogateSafe(pr, Math.max(0, Math.floor((MAX_SNAP_BYTES - skeletonBytes - 2) / 6)));
  }
}

const snap = { v: 2, sys, ops, mem, pr: pr.slice(0, keep) };
process.stdout.write(JSON.stringify(snap) + '\n');
process.exit(0);
```

- [X] **[T-003-D] Step 4: Run tests, verify pass**

Run: `npx vitest run tests/scripts/snap-build.test.js`
Expected: PASS — all cases green, including the round-trip validation against Task 1's validator.

- [X] **[T-003-E] Step 5: Commit**

```bash
git add scripts/snap-build.mjs tests/scripts/snap-build.test.js
git commit -m "feat(ARCH-008-A): add canonical snap-build serializer (v1/v2, surrogate-safe pr truncation)"
```

---

### Task 4: rewire `/cc-compact`

**Files:**
- Modify: `global/commands/cc-compact.md:5` (+ append DB-tail section after line 26)

**Interfaces:**
- Consumes: `scripts/session-id.mjs`, `scripts/snap-build.mjs` (Tasks 2–3), `conductor-db session`/`snapshot` (S1).
- Dependency: Tasks 2, 3.

- [X] **[T-004] rewire /cc-compact**

- [X] **[T-004-A] Step 1: Replace the hash-derivation line**

Replace `global/commands/cc-compact.md` line 5 with the full-40 rule:

```markdown
Run `git rev-parse HEAD` to get the current commit SHA (the **full 40-char** hash — NOT `--short`, whose abbreviation length auto-scales with repo size and is unstable across growth). Lowercase and trim it; if it does not match `/^[0-9a-f]{7,40}$/`, or the command exits non-zero (non-git workspace, no commits, git absent, or permission-denied), use `"0000000"`. Wrap the call with shell `timeout` only when `command -v timeout` (or `gtimeout`) succeeds; otherwise run it unwrapped. This same value is `sys.c` and the `sessions` / `snapshots` git-hash key.
```

- [X] **[T-004-B] Step 2: Route serialization through snap-build**

Replace the "Serialize as a single-line JSON object …" instruction (line 18) so the command **pipes the normalized fields to `snap-build.mjs`** (no `pr`) instead of hand-serializing:

```markdown
Serialize by piping a flat JSON object `{ph, c, s, n, f, d, x}` (no `pr`) on **stdin** to `node scripts/snap-build.mjs`; its stdout is the canonical single-line **v1** SNAP JSON. `snap-build` performs all array normalization (filter/dedup/per-element cap/head-drop) and the 4096-char size trim internally — do not pre-serialize. If `snap-build` exits non-zero (malformed field object), report the error and stop; do not write the handoff file, do not run the DB tail, do not print the compact prompt.
```

- [X] **[T-004-C] Step 3: Append the fail-open DB tail**

After the "> Snapshot written…" line (end of file), append:

```markdown

---

## Fail-open DB tail (best-effort, synchronous)

After the handoff file is written and the compact prompt is ready — and **only** if the authoritative write succeeded — run this synchronous, fail-open tail. Any failure here is non-fatal: never revert the handoff file, never suppress the compact prompt.

1. Ensure `.conductor/` exists (`mkdir -p .conductor`, best-effort). If that fails, skip the tail entirely.
2. Resolve the session id: `id="$(node scripts/session-id.mjs 2>>.conductor/last-write.log)"`.
3. Upsert the session row (Node-flag probe applies — same as the cc-implement Step 6 hook: no-flag-first, else `--experimental-sqlite --no-warnings`, else skip):

   `node <probe-flags> scripts/conductor-db.mjs session "$id" "$ph" "$s" "$c" >> .conductor/last-write.log 2>&1`
4. Insert the snapshot row, piping the v1 blob on **stdin** (never argv):

   `printf '%s' "$snap_json" | node <probe-flags> scripts/conductor-db.mjs snapshot "$c" >> .conductor/last-write.log 2>&1`

All argv scalars are double-quoted. **Every** DB-tail redirect uses **append mode (`>>`)** — never `>` — so a rapid or parallel second run never truncates a preceding trace; the log is gitignored, best-effort, and per-run growth is one line at most (rotation is out of scope). The lone `CONDUCTOR_DB:` degradation line (Node < 22.5 / `node:sqlite` absent) lands only in `.conductor/last-write.log`, never the UI. Finally print `> Snapshot written. Run /compact now to clear history.` regardless of the tail's outcome.

**Cross-platform note:** the incantations above are the **Unix (bash) canonical form**; the `.md` file is an agent instruction, not a literal script — realize the same semantics on the host shell. On Windows/PowerShell: **first set `$OutputEncoding = [System.Text.UTF8Encoding]::new($false)`** (no-BOM UTF-8, so the piped snapshot string reaches Node's UTF-8 `TextDecoder` byte-clean); capture the id via `$id = node scripts/session-id.mjs`; pipe the blob with `$snap_json | node … snapshot "$c"`; append the log with `… 2>&1 | Out-File -Append -Encoding utf8 .conductor/last-write.log` (explicit UTF-8 append — never the bare `*>>`, whose default encoding is UTF-16LE on PS 5.1 and would corrupt the trace); ensure the dir with `New-Item -ItemType Directory -Force .conductor`. The stdin-only-for-payloads, double-quoted-argv, append-log, and fail-open rules are identical on both platforms.
```

- [X] **[T-004-D] Step 4: Self-verify the prose**

Re-read the edited `global/commands/cc-compact.md` and confirm: (a) full-40 hash rule present, (b) snap-build pipe replaces hand-serialization, (c) DB tail is gated on authoritative-write success, (d) `snapshot` blob is on stdin, (e) compact prompt still prints unconditionally after the tail. (No unit test — this is agent-instruction prose; behavior is covered by the script suites.)

- [X] **[T-004-E] Step 5: Commit**

```bash
git add global/commands/cc-compact.md
git commit -m "feat(ARCH-008-A): wire /cc-compact to snap-build and the fail-open DB tail"
```

---

### Task 5: rewire `/cc-checkpoint`

**Files:**
- Modify: `global/commands/cc-checkpoint.md` (append DB-tail section after line 25)

**Interfaces:**
- Consumes: `scripts/session-id.mjs`, `scripts/snap-build.mjs`, `conductor-db get-session`/`session`/`snapshot`.
- Dependency: Tasks 2, 3.

- [X] **[T-005] rewire /cc-checkpoint**

- [X] **[T-005-A] Step 1: Append the fail-open DB tail**

After line 25 of `global/commands/cc-checkpoint.md`, append:

```markdown

---

## Fail-open DB tail (best-effort, synchronous)

Run **only after** the `project.md` append succeeded (authoritative). Any failure here is non-fatal — never block or revert the `project.md` update.

1. Ensure `.conductor/` exists (`mkdir -p .conductor`, best-effort); if that fails, skip the tail.
2. Derive `c` — the **full-40** `git rev-parse HEAD` (lowercased, `/^[0-9a-f]{7,40}$/`, `"0000000"` fallback on non-zero/timeout/git-absent/format-mismatch; shell `timeout` only if the binary exists).
3. Resolve the id: `id="$(node scripts/session-id.mjs 2>>.conductor/last-write.log)"`.
4. Derive `ph` by carry-forward: with a bounded ~5 s outer timeout (only if `timeout` exists; `conductor-db`'s internal 2 s `busy_timeout` bounds real contention otherwise), run `node <probe-flags> scripts/conductor-db.mjs get-session "$id"`; if it prints a row whose `phase` is a non-empty enum member, reuse it. On no row, empty phase, DB unavailable, or timeout, default to `"impl"`.
5. Set `pr` to the **verbatim `## Checkpoint …` section body** just appended to `project.md` (the same in-context string) — so `project.md` and the snapshot's `pr` are byte-identical. `pr` is always non-empty here, so the blob is always **v2**.
6. Project `d` / `x` from that section (best-effort): match headings `/^#{2,4}[ \t]+(.+?)[ \t]*$/`; normalize the heading text by removing all `*`, `_`, `` ` `` then `.trim()` + lowercase; a heading containing `decision` or `convention` opens a `d` block, one containing `debt`, `workaround`, or `limitation` opens an `x` block. **The `d` set is tested first and wins** (a heading matching both opens one `d` block). The parent `## Checkpoint …` heading matches no keyword, so it opens no block and closes any open one. Within a block, bullet lines `/^[ \t]*[-*][ \t]+(\S.*?)[ \t]*$/` contribute their trimmed capture (line-based; continuation lines ignored — the full text survives in `pr`). If unstructured, `d`/`x` may be empty (valid).
7. Defaults: `n=[]`, `f=[]`, `s`= the active spec stem or `"none"`.
8. Build the v2 blob: pipe `{ph, c, s, n, f, d, x, pr}` on **stdin** to `node scripts/snap-build.mjs`; capture its stdout. If it exits non-zero, skip the DB write (fail-open).
9. Write the rows (both argv double-quoted; blob on stdin; all output to the log):

   `node <probe-flags> scripts/conductor-db.mjs session "$id" "$ph" "$s" "$c" >> .conductor/last-write.log 2>&1`
   `printf '%s' "$snap_json" | node <probe-flags> scripts/conductor-db.mjs snapshot "$c" >> .conductor/last-write.log 2>&1`

All DB-tail redirects use **append mode (`>>`)** so concurrent runs never truncate a preceding trace. **Cross-platform note:** the forms above are Unix-canonical; on Windows/PowerShell realize the same semantics — set `$OutputEncoding = [System.Text.UTF8Encoding]::new($false)` before piping, capture `$id = node …`, pipe `$snap_json | node … snapshot "$c"`, append the log via `… 2>&1 | Out-File -Append -Encoding utf8 .conductor/last-write.log` (not `*>>`), and `New-Item -ItemType Directory -Force .conductor`.

**No checkpoint post-hook needed (fail-open, no orphaned state):** unlike `/cc-compact`, `/cc-checkpoint` does not clear history, so no `post-compact` hook fires after it — and none is needed. A mid-tail failure leaves no stale telemetry to clean: the session id is unchanged (same env-var session), a partial write (session ok / snapshot fail, or vice-versa) is **accepted** — ARCH-008-B tolerates each miss independently with no rollback — and the only temp file (`session-id.*.tmp`) is cleaned by `session-id.mjs` itself and swept at the next compaction boundary (T-006). Adding a dedicated checkpoint cleanup hook would be YAGNI.

Report the checkpoint as usual regardless of the tail's outcome.
```

- [X] **[T-005-B] Step 2: Self-verify the prose**

Re-read the edited `global/commands/cc-checkpoint.md` and confirm: (a) tail gated on `project.md` success, (b) full-40 hash rule, (c) `pr` = verbatim appended block, (d) `ph` carry-forward → `impl` default, (e) `d`/`x` regex projection with decision-precedence + parent-heading exclusion, (f) `snapshot` blob on stdin, (g) checkpoint reported regardless of tail.

- [X] **[T-005-C] Step 3: Commit**

```bash
git add global/commands/cc-checkpoint.md
git commit -m "feat(ARCH-008-A): wire /cc-checkpoint to a v2 fail-open DB tail with prose capture"
```

---

### Task 6: post-compact session-id rotation

**Files:**
- Modify: `.claude/hooks/post-compact.sh`, `project-template/.claude/hooks/post-compact.sh`
- Modify: `.claude/hooks/post-compact.ps1`, `project-template/.claude/hooks/post-compact.ps1`

**Interfaces:**
- Consumes: the `.conductor/session-id` cache written by Task 2.
- Dependency: none (independent; touches only cleanup).

- [X] **[T-006] post-compact session-id rotation**

- [X] **[T-006-A] Step 1: Edit both `.sh` hooks**

In `.claude/hooks/post-compact.sh` (and the identical `project-template/.claude/hooks/post-compact.sh`), inside `main()` before the final `echo ""` (still within the `main || exit 0` guard), add:

```bash
  _cond="${CC_PROJECT_ROOT:-.}/.conductor"
  rm -f "${_cond}/session-id" 2>/dev/null
  rm -f "${_cond}"/session-id.*.tmp 2>/dev/null
```

This rotates only the fallback cache (env-var sessions re-resolve the same id, so this is a no-op for them) and sweeps any orphaned temp; `rm -f … 2>/dev/null` plus the existing guard isolate any locked/permission-denied file.

- [X] **[T-006-B] Step 2: Edit both `.ps1` hooks**

In `.claude/hooks/post-compact.ps1` (and `project-template/.claude/hooks/post-compact.ps1`), inside the `try` block before the final `""`, add:

```powershell
  $cond = Join-Path $root '.conductor'
  Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $cond 'session-id')
  Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $cond 'session-id.*.tmp')
```

`Join-Path` results are passed as literal (space-safe) arguments; `-Force -ErrorAction SilentlyContinue` isolates locked/absent files; the whole thing stays inside the hook's `try/catch { exit 0 }`.

- [X] **[T-006-C] Step 3: Verify the hooks still run clean**

Run: `bash .claude/hooks/post-compact.sh` (from repo root) and confirm exit 0 with the normal compact banner, no error on a missing `.conductor/session-id`. (PowerShell mirror is not executed on this macOS host — verified by inspection; `powershell` is absent, matching the observed post-compact log.)

- [X] **[T-006-D] Step 4: Commit**

```bash
git add .claude/hooks/post-compact.sh .claude/hooks/post-compact.ps1 project-template/.claude/hooks/post-compact.sh project-template/.claude/hooks/post-compact.ps1
git commit -m "feat(ARCH-008-A): rotate .conductor/session-id and sweep temps in post-compact hooks"
```

---

### Task 7: stale reader-comment fix

**Files:**
- Modify: `.claude/commands/cc-implement.md:27`, `project-template/.claude/commands/cc-implement.md:27`

**Interfaces:** none. Dependency: none.

- [X] **[T-007] stale reader-comment fix**

- [X] **[T-007-A] Step 1: Correct the `v === 1` comment (both mirrors)**

In both files, replace the parenthetical:

`(Exit 0 already guarantees v === 1, since the validator itself rejects any other value before returning success: no separate version check is needed here.)`

with:

`(Exit 0 guarantees v ∈ {1,2}; the reader binds only sys/ops/mem fields and ignores any optional top-level pr, so no separate version check is needed here.)`

- [X] **[T-007-B] Step 2: Commit**

```bash
git add .claude/commands/cc-implement.md project-template/.claude/commands/cc-implement.md
git commit -m "docs(ARCH-008-A): correct cc-implement reader comment for SNAP v2"
```

---

### Task 8: release v1.21.0

**Files:**
- Modify: `VERSION`, `package.json:3`, `package-lock.json` (two version fields), `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`

**Interfaces:** none. Dependency: Tasks 1–7 complete and green.

- [X] **[T-008] release v1.21.0**

- [X] **[T-008-A] Step 1: Run the full test gate**

Run: `npm test`
Expected: PASS — all suites green (329 baseline + the new session-id / snap-build / validator cases).

- [X] **[T-008-B] Step 2: Bump versions**

- `VERSION` → `1.21.0`
- `package.json` line 3 `"version"` → `1.21.0`
- `package-lock.json` — both `"version": "1.20.0"` fields (root + the self-referencing `packages.""`) → `1.21.0`

- [X] **[T-008-C] Step 3: Prepend the CHANGELOG entry**

Prepend a `## [1.21.0] - 2026-07-04` section to `CHANGELOG.md` summarizing: new `session-id.mjs` / `snap-build.mjs`; SNAP v2 (optional `pr`, `sys.c` 7–40 hex); `/cc-compact` + `/cc-checkpoint` fail-open DB write wiring; post-compact session-id rotation.

- [X] **[T-008-D] Step 4: Flip the backlog checkbox (surgical, single line)**

In `AGENT-READABLE BACKLOG.md`, change the `[ARCH-008-A]` heading checkbox `[ ]` → `[X]` (single-line edit only; BUG-003 invariant).

- [X] **[T-008-E] Step 5: Commit**

```bash
git add VERSION package.json package-lock.json CHANGELOG.md "AGENT-READABLE BACKLOG.md"
git commit -m "chore(ARCH-008-A): release v1.21.0"
```

---

## Test List

- [ ] Unit: `snap-validate.mjs` accepts v2 + optional `pr`, rejects `pr` on v1, rejects `v>2`, accepts 7–40-char `sys.c`, rejects 41-char (T-001).
- [ ] Unit/integration: `session-id.mjs` env-verbatim / generate+persist / cache-reuse / pre-existing-cache (T-002).
- [ ] Unit/integration: `snap-build.mjs` v1/v2 selection, array normalization, key-stripping, 10 MiB `pr` truncation, surrogate-safety, malformed/empty/missing-scalar rejection, round-trip validation against the validator (T-003).
- [ ] Integration seam: `snap-build` output → `snap-validate` (covered inside T-003 via `validate()` helper).
- [ ] Gate: repo-wide `npm test` green (T-008-A).
- No E2E/UI — no frontend surface.

## Commit Order

1. T-001 — validator v2 (independent; T-003 tests depend on it).
2. T-002 — session-id.mjs.
3. T-003 — snap-build.mjs (depends on T-001 for round-trip test).
4. T-004 — /cc-compact rewire (depends on T-002, T-003).
5. T-005 — /cc-checkpoint rewire (depends on T-002, T-003).
6. T-006 — post-compact hooks (independent).
7. T-007 — stale comment (independent).
8. T-008 — release v1.21.0 (last; after the full gate is green).

## Identified Risks (critical-review Phase 1)

- **Happy path:** on a committed repo inside Claude Code, each command does its authoritative write, then synchronously resolves the id, builds the blob, and writes one `sessions` upsert + one `snapshots` row keyed by the 40-char hash.
- **`readFileSync(0)` on a TTY** (no piped stdin) throws → `snap-build` exits non-zero, caller skips the DB write. Acceptable: real callers always pipe. Caught early by the empty-stdin test (T-003).
- **Binary-search non-convergence** is impossible for a monotonic length function, but the 64-iter cap + `Math.max(0, …)` conservative fallback (multiplier 6 = worst-case `\uXXXX` bytes/unit) guarantee an under-cap prefix. Verified by the 10 MiB + emoji tests.
- **Surrogate split at the byte boundary** → invalid UTF-16 tail. Mitigated by `surrogateSafe` back-off on both the search result and the fallback; asserted by the emoji test.
- **`pr` rejected on v1 by the validator** (breaking the existing handoff file) — guarded by the version-aware top-key allow-list (v1 still rejects `pr`); the 4096-char file cap is unchanged. Regression covered by the existing 43 validator cases staying green.
- **Non-git / zero-commit / git-absent** → `"0000000"` sentinel (valid under the broadened regex); commands never hard-fail. Documented in the command prose.
- **DB unavailable (Node < 22.5)** → `conductor-db` one-line degrade, exit 0; tail swallows it; authoritative write stands. No test needed beyond S1's existing degrade coverage; the tail's redirect keeps it off the UI.
- **Windows `.ps1` mirror unverified on this host** (no `powershell` binary) — edited by inspection to match the `.sh` semantics; wrapped in the existing `try/catch { exit 0 }`.
- **session-id write to a read-only shared dir** (EACCES/EPERM on `mkdir`/`writeFileSync`) → caught by the same try that guards `renameSync`; re-reads the cache, adopts a winner if present, else prints the unpersisted in-memory UUID. Never throws, always emits one line. (Unpersisted-id fragmentation is the accepted residual from the spec — does not affect ARCH-008-B, which keys on git hash.)
- **Undeletable temp on Windows** (AV/reader lock) → `unlinkSync` swallowed in `session-id.mjs`; the orphan is bounded to one pre-compact window and removed by the T-006 `post-compact` sweep (`-Force -ErrorAction SilentlyContinue` / `rm -f 2>/dev/null`), which itself never aborts on a still-locked file.
- **`sys.c` regex stays the range `/^[0-9a-f]{7,40}$/`, not an exact `(7|40)` alternation** — an exact form would reject already-persisted legacy snapshots whose hash came from the old auto-scaled `--short` (8–39 hex). The commands only ever emit 40-char (`rev-parse HEAD`) or the 7-char `"0000000"` sentinel, so the range accepts every value this feature produces while remaining backward-compatible; tightening it would be a breaking read of prior on-disk blobs.
- **No start-of-command temp sweep** — orphaned `session-id.*.tmp` files are swept **only** by the `post-compact` hook (T-006), not preemptively at command entry. A start-of-command sweep would race a **concurrent** live invocation whose pid-named temp is mid-flight (delete-before-rename), and orphans are already harmless (tiny, gitignored, bounded to one pre-compact window). Preemptive sweeping is YAGNI and slightly hazardous; rejected.
- **Empty/whitespace `$CLAUDE_CODE_SESSION_ID`** — `(env || '').trim()` collapses it to `''` (falsy), so the resolver falls through to the cache/generate path rather than emitting a blank id; a cache value is additionally gated by `looksValid` (non-empty, ≤200 chars, no whitespace) before adoption.
- **JSON escaping in the truncation budget** — the binary search measures `skeletonBytes + Buffer.byteLength(JSON.stringify(prCandidate),'utf8') − 2`, i.e. it re-stringifies the candidate `pr` each probe, so escape expansion (`\n`, `\"`, `\uXXXX`, multi-byte UTF-8) is counted exactly; the `Math.max(0, …/6)` fallback reserves the worst-case 6-byte `\uXXXX` per unit. No character can push the serialized blob over 10 MiB.

---

## Phase exit

Once the plan is approved and saved, run `/cc-compact` before starting implementation.
