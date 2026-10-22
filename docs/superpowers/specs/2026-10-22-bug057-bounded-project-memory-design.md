# BUG-057: Bounded Project Memory at Phase Entry

**Status:** Draft — awaiting operator approval. **Target:** a patch release, which the owner cuts. **Approach:** B of 4 (a bounded `## Current State` digest at the top of `project.md`, history kept below and untouched).

## Problem

`.claude/memory/project.md` is append-only by design: `/cc-spec` appends a `## Spec:` entry on approval (`.claude/commands/cc-spec.md:127`) and `/cc-checkpoint` appends a `## Checkpoint` entry, "append only, never delete" (`global/commands/cc-checkpoint.md:13`). Nothing prunes or caps it. Three phase commands then instruct reading it whole:

- `cc-implement.md:42`: "Read `.claude/memory/project.md` before starting any task."
- `cc-plan.md:58`: "Read `.claude/memory/project.md` and this project's `CLAUDE.md` before doing anything else." (`:55` also looks for the approved spec in it.)
- `cc-resume.md:40`: "Read `.claude/memory/project.md`."

Each line is the same in both mirrors (`.claude/commands/` and `project-template/.claude/commands/`).

This repository's copy measured 3,217 lines, 442,612 bytes and 119 `## ` entries on 2026-10-22. A Read with no `limit` of a file over 150 lines is denied by Guard 1 (`pre-tool-use.mjs:80-94`). The agent then either chunks the file through 22 windows of 150 lines (about 110k tokens) or skips the read, and the memory-first chain loses its first rung. The cost grows linearly with project age, which inverts Pillar 1.

A second defect sits under the first. `cc-resume.md:43-45` extracts `## Active Conventions` and `## Technical Debt`, but no command writes those sections: `/cc-checkpoint` puts conventions and debt under `### Conventions` / `### Technical Debt` inside each appended entry. In this repository both top sections hold only their placeholder comment, so resume always reports them empty. The fix below replaces that read, so it closes this too.

## Measurements (POC, 2026-10-22)

Throwaway script run against a copy of this repository's `project.md`. It was also run against the first 50% and 25% of the file to show growth. Bytes are what the agent must read at phase entry. Tokens are bytes/4, a rough heuristic, not a tokenizer. The POC was not committed.

| Candidate | 25% (804 lines) | 50% (1,609 lines) | 100% (3,217 lines) | Grows with age? |
|---|---|---|---|---|
| 0 Today: full read | 109,110 B, 6 reads | 242,053 B, 11 reads | 442,612 B, 22 reads (~110k tok) | linear |
| A Index (header + `^## ` heading list + latest spec + latest checkpoint) | 9,412 B | 17,720 B | 12,200 B (index alone 7,751 B) | index linear, ~65 B per entry |
| B Current State digest + one targeted spec read | 10,152 B (digest 4,786) | 10,417 B (digest 4,987) | 5,168 B (digest 3,508, 30 lines) | **no**: digest capped |
| C Cap at 150 lines (header + newest entries), rest archived | 31,409 B | 22,415 B | 13,963 B, keeps 6 of 119 entries | no, but bytes swing 2x |
| D conductor-db | not measured, see below | | | |

Other figures: an entry averages 27 lines (max 127). 246 lines are over 400 characters (max 1,420), so a line cap alone does not bound bytes. Option C's first run moves 3,083 lines in one operation.

The digest for B came from the newest 12 Conventions and 12 Debt bullets across the checkpoints, cut at 200 characters, plus the active spec and last checkpoint headings. It held the BUG-061 spec reference, current conventions and open debt, so all four facts the phase commands need were still reachable.

## Solution

A `## Current State` section sits directly under the file's `# Project Memory` intro, ends at a fixed terminator line, and is capped so it always fits in the first 60 lines:

```markdown
## Current State
<!-- Bounded digest, max 40 lines, each line max 200 characters. History below is append-only. -->
- Active spec: <spec heading text, without the leading "## "> | none
- Last checkpoint: <checkpoint heading text, without the leading "## "> | none
### Conventions
- <max 12 bullets>
### Debt
- <max 12 bullets>
<!-- end current state -->
```

**Readers** (`cc-implement`, `cc-plan`, `cc-resume`, both mirrors) Read `project.md` with `limit: 60` and stop at the terminator. For detail they Grep the heading named by `Active spec:` / `Last checkpoint:` with `-n`, then Read that entry with `offset` and `limit: 60`. A Read with a `limit` passes Guard 1, so the hook does not change.

**Fallback** (no `## Current State` yet, which is every existing install until its next checkpoint): Read with `limit: 40`, then Grep `^## (Spec|Checkpoint)` with `-n` and Read the last match of each with `offset` and `limit: 60`. This is the same bounded cost as option A, with no format change.

**Writers** follow BUG-003, one surgical edit per field:

- `/cc-spec` on approval still appends its `## Spec:` entry, then replaces the single `- Active spec:` line.
- `/cc-checkpoint` still appends its `## Checkpoint` entry, unchanged and still the verbatim source of the DB tail's `pr`. Then it replaces the single `- Last checkpoint:` line, adds one bullet per new convention or debt item, and removes one superseded or resolved bullet per Edit whenever a list would go over 12. A removed bullet is not lost: the history entry below holds it verbatim.
- **Bootstrap:** when the section is absent, `/cc-checkpoint` inserts the skeleton once, directly after the intro, in one Edit that inserts and changes no existing byte. It then fills it field by field as above.

Field values never start with `## `, so the post-compact hooks' unanchored `grep "## Checkpoint" | tail -1` (`post-compact.sh:18`, `post-compact.ps1:27`) still finds the newest appended entry.

## Why the others lose

- **A, index header:** the measured index grows about 65 B per entry with no ceiling, so Pillar 1's bound is only postponed. Conventions and debt stay spread across 45 checkpoints and no index can gather them. A written index would also add a writer that must keep the index in sync on every append. A is kept as B's fallback, because it needs no format change.
- **C, cap with archive:** the first run is a 3,083-line move and every later checkpoint repeats a smaller one. That is the bulk rewrite of a tracking file BUG-003 forbids, and a crash between the archive write and the trim leaves duplicates or a gap. Kept bytes still swing 2x because lines are long. Conventions older than the six kept entries leave the read path. It also adds a new host-owned file to `lib/installer/host-owned.mjs`, a protected surface.
- **D, conductor-db:** `.conductor/cache.db` is a local, gitignored, fail-open cache with bounded retention (FEAT-025). `project.md` is the team record in git. Moving the read path there loses sharing and fresh-clone recovery, which hurts Pillar 2. The snapshot's `pr` already covers same-commit resume (ARCH-008-B), and nothing more is needed from it here.
- **Reuse the existing top sections** (`## Active Conventions` / `## Technical Debt`) **instead of a new section:** host files carry the comment "Append by /checkpoint. Never delete entries." over `## Architecture Decisions`, and curating them would contradict the host's own text. The five sections also have no single terminator to bound the read. They stay as they are.

## Pillar justification

- **Pillar 1:** phase-entry read cost is constant: at most 60 lines × 200 characters, about 12 KB worst case, 3.5 KB measured, against 442 KB today. It no longer grows with project age.
- **Pillar 2:** history stays append-only and byte-for-byte intact. The digest is derived data that can always be rebuilt from history. No file moves, no deletion, no new store.
- **Simplicity:** command text only, with no script, no new file, and no hook or installer change.
- **BUG-003:** every digest update is one single-line Edit. The single bootstrap insert is the only multi-line Edit, and it adds new lines without overwriting any (see Open Questions).

## Behavior

### Main path

1. `/cc-plan` Reads `project.md` with `limit: 60` and finds `- Active spec: Spec: BUG-061, ... [2026-10-21]`.
2. It Greps `^## Spec: BUG-061` with `-n` in `project.md`, gets one line number, and Reads that entry with `offset` and `limit: 60`.
3. At exit, `/cc-checkpoint` appends its entry, then makes one Edit to `- Last checkpoint:` and one Edit per new bullet.

### Alternative paths

- **No `## Current State` (existing install, or a fresh scaffold from the unchanged stub):** fallback read as above. The next `/cc-checkpoint` bootstraps the section.
- **`Active spec: none` and no spec in the conversation:** `/cc-plan` halts with its existing "No approved spec found" message.
- **A list at its cap:** the writer removes the bullet it judges superseded or resolved before adding the new one, each in its own Edit.
- **A bullet over 200 characters:** the writer shortens it and leaves the full text in the history entry.

### Error cases

- **`project.md` absent:** unchanged. Readers note "No checkpoints yet", and `/cc-init` creates it through the installer seed.
- **Terminator missing (hand-edited file):** readers still use only the first 60 lines, so the cost stays bounded. `/cc-checkpoint` reports the malformed section and does not try to repair it in bulk.
- **Active spec heading not found by Grep (renamed by hand):** fall back to the last `^## Spec:` match.

## Acceptance Criteria

- [ ] AC1: no phase command in either mirror instructs a Read of `.claude/memory/project.md` without a `limit`. `cc-implement`, `cc-plan` and `cc-resume` each say `limit: 60` and name the `<!-- end current state -->` terminator.
- [ ] AC2: the same three commands name the fallback for a file with no `## Current State`: `limit: 40`, then Grep `^## (Spec|Checkpoint)` with `-n` and a Read by `offset`.
- [ ] AC3: `cc-resume` Step 3 extracts the last checkpoint, conventions and debt from `## Current State` and no longer from `## Active Conventions` / `## Technical Debt`.
- [ ] AC4: `global/commands/cc-checkpoint.md` keeps "append only, never delete" for history, carries the skeleton verbatim, states the caps (40 lines, 12 bullets per list, 200 characters per line), and names one Edit per field or bullet plus the one-time bootstrap insert.
- [ ] AC5: both `cc-spec` mirrors replace the single `- Active spec:` line after the existing append, and the mirrors still differ only in script-path nesting.
- [ ] AC6: the skeleton as written in `cc-checkpoint.md`, filled to its caps, fits within 60 lines of a file whose intro is the stub's 3 lines (pinned by test).
- [ ] AC7: `project-template/.claude/memory/project.md` is byte-identical to its `b018793` content. `warnIfProjectMemoryIsStub` (`lib/installer/deploy.mjs:152-168`) byte-compares against it, so changing it would blind the 1.28/1.29 overwrite warning.
- [ ] AC8: `staging-convention.test.js` and `commands-parity.test.js` pass unchanged, and the full suite passes.

## Migration

- The installer seeds `memory/project.md` only when absent (`host-owned.mjs:36`, `'seed'`). Existing hosts keep their file byte-for-byte. No installer change, no migration script.
- Commands ship through the normal install. On an old-format file they take the fallback, which is already bounded. The first `/cc-checkpoint` after upgrade inserts the section, so each host migrates itself, one surgical Edit at a time, and the history is untouched.
- The stub is deliberately unchanged (AC7). Fresh scaffolds take the same bootstrap path as existing hosts, so there is one code path.
- This repository's own `project.md` is not edited by this item. It migrates on its next owner checkpoint.

## Out of Scope

- The release and its records (`VERSION`, package versions, `CHANGELOG.md`, the backlog flip, README Known limits, the `project.md` closeout), per `docs/RELEASE-CLOSEOUT.md`.
- Guard 1 and every hook (protected surfaces). No change is needed.
- `lib/installer/*` and `host-owned.mjs`. No new host-owned file.
- Archiving, trimming or rewriting history in any `project.md`.
- The stub's leaked dogfood content (reported separately, below).
- `skills/memory-first/SKILL.md` and `global/CLAUDE.md`: both already reach `project.md` through Grep, which is bounded.

## System Impact

- `.claude/commands/cc-implement.md:42`, `project-template/.claude/commands/cc-implement.md:42`
- `.claude/commands/cc-plan.md:55,58`, `project-template/.claude/commands/cc-plan.md:55,58`
- `.claude/commands/cc-resume.md:38-47`, `project-template/.claude/commands/cc-resume.md:38-47` (byte-identical pair, `commands-parity.test.js:258`)
- `.claude/commands/cc-spec.md:127-134`, `project-template/.claude/commands/cc-spec.md:127-134`
- `global/commands/cc-checkpoint.md:13-15` (the DB-tail paragraph `:33-40` is unchanged: `pr` stays the appended entry)
- `.github/wiki/pages/Memory-Architecture.md` (one paragraph on the layout)
- New test: `tests/unit/bounded-project-memory.test.js`

### Predicted test count

| File | Before | After | Delta |
|---|---|---|---|
| `tests/unit/bounded-project-memory.test.js` (new) | 0 | 8 | +8 |
| `tests/installer/commands-parity.test.js` | 50 | 50 | 0 |
| `tests/unit/staging-convention.test.js` + `tests/installer/host-owned.test.js` | 17 | 17 | 0 |
| Full suite | N | N + 8 | +8 |

Before counts measured locally on 2026-10-22 (Windows, gh isolated). N is the CI Linux baseline at merge time.

### Files Requiring Full Read (deferred to /cc-plan)

- `global/commands/cc-checkpoint.md` (53 lines, already read whole)
- `.claude/commands/cc-resume.md:38-60`

## Other Findings (not fixed here)

- `project-template/.claude/memory/project.md` seeds every host with this repository's own BUG-001 checkpoint (file list included), its conventions and its FEAT-005 debt. That is dogfood content leaking into host memory. Any fix has to account for `warnIfProjectMemoryIsStub`'s byte compare.
- The `cc-spec` mirrors have no parity test, unlike `cc-plan`, `cc-init`, `cc-implement` and `cc-resume`.

## Open Questions

1. Is the one-time multi-line bootstrap insert acceptable under BUG-003, or should the skeleton be inserted one line per Edit (7 Edits)?
2. Caps: 40 lines, 12 bullets per list and 200 characters per line came from this POC. Does the owner want different numbers?

## Complexity Estimate

S: command text in eight mirrored files plus one global command, one wiki paragraph and one 8-test file. No code, hook or installer change.
