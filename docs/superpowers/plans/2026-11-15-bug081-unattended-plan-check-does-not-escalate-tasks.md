# BUG-081 unattended plan check does not escalate tasks that write git hooks, MCP config, CI workflows and package lifecycle scripts implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** Append the fourteen outside-the-run entries the approved spec lists to `CONTROL_PLANE` in `scripts/orchestrate.mjs`, update the pin test to the new array, and add the test rows for AC2-AC5. No logic changes: the reach rule, `inControlPlane`, `surfaceTask` and the reason text stay as BUG-080 shipped them.

**Spec:** `docs/superpowers/specs/2026-11-15-bug081-unattended-plan-check-does-not-escalate-tasks-design.md` (sha256 `09e31928624b1e45d827bf24c5309b5ba4d40e401bca621f6bbdd26b46ea5381`). Issue #231.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>` and `-t <pattern>`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines (including the `[BUG-081]` entry) stay untouched (spec, Out of Scope).
- **Data only.** The only code edit is the `CONTROL_PLANE` array and the comment above it. `WRITE_SURFACE`, `globToRegExp`, `reachesDir`, `reachesList`, `taskGlob`, `ntfsAlias`, `inSurface`, `inControlPlane` and `surfaceTask` stay unchanged (spec, Out of Scope; AC6).
- **Hook untouched.** `.claude/hooks/pre-tool-use.mjs` and `project-template/.claude/hooks/pre-tool-use.mjs` are not edited (Owner Decision 9). `[BUG-070]`, `[BUG-082]` and `[BUG-083]` are not folded in (Owner Decision 8).
- **Existing rows unchanged.** U22 and U41-U45 are not edited (AC5). The only existing test line that changes is the `CONTROL_PLANE` pin (AC1).
- **No workflow written.** `.github/workflows/` and `.github/actions/` are only named as strings in a constant and in test rows; no file under them is created or edited.
- No new dependency, no network, no installer, settings, command or SNAP-script change; `tools/skip-baseline.json` untouched.
- Every file this plan edits after Task 0 (`scripts/orchestrate.mjs`, `tests/scripts/orchestrate.test.js`, this plan) is tracked, so every staging step is `git add -u <path>` with an explicit path.

## Plan decisions

1. **Order of the list (Owner Decision 5).** The BUG-080 entries keep their order; the fourteen new entries follow `'.claude/scripts/**'` in exactly the order of the spec's "Resulting list", in one group headed by a one-line comment. The pin test moves to that exact array in the same commit, so the pin and the constant are never out of step on any commit.
2. **Reach rule confirmed (spec, Files Requiring Full Read).** Read at `scripts/orchestrate.mjs:1047-1093`. `globToRegExp` maps `*` to `[^/]*`, which matches a leading `.`, so `*.json` matches the fixed entries `package.json`, `.mcp.json`, `opencode.json` and `package-lock.json`, and `.*/config`, `*/workflows/x.yml`, `*/hooks/pre-commit` and `**/package.json` reach `.conductor/**` in `WRITE_SURFACE` first (write-surface reason). `?` is escaped as a literal, so the rows use only `*` and `**` as glob characters. The reason names the entry as the plan declared it (`t.files.find`), before case folding and `./` stripping, which is why `expectEscalation(path, …)` can build the reason from the row literal.
3. **Every row measured before writing this plan.** A throwaway script (deleted) evaluated the shipped `globToRegExp` … `inSurface` source against `WRITE_SURFACE` and both the current and the new `CONTROL_PLANE`, for every row in the tables below. Result: every U46/U47 row is `OK` (approved) on the current list and control-plane on the new one; every U48 row is approved on both; every U49 row is write surface on both; the existing U43 near misses and U44 rows are unchanged under the new list.
4. **Test placement and helpers.** The four new `it.each` blocks go right after U45 (`tests/scripts/orchestrate.test.js:3642-3649`), inside `describe('unattended mode [FEAT-054]')`, as U46-U49. U46, U47 and U49 call the existing `expectEscalation(path, list)` (line 3555). U48 repeats the four-line U43 body (`atPlan`, `plan`, `delegateDoc`, `approvals.plan.by`) rather than extracting a helper, because extracting one would edit U43, which AC5 keeps byte for byte.
5. **One commit.** Tests and constant land together (Task 3), because AC1 ties the pin to the constant and a commit with only the tests would be red. The red run in T-106 happens in the working tree before the constant edit.
6. **`.gitignore` leaf.** `!/docs/superpowers/plans/2026-11-15-bug081-unattended-plan-check-does-not-escalate-tasks.md` is inserted after the `2026-11-14-feat054` plan leaf and before the first spec leaf, the sorted position; `tests/unit/gitignore-block-parity.test.js` checks it.
7. **Approval (Owner Decision 11).** The spec requires an explicit owner approval of this plan, not a delegated one, before the build starts.

## Owner decisions (plan)

1. **Spec approval.** The spec approved at `e9e432b` (sha256 `96a11a22…`) is confirmed as approved by the owner. The owner records it in a separate commit on this branch on top of `ee3c243` (5aa0b68) that changes only the spec's Status line to "Approved 2026-11-15 by the owner" (`docs: record the owner's approval of the BUG-081 spec [BUG-081]`). After that commit the spec hashes `09e31928624b1e45d827bf24c5309b5ba4d40e401bca621f6bbdd26b46ea5381`, the value in the **Spec:** line above. No other spec edit is made.
2. **Plan approval.** The build does not start (T-101) until the owner gives an explicit `approve plan` of this plan, outside any `--unattended` run. A delegated review does not count (Owner Decision 11 of the spec).
3. **Plan confirmed as written at `e9e432b`.** This includes the U46-U49 row counts (14, 51, 20, 4), the T-106 red count `66 failed, 99 passed, 606 skipped (771)` and the single build commit T-305.
4. **Pull request.** The pull request from this branch against `main` opens ready for review, not as a draft.
5. **Issue triage.** Triage of issue #231 (assignee, labels, milestone) happens outside this plan and changes no file in the repository.

## Deviations

Approved by the owner after the build; the plan needs no new `approve`.

1. **Plan decision 2, corrected.** The reason names the entry after the parser strips a leading `./` and a `:line` suffix (`extractTasks`, `scripts/orchestrate.mjs:255`), before case folding. The build therefore changed `expectEscalation` (`tests/scripts/orchestrate.test.js:3563`) to build the reason from `path.replace(/^\.\//, '')`, so the `./` rows of U47 pass. That reason line is the second changed existing line in the test file, beside the pin name line.
2. **T-302, corrected.** `git diff -U0 HEAD -- tests/scripts/orchestrate.test.js | grep '^-[^-]'` shows exactly two lines: the old pin name line and the old `const reason` line of `expectEscalation`. No U22 or U41-U45 line is removed.
3. **Second build commit.** `ee3c243` (`docs: tick the BUG-081 plan test list [BUG-081]`) follows T-305 and carries only the Test List ticks of this plan.

## Baseline (measured on this branch, HEAD 437a3da)

- `npx vitest run tests/scripts/orchestrate.test.js -t "BUG-080|BUG-081|U22 |write surface"`: **76 passed, 606 skipped (682)**, about 71 s. The match set: the `CONTROL_PLANE` pin, U41 (28), U42 (14), U43 (9), U44 (3), U45, the 18 U22 rows and the other `write surface [FEAT-011 AC4]` tests. No test name contains `BUG-081` yet.
- `tools/skip-baseline.json` lists no `tests/scripts/orchestrate.test.js` test on any leg (`ci-node20`, `ci-node24`, `ci-windows-node24`), and the `unattended mode [FEAT-054]` block has no `skipIf`.

## Test rows

### U46 (AC2): one literal per new entry, control-plane reason (14 rows)

`.git/hooks/pre-commit`, `.husky/pre-commit`, `.githooks/pre-commit`, `.mcp.json`, `opencode.json`, `opencode.jsonc`, `.claude/flow-status.mjs`, `project-template/.claude/flow-status.mjs`, `.github/workflows/test.yml`, `.github/actions/setup/action.yml`, `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `.npmrc`.

### U47 (AC3): directory, glob, case and `./` forms, control-plane reason (51 rows)

| New entry | Bare directory | Glob that reaches it | Upper-case spelling | `./` spelling | Other |
|---|---|---|---|---|---|
| `.git/**` | `.git`, `.git/hooks` | `.git/*` | `.GIT/hooks/pre-commit` | `./.git/config` | `.git/config` |
| `.husky/**` | `.husky` | `.hus*/x` | `.HUSKY/Pre-Commit` | `./.husky/pre-commit` | |
| `.githooks/**` | `.githooks` | `.githooks/*` | `.GitHooks/Pre-Commit` | `./.githooks/pre-commit` | |
| `.mcp.json` | | `.mcp.*` | `.MCP.json` | `./.mcp.json` | |
| `opencode.json` | | `opencode.*` | `OpenCode.JSON` | `./opencode.json` | |
| `opencode.jsonc` | | `*.jsonc` | `OpenCode.JSONC` | `./opencode.jsonc` | |
| `.claude/flow-status.mjs` | | `.claude/*.mjs` | `.Claude/Flow-Status.mjs` | `./.claude/flow-status.mjs` | |
| `project-template/.claude/flow-status.mjs` | | `project-template/.claude/flow-*` | `Project-Template/.Claude/Flow-Status.mjs` | `./project-template/.claude/flow-status.mjs` | |
| `.github/workflows/**` | `.github/workflows` | `.github/workflows/*.yml`, `.github/**` | `.GitHub/Workflows/Test.yml` | `./.github/workflows/ci.yml` | `.github/workflows/new.yml` |
| `.github/actions/**` | `.github/actions` | `.github/actions/*/action.yml` | `.GitHub/Actions/Setup/Action.yml` | `./.github/actions/setup/action.yml` | |
| `package.json` | | `*.json` | `Package.JSON` | `./package.json` | |
| `package-lock.json` | | `package-*.json` | `Package-Lock.JSON` | `./package-lock.json` | |
| `npm-shrinkwrap.json` | | `npm-*` | `NPM-Shrinkwrap.JSON` | `./npm-shrinkwrap.json` | |
| `.npmrc` | | `.npm*` | `.NPMRC` | `./.npmrc` | |

Row count: fixed entries: `.mcp.json`, `opencode.json`, `opencode.jsonc`, the two `flow-status.mjs`, `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `.npmrc` (9 entries × 3 forms = 27); directory entries: `.git` 6, `.husky` 4, `.githooks` 4, workflows 6, actions 4 (24). 27 + 24 = 51. Every spelling the spec's AC3 lists is in this table.

### U48 (AC4): near misses approve (20 rows)

`.gitignore`, `.gitattributes`, `.github`, `.github/CODEOWNERS`, `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/bug.yml`, `.github/wiki/Home.md`, `.github/workflowsx/a.yml`, `docs/.git/hooks/x`, `tools/package.json` (comment citing `[BUG-082]`), `mcp.json`, `docs/.mcp.json`, `.huskyx/pre-commit`, `docs/.husky/pre-commit`, `docs/.npmrc`, `.npmrc.example`, `tools/package-lock.json`, `docs/opencode.json`, `.claude/flow-status.md`, `src/package.json` (comment citing `[BUG-082]`).

### U49 (AC5): reaches both lists, write-surface reason (4 rows)

`.*/config`, `*/workflows/x.yml`, `**/package.json`, `*/hooks/pre-commit`.

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-15-bug081-unattended-plan-check-does-not-escalate-tasks.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file from the approved spec `96a11a22…`. No dependency.
- [X] [T-002] `.gitignore`: insert the leaf `!/docs/superpowers/plans/2026-11-15-bug081-unattended-plan-check-does-not-escalate-tasks.md` after the `2026-11-14-feat054` plan leaf (plan decision 6). Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` (tracked) and `git add docs/superpowers/plans/2026-11-15-bug081-unattended-plan-check-does-not-escalate-tasks.md` (new; re-included by its leaf, so no ignored ancestor applies). Depends on T-002.
- [X] [T-004] Commit: `docs: plan the outside-the-run entries for the unattended plan check [BUG-081]`. Depends on T-003.

---

### Task 1: Tests first (red)

**Files:**
- Modify: `tests/scripts/orchestrate.test.js`

- [X] [T-101] Modify the pin at `tests/scripts/orchestrate.test.js:478`: rename it to `'[BUG-080][BUG-081] CONTROL_PLANE declares exactly the control-plane entries the specs list'` and append, after `'.claude/scripts/**',`, the fourteen entries in the spec's "Resulting list" order: `'.git/**', '.husky/**', '.githooks/**', '.mcp.json', 'opencode.json', 'opencode.jsonc',` / `'.claude/flow-status.mjs', 'project-template/.claude/flow-status.mjs',` / `'.github/workflows/**', '.github/actions/**',` / `'package.json', 'package-lock.json', 'npm-shrinkwrap.json', '.npmrc',` (four lines, same layout as the spec). `package.json` is a bare string, no glob (AC1). Depends on T-004.
- [X] [T-102] Add after U45 (ends near line 3649) `it.each([...U46 rows])('U46 [BUG-081 AC2] delegate plan over an APPROVE report escalates a task that declares the outside-the-run file %s', (path) => { expectEscalation(path, 'control-plane files'); });` with the 14 rows of the U46 list. Depends on T-101.
- [X] [T-103] Add after U46 `it.each([...U47 rows])('U47 [BUG-081 AC3] delegate plan escalates the directory, glob, case or ./ form %s with the control-plane reason', (path) => { expectEscalation(path, 'control-plane files'); });` with the 51 rows of the U47 table, grouped by entry in table order. Depends on T-102.
- [X] [T-104] Add after U47 `it.each([...U48 rows])('U48 [BUG-081 AC4] delegate plan over an APPROVE report approves a task that declares the near miss %s', (path) => { … })` with the 20 rows of the U48 list and the U43 body verbatim: `atPlan();`, `plan(\`# Demo Plan\n\n${task(1, ['src/a.js'])}\n${task(2, [path])}\n## Test List\n\`);`, `expect(delegateDoc('plan')).toEqual({ status: 0, out: \`plan approved by delegated review: define_approved, 2 task(s); sha256 ${sha(PLAN)}\`, err: '' });`, `expect(runFile().approvals.plan.by).toBe('define-review');`. The `tools/package.json` and `src/package.json` rows each carry a trailing `// [BUG-082]: nested manifests belong to the any-depth rule` comment (Owner Decision 6). Depends on T-103.
- [X] [T-105] Add after U48 `it.each([...U49 rows])('U49 [BUG-081 AC5] a glob that reaches both lists, %s, keeps the write-surface reason', (path) => { expectEscalation(path, 'orchestrator write surface'); });` with the 4 rows of the U49 list. Depends on T-104.
- [X] [T-106] Red run: `npx vitest run tests/scripts/orchestrate.test.js -t "BUG-080|BUG-081|U22 |write surface"`. Predicted for the filter's full match set: **66 failed, 99 passed, 606 skipped (771)**. Failing: the pin (1, the new array is not in the constant yet), U46 (14) and U47 (51), each approved instead of escalated. Passing: U22 (18), U41 (28), U42 (14), U43 (9), U44 (3), U45 (1), the other `write surface [FEAT-011 AC4]` tests (2), U48 (20, near misses approve on either list) and U49 (4, the write-surface check runs first). Any other count means a row is mistyped: fix the row, not the prediction. Depends on T-105.

---

### Task 2: Extend CONTROL_PLANE (green)

**Files:**
- Modify: `scripts/orchestrate.mjs`

- [X] [T-201] Modify the comment above `CONTROL_PLANE` (`scripts/orchestrate.mjs:23-24`): keep both lines and add a third, `// Owner decision (BUG-081): also the files that run code outside the run, after it ends.` No dependency on the test edits beyond order; depends on T-106.
- [X] [T-202] Modify `CONTROL_PLANE`: after `'.claude/scripts/**',` add the line `// BUG-081: these run code after the run ends (git, MCP and OpenCode servers, the status line, CI, npm).` followed by the same four entry lines as T-101, in the same order. Nothing else in the file changes. Depends on T-201.
- [X] [T-203] Green run: the T-106 command. Predicted: **165 passed, 606 skipped (771)**, no failure. Depends on T-202.
- [X] [T-204] AC6 checks: `git diff --quiet HEAD -- .claude/hooks project-template/.claude/hooks lib` exits 0; `grep -n "^export const WRITE_SURFACE = \[RUN_FILE, ENVELOPE_FILE, '.claude/memory/session-snapshot.json', '.conductor/\*\*'\];" scripts/orchestrate.mjs` gives one match; `npx vitest run tests/hooks/guard6.test.js` gives **30 passed (30)**. Depends on T-203.

---

### Task 3: Full suite, scope check and commit

**Files:**
- Modify: `scripts/orchestrate.mjs`, `tests/scripts/orchestrate.test.js` (staged), this plan (checkboxes)

- [X] [T-301] Run `npm test`. Predicted locally: exit 0, every file green (AC7). CI legs (`ci-node20`, `ci-node24`, `ci-windows-node24`): 89 more tests run on each leg, none skipped, so each leg's skipped set equals its key in `tools/skip-baseline.json` and that file stays untouched. A failure that comes from the sandbox (network, tmp permissions) is reported as ENV with the test's name; any other red is fixed. Depends on T-204.
- [X] [T-302] Scope check: `git status --porcelain` lists exactly `scripts/orchestrate.mjs`, `tests/scripts/orchestrate.test.js` and this plan as modified; `git diff -U0 HEAD -- tests/scripts/orchestrate.test.js | grep '^-[^-]'` shows only the old pin name line (AC5: no U22 or U41-U45 line removed); `git diff -U0 HEAD -- scripts/orchestrate.mjs | grep '^-[^-]'` is empty (only additions); `git diff --quiet HEAD -- VERSION CHANGELOG.md package.json package-lock.json README.md "AGENT-READABLE BACKLOG.md" .claude/memory .github tools` exits 0. Depends on T-301.
- [X] [T-303] Stage: `git add -u scripts/orchestrate.mjs tests/scripts/orchestrate.test.js` (both tracked). Depends on T-302.
- [X] [T-304] Stage: `git add -u docs/superpowers/plans/2026-11-15-bug081-unattended-plan-check-does-not-escalate-tasks.md` (ticks T-101 to T-303). Depends on T-303.
- [X] [T-305] Commit: `fix: escalate unattended plans that write git hooks, MCP config, CI workflows or npm files [BUG-081]`. Depends on T-304.

---

## Test List

- [X] Unit, AC1: the renamed `CONTROL_PLANE` pin in `tests/scripts/orchestrate.test.js` equals the BUG-080 list followed by the fourteen new entries (T-101).
- [X] Integration, AC2: U46, 14 rows, one literal per new entry, with the U41 shape (escalation, `approvals.plan === null`, owner `approve plan` exits 0) (T-102).
- [X] Integration, AC3: U47, 51 rows, the directory, glob, case and `./` forms of the table (T-103).
- [X] Integration, AC4: U48, 20 near-miss rows approve; the two nested-manifest rows cite `[BUG-082]` (T-104).
- [X] Integration, AC5: U49, 4 rows keep the write-surface reason; U22 and U41-U45 unchanged and green (T-105, T-302).
- [X] AC6: `WRITE_SURFACE` pin, hook diff empty, Guard 6 parity suite green (T-204).
- [X] AC7: `npm test` green (T-301).
- [X] No E2E/UI test: there is no UI.

## Commit Order

0. Task 0: this plan and its `.gitignore` leaf (done by this session's commit).
1. Tasks 1-3: one commit, T-305, carrying the constant, the tests and the ticks T-101 to T-303 (plan decision 5). Tasks 1 and 2 have no commit of their own: a tests-only commit would be red. The ticks of T-304 and T-305 are made after the last commit and ride whichever commit next stages this plan.

## Identified Risks

- **A mistyped row reads as a matcher bug.** T-106 predicts the exact red count; a mismatch points at the row list before the constant changes. Every row was evaluated against the shipped matcher (plan decision 3).
- **`*.json` or `*.jsonc` reaching an unintended entry.** The reason names the declared entry, not the list entry it matched, so a glob that matches several fixed entries still yields one deterministic reason; the row passes whichever entry it reaches first.
- **Order drift between pin and constant.** AC1 pins the exact order; T-101 and T-202 copy the same four lines from the spec. A difference fails the pin in T-203.
- **Scope creep.** A reviewer may ask for `.pre-commit-config.yaml`, `.vscode/tasks.json`, nested manifests or a hook mirror. The spec sends them to a follow-up item, `[BUG-082]` and Owner Decision 9; the build reports such a request and does not add them.
- **Friction on later items.** Any unattended plan that edits `package.json` (for example a devDependency bump) now waits for the owner. That is the accepted cost (spec, Decision per path).
- **Run time.** The filtered run takes about 75 s with 89 more CLI-spawning rows; `npm test` in T-301 runs everything once.
- **Line numbers drift.** References are from HEAD `437a3da`; locate by the quoted text if they move.
