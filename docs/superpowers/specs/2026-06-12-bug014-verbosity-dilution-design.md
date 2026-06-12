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
            LEVEL="${_line#VERBOSITY:}"           # strip key prefix
            LEVEL="${LEVEL#"${LEVEL%%[! ]*}"}"    # strip leading spaces
            LEVEL="${LEVEL%$'\r'}"                # strip trailing CR
            LEVEL="${LEVEL%% *}"                  # strip trailing spaces
            LEVEL="${LEVEL^^}"                    # uppercase (bash 4+)
            break
            ;;
    esac
done < "$_mem_file"
```

### Path variable quoting

All path variable expansions in both scripts must be double-quoted without exception, including inside `[ ]` tests, `< "$file"` redirections, and string comparisons:

```bash
[ -f "$_dir/.claude/hooks/verbosity-remind.sh" ]   # correct
[ -f $_dir/.claude/hooks/verbosity-remind.sh ]      # FORBIDDEN
done < "$_mem_file"                                  # correct
[ "$_dir" != "$_prev" ]                             # correct
```

This mandate covers: `"$_dir"`, `"$_prev"`, `"$_start"`, `"$_mem_file"`, `"$_log_dir"`, and every other variable holding a filesystem path. Paths containing spaces, parentheses, or shell-special characters must work without modification.

### Hook execution model

Claude Code fires `UserPromptSubmit` hooks **sequentially**, not concurrently. Each hook's stdout is captured independently and injected into the conversation context as a separate block before Claude generates its response. Stderr is not injected. Hook output appears permanently in the session transcript (`.jsonl` history files) — this is expected and acceptable: the reminder is a short, transparent signal (~20 tokens) that documents the active verbosity level for audit purposes. There is no mechanism to suppress it from the transcript.

The global hook's deferral decision is based on filesystem state (Stage 1 traversal), not on execution order. The guarantee of exactly one injected reminder holds regardless of which hook runs first.

### CI/CD bypass

At hook entry — before any guard, traversal, or file read — check for the bypass flag:

```bash
[ "${CC_VERBOSITY_SKIP:-0}" = "1" ] && exit 0
```

Setting `CC_VERBOSITY_SKIP=1` in the environment causes both hooks to exit immediately with no output. This flag is intended for:
- Automated test suite execution (`tests/guard3-test.sh` and similar)
- CI/CD pipelines that run Claude Code non-interactively
- Any context where the reminder output would pollute structured pipeline logs

The flag is not persisted; it must be set per-invocation or exported in the CI environment. It is not read from `verbosity.md` or any config file.

### Diagnostic logging

Silent extraction failures (conditions beyond the expected sanity-guard fallbacks) must not be silently dropped. Loggable conditions:

- File read error (e.g., `verbosity.md` is readable but throws an I/O error mid-read)
- Traversal cap reached (40 iterations) with no file found at any level — this is unusual and worth recording
- Bash `set -e` trap triggered unexpectedly inside the hook body

Non-loggable conditions (expected defensive paths, no log entry written):
- `LEVEL` empty after extraction → sanity guard sets MIN (normal)
- Unrecognized level value → sanity guard sets MIN (normal)
- `verbosity.md` absent at all levels → sanity guard sets MIN (normal)

Log target: `~/.claude/logs/verbosity-hook.log`. Parent directory created with `mkdir -p` on first write. Appended — never truncated.

Log line format:
```
YYYY-MM-DD HH:MM:SS [global|project] <one-sentence description>
```

Example:
```
2026-06-12 14:32:01 [global] traversal cap (40) reached; no verbosity.md found
```

Log writes use `>>` append redirect. If the log write itself fails (e.g., disk full), the failure is silently ignored — the hook always exits 0 and emits the MIN fallback reminder regardless.

### `$PWD` null guard

At hook entry, after the CI bypass check and before any traversal:

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
    # test condition at "$_dir"
    _prev="$_dir"
    _dir="${_dir%/*}"
    [ -z "$_dir" ] && _dir="/"
    (( _iters++ ))
done
```

Loop invariants:
- **Termination condition**: `"$_dir" == "$_prev"` (path stopped changing). Not `"$_dir" == /`.
- **Iteration cap**: 40 iterations maximum. Handles virtual filesystems, bind mounts, or degenerate path structures where `${_dir%/*}` does not converge. If the cap is reached without finding the target, the loop exits and the stage falls through to its next fallback. A cap-reached event at Stage 2 is logged (see Diagnostic logging).
- **No subshells inside the loop**: `${_dir%/*}` is a pure parameter expansion. No `dirname`, no `$(...)`, no fork per iteration.
- **Git Bash drive roots** (`/c`, `/d`): `${"/c"%/*}` yields `""`, which is set to `/`. Next iteration: `"/" == "/"` → exits. No infinite loop.
- **Permission-denied directories**: the `-f` test evaluates false when the parent directory lacks execute permission; no error is emitted to stderr. Traversal continues upward transparently. The hook never reads or lists directory contents — only tests for a specific file path — so partial permission boundaries are handled gracefully.

**Symlink note**: The traversal uses `"$PWD"` (logical shell-assigned path). Bash resolves symlinks transparently at the `-f` test level. Do not substitute `$(pwd -P)` (physical path) — doing so breaks setups where `.claude/` is accessible exclusively via a symlink path.

### Main path

1. User submits a prompt. Claude Code fires all `UserPromptSubmit` hooks sequentially.
2. **Global hook fires.**
   - CI bypass: if `CC_VERBOSITY_SKIP=1`, exit 0 immediately.
   - `$PWD` null guard: if `$PWD` empty, skip traversal; go to Stage 2 global fallback.
   - Stage 1 — upward traversal (cap 40) for `.claude/hooks/verbosity-remind.sh`. If found, exit 0 with no output (defer to project hook).
   - Stage 2 — upward traversal (cap 40) for `.claude/memory/verbosity.md`. First file found wins. If cap reached or `$PWD` was null, read `~/.claude/memory/verbosity.md`.
   - Stage 3 — parse with code-fence tracking, normalize, sanity guard. If `LEVEL` not in `{MIN, INFO, VERBOSE}`, set `LEVEL=MIN`.
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

### Empty or binary-only prompt behavior

The hook fires on the `UserPromptSubmit` event regardless of prompt content. It does not inspect or read the prompt string. When the user submits an empty string or a prompt consisting exclusively of binary attachments (images, files):

- The hook runs its full pipeline (bypass check → null guard → three stages) identically.
- It emits the verbosity reminder normally.
- Claude receives the reminder as injected context alongside the empty/binary input.

No special handling or suppression is required for these inputs.

### Alternative paths

- **Invoked from a project subdirectory** — upward traversal (capped at 40) finds `.claude/hooks/verbosity-remind.sh` and `.claude/memory/verbosity.md` at the project root; behavior is identical to being at the root.
- **Project has a local `.claude/memory/verbosity.md` that overrides global** — Stage 2 finds the project file first; `~/.claude/memory/verbosity.md` is never read. This enables per-project verbosity overrides.
- **No project template installed (bare session)** — global hook finds no project hook via traversal; it reads `~/.claude/memory/verbosity.md` directly and emits the reminder. Project hook never fires.
- **User changes verbosity mid-session** — direct edit of `~/.claude/memory/verbosity.md` (or the project-local override). No command modifies this file mid-session: `/cc-lang` changes response language only and does not touch `verbosity.md`. The hook re-reads the file on the next prompt; the updated level takes effect immediately.

### Error cases

- **`CC_VERBOSITY_SKIP=1` set** — hook exits 0 immediately, no output.
- **`$PWD` is null or unset** — traversal skipped; hook reads `~/.claude/memory/verbosity.md` directly. Sanity guard handles bad state. Hook exits 0.
- **`verbosity.md` is missing at all levels** — extraction yields empty `LEVEL`; sanity guard sets `MIN`. Hook exits 0, emits `\n[VERBOSITY:MIN]`. Under normal operation, installers always provision `~/.claude/memory/verbosity.md` at install time. The sanity guard is a corruption defense.
- **`verbosity.md` contains an unrecognized value** — uppercase normalization applied first; if still not in `{MIN, INFO, VERBOSE}`, sanity guard sets `MIN`. Hook exits 0.
- **`verbosity.md` is empty or has no `VERBOSITY:` line** — extraction yields empty `LEVEL`; sanity guard sets `MIN`. Hook exits 0.
- **`verbosity.md` has Windows CRLF line endings** — `\r` stripped during extraction; `VERBOSE\r` normalizes to `VERBOSE`. Hook exits 0.
- **`VERBOSITY:` line is inside a Markdown code fence** — `_in_fence` flag discards the match; traversal continues for a body-level match. If none found, falls back to next memory source.
- **Traversal cap reached (40 iterations)** — loop exits; falls back to `~/.claude/memory/verbosity.md`. Cap-reached event logged to `~/.claude/logs/verbosity-hook.log`.
- **Permission-denied directory in traversal path** — `-f` test returns false silently; traversal continues upward. No error emitted.
- **Hook script missing or not executable** — Claude Code logs a hook error; session continues. `CLAUDE.md` and `skills/verbosity.md` serve as soft fallbacks.
- **Git Bash drive-root edge case** — change-detection loop terminates correctly; no infinite loop.

### Settings JSON array-append strategy

Both installers currently overwrite `settings.json` wholesale using raw file download (`download` in `install.sh`, `Save-RemoteFile` in `install.ps1`). This is replaced for `settings.json` files with a targeted merge strategy that preserves any user-added hooks:

**install.sh** — if `jq` is available:
1. Read the existing target `settings.json` (or start from `{}` if absent).
2. Extract the current `hooks.UserPromptSubmit` array (default `[]` if absent).
3. If the verbosity hook command string is not already present in the array, append the new hook entry.
4. Write the merged result back. If `jq` is unavailable: overwrite with the repo version and print a warning: `"⚠ jq not found — settings.json overwritten. Re-add any custom UserPromptSubmit hooks manually."`.

**install.ps1** — using `ConvertFrom-Json` / `ConvertTo-Json` (always available in PS 5.1+):
1. Read existing `settings.json` as a `PSCustomObject` (or start from `'{}'`).
2. Ensure `hooks.UserPromptSubmit` exists as an array.
3. If the verbosity hook command string is not already in the array, append the new entry.
4. Serialize back with `ConvertTo-Json -Depth 10` and `Set-Content -Encoding utf8`.

**Idempotency**: the check for the hook command string ensures re-running the installer does not create duplicate entries. The hook command string used as the idempotency key is the exact value that will appear in `settings.json` (e.g., `"bash ~/.claude/hooks/verbosity-remind.sh"`).

### Windows installer and execution permissions

`install.ps1` copies hook scripts using `Save-RemoteFile` (raw content write via `Set-Content`). No `icacls`, `chmod`, or permission-setting call is needed. All hooks in `settings.json` are invoked via explicit `bash path/to/script.sh` — not as direct executables (`./hook.sh`). Unix execute bits are not consulted on Windows Git Bash in this invocation mode. The new `verbosity-remind.sh` hooks must be registered with:

- Global: `"command": "bash ~/.claude/hooks/verbosity-remind.sh"`
- Project: `"command": "bash -c 'h=\".claude/hooks/verbosity-remind.sh\"; [ -f \"$h\" ] && bash \"$h\" || exit 0'"`

## Acceptance Criteria

### Functional

- [ ] `global/hooks/verbosity-remind.sh` exists; emits exactly one reminder line per invocation when no project hook is found via upward traversal.
- [ ] `project-template/.claude/hooks/verbosity-remind.sh` exists; emits exactly one reminder line per invocation.
- [ ] When both hooks are registered, exactly one reminder appears per prompt (global defers via upward traversal).
- [ ] `CC_VERBOSITY_SKIP=1` causes both hooks to exit 0 with no output.
- [ ] All path variable expansions are double-quoted; hook functions correctly with a CWD path containing spaces and parentheses.
- [ ] Upward traversal uses only pure bash `${dir%/*}` — no `dirname`, no `$(...)` subshells inside the loop.
- [ ] Loop termination uses change-detection (`"$_dir" != "$_prev"`), not `"$_dir" != /`.
- [ ] Loop iteration cap of 40 is enforced; traversal exits gracefully when cap is reached.
- [ ] Cap-reached event at Stage 2 is appended to `~/.claude/logs/verbosity-hook.log`.
- [ ] Permission-denied directory in traversal path is handled silently (no stderr output, traversal continues).
- [ ] Reminder output begins with a leading `\n` character.
- [ ] Extraction strips leading spaces, trailing spaces, and `\r` using pure bash parameter expansion.
- [ ] Extracted level is uppercased via `${LEVEL^^}` before sanity guard; `min`, `Min`, `MIN` all resolve to `MIN`.
- [ ] Sanity guard falls back to `MIN` for any value outside `{MIN, INFO, VERBOSE}` after normalization.
- [ ] Code-fence tracking prevents a `VERBOSITY:` line inside a Markdown code block from being matched.
- [ ] `$PWD` null guard skips traversal and falls back to global `~/.claude/memory/verbosity.md`.
- [ ] Project-local `.claude/memory/verbosity.md` overrides `~/.claude/memory/verbosity.md` when found in ancestor chain.
- [ ] Reminder text is level-aware: three distinct messages for MIN / INFO / VERBOSE.
- [ ] `global/settings.json` registers global hook; existing graphify entry preserved; re-run does not duplicate the entry.
- [ ] `project-template/.claude/settings.json` registers project hook; existing `PreToolUse` and `PostCompact` entries preserved; re-run does not duplicate.
- [ ] Installer merge strategy: if `settings.json` contains pre-existing `UserPromptSubmit` hooks from another source, they are preserved after install.
- [ ] `skills/verbosity.md` Application section updated to describe hook-driven enforcement.
- [ ] `install.sh` and `install.ps1` copy `global/hooks/verbosity-remind.sh` to `~/.claude/hooks/`.

### Performance ceiling

- [ ] Both hooks complete within **50ms** measured from entry to final stdout write, on a warm local filesystem (second or later invocation in the same session). Measurement includes the full pipeline: bypass check, null guard, both traversal stages, file read, normalization, and output. Excludes cold OS filesystem cache misses on the very first invocation.
- [ ] The hook introduces zero network I/O. All reads are local filesystem only.

### Cascading verification matrix

Manual or scripted test scenarios that must pass before production release.

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

## Out of Scope

- Changing the verbosity level — re-run the installer with `--verbosity` or directly edit `~/.claude/memory/verbosity.md`; no command wrapper is in scope.
- Enforcing verbosity inside subagent responses — subagents inherit the system prompt but not hook output.
- Detecting verbosity drift in past responses and auto-correcting — enforcement is prospective only (next prompt).
- Adding a project-level `verbosity.md` template to the project template — teams override by creating `.claude/memory/verbosity.md` manually.
- Windows native PowerShell hook execution — hooks run under bash (Git Bash on Windows); no PowerShell port needed.
- Suppressing hook output from `.jsonl` session transcripts — hook output is visible in history by design.
- Symlinked `.claude/` directories (`.claude/` is itself a symlink pointing elsewhere) — only standard layout where `.claude/` is a real directory at the project root is supported.
- Log rotation or size management for `~/.claude/logs/verbosity-hook.log` — append-only; no rotation.

## System Impact

- `global/hooks/verbosity-remind.sh` — new file; must be added to `install.sh` and `install.ps1` copy lists.
- `global/settings.json` — verbosity hook entry added via merge strategy; graphify entry preserved.
- `project-template/.claude/hooks/verbosity-remind.sh` — new file; copied on `--project` installs.
- `project-template/.claude/settings.json` — verbosity hook entry added via merge strategy; `PreToolUse` and `PostCompact` entries preserved.
- `skills/verbosity.md` — Application section updated; level definitions unchanged.
- `install.sh` — copy list updated; `settings.json` write replaced with jq-merge function.
- `install.ps1` — copy list updated; `settings.json` write replaced with `ConvertFrom-Json` merge block.

## Complexity Estimate

S/M — two bash scripts (~50 lines each), JSON merge logic in both installers (~20 lines each), two JSON source file edits, one skill section update. Installer merge logic elevates from S to S/M.
