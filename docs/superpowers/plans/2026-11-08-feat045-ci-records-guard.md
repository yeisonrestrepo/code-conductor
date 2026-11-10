# FEAT-045 CI Records-Guard Implementation Plan

> **For agentic workers:** carry out this plan one task at a time, in order. A code role may touch only the files named in its task's **Files:** block. Steps use checkbox (`- [ ]`) syntax for tracking. Code roles can run only `npm test` (Guard 7), and a full run takes about 2-5 minutes, so each red or green step is one full `npm test` run.

**Spec:** `docs/superpowers/specs/2026-11-08-feat045-ci-records-guard-design.md` (approved; sha256 4559c809…e247). Rulings 1-14 there are fixed and this plan does not reopen them.

**Goal:** If a PR not opened by the repository owner changes an owner-side record by value, a check goes red. The records are the `VERSION` content, the `package.json`/`package-lock.json` versions, the `CHANGELOG.md` release headings, and the backlog heading states and DONE lines. Each failure message names the file and the CONTRIBUTING anchor.

**Architecture:** One zero-dependency Node ESM script, `tools/records-guard.mjs`, in the style of `tools/skip-baseline.mjs`. It has pure exported checks, an `evaluate(files, revs)` that returns `{ code, lines }`, and a `main()` that reads both revisions with `git cat-file -e` / `git show` through `spawnSync` with an argv array and no shell. A sibling workflow, `.github/workflows/records-guard.yml`, runs it on `pull_request` with `--base HEAD^1 --head HEAD`. The doc edits are one README Instruments bullet plus its count word, one `tools/README.md` row, one CONTRIBUTING line, and two `.gitignore` leaves.

**Tech stack:** Node ≥20 ESM, `node:` built-ins only; vitest (`tests/tools/*.test.js`); GitHub Actions `actions/checkout@v7`, `actions/setup-node@v7`.

**Standing rules for every task:**
- Never touch `VERSION`, the `package.json`/`package-lock.json` versions, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, README `## Known limits`, `.github/workflows/test.yml` or `tools/skip-baseline.json`. Add no `skip`, `skipIf` or `todo` to any test (AC16).
- code-simplifier rules: every function is 30 lines or fewer, guard clauses and early returns, descriptive names, and comments that explain why, never what.
- **Known unrelated failure:** while an orchestrated run is live, `tests/hooks/pre-tool-use-contract.test.js` › "allows a Write to a path that does not exist" fails (#118). A green step means every other case passes and that one is the only failure. Report it, and do not fix it.
- Every git call made by a test fixture uses `env: cleanGitEnv()` from `tests/helpers/git-env.js` (BUG-053).

---

## AC → task map

| Spec AC | Covered by | How |
|---|---|---|
| 1 VERSION change / whitespace-CRLF-BOM-only | Task 1 (check), Task 3 (path + anchor in the line) | unit |
| 2 package.json version vs scripts/devDeps/re-indent | Task 1, Task 3 | unit |
| 3 lockfile root + `packages[""]` vs `node_modules/*` | Task 1, Task 3 | unit |
| 4 CHANGELOG added/removed/rc/Unreleased/typo/date | Task 2, Task 3 | unit |
| 5 backlog heading state changes | Task 2, Task 3 | unit |
| 6 DONE lines added/removed/edited, with line numbers | Task 2, Task 3 | unit |
| 7 README never read | Task 3 (`RECORD_FILES` excludes it; POC row 12), Task 4 (CLI case b) | unit + CLI |
| 8 12/12 POC variant-C scenarios | Task 3 | `it.each` over 12 rows |
| 9 present/absent rules | Task 3 | unit |
| 10 invalid JSON at head / base, no throw (plus the reviewer's BOM note) | Task 1 (BOM, `error.side`), Task 3 (violation vs ABORT) | unit |
| 11 CLI cases (a)-(e) in a temp git repo | Task 4 | CLI |
| 12 `node:` imports only; `tools/` not shipped | Task 4 (import-line test); existing `tests/tools/tools-not-shipped.test.js` stays green in every task | unit |
| 13 workflow YAML shape | Task 5 | read-only YAML-text test |
| 14 `test.yml` byte-identical | Task 5, verification step (`git diff main -- .github/workflows/test.yml` is empty, run by the orchestrator) | diff check |
| 15 doc diff scope | Task 1 (README + `tools/README.md`), Task 6 (CONTRIBUTING), Task 7 (spec + plan leaves); verification step in Task 7 | diff check |
| 16 no new skips, `skip-baseline.json` unchanged | every task (standing rule); verified in Task 7 | diff check + CI |
| 17 full suite green incl. repo-invariants + gitignore parity | Task 1 (repo-invariants Instruments case), Task 7 (parity, final full run) | `npm test` |

---

### Task 1: Script skeleton, version checks, and the Instruments docs

The script and the README Instruments edit land together, because `tests/tools/repo-invariants.test.js:130-135` ("names every tools/ instrument in the Instruments section, with their count") enumerates `git ls-files 'tools/*.mjs'` and goes red the moment `tools/records-guard.mjs` is tracked without a `` **`records-guard.mjs`** `` bullet and "Five checks live in `tools/`".

**Where this breaks:**
- **The repo-invariants pairing.** If the script is committed without both README edits, the Instruments case goes red. The count sentence must contain the literal `Five checks live in \`tools/\``.
- **JSON parsing.** Without the BOM strip, a BOM-only change reads as invalid JSON. A side that fails to parse must return `error.side` and must not throw.
- **Version comparison.** `!==` on the parsed values must treat a missing `version` as a change. Optional chaining must cover a lockfile with no `packages` key.

**Files:**
- Create: `tools/records-guard.mjs`
- Test: `tests/tools/records-guard.test.js`
- Modify: `README.md`
- Modify: `tools/README.md`

- [x] **Step 1: Write the failing tests** in `tests/tools/records-guard.test.js`. Import from `../../tools/records-guard.mjs`: `RECORD_FILES, ANCHOR_NEVER, ANCHOR_RECORDS, checkVersionFile, checkPackageJson, checkLockfile`. Use fixture builders like these:

```js
const pkg = (over = {}, indent = 2) =>
  JSON.stringify({ name: 'code-conductor', version: '1.43.0', scripts: { test: 'vitest run' }, devDependencies: { vitest: '^3.2.0' }, ...over }, null, indent) + '\n';
const lock = ({ root = '1.43.0', pkgRoot = '1.43.0', dep = '3.2.4' } = {}) => JSON.stringify({
  name: 'code-conductor', version: root, lockfileVersion: 3,
  packages: { '': { name: 'code-conductor', version: pkgRoot }, 'node_modules/vitest': { version: dep } },
}, null, 2) + '\n';
```

  Cases, in `describe('constants')`, `describe('checkVersionFile')`, `describe('checkPackageJson')` and `describe('checkLockfile')`:
  - `RECORD_FILES` equals `['VERSION', 'package.json', 'package-lock.json', 'CHANGELOG.md', 'AGENT-READABLE BACKLOG.md']`, is frozen, and does not contain `README.md`.
  - `ANCHOR_NEVER === 'CONTRIBUTING.md#what-contributors-must-never-do'`, `ANCHOR_RECORDS === 'CONTRIBUTING.md#records-are-owner-side'`.
  - AC1: `checkVersionFile('1.43.0\n', '1.44.0\n').violations` equals `['1.43.0 -> 1.44.0']`. `'1.43.0\n'` vs `'1.43.0'`, vs `'1.43.0\r\n'`, and vs `'﻿1.43.0\n'` each give `[]`.
  - AC2: `checkPackageJson(pkg(), pkg({ version: '1.44.0' })).violations` has length 1 and contains `1.43.0 -> 1.44.0`. A `scripts` change, a `devDependencies` change and `pkg({}, 4)` (re-indent) each give `[]`. A `version` removed at head is one violation (strict `!==`).
  - AC3: `lock()` vs `lock({ root: '1.44.0', pkgRoot: '1.44.0' })` gives 2 violations, one starting `version ` and one starting `packages[""].version `. Root only, or `packages[""]` only, gives 1. `lock({ dep: '3.2.5' })` gives `[]`. A lockfile with no `packages` key on both sides gives `[]`.
  - AC10 / reviewer BOM note: `checkPackageJson('﻿' + pkg(), pkg())` and `checkLockfile(lock(), '﻿' + lock())` give `{ violations: [] }` and no `error`. `checkPackageJson(pkg(), '{ nope')` returns `{ error: { side: 'head', message: <string> } }`. `checkPackageJson('{ nope', pkg())` returns `error.side === 'base'`. None of these throw.
  - CRLF: `pkg().replace(/\n/g, '\r\n')` vs `pkg()` gives `[]`.

- [x] **Step 2: Run `npm test`, expect red.** `tests/tools/records-guard.test.js` fails to load: the module `tools/records-guard.mjs` cannot be resolved. Every other file is green except #118.

- [x] **Step 3: Write `tools/records-guard.mjs`.** Use the header of `skip-baseline.mjs`: a shebang, a one-line purpose, a `REPO-ONLY` note pointing at `tools/id-ceiling.mjs` and `tools-not-shipped.test.js`, a "Why this exists" paragraph (PR #59 shipped release records from a contributor branch and only a human reviewer caught it; a path or added-line check fails legitimate edits, so values are compared), and "This is a gate: every doubt aborts." Import only `node:` built-ins, and only the ones the file uses. The core:

```js
export const ANCHOR_NEVER = 'CONTRIBUTING.md#what-contributors-must-never-do';
export const ANCHOR_RECORDS = 'CONTRIBUTING.md#records-are-owner-side';
export const RECORD_FILES = Object.freeze(['VERSION', 'package.json', 'package-lock.json', 'CHANGELOG.md', 'AGENT-READABLE BACKLOG.md']);

const toLf = (text) => text.replace(/\r\n/g, '\n');

// trim() also drops U+FEFF, so a BOM or trailing-newline change alone is not a version change.
export function checkVersionFile(base, head) {
  const before = base.trim();
  const after = head.trim();
  return { violations: before === after ? [] : [`${before} -> ${after}`] };
}

// An editor-added BOM is invisible and fatal to JSON.parse; it is not a contributor's change.
function parseJson(text) {
  try { return { value: JSON.parse(text.replace(/^﻿/, '')) }; } catch (err) { return { message: err.message }; }
}

function compareJsonFields(base, head, fields) {
  const before = parseJson(base);
  if ('message' in before) return { error: { side: 'base', message: before.message } };
  const after = parseJson(head);
  if ('message' in after) return { error: { side: 'head', message: after.message } };
  const changed = fields.filter(([, read]) => read(before.value) !== read(after.value));
  return { violations: changed.map(([label, read]) => `${label} ${read(before.value)} -> ${read(after.value)}`) };
}

export const checkPackageJson = (base, head) => compareJsonFields(base, head, [['version', (j) => j?.version]]);
// Only the two root versions are records; every node_modules entry carries its own "version".
export const checkLockfile = (base, head) => compareJsonFields(base, head, [
  ['version', (j) => j?.version],
  ['packages[""].version', (j) => j?.packages?.['']?.version],
]);
```

  `parseJson` does not need `toLf`, because `JSON.parse` already treats `\r\n` as whitespace. `toLf` is used by the Task 2 parsers and is defined here so that Task 2 only adds functions.

- [x] **Step 4: Edit `README.md` `## Instruments: releases that verify their own record`** (around lines 482-489). Make exactly two edits:
  - Line 484: replace the opening through the colon with: "Five checks live in `tools/` as tracked repository infrastructure. Three of them run in full on every pull request, and a fourth, `records-guard.mjs`, on every pull request not opened by the owner, so a divergence blocks the merge rather than waiting for someone to remember; the fifth, `id-ceiling.mjs`, runs its duplicate-free half on every pull request too, and its ceiling query by hand before each mint:"
  - Insert one bullet after the `skip-baseline.mjs` bullet: "- **`records-guard.mjs`** compares the owner-side records between a pull request's base and head by parsed value, not by line: the `VERSION` content, the `package.json` and `package-lock.json` root versions, the set of `CHANGELOG.md` release headings, and the backlog's heading states and DONE lines. A dependency bump, an `[Unreleased]` entry or a new open item passes. It runs in `.github/workflows/records-guard.yml` on every pull request not opened by the repository owner. It exists because PR #59 shipped release records from a contributor branch and only a human reviewer caught it."

  Touch nothing else in README, and above all not `## Known limits`.

- [x] **Step 5: Edit `tools/README.md`.** After the `skip-baseline.mjs` row (line 12), add exactly one row:
  `` | `records-guard.mjs` | invariant | `.github/workflows/records-guard.yml` on every non-owner PR; by hand with `--base`/`--head` | ``

- [x] **Step 6: Run `npm test`, expect green.** All new cases pass. `tests/tools/repo-invariants.test.js` and `tests/tools/tools-not-shipped.test.js` stay green. The only failure is #118. Hand back. The orchestrator commits the four files together (`feat(tools): records-guard version checks + Instruments docs [FEAT-045]`), and that commit is what makes the repo-invariants case actually exercise the new file.

---

### Task 2: CHANGELOG and backlog checks

**Where this breaks:** three spots, each pinned by a case in Step 1.
- **The heading regexes.** A missing `m` flag matches only the first line. A missing `^` anchor lets prose or an indented `## [1.44.0]` count. A state group wider than one character misses `[~]`. A lower-case `x` that is not normalized reads `[X]`→`[x]` as a flip.
- **The absent-id rule.** If an id missing on one side is read as "no states" instead of `[ ]`, adding or removing a `### [ ]` item fails when it must pass, and removing an `[X]` item may pass when it must fail.
- **The DONE multiset.** A `Set` instead of a counted multiset lets a duplicated DONE line pass. Mixing up the sides reports a base line number for an added line or a head line number for a removed one.

**Files:**
- Modify: `tools/records-guard.mjs`
- Test: `tests/tools/records-guard.test.js`

- [x] **Step 1: Write the failing tests.** Add `checkChangelog` and `checkBacklog` to the import, and use these fixtures:

```js
const CHANGELOG = '# Changelog\n\n## [Unreleased]\n\n## [1.43.0] - 2026-11-01\n\n- Fixed a tpyo.\n\n## [1.42.0] - 2026-10-20\n\n- Older.\n';
const BACKLOG = [
  '# Backlog', '',
  '### [ ] `[FEAT-045]` CI Records-Guard', '', 'Open text.', '',
  '### [X] `[FEAT-044]` Flow viewer', '', '* **DONE in 1.43.0.**', '',
  '### [~] `[BUG-010]` Parked', '', 'Mentions a DONE line mid-sentence.', '',
].join('\n');
```

  Cases:
  - AC4: adding `## [1.44.0] - 2026-11-08` gives one violation containing `release heading [1.44.0] added`. Adding `## [1.44.0-rc.1]` gives one violation. Removing `## [1.42.0] - 2026-10-20` gives `release heading [1.42.0] removed`. A new `## [Unreleased]`-only body line, `## [unreleased]` in lower case, the typo fix `tpyo`→`typo`, and a date edit `2026-11-01`→`2026-11-02` each give `[]`. Duplicating `## [1.43.0]` gives `[]` (set semantics). `  ## [1.44.0]` (indented) and prose `see ## [1.44.0]` give `[]`. A CRLF copy of the text gives `[]`.
  - AC5: flipping FEAT-045 `[ ]`→`[X]` gives one violation containing `FEAT-045 heading [ ] -> [X]`. Also violations: `[X]`→`[ ]` on FEAT-044, `[ ]`→`[~]` on FEAT-045, `[~]`→`[X]` on BUG-010, a new item ``### [X] `[FEAT-099]` x``, a new item ``### [~] `[FEAT-099]` x``, removing the FEAT-044 heading, and removing the BUG-010 heading. No violation: a new ``### [ ] `[FEAT-099]` x`` item, removing the FEAT-045 heading, and FEAT-044 `[X]`→`[x]`.
  - AC6: inserting `* **DONE in 1.44.0.**` after the FEAT-045 heading gives `DONE line added at line <n>`, where `<n>` is its 1-based head line. Deleting line 9 (`* **DONE in 1.43.0.**`) gives `DONE line removed (base line 9)`. Editing that line's text gives exactly two violations, one added and one removed. Editing `Open text.` gives `[]`. Duplicating an existing DONE line gives one `added`, because the comparison is a multiset. A heading flip plus an added DONE line in one diff gives both, since every violation is reported.

- [x] **Step 2: Run `npm test`, expect red.** In `tests/tools/records-guard.test.js`, the new `checkChangelog` and `checkBacklog` cases fail. Which error appears depends on how vitest transforms the import of a missing named export. If it is a missing-export error, the whole file fails to load and the Task 1 cases in it report as failing too. If it is a TypeError on calling `undefined`, only the new cases fail. Either form is the expected red. No other file is red except #118.

- [x] **Step 3: Implement** in `tools/records-guard.mjs`:

```js
function releaseVersions(text) {
  const versions = [...toLf(text).matchAll(/^## \[([^\]]+)\]/gm)].map((m) => m[1]);
  return new Set(versions.filter((v) => v.toLowerCase() !== 'unreleased'));
}

export function checkChangelog(base, head) {
  const before = releaseVersions(base);
  const after = releaseVersions(head);
  const added = [...after].filter((v) => !before.has(v)).map((v) => `release heading [${v}] added`);
  const removed = [...before].filter((v) => !after.has(v)).map((v) => `release heading [${v}] removed`);
  return { violations: [...added, ...removed] };
}

// Same heading shape repo-invariants.test.js matches; the state is any single character.
const BACKLOG_HEADING = /^### \[(.)\] `\[([A-Z]+-\d+)\]`/gm;

function headingStates(text) {
  const states = new Map();
  for (const [, mark, id] of toLf(text).matchAll(BACKLOG_HEADING)) {
    states.set(id, [...(states.get(id) ?? []), mark === 'x' ? 'X' : mark]);
  }
  for (const list of states.values()) list.sort();
  return states;
}

// An absent id reads as one open heading, so adding or dropping an open item is no record change.
const statesOf = (states, id) => (states.get(id) ?? [' ']).map((s) => `[${s}]`).join(',');

function headingViolations(base, head) {
  const before = headingStates(base);
  const after = headingStates(head);
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort();
  return ids
    .filter((id) => statesOf(before, id) !== statesOf(after, id))
    .map((id) => `${id} heading ${statesOf(before, id)} -> ${statesOf(after, id)}`);
}

function doneLines(text) {
  return toLf(text).split('\n')
    .map((line, i) => ({ line, number: i + 1 }))
    .filter(({ line }) => line.startsWith('* **DONE'));
}

// Multiset difference: occurrences beyond the other side's count are the changed ones.
function unmatched(lines, other) {
  const budget = new Map();
  for (const { line } of other) budget.set(line, (budget.get(line) ?? 0) + 1);
  return lines.filter(({ line }) => {
    const left = budget.get(line) ?? 0;
    budget.set(line, left - 1);
    return left <= 0;
  });
}

function doneViolations(base, head) {
  const before = doneLines(base);
  const after = doneLines(head);
  const added = unmatched(after, before).map(({ number }) => `DONE line added at line ${number}`);
  const removed = unmatched(before, after).map(({ number }) => `DONE line removed (base line ${number})`);
  return [...added, ...removed];
}

export function checkBacklog(base, head) {
  return { violations: [...headingViolations(base, head), ...doneViolations(base, head)] };
}
```

- [x] **Step 4: Run `npm test`, expect green**, with #118 as the only failure. Hand back for commit (`feat(tools): records-guard changelog and backlog checks [FEAT-045]`).

---

### Task 3: `checkRecord`, `evaluate`, presence rules, and the 12 POC scenarios

**Where this breaks:**
- **Order of the presence rules.** The both-absent check must run before the one-sided checks, or a missing record reports as deleted. The one-sided checks must run before the content check, or a check receives `null` and throws.
- **Violation versus ABORT.** `evaluate` must check for a bad base before it collects violations. Otherwise a bad base hides behind other findings, or prints alongside them, instead of being the single `RECORDS_GUARD_ABORT` line. Invalid JSON at head must be a violation, not an abort.
- **The OK count.** It must count only the records actually compared, so a record absent on both sides lowers the number.
- **POC row 12.** It passes only because `README.md` is not in `RECORD_FILES`. If the row instead builds a README record, `checkRecord` throws.

**Files:**
- Modify: `tools/records-guard.mjs`
- Test: `tests/tools/records-guard.test.js`

- [x] **Step 1: Write the failing tests.** Add `checkRecord` and `evaluate` to the import, and reuse the fixtures from Tasks 1-2. Use a helper `same()` that returns the five records unchanged (`{ path, base, head }` with `base === head`). Cases:
  - Path and anchor (AC1-6): `checkRecord('VERSION', '1.43.0\n', '1.44.0\n').violations` equals `['RECORDS_GUARD_VIOLATION VERSION: 1.43.0 -> 1.44.0; see CONTRIBUTING.md#what-contributors-must-never-do']`. `package.json`, `package-lock.json` (the line contains `packages[""].version 1.43.0 -> 1.44.0`) and `CHANGELOG.md` lines end `; see ${ANCHOR_NEVER}`. Backlog flip and DONE lines end `; see ${ANCHOR_RECORDS}` and name `AGENT-READABLE BACKLOG.md`.
  - AC9: `checkRecord(p, text, null)` gives `RECORDS_GUARD_VIOLATION <p>: deleted or renamed at head; see <anchor>`. `(p, null, text)` gives `... created at head; ...`. `(p, null, null)` gives `{ compared: false, violations: [] }`. `evaluate` with `VERSION` absent on both sides and the other four unchanged gives code 0 and `RECORDS_GUARD_OK: 4 record files compared`.
  - AC10: `evaluate` with `package.json` head `'{ nope'` gives code 1, a line matching `/^RECORDS_GUARD_VIOLATION package\.json: not valid JSON at head \(.+\); its version cannot be verified; see CONTRIBUTING\.md#what-contributors-must-never-do$/`, and then `RECORDS_GUARD_FAILED: 1 violation(s). Records are written by the owner at release time.` `package-lock.json` base `'{ nope'` with revs `{ base: 'abc123', head: 'def456' }` gives code 1 and exactly one line, starting `RECORDS_GUARD_ABORT: package-lock.json is not valid JSON at base abc123 (`. Neither throws (`expect(() => …).not.toThrow()`).
  - OK line: `evaluate(same(), { base: 'abc123', head: 'def456' })` gives `{ code: 0, lines: ['RECORDS_GUARD_OK: 5 record files compared, no owner-side change (base abc123, head def456)'] }`.
  - FAILED count: a VERSION bump plus a backlog flip gives code 1, two violation lines, and `RECORDS_GUARD_FAILED: 2 violation(s). …` last.
  - `checkRecord('README.md', 'a', 'b')` throws, because it is not a record file and is a programming error.
  - AC7 / AC8: `it.each` over the 12 POC variant-C rows. Each row is `[scenario, expected, path, mutate]`. Head is base with `mutate` applied to that one record, and the result is `evaluate(...)`. The test asserts `code === (expected === 'FAIL' ? 1 : 0)`, and for every row except the README one it asserts that the mutation actually changed the text. The rows are:

    | # | Scenario | Expected |
    |---|---|---|
    | 1 | VERSION bump | FAIL |
    | 2 | package.json version bump | FAIL |
    | 3 | package.json script edit only | PASS |
    | 4 | lockfile version bump | FAIL |
    | 5 | lockfile dependency-only change | PASS |
    | 6 | CHANGELOG release heading added | FAIL |
    | 7 | CHANGELOG [Unreleased] entry added | PASS |
    | 8 | CHANGELOG typo fix in old body | PASS |
    | 9 | backlog checkbox flip | FAIL |
    | 10 | backlog [ ] item text edit | PASS |
    | 11 | backlog DONE line added | FAIL |
    | 12 | README edit near Known limits | PASS: `README.md` is not in `RECORD_FILES`, so `evaluate(same())` sees no change |

    Add one plain `it` that asserts the table has 12 rows, which makes the 12/12 of AC8 visible.

- [x] **Step 2: Run `npm test`, expect red.** The new `checkRecord` and `evaluate` cases fail, either through a missing-export error that fails the whole file to load or through a TypeError on calling `undefined`. Either form is the expected red. No other file is red except #118.

- [x] **Step 3: Implement:**

```js
const CHECKS = {
  'VERSION': [checkVersionFile, ANCHOR_NEVER],
  'package.json': [checkPackageJson, ANCHOR_NEVER],
  'package-lock.json': [checkLockfile, ANCHOR_NEVER],
  'CHANGELOG.md': [checkChangelog, ANCHOR_NEVER],
  'AGENT-READABLE BACKLOG.md': [checkBacklog, ANCHOR_RECORDS],
};

const violation = (path, detail, anchor) => `RECORDS_GUARD_VIOLATION ${path}: ${detail}; see ${anchor}`;

export function checkRecord(path, base, head) {
  const entry = CHECKS[path];
  if (!entry) throw new Error(`records-guard: ${path} is not a record file`);
  const [check, anchor] = entry;
  if (base === null && head === null) return { compared: false, violations: [] };
  // A rename is a deletion at the record path; the new path is not a record.
  if (head === null) return { compared: true, violations: [violation(path, 'deleted or renamed at head', anchor)] };
  if (base === null) return { compared: true, violations: [violation(path, 'created at head', anchor)] };
  const result = check(base, head);
  // A base that does not parse is main's fault, not the PR's, so it is an instrument fault.
  if (result.error?.side === 'base') return { compared: true, baseError: result.error.message, violations: [] };
  if (result.error) {
    return { compared: true, violations: [violation(path, `not valid JSON at head (${result.error.message}); its version cannot be verified`, anchor)] };
  }
  return { compared: true, violations: result.violations.map((detail) => violation(path, detail, anchor)) };
}

const abort = (reason) => ({ code: 1, lines: [`RECORDS_GUARD_ABORT: ${reason}`] });

export function evaluate(files, { base = 'base', head = 'head' } = {}) {
  const results = files.map((file) => ({ path: file.path, ...checkRecord(file.path, file.base, file.head) }));
  const broken = results.find((r) => r.baseError !== undefined);
  if (broken) return abort(`${broken.path} is not valid JSON at base ${base} (${broken.baseError})`);
  const violations = results.flatMap((r) => r.violations);
  if (violations.length > 0) {
    return { code: 1, lines: [...violations, `RECORDS_GUARD_FAILED: ${violations.length} violation(s). Records are written by the owner at release time.`] };
  }
  const compared = results.filter((r) => r.compared).length;
  return { code: 0, lines: [`RECORDS_GUARD_OK: ${compared} record files compared, no owner-side change (base ${base}, head ${head})`] };
}
```

  `evaluate` takes the revs as an optional second argument, because the spec's OK and ABORT lines name them. Its return shape stays `{ code, lines }`, the same as `skip-baseline.evaluate`.

- [x] **Step 4: Run `npm test`, expect green**, with #118 as the only failure. Hand back for commit (`feat(tools): records-guard evaluate and presence rules [FEAT-045]`).

---

### Task 4: `parseArgs`, the CLI, and the import-only test

**Where this breaks:**
- **The git calls.** `rev-parse --verify --quiet <rev>^{commit}` must run before any read. If it does not, a rev missing from a shallow clone makes `cat-file -e` fail for every path, and every record reads as absent, which is a silent pass. `cat-file -e` failing must mean "absent" only after both revs are verified. A failure of `git show` after `cat-file -e` succeeded is an abort, never `null`. A spawn error (`r.error`, git missing) must abort and must not be read as a status.
- **Fail-closed argument parsing.** An empty value, a flag in the value slot, an unknown flag, or a missing `--base`/`--head` must each return `error`. Any of them falling through to a default is a fail-open.
- **The fixture repo.** A test git call without `cleanGitEnv()` can aim at the real repository (BUG-053). A tool run without `cwd: dir` reads this repository instead of the fixture.
- **Output and the entry guard.** `process.exit` instead of `exitCode` can truncate stdout. A `process.argv[1]` entry-point guard that never matches leaves `main` uncalled, which shows up as exit 0 with empty stdout.

**Files:**
- Modify: `tools/records-guard.mjs`
- Test: `tests/tools/records-guard.test.js`

- [x] **Step 1: Write the failing tests.** Add `parseArgs` to the import, and add `import { cleanGitEnv } from '../helpers/git-env.js'`.
  - `parseArgs`: `['--base','a','--head','b']` gives `{ base: 'a', head: 'b' }`. Each of these returns an `error` and does not throw: `[]`; `['--base','a']` (missing `--head`); `['--base','','--head','b']` (empty value, fail-closed); `['--base','--head','b']`; `['--base','a','--head','b','--x','y']` (unknown flag).
  - AC12: read `tools/records-guard.mjs` as text and collect every `^import … from '…'` specifier plus any `import(` / `require(`. Assert that the static list is non-empty, that every specifier starts with `node:`, and that there are no `require(` or dynamic `import(` calls.
  - AC11, in `describe('the CLI')`: a helper builds a repo under `mkdtempSync(join(tmpdir(), 'cc-records-'))` with `git init -q` and local `user.email`/`user.name`. It writes the five records (the Task 1-2 fixtures) plus a `README.md` containing `## Known limits\n\n- none\n`, and commits as `base`. Every git call uses `{ cwd: dir, env: cleanGitEnv() }`. `afterEach` removes the dirs. Run the tool as `spawnSync(process.execPath, [TOOL, ...args], { cwd: dir, env: cleanGitEnv(), encoding: 'utf8' })`, where `TOOL` is the absolute path to `tools/records-guard.mjs`.
    - (a) The second commit changes only `VERSION`. Run with `--base HEAD~1 --head HEAD`: status 1, and stdout contains `RECORDS_GUARD_VIOLATION VERSION: 1.43.0 -> 1.44.0; see CONTRIBUTING.md#what-contributors-must-never-do`.
    - (b) The second commit changes only a README line next to `## Known limits`: status 0, and stdout starts `RECORDS_GUARD_OK: 5 record files compared`.
    - (c) `--base nope-not-a-rev --head HEAD`: status 1, and stdout contains `RECORDS_GUARD_ABORT: revision "nope-not-a-rev" is not a commit in this clone` and `fetch-depth`.
    - (d) `--base HEAD` only: status 1, and stdout contains `RECORDS_GUARD_ABORT:` and `usage: node tools/records-guard.mjs --base <rev> --head <rev>`.
    - (e) The second commit flips FEAT-045 `[ ]`→`[X]` in `AGENT-READABLE BACKLOG.md`: status 1, and stdout contains `RECORDS_GUARD_VIOLATION AGENT-READABLE BACKLOG.md: FEAT-045 heading [ ] -> [X]; see CONTRIBUTING.md#records-are-owner-side`. This proves that the path with a space is read.
    - A record deleted at head (`git rm -q VERSION` and then commit) exits 1 with `VERSION: deleted or renamed at head`.

- [x] **Step 2: Run `npm test`, expect red.** The new cases fail. The `parseArgs` cases fail either through a missing-export error that fails the whole file to load or through a TypeError on calling `undefined`; either form is the expected red. If the file loads, the CLI cases fail on status 0 with empty stdout, because `main` does not exist yet and the module only exports, and the import-only case may already pass, which is expected. No other file is red except #118.

- [x] **Step 3: Implement:**

```js
const USAGE = 'usage: node tools/records-guard.mjs --base <rev> --head <rev>';

export function parseArgs(argv) {
  const out = { base: null, head: null };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (flag !== '--base' && flag !== '--head') return { error: `unknown argument ${JSON.stringify(flag)}` };
    const value = argv[i + 1];
    // An empty value is rejected too: a gate's rule is fail-closed.
    if (!value || value.startsWith('--')) return { error: `${flag} needs a value` };
    out[flag.slice(2)] = value;
  }
  if (!out.base || !out.head) return { error: 'both --base <rev> and --head <rev> are required' };
  return out;
}

// argv array, no shell: the space in AGENT-READABLE BACKLOG.md needs no quoting.
function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`git ${args.join(' ')} failed (${r.error.message})`);
  return r;
}

// A rev missing from a shallow clone must never read as "every record absent".
function assertCommit(rev) {
  if (git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]).status === 0) return;
  throw new Error(`revision "${rev}" is not a commit in this clone; the checkout needs fetch-depth >= 2 (or fetch the base)`);
}

function readAt(rev, path) {
  if (git(['cat-file', '-e', `${rev}:${path}`]).status !== 0) return null;
  const r = git(['show', `${rev}:${path}`]);
  if (r.status === 0) return r.stdout;
  throw new Error(`git show ${rev}:${path} failed (${r.stderr.split('\n')[0].trim()})`);
}

function run(argv) {
  const args = parseArgs(argv);
  if (args.error) return abort(`${args.error}; ${USAGE}`);
  try {
    assertCommit(args.base);
    assertCommit(args.head);
    const files = RECORD_FILES.map((path) => ({ path, base: readAt(args.base, path), head: readAt(args.head, path) }));
    return evaluate(files, args);
  } catch (err) {
    return abort(err.message);
  }
}

function main() {
  const result = run(process.argv.slice(2));
  for (const line of result.lines) console.log(line);
  // exitCode, not exit(): process.exit can truncate a piped stdout before it drains.
  process.exitCode = result.code;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
```

  The imports are `spawnSync` from `node:child_process` and `fileURLToPath` from `node:url`. git runs in `process.cwd()`, which is the checkout root in CI and the temp repo in tests.

- [x] **Step 4: Run `npm test`, expect green**, with #118 as the only failure. Hand back for commit (`feat(tools): records-guard CLI [FEAT-045]`).

---

### Task 5: The sibling workflow and its YAML-text test

**Where this breaks:**
- **YAML indentation against the anchored regexes.** `^on:\n  pull_request:\n` and `^permissions:\n  contents: read$` assume two-space indentation, LF line endings after normalization, and no trailing spaces. Tabs, or four spaces, fail the test even when the YAML is valid.
- **Words in comments.** A comment that mentions `author_association` or `head_ref` fails the negative assertions.
- **The `uses:` versions.** A `uses:` pinned to a different major, or to a SHA, fails the "same as `test.yml`" check.
- **The base revision.** `fetch-depth` below 2 makes `HEAD^1` unreachable in CI. That shows up only on a real PR, as `RECORDS_GUARD_ABORT`, not in the suite.
- **`test.yml`.** Any edit to it breaks AC14.

**Files:**
- Create: `.github/workflows/records-guard.yml`
- Test: `tests/tools/records-guard.test.js`

- [x] **Step 1: Write the failing tests** in `describe('the workflow')`. Read `.github/workflows/records-guard.yml` and `.github/workflows/test.yml` from the repo root with CRLF normalized to LF. Cases (AC13):
  - The text matches `/^on:\n  pull_request:\n/m`, and no other top-level trigger appears under `on:`: the text does not match `/^\s+(push|pull_request_target|workflow_dispatch|schedule|workflow_run):/m`.
  - The set of `uses:` values equals `{ 'actions/checkout@v7', 'actions/setup-node@v7' }`. Each value is also a `uses:` value in `test.yml`, so the majors are the same as `test.yml`'s.
  - The text contains `fetch-depth: 2`, matches `/^permissions:\n  contents: read$/m`, and contains `if: github.event.pull_request.user.login != github.repository_owner`.
  - The text does not contain `author_association` or `head_ref`.
  - The text contains `node tools/records-guard.mjs --base HEAD^1 --head HEAD`.

- [x] **Step 2: Run `npm test`, expect red.** Every `the workflow` case fails with `ENOENT … records-guard.yml`.

- [x] **Step 3: Create `.github/workflows/records-guard.yml`** exactly as spec §3 shows. No comment may contain the words `author_association` or `head_ref`.

```yaml
name: Records guard

on:
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  records-guard:
    # Ruling 2: the owner's own PRs (release PRs included) are exempt; collaborators are not.
    if: github.event.pull_request.user.login != github.repository_owner
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v7
        with:
          # The pull_request checkout is the merge commit; depth 2 reaches its first
          # parent, which is the base tip the PR is being merged into.
          fetch-depth: 2
          persist-credentials: false
      - uses: actions/setup-node@v7
        with:
          # engines.node's floor, so the guard proves it needs nothing newer.
          node-version: '20'
      - name: Fail if the PR changes owner-side records
        run: node tools/records-guard.mjs --base HEAD^1 --head HEAD
```

- [x] **Step 4: Run `npm test`, expect green**, with #118 as the only failure. Do not touch `.github/workflows/test.yml`. AC14 is verified by the orchestrator: `git diff main -- .github/workflows/test.yml` must be empty. Hand back for commit (`ci: records-guard workflow [FEAT-045]`).

---

### Task 6: The CONTRIBUTING line

**Where this breaks:** AC15 requires the diff to be exactly one `+` line, and that line has to stay inside its paragraph.
- **A stray blank line.** One added before or after the line makes a second `+` line.
- **Wrong position.** Inserted after the blank line at 94, the line becomes its own paragraph ahead of "Three more rules bind the work itself:" and reads as a lead-in to that list. Inserted inside the bulleted record list (lines 87-90), it becomes part of a bullet.
- **Changed line endings.** An editor that rewrites the file's line endings turns every line into a `-`/`+` pair.

No test catches any of these, so the orchestrator's diff check in Step 2 is the only gate.

**Files:**
- Modify: `CONTRIBUTING.md`

- [x] **Step 1: Insert exactly one line** in `## Records are owner-side`, directly after line 93 (`release lands, so they are dropped on landing and written owner-side.`) and before the blank line that precedes "Three more rules bind the work itself:". It continues that paragraph, so the diff is exactly one added line (AC15) and the text reads:

  ```
  The `Records guard` workflow (`tools/records-guard.mjs`) fails any PR not opened by the owner that changes one of these records, except the README Known-limits lines, and its message names the file and the rule.
  ```

  Insert the line inside the fence verbatim, without the fence. Change nothing else.

- [x] **Step 2: Run `npm test`, expect green**, with #118 as the only failure. No test pins this line. It is a doc check: the orchestrator confirms that `git diff main -- CONTRIBUTING.md` shows exactly one `+` line and no `-` line. Hand back for commit (`docs: name the records guard in CONTRIBUTING [FEAT-045]`).

---

### Task 7: Tracked-surface leaves for the spec and plan, and final verification

**Precondition (orchestrator, before dispatching this task):** stage both docs with `git add -f docs/superpowers/specs/2026-11-08-feat045-ci-records-guard-design.md docs/superpowers/plans/2026-11-08-feat045-ci-records-guard.md`. `tests/unit/gitignore-block-parity.test.js` compares the block against `git ls-files`. A leaf without a tracked file is red, and a tracked file without its leaf is red, so the staging and the leaves must land together.

**Where this breaks:**
- **Parity between the leaves and the tracked files.** A leaf for a doc that is not staged is red, and a staged doc without its leaf is red.
- **Leaf placement.** A leaf out of sorted position, or outside the `# --- END tracked-surface block (BUG-042) ---` line, fails the parity test.
- **Leaf text.** A typo in a leaf path, or a missing leading `!/`, fails it too.
- **A stale plan.** If the plan file is edited after staging, the staged copy is stale and the orchestrator must restage it before committing.

**Files:**
- Modify: `.gitignore`

- [x] **Step 1: Add two leaf lines in sorted position inside the BUG-042 tracked-surface block:**
  - `!/docs/superpowers/plans/2026-11-08-feat045-ci-records-guard.md` goes directly after `!/docs/superpowers/plans/2026-10-27-issue109-verbosity-alias.md` (line 138) and before the first `!/docs/superpowers/specs/` line.
  - `!/docs/superpowers/specs/2026-11-08-feat045-ci-records-guard-design.md` goes directly after `!/docs/superpowers/specs/2026-10-27-issue109-verbosity-alias-design.md` (line 195) and before `# --- END tracked-surface block (BUG-042) ---`.

  Change nothing else in `.gitignore`. `tools/`, `tests/` and `.github/` are not under the deny block.

- [x] **Step 2: Run `npm test`, expect green (AC17).** `tests/unit/gitignore-block-parity.test.js`, `tests/tools/repo-invariants.test.js`, `tests/tools/tools-not-shipped.test.js` and all of `tests/tools/records-guard.test.js` pass. The only failure is #118.

- [x] **Step 3: Final diff verification (orchestrator, read-only):**
  - `git diff --name-only main` lists exactly these files: `tools/records-guard.mjs`, `tests/tools/records-guard.test.js`, `.github/workflows/records-guard.yml`, `README.md`, `tools/README.md`, `CONTRIBUTING.md`, `.gitignore`, and the spec and plan.
  - Absent from that list (AC14-16 and the standing rules): `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.github/workflows/test.yml` and `tools/skip-baseline.json`.
  - `git diff main -- README.md` touches only the Instruments section: one changed intro line and one added bullet.
  - `git diff main -- tools/README.md` is one added row.
  - `tests/tools/records-guard.test.js` contains no `skip`, `skipIf`, `todo` or `only`.

  Hand back for commit (`chore: track FEAT-045 spec and plan [FEAT-045]`).
