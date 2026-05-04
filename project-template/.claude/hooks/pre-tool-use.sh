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
