# BUG-057 project.md Grows Without Bound While the Phase Commands Instruct a Full Read — Closure Design

**Status:** Draft (pending independent review)
**Backlog:** `[BUG-057]` · **Issue:** #77

## Problem

The backlog entry for `[BUG-057]` is still open (`AGENT-READABLE BACKLOG.md:1052`, `### [ ]`), but the defect it describes is already fixed on `main`. Commit `5b4411d` ("fix: bound the phase-entry read of project memory [BUG-057]", 2026-10-22) merged through PR #86 (`fa127ef`) and is an ancestor of this branch's base `f37d515`. It implements the approved spec `docs/superpowers/specs/2026-10-22-bug057-bounded-project-memory-design.md` (approach B of 4) and its plan `docs/superpowers/plans/2026-10-22-bug057-bounded-project-memory.md`.

The entry reported three facts, verified at `6f4607d`. Each one now reads differently on `main` (`f37d515`):

| Entry fact at `6f4607d` | State on `main` at `f37d515` |
|---|---|
| `cc-implement.md:42`, `cc-plan.md:58` and `cc-resume.md:40` instruct a whole-file read of `project.md`. | All three, in both trees (`.claude/commands/` and `project-template/.claude/commands/`), Read `.claude/memory/project.md` with `limit: 60` and stop at `<!-- end current state -->`. Detail comes from a Grep of the heading the digest names, then a Read with `offset` and `limit: 60`. Each one ends with "Never read the whole file". |
| That read collides with Guard 1, which denies a Read of a >150-line file that has no limit. | Guard 1 returns early on any Read that carries a `limit` (`.claude/hooks/pre-tool-use.mjs:117`), so a phase-entry read can no longer reach the deny path. |
| Cost grows linearly with project age, because nothing bounds what is read. | What is read at phase entry is the `## Current State` digest that `/cc-checkpoint` maintains. It is capped at 40 lines, 12 bullets per list and 200 characters per line (`global/commands/cc-checkpoint.md:17-33`), so its size does not depend on the length of the history. |

The fix also closes the fallback for a file that has no digest yet: Read with `limit: 40`, Grep `^## (Spec|Checkpoint)` with `-n`, and Read the last match of each with `limit: 60`. The Grep output still grows with the number of headings, but each heading is one line: 73 lines (4,534 bytes) on this repository's own 3,452-line file. The first `/cc-checkpoint` then inserts the digest and ends the fallback.

The records still show the bug as open:

- `AGENT-READABLE BACKLOG.md:1052` keeps `### [ ] \`[BUG-057]\``.
- `README.md:497` keeps "`[BUG-057]`, open: …" under Known limits, with a manual prune-or-archive workaround.
- `CHANGELOG.md` has no `[BUG-057]` entry.

A reader of the README is told to prune their memory file by hand for a defect that no longer exists.

## Solution

No code changes. The item closes on the existing fix, `5b4411d`. This spec only checks, against the current `main`, that the fix still answers each fact in the entry. The three records are written on the release side, not by this item's branch (CONTRIBUTING, "Records are owner-side"):

1. Tick `[BUG-057]` in the backlog and add a DONE line that cites `5b4411d` / PR #86, the 2026-10-22 spec and the 2026-10-22 plan.
2. Remove the `README.md:497` Known-limits line.
3. Back-fill a `### Fixed` bullet for `[BUG-057]` under `## [1.42.0]` in `CHANGELOG.md`. 1.42.0 (2026-10-27) is the first release that contains `5b4411d` (2026-10-22); 1.41.0 (2026-10-21) predates it.

**The fix shape the entry left open.** The entry listed three candidates without choosing one: an index header, checkpoint digests, and cap-with-archive. The 2026-10-22 spec chose a bounded digest at the top of the file, with the history below it left untouched and still append-only. That is the index-header and digest candidates combined. Cap-with-archive was not taken because it deletes or moves history, which breaks the "append only, never delete" contract of `/cc-checkpoint` and the BUG-003 surgical-edit invariant. This spec keeps that choice: the bounded digest answers the entry's symptom, which is the cost of the phase-entry read, and re-opening the choice would re-specify shipped, tested behavior with no new defect to justify it.

The owner decided the closure path (see Owner Decisions).

## Owner Decisions

- **Closure path:** option (a). `[BUG-057]` closes on the existing fix `5b4411d`. It is not re-specified or re-implemented, and cap-with-archive is not added on top of the digest.
- **Records routing:** the same routing as `[BUG-056]`. The `CHANGELOG.md` entry is a back-filled `### Fixed` bullet under `## [1.42.0]`, the first release that contains `5b4411d`. The `README.md:497` Known-limits removal, the backlog tick and the DONE line citing `5b4411d` go on a `records/*` branch through the release process, batched with the pending `[BUG-056]` records.
- **Item branch scope:** this item's branch carries only this spec and its plan (with their `.gitignore` leaf lines). No record file changes here.
- **Merge gate:** the item is not merged while the Records guard is red.

## Behavior

### Main path

1. `/cc-implement`, `/cc-plan` and `/cc-resume` Read `project.md` with `limit: 60` and stop at the digest's terminator. The behavior is already on `main` and is unchanged by this item.
2. `/cc-spec` on approval appends its `## Spec:` entry and replaces the single `- Active spec:` line. `/cc-checkpoint` appends its `## Checkpoint` entry and maintains the digest one Edit per line, within its caps. Also already on `main`.
3. On the `records/*` branch, the backlog shows `[X] \`[BUG-057]\`` with a DONE line citing `5b4411d`, the README no longer lists `[BUG-057]` under Known limits, and `CHANGELOG.md` records the fix under `## [1.42.0]` / `### Fixed`.

### Alternative paths

- A `project.md` without a `## Current State` section, such as a file older than the fix or this repository's own file at `f37d515`: the reader takes the bounded fallback, a Read with `limit: 40` plus a Grep of headings and two Reads with `limit: 60`. The next `/cc-checkpoint` inserts the digest skeleton once. This is unchanged from the 2026-10-22 spec.
- A digest whose `<!-- end current state -->` line is missing: `/cc-checkpoint` reports the malformed section and leaves it as it is. The reader's `limit: 60` still bounds the read. Unchanged.

### Error cases

- None introduced. This item changes no code.

## Acceptance Criteria

- [ ] `git merge-base --is-ancestor 5b4411d HEAD` succeeds on the item branch.
- [ ] No command in `.claude/commands/`, `project-template/.claude/commands/` or `global/commands/` instructs a Read of `.claude/memory/project.md` without a `limit`. `tests/unit/bounded-project-memory.test.js` AC1 asserts this for the three readers in both trees.
- [ ] `npx vitest run tests/unit/bounded-project-memory.test.js` passes 9 of 9. Measured on this branch: 9 passed.
- [ ] Guard 1 still allows any Read that carries a `limit` (`.claude/hooks/pre-tool-use.mjs:117`), and the two `pre-tool-use.mjs` copies are byte-identical (`cmp` exits 0).
- [ ] On the `records/*` branch, batched with the `[BUG-056]` records: `AGENT-READABLE BACKLOG.md` shows `### [X] \`[BUG-057]\`` with a DONE line citing `5b4411d`, `README.md` has no `[BUG-057]` Known-limits line, and `CHANGELOG.md` has a `[BUG-057]` bullet under `## [1.42.0]` / `### Fixed`.
- [ ] This item's own diff touches only this spec, its plan and their `.gitignore` leaf lines. No command, hook, installer, settings or record file changes.
- [ ] The item is not merged while the Records guard is red.

## Out of Scope

- Any change to the phase commands, `/cc-checkpoint`, Guard 1 or the installer. The shipped fix is not re-specified.
- Cap-with-archive, retrieval by topic, or a queryable memory store (issue #77 calls these a feature that needs its own spec).
- Writing the records (`AGENT-READABLE BACKLOG.md`, `README.md` Known limits, `CHANGELOG.md`) on this branch. They go on a `records/*` branch through the release process.
- Bootstrapping the digest into this repository's own `.claude/memory/project.md`. Memory is written by `/cc-checkpoint` on the owner side, not by an item branch.
- Ticking the checkboxes of the 2026-10-22 plan, whose work merged while its boxes stayed unticked. That plan is approved by hash, and its boxes are not this item's work.

## System Impact

- This item: `docs/superpowers/specs/2026-11-20-bug057-project-md-grows-without-bound-while-the-phase-design.md`, its plan, and their leaf lines in `.gitignore`. Nothing else.
- On the `records/*` branch: `AGENT-READABLE BACKLOG.md:1052`, `README.md:497`, and the `## [1.42.0]` section of `CHANGELOG.md`.
- Reviewed and unaffected: `skills/memory-first/SKILL.md` and `global/CLAUDE.md` step 1, which reach `project.md` by Grep, not a whole Read; `.claude/hooks/post-compact.{sh,ps1}`, which greps only the last checkpoint heading; and `.claude/agents/*.md`, which do not reference `project.md`.

### Files Requiring Full Read (deferred to /cc-plan)

_None. The closure touches no source file; the record edits are single entries at known lines._

## Complexity Estimate

XS. No code changes; one spec, one plan, their `.gitignore` lines, and three record edits made on the `records/*` branch.
