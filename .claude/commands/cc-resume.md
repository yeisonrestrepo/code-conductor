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

## Step 6a: Scan active plan for in-progress and failed tasks

If a plan file was found in Step 6, scan it for active-state markers:

Run `Grep` with:
- `pattern`: `\[>\]|\[!\]`
- `path`: the plan file path found in Step 6
- `output_mode`: `content`

Collect results:
- Lines containing `[>]` are **in-progress tasks** (execution interrupted mid-flight)
- Lines containing `[!]` are **failed tasks** (execution halted; manual resolution required)

Extract the task ID (e.g. `[T-001-A]`) from each matching line. Store counts and IDs for the report.

If no `[>]` or `[!]` lines are found, skip these fields in the report.

## Step 7 — Read git state

Run:

```bash
git log --oneline -10
git status --short
git branch --show-current
```

Count the lines in the `git status --short` output — each line represents one uncommitted file. If the output is empty, the count is `"none"`.

If not inside a git repository, skip silently.

## Step 8 — Check for updates

Read the local installed version from `~/.claude/memory/conductor-version.md`.

Fetch the remote version:

```bash
curl -fsSL --max-time 5 https://raw.githubusercontent.com/yeisonrestrepo/code-conductor/main/VERSION 2>/dev/null
```

If the remote version differs from the local version, store this notice for the report:
`"⚡ code-conductor [remote version] available — run: bash install.sh to update"`

If the fetch fails or times out, skip silently. Do not stop the session.

## Step 9 — Render report

Output this report, populating each field from the steps above:

```
## Session Resume — [Name] · [YYYY-MM-DD]

[⚠ Project identity incomplete — run /cc-init to fill it in.]  ← include only if applicable
[⚡ code-conductor X.Y.Z available — run: bash install.sh to update]  ← include only if applicable

### Active Work
Spec:  [spec filename] — [spec title]
Plan:  [plan filename] — [plan title]
In-progress: [count] task(s) - [task IDs]   (include only if [>] tasks were found in Step 6a)
Failed:      [count] task(s) - [task IDs]   (include only if [!] tasks were found in Step 6a)

### Recent Commits
[git log --oneline -10 output]

### Open Changes
Branch: [branch name]  ·  Uncommitted: [count, or "none"]

### Memory Highlights
[latest checkpoint block — 3 bullets max]

### Session Preferences
[personal.md relevant lines]
```

## Step 10 — Load stack profile

Run `/cc-stack` to detect and load the matching stack profile.

If `/cc-stack` cannot detect a stack or reports an error, append this line to the report:
`"⚠ Stack could not be detected — run /cc-stack manually."`
Do not stop the session.
