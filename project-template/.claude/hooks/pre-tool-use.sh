#!/usr/bin/env bash
# Blocks duplicate file creation. Triggered before Write/Edit tool calls.

set -euo pipefail

# Extract file path from CLAUDE_TOOL_INPUT env var (JSON)
FILE_PATH=""
if [ -n "${CLAUDE_TOOL_INPUT:-}" ]; then
  FILE_PATH=$(echo "$CLAUDE_TOOL_INPUT" | grep -o '"path":"[^"]*"' | head -1 | sed 's/"path":"//;s/"//')
fi

# If we couldn't extract the path, don't block (fail open)
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# If file doesn't exist, allow the write
if [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

# File exists — print warning and block
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
