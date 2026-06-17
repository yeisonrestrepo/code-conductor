#!/usr/bin/env bash
# Same exit-0 invariant as global hook — must never exit non-zero.
# See global hook comment for full design rationale.
trap 'exit 0' EXIT ERR

# CI/CD bypass — exit before any I/O
case "${CC_VERBOSITY_SKIP:-0}" in
    1|true|yes|on|TRUE|YES|ON|True|Yes|On) exit 0 ;;
esac

# Named traversal cap (same value as global hook; defined separately per-script
# so each hook is independently executable without sourcing the other).
readonly _VERBOSITY_TRAVERSAL_CAP=40

# $HOME null guard
if [ -z "${HOME:-}" ]; then
    printf '\n[VERBOSITY:MIN] One sentence. [CHANGES] file list only. No prose.\n'
    exit 0
fi

# $PWD null guard
_start="${PWD:-}"
_skip_traversal=0
[ -z "$_start" ] && _skip_traversal=1

# Log setup
_SCOPE="project"
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
        # Log rotation (same strategy as global hook): `true > "$_logfile"` is
        # POSIX-portable. See global hook _write_log comment for full rationale.
        true > "$_logfile" 2>/dev/null && \
            printf '%s [%s] log rotated at 1 MB ceiling\n' \
                "$(date '+%Y-%m-%d %H:%M:%S')" "$_SCOPE" >> "$_logfile" 2>/dev/null
        # Fall through — write current message to freshly truncated file.
    fi
    # Concurrent writes: POSIX O_APPEND (>>) serialises each write() atomically for
    # payloads under PIPE_BUF (~512 B). A single log line is well under that limit.
    # The size check is a non-atomic TOCTOU; see global hook for the full note.
    printf '%s [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$_SCOPE" "$1" >> "$_logfile" 2>/dev/null
}

# ── Stage 2: cascading memory resolution (no Stage 1 — project hook IS the authority) ──
_mem_file=""
if [ "$_skip_traversal" = "0" ]; then
    # Cycle safety: same guarantee as global hook — ${_dir%/*} is pure string
    # truncation; symlink cycles cannot occur. The $_VERBOSITY_TRAVERSAL_CAP-iteration
    # cap handles degenerate deep paths. See global hook for the full cycle-safety note.
    _dir="$_start"; _prev=""; _iters=0; _cap=$_VERBOSITY_TRAVERSAL_CAP
    while [ "$_dir" != "$_prev" ] && (( _iters < _cap )); do
        _f="$_dir/.claude/memory/verbosity.md"
        if [ -f "$_f" ] && [ -r "$_f" ]; then
            # Symlink safety (same rule as global hook): skip verbosity.md files that
            # resolve to sensitive system paths to prevent unintended file reads.
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

# ── Extraction loop ───────────────────────────────────────────────────────────
_in_fence=0; _in_fm=0; LEVEL=""; _lineno=0
if [ -f "$_mem_file" ] && [ -r "$_mem_file" ]; then
    while IFS= read -r _line || [ -n "$_line" ]; do
        _lineno=$(( _lineno + 1 ))
        [ "$_lineno" = "1" ] && _line="${_line#$'\xef\xbb\xbf'}"
        _line="${_line%$'\r'}"
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
    # .verbosity-fence-warned: 60-min TTL, per-machine. See global hook for full lifecycle note.
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

# ── Normalization ─────────────────────────────────────────────────────────────
# Empty / whitespace-only verbosity.md: same recovery as global hook.
# LEVEL="" passes through normalization unchanged; Stage 3 sanity guard
# catches it via the wildcard branch and sets LEVEL="MIN". No extra guard needed.
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

# Output is injected into Claude's prompt context. Use only printable ASCII —
# no ANSI escapes, control sequences, or non-ASCII bytes. See global hook note.
case "$LEVEL" in
    MIN)     printf '\n[VERBOSITY:MIN] One sentence. [CHANGES] file list only. No prose.\n' ;;
    INFO)    printf '\n[VERBOSITY:INFO] Bullet list max 5. [CHANGES]+[REASON] tags.\n' ;;
    VERBOSE) printf '\n[VERBOSITY:VERBOSE] Full explanation. All tags active.\n' ;;
esac
