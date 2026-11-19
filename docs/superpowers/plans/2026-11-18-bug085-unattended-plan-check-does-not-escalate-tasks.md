# BUG-085 unattended plan check does not escalate tasks that write config-read hook runners, editor and container auto-run files, other package managers or other CI systems implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** In `scripts/orchestrate.mjs`, append the spec's 130 entries to `CONTROL_PLANE` (four families, each under its own comment line) and its 54 package-manager and build-system file names to `CONTROL_PLANE_NAMES`, with the two `Owner decision (BUG-085)` comment lines. No logic change. Update both pin tests and add the U55-U58 rows for AC3-AC6.

**Spec:** `docs/superpowers/specs/2026-11-18-bug085-unattended-plan-check-does-not-escalate-tasks-design.md` (sha256 `ca3ea447c6525af952c80ec49c16027b5746f359c5982d0d9ab065f7027cce04`). Issue #241, follow-up to `[BUG-081]`.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>` and `-t <pattern>`.

**Approval:** the spec's Owner approval section applies to this plan too: the lists are a security-posture boundary and Tasks 1-3 declare `scripts/orchestrate.mjs`, a `CONTROL_PLANE` entry. This plan needs an owner approval, not a delegated one; no delegated verdict and no `--unattended` run approves it.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines stay untouched (spec, Out of Scope).
- **Data only.** In `scripts/orchestrate.mjs` the only changes are: one comment line after the `// Owner decision (BUG-082): …` line; the 130 entries and four family comment lines before the closing `];` of `CONTROL_PLANE`; the one-line `CONTROL_PLANE_NAMES` replaced by the spec's multi-line form with its comment line. `WRITE_SURFACE`, `globToRegExp`, `reachesDir`, `reachesList`, `taskGlob`, `namesControlFile`, `inSurface`, `inControlPlane`, `surfaceTask`, `extractTasks` and both reason texts stay as shipped (AC7).
- **Existing rows.** In the test file, the only changed lines are the two pin tests (renamed and extended). `expectEscalation`, the `WRITE_SURFACE` pin and every row of U22 and U41-U54 are not edited; no row is removed (AC7, spec owner decision 5: none of the 43 re-measured approve rows moves).
- **Hook untouched.** `.claude/hooks/**`, `project-template/**`, the installer and `.claude/commands/cc-orchestrate.md` are not edited (spec, System Impact). No workflow file is written: the CI paths are only strings in a constant.
- No new dependency, no network, no settings, command or SNAP-script change; `tools/skip-baseline.json` untouched.
- Every file this plan edits after Task 0 (`scripts/orchestrate.mjs`, `tests/scripts/orchestrate.test.js`, this plan) is tracked, so every staging step is `git add -u <path>` with an explicit path.

## Plan decisions

1. **Code shape.** Read at `scripts/orchestrate.mjs:20-45` (HEAD `1d17bc7`).
   - After the line `// Owner decision (BUG-082): a CLAUDE.md or an npm manifest also reaches it at any depth, by its last segment (CONTROL_PLANE_NAMES).` add, as the last line of the comment block above `export const CONTROL_PLANE = [`:

     ```js
     // Owner decision (BUG-085): also the config-read hook runners, editor and container auto-run files, other package managers, build systems and CI systems.
     ```
   - After the last shipped entry line `  'package.json', 'package-lock.json', 'npm-shrinkwrap.json', '.npmrc',` and before `];`, insert the spec's first Resulting-list code block (from `// BUG-085: config-read git hook runners.` to the line ending `'.semaphore/**',`) verbatim, each line indented two spaces like the shipped entries. Copy it from the spec, not from memory: the spec is approved by hash, and the pin test catches any drift.
   - Replace the line `export const CONTROL_PLANE_NAMES = ['claude.md', 'claude.local.md', 'package.json', 'package-lock.json', 'npm-shrinkwrap.json', '.npmrc'];` with the spec's second Resulting-list code block verbatim: the `// Owner decision (BUG-085): the other package managers' and build systems' fixed files also reach it at any depth, like npm's.` line, then `export const CONTROL_PLANE_NAMES = [`, the 60 names on 16 lines indented two spaces, and `];`.
   - Measured on a throwaway copy: the module then exports `CONTROL_PLANE` with 172 entries (172 distinct) and `CONTROL_PLANE_NAMES` with 60.
2. **Pin tests** (`tests/scripts/orchestrate.test.js:478` and `:498`).
   - Rename `'[BUG-080][BUG-081] CONTROL_PLANE declares exactly the control-plane entries the specs list'` to `'[BUG-080][BUG-081][BUG-085] CONTROL_PLANE declares exactly the control-plane entries the specs list'`. After its line `      'package.json', 'package-lock.json', 'npm-shrinkwrap.json', '.npmrc',` and before `    ]);`, insert the same 130 entries on the same lines as in the code, indented six spaces, **without** the four family comment lines (the shipped pin carries no comments).
   - Rename `'[BUG-082] CONTROL_PLANE_NAMES declares exactly the file names that reach the control plane at any depth'` to `'[BUG-082][BUG-085] CONTROL_PLANE_NAMES declares exactly the file names that reach the control plane at any depth'`, and its `toEqual([...])` becomes the multi-line array of the 60 names, on the same 16 lines as in the code, indented six spaces, opened by `toEqual([` and closed by `    ]);`.
   - The `WRITE_SURFACE` pin is not touched (AC7).
3. **Test blocks.** Four `it.each` blocks go right after U54 (ends `tests/scripts/orchestrate.test.js:3866`), inside the same `describe`, after one comment line: `// BUG-085: config-read hook runners, editor and container auto-run files, other package managers, build systems and CI systems reach the control plane.`
   - **U55** (AC3, 130 rows): `expectEscalation(path, 'control-plane files')`. Name: `'U55 [BUG-085 AC3] delegate plan over an APPROVE report escalates a task that declares the outside-the-run file %s'`.
   - **U56** (AC4, 69 rows): `expectEscalation(path, 'control-plane files')`. Name: `'U56 [BUG-085 AC4] delegate plan escalates the directory, glob, case, ./ or nested form %s with the control-plane reason'`.
   - **U57** (AC5, 42 rows): the U53 approve body verbatim (`atPlan()`, the two-task `plan(…)`, `plan approved by delegated review: define_approved, 2 task(s); sha256 ${sha(PLAN)}`, `approvals.plan.by === 'define-review'`). Name: `'U57 [BUG-085 AC5] delegate plan over an APPROVE report approves a task that declares the near miss %s'`.
   - **U58** (AC6, 7 rows): `expectEscalation(path, 'orchestrator write surface')`. Name: `'U58 [BUG-085 AC6] a glob that reaches both lists, %s, keeps the write-surface reason'`.
   - `expectEscalation` already reuses the U46 shape AC3 asks for (`approvals.plan === null`, `delegated.plan` verdict and reason, then an owner `approve plan` exiting 0) and drops a leading `./` from the reason, so the `./` rows need no special helper.
   - All rows are printable ASCII and contain no `'`, so each is a plain single-quoted string, one per line, like U46.
4. **Every count measured before writing this plan.** On a throwaway copy of the tree (deleted), with plan decisions 2 and 3 applied:
   - with the shipped `scripts/orchestrate.mjs`, `npx vitest run tests/scripts/orchestrate.test.js -t "BUG-085"` gave **201 failed, 49 passed, 833 skipped (1083)**: the 130 U55 and 69 U56 rows (each approves today) and the two pins fail; the 42 U57 and 7 U58 rows pass. This confirms the spec's "each one approves today";
   - with plan decision 1 also applied, the same command gave **250 passed, 833 skipped (1083)**;
   - with plan decision 1 applied, `npx vitest run tests/scripts/orchestrate.test.js -t "BUG-080|BUG-081|BUG-082|BUG-086|U22 |write surface|FEAT-054"` gave **556 passed, 527 skipped (1083)**, no failure (its match set also holds the two renamed pins, which cite `BUG-080`, `BUG-081` and `BUG-082`), so no row of U22 or U41-U54 changes outcome (AC7).
   The file holds 833 tests at HEAD; the change adds 250 and removes none (1083).
5. **One commit.** Tests and code land together (Task 3): a tests-only commit would be red. The red run in T-105 happens in the working tree before the code edit.
6. **`.gitignore` leaf.** `!/docs/superpowers/plans/2026-11-18-bug085-unattended-plan-check-does-not-escalate-tasks.md` goes after the `2026-11-18-bug084` plan leaf and before the `2026-11-18-bug086` plan leaf, the sorted position; `tests/unit/gitignore-block-parity.test.js` checks it.

## Test rows

### U55 (AC3): one row per new `CONTROL_PLANE` entry (130 rows)

Each of the 130 entries of the spec's first Resulting-list code block, in that order: the entry itself for a fixed entry, and the entry with its trailing `**` replaced by `x` for a `/**` entry. So the 17 directory rows are `.lefthook/x`, `.lefthook-local/x`, `.vscode/x`, `.idea/x`, `.zed/x`, `.devcontainer/x`, `.yarn/x`, `.bundle/x`, `.cargo/x`, `.mvn/x`, `gradle/x`, `.circleci/x`, `.buildkite/x`, `.woodpecker/x`, `.gitea/workflows/x`, `.forgejo/workflows/x`, `.semaphore/x`, and the other 113 rows are the fixed entries as written (lower-case: `pipfile`, `gemfile`, `jenkinsfile`, `cargo.toml`, `directory.build.props`, …).

### U56 (AC4): directory, glob, case, `./` and nested forms (69 rows)

The 52 forms of the spec's second Alternative-paths bullet, then the 17 nested manifests of its third, in spec order:

`.vscode`, `.vscode/tasks.json`, `.vscode/settings.json`, `.vscode/tasks.*`, `.VSCode/Tasks.json`, `.idea/workspace.xml`, `.zed/tasks.json`, `.devcontainer`, `.devcontainer/devcontainer.json`, `.devcontainer/*.yml`, `./.devcontainer/devcontainer.json`, `.lefthook/pre-commit/a.sh`, `.Pre-Commit-Config.YAML`, `./.huskyrc`, `.LintStagedRC`, `Lint-Staged.Config.mjs`, `*.yaml`, `*.yml`, `*.lock`, `*.toml`, `*.py`, `*.cjs`, `setup.*`, `go.*`, `jenkins*`, `JENKINSFILE`, `Jenkinsfile`, `Cargo.TOML`, `Gemfile`, `Pipfile`, `Build.RS`, `POM.xml`, `Directory.Build.props`, `NuGet.Config`, `.GitLab-CI.yml`, `./.gitlab-ci.yml`, `./yarn.lock`, `.yarn`, `.yarn/releases/yarn-4.cjs`, `.mvn`, `.mvn/wrapper/maven-wrapper.properties`, `gradle`, `gradle/wrapper/gradle-wrapper.properties`, `.circleci`, `.circleci/config.yml`, `.circle*/config.yml`, `.gitea/workflows`, `.gitea/workflows/ci.yml`, `.gitea/*/ci.yml`, `.forgejo/workflows/ci.yml`, `.cargo/config.toml`, `.bundle/config`,

`src/setup.py`, `src/go.mod`, `tools/yarn.lock`, `tools/cargo.toml`, `packages/a/pyproject.toml`, `crates/a/build.rs`, `app/pom.xml`, `modules/a/build.gradle.kts`, `src/a/packages.lock.json`, `src/**/*.py`, `lib/**/*.rb`, `src/**/*.rs`, `src/Cargo.toml`, `Packages/A/PyProject.TOML`, `./src/setup.py`, `src/**/pom.xml`, `src/*/build.rs`.

### U57 (AC5): near misses keep the delegated APPROVE (42 rows)

`docs/.vscode/settings.json`, `src/.vscode/tasks.json`, `.vscodex/a.json`, `vscode/settings.json`, `.devcontainerx/devcontainer.json`, `devcontainer.json`, `.idea.md`, `.gitlab/issue_templates/bug.md`, `gitlab-ci.yml`, `.gitlab-ci.yml.example`, `docs/.gitlab-ci.yml`, `.travis.yml.bak`, `docs/jenkinsfile`, `.pre-commit-hooks.yaml`, `docs/.pre-commit-config.yaml`, `lefthook.yml.example`, `docs/.huskyrc`, `docs/.lintstagedrc`, `.commitlintrc.json`, `commitlint.config.js`, `.eslintrc.json`, `eslint.config.js`, `.prettierrc`, `.circlecix/config.yml`, `.gitea`, `.gitea/issue_template/bug.md`, `.forgejo`, `.yarnrc.yml.bak`, `cargo.toml.orig`, `go.sum`, `docs/setup.py.md`, `src/cargo.toml.orig`, `src/go.sum`, `docs/requirements-dev.txt`, `src/pom.xml.bak`, `src/xbuild.rs`, `.mvnx/x`, `gradlex/x`, `src/**/x.py`, `makefile`, `justfile`, `taskfile.yml`.

### U58 (AC6): write-surface reason first (7 rows)

`*/tasks.json`, `.*/config.yml`, `**/yarn.lock`, `*/workflows/ci.yml`, `**/go.mod`, `**/build.rs`, `**/pom.xml`.

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-18-bug085-unattended-plan-check-does-not-escalate-tasks.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file from the approved spec `ca3ea447…`. No dependency.
- [X] [T-002] `.gitignore`: insert the leaf `!/docs/superpowers/plans/2026-11-18-bug085-unattended-plan-check-does-not-escalate-tasks.md` after the `2026-11-18-bug084` plan leaf (plan decision 6). Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` (tracked) and `git add docs/superpowers/plans/2026-11-18-bug085-unattended-plan-check-does-not-escalate-tasks.md` (new; re-included by its leaf, so no ignored ancestor applies). Depends on T-002.
- [X] [T-004] Commit: `docs: plan the hook-runner, editor, package-manager and CI escalation for the unattended plan check [BUG-085]`. Depends on T-003.

---

### Task 1: Tests first (red)

**Files:**
- Modify: `tests/scripts/orchestrate.test.js`

- [X] [T-101] Modify the `CONTROL_PLANE` pin as plan decision 2 says: rename it to cite `[BUG-085]` and append the 130 entries, without the family comment lines (AC1). Depends on T-004.
- [X] [T-102] Modify the `CONTROL_PLANE_NAMES` pin as plan decision 2 says: rename it to cite `[BUG-085]` and set it to the 60-name multi-line array (AC2). Depends on T-101.
- [X] [T-103] After U54, add the comment line and the U55, U56, U57 and U58 blocks of plan decision 3, with the rows of the Test rows section in that order (AC3-AC6). Depends on T-102.
- [X] [T-104] Check the row counts before running: 130 rows in U55, 69 in U56, 42 in U57, 7 in U58; the U55 rows are exactly the spec's 130 entries in order with each `/**` turned into `/x`. Depends on T-103.
- [X] [T-105] Red run: `npx vitest run tests/scripts/orchestrate.test.js -t "BUG-085"`. Predicted for the filter's full match set: **201 failed, 49 passed, 833 skipped (1083)**. Failing: the 130 U55 rows, the 69 U56 rows (each approved today) and the two renamed pins. Passing: the 42 U57 rows and the 7 U58 rows. No other test name contains `BUG-085`. Any other count means a row is mistyped: fix the row, not the prediction. Depends on T-104.

---

### Task 2: The new entries and names (green)

**Files:**
- Modify: `scripts/orchestrate.mjs`

- [X] [T-201] Modify `scripts/orchestrate.mjs`: add the `Owner decision (BUG-085)` comment line above `CONTROL_PLANE` (plan decision 1). Depends on T-105.
- [X] [T-202] Append the spec's 130 entries with their four family comment lines before the `CONTROL_PLANE` closing `];` (plan decision 1, AC1). Depends on T-201.
- [X] [T-203] Replace the one-line `CONTROL_PLANE_NAMES` with the spec's commented 60-name form (plan decision 1, AC2). Depends on T-202.
- [X] [T-204] Green run: the T-105 command. Predicted: **250 passed, 833 skipped (1083)**, no failure. Depends on T-203.
- [X] [T-205] AC7 run: `npx vitest run tests/scripts/orchestrate.test.js -t "BUG-080|BUG-081|BUG-082|BUG-086|U22 |write surface|FEAT-054"`. Predicted: **556 passed, 527 skipped (1083)**, no failure (measured in plan decision 4). Depends on T-204.

---

### Task 3: Full suite, scope check and commit

**Files:**
- Modify: `scripts/orchestrate.mjs`, `tests/scripts/orchestrate.test.js` (staged), this plan (checkboxes)

- [X] [T-301] Run `npm test`. Predicted locally: exit 0, every file green (AC8). CI legs run 250 more tests each, none skipped, so `tools/skip-baseline.json` stays untouched. A failure that comes from the sandbox (network, tmp permissions) is reported as ENV with the test's name; any other red is fixed. Depends on T-205.
- [X] [T-302] Scope check: `git status --porcelain` lists exactly `scripts/orchestrate.mjs`, `tests/scripts/orchestrate.test.js` and this plan as modified; `git diff -U0 HEAD -- scripts/orchestrate.mjs | grep '^-[^-]'` shows exactly one line, the old one-line `CONTROL_PLANE_NAMES`; `git diff -U0 HEAD -- tests/scripts/orchestrate.test.js | grep '^-[^-]'` shows exactly three lines, the two old pin names and the old one-line `CONTROL_PLANE_NAMES` expectation; `git diff --quiet HEAD -- VERSION CHANGELOG.md package.json package-lock.json README.md "AGENT-READABLE BACKLOG.md" .claude .github project-template tools` exits 0. Depends on T-301.
- [X] [T-303] Stage: `git add -u scripts/orchestrate.mjs tests/scripts/orchestrate.test.js` (both tracked). Depends on T-302.
- [X] [T-304] Stage: `git add -u docs/superpowers/plans/2026-11-18-bug085-unattended-plan-check-does-not-escalate-tasks.md` (ticks T-101 to T-303). Depends on T-303.
- [X] [T-305] Commit: `fix: escalate hook-runner, editor, container, package-manager, build and CI files in the unattended plan check [BUG-085]`. Depends on T-304.

---

## Test List

- [X] Unit, AC1: the `CONTROL_PLANE` pin equals the shipped 42 entries followed by the 130 new ones, in order (T-101).
- [X] Unit, AC2: the `CONTROL_PLANE_NAMES` pin equals the 60 names, in order (T-102); the comment lines are checked by T-302's diff and the spec text.
- [X] Integration, AC3: U55, one row per new entry, escalates with the control-plane reason; `approvals.plan` stays `null`, `delegated.plan` records the verdict and reason, and the owner's `approve plan` exits 0 (`expectEscalation`; T-103).
- [X] Integration, AC4: U56 directory, glob, case, `./` and nested rows escalate with the control-plane reason (T-103).
- [X] Integration, AC5: U57 near misses keep the delegated APPROVE (T-103).
- [X] Integration, AC6: U58 rows keep the write-surface reason (T-103).
- [X] AC7: `WRITE_SURFACE` pin, U22 and U41-U54 unchanged and green (T-205, T-302).
- [X] AC8: `npm test` green (T-301).
- [X] No E2E/UI test: there is no UI.

## Commit Order

0. Task 0: this plan and its `.gitignore` leaf (done by this session's commit).
1. Tasks 1-3: one commit, T-305, carrying the constants, the tests and the ticks T-101 to T-303 (plan decision 5). Tasks 1 and 2 have no commit of their own: a tests-only commit would be red. The ticks of T-304 and T-305 are made after the last commit and ride whichever commit next stages this plan.

## Identified Risks

- **Transcription drift.** 130 entries and 60 names are easy to mistype or reorder. Both are copied from the spec's code blocks, the pins are exact `toEqual` arrays, and T-104 checks the row counts before the red run; a typo in the code fails the pin in T-204, a typo in a row fails its U55 row.
- **A family comment line inside the pin array.** Comments inside an array literal are harmless to `toEqual`, but the shipped pin carries none; plan decision 2 keeps it that way so the pin reads as a plain list.
- **The apostrophes in the comments.** The third family comment (`other package managers' and build systems'`) and the `CONTROL_PLANE_NAMES` comment contain `'`. They are `//` comments, so they are safe in JavaScript, but a tool that extracts quoted strings from the code block must skip comment lines (one did while measuring this plan).
- **An approve row elsewhere starts to escalate.** Measured: the T-205 filter covers every delegated-plan block of the file and stays green, and the spec's re-measure of the 43 approve rows of U43, U48, U51 and U53 agrees; T-301 covers the rest of the suite. The stack-detection tests name `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb` and `go.mod` as files on disk, not plan entries, so they are unaffected.
- **Friction on later items.** Unattended plans that declare any of these files, or a glob such as `src/**/*.py`, now wait for the owner; the spec accepts that cost (System Impact).
- **Run time.** The four blocks add 250 subprocess-backed rows; the filtered run took about four minutes in the sandbox. That is slow, not wrong: allow for it rather than cutting rows.
- **This item's own plan.** `scripts/orchestrate.mjs` is a `CONTROL_PLANE` entry, so an unattended review of this plan escalates; that is expected, and the plan takes an owner approval anyway.
- **Line numbers drift.** References are from HEAD `1d17bc7`; locate by the quoted text if they move.
