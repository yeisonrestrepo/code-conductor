# Project Memory

Shared team memory. Committed to git. Updated automatically by /checkpoint.

## Stack
<!-- Set by /stack -->

## Architecture Decisions
<!-- Append by /checkpoint. Never delete entries. -->

### Checkpoint 2026-06-09 17:45

**BUG-001: Phase Boundary Compaction (/cc-compact) — v1.7.0**

- **Decided:** phase context clearing uses a dedicated `/cc-compact` command (not baked into phase commands, not an extension of `/cc-checkpoint`). One command, one invariant: serialize then prompt for `/compact`.
- **Decided:** snapshot schema is fixed and token-bounded (≤300 tokens): Phase, Commit (full SHA-1 via `git rev-parse HEAD`), Decisions (max 10), Pending, Files Touched, Constraints (max 5), Spec Reference. No freeform prose.
- **Decided:** snapshot file is `.claude/memory/session-snapshot.md`, gitignored, single instance (always overwritten).
- **Decided:** Destructive Read Invariant — every phase command that reads the snapshot must delete it immediately after reading. Deletion failure halts the command.
- **Decided:** Phase Handoff Enforcement uses decoupled conditions — turn count > 5 is the only blocking halt; absent snapshot is a read-if-present fallback, not a blocker (prevents infinite standby on fresh sessions).
- **Decided:** `/compact` is user-invoked, not agent-invoked. `/cc-compact` outputs a prompt; it does not call `/compact` itself.
- **Rejected:** extending `/cc-checkpoint` with phase-boundary semantics (blurs its purpose as a general decision-saver).
- **Rejected:** baking compaction logic directly into phase commands (harder to evolve independently).

**Files added/modified:**
- `global/commands/cc-compact.md` — new
- `project-template/.claude/commands/cc-implement.md` — new
- `project-template/.claude/commands/cc-spec.md` — DRI + exit prompt
- `project-template/.claude/commands/cc-plan.md` — enforcement + DRI + exit prompt
- `project-template/.claude/commands/cc-review.md` — enforcement + DRI

## Active Conventions
<!-- Project-specific conventions established in this codebase -->

- No em-dashes (—) anywhere in command files or docs — use hyphens (-) or colons (:).
- All phase command files use `## Phase entry - <Name>` and `## Phase exit` section headers (second-level).
- Spec files live in `docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md` (force-added since `docs/` is gitignored).
- Plan files live in `docs/superpowers/plans/YYYY-MM-DD-<slug>.md` (force-added).
- VERSION file contains a single semver string. Minor bump for new behavioral features.

## Technical Debt
<!-- Known shortcuts, limitations, and deferred work -->

- `docs/` is in `.gitignore` but spec/plan files need to be tracked — currently force-added individually. Should add `!docs/superpowers/` exception to `.gitignore` to fix this properly (deferred).
- BUG-001 enforcement check relies on the agent counting turns correctly — no programmatic turn counter exists yet. FEAT-007 (token threshold auto-compaction) would make this structural.
- `/cc-compact` depends on the agent accurately recalling phase state from conversation context — no structured state extraction mechanism exists yet (FEAT-005 SQLite layer would fix this).

## Workarounds
<!-- Non-obvious solutions and why they exist -->
