# Handoff Contract Implementation Plan [BUG-038]

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the session handoff one contract that its writer, its validator and its store all import, make the validator's size check version-aware so a prose-carrying snapshot stops being written and then discarded, make every rejection name its reason, and have each phase boundary write its own session row.

**Architecture:** One new zero-dependency ESM module under `scripts/` holds every limit, array cap, field set and version ceiling the SNAP envelope is defined by. `snap-build.mjs`, `snap-validate.mjs` and `conductor-db.mjs` import from it instead of carrying literals. The validator's single pre-parse size check splits into a hard pre-parse ceiling (10 MiB, applied before `JSON.parse`) and a post-parse, version-specific cap (4096 characters for v1, 10 MiB for v2). `resume-read.mjs` keeps degrading and keeps exiting 3, but every degrade line now names why. `/cc-plan` and `/cc-implement` gain the same fail-open session-row tail `/cc-compact` already runs, extracted once into a marker-delimited block so the three agree by construction.

**Tech Stack:** Node ESM (`node:` builtins only), Vitest 3, markdown command files with two mirrors (`.claude/commands/` and `project-template/.claude/commands/`).

**Spec:** `docs/superpowers/specs/2026-09-27-bug038-handoff-contract-design.md`

## Global Constraints

- Target release **1.31.0** (minor). Version literal lives in `package.json:3` and `CHANGELOG.md` only.
- Zero runtime dependencies. The contract module imports nothing outside `node:` builtins.
- `snap-validate.mjs` must stay independently spawnable by path: `resume-read.mjs:38` invokes it as a child process. Its sibling import resolves because the installer copies `scripts/` wholesale (`lib/installer/deploy.mjs:190`).
- `snap-validate.mjs` must stay within its **32-line hard cap** (`tests/unit/snap-validate.test.js:247`, counting non-blank non-comment lines). It sits at exactly 32 today; the target text below is exactly 32.
- `resume-read.mjs` must **not** import the contract module. Two pre-existing tests copy it alone into an isolated tree (`tests/scripts/resume-read.test.js:193,205`); it learns rejection reasons from the validator's stderr, never from a static import.
- `resume-read.mjs` stays Node-14 syntax only: no `||=`, `&&=`, `??=`, `.at(`, `structuredClone` (`tests/scripts/resume-read.test.js:117`).
- Fail-open stays fail-open. No new tail may change a command's exit or suppress its normal output.
- No em-dashes in any authored output, including code comments, commit messages and the plan's own prose.
- Commit messages: Conventional Commits, id in the subject, and the two attribution lines.
- BUG-003 invariant: plan state updates are surgical single-line edits.
- `docs/` is gitignored (`.gitignore:8`), so every commit touching this plan file uses `git add -f`.

**Test baseline at plan time: 816 passed, 12 skipped, 828 total, across 31 files (30 passed, 1 skipped).** Verified by `npx vitest run` on `673ac3c`. Every predicted count below assumes `node:sqlite` is available, as it is on this machine: the DB-branch cases are `skipIf`-gated and would land in the skipped column without it.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `scripts/snap-contract.mjs` | create | The contract: pre-parse ceiling, per-version caps, array caps, field sets, version ceiling |
| `scripts/snap-validate.mjs` | modify | Two-tier size check; all four contracts resolved from the module |
| `scripts/snap-build.mjs` | modify | `MAX_SNAP_BYTES`, `V1_MAX_CHARS`, `CAPS` replaced by imports; caps re-keyed to the one scheme |
| `scripts/conductor-db.mjs` | modify | `MAX_SNAP_BYTES` replaced by an import |
| `scripts/resume-read.mjs` | modify | Degrade paths carry their reason |
| `global/commands/cc-compact.md` | modify | Session-row tail extracted into the marker block |
| `.claude/commands/cc-plan.md` + template mirror | modify | New session-row tail, phase `plan` |
| `.claude/commands/cc-implement.md` + template mirror | modify | New session-row tail, phase `impl` |
| `tests/unit/snap-contract.test.js` | create | Three-consumer agreement, no duplicated literal, one cap table |
| `tests/scripts/handoff-cycle.test.js` | create | The end-to-end cycle, doc-sourced phase literal |
| `tests/unit/snap-validate.test.js` | modify | 9 new cases (two-tier sizes, pre-parse block, field sets, version ceiling) |
| `tests/scripts/resume-read.test.js` | modify | 3 new cases (reason lines, oversize still exits 3) |
| `tests/installer/commands-parity.test.js` | modify | 13 new cases (cc-implement mirrors, the three tails, loud degrade) |
| `tests/scripts/conductor-db.test.js` | modify | **Pre-declared touch:** two fixtures copy the contract sibling. See Risk 1. |

---

## Task 0: Commit the plan

- [X] [T-000-A] Stage the plan file

```bash
git add -f docs/superpowers/plans/2026-09-27-bug038-handoff-contract.md
```

- [X] [T-000-B] Commit

```bash
git commit -m "$(cat <<'EOF'
docs: add the BUG-038 handoff-contract implementation plan

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HLS5KAHkhpMChyqNTbqrhe
EOF
)"
```

**Predicted state at the T-000 boundary:** 816 passed, 12 skipped. No source touched.

---

## Task 1: The contract module and the two-tier validator

**Files:**
- Create: `scripts/snap-contract.mjs`
- Modify: `scripts/snap-validate.mjs`
- Test: `tests/unit/snap-validate.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `scripts/snap-contract.mjs` exporting `PRE_PARSE_MAX_BYTES: number`, `V1_MAX_CHARS: number`, `POST_PARSE_MAX: Record<1|2, number>`, `MAX_VERSION: number`, `CAPS: Record<'ops.n'|'ops.f'|'mem.d'|'mem.x', [number, number]>`, `TOP_FIELDS: Record<1|2, string[]>`, `BLOCK_FIELDS: Record<'sys'|'ops'|'mem', string[]>`. Tasks 2, 3 and 5 import these names.

- [X] [T-001-A] Write the failing tests for the two-tier size check

Append to `tests/unit/snap-validate.test.js`, inside the existing `describe('snap-validate.mjs', ...)` block, before its closing `})`:

```js
  // ---- BUG-038: two tiers, because one number cannot do both jobs ----

  const pad = (n) => 'x'.repeat(n)

  it('accepts a v2 payload larger than the v1 4096-character budget', () => {
    const big = { v: 2, sys: { ph: 'impl', c: 'abc1234', s: 'feat010' }, ops: { n: [], f: [] }, mem: { d: [], x: [] }, pr: pad(6000) }
    const r = run(fixture(j(big)))
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
  })

  it('still rejects a v1 payload over 4096 characters, naming the v1 cap', () => {
    const over = { ...VALID, mem: { d: [pad(300), pad(300), pad(300), pad(300), pad(300), pad(300), pad(300), pad(300), pad(300), pad(300)], x: [pad(200), pad(200), pad(200), pad(200), pad(200)] }, ops: { n: [pad(200), pad(200), pad(200)], f: [] } }
    const text = j(over)
    expect(text.length).toBeGreaterThan(4096)
    const r = run(fixture(text))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('payload too large')
    expect(r.stderr).toContain('4096')
    expect(r.stderr).toContain('(v1 cap)')
  })

  it('rejects a payload over the pre-parse ceiling WITHOUT parsing it', () => {
    // Deliberately malformed JSON above the ceiling: if the ceiling were applied
    // after JSON.parse, the reported error would be `malformed JSON` instead.
    const r = run(fixture('{' + pad(10485760)))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('pre-parse ceiling')
    expect(r.stderr).not.toContain('malformed JSON')
  })

  it('accepts a v2 pr carrying newlines and keeps the payload one physical line', () => {
    const withNl = { v: 2, sys: { ph: 'rev', c: 'abc1234', s: 'feat010' }, ops: { n: [], f: [] }, mem: { d: [], x: [] }, pr: 'line one\nline two\nline three' }
    const text = j(withNl)
    expect(text).not.toContain('\n')
    const r = run(fixture(text))
    expect(r.status).toBe(0)
  })

  it('rejects a payload carrying the Unicode replacement character', () => {
    const r = run(fixture(j({ ...VALID, sys: { ...VALID.sys, s: 'ok' } }).replace('"ok"', '"o�k"')))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: encoding error\n')
  })

  it('rejects a payload with an internal newline', () => {
    const r = run(fixture(j(VALID).replace('{"v"', '{\n"v"')))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: internal newline in payload\n')
  })
```

- [X] [T-001-B] Write the failing tests for the field sets and the version ceiling

Append immediately after the block from T-001-A:

```js
  // ---- BUG-038: field sets and the version ceiling come from the contract ----

  it('resolves its per-version top-level field set from the contract module', async () => {
    const { TOP_FIELDS } = await import('../../scripts/snap-contract.mjs')
    const src = readFileSync(VALIDATOR, 'utf8')
    expect(src).toContain('TOP_FIELDS')
    expect(src).not.toMatch(/\['v', 'sys', 'ops', 'mem'\]/)
    expect(TOP_FIELDS[2]).toContain('pr')
    expect(TOP_FIELDS[1]).not.toContain('pr')
    // v1 rejecting `pr` is the behavior that field set encodes
    const r = run(fixture(j({ ...VALID, pr: 'prose' })))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: unexpected key: pr\n')
  })

  it('resolves its per-block field sets from the contract module', async () => {
    const { BLOCK_FIELDS } = await import('../../scripts/snap-contract.mjs')
    const src = readFileSync(VALIDATOR, 'utf8')
    expect(src).toContain('BLOCK_FIELDS')
    expect(BLOCK_FIELDS).toEqual({ sys: ['ph', 'c', 's'], ops: ['n', 'f'], mem: ['d', 'x'] })
    const r = run(fixture(j({ ...VALID, sys: { ...VALID.sys, extra: 1 } })))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: unexpected key: sys.extra\n')
  })

  it('tracks the contract module for the SNAP_UNKNOWN_VERSION boundary', async () => {
    const { MAX_VERSION } = await import('../../scripts/snap-contract.mjs')
    const src = readFileSync(VALIDATOR, 'utf8')
    expect(src).toContain('MAX_VERSION')
    expect(src).not.toMatch(/snap\.v > 2/)
    const over = run(fixture(j({ ...VALID, v: MAX_VERSION + 1 })))
    expect(over.status).toBe(1)
    expect(over.stderr).toBe('SNAP_ERROR: SNAP_UNKNOWN_VERSION\n')
  })
```

- [X] [T-001-C] Run the new tests and confirm they fail

Run: `npx vitest run tests/unit/snap-validate.test.js`
Expected: FAIL. The v2-over-4096 case fails with `payload too large`; the pre-parse case reports `payload too large` without the words `pre-parse ceiling`; the three module cases fail on `Cannot find module '../../scripts/snap-contract.mjs'`.

- [X] [T-001-D] Create the contract module

Create `scripts/snap-contract.mjs`:

```js
// scripts/snap-contract.mjs
// The handoff contract: every limit, array cap, field set and version the SNAP
// envelope is defined by. snap-build.mjs (writer), snap-validate.mjs (validator)
// and conductor-db.mjs (store) all import from here, so a literal on one side
// cannot drift from the other. Zero dependencies, node: builtins only.

// Hard pre-parse ceiling: the largest any version may legitimately be. Applied
// before JSON.parse, whatever version the payload claims, so a hostile or
// corrupt file cannot exhaust memory through the parser.
export const PRE_PARSE_MAX_BYTES = 10485760; // 10 MiB

// The v1 context budget for .claude/memory/session-snapshot.json, a file whose
// whole purpose is to be read into a session. Not a drifted literal: a real
// constraint, kept under its own name.
export const V1_MAX_CHARS = 4096;

// Post-parse, version-specific caps, applied once snap.v is known. For v2 the
// two tiers coincide; they separate the moment a v3 arrives with its own budget.
export const POST_PARSE_MAX = { 1: V1_MAX_CHARS, 2: PRE_PARSE_MAX_BYTES };

// Highest v this contract understands. Raising it here moves the
// SNAP_UNKNOWN_VERSION boundary with no edit anywhere else.
export const MAX_VERSION = 2;

// One array-cap table in ONE key scheme: dotted path to [count cap, element cap].
// Two schemes for one table is how a drift hides from every diff and grep.
export const CAPS = {
  'ops.n': [3, 200],
  'ops.f': [20, 300],
  'mem.d': [10, 300],
  'mem.x': [5, 200],
};

// Field sets. Top-level is per version; block members are version-invariant.
export const TOP_FIELDS = {
  1: ['v', 'sys', 'ops', 'mem'],
  2: ['v', 'sys', 'ops', 'mem', 'pr'],
};
export const BLOCK_FIELDS = { sys: ['ph', 'c', 's'], ops: ['n', 'f'], mem: ['d', 'x'] };
```

- [X] [T-001-E] Rewrite the validator against the contract

Modify `scripts/snap-validate.mjs`. Four edits, each surgical:

1. Line 1 gains the contract import, packed onto the existing import line so the line count does not grow:

```js
import { readFileSync } from 'node:fs'; import { BLOCK_FIELDS, CAPS, MAX_VERSION, POST_PARSE_MAX, PRE_PARSE_MAX_BYTES, TOP_FIELDS } from './snap-contract.mjs';
```

2. Line 7 splits. Replace:

```js
if (trimmed === '') err('empty file'); if (raw.length > 4096) err('payload too large');
```

with two lines:

```js
if (trimmed === '') err('empty file');
if (raw.length > PRE_PARSE_MAX_BYTES) err(`payload too large: ${raw.length} > ${PRE_PARSE_MAX_BYTES} (pre-parse ceiling)`);
```

3. Line 14 and lines 17-18 resolve their field sets from the module. Replace line 14:

```js
const topAllowed = snap.v === 2 ? ['v', 'sys', 'ops', 'mem', 'pr'] : ['v', 'sys', 'ops', 'mem'];
```

with:

```js
const topAllowed = TOP_FIELDS[snap.v] || TOP_FIELDS[1];
```

Delete line 17 (`const allow = {...}`) entirely and replace line 18 with:

```js
for (const b of ['sys', 'ops', 'mem']) { const extra = Object.keys(snap[b]).find(k => !BLOCK_FIELDS[b].includes(k)); if (extra) err(`unexpected key: ${b}.${extra}`); }
```

4. Line 19 takes the version ceiling from the module, and the post-parse cap lands on the next line, after `snap.v` has been validated so `POST_PARSE_MAX[snap.v]` is always defined. Replace line 19:

```js
if (typeof snap.v !== 'number' || !Number.isInteger(snap.v) || snap.v < 1) err('v must be a positive integer'); if (snap.v > 2) err('SNAP_UNKNOWN_VERSION');
```

with:

```js
if (typeof snap.v !== 'number' || !Number.isInteger(snap.v) || snap.v < 1) err('v must be a positive integer'); if (snap.v > MAX_VERSION) err('SNAP_UNKNOWN_VERSION');
if (raw.length > POST_PARSE_MAX[snap.v]) err(`payload too large: ${raw.length} > ${POST_PARSE_MAX[snap.v]} (v${snap.v} cap)`);
```

5. Delete line 21 (`const caps = { 'ops.n': [3, 200], ... };`) and change the loop head on line 22 to iterate the imported table:

```js
for (const [key, [cap, elemCap]] of Object.entries(CAPS)) {
```

The size check keeps using `raw.length`, not `trimmed.length`, so the v1 boundary stays exactly where the spec's characterization measured it: 4096 accepted, 4097 rejected.

- [X] [T-001-F] Verify the 32-line cap still holds

Run: `npx vitest run tests/unit/snap-validate.test.js -t "32-line hard cap"`
Expected: PASS. Net line change is zero: one line added for the pre-parse split, one for the post-parse cap, one removed for `const allow`, one removed for `const caps`, and the import packed onto line 1.

If it fails, do **not** edit the cap. Pack `process.exit(0)` onto the preceding line, the style the file already uses on lines 3, 7, 19 and 31, and re-run.

- [X] [T-001-G] Run the validator suite

Run: `npx vitest run tests/unit/snap-validate.test.js`
Expected: PASS, 52 + 9 = **61 cases** in this file.

- [X] [T-001-H] Run the full suite

Run: `npx vitest run`
Expected: **825 passed, 12 skipped**, 31 files.

- [X] [T-001-I] Commit

```bash
git add scripts/snap-contract.mjs scripts/snap-validate.mjs tests/unit/snap-validate.test.js
git commit -m "$(cat <<'EOF'
fix: split the handoff size check into two version-aware tiers [BUG-038]

The validator capped every payload at 4096 characters one line before
JSON.parse, so it could not branch on snap.v and every v2 snapshot
carrying checkpoint prose was written, stored and then discarded.

A hard 10 MiB pre-parse ceiling keeps an unbounded file out of the
parser; the version-specific cap applies after the version is known,
with v1 keeping its 4096-character context budget under its own name.
The new scripts/snap-contract.mjs owns both values, the array caps,
both field sets and the version ceiling.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HLS5KAHkhpMChyqNTbqrhe
EOF
)"
```

**Predicted state at the T-001 boundary: 825 passed, 12 skipped, 31 files.**

---

## Task 2: The writer and the store consume the same contract

**Files:**
- Modify: `scripts/snap-build.mjs:3-5,51-52`, `scripts/conductor-db.mjs:27`
- Modify: `tests/scripts/conductor-db.test.js:286,306` (pre-declared touch, Risk 1)
- Test: `tests/unit/snap-contract.test.js` (create)

**Interfaces:**
- Consumes: every export from Task 1's `scripts/snap-contract.mjs`.
- Produces: no new symbols. `snap-build.mjs` keeps its stdin/stdout interface and `conductor-db.mjs` keeps its argv interface unchanged.

- [X] [T-002-A] Write the failing contract-parity tests

Create `tests/unit/snap-contract.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CAPS, MAX_VERSION, POST_PARSE_MAX, PRE_PARSE_MAX_BYTES, V1_MAX_CHARS } from '../../scripts/snap-contract.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const src = (rel) => readFileSync(resolve(REPO_ROOT, rel), 'utf8')
const CONSUMERS = ['scripts/snap-build.mjs', 'scripts/snap-validate.mjs', 'scripts/conductor-db.mjs']

describe('snap-contract.mjs', () => {
  it('is the only file spelling a handoff limit as a literal', () => {
    // Both spellings of 10 MiB and the bare 4096 live here and nowhere else.
    for (const rel of CONSUMERS) {
      const text = src(rel)
      expect(text).not.toContain('10485760')
      expect(text).not.toContain('10 * 1024 * 1024')
      expect(text).not.toMatch(/\b4096\b/)
    }
    const contract = src('scripts/snap-contract.mjs')
    expect(contract).toContain('10485760')
    expect(contract).toContain('4096')
    expect(contract).not.toContain('10 * 1024 * 1024')
  })

  it('is imported by all three consumers', () => {
    for (const rel of CONSUMERS) {
      expect(src(rel)).toContain("from './snap-contract.mjs'")
    }
  })

  it('holds the array caps as one table in one key scheme', () => {
    expect(Object.keys(CAPS)).toEqual(['ops.n', 'ops.f', 'mem.d', 'mem.x'])
    // The leaf-keyed duplicate is what made the old drift invisible to any diff.
    expect(src('scripts/snap-build.mjs')).not.toMatch(/CAPS = \{/)
    expect(src('scripts/snap-validate.mjs')).not.toMatch(/caps = \{/)
  })

  it('the writer normalizes against the same caps the validator rejects against', () => {
    // 4 pending items with a cap of 3: the writer must head-drop to exactly the
    // count the validator would otherwise reject.
    const [countCap] = CAPS['ops.n']
    const input = JSON.stringify({
      ph: 'plan', c: 'abc1234', s: 'spec-stem',
      n: ['one', 'two', 'three', 'four'], f: [], d: [], x: [],
    })
    const r = spawnSync(process.execPath, [resolve(REPO_ROOT, 'scripts/snap-build.mjs')],
      { input, encoding: 'utf8' })
    expect(r.status).toBe(0)
    const built = JSON.parse(r.stdout.trim())
    expect(built.ops.n.length).toBe(countCap)
    expect(built.ops.n[0]).toBe('two') // oldest dropped from the head
  })

  it('pins both tiers and the version ceiling to single values', () => {
    expect(PRE_PARSE_MAX_BYTES).toBe(10485760)
    expect(V1_MAX_CHARS).toBe(4096)
    expect(POST_PARSE_MAX[1]).toBe(V1_MAX_CHARS)
    expect(POST_PARSE_MAX[2]).toBe(PRE_PARSE_MAX_BYTES)
    expect(MAX_VERSION).toBe(2)
    expect(Object.keys(POST_PARSE_MAX).map(Number)).toEqual([1, MAX_VERSION])
  })
})
```

- [X] [T-002-B] Run the new file and confirm it fails

Run: `npx vitest run tests/unit/snap-contract.test.js`
Expected: FAIL on the literal and import assertions for `snap-build.mjs` and `conductor-db.mjs` (both still carry their own constants).

- [X] [T-002-C] Point snap-build at the contract

Modify `scripts/snap-build.mjs`. Replace lines 3-5:

```js
const MAX_SNAP_BYTES = 10485760;          // 10 MiB (v2)
const V1_MAX_CHARS = 4096;                // handoff-file contract (v1)
const CAPS = { n: [3, 200], f: [20, 300], d: [10, 300], x: [5, 200] };
```

with one import line placed directly under the existing `node:fs` import:

```js
import { CAPS, PRE_PARSE_MAX_BYTES as MAX_SNAP_BYTES, V1_MAX_CHARS } from './snap-contract.mjs';
```

Then re-key the four call sites at lines 51-52 to the dotted scheme:

```js
const ops = { n: normArray(obj.n, CAPS['ops.n']), f: normArray(obj.f, CAPS['ops.f']) };
const mem = { d: normArray(obj.d, CAPS['mem.d']), x: normArray(obj.x, CAPS['mem.x']) };
```

Nothing else in the file changes: `MAX_SNAP_BYTES` and `V1_MAX_CHARS` keep their names and every use site is untouched.

- [X] [T-002-D] Point conductor-db at the contract

Modify `scripts/conductor-db.mjs`. Delete line 27:

```js
const MAX_SNAP_BYTES = 10 * 1024 * 1024;   // 10 MiB
```

and add to the import block after line 17:

```js
import { PRE_PARSE_MAX_BYTES as MAX_SNAP_BYTES } from './snap-contract.mjs';
```

The alias keeps `cmdSnapshot`'s two use sites (`:447`, `:449`) and its `10 MiB` warning text byte-identical.

- [X] [T-002-E] Repair the two isolated-copy fixtures

Modify `tests/scripts/conductor-db.test.js`. Both `Fallback B` cases copy `conductor-db.mjs` alone into a tree with no sibling, which now fails at module resolution rather than at the behavior under test. Add the sibling to each fixture, immediately after the existing `cpSync` line at `:286` and at `:306`:

```js
      cpSync(CONTRACT, join(scriptsDir, 'snap-contract.mjs'));
```

and declare `CONTRACT` next to `SCRIPT` at the top of the file:

```js
const CONTRACT = fileURLToPath(new URL('../../scripts/snap-contract.mjs', import.meta.url));
```

**Classification, recorded here so it is not re-litigated at execution time:** this is a **fixture completeness repair, not an assertion adjustment**. Neither `expect` in either case changes; the tree the fixture builds simply gains the sibling the deployed layout has always shipped (the installer copies `scripts/` wholesale at `lib/installer/deploy.mjs:190`). The single-file copy was an artifact of the script having had no siblings, and the assertion it guards, that root resolution lands the DB at `tree/.conductor/cache.db`, is untouched and exactly as strong. If the reviewer disagrees, the alternative is to leave `conductor-db.mjs` carrying its own `10 * 1024 * 1024`, which forfeits acceptance criteria 6 and 7.

- [X] [T-002-F] Run the three affected suites

Run: `npx vitest run tests/unit/snap-contract.test.js tests/scripts/snap-build.test.js tests/scripts/conductor-db.test.js`
Expected: PASS. `snap-contract.test.js` 5 cases, `snap-build.test.js` unchanged, `conductor-db.test.js` 74 unchanged.

- [X] [T-002-G] Run the full suite

Run: `npx vitest run`
Expected: **830 passed, 12 skipped**, 32 files.

- [X] [T-002-H] Commit

```bash
git add scripts/snap-build.mjs scripts/conductor-db.mjs tests/unit/snap-contract.test.js tests/scripts/conductor-db.test.js
git commit -m "$(cat <<'EOF'
fix: writer and store resolve handoff limits from the contract [BUG-038]

10485760 and 10 * 1024 * 1024 were two spellings of one number that
agreed only because the arithmetic happened to match, and the array
caps held identical values in two key schemes, leaf and dotted path,
so no diff could pair them. All three consumers now import one table.

The two conductor-db root-resolution fixtures copy the contract
sibling alongside the script. No assertion changes: the fixture tree
gains the file the deployed layout has always shipped.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HLS5KAHkhpMChyqNTbqrhe
EOF
)"
```

**Predicted state at the T-002 boundary: 830 passed, 12 skipped, 32 files.**

---

## Task 3: Under-informative degrade becomes loud degrade

**Files:**
- Modify: `scripts/resume-read.mjs:61-64,77-85,100-102,141-149`
- Test: `tests/scripts/resume-read.test.js`

**Interfaces:**
- Consumes: the validator's stderr, which after Task 1 names the size case with its observed size and the cap applied.
- Produces: `validateFile(p)` and `validateBlob(blob)` return `{ ok: boolean, reason: string }` instead of a bare boolean. Both are file-local.

- [X] [T-003-A] Write the failing tests

Append to `tests/scripts/resume-read.test.js`, inside the `describe('resume-read.mjs DB branch', ...)` block for the first two and inside the core `describe` for the third:

```js
  it.skipIf(!sqliteAvailable())('an oversize v1 blob degrades LOUDLY: reason, size, cap, exit 3', () => {
    const { dir, head } = mkRepo();
    // v1 over its 4096-character budget: valid JSON, valid schema, too large.
    const pad = (n) => 'x'.repeat(n);
    const big = {
      v: 1, sys: { ph: 'plan', c: head, s: 'my-spec' },
      ops: { n: [pad(200), pad(200), pad(200)], f: [] },
      mem: { d: Array.from({ length: 10 }, () => pad(300)), x: Array.from({ length: 5 }, () => pad(200)) },
    };
    expect(JSON.stringify(big).length).toBeGreaterThan(4096);
    dbStore(dir, head, big);
    const r = run(dir);
    expect(r.status).toBe(3);                 // fail-open stays fail-open
    expect(r.stdout).toBe('');
    const log = readFileSync(join(dir, '.conductor', 'last-write.log'), 'utf8');
    expect(log).toMatch(/resume: db-invalid degrade: .*payload too large/);
    expect(log).toContain('4096');            // the cap applied
    expect(log).toMatch(/payload too large: \d+ >/);  // the observed size
  });

  it.skipIf(!sqliteAvailable())('names the reason for a schema-invalid DB blob', () => {
    const { dir, head } = mkRepo();
    dbStore(dir, head, { v: 1, sys: { ph: 'nope', c: head, s: 'my-spec' }, ops: { n: [], f: [] }, mem: { d: [], x: [] } });
    const r = run(dir);
    expect(r.status).toBe(3);
    const log = readFileSync(join(dir, '.conductor', 'last-write.log'), 'utf8');
    expect(log).toMatch(/resume: db-invalid degrade: .*ph must be spec\|plan\|impl\|rev/);
  });
```

and, in the core file-branch `describe`:

```js
  it('names the reason when the handoff file is rejected (exit 4 unchanged)', () => {
    const { dir } = mkRepo();
    writeFileSync(join(dir, HANDOFF_REL), '{"v":1,"sys":{"ph":"impl"}}\n', 'utf8');
    const r = run(dir);
    expect(r.status).toBe(4);                 // halt semantics unchanged
    expect(existsSync(join(dir, HANDOFF_REL))).toBe(true);
    const log = readFileSync(join(dir, '.conductor', 'last-write.log'), 'utf8');
    expect(log).toMatch(/resume: file-invalid halt: SNAP_ERROR: missing: /);
  });
```

- [X] [T-003-B] Run them and confirm they fail

Run: `npx vitest run tests/scripts/resume-read.test.js`
Expected: FAIL. The trace lines read `resume: db-invalid degrade` and `resume: file-invalid halt` with no reason appended.

- [X] [T-003-C] Carry the validator's reason through

Modify `scripts/resume-read.mjs`.

Replace `validateFile` (lines 60-64):

```js
// Validate an existing file path via snap-validate. Returns the verdict AND the
// validator's own reason, so a degrade can name what was wrong (BUG-038).
function validateFile(p) {
  const r = spawnSync(process.execPath, [VALIDATE, p], { encoding: 'utf8', env: process.env });
  return { ok: r.status === 0, reason: reasonOf(r) };
}
```

Add the shared extractor directly above it:

```js
// snap-validate writes one `SNAP_ERROR: ...` line per rejection; the first is the cause.
function reasonOf(r) {
  const first = String(r.stderr || '').trim().split('\n')[0];
  return first || ('validator exit ' + r.status);
}
```

Replace the body of `validateBlob` (lines 81-85):

```js
  try {
    const r = spawnSync(process.execPath, [VALIDATE, tmp], { encoding: 'utf8', env: process.env });
    return { ok: r.status === 0, reason: reasonOf(r) };
  } finally { tryUnlink(tmp); }
```

and its write-failure guard on line 80:

```js
  catch { return { ok: false, reason: 'temp write failed' }; } // FS write error, blob unusable
```

Update the DB call sites (lines 100-102):

```js
  const verdict = validateBlob(blob);
  if (!verdict.ok) { trace('db-invalid degrade: ' + verdict.reason); return null; }
  const snap = parseJson(blob);
  if (snap === undefined) { trace('db-invalid degrade: unparseable after validation'); return null; }
```

and the two earlier DB fall-throughs, which report nothing at all today:

```js
  const flags = probeSqliteFlags();
  if (flags === null) { trace('db-unavailable degrade: node:sqlite absent'); return null; }
```

```js
  if (r.status !== 0) { trace('db-query degrade: get-snapshot exit ' + r.status); return null; }
  if (!r.stdout) return null; // no row for this hash is an ordinary miss, not a rejection
```

Update the file-branch sites (lines 144-149):

```js
  catch (e) { trace('file-unreadable degrade: ' + ((e && e.code) || 'unknown')); return { code: 3, out: '' }; } // leave file on disk
  if (content.trim() === '') { trace('file-empty degrade'); tryUnlink(HANDOFF); return { code: 3, out: '' }; }
  const fileVerdict = validateFile(HANDOFF);
  if (!fileVerdict.ok) { trace('file-invalid halt: ' + fileVerdict.reason); return { code: 4, out: '' }; } // leave on disk
  const snap = parseJson(content);
  if (snap === undefined) { trace('file-invalid halt: unparseable after validation'); return { code: 4, out: '' }; }
  if (snap.sys.c !== hash) { trace('file-stale-hash degrade: ' + snap.sys.c + ' != ' + hash); tryUnlink(HANDOFF); return { code: 3, out: '' }; }
```

No exit code anywhere in this file changes. The degrade stays a degrade and the halt stays a halt; only the trace gains its cause.

- [X] [T-003-D] Confirm the Node-14 syntax pin still holds

Run: `npx vitest run tests/scripts/resume-read.test.js -t "Node-14-compatible"`
Expected: PASS. The new code uses `||` and `String()`, never `??=`, `||=`, `.at(` or `structuredClone`.

- [X] [T-003-E] Run the suite

Run: `npx vitest run`
Expected: **833 passed, 12 skipped**, 32 files.

- [X] [T-003-F] Commit

```bash
git add scripts/resume-read.mjs tests/scripts/resume-read.test.js
git commit -m "$(cat <<'EOF'
fix: every resume-read degrade names its reason [BUG-038]

The reader was not silent, it was under-informative: it logged
`db-invalid degrade` and withheld the cause, and rc 3 means clean
miss, so a developer saw an ordinary fresh start. The validator
already knows why it rejected a blob; that reason now reaches the
trace line, with the observed size against the cap applied for the
size case.

Fail-open is correct for a cache, so the degrade and the exit code
are unchanged. Only the silence about why is gone.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HLS5KAHkhpMChyqNTbqrhe
EOF
)"
```

**Predicted state at the T-003 boundary: 833 passed, 12 skipped, 32 files.**

---

## Task 4: The phase is written by the component that owns it

**Files:**
- Modify: `global/commands/cc-compact.md:38-42`
- Modify: `.claude/commands/cc-plan.md` (append after line 227), `project-template/.claude/commands/cc-plan.md`
- Modify: `.claude/commands/cc-implement.md` (append after line 164), `project-template/.claude/commands/cc-implement.md`
- Test: `tests/installer/commands-parity.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks. These are agent instructions, not code.
- Produces: the marker pair `<!-- SESSION-ROW-TAIL:BEGIN -->` / `<!-- SESSION-ROW-TAIL:END -->` delimiting one canonical block in each of the three commands. Task 5's end-to-end test reads the phase literal out of `.claude/commands/cc-plan.md` through these markers.

- [X] [T-004-A] Write the failing parity tests

Append to `tests/installer/commands-parity.test.js`:

```js
const IMPL_MIRRORS = ['.claude/commands/cc-implement.md', 'project-template/.claude/commands/cc-implement.md'];

describe('cc-implement mirrors', () => {
  it('differ only in the script path nesting', () => {
    expect(unnest(read(IMPL_MIRRORS[1]))).toBe(read(IMPL_MIRRORS[0]));
  });
});

// One canonical fail-open session-row tail, instantiated three times. The block is
// delimited by markers so the comparison is mechanical rather than a prose diff.
const TAIL_BEGIN = '<!-- SESSION-ROW-TAIL:BEGIN -->';
const TAIL_END = '<!-- SESSION-ROW-TAIL:END -->';
const TAIL_SOURCES = [
  ['global/commands/cc-compact.md', '$ph'],
  ['.claude/commands/cc-plan.md', 'plan'],
  ['.claude/commands/cc-implement.md', 'impl'],
];

function tailOf(rel) {
  const text = unnest(read(rel));
  const a = text.indexOf(TAIL_BEGIN);
  const b = text.indexOf(TAIL_END);
  expect(a, `${rel} carries the tail begin marker`).toBeGreaterThan(-1);
  expect(b, `${rel} carries the tail end marker`).toBeGreaterThan(a);
  return text.slice(a + TAIL_BEGIN.length, b);
}

describe('the fail-open session-row tail', () => {
  it.each(TAIL_SOURCES)('%s writes the session row with phase %s', (rel, phase) => {
    expect(tailOf(rel)).toContain(`conductor-db.mjs session "$id" "${phase}" "$s" "$c"`);
  });

  it.each(TAIL_SOURCES)('%s degrades loudly when the row is not written', (rel) => {
    const tail = tailOf(rel);
    expect(tail).toContain('CC_DB_TAIL: session row not written');
    expect(tail).toContain('non-fatal');
  });

  it('the three tails agree in everything but the phase literal', () => {
    const normalized = TAIL_SOURCES.map(([rel]) =>
      tailOf(rel).replace(/session "\$id" "[^"]+"/, 'session "$id" "<PHASE>"'));
    expect(normalized[1]).toBe(normalized[0]);
    expect(normalized[2]).toBe(normalized[0]);
  });

  it.each([...PLAN_MIRRORS, ...IMPL_MIRRORS])('%s carries the tail in both mirrors', (rel) => {
    expect(read(rel)).toContain(TAIL_BEGIN);
  });

  it('leaves cc-checkpoint deriving its phase by carry-forward', () => {
    // The carry-forward was never wrong; it was reading a record nobody wrote.
    const text = read('global/commands/cc-checkpoint.md');
    expect(text).toContain('Derive `ph` by carry-forward');
    expect(text).not.toContain(TAIL_BEGIN);
  });
});
```

Rename the existing `MIRRORS` constant to `PLAN_MIRRORS` at its declaration (`tests/installer/commands-parity.test.js:19`) and at its four use sites inside `describe('cc-plan mirrors', ...)`. This is a mechanical rename for readability now that a second mirror pair exists; no assertion changes.

- [X] [T-004-B] Run them and confirm they fail

Run: `npx vitest run tests/installer/commands-parity.test.js`
Expected: FAIL. Every `tailOf` call fails on the missing begin marker. `cc-implement mirrors` passes already, since the two files differ only in the nesting `unnest` reverses.

- [X] [T-004-C] Extract the tail in cc-compact

Modify `global/commands/cc-compact.md`. Replace lines 38-42 (steps 1 through 3 of the existing tail) with the marked canonical block, leaving step 4 (the snapshot row) and line 47's closing paragraph where they are:

```markdown
<!-- SESSION-ROW-TAIL:BEGIN -->
**Preconditions.** `c` is the full-40 `git rev-parse HEAD`, lowercased, matching `/^[0-9a-f]{7,40}$/`, `"0000000"` on any failure; `s` is the active spec stem or `"none"`. Both are derived exactly as this command's body already specifies.

1. Ensure `.conductor/` exists (`mkdir -p .conductor`, best-effort). If that fails, skip the tail entirely.
2. Resolve the session id: `id="$(node .claude/scripts/session-id.mjs 2>>.conductor/last-write.log)"`.
3. Probe how to launch `node:sqlite`, the same probe the `cc-implement` Step 6 hook runs: no flag first, else `--experimental-sqlite --no-warnings`, else skip the write.
4. Upsert the session row. Every argv scalar is double-quoted, because a repository path can contain spaces:

   `node <probe-flags> .claude/scripts/conductor-db.mjs session "$id" "$ph" "$s" "$c" >> .conductor/last-write.log 2>&1`
5. **Loud degrade.** If the probe skipped the write, or the write exited non-zero, append one line naming the reason:

   `printf '%s\n' "CC_DB_TAIL: session row not written (<reason>)" >> .conductor/last-write.log`

   A row that is simply absent is the shape that let the recorded phase go stale across two boundaries unnoticed. The absence is always reported.

Every redirect uses append mode (`>>`), never `>`, so a rapid or parallel second run never truncates a preceding trace. Any failure in this block is **non-fatal**: the command reports its normal outcome regardless.

**Cross-platform note.** The forms above are Unix-canonical; the `.md` file is an agent instruction, not a literal script. On Windows/PowerShell realize the same semantics: set `$OutputEncoding = [System.Text.UTF8Encoding]::new($false)` first, capture `$id = node .claude/scripts/session-id.mjs`, and append the log with `… 2>&1 | Out-File -Append -Encoding utf8 .conductor/last-write.log`, never the bare `*>>`, whose default encoding is UTF-16LE on PS 5.1 and would corrupt the trace. Ensure the directory with `New-Item -ItemType Directory -Force .conductor`.
<!-- SESSION-ROW-TAIL:END -->
```

Renumber the surviving snapshot step from `4.` to `6.` and keep its text verbatim.

- [X] [T-004-D] Add the tail to cc-plan (source mirror)

Modify `.claude/commands/cc-plan.md`. Append after line 227, as a new section:

```markdown

---

## Phase exit - session row

The plan phase has completed, which is the only moment at which "phase `plan` just
finished" is a fact rather than a deduction. Write it here, at its own boundary.
Run this after step 7's exit instruction has been printed.
```

followed by the block from T-004-C verbatim, with two substitutions and nothing else:
- `"$ph"` becomes `"plan"` on the `session` command line;
- every `node .claude/scripts/` becomes `node scripts/` (the source mirror's un-nested path form).

- [X] [T-004-E] Add the tail to cc-implement (source mirror)

Modify `.claude/commands/cc-implement.md`. Append after line 164, as a new section:

```markdown

---

## Phase exit - session row

Step 1 returned no `[ ]` match at `offset = 0`, so every task is complete and the
implementation phase has finished. Write that fact here, at its own boundary, after
the completion summary has been output.
```

followed by the same block, with `"impl"` as the phase literal and the same un-nested paths.

- [X] [T-004-F] Regenerate both template mirrors

Modify `project-template/.claude/commands/cc-plan.md` and `project-template/.claude/commands/cc-implement.md`: append the identical sections with the nested path form, `node .claude/scripts/`, which is the exact inverse of the `unnest` transform the parity test applies.

- [X] [T-004-G] Run the parity suite

Run: `npx vitest run tests/installer/commands-parity.test.js`
Expected: PASS, 17 + 13 = **30 cases** in this file. The 13 break down as: 1 mirror-nesting case, 3 phase-literal cases, 3 loud-degrade cases, 1 three-way agreement case, 4 both-mirrors-carry-the-block cases, 1 cc-checkpoint-unchanged case.

- [X] [T-004-H] Run the full suite

Run: `npx vitest run`
Expected: **846 passed, 12 skipped**, 32 files.

- [X] [T-004-I] Commit

```bash
git add global/commands/cc-compact.md .claude/commands/cc-plan.md .claude/commands/cc-implement.md project-template/.claude/commands/cc-plan.md project-template/.claude/commands/cc-implement.md tests/installer/commands-parity.test.js
git commit -m "$(cat <<'EOF'
fix: each phase boundary writes its own session row [BUG-038]

cc-compact was the only command that DETERMINED a phase, so the
newest session row at checkpoint time was whatever the last
compaction left, two boundaries stale after a plan and an
implementation. cc-plan and cc-implement now each write the phase
they just finished, and cc-checkpoint's carry-forward is left alone:
it was never wrong, it was reading a record nobody had written.

The tail is one marker-delimited block instantiated three times, and
the parity suite asserts the three agree in everything but the phase
literal. Three hand-maintained copies of fail-open prose would be the
same drift surface the contract module exists to prevent.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HLS5KAHkhpMChyqNTbqrhe
EOF
)"
```

**Predicted state at the T-004 boundary: 846 passed, 12 skipped, 32 files.**

---

## Task 5: The end-to-end handoff cycle

**Files:**
- Test: `tests/scripts/handoff-cycle.test.js` (create)

**Interfaces:**
- Consumes: Task 1's two-tier validator, Task 2's shared contract, Task 3's reason lines, Task 4's marker block (the phase literal is read out of the command file, not hand-copied).
- Produces: nothing importable. This is the criterion that spans both halves.

- [X] [T-005-A] Write the cycle test

Create `tests/scripts/handoff-cycle.test.js`:

```js
// The criterion that spans both halves of BUG-038: a plan-boundary session row,
// a checkpoint carry-forward, a v2 snapshot too large for the old cap, and a
// resume read that reports the phase the boundary actually wrote.
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sqliteAvailable, dbFlags } from '../helpers/sqlite.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DB = join(REPO_ROOT, 'scripts/conductor-db.mjs');
const BUILD = join(REPO_ROOT, 'scripts/snap-build.mjs');
const RESUME = join(REPO_ROOT, 'scripts/resume-read.mjs');

// The phase literals come from the command files, so a doc edit cannot silently
// drift from the behavior this test asserts.
function phaseFromTail(rel) {
  const text = readFileSync(join(REPO_ROOT, rel), 'utf8');
  const a = text.indexOf('<!-- SESSION-ROW-TAIL:BEGIN -->');
  const b = text.indexOf('<!-- SESSION-ROW-TAIL:END -->');
  const m = /conductor-db\.mjs session "\$id" "([^"]+)"/.exec(text.slice(a, b));
  return m && m[1];
}

const trees = [];
afterEach(() => { while (trees.length) { try { rmSync(trees.pop(), { recursive: true, force: true }); } catch {} } });

function mkRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'cycle-'));
  trees.push(dir);
  const g = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  g(['init', '-q']);
  g(['config', 'user.email', 't@t.t']);
  g(['config', 'user.name', 'T']);
  writeFileSync(join(dir, 'f'), 'x', 'utf8');
  writeFileSync(join(dir, '.gitignore'), '.conductor/\n', 'utf8');
  g(['add', '.']);
  g(['commit', '-q', '-m', 'init']);
  mkdirSync(join(dir, '.claude', 'memory'), { recursive: true });
  return { dir, head: g(['rev-parse', 'HEAD']).trim() };
}

const db = (dir, args, input) =>
  spawnSync(process.execPath, dbFlags().concat([DB, ...args]),
    { cwd: dir, input, encoding: 'utf8', env: process.env });

describe.skipIf(!sqliteAvailable())('the checkpoint-to-resume handoff cycle', () => {
  it('resumes the phase the boundary wrote, through a blob the old cap discarded', () => {
    const { dir, head } = mkRepo();
    const planPhase = phaseFromTail('.claude/commands/cc-plan.md');
    expect(planPhase).toBe('plan');

    // 1. The plan boundary writes its own session row (Task 4's tail).
    expect(db(dir, ['session', 'sess-1', planPhase, 'my-spec', head]).status).toBe(0);

    // 2. The checkpoint carry-forward reads the newest row.
    const got = db(dir, ['get-session', 'sess-1']);
    expect(got.status).toBe(0);
    expect(JSON.parse(got.stdout).phase).toBe(planPhase);

    // 3. It builds a v2 blob whose prose is far past the old 4096 cap.
    const prose = '## Checkpoint\n' + 'decision line\n'.repeat(500);
    const built = spawnSync(process.execPath, [BUILD], {
      input: JSON.stringify({ ph: planPhase, c: head, s: 'my-spec', n: ['next'], f: [], d: [], x: [], pr: prose }),
      encoding: 'utf8',
    });
    expect(built.status).toBe(0);
    const blob = built.stdout.trim();
    expect(blob.length).toBeGreaterThan(4096);
    expect(db(dir, ['snapshot', head], blob).status).toBe(0);

    // 4. The next phase entry resumes it instead of discarding it.
    const r = spawnSync(process.execPath, [RESUME], { cwd: dir, encoding: 'utf8', env: process.env });
    expect(r.status).toBe(0);
    const lines = r.stdout.split('\n');
    expect(lines[0]).toBe('RESUME_HIT');
    expect(lines).toContain('source: db');
    expect(lines).toContain(`phase: ${planPhase}`);
    expect(lines).toContain('version: 2');
    expect(lines).toContain('prose: available');
  });

  it('records the phase that just completed, not the one the last compaction left', () => {
    const { dir, head } = mkRepo();
    const implPhase = phaseFromTail('.claude/commands/cc-implement.md');
    expect(implPhase).toBe('impl');
    // spec (compact), then plan (the new tail), then impl (the new tail).
    db(dir, ['session', 'sess-2', 'spec', 'my-spec', head]);
    db(dir, ['session', 'sess-2', 'plan', 'my-spec', head]);
    db(dir, ['session', 'sess-2', implPhase, 'my-spec', head]);
    const got = db(dir, ['get-session', 'sess-2']);
    expect(JSON.parse(got.stdout).phase).toBe(implPhase);
  });

  it('survives a DB write failure at the boundary: no row, no crash, exit 0', () => {
    const { dir, head } = mkRepo();
    // An unwritable .conductor is the realistic tail failure; conductor-db is
    // fail-open by contract and must still exit 0 with its CONDUCTOR_DB: line.
    const r = db(dir, ['session', 'sess-3', 'plan', 'my-spec', 'NOT-A-HASH']);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('CONDUCTOR_DB:');
    const got = db(dir, ['get-session', 'sess-3']);
    expect(got.stdout).toBe('');   // the row really is absent
    expect(head).toMatch(/^[0-9a-f]{40}$/);
  });
});
```

- [X] [T-005-B] Run the new file

Run: `npx vitest run tests/scripts/handoff-cycle.test.js`
Expected: PASS, 3 cases. Every dependency is already in place after Tasks 1 through 4; this file is the criterion, not a driver of new production code. If the first case fails at step 4 with exit 3, the two-tier cap did not land: re-check `POST_PARSE_MAX[2]`.

- [X] [T-005-C] Run the full suite

Run: `npx vitest run`
Expected: **849 passed, 12 skipped**, 33 files.

- [X] [T-005-D] Commit

```bash
git add tests/scripts/handoff-cycle.test.js
git commit -m "$(cat <<'EOF'
test: the end-to-end checkpoint-to-resume handoff cycle [BUG-038]

One cycle exercises both halves: the plan boundary writes its phase,
the carry-forward reads it, a v2 blob far past the old 4096 cap is
stored, and the resume read reports the phase the boundary wrote
instead of degrading. The phase literals are read out of the command
files, so a doc edit cannot drift from what this asserts.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HLS5KAHkhpMChyqNTbqrhe
EOF
)"
```

**Predicted state at the T-005 boundary: 849 passed, 12 skipped, 33 files.**

---

## Task 6: Release 1.31.0 and land the record

**Files:**
- Modify: `package.json:3`, `CHANGELOG.md`, `README.md:317-318`
- Modify: `.claude/memory/project.md`, `AGENT-READABLE BACKLOG.md`

- [X] [T-006-A] Bump the version

Modify `package.json:3`: `"version": "1.30.0"` becomes `"version": "1.31.0"`.

- [X] [T-006-B] Add the CHANGELOG entry

Insert above the `## [1.30.0]` heading in `CHANGELOG.md`:

```markdown
## [1.31.0] - 2026-09-27

### Fixed
- `[BUG-038]` `scripts/snap-validate.mjs`: the payload size check ran one line before `JSON.parse`, so it could not branch on `snap.v` and capped every version at 4096 characters. Every v2 snapshot carrying checkpoint prose was written, stored and then discarded by the resume read. The check is now two tiers: a hard 10 MiB pre-parse ceiling, then the version-specific cap once the version is known. v1 keeps its 4096-character context budget under its own name.
- `[BUG-038]` `scripts/resume-read.mjs`: every degrade and halt names its reason on `.conductor/last-write.log`, and the size case names the observed size against the cap applied. Exit codes and fail-open behavior are unchanged.
- `[BUG-038]` `/cc-plan` and `/cc-implement`: each writes a session row at its own boundary, so `/cc-checkpoint`'s carry-forward stops reporting a phase two boundaries stale. The carry-forward itself is unchanged.

### Added
- `[BUG-038]` `scripts/snap-contract.mjs`: one module owning the pre-parse ceiling, the per-version caps, the array caps in a single key scheme, both field-set allow-lists and the version ceiling. `snap-build.mjs`, `snap-validate.mjs` and `conductor-db.mjs` all import from it, and a test asserts the three resolve the same values.
- `[BUG-038]` `tests/scripts/handoff-cycle.test.js`: the end-to-end cycle, with the phase literals read out of the command files.
```

- [X] [T-006-C] Add the module to the README script tree

Modify `README.md`. Insert above the `snap-build.mjs` line at `:317`:

```
│   ├── snap-contract.mjs         SNAP limits, caps, field sets, version ceiling
```

- [X] [T-006-D] Run the full suite one last time

Run: `npx vitest run`
Expected: **849 passed, 12 skipped**, 33 files. Unchanged from T-005: this task adds no tests.

- [X] [T-006-E] Commit the release

```bash
git add package.json CHANGELOG.md README.md
git commit -m "$(cat <<'EOF'
chore: release 1.31.0 [BUG-038]

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HLS5KAHkhpMChyqNTbqrhe
EOF
)"
```

- [X] [T-006-F] Write the archetype paragraph into project memory

Append to `.claude/memory/project.md` a conventions paragraph titled **success semantics on failure paths**, naming its four instances: Guard 4 printing a block while exiting 1 (`[BUG-036]`), `git add` exiting 1 on a successful stage (`[BUG-040]`), the clean-miss resume that reported rc 3 for a rejected blob (`[BUG-038]`, fixed here), and `add_rc=1` under `.claude/`. Close with the standing instruction to grep for the fifth proactively rather than waiting for it to surface.

Append the BUG-038 implementation summary in the same commit.

- [X] [T-006-G] Close the backlog entry

Modify `AGENT-READABLE BACKLOG.md`: flip `[BUG-038]`'s checkbox to `[X]` as a surgical single-line edit and add a DONE bullet naming the release, the plan path and the task count. Both this and T-006-F land on `main` under the owner-scoped memory-and-backlog exception, not on the feature branch.

---

## Test List

- [ ] `tests/unit/snap-validate.test.js` +9: v2 over 4096 accepted; v1 over 4096 rejected naming the v1 cap; over the pre-parse ceiling rejected unparsed; v2 `pr` with newlines accepted; encoding error; internal newline; top-level field set from the module; block field sets from the module; version ceiling tracks the module.
- [ ] `tests/unit/snap-contract.test.js` +5 (new file): no consumer spells a handoff limit; all three import the module; one cap table in one key scheme; the writer normalizes against the caps the validator rejects against; both tiers and the ceiling pinned.
- [ ] `tests/scripts/resume-read.test.js` +3: oversize v1 blob degrades loudly and still exits 3; schema-invalid blob names its reason; rejected handoff file names its reason and still exits 4.
- [ ] `tests/installer/commands-parity.test.js` +13: cc-implement mirrors differ only in nesting (1); the three tails carry the session write with their own phase literal (3); the three tails carry the loud-degrade line (3); the three agree modulo the phase literal (1); all four cc-plan and cc-implement mirrors carry the block (4); cc-checkpoint still derives by carry-forward and carries no block (1).
- [ ] `tests/scripts/handoff-cycle.test.js` +3 (new file): the full cycle; the phase that just completed wins; a DB write failure is non-fatal and leaves no row.
- [ ] `tests/scripts/conductor-db.test.js` 0 new, 2 fixtures repaired (Risk 1).

Integration seam: the cycle test is the integration test. No UI, so no E2E.

## Commit Order

| Commit | Steps | Subject |
|---|---|---|
| 1 | T-000-A..B | `docs: add the BUG-038 handoff-contract implementation plan` |
| 2 | T-001-A..I | `fix: split the handoff size check into two version-aware tiers [BUG-038]` |
| 3 | T-002-A..H | `fix: writer and store resolve handoff limits from the contract [BUG-038]` |
| 4 | T-003-A..F | `fix: every resume-read degrade names its reason [BUG-038]` |
| 5 | T-004-A..I | `fix: each phase boundary writes its own session row [BUG-038]` |
| 6 | T-005-A..D | `test: the end-to-end checkpoint-to-resume handoff cycle [BUG-038]` |
| 7 | T-006-A..E | `chore: release 1.31.0 [BUG-038]` |
| 8 | T-006-F..G | memory and backlog, on `main`, owner-scoped |

Every staging step follows every edit step in its own commit group. No task stages a file it edits later.

## Identified Risks

**Risk 1 (materialized before execution, ruling requested at plan approval).** `tests/scripts/conductor-db.test.js:286` and `:306` copy `conductor-db.mjs` alone into a sibling-free tree. Task 2's import makes both fail with `ERR_MODULE_NOT_FOUND` before reaching the behavior under test. T-002-E adds the sibling to each fixture. Classification proposed: **fixture completeness, not assertion adjustment**. No `expect` changes; the temp tree gains the file the deployed layout always ships. This is a third shape alongside the two already on the record, and naming it here is what keeps the deviation list honest. Caught early because the plan grepped for isolated `cpSync` copies before writing a single import.

**Risk 2.** The 32-line cap on `snap-validate.mjs` is at exactly 32 today and the target text is exactly 32. Any additional line during execution breaks a pre-existing test. Detection: T-001-F runs that one case before the rest. Remedy: pack statements, the style the file already uses; never edit the cap.

**Risk 3.** `resume-read.mjs` must stay import-free, or the two tier-3 root-resolution tests that copy it alone (`:193`, `:205`) break the same way Risk 1 describes. Task 3 routes the reason through the validator's stderr precisely for this reason. Detection: T-003-E, and the two cases are in the same file.

**Risk 4.** The post-parse cap must sit **after** the `snap.v > MAX_VERSION` check, or `POST_PARSE_MAX[snap.v]` is `undefined` for a v3 payload and `raw.length > undefined` is `false`, silently accepting an oversize v3. T-001-E places it on the line after. Detection: the version-ceiling case in T-001-B still expects `SNAP_UNKNOWN_VERSION`, which only fires if the ordering is right.

**Risk 5.** Rewriting cc-compact's tail edits the live command that produces this session's own handoff. A wording error there degrades the next `/cc-compact` silently. Detection: the three-way parity assertion in T-004-A fails on any divergence, and T-004-C changes only the delimited region, leaving the snapshot step and the compact prompt untouched.

**Risk 6.** The `unnest` transform recognizes exactly two substitutions (`node .claude/scripts/` and ``running `.claude/scripts/``). The new tail must use the `node .claude/scripts/` form in the template mirrors and nothing else, or `cc-plan mirrors differ only in the script path nesting` fails. Detection: T-004-G, first assertion in the file.

**Risk 7.** `conductor-db.mjs` is also spawned with `--experimental-sqlite` on older Node. A sibling ESM import is resolved by the loader before any flag handling, so the probe ladder is unaffected, but the contract module must remain free of any syntax below the Node floor. It uses plain `export const` only.

**Tripwire convention (carried forward from BUG-037).** Every task boundary above states a predicted test count. Any off-by-one is reconciled before the next line of code is written, and the reconciliation is recorded in the plan at the boundary where it was found.
