#!/usr/bin/env bash
set +e
main() {
  _mem="${CC_PROJECT_ROOT:-.}/.claude/memory"
  if [ -e "$_mem" ] && [ ! -d "$_mem" ]; then exit 0; fi
  mkdir -p "$_mem" 2>/dev/null || exit 0

  _target="${_mem}/turn-count.txt"
  _tmp="${_mem}/turn-count.txt.tmp"
  printf '0\n' > "$_tmp" && mv -f "$_tmp" "$_target" \
    || { rm -f "$_tmp" 2>/dev/null; exit 0; }

  echo ""
  echo "📦 Conversation compacted. Context counter reset to 0."

  _mem_file="${CC_PROJECT_ROOT:-.}/.claude/memory/project.md"
  if [ -f "$_mem_file" ]; then
    _last=$(grep "## Checkpoint" "$_mem_file" | tail -1 || true)
    [ -n "$_last" ] && echo "   Last checkpoint: $_last" \
      || echo "   No checkpoints recorded yet in project.md."
  else
    echo "   No project.md found."
  fi

  echo ""
  echo "   💡 If this session had important decisions or conventions,"
  echo "      run /checkpoint before continuing."

  _cond="${CC_PROJECT_ROOT:-.}/.conductor"
  rm -f "${_cond}/session-id" 2>/dev/null
  rm -f "${_cond}"/session-id.*.tmp 2>/dev/null

  echo ""
}
main || exit 0
