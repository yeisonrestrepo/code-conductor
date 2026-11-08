# BUG-055 Implementation Plan: detect-stack Non-String package.json Fields

> **For agentic workers:** execute task by task, in order. Each task is TDD: write the failing tests, run them and see them fail, apply the fix, then run them and see them pass. Touch only the files the task's **Files:** block names.

**Goal:** `scripts/detect-stack.mjs` treats any non-string `name`, `description` or `scripts.build|test|lint|format` in a `package.json` as absent, writes one `WARN:` line per ignored field per manifest, and never collapses to `{}` because of a field's type.

**Spec:** `docs/superpowers/specs/2026-11-08-bug055-detect-stack-non-string-scripts-design.md` (sha256 `0a54bf61…7c1c`). It implements the owner-APPROVED `docs/superpowers/specs/2026-10-07-bug055-non-string-manifest-fields-design.md` with the same scope. Where the two disagree, the approved spec wins.

**Baseline:** `5fc234a`. All line references below are at that commit.

**Test command:** `npm test` (`vitest run`). **Known unrelated failure:** `tests/hooks/pre-tool-use-contract.test.js` › "allows a Write to a path that does not exist" fails while any orchestrator run is live (issue #118). In every task, "suite green" means that every other test passes.

**Never touch:** VERSION, package versions, CHANGELOG, `AGENT-READABLE BACKLOG.md`, README Known limits (CONTRIBUTING), and `tests/scripts/detect-stack.test.js`, which must stay byte-identical to `5fc234a` (AC12, Ruling 3).

---

## Design decisions fixed by this plan

1. **The read rule is one exported helper** in `scripts/detect-stack.mjs`, next to `warn()` (`:32`):
   ```js
   // A package.json field counts only when it is a string; anything else reads as a missing key.
   export function stringField(value) { return typeof value === 'string' ? value : undefined; }
   ```
   Every listed read site goes through it: `:245`, `:253`, `:259`, `:265`, `:271`, `:278-279`, `:598-601`, `:614` and `:623`. A string value (blank strings included) passes through unchanged, so all-string output is byte-identical (Q1).
2. **The WARN is emitted where a manifest is loaded** (`:503` root, `:549` each workspace), never inside a detector. A field read by two detectors therefore still writes one line (AC8). The exact text is the spec's, with an ASCII hyphen:
   `WARN: non-string package.json field ignored - <field>: <path>`
   where `<path>` is the same `join(<dir>, 'package.json')` string passed to `readManifest`.
3. **"Present" means `value !== undefined`.** A JSON `null`, `0`, `false`, number, object, array or boolean in one of the six fields gets a WARN. A missing key does not. **`scripts` that is not a plain object** (`null`, `"x"`, `true`, an array) gives no WARN. Reading `.build` on it yields `undefined`, which is the existing behavior (spec, Alternative paths).
4. **package.json that parses to a non-object** (`42`, `[]`, `"x"`, and also `{}`), which the reviewer raised. `readManifest` already returns `null` for these at `:50` (`typeof raw !== 'object' || raw === null || Array.isArray(raw)`) and at `:51` (empty object). They take the spec's "`readManifest` returns `null`" error case: there is no field WARN, the run exits 0, and the stdout is the same as with no manifest. No code change is needed. Task 3 adds one invariance test that pins this, and scope stays the same.
5. **Tests live in a new sibling file, `tests/scripts/detect-stack-cli.test.js`** (Ruling 3). The file has no fs mock. Fixtures are `mkdtempSync` temp dirs, and the spawn pattern follows `tests/scripts/orchestrate.test.js:454`:
   ```js
   spawnSync(process.execPath, [join(REPO_ROOT, 'scripts/detect-stack.mjs'), dir], { encoding: 'utf8' })
   ```
   Use `realpathSync(mkdtempSync(join(tmpdir(), 'cc-ds-cli-')))` so the basename assertions (AC6, AC13) compare against the real path. Remove each dir in `afterEach` with `rmSync(dir, { recursive: true, force: true })`. Give the file one helper, `run(pkgText)`, that writes `package.json`, spawns, and returns `{ status, out: JSON.parse(stdout), stderr, dir }`. Also give it `fieldWarns(stderr, field)`, which returns the stderr lines that start with `WARN: non-string package.json field ignored - ${field}: `. AC8 counts only those lines, because the existing `WARN: readdir error` lines are unrelated.
6. **AC14 (red before green)** is satisfied per task. Each task's "run red" step happens before any edit to `scripts/detect-stack.mjs` in that task. The code paths each new case exercises are still byte-identical to `5fc234a` at that point: Task 1 runs on `5fc234a` itself, Task 2 changes only `main()` sites that Task 1 did not touch, and Task 3 adds a WARN that has never existed. A behavior-change case that does not fail at its red step is a plan defect: stop and report it, and do not weaken the case. The implementer records each red run's failing-case count in the task hand-back.

## AC → task map

| AC | Task(s) |
|---|---|
| AC1 (class a, four field shapes) | 2 |
| AC2 (no `build`, keeps `test`) | 1 (detectTSNode copy), 2 (end-to-end CLI) |
| AC3 (Next `test: 42` → `jest`) | 1 |
| AC4 (falsy: `test: 0` → `jest`; `build: 0`/`false` no key) | 1 (`test: 0`), 2 (`build: 0`/`false`) |
| AC5 (`description: 42`) | 2 |
| AC6 (`name: 42` → basename, no `stack`/`setup`) | 1 (TSNode gate), 2 (`:614` name) |
| AC7 (blank `test` unchanged, no WARN) | 1 (no key), 3 (no WARN) |
| AC8 (one WARN per field per manifest) | 3 |
| AC9 (exit 0, stdout parses) | 1, 2, 3 (asserted inside `run()` for every fixture) |
| AC10 (six detectors called directly) | 1 |
| AC11 (orchestrate comment only) | 4 |
| AC12 (full suite, `detect-stack.test.js` byte-identical) | 1-5 (each task's verification), 4 (final full-suite check) |
| AC13 (no-name/no-TS path to `:598-601`) | 2 |
| AC14 (red before green) | 1, 2, 3 (each task's red step; see decision 6) |

---

### Task 1: Read-rule helper and the six detectors

**Files:**
- Modify: `scripts/detect-stack.mjs`
- Create: `tests/scripts/detect-stack-cli.test.js`

**Covers:** AC10, AC3, AC4 (`test: 0`), AC2 (detector half), AC6 (detectTSNode gate), AC7 (no key), AC9.

- [x] **Step 1: Write the failing tests.** Create `tests/scripts/detect-stack-cli.test.js` with the decision-5 scaffolding (imports from `vitest`, `node:child_process`, `node:fs`, `node:os`, `node:path`, `node:url`; `REPO_ROOT`; `run()`, which also asserts `status === 0` and that stdout parses, for AC9; `fieldWarns()`). Import the six detectors directly from `../../scripts/detect-stack.mjs`, with no fs mock. Add:
  - **AC10:** `describe('[AC10] detectors never return a non-string command')`. `it.each` over the bad values `42`, `0`, `false`, `null`, `{ cmd: 'x' }`, `['eslint']` and `true`, using `scripts = { build: v, test: v, lint: v, format: v }` and these manifests:
    - `detectAngular({ dependencies: { '@angular/core': '^17.0.0' }, scripts })` (await it);
    - `detectNextjs({ dependencies: { next: '14' }, scripts })`;
    - `detectNestjs({ dependencies: { '@nestjs/core': '10' }, scripts })`;
    - `detectReact({ dependencies: { react: '18' }, scripts })`;
    - `detectVue({ dependencies: { vue: '3' }, scripts })`;
    - `detectTSNode({ name: 'x', scripts })`.

    For each, assert that every one of `build`, `test`, `lint` and `format` is either `undefined` or `typeof 'string'`. Also assert the defaults: Angular `build === 'ng build'`, Next `test === 'jest'`, Vue `test === 'vitest'`, and React, Vue and TSNode `build === undefined`.
  - **AC6 gate:** `detectTSNode({ name: 42, scripts: { test: 'vitest' } })` deep-equals `{}`.
  - **AC3 (CLI):** `run('{"name":"x","dependencies":{"next":"14"},"scripts":{"test":42}}').out.test === 'jest'`.
  - **AC4, `test: 0` (CLI):** the same with `"test":0` → `'jest'`.
  - **AC7 (CLI):** `run('{"name":"x","dependencies":{"next":"14"},"scripts":{"test":""}}').out` has no `test` key. This is an invariance case and passes at red; that is expected.
  - **AC2, detector half:** `detectTSNode({ name: 'x', scripts: { build: 42, test: 'vitest' } })` has `build === undefined` and `test === 'vitest'`.
- [x] **Step 2: Run red.** `npx vitest run tests/scripts/detect-stack-cli.test.js`. The AC10, AC6-gate, AC3, AC4 (`test: 0`) and AC2-detector cases fail at `5fc234a`, and AC7 passes. Record the count.
  - One expected exception: the AC10 `null` rows for Angular, Next and Nest pass at red, because `??` already falls back on `null` at `5fc234a`. Those three rows are invariance rows. Every other AC10 row must fail.
- [x] **Step 3: Fix.** In `scripts/detect-stack.mjs`:
  - add `stringField` (decision 1) directly below `warn()` at `:32`;
  - `:245`: `build: stringField(s.build) ?? 'ng build', test: stringField(s.test) ?? 'ng test', lint: stringField(s.lint) ?? 'ng lint'`;
  - `:253` and `:259`: wrap `s.build`, `s.test` and `s.lint` the same way, keeping each default;
  - `:265` and `:271`: `build: stringField(s.build)`, `test: stringField(s.test) ?? <default>`, `lint: stringField(s.lint)`;
  - `:278`: `if (!hasDep && !stringField(pkg.name)) return {};`
  - `:279`: wrap all four of `s.build`, `s.test`, `s.lint` and `s.format`.

  Do not touch `main()` in this task.
- [x] **Step 4: Run green.** `npx vitest run tests/scripts/detect-stack-cli.test.js` passes. `npm test` passes except the known #118 case, and `tests/scripts/detect-stack.test.js` is unmodified.

### Task 2: Read rule at the `main()` sites (`:598-601`, `:614`, `:623`)

**Files:**
- Modify: `scripts/detect-stack.mjs`
- Modify: `tests/scripts/detect-stack-cli.test.js`

**Covers:** AC1, AC13, AC5, AC6 (name), AC2 (end-to-end), AC4 (`build: 0`/`false`), AC9.

- [x] **Step 1: Write the failing tests.** Append to `tests/scripts/detect-stack-cli.test.js`:
  - **AC1 and AC13, per field.** These fixtures have no `name` and no TS dependency. Use `it.each`:
    - `{"scripts":{"build":42,"test":"vitest"}}` → no `build`, `test === 'vitest'`;
    - `{"scripts":{"test":{"cmd":"x"},"build":"tsc"}}` → no `test`, `build === 'tsc'`;
    - `{"scripts":{"lint":["eslint"],"test":"vitest"}}` → no `lint`, `test === 'vitest'`;
    - `{"scripts":{"format":true,"test":"vitest"}}` → no `format`, `test === 'vitest'`.

    Each also asserts that `out` is not `{}` (`Object.keys(out).length > 0`) and that stderr does not contain `"code":"UNKNOWN"`.
  - **AC13, survivors:** `{"scripts":{"build":42,"test":" vitest ","lint":"eslint .","format":"prettier ."}}` → `test === 'vitest'`, `lint === 'eslint .'`, `format === 'prettier .'`, `name === basename(dir)`, and no `build` key.
  - **AC2, end-to-end:** `{"name":"x","scripts":{"build":42,"test":"vitest"}}` → no `build`, `test === 'vitest'`.
  - **AC5:** `{"name":"x","description":42,"scripts":{"test":"vitest"}}` → no `description`, `name === 'x'`, `test === 'vitest'`.
  - **AC6:** `{"name":42,"scripts":{"test":"vitest"}}` → `name === basename(dir)` (and never `42`), no `stack` key, no `setup` key.
  - **AC4, invariance:** `{"scripts":{"build":0}}` and `{"scripts":{"build":false}}` → no `build` key. These pass at red; that is expected.
- [x] **Step 2: Run red.** `npx vitest run tests/scripts/detect-stack-cli.test.js`:
  - the AC1/AC13 per-field, AC13-survivor and AC5 cases fail with stdout `{}`;
  - AC2-end-to-end fails with `"build": 42`;
  - AC6 fails with `"name": 42`;
  - the AC4 invariance cases pass.

  Record the count.
- [x] **Step 3: Fix.** In `main()` of `scripts/detect-stack.mjs`:
  - `:597-601`: read each script through `stringField` before the truthiness check, for example `const build = stringField(s.build); if (!merged.build && build) merged.build = build.trim();`, and the same for `test`, `lint` and `format`. A loop over the four keys is fine if it stays flat;
  - `:614`: `const pkgName = stringField(rootPkg?.name); if (pkgName) merged.name = pkgName;` (keep the `else if` go.mod branch and the `:620` basename fallback as they are);
  - `:623`: `const description = stringField(rootPkg?.description); if (description) merged.description = description.trim().replace(/\r?\n/g, ' ');`.

  Do not touch the handlers at `:663-683`.
- [x] **Step 4: Run green.** The new file passes. `npm test` passes except #118.

### Task 3: One field WARN per manifest

**Files:**
- Modify: `scripts/detect-stack.mjs`
- Modify: `tests/scripts/detect-stack-cli.test.js`

**Covers:** AC8, AC7 (no WARN), decision 4 (non-object manifest), AC9.

- [x] **Step 1: Write the failing tests.** Append:
  - **AC8, one line:** `run('{"scripts":{"build":42,"test":"vitest"}}')`. `fieldWarns(stderr, 'scripts.build')` has length 1, its line includes `basename(dir)` and ends with `package.json`, and no other field has a field WARN.
  - **AC8, two detectors:** `{"name":"x","dependencies":{"next":"14"},"devDependencies":{"typescript":"5"},"scripts":{"test":42}}`. `fieldWarns(stderr, 'scripts.test')` has length 1.
  - **AC8, one per field:** `{"name":42,"description":false,"scripts":{"build":null,"test":"vitest","lint":[],"format":{}}}`. This gives exactly one line each for `name`, `description`, `scripts.build`, `scripts.lint` and `scripts.format`, and none for `scripts.test`.
  - **AC8, no WARN:** an all-string fixture, `{"name":"x","description":"d","scripts":{"build":"tsc","test":"vitest","lint":"eslint .","format":"prettier ."}}`, has zero lines matching `WARN: non-string package.json field ignored`. This is an invariance case.
  - **AC7, no WARN:** the AC7 fixture from Task 1 has zero field WARN lines. This is an invariance case.
  - **`scripts` not an object:** `it.each` over `{"name":"x","scripts":null}`, `{"name":"x","scripts":"x"}` and `{"name":"x","scripts":true}`. Each has zero field WARN lines and exits 0. This is an invariance case.
  - **Decision 4, non-object manifest:** `it.each` over the raw texts `42`, `[]` and `"x"`. Each exits 0, its stdout parses, it has zero field WARN lines, and its `out.name === basename(dir)`. This is an invariance case.
- [x] **Step 2: Run red.** The three WARN-present cases fail because no such line exists at this point. The invariance cases pass. Record the count.
- [x] **Step 3: Fix.** In `scripts/detect-stack.mjs`, add one exported function below `readManifest` that applies decisions 2 and 3:
  ```js
  const SCRIPT_KEYS = ['build', 'test', 'lint', 'format'];

  // One line per ignored field, emitted where a manifest is loaded so two detectors reading it cannot double it.
  export function warnNonStringFields(pkg, filepath) {
    if (!pkg) return;
    const scripts = typeof pkg.scripts === 'object' && pkg.scripts !== null ? pkg.scripts : {};
    const fields = [['name', pkg.name], ['description', pkg.description], ...SCRIPT_KEYS.map(k => [`scripts.${k}`, scripts[k]])];
    for (const [field, value] of fields) {
      if (value !== undefined && typeof value !== 'string') warn(`non-string package.json field ignored - ${field}: ${filepath}`);
    }
  }
  ```
  Call it right after each load:
  - at `:503`, compute the root path once, load it, then call `warnNonStringFields(rootPkg, rootPkgPath)`;
  - at `:549`, do the same per workspace manifest before pushing it.

  `readManifest` itself is unchanged, so the mocked `tests/scripts/detect-stack.test.js` stays valid. If Task 2 inlined the four keys rather than looping, it may reuse `SCRIPT_KEYS` now; that is optional.
- [x] **Step 4: Run green.** The new file passes. `npm test` passes except #118.

### Task 4: Reword the stale orchestrate comment

**Files:**
- Modify: `scripts/orchestrate.mjs`

**Covers:** AC11 and AC12 (final full-suite check).

- [x] **Step 1: Edit comment text only** at `scripts/orchestrate.mjs:207-209`. The clause "a non-string script makes detect-stack fail whole and the halt would then name the wrong cause" is no longer true. Replace it with the real reason, for example:
  ```js
  // D6: the one command code and qa may run, resolved before anything is recorded. The script
  // is checked before detect-stack runs, because detect-stack drops a non-string script and may
  // offer its own default runner, which the run must not take in place of the owner's script.
  ```
  Change no code line. `hasTestScript` (`:198-205`) and `resolveTestCommand` (`:210-221`) stay byte-identical (Out of Scope).
- [x] **Step 2: Verify.** `npm test` passes except #118, and `tests/scripts/orchestrate.test.js` passes unchanged. Confirm by diff against `5fc234a` that:
  - `scripts/orchestrate.mjs` differs only in lines `:207-209`;
  - `tests/scripts/detect-stack.test.js` and `tests/scripts/orchestrate.test.js` show no diff (AC11, AC12).

### Task 5: Tracked-surface `.gitignore` leaves for the spec and this plan

**Files:**
- Modify: `.gitignore`

**Precondition, owned by the orchestrator:** stage both docs with `git add -f` **immediately before this task runs, and not earlier**:
- `docs/superpowers/specs/2026-11-08-bug055-detect-stack-non-string-scripts-design.md`
- `docs/superpowers/plans/2026-11-08-bug055-non-string-manifest-fields.md`

`tests/unit/gitignore-block-parity.test.js` compares the block against `git ls-files`. Once either doc is in the index, that test stays red until this task's leaves land. If the docs were staged before Tasks 1-4, those tasks could not end green.

- [ ] **Step 1: Run red.** With both docs staged, `npx vitest run tests/unit/gitignore-block-parity.test.js` fails because two leaves are missing.
- [x] **Step 2: Add the two leaves in sorted position** inside the BUG-042 block:
  - after `.gitignore:138` (`!/docs/superpowers/plans/2026-10-27-issue109-verbosity-alias.md`), and before the first `!/docs/superpowers/specs/` line, add:
    `!/docs/superpowers/plans/2026-11-08-bug055-non-string-manifest-fields.md`
  - after `.gitignore:195` (`!/docs/superpowers/specs/2026-10-27-issue109-verbosity-alias-design.md`), and before `# --- END tracked-surface block (BUG-042) ---`, add:
    `!/docs/superpowers/specs/2026-11-08-bug055-detect-stack-non-string-scripts-design.md`

  Use two single-line inserts and no bulk rewrite. Line numbers are at `5fc234a`. The plan leaf shifts the spec insertion point to after `:196`, so anchor on the line content, not the number.
- [x] **Step 3: Run green.** The parity test passes, and `npm test` passes except #118.
