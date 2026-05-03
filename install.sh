#!/usr/bin/env bash
# code-conductor installer — macOS and Linux
# Usage: curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/code-conductor/main/install.sh | bash
#        bash install.sh --project     (also install project template)
#        bash install.sh --no-deps     (skip dependency installation)

set -euo pipefail

REPO="YOUR_ORG/code-conductor"
BRANCH="main"
BASE_URL="https://raw.githubusercontent.com/${REPO}/${BRANCH}"
GLOBAL_DIR="${HOME}/.claude"
INSTALL_PROJECT=false
SKIP_DEPS=false
FAILED_DEPS=()

# ── Parse flags ──────────────────────────────────────────────────────────────
for arg in "$@"; do
  case $arg in
    --project|-project) INSTALL_PROJECT=true ;;
    --no-deps)           SKIP_DEPS=true ;;
  esac
done

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC}  $1"; }
err()  { echo -e "${RED}✗${NC} $1"; }
info() { echo -e "${BLUE}→${NC} $1"; }

echo ""
echo "  code-conductor installer"
echo "  ─────────────────────────"
echo ""

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

  if [ "$HAS_NODE" = true ] && [ "$HAS_PYTHON" = true ]; then
    install_dep "ui-ux-pro-max-skill" "npm install -g uipro-cli && uipro init --ai claude --global"
  else
    warn "ui-ux-pro-max-skill requires both Node and Python — skipped"
    FAILED_DEPS+=("ui-ux-pro-max-skill: npm install -g uipro-cli && uipro init --ai claude --global")
  fi

  if command -v claude &>/dev/null; then
    install_dep "Playwright MCP" "claude mcp add playwright npx @playwright/mcp@latest"
    install_dep "Superpowers" "claude plugin install superpowers@claude-plugins-official"
    install_dep "code-simplifier" "claude plugin install code-simplifier@claude-plugins-official"
  else
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
download "global/commands/checkpoint.md" "${GLOBAL_DIR}/commands/checkpoint.md"
download "global/commands/stack.md"      "${GLOBAL_DIR}/commands/stack.md"
download "global/commands/lang.md"       "${GLOBAL_DIR}/commands/lang.md"
download "skills/code-simplifier.md"    "${GLOBAL_DIR}/skills/code-simplifier.md"
download "skills/ui-ux.md"              "${GLOBAL_DIR}/skills/ui-ux.md"

for profile in _base _multi-stack _template javascript typescript python java go rust react angular nextjs nestjs django flask; do
  download "stack-profiles/${profile}.md" "${GLOBAL_DIR}/stack-profiles/${profile}.md"
done

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

  for cmd in spec plan review debug refactor test docs; do
    download "project-template/.claude/commands/${cmd}.md" "${PROJ_DIR}/commands/${cmd}.md"
  done

  download "project-template/.claude/hooks/pre-tool-use.sh"  "${PROJ_DIR}/hooks/pre-tool-use.sh"
  download "project-template/.claude/hooks/post-compact.sh"  "${PROJ_DIR}/hooks/post-compact.sh"

  chmod +x "${PROJ_DIR}/hooks/pre-tool-use.sh" "${PROJ_DIR}/hooks/post-compact.sh"

  # Update .gitignore
  GITIGNORE=".gitignore"
  ENTRY=".claude/memory/personal.md"
  if [ ! -f "$GITIGNORE" ] || ! grep -qF "$ENTRY" "$GITIGNORE"; then
    echo "$ENTRY" >> "$GITIGNORE"
    ok "Added $ENTRY to .gitignore"
  fi
fi

# ── Final report ───────────────────────────────────────────────────────────────
echo ""
echo "  ─────────────────────────────────────────"
echo "  code-conductor installed"
echo "  ─────────────────────────────────────────"
echo ""
echo "  Global commands (all projects):"
echo "    /checkpoint  /stack  /lang"
echo ""
if [ "$INSTALL_PROJECT" = true ]; then
  echo "  Project commands (this project):"
  echo "    /spec  /plan  /review  /debug  /refactor  /test  /docs"
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
