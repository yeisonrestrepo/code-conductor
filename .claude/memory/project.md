# Project Memory

Shared team memory. Committed to git. Updated automatically by /checkpoint.

## Stack
<!-- Set by /stack -->

## Architecture Decisions
<!-- Append by /checkpoint. Never delete entries. -->

## Active Conventions
<!-- Project-specific conventions established in this codebase -->

## Technical Debt
<!-- Known shortcuts, limitations, and deferred work -->

## Workarounds
<!-- Non-obvious solutions and why they exist -->

## Spec: contributing-and-license 2026-05-25

Add Apache 2.0 LICENSE, CONTRIBUTING.md (issue + PR workflow), and .github/pull_request_template.md (auto-fills PRs on GitHub).
- License: Apache 2.0, copyright 2026 Yeison Restrepo
- Three static files, no code changes

## Spec: cc-resume 2026-05-25

New `/cc-resume` command that restores full session context in a single invocation.
- Reads: CLAUDE.md, project.md, personal.md, latest spec + plan (mtime tiebreaker), git log + status
- Renders a structured Session Resume report, then runs `/cc-stack` to fully warm the session
- Guard: stops with `/cc-init` prompt if project identity is missing
- Scope: S — read-only synthesis, no new dependencies

## Checkpoint 2026-06-10 07:23

### Decisions
- BUG-002 (Spec Read Budget) fully implemented: 30-line cap on source file reads during /cc-spec phase
- Enforcement is prompt-only (cc-spec.md instruction block); hook-level enforcement deferred to FEAT-018
- Deferred-reads slot pre-rendered in System Impact template so agent always has a named place to record deferred files
- Task 3 pre-check pattern established: grep -c before any backlog checkbox edit; halt if count != 1

### Conventions
- Backlog checkbox edits require a pre-check grep (count=1) before proceeding
- Plan file insertion blocks use hyphen not em dash for markdown consistency

### Technical Debt
- claude-mem worker unreachable breaks Read/Edit tools via PreToolUse hook; workaround: use PowerShell for file reads and modifications
- AGENT-READABLE BACKLOG.md was untracked before this session; first commit added it as a new file

## Checkpoint 2026-06-10 (BUG-003)

### Decisions
- BUG-003 implemented: surgical 5-step plan-state ritual in cc-implement.md
- Task IDs `[T-NNN+]` mandated in cc-plan.md at generation time
- cc-resume.md extended to surface `[>]` and `[!]` markers in session report
- All six command files updated (`.claude` + `project-template` mirrors)
- Hook (Step 6) is a no-op conditional on `.conductor/cache.db`

### Conventions
- Plans must include `[T-NNN]` IDs on every task checkbox line
- 4-state checkbox protocol: `[ ]` pending, `[>]` in-progress, `[X]` complete, `[!]` failed
- Pre-flip uniqueness: Grep with `\[T-NNN\]` (plain pattern, no PCRE2); count must equal 1 before any Edit

### Technical Debt
- SQLite hook in cc-implement.md Step 6 is a no-op until FEAT-005 is implemented
