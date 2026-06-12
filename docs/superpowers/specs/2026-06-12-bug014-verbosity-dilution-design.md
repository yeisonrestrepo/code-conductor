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
- One or more spaces after the colon are accepted; the extraction script strips all leading spaces from the extracted value. The "exactly one space" phrasing in the canonical format above is the recommended authoring style, not a parsing requirement.
- `grep -m1 '^VERBOSITY:'` is frontmatter-safe because frontmatter keys are lowercase (`name:`, `type:`, etc.) and never start with `VERBOSITY:`.
- **UTF-8 BOM handling**: Windows editors (Notepad, VS Code with certain settings) may prepend a UTF-8 Byte Order Mark (`\xEF\xBB\xBF`) to the file. If the `VERBOSITY:` line is the very first line with no frontmatter, the BOM appears before the `V` and causes the `VERBOSITY:*` case pattern to fail. The extraction loop strips the BOM from the first line read before any pattern matching.
- **Final line without trailing newline**: `while IFS= read -r _line` exits when `read` returns non-zero — which happens both at EOF after a newline and at EOF without a newline, but only processes the line in the first case. The trailing-newline-free case leaves `_line` populated but the loop body unexecuted. Fix: use `|| [ -n "$_line" ]` as the loop condition so the final partial line is always processed.
- **Code block false-positive prevention**: A `VERBOSITY:` line inside a Markdown code fence (` ``` `) must not be matched. The extraction loop tracks a `_in_fence` flag (toggled by lines starting with ` ``` `). Any `^VERBOSITY:` match while `_in_fence=1` is discarded. This is implemented as a bash `while IFS= read -r` loop over the file — no external awk or sed call.
- **Fence toggle under `set -e`**: `(( expr ))` returns exit code 1 when the arithmetic result is 0. In `set -e` environments (or scripts that inherit strict error mode), toggling `_in_fence` from 1 to 0 terminates the script. The toggle expression must be guarded: `(( _in_fence = 1 - _in_fence )) || true`.
- **Unclosed fence recovery**: If the first pass completes with `LEVEL` still empty and `_in_fence=1`, the file contains an unclosed code fence. A recovery pass re-reads the file ignoring fence state; the first `^VERBOSITY:` line found is used. The warning is throttled using a 60-minute marker file (`$HOME/.claude/logs/.verbosity-fence-warned`) so it fires at most once per hour regardless of how many prompts are submitted: `find "$HOME/.claude/logs/.verbosity-fence-warned" -mmin -60 2>/dev/null | grep -q . || { echo "..." >&2; touch "$HOME/.claude/logs/.verbosity-fence-warned" 2>/dev/null; }`. Warning goes to stderr only — not to the append-only log file. If recovery also yields no match, fall through to the next memory source.
- After extraction, the value is normalized using a `case` statement before the sanity guard (see Uppercase normalization below).

Extraction sequence (pure bash, bash 3.2 compatible):

```bash
_in_fence=0; LEVEL=""; _first=1
while IFS= read -r _line || [ -n "$_line" ]; do
    if [ "$_first" = "1" ]; then
        _line="${_line#$'\xef\xbb\xbf'}"   # strip UTF-8 BOM on first line
        _first=0
    fi
    case "$_line" in
        '```'*) (( _in_fence = 1 - _in_fence )) || true ;;
        VERBOSITY:*)
            (( _in_fence )) && continue
            LEVEL="${_line#VERBOSITY:}"           # strip key prefix
            LEVEL="${LEVEL#"${LEVEL%%[! ]*}"}"    # strip leading spaces
            LEVEL="${LEVEL%$'\r'}"                # strip trailing CR
            LEVEL="${LEVEL%% *}"                  # strip trailing spaces
            break
            ;;
    esac
done < "$_mem_file"
```

### Uppercase normalization (bash 3.2 compatible)

`${LEVEL^^}` (bash 4.0+ only) must not be used. macOS ships bash 3.2 by default; using `^^` causes a syntax error on those platforms. Normalization is performed with a `case` bracket-expression pattern that matches all capitalisation variants of the three valid tokens, with zero subshell overhead:

```bash
case "$LEVEL" in
    [Mm][Ii][Nn])                           LEVEL="MIN"     ;;
    [Ii][Nn][Ff][Oo])                       LEVEL="INFO"    ;;
    [Vv][Ee][Rr][Bb][Oo][Ss][Ee])          LEVEL="VERBOSE" ;;
esac
```

Any value not matching one of these three patterns passes through unchanged; the Stage 3 sanity guard then sets it to `MIN`.

### Path variable quoting

All path variable expansions in both scripts must be double-quoted without exception, including inside `[ ]` tests, `< "$file"` redirections, and string comparisons:

```bash
[ -f "$_dir/.claude/hooks/verbosity-remind.sh" ]   # correct
[ -f $_dir/.claude/hooks/verbosity-remind.sh ]      # FORBIDDEN
done < "$_mem_file"                                  # correct
[ "$_dir" != "$_prev" ]                             # correct
```

This mandate covers: `"$_dir"`, `"$_prev"`, `"$_start"`, `"$_mem_file"`, `"$_log_dir"`, and every other variable holding a filesystem path. Paths containing spaces, parentheses, or shell-special characters must work without modification.

### `$HOME` over `~`

The tilde character (`~`) undergoes shell tilde-expansion only in interactive shells and in specific quoting contexts. Inside `bash -c '...'` subshells, here-strings, and non-interactive script execution, `~` is treated as a literal character and does not expand. All paths that reference the user home directory must use `"$HOME"` instead:

| Forbidden | Required |
|-----------|----------|
| `~/.claude/memory/verbosity.md` | `"$HOME/.claude/memory/verbosity.md"` |
| `~/.claude/hooks/verbosity-remind.sh` | `"$HOME/.claude/hooks/verbosity-remind.sh"` |
| `~/.claude/logs/verbosity-hook.log` | `"$HOME/.claude/logs/verbosity-hook.log"` |

This applies to both hook scripts and both installer scripts.

### Hook execution model

Claude Code fires `UserPromptSubmit` hooks **sequentially**, not concurrently. Each hook's stdout is captured independently and injected into the conversation context as a separate block before Claude generates its response. Stderr is not injected. Hook output appears permanently in the session transcript (`.jsonl` history files) — this is expected and acceptable: the reminder is a short, transparent signal (~20 tokens) that documents the active verbosity level for audit purposes. There is no mechanism to suppress it from the transcript.

The global hook's deferral decision is based on filesystem state (Stage 1 traversal), not on execution order. The guarantee of exactly one injected reminder holds regardless of which hook runs first.

### CI/CD bypass

At hook entry — before any guard, traversal, or file read — check for the bypass flag:

```bash
case "${CC_VERBOSITY_SKIP:-0}" in
    1|true|yes|on|TRUE|YES|ON|True|Yes|On) exit 0 ;;
esac
```

The `CC_VERBOSITY_SKIP` flag accepts any of the standard truthy values: `1`, `true`, `yes`, `on` (and their uppercase and title-case variants). Any other value — including `false`, `0`, or absent — is treated as disabled. This broadens compatibility with CI environments that set boolean flags as `true` (e.g., GitHub Actions `${{ true }}`), not just `1`. The flag is not persisted; it must be exported in the environment per-invocation.

### Diagnostic logging

Silent extraction failures (conditions beyond expected sanity-guard fallbacks) must not be silently dropped.

Loggable conditions:
- Traversal cap reached (40 iterations) at Stage 2 with no file found at any level
- File read I/O error mid-read (bash `read` returns non-zero unexpectedly)
- Unexpected `set -e` trap triggered inside the hook body

Non-loggable conditions (expected defensive paths; no log entry written):
- `LEVEL` empty after extraction → sanity guard sets MIN (normal)
- Unrecognized level value → sanity guard sets MIN (normal)
- `verbosity.md` absent at all levels → sanity guard sets MIN (normal)

Log target: `"$HOME/.claude/logs/verbosity-hook.log"`. Before any log write, the directory path must pass a three-step defensive validation:

```bash
_logdir="$HOME/.claude/logs"
_logfile="$_logdir/verbosity-hook.log"
_log_ok=0
if [ -e "$_logdir" ] && [ ! -d "$_logdir" ]; then
    # Path exists but is not a directory (e.g., a regular file named "logs")
    echo "[verbosity-remind] log dir blocked by non-directory: $_logdir" >&2
elif mkdir -p "$_logdir" 2>/dev/null && [ -w "$_logdir" ]; then
    _log_ok=1
fi
# Subsequent log writes use: (( _log_ok )) && printf '...\n' >> "$_logfile" 2>/dev/null
```

Step 1: if the path exists but is not a directory, emit a one-time stderr warning and disable file logging for this invocation — `mkdir -p` would silently succeed (no-op) but the `>>` write would fail with a confusing error.

Step 2: attempt `mkdir -p 2>/dev/null`. Suppresses permission errors from stdout.

Step 3: verify the directory is writable (`-w`). If creation succeeded but the directory is mode 000 or owned by another user, the `>>` write would fail silently. Checking `-w` first avoids the attempt entirely.

If any step fails, `_log_ok` remains 0 and all log writes are skipped silently. The hook always exits 0 regardless.

Log line format:
```
YYYY-MM-DD HH:MM:SS [global|project] <one-sentence description>
```

Example:
```
2026-06-12 14:32:01 [global] traversal cap (40) reached; no verbosity.md found
```

Log writes use `>>` append redirect. If the log write itself fails (disk full, permissions), the failure is silently ignored.

### `$PWD` null guard

At hook entry, after the CI bypass check and before any traversal:

```bash
_start="${PWD:-}"
if [ -z "$_start" ]; then
    # $PWD is unset or empty — skip traversal entirely
    # Fall through directly to global $HOME/.claude/memory/verbosity.md
    _start=""
fi
```

If `$PWD` is null or missing, both traversal stages are skipped. Stage 2 reads `"$HOME/.claude/memory/verbosity.md"` directly. The sanity guard handles any subsequent bad state. The hook always exits 0.

### Upward traversal algorithm

Applies to Stage 1 (hook detection, global hook only) and Stage 2 (memory file resolution, both hooks). The same loop structure is reused for both.

```bash
_dir="$_start"; _prev=""; _iters=0; _cap=40
while [ "$_dir" != "$_prev" ] && (( _iters < _cap )); do
    # test condition at "$_dir"
    _prev="$_dir"
    _dir="${_dir%/*}"
    [ -z "$_dir" ] && _dir="/"
    (( _iters++ ))
done
```

Loop invariants:
- **Termination condition**: `"$_dir" == "$_prev"` (path stopped changing). Not `"$_dir" == /`.
- **Iteration cap**: 40 iterations maximum. Handles virtual filesystems, bind mounts, or degenerate path structures where `${_dir%/*}` does not converge. If the cap is reached without finding the target, the loop exits and the stage falls through to its next fallback. A cap-reached event at Stage 2 is logged.
- **No subshells inside the loop**: `${_dir%/*}` is a pure parameter expansion. No `dirname`, no `$(...)`, no fork per iteration.
- **Git Bash drive roots** (`/c`, `/d`): `${"/c"%/*}` yields `""`, which is set to `/`. Next iteration: `"/" == "/"` → exits. No infinite loop.
- **Windows UNC network paths** (`//server/share/...` under Git Bash): `${dir%/*}` on `//server/share/project` yields `//server/share`; on `//server/share` yields `//server`; on `//server` yields `""` → set to `/`. The traversal then checks `/` and terminates via change-detection. Checks at `//server` and `/` are safe because `-f` evaluates false for non-existent paths at those roots. The loop does NOT traverse into the UNC namespace (`//server` is not the UNC root `\\server`); the POSIX `/` root is reached instead. No `.claude/` directory exists at these roots in any normal deployment, so the fallback to `$HOME/.claude/memory/verbosity.md` applies. The iteration cap (40) prevents any runaway traversal on degenerate UNC mount structures.
- **Permission-denied directories**: the `-f` test evaluates false when the parent directory lacks execute permission; no error is emitted to stderr. Traversal continues upward transparently.

**Symlink note**: The traversal uses `"$PWD"` (logical shell-assigned path). Do not substitute `$(pwd -P)` — doing so breaks setups where `.claude/` is accessible exclusively via a symlink path.

### Stage 1 readability check

The global hook's Stage 1 traversal must confirm both existence and readability before deferring authority. A project hook that exists but is not readable (e.g., permission-stripped on a shared system) must not cause the global hook to defer:

```bash
[ -f "$_dir/.claude/hooks/verbosity-remind.sh" ] && [ -r "$_dir/.claude/hooks/verbosity-remind.sh" ]
```

If the file exists but fails the `-r` test, the traversal continues upward as if the file were absent. The global hook remains the authority for that prompt.

### Main path

1. User submits a prompt. Claude Code fires all `UserPromptSubmit` hooks sequentially.
2. **Global hook fires.**
   - CI bypass: if `CC_VERBOSITY_SKIP=1`, exit 0 immediately.
   - `$PWD` null guard: if `$PWD` empty, skip traversal; go to Stage 2 global fallback.
   - Stage 1 — upward traversal (cap 40) for `.claude/hooks/verbosity-remind.sh`. Each candidate is tested with both `-f` and `-r`. If a readable file is found, exit 0 with no output (defer to project hook).
   - Stage 2 — upward traversal (cap 40) for `.claude/memory/verbosity.md`. First file found wins. If cap reached or `$PWD` was null, read `"$HOME/.claude/memory/verbosity.md"`.
   - Stage 3 — parse with code-fence tracking, normalize via `case`, sanity guard. If `LEVEL` not in `{MIN, INFO, VERBOSE}`, set `LEVEL=MIN`.
   - Emit one reminder line with leading newline to stdout.
3. **Project hook fires** (only in projects with the template installed).
   - CI bypass check first.
   - `$PWD` null guard.
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

### Project hook command registration

The project hook cannot be registered with a static relative path (`.claude/hooks/verbosity-remind.sh`) because Claude Code may invoke `UserPromptSubmit` hooks from any directory, not necessarily the project root. A relative path evaluates against the CWD at invocation time; from a nested subdirectory it resolves to a non-existent path, silently producing no output.

The registration command must embed a self-contained upward traversal loop that locates the project's hook script regardless of invocation CWD:

```json
"command": "bash -c '_d=\"${PWD:-}\"; _p=\"\"; _i=0; while [ \"$_d\" != \"$_p\" ] && [ $_i -lt 40 ]; do h=\"$_d/.claude/hooks/verbosity-remind.sh\"; [ -f \"$h\" ] && [ -r \"$h\" ] && { bash \"$h\"; exit $?; }; _p=\"$_d\"; _d=\"${_d%/*}\"; [ -z \"$_d\" ] && _d=/; _i=$((_i+1)); done; exit 0'"
```

This command:
- Uses the same change-detection termination and 40-iteration cap as the standalone scripts
- Tests both `-f` and `-r` before invoking (matching Stage 1 readability requirement)
- Passes `$?` through so a non-zero exit from the hook script propagates correctly
- Falls through with `exit 0` (no output) if no project hook is found — this case should not occur in a properly installed project, but is harmless

**JSON escaping constraints**: the command string above is the exact value that must appear inside the JSON `"command"` field. Escaping rules that apply to this string:

| Character in bash command | JSON encoding | Appears in this command |
|--------------------------|---------------|------------------------|
| `"` (double-quote) | `\"` | yes — all inner `"$_d"`, `"$h"` etc. |
| `\` (backslash) | `\\` | no — no literal backslashes in the traversal loop |
| `/` (forward-slash) | `/` (no escape needed in JSON) | yes — paths |
| newline | `\n` | no — command is one line |

The inner `\"` pairs around variable references (e.g., `\"$_d\"`) are **JSON escapes for the double-quote character**; when the JSON is parsed they become literal `"` in the command string. The bash `-c '...'` single-quoted context then receives them as literal `"` characters that act as shell quoting within the script. This is the same escaping pattern already used by the existing `pre-tool-use.sh` registration in `project-template/.claude/settings.json`.

Installers must use `jq` / `ConvertTo-Json` to serialize the command string into JSON rather than hand-constructing the JSON — these tools handle all escaping automatically and prevent corruption.

**Global hook command — install-time absolute path resolution**: Claude Code's shell expansion behaviour for `$HOME` inside `settings.json` command strings is unverified and must not be relied upon. The global hook command must be written with the absolute path resolved at install time:

```bash
# install.sh — write literal resolved path, not $HOME variable
_global_hook_cmd="bash ${HOME}/.claude/hooks/verbosity-remind.sh"
# pass $_global_hook_cmd to jq for JSON serialization
```

```powershell
# install.ps1 — resolve $HOME at install time
$globalHookCmd = "bash $env:USERPROFILE/.claude/hooks/verbosity-remind.sh"
# pass $globalHookCmd to ConvertTo-Json serialization
```

The resulting `settings.json` entry contains a literal path such as `bash /home/alice/.claude/hooks/verbosity-remind.sh` — no runtime variable expansion is required. If the user's home directory changes after installation, they must re-run the installer.

### Empty or binary-only prompt behavior

The hook fires on the `UserPromptSubmit` event regardless of prompt content. It does not inspect or read the prompt string. When the user submits an empty string or a prompt consisting exclusively of binary attachments (images, files), the hook runs its full pipeline identically and emits the verbosity reminder normally. No special handling or suppression is required.

### Alternative paths

- **Invoked from a project subdirectory** — upward traversal (capped at 40) in the embedded registration command finds `.claude/hooks/verbosity-remind.sh` at the project root; behavior is identical to being at the root.
- **Project has a local `.claude/memory/verbosity.md` that overrides global** — Stage 2 finds the project file first; `"$HOME/.claude/memory/verbosity.md"` is never read.
- **No project template installed (bare session)** — global hook Stage 1 finds no project hook; reads `"$HOME/.claude/memory/verbosity.md"` directly and emits the reminder. Project hook never fires.
- **User changes verbosity mid-session** — direct edit of `"$HOME/.claude/memory/verbosity.md"` (or the project-local override). `/cc-lang` changes response language only; it does not touch `verbosity.md`. The hook re-reads the file on the next prompt.

### Error cases

- **`CC_VERBOSITY_SKIP` set to a truthy value** (`1`, `true`, `yes`, `on`, any case) — hook exits 0 immediately, no output.
- **`$PWD` is null or unset** — traversal skipped; hook reads `"$HOME/.claude/memory/verbosity.md"` directly. Sanity guard handles bad state. Hook exits 0.
- **`verbosity.md` is missing at all levels** — extraction yields empty `LEVEL`; sanity guard sets `MIN`. Hook exits 0, emits `\n[VERBOSITY:MIN]`. Installers always provision `"$HOME/.claude/memory/verbosity.md"` at install time; sanity guard is a corruption defense.
- **`verbosity.md` contains an unrecognized value** — `case` normalization attempted; if still not in `{MIN, INFO, VERBOSE}`, sanity guard sets `MIN`. Hook exits 0.
- **`verbosity.md` is empty or has no `VERBOSITY:` line** — extraction yields empty `LEVEL`; sanity guard sets `MIN`. Hook exits 0.
- **`verbosity.md` has Windows CRLF line endings** — `\r` stripped during extraction; `VERBOSE\r` normalizes correctly. Hook exits 0.
- **`VERBOSITY:` line is inside a Markdown code fence** — `_in_fence` flag discards the match; traversal continues for a body-level match. Falls back to next memory source if none found.
- **Unclosed code fence in `verbosity.md`** — first pass yields empty `LEVEL` with `_in_fence=1`; recovery pass re-reads ignoring fences; first `^VERBOSITY:` line used. Throttled stderr warning emitted at most once per 60 minutes via marker file; does not appear on every prompt.
- **`verbosity.md` has no trailing newline** — `|| [ -n "$_line" ]` loop condition ensures the final line is processed; last line matched and `LEVEL` extracted correctly.
- **`verbosity.md` starts with UTF-8 BOM** — BOM bytes (`\xef\xbb\xbf`) stripped from first line before pattern matching; `VERBOSITY:` on line 1 matches correctly without frontmatter.
- **Arithmetic fence toggle yields 0 under `set -e`** — `|| true` prevents script termination when `_in_fence` transitions from 1 to 0.
- **Log directory is a non-directory file** — stderr warning emitted; file logging disabled for that invocation; hook continues.
- **Log directory exists but is not writable** — `-w` check prevents a failed `>>` attempt; file logging silently disabled; hook continues.
- **Traversal cap reached (40 iterations)** — loop exits; falls back to `"$HOME/.claude/memory/verbosity.md"`. Cap-reached event logged.
- **Project hook exists but is not readable (`-r` fails)** — global hook Stage 1 does not defer; continues traversal upward. Global hook remains the authority for that prompt.
- **Permission-denied directory in traversal path** — `-f` returns false silently; traversal continues upward. No stderr output.
- **`mkdir -p` for log dir fails** — `2>/dev/null` suppresses the error from stdout; subsequent log write fails silently; hook continues and exits 0.
- **Hook script missing or not executable** — Claude Code logs a hook error; session continues. `CLAUDE.md` and `skills/verbosity.md` serve as soft fallbacks.
- **Git Bash drive-root edge case** — change-detection loop terminates correctly; no infinite loop.

### Settings JSON array-append strategy

Both installers currently overwrite `settings.json` wholesale. This is replaced with a targeted merge strategy.

**Formatting normalization**: the merged output is normalized to:
- **install.sh** (`jq`): 2-space indentation (`jq '.'` default). Minified and deeply-indented input is both normalized to 2-space pretty-print. This is the canonical format for all code-conductor `settings.json` files.
- **install.ps1** (`ConvertTo-Json`): 4-space indentation (`ConvertTo-Json -Depth 10` default). This divergence from the bash output is acceptable because the files are platform-specific; the PowerShell installer only runs on Windows.

Minified input is intentionally re-indented. This is documented behavior, not a side effect.

**Directory pre-flight** — before copying any asset, both installers must verify and create all target parent directories:

```bash
# install.sh
mkdir -p "${HOME}/.claude/hooks"  2>/dev/null
mkdir -p "${HOME}/.claude/memory" 2>/dev/null
```

```powershell
# install.ps1
New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\hooks"  | Out-Null
New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\memory" | Out-Null
```

These calls must precede any `cp` / `Save-RemoteFile` invocations. If directory creation fails (e.g., insufficient permissions), the installer must print an error and halt — silently copying into a non-existent path would produce no file and no feedback.

**install.sh merge procedure** — when `jq` is available:
1. Read the existing target `settings.json` (start from `{}` if absent).
2. Remove all entries in `hooks.UserPromptSubmit` whose command contains `verbosity-remind.sh` (stale variant cleanup).
3. Append the current verbosity hook entry.
4. Write the merged result back with 2-space indentation.

**install.sh fallback** — when `jq` is not available:
1. Check for `python3` as a non-destructive alternative JSON processor:
   ```bash
   if command -v python3 >/dev/null 2>&1; then
       # Perform merge via python3 json module
       python3 - <<'PYEOF'
   import json, sys, os
   path = sys.argv[1]; cmd = sys.argv[2]
   d = json.load(open(path)) if os.path.exists(path) else {}
   arr = d.setdefault("hooks", {}).setdefault("UserPromptSubmit", [])
   arr[:] = [e for e in arr if "verbosity-remind.sh" not in e.get("command", "")]
   arr.append({"type": "command", "command": cmd})
   json.dump(d, open(path, "w"), indent=2); print(json.dumps(d, indent=2))
   PYEOF
   fi
   ```
   `python3` is universally available on macOS (via Xcode tools) and common on Linux. It performs the same stale-variant removal and append as the `jq` path, outputting 2-space indented JSON, with no destructive fallback.

2. If neither `jq` nor `python3` is available: **do not overwrite `settings.json`**. Print instructions for manual addition and exit with a non-zero code:
   ```
   ⚠ Neither jq nor python3 found. settings.json was NOT modified.
     Add the following entry manually to the hooks.UserPromptSubmit array in:
       <path to settings.json>

     {"type": "command", "command": "<resolved-absolute-hook-path>"}
   ```
   This eliminates the destructive fallback entirely. User-configured hooks are never at risk from a missing tool dependency.

**install.ps1 merge procedure** — using `ConvertFrom-Json` / `ConvertTo-Json` (always available in PS 5.1+):
1. Attempt to read and parse existing `settings.json` inside a `try/catch` block:
   ```powershell
   $existing = $null
   if (Test-Path $_settingsPath) {
       try {
           $existing = Get-Content $_settingsPath -Raw -Encoding utf8 | ConvertFrom-Json
       } catch {
           Write-Warning "settings.json is malformed — creating backup and starting fresh."
           $ts  = Get-Date -Format "yyyyMMddHHmmss"
           $rnd = [System.Guid]::NewGuid().ToString('N').Substring(0, 8)
           Copy-Item $_settingsPath "${_settingsPath}.bak.${ts}.${rnd}"
           $existing = $null
       }
   }
   if ($null -eq $existing) { $existing = [PSCustomObject]@{} }
   ```
   If `ConvertFrom-Json` throws (malformed JSON), the corrupted file is backed up with a timestamp, and the merge starts from an empty object. This prevents script termination and prevents configuration loss.
2. Ensure `hooks.UserPromptSubmit` exists as an array (`@()`).
3. Remove all entries whose `command` property contains `verbosity-remind.sh` (stale variant cleanup).
4. Append the current verbosity hook entry.
5. Serialize back with `ConvertTo-Json -Depth 10` and `Set-Content -Encoding utf8`.

No backup is needed on the success path because `ConvertFrom-Json` / `ConvertTo-Json` performs a non-destructive in-memory merge — existing entries are preserved before the file is written. Backup only occurs in the `catch` block (malformed input).

**Idempotency key and stale variant cleanup**: the substring `verbosity-remind.sh` serves as the hook fingerprint. Before appending the new entry, the installer removes ALL existing entries in the `UserPromptSubmit` array whose command string contains `verbosity-remind.sh` — regardless of how the command was previously phrased (relative path, old absolute path, previous script version). The current command string is then appended. This ensures that only one verbosity-remind hook exists at any time and that structural renames or path changes from earlier spec versions do not leave orphaned entries.

### Windows installer and execution permissions

`install.ps1` copies hook scripts using `Save-RemoteFile` (raw content write via `Set-Content`). No `icacls`, `chmod`, or permission-setting call is needed. All hooks are invoked via explicit `bash path/to/script.sh` — not as direct executables. The new hooks must be registered following the same patterns as existing hooks (see Project hook command registration above).

## Acceptance Criteria

### Functional

- [ ] `global/hooks/verbosity-remind.sh` exists; emits exactly one reminder line per invocation when no readable project hook is found via upward traversal.
- [ ] `project-template/.claude/hooks/verbosity-remind.sh` exists; emits exactly one reminder line per invocation.
- [ ] When both hooks are registered, exactly one reminder appears per prompt (global defers via upward traversal with `-f` and `-r` checks).
- [ ] `CC_VERBOSITY_SKIP` with value `1`, `true`, `yes`, or `on` (any case) causes both hooks to exit 0 with no output; `false`, `0`, or absent does not.
- [ ] All path variable expansions are double-quoted; hook functions correctly with a CWD containing spaces and parentheses.
- [ ] All home-directory paths use `"$HOME"` — no bare `~` in any script or settings.json command string.
- [ ] Upward traversal uses only pure bash `${_dir%/*}` — no `dirname`, no `$(...)` subshells inside the loop.
- [ ] Loop termination uses change-detection (`"$_dir" != "$_prev"`), not `"$_dir" != /`.
- [ ] Loop iteration cap of 40 is enforced; traversal exits gracefully when cap is reached.
- [ ] Stage 1 deferral requires both `-f` and `-r` to pass; an unreadable project hook does not cause the global hook to defer.
- [ ] Cap-reached event at Stage 2 is appended to `"$HOME/.claude/logs/verbosity-hook.log"`.
- [ ] `mkdir -p "$HOME/.claude/logs" 2>/dev/null` is used; permission errors do not bleed into stdout.
- [ ] Permission-denied directory in traversal path is handled silently (no stderr output, traversal continues).
- [ ] Reminder output begins with a leading `\n` character.
- [ ] Extraction strips leading spaces, trailing spaces, and `\r` using pure bash parameter expansion.
- [ ] Extraction loop uses `|| [ -n "$_line" ]` condition; files without a trailing newline are parsed correctly.
- [ ] UTF-8 BOM (`\xef\xbb\xbf`) stripped from first line before pattern matching; `VERBOSITY:` on line 1 without frontmatter matches correctly.
- [ ] Fence toggle uses `(( ... )) || true`; no script termination when toggling from 1 to 0 under `set -e`.
- [ ] Level normalization uses `case` bracket expressions, not `${LEVEL^^}`; `min`, `Min`, `MIN` all resolve to `MIN` on bash 3.2.
- [ ] Sanity guard falls back to `MIN` for any value outside `{MIN, INFO, VERBOSE}` after normalization.
- [ ] Code-fence tracking prevents a `VERBOSITY:` line inside a Markdown code block from being matched.
- [ ] Unclosed fence warning throttled via `$HOME/.claude/logs/.verbosity-fence-warned` marker with 60-minute TTL; fires at most once per hour per hook scope.
- [ ] Log directory validation: non-directory path at log dir → stderr warning + logging disabled; unwritable directory → logging silently disabled; both cases leave hook exit 0.
- [ ] `$PWD` null guard skips traversal and falls back to `"$HOME/.claude/memory/verbosity.md"`.
- [ ] Project-local `.claude/memory/verbosity.md` overrides `"$HOME/.claude/memory/verbosity.md"` when found in ancestor chain.
- [ ] Reminder text is level-aware: three distinct messages for MIN / INFO / VERBOSE.
- [ ] Project hook command in `settings.json` uses embedded traversal loop — static relative path `.claude/hooks/...` is not used.
- [ ] `global/settings.json` registers global hook; graphify entry preserved; re-run does not duplicate.
- [ ] `project-template/.claude/settings.json` registers project hook with embedded traversal; existing `PreToolUse` and `PostCompact` entries preserved; re-run does not duplicate.
- [ ] Installer merge: pre-existing `UserPromptSubmit` hooks from other sources are preserved after install.
- [ ] install.sh with `jq`: stale `verbosity-remind.sh` variants removed from `UserPromptSubmit` array before appending current entry; output 2-space indented.
- [ ] install.sh with `python3` (jq absent): same stale-variant removal and append via `json` module; no destructive overwrite.
- [ ] install.sh with neither `jq` nor `python3`: `settings.json` is NOT modified; user receives exact JSON fragment to add manually; installer exits non-zero.
- [ ] install.ps1 merge: stale `verbosity-remind.sh` variants removed before appending current entry; output 4-space indented via `ConvertTo-Json -Depth 10`.
- [ ] install.ps1 `ConvertFrom-Json` wrapped in `try/catch`; malformed input triggers backup named `<path>.bak.YYYYMMDDHHMMSS.<8-char-GUID>` without script termination.
- [ ] Both installers run directory pre-flight (`mkdir -p` / `New-Item -Force`) for `hooks/` and `memory/` before copying assets; halt with error if creation fails.
- [ ] Global hook command in `settings.json` contains literal resolved absolute path (no `$HOME` variable); confirmed for both installers.
- [ ] Project hook command serialized via `jq`/`ConvertTo-Json`; no manual string concatenation.
- [ ] Unclosed code fence in `verbosity.md`: recovery pass finds first `^VERBOSITY:` line ignoring fences; warning emitted to stderr (not the append-only log file); per-prompt log accumulation prevented.
- [ ] UNC path (`//server/share/project`) traversal terminates correctly; falls back to `$HOME` global memory file.
- [ ] `skills/verbosity.md` Application section updated to describe hook-driven enforcement.
- [ ] `install.sh` and `install.ps1` copy `global/hooks/verbosity-remind.sh` to `"$HOME/.claude/hooks/"`.

### Performance ceiling

- [ ] Both hooks complete within **50ms** on a warm local filesystem (second or later invocation). Includes full pipeline: bypass check, null guard, both traversal stages, file read, normalization, output. Excludes cold OS filesystem cache misses on the very first invocation.
- [ ] The hook introduces zero network I/O.

### Cascading verification matrix

| # | `$PWD` | CI bypass | Global hook | Project hook at ancestor | Project `verbosity.md` | Global `verbosity.md` | Expected emitter | Expected level |
|---|--------|-----------|------------|--------------------------|------------------------|-----------------------|-----------------|----------------|
| 1 | `/home/user` | 0 | yes | no | no | `MIN` | global | MIN |
| 2 | `/home/user/proj` | 0 | yes | yes (root) | no | `MIN` | project | MIN |
| 3 | `/home/user/proj/src` | 0 | yes | yes (root via traversal) | no | `MIN` | project | MIN |
| 4 | `/home/user/proj` | 0 | yes | yes | `INFO` (project-local) | `MIN` | project | INFO |
| 5 | `/home/user/proj` | 0 | yes | yes | `verbose` (lowercase) | `MIN` | project | VERBOSE |
| 6 | `/home/user/proj` | 0 | yes | no | no | absent | global | MIN (sanity guard) |
| 7 | `/home/user/proj` | 0 | yes | no | no | `LOUD` | global | MIN (sanity guard) |
| 8 | empty string | 0 | yes | n/a | no | `INFO` | global (traversal skipped) | INFO |
| 9 | `/c/Users/proj` | 0 | yes | no | no | `VERBOSE` | global (Git Bash root) | VERBOSE |
| 10 | `/home/user/proj` | 0 | yes | no | `VERBOSITY:` in ` ``` ` fence | `MIN` | global | MIN (fence guard) |
| 11 | `/home/user/proj` | 1 | yes | yes | `INFO` | `MIN` | neither | (no output) |
| 12 | `/home/user with spaces/proj` | 0 | yes | no | no | `MIN` | global | MIN (quoted path) |
| 13 | `/home/user/proj` | 0 | yes | yes (exists, not readable) | n/a | `MIN` | global (readable check fails, no defer) | MIN |
| 14 | `/home/user/proj/src/lib` | 0 | yes | yes (at `/home/user/proj`) | no | `MIN` | project (embedded traversal in settings cmd) | MIN |

## Out of Scope

- Changing the verbosity level — re-run the installer with `--verbosity` or directly edit `"$HOME/.claude/memory/verbosity.md"`; no command wrapper is in scope.
- Enforcing verbosity inside subagent responses — subagents inherit the system prompt but not hook output.
- Detecting verbosity drift in past responses and auto-correcting — enforcement is prospective only (next prompt).
- Adding a project-level `verbosity.md` template to the project template — teams override by creating `.claude/memory/verbosity.md` manually.
- Windows native PowerShell hook execution — hooks run under bash (Git Bash on Windows); no PowerShell port needed.
- Suppressing hook output from `.jsonl` session transcripts — hook output is visible in history by design.
- Symlinked `.claude/` directories (`.claude/` is itself a symlink pointing elsewhere) — only standard layout is supported.
- Log rotation or size management for the log file — append-only; no rotation.
- Merging `settings.json` formatting differences between installer runs beyond the defined normalization (2-space jq / 4-space PS).

## System Impact

- `global/hooks/verbosity-remind.sh` — new file; must be added to `install.sh` and `install.ps1` copy lists.
- `global/settings.json` — verbosity hook entry added via merge strategy; graphify entry preserved.
- `project-template/.claude/hooks/verbosity-remind.sh` — new file; copied on `--project` installs.
- `project-template/.claude/settings.json` — verbosity hook entry with embedded traversal command added; `PreToolUse` and `PostCompact` entries preserved.
- `skills/verbosity.md` — Application section updated; level definitions unchanged.
- `install.sh` — copy list updated; `settings.json` write replaced with `jq`-merge function + backup fallback.
- `install.ps1` — copy list updated; `settings.json` write replaced with `ConvertFrom-Json` merge block.

## Complexity Estimate

M — two bash scripts (~55 lines each), JSON merge logic in both installers (~25 lines each), embedded traversal in settings.json command string, two JSON source file edits, one skill section update. The installer merge logic and embedded traversal command elevate from S to M.
