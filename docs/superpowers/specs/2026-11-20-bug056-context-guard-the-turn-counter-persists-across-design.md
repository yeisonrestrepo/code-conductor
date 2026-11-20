# BUG-056 Context-Guard Turn Counter Persists Across Sessions — Closure Design

**Status:** Draft (pending independent review)
**Backlog:** `[BUG-056]` · **Issue:** #78

## Problem

The backlog entry for `[BUG-056]` is still open, but the defect it describes is already fixed on `main`. Commit `2d8e236` ("fix: key the context-guard turn count to the session id [BUG-056]", 2026-10-23, merged via PR #98) keys `.claude/memory/turn-count.txt` to the hook's stdin `session_id`. A fresh session now restarts the count at 1 and no longer inherits the previous session's WARNING or CRITICAL banner. The fix follows the approved spec `docs/superpowers/specs/2026-10-23-bug056-context-guard-session-reset-design.md` and its plan `docs/superpowers/plans/2026-10-23-bug056-context-guard-session-reset.md`.

Three records still describe the bug as open:

- `AGENT-READABLE BACKLOG.md:1035` keeps `### [ ] \`[BUG-056]\``.
- `README.md:496` keeps a Known-limits line, "`[BUG-056]`, open: …", with a manual workaround.
- `CHANGELOG.md` has no `[BUG-056]` entry.

A user who reads the README is told to delete the counter file by hand for a bug that no longer exists.

## Solution

No code changes. The item closes by bringing the three records in line with `main`:

1. Tick `[BUG-056]` in the backlog and add a DONE line that cites `2d8e236`, the 2026-10-23 spec, and the 2026-10-23 plan.
2. Remove the `README.md:496` Known-limits line.
3. Add a `CHANGELOG.md` entry for `[BUG-056]` under the next release.

The backlog asked whether a session-start reset is enough or the metric itself should change. The 2026-10-23 spec answered that with a per-session reset keyed to `session_id`. The metric stays prompt-based. See Owner Decisions.

## Owner Decisions

- **Closure path:** the item closes with the existing fix (`2d8e236`). It is not re-specified or re-implemented.
- **Records:** closing the item includes ticking `[BUG-056]` in the backlog with a reference to `2d8e236`, removing the `README.md:496` Known-limits line, and adding the CHANGELOG entry. The owner explicitly authorized these record edits for this item.
- **Metric:** the counter keeps measuring prompts. No new backlog item is opened to measure context size instead.

## Behavior

### Main path

1. The hook behavior on `main` is already correct: a prompt whose stdin `session_id` differs from the stored id restarts the count at 1. A matching id increments the count. Thresholds and banners are unchanged.
2. The backlog shows `[X] \`[BUG-056]\`` with a DONE line citing `2d8e236`.
3. The README no longer lists `[BUG-056]` under Known limits.
4. `CHANGELOG.md` records the fix under `[BUG-056]`.

### Alternative paths

- `--resume` of the same session: ids match and the count continues. This is unchanged from the 2026-10-23 spec.
- No stdin `session_id` (older Claude Code, manual run): the stored count increments as before 2d8e236. This is unchanged.

### Error cases

- None introduced. No code changes in this item.

## Acceptance Criteria

- [ ] `git merge-base --is-ancestor 2d8e236 HEAD` succeeds on the item branch.
- [ ] `.claude/hooks/context-guard.{sh,ps1}` and `project-template/.claude/hooks/context-guard.{sh,ps1}` are byte-identical pairs, and both read `session_id`.
- [ ] `tests/hooks/context-guard.test.js` passes, including "stale count from another session — restarts at 1".
- [ ] `AGENT-READABLE BACKLOG.md` shows `### [X] \`[BUG-056]\`` with a DONE line citing `2d8e236`.
- [ ] `README.md` has no `[BUG-056]` Known-limits line.
- [ ] `CHANGELOG.md` has a `[BUG-056]` entry.
- [ ] No hook, installer, or settings file changes in this item.

## Out of Scope

- Changing the metric from prompts to context size (owner decision: no new item).
- Any change to `context-guard.*`, `post-compact.*`, or `settings.json`.
- A `SessionStart` reset hook (rejected in the 2026-10-23 spec).

## System Impact

- Documentation and records only: `AGENT-READABLE BACKLOG.md`, `README.md`, `CHANGELOG.md`.
- No runtime, installer, or test changes.

## Files Requiring Full Read

- None. The closure edits are single entries at known lines: `AGENT-READABLE BACKLOG.md:1035`, `README.md:496`, and the head of `CHANGELOG.md`.

## Complexity Estimate

XS. Three record edits, no code.
