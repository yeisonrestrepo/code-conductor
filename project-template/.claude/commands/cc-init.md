---
description: "(Conductor) Initialize or re-sync the project environment"
---

## Step 1 — Stack detection

Run `/cc-stack`. Wait for stack profile confirmation before continuing.

## Step 2 — Memory checkpoint

Run `/cc-checkpoint`. Persist current architectural state to `.claude/memory/project.md`.

## Step 3 — Graph sync

Run `/graphify .` to build or refresh the project knowledge graph from the current working directory.

## Step 4 — Hook integrity check

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

## Step 5 — Confirm

Report:
- Stack profile loaded: [name]
- Memory checkpoint: [saved / skipped — reason]
- Graph: [built / refreshed / skipped — reason]
- Hook: [OK / MISSING]

`/cc-init complete.`
