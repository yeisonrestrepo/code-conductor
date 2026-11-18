# BUG-082 unattended plan check does not escalate tasks that write nested CLAUDE.md files implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** In `inControlPlane` (`scripts/orchestrate.mjs`), also escalate with the control-plane reason any plan **Files:** entry whose last segment can name `claude.md`, `claude.local.md`, `package.json`, `package-lock.json`, `npm-shrinkwrap.json` or `.npmrc` at any depth (spec rules 1 and 2). The six names live in a new exported constant `CONTROL_PLANE_NAMES`, pinned by a test. Move `docs/CLAUDE.md` out of U43 and four rows out of U48, and add the U52-U54 rows for AC1-AC4.

**Spec:** `docs/superpowers/specs/2026-11-18-bug082-unattended-plan-check-does-not-escalate-tasks-design.md` (sha256 `665fb408c79caa18763ec18d6e30d8edc4ef66d6e685f7349e7e12a04cdb50d4`). Issue #230.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>` and `-t <pattern>`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines stay untouched (spec, Out of Scope).
- **One constant, one helper, one disjunct.** In `scripts/orchestrate.mjs` the only changes are: one comment line in the block above `CONTROL_PLANE`, the new `CONTROL_PLANE_NAMES` constant right after `CONTROL_PLANE`, a `namesControlFile` helper with its comment above `inControlPlane`, and a second disjunct in `inControlPlane`. `CONTROL_PLANE`, `WRITE_SURFACE`, `globToRegExp`, `reachesDir`, `reachesList`, `taskGlob`, `ntfsAlias`, `nonAscii`, `inSurface`, `surfaceTask`, `extractTasks` and both reason texts stay as shipped (spec, Solution).
- **Pins unchanged.** The `WRITE_SURFACE` and `CONTROL_PLANE` pin tests stay byte-identical (AC5). The new pin is a separate `it` after the `CONTROL_PLANE` pin (AC5b).
- **Existing rows.** In the test file, the only removed lines are `docs/CLAUDE.md` in U43 and `tools/package.json`, `src/package.json` (with their `[BUG-082]` comments), `docs/.npmrc` and `tools/package-lock.json` in U48 (AC3, AC3b, AC5). `expectEscalation`, U41, U42 and U44-U51 are otherwise not edited.
- **Hook untouched.** `.claude/hooks/pre-tool-use.mjs`, `project-template/**` and the installer are not edited (spec, Out of Scope). No workflow file is written.
- No new dependency, no network, no settings, command or SNAP-script change; `tools/skip-baseline.json` untouched.
- Every file this plan edits after Task 0 (`scripts/orchestrate.mjs`, `tests/scripts/orchestrate.test.js`, this plan) is tracked, so every staging step is `git add -u <path>` with an explicit path.

## Plan decisions

1. **Code shape.** Read at `scripts/orchestrate.mjs:23-45` and `:1052-1100` (HEAD `1cf894f`).
   - Above `export const CONTROL_PLANE = [`, after the `// Owner decision (BUG-081): …` line, add:

     ```js
     // Owner decision (BUG-082): a CLAUDE.md or an npm manifest also reaches it at any depth, by its last segment (CONTROL_PLANE_NAMES).
     ```
   - Right after the `CONTROL_PLANE` closing `];`, add:

     ```js
     export const CONTROL_PLANE_NAMES = ['claude.md', 'claude.local.md', 'package.json', 'package-lock.json', 'npm-shrinkwrap.json', '.npmrc'];
     ```
   - Above the existing `// No alias or non-ASCII test: …` comment (which stays attached to `inControlPlane`), add:

     ```js
     // A path the glob matches ends in a segment its last segment matches, except that a `**` there can span a `/`;
     // then only the text after the last `**` has to match the end of the file name (BUG-082).
     function namesControlFile(glob) {
       const last = glob.slice(glob.lastIndexOf('/') + 1);
       const tail = last.includes('**') ? `**${last.slice(last.lastIndexOf('**') + 2)}` : last;
       return CONTROL_PLANE_NAMES.some((name) => globToRegExp(tail).test(name));
     }
     ```

     Rule 1 is the `last` branch, rule 2 the `**` branch; an empty last segment (`src/`) builds `^$`, which matches no name (spec, Error cases).
   - `inControlPlane` becomes:

     ```js
     const inControlPlane = (entry) => reachesList(taskGlob(entry), CONTROL_PLANE) || namesControlFile(taskGlob(entry));
     ```
2. **Constant name.** The spec asks for "one new exported constant next to `CONTROL_PLANE`" without naming it. `CONTROL_PLANE_NAMES` says what it holds (file names, not paths) and which list it extends; the pin test reads it as `orchestrateModule.CONTROL_PLANE_NAMES`, like the `CONTROL_PLANE` pin.
3. **Test blocks.** Three `it.each` blocks go right after U51 (`tests/scripts/orchestrate.test.js`, ends near line 3798), inside the same `describe`, after one comment line: `// BUG-082: a CLAUDE.md or npm manifest at any depth reaches the control plane, also through a glob that can name it.`
   - **U52** (AC1, AC2, AC3b escalations, 32 rows): `expectEscalation(path, 'control-plane files')`.
   - **U53** (AC3, AC3b near misses, 15 rows): the U43/U48/U51 approve body verbatim.
   - **U54** (AC4, 3 rows): `expectEscalation(path, 'orchestrator write surface')`, with `%j` in the name so the U+200B row is visible; that row is written `'src/CLAUDE​.md'` (escape, as U50 does).
   - The `./` rows (`./src/CLAUDE.md`, `./packages/a/package.json`) need no special helper: `expectEscalation` drops the leading `./` from the reason, as for U47 and U50.
4. **Pin test.** After the `CONTROL_PLANE` pin (ends near line 496): `it('[BUG-082] CONTROL_PLANE_NAMES declares exactly the file names that reach the control plane at any depth', () => { expect(orchestrateModule.CONTROL_PLANE_NAMES).toEqual(['claude.md', 'claude.local.md', 'package.json', 'package-lock.json', 'npm-shrinkwrap.json', '.npmrc']); });`
5. **Every count measured before writing this plan.** On a throwaway copy of the tree (deleted), with the rows of plan decision 3, the pin, and the five row removals applied:
   - with the shipped `scripts/orchestrate.mjs`, `npx vitest run tests/scripts/orchestrate.test.js -t "BUG-082"` gave **33 failed, 18 passed, 784 skipped (835)**: the 32 U52 rows (they approve today) and the pin (the constant is `undefined`) fail; the 15 U53 and 3 U54 rows pass;
   - with the code of plan decision 1, the same command gave **51 passed, 784 skipped (835)**;
   - with the code of plan decision 1, `npx vitest run tests/scripts/orchestrate.test.js -t "BUG-080|BUG-081|BUG-086|U22 |write surface|FEAT-054"` gave **308 passed, 527 skipped (835)**, no failure, so no other row of U41-U51 starts to escalate.
   The file holds 789 tests at HEAD; the change adds 51 and removes 5 (835).
6. **One commit.** Tests and code land together (Task 3): a tests-only commit would be red. The red run in T-105 happens in the working tree before the code edit.
7. **`.gitignore` leaf.** `!/docs/superpowers/plans/2026-11-18-bug082-unattended-plan-check-does-not-escalate-tasks.md` goes after the `2026-11-15-bug081` plan leaf and before the `2026-11-18-bug084` plan leaf, the sorted position; `tests/unit/gitignore-block-parity.test.js` checks it.

## Test rows

### U52 (AC1, AC2, AC3b): escalate with the control-plane reason (32 rows)

- Nested instruction files (AC1): `docs/CLAUDE.md`, `src/CLAUDE.md`, `src/CLAUDE.local.md`, `packages/a/b/CLAUDE.md`, `src/.claude/CLAUDE.md`, `project-template/docs/CLAUDE.md`, `./src/CLAUDE.md`, `Src/Claude.MD`.
- Globs (AC2): `src/**/CLAUDE.md`, `src/*/CLAUDE.md`, `src/*.md`, `src/*`, `src/**`, `src/CLAUDE*`, `src/**.md`, `src/a**`, `src/c*.local.md`.
- Nested manifests (AC3b): `tools/package.json`, `src/package.json`, `tools/package-lock.json`, `docs/.npmrc`, `packages/a/package.json`, `packages/a/b/package-lock.json`, `tools/npm-shrinkwrap.json`, `tools/.npmrc`, `packages/*/package.json`, `packages/**`, `packages/*/*.json`, `tools/.npm*`, `Packages/A/Package.JSON`, `Tools/.NPMRC`, `./packages/a/package.json`.

### U53 (AC3, AC3b): near misses keep the delegated APPROVE (15 rows)

`src/CLAUDE.md.bak`, `src/CLAUDE.mdx`, `src/xCLAUDE.md`, `src/CLAUDE.md/x.js`, `src/notes.md`, `src/**.js`, `src/**/x.js`, `docs/CLAUDE.local.md.example`, `src/claude-md`, `src/package.json.bak`, `src/package.jsonc`, `src/xpackage.json`, `docs/npmrc`, `src/package-lock.json.orig`, `src/package.json/x.js`. (`.npmrc.example` stays in U48.)

### U54 (AC4): write-surface reason first (3 rows)

`'**/CLAUDE.md'`, `'src/CLAUDE.md.'`, `'src/CLAUDE​.md'`.

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-18-bug082-unattended-plan-check-does-not-escalate-tasks.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file from the approved spec `dd991eb1…`. No dependency.
- [X] [T-002] `.gitignore`: insert the leaf `!/docs/superpowers/plans/2026-11-18-bug082-unattended-plan-check-does-not-escalate-tasks.md` after the `2026-11-15-bug081` plan leaf (plan decision 7). Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` (tracked) and `git add docs/superpowers/plans/2026-11-18-bug082-unattended-plan-check-does-not-escalate-tasks.md` (new; re-included by its leaf, so no ignored ancestor applies). Depends on T-002.
- [X] [T-004] Commit: `docs: plan the any-depth CLAUDE.md and manifest escalation for the unattended plan check [BUG-082]`. Depends on T-003.

---

### Task 1: Tests first (red)

**Files:**
- Modify: `tests/scripts/orchestrate.test.js`

- [X] [T-101] Add the `CONTROL_PLANE_NAMES` pin test of plan decision 4 after the `CONTROL_PLANE` pin, as its own `it`, leaving the `CONTROL_PLANE` pin byte-identical. Depends on T-004.
- [X] [T-102] U43: delete the `'docs/CLAUDE.md',` row; every other U43 row stays (AC3). Depends on T-101.
- [X] [T-103] U48: delete the rows `'tools/package.json', // [BUG-082]: …`, `'docs/.npmrc',`, `'tools/package-lock.json',` and `'src/package.json', // [BUG-082]: …`; `'.npmrc.example',` and the other rows stay (AC3b). Depends on T-102.
- [X] [T-104] After U51, add the comment line and the U52, U53 and U54 blocks of plan decision 3 with the rows of the Test rows section, in that order. Names: `'U52 [BUG-082 AC1 AC2 AC3b] delegate plan over an APPROVE report escalates the nested instruction file or manifest %s with the control-plane reason'`, `'U53 [BUG-082 AC3 AC3b] delegate plan over an APPROVE report approves the nested near miss %s'`, `'U54 [BUG-082 AC4] the nested instruction-file form %j keeps the write-surface reason'`. Depends on T-103.
- [X] [T-105] Red run: `npx vitest run tests/scripts/orchestrate.test.js -t "BUG-082"`. Predicted for the filter's full match set: **33 failed, 18 passed, 784 skipped (835)**. Failing: the 32 U52 rows (approved today) and the `[BUG-082]` pin. Passing: the 15 U53 rows and the 3 U54 rows. No other test name contains `BUG-082` (the U48 `[BUG-082]` comments are gone and were never in a name). Any other count means a row is mistyped: fix the row, not the prediction. Depends on T-104.

---

### Task 2: The any-depth disjunct (green)

**Files:**
- Modify: `scripts/orchestrate.mjs`

- [X] [T-201] Modify `scripts/orchestrate.mjs`: add the `Owner decision (BUG-082)` comment line above `CONTROL_PLANE` and the `CONTROL_PLANE_NAMES` constant right after its `];` (plan decision 1). Depends on T-105.
- [X] [T-202] Add the `namesControlFile` helper and its two comment lines above the `// No alias or non-ASCII test: …` comment (plan decision 1). Depends on T-201.
- [X] [T-203] Modify `inControlPlane` to the two-disjunct form of plan decision 1. Depends on T-202.
- [X] [T-204] Green run: the T-105 command. Predicted: **51 passed, 784 skipped (835)**, no failure. Depends on T-203.
- [X] [T-205] AC5 run: `npx vitest run tests/scripts/orchestrate.test.js -t "BUG-080|BUG-081|BUG-086|U22 |write surface|FEAT-054"`. Predicted: **308 passed, 527 skipped (835)**, no failure (measured in plan decision 5). Depends on T-204.

---

### Task 3: Full suite, scope check and commit

**Files:**
- Modify: `scripts/orchestrate.mjs`, `tests/scripts/orchestrate.test.js` (staged), this plan (checkboxes)

- [X] [T-301] Run `npm test`. Predicted locally: exit 0, every file green (AC6). CI legs run 46 more tests each (51 added, 5 removed), none skipped, so `tools/skip-baseline.json` stays untouched. A failure that comes from the sandbox (network, tmp permissions) is reported as ENV with the test's name; any other red is fixed. Depends on T-205.
- [X] [T-302] Scope check: `git status --porcelain` lists exactly `scripts/orchestrate.mjs`, `tests/scripts/orchestrate.test.js` and this plan as modified; `git diff -U0 HEAD -- tests/scripts/orchestrate.test.js | grep '^-[^-]'` shows exactly the five rows removed in T-102 and T-103; `git diff -U0 HEAD -- scripts/orchestrate.mjs | grep '^-[^-]'` shows exactly one line, the old `inControlPlane`; `git diff --quiet HEAD -- VERSION CHANGELOG.md package.json package-lock.json README.md "AGENT-READABLE BACKLOG.md" .claude .github project-template tools` exits 0. Depends on T-301.
- [X] [T-303] Stage: `git add -u scripts/orchestrate.mjs tests/scripts/orchestrate.test.js` (both tracked). Depends on T-302.
- [X] [T-304] Stage: `git add -u docs/superpowers/plans/2026-11-18-bug082-unattended-plan-check-does-not-escalate-tasks.md` (ticks T-101 to T-303). Depends on T-303.
- [X] [T-305] Commit: `fix: escalate nested CLAUDE.md and npm manifests in the unattended plan check [BUG-082]`. Depends on T-304.

---

## Test List

- [X] Integration, AC1: U52 nested `CLAUDE.md` / `CLAUDE.local.md` rows, including `./` and mixed-case forms, escalate with the control-plane reason; `approvals.plan` stays `null`, `delegated.plan` records the verdict and reason, and the owner's `approve plan` exits 0 (`expectEscalation`; T-104).
- [X] Integration, AC2: U52 glob rows that can name such a file escalate (T-104).
- [X] Integration, AC3: `docs/CLAUDE.md` leaves U43 (T-102); U53 near misses approve (T-104).
- [X] Integration, AC3b: U52 nested-manifest rows escalate, the four U48 rows leave it (T-103), U53 manifest near misses approve, `.npmrc.example` stays in U48.
- [X] Integration, AC4: U54 rows keep the write-surface reason (T-104).
- [X] Unit, AC5b: the `CONTROL_PLANE_NAMES` pin (T-101).
- [X] AC5: `CONTROL_PLANE` and `WRITE_SURFACE` pins and U41, U42, U44-U51 unchanged and green (T-205, T-302).
- [X] AC6: `npm test` green (T-301).
- [X] No E2E/UI test: there is no UI.

## Commit Order

0. Task 0: this plan and its `.gitignore` leaf (done by this session's commit).
1. Tasks 1-3: one commit, T-305, carrying the constant, the helper, the tests and the ticks T-101 to T-303 (plan decision 6). Tasks 1 and 2 have no commit of their own: a tests-only commit would be red. The ticks of T-304 and T-305 are made after the last commit and ride whichever commit next stages this plan.

## Identified Risks

- **Rule 2 is wrong at the edge.** Taking the text after the *first* `**`, or dropping the `**` prefix, makes `src/a**` approve or `src/**.js` escalate; U52 and U53 both carry such rows, so T-204 fails on either mistake.
- **The helper runs on `entry` instead of `taskGlob(entry)`.** Then `Src/Claude.MD`, `Packages/A/Package.JSON` and `Tools/.NPMRC` approve; the U52 rows fail in T-204.
- **An approve row elsewhere starts to escalate.** Any other test whose delegated plan declares a nested `CLAUDE.md` or manifest would now escalate. The measured T-205 run covers every delegated-plan block of the file; T-301 covers the rest of the suite.
- **Friction on later items.** Any unattended plan that declares a workspace `package.json` or a directory glob such as `src/**` now waits for the owner. The spec accepts that cost (Choices, "What matches at any depth").
- **This item's own plan.** `scripts/orchestrate.mjs` is a `CONTROL_PLANE` entry, so an unattended review of this plan escalates; that is expected.
- **Line numbers drift.** References are from HEAD `1cf894f`; locate by the quoted text if they move.

## Deviations

- The run ended after the build audit; tests and security review run on the pull request (CI and the security gate).
