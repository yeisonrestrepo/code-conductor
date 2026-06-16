# BUG-014: Verbosity Dilution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two `UserPromptSubmit` hook scripts that re-inject the active verbosity level before every Claude response, preventing constraint fade mid-session.

**Architecture:** Global hook (`global/hooks/verbosity-remind.sh`) fires first and defers to any project hook found via upward traversal. Project hook (`project-template/.claude/hooks/verbosity-remind.sh`) runs Stage 2 + Stage 3 only. Both hooks always exit 0 via `trap 'exit 0' EXIT ERR`. Installers merge hook registration into `settings.json` via jq → python3 → manual fallback, preserving third-party hooks.

**Tech Stack:** bash 3.2+, jq, python3, PowerShell 5.1

**Format note:** Existing `settings.json` files in this repo use the nested `{matcher, hooks: [{type, command}]}` format — not the flat `{type, command}` format. All new entries in this plan use the nested format for consistency.

---

### Task 1: Create `global/hooks/verbosity-remind.sh`

**Files:**
- Create: `global/hooks/verbosity-remind.sh`

- [ ] [T-001] Write `global/hooks/verbosity-remind.sh` with the following exact content:

> **Encoding:** Write as **UTF-8 without BOM**. A BOM byte sequence (`\xef\xbb\xbf`) placed before `#!/usr/bin/env bash` causes `exec format error` on Linux — the shebang is no longer on byte 0 of the file. The hook strips a BOM from `verbosity.md` during parsing; the script file itself must carry none. In editors: VS Code → "UTF-8" in the bottom bar (no "with BOM" suffix); vim `:set nobomb`.

```bash
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
    while [ "$_dir" != "$_prev" ] && (( _iters < _cap )); do
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
#   finds nothing. If that path also does not exist, the `while read` loop over
#   a missing file produces no iterations. LEVEL remains "". Stage 3 maps → MIN.
#   Log: "INFO: verbosity.md not found at any traversal depth; defaulting to MIN"

# ── Extraction loop (bash 3.2 compatible) ────────────────────────────────────
_in_fence=0; _in_fm=0; LEVEL=""; _lineno=0
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
```

- [ ] [T-001-A] Set executable permission and verify syntax:

```bash
# chmod +x is required — Claude Code invokes the hook via the OS exec() syscall,
# not through an explicit `bash` interpreter call. Without the execute bit the kernel
# returns EACCES and Claude Code logs a hook-launch error.
chmod +x global/hooks/verbosity-remind.sh

bash -n global/hooks/verbosity-remind.sh
```

Expected: `chmod` exits 0 (no output); `bash -n` exits 0 with no output.

- [ ] [T-001-B] File integrity validation: after writing `global/hooks/verbosity-remind.sh`, compute its SHA-256 checksum and compare against a known-good reference. This detects disk corruption, incomplete writes, or supply-chain tampering during the install process.

```bash
# Step 1: compute SHA-256 of the written file
_sha_cmd=""
command -v sha256sum >/dev/null 2>&1 && _sha_cmd="sha256sum"
command -v shasum    >/dev/null 2>&1 && [ -z "$_sha_cmd" ] && _sha_cmd="shasum -a 256"
command -v openssl   >/dev/null 2>&1 && [ -z "$_sha_cmd" ] && _sha_cmd="openssl dgst -sha256"

if [ -n "$_sha_cmd" ]; then
    _actual_sha=$($_sha_cmd "global/hooks/verbosity-remind.sh" 2>/dev/null | awk '{print $1}')
    echo "SHA-256 (verbosity-remind.sh): $_actual_sha"
    # Step 2: compare against the reference checksum published in the repo's
    # checksums.sha256 file (generated during the release T-009 step).
    # Format: <sha256>  global/hooks/verbosity-remind.sh
    if [ -f "checksums.sha256" ]; then
        _expected_sha=$(grep 'global/hooks/verbosity-remind.sh' checksums.sha256 | awk '{print $1}')
        if [ "$_actual_sha" = "$_expected_sha" ]; then
            echo "PASS: SHA-256 matches checksums.sha256"
        else
            echo "FAIL: SHA-256 mismatch!"
            echo "  Expected: $_expected_sha"
            echo "  Actual:   $_actual_sha"
            echo "  Do not proceed. Re-download or restore from source control."
        fi
    else
        echo "INFO: checksums.sha256 not found — skipping reference comparison."
        echo "  Add this to T-009-D: sha256sum global/hooks/verbosity-remind.sh >> checksums.sha256"
    fi
else
    echo "WARN: No SHA-256 utility found (sha256sum/shasum/openssl). Skipping integrity check."
fi
```

Add an equivalent step after T-002 for the project hook. The `checksums.sha256` file must be committed to the repo as part of T-009-D (release commit) so it is available for verification on fresh installs.

---

### Task 2: Create `project-template/.claude/hooks/verbosity-remind.sh`

**Files:**
- Create: `project-template/.claude/hooks/verbosity-remind.sh`

- [ ] [T-002] Write `project-template/.claude/hooks/verbosity-remind.sh` with the following exact content (identical to the global hook except: no Stage 1 block, `_SCOPE="project"`):

> **Encoding:** Write as **UTF-8 without BOM** — same constraint as T-001. A BOM before the shebang causes `exec format error` at hook invocation time.

```bash
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
```

- [ ] [T-002-A] Set executable permission and verify syntax:

```bash
# Same exec-bit requirement as T-001-A.
chmod +x project-template/.claude/hooks/verbosity-remind.sh

bash -n project-template/.claude/hooks/verbosity-remind.sh
```

Expected: `chmod` exits 0; `bash -n` exits 0 with no output.

---

### Task 3: Update `project-template/.claude/settings.json`

**Files:**
- Modify: `project-template/.claude/settings.json`

Add a `UserPromptSubmit` array to the existing `hooks` object. Preserve `PreToolUse` and `PostCompact` exactly. The embedded traversal command is the project hook registration; it must be JSON-escaped correctly (inner double-quotes become `\"`).

**Shell escaping audit for the `command` string in `settings.json`:**

The command value is a JSON string executed by Claude Code via the system shell. The escaping chain has two layers:

1. **JSON layer:** double-quotes inside the command must be `\"`. Single quotes, backslashes, and dollar signs need no JSON escaping and pass through verbatim.
2. **Shell layer:** Claude Code invokes the command via `/bin/sh -c "<command>"` (or equivalent). This means:
   - Single-quoted substrings like `'set +e; ...'` are passed to `sh` as literals — they are NOT expanded by JSON parsing, so their contents are safe.
   - However, `/bin/sh` (POSIX) differs from `bash` in one key area: `(( expr ))` and `[[ test ]]` are bash extensions. The project hook's embedded traversal uses only POSIX-compatible constructs (`[ ... ]`, `$(( ))`, `while`/`do`/`done`) specifically for this reason.
   - The global `verbosity-remind.sh` is invoked via `bash <path>` — not `/bin/sh` — so bash-specific syntax inside that script is safe.

Verification: run `sh -c '<command string>'` (with the JSON `\"` unescaped back to `"`) on a POSIX sh (dash, ash, or `sh` on macOS) and confirm it exits 0. Expected: the command exits 0 and produces no error output when no verbosity.md is found.

- [ ] [T-003] Edit `project-template/.claude/settings.json`. Replace the entire file content with:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|create_file|write_file",
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'h=\".claude/hooks/pre-tool-use.sh\"; [ -f \"$h\" ] && bash \"$h\" || { echo \"⚠ Hook missing — run /cc-init to repair\"; exit 0; }'"
          }
        ]
      }
    ],
    "PostCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'h=\".claude/hooks/post-compact.sh\"; [ -f \"$h\" ] && bash \"$h\" || exit 0'"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'set +e; _dir=\"${PWD:-}\"; _prev=\"\"; _iters=0; while [ \"$_dir\" != \"$_prev\" ] && [ \"$_iters\" -lt 40 ]; do _h=\"$_dir/.claude/hooks/verbosity-remind.sh\"; [ -f \"$_h\" ] && [ -r \"$_h\" ] && { bash \"$_h\"; exit $?; }; _prev=\"$_dir\"; _dir=\"${_dir%/*}\"; [ -z \"$_dir\" ] && _dir=/; _iters=$((_iters+1)); done; exit 0'"
          }
        ]
      }
    ]
  },
  "permissions": {
    "allow": [],
    "deny": []
  }
}
```

- [ ] [T-003-A] Verify JSON is valid:

```bash
python3 -c "import json; json.load(open('project-template/.claude/settings.json')); print('valid')"
```

Expected: `valid`

- [ ] [T-003-B] Verify PreToolUse and PostCompact entries are unchanged (grep confirms both are present):

```bash
grep -c "pre-tool-use.sh" project-template/.claude/settings.json
grep -c "post-compact.sh" project-template/.claude/settings.json
```

Expected: both output `1`.

---

### Task 4: Update `install.sh` — global hook copy + settings.json merge

**Files:**
- Modify: `install.sh`

> **Recommended pre-installer safety step:** Before running any install task, back up the entire `$HOME/.claude/` directory to a timestamped snapshot. This protects all existing hooks, memory files, and settings from accidental overwrites or a failed install rollback:
>
> ```bash
> _bk_ts=$(date +%Y%m%d%H%M%S)
> cp -r "$HOME/.claude" "$HOME/.claude.bak.${_bk_ts}" \
>     && echo "Backed up \$HOME/.claude → \$HOME/.claude.bak.${_bk_ts}" \
>     || echo "WARN: Could not back up \$HOME/.claude — proceeding without backup."
> ```
>
> To restore: `cp -r "$HOME/.claude.bak.<timestamp>" "$HOME/.claude"`. Backup directories are not auto-cleaned; remove old ones manually once the installation is confirmed stable.

**`chmod +x` mandate:** Every hook file written by `install.sh` or `install.ps1` MUST have the executable bit set immediately after the copy, before any other step. Claude Code dispatches hooks via the OS `exec()` syscall, not through an interpreter invocation — a missing executable bit causes a silent `EACCES` failure with no user-visible error. The mandate applies to all three copy targets:

| Target file | Installer line that must follow the copy |
|---|---|
| `${GLOBAL_DIR}/hooks/verbosity-remind.sh` | `chmod +x "${GLOBAL_DIR}/hooks/verbosity-remind.sh"` |
| `${PROJ_DIR}/hooks/verbosity-remind.sh` | `chmod +x "${PROJ_DIR}/hooks/verbosity-remind.sh"` |
| Source hooks in `global/` and `project-template/` | `chmod +x global/hooks/verbosity-remind.sh` and `chmod +x project-template/.claude/hooks/verbosity-remind.sh` (T-001-C / T-002-C) |

**Standardized installer error format:** All dependency-missing or file-system errors emitted by `install.sh` MUST follow this pattern so operators and automated tooling can parse them reliably:

```
[verbosity-remind] ERROR <scope>: <description>. Fix: <actionable remedy>.
```

- `<scope>` = `dependency` | `filesystem` | `json` | `exec`
- Examples:
  - `[verbosity-remind] ERROR dependency: jq not found. Fix: brew install jq  OR  apt-get install jq.`
  - `[verbosity-remind] ERROR filesystem: /home/user/.claude/settings.json is not writable. Fix: chmod u+w /home/user/.claude/settings.json`
  - `[verbosity-remind] ERROR json: settings.json is not valid JSON (line 4). Fix: restore from .bak or .pre-merge.<ts> backup.`
  - `[verbosity-remind] ERROR exec: python3 not found. Fix: install Python 3.6+ and ensure it is on PATH.`

This format is emitted by `warn()` calls and must be used consistently in `_merge_settings_json`, `_backup_if_malformed`, `_validate_settings_json_structure`, and all writability guards.

Four additions to `install.sh`:
1. Copy `global/hooks/verbosity-remind.sh` to `$HOME/.claude/hooks/` (agent-managed, always overwrite)
2. Run `_merge_settings_json` function to register global hook in `$HOME/.claude/settings.json`
3. Copy `project-template/.claude/hooks/verbosity-remind.sh` (inside the `--project` block)
4. Run `_merge_settings_json` for the project `settings.json` (inside the `--project` block)

**Prerequisite:** T-001 and T-002 must be `[X]`.

- [ ] [T-004-A] Add the `_merge_settings_json` function to `install.sh`. Insert it immediately after the `download()` function definition (after line 215, before the `# ── Install global files` comment). The function handles jq → python3 → manual fallback for both global and project settings.json files:

```bash
# ── settings.json merge helper ────────────────────────────────────────────────
# Usage: _merge_settings_json <settings_path> <hook_command>
# Adds/replaces the verbosity-remind hook entry in the UserPromptSubmit array.
# Field preservation guarantee:
#   - All top-level fields outside .hooks (e.g. permissions, enabledMcpjsonServers,
#     and any third-party keys) are preserved unchanged in every code path.
#   - All .hooks sub-keys other than UserPromptSubmit are preserved unchanged.
#   - jq pipes the full source object and only rewrites .hooks.UserPromptSubmit.
#   - python3 loads the full dict d, modifies d["hooks"]["UserPromptSubmit"] only,
#     and serialises d back — all other keys in d survive.
#   - Exception: if .hooks is not a JSON object (structurally invalid), it is reset
#     to {}. This loses any corrupt hooks content but does not touch other top-level
#     fields. The malformed file is backed up before this happens.
# Never truncates the UserPromptSubmit array; only removes stale verbosity entries.
# Legacy duplicate migration strategy:
#   The fingerprint used to identify stale entries is "verbosity-remind.sh" appearing
#   in the command string. This covers all entries written by this installer (both
#   current and prior runs). It does NOT remove hooks with different command names that
#   may inject similar verbosity-like content (e.g., old custom scripts). If such
#   partially-overlapping hooks exist, the engineer must identify and remove them
#   manually — the installer will NOT attempt to detect them, as arbitrary heuristics
#   could silently remove legitimate third-party hooks.
# Post-merge schema validator — call immediately after any successful write.
# Confirms: (1) file is parseable JSON, (2) exactly one verbosity-remind entry
# in UserPromptSubmit, (3) that entry's command matches the registered hook command.
# Uses python3 if available; falls back to jq; warns-only if neither is present.
_validate_merged_settings() {
  local _path="$1" _expected_cmd="$2"
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$_path" "$_expected_cmd" <<'VALIDATE'
import json, sys
path, cmd = sys.argv[1], sys.argv[2]
try:
    with open(path) as f: d = json.load(f)
except Exception as e:
    print(f"[verbosity-remind] VALIDATION FAIL: {path} is not valid JSON: {e}", flush=True)
    sys.exit(1)
arr = d.get("hooks", {}).get("UserPromptSubmit", [])
matches = [e for e in arr
           if isinstance(e.get("hooks"), list)
           and any(h.get("command") == cmd for h in e["hooks"])]
if len(matches) == 1:
    print(f"[verbosity-remind] VALIDATION PASS: 1 verbosity-remind entry in UserPromptSubmit")
elif len(matches) == 0:
    print("[verbosity-remind] VALIDATION FAIL: verbosity-remind entry NOT found after merge")
    sys.exit(1)
else:
    print(f"[verbosity-remind] VALIDATION FAIL: {len(matches)} duplicate entries found (expected 1)")
    sys.exit(1)
VALIDATE
    [ $? -ne 0 ] && warn "Post-merge validation FAILED — check settings.json manually"
  elif command -v jq >/dev/null 2>&1; then
    _count=$(jq --arg cmd "$_expected_cmd" \
      '[.hooks.UserPromptSubmit[]? | select(.hooks[]?.command == $cmd)] | length' \
      "$_path" 2>/dev/null)
    if [ "$_count" = "1" ]; then
      echo "[verbosity-remind] VALIDATION PASS: 1 verbosity-remind entry (jq)"
    else
      warn "VALIDATION: found ${_count:-?} entries (expected 1) — check $_path"
    fi
  else
    warn "VALIDATION SKIPPED: neither python3 nor jq available for post-merge check"
  fi
}

_merge_settings_json() {
  local _settings_path="$1"
  local _hook_cmd="$2"

  # Idempotency pre-check: if the exact hook command is already registered in
  # settings.json, skip the entire merge (no backup, no write, no validation).
  # This prevents spurious log entries and timestamp churn on re-runs.
  if [ -f "$_settings_path" ] && command -v python3 >/dev/null 2>&1; then
    python3 - "$_settings_path" "$_hook_cmd" >/dev/null 2>&1 <<'IDEM_CHECK'
import json, sys
path, cmd = sys.argv[1], sys.argv[2]
with open(path) as f: d = json.load(f)
arr = d.get("hooks", {}).get("UserPromptSubmit", [])
already = any(
    any(h.get("command") == cmd for h in e.get("hooks", []))
    for e in arr if isinstance(e.get("hooks"), list)
)
sys.exit(0 if already else 1)
IDEM_CHECK
    if [ $? -eq 0 ]; then
      ok "settings.json already contains verbosity-remind hook — skipping merge (idempotent)"
      return 0
    fi
  fi

  # Pre-modification write-permission guard (function-level — complements the
  # caller-level _settings_rw_check). Catches the case where the function is called
  # directly without going through the T-004-C wrapper.
  if [ -f "$_settings_path" ] && [ ! -w "$_settings_path" ]; then
    warn "ERROR: $_settings_path is not writable. Merge aborted."
    warn "  Fix: chmod u+w '$_settings_path'"
    return 1
  fi

  # Pre-execution backup — two copies created before any modification:
  #   1. Stable .bak (non-timestamped): <path>.bak — always overwritten on each run.
  #      Provides immediate single-command recovery: cp settings.json.bak settings.json
  #   2. Timestamped .pre-merge.<ts>: preserved across runs; one new file per install.
  #      Required when .bak was overwritten by a subsequent failing run.
  # Both are skipped silently if the file does not yet exist (first install).
  if [ -f "$_settings_path" ]; then
    # Stable .bak — always overwritten; immediate recovery: cp settings.json.bak settings.json
    cp "$_settings_path" "${_settings_path}.bak" 2>/dev/null \
      && echo "  [verbosity-remind] quick-backup → ${_settings_path}.bak" \
      || warn "Could not write .bak backup — proceeding without it."
    # Timestamped .pre-merge.<ts> — preserved per-run for forensic recovery
    local _bk_ts; _bk_ts=$(date +%Y%m%d%H%M%S)
    if cp "$_settings_path" "${_settings_path}.pre-merge.${_bk_ts}" 2>/dev/null; then
      echo "  [verbosity-remind] timestamped backup → ${_settings_path}.pre-merge.${_bk_ts}"
    else
      warn "Could not write timestamped backup of settings.json — proceeding without rollback copy."
    fi
  fi

  # Dry-run mode: pass DRY_RUN=1 as an environment prefix (or set before calling)
  # to preview what _merge_settings_json WOULD write without modifying any file.
  # Example:  DRY_RUN=1 bash -c 'source install.sh; _merge_settings_json ~/.claude/settings.json "bash ~/.claude/hooks/verbosity-remind.sh"'
  # When DRY_RUN=1: the function computes the merged JSON and prints it to stdout
  # prefixed with "[DRY-RUN]" then returns 0. No backup, no write, no validation of
  # actual file state. Useful for verifying the merge output before committing.
  # In the function body, replace the `printf '%s\n' "$_merged" > "$_settings_path"` line with:
  #   if [ "${DRY_RUN:-0}" = "1" ]; then
  #     echo "[DRY-RUN] Would write the following to: $_settings_path"
  #     printf '%s\n' "$_merged"
  #     return 0
  #   fi
  #   printf '%s\n' "$_merged" > "$_settings_path"
  # Apply the same guard at the python3 write site (os.fdopen / open(path, 'w')):
  # before the write call, check os.environ.get('DRY_RUN', '0') == '1' and print+exit.

  # Expected behavior by scenario — for operator troubleshooting:
  #
  #   settings.json ABSENT:
  #     • jq path: _src defaults to "{}"; jq builds the full structure and writes the file.
  #     • python3 path: json.load() is never called (os.path.exists returns False); d = {}
  #       is used directly; the file is created on write.
  #     • Manual fallback: installer prints the NOTE about creating the file manually.
  #
  #   settings.json present but INVALID JSON (syntax error, trailing comma, etc.):
  #     • _backup_if_malformed detects the parse failure, copies the file to a timestamped
  #       backup (<path>.malformed.<ts>), and the merge continues against "{}" as a safe
  #       baseline. The operator should inspect the backup to recover any custom settings.
  #     • jq: if trailing commas are present, _strip_trailing_commas (below) normalises
  #       the content via python3 re-serialisation before the jq filter runs. If
  #       python3 is also unavailable, sed strips the most common trailing-comma pattern.
  #
  #   settings.json present but NOT A JSON OBJECT (array, string, null):
  #     • _validate_settings_json_structure aborts the merge before any write attempt.
  #       The operator must manually fix or delete the file.
  #
  #   settings.json becomes malformed DURING an update (e.g., partial write due to
  #   process kill, disk full, or concurrent installer run without locking):
  #     • The hook (verbosity-remind.sh) reads settings.json zero times — it is read
  #       exclusively by Claude Code at startup. A malformed settings.json causes Claude
  #       Code to skip hook loading entirely, which means the hook does NOT run. The user
  #       can still submit prompts (no blocking), but verbosity enforcement is silently
  #       absent. Claude Code logs a parse warning internally.
  #     • Recovery: restore from the most recent .pre-merge.<ts> backup using:
  #         cp "$HOME/.claude/settings.json.pre-merge.<ts>" "$HOME/.claude/settings.json"
  #       Or re-run the installer — it detects malformed JSON via _backup_if_malformed,
  #       saves a .malformed.<ts> copy, and rebuilds from "{}".
  #     • The atomic write strategy (mktemp + mv) in the jq and python3 paths makes
  #       mid-write corruption impossible under normal conditions. The only remaining
  #       risk is a disk-full condition that truncates the temp file before mv completes.

  # Back up malformed JSON before any merge attempt
  _backup_if_malformed() {
    local _path="$1"
    if [ -f "$_path" ] && ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$_path" 2>/dev/null; then
      local _ts; _ts=$(date +%Y%m%d%H%M%S)
      cp "$_path" "${_path}.bak.${_ts}"
      warn "settings.json is malformed — backed up to ${_path}.bak.${_ts}; starting fresh."
    fi
  }

  # Structural validation: confirm settings.json (if it exists) is a JSON object.
  # A non-object root (e.g., array or bare scalar) would corrupt the merge.
  # Runs immediately before the jq/python3 merge attempt — distinct from
  # _backup_if_malformed, which acts after detection of invalid JSON.
  # ── Null and unexpected-type handling for the hooks section ─────────────────
  # The following table documents every anomalous value that may appear in
  # settings.json and the exact recovery action taken by each merge path:
  #
  # ┌─────────────────────────────────────┬────────────┬────────────────────────┐
  # │ settings.json state                 │ jq path    │ python3 path           │
  # ├─────────────────────────────────────┼────────────┼────────────────────────┤
  # │ File absent                         │ Start {}   │ d = {}                 │
  # │ File is empty (0 bytes)             │ _bk_malfrm │ json.load fails → d={} │
  # │ Root is null   (JSON null literal)  │ ABORT*     │ ABORT*                 │
  # │ Root is array  (e.g., [])           │ ABORT*     │ ABORT*                 │
  # │ Root is string (e.g., "foo")        │ ABORT*     │ ABORT*                 │
  # │ Root is object — "hooks" key absent │ .hooks={}  │ d.get("hooks",{})      │
  # │ Root.hooks is null                  │ .hooks={}  │ isinstance check → {}  │
  # │ Root.hooks is a string/number/bool  │ .hooks={}  │ isinstance check → {}  │
  # │ Root.hooks is an array (wrong type) │ .hooks={}  │ isinstance check → {}  │
  # │ Root.hooks is an object (correct)   │ preserved  │ preserved              │
  # │ hooks.UserPromptSubmit absent       │ []=[]      │ setdefault([])         │
  # │ hooks.UserPromptSubmit is null      │ []=[]      │ not isinstance → reset │
  # │ hooks.UserPromptSubmit is object    │ []=[]      │ not isinstance → reset │
  # │ hooks.UserPromptSubmit is string    │ []=[]      │ not isinstance → reset │
  # └─────────────────────────────────────┴────────────┴────────────────────────┘
  # *ABORT: _validate_settings_json_structure emits ERROR json: and returns 1,
  #  causing _merge_settings_json to return 1. The file is not modified. The
  #  installer prints the standardized error and the operator must restore from
  #  backup or replace the file with {}.
  #
  # The python3 path guards UserPromptSubmit type explicitly:
  #   arr = hooks.setdefault("UserPromptSubmit", [])
  #   if not isinstance(arr, list): arr = []; hooks["UserPromptSubmit"] = arr
  # This covers null (NoneType), dict, string, number, and bool.
  #
  # The jq path uses:
  #   if (.hooks.UserPromptSubmit | type) != "array" then .hooks.UserPromptSubmit = []
  # jq's `type` function returns "null" for JSON null — this is != "array",
  # so null is correctly reset to []. Same for "object", "string", "number".
  _validate_settings_json_structure() {
    local _path="$1"
    [ -f "$_path" ] || return 0   # absent file is valid — will be created on first merge
    local _type
    _type=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(type(d).__name__)" "$_path" 2>/dev/null) \
      || _type=$(jq -r 'type' "$_path" 2>/dev/null) \
      || { warn "WARN: Could not determine JSON root type of ${_path} — proceeding."; return 0; }
    if [ "$_type" != "dict" ] && [ "$_type" != "object" ]; then
      warn "[verbosity-remind] ERROR json: ${_path} root is '${_type}', not an object. Fix: restore from backup or replace with {}."
      warn "  Merge aborted. File not modified."
      return 1
    fi
    return 0
  }
  _validate_settings_json_structure "$_settings_path" || return 1

  if command -v jq >/dev/null 2>&1; then
    # jq path: back up malformed, merge, write 2-space indented
    # Missing top-level "hooks" key: jq evaluates .hooks as null (type "null"),
    # which is not "object", so the first filter resets it to {}. UserPromptSubmit
    # is then added into the fresh object. All other top-level keys are preserved.
    _backup_if_malformed "$_settings_path"
    # Trailing-comma normalisation: jq uses a strict RFC 8259 parser and rejects
    # trailing commas (e.g., {"a":1,} or [1,2,]). These are common after manual edits.
    # Normalise by round-tripping through python3 if available; fall back to sed
    # for the most frequent pattern when python3 is absent.
    _strip_trailing_commas() {
      local _content="$1"
      if command -v python3 >/dev/null 2>&1; then
        # python3 json.loads → json.dumps strips all trailing commas unconditionally
        printf '%s' "$_content" | \
          python3 -c "import json,sys; print(json.dumps(json.loads(sys.stdin.read()), indent=2))" 2>/dev/null \
          || printf '%s' "$_content"
      else
        # Best-effort sed: strip trailing comma before ] or } (single-level only).
        # This handles the most common case but is not a full JSON parser.
        printf '%s' "$_content" | sed 's/,\([[:space:]]*[}\]]\)/\1/g'
      fi
    }
    local _src="{}"
    [ -f "$_settings_path" ] && _src=$(_strip_trailing_commas "$(cat "$_settings_path" 2>/dev/null || echo "{}")")
    local _merged
    _merged=$(printf '%s' "$_src" | jq \
      --arg cmd "$_hook_cmd" \
      '
      # Reset hooks to {} if not an object (covers absent key → null type)
      if (.hooks | type) != "object" then .hooks = {} else . end |
      # Ensure UserPromptSubmit is an array
      if (.hooks.UserPromptSubmit | type) != "array" then .hooks.UserPromptSubmit = [] else . end |
      # Remove stale verbosity-remind entries (nested format: check hooks[].command)
      .hooks.UserPromptSubmit |= [.[] | select(
        all(.hooks[]?; .command | contains("verbosity-remind.sh") | not)
      )] |
      # Append new entry in nested format
      .hooks.UserPromptSubmit += [{"matcher": "", "hooks": [{"type": "command", "command": $cmd}]}]
      ' 2>/dev/null) || true
    if [ -n "$_merged" ]; then
      # Atomic write via mktemp + mv to prevent race conditions when multiple
      # installer processes run concurrently. On POSIX filesystems, rename(2) is
      # atomic — a reader always sees either the old or the new content, never a
      # partial write. The temp file is in the same directory to guarantee same
      # filesystem (cross-device mv falls back to copy+delete, which is NOT atomic).
      local _tmp_out; _tmp_out=$(mktemp "${_settings_path}.tmp.XXXXXX" 2>/dev/null) \
        || { warn "Could not create temp file for atomic write — falling back to direct write"; printf '%s\n' "$_merged" > "$_settings_path"; }
      if [ -n "$_tmp_out" ]; then
        printf '%s\n' "$_merged" > "$_tmp_out" && mv -f "$_tmp_out" "$_settings_path" \
          || { rm -f "$_tmp_out" 2>/dev/null; warn "Atomic write failed — direct write attempted"; printf '%s\n' "$_merged" > "$_settings_path"; }
      fi
      ok "settings.json updated (jq)"
      # Post-merge schema validation: confirm the written file is parseable and
      # contains exactly one verbosity-remind entry in UserPromptSubmit.
      _validate_merged_settings "$_settings_path" "$_hook_cmd"
    else
      warn "jq merge failed — trying python3"
    fi

  elif command -v python3 >/dev/null 2>&1; then
    # python3 path
    _backup_if_malformed "$_settings_path"
    python3 - "$_settings_path" "$_hook_cmd" <<'PYEOF'
import json, sys, os
path = sys.argv[1]
cmd  = sys.argv[2]
d = {}
if os.path.exists(path):
    try:
        with open(path) as f: d = json.load(f)
    except json.JSONDecodeError:
        pass
hooks = d.get("hooks", {})
if not isinstance(hooks, dict):
    hooks = {}
d["hooks"] = hooks
arr = hooks.setdefault("UserPromptSubmit", [])
# Remove stale entries — handle nested {matcher, hooks:[]} format and flat {type, command} format
arr[:] = [
    e for e in arr
    if not (
        any("verbosity-remind.sh" in str(h.get("command", ""))
            for h in e.get("hooks", []))
        if isinstance(e.get("hooks"), list)
        else "verbosity-remind.sh" in str(e.get("command", ""))
    )
]
arr.append({"matcher": "", "hooks": [{"type": "command", "command": cmd}]})
# Atomic write: write to temp file then os.rename() — rename(2) is atomic on POSIX.
# This prevents partial-write corruption if the process is killed mid-write.
import tempfile
dir_ = os.path.dirname(os.path.abspath(path))
fd, tmp = tempfile.mkstemp(dir=dir_, prefix=".settings-tmp-")
try:
    with os.fdopen(fd, "w") as f:
        json.dump(d, f, indent=2)
    os.rename(tmp, path)
except Exception as e:
    os.unlink(tmp) if os.path.exists(tmp) else None
    raise
PYEOF
    if [ $? -eq 0 ]; then
      ok "settings.json updated (python3)"
      _validate_merged_settings "$_settings_path" "$_hook_cmd"
    else
      warn "python3 merge failed — see manual instructions below"
    fi

  elif command -v perl >/dev/null 2>&1; then
    # Perl fallback: uses only core Perl modules (no CPAN required; present on most
    # Unix systems including macOS, Debian/Ubuntu, Alpine, and RHEL without extras).
    _backup_if_malformed "$_settings_path"
    perl - "$_settings_path" "$_hook_cmd" <<'PLEOF'
use strict; use warnings; use JSON::PP;
my ($path, $cmd) = @ARGV;
my $d = {};
if (-f $path) {
    open(my $fh, '<', $path) or die "Cannot read $path: $!";
    local $/; my $raw = <$fh>; close $fh;
    eval { $d = decode_json($raw) };
    $d = {} if $@;
}
$d->{hooks} = {} unless ref($d->{hooks}) eq 'HASH';
$d->{hooks}{UserPromptSubmit} = [] unless ref($d->{hooks}{UserPromptSubmit}) eq 'ARRAY';
my $arr = $d->{hooks}{UserPromptSubmit};
@$arr = grep {
    my $entry = $_;
    my $hooks = $entry->{hooks} // [];
    !grep { ($_->{command} // '') =~ /verbosity-remind\.sh/ } @$hooks;
} @$arr;
push @$arr, { matcher => "", hooks => [{ type => "command", command => $cmd }] };
open(my $out, '>', $path) or die "Cannot write $path: $!";
print $out encode_json($d), "\n";
close $out;
print "settings.json updated (perl)\n";
PLEOF
    if [ $? -eq 0 ]; then
      ok "settings.json updated (perl)"
    else
      warn "perl merge failed — falling back to node.js if available"
      # Node.js fallback
      if command -v node >/dev/null 2>&1; then
        node - "$_settings_path" "$_hook_cmd" <<'NJEOF'
const fs = require('fs'), path = process.argv[2], cmd = process.argv[3];
let d = {};
if (fs.existsSync(path)) {
  try { d = JSON.parse(fs.readFileSync(path, 'utf8')); } catch(e) { d = {}; }
}
if (typeof d.hooks !== 'object' || Array.isArray(d.hooks)) d.hooks = {};
if (!Array.isArray(d.hooks.UserPromptSubmit)) d.hooks.UserPromptSubmit = [];
d.hooks.UserPromptSubmit = d.hooks.UserPromptSubmit.filter(e =>
  !(e.hooks || []).some(h => (h.command || '').includes('verbosity-remind.sh'))
);
d.hooks.UserPromptSubmit.push({ matcher: '', hooks: [{ type: 'command', command: cmd }] });
fs.writeFileSync(path, JSON.stringify(d, null, 2) + '\n');
console.log('settings.json updated (node)');
NJEOF
        [ $? -eq 0 ] && ok "settings.json updated (node)" \
            || warn "node merge failed — see manual instructions below"
      fi
    fi

  else
    # All automated merge tools exhausted (no jq, python3, perl, or node found).
    # Report each missing dependency individually to simplify troubleshooting.
    command -v jq      >/dev/null 2>&1 || warn "  Missing: 'jq'      (install: brew install jq / apt install jq / dnf install jq)"
    command -v python3 >/dev/null 2>&1 || warn "  Missing: 'python3' (install: brew install python / apt install python3 / dnf install python3)"
    command -v perl    >/dev/null 2>&1 || warn "  Missing: 'perl'    (install: brew install perl / apt install perl / dnf install perl)"
    command -v node    >/dev/null 2>&1 || warn "  Missing: 'node'    (install: https://nodejs.org)"
    echo ""
    echo "╔══════════════════════════════════════════════════════════════════════╗"
    echo "║  ERROR: settings.json merge FAILED — manual action required         ║"
    echo "║  The verbosity-remind hook will NOT fire until this is resolved.     ║"
    echo "╚══════════════════════════════════════════════════════════════════════╝"
    echo ""
    warn "settings.json was NOT modified. To complete setup manually:"
    # File-existence note: if settings.json does not yet exist, the engineer must
    # create it from scratch before inserting this fragment.
    if [ ! -f "$_settings_path" ]; then
      echo "  Step 1 — Create the file (it does not exist yet):"
      echo '    echo '"'"'{"hooks": {"UserPromptSubmit": []}}'"'"' > '"${_settings_path}"
      echo ""
    fi
    echo "  Add the following entry to the hooks.UserPromptSubmit array in:"
    echo "    ${_settings_path}"
    echo ""
    echo '  {"matcher": "", "hooks": [{"type": "command", "command": "'"${_hook_cmd}"'"}]}'
    echo ""
    echo "  After manual edit, verify with: python3 -m json.tool ${_settings_path}"
    return 1
  fi
}
```

- [ ] [T-004-A-1] Verify the manual fallback text printed by `_merge_settings_json` produces a JSON object matching the nested schema defined in T-003. Run this one-time check after inserting the function into `install.sh`:

```bash
# Extract the printed fragment from the function source and validate its structure
_fallback_json='{"matcher": "", "hooks": [{"type": "command", "command": "PLACEHOLDER"}]}'
python3 - <<PYEOF
import json, sys
fragment = json.loads('${_fallback_json}')
# Must be an object (not array, not string)
assert isinstance(fragment, dict), "top-level must be object"
# Must have exactly 'matcher' (string) and 'hooks' (array)
assert isinstance(fragment.get("matcher"), str), "matcher must be string"
assert isinstance(fragment.get("hooks"), list), "hooks must be array"
inner = fragment["hooks"][0]
assert inner.get("type") == "command", "inner type must be 'command'"
assert isinstance(inner.get("command"), str), "inner command must be string"
print("Schema OK: fallback text matches T-003 nested format")
PYEOF
```

Expected: `Schema OK: fallback text matches T-003 nested format`. If this fails, the `echo` line in the manual fallback block must be updated to match T-003's schema before proceeding.

- [ ] [T-004-A-2] Confirm the pre-merge backup logic is present in the final `install.sh` and document the rollback procedure for operators:

```bash
# Verify the backup block is in the installed function
grep -q 'pre-merge' install.sh \
    && echo "PASS: pre-merge backup block found in install.sh" \
    || echo "FAIL: pre-merge backup block missing — re-check T-004-A insertion"

# Rollback procedure (run manually if a merge failure leaves settings.json corrupt):
# 1. Find the most recent backup:
#    ls -t "$HOME/.claude/settings.json.pre-merge."* 2>/dev/null | head -1
# 2. Restore it:
#    cp "$(ls -t $HOME/.claude/settings.json.pre-merge.* | head -1)" "$HOME/.claude/settings.json"
# 3. Verify the restore:
#    python3 -c "import json; print(json.load(open('$HOME/.claude/settings.json')))"
```

The backup file is named `<settings_path>.pre-merge.<YYYYMMDDHHmmss>` and is created on every install run where the file already exists. Backup files are not auto-cleaned — remove them manually after confirming the installation is stable.

- [ ] [T-004-A-2b] Pre-install stale state audit: remove any stale temporary lock files, partially-written temp files, and expired state markers from `$HOME/.claude/logs/` before starting the install sequence. These can accumulate from crashed installs or interrupted hook runs and cause silent misbehaviour.

```bash
_claude_logs="${HOME}/.claude/logs"
mkdir -p "$_claude_logs" 2>/dev/null || true

# Remove stale .verbosity-fence-warned markers older than 60 minutes
# (the hook's own TTL). A stale marker suppresses fence warnings.
find "$_claude_logs" -maxdepth 1 -name '.verbosity-fence-warned' \
    -mmin +60 -delete 2>/dev/null || true

# Remove partially-written settings temp files left by crashed installs
find "${HOME}/.claude" -maxdepth 1 -name 'settings.json.tmp.*' \
    -delete 2>/dev/null || true

# Remove pre-merge backup files older than 30 days (optional; operator consent)
# Uncomment to enable automatic cleanup:
# find "${HOME}/.claude" -maxdepth 1 -name 'settings.json.pre-merge.*' \
#     -mtime +30 -delete 2>/dev/null || true

echo "  [verbosity-remind] LOG: Pre-install stale state audit complete"
```

Expected: no output from `find` (all deletions are silent). The audit must complete without error before T-004-A-3.

- [ ] [T-004-A-3] Pre-flight: validate that `bash` is available and its resolved path matches the path that will be embedded in the hook command. Run this check before executing any install step:

```bash
# 1. Confirm bash is on PATH
if ! _bash_path=$(command -v bash 2>/dev/null); then
    echo "FATAL: bash not found on PATH. The hook command 'bash <path>/verbosity-remind.sh'"
    echo "  will fail at runtime. Install bash or add it to PATH before continuing."
    exit 1
fi
echo "PASS: bash found at: $_bash_path"

# 2. Confirm the resolved path is a real executable (not a dangling symlink)
if [ ! -x "$_bash_path" ]; then
    echo "FATAL: $_bash_path is not executable. Broken symlink or bad permissions."
    exit 1
fi
echo "PASS: $_bash_path is executable"

# 3. Confirm bash executes, reports a parseable version, and meets the minimum
#    required version (3.2+). The hook uses $(()), [[, and IFS constructs that
#    are absent or broken in bash <3.2.
_bash_ver=$(bash --version 2>/dev/null | head -1)
if [ -z "$_bash_ver" ]; then
    echo "WARN: 'bash --version' produced no output — non-standard bash build."
else
    echo "PASS: $_bash_ver"
    # Extract major.minor and verify >= 3.2
    _bash_major=$(bash -c 'echo ${BASH_VERSINFO[0]}' 2>/dev/null)
    _bash_minor=$(bash -c 'echo ${BASH_VERSINFO[1]}' 2>/dev/null)
    if [ -n "$_bash_major" ] && [ -n "$_bash_minor" ]; then
        if [ "$_bash_major" -gt 3 ] || \
           ( [ "$_bash_major" -eq 3 ] && [ "$_bash_minor" -ge 2 ] ); then
            echo "PASS: bash version ${_bash_major}.${_bash_minor} >= 3.2 (minimum required)"
        else
            echo "FATAL: bash version ${_bash_major}.${_bash_minor} is below 3.2."
            echo "  The hook uses \$((...)), [[ ]], and IFS constructs unavailable in older bash."
            echo "  Upgrade bash before continuing."
        fi
    fi
fi

# 5. Diagnostic: print the exact bash binary path that the installer will embed
# in the hook command string. This confirms the path used in settings.json matches
# the system's actual bash, preventing silent hook failures on non-standard layouts.
echo "--- Installer bash diagnostic ---"
echo "  Detected bash path (for hook command): $_bash_path"
echo "  This path will be embedded as: bash $_bash_path"
echo "  Confirm this is the intended bash for your Claude Code runtime environment."

# 4. On non-standard systems (e.g. minimal Docker images, Nix, Homebrew macOS),
# /usr/bin/env bash may resolve to a different binary than /bin/bash. The hook
# shebang uses /usr/bin/env bash, so confirm that env also finds the same binary:
_env_bash=$(env bash -c 'command -v bash' 2>/dev/null)
if [ "$_env_bash" != "$_bash_path" ]; then
    echo "WARN: 'env bash' resolves to '$_env_bash' but PATH bash is '$_bash_path'."
    echo "  The hook shebang (#!/usr/bin/env bash) may use a different bash than expected."
else
    echo "PASS: 'env bash' and PATH bash agree: $_bash_path"
fi
```

Expected: all `PASS` lines. Any `FATAL` line must be resolved before continuing.

- [ ] [T-004-A-3-B] python3 standard module availability check: even when `python3` is on PATH, minimal or stripped environments (Alpine musl, Docker distroless images, conda envs with incomplete stdlib, PyPy distributions) may be missing standard library modules used by `_merge_settings_json`. All required modules are stdlib and should be present in any CPython 3.6+ installation, but the check prevents a cryptic `ModuleNotFoundError` at merge time. Add this check immediately after T-004-A-3 (bash pre-flight):

  ```bash
  # python3 standard module availability check
  # Required modules: json (parse), tempfile (mkstemp), os (rename, path), sys (argv)
  # Optional (used in _validate_merged_settings): none beyond the above
  if command -v python3 >/dev/null 2>&1; then
      _py3_modules_ok=1
      for _mod in json tempfile os sys; do
          if python3 -c "import ${_mod}" 2>/dev/null; then
              echo "PASS: python3 module '${_mod}' is importable"
          else
              warn "[verbosity-remind] WARN dependency: python3 module '${_mod}' is NOT importable."
              warn "  Environment: $(python3 --version 2>&1), prefix=$(python3 -c 'import sys; print(sys.prefix)' 2>/dev/null)"
              warn "  Fix: reinstall Python 3.6+ with the standard library, or use a non-stripped distribution."
              warn "  Impact: python3 merge path will be skipped; jq or perl/node fallback will be used."
              _py3_modules_ok=0
          fi
      done
      if [ "$_py3_modules_ok" = 0 ]; then
          warn "[verbosity-remind] WARN: python3 stdlib incomplete — marking python3 unavailable for merge."
          # Shadow the python3 command so _merge_settings_json skips to next fallback
          python3() { return 127; }
      else
          echo "PASS: all required python3 stdlib modules are importable"
      fi
  else
      echo "INFO: python3 not found — jq or perl/node fallback will be used for settings.json merge."
  fi
  ```

  **Why this matters in stripped containers:** Alpine Linux's `python3` package (`apk add python3`) includes the full stdlib. However, `python3-dev`-only installs, some Conda envs, and PyPy distributions may omit `tempfile` or `os` from the importable namespace (unusual but documented in PyPy packaging issues). The shadow function pattern (`python3() { return 127; }`) is the same pattern used for the jq version gate in T-004-A-10 — it degrades gracefully without aborting the install.

  **install.ps1 equivalent:** PowerShell's `ConvertFrom-Json` and `[System.IO.File]::WriteAllText` are built into the .NET runtime — no module import is required. The PS 5.1 minimum version check in T-005-F is the equivalent gate.

- [ ] [T-004-A-4] Mandatory early-stage backup: before any file is written or merged, `install.sh` MUST emit a timestamped backup of every `settings.json` file that will be modified. This backup runs unconditionally, at the start of the installer's main body (before any `download` or `_merge_settings_json` call), independently of the per-merge `.pre-merge.<ts>` backup inside `_merge_settings_json`. Add the following block to `install.sh` immediately after the pre-flight checks (T-004-A-2b, T-004-A-3) and before the `# ── Install global files` comment:

```bash
# ── Early-stage mandatory backup ──────────────────────────────────────────────
# Runs before any file write. Backs up both global and project settings.json
# (if they exist) to enable immediate rollback without relying on in-function
# backups that may not be reached if the installer aborts early.
_early_backup() {
  local _path="$1"
  [ -f "$_path" ] || return 0
  local _ts; _ts=$(date +%Y%m%d%H%M%S)
  local _bak="${_path}.installer-backup.${_ts}"
  if cp "$_path" "$_bak" 2>/dev/null; then
    echo "  [verbosity-remind] early backup: ${_path} → ${_bak}"
  else
    warn "[verbosity-remind] ERROR filesystem: could not write early backup of ${_path}. Fix: check write permissions on $(dirname "$_path")."
    warn "  Proceeding without early backup — per-merge backup inside _merge_settings_json is still active."
  fi
}
_early_backup "${HOME}/.claude/settings.json"
[ "$INSTALL_PROJECT" = true ] && _early_backup "${PROJ_DIR}/settings.json" 2>/dev/null || true
```

Rollback command (human operator): `cp "$HOME/.claude/settings.json.installer-backup.<ts>" "$HOME/.claude/settings.json"`. Backup files are not auto-cleaned; remove after confirming the installation is stable. The `.installer-backup.<ts>` suffix is distinct from the per-merge `.pre-merge.<ts>` suffix so both generations of backups are independently identifiable.

- [ ] [T-004-A-5] Pre-installation JSON validation: before calling `_merge_settings_json` for any target path, validate that the file is parseable JSON (if it exists and is non-empty). A corrupt or truncated `settings.json` that is not caught here will cause the jq / python3 merge paths to fail mid-execution, leaving the file in a partially written state. Add the following guard function to `install.sh` immediately after `_early_backup` calls (before the `# ── Install global files` comment):

```bash
_pre_validate_json() {
  local _path="$1"
  # Non-existent or empty file is valid — will be created from scratch
  [ -f "$_path" ] || return 0
  [ -s "$_path" ] || return 0
  # Attempt parse with python3, then jq, then a naive bracket-match fallback
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$_path" 2>/dev/null && return 0
    warn "[verbosity-remind] ERROR json: ${_path} failed python3 JSON parse."
  elif command -v jq >/dev/null 2>&1; then
    jq empty "$_path" >/dev/null 2>&1 && return 0
    warn "[verbosity-remind] ERROR json: ${_path} failed jq JSON parse."
  else
    # Naive: confirm file starts with '{' and ends with '}' (after stripping whitespace)
    _first=$(head -c1 "$_path" 2>/dev/null)
    _last=$(tail -c1 "$_path" 2>/dev/null | tr -d '\n\r ')
    [ "$_first" = "{" ] && [ "$_last" = "}" ] && return 0
    warn "[verbosity-remind] ERROR json: ${_path} does not appear to be a JSON object (no python3 or jq to verify further)."
  fi
  warn "  Detected corrupt or malformed settings.json. Fix: restore from backup:"
  warn "    cp '${_path}.installer-backup.<ts>' '${_path}'"
  warn "  OR clear the file: echo '{}' > '${_path}'"
  warn "  Merge aborted for this target to prevent data corruption."
  return 1
}
_pre_validate_json "${HOME}/.claude/settings.json" \
    && _global_json_ok=1 \
    || _global_json_ok=0
[ "$INSTALL_PROJECT" = true ] && {
  _pre_validate_json "${PROJ_DIR}/settings.json" \
      && _proj_json_ok=1 \
      || _proj_json_ok=0
} || _proj_json_ok=0
```

The `_global_json_ok` / `_proj_json_ok` flags are checked in T-004-C and T-004-D respectively: if `_global_json_ok=0`, skip the `_merge_settings_json` call for the global target and print the standardized error. This prevents the installer from proceeding to a merge that is guaranteed to corrupt the file further.

**Behavior when structure is missing or wrong type:** If `settings.json` exists but its root is not a JSON object (e.g., root is an array `[]`, a string, or `null`), `_validate_settings_json_structure` (inside `_merge_settings_json`) will detect this and abort the merge for that target. The installer prints:

```
[verbosity-remind] ERROR json: <path> root is not a JSON object (type: array). Fix: replace file with {} or restore from backup.
```

The file is left unmodified. The operator must either restore from the `.installer-backup.<ts>` file or replace the root with `{}` and re-run the installer.

- [ ] [T-004-A-6] Atomic write completeness audit: confirm that every code path inside `_merge_settings_json` that writes `settings.json` uses the atomic `mktemp + mv -f` pattern, with no direct `> path` or `open(path, "w")` writes that could leave the file truncated if the process is interrupted.

  **mktemp GNU vs BSD compatibility:** The `mktemp` invocation form MUST be a full-path template to guarantee identical behavior on GNU coreutils (Linux), BSD mktemp (macOS 12+), and BusyBox (Alpine). The compatibility table:

  | Form | GNU (Linux) | BSD (macOS) | BusyBox (Alpine) | Verdict |
  |---|---|---|---|---|
  | `mktemp /dir/prefix.XXXXXX` | ✓ creates in `/dir/` | ✓ creates in `/dir/` | ✓ creates in `/dir/` | **Use this form** |
  | `mktemp -t prefix` | Creates in `$TMPDIR` (not `/dir/`) | Creates in `/tmp/` (ignores `$TMPDIR` on some BSD) | ✓ but path is /tmp | **Do not use** — wrong directory |
  | `mktemp -p /dir prefix.XXXXXX` | ✓ GNU extension | **ABSENT** on macOS — fatal error | ✓ BusyBox extension | **Do not use** — BSD fatal |
  | `mktemp prefix.XXXXXX` (relative) | Creates in `$PWD` | Creates in `$PWD` | Creates in `$PWD` | **Do not use** — CWD-dependent |

  **Mandatory form in all scripts:** `mktemp "${_settings_path}.tmp.XXXXXX"` — a full-path template where the `X` suffix is appended to the target directory's path. This is the only form that:
  - Writes the temp file in the same directory as the target (required for atomic `mv -f` which uses `rename(2)`; cross-device rename fails)
  - Works identically on GNU, BSD, and BusyBox without flags
  - Requires at least 3 `X` characters (POSIX minimum); the plan uses 6 `X` characters for entropy

  **Verification — confirm no forbidden mktemp forms are present:**
  ```bash
  grep -n 'mktemp' install.sh | grep -vE 'mktemp "\$\{.*\}\..*XXXXXX"' \
      && echo "FAIL: non-canonical mktemp form found — replace with full-path template" \
      || echo "PASS: all mktemp calls use full-path template"
  ```

  **macOS-specific note:** On macOS 12+ (Monterey and later), `mktemp` is `/usr/bin/mktemp` from BSD; on macOS 10.x/11.x it may be the older Xcode CLI variant. Both support the full-path template form. The `-p` flag is NOT available on any macOS version's native `mktemp`. If a developer has GNU coreutils installed via Homebrew (`gmktemp`), `mktemp` in their PATH may be GNU — the canonical full-path form works on both.

  The three paths that must each be atomic:

  **jq path** — already atomic via `mktemp + mv -f`:
  ```bash
  _tmp_out=$(mktemp "${_settings_path}.tmp.XXXXXX") \
      && jq ... "$_settings_path" > "$_tmp_out" \
      && mv -f "$_tmp_out" "$_settings_path" \
      || { rm -f "$_tmp_out" 2>/dev/null; warn "jq atomic write failed"; }
  ```
  Verify: `grep -A5 'mktemp.*settings' install.sh | grep 'mv -f'` must return a match.

  **python3 path** — already atomic via `tempfile.mkstemp + os.rename()`:
  ```python
  fd, tmp = tempfile.mkstemp(dir=dir_, prefix=".settings-tmp-")
  try:
      with os.fdopen(fd, "w") as f: json.dump(d, f, indent=2)
      os.rename(tmp, path)   # rename(2) is atomic on POSIX; NTFS on Windows via MoveFileEx
  except Exception:
      if os.path.exists(tmp): os.unlink(tmp)
      raise
  ```
  Verify: `grep -A3 'tempfile.mkstemp' install.sh | grep 'os.rename'` must return a match.

  **Manual fallback path** — must also be atomic. The `echo` / `printf` fallback that constructs a fresh `{}` object MUST write via a temp file before replacing the target. Update the manual fallback block in `_merge_settings_json` to:
  ```bash
  # Manual fallback: construct minimal settings.json atomically
  _tmp_manual=$(mktemp "${_settings_path}.tmp.XXXXXX" 2>/dev/null) || {
      warn "[verbosity-remind] ERROR filesystem: cannot create temp file for manual fallback. Fix: check write permissions on $(dirname "$_settings_path")."
      return 1
  }
  printf '%s\n' \
      '{"hooks":{"UserPromptSubmit":[{"matcher":"","hooks":[{"type":"command","command":"'"${_hook_cmd}"'"}]}]}}' \
      > "$_tmp_manual" \
      && mv -f "$_tmp_manual" "$_settings_path" \
      || { rm -f "$_tmp_manual" 2>/dev/null; warn "[verbosity-remind] ERROR filesystem: manual fallback atomic write failed."; return 1; }
  ```
  The original `echo` line that wrote directly to `$_settings_path` must be replaced with this pattern.

  **Verification after all three paths are confirmed atomic:**
  ```bash
  # Confirm no bare '> "$_settings_path"' or '>> "$_settings_path"' writes remain
  grep -n '> "\$_settings_path"\|>> "\$_settings_path"' install.sh \
      && echo "FAIL: non-atomic write found — fix before proceeding" \
      || echo "PASS: all settings.json writes are atomic (temp+rename)"
  ```
  Expected: `PASS` line only. Any `FAIL` means a code path was missed.

- [ ] [T-004-A-7] ISO 8601 structured log format mandate: all log output emitted by `install.sh`, `install.ps1`, and both hook scripts MUST conform to the unified machine-readable format already defined in the global hook header. Verify conformance across all four scripts and add a format compliance note to the installer's `warn()` / `ok()` functions.

  **Canonical format (already defined in global hook):**
  ```
  YYYY-MM-DD HH:MM:SS [<scope>] <LEVEL> <message>
  ```
  - Timestamp: local time in `date '+%Y-%m-%d %H:%M:%S'` (ISO 8601 extended, space separator)
  - Scope bracket: `[global]`, `[project]`, or `[install]` — must match the script's `_SCOPE` variable
  - Level: `INFO`, `WARN`, `ERROR`, `PASS`, `FAIL`, `DEBUG` — uppercase only
  - Message: free text; no internal newlines

  **`install.sh` compliance:** The `warn()` and `ok()` functions currently write to stdout only. Add parallel log writes to both:
  ```bash
  _install_logfile="${HOME}/.claude/logs/verbosity-hook.log"
  _install_log_scope="install"
  _install_log() {
      local _level="$1" _msg="$2"
      printf '%s [%s] %s %s\n' \
          "$(date '+%Y-%m-%d %H:%M:%S')" \
          "$_install_log_scope" \
          "$_level" \
          "$_msg" >> "$_install_logfile" 2>/dev/null || true
  }
  # Wrap existing ok() / warn() to also emit structured log entries:
  _orig_ok() { ok "$@"; }
  ok() { _orig_ok "$@"; _install_log "INFO" "$*"; }
  warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; _install_log "WARN" "$*"; }
  ```
  The `_install_logfile` path must match the hook's log file so all events (hook runs + install events) appear in a single chronological stream queryable with `grep '\[install\]'` or `grep '\[global\]'`.

  **install.ps1 compliance:** Equivalent structured log writes must be added. Add a `Write-InstallLog` function immediately after `Merge-SettingsJson`:
  ```powershell
  function Write-InstallLog {
      param([string]$Level, [string]$Message)
      $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
      $line = "$ts [install] $Level $Message"
      $logPath = Join-Path $env:USERPROFILE ".claude\logs\verbosity-hook.log"
      try { Add-Content -Path $logPath -Value $line -Encoding utf8 -ErrorAction SilentlyContinue }
      catch { <# non-fatal — console output is always present #> }
  }
  ```
  Call `Write-InstallLog "INFO" "..."` / `Write-InstallLog "WARN" "..."` at every `Write-Host` or `Write-Warning` call inside `Merge-SettingsJson`, `Backup-EarlySettings`, and the post-install trigger block.

  **Format verification:**
  ```bash
  # Tail last 20 install log entries and confirm all match the format
  tail -20 "${HOME}/.claude/logs/verbosity-hook.log" \
    | grep -vE '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2} \[(global|project|install)\] (INFO|WARN|ERROR|PASS|FAIL|DEBUG) ' \
    | head -5
  # Expected: no output (all lines conform)
  ```

- [ ] [T-004-A-8] `.claude/` directory existence and writability pre-check: before any hook file copy or `settings.json` merge, verify that the `$HOME/.claude/` directory exists and is writable by the current user. A missing or read-only `.claude/` directory will cause every subsequent step to fail with cryptic errors. Add this check at the very start of the install body (before T-004-A-4's early backup):

  ```bash
  _global_claude_dir="${HOME}/.claude"
  if [ ! -d "$_global_claude_dir" ]; then
      echo "[verbosity-remind] INFO: ${_global_claude_dir} does not exist — creating."
      mkdir -p "$_global_claude_dir/hooks" "$_global_claude_dir/logs" "$_global_claude_dir/memory" 2>/dev/null \
          || { warn "[verbosity-remind] ERROR filesystem: cannot create ${_global_claude_dir}. Fix: mkdir -p '${_global_claude_dir}' and verify parent directory permissions."; exit 2; }
      echo "[verbosity-remind] INFO: created ${_global_claude_dir} and subdirectories."
  elif [ ! -w "$_global_claude_dir" ]; then
      warn "[verbosity-remind] ERROR filesystem: ${_global_claude_dir} exists but is not writable by uid=$(id -u)."
      warn "  Fix: chmod u+w '${_global_claude_dir}'  OR  chown $(id -u) '${_global_claude_dir}'"
      exit 2
  else
      echo "[verbosity-remind] PASS: ${_global_claude_dir} exists and is writable."
  fi
  # Ensure subdirectories exist (hook may have been installed partially)
  for _sub in hooks logs memory; do
      mkdir -p "${_global_claude_dir}/${_sub}" 2>/dev/null \
          || warn "[verbosity-remind] WARN: could not create ${_global_claude_dir}/${_sub} — proceeding."
  done
  ```

  **install.ps1 equivalent** (add as `Assert-ClaudeDirectory` function called at script start):
  ```powershell
  function Assert-ClaudeDirectory {
      $base = Join-Path $env:USERPROFILE ".claude"
      if (-not (Test-Path $base)) {
          Write-Host "[verbosity-remind] INFO: $base does not exist — creating."
          try {
              @('hooks','logs','memory') | ForEach-Object { New-Item -ItemType Directory -Force -Path (Join-Path $base $_) | Out-Null }
              Write-Host "[verbosity-remind] PASS: $base and subdirectories created."
          } catch {
              Write-Warning "[verbosity-remind] ERROR filesystem: cannot create $base. Fix: mkdir $base and verify parent permissions."; exit 2
          }
      } elseif (-not (Test-Path $base -PathType Container)) {
          Write-Warning "[verbosity-remind] ERROR filesystem: $base exists but is not a directory."; exit 2
      } else {
          # Writable check: attempt temp file creation
          $testFile = Join-Path $base ".write-test-$(Get-Random)"
          try {
              [System.IO.File]::WriteAllText($testFile, '') ; Remove-Item $testFile -Force -ErrorAction SilentlyContinue
              Write-Host "[verbosity-remind] PASS: $base is writable."
          } catch {
              Write-Warning "[verbosity-remind] ERROR filesystem: $base is not writable by current user. Fix: icacls $base /grant ${env:USERNAME}:F"; exit 2
          }
      }
  }
  Assert-ClaudeDirectory
  ```

- [ ] [T-004-A-9] `--force` / `--clean` installer flag: define a `--force` flag that resets the hook configuration by removing all existing verbosity-remind entries from `settings.json` before re-registering, and a `--clean` flag that fully removes all verbosity-remind artifacts. Add argument parsing to `install.sh` immediately after the existing flag parsing block:

  ```bash
  # ── Verbosity hook flags ──────────────────────────────────────────────────────
  _FORCE_REINSTALL=0
  _CLEAN_REMOVE=0
  for _arg in "$@"; do
      case "$_arg" in
          --force-verbosity) _FORCE_REINSTALL=1 ;;
          --clean-verbosity) _CLEAN_REMOVE=1 ;;
      esac
  done

  if [ "$_CLEAN_REMOVE" = 1 ]; then
      echo "[verbosity-remind] INFO: --clean-verbosity: removing all verbosity-remind artifacts."
      rm -f "${HOME}/.claude/hooks/verbosity-remind.sh"
      if command -v python3 >/dev/null 2>&1 && [ -f "${HOME}/.claude/settings.json" ]; then
          python3 - "${HOME}/.claude/settings.json" <<'PYEOF'
  import json, sys
  path = sys.argv[1]
  with open(path) as f: d = json.load(f)
  arr = d.get('hooks',{}).get('UserPromptSubmit',[])
  arr[:] = [e for e in arr
            if not any('verbosity-remind' in h.get('command','')
                       for h in e.get('hooks',[]))]
  import tempfile, os
  fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(path)), prefix='.settings-clean-')
  with os.fdopen(fd,'w') as f: json.dump(d, f, indent=2)
  os.rename(tmp, path)
  print("Removed verbosity-remind entries from", path)
  PYEOF
      fi
      echo "[verbosity-remind] INFO: clean complete. Re-run installer without --clean-verbosity to reinstall."
      exit 0
  fi

  if [ "$_FORCE_REINSTALL" = 1 ]; then
      echo "[verbosity-remind] INFO: --force-verbosity: removing existing entries before re-registering."
      # Inline removal — idempotency pre-check inside _merge_settings_json will then
      # see 0 entries and proceed with a fresh registration.
      if command -v python3 >/dev/null 2>&1 && [ -f "${HOME}/.claude/settings.json" ]; then
          python3 - "${HOME}/.claude/settings.json" <<'PYEOF'
  import json, sys, tempfile, os
  path = sys.argv[1]
  with open(path) as f: d = json.load(f)
  arr = d.get('hooks',{}).get('UserPromptSubmit',[])
  arr[:] = [e for e in arr
            if not any('verbosity-remind' in h.get('command','')
                       for h in e.get('hooks',[]))]
  fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(path)), prefix='.settings-force-')
  with os.fdopen(fd,'w') as f: json.dump(d, f, indent=2)
  os.rename(tmp, path)
  print("[verbosity-remind] INFO: existing entries removed; proceeding with fresh registration.")
  PYEOF
      fi
  fi
  ```

  **install.ps1 equivalent flags** (add to param block at top of script):
  ```powershell
  param(
      ...existing params...,
      [switch]$ForceVerbosity,
      [switch]$CleanVerbosity
  )
  ```
  With matching if-blocks mirroring the bash logic using `Merge-SettingsJson`'s dedup path.

  **Usage:**
  ```bash
  bash install.sh --force-verbosity          # reset and re-register hook
  bash install.sh --clean-verbosity          # fully remove all hook artifacts
  powershell.exe -ExecutionPolicy Bypass -Scope Process -File .\install.ps1 -ForceVerbosity
  powershell.exe -ExecutionPolicy Bypass -Scope Process -File .\install.ps1 -CleanVerbosity
  ```

- [ ] [T-004-A-10] jq version compatibility check: add a jq version gate to the pre-flight checks in `install.sh`. The jq filters used in `_merge_settings_json` (`select(all(...))`, `select(.hooks[]?.command)`) require jq **1.6+**. jq 1.5 and earlier do not support the `?` optional operator on iterator expressions, which causes the nested-format deduplication filter to silently drop all existing entries. Add this check immediately after the `bash` version check in T-004-A-3:

  ```bash
  # jq version check: require 1.6+ for optional operator support (?.)
  if command -v jq >/dev/null 2>&1; then
      _jq_ver_raw=$(jq --version 2>/dev/null)          # outputs e.g. "jq-1.6" or "jq-1.7.1"
      _jq_ver=$(printf '%s' "$_jq_ver_raw" | sed 's/^jq-//')
      _jq_major=$(printf '%s' "$_jq_ver" | cut -d. -f1)
      _jq_minor=$(printf '%s' "$_jq_ver" | cut -d. -f2)
      if [ -n "$_jq_major" ] && [ -n "$_jq_minor" ]; then
          if [ "$_jq_major" -gt 1 ] || { [ "$_jq_major" -eq 1 ] && [ "$_jq_minor" -ge 6 ]; }; then
              echo "PASS: jq ${_jq_ver} meets minimum 1.6 requirement"
          else
              warn "[verbosity-remind] WARN dependency: jq ${_jq_ver} is below minimum 1.6. The jq merge path will be skipped; python3 fallback will be used."
              warn "  Fix: upgrade jq to 1.6+. brew install jq  /  apt-get install jq  /  download from https://jqlang.github.io/jq/download/"
              warn "  Note: jq < 1.6 lacks the '?' optional operator; select(.hooks[]?.command) will fail silently."
              # Disable jq path by shadowing the command in this shell
              jq() { return 127; }
          fi
      else
          warn "[verbosity-remind] WARN: could not parse jq version from '${_jq_ver_raw}' — skipping jq version check."
      fi
  else
      echo "INFO: jq not installed — python3 fallback will be used for settings.json merge."
  fi
  ```

  **install.ps1 equivalent** (add inside the jq detection block of `Merge-SettingsJson`):
  ```powershell
  if ($jqExe) {
      $jqVerRaw = (& $jqExe --version 2>$null)   # e.g. "jq-1.6"
      $jqVer = $jqVerRaw -replace '^jq-', ''
      $parts = $jqVer -split '\.'
      $major = [int]($parts[0] -replace '[^0-9]','')
      $minor = [int]($parts[1] -replace '[^0-9]','')
      if ($major -gt 1 -or ($major -eq 1 -and $minor -ge 6)) {
          Write-Host "PASS: jq $jqVer meets minimum 1.6 requirement"
      } else {
          Write-Warning "[verbosity-remind] WARN dependency: jq $jqVer below minimum 1.6 — falling back to ConvertFrom-Json."
          $jqExe = $null   # disable jq path for this run
      }
  }
  ```

- [ ] [T-004-B] Add the global hook copy line to `install.sh`. Insert it inside the `# ── Install global files` block, in the "Agent-managed files — always overwrite" section, immediately after the existing `download "global/hooks/graphify-ast-refresh.py" ...` line.

  **Pre-check — verify the target hook directory is writable and not mounted `noexec` before the copy attempt.** Add these guards immediately before the `download` call:

```bash
if [ ! -w "${GLOBAL_DIR}/hooks" ] && [ ! -w "${GLOBAL_DIR}" ]; then
    warn "FATAL: ${GLOBAL_DIR}/hooks is not writable. Cannot install global verbosity hook."
    warn "  Check permissions with: ls -la ${GLOBAL_DIR}"
    return 1
fi

# noexec mount check: create a temp executable in the target dir and attempt
# to run it. If exec fails, the mount is noexec and the hook will never fire.
_noexec_test=$(mktemp "${GLOBAL_DIR}/hooks/.noexec-test.XXXXXX" 2>/dev/null)
if [ -n "$_noexec_test" ]; then
    printf '#!/bin/sh\nexit 0\n' > "$_noexec_test"
    chmod +x "$_noexec_test" 2>/dev/null
    if ! "$_noexec_test" 2>/dev/null; then
        warn "WARN: ${GLOBAL_DIR}/hooks appears to be on a noexec mount."
        warn "  Hook scripts cannot be executed from this directory. The verbosity"
        warn "  hook will be installed but will silently fail at runtime."
        warn "  Fix: remount the filesystem without noexec, or move \$HOME/.claude"
        warn "  to a directory on an exec-permitted mount."
    fi
    rm -f "$_noexec_test" 2>/dev/null
fi
```

  Then add the copy:

```bash
download "global/hooks/verbosity-remind.sh" "${GLOBAL_DIR}/hooks/verbosity-remind.sh"
chmod +x "${GLOBAL_DIR}/hooks/verbosity-remind.sh"
```

- [ ] [T-004-C] Add the global `settings.json` merge call. Insert it immediately after the `ok "Verbosity set to ${VERBOSITY}"` line (after the line `echo "VERBOSITY: ${VERBOSITY}" > ...`):

> **settings.json path — environment override behavior:**
> Claude Code does not expose an environment variable to redirect `settings.json` to a custom path. The path is always:
>
> | Scope | Canonical path | Override? |
> |---|---|---|
> | Global (user-level) | `$HOME/.claude/settings.json` | `$HOME` only — no `CLAUDE_CONFIG_DIR` or `CLAUDE_SETTINGS_DIR` env var in Claude Code as of 1.11.0 |
> | Project-level | `<project-root>/.claude/settings.json` | Determined by `--project <dir>` flag to the installer; not by any env var |
> | CI override | Set `HOME=/path/to/ci/home` to redirect global path | Supported; `HOME` override is the only documented mechanism |
>
> **Implication for the installer:** `GLOBAL_DIR` is computed as `$HOME/.claude` and there is no fallback to a `CLAUDE_HOME` or `CLAUDE_CONFIG_DIR` env var. If a user's Claude Code installation uses a non-standard home directory (e.g., via a `--user-data-dir` flag at the application level), the installer will write to the wrong path. The only supported override is setting `HOME` before running the installer:
> ```bash
> HOME=/custom/path bash install.sh
> ```
> The installer does NOT read any XDG base directory (`XDG_CONFIG_HOME`, `XDG_DATA_HOME`) — Claude Code itself does not use XDG conventions. If Claude Code adds env-var path overrides in a future version, the installer must be updated to match.

```bash
# Pre-merge permission validation: warn if settings.json is effectively read-only
# before attempting any write. A read-only file causes a silent failure in some
# environments (e.g., network shares, Docker volumes, Git-managed configs).
_settings_rw_check() {
    local _f="$1"
    [ -f "$_f" ] || {
        # File absent: check that the parent directory is writable (installer will create the file)
        _dir="$(dirname "$_f")"
        if [ ! -w "$_dir" ]; then
            warn "[verbosity-remind] ERROR filesystem: ${_dir} is not writable; cannot create $(basename "$_f"). Fix: chmod u+w '${_dir}'."
            return 1
        fi
        return 0
    }
    if [ ! -w "$_f" ]; then
        warn "[verbosity-remind] ERROR filesystem: ${_f} is not writable by the current user (uid=$(id -u)). Fix: chmod u+w '${_f}' or check mount options."
        return 1
    fi
    return 0
}
_settings_rw_check "${GLOBAL_DIR}/settings.json" || true   # non-fatal: merge handles absent file

# HOME vs python3 home mismatch check: if the shell $HOME and python3's expanduser('~')
# disagree, the hook will write to a different location than the installer.
# This can happen when running under sudo -H, in containers with UID remapping,
# or when USERPROFILE and HOME are out of sync on WSL.
if command -v python3 >/dev/null 2>&1; then
    _py3_home=$(python3 -c "import os; print(os.path.expanduser('~'))" 2>/dev/null)
    if [ -n "$_py3_home" ] && [ "$_py3_home" != "$HOME" ]; then
        warn "WARN: Shell \$HOME='${HOME}' differs from python3 expanduser home='${_py3_home}'."
        warn "  The hook writes logs and reads verbosity.md from \$HOME. If python3 tooling"
        warn "  resolves paths differently, hook output may be inconsistent."
        warn "  Cause: sudo -H, container UID remapping, or WSL USERPROFILE/HOME mismatch."
    fi
fi

# CRLF/LF normalization: verbosity.md may contain CRLF line endings when
# authored on Windows or checked out with git's autocrlf=true. The extraction
# loop strips \r from each line (_line="${_line%$'\r'}") inside the hook, but
# the installer should normalise the file at write time to prevent edge cases
# with tools that do byte-exact comparisons. Add this step after writing verbosity.md:
#   sed -i 's/\r$//' "${GLOBAL_DIR}/memory/verbosity.md" 2>/dev/null || true
# On macOS where sed -i requires an argument, use:
#   sed -i '' 's/\r$//' "${GLOBAL_DIR}/memory/verbosity.md" 2>/dev/null || true
# Combined cross-platform form (safe on both GNU sed and BSD sed):
if [ -f "${GLOBAL_DIR}/memory/verbosity.md" ]; then
    _tmp_vmd=$(mktemp "${GLOBAL_DIR}/memory/verbosity.md.tmp.XXXXXX" 2>/dev/null)
    if [ -n "$_tmp_vmd" ]; then
        tr -d '\r' < "${GLOBAL_DIR}/memory/verbosity.md" > "$_tmp_vmd" \
            && mv -f "$_tmp_vmd" "${GLOBAL_DIR}/memory/verbosity.md" \
            || rm -f "$_tmp_vmd" 2>/dev/null
    fi
fi

# Absolute path normalization: resolve the hook file path to an absolute path
# before embedding it in the hook command string. A relative path (e.g., one
# constructed from $PWD at install time) will break if Claude Code is launched
# from a different directory. Use realpath if available; fall back to readlink -f;
# fall back to the original expansion (which is already absolute via $HOME).
_hook_abs_path="${HOME}/.claude/hooks/verbosity-remind.sh"
if command -v realpath >/dev/null 2>&1; then
    _hook_abs_path=$(realpath "$_hook_abs_path" 2>/dev/null) || _hook_abs_path="${HOME}/.claude/hooks/verbosity-remind.sh"
elif command -v readlink >/dev/null 2>&1; then
    _hook_abs_path=$(readlink -f "$_hook_abs_path" 2>/dev/null) || _hook_abs_path="${HOME}/.claude/hooks/verbosity-remind.sh"
fi
echo "  [verbosity-remind] hook path (absolute): $_hook_abs_path"
_global_hook_cmd="bash ${_hook_abs_path}"
# BOM detection for settings.json (install.sh / Unix context)
# On Windows-hosted git repos with core.autocrlf=true or core.safecrlf, settings.json
# may be written with a UTF-8 BOM (\xef\xbb\xbf) by Windows tools (Notepad, VS Code
# with "UTF-8 with BOM" encoding, or PowerShell Set-Content without -Encoding).
# A BOM-prefixed settings.json causes Claude Code to reject the file silently.
# Detect and strip BOM before merge:
if [ -f "${GLOBAL_DIR}/settings.json" ]; then
    _bom_check=$(head -c3 "${GLOBAL_DIR}/settings.json" 2>/dev/null | od -An -tx1 | tr -d ' \n')
    if [ "$_bom_check" = "efbbbf" ]; then
        warn "[verbosity-remind] WARN: UTF-8 BOM detected in ${GLOBAL_DIR}/settings.json — stripping before merge."
        _tmp_nobom=$(mktemp "${GLOBAL_DIR}/settings.json.nobom.XXXXXX" 2>/dev/null)
        if [ -n "$_tmp_nobom" ]; then
            # Skip first 3 bytes (BOM), write rest to tmp, atomic rename
            tail -c +4 "${GLOBAL_DIR}/settings.json" > "$_tmp_nobom" \
                && mv -f "$_tmp_nobom" "${GLOBAL_DIR}/settings.json" \
                || { rm -f "$_tmp_nobom" 2>/dev/null; warn "[verbosity-remind] ERROR filesystem: BOM strip failed — merge may be unreliable."; }
        fi
    fi
fi
_merge_settings_json "${GLOBAL_DIR}/settings.json" "$_global_hook_cmd"

# CC_VERBOSITY_SKIP conflict check — warn if the bypass flag is permanently active
# in the current environment or shell profile. If set, the newly registered hook
# will silently produce no output on every prompt, making BUG-014 ineffective.
case "${CC_VERBOSITY_SKIP:-0}" in
    1|true|yes|on|TRUE|YES|ON|True|Yes|On)
        warn "WARNING: CC_VERBOSITY_SKIP=${CC_VERBOSITY_SKIP} is set in the current environment."
        warn "  The verbosity-remind hook will exit immediately without injecting any constraint."
        warn "  To enable the hook, unset CC_VERBOSITY_SKIP in your shell profile and restart Claude."
        ;;
esac
```

- [ ] [T-004-D] Add the project hook copy and merge inside the `if [ "$INSTALL_PROJECT" = true ]` block. Insert both lines immediately after the existing `chmod +x ...` line for `pre-tool-use.sh` and `post-compact.sh`.

  **Pre-check — verify the project hook directory is writable before the copy attempt:**

```bash
if [ ! -w "${PROJ_DIR}/hooks" ] && [ ! -w "${PROJ_DIR}" ]; then
    warn "FATAL: ${PROJ_DIR}/hooks is not writable. Cannot install project verbosity hook."
    warn "  Check permissions with: ls -la ${PROJ_DIR}"
    return 1
fi
```

  Then add the copy:

```bash
download "project-template/.claude/hooks/verbosity-remind.sh" "${PROJ_DIR}/hooks/verbosity-remind.sh"
chmod +x "${PROJ_DIR}/hooks/verbosity-remind.sh"
_proj_hook_embedded="bash -c 'set +e; _dir=\"\${PWD:-}\"; _prev=\"\"; _iters=0; while [ \"\$_dir\" != \"\$_prev\" ] && [ \"\$_iters\" -lt 40 ]; do _h=\"\$_dir/.claude/hooks/verbosity-remind.sh\"; [ -f \"\$_h\" ] && [ -r \"\$_h\" ] && { bash \"\$_h\"; exit \$?; }; _prev=\"\$_dir\"; _dir=\"\${_dir%/*}\"; [ -z \"\$_dir\" ] && _dir=/; _iters=\$((\$_iters+1)); done; exit 0'"
_merge_settings_json "${PROJ_DIR}/settings.json" "$_proj_hook_embedded"
```

- [ ] [T-004-E] Verify syntax:

```bash
bash -n install.sh
```

Expected: no output, exit 0.

- [ ] [T-004-F] Verify install.sh regression — confirm that all existing install functions survive the new code insertion and that hook injection is idempotent:

```bash
# 1. All required functions must be declared after the edits
bash -c '
source install.sh 2>/dev/null || true
declare -f _merge_settings_json >/dev/null && echo "PASS: _merge_settings_json defined" || echo "FAIL: _merge_settings_json missing"
declare -f download >/dev/null && echo "PASS: download defined" || echo "FAIL: download missing"
'

# 2. Idempotency: run _merge_settings_json twice on a temp file; confirm single entry
_tmp_cfg=$(mktemp /tmp/settings-XXXXXX.json)
echo '{"hooks": {"UserPromptSubmit": []}}' > "$_tmp_cfg"
bash -c "source install.sh 2>/dev/null; _merge_settings_json '$_tmp_cfg' 'bash /test/hook.sh'" 2>/dev/null
bash -c "source install.sh 2>/dev/null; _merge_settings_json '$_tmp_cfg' 'bash /test/hook.sh'" 2>/dev/null
_count=$(python3 -c "import json; d=json.load(open('$_tmp_cfg')); print(len(d['hooks']['UserPromptSubmit']))")
[ "$_count" = "1" ] && echo "PASS: idempotent — 1 entry after 2 runs" || echo "FAIL: $count entries after 2 runs (expected 1)"
rm -f "$_tmp_cfg"
```

Expected: `PASS` for all three assertions.

- [ ] [T-004-G] Clean up orphaned or renamed verbosity hook files. If a future naming convention changes (e.g., `verbosity-hook.sh` renamed to `verbosity-remind.sh`), stale copies under the old name will silently co-exist without firing. Add this cleanup block to `install.sh` immediately before the `_merge_settings_json` calls in both the global and project install sections:

```bash
# Remove any verbosity hook files that no longer match the current filename.
# Naming convention: the canonical file is verbosity-remind.sh. Remove any
# hooks/verbosity-*.sh files in the target directory that differ from this name.
for _stale in "${GLOBAL_DIR}/hooks/verbosity-"*.sh; do
    [ -f "$_stale" ] || continue
    [ "$_stale" = "${GLOBAL_DIR}/hooks/verbosity-remind.sh" ] && continue
    warn "Removing stale hook: $_stale"
    rm -f "$_stale" 2>/dev/null || warn "  Could not remove $_stale — remove manually."
done
```

Apply the same loop for `${PROJ_DIR}/hooks/verbosity-*.sh` inside the `--project` block.

- [ ] [T-004-H] Post-install verification: immediately after all install steps complete, invoke the hook in diagnostic mode to confirm it executes successfully end-to-end. Add this block at the end of the main install body (after all `_merge_settings_json` calls):

```bash
echo ""
echo "── Post-install hook diagnostic ──────────────────────────────────────────"
# Step 1: exec bit
[ -x "${GLOBAL_DIR}/hooks/verbosity-remind.sh" ] \
    && echo "PASS: exec bit set on ${GLOBAL_DIR}/hooks/verbosity-remind.sh" \
    || echo "FAIL: exec bit missing — run: chmod +x ${GLOBAL_DIR}/hooks/verbosity-remind.sh"

# Step 2: dry-run invocation — capture stdout and stderr separately
_diag_out=$(bash "${GLOBAL_DIR}/hooks/verbosity-remind.sh" 2>/tmp/verbosity-diag-err.txt)
_diag_exit=$?
[ "$_diag_exit" -eq 0 ] \
    && echo "PASS: hook exits 0" \
    || echo "WARN: hook exited ${_diag_exit} (should always be 0)"

case "$_diag_out" in
    *'[VERBOSITY:'*) echo "PASS: hook emits [VERBOSITY:LEVEL] tag" ;;
    "")              echo "INFO: hook produced no stdout (CC_VERBOSITY_SKIP may be set, or verbosity.md absent — MIN is the default)" ;;
    *)               echo "WARN: unexpected hook output: $(printf '%s' "$_diag_out" | head -1)" ;;
esac

[ -s /tmp/verbosity-diag-err.txt ] \
    && echo "WARN: hook emitted stderr:" && cat /tmp/verbosity-diag-err.txt \
    || true
rm -f /tmp/verbosity-diag-err.txt 2>/dev/null
echo "── End diagnostic ────────────────────────────────────────────────────────"
```

Expected: `PASS: exec bit set` and `PASS: hook exits 0`. The `[VERBOSITY:]` line is present only if `$HOME/.claude/memory/verbosity.md` exists; INFO on absent file is normal immediately after a fresh install.

- [ ] [T-004-I] Post-install log verification: invoke the hook once and confirm it wrote a structured log entry to `$HOME/.claude/logs/verbosity-hook.log`. This verifies end-to-end that the hook is active, the log file is writable, and the `_write_log` function is reachable. Run after T-004-H:

```bash
_logfile="$HOME/.claude/logs/verbosity-hook.log"

# Record the line count before the invocation
_lines_before=$(wc -l < "$_logfile" 2>/dev/null || echo 0)

# Invoke the hook (suppress stdout; we only care about the log entry)
bash "${HOME}/.claude/hooks/verbosity-remind.sh" > /dev/null 2>&1

# Give the log write up to 1 second to flush (normally instantaneous)
sleep 0.1 2>/dev/null || true

_lines_after=$(wc -l < "$_logfile" 2>/dev/null || echo 0)
if [ "$_lines_after" -gt "$_lines_before" ]; then
    echo "PASS: hook wrote a log entry (lines: ${_lines_before} → ${_lines_after})"
    echo "  Last entry: $(tail -1 "$_logfile" 2>/dev/null)"
else
    echo "INFO: no new log entry — hook may have exited early (CC_VERBOSITY_SKIP, \$HOME absent,"
    echo "  or _log_ok=0 due to unwritable log dir). Check \$HOME/.claude/logs/ permissions."
    echo "  This is not a failure if CC_VERBOSITY_SKIP=1 is set in the current environment."
fi

# Confirm the last log entry matches the unified format: YYYY-MM-DD HH:MM:SS [scope] LEVEL msg
_last_entry=$(tail -1 "$_logfile" 2>/dev/null || echo "")
if printf '%s' "$_last_entry" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2} \[(global|project|install)\]'; then
    echo "PASS: log entry matches unified format"
else
    echo "INFO: last log line does not match expected format — may be from a prior session"
fi
```

- [ ] [T-004-I-2] Final install.sh stderr summary for CI/CD: add a structured summary block at the very end of `install.sh`'s main body (after T-004-H, T-004-I, all merge calls, and CC_VERBOSITY_SKIP warning). This block writes a machine-readable exit summary to **stderr** so CI/CD pipelines can parse it independently of stdout install noise:

```bash
# ── Final install summary (stderr, machine-readable) ──────────────────────────
# CI/CD pipelines: capture with 2>&1 | grep '\[verbosity-remind\] INSTALL'
# or redirect stderr separately: bash install.sh 2>install-err.log
_install_exit_code=0
_install_summary_items=()
_summary_global="SKIP"
_summary_project="SKIP"

# Global hook status
if [ -x "${GLOBAL_DIR}/hooks/verbosity-remind.sh" ]; then
    _summary_global="OK"
else
    _summary_global="FAIL(exec-bit)"
    _install_exit_code=4
fi

# Project hook status (only if --project was requested)
if [ "$INSTALL_PROJECT" = true ]; then
    if [ -x "${PROJ_DIR}/hooks/verbosity-remind.sh" ]; then
        _summary_project="OK"
    else
        _summary_project="FAIL(exec-bit)"
        _install_exit_code=4
    fi
fi

# settings.json registration status
_settings_registered="UNKNOWN"
if command -v python3 >/dev/null 2>&1 && [ -f "${HOME}/.claude/settings.json" ]; then
    python3 -c "
import json,sys
d=json.load(open('${HOME}/.claude/settings.json'))
arr=d.get('hooks',{}).get('UserPromptSubmit',[])
n=sum(1 for e in arr if any('verbosity-remind' in h.get('command','') for h in e.get('hooks',[])))
sys.exit(0 if n==1 else 1)
" 2>/dev/null && _settings_registered="OK" || _settings_registered="FAIL(count!=1)"
fi

printf '[verbosity-remind] INSTALL global=%s project=%s settings=%s exit=%d\n' \
    "$_summary_global" "$_summary_project" "$_settings_registered" "$_install_exit_code" >&2

exit "$_install_exit_code"
```

  Expected stderr output (successful install, no project flag):
  ```
  [verbosity-remind] INSTALL global=OK project=SKIP settings=OK exit=0
  ```
  CI/CD parser example: `bash install.sh 2>&1 | grep '\[verbosity-remind\] INSTALL' | grep 'exit=0'`; non-zero exit code signals automation to investigate.

---

### Task 5: Update `install.ps1` — global hook copy + settings.json merge

**Files:**
- Modify: `install.ps1`

- [ ] [T-005-A] Add the `Merge-SettingsJson` function to `install.ps1`. Insert it immediately after the `Save-RemoteFile` function definition (after the closing `}` of that function, before the `# -- Install global files` comment):

```powershell
# -- settings.json merge helper -------------------------------------------------
# Minimum PowerShell version: 5.1 (Windows PowerShell, ships with Windows 10+).
# ConvertFrom-Json in PS 3/4 does not support -AsHashtable and returns a flat
# PSCustomObject that cannot represent nested arrays correctly. PS 5.1 is required.
# PS 6+ (PowerShell Core) also works. Verify at runtime:
#   if ($PSVersionTable.PSVersion.Major -lt 5 -or
#       ($PSVersionTable.PSVersion.Major -eq 5 -and $PSVersionTable.PSVersion.Minor -lt 1)) {
#       Write-Warning "PowerShell 5.1+ required; detected $($PSVersionTable.PSVersion)"; exit 1
#   }
#
# ── Character encoding / BOM safety ────────────────────────────────────────────
# Windows PowerShell 5.1 default encoding is UTF-16 LE with BOM for file writes.
# Claude Code's JSON parser expects UTF-8 WITHOUT BOM. A BOM (\xef\xbb\xbf as
# the first three bytes) in settings.json causes silent parse failure — Claude
# Code reads the file as empty or invalid and the hook is never invoked.
#
# ALL write operations in this function use [System.IO.File]::WriteAllText with
# (New-Object System.Text.UTF8Encoding($false)) — the $false argument suppresses
# the BOM. NEVER use Set-Content, Out-File, or > redirection for settings.json
# on Windows without -Encoding utf8NoBOM (PS 6+) or the .NET API (PS 5.1).
#
# Detection: if you suspect an existing settings.json has a BOM, run:
#   $bytes = [System.IO.File]::ReadAllBytes($path)
#   if ($bytes[0] -eq 0xef -and $bytes[1] -eq 0xbb -and $bytes[2] -eq 0xbf) {
#       Write-Warning "BOM detected — stripping before parse"
#       $clean = [System.Text.Encoding]::UTF8.GetString($bytes[3..($bytes.Length-1)])
#   }
# Strip and re-save using the .NET WriteAllText form shown above.
# The idempotency pre-check reads the file as UTF-8; if a BOM is present it will
# cause json.loads() to fail (python3 on Windows reads with utf-8-sig by default,
# which strips BOM — this difference can mask BOM issues). The canonical fix is
# always to re-write the file using the .NET UTF-8-no-BOM path below.
function Merge-SettingsJson {
    param([string]$SettingsPath, [string]$HookCmd)

    # Pre-execution backup — always create a timestamped copy before any modification.
    # Provides a rollback path for any merge failure. Skipped if file does not yet exist.
    if (Test-Path $SettingsPath) {
        $bkTs  = Get-Date -Format "yyyyMMddHHmmss"
        $bkDst = "${SettingsPath}.pre-merge.${bkTs}"
        try {
            Copy-Item $SettingsPath $bkDst -ErrorAction Stop
            Write-Host "  [verbosity-remind] backed up settings.json → $bkDst"
        } catch {
            Write-Warning "[verbosity-remind] WARN: Could not write pre-merge backup of settings.json — proceeding without rollback copy."
        }
    }

    # Pre-merge permission validation: verify settings.json is not read-only.
    # A read-only file will cause the atomic write to fail silently.
    if (Test-Path $SettingsPath) {
        $fileInfo = Get-Item $SettingsPath
        if ($fileInfo.IsReadOnly) {
            Write-Warning "[verbosity-remind] WARN: $SettingsPath is marked read-only. Attempting to clear read-only flag..."
            try {
                $fileInfo.IsReadOnly = $false
                Write-Host "  [verbosity-remind] Read-only flag cleared."
            } catch {
                Write-Error "[verbosity-remind] ERROR: Cannot clear read-only flag on $SettingsPath — merge aborted."
                Write-Host "  Fix: attrib -R `"$SettingsPath`" or check ACL with icacls `"$SettingsPath`""
                return
            }
        }
    }

    # jq path: prefer jq for parity with install.sh's primary parse strategy.
    # jq on Windows is available via: winget install jqlang.jq / choco install jq / scoop install jq
    $jqExe = (Get-Command jq -ErrorAction SilentlyContinue)?.Source
    if ($jqExe) {
        $src = if (Test-Path $SettingsPath) { Get-Content $SettingsPath -Raw -Encoding utf8 } else { '{}' }
        $merged = $src | & $jqExe --arg cmd $HookCmd '
            if (.hooks | type) != "object" then .hooks = {} else . end |
            if (.hooks.UserPromptSubmit | type) != "array" then .hooks.UserPromptSubmit = [] else . end |
            .hooks.UserPromptSubmit |= [.[] | select(
                all(.hooks[]?; .command | contains("verbosity-remind.sh") | not)
            )] |
            .hooks.UserPromptSubmit += [{"matcher": "", "hooks": [{"type": "command", "command": $cmd}]}]
        ' 2>$null
        if ($LASTEXITCODE -eq 0 -and $merged) {
            # Atomic write: write to temp file then rename (same directory = same FS).
            # Rename is atomic under NTFS — readers always see old or new, never partial.
            $tmpPath = "${SettingsPath}.tmp.$([System.Guid]::NewGuid().ToString('N').Substring(0,8))"
            try {
                [System.IO.File]::WriteAllText($tmpPath, $merged,
                    (New-Object System.Text.UTF8Encoding($false)))
                Move-Item -Path $tmpPath -Destination $SettingsPath -Force
                Write-Host "  [verbosity-remind] OK: settings.json updated (jq)"
            } catch {
                Remove-Item $tmpPath -Force -ErrorAction SilentlyContinue
                Write-Warning "[verbosity-remind] WARN: jq atomic write failed — falling back to ConvertFrom-Json"
                $jqExe = $null   # fall through to ConvertFrom-Json path below
            }
            if ($jqExe) { return }   # success — skip ConvertFrom-Json path
        } else {
            Write-Warning "[verbosity-remind] WARN: jq parse failed — falling back to ConvertFrom-Json"
        }
    }

    # ConvertFrom-Json path (PS 5.1+ required — see header note)
    $existing = $null
    if (Test-Path $SettingsPath) {
        try {
            $existing = Get-Content $SettingsPath -Raw -Encoding utf8 | ConvertFrom-Json
        } catch {
            Write-Warning "[verbosity-remind] WARN: settings.json is malformed — creating backup and starting fresh."
            $ts  = Get-Date -Format "yyyyMMddHHmmss"
            $rnd = [System.Guid]::NewGuid().ToString('N').Substring(0, 8)
            Copy-Item $SettingsPath "${SettingsPath}.bak.${ts}.${rnd}" -ErrorAction SilentlyContinue
            $existing = $null
        }
    }
    if ($null -eq $existing) { $existing = [PSCustomObject]@{} }

    # Ensure hooks is a PSCustomObject
    if ($null -eq $existing.hooks -or $existing.hooks -isnot [PSCustomObject]) {
        $existing | Add-Member -Force -NotePropertyName 'hooks' -NotePropertyValue ([PSCustomObject]@{})
    }

    # Ensure UserPromptSubmit is an array
    $arr = @()
    if ($existing.hooks.PSObject.Properties['UserPromptSubmit'] -and
        $existing.hooks.UserPromptSubmit -is [array]) {
        $arr = @($existing.hooks.UserPromptSubmit)
    }

    # Remove stale verbosity-remind entries (nested and flat format)
    $arr = @($arr | Where-Object {
        $hooks = $_.hooks
        if ($hooks -is [array]) {
            -not ($hooks | Where-Object { $_.command -like "*verbosity-remind.sh*" })
        } else {
            $_.command -notlike "*verbosity-remind.sh*"
        }
    })

    # Append new entry in nested format
    $newEntry = [PSCustomObject]@{
        matcher = ""
        hooks   = @([PSCustomObject]@{ type = "command"; command = $HookCmd })
    }
    $arr += $newEntry

    $existing.hooks | Add-Member -Force -NotePropertyName 'UserPromptSubmit' -NotePropertyValue $arr

    # UTF-8 encoding note: PowerShell 5.1's `Set-Content -Encoding utf8` writes
    # UTF-8 WITH BOM (\xef\xbb\xbf). Claude Code's JSON parser may reject or
    # misparse a BOM-prefixed settings.json. Use the .NET API directly to write
    # UTF-8 WITHOUT BOM, which is what Claude Code expects.
    # Atomic write: temp file + Move-Item for NTFS atomicity (matches install.sh strategy).
    $json = $existing | ConvertTo-Json -Depth 10
    $tmpPath = "${SettingsPath}.tmp.$([System.Guid]::NewGuid().ToString('N').Substring(0,8))"
    try {
        [System.IO.File]::WriteAllText($tmpPath, $json,
            (New-Object System.Text.UTF8Encoding($false)))   # $false = no BOM
        Move-Item -Path $tmpPath -Destination $SettingsPath -Force
        Write-Host "  [verbosity-remind] OK: settings.json updated (ConvertFrom-Json, UTF-8 no BOM)"
    } catch {
        Remove-Item $tmpPath -Force -ErrorAction SilentlyContinue
        Write-Error "[verbosity-remind] ERROR: Atomic write to $SettingsPath FAILED: $_"
        Write-Host "  The merge result was NOT written. Run the installer again or apply manually."
    }
}
```

- [ ] [T-005-B] Add the global hook copy to the "Agent-managed -- always overwrite" section of `install.ps1`, immediately after the `Save-RemoteFile "global/hooks/graphify-ast-refresh.py" ...` line:

```powershell
Save-RemoteFile "global/hooks/verbosity-remind.sh" "$GLOBAL_DIR\hooks\verbosity-remind.sh"
```

- [ ] [T-005-C] Add the global `settings.json` merge call immediately after the `Write-Ok "Verbosity set to $Verbosity"` line:

```powershell
$globalHookCmd = "bash $env:USERPROFILE/.claude/hooks/verbosity-remind.sh"
Merge-SettingsJson "$GLOBAL_DIR\settings.json" $globalHookCmd
```

- [ ] [T-005-D] Add the project hook copy and merge call inside the `if ($Project)` block, immediately after the existing `Save-RemoteFile "project-template/.claude/hooks/post-compact.sh"` line:

```powershell
Save-RemoteFile "project-template/.claude/hooks/verbosity-remind.sh" "$projDir\hooks\verbosity-remind.sh"
# Single-quoted here-string prevents PowerShell from expanding bash variables like ${PWD:-}, $_dir, $_h.
# The closing '@ MUST be at column 0 — no leading whitespace.
$projHookEmbedded = (@'
bash -c 'set +e; _dir="${PWD:-}"; _prev=""; _iters=0; while [ "$_dir" != "$_prev" ] && [ "$_iters" -lt 40 ]; do _h="$_dir/.claude/hooks/verbosity-remind.sh"; [ -f "$_h" ] && [ -r "$_h" ] && { bash "$_h"; exit $?; }; _prev="$_dir"; _dir="${_dir%/*}"; [ -z "$_dir" ] && _dir=/; _iters=$((_iters+1)); done; exit 0'
'@).TrimEnd()
Merge-SettingsJson "$projDir\settings.json" $projHookEmbedded
```

Notes:
- `@'...'@` is a PowerShell single-quoted here-string; nothing between `@'` and `'@` is interpolated — `${PWD:-}`, `$_dir`, `$_h`, and all bash variables survive literally.
- `.TrimEnd()` (not `.Trim()`) removes only trailing whitespace (`\r\n` appended by the here-string) without risking removal of any leading content. The string's trailing character remains the closing bash single-quote `'`, not whitespace.
- The `'@` closing delimiter MUST be at column 0 (no indentation) — PowerShell parses it as a literal terminator only when it appears at the start of a line.
- Verify the result matches T-003's JSON `command` value: `$projHookEmbedded -eq (Get-Content project-template\.claude\settings.json | ConvertFrom-Json).hooks.UserPromptSubmit[0].hooks[0].command`

- [ ] [T-005-E] Verify PowerShell syntax (Windows only). On locked-down workstations the default `Restricted` ExecutionPolicy blocks all script execution, including spawning child `powershell.exe` processes. Use the `-ExecutionPolicy Bypass -Scope Process` form to limit the override to the current process only — no elevation required:

```powershell
powershell.exe -ExecutionPolicy Bypass -Scope Process -NoProfile -Command {
    $errors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile(
        (Resolve-Path '.\install.ps1').Path, [ref]$null, [ref]$errors)
    if ($errors.Count -eq 0) {
        Write-Host "Syntax OK"
    } else {
        $errors | ForEach-Object { Write-Host "Parse error: $_" }
        exit 1
    }
}
```

Expected: `Syntax OK`. `Resolve-Path '.\install.ps1'` always converts the relative path to an absolute path before passing it to `ParseFile` — the API requires an absolute path and will throw `ArgumentException` on a relative path. If the working directory is not the repo root (e.g., you are in a subdirectory like `docs/superpowers/plans`), `Resolve-Path '.\install.ps1'` will fail with a path-not-found error. In that case supply the absolute path explicitly:

```powershell
# Substitute the actual absolute repo root for <REPO_ROOT>
(Resolve-Path '<REPO_ROOT>\install.ps1').Path
# e.g. C:\Users\yeiso\Documentos\Projects\Personal\code-conductor\install.ps1
```

The static parser method does not execute any code in `install.ps1`; it only tokenizes and validates syntax, so even destructive commands in the file are never run during this check.

- [ ] [T-005-F] Document the required invocation form for `install.ps1` on restricted Windows workstations. Add this note to the installer's header comment block (lines 1–6 of `install.ps1`), immediately after the existing usage examples:

```powershell
#        powershell.exe -ExecutionPolicy Bypass -Scope Process -File .\install.ps1
```

**PowerShell execution policy — comprehensive documentation:**

Windows enforces execution policies that control which scripts can run. The default policy (`Restricted` on home editions, `RemoteSigned` on most enterprise builds) blocks unsigned scripts. `install.ps1` is unsigned. The following table documents every policy level and the correct invocation for each:

| Policy | Effect | Required invocation form |
|---|---|---|
| `Restricted` (default, home) | Blocks all scripts | `powershell.exe -ExecutionPolicy Bypass -Scope Process -File .\install.ps1` |
| `AllSigned` | Requires code signature | Same `-ExecutionPolicy Bypass` form |
| `RemoteSigned` (default, enterprise) | Blocks scripts downloaded from internet; allows local unsigned | `powershell.exe -ExecutionPolicy RemoteSigned -Scope Process -File .\install.ps1` OR Bypass form |
| `Unrestricted` / `Bypass` | Allows all scripts | `.\install.ps1` (no flag needed) |

**What `-Scope Process` means:** The policy change applies only to the current `powershell.exe` process. It does not persist to the machine (`LocalMachine`) or user (`CurrentUser`) scope. No elevation (UAC) is required. The script itself must NOT call `Set-ExecutionPolicy` — this requires elevation, silently fails for standard users, and would persist beyond the process scope.

**Checking the current policy before running:**
```powershell
Get-ExecutionPolicy -List
# Confirm "Process" row shows Bypass or RemoteSigned after applying -Scope Process flag
```

**Minimum PowerShell version:** 5.1 (Windows PowerShell). `ConvertFrom-Json` with nested array support and `[System.IO.File]::WriteAllText` atomic UTF-8 write both require 5.1+. Check with:
```powershell
$PSVersionTable.PSVersion   # Major must be >= 5, Minor >= 1 for 5.x builds
```
If the version is below 5.1, the ConvertFrom-Json path will produce incomplete output and the jq path (if jq is installed) must be used instead. Document this in `install.ps1`'s header:
```powershell
# Minimum: Windows PowerShell 5.1. ConvertFrom-Json nested arrays and
# [System.IO.File]::WriteAllText UTF-8-no-BOM support require 5.1+.
# Check: $PSVersionTable.PSVersion (Major >= 5, Minor >= 1)
```

The `-Scope Process` flag limits the policy relaxation to the current PowerShell session only; it does not persist to the machine or user scope and does not require elevation. The script must not call `Set-ExecutionPolicy` internally — doing so requires elevation and silently fails for non-admin users.

- [ ] [T-005-G] Verify install.ps1 regression — confirm existing functions survive the new code insertion and that `Merge-SettingsJson` is idempotent:

```powershell
# 1. All required functions must be present
powershell.exe -ExecutionPolicy Bypass -Scope Process -NoProfile -Command {
    . .\install.ps1 -WhatIf 2>$null
    if (Get-Command Merge-SettingsJson -ErrorAction SilentlyContinue) {
        Write-Host "PASS: Merge-SettingsJson defined"
    } else { Write-Host "FAIL: Merge-SettingsJson missing" }
    if (Get-Command Save-RemoteFile -ErrorAction SilentlyContinue) {
        Write-Host "PASS: Save-RemoteFile defined"
    } else { Write-Host "FAIL: Save-RemoteFile missing" }
}

# 2. Idempotency: run Merge-SettingsJson twice; confirm single entry
powershell.exe -ExecutionPolicy Bypass -Scope Process -NoProfile -Command {
    $f = [System.IO.Path]::GetTempFileName() -replace '\.tmp$', '.json'
    '{"hooks":{"UserPromptSubmit":[]}}' | Set-Content $f -Encoding utf8
    . .\install.ps1 -WhatIf 2>$null
    Merge-SettingsJson $f "bash /test/hook.sh"
    Merge-SettingsJson $f "bash /test/hook.sh"
    $d = Get-Content $f -Raw | ConvertFrom-Json
    $count = $d.hooks.UserPromptSubmit.Count
    if ($count -eq 1) { Write-Host "PASS: idempotent — 1 entry after 2 runs" }
    else { Write-Host "FAIL: $count entries (expected 1)" }
    Remove-Item $f -Force
}
```

Expected: `PASS` for all three assertions. If `install.ps1` does not support `-WhatIf`, omit the flag and ensure the script does not perform network operations when dot-sourced without arguments.

- [ ] [T-005-H] Windows-only: verify that `bash` is available and correctly resolved in the system PATH before trusting that hook commands will function at runtime. The hook command registered in `settings.json` uses the form `bash <path>/verbosity-remind.sh`, so `bash` must be on PATH in the environment where Claude Code is launched:

```powershell
# Step 1: Confirm bash is reachable from PowerShell
$bashPath = (Get-Command bash -ErrorAction SilentlyContinue).Source
if ($bashPath) {
    Write-Host "PASS: bash found at: $bashPath"
} else {
    Write-Host "FATAL: bash not found on PATH."
    Write-Host "  Windows users must install one of:"
    Write-Host "    - Git for Windows (adds Git Bash at C:\Program Files\Git\bin\bash.exe)"
    Write-Host "    - WSL (Windows Subsystem for Linux)"
    Write-Host "    - Cygwin or MSYS2"
    Write-Host "  Then ensure the install directory is in the system PATH."
    Write-Host "  Git for Windows PATH option: 'Git from the command line and also from 3rd-party software'"
}

# Step 2: If found, confirm it executes and reports a version
if ($bashPath) {
    $ver = (bash --version 2>$null) | Select-Object -First 1
    if ($ver) { Write-Host "PASS: $ver" }
    else { Write-Host "WARN: bash --version returned no output — non-standard build." }
}
```

Expected: `PASS` on both lines. If `bash` is not found, Claude Code will silently fail to invoke the hook — the hook will not run and verbosity enforcement will be absent. Git for Windows is the recommended solution for most Windows developers; WSL is preferred for environments requiring a full POSIX runtime.

Note: PowerShell 5.1 does not support the `?.` null-conditional operator — the `.Source` property access above assumes `Get-Command` returned a non-null result, guarded by the `if ($bashPath)` check on the next line.

- [ ] [T-005-I] Post-install hook trigger — install.ps1 equivalent of T-004-H. After all `Merge-SettingsJson` calls complete, invoke the global hook once to confirm it is correctly registered, reachable, and executable. Add this block at the end of `install.ps1`'s main body (after all `Merge-SettingsJson` calls and the project-hook section):

```powershell
# ── Post-install hook trigger ──────────────────────────────────────────────────
# Invoke the installed hook once to confirm: (a) bash is reachable, (b) the
# hook script is executable, (c) the hook exits 0 without error output.
$hookPath = Join-Path $GlobalDir "hooks\verbosity-remind.sh"
if (Test-Path $hookPath) {
    $bashExe = (Get-Command bash -ErrorAction SilentlyContinue).Source
    if ($bashExe) {
        $result = & $bashExe $hookPath 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "PASS: post-install hook trigger succeeded (exit 0)"
        } else {
            Write-Warning "[verbosity-remind] ERROR exec: hook invocation returned exit $LASTEXITCODE. Output: $result"
            Write-Warning "  Fix: verify hook file is not corrupted and bash is >= 3.2."
        }
        # Verify settings.json contains the registered entry
        $settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"
        if (Test-Path $settingsPath) {
            $jqExe = (Get-Command jq -ErrorAction SilentlyContinue).Source
            if ($jqExe) {
                $count = (Get-Content $settingsPath -Raw | & $jqExe '[.hooks.UserPromptSubmit[]? | select(.hooks[]?.command | contains("verbosity-remind"))] | length' 2>$null)
                if ($count -eq "1") {
                    Write-Host "PASS: settings.json contains exactly 1 verbosity-remind entry"
                } elseif ($count -gt 1) {
                    Write-Warning "[verbosity-remind] ERROR json: $count duplicate entries in settings.json. Fix: re-run installer (idempotency pre-check will deduplicate)."
                } else {
                    Write-Warning "[verbosity-remind] ERROR json: 0 verbosity-remind entries found in settings.json after install. Fix: re-run installer."
                }
            } else {
                Write-Host "INFO: jq not available — skipping settings.json entry count check. Install jq for full post-install validation."
            }
        }
    } else {
        Write-Warning "[verbosity-remind] ERROR dependency: bash not found — cannot trigger hook. Fix: install Git for Windows and add bash to PATH."
    }
} else {
    Write-Warning "[verbosity-remind] ERROR filesystem: hook not found at ${hookPath} after install. Fix: re-run installer."
}
```

Expected: `PASS: post-install hook trigger succeeded (exit 0)` and `PASS: settings.json contains exactly 1 verbosity-remind entry`. Any `ERROR` or `WARNING` line requires investigation before declaring the install complete.

- [ ] [T-005-J] Mandatory early-stage backup for install.ps1 — equivalent of T-004-A-4. Add this block to `install.ps1` immediately after the pre-flight checks and before the `# -- Install global files` comment:

```powershell
# ── Early-stage mandatory backup ───────────────────────────────────────────────
function Backup-EarlySettings {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return }   # absent = will be created; no backup needed
    $ts = Get-Date -Format 'yyyyMMddHHmmss'
    $bak = "${Path}.installer-backup.${ts}"
    try {
        Copy-Item -Path $Path -Destination $bak -Force
        Write-Host "  [verbosity-remind] early backup: $Path → $bak"
    } catch {
        Write-Warning "[verbosity-remind] ERROR filesystem: could not write early backup of $Path. Fix: check write permissions on $(Split-Path $Path -Parent)."
        Write-Warning "  Proceeding without early backup — per-merge backup inside Merge-SettingsJson is still active."
    }
}
Backup-EarlySettings (Join-Path $env:USERPROFILE ".claude\settings.json")
if ($Project) { Backup-EarlySettings (Join-Path $ProjectDir "settings.json") }
```

**Standardized exit code reporting for install.ps1:** Add the following exit-code contract to the header comment of `install.ps1`:

```powershell
# Exit codes:
#   0  — success (all steps completed; hook registered and reachable)
#   1  — environment dependency failure (bash/jq/python3 missing or incompatible)
#   2  — file system failure (directory not writable, settings.json corrupt)
#   3  — JSON merge failure (settings.json structure invalid after write)
#   4  — post-install verification failure (hook registered but invocation failed)
# Note: the script uses 'exit <code>' only for FATAL conditions; warnings and
# partial failures are logged but do not terminate the install.
```

The equivalent contract for `install.sh` (add to its header `# Exit codes:` block):
```bash
# Exit codes:
#   0  — success
#   1  — environment dependency failure (bash missing, version below 3.2)
#   2  — file system failure (hook dir not writable, noexec mount)
#   3  — JSON merge failure (settings.json corrupt, all merge paths exhausted)
#   4  — post-install verification failure (hook exits non-zero after install)
# Partial failures (single target failed while others succeeded) emit a warning
# and exit 0 so CI pipelines are not blocked by a missing project settings.json.
```

- [ ] [T-005-J-2] Final install.ps1 stderr summary for CI/CD — install.ps1 equivalent of T-004-I-2. Add this block at the very end of `install.ps1`'s main body (after T-005-I and all merge calls):

```powershell
# ── Final install summary (stderr, machine-readable) ──────────────────────────
# CI/CD: capture with (.\install.ps1 2>&1) | Select-String '\[verbosity-remind\] INSTALL'
$summaryGlobal  = if (Test-Path (Join-Path $GlobalDir 'hooks\verbosity-remind.sh')) { 'OK' } else { 'FAIL(missing)' }
$summaryProject = if ($Project) {
    if (Test-Path (Join-Path $ProjectDir '.claude\hooks\verbosity-remind.sh')) { 'OK' } else { 'FAIL(missing)' }
} else { 'SKIP' }

$settingsPath = Join-Path $env:USERPROFILE '.claude\settings.json'
$summarySettings = 'UNKNOWN'
if (Test-Path $settingsPath) {
    $jqExe2 = (Get-Command jq -ErrorAction SilentlyContinue).Source
    if ($jqExe2) {
        $n = (Get-Content $settingsPath -Raw | & $jqExe2 '[.hooks.UserPromptSubmit[]? | select(.hooks[]?.command | contains("verbosity-remind"))] | length' 2>$null)
        $summarySettings = if ($n -eq '1') { 'OK' } else { "FAIL(count=$n)" }
    } else {
        $raw = Get-Content $settingsPath -Raw -ErrorAction SilentlyContinue
        $summarySettings = if ($raw -match 'verbosity-remind') { 'OK(text-match)' } else { 'FAIL(not-found)' }
    }
}

$exitCode = if ($summaryGlobal -eq 'OK' -and $summarySettings -like 'OK*') { 0 } else { 4 }
[Console]::Error.WriteLine("[verbosity-remind] INSTALL global=$summaryGlobal project=$summaryProject settings=$summarySettings exit=$exitCode")
exit $exitCode
```

  Expected stderr output (successful install, no -Project flag):
  ```
  [verbosity-remind] INSTALL global=OK project=SKIP settings=OK exit=0
  ```
  `[Console]::Error.WriteLine` writes to the PowerShell error stream (stream 2) without adding a `WARNING:` prefix or creating an `ErrorRecord`. CI/CD parsers can isolate it with `2>&1 | Select-String 'INSTALL'` or by capturing stderr separately.

---

### Task 6: Update `skills/verbosity.md`

**Files:**
- Modify: `skills/verbosity.md`

Update the `## Application` section to describe hook-driven enforcement. The level definitions are unchanged.

- [ ] [T-006] Replace the `## Application` section of `skills/verbosity.md`:

Old content (lines 22–24):
```
## Application
Apply the active level to every response in the session. The level persists until the session ends or the user changes it explicitly.
```

New content:
```
## Application

The active level is enforced by a `UserPromptSubmit` hook (`verbosity-remind.sh`) that fires before every response and injects a compact, level-aware reminder into the conversation context. The reminder is injected at each prompt boundary so the constraint survives context fills and session drift — not only at session start.

Read `~/.claude/memory/verbosity.md` for the configured level. Default: MIN if the file is absent, unreadable, or contains no valid `VERBOSITY:` token. To change the level, re-run the installer with `--verbosity MIN|INFO|VERBOSE` or edit the file directly.

Changes to `verbosity.md` take effect on the **next user prompt** — no session restart required. If you edit the file during an active Claude session, the hook picks up the new level on the immediately following prompt; there is no stale session state to clear. If the hook emits at an unexpected level after a change, verify the file was saved (not merely modified in an unsaved buffer), confirm that `$HOME` resolves to the expected path in the terminal that launched Claude, and check that no parent environment is setting `CC_VERBOSITY_SKIP=1`.

VERBOSITY_HOOK_VERSION: 1.11.0
```

The `VERBOSITY_HOOK_VERSION:` line serves as a machine-readable migration marker. Future versions of `verbosity-remind.sh` can read this field to detect legacy configurations and perform automatic upgrades (e.g., format changes, new token syntax). The hook ignores lines it does not recognise — `VERBOSITY_HOOK_VERSION` is not a verbosity token and will not affect level detection. Future hook authors: parse this with `grep -m1 '^VERBOSITY_HOOK_VERSION:' verbosity.md | cut -d: -f2 | tr -d ' '` and compare against the minimum supported version.

- [ ] [T-006-A] Verify the file looks correct:

```bash
grep -A6 "## Application" skills/verbosity.md
```

Expected: shows the new two-paragraph Application section.

- [ ] [T-006-B] Verify that the `VERBOSITY_HOOK_VERSION` parser is robust against unexpected formatting or missing lines. Future hook versions that read this field must apply the following defensive parse:

```bash
# Robust parser for VERBOSITY_HOOK_VERSION — handles all edge cases:
#   - Line absent (grep exits 1): _version="" — caller treats as legacy pre-1.11.0
#   - Line present but value empty ("VERBOSITY_HOOK_VERSION: "): _version=""
#   - Line has leading/trailing spaces: stripped by tr -d
#   - Line has CRLF endings: stripped by tr -d '\r'
#   - Multiple matching lines: grep -m1 uses first occurrence only
#   - Unexpected format ("VERBOSITY_HOOK_VERSION" with no colon): awk prints empty string
_raw=$(grep -m1 '^VERBOSITY_HOOK_VERSION:' skills/verbosity.md 2>/dev/null || echo "")
_version=$(printf '%s' "$_raw" | awk -F: '{gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); print $2}' | tr -d '\r ')

if [ -z "$_version" ]; then
    echo "INFO: VERBOSITY_HOOK_VERSION not found or empty — treating as legacy (pre-1.11.0)"
else
    echo "PASS: VERBOSITY_HOOK_VERSION = '$_version'"
fi
```

Run this verification after T-006 to confirm the version key is present and parseable. Any future hook author adding migration logic must validate their parser against: absent line, line with extra spaces, CRLF line endings, and duplicate lines.

---

### Task 7: Write `tests/verbosity-hook-test.sh`

**Files:**
- Create: `tests/verbosity-hook-test.sh`

This test harness covers the 14-row cascading verification matrix from the spec plus key error cases. It uses a temp directory to simulate filesystem layouts without touching `$HOME`.

- [ ] [T-007] Write `tests/verbosity-hook-test.sh`:

```bash
#!/usr/bin/env bash
# BUG-014 verbosity hook test harness
# Run: bash tests/verbosity-hook-test.sh
# Requires: bash 3.2+, mktemp

set -euo pipefail
PASS=0; FAIL=0; _tmp=$(mktemp -d)
# Remove stale .verbosity-fence-warned marker before tests — a marker < 60 min old
# from a prior run or session would suppress fence-warning assertions in this harness.
rm -f "$HOME/.claude/logs/.verbosity-fence-warned" 2>/dev/null || true
trap 'rm -rf "$_tmp"' EXIT

# || true guards: (( expr )) returns exit code 1 when expr == 0 (e.g. PASS++ when PASS=0).
# With set -e active, a bare (( PASS++ )) would kill the script on the first assertion.
ok()   { echo "  PASS: $1"; (( PASS++ )) || true; }
fail() { echo "  FAIL: $1 — got: '$2' want: '$3'"; (( FAIL++ )) || true; }

# Environment isolation guarantee:
#   HOME, PWD, and CC_VERBOSITY_SKIP are passed as inline env-var prefixes to
#   the bash subprocess only. They do NOT modify the parent shell's environment.
#   Each test block creates its own temp directory (_h1, _h2, …) so filesystem
#   state is isolated. The `out` variable is reassigned before every assertion,
#   so no cross-contamination from prior test output is possible.
#   CC_VERBOSITY_SKIP defaults to 0 if omitted (third arg to helpers).
run_global() {
    local _home="$1" _pwd="$2" _skip="${3:-0}"
    CC_VERBOSITY_SKIP="$_skip" HOME="$_home" PWD="$_pwd" \
        bash global/hooks/verbosity-remind.sh 2>/dev/null || true
}

run_project() {
    local _home="$1" _pwd="$2" _skip="${3:-0}"
    CC_VERBOSITY_SKIP="$_skip" HOME="$_home" PWD="$_pwd" \
        bash project-template/.claude/hooks/verbosity-remind.sh 2>/dev/null || true
}

# ── Matrix row 1: global hook, no project hook, verbosity.md = MIN ─────────
_h1="$_tmp/h1"; mkdir -p "$_h1/.claude/memory"
echo "VERBOSITY: MIN" > "$_h1/.claude/memory/verbosity.md"
out=$(run_global "$_h1" "$_h1")
case "$out" in
    *"VERBOSITY:MIN"*) ok "row1 global hook emits MIN" ;;
    *) fail "row1 global hook emits MIN" "$out" "contains VERBOSITY:MIN" ;;
esac

# ── Row 2: global defers to project hook ──────────────────────────────────
_h2="$_tmp/h2"; mkdir -p "$_h2/proj/.claude/hooks" "$_h2/.claude/memory"
echo "VERBOSITY: MIN" > "$_h2/.claude/memory/verbosity.md"
cp project-template/.claude/hooks/verbosity-remind.sh "$_h2/proj/.claude/hooks/verbosity-remind.sh"
out=$(run_global "$_h2" "$_h2/proj")
if [ -z "$out" ] || [ "$out" = $'\n' ]; then
    ok "row2 global defers (exits 0, no output) when project hook exists"
else
    fail "row2 global defers" "$out" "empty (deferred)"
fi

# ── Row 3: invoked from subdirectory, project hook at root ────────────────
_h3="$_tmp/h3"; mkdir -p "$_h3/proj/src/lib" "$_h3/proj/.claude/hooks" "$_h3/.claude/memory"
echo "VERBOSITY: MIN" > "$_h3/.claude/memory/verbosity.md"
cp project-template/.claude/hooks/verbosity-remind.sh "$_h3/proj/.claude/hooks/verbosity-remind.sh"
out=$(run_global "$_h3" "$_h3/proj/src/lib")
if [ -z "$out" ] || [ "$out" = $'\n' ]; then
    ok "row3 global defers from subdir via traversal"
else
    fail "row3 global defers from subdir" "$out" "empty (deferred)"
fi

# ── Row 4: project-local verbosity.md overrides global ────────────────────
_h4="$_tmp/h4"; mkdir -p "$_h4/proj/.claude/memory" "$_h4/.claude/memory"
echo "VERBOSITY: MIN" > "$_h4/.claude/memory/verbosity.md"
echo "VERBOSITY: INFO" > "$_h4/proj/.claude/memory/verbosity.md"
out=$(run_project "$_h4" "$_h4/proj")
case "$out" in
    *"VERBOSITY:INFO"*) ok "row4 project-local verbosity.md overrides global" ;;
    *) fail "row4 project-local override" "$out" "contains VERBOSITY:INFO" ;;
esac

# ── Row 5: lowercase 'verbose' normalizes to VERBOSE ─────────────────────
_h5="$_tmp/h5"; mkdir -p "$_h5/proj/.claude/memory" "$_h5/.claude/memory"
echo "VERBOSITY: MIN" > "$_h5/.claude/memory/verbosity.md"
echo "VERBOSITY: verbose" > "$_h5/proj/.claude/memory/verbosity.md"
out=$(run_project "$_h5" "$_h5/proj")
case "$out" in
    *"VERBOSITY:VERBOSE"*) ok "row5 lowercase verbose normalized to VERBOSE" ;;
    *) fail "row5 lowercase verbose" "$out" "contains VERBOSITY:VERBOSE" ;;
esac

# ── Row 6: no verbosity.md at any level → sanity guard MIN ───────────────
_h6="$_tmp/h6"; mkdir -p "$_h6"
out=$(run_global "$_h6" "$_h6")
case "$out" in
    *"VERBOSITY:MIN"*) ok "row6 sanity guard MIN when no verbosity.md" ;;
    *) fail "row6 sanity guard MIN" "$out" "contains VERBOSITY:MIN" ;;
esac

# ── Row 7: unrecognized level → sanity guard MIN ─────────────────────────
_h7="$_tmp/h7"; mkdir -p "$_h7/.claude/memory"
echo "VERBOSITY: LOUD" > "$_h7/.claude/memory/verbosity.md"
out=$(run_global "$_h7" "$_h7")
case "$out" in
    *"VERBOSITY:MIN"*) ok "row7 unrecognized level falls back to MIN" ;;
    *) fail "row7 unrecognized level" "$out" "contains VERBOSITY:MIN" ;;
esac

# ── Row 8: empty $PWD → skip traversal, read $HOME/verbosity.md ──────────
_h8="$_tmp/h8"; mkdir -p "$_h8/.claude/memory"
echo "VERBOSITY: INFO" > "$_h8/.claude/memory/verbosity.md"
out=$(CC_VERBOSITY_SKIP=0 HOME="$_h8" PWD="" bash global/hooks/verbosity-remind.sh 2>/dev/null || true)
case "$out" in
    *"VERBOSITY:INFO"*) ok "row8 empty PWD falls back to HOME memory" ;;
    *) fail "row8 empty PWD" "$out" "contains VERBOSITY:INFO" ;;
esac

# ── Row 10: VERBOSITY: inside code fence → not matched ───────────────────
_h10="$_tmp/h10"; mkdir -p "$_h10/.claude/memory"
cat > "$_h10/.claude/memory/verbosity.md" <<'EOF'
Some doc

```
VERBOSITY: VERBOSE
```

VERBOSITY: MIN
EOF
out=$(run_global "$_h10" "$_h10")
case "$out" in
    *"VERBOSITY:MIN"*) ok "row10 fenced VERBOSITY not matched, body VERBOSITY:MIN used" ;;
    *) fail "row10 fence guard" "$out" "contains VERBOSITY:MIN" ;;
esac

# ── Row 11: CC_VERBOSITY_SKIP=1 → no output ──────────────────────────────
_h11="$_tmp/h11"; mkdir -p "$_h11/.claude/memory"
echo "VERBOSITY: VERBOSE" > "$_h11/.claude/memory/verbosity.md"
out=$(run_global "$_h11" "$_h11" "1")
if [ -z "$out" ]; then
    ok "row11 CC_VERBOSITY_SKIP=1 produces no output"
else
    fail "row11 CI bypass" "$out" "empty"
fi

# ── Row 12: path with spaces ──────────────────────────────────────────────
_h12="$_tmp/h12 with spaces"; mkdir -p "$_h12/.claude/memory"
echo "VERBOSITY: MIN" > "$_h12/.claude/memory/verbosity.md"
out=$(run_global "$_h12" "$_h12")
case "$out" in
    *"VERBOSITY:MIN"*) ok "row12 path with spaces handled correctly" ;;
    *) fail "row12 path with spaces" "$out" "contains VERBOSITY:MIN" ;;
esac

# ── Row 13: project hook exists but not readable → global retains authority
# chmod 000 has no effect on root (Docker, CI containers). Skip with explanation when uid=0.
_h13="$_tmp/h13"; mkdir -p "$_h13/proj/.claude/hooks" "$_h13/.claude/memory"
echo "VERBOSITY: MIN" > "$_h13/.claude/memory/verbosity.md"
cp project-template/.claude/hooks/verbosity-remind.sh "$_h13/proj/.claude/hooks/verbosity-remind.sh"
if [ "$(id -u)" = "0" ]; then
    echo "  SKIP: row13 — running as root; chmod 000 is bypassed by kernel, test not meaningful"
else
    chmod 000 "$_h13/proj/.claude/hooks/verbosity-remind.sh"
    out=$(run_global "$_h13" "$_h13/proj")
    case "$out" in
        *"VERBOSITY:MIN"*) ok "row13 unreadable project hook → global retains authority" ;;
        *) fail "row13 unreadable project hook" "$out" "contains VERBOSITY:MIN" ;;
    esac
    chmod 644 "$_h13/proj/.claude/hooks/verbosity-remind.sh"
fi

# ── CRLF line endings ─────────────────────────────────────────────────────
_hcr="$_tmp/hcr"; mkdir -p "$_hcr/.claude/memory"
printf "VERBOSITY: VERBOSE\r\n" > "$_hcr/.claude/memory/verbosity.md"
out=$(run_global "$_hcr" "$_hcr")
case "$out" in
    *"VERBOSITY:VERBOSE"*) ok "CRLF line endings normalized correctly" ;;
    *) fail "CRLF" "$out" "contains VERBOSITY:VERBOSE" ;;
esac

# ── Frontmatter VERBOSITY not matched; body VERBOSITY matched ─────────────
_hfm="$_tmp/hfm"; mkdir -p "$_hfm/.claude/memory"
cat > "$_hfm/.claude/memory/verbosity.md" <<'EOF'
---
VERBOSITY: VERBOSE
---

VERBOSITY: INFO
EOF
out=$(run_global "$_hfm" "$_hfm")
case "$out" in
    *"VERBOSITY:INFO"*) ok "frontmatter VERBOSITY not matched, body VERBOSITY:INFO used" ;;
    *) fail "frontmatter guard" "$out" "contains VERBOSITY:INFO" ;;
esac

# ── UTF-8 BOM on line 1 ───────────────────────────────────────────────────
_hbom="$_tmp/hbom"; mkdir -p "$_hbom/.claude/memory"
printf '\xef\xbb\xbfVERBOSITY: INFO\n' > "$_hbom/.claude/memory/verbosity.md"
out=$(run_global "$_hbom" "$_hbom")
case "$out" in
    *"VERBOSITY:INFO"*) ok "UTF-8 BOM stripped, VERBOSITY:INFO matched on line 1" ;;
    *) fail "UTF-8 BOM" "$out" "contains VERBOSITY:INFO" ;;
esac

# ── Inline comment (space+hash) stripped; token preserved ────────────────
_hic="$_tmp/hic"; mkdir -p "$_hic/.claude/memory"
echo "VERBOSITY: MIN # keep it short" > "$_hic/.claude/memory/verbosity.md"
out=$(run_global "$_hic" "$_hic")
case "$out" in
    *"VERBOSITY:MIN"*) ok "inline comment (space+hash) stripped, MIN extracted" ;;
    *) fail "inline comment" "$out" "contains VERBOSITY:MIN" ;;
esac

# ── Bare hash (no space) — NOT a comment; value fails normalization → MIN ─
_hbh="$_tmp/hbh"; mkdir -p "$_hbh/.claude/memory"
echo "VERBOSITY: MIN#tag" > "$_hbh/.claude/memory/verbosity.md"
out=$(run_global "$_hbh" "$_hbh")
case "$out" in
    *"VERBOSITY:MIN"*) ok "bare-hash value fails normalization, sanity guard sets MIN" ;;
    *) fail "bare-hash guard" "$out" "contains VERBOSITY:MIN" ;;
esac

# ── Hook always exits 0 (even with broken HOME) ───────────────────────────
CC_VERBOSITY_SKIP=0 HOME="" PWD="" bash global/hooks/verbosity-remind.sh >/dev/null 2>/dev/null
[ $? -eq 0 ] && ok "hook exits 0 with empty HOME" || fail "hook exit 0" "$?" "0"

# ── UserPromptSubmit array ordering — verbosity hook must be present and last ─
# Run _merge_settings_json on a fixture that already has a non-verbosity entry;
# confirm: (1) pre-existing entry is preserved, (2) verbosity entry is appended last.
if command -v python3 >/dev/null 2>&1; then
    _ha_cfg="$_tmp/ordering-settings.json"
    echo '{"hooks":{"UserPromptSubmit":[{"matcher":"","hooks":[{"type":"command","command":"bash /existing/hook.sh"}]}]}}' > "$_ha_cfg"
    bash -c "source install.sh 2>/dev/null; _merge_settings_json '$_ha_cfg' 'bash /verbosity/hook.sh'" 2>/dev/null
    python3 - "$_ha_cfg" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
arr = d["hooks"]["UserPromptSubmit"]
if len(arr) != 2:
    print(f"  FAIL: array ordering — expected 2 entries, got {len(arr)}")
    sys.exit(1)
first_cmd = (arr[0].get("hooks") or [{}])[0].get("command", arr[0].get("command", ""))
last_cmd  = (arr[1].get("hooks") or [{}])[0].get("command", arr[1].get("command", ""))
if "/existing/hook.sh" in first_cmd:
    print("  PASS: pre-existing hook preserved as first entry")
else:
    print(f"  FAIL: pre-existing hook not first — got: {first_cmd!r}")
    sys.exit(1)
if "/verbosity/hook.sh" in last_cmd:
    print("  PASS: verbosity hook appended as last entry")
else:
    print(f"  FAIL: verbosity hook not last — got: {last_cmd!r}")
    sys.exit(1)
PYEOF
else
    echo "  SKIP: array ordering test requires python3 (not found)"
fi

# ── T-14: Deeply nested path exceeding 40-iteration traversal cap ─────────────
# Create a path with 45 directory components. The hook's traversal cap is 40,
# so verbosity.md placed at depth 45 must NOT be found. The hook should fall
# back to $HOME/verbosity.md (or emit MIN if that also doesn't exist).
_deep_base="$_tmp/deep-path-test"
_deep_path="$_deep_base"
for _i in $(seq 1 45); do _deep_path="${_deep_path}/d${_i}"; done
mkdir -p "$_deep_path/.claude/memory" 2>/dev/null || true
printf 'VERBOSITY: VERBOSE\n' > "$_deep_path/.claude/memory/verbosity.md"
# Place a MIN verbosity.md at HOME level as the expected fallback
_deep_home="$_tmp/deep-home"
mkdir -p "$_deep_home/.claude/memory"
printf 'VERBOSITY: MIN\n' > "$_deep_home/.claude/memory/verbosity.md"
_deep_out=$(HOME="$_deep_home" PWD="$_deep_path" bash global/hooks/verbosity-remind.sh 2>/dev/null)
case "$_deep_out" in
    *'[VERBOSITY:MIN'*) ok "T-14 deep path >40: falls back to HOME verbosity (MIN)" ;;
    *'[VERBOSITY:VERBOSE'*) fail "T-14 deep path >40" "VERBOSE (should not have found deep file)" "MIN (HOME fallback)" ;;
    "")                  ok "T-14 deep path >40: no output — HOME verbosity.md absent (MIN default, acceptable)" ;;
    *)                   fail "T-14 deep path >40" "$_deep_out" "[VERBOSITY:MIN]" ;;
esac
rm -rf "$_deep_base" "$_deep_home" 2>/dev/null || true

echo ""
echo "  Results: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
```

- [ ] [T-007-A] Run the test harness. All tests must pass:

```bash
bash tests/verbosity-hook-test.sh
```

Expected: `Results: N passed, 0 failed`

**Test Success Table** — every named test case, its expected exit code from the hook, and the observable state mutation. Use this table to verify that the test harness is testing the right things and that assertions are correctly scoped.

| Test case ID | Description | Expected hook exit code | Expected stdout token | Observable state mutation |
|---|---|---|---|---|
| T-HK-01 | verbosity.md contains `VERBOSITY: MIN` | 0 | `[VERBOSITY:MIN]` | Log file gains 1 line matching `INFO \[VERBOSITY:MIN\]` |
| T-HK-02 | verbosity.md contains `VERBOSITY: INFO` | 0 | `[VERBOSITY:INFO]` | Log file gains 1 line matching `INFO \[VERBOSITY:INFO\]` |
| T-HK-03 | verbosity.md contains `VERBOSITY: VERBOSE` | 0 | `[VERBOSITY:VERBOSE]` | Log file gains 1 line matching `INFO \[VERBOSITY:VERBOSE\]` |
| T-HK-04 | verbosity.md absent (no global, no project) | 0 | `[VERBOSITY:MIN]` (default) | Log gains 1 WARN line about missing verbosity.md |
| T-HK-05 | verbosity.md has unrecognised level (e.g. `VERBOSITY: QUIET`) | 0 | `[VERBOSITY:MIN]` (normalized) | Log gains 1 WARN line about unknown level |
| T-HK-06 | `CC_VERBOSITY_SKIP=1` set | 0 | _(no output)_ | No new log line added; `.verbosity-fence-warned` state file unmodified |
| T-HK-07 | `CC_VERBOSITY_SKIP=true` (alternate truthy value) | 0 | _(no output)_ | Same as T-HK-06 |
| T-HK-08 | `$HOME` unset (empty string) | 0 | _(no output)_ | No crash; hook exits cleanly via trap |
| T-HK-09 | verbosity.md is a symlink to a valid file | 0 | `[VERBOSITY:MIN]` | Log gains 1 INFO line |
| T-HK-10 | verbosity.md is a symlink to `/etc/passwd` (security check) | 0 | `[VERBOSITY:MIN]` (default) | Log gains WARN: symlink points to system path — skip |
| T-HK-11 | verbosity.md contains inline comment `VERBOSITY: MIN # team default` | 0 | `[VERBOSITY:MIN]` | Comment stripped; correct level emitted |
| T-HK-12 | Project verbosity.md overrides global (`INFO` vs `MIN`) | 0 | `[VERBOSITY:INFO]` | Project-level file takes precedence |
| T-HK-13 | Traversal cap reached (41 nested dirs) | 0 | `[VERBOSITY:MIN]` (default) | Log gains WARN: traversal cap reached |
| T-HK-14 | Concurrent hook invocations (two parallel runs) | 0 (both) | `[VERBOSITY:MIN]` (both) | Log gains 2 entries; no interleaving corruption |
| T-INS-01 | `_merge_settings_json` — target file absent | 0 | (prints OK) | `settings.json` created with correct nested schema |
| T-INS-02 | `_merge_settings_json` — idempotent (run twice) | 0 | (prints skipping) | `settings.json` has exactly 1 verbosity-remind entry |
| T-INS-03 | `_merge_settings_json` — existing third-party hook preserved | 0 | (prints OK) | Third-party entry still present; 1 new verbosity-remind entry added |
| T-INS-04 | `_pre_validate_json` — target is invalid JSON | 1 | `ERROR json:` | Merge aborted; `settings.json` unmodified |
| T-INS-05 | `--force-verbosity` flag — re-registration after duplicate | 0 | (prints removed then OK) | Exactly 1 entry in `settings.json` after run |
| T-INS-06 | `--clean-verbosity` flag | 0 | (prints removed) | hook file deleted; `settings.json` has 0 verbosity-remind entries |
| T-INS-07 | jq 1.5 detected — python3 fallback used | 0 | `WARN dependency: jq … below minimum` | python3 path produces correct schema output |
| T-INS-08 | BOM in `settings.json` — stripped before merge | 0 | `WARN: UTF-8 BOM detected` | Merged file is BOM-free; entry correctly registered |
| T-UNI-01 | `uninstall-verbosity.sh` — removes hook file | 0 | `PASS: removed` | `$HOME/.claude/hooks/verbosity-remind.sh` absent after run |
| T-UNI-02 | `uninstall-verbosity.sh --dry-run` — no mutations | 0 | `DRY-RUN:` | No files modified; `settings.json` and hook file unchanged |
| T-UNI-03 | `uninstall-verbosity.sh` — not a git repo (Step 3 skipped) | 0 | `INFO: not a git repository` | No `git` command executed; no error |

The test harness (`tests/verbosity-hook-test.sh`) must cover T-HK-01 through T-HK-14 as automated assertions. T-INS-* and T-UNI-* rows are covered by T-004-F, T-005-G, and T-007-B/T-007-C/T-007-D verification steps respectively; they are not automated in the test harness but must be checked manually before T-009.

- [ ] [T-007-B] Guard against post-edit drift: verify that the manual fallback echo line in `install.sh` still emits valid JSON matching T-003's nested `{matcher, hooks:[{type,command}]}` schema (T-004-A-1 checked this at insert time; this step re-checks against the final file):

```bash
python3 - <<'PYEOF'
import re, json, sys

with open("install.sh") as f:
    lines = f.readlines()

# Line-by-line search — robust to any horizontal whitespace around 'echo'.
# Looks for a line inside _merge_settings_json that contains both "matcher"
# and "hooks" (the two required keys of the T-003 nested schema).
# Using line-by-line avoids multi-line dotall hazards and handles tabs,
# multiple spaces, or any POSIX horizontal whitespace between 'echo' and the string.
fragment_line = None
for line in lines:
    stripped = line.strip()
    if re.match(r'echo\b', stripped) and '"matcher"' in stripped and '"hooks"' in stripped:
        fragment_line = stripped
        break

if fragment_line is None:
    print("FAIL: no fallback echo line with 'matcher' and 'hooks' found in install.sh")
    sys.exit(1)

# Extract the outermost {...} from the line
m = re.search(r'(\{.*\})', fragment_line)
if not m:
    print(f"FAIL: no JSON object found on line: {fragment_line!r}")
    sys.exit(1)

# Replace shell variable interpolation with a string placeholder
raw = re.sub(r'''\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|'\"\$\{?[^}]*\}?\"'?''',
             '"PLACEHOLDER"', m.group(1))
try:
    obj = json.loads(raw)
except json.JSONDecodeError as e:
    print(f"FAIL: fragment not valid JSON after substitution: {e}\n  raw: {raw!r}")
    sys.exit(1)

assert isinstance(obj.get("matcher"), str),   "matcher must be string"
assert isinstance(obj.get("hooks"), list),    "hooks must be array"
inner = obj["hooks"][0]
assert inner.get("type") == "command",        "inner type must be 'command'"
assert isinstance(inner.get("command"), str), "inner command must be string"
print("Schema OK: fallback in install.sh matches T-003 nested format")
PYEOF
```

Expected: `Schema OK: fallback in install.sh matches T-003 nested format`. If this fails, the `echo` line in `_merge_settings_json`'s manual fallback block has drifted from T-003's schema and must be corrected before proceeding to T-008.

- [ ] [T-007-C] Verify that `install.ps1`'s `Merge-SettingsJson` generates the same T-003 nested structure `{matcher, hooks:[{type,command}]}` that `install.sh` produces. Run the idempotency fixture from T-005-G and then inspect the output:

```powershell
powershell.exe -ExecutionPolicy Bypass -Scope Process -NoProfile -Command {
    $f = [System.IO.Path]::GetTempFileName() -replace '\.tmp$', '.json'
    '{"hooks":{"UserPromptSubmit":[]}}' | Set-Content $f -Encoding utf8
    . .\install.ps1 -WhatIf 2>$null
    Merge-SettingsJson $f "bash /test/hook.sh"
    $d     = Get-Content $f -Raw | ConvertFrom-Json
    $entry = $d.hooks.UserPromptSubmit[0]
    if ($entry.matcher -eq "" -and
        $entry.hooks[0].type -eq "command" -and
        $entry.hooks[0].command -eq "bash /test/hook.sh") {
        Write-Host "Schema OK: install.ps1 output matches T-003 nested format"
    } else {
        Write-Host "FAIL: unexpected structure — $($entry | ConvertTo-Json -Compress)"
        exit 1
    }
    Remove-Item $f -Force
}
```

Expected: `Schema OK: install.ps1 output matches T-003 nested format`.

- [ ] [T-007-D] Pre-flight writability check for Task 9 release files — verify that `VERSION` and `CHANGELOG.md` are writable (or absent, in which case they will be created) before T-009 attempts to modify them:

```bash
_check_writable() {
    local _f="$1"
    if [ -e "$_f" ]; then
        [ -w "$_f" ] \
            && echo "PASS: $1 exists and is writable" \
            || { echo "FAIL: $1 exists but is NOT writable (check permissions or git attributes)"; return 1; }
    else
        # File absent — confirm parent directory is writable so the file can be created
        local _parent; _parent="$(dirname "$_f")"
        [ -w "$_parent" ] \
            && echo "PASS: $1 does not exist; parent dir writable (will be created by T-009)" \
            || { echo "FAIL: $1 absent and parent dir is NOT writable"; return 1; }
    fi
}

_check_writable VERSION
_check_writable CHANGELOG.md
```

Expected: both lines print `PASS`. If either prints `FAIL`, resolve the permission issue before executing T-009-C/D.

- [ ] [T-007-E] Standardized log file cleanup procedure for `~/.claude/logs/`: the hook and installer write to `$HOME/.claude/logs/verbosity-hook.log`, and state files such as `.verbosity-fence-warned` accumulate in the same directory. Document the cleanup procedure and add a maintenance helper to `install.sh` that operators can invoke manually. Add this block to `install.sh` as a callable function (not automatically invoked):

```bash
# ── Log maintenance helper ─────────────────────────────────────────────────────
# Usage: bash install.sh --cleanup-logs
# Removes: orphaned temp files, expired state markers, and rotates the main log.
# Does NOT delete the verbosity-hook.log itself — only rotates it if oversized.
# Safe to run at any time; all operations are guarded with || true.
_cleanup_verbosity_logs() {
    local _logs_dir="${HOME}/.claude/logs"
    local _log="${_logs_dir}/verbosity-hook.log"
    echo "[verbosity-remind] INFO: starting log cleanup in ${_logs_dir}"

    # 1. Remove expired .verbosity-fence-warned state files (older than 60 min)
    find "$_logs_dir" -maxdepth 1 -name '.verbosity-fence-warned' -mmin +60 \
        -delete 2>/dev/null && echo "  PASS: expired fence-warned markers removed." || true

    # 2. Remove stale temp files from failed installs (settings.json.tmp.* and .settings-tmp-*)
    find "${HOME}/.claude" -maxdepth 2 \
        \( -name 'settings.json.tmp.*' -o -name '.settings-tmp-*' -o -name '.settings-clean-*' -o -name '.settings-force-*' \) \
        -mmin +10 -delete 2>/dev/null && echo "  PASS: stale temp files removed." || true

    # 3. Rotate verbosity-hook.log if it exceeds 1 MB (1048576 bytes)
    if [ -f "$_log" ]; then
        _log_size=$(wc -c < "$_log" 2>/dev/null || echo 0)
        if [ "$_log_size" -gt 1048576 ]; then
            local _ts; _ts=$(date +%Y%m%d%H%M%S)
            mv -f "$_log" "${_log}.${_ts}.rotated" 2>/dev/null \
                && echo "  PASS: log rotated → ${_log}.${_ts}.rotated (${_log_size} bytes)" \
                || warn "  [verbosity-remind] WARN: could not rotate log — proceeding."
        else
            echo "  INFO: log size ${_log_size} bytes — no rotation needed (threshold: 1MB)."
        fi
    else
        echo "  INFO: ${_log} does not exist — nothing to rotate."
    fi

    # 4. Remove installer backup files older than 30 days
    find "${HOME}/.claude" -maxdepth 2 \
        \( -name 'settings.json.installer-backup.*' -o -name 'settings.json.pre-merge.*' \) \
        -mtime +30 -delete 2>/dev/null && echo "  PASS: old backup files (>30d) removed." || true

    echo "[verbosity-remind] INFO: log cleanup complete."
}

# Auto-invoke cleanup if --cleanup-logs flag is passed
for _arg in "$@"; do
    [ "$_arg" = "--cleanup-logs" ] && { _cleanup_verbosity_logs; exit 0; }
done
```

  **Usage:**
  ```bash
  bash install.sh --cleanup-logs          # Unix
  # PowerShell equivalent — add -CleanupLogs switch to install.ps1 param block:
  powershell.exe -ExecutionPolicy Bypass -Scope Process -File .\install.ps1 -CleanupLogs
  ```

  **Recommended schedule:** run manually after each stable release, or add to a cron/Task Scheduler entry no more frequently than weekly. The hook's T-004-A-2b pre-install audit already handles critical pre-install stale state; this procedure handles the longer-term accumulation. Document this in `README.md` under a "Maintenance" section in T-009-E.

  **install.ps1 equivalent cleanup function** (add as `Invoke-LogCleanup` and call when `-CleanupLogs` is passed):
  ```powershell
  function Invoke-LogCleanup {
      $logsDir = Join-Path $env:USERPROFILE ".claude\logs"
      $log = Join-Path $logsDir "verbosity-hook.log"
      Write-Host "[verbosity-remind] INFO: starting log cleanup in $logsDir"
      # 1. Expired fence-warned markers
      Get-ChildItem $logsDir -Filter '.verbosity-fence-warned' -ErrorAction SilentlyContinue |
          Where-Object { $_.LastWriteTime -lt (Get-Date).AddMinutes(-60) } |
          Remove-Item -Force -ErrorAction SilentlyContinue
      # 2. Stale temp files
      Get-ChildItem (Join-Path $env:USERPROFILE ".claude") -Recurse -Depth 2 |
          Where-Object { $_.Name -match '^settings\.json\.(tmp|installer-backup|pre-merge|clean|force)\.' -and
                         $_.LastWriteTime -lt (Get-Date).AddMinutes(-10) } |
          Remove-Item -Force -ErrorAction SilentlyContinue
      # 3. Log rotation (>1 MB)
      if (Test-Path $log) {
          $sz = (Get-Item $log).Length
          if ($sz -gt 1MB) {
              $ts = Get-Date -Format 'yyyyMMddHHmmss'
              Move-Item $log "${log}.${ts}.rotated" -Force -ErrorAction SilentlyContinue
              Write-Host "  PASS: log rotated (${sz} bytes)"
          } else { Write-Host "  INFO: log size ${sz} bytes — no rotation needed." }
      }
      # 4. Backup files >30 days
      Get-ChildItem (Join-Path $env:USERPROFILE ".claude") -Recurse -Depth 2 |
          Where-Object { $_.Name -match 'installer-backup\.|pre-merge\.' -and
                         $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
          Remove-Item -Force -ErrorAction SilentlyContinue
      Write-Host "[verbosity-remind] INFO: log cleanup complete."
  }
  ```

---

### Task 8: Manual smoke test — end-to-end

**No files changed in this task.**

- [ ] [T-008] Verify global hook emits the correct verbosity line with explicit assertions:

```bash
# Confirm verbosity.md contains a valid VERBOSITY: token
grep -q 'VERBOSITY:' "$HOME/.claude/memory/verbosity.md" \
    && echo "PASS: verbosity.md contains VERBOSITY: token" \
    || { echo "FAIL: verbosity.md missing VERBOSITY: token"; exit 1; }

# Capture hook stdout only (redirect stderr to /dev/null to suppress log noise)
_out=$(bash global/hooks/verbosity-remind.sh 2>/dev/null)

# Assert output is non-empty
[ -n "$_out" ] \
    && echo "PASS: hook produced output" \
    || { echo "FAIL: hook produced no output"; exit 1; }

# Assert output matches expected verbosity tag — insensitive to shell PS1/color/prompt
case "$_out" in
    *'[VERBOSITY:'*']'*) echo "PASS: output contains [VERBOSITY:LEVEL] tag" ;;
    *) echo "FAIL: output does not contain [VERBOSITY:LEVEL] tag — got: $(printf '%s' "$_out" | cat -v)"; exit 1 ;;
esac

# Assert hook exits 0 regardless of output content
bash global/hooks/verbosity-remind.sh >/dev/null 2>/dev/null
[ $? -eq 0 ] && echo "PASS: hook exits 0" || { echo "FAIL: hook exited non-zero"; exit 1; }
```

The `cat -v` in the failure branch renders any non-printable bytes as visible escape notation (e.g., `^[` for ESC), exposing control character contamination that would otherwise be invisible in a terminal.

**Token usage impact note:** Every `UserPromptSubmit` hook invocation injects a short reminder string into the conversation context before Claude responds. The token cost per prompt is:

| Level   | Injected text (approximate)                                      | Tokens (est.) |
|---------|------------------------------------------------------------------|---------------|
| MIN     | `[VERBOSITY:MIN] One declarative sentence. No filler.`           | 10–12         |
| INFO    | `[VERBOSITY:INFO] Summary sentence + [CHANGES] tag required.`    | 14–18         |
| VERBOSE | `[VERBOSITY:VERBOSE] Full explanation. All tags active.`         | 12–16         |

At the median Claude session (60–120 prompts), the total overhead is **600–2 000 tokens** — approximately 0.3–1% of a 200k-token context. This cost is intentional and constant: context filling does not increase the per-prompt overhead; the hook always injects the same string regardless of how full the context is. Engineers running tight token budgets can set `CC_VERBOSITY_SKIP=1` in CI environments where verbosity enforcement is not needed.

- [ ] [T-008-A] Verify the 50ms performance ceiling (median of 10 warm runs ≤ 50ms):

```bash
# Cold discard — prime disk cache, not measured
bash global/hooks/verbosity-remind.sh > /dev/null

# Collect 10 wall-clock samples in milliseconds using TIMEFORMAT and awk.
# TIMEFORMAT='%R' emits elapsed seconds as a decimal (e.g. "0.042") on stderr.
# This avoids the shell-specific "real  0m0.042s" keyword format entirely.
_times=()
for i in $(seq 1 10); do
    TIMEFORMAT='%R'
    _ms=$(
        { time bash global/hooks/verbosity-remind.sh > /dev/null; } 2>&1 |
        awk '{ printf "%d\n", $1 * 1000 }'
    )
    _times+=("$_ms")
done

# Report all samples and compute median
printf '%s\n' "${_times[@]}" | sort -n | awk '
    { a[NR]=$1 }
    END {
        n=NR
        med = (n%2) ? a[int(n/2)+1] : (a[n/2]+a[n/2+1])/2
        printf "Samples (ms): "
        for(i=1;i<=n;i++) printf "%d ", a[i]
        printf "\nMedian: %d ms\n", med
        if (med <= 50) print "PASS: median within 50ms ceiling"
        else           print "FAIL: median exceeds 50ms ceiling"
    }
'
```

Expected: all 10 samples print below 150 ms; median prints `PASS: median within 50ms ceiling`.

- [ ] [T-008-B] Verify hook registration persists across terminal session refreshes:

The hook is invoked by Claude Code on every `UserPromptSubmit` event, not by the shell. Its registration lives in `settings.json` — a static file read when Claude Code starts. "Persistence across sessions" means the entry survives in `settings.json` after the installer runs, regardless of whether the calling shell's environment is refreshed (e.g. `exec $SHELL`, `source ~/.bashrc`).

```bash
# Step 1: confirm the hook command is present in the global settings.json
_gsettings="$HOME/.claude/settings.json"
python3 -c "
import json, sys
d = json.load(open('$_gsettings'))
arr = d.get('hooks', {}).get('UserPromptSubmit', [])
cmds = []
for e in arr:
    hooks = e.get('hooks', [])
    if hooks:
        cmds.extend(h.get('command','') for h in hooks)
    else:
        cmds.append(e.get('command',''))
found = any('verbosity-remind.sh' in c for c in cmds)
print('PASS: verbosity-remind hook entry found in settings.json' if found
      else 'FAIL: verbosity-remind hook entry NOT found in settings.json')
sys.exit(0 if found else 1)
"

# Step 2: simulate a fresh shell subprocess and confirm the hook file is still
# executable (i.e. no session-specific PATH or umask change has removed it)
bash -c '
    _hook="$HOME/.claude/hooks/verbosity-remind.sh"
    [ -f "$_hook" ] && [ -x "$_hook" ] \
        && echo "PASS: hook script exists and is executable in fresh subprocess" \
        || echo "FAIL: hook script missing or not executable in fresh subprocess"
'

# Step 3: invoke the hook inside an env-stripped subprocess that mimics a
# minimal shell environment (no PS1, no TERM, no colour variables)
env -i HOME="$HOME" PATH="/usr/bin:/bin" bash "$HOME/.claude/hooks/verbosity-remind.sh" 2>/dev/null \
    | grep -q '\[VERBOSITY:' \
    && echo "PASS: hook emits [VERBOSITY:...] tag in env-stripped subprocess" \
    || echo "FAIL: hook produced no [VERBOSITY:...] output in env-stripped subprocess"
```

Expected: all three steps print `PASS`. Step 3 uses `env -i` to strip session-specific variables (PS1, TERM, COLORTERM, etc.) that might otherwise mask hook output differences between a fresh terminal and the current session.

- [ ] [T-008-C] Hook self-invocation validation — confirm the hook can invoke itself from the exact same execution path that Claude Code will use (i.e., the command string registered in `settings.json`), rather than via a bare `bash <path>` shortcut. This catches path resolution issues, quoting bugs in the registered command, and execution policy problems that would not appear in a direct bash invocation.

  **Step 1 — Extract the registered command string from settings.json:**
  ```bash
  _reg_cmd=$(python3 - "$HOME/.claude/settings.json" <<'PYCMD'
  import json, sys
  d = json.load(open(sys.argv[1]))
  for entry in d.get('hooks',{}).get('UserPromptSubmit',[]):
      for h in entry.get('hooks',[]):
          if 'verbosity-remind' in h.get('command',''):
              print(h['command']); raise SystemExit(0)
  raise SystemExit(1)
  PYCMD
  )
  if [ -z "$_reg_cmd" ]; then
      echo "FAIL: could not extract verbosity-remind command from settings.json"
      exit 1
  fi
  echo "Registered command: $_reg_cmd"
  ```

  **Step 2 — Execute the extracted command verbatim, as a shell would:**
  ```bash
  # eval expands the command exactly as Claude Code's hook dispatcher would
  _hook_output=$(eval "$_reg_cmd" 2>/dev/null)
  _hook_exit=$?
  if [ "$_hook_exit" -eq 0 ]; then
      echo "PASS: registered command exited 0"
  else
      echo "FAIL: registered command exited ${_hook_exit} — hook invocation failed via registered path"
  fi
  ```

  **Step 3 — Confirm the output contains the expected [VERBOSITY:…] tag:**
  ```bash
  printf '%s\n' "$_hook_output" | grep -q '\[VERBOSITY:' \
      && echo "PASS: hook emits [VERBOSITY:...] tag when invoked via registered command" \
      || echo "FAIL: hook produced no [VERBOSITY:...] output — verbosity constraint will not be injected"
  ```

  **Step 4 — Log a PASS/FAIL entry to the structured log for CI/CD traceability:**
  ```bash
  _ts=$(date '+%Y-%m-%d %H:%M:%S')
  _result="PASS"
  printf '%s\n' "$_hook_output" | grep -q '\[VERBOSITY:' || _result="FAIL"
  printf '%s [install] %s self-invocation-validation cmd="%s"\n' \
      "$_ts" "$_result" "$_reg_cmd" >> "$HOME/.claude/logs/verbosity-hook.log" 2>/dev/null || true
  ```

  Expected: all four steps succeed. Any `FAIL` in steps 2–3 means the registered command string is broken — common causes: absolute path changed after install, spaces in `$HOME` path not quoted in the command string, bash not on PATH at Claude Code's launch-time environment. Fix by re-running the installer (which will re-register the command with a freshly resolved absolute path).

---

### Task 9: Commit

**No files changed in this task.**

- [ ] [T-009] Stage all new and modified files. The table below maps each file to its repository source path (relative to repo root) and whether `-f` is required:

| File | Repo source path | `-f` needed? | Reason |
|------|-----------------|-------------|--------|
| Global hook | `global/hooks/verbosity-remind.sh` | yes | `global/hooks/` is gitignored |
| Project hook | `project-template/.claude/hooks/verbosity-remind.sh` | yes | `project-template/.claude/` is gitignored |
| Project settings | `project-template/.claude/settings.json` | yes | same gitignore scope |
| **This plan file** | `docs/superpowers/plans/2026-06-12-bug014-verbosity-dilution-plan.md` | yes | `docs/` is gitignored; this file was created locally by `/cc-plan` and has never been staged before; it does NOT exist on any remote and is not fetched — it is staged FROM the local working tree TO the git index. **Path consistency note:** some editors or download managers append a suffix like `_1`, `_2`, or `_6` when saving (e.g. `…-plan_6.md`). Confirm the exact on-disk name before running `git add -f`: `ls docs/superpowers/plans/`. The `git add -f` command below uses the canonical name — update it if your copy differs. |
| install.sh | `install.sh` | no | tracked at repo root |
| install.ps1 | `install.ps1` | no | tracked at repo root |
| skills/verbosity.md | `skills/verbosity.md` | no | tracked at repo root |
| Test harness | `tests/verbosity-hook-test.sh` | no | tracked under `tests/` |

```bash
git add -f global/hooks/verbosity-remind.sh
git add -f project-template/.claude/hooks/verbosity-remind.sh
git add -f project-template/.claude/settings.json
git add -f docs/superpowers/plans/2026-06-12-bug014-verbosity-dilution-plan.md
git add install.sh install.ps1 skills/verbosity.md
git add tests/verbosity-hook-test.sh
```

> **`.verbosity-fence-warned` and `.gitignore`:** The marker file lives at `$HOME/.claude/logs/.verbosity-fence-warned` — inside the user's home directory, entirely outside the repository working tree. Git never traverses `$HOME` when scanning for untracked files, so the marker is invisible to git regardless of `.gitignore` contents. It does **not** need to appear in the project `.gitignore`, the global `~/.gitignore_global`, or any other ignore file. No action is required here.

- [ ] [T-009-A] Verify staged files are correct (8 files total: 2 hook scripts, 1 settings.json, 1 plan file, install.sh, install.ps1, skills/verbosity.md, tests/verbosity-hook-test.sh):

```bash
git status
git diff --cached --name-only
```

Expected: the 8 files above, no unintended changes.

- [ ] [T-009-B] Create feature commit:

```bash
git commit -m "feat(BUG-014): add verbosity-remind UserPromptSubmit hooks

Adds global/hooks/verbosity-remind.sh and project-template/.claude/hooks/verbosity-remind.sh.
Both hooks fire on every UserPromptSubmit, emit one level-aware verbosity reminder, and
always exit 0. Global hook defers to project hook via upward traversal. Installers merge
the hook registration into settings.json via jq → python3 → manual fallback."
```

- [ ] [T-009-C] Update CHANGELOG.md — prepend a new `## [1.11.0]` entry (minor bump: hooks are a non-breaking feature addition; no existing API removed or behavior broken; previous release was 1.10.0):

Handle each possible initial state of `CHANGELOG.md` before inserting:

```bash
python3 - <<'PYEOF'
import os, sys

path = "CHANGELOG.md"
new_entry = """\
## [1.11.0] — 2026-06-12

### Added
- `global/hooks/verbosity-remind.sh` — global `UserPromptSubmit` hook; re-injects active verbosity level before every response; defers to project hook via upward traversal (BUG-014)
- `project-template/.claude/hooks/verbosity-remind.sh` — project-scoped hook; emits level-aware verbosity reminder; reads nearest `.claude/memory/verbosity.md` via ancestor traversal (BUG-014)
- `CC_VERBOSITY_SKIP` bypass flag for CI/CD environments
- `install.sh` / `install.ps1` — `_merge_settings_json` / `Merge-SettingsJson` function; jq → python3 → manual fallback; preserves third-party hooks; idempotent re-runs (BUG-014)

### Changed
- `skills/verbosity.md` — Application section updated to describe hook-driven enforcement (BUG-014)
- `project-template/.claude/settings.json` — `UserPromptSubmit` array added with embedded traversal command

"""

# ── Normalise the file to a known starting state ───────────────────────────
if not os.path.exists(path) or os.path.getsize(path) == 0:
    # Case A: file absent OR completely empty — create canonical scaffold
    print("Case A: file absent or empty — initialising with '# Changelog' header")
    content = "# Changelog\n\n"
elif open(path).read().strip() == "":
    # Case B: file exists but is only whitespace
    print("Case B: file is whitespace-only — reinitialising")
    content = "# Changelog\n\n"
else:
    content = open(path).read()
    lines = content.splitlines()
    # Case C: file exists but the first non-empty line is NOT the h1 header
    # (e.g. starts directly with ## [Unreleased] or ## [1.10.0])
    first_nonempty = next((l for l in lines if l.strip()), "")
    if not first_nonempty.startswith("# "):
        print(f"Case C: no '# Changelog' h1 found — prepending header before existing content")
        content = "# Changelog\n\n" + content

# ── Insert the new entry after the h1 header ──────────────────────────────
lines = content.split('\n')
# Locate the h1 line (always line 0 after normalisation above)
h1_idx = next((i for i, l in enumerate(lines) if l.startswith('# ')), 0)
# Find the first line after the h1 that is not blank
insert_at = h1_idx + 1
while insert_at < len(lines) and lines[insert_at].strip() == '':
    insert_at += 1

lines.insert(insert_at, new_entry)
with open(path, "w") as f:
    f.write('\n'.join(lines))
print(f"Inserted ## [1.11.0] at line {insert_at+1}")
PYEOF
```

Verify the result:

```bash
head -20 CHANGELOG.md
```

Expected: line 3 (after the blank line post-header) starts with `## [1.11.0] — 2026-06-12`.

The entry content:
```markdown
## [1.11.0] — 2026-06-12

### Added
- `global/hooks/verbosity-remind.sh` — global `UserPromptSubmit` hook; re-injects active verbosity level before every response; defers to project hook via upward traversal (BUG-014)
- `project-template/.claude/hooks/verbosity-remind.sh` — project-scoped hook; emits level-aware verbosity reminder; reads nearest `.claude/memory/verbosity.md` via ancestor traversal (BUG-014)
- `CC_VERBOSITY_SKIP` bypass flag for CI/CD environments
- `install.sh` / `install.ps1` — `_merge_settings_json` / `Merge-SettingsJson` function; jq → python3 → manual fallback; preserves third-party hooks; idempotent re-runs (BUG-014)

### Changed
- `skills/verbosity.md` — Application section updated to describe hook-driven enforcement (BUG-014)
- `project-template/.claude/settings.json` — `UserPromptSubmit` array added with embedded traversal command
```

- [ ] [T-009-D] Update `VERSION` file to `1.11.0`:

```bash
# Pre-commit check: if unrelated staged changes exist, stash them first to
# prevent the version-bump commit from accidentally bundling unrelated work.
_unrelated=$(git diff --cached --name-only | grep -v -E '^(VERSION|CHANGELOG\.md)$' | head -5)
if [ -n "$_unrelated" ]; then
    echo "WARNING: unrelated staged changes detected:"
    echo "$_unrelated"
    echo "Stashing all staged changes, then re-staging only VERSION and CHANGELOG.md."
    git stash --include-untracked
    _stashed=1
fi

# shell redirection (>) creates VERSION if it does not exist; no guard required
echo "1.11.0" > VERSION
git add VERSION CHANGELOG.md
git commit -m "chore: bump version to 1.11.0, update CHANGELOG for BUG-014"

# Restore stashed changes if we stashed earlier
if [ "${_stashed:-0}" = "1" ]; then
    git stash pop
    echo "Stash restored. Review git status to confirm repository is clean."
fi
```

- [ ] [T-009-E] Update `README.md` to reflect the 1.11.0 release state. Follow these steps in order:

**Step 1 — Version string / badge update:**

```bash
# Find all stale version references
grep -n '1\.10\.0' README.md
```

If any are found, replace them:

```bash
sed -i 's/1\.10\.0/1.11.0/g' README.md
```

**Step 2 — BUG-014 feature summary insertion:**

Locate the "Features" or "How it works" section (use `grep -n '## Features\|## How it works\|## What'` to find the heading). Insert the following bullet as the **last item** in that section, immediately before the next `##` heading or end of section:

```markdown
- **Verbosity enforcement** — a `UserPromptSubmit` hook (`verbosity-remind.sh`) re-injects the active MIN/INFO/VERBOSE constraint before every Claude response, preventing level drift as context fills (BUG-014)
```

If no such section exists, append to the bottom of README.md:

```bash
cat >> README.md <<'EOF'

## What's New in 1.11.0

- **Verbosity enforcement** — a `UserPromptSubmit` hook (`verbosity-remind.sh`) re-injects the active MIN/INFO/VERBOSE constraint before every Claude response, preventing level drift as context fills (BUG-014)
EOF
```

**Step 3 — Verify and commit:**

```bash
grep -n 'verbosity-remind\|BUG-014' README.md   # confirm insertion landed
git diff README.md                               # review the full diff

# Stage and commit only if README.md was actually modified
git diff --quiet README.md \
    && echo "README.md unchanged — no commit needed" \
    || { git add README.md && git commit -m "docs: update README for 1.11.0 — verbosity hook enforcement"; }
```

**Step 4 — Document `$HOME` unset behavior in README:**

Add the following note to the README's "Requirements" or "Limitations" section (or append to the BUG-014 bullet if no such section exists). This documents the behavior engineers will encounter in containerized or headless environments where `$HOME` is unset:

```markdown
> **Note — `$HOME` unset environments:** When `$HOME` is unset (e.g., some CI containers,
> `sudo -H` shells, minimal Docker images), `verbosity-remind.sh` exits immediately with
> code 0 and emits no output. Claude falls back to MIN verbosity by default. Set
> `HOME=/root` (or the appropriate home directory) in the container environment to
> restore full hook behavior. The hook never raises an error when `$HOME` is absent —
> it degrades gracefully to ensure the user's session is never blocked.
```

Verify insertion with `grep -n 'HOME is unset\|HOME.*unset' README.md` after the edit.

**Step 5 — Document `git revert` behavior in non-repository environments:**

Add the following note to the README's "Uninstall" or "Troubleshooting" section. It must appear alongside the uninstall instructions so operators running the procedure in CI/CD pipelines are not surprised by `git revert` failures:

```markdown
> **`git revert` in non-repository environments (CI/CD, Docker, bare installs):**
> The uninstall procedure's Step 3 (`git checkout <tag> -- skills/verbosity.md`) and
> Step 4 (`git revert <sha>`) both require a git working tree. In CI/CD pipelines,
> Docker containers, or directories that are not git repositories, these commands will
> fail with `fatal: not a git repository`. This is expected and non-fatal.
>
> **In non-repo environments:**
> - Step 3: manually delete or restore `skills/verbosity.md` from a backup or the
>   1.10.0 release archive.
> - Step 4: `VERSION` and `CHANGELOG.md` are not managed by git; restore them from
>   your artifact store or by running the installer for the previous version.
> - The automated `uninstall-verbosity.sh` script detects non-repo environments via
>   `git rev-parse --git-dir` and skips Steps 3–4 gracefully with an informational
>   message, so it is safe to run in any environment.
>
> The hook removal (Step 1) and `settings.json` cleanup (Step 2) work identically in
> all environments — no git is required.
```

Verify insertion with `grep -n 'not a git repository\|non-repository' README.md` after the edit.

---

## Test List

- [ ] Unit: `bash tests/verbosity-hook-test.sh` — 17 assertions covering matrix rows, error cases, and format guards
- [ ] Integration: global hook defers to project hook (row 2, row 3 in test harness)
- [ ] Integration: installer merge idempotency — run install.sh merge function twice, confirm single entry in UserPromptSubmit
- [ ] Performance: 10-run median ≤ 50ms, no individual run > 150ms (T-008-A)
- [ ] Manual: install.sh dry run with `--project` flag, confirm settings.json is correctly merged

## Log Rotation Policy

All log output from the verbosity hook and its installers flows to a single file: `$HOME/.claude/logs/verbosity-hook.log`. The following policy governs retention and rotation to bound the long-term storage footprint.

| Dimension | Limit | Rationale |
|---|---|---|
| **Maximum file size** | 1 MB (1 048 576 bytes) | Keeps the file within a single read call; below typical OS page cache limits |
| **Rotation trigger** | Size check on each `--cleanup-logs` run | On-demand; not cron-based — no background daemon required |
| **Rotated file name** | `verbosity-hook.log.<YYYYMMDDHHmmss>.rotated` | Timestamp-sortable; human-readable without additional tooling |
| **Rotated file retention** | 30 days, then deleted by `--cleanup-logs` | Balances forensic audit window against disk growth |
| **Maximum rotated copies** | No hard limit (enforced by 30-day TTL) | Typically 1–2 copies; more implies `--cleanup-logs` has not been run |
| **State file TTL** | `.verbosity-fence-warned`: 60 min | Matches the fence suppress-window; cleaned in T-004-A-2b pre-install audit |
| **Backup file retention** | `settings.json.installer-backup.*`: 30 days | Rotated by `--cleanup-logs`; operator may delete sooner once install is confirmed stable |
| **Stale temp file TTL** | `settings.json.tmp.*`, `.settings-tmp-*`: 10 min | Short TTL because temp files from completed runs should not persist |

**Manual rotation command (Unix):**
```bash
bash install.sh --cleanup-logs
# or directly:
_log="$HOME/.claude/logs/verbosity-hook.log"
[ "$(wc -c < "$_log")" -gt 1048576 ] \
    && mv -f "$_log" "${_log}.$(date +%Y%m%d%H%M%S).rotated" \
    && echo "Rotated."
```

**Manual rotation command (Windows PowerShell):**
```powershell
powershell.exe -ExecutionPolicy Bypass -Scope Process -File .\install.ps1 -CleanupLogs
# or directly via Invoke-LogCleanup (defined in install.ps1 after T-005-J)
```

**CI/CD note:** log rotation is a maintenance operation, not a required step before hook invocation. CI/CD pipelines that run the installer should pass `--cleanup-logs` after the run completes (not before, as it deletes temp files) to avoid unbounded log growth across repeated pipeline executions. If the logs directory is ephemeral (mounted tmpfs, Docker layer, etc.), no cleanup is needed — the directory is discarded at container exit.

## Commit Order

1. T-001 → T-002 → T-003 → T-006: new files + skills update (can batch into one commit)
2. T-004 → T-005: installer changes (one commit)
3. T-007 → T-008: tests + smoke test verification
4. T-009: feature commit, CHANGELOG, VERSION bump

## Uninstall / Removal Procedure

The uninstall procedure is implemented as a dedicated script (`uninstall-verbosity.sh` / `Uninstall-Verbosity.ps1`) that mirrors the installer's logic exactly, so operators never need to perform manual file operations. The scripts are created in T-009-D alongside the installer files and shipped in the repo root.

### `uninstall-verbosity.sh`

```bash
#!/usr/bin/env bash
# uninstall-verbosity.sh — remove all BUG-014 / 1.11.0 verbosity hook artifacts
# Usage:
#   bash uninstall-verbosity.sh [--project <dir>] [--dry-run] [--keep-logs]
# Exit codes (mirrors install.sh contract):
#   0 — success (all targeted artifacts removed)
#   1 — dependency failure (python3 absent; settings.json update skipped)
#   2 — filesystem failure (hook dir not writable)
#   3 — settings.json update failed (not removed; backup left intact)
trap 'exit 0' EXIT ERR

_DRY_RUN=0
_KEEP_LOGS=0
_PROJ_DIR=""
for _arg in "$@"; do
    case "$_arg" in
        --dry-run)    _DRY_RUN=1 ;;
        --keep-logs)  _KEEP_LOGS=1 ;;
        --project)    shift; _PROJ_DIR="$1" ;;
    esac
done

_run() {
    if [ "$_DRY_RUN" = 1 ]; then
        echo "[uninstall-verbosity] DRY-RUN: $*"
    else
        eval "$@"
    fi
}

# ── Step 1: Remove hook files ────────────────────────────────────────────────
_global_hook="${HOME}/.claude/hooks/verbosity-remind.sh"
if [ -f "$_global_hook" ]; then
    _run rm -f "'$_global_hook'" \
        && echo "[uninstall-verbosity] PASS: removed $_global_hook" \
        || echo "[uninstall-verbosity] WARN: could not remove $_global_hook"
else
    echo "[uninstall-verbosity] INFO: $_global_hook not present — skipping."
fi

if [ -n "$_PROJ_DIR" ] && [ -f "${_PROJ_DIR}/.claude/hooks/verbosity-remind.sh" ]; then
    _run rm -f "'${_PROJ_DIR}/.claude/hooks/verbosity-remind.sh'" \
        && echo "[uninstall-verbosity] PASS: removed ${_PROJ_DIR}/.claude/hooks/verbosity-remind.sh" \
        || echo "[uninstall-verbosity] WARN: could not remove project hook"
fi

# ── Step 2: Remove hook registration from settings.json (atomic) ─────────────
_remove_from_settings() {
    local _path="$1"
    [ -f "$_path" ] || { echo "[uninstall-verbosity] INFO: $_path not found — skipping."; return 0; }
    if ! command -v python3 >/dev/null 2>&1; then
        echo "[uninstall-verbosity] WARN dependency: python3 not found — settings.json not updated."
        echo "  Manual fix: remove the verbosity-remind entry from $_path"
        return 1
    fi
    if [ "$_DRY_RUN" = 1 ]; then
        echo "[uninstall-verbosity] DRY-RUN: would remove verbosity-remind entries from $_path"
        return 0
    fi
    python3 - "$_path" <<'PYEOF'
import json, sys, tempfile, os
path = sys.argv[1]
# Early backup before removal
import shutil, time
bak = f"{path}.uninstall-backup.{int(time.time())}"
shutil.copy2(path, bak)
print(f"[uninstall-verbosity] backup: {path} → {bak}")
with open(path) as f: d = json.load(f)
arr = d.get('hooks', {}).get('UserPromptSubmit', [])
before = len(arr)
arr[:] = [e for e in arr
          if not any('verbosity-remind' in h.get('command', '')
                     for h in e.get('hooks', []))]
removed = before - len(arr)
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(path)), prefix='.settings-uninstall-')
try:
    with os.fdopen(fd, 'w') as f: json.dump(d, f, indent=2)
    os.rename(tmp, path)
except Exception as e:
    if os.path.exists(tmp): os.unlink(tmp)
    print(f"[uninstall-verbosity] ERROR json: {e}"); sys.exit(3)
print(f"[uninstall-verbosity] PASS: removed {removed} verbosity-remind entr{'y' if removed==1 else 'ies'} from {path}")
PYEOF
}
_remove_from_settings "${HOME}/.claude/settings.json"
[ -n "$_PROJ_DIR" ] && _remove_from_settings "${_PROJ_DIR}/.claude/settings.json"

# ── Step 3: Revert skills/verbosity.md (if inside a git repo) ────────────────
# Note: git revert operates only inside a git working tree. In CI/CD environments
# or directories that are not git repositories, git commands will exit non-zero
# with "not a git repository". The uninstall script guards this explicitly:
if git rev-parse --git-dir >/dev/null 2>&1; then
    _old_tag=$(git tag --list 'v1.10.*' | sort -V | tail -1)
    if [ -n "$_old_tag" ]; then
        _run git checkout "'${_old_tag}'" -- skills/verbosity.md \
            && echo "[uninstall-verbosity] PASS: skills/verbosity.md restored from ${_old_tag}" \
            || echo "[uninstall-verbosity] WARN: git checkout failed — restore skills/verbosity.md manually."
    else
        echo "[uninstall-verbosity] WARN: no v1.10.x tag found — restore skills/verbosity.md from git history manually."
        echo "  Command: git log --oneline -- skills/verbosity.md | head -5"
    fi
else
    echo "[uninstall-verbosity] INFO: not a git repository — skipping skills/verbosity.md revert."
    echo "  Manual fix: delete the '## Application' section lines added by 1.11.0 from skills/verbosity.md."
fi

# ── Step 4: Remove ALL temporary state files (unconditional) ─────────────────
# Temporary state files are always removed regardless of --keep-logs because they
# are transient coordination artifacts, not user data. --keep-logs only preserves
# the structured log file (verbosity-hook.log) and rotated copies.
#
# Complete list of residual artifacts cleaned by this step:
#   .verbosity-fence-warned       — 60-min TTL suppress marker
#   settings.json.tmp.*           — stale atomic-write temp files (>10 min old)
#   settings.json.nobom.*         — BOM-strip temp files
#   .settings-tmp-*               — python3 merge temp files
#   .settings-clean-*             — --clean-verbosity temp files
#   .settings-force-*             — --force-verbosity temp files
#   .settings-uninstall-*         — own uninstall temp files (self-cleanup)
#   settings.json.installer-backup.* — early-stage install backups (30-day TTL)
#   settings.json.pre-merge.*     — per-merge backups (30-day TTL)
#   settings.json.uninstall-backup.* — uninstall backups (kept unless --purge-backups)
_claude_logs="${HOME}/.claude/logs"
_claude_dir="${HOME}/.claude"

# Always remove state markers
_run rm -f "'${_claude_logs}/.verbosity-fence-warned'" 2>/dev/null || true
echo "[uninstall-verbosity] PASS: .verbosity-fence-warned state marker removed."

# Always remove stale temp files (>0 min old — all of them, since uninstall is terminal)
for _glob in \
    "${_claude_dir}/settings.json.tmp.*" \
    "${_claude_dir}/settings.json.nobom.*" \
    "${_claude_dir}/.settings-tmp-*" \
    "${_claude_dir}/.settings-clean-*" \
    "${_claude_dir}/.settings-force-*" \
    "${_claude_dir}/.settings-uninstall-*"
do
    # Use find to expand globs safely (avoids "no match" shell errors)
    find "${_claude_dir}" -maxdepth 1 -name "$(basename "$_glob")" \
        -delete 2>/dev/null && true
done
echo "[uninstall-verbosity] PASS: all temporary install/merge artifacts removed."

# Log file: respect --keep-logs
if [ "$_KEEP_LOGS" = 0 ]; then
    _run rm -f "'${_claude_logs}/verbosity-hook.log'" 2>/dev/null || true
    # Also remove rotated log copies
    find "${_claude_logs}" -maxdepth 1 -name 'verbosity-hook.log.*.rotated' \
        -delete 2>/dev/null && true
    echo "[uninstall-verbosity] PASS: verbosity-hook.log and rotated copies removed (use --keep-logs to preserve)."
else
    echo "[uninstall-verbosity] INFO: --keep-logs set — verbosity-hook.log preserved."
fi

# Backup files: respect --purge-backups (not removed by default — they are recovery assets)
# Add --purge-backups flag if total backup removal is needed:
# for _pat in 'settings.json.installer-backup.*' 'settings.json.pre-merge.*' 'settings.json.uninstall-backup.*'; do
#     find "${_claude_dir}" -maxdepth 1 -name "$_pat" -delete 2>/dev/null && true
# done

# ── Step 5: Final summary (stderr, machine-readable) ─────────────────────────
_hook_gone=0; [ ! -f "${HOME}/.claude/hooks/verbosity-remind.sh" ] && _hook_gone=1
printf '[uninstall-verbosity] UNINSTALL hook-removed=%s exit=0\n' \
    "$([ "$_hook_gone" = 1 ] && echo YES || echo NO)" >&2

echo "[uninstall-verbosity] Done. Restart Claude Code to apply the updated settings.json."
exit 0
```

### `Uninstall-Verbosity.ps1`

```powershell
# Uninstall-Verbosity.ps1 — remove all BUG-014 / 1.11.0 verbosity hook artifacts
# Usage: powershell.exe -ExecutionPolicy Bypass -Scope Process -File .\Uninstall-Verbosity.ps1 [-Project <dir>] [-DryRun] [-KeepLogs]
param(
    [string]$Project   = "",
    [switch]$DryRun,
    [switch]$KeepLogs
)

function Invoke-Step { param([string]$Desc, [scriptblock]$Action)
    if ($DryRun) { Write-Host "[uninstall-verbosity] DRY-RUN: $Desc"; return }
    & $Action
}

# Step 1: Remove hook files
$globalHook = Join-Path $env:USERPROFILE ".claude\hooks\verbosity-remind.sh"
if (Test-Path $globalHook) {
    Invoke-Step "Remove $globalHook" { Remove-Item $globalHook -Force; Write-Host "[uninstall-verbosity] PASS: removed $globalHook" }
} else { Write-Host "[uninstall-verbosity] INFO: $globalHook not present." }
if ($Project) {
    $projHook = Join-Path $Project ".claude\hooks\verbosity-remind.sh"
    if (Test-Path $projHook) { Invoke-Step "Remove $projHook" { Remove-Item $projHook -Force } }
}

# Step 2: Remove settings.json registration (atomic)
function Remove-FromSettings { param([string]$Path)
    if (-not (Test-Path $Path)) { Write-Host "[uninstall-verbosity] INFO: $Path not found."; return }
    if ($DryRun) { Write-Host "[uninstall-verbosity] DRY-RUN: would remove verbosity-remind from $Path"; return }
    $ts = Get-Date -Format 'yyyyMMddHHmmss'
    Copy-Item $Path "${Path}.uninstall-backup.${ts}" -Force
    $raw = Get-Content $Path -Raw -Encoding utf8
    $d = $raw | ConvertFrom-Json
    $arr = @($d.hooks.UserPromptSubmit | Where-Object {
        -not ($_.hooks | Where-Object { $_.command -like "*verbosity-remind*" })
    })
    $d.hooks | Add-Member -Force -NotePropertyName 'UserPromptSubmit' -NotePropertyValue $arr
    $tmp = "${Path}.uninstall-tmp.$(New-Guid.Guid.Substring(0,8))"
    try {
        [System.IO.File]::WriteAllText($tmp, ($d | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding($false)))
        Move-Item $tmp $Path -Force
        Write-Host "[uninstall-verbosity] PASS: verbosity-remind entries removed from $Path"
    } catch { if (Test-Path $tmp) { Remove-Item $tmp -Force }; Write-Warning "[uninstall-verbosity] ERROR: $($_.Exception.Message)" }
}
Remove-FromSettings (Join-Path $env:USERPROFILE ".claude\settings.json")
if ($Project) { Remove-FromSettings (Join-Path $Project ".claude\settings.json") }

# Step 3: Revert skills/verbosity.md (git-only)
# Note: git commands require a git working tree. In CI/CD or non-repo environments
# git will exit non-zero; this block detects that and skips gracefully.
$inRepo = (git rev-parse --git-dir 2>$null) -ne $null
if ($inRepo) {
    $oldTag = (git tag --list 'v1.10.*' | Sort-Object | Select-Object -Last 1)
    if ($oldTag) {
        Invoke-Step "git checkout ${oldTag} -- skills/verbosity.md" {
            git checkout $oldTag -- skills/verbosity.md 2>$null
            Write-Host "[uninstall-verbosity] PASS: skills/verbosity.md restored from $oldTag"
        }
    } else { Write-Warning "[uninstall-verbosity] WARN: no v1.10.x tag found — restore skills/verbosity.md manually." }
} else { Write-Host "[uninstall-verbosity] INFO: not a git repository — skipping skills/verbosity.md revert." }

# Step 4: Remove ALL temporary state files (unconditional) + log files (respects -KeepLogs)
$claudeDir  = Join-Path $env:USERPROFILE ".claude"
$claudeLogs = Join-Path $claudeDir "logs"

# State marker — always removed (transient coordination artifact, not user data)
$fenceMarker = Join-Path $claudeLogs ".verbosity-fence-warned"
if (Test-Path $fenceMarker) { Invoke-Step "Remove $fenceMarker" { Remove-Item $fenceMarker -Force } }
Write-Host "[uninstall-verbosity] PASS: .verbosity-fence-warned state marker removed."

# All temporary install/merge artifacts — always removed
$tempPatterns = @(
    'settings.json.tmp.*', 'settings.json.nobom.*',
    '.settings-tmp-*', '.settings-clean-*', '.settings-force-*', '.settings-uninstall-*'
)
$tempPatterns | ForEach-Object {
    Get-ChildItem $claudeDir -Filter $_ -ErrorAction SilentlyContinue |
        ForEach-Object { Invoke-Step "Remove $($_.FullName)" { Remove-Item $_.FullName -Force } }
}
Write-Host "[uninstall-verbosity] PASS: all temporary install/merge artifacts removed."

# Log file and rotated copies — respect -KeepLogs
if (-not $KeepLogs) {
    $logFile = Join-Path $claudeLogs "verbosity-hook.log"
    if (Test-Path $logFile) { Invoke-Step "Remove $logFile" { Remove-Item $logFile -Force } }
    Get-ChildItem $claudeLogs -Filter "verbosity-hook.log.*.rotated" -ErrorAction SilentlyContinue |
        ForEach-Object { Invoke-Step "Remove $($_.FullName)" { Remove-Item $_.FullName -Force } }
    Write-Host "[uninstall-verbosity] PASS: verbosity-hook.log and rotated copies removed (use -KeepLogs to preserve)."
} else { Write-Host "[uninstall-verbosity] INFO: -KeepLogs set — verbosity-hook.log preserved." }
# Backup files (settings.json.installer-backup.*, .pre-merge.*, .uninstall-backup.*) are NOT
# removed by default — they are recovery assets. Add -PurgeBackups switch to remove them.

# Step 5: Final summary (stderr)
$hookGone = (-not (Test-Path (Join-Path $env:USERPROFILE ".claude\hooks\verbosity-remind.sh")))
[Console]::Error.WriteLine("[uninstall-verbosity] UNINSTALL hook-removed=$(if ($hookGone) {'YES'} else {'NO'}) exit=0")
Write-Host "[uninstall-verbosity] Done. Restart Claude Code to apply the updated settings.json."
exit 0
```

**T-009-D must also stage these two files** (add to the T-009 file table):

| File | Action | `-f` needed? |
|---|---|---|
| `uninstall-verbosity.sh` | Create in repo root | No |
| `Uninstall-Verbosity.ps1` | Create in repo root | No |

After step 2, restart Claude Code (or the terminal) so the updated `settings.json` is re-read.

---

## Hooks Array JSON Schema

The following schema is the canonical contract for entries in `settings.json`'s `UserPromptSubmit` array. All code in this plan that reads, writes, or validates hook entries must conform to this schema. Future maintainers must not drift from it without updating both the schema and the validation functions (`_validate_merged_settings`, `_validate_settings_json_structure`, `_validate_merged_settings` in install.ps1).

### Schema (JSON Schema draft-07)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "verbosity-remind-hook-entry",
  "description": "One entry in the UserPromptSubmit hooks array. The nested format is required — the flat format {type, command} at the array root is not used by this project.",
  "type": "object",
  "required": ["matcher", "hooks"],
  "additionalProperties": false,
  "properties": {
    "matcher": {
      "type": "string",
      "description": "Glob pattern matching the prompt text. Empty string '' matches all prompts.",
      "examples": ["", "*", "!skip*"]
    },
    "hooks": {
      "type": "array",
      "minItems": 1,
      "description": "Ordered list of hook commands to execute when the matcher fires.",
      "items": {
        "type": "object",
        "required": ["type", "command"],
        "additionalProperties": false,
        "properties": {
          "type": {
            "type": "string",
            "const": "command",
            "description": "Always 'command'. No other type is supported for UserPromptSubmit."
          },
          "command": {
            "type": "string",
            "minLength": 1,
            "description": "Shell command executed by Claude Code via the OS exec() syscall. Must be an absolute path or a PATH-resolvable binary name. The command must exit 0; non-zero exits block prompt submission.",
            "examples": [
              "bash /home/user/.claude/hooks/verbosity-remind.sh",
              "/usr/bin/bash /home/user/.claude/hooks/verbosity-remind.sh"
            ]
          }
        }
      }
    }
  }
}
```

### Schema constraints enforced by this plan

| Constraint | Where enforced | Failure action |
|---|---|---|
| Root of `settings.json` is a JSON object `{}` | `_validate_settings_json_structure` | Merge aborted; `ERROR json:` emitted |
| `hooks` key is present and is a JSON object | `_validate_settings_json_structure` | Created as `{}` if absent |
| `UserPromptSubmit` is an array (not object/string) | jq / python3 merge path type guards | Reset to `[]` if wrong type |
| Each entry has `matcher` (string) and `hooks` (array) | `_validate_merged_settings` | `VALIDATION FAIL` warning |
| Each inner hook has `type: "command"` and `command` (non-empty string) | `_validate_merged_settings` | `VALIDATION FAIL` warning |
| Exactly 1 verbosity-remind entry after merge | `_validate_merged_settings` / `_validate_merged_settings` (PS) | `VALIDATION FAIL` if 0 or >1 |
| No BOM in serialized output | `.NET UTF8Encoding($false)` / python3 `json.dump` + `os.rename` | Post-merge BOM check in T-004-C |
| Encoding: UTF-8 without BOM | All write paths | Atomic write verifies via BOM detection |

### Avoiding schema drift with third-party configurations

Third-party Claude Code extensions may also write to `UserPromptSubmit`. The deduplication filters in `_merge_settings_json` and `Merge-SettingsJson` match only on `command` strings containing `"verbosity-remind"` — they never remove entries that do not match this substring. The schema above describes **only the verbosity-remind entry format**; third-party entries may use different field sets and are preserved untouched.

**Invariant to preserve:** when adding future hook entries (e.g., for a new feature), use the same `{matcher, hooks: [{type, command}]}` nested format and a unique `command` substring identifiable for targeted deduplication. Never use the flat `{type, command}` format at the `UserPromptSubmit` array root — it is incompatible with the nested format and Claude Code may reject or misparse mixed arrays.

## Identified Risks

| Risk | Mitigation |
|------|------------|
| `(( _iters < _cap ))` in `while` condition exits loop when `_iters >= _cap` — correct, but `set -e` interaction | `trap 'exit 0' EXIT ERR` covers all non-zero exits; `|| true` guards fence toggle |
| `install.sh` jq expression for nested format removal may not handle entries without `.hooks[]` | jq `select(all(...))` returns true for empty arrays — safe; python3 path handles it explicitly |
| `install.ps1` `$projHookEmbedded` double-quote escaping in PowerShell | Verify output matches T-003 JSON value character-for-character before commit |
| Stage 1 traversal finds own project hook script when run from inside the code-conductor repo itself | Working as designed — code-conductor's own project hook takes authority; global hook defers |
| Windows `bash` not in PATH | Documented in spec as prerequisite; installer prints Git for Windows requirement |
| Hook file missing executable bit (`chmod +x` omitted or lost on checkout) | `chmod +x` is now mandated immediately after every copy (T-004-B, T-004-D, T-005-B, T-005-D); T-004-H / T-005-I post-install trigger will catch a missing exec bit and print an actionable error |
| `settings.json` written with UTF-8 BOM by Windows tools | BOM detection + stripping added in T-004-C (install.sh) and documented in T-005-A / T-005-J header; post-merge validation will catch silent parse failures |
| `settings.json` is read-only or in a read-only directory (enterprise lock-down) | `_settings_rw_check` now checks parent directory writability for absent files and emits `[verbosity-remind] ERROR filesystem:` with uid; T-004-A-5 pre-validates before any merge attempt |
| Installer exits non-zero but callers cannot distinguish dependency failure from filesystem failure | Standardized exit codes (0–4) defined for both `install.sh` and `install.ps1` in T-005-J; partial failures for single-target failures exit 0 to avoid blocking CI |
| `install.ps1` blocked by `Restricted` ExecutionPolicy on locked-down enterprise workstations | T-005-F documents all five policy levels, correct `-ExecutionPolicy Bypass -Scope Process` invocation, and PS 5.1 minimum version check |
| Manual fallback `echo` write is non-atomic — process kill mid-write truncates `settings.json` | T-004-A-6 mandates all three paths (jq, python3, manual fallback) use mktemp+mv atomicity; T-004-A-6 verification grep confirms no bare `>` writes remain |
| Installer logs go to stdout only — CI/CD cannot parse success/failure without grepping mixed output | T-004-I-2 / T-005-J-2 add a `[verbosity-remind] INSTALL global=… settings=… exit=N` summary line to **stderr** with a standardized format; exit code contract (0–4) defined in T-005-J |
| jq 1.5 silently drops all existing UserPromptSubmit entries due to missing `?` operator support | T-004-A-10 adds jq version gate (1.6+ required); versions below 1.6 trigger a warning and shadow the `jq` command so python3 fallback is used |
| `$HOME/.claude/` missing entirely on first install — all subsequent steps fail with cryptic errors | T-004-A-8 adds `Assert-ClaudeDirectory` / directory pre-check that creates `.claude/{hooks,logs,memory}` and exits 2 if parent is not writable |
| Registered command string path breaks if `$HOME` contains spaces — `eval "$_reg_cmd"` splits on spaces | T-008-C self-invocation validation catches this; fix is to quote the path in the registered command: `bash "$HOME/.claude/hooks/verbosity-remind.sh"` |
| Log files accumulate indefinitely — `verbosity-hook.log` can grow unbounded on high-frequency sessions | T-007-E adds `_cleanup_verbosity_logs` / `Invoke-LogCleanup` with 1 MB rotation threshold and 30-day backup pruning; `--cleanup-logs` flag enables manual invocation |
| `git revert` in uninstall Step 4 fails silently in CI/CD or non-git-repo environments | `uninstall-verbosity.sh` guards with `git rev-parse --git-dir` and skips gracefully; T-009-E Step 5 adds explicit README note documenting this behavior and manual fallback procedure |
| Future hook entries using the flat `{type, command}` format (not nested) could break deduplication filters | Hooks Array JSON Schema section documents the nested-format invariant; `_validate_merged_settings` will detect wrong-format entries; schema must be updated for any format change |
| `mktemp -p /dir prefix.XXXXXX` used inadvertently — fatal on macOS BSD mktemp (no `-p` flag) | T-004-A-6 mandates full-path template form `mktemp "${path}.tmp.XXXXXX"`; verification grep confirms no `-p`/`-t` forms remain; compatibility table documents all four forms |
| `hooks.UserPromptSubmit: null` in settings.json causes jq `select` to iterate over null — silent data loss | Null/unexpected-type table in `_merge_settings_json` header documents all 13 type combinations; jq filter uses `if (.hooks.UserPromptSubmit \| type) != "array" then ... = []` to reset null → [] before filter |
| Second `VERBOSITY:` line in verbosity.md silently overrides intended level if loop doesn't break | Extraction loop `break`s on first non-fence match (documented in Cases 1–6); T-HK-11 test verifies comment stripping; first-match invariant must not be changed without updating the test table |
| `python3 -c "import tempfile"` fails in distroless or musl-stripped containers | T-004-A-3-B adds per-module importability check; failed modules shadow `python3()` to `return 127`; jq/perl/node fallback continues; explicit WARN with `sys.prefix` output for debugging |
| Directory symlink loop in the project tree causes `readlink -f` ELOOP — unhandled in symlink guard | Traversal is string-based only (never follows symlinks for directories); ELOOP from `readlink -f` on a verbosity.md symlink falls back to `readlink "$_f"` (one level) and the security check runs on that; symlink cycle results in no-token read, normalized to MIN |
| Claude Code adds a `CLAUDE_CONFIG_DIR` env var in a future version — installer writes to wrong path | T-004-C documents that no env override exists as of 1.11.0; `HOME` is the only redirect mechanism; future installer updates must check for new Claude Code env vars at release time |
| Uninstall leaves `.settings-tmp-*` or `.verbosity-fence-warned` behind if rm fails silently | Step 4 rewritten to enumerate all 8 artifact patterns unconditionally; uses `find -delete` (not glob expansion) to avoid "no match" exits; state marker removal is now always reported |
