# BUG-057 (closure) Bring the records in line with the bounded project-memory fix already on `main`: implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** close `[BUG-057]` without changing any code. Commit `5b4411d` ("fix: bound the phase-entry read of project memory [BUG-057]", merged by PR #86 as `fa127ef`) already makes `/cc-implement`, `/cc-plan` and `/cc-resume` Read `.claude/memory/project.md` with `limit: 60` and stop at the `## Current State` digest that `/cc-checkpoint` keeps bounded. This item checks that on this branch. The three records that still call the bug open (the backlog heading and its DONE line, the README Known-limits line, and a `CHANGELOG.md` entry) are not edited on this branch: by owner decision they go on a `records/*` branch through the release process, batched with the pending `[BUG-056]` records. This plan fixes their exact content in the Records hand-off section.

**Spec:** `docs/superpowers/specs/2026-11-20-bug057-project-md-grows-without-bound-while-the-phase-design.md` (sha256 `e8b1b0f100d7c84a0d0df788b7ec08695bf5a05a5334411f67788ff02dc545e2`). Filed from issue #77. Prior work: spec `docs/superpowers/specs/2026-10-22-bug057-bounded-project-memory-design.md`, plan `docs/superpowers/plans/2026-10-22-bug057-bounded-project-memory.md`.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>`.

## Global Constraints

- **No code change.** Commands (`.claude/commands/`, `project-template/.claude/commands/`, `global/commands/`), hooks, the installer, `settings.json`, `scripts/`, `lib/`, `tools/`, `tests/` and workflows stay byte-identical to `origin/main` (spec AC6, Out of Scope).
- **No record edit on this branch.** This branch carries only the spec, this plan and their `.gitignore` leaves (spec, Owner Decisions, "Item branch scope"). `AGENT-READABLE BACKLOG.md`, `README.md`, `CHANGELOG.md`, `VERSION`, the `package.json` / `package-lock.json` versions and `.claude/memory/**` stay byte-identical to `origin/main`.
- **No new release heading.** The CHANGELOG entry is back-filled under `## [1.42.0]` (spec, Owner Decisions, "Records routing"). No `## [x.y.z]` and no `## [Unreleased]` heading is added.
- **A red verification is not fixed here.** If Task 1 fails, the build stops and reports the failing check as a regression since `5b4411d`. That needs a new spec; it is not fixed silently in this item (spec, Solution: "No code changes").
- **Staging forms.** `.gitignore` is tracked: `git add -u .gitignore`. This plan sits under the ignored `docs/superpowers/plans/`, so it is new in Task 0 (`git add -f`). After that it is tracked and re-included by its leaf (`git add -u`).

## Plan decisions

1. **1.42.0 is the release that shipped `5b4411d`.** Measured during planning: `git log --ancestry-path 5b4411d..HEAD -- VERSION` names `b62b1fa chore: release 1.42.0` as the first version change after the fix, `git show b62b1fa:VERSION` prints `1.42.0`, and `5b4411d` is not an ancestor of the 1.41.0 release commit. `CHANGELOG.md:150` reads `## [1.42.0] - 2026-10-27` with only an `### Added` section (`[FEAT-046]`, `[FEAT-049]`). T-001-B re-checks this at build time.
2. **The DONE line follows the backlog's existing shape.** Closed bug entries carry a `* **DONE, shipped as \`<version>\` on <date>.**` bullet directly under the heading, as `[BUG-055]` does (`AGENT-READABLE BACKLOG.md:1016`). `tools/record-parity.mjs` reads that bullet through its `SHIPPED_AS` pattern, and requires the named version to exist as a CHANGELOG heading, so the line names `1.42.0` and its release date `2026-10-27`.
3. **Batched with `[BUG-056]` in one `### Fixed` section.** The `[BUG-056]` closure plan (`docs/superpowers/plans/2026-11-20-bug056-context-guard-the-turn-counter-persists-across.md`, R-3) adds a `### Fixed` section under `## [1.42.0]`. Both items back-fill the same release, so they share that one section: R-3 below appends the `[BUG-057]` bullet after the `[BUG-056]` bullet when the section exists, and creates the section only when it does not. A second `### Fixed` heading under one release is never added.
4. **Backlog and README change in one commit.** `tests/tools/repo-invariants.test.js` requires the open `[BUG-NNN]` headings and the Known-limits `- **\`[BUG-NNN]\`` bullets to match exactly. A commit that does only one of the two edits leaves the tree red, so R-1 and R-2 land in the same commit on the `records/*` branch. On this branch neither file changes, so the invariant stays green.
5. **No other Known-limits text moves.** The `[BUG-056]` line just above (`README.md:496`) belongs to its own hand-off, and the dossier count in the same list counts `### DOSSIER` headings, which this item does not change.
6. **The `.gitignore` leaf** for this plan goes in sorted position in the plans block: directly after `!/docs/superpowers/plans/2026-11-20-bug056-context-guard-the-turn-counter-persists-across.md` and directly before `!/docs/superpowers/plans/2026-11-20-bug059-fake-gh-is-posix-only-so-on-windows-the-suites.md`. The spec's leaf is already at `.gitignore:284`.

## Files read in full (spec, Files Requiring Full Read)

None, per the spec. Checked by grep during planning:
- The three readers Read `project.md` with `limit: 60`: `.claude/commands/cc-implement.md:42`, `cc-plan.md:58`, `cc-resume.md:40`, and the same lines in `project-template/.claude/commands/`.
- Guard 1 returns early on a Read with a `limit` at `.claude/hooks/pre-tool-use.mjs:117`.
- `tests/unit/bounded-project-memory.test.js` has one `describe('bounded project memory [BUG-057]')` with 9 tests; it passed 9 of 9 at planning time.
- The open heading is at `AGENT-READABLE BACKLOG.md:1052`, and the Known-limits line is at `README.md:497`.
- The `[1.42.0]` section starts at `CHANGELOG.md:150`, and the next heading, `## [1.41.0]`, is at `:156`.

---

### Task 0: Commit this plan and its ignore leaf

**Files:**
- Modify: `.gitignore` (one leaf, sorted position)
- Create (stage): `docs/superpowers/plans/2026-11-20-bug057-project-md-grows-without-bound-while-the-phase.md`

- [X] [T-000-A] Modify `.gitignore`: add `!/docs/superpowers/plans/2026-11-20-bug057-project-md-grows-without-bound-while-the-phase.md` directly after the `2026-11-20-bug056-…` plan leaf and before the `2026-11-20-bug059-…` plan leaf (Plan decision 6). No dependency.
- [X] [T-000-B] Stage: `git add -u .gitignore`, then `git add -f docs/superpowers/plans/2026-11-20-bug057-project-md-grows-without-bound-while-the-phase.md`. Depends on T-000-A.
- [X] [T-000-C] Commit: `docs: plan closing the BUG-057 records against the fix already on main [BUG-057]`. Depends on T-000-B.

### Task 1: Verify the fix on this branch (spec AC1-AC4)

**Files:**
- Read only: `.claude/commands/`, `project-template/.claude/commands/`, `global/commands/`, `.claude/hooks/pre-tool-use.mjs`, `project-template/.claude/hooks/pre-tool-use.mjs`, `tests/unit/bounded-project-memory.test.js`
- Modify: this plan (checkboxes only; the ticks ride Task 2's commit)

- [X] [T-001-A] Run `git merge-base --is-ancestor 5b4411d HEAD`. Expected: exit 0 (AC1). No dependency.
- [X] [T-001-B] Run `git merge-base --is-ancestor 5b4411d b62b1fa && git show b62b1fa:VERSION`. Expected: exit 0 and `1.42.0`. This confirms the release that Plan decision 1 names. Depends on T-001-A only for order.
- [X] [T-001-C] Run ``grep -rnE 'Read[^`]*`\.claude/memory/project\.md`' .claude/commands project-template/.claude/commands global/commands | grep -vc 'limit: '``. Expected: `0`. No command line that Reads `.claude/memory/project.md` lacks a `limit` (AC2).
- [X] [T-001-D] Run `npx vitest run tests/unit/bounded-project-memory.test.js`. Expected: `Test Files 1 passed (1)` and `Tests 9 passed (9)`. The filter's full match set is the whole file, the `bounded project memory [BUG-057]` describe (AC2, AC3).
- [X] [T-001-E] Run `cmp .claude/hooks/pre-tool-use.mjs project-template/.claude/hooks/pre-tool-use.mjs && grep -n "if (input.limit !== undefined) return null;" .claude/hooks/pre-tool-use.mjs`. Expected: `cmp` prints nothing (exit 0), and `grep` prints one line inside `guard1LargeRead` (line 117 at planning time) (AC4).

## Records hand-off (spec AC5, not executed on this branch)

By owner decision (spec, Owner Decisions, "Records routing") these edits are made on a `records/*` branch through the release process, batched with the `[BUG-056]` records, not by the build on this branch. They are listed here so that branch applies exactly this content. The steps carry no checkbox because no commit of this branch does them. AC5 is met when that branch merges.

**Files (on the `records/*` branch):**
- Modify: `AGENT-READABLE BACKLOG.md` (the `[BUG-057]` heading and one new DONE bullet)
- Modify: `README.md` (delete one Known-limits line)
- Modify: `CHANGELOG.md` (one bullet in the `### Fixed` section under `## [1.42.0]`)

- R-1. Modify `AGENT-READABLE BACKLOG.md:1052`: change `### [ ] \`[BUG-057]\`` to `### [X] \`[BUG-057]\`` and leave the title unchanged. Directly below the heading, insert this line, followed by one blank line before the existing `- Symptom:` bullet. The layout matches `[BUG-055]` at `:1015-1018`.

  ```
  * **DONE, shipped as `1.42.0` on 2026-10-27.** `/cc-implement`, `/cc-plan` and `/cc-resume`, in `.claude/commands/` and `project-template/.claude/commands/`, Read `.claude/memory/project.md` with `limit: 60` and stop at `<!-- end current state -->`; detail comes from a Grep of the heading the digest names and a Read with `offset` and `limit: 60`, and a file with no digest yet takes a bounded fallback (`limit: 40` plus a heading Grep). `/cc-checkpoint` keeps the `## Current State` digest at the top of the file within 40 lines, 12 bullets per list and 200 characters per line, and the history below it stays append-only. The phase-entry read no longer grows with project age, and Guard 1 allows it because it carries a `limit`. Cap-with-archive was not taken, by owner decision. Fixed by `5b4411d` (PR #86), intake of issue #77. The records were back-filled on 2026-11-20. Pinned by `tests/unit/bounded-project-memory.test.js`. Spec: `docs/superpowers/specs/2026-10-22-bug057-bounded-project-memory-design.md`. Plan: `docs/superpowers/plans/2026-10-22-bug057-bounded-project-memory.md`. Closure spec: `docs/superpowers/specs/2026-11-20-bug057-project-md-grows-without-bound-while-the-phase-design.md`.
  ```

  It runs after Task 1 is green on this branch.
- R-2. Modify `README.md`: delete the single line that starts with `- **\`[BUG-057]\`, open:**` (line 497 at planning time). Leave the lines around it untouched, including the `[BUG-056]` line (handled by its own hand-off) and the dossier count (Plan decisions 4-5). R-1 and R-2 land in the same commit.
- R-3. Modify `CHANGELOG.md` in the `## [1.42.0] - 2026-10-27` section (Plan decision 3):
  - If that section already has a `### Fixed` heading (the `[BUG-056]` records landed first, or in the same batch), append this bullet as the last bullet of that `### Fixed` list, after the `[BUG-056]` bullet.
  - Otherwise, after the last `### Added` bullet (`[FEAT-049]`) and before the blank line that precedes `## [1.41.0]`, insert one blank line, the heading `### Fixed`, and this bullet.

  The id marker is the bullet's first token, so record-parity reads it as a claim (`docs/RELEASE-CLOSEOUT.md`, "What a CHANGELOG entry must look like").

  ```
  - **[BUG-057]** Loading project memory at phase entry no longer reads all of `.claude/memory/project.md`. `/cc-implement`, `/cc-plan` and `/cc-resume` Read it with `limit: 60` and stop at the `## Current State` digest, which `/cc-checkpoint` keeps within 40 lines at the top of the file while the history below stays append-only. The read cost no longer grows with project age, and the read no longer collides with Guard 1's 150-line rule. A file with no digest yet takes a bounded fallback until its next checkpoint. Pinned by `tests/unit/bounded-project-memory.test.js`. Fixed by `5b4411d` (PR #86), intake of issue #77. This entry was back-filled on 2026-11-20.
  ```

  Add no other heading (Global Constraints). No dependency.
- R-4. Run `node tools/record-parity.mjs && node tools/version-gate.mjs && npx vitest run tests/tools/repo-invariants.test.js`. Expected:
  - `record-parity` exits 0 with no `FAIL [` line.
  - `version-gate` exits 0.
  - `Test Files 1 passed (1)` with no failed test. The filter's full match set is the whole of `repo-invariants.test.js`, and every test in it is green, including the record-parity rows and "lists every open filed defect in Known limits, and only those".

  Run after R-1 through R-3, before the commit.
- R-5. Suggested commit subject: `docs: close the BUG-057 records, fixed by 5b4411d in 1.42.0 [BUG-057]`. When batched with `[BUG-056]` in one commit, the subject names both ids.

### Task 2: Full suite and scope check (spec AC6)

**Files:**
- Modify: this plan (checkboxes only)

- [X] [T-002-A] Run `git diff --stat origin/main -- .claude project-template global skills lib scripts tools tests bin VERSION package.json package-lock.json .github README.md CHANGELOG.md "AGENT-READABLE BACKLOG.md"`. Expected: empty. No command, hook, installer, settings, code, test, version, workflow or record change (AC6). Depends on T-001-A through T-001-E.
- [X] [T-002-B] Run `git diff --name-only origin/main`. Expected: exactly `.gitignore`, the spec and this plan.
- [X] [T-002-C] Run `npm test`. Expected: exit 0 and no failed test file. A failure caused by the sandbox environment (network, tmp permissions) is reported as ENV with its test name. Any other red stops the build and is reported (Global Constraints).
- [X] [T-002-D] Stage: `git add -u docs/superpowers/plans/2026-11-20-bug057-project-md-grows-without-bound-while-the-phase.md` so the Task 1 and Task 2 ticks are committed. Depends on T-002-A through T-002-C.
- [X] [T-002-E] Commit: `docs: verify the BUG-057 fix on main against the full suite [BUG-057]`. Depends on T-002-D. This is the last group, so no later commit picks up its own tick; the closeout leaves that tick in the final commit of the tree.

## Test List

- [X] Unit: `tests/unit/bounded-project-memory.test.js`, 9 of 9 (AC2-AC3), unchanged.
- [X] Hooks: Guard 1's `limit` early return and the byte identity of the two `pre-tool-use.mjs` copies (AC4), checked by T-001-E; the existing hook suites run inside `npm test`, unchanged.
- [X] Records on this branch: `tests/tools/repo-invariants.test.js` stays green inside `npm test`, with no record changed. On the `records/*` branch, R-4 runs it with `tools/record-parity.mjs` and `tools/version-gate.mjs` (AC5).
- [X] Full suite: `npm test` green (AC6).

## Commit Order

1. Task 0: this plan and its `.gitignore` leaf, made at the end of the planning session.
2. Task 2: Task 1's and Task 2's ticks. Task 1 has no commit of its own.
3. Outside this branch: the Records hand-off commit on a `records/*` branch through the release process, batched with `[BUG-056]` (spec, Owner Decisions).

When the build's commits are made as one commit of the tree, the order above is the order of the edits and the content of that one commit.

## Identified Risks

- **The Records guard on this PR.** `tools/records-guard.mjs` flags a `[BUG-057]` heading flip, an added DONE line or a CHANGELOG change on any PR that is not the owner's or the release App's. This branch edits no record, so the guard is green here. T-002-A and T-002-B catch a stray record edit before the commit. The item is not merged while that guard is red (spec, Owner Decisions, "Merge gate"; AC7).
- **The item is not closed until the records branch merges.** This PR verifies the fix and carries the spec and plan; AC5 is met only when the `records/*` branch lands. The hand-off content is fixed here so that branch does not re-derive it.
- **Two items back-filling one release.** `[BUG-056]` and `[BUG-057]` both add a `### Fixed` bullet under `## [1.42.0]`. Applying both hand-offs literally would add two `### Fixed` headings. R-3 appends to an existing `### Fixed` section instead (Plan decision 3).
- **A release lands between planning and build.** Line numbers can drift, and the `[1.42.0]` section can move. R-1, R-2 and R-3 anchor on text (the heading, the `- **\`[BUG-057]\`, open:**` prefix, the `## [1.42.0]` heading), not on line numbers. A release that already closed `[BUG-057]` makes the hand-off empty, and the records branch then adds no duplicate records.
- **Parity red from a wrong placement.** A bullet under the top heading, or a DONE line that names a version other than `1.42.0`, turns record-parity red. R-4 catches this before the records commit.
- **The invariant test is red if only one of the backlog and README edits is made.** Both edits are in the same records commit (Plan decision 4), and R-4 runs before it.
- **The T-001-C grep is line-based.** It finds a Read of `project.md` without a `limit` on the same line. The three readers keep the instruction on one line, and `bounded-project-memory.test.js` AC1 pins the same property structurally, so T-001-D backs up T-001-C.
