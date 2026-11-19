# BUG-083 Publish job disables the setup-node package-manager cache explicitly implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** Add `package-manager-cache: false` to the `publish` job's `actions/setup-node@v7` step in `.github/workflows/publish.yml`, and replace the `not.toMatch(/cache/)` check in `tests/installer/workflow.test.js` with assertions that pin that explicit value and forbid any `cache:` or `cache-dependency-path:` input in the job.

**Spec:** `docs/superpowers/specs/2026-11-19-bug083-publish-job-relies-on-omitted-cache-key-design.md` (sha256 `c0472396ded23097cd34788e1aac08191f29752d6d2fb323fb3dd6add38eb112`), approach A. Issue #235.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines (including the `[BUG-083]` entry at `README.md:508`) stay untouched (spec, Out of Scope).
- **One workflow, one test file.** Only `.github/workflows/publish.yml` and `tests/installer/workflow.test.js` change, plus this plan and its `.gitignore` leaf. `test.yml`, `records-guard.yml` and `wiki-sync.yml` are not touched (spec, Out of Scope).
- **The `verify` job is byte-for-byte unchanged**, including `cache: 'npm'` (spec, AC2).
- The value is spelled exactly `package-manager-cache: false`, unquoted, at the 10-space indent of the step's `with:` block (spec, Solution, the choice the entry leaves open).
- No new dependency, no YAML parser: the new helper reads the comment-stripped workflow text like the existing `runs`, `uses` and `permissions` helpers do.
- Every file this plan edits after Task 0 is tracked, so every staging step is `git add -u <path>` with an explicit path.

## Review Focus

- **An explicit `cache: 'npm'` added to the `publish` step.** It turns caching on whatever `package-manager-cache` says, so the job must still forbid it. Pinned by `not.toMatch(/^[ -]*cache:/m)` in T-102, measured red in plan decision 5.
- **The value flipped to `true` or quoted differently.** Pinned by the literal-line assertion in T-102, measured red in plan decision 5.
- **The input placed outside the `setup-node` step** (for example at job level, where it does nothing). Pinned by matching inside `step(publish, 'actions/setup-node')` at a 10-space indent, not anywhere in the job.
- **A second `package-manager-cache:` line** (a duplicate key, where the last one would win). Pinned by the exactly-one count in T-102.
- **A comment naming the input.** Comments are stripped before every assertion (`tests/installer/workflow.test.js:13`), so the new job comment in T-202 cannot satisfy or break the checks.

## Plan decisions

1. **Helper `step(block, action)`.** Added after `permissions()` (ends at `tests/installer/workflow.test.js:37`), before `const verify = job('verify');` (line 39), with a one-line comment tagged `[BUG-083]`. It returns the text of the step whose line starts with `      - uses: <action>@` (6-space indent, the step indent of both jobs), up to the next line starting with `      - ` or the end of the block, and `''` when no such step exists. String `startsWith`, not a regex, so the action name needs no escaping.
2. **The test keeps its place and is renamed.** The `it` at lines 99-102 (`'targets the npm registry and restores no cache'`) becomes `'targets the npm registry and disables the package-manager cache explicitly [BUG-083]'`. The registry assertion moves from the whole job to the `setup-node` step, which is stricter and still true today.
3. **Assertions** (spec, AC3), in this order inside the renamed `it`:
   - `const node = step(publish, 'actions/setup-node');`
   - `expect(node).toMatch(/registry-url:\s*'https:\/\/registry\.npmjs\.org'/);`
   - `expect((publish.match(/package-manager-cache:/g) ?? []).length).toBe(1);`
   - `expect(node).toMatch(/^ {10}package-manager-cache: false$/m);`
   - `expect(publish).not.toMatch(/^[ -]*cache:/m);`
   - `expect(publish).not.toMatch(/^[ -]*cache-dependency-path:/m);`
   `^[ -]*cache:` does not match `package-manager-cache:`, because letters precede `cache` there.
4. **Job comment.** The three-line comment above `publish:` (`.github/workflows/publish.yml:46-48`) gains two lines after `verify tested (same release commit) [BUG-073].`: `# Its setup-node step turns the package-manager cache off explicitly, so a packageManager` and `# field in package.json can never make this job restore verify's cache [BUG-083].` Both at the 2-space indent of the existing lines.
5. **Red and green measured before writing this plan** (HEAD `59f8709`). A throwaway test file (deleted) with the helper and the assertions of decision 3, run against the current `publish.yml` text and against edited copies of it, gave: today's text **red** (`expected +0 to be 1`); text with the new line **green**; the new line plus `cache: 'npm'` **red** (`not to match /^[ -]*cache:/m`); the line with `true` **red** (`to match /^ {10}package-manager-cache: false$/m`). The same run confirmed `verify` still holds `^ {10}cache: 'npm'$`.
6. **`.gitignore` leaf.** `!/docs/superpowers/plans/2026-11-19-bug083-publish-job-relies-on-omitted-cache-key.md` goes after the `2026-11-18-bug086` plan leaf, its sorted position. `tests/unit/gitignore-block-parity.test.js` checks it.

## Baseline (measured on this branch, HEAD 59f8709)

- `npx vitest run tests/installer/workflow.test.js`: **31 passed (31)**.
- `tools/skip-baseline.json` lists no `tests/installer/workflow.test.js` test on any leg.
- `npx vitest run` (full suite, this sandbox): **5 failed, 3442 passed, 27 skipped (3474)**, all ENV and none in a file this plan touches. Three need an unreadable or read-only path, which the sandbox's uid 0 can always read or write: `tests/hooks/context-guard.test.js` "unreadable threshold file — fallback 25", `tests/hooks/verbosity-remind.test.js` "row13: unreadable project hook -> global retains authority", `tests/scripts/conductor-db.test.js` "degrades to exit 0 without throwing when the db dir is read-only". Two expect `git add -u <untracked>` to exit 128, which the sandbox's git 2.43.0 does not: `tests/unit/staging-convention.test.js` AC7 and AC8. T-301 expects exactly this set and nothing more.

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-19-bug083-publish-job-relies-on-omitted-cache-key.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file from the approved spec `c0472396…`. No dependency.
- [X] [T-002] `.gitignore`: insert the leaf `!/docs/superpowers/plans/2026-11-19-bug083-publish-job-relies-on-omitted-cache-key.md` after the `2026-11-18-bug086` plan leaf (plan decision 6). Depends on T-001.
- [ ] [T-003] Stage: `git add -u .gitignore` (tracked) and `git add docs/superpowers/plans/2026-11-19-bug083-publish-job-relies-on-omitted-cache-key.md` (new, re-included by its leaf). Depends on T-002.
- [ ] [T-004] Commit: `docs: plan the explicit package-manager-cache opt-out for the publish job [BUG-083]`. Depends on T-003.

---

### Task 1: Test first (red)

**Files:**
- Modify: `tests/installer/workflow.test.js:37-39`, `tests/installer/workflow.test.js:99-102`

- [ ] [T-101] Add the `step(block, action)` helper after `permissions()` (plan decision 1). Depends on T-004.
- [ ] [T-102] Rename the `it` at lines 99-102 and replace its body with the assertions of plan decision 3 (plan decision 2). Depends on T-101.
- [ ] [T-103] Red run: `npx vitest run tests/installer/workflow.test.js`. The filter is the whole file and the test count is unchanged (one `it` replaced), so its full match set is the 31 baseline tests. Predicted: **1 failed, 30 passed (31)**. The failure is the renamed test, at the exactly-one count (`expected +0 to be 1`) (spec, AC4). Any other count or failing line means the helper or an assertion is wrong: fix the test, not the prediction. Depends on T-102.

---

### Task 2: Disable the cache in the publish job (green)

**Files:**
- Modify: `.github/workflows/publish.yml:46-48`, `.github/workflows/publish.yml:60-63`

- [ ] [T-201] Insert `          package-manager-cache: false` (10-space indent) after `          registry-url: 'https://registry.npmjs.org'` in the `publish` job's `setup-node` step. Depends on T-103.
- [ ] [T-202] Append the two comment lines of plan decision 4 to the comment above `publish:`. Depends on T-201.
- [ ] [T-203] Green run: the T-103 command. Predicted: **31 passed (31)**, so the other 30 tests, including "uses only checkout and setup-node" and the exact `runs(publish)` list, pass unchanged (spec, AC6). Depends on T-202.
- [ ] [T-204] Scratch check for an explicit cache (spec, AC5): add `          cache: 'npm'` after the new line, run the T-103 command, expect **1 failed, 30 passed (31)** with the renamed test failing at `not.toMatch(/^[ -]*cache:/m)`, then remove the scratch line and confirm `git diff -U0 HEAD -- .github/workflows/publish.yml` shows only the T-201 and T-202 additions. Depends on T-203.

---

### Task 3: Full suite, scope check and commit

**Files:**
- Modify: `.github/workflows/publish.yml`, `tests/installer/workflow.test.js` (staged), this plan (checkboxes)

- [ ] [T-301] Run `npm test`. Predicted: every file green except the five ENV failures listed under Baseline, which stay exactly as measured on HEAD `59f8709`; on CI, where neither cause applies, exit 0 (spec, AC7). The workflow test runs on every CI leg and is not skipped, so `tools/skip-baseline.json` stays untouched. A failure caused by the sandbox (network, tmp permissions, missing `node:sqlite`) is reported as ENV with the test's name and checked against the baseline run on HEAD `59f8709`. Any other red is fixed. Depends on T-204.
- [ ] [T-302] Scope check:
  - `git status --porcelain` lists exactly `.github/workflows/publish.yml`, `tests/installer/workflow.test.js` and this plan as modified.
  - `git diff -U0 HEAD -- .github/workflows/publish.yml | grep '^-[^-]'` prints nothing (additions only), and the `verify` job's lines are not in the diff (spec, AC1, AC2).
  - `git diff -U0 HEAD -- tests/installer/workflow.test.js | grep '^-[^-]'` shows only the old `it` title line and the old `registry-url` / `not.toMatch(/cache/)` lines.
  - `git diff --quiet HEAD -- VERSION CHANGELOG.md package.json package-lock.json README.md "AGENT-READABLE BACKLOG.md" .claude tools lib bin scripts .github/workflows/test.yml .github/workflows/records-guard.yml .github/workflows/wiki-sync.yml` exits 0.
  - Depends on T-301.
- [ ] [T-303] Stage: `git add -u .github/workflows/publish.yml tests/installer/workflow.test.js` (both tracked). Depends on T-302.
- [ ] [T-304] Stage: `git add -u docs/superpowers/plans/2026-11-19-bug083-publish-job-relies-on-omitted-cache-key.md` (carries the ticks for T-101 to T-303). Depends on T-303.
- [ ] [T-305] Commit: `fix: disable the setup-node package-manager cache explicitly in the publish job [BUG-083]`. Depends on T-304.

---

## Test List

- [ ] Unit, AC3-AC4: the renamed test pins exactly one `package-manager-cache: false` line in the `setup-node` step and no `cache:` or `cache-dependency-path:` input in the `publish` job. Red before T-201 (T-103), green after (T-203).
- [ ] Unit, AC5: the same test is red with a scratch `cache: 'npm'` in the step (T-204).
- [ ] Unit, AC6: the other 30 tests in `tests/installer/workflow.test.js` pass unchanged (T-203).
- [ ] AC7: `npm test` green (T-301).
- [ ] No integration or E2E/UI test: the workflow runs only on a published release, and there is no UI.

## Commit Order

1. Task 0 (T-004): this plan and its `.gitignore` leaf.
2. Task 3 (T-305): the test, the workflow change and the plan ticks for T-101 to T-303, in one commit, so no commit has a red suite. The red run in T-103 happens in the working tree before the fix. The ticks for T-304, T-305 and the Test List ride a closeout commit.

## Identified Risks

- **setup-node drops or renames the input.** GitHub would warn "Unexpected input" and the job would fall back to today's implicit protection; the YAML-only test cannot see that (spec, Error cases). Catch: the input is documented in the `@v7` README; a future major bump of `actions/setup-node` should re-check it.
- **Step indent changes.** If the workflow is ever re-indented, `step()` returns `''` and the test fails loudly at the registry assertion rather than passing silently, because every positive assertion runs against the step text.
- **Records guard.** The PR touches none of the owner-side records, so `tools/records-guard.mjs` has nothing to flag. Catch: T-302's `git diff --quiet` line.
- **Full suite in this sandbox.** Some suites need `node:sqlite` or network. Catch: T-301 compares any red against the baseline run on the same HEAD before calling it ENV.
