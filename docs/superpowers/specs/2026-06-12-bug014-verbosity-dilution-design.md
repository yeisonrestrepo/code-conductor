# BUG-014: Verbosity Dilution — Spec

## Problem

The agent ignores configured verbosity constraints (MIN / INFO / VERBOSE) over extended development sessions. The `skills/verbosity.md` instruction is loaded once at session start; as the context window fills, the constraint fades and the agent reverts to verbose, prose-heavy responses. There is no mechanism that re-injects the active verbosity level at each prompt boundary. The result is wasted output tokens and broken developer expectations about response length.

## Solution

Add a `UserPromptSubmit` hook — deployed at two scopes (global and project-level) with a strict cascading fallback — that fires before every Claude response and emits a compact, level-aware verbosity reminder. The global hook serves as the universal machine-level guardrail; the project hook serves as the team-distributed authority when present. A three-stage pipeline inside each hook (upward project-hook detection → cascading memory resolution → sanity guard) ensures exactly one reminder fires per prompt and the active level is always resolved correctly, even from subdirectories or with missing/corrupted state files.

## Behavior

### Main path

1. User submits a prompt. Claude Code fires all `UserPromptSubmit` hooks.
2. **Global hook fires first.**
   - Stage 1 — upward traversal from CWD to filesystem root using pure bash `${dir%/*}` with change-detection loop termination. If `.claude/hooks/verbosity-remind.sh` is found anywhere in the ancestor chain, the global hook exits 0 with no output (defers to project hook).
   - Stage 2 — upward traversal from CWD for `.claude/memory/verbosity.md`. First file found wins. If none found, falls back to `~/.claude/memory/verbosity.md`.
   - Stage 3 — sanity guard: if the extracted level is not one of `MIN`, `INFO`, `VERBOSE`, set `LEVEL=MIN`.
   - Emits one reminder line to stdout.
3. **Project hook fires** (only in projects with the template installed).
   - Runs Stages 2–3 only (no hook-detection stage; it is the authority).
   - Emits one reminder line.
4. Claude receives exactly one injected reminder. The reminder format is level-aware:
   - `MIN`: `[VERBOSITY:MIN] One sentence. [CHANGES] file list only. No prose.`
   - `INFO`: `[VERBOSITY:INFO] Bullet list max 5. [CHANGES]+[REASON] tags.`
   - `VERBOSE`: `[VERBOSITY:VERBOSE] Full explanation. All tags active.`
5. Claude applies the constraint to the response for that turn.

### Alternative paths

- **Invoked from a project subdirectory** — upward traversal finds `.claude/hooks/verbosity-remind.sh` and `.claude/memory/verbosity.md` at the project root; behavior is identical to being at the root.
- **Project has a local `.claude/memory/verbosity.md` that overrides global** — Stage 2 finds the project file first; global `~/.claude/memory/verbosity.md` is never read. This allows per-project verbosity overrides without touching the global setting.
- **No project template installed (bare session)** — global hook finds no project hook via traversal; it reads `~/.claude/memory/verbosity.md` directly and emits the reminder. Project hook never fires because it is not registered in any `settings.json`.
- **User changes verbosity mid-session via `/cc-lang` or direct edit** — on the next prompt, the hook re-reads `verbosity.md`; the updated level takes effect immediately with no session restart required.

### Error cases

- **`verbosity.md` is missing** — sanity guard catches empty `LEVEL`; falls back to `MIN`. Hook exits 0 and emits `[VERBOSITY:MIN]` reminder.
- **`verbosity.md` is present but contains an unrecognized value** (e.g., `VERBOSITY: LOUD`) — sanity guard replaces with `MIN`. Hook exits 0.
- **`verbosity.md` is empty or has no `VERBOSITY:` line** — `grep -m1` returns empty string; sanity guard sets `MIN`. Hook exits 0.
- **Hook script is missing or not executable** — Claude Code logs a hook error; session continues unaffected. The verbosity skill instruction in `CLAUDE.md` and `skills/verbosity.md` still serves as a soft fallback.
- **Git Bash drive-root edge case** (`/c`, `/d`)  — change-detection loop condition (`dir != prev`) terminates correctly when `${dir%/*}` stops producing a new value; no infinite loop.

## Acceptance Criteria

- [ ] `global/hooks/verbosity-remind.sh` exists and is executable; emits exactly one reminder line per invocation when no project hook is found.
- [ ] `project-template/.claude/hooks/verbosity-remind.sh` exists and is executable; emits exactly one reminder line per invocation.
- [ ] When both hooks are registered, exactly one reminder appears per prompt (global defers via upward traversal).
- [ ] Upward traversal uses only pure bash `${dir%/*}` — no `dirname`, no `$(...)` subshells inside the loop.
- [ ] Loop termination uses change-detection (`dir != prev`), not `dir != /`.
- [ ] Project-local `.claude/memory/verbosity.md` overrides `~/.claude/memory/verbosity.md` when present.
- [ ] Missing, empty, or corrupted `verbosity.md` at all levels falls back to `MIN` without error exit.
- [ ] Reminder text is level-aware: three distinct messages for MIN / INFO / VERBOSE.
- [ ] `global/settings.json` registers the global hook under `UserPromptSubmit`.
- [ ] `project-template/.claude/settings.json` registers the project hook under `UserPromptSubmit`.
- [ ] `skills/verbosity.md` updated: "read once at session start" replaced with description of hook-driven enforcement.
- [ ] `install.sh` and `install.ps1` verified to copy `global/hooks/verbosity-remind.sh` to `~/.claude/hooks/`.

## Out of Scope

- Changing the verbosity level itself — that remains `/cc-lang` or direct edit of `verbosity.md`.
- Enforcing verbosity inside subagent responses — subagents inherit the system prompt but not hook output.
- Detecting verbosity drift in past responses and auto-correcting — enforcement is prospective only (next prompt).
- Adding a project-level `verbosity.md` template file to the project template — teams override by creating `.claude/memory/verbosity.md` manually.
- Windows native PowerShell hook execution — hooks run under bash (Git Bash on Windows); no PowerShell port needed.

## System Impact

- `global/hooks/verbosity-remind.sh` — new file; must be added to `install.sh` copy list.
- `global/settings.json` — second entry added to existing `UserPromptSubmit` array; existing graphify hook entry is preserved exactly.
- `project-template/.claude/hooks/verbosity-remind.sh` — new file; copied by `install.ps1` / `install.sh` on `--project` installs.
- `project-template/.claude/settings.json` — new `UserPromptSubmit` block added; existing `PreToolUse` and `PostCompact` blocks are preserved.
- `skills/verbosity.md` — one-line update to the Application section; no behavioral change to level definitions.
- `install.sh` / `install.ps1` — verify `global/hooks/` directory is copied to `~/.claude/hooks/`; no structural change expected.

## Complexity Estimate

S — two short bash scripts (~30 lines each), two JSON edits, one skill line update, installer verification.
