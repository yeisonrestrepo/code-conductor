---
description: "(Conductor) Initialize or re-sync the project environment"
---

## Step 1 — Detect project state

List files in the project (exclude `.git/`, `.claude/`, `node_modules/`, and dot-files, max depth 3). Count source files found.

If the count is 0 or only `CLAUDE.md` / config files exist, treat this as a **new/empty project** (`IS_NEW=true`). Otherwise set `IS_NEW=false`.

## Step 2 — Collect project identity

Read `CLAUDE.md`. Check the `## Project Identity` section.

If **Name** is empty or missing, ask the user all of these questions at once (not one at a time):

1. What is the project name?
2. One sentence: what does it do?
3. Primary tech stack (e.g. "TypeScript + React", "Python + FastAPI") — **only ask if `IS_NEW=false`**
4. Response language preference? (default: `en` — only ask if context suggests otherwise)

Once collected, replace the `## Project Identity` section content in `CLAUDE.md` with:

```
- **Name:** <name>
- **Description:** <description>
- **Stack:** <stack, or "TBD — run /cc-stack when code exists" if IS_NEW=true>
- **Language:** <language code>
```

If the section is already populated, skip the questions and proceed.

## Step 3 — Stack detection *(skip if IS_NEW=true)*

Run `/cc-stack`. Wait for stack profile confirmation before continuing.

## Step 4 — Memory checkpoint *(skip if IS_NEW=true)*

Run `/cc-checkpoint`. Persist current architectural state to `.claude/memory/project.md`.

## Step 5 — Graph sync *(skip if IS_NEW=true)*

Run `/graphify .` to build or refresh the project knowledge graph from the current working directory.

## Step 6 — Hook integrity check

Verify `.claude/hooks/pre-tool-use.sh` exists and is executable:

```bash
HOOK=".claude/hooks/pre-tool-use.sh"
if [ ! -f "$HOOK" ]; then
  echo "⚠️  Hook missing: $HOOK"
  echo "Run: bash install.sh  (or copy from project-template/.claude/hooks/)"
  exit 1
fi
[ -x "$HOOK" ] || chmod +x "$HOOK"
echo "✓ Hook OK: $HOOK"
```

If the hook file is absent, stop and report. Do not proceed silently.

## Step 7 — Confirm

Report:
- Project identity: [name / stack / language — written to CLAUDE.md]
- Stack profile loaded: [name / skipped — new project]
- Memory checkpoint: [saved / skipped — new project]
- Graph: [built / refreshed / skipped — new project]
- Hook: [OK / MISSING]

`/cc-init complete.`
