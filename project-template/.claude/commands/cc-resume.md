---
description: "(Conductor) Restore full session context in a fresh Claude Code session"
---

## Step 1 — Verify project initialization

Check if `CLAUDE.md` exists in the current directory.

- If **absent**: stop immediately and output — `"Project not initialized. Run /cc-init first."`
- If **present but `## Project Identity` fields are all empty**: continue and include this warning at the top of the final report: `"⚠ Project identity incomplete — run /cc-init to fill it in."`

## Step 2 — Read project identity

Read `CLAUDE.md`. Extract:
- **Name** (from `- **Name:**`)
- **Description** (from `- **Description:**`)
- **Stack** (from `- **Stack:**`)
- **Language** (from `- **Language:**`)

Use `—` for any missing fields.

## Step 3 — Read project memory

Read `.claude/memory/project.md`.

Extract:
- The content of the most recent `## Checkpoint [...]` block (3 bullets max)
- Any entries under `## Active Conventions`
- Any entries under `## Technical Debt`

If the file is absent or has no `## Checkpoint` block, note `"No checkpoints yet"`.

## Step 4 — Read personal preferences

Read `.claude/memory/personal.md`. Extract developer preferences (verbosity, shortcuts, habits).

If the file is absent, skip silently.

## Step 5 — Find latest spec

List files in `docs/superpowers/specs/`. Select the file with the most recent modification time (`mtime`). Extract its first `#` heading as a one-line summary.

If the directory is absent or empty, use `none`.

## Step 6 — Find latest plan

List files in `docs/superpowers/plans/`. Select the file with the most recent modification time (`mtime`). Extract its first `#` heading as a one-line summary.

If the directory is absent or empty, use `none`.

## Step 7 — Read git state

Run:

```bash
git log --oneline -10
git status --short
git branch --show-current
```

If not inside a git repository, skip silently.

## Step 8 — Render report

Output this report, populating each field from the steps above:

```
## Session Resume — [Name] · [YYYY-MM-DD]

[⚠ Project identity incomplete — run /cc-init to fill it in.]  ← include only if applicable

### Active Work
Spec:  [spec filename] — [spec title]
Plan:  [plan filename] — [plan title]

### Recent Commits
[git log --oneline -10 output]

### Open Changes
Branch: [branch name]  ·  Uncommitted: [count, or "none"]

### Memory Highlights
[latest checkpoint block — 3 bullets max]

### Session Preferences
[personal.md relevant lines]
```

## Step 9 — Load stack profile

Run `/cc-stack` to detect and load the matching stack profile.
