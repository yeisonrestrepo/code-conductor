---
description: "(Conductor) Define the problem and generate an approved spec"
---

## Phase entry - Resume Read

Before doing anything else, restore any stored context for the current commit by running `scripts/resume-read.mjs`. It resolves the current git hash, prefers a valid DB snapshot (`conductor-db get-snapshot`), falls back to the `.claude/memory/session-snapshot.json` handoff file, and prints a `RESUME_HIT` block on a hit / nothing on a miss. Capture its stdout **and** its exit code with the canonical per-platform form (each first probes for `node` and treats its absence as a clean miss, never an error):

- **Unix / Git Bash:**
  ```sh
  if command -v node >/dev/null 2>&1; then
    resume_out="$(node scripts/resume-read.mjs 2>>.conductor/last-write.log)"; resume_rc=$?
  else resume_rc=3; resume_out=""; fi
  ```
- **PowerShell:**
  ```powershell
  if (Get-Command node -ErrorAction SilentlyContinue) {
    $__eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
      $__nap = $PSNativeCommandUseErrorActionPreference; $PSNativeCommandUseErrorActionPreference = $false
    }
    try {
      $resume_out = node scripts/resume-read.mjs 2>> .conductor/last-write.log; $resume_rc = $LASTEXITCODE
    } catch { $resume_rc = 3; $resume_out = "" }
    finally {
      $ErrorActionPreference = $__eap
      if (Test-Path variable:__nap) { $PSNativeCommandUseErrorActionPreference = $__nap }
    }
  } else { $resume_rc = 3; $resume_out = "" }
  ```

Branch on `resume_rc` - **only `0` and `4` are meaningful; every other code proceeds fresh:**

- **`0`** → parse the captured block and adopt it as this phase's starting context, then echo one banner to the user: `> Resumed from stored snapshot @ <commit> (phase: <phase>)`, appending ` (checkpoint prose available)` when the block reports `prose: available`. Parsing (the command owns normalization): split on `\n`; strip a trailing `\r` from every line; drop leading/trailing wholly-blank lines; require `lines[0].trim() === 'RESUME_HIT'` (anything else = miss); `key: value` lines split on the first `': '` (both sides trimmed); the `pending:` block is every subsequent `^\s*-\s+` line up to the first blank line or EOF, each item trimmed. Unknown keys are ignored. In PowerShell, `node …` binds `string[]` for multi-line output - normalize with `$lines = @($resume_out)`; a `$null`/empty capture with `resume_rc = 3` is a miss.
- **`4`** → **operational halt.** Do not run this phase's normal work. Emit exactly: `SNAP_INVALID: corrupt handoff at .claude/memory/session-snapshot.json - inspect or remove it, then re-run.` and enter standby awaiting user action. The corrupt file is left on disk (the script did not delete it).
- **`3` or any other code** → **proceed fresh** (clean miss, bypass, degrade, absent `node`, or any unexpected runtime code). Ignore the capture.

`resume-read.mjs` writes its own trace lines to `.conductor/last-write.log` via `appendFileSync`; the `2>>` redirect above only sinks the incidental exit-4 halt reason away from the UI - it is not the trace channel.

---

## Phase 0 — Skill activation

Before doing anything else, invoke both skills in order:

```
Skill({ skill: "brainstorming", args: "$ARGUMENTS" })
Skill({ skill: "critical-review" })
```

`brainstorming` explores the problem space and surfaces unknowns. `critical-review` Phase 1 then runs the Pre-Flight Analysis (Happy Path / Failure Points / Boundary Conditions) on the proposed solution before the spec is written. Do not write the spec until both have completed.

---

## Spec Read Budget

Before reading any file:
1. Run Grep or Glob to locate relevant files. Skip this step only if the user's prompt names the exact file path.
2. Apply the correct read rule based on file type:

**Capped source files** - read the first 30 lines only (`offset` omitted, `limit: 30`). Starting at any offset other than the beginning is forbidden; if the first 30 lines are insufficient, defer the file. Multiple reads of the same file at any offset are forbidden.
Extensions: `.ts` `.tsx` `.js` `.jsx` `.mjs` `.cjs` `.py` `.go` `.rs` `.java` `.rb` `.cs` `.cpp` `.c` `.h` `.swift` `.kt` `.php` `.sh` `.html` `.css` `.scss` `.sass` `.less` `.svelte` `.vue`

**Exempt files** - may be read in full:
Named manifests/config: `package.json` `package-lock.json` `yarn.lock` `pnpm-lock.yaml` `bun.lockb` `go.mod` `go.sum` `Cargo.toml` `Cargo.lock` `pyproject.toml` `requirements.txt` `Pipfile` `Gemfile` `Gemfile.lock` `tsconfig.json` `tsconfig.*.json` `.gitignore` `.eslintrc.*` `.prettierrc.*` `.env.example` `.nvmrc` `.node-version` `.python-version` `.tool-versions`
Patterns: `*.yaml` `*.yml` `*.toml` `*.json` (config/manifest root files only - do not apply to data or generated JSON) `*.md` `CLAUDE.md` `Makefile` `Dockerfile` `Dockerfile.*` `*.dockerfile` `Jenkinsfile` `Procfile` `Brewfile`
Note: `.env`, `.env.local`, `.env.*` (real values) are **not exempt** - the agent should not read them during spec phase.

**Extensionless files** - exempt only when the exact name appears in the Named manifests/config list or Patterns above. All other extensionless files (including unknown dotfiles) default to capped.

**Default** - any file not matched by the above rules defaults to capped.

**Deferred reads** - if a capped source file cannot be understood from 30 lines, record it in `### Files Requiring Full Read (deferred to /cc-plan)` and move on. Do not slice-read it.

---

Search the codebase for existing code related to `$ARGUMENTS` before asking any questions.

Run: `grep -r "$ARGUMENTS" src/ --include="*.{ts,js,py,java,go,rs}" -l 2>/dev/null | head -20`

Then ask only for missing context. You need to understand:
1. **Problem** — what is broken or missing?
2. **User** — who is affected and what do they expect?
3. **Constraints** — performance, security, backward compatibility?
4. **Similar features** — anything in the codebase to stay consistent with?

Generate a spec with these sections:

## Problem
[What is broken or missing, from the user's perspective]

## Solution
[What will be built, one paragraph]

## Behavior

### Main path
[Step-by-step: what happens in the happy path]

### Alternative paths
[Edge cases the user might hit]

### Error cases
[What happens when things go wrong]

## Acceptance Criteria
- [ ] [Testable criterion]
- [ ] [Testable criterion]

## Out of Scope
[Explicitly list what this spec does NOT cover]

## System Impact
[What existing code will be affected or needs to be reviewed]

### Files Requiring Full Read (deferred to /cc-plan)

_None. List any source files that could not be understood within the 30-line cap. /cc-plan will perform full reads of these files before task breakdown._

## Complexity Estimate
[S / M / L — with one sentence justification]

---

Wait for explicit approval before proceeding to `/cc-plan`.

Once approved, append a summary to `.claude/memory/project.md` under:
`## Spec: [name] [YYYY-MM-DD]`

---

## Phase exit

Once the spec is approved and the summary has been appended to `.claude/memory/project.md`, instruct the user:

> "Spec complete. Run `/cc-compact` now before starting `/cc-plan`."

Do not proceed to plan phase without user confirmation that `/cc-compact` has been run.
