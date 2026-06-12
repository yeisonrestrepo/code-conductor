# BUG-014: Verbosity Dilution — Spec

## Problem

The agent ignores configured verbosity constraints (MIN / INFO / VERBOSE) over extended development sessions. The `skills/verbosity.md` instruction is loaded once at session start; as the context window fills, the constraint fades and the agent reverts to verbose, prose-heavy responses. There is no mechanism that re-injects the active verbosity level at each prompt boundary. The result is wasted output tokens and broken developer expectations about response length.

## Solution

Add a `UserPromptSubmit` hook — deployed at two scopes (global and project-level) with a strict cascading fallback — that fires before every Claude response and emits a compact, level-aware verbosity reminder. The global hook serves as the universal machine-level guardrail; the project hook serves as the team-distributed authority when present. A three-stage pipeline inside each hook (upward project-hook detection → cascading memory resolution → sanity guard) ensures exactly one reminder fires per prompt and the active level is always resolved correctly, even from subdirectories or with missing/corrupted state files.

Bracket tokens in the reminder output (e.g., `[VERBOSITY:MIN]`, `[CHANGES]`) are purely descriptive natural language instructions. They are not parsed by any regex engine in the system prompt. The agent interprets them as behavioral directives via training and the CLAUDE.md rules. No code-level token matching is triggered by their presence.

## Behavior

### `verbosity.md` file format and parsing

`~/.claude/memory/verbosity.md` may contain a YAML frontmatter block (lines between `---` delimiters at the file top) followed by a bare text body. The canonical `VERBOSITY:` line is always in the body. Its format is:

```
VERBOSITY: MIN
```

Parsing rules:
- Raw text only — no Markdown bold, no backticks, no extra punctuation around the value.
- Exactly one space after the colon. Trailing whitespace and `\r` (CRLF from Windows editors) are stripped before validation.
- `grep -m1 '^VERBOSITY:'` is frontmatter-safe because frontmatter keys are lowercase (`name:`, `type:`, etc.) and never start with `VERBOSITY:`.
- **Code block false-positive prevention**: A `VERBOSITY:` line inside a Markdown code fence (` ``` `) must not be matched. The extraction loop tracks a `_in_fence` flag (toggled by lines starting with ` ``` `). Any `^VERBOSITY:` match while `_in_fence=1` is discarded. This is implemented as a bash `while IFS= read -r` loop over the file — no external awk or sed call.
- After extraction, the value is uppercased and whitespace-stripped using pure bash parameter expansion before the sanity guard.

Extraction sequence (pure bash, single subshell only for the file read):

```bash
_in_fence=0; LEVEL=""
while IFS= read -r _line; do
    case "$_line" in
        '```'*) (( _in_fence = 1 - _in_fence )) ;;
        VERBOSITY:*)
            (( _in_fence )) && continue
            LEVEL="${_line#VERBOSITY:}"      # strip key prefix
            LEVEL="${LEVEL#"${LEVEL%%[! ]*}"}"  # strip leading spaces
            LEVEL="${LEVEL%$'\r'}"           # strip trailing CR
            LEVEL="${LEVEL%% *}"             # strip trailing spaces
            LEVEL="${LEVEL^^}"               # uppercase (bash 4+)
            break
            ;;
    esac
done < "$_mem_file"
```

### Hook execution model

Claude Code fires `UserPromptSubmit` hooks **sequentially**, not concurrently. Each hook's stdout is captured independently and injected into the conversation context as a separate block before Claude generates its response. Stderr is not injected. Hook output appears permanently in the session transcript (`.jsonl` history files) — this is expected and acceptable: the reminder is a short, transparent signal (~20 tokens) that documents the active verbosity level for audit purposes. There is no mechanism to suppress it from the transcript.

The global hook's deferral decision is based on filesystem state (Stage 1 traversal), not on execution order. The guarantee of exactly one injected reminder holds regardless of which hook runs first.

### `$PWD` null guard

At hook entry, before any traversal begins:

```bash
_start="${PWD:-}"
if [ -z "$_start" ]; then
    # $PWD is unset or empty — skip traversal entirely
    # Fall through directly to global ~/.claude/memory/verbosity.md
    _start=""
fi
```

If `$PWD` is null or missing, both traversal stages are skipped. Stage 2 falls back directly to `~/.claude/memory/verbosity.md`. The sanity guard handles any subsequent bad state. The hook always exits 0.

### Upward traversal algorithm

Applies to Stage 1 (hook detection, global hook only) and Stage 2 (memory file resolution, both hooks). The same loop structure is reused for both.

```bash
_dir="$_start"; _prev=""; _iters=0; _cap=40
while [ "$_dir" != "$_prev" ] && (( _iters < _cap )); do
    # test condition at $_dir
    _prev="$_dir"
    _dir="${_dir%/*}"
    [ -z "$_dir" ] && _dir="/"
    (( _iters++ ))
done
```

Loop invariants:
- **Termination condition**: `dir == prev` (path stopped changing). Not `dir == /`.
- **Iteration cap**: 40 iterations maximum. Handles virtual filesystems, bind mounts, or degenerate path structures where `${dir%/*}` does not converge. If the cap is reached without finding the target, the loop exits and the stage falls through to its next fallback.
- **No subshells inside the loop**: `${dir%/*}` is a pure parameter expansion. No `dirname`, no `$(...)`, no fork per iteration.
- **Git Bash drive roots** (`/c`, `/d`): `${"/c"%/*}` yields `""`, which is set to `/`. Next iteration: `"/" == "/"` → exits. No infinite loop.

**Symlink note**: The traversal uses `$PWD` (logical shell-assigned path). Bash resolves symlinks transparently at the `-f` test level. Do not substitute `$(pwd -P)` (physical path) — doing so breaks setups where `.claude/` is accessible exclusively via a symlink path.

### Main path

1. User submits a prompt. Claude Code fires all `UserPromptSubmit` hooks sequentially.
2. **Global hook fires.**
   - Entry guard: if `$PWD` is null, skip traversal; go to Stage 2 global fallback.
   - Stage 1 — upward traversal (cap 40) for `.claude/hooks/verbosity-remind.sh`. If found, exit 0 with no output (defer to project hook).
   - Stage 2 — upward traversal (cap 40) for `.claude/memory/verbosity.md`. First file found wins. If cap reached or `$PWD` was null, read `~/.claude/memory/verbosity.md`.
   - Stage 3 — parse with code-fence tracking, normalize, sanity guard. If `LEVEL` not in `{MIN, INFO, VERBOSE}`, set `LEVEL=MIN`.
   - Emit one reminder line with leading newline to stdout.
3. **Project hook fires** (only in projects with the template installed).
   - Entry guard: same `$PWD` null check.
   - Runs Stages 2–3 only (no hook-detection stage; it is the authority).
   - Emit one reminder line with leading newline to stdout.
4. Claude receives exactly one injected reminder. Format is level-aware, always preceded by `\n`:

   ```
   \n[VERBOSITY:MIN] One sentence. [CHANGES] file list only. No prose.
   \n[VERBOSITY:INFO] Bullet list max 5. [CHANGES]+[REASON] tags.
   \n[VERBOSITY:VERBOSE] Full explanation. All tags active.
   ```

   The leading `\n` prevents the reminder from being concatenated with the last character of the user's terminal input line.
5. Claude applies the constraint to the response for that turn.

### Empty or binary-only prompt behavior

The hook fires on the `UserPromptSubmit` event regardless of prompt content. It does not inspect or read the prompt string. When the user submits an empty string or a prompt consisting exclusively of binary attachments (images, files):

- The hook runs its full three-stage pipeline identically.
- It emits the verbosity reminder normally.
- Claude receives the reminder as injected context alongside the empty/binary input.
- Claude's response to the empty/binary input is governed by the injected verbosity level.

No special handling or suppression is required for these inputs.

### Alternative paths

- **Invoked from a project subdirectory** — upward traversal (capped at 40) finds `.claude/hooks/verbosity-remind.sh` and `.claude/memory/verbosity.md` at the project root; behavior is identical to being at the root.
- **Project has a local `.claude/memory/verbosity.md` that overrides global** — Stage 2 finds the project file first; `~/.claude/memory/verbosity.md` is never read. This enables per-project verbosity overrides.
- **No project template installed (bare session)** — global hook finds no project hook via traversal; it reads `~/.claude/memory/verbosity.md` directly and emits the reminder. Project hook never fires.
- **User changes verbosity mid-session** — direct edit of `~/.claude/memory/verbosity.md` (or the project-local override). No command modifies this file mid-session: `/cc-lang` changes response language only and does not touch `verbosity.md`. The hook re-reads the file on the next prompt; the updated level takes effect immediately.

### Error cases

- **`$PWD` is null or unset** — traversal skipped; hook reads `~/.claude/memory/verbosity.md` directly. Sanity guard handles bad state. Hook exits 0.
- **`verbosity.md` is missing at all levels** — `grep` returns empty; sanity guard sets `LEVEL=MIN`. Hook exits 0, emits `\n[VERBOSITY:MIN]` reminder. Under normal operation, `install.sh` and `install.ps1` always provision `~/.claude/memory/verbosity.md` at install time (`echo "VERBOSITY: ${VERBOSITY}" > "${GLOBAL_DIR}/memory/verbosity.md"`). The sanity guard is a corruption defense, not a substitute for installation.
- **`verbosity.md` contains an unrecognized value** (e.g., `VERBOSITY: LOUD`) — uppercase normalization applied first; if still not in `{MIN, INFO, VERBOSE}`, sanity guard sets `MIN`. Hook exits 0.
- **`verbosity.md` is empty or has no `VERBOSITY:` line** — extraction yields empty `LEVEL`; sanity guard sets `MIN`. Hook exits 0.
- **`verbosity.md` has Windows CRLF line endings** — `\r` stripped during extraction before sanity guard runs; `VERBOSE\r` normalizes to `VERBOSE`. Hook exits 0.
- **`VERBOSITY:` line is inside a Markdown code fence** — `_in_fence` flag causes the match to be discarded; traversal continues reading the file for a body-level match. If none found, falls back to next memory source.
- **Traversal cap reached (40 iterations) with no file found** — loop exits; hook falls back to `~/.claude/memory/verbosity.md`. Sanity guard handles downstream state. No error is emitted to stderr.
- **Hook script missing or not executable** — Claude Code logs a hook error; session continues. `CLAUDE.md` and `skills/verbosity.md` serve as soft fallbacks.
- **Git Bash drive-root edge case** — change-detection loop terminates correctly; no infinite loop.

### Windows installer and execution permissions

`install.ps1` copies hook scripts using `Save-RemoteFile` (raw content write via `Set-Content`). It does not call `icacls`, `chmod`, or any permission-setting utility, and none is needed. All hooks in `settings.json` are invoked via explicit `bash path/to/script.sh` — not as direct executables (`./hook.sh`). The bash interpreter is responsible for execution; Unix execute bits are not consulted on Windows Git Bash in this invocation mode. The new `verbosity-remind.sh` hooks must follow the same registration pattern:

- Global: `"command": "bash ~/.claude/hooks/verbosity-remind.sh"`
- Project: `"command": "bash -c 'h=\".claude/hooks/verbosity-remind.sh\"; [ -f \"$h\" ] && bash \"$h\" || exit 0'"`

## Acceptance Criteria

### Functional

- [ ] `global/hooks/verbosity-remind.sh` exists; emits exactly one reminder line per invocation when no project hook is found via upward traversal.
- [ ] `project-template/.claude/hooks/verbosity-remind.sh` exists; emits exactly one reminder line per invocation.
- [ ] When both hooks are registered, exactly one reminder appears per prompt (global defers via upward traversal).
- [ ] Upward traversal uses only pure bash `${dir%/*}` — no `dirname`, no `$(...)` subshells inside the loop.
- [ ] Loop termination uses change-detection (`dir != prev`), not `dir != /`.
- [ ] Loop iteration cap of 40 is enforced; traversal exits gracefully when cap is reached.
- [ ] Reminder output begins with a leading `\n` character to prevent text concatenation with terminal input.
- [ ] Extraction strips leading spaces, trailing spaces, and `\r` using pure bash parameter expansion.
- [ ] Extracted level is uppercased via `${LEVEL^^}` before sanity guard; `min`, `Min`, `MIN` all resolve to `MIN`.
- [ ] Sanity guard falls back to `MIN` for any value outside `{MIN, INFO, VERBOSE}` after normalization.
- [ ] Code-fence tracking prevents a `VERBOSITY:` line inside a Markdown code block from being matched.
- [ ] `$PWD` null guard skips traversal and falls back to global `~/.claude/memory/verbosity.md`.
- [ ] Project-local `.claude/memory/verbosity.md` overrides `~/.claude/memory/verbosity.md` when found in ancestor chain.
- [ ] Reminder text is level-aware: three distinct messages for MIN / INFO / VERBOSE.
- [ ] `global/settings.json` registers global hook under `UserPromptSubmit` using `bash ~/.claude/hooks/verbosity-remind.sh`; existing graphify entry preserved.
- [ ] `project-template/.claude/settings.json` registers project hook under `UserPromptSubmit` using the `bash -c '...'` guard pattern; existing `PreToolUse` and `PostCompact` entries preserved.
- [ ] `skills/verbosity.md` Application section updated to describe hook-driven enforcement.
- [ ] `install.sh` and `install.ps1` verified to copy `global/hooks/verbosity-remind.sh` to `~/.claude/hooks/`.

### Cascading verification matrix

Manual or scripted test scenarios that must pass before production release. Each row defines the filesystem layout and the expected output.

| # | `$PWD` | Global hook present | Project hook at ancestor | Project `verbosity.md` | Global `verbosity.md` | Expected emitter | Expected level |
|---|--------|--------------------|--------------------------|-----------------------|----------------------|-----------------|----------------|
| 1 | `/home/user` | yes | no | no | `MIN` | global | MIN |
| 2 | `/home/user/proj` | yes | yes (at `/home/user/proj`) | no | `MIN` | project | MIN |
| 3 | `/home/user/proj/src` | yes | yes (at `/home/user/proj`) | no | `MIN` | project (found via traversal) | MIN |
| 4 | `/home/user/proj` | yes | yes | `INFO` (project-local) | `MIN` (global) | project | INFO |
| 5 | `/home/user/proj` | yes | yes | `verbose` (lowercase) | `MIN` | project | VERBOSE (normalized) |
| 6 | `/home/user/proj` | yes | no | no | absent | global | MIN (sanity guard) |
| 7 | `/home/user/proj` | yes | no | no | `LOUD` | global | MIN (sanity guard) |
| 8 | empty string | yes | n/a | no | `INFO` | global (traversal skipped) | INFO |
| 9 | `/c/Users/proj` | yes | no | no | `VERBOSE` | global (Git Bash root termination) | VERBOSE |
| 10 | `/home/user/proj` | yes | no | file has `VERBOSITY:` inside ` ``` ` fence | `MIN` | global | MIN (fence guard active) |

## Out of Scope

- Changing the verbosity level — re-run the installer with `--verbosity` or directly edit `~/.claude/memory/verbosity.md`; no command wrapper is in scope.
- Enforcing verbosity inside subagent responses — subagents inherit the system prompt but not hook output.
- Detecting verbosity drift in past responses and auto-correcting — enforcement is prospective only (next prompt).
- Adding a project-level `verbosity.md` template to the project template — teams override by creating `.claude/memory/verbosity.md` manually.
- Windows native PowerShell hook execution — hooks run under bash (Git Bash on Windows); no PowerShell port needed.
- Suppressing hook output from `.jsonl` session transcripts — hook output is visible in history by design.
- Symlinked `.claude/` directories (`.claude/` is itself a symlink pointing elsewhere) — only standard layout where `.claude/` is a real directory at the project root is supported.

## System Impact

- `global/hooks/verbosity-remind.sh` — new file; must be added to `install.sh` and `install.ps1` copy lists.
- `global/settings.json` — second entry added to existing `UserPromptSubmit` array; graphify entry preserved.
- `project-template/.claude/hooks/verbosity-remind.sh` — new file; copied on `--project` installs.
- `project-template/.claude/settings.json` — new `UserPromptSubmit` entry added; `PreToolUse` and `PostCompact` entries preserved.
- `skills/verbosity.md` — Application section updated; level definitions unchanged.
- `install.sh` / `install.ps1` — add `global/hooks/verbosity-remind.sh` to the copy list for global hook installation; no structural change to the installer logic.

## Complexity Estimate

S — two bash scripts (~40 lines each), two JSON edits, one skill section update, installer line addition.
