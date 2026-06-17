#!/usr/bin/env bash
# Design invariant: this hook MUST always exit 0.
# Claude Code's UserPromptSubmit mechanism blocks prompt submission if a
# registered hook exits non-zero — a non-zero exit would freeze the user's session.
# `trap 'exit 0' EXIT ERR` enforces this invariant unconditionally:
#   - EXIT: ensures exit code 0 even if `exit N` is called with N > 0.
#   - ERR: catches any unhandled command failure (set -e is NOT active here)
#     and converts it to a clean 0 exit.
# Consequence: genuine failures cannot be signalled via exit code. They are
# reported exclusively via stderr (which Claude Code surfaces as a warning) and
# via the log file at $HOME/.claude/logs/verbosity-hook.log. If a future version
# of Claude Code relaxes the exit-code constraint, remove this trap and replace
# with explicit `exit 0` calls at each return point.
#
# Trap scoping note: the trap applies to the entire script process. It is
# intentionally total — no ERR or EXIT path can bubble a non-zero code out.
# This is correct for production; it is a deliberate trade-off against debuggability.
#
# Debug bypass: set CC_VERBOSITY_DEBUG=1 to disable the trap and expose raw exit
# codes and set -e behaviour. NEVER use CC_VERBOSITY_DEBUG in production — a
# non-zero exit from the hook will block all user prompt submissions:
#   CC_VERBOSITY_DEBUG=1 bash -x global/hooks/verbosity-remind.sh
# The CC_VERBOSITY_SKIP check below still fires before the trap is conditionally armed.
if [ "${CC_VERBOSITY_DEBUG:-0}" = "1" ]; then
    set -euo pipefail
    # trap not armed — raw exit codes propagate
else
    trap 'exit 0' EXIT ERR
fi

# CI/CD bypass — exit before any I/O
# Precedence rule for CC_VERBOSITY_SKIP:
#   The hook reads this variable exclusively from the process environment.
#   There is no file-based config for this flag. Precedence (highest → lowest):
#     1. Variable set inline at invocation:   CC_VERBOSITY_SKIP=1 bash hook.sh
#     2. Variable exported in the calling shell's environment (.bashrc, .zshrc,
#        CI runner environment block, Docker --env).
#     3. Default: 0 (feature active).
#   System-level environment variables (set before the shell that launched Claude
#   Code) take precedence over any user-level shell profile export, because the
#   shell profile is sourced AFTER the system environment is inherited.
#   There is no project-local override mechanism; to disable per-project, set
#   CC_VERBOSITY_SKIP=1 in the shell that launches Claude Code for that project.
#
#   Windows-specific precedence (Git Bash / WSL / PowerShell):
#     - Git Bash: inherits system env from Windows, then sources ~/.bashrc. A
#       system-level CC_VERBOSITY_SKIP set via "setx" or group policy takes
#       precedence over ~/.bashrc exports. Set with: setx CC_VERBOSITY_SKIP 1
#     - WSL: inherits Windows env vars (WSLENV-mapped), then sources ~/.bashrc.
#       If WSLENV includes CC_VERBOSITY_SKIP, the Windows value propagates into
#       WSL and overrides any ~/.bashrc export. Check with: echo $CC_VERBOSITY_SKIP
#     - PowerShell: hook invoked as bash subprocess. The PS session's environment
#       ($env:CC_VERBOSITY_SKIP) propagates to child processes. Set with:
#       $env:CC_VERBOSITY_SKIP = "1"   (session-scope)
#       [System.Environment]::SetEnvironmentVariable('CC_VERBOSITY_SKIP','1','User')  (user-scope)
#   On all platforms: prefer user-scope env vars over system-scope to avoid
#   affecting all users on a shared machine.
#
#   Quick-reference table for CC_VERBOSITY_SKIP across environments:
#   ┌──────────────────┬───────────────────────────────────────────────────────┐
#   │ Environment      │ How to set (user-scope, session-persistent)            │
#   ├──────────────────┼───────────────────────────────────────────────────────┤
#   │ bash/zsh         │ echo 'export CC_VERBOSITY_SKIP=1' >> ~/.bashrc/.zshrc │
#   │ Git Bash (Win)   │ echo 'export CC_VERBOSITY_SKIP=1' >> ~/.bashrc        │
#   │ PowerShell       │ Add to $PROFILE: $env:CC_VERBOSITY_SKIP = "1"         │
#   │ WSL              │ echo 'export CC_VERBOSITY_SKIP=1' >> ~/.bashrc        │
#   │ CI (GitHub)      │ Add to env: block in workflow YAML                    │
#   │ CI (GitLab)      │ Add to variables: block in .gitlab-ci.yml             │
#   │ Docker           │ Add -e CC_VERBOSITY_SKIP=1 to docker run              │
#   │ Inline one-shot  │ CC_VERBOSITY_SKIP=1 bash hook.sh                      │
#   └──────────────────┴───────────────────────────────────────────────────────┘
#   Accepted truthy values: 1, true, yes, on (any case). All other values: feature active.
case "${CC_VERBOSITY_SKIP:-0}" in
    1|true|yes|on|TRUE|YES|ON|True|Yes|On) exit 0 ;;
esac

# Named traversal cap — defined once here to avoid a magic number repeated in
# Stage 1 and Stage 2 loop bodies. Increase only with justification: each unit
# adds one stat() call per prompt invocation; 40 covers paths up to 40 components
# deep which is far beyond any realistic project directory structure.
readonly _VERBOSITY_TRAVERSAL_CAP=40

# $HOME null guard — no memory path or log path is resolvable without it
if [ -z "${HOME:-}" ]; then
    printf '\n[VERBOSITY:MIN] One sentence. [CHANGES] file list only. No prose.\n'
    exit 0
fi

# $PWD null guard
_start="${PWD:-}"
_skip_traversal=0
[ -z "$_start" ] && _skip_traversal=1

# Log setup — done once, used throughout.
# Graceful degradation for restricted/read-only environments:
#   - If $_logdir exists but is not a directory: log silently disabled (_log_ok=0).
#   - If mkdir -p fails (read-only FS, permission denied): _log_ok=0 — hook continues
#     without logging. The hook NEVER blocks or exits non-zero due to log failures.
#   - If $_logdir is writable but $_logfile is occupied by a directory: _log_ok=0.
#   - If the log file itself becomes read-only after creation (e.g., chmod 444 by
#     another process): the >>  append in _write_log silently fails (2>/dev/null).
#   In all restricted cases, the hook's functional output (the [VERBOSITY:…] line
#   emitted to stdout) is unaffected — only the audit log is suppressed.
# Unified machine-readable log format for this hook and the installer:
#   YYYY-MM-DD HH:MM:SS [<scope>] <LEVEL> <message>
#   scope = global | project | install
#   LEVEL = INFO | WARN | ERROR | PASS | FAIL
#   Example: 2026-06-12 09:31:05 [global] INFO level=MIN source=~/.claude/memory/verbosity.md
#   Parse with: awk '{print $1, $2, $3, $4, substr($0, index($0,$5))}'
#   Master Agent: tail -F "$HOME/.claude/logs/verbosity-hook.log" | grep '\[install\]'
#   The installer writes to the same log file with scope=install so all events
#   are co-located for automated success tracking.
_SCOPE="global"
_logdir="$HOME/.claude/logs"
_logfile="$_logdir/verbosity-hook.log"
_log_ok=0
if [ -e "$_logdir" ] && [ ! -d "$_logdir" ]; then
    echo "[verbosity-remind] log dir blocked by non-directory: $_logdir" >&2
elif mkdir -p "$_logdir" 2>/dev/null && [ -w "$_logdir" ]; then
    if [ -e "$_logfile" ] && [ ! -f "$_logfile" ]; then
        echo "[verbosity-remind] log file path blocked by directory: $_logfile" >&2
    else
        _log_ok=1
    fi
fi

_write_log() {
    (( _log_ok )) || return 0
    _logsize=0
    [ -f "$_logfile" ] && _logsize=$(wc -c < "$_logfile" 2>/dev/null || echo 0)
    if [ "${_logsize:-0}" -gt 1048576 ]; then
        # Log rotation: use `true > "$_logfile"` (POSIX-portable, no coreutils needed).
        # Works on Linux, macOS, Alpine/musl, Busybox, and Solaris. Do NOT use
        # `truncate -s 0` (GNU-only, absent on macOS/BSDs) as the primary command.
        # If truncation fails (read-only FS or permission denied), continue silently.
        true > "$_logfile" 2>/dev/null && \
            printf '%s [%s] log rotated at 1 MB ceiling\n' \
                "$(date '+%Y-%m-%d %H:%M:%S')" "$_SCOPE" >> "$_logfile" 2>/dev/null
        # Fall through — write the current message to the freshly truncated file.
    fi
    # Concurrent writes: POSIX O_APPEND (>>) serialises each write() atomically for
    # payloads under PIPE_BUF (~512 B). A single log line from printf is well under
    # that limit, so byte-level interleaving between simultaneous sessions cannot occur.
    # The wc -c size check above is a non-atomic TOCTOU — two sessions may both read
    # size < 1 MB and both proceed, pushing the file slightly over the ceiling. This is
    # a benign race; the next session will catch the overage on its own size check.
    printf '%s [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$_SCOPE" "$1" >> "$_logfile" 2>/dev/null
}

# ── Stage 1: upward project-hook detection (global hook only) ────────────────
if [ "$_skip_traversal" = "0" ]; then
    _dir="$_start"; _prev=""; _iters=0; _cap=$_VERBOSITY_TRAVERSAL_CAP
    while [ "$_dir" != "$_prev" ] && [ "$_dir" != "${HOME:-}" ] && (( _iters < _cap )); do
        _h="$_dir/.claude/hooks/verbosity-remind.sh"
        [ -f "$_h" ] && [ -r "$_h" ] && exit 0
        _prev="$_dir"
        _dir="${_dir%/*}"
        [ -z "$_dir" ] && _dir="/"
        (( _iters++ )) || true
    done
fi

# ── Stage 2: cascading memory resolution ─────────────────────────────────────
_mem_file=""
if [ "$_skip_traversal" = "0" ]; then
    # ── Traversal: symlinks and circular structures ───────────────────────────
    # The upward traversal uses ONLY string operations on the path — it never
    # calls stat(2), readdir(2), or follows filesystem symlinks during directory
    # navigation. Specifically:
    #
    #   _dir="${_dir%/*}"   — POSIX parameter expansion; pure string truncation.
    #                         No syscall. Cannot follow a symlink loop.
    #
    # This means if $PWD itself is a symlink (e.g., /project → /data/project),
    # the traversal walks the LOGICAL path (the symlink chain) not the physical
    # path. It will not revisit directories because each iteration strictly
    # shortens the string (or hits "/" and exits via the $_dir != $_prev guard).
    #
    # Circular structures that CAN arise and their handling:
    #
    #   Directory symlink loop on the PHYSICAL filesystem (e.g., a/.claude → b,
    #   b/.claude → a): SAFE. The traversal walks the logical string path, not
    #   physical inodes. It will never re-enter a directory via a symlink because
    #   it only shortens $_dir; it never appends components or follows links.
    #
    #   Circular mount point (bind-mount of / inside itself): SAFE. Same reason —
    #   string truncation cannot follow a mount.
    #
    #   symlink to verbosity.md (the FILE, not the directory): The file itself
    #   is a symlink. `[ -f "$_f" ]` returns true for a symlink to a regular file.
    #   `[ -L "$_f" ]` then detects it, and `readlink -f` resolves the target.
    #   If the resolved target is in /etc/, /proc/, /sys/, or /dev/, the file is
    #   skipped. Any other resolved target is treated as a normal verbosity.md.
    #   A symlink cycle in verbosity.md itself (a → b → a) causes `readlink -f`
    #   to fail (ELOOP); the fallback `readlink "$_f"` returns the immediate link
    #   target (one level), and the security check runs on that. If both fail,
    #   _resolved="" and the security case-match passes (empty string does not
    #   match /etc/*, /proc/*, etc.) — the file is used as-is. This is the safe
    #   side: a symlink cycle that cannot be resolved is unlikely to be a valid
    #   verbosity.md and will produce no VERBOSITY: tokens (the read loop over a
    #   cyclic symlink fails immediately).
    #
    # $_VERBOSITY_TRAVERSAL_CAP (40) is a DEPTH guard, not a cycle guard.
    # It caps degenerate paths with > 40 path components (e.g., deeply nested
    # monorepos, Docker overlay mounts with long chain paths). It is not needed
    # for cycle prevention — that is already guaranteed by string truncation.
    _dir="$_start"; _prev=""; _iters=0; _cap=$_VERBOSITY_TRAVERSAL_CAP
    while [ "$_dir" != "$_prev" ] && (( _iters < _cap )); do
        _f="$_dir/.claude/memory/verbosity.md"
        if [ -f "$_f" ] && [ -r "$_f" ]; then
            # Symlink safety: reject verbosity.md files that resolve to sensitive system paths.
            # A symlink crafted to point at /etc/passwd, /proc/self/environ, etc. would
            # allow arbitrary file reads via the VERBOSITY: extraction loop below.
            if [ -L "$_f" ]; then
                _resolved=$(readlink -f "$_f" 2>/dev/null || readlink "$_f" 2>/dev/null || echo "")
                case "$_resolved" in
                    /etc/*|/proc/*|/sys/*|/dev/*)
                        _write_log "WARN: verbosity.md at $_f resolves to '$_resolved' — skipping"
                        _prev="$_dir"; _dir="${_dir%/*}"; [ -z "$_dir" ] && _dir="/"
                        (( _iters++ )) || true; continue ;;
                esac
            fi
            _mem_file="$_f"
            break
        fi
        _prev="$_dir"
        _dir="${_dir%/*}"
        [ -z "$_dir" ] && _dir="/"
        (( _iters++ )) || true
    done
    (( _iters >= _cap )) && [ -z "$_mem_file" ] && \
        _write_log "traversal cap (${_cap}) reached; no verbosity.md found"
fi

[ -z "$_mem_file" ] && _mem_file="$HOME/.claude/memory/verbosity.md"
# Precedence rule: the first verbosity.md found during upward traversal is used exclusively.
# If a project-specific file is found but contains no VERBOSITY: token, LEVEL remains ""
# after the extraction loop. Stage 3 normalisation then maps "" to MIN (the safe default).
# The global ($HOME) file is NOT consulted as a secondary fallback — it is only the
# initial value used when no project-specific file exists at all. This means a project
# can intentionally "reset" to MIN by providing a verbosity.md with no VERBOSITY: token.
#
# ── verbosity.md marker edge cases ───────────────────────────────────────────
# CASE 1 — No VERBOSITY: token at all (file exists but marker absent):
#   _in_fence and LEVEL both remain at their initial values (0 and "").
#   Stage 3 maps "" → MIN. The hook emits [VERBOSITY:MIN] and logs a WARN:
#     "WARN: no VERBOSITY: token found in <path>; defaulting to MIN"
#   Implication: an empty verbosity.md or a file consisting only of comments
#   is treated as "intentional MIN reset" and is not an error.
#
# CASE 2 — Multiple VERBOSITY: tokens in the same file:
#   The extraction loop hits `break` on the FIRST match outside a fence or
#   front-matter block. All subsequent VERBOSITY: lines are ignored.
#   Example file:
#     VERBOSITY: MIN          ← THIS line wins (first non-fence match)
#     VERBOSITY: VERBOSE      ← ignored
#   Log entry: "INFO: VERBOSITY:MIN (first match at line N of <path>)"
#   Future maintainers MUST NOT add a second VERBOSITY: token expecting it
#   to override the first — only the first token outside a fence is authoritative.
#
# CASE 3 — VERBOSITY: token inside a fenced code block (``` or ~~~):
#   The _in_fence flag is toggled by fence-open/close lines. A VERBOSITY: line
#   inside an open fence is skipped via `(( _in_fence )) && continue`. It does
#   NOT set LEVEL. This is intentional — code examples in verbosity.md must not
#   accidentally activate a level change.
#
# CASE 4 — VERBOSITY: token inside a YAML front-matter block (--- ... ---):
#   _in_fm=1 is set on encountering a leading `---` on line 1. All lines inside
#   the front-matter block are skipped. The VERBOSITY: token in front-matter is
#   NOT extracted. This prevents Obsidian/Jekyll metadata from leaking into level
#   detection. The hook looks for VERBOSITY: in the document body only.
#
# CASE 5 — VERBOSITY: with an unrecognised value (e.g., "VERBOSITY: QUIET"):
#   LEVEL is set to the raw value "QUIET". Stage 3 normalisation maps any value
#   that is not MIN, INFO, or VERBOSE to MIN, and logs:
#     "WARN: unknown VERBOSITY level 'QUIET'; normalised to MIN"
#   The hook still emits [VERBOSITY:MIN] — it does not error or block.
#
# CASE 6 — verbosity.md is completely absent (no project file, no global file):
#   _mem_file points to $HOME/.claude/memory/verbosity.md after the traversal
#   finds nothing. If that path also does not exist, the `[ -f ] && [ -r ]` guard
#   above skips the while loop entirely. LEVEL remains "". Stage 3 maps → MIN.
#   (Do NOT rely on "no iterations" here — `done < missing_file` triggers ERR.)

# ── Extraction loop (bash 3.2 compatible) ────────────────────────────────────
# Guard: `done < "$_mem_file"` triggers the ERR trap when the file doesn't exist
# (because the `<` redirection fails), causing silent exit 0 with no output.
# The guard converts a missing/unreadable file into LEVEL="" → sanity guard → MIN,
# which is the documented CASE 6 behaviour. Do NOT rely on "no iterations" here.
_in_fence=0; _in_fm=0; LEVEL=""; _lineno=0
if [ -f "$_mem_file" ] && [ -r "$_mem_file" ]; then
    while IFS= read -r _line || [ -n "$_line" ]; do
        _lineno=$(( _lineno + 1 ))
        [ "$_lineno" = "1" ] && _line="${_line#$'\xef\xbb\xbf'}"  # BOM strip on line 1
        _line="${_line%$'\r'}"                                       # CRLF compat, all lines
        if [ "$_lineno" = "1" ] && [ "$_line" = "---" ]; then
            _in_fm=1; continue
        fi
        if [ "$_in_fm" = "1" ]; then
            case "$_line" in
                ---|\.\.\.) _in_fm=0 ;;
            esac
            continue
        fi
        case "$_line" in
            '```'*|'~~~'*) (( _in_fence = 1 - _in_fence )) || true ;;
            VERBOSITY:*)
                (( _in_fence )) && continue
                LEVEL="${_line#VERBOSITY:}"
                LEVEL="${LEVEL#"${LEVEL%%[! ]*}"}"
                LEVEL="${LEVEL%% #*}"          # strip " # comment" (space+hash); bare # not treated as delimiter
                LEVEL="${LEVEL%%[[:space:]]*}"  # strip remaining trailing whitespace
                break
                ;;
        esac
    done < "$_mem_file"
fi

# Recovery pass — unclosed fence
if [ -z "$LEVEL" ] && [ "$_in_fence" = "1" ]; then
    mkdir -p "$HOME/.claude/logs" 2>/dev/null
    # .verbosity-fence-warned lifecycle: 60-minute TTL, per-machine not per-session.
    # A marker from a prior session suppresses this warning if < 60 min old — intentional
    # throttle to avoid noise on repeated openings of the same malformed file.
    # The marker ages out automatically; tests must remove it before asserting on stderr.
    find "$HOME/.claude/logs/.verbosity-fence-warned" -mmin -60 2>/dev/null | grep -q . || {
        echo "[verbosity-remind] unclosed fence in $_mem_file; using recovery pass" >&2
        touch "$HOME/.claude/logs/.verbosity-fence-warned" 2>/dev/null
    }
    while IFS= read -r _line || [ -n "$_line" ]; do
        _line="${_line%$'\r'}"
        case "$_line" in
            VERBOSITY:*)
                LEVEL="${_line#VERBOSITY:}"
                LEVEL="${LEVEL#"${LEVEL%%[! ]*}"}"
                LEVEL="${LEVEL%% #*}"           # strip " # comment" (space+hash only)
                LEVEL="${LEVEL%%[[:space:]]*}"  # strip remaining trailing whitespace
                break
                ;;
        esac
    done < "$_mem_file"
fi

# ── Normalization (bash 3.2 compatible, no ${LEVEL^^}) ───────────────────────
# Empty / whitespace-only verbosity.md recovery:
#   If verbosity.md is empty or contains only whitespace (no VERBOSITY: token),
#   the extraction loop exits with LEVEL="". The recovery pass is skipped
#   (it runs only for unclosed fences). The normalization case below passes
#   LEVEL="" through unchanged. The Stage 3 sanity guard then catches
#   LEVEL="" via the wildcard branch and sets LEVEL="MIN" — same result as
#   an absent file. No additional guard needed; this path is already safe.
case "$LEVEL" in
    [Mm][Ii][Nn])                           LEVEL="MIN"     ;;
    [Ii][Nn][Ff][Oo])                       LEVEL="INFO"    ;;
    [Vv][Ee][Rr][Bb][Oo][Ss][Ee])          LEVEL="VERBOSE" ;;
esac

# ── Stage 3: sanity guard + emit ─────────────────────────────────────────────
case "$LEVEL" in
    MIN|INFO|VERBOSE) ;;
    *) LEVEL="MIN" ;;
esac

# Output is injected into Claude's prompt context via the UserPromptSubmit hook.
# Use only printable ASCII in the format strings. Never add ANSI escape codes,
# terminal control sequences (\033[…), or non-ASCII bytes — the hook runs in a
# non-TTY subprocess; control characters appear as literal bytes in Claude's input.
case "$LEVEL" in
    MIN)     printf '\n[VERBOSITY:MIN] One sentence. [CHANGES] file list only. No prose.\n' ;;
    INFO)    printf '\n[VERBOSITY:INFO] Bullet list max 5. [CHANGES]+[REASON] tags.\n' ;;
    VERBOSE) printf '\n[VERBOSITY:VERBOSE] Full explanation. All tags active.\n' ;;
esac
