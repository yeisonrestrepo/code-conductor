#!/usr/bin/env bash
# Reminds the developer to checkpoint after /compact compresses the conversation.

set -euo pipefail

MEMORY_FILE=".claude/memory/project.md"

echo ""
echo "📦 Conversation compacted."

if [ -f "$MEMORY_FILE" ]; then
  LAST_CHECKPOINT=$(grep "## Checkpoint" "$MEMORY_FILE" | tail -1 || echo "")
  if [ -n "$LAST_CHECKPOINT" ]; then
    echo "   Last checkpoint: $LAST_CHECKPOINT"
  else
    echo "   No checkpoints recorded yet in project.md."
  fi
else
  echo "   No project.md found at $MEMORY_FILE."
fi

echo ""
echo "   💡 If this session had important decisions or conventions,"
echo "      run /checkpoint before continuing."
echo ""

exit 0
