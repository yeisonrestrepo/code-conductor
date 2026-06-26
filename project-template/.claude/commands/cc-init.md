---
description: "(Conductor) Initialize or re-sync the project environment"
---

## Step 1 — Detect project state

List files in the project (exclude `.git/`, `.claude/`, `node_modules/`, and dot-files, max depth 3). Count source files found.

If the count is 0 or only `CLAUDE.md` / config files exist, treat this as a **new/empty project** (`IS_NEW=true`). Otherwise set `IS_NEW=false`.

## Step 2 — Auto-detect and collect project identity

Check if `scripts/detect-stack.mjs` exists in the project root. If it does, run:

```bash
node scripts/detect-stack.mjs "$PWD"
```

**Environment flags:** `CC_GLOB_DEPTH` and any other `CC_*` env vars the user may have set are automatically inherited by the child `node` process — no explicit export or forwarding is required. The `/cc-init` command must NOT reset or unset these variables before calling detect-stack.

Capture the JSON output. For each field in the JSON (name, description, stack, build, test, lint, format, setup), check the corresponding line in CLAUDE.md:
- If the CLAUDE.md line contains `<command>` (any case) or is blank after `Key:` → replace with the detected value using a single `Edit` call.
- If the CLAUDE.md line already has a non-placeholder value → skip (never overwrite).

Apply all replacements in a **single `Edit` call** after collecting all detected values.

If `scripts/detect-stack.mjs` is missing or returns `{}`, skip auto-detection.

After auto-detection (or if skipped), check which identity fields remain blank:

Read `CLAUDE.md`. Check the `## Project Identity` section.

If **Name** is still empty, ask the user all of these questions at once (not one at a time):

1. What is the project name?
2. One sentence: what does it do?
3. Primary tech stack (e.g. "TypeScript + React", "Python + FastAPI") — **only ask if `IS_NEW=false` AND stack was not auto-detected**
4. Response language preference? (default: `en` — only ask if context suggests otherwise)

If Name was already filled (by auto-detection or previous run), skip directly to Step 3 without asking.

Once any manual fields are collected, update CLAUDE.md with a single `Edit` call covering all remaining blank fields.

**CI mode:** If `CI=true` or stdin is not a TTY, skip all interactive questions. Leave unresolved `<command>` placeholders in place.

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
