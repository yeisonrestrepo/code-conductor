#!/usr/bin/env bash
# code-conductor installer — macOS and Linux
# Usage: curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/code-conductor/main/install.sh | bash
#        bash install.sh --project     (also install project template)
#        bash install.sh --no-deps     (skip dependency installation)
#        bash install.sh --verbosity MIN|INFO|VERBOSE  (response verbosity, default: MIN)

set -euo pipefail

REPO="yeisonrestrepo/code-conductor"
BRANCH="main"
BASE_URL="https://raw.githubusercontent.com/${REPO}/${BRANCH}"
GLOBAL_DIR="${HOME}/.claude"
INSTALL_PROJECT=false
SKIP_DEPS=false
FAILED_DEPS=()
VERBOSITY="MIN"

LOCAL_VERSION_FILE="${GLOBAL_DIR}/memory/conductor-version.md"
LOCAL_VERSION=$([ -f "$LOCAL_VERSION_FILE" ] && cat "$LOCAL_VERSION_FILE" || echo "")

# ── Parse flags ──────────────────────────────────────────────────────────────
for arg in "$@"; do
  case $arg in
    --project|-project) INSTALL_PROJECT=true ;;
    --no-deps)           SKIP_DEPS=true ;;
    --verbosity=*)       VERBOSITY="${arg#*=}" ;;
    --verbosity)         _NEXT_VERB=true ;;
    *)
      if [ "${_NEXT_VERB:-false}" = true ]; then
        VERBOSITY="$arg"
        _NEXT_VERB=false
      fi
      ;;
  esac
done

# ── Verbosity hook flags ──────────────────────────────────────────────────────
_FORCE_REINSTALL=0
_CLEAN_REMOVE=0
for _arg in "$@"; do
    case "$_arg" in
        --force-verbosity) _FORCE_REINSTALL=1 ;;
        --clean-verbosity) _CLEAN_REMOVE=1 ;;
    esac
done

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

# ── Structured installer log ───────────────────────────────────────────────────
# Format: YYYY-MM-DD HH:MM:SS [install] LEVEL message
# Co-located with the hook's log so all events appear in one chronological stream.
# Parse with: grep '\[install\]' ~/.claude/logs/verbosity-hook.log
_install_logfile="${HOME}/.claude/logs/verbosity-hook.log"
_install_log_scope="install"
_install_log() {
    local _level="$1" _msg="$2"
    mkdir -p "${HOME}/.claude/logs" 2>/dev/null || true
    printf '%s [%s] %s %s\n' \
        "$(date '+%Y-%m-%d %H:%M:%S')" \
        "$_install_log_scope" \
        "$_level" \
        "$_msg" >> "$_install_logfile" 2>/dev/null || true
}

ok()   { echo -e "${GREEN}✓${NC} $1"; _install_log "INFO" "$1"; }
warn() { echo -e "${YELLOW}⚠${NC}  $1" >&2; _install_log "WARN" "$1"; }
err()  { echo -e "${RED}✗${NC} $1" >&2; _install_log "ERROR" "$1"; }
info() { echo -e "${BLUE}→${NC} $1"; }

case $VERBOSITY in
  MIN|INFO|VERBOSE) ;;
  *) warn "Unknown verbosity '${VERBOSITY}', defaulting to MIN"; VERBOSITY="MIN" ;;
esac

# ── Early-exit flags ──────────────────────────────────────────────────────────
for _arg in "$@"; do
  [ "$_arg" = "--cleanup-logs" ] && { _cleanup_verbosity_logs; exit 0; }
done

echo ""
echo "  code-conductor installer"
echo "  ─────────────────────────"
echo ""

REMOTE_VERSION=$(curl -fsSL --max-time 5 "${BASE_URL}/VERSION" 2>/dev/null || echo "")
[ -n "$REMOTE_VERSION" ] && info "v${REMOTE_VERSION}"
if [ -n "$LOCAL_VERSION" ] && [ -n "$REMOTE_VERSION" ] && [ "$LOCAL_VERSION" != "$REMOTE_VERSION" ]; then
  warn "Updating ${LOCAL_VERSION} → ${REMOTE_VERSION}"
fi
{ [ -n "$REMOTE_VERSION" ] || [ -n "$LOCAL_VERSION" ]; } && echo ""

# ── Runtime detection ─────────────────────────────────────────────────────────
HAS_NODE=false
HAS_PYTHON=false
NODE_VERSION=""

if command -v node &>/dev/null; then
  NODE_VERSION=$(node --version | sed 's/v//')
  MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
  if [ "$MAJOR" -ge 18 ]; then
    HAS_NODE=true
    ok "Node.js ${NODE_VERSION} detected"
  else
    warn "Node.js ${NODE_VERSION} found but version 18+ is required"
  fi
fi

if command -v python3 &>/dev/null; then
  HAS_PYTHON=true
  ok "Python 3 detected"
fi

HAS_PYTHON310=false
if [ "$HAS_PYTHON" = true ]; then
  _PY_MINOR=$(python3 -c "import sys; print(sys.version_info.minor)" 2>/dev/null || echo "0")
  _PY_MAJOR=$(python3 -c "import sys; print(sys.version_info.major)" 2>/dev/null || echo "3")
  if [ "$_PY_MAJOR" -ge 3 ] && [ "$_PY_MINOR" -ge 10 ]; then
    HAS_PYTHON310=true
    ok "Python 3.${_PY_MINOR} (>=3.10) — Graphify eligible"
  else
    warn "Python 3.${_PY_MINOR} found but Graphify requires 3.10+"
  fi
fi

# ── Auto-install Node if missing ───────────────────────────────────────────────
if [ "$HAS_NODE" = false ]; then
  info "Node.js 18+ not found. Attempting to install..."

  if [[ "$OSTYPE" == "darwin"* ]]; then
    if command -v brew &>/dev/null; then
      info "Installing via Homebrew..."
      brew install node && HAS_NODE=true
    elif command -v nvm &>/dev/null || [ -f "${HOME}/.nvm/nvm.sh" ]; then
      # shellcheck source=/dev/null
      source "${HOME}/.nvm/nvm.sh"
      nvm install --lts && nvm use --lts && HAS_NODE=true
    else
      warn "Neither Homebrew nor nvm found. Install Node.js 18+ manually: https://nodejs.org"
    fi
  else
    if command -v nvm &>/dev/null || [ -f "${HOME}/.nvm/nvm.sh" ]; then
      # shellcheck source=/dev/null
      source "${HOME}/.nvm/nvm.sh"
      nvm install --lts && nvm use --lts && HAS_NODE=true
    elif command -v apt-get &>/dev/null; then
      curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
      sudo apt-get install -y nodejs && HAS_NODE=true
    elif command -v dnf &>/dev/null; then
      sudo dnf install -y nodejs && HAS_NODE=true
    elif command -v pacman &>/dev/null; then
      sudo pacman -Sy --noconfirm nodejs npm && HAS_NODE=true
    else
      warn "Could not detect package manager. Install Node.js 18+ manually: https://nodejs.org"
    fi
  fi
fi

if [ "$HAS_NODE" = false ] && [ "$HAS_PYTHON" = false ]; then
  err "Neither Node.js 18+ nor Python 3 could be installed."
  echo ""
  echo "  Please install at least one:"
  echo "  • Node.js 18+: https://nodejs.org"
  echo "  • Python 3:    https://python.org"
  exit 1
fi

# ── Dependency installation ────────────────────────────────────────────────────
install_dep() {
  local name="$1"
  local cmd="$2"
  info "Installing ${name}..."
  if eval "$cmd"; then
    ok "${name} installed"
  else
    warn "${name} failed — manual install: ${cmd}"
    FAILED_DEPS+=("$name: $cmd")
  fi
}

if [ "$SKIP_DEPS" = false ]; then
  echo ""
  info "Installing dependencies..."
  echo ""

  [ "$HAS_NODE" = true ] && install_dep "claude-mem" "npx --yes claude-mem install"

  if [ "$HAS_NODE" = true ]; then
    _cm_dir=$(find "${HOME}/.claude/plugins/cache/thedotmack/claude-mem" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort -rV | head -1)
    if [ -n "$_cm_dir" ] && [ -f "$_cm_dir/package.json" ]; then
      info "Installing claude-mem dependencies..."
      if npm install --prefix "$_cm_dir" --ignore-scripts --silent; then
        ok "claude-mem dependencies installed"
      else
        warn "claude-mem dependencies failed -- run: npm install --prefix \"$_cm_dir\" --ignore-scripts"
      fi
    fi
  fi

  [ "$HAS_NODE" = true ] && install_dep "uipro-cli"  "npm install -g uipro-cli"

  if command -v claude &>/dev/null; then
    install_dep "Playwright MCP" "claude mcp add playwright npx @playwright/mcp@latest"
    install_dep "Superpowers" "claude plugin install superpowers@claude-plugins-official"
    install_dep "code-simplifier" "claude plugin install code-simplifier@claude-plugins-official"
  fi

  if [ "$HAS_PYTHON310" = true ]; then
    if command -v pipx &>/dev/null; then
      install_dep "Graphify" "pipx install graphifyy && python3 -m graphify install"
    else
      install_dep "Graphify" "pip install graphifyy && python3 -m graphify install"
    fi
  else
    warn "Graphify requires Python 3.10+ — skipped"
    FAILED_DEPS+=("Graphify: pipx install graphifyy && python3 -m graphify install")
  fi

  if ! command -v claude &>/dev/null; then
    warn "claude CLI not found — Playwright MCP, Superpowers, and code-simplifier need the Claude Code CLI"
    FAILED_DEPS+=(
      "Playwright MCP: claude mcp add playwright npx @playwright/mcp@latest"
      "Superpowers: claude plugin install superpowers@claude-plugins-official"
      "code-simplifier: claude plugin install code-simplifier@claude-plugins-official"
    )
  fi
fi

# ── Download helper ────────────────────────────────────────────────────────────
download() {
  local src="$1"
  local dest="$2"
  local overwrite="${3:-true}"

  if [ "$overwrite" = false ] && [ -f "$dest" ]; then
    info "Skipped (already exists): $dest"
    return
  fi

  mkdir -p "$(dirname "$dest")"
  if curl -fsSL "${BASE_URL}/${src}" -o "$dest"; then
    ok "Downloaded: $dest"
  else
    warn "Failed to download: $src"
  fi
}

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

    # 2. Remove stale temp files from failed installs
    find "${HOME}/.claude" -maxdepth 2 \
        \( -name 'settings.json.tmp.*' -o -name '.settings-tmp-*' -o -name '.settings-clean-*' -o -name '.settings-force-*' \) \
        -mmin +10 -delete 2>/dev/null && echo "  PASS: stale temp files removed." || true

    # 3. Rotate verbosity-hook.log if it exceeds 1 MB (1048576 bytes)
    if [ -f "$_log" ]; then
        _log_size=$(wc -c < "$_log" 2>/dev/null || echo 0)
        if [ "$_log_size" -gt 1048576 ]; then
            local _ts; _ts=$(date +%Y%m%d%H%M%S)
            mv -f "$_log" "${_log}.${_ts}.rotated" 2>/dev/null \
                && echo "  PASS: log rotated -> ${_log}.${_ts}.rotated (${_log_size} bytes)" \
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
    os.replace(tmp, path)
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

# ── Pre-flight: bash availability and version ─────────────────────────────────
if ! _bash_path=$(command -v bash 2>/dev/null); then
  echo "FATAL: bash not found on PATH. The hook command 'bash <path>/verbosity-remind.sh'"
  echo "  will fail at runtime. Install bash or add it to PATH before continuing."
  exit 1
fi
echo "PASS: bash found at: $_bash_path"
if [ ! -x "$_bash_path" ]; then
  echo "FATAL: $_bash_path is not executable. Broken symlink or bad permissions."
  exit 1
fi
_bash_ver=$(bash --version 2>/dev/null | head -1)
if [ -z "$_bash_ver" ]; then
  echo "WARN: 'bash --version' produced no output — non-standard bash build."
else
  echo "PASS: $_bash_ver"
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
      exit 1
    fi
  fi
fi
_env_bash=$(env bash -c 'command -v bash' 2>/dev/null)
if [ "$_env_bash" != "$_bash_path" ]; then
  echo "WARN: 'env bash' resolves to '$_env_bash' but PATH bash is '$_bash_path'."
  echo "  The hook shebang (#!/usr/bin/env bash) may use a different bash than expected."
else
  echo "PASS: 'env bash' and PATH bash agree: $_bash_path"
fi

# ── Pre-flight: jq version gate (T-004-A-10) ─────────────────────────────────
# Requires jq 1.6+ for the ? optional operator used in _merge_settings_json.
# jq < 1.6 lacks .hooks[]?.command — shadows jq() to force python3 fallback.
if command -v jq >/dev/null 2>&1; then
    _jq_ver_raw=$(jq --version 2>/dev/null)
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
            jq() { return 127; }
        fi
    else
        warn "[verbosity-remind] WARN: could not parse jq version from '${_jq_ver_raw}' — skipping jq version check."
    fi
else
    echo "INFO: jq not installed — python3 fallback will be used for settings.json merge."
fi

# ── Pre-flight: python3 stdlib module availability (T-004-A-3-B) ─────────────
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
    python3() { return 127; }
  else
    echo "PASS: all required python3 stdlib modules are importable"
  fi
else
  echo "INFO: python3 not found — jq or perl/node fallback will be used for settings.json merge."
fi

# ── Handle --clean-verbosity and --force-verbosity ───────────────────────────
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

# ── .claude/ directory existence and writability pre-check ───────────────────
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

# ── Pre-installation JSON validation ──────────────────────────────────────────
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

# ── Install global files ───────────────────────────────────────────────────────
echo ""
info "Installing global Claude files to ${GLOBAL_DIR}..."
echo ""

mkdir -p "${GLOBAL_DIR}/commands" "${GLOBAL_DIR}/hooks" "${GLOBAL_DIR}/memory"

# User-configured files — skip if exist
download "global/CLAUDE.md"           "${GLOBAL_DIR}/CLAUDE.md"           false
download "global/settings.json"        "${GLOBAL_DIR}/settings.json"        false
download "global/memory/personal.md"   "${GLOBAL_DIR}/memory/personal.md"   false
download "global/hooks/graphify-ast-refresh.py" "${GLOBAL_DIR}/hooks/graphify-ast-refresh.py" false

# ── verbosity-remind.sh: writability + noexec pre-checks then copy ────────────
if [ ! -w "${GLOBAL_DIR}/hooks" ] && [ ! -w "${GLOBAL_DIR}" ]; then
    warn "FATAL: ${GLOBAL_DIR}/hooks is not writable. Cannot install global verbosity hook."
    warn "  Check permissions with: ls -la ${GLOBAL_DIR}"
else
    # noexec mount check
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
    download "global/hooks/verbosity-remind.sh" "${GLOBAL_DIR}/hooks/verbosity-remind.sh"
    chmod +x "${GLOBAL_DIR}/hooks/verbosity-remind.sh"
fi

# Agent-managed files — always overwrite
download "global/commands/cc-checkpoint.md" "${GLOBAL_DIR}/commands/cc-checkpoint.md"
download "global/commands/cc-stack.md"      "${GLOBAL_DIR}/commands/cc-stack.md"
download "global/commands/cc-lang.md"       "${GLOBAL_DIR}/commands/cc-lang.md"
download "global/commands/cc-compact.md"    "${GLOBAL_DIR}/commands/cc-compact.md"
download "skills/code-simplifier.md"    "${GLOBAL_DIR}/skills/code-simplifier.md"
download "skills/critical-review.md"    "${GLOBAL_DIR}/skills/critical-review.md"
download "skills/verbosity.md"          "${GLOBAL_DIR}/skills/verbosity.md"
download "skills/memory-first.md"       "${GLOBAL_DIR}/skills/memory-first.md"
download "skills/agent-delegation.md"   "${GLOBAL_DIR}/skills/agent-delegation.md"


for profile in _base _multi-stack _template javascript typescript python java go rust react angular nextjs nestjs django flask; do
  download "stack-profiles/${profile}.md" "${GLOBAL_DIR}/stack-profiles/${profile}.md"
done

echo "VERBOSITY: ${VERBOSITY}" > "${GLOBAL_DIR}/memory/verbosity.md"
ok "Verbosity set to ${VERBOSITY}"

# ── Global settings.json merge (T-004-C) ──────────────────────────────────────
_settings_rw_check() {
    local _f="$1"
    [ -f "$_f" ] || {
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
_settings_rw_check "${GLOBAL_DIR}/settings.json" || true

# HOME vs python3 home mismatch check
if command -v python3 >/dev/null 2>&1; then
    _py3_home=$(python3 -c "import os; print(os.path.expanduser('~'))" 2>/dev/null)
    if [ -n "$_py3_home" ] && [ "$_py3_home" != "$HOME" ]; then
        warn "WARN: Shell \$HOME='${HOME}' differs from python3 expanduser home='${_py3_home}'."
        warn "  The hook writes logs and reads verbosity.md from \$HOME. If python3 tooling"
        warn "  resolves paths differently, hook output may be inconsistent."
        warn "  Cause: sudo -H, container UID remapping, or WSL USERPROFILE/HOME mismatch."
    fi
fi

# CRLF normalisation of verbosity.md
if [ -f "${GLOBAL_DIR}/memory/verbosity.md" ]; then
    _tmp_vmd=$(mktemp "${GLOBAL_DIR}/memory/verbosity.md.tmp.XXXXXX" 2>/dev/null)
    if [ -n "$_tmp_vmd" ]; then
        tr -d '\r' < "${GLOBAL_DIR}/memory/verbosity.md" > "$_tmp_vmd" \
            && mv -f "$_tmp_vmd" "${GLOBAL_DIR}/memory/verbosity.md" \
            || rm -f "$_tmp_vmd" 2>/dev/null
    fi
fi

# Resolve absolute hook path for embedding in settings.json command string
_hook_abs_path="${HOME}/.claude/hooks/verbosity-remind.sh"
if command -v realpath >/dev/null 2>&1; then
    _hook_abs_path=$(realpath "$_hook_abs_path" 2>/dev/null) || _hook_abs_path="${HOME}/.claude/hooks/verbosity-remind.sh"
elif command -v readlink >/dev/null 2>&1; then
    _hook_abs_path=$(readlink -f "$_hook_abs_path" 2>/dev/null) || _hook_abs_path="${HOME}/.claude/hooks/verbosity-remind.sh"
fi
echo "  [verbosity-remind] hook path (absolute): $_hook_abs_path"
_global_hook_cmd="bash ${_hook_abs_path}"

# BOM detection and strip for settings.json
if [ -f "${GLOBAL_DIR}/settings.json" ]; then
    _bom_check=$(head -c3 "${GLOBAL_DIR}/settings.json" 2>/dev/null | od -An -tx1 | tr -d ' \n')
    if [ "$_bom_check" = "efbbbf" ]; then
        warn "[verbosity-remind] WARN: UTF-8 BOM detected in ${GLOBAL_DIR}/settings.json — stripping before merge."
        _tmp_nobom=$(mktemp "${GLOBAL_DIR}/settings.json.nobom.XXXXXX" 2>/dev/null)
        if [ -n "$_tmp_nobom" ]; then
            tail -c +4 "${GLOBAL_DIR}/settings.json" > "$_tmp_nobom" \
                && mv -f "$_tmp_nobom" "${GLOBAL_DIR}/settings.json" \
                || { rm -f "$_tmp_nobom" 2>/dev/null; warn "[verbosity-remind] ERROR filesystem: BOM strip failed — merge may be unreliable."; }
        fi
    fi
fi

# Remove stale verbosity hook files (T-004-G): if the hook was renamed, old
# copies under the previous name fire no prompt and cause no errors — but they
# silently accumulate. Clean them up before the merge so only the canonical
# name survives.
for _stale in "${GLOBAL_DIR}/hooks/verbosity-"*.sh; do
    [ -f "$_stale" ] || continue
    [ "$_stale" = "${GLOBAL_DIR}/hooks/verbosity-remind.sh" ] && continue
    warn "Removing stale verbosity hook: $_stale"
    rm -f "$_stale" 2>/dev/null || warn "  Could not remove $_stale — remove manually."
done

[ "$_global_json_ok" = "1" ] && _merge_settings_json "${GLOBAL_DIR}/settings.json" "$_global_hook_cmd" \
    || warn "[verbosity-remind] WARN: skipping global settings.json merge — pre-validation failed."

# CC_VERBOSITY_SKIP conflict check
case "${CC_VERBOSITY_SKIP:-0}" in
    1|true|yes|on|TRUE|YES|ON|True|Yes|On)
        warn "WARNING: CC_VERBOSITY_SKIP=${CC_VERBOSITY_SKIP} is set in the current environment."
        warn "  The verbosity-remind hook will exit immediately without injecting any constraint."
        warn "  To enable the hook, unset CC_VERBOSITY_SKIP in your shell profile and restart Claude."
        ;;
esac

# ── Install project template ───────────────────────────────────────────────────
if [ "$INSTALL_PROJECT" = true ]; then
  echo ""
  info "Installing project template into current directory..."
  echo ""

  PROJ_DIR=".claude"
  mkdir -p "${PROJ_DIR}/commands" "${PROJ_DIR}/hooks" "${PROJ_DIR}/memory"

  download "project-template/CLAUDE.md"                  "CLAUDE.md"                            false
  download "project-template/.claude/settings.json"      "${PROJ_DIR}/settings.json"            false
  download "project-template/.claude/memory/project.md"  "${PROJ_DIR}/memory/project.md"        false

  for cmd in cc-init cc-resume cc-spec cc-plan cc-implement cc-review cc-debug cc-refactor cc-test cc-docs; do
    download "project-template/.claude/commands/${cmd}.md" "${PROJ_DIR}/commands/${cmd}.md"
  done

  download "project-template/.claude/hooks/pre-tool-use.sh"  "${PROJ_DIR}/hooks/pre-tool-use.sh"
  download "project-template/.claude/hooks/post-compact.sh"  "${PROJ_DIR}/hooks/post-compact.sh"

  chmod +x "${PROJ_DIR}/hooks/pre-tool-use.sh" "${PROJ_DIR}/hooks/post-compact.sh"

  # ── Project verbosity hook copy and merge (T-004-D) ────────────────────────
  if [ ! -w "${PROJ_DIR}/hooks" ] && [ ! -w "${PROJ_DIR}" ]; then
    warn "FATAL: ${PROJ_DIR}/hooks is not writable. Cannot install project verbosity hook."
    warn "  Check permissions with: ls -la ${PROJ_DIR}"
  else
    download "project-template/.claude/hooks/verbosity-remind.sh" "${PROJ_DIR}/hooks/verbosity-remind.sh"
    chmod +x "${PROJ_DIR}/hooks/verbosity-remind.sh"
    _proj_hook_embedded="bash -c 'set +e; _dir=\"\${PWD:-}\"; _prev=\"\"; _iters=0; while [ \"\$_dir\" != \"\$_prev\" ] && [ \"\$_iters\" -lt 40 ]; do _h=\"\$_dir/.claude/hooks/verbosity-remind.sh\"; [ -f \"\$_h\" ] && [ -r \"\$_h\" ] && { bash \"\$_h\"; exit \$?; }; _prev=\"\$_dir\"; _dir=\"\${_dir%/*}\"; [ -z \"\$_dir\" ] && _dir=/; _iters=\$((\$_iters+1)); done; exit 0'"
    # Remove stale verbosity hook files in the project hooks directory (T-004-G).
    for _stale in "${PROJ_DIR}/hooks/verbosity-"*.sh; do
        [ -f "$_stale" ] || continue
        [ "$_stale" = "${PROJ_DIR}/hooks/verbosity-remind.sh" ] && continue
        warn "Removing stale verbosity hook: $_stale"
        rm -f "$_stale" 2>/dev/null || warn "  Could not remove $_stale — remove manually."
    done
    [ "$_proj_json_ok" = "1" ] && _merge_settings_json "${PROJ_DIR}/settings.json" "$_proj_hook_embedded" \
      || warn "[verbosity-remind] WARN: skipping project settings.json merge — pre-validation failed."
  fi

  if command -v graphify &>/dev/null && command -v claude &>/dev/null; then
    install_dep "Graphify project graph" \
      "graphify . && graphify hook install && claude mcp add graphify 'python -m graphify.serve graphify-out/graph.json'"
  fi

  if command -v uipro &>/dev/null; then
    install_dep "ui-ux-pro-max" "uipro init --ai claude"
  else
    warn "uipro not found — skipped"
    FAILED_DEPS+=("ui-ux-pro-max: npm install -g uipro-cli && uipro init --ai claude")
  fi

  # Update .gitignore
  GITIGNORE=".gitignore"
  ENTRY=".claude/memory/personal.md"
  if [ ! -f "$GITIGNORE" ] || ! grep -qF "$ENTRY" "$GITIGNORE"; then
    echo "$ENTRY" >> "$GITIGNORE"
    ok "Added $ENTRY to .gitignore"
  fi

  # Node.js and npm engine constraint check (FEAT-024)
  if command -v node >/dev/null 2>&1; then
    _node_major=$(node --eval "process.stdout.write(process.versions.node.split('.')[0])" 2>/dev/null)
    # Validate _node_major is purely numeric before arithmetic comparison.
    # nvm/asdf/nvs shell wrappers can inject warnings into stdout, producing
    # a non-numeric or empty value; [ non-numeric -lt 20 ] would error or compare 0.
    case "$_node_major" in
      ''|*[!0-9]*)
        warn "Could not parse Node.js major version (got: '${_node_major:-<empty>}'); a shell wrapper may have corrupted the output; engine check skipped"
        ;;
      *)
        if [ "$_node_major" -lt 20 ]; then
          warn "Node.js $(node --version) is below the >=20 engine requirement; npm test may fail"
        else
          ok "Node.js $(node --version) meets the >=20 engine requirement"
          # npm 10+ ships bundled with Node 20; verify it is present and usable.
          if command -v npm >/dev/null 2>&1; then
            _npm_major=$(npm --version 2>/dev/null | cut -d. -f1)
            case "$_npm_major" in
              ''|*[!0-9]*)
                warn "Could not parse npm version (got: '${_npm_major:-<empty>}'); engine check skipped"
                ;;
              *)
                if [ "$_npm_major" -lt 10 ]; then
                  warn "npm $(npm --version) is below >=10; run 'npm install -g npm@latest' to upgrade"
                else
                  ok "npm $(npm --version) meets the >=10 constraint"
                fi
                ;;
            esac
          else
            warn "npm not found in PATH even though Node >=20 is present; reinstall Node or add npm to PATH"
          fi
        fi
        ;;
    esac
  else
    warn "node not found in PATH - cannot verify >=20 engine requirement; npm test will fail unless Node >=20 is installed"
  fi

  # Pre-commit test gate (FEAT-024)
  if git rev-parse --git-dir >/dev/null 2>&1; then
    _hooks_dir=$(git rev-parse --git-path hooks 2>/dev/null)
    _precommit="${_hooks_dir}/pre-commit"
    _sentinel="# code-conductor:test-gate"
    if [ -n "$_hooks_dir" ]; then
      if grep -qF "$_sentinel" "$_precommit" 2>/dev/null; then
        ok "Pre-commit test gate already present (idempotent)"
      else
        mkdir -p "$_hooks_dir"
        if [ -f "$_precommit" ] && [ ! -w "$_precommit" ]; then
          warn "Pre-commit hook file is not writable ($_precommit); test gate not installed"
        elif [ ! -w "$_hooks_dir" ]; then
          warn "Hooks directory is not writable ($_hooks_dir); test gate not installed"
        else
          [ -f "$_precommit" ] || printf '#!/bin/sh\n' > "$_precommit"
          # Ensure existing content ends with a newline before appending.
          # tail -c 1 | wc -l: returns 1 if last byte is LF, 0 otherwise. Both are POSIX.
          [ -s "$_precommit" ] && [ "$(tail -c 1 "$_precommit" | wc -l)" -eq 0 ] && printf '\n' >> "$_precommit"
          cat >> "$_precommit" <<'HOOK_BLOCK'
# code-conductor:test-gate
command -v npm >/dev/null 2>&1 || { echo "[conductor] npm not found - skipping test gate"; exit 0; }
_root=$(git rev-parse --show-toplevel)
[ -d "$_root/node_modules" ] || { echo "[conductor] node_modules not installed - run npm ci first, skipping test gate"; exit 0; }
cd "$_root" && npm test
# /code-conductor:test-gate
HOOK_BLOCK
          chmod +x "$_precommit"
          ok "Pre-commit test gate appended to $_precommit"
        fi
      fi
    else
      warn "Could not resolve git hooks directory - pre-commit hook not installed"
    fi
  else
    warn "Not in a git repository - pre-commit hook not installed"
  fi
fi

# ── Post-install hook diagnostic (T-004-H) ─────────────────────────────────────
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

# ── Post-install log verification (T-004-I) ─────────────────────────────────────
_logfile="$HOME/.claude/logs/verbosity-hook.log"

_lines_before=$(wc -l < "$_logfile" 2>/dev/null || echo 0)

bash "${HOME}/.claude/hooks/verbosity-remind.sh" > /dev/null 2>&1

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

_last_entry=$(tail -1 "$_logfile" 2>/dev/null || echo "")
if printf '%s' "$_last_entry" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2} \[(global|project|install)\]'; then
    echo "PASS: log entry matches unified format"
else
    echo "INFO: last log line does not match expected format — may be from a prior session"
fi

# ── Final report ───────────────────────────────────────────────────────────────
[ -n "$REMOTE_VERSION" ] && echo "$REMOTE_VERSION" > "$LOCAL_VERSION_FILE"

echo ""
echo "  ─────────────────────────────────────────"
echo "  code-conductor installed"
[ -n "$REMOTE_VERSION" ] && echo "  v${REMOTE_VERSION}"
echo "  ─────────────────────────────────────────"
echo ""
echo "  Global commands (all projects):"
echo "    /cc-checkpoint  /cc-stack  /cc-lang  /cc-compact"
echo ""
if [ "$INSTALL_PROJECT" = true ]; then
  echo "  Project commands (this project):"
  echo "    /cc-init  /cc-resume  /cc-spec  /cc-plan  /cc-review  /cc-debug  /cc-refactor  /cc-test  /cc-docs"
  echo ""
fi

if [ ${#FAILED_DEPS[@]} -gt 0 ]; then
  echo ""
  warn "Some items need manual installation:"
  for item in "${FAILED_DEPS[@]}"; do
    echo "    $item"
  done
fi

echo ""
echo "  To update: re-run the install command"
echo "  Changelog: https://github.com/yeisonrestrepo/code-conductor/blob/main/CHANGELOG.md"
echo ""

# ── Final install summary (stderr, machine-readable) (T-004-I-2) ───────────────
# CI/CD pipelines: capture with 2>&1 | grep '\[verbosity-remind\] INSTALL'
# or redirect stderr separately: bash install.sh 2>install-err.log
_install_exit_code=0
_summary_global="SKIP"
_summary_project="SKIP"

if [ -x "${GLOBAL_DIR}/hooks/verbosity-remind.sh" ]; then
    _summary_global="OK"
else
    _summary_global="FAIL(exec-bit)"
    _install_exit_code=4
fi

if [ "$INSTALL_PROJECT" = true ]; then
    if [ -x "${PROJ_DIR}/hooks/verbosity-remind.sh" ]; then
        _summary_project="OK"
    else
        _summary_project="FAIL(exec-bit)"
        _install_exit_code=4
    fi
fi

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
