# BUG-056 (closure) Bring the records in line with the context-guard fix already on `main`: implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** close `[BUG-056]` without changing any code. Commit `2d8e236` ("fix: key the context-guard turn count to the session id [BUG-056]", PR #98) already keys `.claude/memory/turn-count.txt` to the hook's stdin `session_id`, so a fresh session restarts the count at 1. This item checks that on this branch. The three records that still call the bug open (the backlog heading and its DONE line, the README Known-limits line, and a `CHANGELOG.md` entry) are not edited on this branch: by owner decision they move to a `records/*` branch opened by the release App, and this plan specifies their exact content in the Records hand-off section.

**Spec:** `docs/superpowers/specs/2026-11-20-bug056-context-guard-the-turn-counter-persists-across-design.md` (sha256 `18b8e35e1d11eb5a08837da5f12754ae1459611b4533071d7efdb75376d4cdf6`). Filed from issue #78. Prior work: spec `docs/superpowers/specs/2026-10-23-bug056-context-guard-session-reset-design.md`, plan `docs/superpowers/plans/2026-10-23-bug056-context-guard-session-reset.md`.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>`.

## Global Constraints

- **No code change.** Hooks (`.claude/hooks/`, `project-template/.claude/hooks/`), the installer, `settings.json`, `scripts/`, `lib/`, `tools/`, `tests/` and workflows stay byte-identical to `origin/main` (spec AC7, Out of Scope).
- **No record edit on this branch.** This branch carries only the spec, this plan and their `.gitignore` leaves (Owner decisions, "Records guard"). `AGENT-READABLE BACKLOG.md`, `README.md`, `CHANGELOG.md`, `VERSION`, the `package.json` / `package-lock.json` versions and `.claude/memory/**` stay byte-identical to `origin/main`. The spec's owner-authorized record edits (spec, Owner Decisions, "Records") land on a `records/*` branch through the release App, with the content in the Records hand-off section.
- **No new release heading.** This item adds no `## [x.y.z]` heading and no `## [Unreleased]` heading to `CHANGELOG.md` (Plan decision 2).
- **A red verification is not fixed here.** If Task 1 fails, the build stops and reports the failing check as a regression since `2d8e236`. That needs a new spec. It is not fixed silently in this item (spec, Solution: "No code changes").
- **Staging forms.** `.gitignore` is tracked: `git add -u .gitignore`. This plan sits under the ignored `docs/superpowers/plans/`, so it is new in Task 0 (`git add -f`). After that it is tracked and re-included by its leaf (`git add -u`).

## Owner decisions

These were open questions in the first version of this plan. They are now decided and bind the build.

1. **CHANGELOG placement:** the `[BUG-056]` entry is back-filled as a `### Fixed` bullet under `## [1.42.0]`, the release that shipped `2d8e236` (Plan decision 2). No new release heading and no `## [Unreleased]` heading is added.
2. **Records guard:** no merge over a red check. This branch keeps only the spec and the plan. All `[BUG-056]` records (the CHANGELOG bullet, the `README.md:496` Known-limits removal, the backlog heading tick and its DONE line) move to a `records/*` branch opened by the release App, so the records-guard exemption for that branch applies (`.github/workflows/records-guard.yml:16-19`). The build on this branch does not edit any record.

## Plan decisions

1. **The DONE line follows the backlog's existing shape.** The review's minor finding noted that "DONE line" needs a fixed format. Closed bug entries carry a `* **DONE, shipped as `<version>` on <date>.**` bullet directly under the heading, as in `[BUG-055]` (`AGENT-READABLE BACKLOG.md:1016`). `tools/record-parity.mjs` reads that bullet through `SHIPPED_AS` (`/shipped as `?(\d+\.\d+\.\d+)`?/`, `:30`), and direction C requires the named version to exist as a CHANGELOG heading (`:132-139`). The DONE line therefore names a real release.
2. **The CHANGELOG entry is back-filled under `[1.42.0]`, the release that shipped `2d8e236`.** The spec says "under the next release", and the review left the placement to the plan. Measured during planning: `git log --ancestry-path 2d8e236..HEAD -- VERSION` names `b62b1fa chore: release 1.42.0` as the first version change after the fix. `CHANGELOG.md:150` reads `## [1.42.0] - 2026-10-27` with only an `### Added` section (`[FEAT-046]`, `[FEAT-049]`), so the fix shipped in 1.42.0 with no entry. "The next release" cannot be written here for three reasons:
   - A new `## [x.y.z]` heading is a version decision. It also needs a `VERSION` bump, which the owner did not authorize, and `tools/records-guard.mjs` fails a PR that adds one (`checkChangelog`, `:56-62`).
   - An `## [Unreleased]` heading turns `tools/version-gate.mjs`'s "CHANGELOG.md first heading" red (`:24-25`).
   - A bullet under the current top heading `[1.52.12]` would claim that 1.52.12 shipped the fix. Record-parity direction B would then require the DONE line to read `shipped as 1.52.12` (`:115-129`), and that is false.

   Back-filling under `[1.42.0]` states the fact and keeps every gate green. Direction A is satisfied because 1.42.0 claims `[BUG-056]` and its heading reads `[X]`. Direction B is unaffected because 1.42.0 is not the current version. Direction C is satisfied because 1.42.0 exists. The bullet says that it was back-filled. The spec text is not changed (it is approved by hash). The owner confirmed this placement (Owner decisions 1).
3. **Backlog and README change in one commit.** `tests/tools/repo-invariants.test.js:123-127` requires the open `[BUG-NNN]` headings and the Known-limits `- **`[BUG-NNN]`` bullets to match exactly. A commit that does only one of the two edits leaves the tree red, so both edits are in the same commit on the `records/*` branch (Records hand-off). On this branch neither file changes, so the invariant stays green.
4. **No other Known-limits text moves.** The dossier count at `README.md:504` counts `### DOSSIER` headings (`repo-invariants.test.js:131-134`), and this item does not change any of them.
5. **The `.gitignore` leaf** for this plan goes in sorted position in the plans block: directly after `!/docs/superpowers/plans/2026-11-19-bug087-installer-follows-a-symlink-at-the-opencode.md` and directly before `!/docs/superpowers/plans/2026-11-20-bug059-fake-gh-is-posix-only-so-on-windows-the-suites.md`. The spec's leaf is already at `.gitignore:282`.

## Files read in full (spec, Files Requiring Full Read)

None, per the spec. Checked by grep during planning:
- `session_id` is read at `.claude/hooks/context-guard.sh:42-45`.
- The test row "stale count from another session — restarts at 1" is at `tests/hooks/context-guard.test.js:263`.
- The open heading is at `AGENT-READABLE BACKLOG.md:1035`, and the Known-limits line is at `README.md:496`.
- The `[1.42.0]` section starts at `CHANGELOG.md:150`, and the next heading, `## [1.41.0]`, is at `:156`.
- Record-parity's regexes are at `tools/record-parity.mjs:26-30`.

---

### Task 0: Commit this plan and its ignore leaf

**Files:**
- Modify: `.gitignore` (one leaf, sorted position)
- Create (stage): `docs/superpowers/plans/2026-11-20-bug056-context-guard-the-turn-counter-persists-across.md`

- [X] [T-000-A] Modify `.gitignore`: add `!/docs/superpowers/plans/2026-11-20-bug056-context-guard-the-turn-counter-persists-across.md` directly after the `2026-11-19-bug087-…` plan leaf and before the `2026-11-20-bug059-…` plan leaf (Plan decision 5). No dependency.
- [X] [T-000-B] Stage: `git add -u .gitignore`, then `git add -f docs/superpowers/plans/2026-11-20-bug056-context-guard-the-turn-counter-persists-across.md`. Depends on T-000-A.
- [X] [T-000-C] Commit: `docs: plan closing the BUG-056 records against the fix already on main [BUG-056]`. Depends on T-000-B.

### Task 1: Verify the fix on this branch (AC1-AC3)

**Files:**
- Read only: `.claude/hooks/context-guard.{sh,ps1}`, `project-template/.claude/hooks/context-guard.{sh,ps1}`, `tests/hooks/context-guard.test.js`
- Modify: this plan (checkboxes only; the ticks ride Task 2's commit)

- [X] [T-001-A] Run `git merge-base --is-ancestor 2d8e236 HEAD`. Expected: exit 0 (AC1). No dependency.
- [X] [T-001-B] Run `git merge-base --is-ancestor 2d8e236 b62b1fa && git show b62b1fa:VERSION`. Expected: exit 0 and `1.42.0`. This confirms the release that Plan decisions 1-2 name. Depends on T-001-A only for order.
- [X] [T-001-C] Run `cmp .claude/hooks/context-guard.sh project-template/.claude/hooks/context-guard.sh && cmp .claude/hooks/context-guard.ps1 project-template/.claude/hooks/context-guard.ps1 && grep -c session_id .claude/hooks/context-guard.sh .claude/hooks/context-guard.ps1`. Expected: both `cmp` print nothing (exit 0), and each `grep -c` count is at least 1 (AC2).
- [X] [T-001-D] Run `npx vitest run tests/hooks/context-guard.test.js`. Expected: `Test Files 1 passed (1)` and no failed test. The filter's full match set is the whole file, including both `session reset (BUG-056)` describes and the row "stale count from another session — restarts at 1" (AC3). The `.ps1` rows are skipped when `pwsh` is absent, as `tools/skip-baseline.json` records, and skipped rows are expected, not red.

## Records hand-off (AC4-AC6, not executed on this branch)

By owner decision (Owner decisions 2) these edits are made on a `records/*` branch opened by the release App, not by the build on this branch. They are listed here so that branch applies exactly this content. The steps carry no checkbox because no commit of this branch does them. AC4-AC6 are met when that branch merges.

**Files (on the `records/*` branch):**
- Modify: `AGENT-READABLE BACKLOG.md` (the `[BUG-056]` heading and one new DONE bullet)
- Modify: `README.md` (delete one Known-limits line)
- Modify: `CHANGELOG.md` (one `### Fixed` section with one bullet under `## [1.42.0]`)

- R-1. Modify `AGENT-READABLE BACKLOG.md:1035`: change `### [ ] \`[BUG-056]\`` to `### [X] \`[BUG-056]\`` and leave the title unchanged. Directly below the heading, insert this line, followed by one blank line before the existing `- Symptom:` bullet. The layout matches `[BUG-055]` at `:1015-1018`.

  ```
  * **DONE, shipped as `1.42.0` on 2026-10-27.** `.claude/hooks/context-guard.sh` and `context-guard.ps1`, and their `project-template/` copies, key `.claude/memory/turn-count.txt` to the `session_id` on the hook's stdin. A prompt whose id differs from the stored one restarts the count at 1, a matching id (`--resume`) increments it, and a payload without an id increments the stored count as before. A fresh session no longer inherits the previous session's CONTEXT WARNING or CRITICAL banner. The counter still measures prompts, not context size, by owner decision, and no new item is opened for the metric. Fixed by `2d8e236` (PR #98), intake of issue #78. The records were back-filled on 2026-11-20. Pinned by the `session reset (BUG-056)` rows of `tests/hooks/context-guard.test.js`. Spec: `docs/superpowers/specs/2026-10-23-bug056-context-guard-session-reset-design.md`. Plan: `docs/superpowers/plans/2026-10-23-bug056-context-guard-session-reset.md`. Closure spec: `docs/superpowers/specs/2026-11-20-bug056-context-guard-the-turn-counter-persists-across-design.md`.
  ```

  It runs after Task 1 is green on this branch.
- R-2. Modify `README.md`: delete the single line that starts with `- **\`[BUG-056]\`, open:**` (line 496 at planning time). Leave the lines around it, including the dossier count at `:504`, untouched (Plan decisions 3-4). R-1 and R-2 land in the same commit.
- R-3. Modify `CHANGELOG.md`: in the `## [1.42.0] - 2026-10-27` section, after the last `### Added` bullet (`[FEAT-049]`) and before the blank line that precedes `## [1.41.0]`, insert one blank line, the heading `### Fixed`, and this bullet. The id marker is the bullet's first token, so record-parity reads it as a claim (`docs/RELEASE-CLOSEOUT.md`, "What a CHANGELOG entry must look like").

  ```
  - **[BUG-056]** A fresh session no longer starts with the previous session's context-guard turn count, so its first prompt no longer shows the CONTEXT WARNING or CRITICAL banner. `context-guard.sh` and `context-guard.ps1`, and their `project-template/` copies, key `.claude/memory/turn-count.txt` to the `session_id` on the hook's stdin and restart the count at 1 when the id changes. A resumed session keeps counting, and a payload without an id increments as before. Pinned by the `session reset (BUG-056)` rows of `tests/hooks/context-guard.test.js`. Fixed by `2d8e236` (PR #98), intake of issue #78. This entry was back-filled on 2026-11-20.
  ```

  Add no other heading (Global Constraints, Plan decision 2). No dependency.
- R-4. Run `node tools/record-parity.mjs && node tools/version-gate.mjs && npx vitest run tests/tools/repo-invariants.test.js`. Expected:
  - `record-parity` exits 0 with no `FAIL [` line.
  - `version-gate` exits 0.
  - `Test Files 1 passed (1)` with no failed test. The filter's full match set is the whole of `repo-invariants.test.js`, and every test in it is green, including "keeps its CHANGELOG, backlog and VERSION in record parity", "runs the record-parity command green against this repository" and "lists every open filed defect in Known limits, and only those".

  Run after R-1 through R-3, before the commit.
- R-5. Suggested commit subject: `docs: close the BUG-056 records, fixed by 2d8e236 in 1.42.0 [BUG-056]`.

### Task 2: Full suite and scope check (AC7)

**Files:**
- Modify: this plan (checkboxes only)

- [X] [T-002-A] Run `git diff --stat origin/main -- .claude project-template global skills lib scripts tools tests bin VERSION package.json package-lock.json .github README.md CHANGELOG.md "AGENT-READABLE BACKLOG.md"`. Expected: empty. No hook, installer, settings, code, test, version, workflow or record change (AC7, Owner decisions 2). Depends on T-001-A through T-001-D.
- [X] [T-002-B] Run `git diff --name-only origin/main`. Expected: exactly `.gitignore`, the spec and this plan.
- [X] [T-002-C] Run `npm test`. Expected: exit 0 and no failed test file. A failure caused by the sandbox environment (network, tmp permissions) is reported as ENV with its test name. Any other red stops the build and is reported (Global Constraints).
- [X] [T-002-D] Stage: `git add -u docs/superpowers/plans/2026-11-20-bug056-context-guard-the-turn-counter-persists-across.md` so the Task 1 and Task 2 ticks are committed. Depends on T-002-A through T-002-C.
- [X] [T-002-E] Commit: `docs: verify the BUG-056 fix on main against the full suite [BUG-056]`. Depends on T-002-D. This is the last group, so no later commit picks up its own tick. The closeout leaves that tick in the runner's commit of the tree.

## Test List

- [ ] Hooks: `tests/hooks/context-guard.test.js`, both `session reset (BUG-056)` describes (AC3), unchanged.
- [ ] Records on this branch: `tests/tools/repo-invariants.test.js` stays green inside `npm test`, with no record changed. On the `records/*` branch, R-4 runs it with `tools/record-parity.mjs` and `tools/version-gate.mjs` (AC4-AC6).
- [ ] Full suite: `npm test` green (AC7).

## Commit Order

1. Task 0: this plan and its `.gitignore` leaf. The runner makes this commit at the end of the planning session.
2. Task 2: Task 1's and Task 2's ticks. Task 1 has no commit of its own.
3. Outside this branch: the Records hand-off commit on a `records/*` branch from the release App (Owner decisions 2).

In this lane the runner makes the build's commits as one commit of the tree. The order above is the order of the edits and the content of that one commit.

## Identified Risks

- **The Records guard on this PR.** `tools/records-guard.mjs` flags a `[BUG-056]` heading flip and an added DONE line (`headingViolations`, `doneViolations`) on any PR that is not the owner's or the release App's. This branch edits no record, so the guard is green here. T-002-A and T-002-B catch a stray record edit before the commit. The records PR is exempt because the release App opens it on a `records/*` branch (Owner decisions 2).
- **The item is not closed until the records branch merges.** This PR verifies the fix and carries the spec and plan; AC4-AC6 are met only when the `records/*` branch lands. The hand-off content is fixed in this plan so the records branch does not have to re-derive it.
- **A release lands between planning and build.** Line numbers can then drift, and the `[1.42.0]` section can move. R-1, R-2 and R-3 anchor on text (the heading, the `- **\`[BUG-056]\`, open:**` prefix, the `## [1.42.0]` heading), not on line numbers. A release that already closed `[BUG-056]` makes the Records hand-off empty, and the records branch then adds no duplicate records.
- **Parity red from a wrong placement.** A bullet placed under the top heading, or a DONE line that names a version other than `1.42.0`, turns direction B or C red. R-4 catches this before the records commit.
- **The invariant test is red if only one of the backlog and README edits is made.** Both edits are in the same records commit (Plan decision 3), and R-4 runs before it.
- **`pwsh` is absent in the sandbox.** The `.ps1` rows of `context-guard.test.js` skip, as `tools/skip-baseline.json` records. Skipped rows are expected and do not mean the `.ps1` fix is missing. T-001-C checks the `.ps1` pair by byte identity and by `grep`.
