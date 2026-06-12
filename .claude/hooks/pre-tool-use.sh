#!/usr/bin/env bash
# Guards: (1) large-file Read without limit, (2) duplicate file creation.

set -euo pipefail

# ── Guard 1: Large-file Read without limit ─────────────────────────────────────
if [ "${CLAUDE_TOOL_NAME:-}" = "Read" ]; then
  READ_PATH=$(echo "${CLAUDE_TOOL_INPUT:-}" | grep -o '"file_path":"[^"]*"' | head -1 | sed 's/"file_path":"//;s/"//')
  if [ -n "$READ_PATH" ] && [ -f "$READ_PATH" ]; then
    LINE_COUNT=$(wc -l < "$READ_PATH" 2>/dev/null || echo "0")
    HAS_LIMIT=$(echo "${CLAUDE_TOOL_INPUT:-}" | grep -c '"limit"' || true)
    if [ "$LINE_COUNT" -gt 150 ] && [ "$HAS_LIMIT" -eq 0 ]; then
      echo ""
      echo "⛔ LARGE FILE READ BLOCKED"
      echo "   File:  $READ_PATH"
      echo "   Lines: $LINE_COUNT (>150 — no limit specified)"
      echo ""
      echo "   Follow the orchestrator lookup chain:"
      echo "   1. Check claude-mem / project.md"
      echo "   2. Query graphify for structural questions"
      echo "   3. Use Grep/Glob for pattern searches"
      echo "   4. Read with explicit offset + limit"
      echo ""
      exit 1
    fi
  fi
fi

# ── Guard 3 helpers (defined before Guard 3 block; added incrementally per task) ─

# Pure-Bash JSON string extractor. Finds "command":<value> in CLAUDE_TOOL_INPUT
# and unescapes the JSON string without any external tools.
# Outputs the raw shell command string to stdout.
_g3_extract_command() {
  local json="$1"
  # Find the start of the "command" value: skip to after "command":"
  local after="${json#*\"command\"}"    # everything after the key name
  after="${after#*:}"                   # skip colon (and any whitespace before it is gone)
  after="${after#[[:space:]]}"          # trim leading whitespace
  after="${after#\"}"                   # consume opening "
  # Walk character-by-character to the closing unescaped "
  local result="" i=0 len=${#after} ch="" next=""
  while (( i < len )); do
    ch="${after:i:1}"
    if [[ "$ch" == '\' ]]; then
      next="${after:i+1:1}"
      case "$next" in
        '"')  result+='"';    i=$((i+2)) ;;
        '\')  result+='\\';   i=$((i+2)) ;;
        'n')  result+=$'\n';  i=$((i+2)) ;;
        't')  result+=$'\t';  i=$((i+2)) ;;
        'r')  result+=$'\r';  i=$((i+2)) ;;
        '/')  result+='/';    i=$((i+2)) ;;
        *)    result+="$next"; i=$((i+2)) ;;  # other \X: keep X
      esac
    elif [[ "$ch" == '"' ]]; then
      break   # closing double-quote
    else
      result+="$ch"; i=$((i+1))
    fi
  done
  printf '%s' "$result"
}

# ── Guard 3: Bash command scan ─────────────────────────────────────────────────
# BASH_SCAN_ALLOWLIST: exact literal path tokens the guard permits.
# Operators add entries here. Agents must NEVER modify this array.
BASH_SCAN_ALLOWLIST=()

if [ "${CLAUDE_TOOL_NAME:-}" = "Bash" ]; then
  _G3_CMD=$(_g3_extract_command "${CLAUDE_TOOL_INPUT:-}")

  if [ -z "${_G3_CMD:-}" ]; then
    unset _G3_CMD; exit 0
  fi

  # ── Preprocessing and pattern checks added in subsequent tasks ──
  # Placeholder: pass through until preprocessing is wired.
  unset _G3_CMD
fi

# ── Guard 2: Duplicate file creation ──────────────────────────────────────────
FILE_PATH=""
if [ -n "${CLAUDE_TOOL_INPUT:-}" ]; then
  FILE_PATH=$(echo "$CLAUDE_TOOL_INPUT" | grep -o '"path":"[^"]*"' | head -1 | sed 's/"path":"//;s/"//' || true)
fi

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

if [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

LINE_COUNT=$(wc -l < "$FILE_PATH" 2>/dev/null || echo "?")
LAST_MODIFIED=$(date -r "$FILE_PATH" "+%Y-%m-%d %H:%M" 2>/dev/null || stat -c "%y" "$FILE_PATH" 2>/dev/null | cut -d. -f1 || echo "unknown")

echo ""
echo "⚠️  FILE ALREADY EXISTS"
echo "   Path:          $FILE_PATH"
echo "   Lines:         $LINE_COUNT"
echo "   Last modified: $LAST_MODIFIED"
echo ""
echo "   Choose an action:"
echo "   1. Edit the existing file instead of overwriting"
echo "   2. Confirm you want to overwrite (re-issue the command)"
echo "   3. Cancel"
echo ""

exit 1
