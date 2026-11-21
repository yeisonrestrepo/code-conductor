# BUG-070 GitHub Actions pinned by commit SHA in every workflow implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** Pin the eleven `uses:` references in `.github/workflows/{records-guard,test,publish,wiki-sync}.yml` to full commit SHAs with the release as a trailing comment, adapt `tests/tools/records-guard.test.js` to the new form, and pin the form for every workflow in `tests/installer/workflow.test.js`.

**Spec:** `docs/superpowers/specs/2026-11-20-bug070-github-actions-pinned-by-tag-instead-of-commit-design.md` (sha256 `a21e62cfaa34a76b85b555d28459bb0858896a5cc71f31aa0dcdf2bd6c4c232c`), approach A. Issue #163.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines (including the `[BUG-070]` entry at `README.md:500`) stay untouched (spec, Out of Scope).
- **Owner-applied.** The lane App has no Workflows permission, so the lane run for this item was aborted and the owner's session applies the whole item, workflow commit included, on this branch.
- **Workflows: value only.** In the four workflow files only the text after `@` on the eleven listed lines changes. No other line, input, comment or indentation (spec, Solution, AC1).
- **One action, one SHA:** `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`, `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0`, `actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0`, everywhere.
- No new dependency, no YAML parser: the tests read the workflow text line by line, like the existing helpers.
- Every file this plan edits after Task 0 is tracked, so every staging step is `git add -u <path>` with an explicit path.

## Review Focus

- **A pin that drifts back to a tag, a short SHA or a missing comment.** Pinned by the shape assertion in T-102, measured red against today's files in T-103.
- **One workflow bumped and another not.** Pinned by the one-pair-per-action assertion in T-102, measured red with a scratch SHA in T-204.
- **A vacuous pass.** If the line filter matched nothing, both assertions would pass on an empty list; T-102 asserts the list and the pair map are non-empty, and T-103 is red at that assertion for the pair test.
- **Comment lines.** The `uses:` filter requires `uses:` to be the first token after optional `- `, so a `# uses: ...` comment never enters the list.

## Plan decisions

1. **`usesValues` in `tests/tools/records-guard.test.js:502`** keeps its shape and gains an optional trailing `(?:\s+#\s*(v\d+\.\d+\.\d+))?` group; a matched comment is kept in the value as `<ref> # <version>`, so the "same value in test.yml" check compares SHA and comment together.
2. **The row at `tests/tools/records-guard.test.js:513`** is renamed `'uses the same action majors as test.yml, pinned by commit SHA [BUG-070]'`. It maps each value through `^(actions\/(?:checkout|setup-node))@[0-9a-f]{40} # v7\.\d+\.\d+$` and expects exactly `['actions/checkout', 'actions/setup-node']`; a third action, a tag or a different major yields a different array. The `test.yml` loop is unchanged.
3. **New describe in `tests/installer/workflow.test.js`**, appended at the end of the file, with `readdirSync` added to the `node:fs` import. It reads every `*.yml`/`*.yaml` in `.github/workflows/`, keeps lines matching `^\s*(?:-\s+)?uses:`, and checks each trimmed line against `^(?:-\s+)?uses: ([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([0-9a-f]{40}) # (v\d+\.\d+\.\d+)$`. Two `it`s: the shape (non-empty list, no offending line, offenders listed as `<file>: <line>` so a failure names them) and one pair per action (non-empty map, no action with two pairs).
4. **Workflow edit** by three anchored substitutions, one per action, each matching `uses: actions/<name>@v<N>$` so nothing else in the files can match.
5. **Red measured before writing this plan** (HEAD `6228474`, eleven pins applied to a scratch tree, then reverted): `tests/tools/records-guard.test.js` "uses the same action majors as test.yml" failed with `expected Set{} to deeply equal Set{ 'actions/checkout@v7', …(1) }`, 1 failed and 156 passed across the three workflow test files; the decision-1/2 version of the row passed against the pinned tree (104 passed).
6. **`.gitignore` leaf.** `!/docs/superpowers/plans/2026-11-20-bug070-github-actions-pinned-by-tag-instead-of-commit.md` goes after the `2026-11-20-bug059` plan leaf, its sorted position.

## Baseline (measured on `main`, HEAD 6228474)

- `npx vitest run tests/tools/records-guard.test.js tests/installer/workflow.test.js tests/wiki/wiki-gen.test.js`: **157 passed (157)**.
- `npx vitest run` (full suite, this sandbox): **5 failed, 3540 passed, 28 skipped (3573)**, all ENV and none in a file this plan touches; the same five the BUG-083 plan recorded. Three need an unreadable or read-only path, which the sandbox's uid 0 can always read or write: `tests/hooks/context-guard.test.js` "unreadable threshold file — fallback 25", `tests/hooks/verbosity-remind.test.js` "row13: unreadable project hook -> global retains authority", `tests/scripts/conductor-db.test.js` "degrades to exit 0 without throwing when the db dir is read-only". Two expect `git add -u <untracked>` to exit 128, which the sandbox's git does not: `tests/unit/staging-convention.test.js` AC7 and AC8. T-301 expects exactly this set and nothing more.

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-20-bug070-github-actions-pinned-by-tag-instead-of-commit.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file from the approved spec. No dependency.
- [X] [T-002] `.gitignore`: insert the plan leaf (plan decision 6). Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` and `git add` this plan (new, re-included by its leaf). Depends on T-002.
- [X] [T-004] Commit: `docs: plan pinning GitHub Actions by commit SHA in every workflow [BUG-070]`. Depends on T-003.

---

### Task 1: Tests first (red)

**Files:**
- Modify: `tests/tools/records-guard.test.js:502`, `tests/tools/records-guard.test.js:513-518`, `tests/installer/workflow.test.js:2`, end of `tests/installer/workflow.test.js`

- [ ] [T-101] Change `usesValues` and the row (plan decisions 1 and 2). Depends on T-004.
- [ ] [T-102] Add the `[BUG-070]` describe and the `readdirSync` import (plan decision 3). Depends on T-101.
- [ ] [T-103] Red run: `npx vitest run tests/tools/records-guard.test.js tests/installer/workflow.test.js tests/wiki/wiki-gen.test.js`. Predicted: **3 failed**, the renamed records-guard row and both new `[BUG-070]` tests, and every other test passing (spec, AC3). Depends on T-102.

---

### Task 2: Pin the workflows (green)

**Files:**
- Modify: `.github/workflows/records-guard.yml:23,30`, `.github/workflows/test.yml:32,34,41`, `.github/workflows/publish.yml:18,19,60,63`, `.github/workflows/wiki-sync.yml:38,40`

- [ ] [T-201] Apply the three substitutions of plan decision 4. Depends on T-103.
- [ ] [T-202] Green run: the T-103 command. Predicted: **0 failed** (spec, AC2, AC3, AC5). Depends on T-201.
- [ ] [T-203] Regression check for AC2: set `records-guard.yml:23` back to `actions/checkout@v7`, run `npx vitest run tests/tools/records-guard.test.js`, expect the renamed row red, then restore. Depends on T-202.
- [ ] [T-204] Scratch check for AC4: change the SHA on `wiki-sync.yml:38` to forty `0`s, run `npx vitest run tests/installer/workflow.test.js`, expect only the one-pair-per-action test red, then restore and confirm `git diff --stat` still shows eleven lines changed in the workflows. Depends on T-203.

---

### Task 3: Full suite, scope check and commit

**Files:**
- Modify: the four workflows and two test files (staged), this plan (checkboxes)

- [ ] [T-301] Run `npm test`. Predicted: the same failures as the Baseline and no others (spec, AC6). Depends on T-204.
- [ ] [T-302] Scope check:
  - `git status --porcelain` lists exactly the four workflows, the two test files and this plan.
  - `git diff -U0 HEAD -- .github/workflows | grep -c '^[-+] '` prints `22`, and every removed/added pair differs only after `@` (spec, AC1).
  - `git diff --quiet HEAD -- VERSION CHANGELOG.md package.json package-lock.json README.md "AGENT-READABLE BACKLOG.md" .claude tools lib bin scripts` exits 0.
  - Depends on T-301.
- [ ] [T-303] Stage: `git add -u` with the six explicit paths and this plan. Depends on T-302.
- [ ] [T-304] Commit: `fix: pin GitHub Actions by commit SHA in every workflow [BUG-070]`. Depends on T-303.

---

## Test List

- [ ] Unit, AC2: the renamed records-guard row passes on the pins and is red on a restored `@v7` (T-202, T-203).
- [ ] Unit, AC3: the `[BUG-070]` describe is red on today's files (T-103) and green after (T-202).
- [ ] Unit, AC4: the one-pair test is red with a scratch SHA (T-204).
- [ ] Unit, AC5: every other test in the three workflow test files passes unchanged (T-202).
- [ ] AC6: `npm test` matches the baseline (T-301).
- [ ] No integration or E2E test: the pins are exercised by the next CI run of each workflow, and there is no UI.

## Commit Order

1. Task 0 (T-004): this plan and its `.gitignore` leaf.
2. Task 3 (T-304): the tests, the workflow pins and the plan ticks, in one commit, so no commit has a red suite. The red run in T-103 happens in the working tree before the fix.

## Identified Risks

- **A pinned commit becomes unreachable upstream.** The job fails at action download, loudly; re-resolve with `git ls-remote` and bump all files together.
- **Comment drift.** The test does not prove the comment names the SHA's tag (spec, Error cases). Catch: re-run the `git ls-remote` of the spec when bumping.
- **Full suite in this sandbox.** Some suites depend on uid, git version or network. Catch: T-301 compares against the Baseline on the same HEAD.
