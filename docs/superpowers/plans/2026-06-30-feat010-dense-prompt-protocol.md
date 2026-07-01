# FEAT-010 Dense Prompt Protocol Standard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace markdown `session-snapshot.md` with SNAP v1 (a minified single-line JSON handoff format) backed by a standalone validator, achieving ≥15% character reduction with 100% parse reliability (corrected 2026-06-30 from an unverified ≥30% target; see spec commit `3a4be07`).

**Architecture:** `scripts/snap-validate.mjs` (≤30 lines, dependency-free) enforces the SNAP v1 schema. `/cc-compact` (global user command, source-tracked at `global/commands/cc-compact.md`) writes the JSON envelope. `/cc-implement` (project command, mirrored at `.claude/commands/cc-implement.md` and `project-template/.claude/commands/cc-implement.md`) reads it via destructive-read, falling back to the legacy `.md` for one session.

**Tech Stack:** Node.js ≥ 18 (`fs`, `JSON.parse`), Vitest ^3, markdown command definitions.

## Global Constraints

- `scripts/snap-validate.mjs` ≤ 30 non-blank, non-`//`-comment-only lines (hard design constraint, test-enforced)
- Validator exits only 0 (valid) or 1 (schema violation); never writes to stdout under any condition
- Every validator stderr line is prefixed `SNAP_ERROR: <message>`: single uniform prefix, no second `SNAP_INVALID` prefix tier (resolved 2026-06-30, see spec commit `3925c35`)
- `/cc-implement` orchestrator-level halts (`REPO_ROOT_FAILED`, `NODE_NOT_FOUND`, `SNAP_UNKNOWN_VERSION`, `SNAP_INVALID`) use plain unformatted text: these are not validator stderr lines
- No alphabetical JSON key sorting in the writer
- `.claude/` and `docs/` are gitignored project-wide except `!project-template/*`: committing files under either path requires `git add -f` (paths outside both, like `global/`, do not)
- BUG-003 invariant: plan/tracking file edits are surgical single-line `Edit` calls only, never bulk rewrites
- VERSION/package.json/CHANGELOG.md/README.md bumps are sequenced as the final tasks (T-009 through T-012), after all code and tests pass, per spec's explicit "Plan task ordering" mandate
- `package.json` `"engines".node` is currently `>=20`; spec requires Node ≥ 18; do not lower or touch `engines` (out of scope, pre-existing repo-wide floor)

---

### Task T-001: Validator script (`scripts/snap-validate.mjs`)

**Files:**
- Create: `scripts/snap-validate.mjs`

**Interfaces:**
- Produces: a CLI script invoked as `node scripts/snap-validate.mjs <path>`. No exports (not imported by tests: tests spawn it as a subprocess). Exit 0 on valid SNAP v1 JSON; exit 1 with `SNAP_ERROR: <message>` on stderr for any violation.

- [X] **Step 1: Write the validator**

```js
import { readFileSync } from 'node:fs';
const err = (m) => { process.stderr.write(`SNAP_ERROR: ${m}\n`); process.exit(1); };
const path = process.argv[2]; if (path === undefined) err('no path provided');
let raw; try { raw = readFileSync(path, 'utf8'); } catch (e) { err(e.code === 'ENOENT' ? 'file not found' : e.code); }
if (raw.includes('�')) err('encoding error');
const trimmed = raw.trim(); if (trimmed.includes('\n')) err('internal newline in payload');
if (trimmed === '') err('empty file'); if (raw.length > 4096) err('payload too large');
let snap; try { snap = JSON.parse(trimmed); } catch { err('malformed JSON'); }
if (typeof snap !== 'object' || snap === null || Array.isArray(snap)) err('root must be a plain object');
for (const b of ['sys', 'ops', 'mem']) if (typeof snap[b] !== 'object' || snap[b] === null || Array.isArray(snap[b])) err(`missing block: ${b}`);
const req = { v: snap.v, 'sys.ph': snap.sys.ph, 'sys.c': snap.sys.c, 'sys.s': snap.sys.s, 'ops.n': snap.ops.n, 'ops.f': snap.ops.f, 'mem.d': snap.mem.d, 'mem.x': snap.mem.x };
const missing = Object.entries(req).filter(([, v]) => v === undefined).map(([k]) => k);
if (missing.length) { for (const k of missing) process.stderr.write(`SNAP_ERROR: missing: ${k}\n`); process.exit(1); }
const topExtra = Object.keys(snap).find(k => !['v', 'sys', 'ops', 'mem'].includes(k)); if (topExtra) err(`unexpected key: ${topExtra}`);
const allow = { sys: ['ph', 'c', 's'], ops: ['n', 'f'], mem: ['d', 'x'] };
for (const b of ['sys', 'ops', 'mem']) { const extra = Object.keys(snap[b]).find(k => !allow[b].includes(k)); if (extra) err(`unexpected key: ${b}.${extra}`); }
if (typeof snap.v !== 'number' || !Number.isInteger(snap.v) || snap.v < 1) err('v must be a positive integer'); if (snap.v > 1) err('SNAP_UNKNOWN_VERSION');
if (!['spec', 'plan', 'impl', 'rev'].includes(snap.sys.ph)) err('ph must be spec|plan|impl|rev');
const caps = { 'ops.n': [3, 200], 'ops.f': [20, 300], 'mem.d': [10, 300], 'mem.x': [5, 200] };
for (const [key, [cap, elemCap]] of Object.entries(caps)) {
  const [blk, sub] = key.split('.'); const arr = snap[blk][sub]; if (!Array.isArray(arr)) err(`${key} must be an array`); if (arr.length > cap) err(`${key} exceeds cap`);
  arr.forEach((el, i) => { if (typeof el !== 'string' || el.trim() === '') err(`empty element in ${key}[${i}]`); if (JSON.stringify(el).slice(1, -1).length > elemCap) err(`element too long in ${key}[${i}]`); });
}
snap.ops.f.forEach((el, i) => {
  if (el.includes('\\')) err(`backslash in ops.f[${i}]`);
  const idx = el.lastIndexOf(':'); if (idx <= 0) err(`empty path in ops.f[${i}]`);
  if (!['C', 'M', 'D'].includes(el.slice(idx + 1))) err(`invalid action code in ops.f[${i}]`);
});
if (!/^[0-9a-f]{7}$/.test(snap.sys.c)) err('invalid sys.c format'); if (!/^[a-zA-Z0-9._-]+$/.test(snap.sys.s)) err('invalid chars in sys.s');
process.exit(0);
```

No shebang, no `chmod +x`: invocation is always explicit `node scripts/snap-validate.mjs <path>`. This exact text (including the `Array.isArray()` guard on each of the four array fields, which prevents a non-array `ops.n`/`ops.f`/`mem.d`/`mem.x` value from reaching `.length`/`.forEach` and crashing with an uncaught native error) was written to a scratch file and verified during plan authoring: `node -c` confirmed valid syntax, a cross-platform line count (Step 2) reported exactly **30**, and a fixture battery covering valid payload, empty/malformed/array-root, missing block, bad ph case, v=2, lowercase action code, backslash path, bad sys.c/sys.s, array-cap overflow, empty element, extra key, float v, no-arg, nonexistent file, and non-array `ops.n` (string/number/object/null) all produced the exact stderr strings and exit codes specified below. Copy it verbatim rather than re-deriving it: further "simplification" risks exceeding the line cap again (an earlier, more readable draft of the same logic ran to 50 lines).

- [X] **Step 2: Count non-blank, non-comment lines and confirm ≤30**

Run (cross-platform, no shell-specific flags, same Node already required by the project):
```bash
node -e "const s=require('fs').readFileSync('scripts/snap-validate.mjs','utf8').split(/\r?\n/);console.log(s.filter(l=>l.trim()!==''&&!l.trim().startsWith('//')).length)"
```
Expected: `30`. If it differs because the file was retyped instead of copied verbatim, diff against this plan's code block before changing any logic.

- [X] **Step 3: Smoke-test manually**

Use `tests/.tmp/` (the project's existing repo-relative scratch directory, already in `.gitignore`, already used the same way by `tests/hooks/guard3.test.js`) instead of the OS global temp directory: it's a stable relative path that behaves identically on every platform, unlike `/tmp/`, which does not exist on native Windows.

```bash
mkdir -p tests/.tmp
trap 'rm -f tests/.tmp/snap-ok.json' EXIT
echo -n '{"v":1,"sys":{"ph":"impl","c":"abc1234","s":"x"},"ops":{"n":[],"f":[]},"mem":{"d":[],"x":[]}}' > tests/.tmp/snap-ok.json
node scripts/snap-validate.mjs tests/.tmp/snap-ok.json; echo "exit=$?"
node scripts/snap-validate.mjs tests/.tmp/does-not-exist.json; echo "exit=$?"
```
The `trap ... EXIT` guarantees `tests/.tmp/snap-ok.json` is removed when this shell exits, regardless of which command above fails or what its exit code is (no reliance on reaching an unconditional `rm` line at the end).
Expected: first invocation prints nothing, `exit=0`; second prints `SNAP_ERROR: file not found` to stderr, `exit=1`.

- [X] **Step 4: Re-run the smoke battery against the type-mutation cases**

```bash
trap 'rm -f tests/.tmp/snap-bad.json' EXIT
echo -n '{"v":1,"sys":{"ph":"impl","c":"abc1234","s":"x"},"ops":{"n":"not-an-array","f":[]},"mem":{"d":[],"x":[]}}' > tests/.tmp/snap-bad.json
node scripts/snap-validate.mjs tests/.tmp/snap-bad.json; echo "exit=$?"
```
Expected: `SNAP_ERROR: ops.n must be an array` on stderr, `exit=1` (not an uncaught `TypeError` crash). The `trap` again guarantees cleanup even though this command is expected to exit 1.

- [X] **Step 5: Commit**

```bash
git add scripts/snap-validate.mjs
git commit -m "feat(FEAT-010): add scripts/snap-validate.mjs SNAP v1 validator"
```

---

### Task T-002: Validator test suite (`tests/unit/snap-validate.test.js`)

**Files:**
- Create: `tests/unit/snap-validate.test.js`

**Interfaces:**
- Consumes: `scripts/snap-validate.mjs` (T-001) as a subprocess via `spawnSync('node', [VALIDATOR_PATH, fixturePath])`, mirroring the `spawnSync` pattern already used in `tests/hooks/context-guard.test.js`.

- [X] **Step 1: Write the test file**

```js
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')
const VALIDATOR = resolve(REPO_ROOT, 'scripts/snap-validate.mjs')

const dirs = []
function fixture(content) {
  const d = mkdtempSync(join(tmpdir(), 'snap-'))
  dirs.push(d)
  const p = join(d, 'session-snapshot.json')
  writeFileSync(p, content, 'utf8')
  return p
}
function run(path) {
  const args = path === undefined ? [VALIDATOR] : [VALIDATOR, path]
  const r = spawnSync('node', args, { stdio: 'pipe', timeout: 10000 })
  return { status: r.status ?? -1, stderr: (r.stderr ?? '').toString(), stdout: (r.stdout ?? '').toString() }
}
afterEach(() => { while (dirs.length) { try { rmSync(dirs.pop(), { recursive: true }) } catch {} } })

const VALID = { v: 1, sys: { ph: 'impl', c: 'abc1234', s: 'feat010' }, ops: { n: [], f: [] }, mem: { d: [], x: [] } }
const j = (obj) => JSON.stringify(obj)

describe('snap-validate.mjs', () => {
  it('accepts a valid v1 payload, exit 0, no stdout', () => {
    const r = run(fixture(j(VALID)))
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
    expect(r.stderr).toBe('')
  })

  it('rejects missing path argument', () => {
    const r = run(undefined)
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: no path provided\n')
  })

  it('rejects non-existent file path', () => {
    const r = run(join(tmpdir(), 'snap-does-not-exist-xyz.json'))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: file not found\n')
  })

  it('rejects a directory passed as the path (EISDIR, not ENOENT)', () => {
    const d = mkdtempSync(join(tmpdir(), 'snap-dir-'))
    dirs.push(d)
    const r = run(d)
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: EISDIR\n')
  })

  it('rejects empty file', () => {
    const r = run(fixture(''))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: empty file\n')
  })

  it('rejects malformed JSON', () => {
    const r = run(fixture('{not json'))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: malformed JSON\n')
  })

  it.each([
    ['array', '[1,2,3]'],
    ['string', '"just a string"'],
    ['number', '42'],
    ['boolean', 'true'],
    ['null', 'null'],
  ])('rejects non-object root (%s)', (label, raw) => {
    const r = run(fixture(raw))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: root must be a plain object\n')
  })

  it.each(['sys', 'ops', 'mem'])('rejects missing parent block: %s', (block) => {
    const payload = { ...VALID }
    delete payload[block]
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe(`SNAP_ERROR: missing block: ${block}\n`)
  })

  it('rejects ph outside enum', () => {
    const payload = { ...VALID, sys: { ...VALID.sys, ph: 'SPEC' } }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: ph must be spec|plan|impl|rev\n')
  })

  it('rejects unknown version (v > 1)', () => {
    const payload = { ...VALID, v: 2 }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: SNAP_UNKNOWN_VERSION\n')
  })

  it.each([
    ['ops.n', 'n', 'ops', 'a string'],
    ['ops.f', 'f', 'ops', 42],
    ['mem.d', 'd', 'mem', {}],
    ['mem.x', 'x', 'mem', null],
  ])('rejects %s when it is not an array (%s)', (key, sub, blk, badValue) => {
    const payload = { ...VALID, [blk]: { ...VALID[blk], [sub]: badValue } }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe(`SNAP_ERROR: ${key} must be an array\n`)
  })

  it.each([
    ['ops.n', 'n', 'ops', 4],
    ['ops.f', 'f', 'ops', 21],
    ['mem.d', 'd', 'mem', 11],
    ['mem.x', 'x', 'mem', 6],
  ])('rejects %s exceeding array cap', (key, sub, blk, count) => {
    const arr = blk === 'ops' && sub === 'f'
      ? Array.from({ length: count }, (_, i) => `f${i}.js:M`)
      : Array.from({ length: count }, (_, i) => `e${i}`)
    const payload = { ...VALID, [blk]: { ...VALID[blk], [sub]: arr } }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe(`SNAP_ERROR: ${key} exceeds cap\n`)
  })

  it('rejects invalid ops.f action code character', () => {
    const payload = { ...VALID, ops: { ...VALID.ops, f: ['a.js:X'] } }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: invalid action code in ops.f[0]\n')
  })

  it('rejects lowercase ops.f action code', () => {
    const payload = { ...VALID, ops: { ...VALID.ops, f: ['a.js:m'] } }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: invalid action code in ops.f[0]\n')
  })

  it('rejects backslash in ops.f path', () => {
    const payload = { ...VALID, ops: { ...VALID.ops, f: ['a\\b.js:M'] } }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: backslash in ops.f[0]\n')
  })

  it('rejects empty array element', () => {
    const payload = { ...VALID, mem: { ...VALID.mem, d: ['  '] } }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: empty element in mem.d[0]\n')
  })

  it('rejects a null array element (caught by the same not-a-string check as empty strings)', () => {
    const payload = { ...VALID, mem: { ...VALID.mem, d: [null] } }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: empty element in mem.d[0]\n')
  })

  it('rejects extra top-level key', () => {
    const payload = { ...VALID, extra: true }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: unexpected key: extra\n')
  })

  it('rejects v as a float', () => {
    const payload = { ...VALID, v: 1.5 }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: v must be a positive integer\n')
  })

  it('rejects v as a numeric string', () => {
    const payload = { ...VALID, v: '1' }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: v must be a positive integer\n')
  })

  it('rejects v of 0', () => {
    const payload = { ...VALID, v: 0 }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: v must be a positive integer\n')
  })

  it('rejects negative v', () => {
    const payload = { ...VALID, v: -1 }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: v must be a positive integer\n')
  })

  it('rejects v at Number.MAX_SAFE_INTEGER as an unknown future version, not a crash', () => {
    const payload = { ...VALID, v: Number.MAX_SAFE_INTEGER }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: SNAP_UNKNOWN_VERSION\n')
  })

  it('rejects non-hex sys.c', () => {
    const payload = { ...VALID, sys: { ...VALID.sys, c: 'ZZZZZZZ' } }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: invalid sys.c format\n')
  })

  it('rejects illegal characters in sys.s', () => {
    const payload = { ...VALID, sys: { ...VALID.sys, s: 'a/b' } }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: invalid chars in sys.s\n')
  })

  it('round-trips all field values unchanged on valid input', () => {
    const payload = { v: 1, sys: { ph: 'plan', c: '0000000', s: 'feat010' }, ops: { n: ['step a'], f: ['x.js:C'] }, mem: { d: ['decision a'], x: ['constraint a'] } }
    const path = fixture(j(payload))
    const r = run(path)
    expect(r.status).toBe(0)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(payload)
  })

  it('leaves the file on disk after a schema violation', () => {
    const path = fixture('{not json')
    run(path)
    expect(readFileSync(path, 'utf8')).toBe('{not json')
  })

  it('writes errors to stderr only, never stdout', () => {
    const r = run(fixture('{not json'))
    expect(r.stdout).toBe('')
    expect(r.stderr).not.toBe('')
  })

  it('contains no console.* invocations (stdout must stay empty on every path, not just the tested ones)', () => {
    const src = readFileSync(VALIDATOR, 'utf8')
    expect(src).not.toMatch(/console\./)
  })

  it('scripts/snap-validate.mjs stays within the 30-line hard cap', () => {
    const src = readFileSync(VALIDATOR, 'utf8').split(/\r?\n/)
    const counted = src.filter(l => l.trim() !== '' && !l.trim().startsWith('//'))
    expect(counted.length).toBeLessThanOrEqual(30)
  })

  it('SNAP v1 serialization is at most 85% of the equivalent markdown snapshot length', () => {
    const snapFixture = '{"v":1,"sys":{"ph":"impl","c":"4a6bc93","s":"2026-06-24-bug015-auto-claude-md-design"},"ops":{"n":["run /cc-implement bug015"],"f":["tests/scripts/_fill_helper.cjs:M","tests/scripts/_fill_helper.ps1:C","tests/scripts/installer-fill.test.ps1:M"]},"mem":{"d":["_fill_helper.cjs dual-mode argv[2]: {→JSON else filepath","PS5.1 strips exe quotes→write tempfile","test harness wraps _fill_helper.ps1"],"x":["BUG-003 surgical single-line edits","PS5.1 dblquote strip"]}}'
    const markdownFixture = [
      '# Session Snapshot',
      '**Phase:** impl',
      '**Commit:** 4a6bc93',
      '',
      '## Decisions',
      '- _fill_helper.cjs dual-mode argv[2]: {→JSON else filepath',
      '- PS5.1 strips exe quotes→write tempfile',
      '- test harness wraps _fill_helper.ps1',
      '',
      '## Pending',
      '- run /cc-implement bug015',
      '',
      '## Files Touched',
      '- `tests/scripts/_fill_helper.cjs` - modified',
      '- `tests/scripts/_fill_helper.ps1` - created',
      '- `tests/scripts/installer-fill.test.ps1` - modified',
      '',
      '## Constraints',
      '- BUG-003 surgical single-line edits',
      '- PS5.1 dblquote strip',
      '',
      '## Spec Reference',
      '`docs/superpowers/specs/2026-06-24-bug015-auto-claude-md-design.md`',
    ].join('\n')
    const norm = (s) => s.replace(/\r\n/g, '\n')
    expect(norm(snapFixture).length).toBeLessThanOrEqual(norm(markdownFixture).length * 0.85)
  })
})
```

This covers 43 cases (≥16 required): 27 single `it()` cases (including the EISDIR/directory-path case, the null-array-element case, the v boundary cases (0, negative, `Number.MAX_SAFE_INTEGER`), and the zero-`console.*` static check), the 5-case primitive-root `it.each` (array/string/number/boolean/null), the 3-case parent-block `it.each`, the 4-case type-mutation `it.each` (non-array ops.n/ops.f/mem.d/mem.x), and the 4-case array-cap `it.each`, including the 30-line guard and the character-count assertion using the spec's own frozen canonical example (line 119 of the design doc) as the SNAP fixture, paired with the markdown shape `/cc-compact` historically produced for the same logical payload.

- [X] **Step 2: Run the new suite and confirm all cases pass**

Run: `npx vitest run tests/unit/snap-validate.test.js`
Expected: all tests pass (43/43). If the character-count assertion fails, recheck the markdown fixture against the exact format `/cc-compact` (T-003) emits: this is the same logical payload, not necessarily the exact format if T-003 wording diverges from the historical fixture.

- [X] **Step 3: Commit**

```bash
git add tests/unit/snap-validate.test.js
git commit -m "test(FEAT-010): add snap-validate.mjs test suite (43 cases)"
```

---

### Task T-003: Rewrite `/cc-compact` to emit SNAP v1 JSON

**Files:**
- Modify: `global/commands/cc-compact.md` (repo-tracked source, full rewrite)
- Modify: `$HOME/.claude/commands/cc-compact.md` (live installed copy, the same path `install.sh` writes to: outside the repo, resolve `$HOME` for whichever machine is running this plan rather than a literal path; mirror identically so the command behaves correctly in this session without a reinstall)

**Interfaces:**
- Produces: `.claude/memory/session-snapshot.json`, a single-line file matching the schema validated by T-001's `scripts/snap-validate.mjs`. Read by T-004/T-005 (`/cc-implement`).

- [X] **Step 1: Write the new command body**

```markdown
---
description: "(Conductor) Serialize phase state and prompt for context compaction"
---

Run `git rev-parse --short HEAD` to get the current commit SHA. Lowercase the trimmed result; if it does not match `/^[0-9a-f]{7}$/` after lowercasing (and slicing to 7 chars if longer, or padding with trailing zeros if shorter), or if the command exits non-zero (non-git workspace, no commits yet), use `"0000000"`.

Determine `sys.s`: take the active specification file path from this phase's context, split on `/` and `\`, keep the last segment, strip a trailing `.md` extension, truncate to 200 characters. If no active spec file exists, use `"none"`.

Collect from the current conversation context:
- **Phase** (`sys.ph`): `spec` | `plan` | `impl` | `rev`, the phase that just completed
- **Decisions** (`mem.d`): finalized decisions this phase, max 10 elements, each ≤300 chars (JSON-serialized length)
- **Pending** (`ops.n`): next immediate step(s), max 3 elements, each ≤200 chars
- **Files Touched** (`ops.f`): each entry `<relpath>:C|M|D` (uppercase only); replace any backslash in the path with `/`; if the path contains a literal `:`, percent-encode it as `%3A` before appending the suffix; max 20 elements, each ≤300 chars
- **Constraints** (`mem.x`): hard constraints next phase must respect, max 5 elements, each ≤200 chars

For all four array fields: filter out empty/whitespace-only strings, deduplicate by exact case-sensitive string equality (first occurrence wins), then truncate each surviving element to its per-element cap (Unicode-safe: `Array.from(str).slice(0, cap).join('')`), then if the array still exceeds its cap, drop from the **head** (oldest first) until it fits. Empty arrays are valid and must still be serialized (never omitted).

Serialize as a single-line JSON object with exactly these top-level keys: `v` (always `1`), `sys` (`{ph, c, s}`), `ops` (`{n, f}`), `mem` (`{d, x}`). Key order within objects does not matter. If the total serialized length exceeds 4096 characters, iteratively drop the oldest element from the longest of `mem.d` / `ops.f` and re-serialize until it fits. Stop condition: if `mem.d` and `ops.f` are both already empty and the payload still exceeds 4096 characters, stop trimming and write the file as-is rather than looping forever; the validator will then correctly reject it with `SNAP_ERROR: payload too large`, surfacing the problem instead of silently hanging. (Given the per-field caps defined elsewhere in this spec, `sys.c` + `sys.s` + `ops.n` + `mem.x` alone never exceed roughly 2000 characters combined, so this floor cannot actually be reached today, but the loop must still have an explicit termination condition rather than relying on that being true forever.)

Write the single JSON line, followed by exactly one trailing newline, to `.claude/memory/session-snapshot.json`.

If `.claude/memory/session-snapshot.md` exists, delete it as part of this write.

Idempotently append `.claude/memory/session-snapshot.json` to the project's `.gitignore`: read the file; if any line, after stripping leading/trailing whitespace, exactly equals `.claude/memory/session-snapshot.json`, skip the append. Otherwise, check whether the last byte of `.gitignore` is a newline; if not, prepend a newline before the appended entry. If `.gitignore` cannot be read or written (permission or lock error), log a non-fatal warning to stderr and continue; do not block the snapshot write.

If writing the snapshot fails (e.g., missing `.claude/memory/` directory), report the error and stop. Do NOT output the compact prompt.

Once the snapshot is written successfully, output exactly:

> Snapshot written. Run `/compact` now to clear history.
```

- [X] **Step 2: Apply identically to both files**

Resolve the actual home directory first, since file-write tools require a literal absolute path and cannot expand `$HOME`/`~` themselves: run `echo $HOME` (Unix/macOS) or `echo $env:USERPROFILE` (Windows PowerShell) via the shell, or equivalently `node -e "console.log(require('os').homedir())"` (cross-platform, no shell-specific syntax). Use that resolved path to construct `<home>/.claude/commands/cc-compact.md`. Write the Step 1 content to `global/commands/cc-compact.md`, then write the exact same content to the resolved live-copy path.

- [X] **Step 3: Commit the repo-tracked copy**

`global/commands/cc-compact.md` is not covered by any `.gitignore` rule (`.claude/` and `docs/` are ignored; `global/` is not), so a plain `git add` is sufficient here, unlike T-004/T-008/T-012 which touch paths under `.claude/`.

```bash
git add global/commands/cc-compact.md
git commit -m "feat(FEAT-010): rewrite /cc-compact to emit SNAP v1 JSON instead of markdown"
```

(The live copy at `~/.claude/commands/cc-compact.md` is outside the repo and is not committed; it now matches what a fresh `install.sh` would deliver.)

---

### Task T-004: Update live `.claude/commands/cc-implement.md` for SNAP v1 destructive-read

**Files:**
- Modify: `.claude/commands/cc-implement.md` (Phase entry blocks, lines 5–28 per current content)

**Interfaces:**
- Consumes: `.claude/memory/session-snapshot.json` written by T-003, validated by `scripts/snap-validate.mjs` (T-001).

- [X] **Step 1: Replace the two Phase entry sections**

Replace the existing `## Phase entry - Handoff enforcement` and `## Phase entry - Destructive Read Invariant` sections (everything from `## Phase entry - Handoff enforcement` through the line `If the file cannot be deleted after reading, report the error and halt.` followed by `---`) with:

```markdown
## Phase entry - Handoff enforcement

Before doing anything else, perform this blocking check:

1. Count the number of turns in the current conversation history.
2. If turn count exceeds 5, halt immediately and output:

   > "Phase boundary detected. Please execute /compact to clear history before proceeding."

   Do not start any implementation tasks. Enter standby. Wait for the user to confirm `/compact` has been run before continuing.

3. If turn count ≤ 5, proceed to the Destructive Read Invariant below.

## Phase entry - Destructive Read Invariant

1. Resolve the repository root via `git rev-parse --show-toplevel`. If `git` is not found in PATH, or the command exits non-zero, halt immediately with `REPO_ROOT_FAILED: cannot determine repository root` and exit with code 3.
2. If `<repo-root>/.claude/memory/session-snapshot.json` exists:
   a. Attempt to read its full contents into context (do not delete yet). If this read fails for any reason other than the file not existing (permission denied, I/O error, or other filesystem-level corruption; the existence check above already ruled out "missing"), halt immediately with `SNAP_READ_FAILED: <brief reason, e.g. permission denied>` and leave the file on disk for manual inspection. Do not proceed to invoke the validator on a file the orchestrator itself could not read.
   b. If `<repo-root>/.claude/memory/session-snapshot.md` also exists, delete it now without reading it: `.json` takes precedence over `.md` whenever both are present.
   c. Invoke `node "<repo-root>/scripts/snap-validate.mjs" "<repo-root>/.claude/memory/session-snapshot.json"`, capturing both its exit code and its stderr text.
   d. If `node` cannot be found or fails to launch, halt with `NODE_NOT_FOUND: node binary not found in PATH` and exit with code 2.
   e. If the validator exits 1: if its stderr is exactly `SNAP_ERROR: SNAP_UNKNOWN_VERSION` (with trailing newline), halt with `SNAP_UNKNOWN_VERSION` (the payload is structurally fine but declares a schema version this reader does not know); for any other stderr content, halt with `SNAP_INVALID`. Either way, leave the file on disk for manual inspection and do not proceed.
   f. If the validator exits 0: bind context variables: phase from `sys.ph`, commit from `sys.c`, decisions from `mem.d`, constraints from `mem.x`, next steps from `ops.n`, files from `ops.f`, spec stem from `sys.s`. If `sys.s` is `"none"`, treat spec reference as absent. (Exit 0 already guarantees `v === 1`, since the validator itself rejects any other value before returning success: no separate version check is needed here.)
   g. Only after all context variables are bound: delete `session-snapshot.json`. If deletion fails (permission or lock error), log a non-fatal warning to stderr and continue: context is already bound.
3. Else if `<repo-root>/.claude/memory/session-snapshot.md` exists (legacy fallback, one session only):
   a. Emit to stderr: `[WARN] session-snapshot.md detected: SNAP v1 JSON not found; falling back to legacy format. Update /cc-compact to write SNAP v1 JSON.`
   b. Read its full contents into context using the existing markdown extraction logic.
   c. Once all context variables are bound, delete `session-snapshot.md`. If deletion fails, log a non-fatal warning and continue.
4. Else: no snapshot context available; proceed directly (read-if-present fallback, existing behavior unchanged).

---
```

- [X] **Step 2: Verify the rest of the file is untouched**

Run two checks:
1. `grep -c "Surgical Plan State Ritual" .claude/commands/cc-implement.md`: expect exactly `1` (not zero, not duplicated).
2. `wc -l .claude/commands/cc-implement.md`: expect exactly `144` (the file was 138 lines before this edit; the replacement block is 31 lines versus the 25 lines it replaces, a net +6, giving 138 + 6 = 144). If the count differs, the edit touched more or less than the intended Phase entry span; diff against this plan's Step 1 block before proceeding, do not guess at which extra lines changed.

- [X] **Step 3: Commit**

```bash
git add -f .claude/commands/cc-implement.md
git commit -m "feat(FEAT-010): /cc-implement reads SNAP v1 JSON with one-session .md fallback"
```

---

### Task T-005: Mirror the same update to `project-template/.claude/commands/cc-implement.md`

**Files:**
- Modify: `project-template/.claude/commands/cc-implement.md` (currently byte-identical to the pre-T-004 `.claude/commands/cc-implement.md`)

**Interfaces:**
- None beyond T-004: this is the distributable template consumed by `install.sh --project` for other repositories.

- [X] **Step 1: Apply the identical replacement from T-004 Step 1**

Replace the same two Phase entry sections with the identical block used in T-004.

- [X] **Step 2: Diff against the live copy to confirm exact parity**

Run: `diff .claude/commands/cc-implement.md project-template/.claude/commands/cc-implement.md`
Expected: no output (files identical).

- [X] **Step 3: Commit**

```bash
git add project-template/.claude/commands/cc-implement.md
git commit -m "feat(FEAT-010): mirror SNAP v1 /cc-implement update to project-template"
```

---

### Task T-006: Full regression run

**Files:** none (verification only)

- [X] **Step 1: Run the complete Vitest suite**

Run: `npx vitest run`
Expected: all 216 pre-existing tests plus the 43 new `snap-validate.test.js` cases pass (259 total), zero failures.

- [X] **Step 2: If any pre-existing test fails, stop and report**

Do not proceed to T-007 until the full suite is green; this task has no commit step, it's a gate.

---

### Task T-007: README.md comparison table (SNAP v1 row)

**Files:**
- Modify: `README.md:11-17` (the "Without code-conductor / With code-conductor" table)

**Interfaces:** none; documentation only.

- [X] **Step 1: Add the row**

Add as a new row after line 17 (`| Manual CLAUDE.md with...`):

```markdown
| Verbose markdown handoffs eat context | **SNAP v1**: minified single-line JSON handoff format, schema-validated by `scripts/snap-validate.mjs`, ≥15% smaller than the markdown snapshot it replaces |
```

- [X] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(FEAT-010): add SNAP v1 row to README comparison table"
```

---

### Task T-008: Flip `AGENT-READABLE BACKLOG.md` `[FEAT-010]` checkbox

**Files:**
- Modify: `AGENT-READABLE BACKLOG.md:45`

**Interfaces:** none.

- [X] **Step 1: Pre-check uniqueness**

Run: `grep -c '\[FEAT-010\]' "AGENT-READABLE BACKLOG.md"`
Expected: `1` (BUG-003 invariant: confirm singular match before editing).

- [X] **Step 2: Surgical single-line edit**

Use `Edit` with `old_string`: `### [ ] \`[FEAT-010]\` Dense Prompt Protocol Standard` and `new_string`: `### [X] \`[FEAT-010]\` Dense Prompt Protocol Standard`.

- [X] **Step 3: Commit**

```bash
git add "AGENT-READABLE BACKLOG.md"
git commit -m "chore(FEAT-010): mark Dense Prompt Protocol Standard complete"
```

---

### Task T-009: Bump `VERSION`

**Files:**
- Modify: `VERSION`

- [X] **Step 1: Write the new version**

Replace file contents with exactly: `1.17.0`

- [X] **Step 2: Commit**

```bash
git add VERSION
git commit -m "chore: bump VERSION to 1.17.0"
```

---

### Task T-010: Bump `package.json` version

**Files:**
- Modify: `package.json:3`
- Modify: `package-lock.json` (regenerated by `npm install --package-lock-only` in Step 2, not hand-edited)

**Interfaces:**
- Consumes: must match `VERSION` from T-009 (`1.17.0`), kept synchronized per project convention.

- [X] **Step 1: Surgical single-line edit**

Use `Edit` with `old_string`: `  "version": "1.16.0",` and `new_string`: `  "version": "1.17.0",`.

- [X] **Step 2: Sync `package-lock.json`**

Run: `npm install --package-lock-only`

This regenerates the lockfile's root-package `version` field to match the new `package.json` value without touching `node_modules` or any dependency resolution. Verified empirically while writing this plan (npm 11.x, lockfileVersion 3, the format already in this repo's committed lockfile): `package-lock.json` does change after a version-only `package.json` bump (the root entries gain/update a `"version": "1.17.0"` field); without this step, `npm ci` in strict CI environments could fail on a lockfile-sync mismatch.

No specific npm version is mandated here, since pinning one in a markdown plan can't be enforced; instead, verify the *output* is scoped correctly: run `git diff package-lock.json` and confirm only `"version": "1.17.0"` lines changed (the root entries under `""` and at the top of the file). If the diff also touches unrelated dependency entries (different `resolved` URLs, `integrity` hashes, or added/removed transitive packages), that signals the local npm version produced a different dependency resolution than the one that generated the currently-committed lockfile; stop and re-run with a closer npm version rather than committing an unrelated dependency-tree change alongside a version bump.

- [X] **Step 3: Commit both files together**

```bash
git add package.json package-lock.json
git commit -m "chore: bump package.json version to 1.17.0"
```

---

### Task T-011: Add `CHANGELOG.md` entry

**Files:**
- Modify: `CHANGELOG.md` (insert new top section before the existing `## [1.16.0]` entry)

- [X] **Step 1: Insert the new entry**

Insert before the line `## [1.16.0] — 2026-06-26`:

```markdown
## [1.17.0] - 2026-06-30

### Added
- `[FEAT-010]` `scripts/snap-validate.mjs`: ≤30-line dependency-free Node.js ≥18 validator for SNAP v1, the minified single-line JSON handoff format; exits 0/1 only, all errors prefixed `SNAP_ERROR:` on stderr
- `[FEAT-010]` `tests/unit/snap-validate.test.js`: 43-case Vitest suite covering schema violations, primitive/array-type mutations, version boundary values, array/element caps, directory-as-path (EISDIR), line-count enforcement, a zero-console.* static check, and the >=15% character-reduction assertion against the legacy markdown format

### Changed
- `[FEAT-010]` `/cc-compact` (global command): now writes `.claude/memory/session-snapshot.json` (SNAP v1) instead of `session-snapshot.md`; idempotently gitignores the new file; deletes legacy `.md` on write
- `[FEAT-010]` `/cc-implement` (project command, both `.claude/commands/` and `project-template/.claude/commands/`): Phase entry now validates and reads SNAP v1 JSON via the destructive-read pattern, with a one-session `.md` fallback for backward compatibility

```

- [X] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add CHANGELOG entry for v1.17.0 (FEAT-010)"
```

---

### Task T-012: Append spec summary to `project.md`

**Files:**
- Modify: `.claude/memory/project.md` (append-only, after the last `## Checkpoint` / `## Spec:` block)

**Interfaces:** none.

- [X] **Step 1: Append the spec summary**

Append at the end of the file:

```markdown

## Spec: FEAT-010 Dense Prompt Protocol Standard 2026-06-30

Replace `session-snapshot.md` with SNAP v1: minified single-line JSON envelope (`v`, `sys{ph,c,s}`, `ops{n,f}`, `mem{d,x}`), validated by `scripts/snap-validate.mjs` (≤30 lines, exits 0/1, all stderr lines prefixed `SNAP_ERROR:`, single-tier prefix, no second `SNAP_INVALID` variant).
- `/cc-compact` writes JSON; `/cc-implement` reads + deletes (destructive-read), one-session `.md` fallback removed in v1.18.0
- 4096-char max file size; array caps `ops.n≤3 ops.f≤20 mem.d≤10 mem.x≤5`; per-element caps 200-300 chars
- v2+ schema (`role`, `tk`, `scope`, `gate`, `p`) reserved for FEAT-011/012, not implemented here
- Spec: `docs/superpowers/specs/2026-06-26-feat010-dense-prompt-protocol-design.md`
- Complexity: M
```

- [X] **Step 2: Commit**

`.claude/memory/project.md` falls under the blanket `.claude/` gitignore rule (not covered by the `!project-template/*` exception), so this requires `-f` like T-004, unlike T-003's `global/commands/cc-compact.md`, which does not.

```bash
git add -f .claude/memory/project.md
git commit -m "docs(FEAT-010): append spec summary to project.md"
```

---

## Test List

- [X] `tests/unit/snap-validate.test.js`: 43 cases (T-002), validator unit/integration coverage
- [X] Full Vitest regression: `npx vitest run`, all 216 pre-existing + 43 new cases pass (T-006)
- [X] Manual smoke test of `scripts/snap-validate.mjs` against a hand-written valid/invalid fixture (T-001 Step 3)
- [X] Manual diff confirming `.claude/commands/cc-implement.md` and `project-template/.claude/commands/cc-implement.md` stay byte-identical (T-005 Step 2)

## Commit Order

T-001 → T-002 → T-003 → T-004 → T-005 → T-006 (gate, no commit) → T-007 → T-008 → T-009 → T-010 → T-011 → T-012. Each task is its own commit; T-006 is verification-only and produces no commit. Code + tests (T-001–T-005) land before any documentation or version bump (T-007–T-012), per the spec's explicit ordering mandate.

## Identified Risks

- **30-line validator cap is tight.** The Step 1 draft in T-001 is dense by necessity; any future addition to the schema (a new key, a new cap) risks pushing past 30 lines. T-002's line-count test catches this immediately as a failing test, not a silent regression.
- **Character-count fixture drift.** T-002's ≤85% assertion hardcodes the spec's canonical example (spec line 119) as both the SNAP and markdown fixture. If T-003's actual `/cc-compact` markdown-era format ever differed from this fixture's shape, the test would still pass (it's a frozen fixture, not a live `/cc-compact` invocation); this is by design per the spec ("fixture is immutable") but means the test does not catch future drift in `/cc-compact`'s real output shape.
- **SNAP v1's actual reduction (18.6% measured) is modest, not dramatic.** The schema's per-element overhead (JSON quote/comma punctuation) is comparable to markdown's per-line overhead (dash/newline), so adding more decisions/files doesn't meaningfully improve the ratio: it stays in the 78-81% range regardless of payload size (verified at tiny/typical/max-cap sizes during plan authoring). If a larger reduction is wanted later, it requires schema rework (flatter delimited encoding instead of JSON), which is explicitly out of scope for this plan.
- **Live `~/.claude/commands/cc-compact.md` is outside git.** T-003 Step 2 updates it directly so this session's own `/cc-compact` runs use the new format immediately, but it is not part of any commit; a fresh `install.sh` run elsewhere would pull from `global/commands/cc-compact.md` (which T-003 Step 3 does commit), so the two stay in sync only if T-003 is executed as written.
- **`.gitignore` runtime append (inside `/cc-compact`'s own logic) is unverified by this plan.** It is correct per spec but only exercised the first time someone actually runs the new `/cc-compact` against a real `.gitignore`; no automated test covers it, consistent with the spec's Out of Scope (no test infra changes mandated for command-body prose, only for `scripts/snap-validate.mjs`).
