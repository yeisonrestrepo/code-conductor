# BUG-084 adopt-claude-md.mjs skips its entry point when run through a symlinked directory implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** Make the direct-run check in `scripts/adopt-claude-md.mjs` resolve `process.argv[1]` with `realpathSync` before comparing it with `import.meta.url`, in the same form as `invokedDirectly()` in `bin/code-conductor.mjs:146-157`. Pin the fix with one test that runs `sections` through a directory link.

**Spec:** `docs/superpowers/specs/2026-11-18-bug084-adopt-claude-md-mjs-skips-its-entry-point-when-design.md` (sha256 `a7a1cf458c32f03db1918cdaac82945b46e4f9816162db5a8821bc041a7d8da7`). Issue #242.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines (including the `[BUG-084]` entry at `README.md:511`) stay untouched (spec, Out of Scope).
- **One script, one test file.** Only `scripts/adopt-claude-md.mjs` and `tests/unit/adopt-claude-md.test.js` change. `scripts/detect-stack.mjs`, `scripts/init-wizard.mjs` and `scripts/session-metrics.mjs` have the same failure mode and are not touched; they go to separate intake (spec, Out of Scope). No shared helper is extracted.
- `tests/installer/deploy.test.js`, `lib/installer/deploy.mjs` and `tools/skip-baseline.json` are not edited.
- No new dependency, no new import in the script (`fs` at `scripts/adopt-claude-md.mjs:14` supplies `realpathSync`; `pathToFileURL` is at line 16), no network, no installer, hook, settings, command or SNAP-script change. Not a protected surface.
- Every file this plan edits after Task 0 is tracked, so every staging step is `git add -u <path>` with an explicit path.

## Plan decisions

1. **Form of the fix (spec, Solution).** The new function is a copy of `bin/code-conductor.mjs:151-157`, written with `fs.realpathSync` because this script imports `fs` as a default import. It returns `false` when `argv[1]` is absent and falls back to the raw `argv[1]` when `realpathSync` throws, then compares `import.meta.url` with `pathToFileURL(resolved).href`. It goes between `main()` (ends at line 221) and the guarded block (line 223), with a two-line comment saying why the realpath is needed. Only the condition on line 223 changes. The `try`/`catch` body below it does not.
2. **Test fixture: a copy, not a link to the repository (spec, AC1 leaves this to the plan).** The test copies the two files the script needs into the test's temp dir: `scripts/adopt-claude-md.mjs` and `lib/installer/merge-md.mjs`. `merge-md.mjs` imports nothing (grepped), so these two files are the whole runtime closure. The test then links `<dir>/link` to `<dir>/real`. A link to the repository's own `scripts/` would also work, but then the existing `afterEach` `rmSync(dir, { recursive: true, force: true })` would run over a link into the working tree. With a copy, the worst a cleanup can do is delete files inside the temp dir.
3. **Link type.** `symlinkSync(real, link, 'junction')` with an absolute `real`, which a junction needs on Windows (spec, AC2). POSIX ignores the type, and on Windows a junction needs no elevation, so the test carries no `CAN_SYMLINK` skip and the skipped set on every CI leg stays as it is.
4. **Assertions.** The test runs `sections` on `'## Team Rules\nbe kind\n'` (the input `tests/installer/deploy.test.js:92` uses, which yields `trigger: true`) twice: through the link and through the real path. It asserts exit 0 through the link, that the parsed JSON has `trigger: true`, and that stdout through the link equals stdout through the real path. This covers AC1's "same JSON, same status".
5. **Placement.** A new `describe('entry point [BUG-084]')` at the end of `tests/unit/adopt-claude-md.test.js`, after the `round 2 fixes` block (ends at line 269). It reuses the file's `dir` / `file` from `beforeEach`, and the existing `afterEach` cleans up. `copyFileSync`, `mkdirSync` and `symlinkSync` join the `node:fs` import on line 3 in alphabetical order.
6. **Red reproduced before writing this plan.** A throwaway copy (deleted) of the two files under `$TMPDIR`, reached through `ln -s`, printed nothing and exited 0 for `sections`. Through the real path it printed the `trigger: true` JSON. So on Linux, without the macOS temp dir, the new test is red against the current line 223.
7. **`.gitignore` leaf.** `!/docs/superpowers/plans/2026-11-18-bug084-adopt-claude-md-mjs-skips-its-entry-point-when.md` goes after the `2026-11-15-bug081` plan leaf and before the first spec leaf, which is its sorted position. `tests/unit/gitignore-block-parity.test.js` checks it.

## Baseline (measured on this branch, HEAD 8e61c30)

- `npx vitest run tests/unit/adopt-claude-md.test.js`: **29 passed (29)**.
- `tools/skip-baseline.json` lists no `tests/unit/adopt-claude-md.test.js` test on any leg.

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-18-bug084-adopt-claude-md-mjs-skips-its-entry-point-when.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file from the approved spec `a7a1cf45…`. No dependency.
- [X] [T-002] `.gitignore`: insert the leaf `!/docs/superpowers/plans/2026-11-18-bug084-adopt-claude-md-mjs-skips-its-entry-point-when.md` after the `2026-11-15-bug081` plan leaf (plan decision 7). Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` (tracked) and `git add docs/superpowers/plans/2026-11-18-bug084-adopt-claude-md-mjs-skips-its-entry-point-when.md` (new, re-included by its leaf, so no ignored ancestor applies). Depends on T-002.
- [X] [T-004] Commit: `docs: plan the symlink-safe entry-point check for adopt-claude-md.mjs [BUG-084]`. Depends on T-003.

---

### Task 1: Test first (red)

**Files:**
- Modify: `tests/unit/adopt-claude-md.test.js`

- [X] [T-101] Modify the `node:fs` import at `tests/unit/adopt-claude-md.test.js:3` to `import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';`. Depends on T-004.
- [X] [T-102] Append after the last line of the file (the close of `describe('round 2 fixes')`, line 269) a `describe('entry point [BUG-084]', …)` holding one test, `it('runs the CLI when the script directory is reached through a symlink', …)`. The body (plan decisions 2-4):
  - `const real = join(dir, 'real');`, then `mkdirSync(join(real, 'scripts'), { recursive: true });` and `mkdirSync(join(real, 'lib', 'installer'), { recursive: true });`.
  - `copyFileSync(SCRIPT, join(real, 'scripts', 'adopt-claude-md.mjs'));` and `copyFileSync(join(ROOT, 'lib', 'installer', 'merge-md.mjs'), join(real, 'lib', 'installer', 'merge-md.mjs'));`.
  - `const link = join(dir, 'link');`, then `symlinkSync(real, link, 'junction');`.
  - `writeFileSync(file, '## Team Rules\nbe kind\n');`.
  - A local `const sections = (root) => spawnSync('node', [join(root, 'scripts', 'adopt-claude-md.mjs'), 'sections', file], { encoding: 'utf8' });`, then `const viaLink = sections(link);` and `const direct = sections(real);`.
  - `expect(viaLink.status).toBe(0);`, `expect(JSON.parse(viaLink.stdout).trigger).toBe(true);`, `expect(viaLink.stdout).toBe(direct.stdout);`.
  - Depends on T-101.
- [X] [T-103] Red run: `npx vitest run tests/unit/adopt-claude-md.test.js`. The filter is the whole file, so its full match set is the 29 baseline tests plus the new one. Predicted: **1 failed, 29 passed (30)**. The failure is the new test, with a `SyntaxError` from `JSON.parse` on the empty stdout through the link (spec, AC3). Any other count, or a failure at `status`, means the fixture is wrong: fix the fixture, not the prediction. Depends on T-102.

---

### Task 2: Resolve argv[1] before the comparison (green)

**Files:**
- Modify: `scripts/adopt-claude-md.mjs`

- [X] [T-201] Insert between `main()` (closing brace at line 221) and the guarded block, separated from each by one blank line:

  ```js
  // Node's ESM loader sets import.meta.url to the module's realpath, so argv[1] must be
  // realpath-resolved too, or a launch through a symlinked directory skips the main block.
  function invokedDirectly() {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    let resolved;
    try { resolved = fs.realpathSync(argv1); } catch { resolved = argv1; }
    return import.meta.url === pathToFileURL(resolved).href;
  }
  ```

  Depends on T-103.
- [X] [T-202] Replace the condition `if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {` with `if (invokedDirectly()) {`. The block body stays byte for byte. Depends on T-201.
- [X] [T-203] Green run: the T-103 command. Predicted: **30 passed (30)**. The 29 existing tests staying green covers AC4: importing the module as `tests/unit/adopt-claude-md.test.js:7` does still does not run the main block. Depends on T-202.

---

### Task 3: Full suite, scope check and commit

**Files:**
- Modify: `scripts/adopt-claude-md.mjs`, `tests/unit/adopt-claude-md.test.js` (staged), this plan (checkboxes)

- [X] [T-301] Run `npm test`. Predicted: exit 0, every file green, including `tests/installer/deploy.test.js` "ships the merge engine so the deployed adopt-claude-md.mjs runs [FEAT-040]", which is unchanged (AC5, AC6). On every CI leg the new test runs and is not skipped, so `tools/skip-baseline.json` stays untouched. A failure caused by the sandbox (network, tmp permissions) is reported as ENV with the test's name. Any other red is fixed. Depends on T-203.
- [X] [T-302] Scope check:
  - `git status --porcelain` lists exactly `scripts/adopt-claude-md.mjs`, `tests/unit/adopt-claude-md.test.js` and this plan as modified.
  - `git diff -U0 HEAD -- scripts/adopt-claude-md.mjs | grep '^-[^-]'` shows only the old `if (import.meta.url === …)` line.
  - `git diff -U0 HEAD -- tests/unit/adopt-claude-md.test.js | grep '^-[^-]'` shows only the old `node:fs` import line.
  - `git diff --quiet HEAD -- VERSION CHANGELOG.md package.json package-lock.json README.md "AGENT-READABLE BACKLOG.md" .claude tools lib bin tests/installer .github` exits 0.
  - Depends on T-301.
- [X] [T-303] Stage: `git add -u scripts/adopt-claude-md.mjs tests/unit/adopt-claude-md.test.js` (both tracked). Depends on T-302.
- [X] [T-304] Stage: `git add -u docs/superpowers/plans/2026-11-18-bug084-adopt-claude-md-mjs-skips-its-entry-point-when.md` (carries the ticks for T-101 to T-303). Depends on T-303.
- [X] [T-305] Commit: `fix: run adopt-claude-md.mjs when its directory is reached through a symlink [BUG-084]`. Depends on T-304.

---

## Test List

- [ ] Unit, AC1-AC3: `entry point [BUG-084]` runs `sections` through a junction-typed directory link and gets exit 0, `trigger: true` and the same stdout as through the real path. It is red before T-202 (T-103) and green after (T-203).
- [ ] Unit, AC4: the 29 existing tests in `tests/unit/adopt-claude-md.test.js` pass unchanged, so importing the module still has no side effects (T-203).
- [ ] Integration, AC5: `tests/installer/deploy.test.js` FEAT-040 deploy-and-run test passes unchanged (T-301).
- [ ] AC6: `npm test` green (T-301).
- [ ] No E2E/UI test: there is no UI.

## Commit Order

1. Task 0 (T-004): this plan and its `.gitignore` leaf.
2. Task 3 (T-305): the test, the fix and the plan ticks for T-101 to T-303, in one commit, so no commit has a red suite. The red run in T-103 happens in the working tree before the fix. The ticks for T-304 and T-305 and the Test List ride a closeout commit if one follows. Otherwise they stay as working-tree state.

## Identified Risks

- **Cleanup through a link.** `afterEach` removes `dir` recursively while `dir/link` points at `dir/real`. Node's `rmSync` removes a link without following it, and because of plan decision 2 the target is inside `dir` anyway, so nothing outside the temp dir can be removed. Catch: T-302's `git status` shows no deleted repository file.
- **Windows junction.** A junction needs an absolute target, and `join(dir, 'real')` is absolute because `mkdtempSync(join(tmpdir(), …))` is. If the `ci-windows-node24` leg reports `EPERM` on `symlinkSync`, the link type was dropped. Check T-102 against the spec's AC2 and do not add a skip.
- **macOS temp dir already symlinked.** There, `dir` itself sits under `/var → /private/var`, so even the "real" run goes through a link. After the fix both runs print the same JSON, so the assertion still holds. Before the fix both would print nothing, and `JSON.parse` fails first, which is the intended red.
- **Red not reproducing.** If T-103 shows 30 passed, the link did not reach the comparison (for example, a resolved path was passed to `spawnSync`). Plan decision 6 already measured the red with the same layout. Fix the fixture before touching the script.
