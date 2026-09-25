---
description: "(Conductor) Initialize or re-sync the project environment"
---

## Step 1 — Detect project state

List files in the project (exclude `.git/`, `.claude/`, `node_modules/`, and dot-files, max depth 3). Count source files found.

If the count is 0 or only `CLAUDE.md` / config files exist, treat this as a **new/empty project** (`IS_NEW=true`). Otherwise set `IS_NEW=false`.

## Step 2 — Auto-detect and collect project identity

If the stack detector is present in the project, run it:

```bash
node scripts/detect-stack.mjs "$PWD"
```

**Environment flags:** `CC_GLOB_DEPTH` and any other `CC_*` env vars the user may have set are automatically inherited by the child `node` process — no explicit export or forwarding is required. The `/cc-init` command must NOT reset or unset these variables before calling detect-stack.

Capture the JSON output. For each field in the JSON (name, description, stack, build, test, lint, format, setup), check the corresponding line in CLAUDE.md:
- If the CLAUDE.md line contains `<command>` or is blank after `Key:` → replace with the detected value using a single `Edit` call.
- If the CLAUDE.md line already has a non-placeholder value → skip (never overwrite).

Apply all replacements in a **single `Edit` call** after collecting all detected values.

If the detector is absent or returns `{}`, skip auto-detection and continue below.

### Step 2b — Resolve what detection could not

Ask about the fields detection could not fill, and never about the ones it did. The script decides which is which; this prose only asks.

```bash
node scripts/init-wizard.mjs report
```

stdout is JSON and nothing else:

```json
{
  "unresolved": [{ "field": "build", "raw": "- Build: <command>", "reason": "placeholder" }],
  "resolved": ["name", "description", "stack", "test"],
  "absent": [{ "field": "setup", "expected": "- Setup:" }]
}
```

`reason` is only ever `empty` or `placeholder`. stderr carries an advisory summary — never parse it. A non-zero exit means `CLAUDE.md` is missing or unreadable: stop and report it, do not continue.

**Non-interactive callers** (CI, scripted installs — anywhere no one can answer): print one line naming the `unresolved` field names, then continue to Step 3. Make no `apply` call. The placeholders survive, which is the truth — nobody was asked.

**Interactive:** if `unresolved` is empty, ask nothing. Otherwise ask about all of its fields in one batch, quoting each entry's `raw` line so the developer sees what is in the file. Ask one further question only if context suggests the default is wrong:

- Response language preference? (default: `en`)

`Language` is not one of the script's fields — write it with a plain `Edit`, like any other prose field.

For each answer to `build`, `test`, `lint` or `format` other than `N/A`, run `check` first and pass any warning through verbatim. It is advisory; the value is written either way:

```bash
node scripts/init-wizard.mjs check build --value-stdin <<'CC_VALUE'
npm run build
CC_VALUE
```

Then write the answer, one call per field:

```bash
node scripts/init-wizard.mjs apply build --value-stdin <<'CC_VALUE'
npm run build
CC_VALUE
```

The value travels on **stdin** inside a heredoc whose delimiter is quoted (`<<'CC_VALUE'`), which disables every form of shell expansion — backticks, `$(...)` and quotes in an answer are inert. Never pass a value as an argv word; `apply` refuses it.

A skipped question applies the literal `N/A`. Never leave a `<command>` placeholder behind.

Finally, for every entry in `absent`, tell the developer that the line is gone from `CLAUDE.md` and quote its `expected` text as the line to restore by hand. `apply` refuses an absent field; it never inserts one.

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
