# BUG-014: Verbosity Dilution — Spec

## Problem

The agent ignores configured verbosity constraints (MIN / INFO / VERBOSE) over extended development sessions. The `skills/verbosity.md` instruction is loaded once at session start; as the context window fills, the constraint fades and the agent reverts to verbose, prose-heavy responses. There is no mechanism that re-injects the active verbosity level at each prompt boundary. The result is wasted output tokens and broken developer expectations about response length.

## Solution

Add a `UserPromptSubmit` hook — deployed at two scopes (global and project-level) with a strict cascading fallback — that fires before every Claude response and emits a compact, level-aware verbosity reminder. The global hook serves as the universal machine-level guardrail; the project hook serves as the team-distributed authority when present. A three-stage pipeline inside each hook (upward project-hook detection → cascading memory resolution → sanity guard) ensures exactly one reminder fires per prompt and the active level is always resolved correctly, even from subdirectories or with missing/corrupted state files.

## Behavior

### `verbosity.md` file format and parsing

`~/.claude/memory/verbosity.md` may contain YAML frontmatter (lines between `---` delimiters) followed by a bare text body. The canonical `VERBOSITY:` line is always in the body, not the frontmatter. Its format is:

```
VERBOSITY: MIN
```

Rules:
- Raw text only — no Markdown bold, no backticks, no extra punctuation around the value.
- Exactly one space after the colon. Trailing whitespace and `\r` (CRLF from Windows editors) must be stripped before validation.
- `grep -m1 '^VERBOSITY:'` reliably finds the line in both frontmatter-present and frontmatter-absent files because frontmatter keys use lowercase (`name:`, `type:`, etc.).
- After extraction, the value is uppercased (`${LEVEL^^}`, bash 4+) before the sanity guard so that lowercase variants such as `min` or `Min` are accepted rather than silently downgraded.

Extraction sequence (pure bash, no subshells except the grep read):

```
raw_line = first line matching ^VERBOSITY: in the file
LEVEL    = ${raw_line#VERBOSITY:}         # strip key prefix
LEVEL    = ${LEVEL#"${LEVEL%%[! ]*}"}    # strip leading spaces (pure bash)
LEVEL    = ${LEVEL%$'\r'}                # strip trailing CR
LEVEL    = ${LEVEL%% *}                  # strip trailing spaces
LEVEL    = ${LEVEL^^}                    # uppercase (bash 4+)
```

### Hook execution model

Claude Code fires `UserPromptSubmit` hooks **sequentially**, not concurrently. Each hook's stdout is captured independently and injected into the conversation context as a separate block. There is no risk of output interleaving between the global and project hooks. The global hook's deferral decision is based on filesystem state (Stage 1 traversal), not on execution order — so the guarantee of exactly one injected reminder holds regardless of which hook runs first.

### Main path

1. User submits a prompt. Claude Code fires all `UserPromptSubmit` hooks sequentially.
2. **Global hook fires.**
   - Stage 1 — upward traversal from `$PWD` (logical path; see Symlink note below) using pure bash `${dir%/*}` with change-detection termination. If `.claude/hooks/verbosity-remind.sh` is found anywhere in the ancestor chain, the global hook exits 0 with no output (defers to project hook).
   - Stage 2 — upward traversal from `$PWD` for `.claude/memory/verbosity.md`. First file found wins. If none found, falls back to `~/.claude/memory/verbosity.md`.
   - Stage 3 — parse and normalize (extraction sequence above), then sanity guard: if `LEVEL` is not one of `MIN`, `INFO`, `VERBOSE`, set `LEVEL=MIN`.
   - Emits one reminder line to stdout.
3. **Project hook fires** (only in projects with the template installed).
   - Runs Stages 2–3 only (no hook-detection stage; it is the authority).
   - Emits one reminder line.
4. Claude receives exactly one injected reminder. The reminder format is level-aware:
   - `MIN`: `[VERBOSITY:MIN] One sentence. [CHANGES] file list only. No prose.`
   - `INFO`: `[VERBOSITY:INFO] Bullet list max 5. [CHANGES]+[REASON] tags.`
   - `VERBOSE`: `[VERBOSITY:VERBOSE] Full explanation. All tags active.`
5. Claude applies the constraint to the response for that turn.

### Upward traversal — loop invariant

```
dir="$PWD"; prev=""
while [ "$dir" != "$prev" ]; do
    # test at $dir
    prev="$dir"
    dir="${dir%/*}"
    [ -z "$dir" ] && dir="/"
done
```

Termination condition is `dir == prev` (path stopped changing), not `dir == /`. This handles Unix roots (`/`), Git Bash drive roots (`/c`, `/d`), and any edge case where `${dir%/*}` yields an empty string.

### Symlink note

The traversal uses `$PWD`, which bash sets to the logical (shell-assigned) path. A project accessed via a symlink (`/home/user/proj` → `/data/realproj`) will have `$PWD=/home/user/proj`; the `-f` test resolves the symlink transparently at the OS level. Do not replace `$PWD` with `$(pwd -P)` (physical path) — doing so would break setups where `.claude/` is only addressable via the symlink path.

### Alternative paths

- **Invoked from a project subdirectory** — upward traversal finds `.claude/hooks/verbosity-remind.sh` and `.claude/memory/verbosity.md` at the project root; behavior is identical to being at the root.
- **Project has a local `.claude/memory/verbosity.md` that overrides global** — Stage 2 finds the project file first; global `~/.claude/memory/verbosity.md` is never read. This enables per-project verbosity overrides without touching the global setting.
- **No project template installed (bare session)** — global hook finds no project hook via traversal; it reads `~/.claude/memory/verbosity.md` directly and emits the reminder. Project hook never fires.
- **User changes verbosity mid-session** — direct edit of `~/.claude/memory/verbosity.md` (or the project-local override). No command wrapper modifies this file mid-session: `/cc-lang` changes response language only and does not touch `verbosity.md`. The hook re-reads the file on the next prompt; the updated level takes effect immediately with no session restart.

### Error cases

- **`verbosity.md` is missing at all levels** — `grep` returns empty; sanity guard sets `LEVEL=MIN`. Hook exits 0, emits `[VERBOSITY:MIN]` reminder. The sanity guard is a corruption defense — under normal operation, `install.sh` and `install.ps1` always provision `~/.claude/memory/verbosity.md` at install time (line: `echo "VERBOSITY: ${VERBOSITY}" > "${GLOBAL_DIR}/memory/verbosity.md"`).
- **`verbosity.md` is present but contains an unrecognized value** (e.g., `VERBOSITY: LOUD`) — uppercase normalization is applied first; if still not in `{MIN, INFO, VERBOSE}`, sanity guard sets `MIN`. Hook exits 0.
- **`verbosity.md` is empty or has no `VERBOSITY:` line** — `grep -m1` returns empty string; extraction yields empty `LEVEL`; sanity guard sets `MIN`. Hook exits 0.
- **`verbosity.md` has Windows CRLF line endings** — `\r` is stripped during extraction before the sanity guard runs; `VERBOSE\r` normalizes to `VERBOSE`. Hook exits 0.
- **Hook script is missing or not executable** — Claude Code logs a hook error; session continues unaffected. The verbosity skill instruction in `CLAUDE.md` and `skills/verbosity.md` serves as a soft fallback.
- **Git Bash drive-root edge case** (`/c`, `/d`) — change-detection loop terminates when `${dir%/*}` stops producing a new value; no infinite loop.

## Acceptance Criteria

- [ ] `global/hooks/verbosity-remind.sh` exists and is executable; emits exactly one reminder line per invocation when no project hook is found via upward traversal.
- [ ] `project-template/.claude/hooks/verbosity-remind.sh` exists and is executable; emits exactly one reminder line per invocation.
- [ ] When both hooks are registered, exactly one reminder appears per prompt (global defers via upward traversal).
- [ ] Upward traversal uses only pure bash `${dir%/*}` — no `dirname`, no `$(...)` subshells inside the loop.
- [ ] Loop termination uses change-detection (`dir != prev`), not `dir != /`.
- [ ] Extraction strips leading spaces, trailing spaces, and `\r` from the raw value using pure bash parameter expansion.
- [ ] Extracted level is uppercased via `${LEVEL^^}` before the sanity guard; lowercase inputs (`min`, `info`, `verbose`) are accepted.
- [ ] Sanity guard falls back to `MIN` for any value outside `{MIN, INFO, VERBOSE}` after normalization.
- [ ] Project-local `.claude/memory/verbosity.md` overrides `~/.claude/memory/verbosity.md` when present in the ancestor chain.
- [ ] Reminder text is level-aware: three distinct messages for MIN / INFO / VERBOSE.
- [ ] `global/settings.json` registers the global hook under `UserPromptSubmit`; existing graphify entry is preserved.
- [ ] `project-template/.claude/settings.json` registers the project hook under `UserPromptSubmit`; existing `PreToolUse` and `PostCompact` entries are preserved.
- [ ] `skills/verbosity.md` Application section updated to describe hook-driven enforcement (replaces "read once at session start").
- [ ] `install.sh` and `install.ps1` verified to copy `global/hooks/verbosity-remind.sh` to `~/.claude/hooks/`.

## Out of Scope

- Changing the verbosity level — re-run the installer with `--verbosity` or directly edit `~/.claude/memory/verbosity.md`; no command wrapper is in scope.
- Enforcing verbosity inside subagent responses — subagents inherit the system prompt but not hook output.
- Detecting verbosity drift in past responses and auto-correcting — enforcement is prospective only (next prompt).
- Adding a project-level `verbosity.md` template file to the project template — teams override by creating `.claude/memory/verbosity.md` manually.
- Windows native PowerShell hook execution — hooks run under bash (Git Bash on Windows); no PowerShell port needed.
- Symlinked `.claude/` directories (`.claude/` is itself a symlink pointing elsewhere) — only the standard layout where `.claude/` is a real directory at the project root is supported.

## System Impact

- `global/hooks/verbosity-remind.sh` — new file; must be added to `install.sh` copy list.
- `global/settings.json` — second entry added to existing `UserPromptSubmit` array; existing graphify hook entry preserved exactly.
- `project-template/.claude/hooks/verbosity-remind.sh` — new file; copied by `install.sh` / `install.ps1` on `--project` installs.
- `project-template/.claude/settings.json` — new `UserPromptSubmit` block added; existing `PreToolUse` and `PostCompact` blocks preserved.
- `skills/verbosity.md` — Application section updated; level definitions unchanged.
- `install.sh` / `install.ps1` — verify `global/hooks/verbosity-remind.sh` copy path; no structural change expected.

## Complexity Estimate

S — two short bash scripts (~35 lines each), two JSON edits, one skill section update, installer verification.
