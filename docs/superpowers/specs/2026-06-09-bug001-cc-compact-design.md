# BUG-001: Phase Boundary Compaction (`/cc-compact`)

**Status:** Approved
**Backlog ref:** BUG-001 - Context Overflow via Superpowers Redundancy

---

## Problem

Each phase of a Code Conductor session (spec - plan - implement - review) accumulates conversation history that is re-sent in full on every API call. Superpowers skills loaded mid-session are injected into context and compound with prior turns, causing O(N²) token growth. Within less than an hour of continuous development, the Claude Pro context window is exhausted.

---

## Solution

Introduce a single new slash command `/cc-compact` that acts as the structural phase-boundary tool. When called at the end of a phase, it serializes essential state into a dense, fixed-schema snapshot file (`.claude/memory/session-snapshot.md`, ≤300 tokens), then prompts the user to run `/compact` to clear conversation history. Each subsequent phase command reads the snapshot as its first step then immediately deletes it, resuming with clean context and no history debt.

---

## Behavior

### Main path

1. Agent completes a phase (e.g., spec approved).
2. Agent calls `/cc-compact`.
3. `/cc-compact` reads current phase state from conversation context.
4. Writes `session-snapshot.md` using the fixed schema (see below).
5. Outputs a prompt to the user: "Snapshot written. Run `/compact` now to clear history."
6. Next phase command (`/cc-plan`, `/cc-review`, etc.) starts fresh.
7. First step of that command: read `session-snapshot.md` then immediately delete it (Destructive Read Invariant).
8. Agent continues with clean context bounded by the snapshot.

### Alternative paths

| Situation | Behavior |
|---|---|
| `/cc-compact` called with nothing decided yet | Writes snapshot with empty Decisions/Pending sections; still prompts for `/compact` |
| `session-snapshot.md` already exists | Overwritten - only the latest phase snapshot is kept |
| Phase command starts with no snapshot present | Proceeds normally without it - snapshot is read-if-present |
| User calls native `/compact` directly | No snapshot written; next phase has no handoff context (degrades to today's behavior) |
| Phase command reads snapshot but deletion fails | Command reports the failure and halts - stale snapshot is worse than no snapshot |

### Phase handoff enforcement

Each incoming phase command (`cc-plan`, `cc-review`, `cc-implement`) performs a blocking check before doing any work:

1. Count turns in the current conversation history.
2. Check whether `session-snapshot.md` exists (i.e., previous phase ran `/cc-compact`).
3. If turn count exceeds 5 OR snapshot is absent, the agent halts immediately and outputs:
   > "Phase boundary detected. Please execute /compact to clear history before proceeding."
4. Agent enters standby - no phase tasks are started, no files are read.
5. Execution resumes only after the user confirms `/compact` has been run.

### Error cases

- If the agent cannot write `session-snapshot.md` (e.g., missing `.claude/memory/` directory), it must report the failure and NOT prompt the user to run `/compact` - partial compaction without a snapshot is worse than no compaction.

---

## Snapshot Schema

File: `.claude/memory/session-snapshot.md`

```markdown
# Session Snapshot
**Phase:** [spec | plan | implement | review]
**Commit:** <SHA-1>

## Decisions
- <one line per finalized decision, max 10>

## Pending
- <next immediate step>
- <step after that, if known>

## Files Touched
- `path/to/file` - <created | modified | deleted>

## Constraints
- <hard constraints the next phase must respect, max 5>

## Spec Reference
`docs/superpowers/specs/<filename>.md`
```

**Limits enforced by the command instructions:**
- Decisions: max 10 items
- Constraints: max 5 items
- No freeform prose - only facts the next phase can act on
- Target: ≤300 tokens total

---

## Acceptance Criteria

- [ ] `/cc-compact` command file exists at `global/commands/cc-compact.md`
- [ ] Running `/cc-compact` produces a valid `session-snapshot.md` matching the schema
- [ ] `/cc-compact` ends by prompting the user to run `/compact`
- [ ] `cc-spec.md` ends with an instruction to run `/cc-compact` before transitioning
- [ ] `cc-plan.md` ends with an instruction to run `/cc-compact` before transitioning
- [ ] `cc-spec.md` and `cc-plan.md` start with the Destructive Read Invariant: read `session-snapshot.md` then delete it
- [ ] `cc-plan.md`, `cc-review.md`, and `cc-implement.md` perform the phase handoff enforcement check before any other action
- [ ] Enforcement check halts execution and outputs the standby prompt when turn count exceeds 5 or snapshot is absent
- [ ] Agent does not resume until the user confirms `/compact` has been run
- [ ] Snapshot write failure blocks the `/compact` prompt from being shown
- [ ] Snapshot deletion failure halts the phase command and reports the error
- [ ] `session-snapshot.md` is listed in `.gitignore` (session-local, not committed)

---

## Out of Scope

- Snapshot history or versioning (one file, always overwritten)
- Automatic triggering via hooks (agent is instructed to call it; no auto-fire)
- Token counting or threshold-based auto-compaction (that is FEAT-007)
- Changes to `/cc-checkpoint` or `/cc-resume`

---

## System Impact

| File | Change |
|---|---|
| `global/commands/cc-compact.md` | New - serialize phase state to snapshot, prompt user to run `/compact` |
| `project-template/.claude/commands/cc-spec.md` | Start: Destructive Read Invariant; End: instruct agent to run `/cc-compact` |
| `project-template/.claude/commands/cc-plan.md` | Start: phase handoff enforcement check + Destructive Read Invariant; End: instruct agent to run `/cc-compact` |
| `project-template/.claude/commands/cc-review.md` | Start: phase handoff enforcement check |
| `project-template/.claude/commands/cc-implement.md` (if present) | Start: phase handoff enforcement check |
| `.gitignore` | Add `session-snapshot.md` |

---

## Complexity Estimate

**S** - One new markdown file (~50 lines), targeted additions to 2 existing command files, one `.gitignore` entry. No runtime code.
