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

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC}  $1"; }
err()  { echo -e "${RED}✗${NC} $1"; }
info() { echo -e "${BLUE}→${NC} $1"; }

case $VERBOSITY in
  MIN|INFO|VERBOSE) ;;
  *) warn "Unknown verbosity '${VERBOSITY}', defaulting to MIN"; VERBOSITY="MIN" ;;
esac

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

# ── Install global files ───────────────────────────────────────────────────────
echo ""
info "Installing global Claude files to ${GLOBAL_DIR}..."
echo ""

mkdir -p "${GLOBAL_DIR}/commands" "${GLOBAL_DIR}/memory"

# User-configured files — skip if exist
download "global/CLAUDE.md"           "${GLOBAL_DIR}/CLAUDE.md"           false
download "global/settings.json"        "${GLOBAL_DIR}/settings.json"        false
download "global/memory/personal.md"   "${GLOBAL_DIR}/memory/personal.md"   false

# Agent-managed files — always overwrite
download "global/commands/cc-checkpoint.md" "${GLOBAL_DIR}/commands/cc-checkpoint.md"
download "global/commands/cc-stack.md"      "${GLOBAL_DIR}/commands/cc-stack.md"
download "global/commands/cc-lang.md"       "${GLOBAL_DIR}/commands/cc-lang.md"
download "skills/code-simplifier.md"    "${GLOBAL_DIR}/skills/code-simplifier.md"
download "skills/critical-review.md"    "${GLOBAL_DIR}/skills/critical-review.md"
download "skills/verbosity.md"          "${GLOBAL_DIR}/skills/verbosity.md"
download "skills/memory-first.md"       "${GLOBAL_DIR}/skills/memory-first.md"
download "skills/agent-delegation.md"   "${GLOBAL_DIR}/skills/agent-delegation.md"

UI_UX_PRO_MAX_URL="https://raw.githubusercontent.com/nextlevelbuilder/ui-ux-pro-max-skill/main/SKILL.md"
UI_UX_PRO_MAX_DEST="${GLOBAL_DIR}/skills/ui-ux-pro-max.md"
mkdir -p "$(dirname "$UI_UX_PRO_MAX_DEST")"
if curl -fsSL --max-time 10 "$UI_UX_PRO_MAX_URL" -o "$UI_UX_PRO_MAX_DEST"; then
  ok "Downloaded: ui-ux-pro-max skill"
else
  warn "ui-ux-pro-max skill download failed — install manually from https://github.com/nextlevelbuilder/ui-ux-pro-max-skill"
  FAILED_DEPS+=("ui-ux-pro-max: curl -fsSL ${UI_UX_PRO_MAX_URL} -o ${UI_UX_PRO_MAX_DEST}")
fi

for profile in _base _multi-stack _template javascript typescript python java go rust react angular nextjs nestjs django flask; do
  download "stack-profiles/${profile}.md" "${GLOBAL_DIR}/stack-profiles/${profile}.md"
done

echo "VERBOSITY: ${VERBOSITY}" > "${GLOBAL_DIR}/memory/verbosity.md"
ok "Verbosity set to ${VERBOSITY}"

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

  for cmd in cc-init cc-spec cc-plan cc-review cc-debug cc-refactor cc-test cc-docs; do
    download "project-template/.claude/commands/${cmd}.md" "${PROJ_DIR}/commands/${cmd}.md"
  done

  download "project-template/.claude/system-prompt.md" "${PROJ_DIR}/system-prompt.md"

  download "project-template/.claude/hooks/pre-tool-use.sh"  "${PROJ_DIR}/hooks/pre-tool-use.sh"
  download "project-template/.claude/hooks/post-compact.sh"  "${PROJ_DIR}/hooks/post-compact.sh"

  chmod +x "${PROJ_DIR}/hooks/pre-tool-use.sh" "${PROJ_DIR}/hooks/post-compact.sh"

  if command -v graphify &>/dev/null && command -v claude &>/dev/null; then
    install_dep "Graphify project graph" \
      "graphify . && graphify hook install && claude mcp add graphify 'python -m graphify.serve graphify-out/graph.json'"
  fi

  # Update .gitignore
  GITIGNORE=".gitignore"
  ENTRY=".claude/memory/personal.md"
  if [ ! -f "$GITIGNORE" ] || ! grep -qF "$ENTRY" "$GITIGNORE"; then
    echo "$ENTRY" >> "$GITIGNORE"
    ok "Added $ENTRY to .gitignore"
  fi
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
echo "    /cc-checkpoint  /cc-stack  /cc-lang"
echo ""
if [ "$INSTALL_PROJECT" = true ]; then
  echo "  Project commands (this project):"
  echo "    /cc-init  /cc-spec  /cc-plan  /cc-review  /cc-debug  /cc-refactor  /cc-test  /cc-docs"
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
