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

_g3_join_continuations() {
  local input="$1" result="" line=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"           # strip trailing CR (CRLF normalisation)
    local tmp="$line" bs=0
    while [[ "$tmp" == *\\ ]]; do tmp="${tmp%\\}"; bs=$((bs+1)); done
    if (( bs % 2 == 1 )); then
      result+="${line%\\} "        # odd backslashes: line continuation
    else
      result+="$line"$'\n'         # even backslashes: real newline
    fi
  done <<< "$input"
  printf '%s' "$result"
}

_g3_scan() {
  # Unified 5-state scanner (UNQUOTED / SINGLE_QUOTED / DOUBLE_QUOTED /
  #   ANSI_C_QUOTED / LOCALE_QUOTED).  Two modes:
  #   "strip" — outputs comment-stripped string to stdout; returns 0 (ok) or 2 (malformed).
  #   "glob"  — returns 1 if an unquoted glob char found, 0 if not, 1 on malformed (fail-closed).
  # Malformed = state != UNQUOTED at end of input (unclosed quote).
  # SINGLE_QUOTED: \ is literal; ANY ' exits (including directly after \).
  local mode="$1" input="$2"
  local state="UNQUOTED" result=""
  local i=0 len=${#input} ch="" two=""
  while (( i < len )); do
    ch="${input:i:1}"; two="${input:i:2}"
    case "$state" in
      UNQUOTED)
        if   [[ "$two" == "\$'" ]]; then
          [[ "$mode" == "strip" ]] && result+="$two"
          i=$((i+2)); state="ANSI_C_QUOTED"
        elif [[ "$two" == '$"' ]]; then
          [[ "$mode" == "strip" ]] && result+="$two"
          i=$((i+2)); state="LOCALE_QUOTED"
        elif [[ "$ch" == '\' ]]; then
          [[ "$mode" == "strip" ]] && result+="${input:i:2}"
          i=$((i+2))
        elif [[ "$ch" == "'" ]]; then
          [[ "$mode" == "strip" ]] && result+="$ch"
          i=$((i+1)); state="SINGLE_QUOTED"
        elif [[ "$ch" == '"' ]]; then
          [[ "$mode" == "strip" ]] && result+="$ch"
          i=$((i+1)); state="DOUBLE_QUOTED"
        elif [[ "$ch" == '#' ]] && [[ "$mode" == "strip" ]]; then
          # Comment: discard to end of line (preserve \n as separator)
          while (( i < len )) && [[ "${input:i:1}" != $'\n' ]]; do i=$((i+1)); done
        else
          # Regular UNQUOTED character
          if [[ "$mode" == "glob" ]] && [[ "$ch" =~ [*?{[] ]]; then
            return 1  # unquoted glob found
          fi
          [[ "$mode" == "strip" ]] && result+="$ch"
          i=$((i+1))
        fi ;;
      SINGLE_QUOTED)
        # \ is literal; any ' exits (there is no escape mechanism here)
        [[ "$mode" == "strip" ]] && result+="$ch"
        [[ "$ch" == "'" ]] && state="UNQUOTED"
        i=$((i+1)) ;;
      DOUBLE_QUOTED|LOCALE_QUOTED)
        if [[ "$ch" == '\' ]]; then
          [[ "$mode" == "strip" ]] && result+="${input:i:2}"
          i=$((i+2))
        elif [[ "$ch" == '"' ]]; then
          [[ "$mode" == "strip" ]] && result+="$ch"
          i=$((i+1)); state="UNQUOTED"
        else
          [[ "$mode" == "strip" ]] && result+="$ch"
          i=$((i+1))
        fi ;;
      ANSI_C_QUOTED)
        if [[ "$ch" == '\' ]]; then
          [[ "$mode" == "strip" ]] && result+="${input:i:2}"
          i=$((i+2))
        elif [[ "$ch" == "'" ]]; then
          [[ "$mode" == "strip" ]] && result+="$ch"
          i=$((i+1)); state="UNQUOTED"
        else
          [[ "$mode" == "strip" ]] && result+="$ch"
          i=$((i+1))
        fi ;;
    esac
  done
  # Fail-closed: unclosed quote is malformed input
  if [[ "$state" != "UNQUOTED" ]]; then
    [[ "$mode" == "strip" ]] && { printf '%s' "$result"; return 2; }
    return 1   # glob mode: fail-closed on malformed input
  fi
  [[ "$mode" == "strip" ]] && printf '%s' "$result"
  return 0
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

  # Length guard: fail-closed on oversized input to protect the scanner from abuse
  if (( ${#_G3_CMD} > 8192 )); then
    printf '\n⛔ BASH SCAN BLOCKED\n' >&2
    printf '   Command string exceeds maximum scan length (8192 chars).\n\n' >&2
    unset _G3_CMD; exit 1
  fi

  # Step 4a: join line continuations
  _G3_JOINED=$(_g3_join_continuations "$_G3_CMD")
  unset _G3_CMD

  # Step 4b: strip comments via unified scanner (mode="strip")
  _G3_SCAN_RC=0
  _G3_PRE=$(_g3_scan "strip" "$_G3_JOINED") || _G3_SCAN_RC=$?
  unset _G3_JOINED

  # Fail-closed: malformed input (rc=2 means unclosed quote)
  if (( _G3_SCAN_RC == 2 )); then
    printf '\n⛔ BASH SCAN BLOCKED\n' >&2
    printf '   Malformed shell syntax (unclosed quote) — blocked as a precaution.\n\n' >&2
    unset _G3_PRE; exit 1
  fi

  # Normalise real newlines to semicolons (simplifies all pattern regexes)
  _G3_PRE="${_G3_PRE//$'\n'/;}"

  # ── Pattern checks added in subsequent tasks ──
  # Placeholder: pass through.
  unset _G3_PRE
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
