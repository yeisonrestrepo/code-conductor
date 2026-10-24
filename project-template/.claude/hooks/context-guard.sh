#!/usr/bin/env bash
set +e

# Prints the session_id from the UserPromptSubmit stdin JSON, or nothing.
# The key must follow { or , so an escaped "session_id" inside the prompt text never matches.
read_session_id() {
  [ -t 0 ] && return 0
  local _in _re
  _in=$(cat 2>/dev/null)
  _re='[{,][[:space:]]*"session_id"[[:space:]]*:[[:space:]]*"([A-Za-z0-9_-]+)"'
  [[ "$_in" =~ $_re ]] && printf '%s' "${BASH_REMATCH[1]}"
}

# Sets stored_id and count from "<id> <count>" or a legacy bare "<count>".
read_state() {
  local _f1="" _f2=""
  IFS=' ' read -r _f1 _f2 _ < "$1" 2>/dev/null
  _f1="${_f1%$'\r'}"; _f1="${_f1#$'\xef\xbb\xbf'}"; _f2="${_f2%$'\r'}"
  stored_id=""; count=0
  if [ -z "$_f2" ]; then
    [[ "$_f1" =~ ^[0-9]+$ ]] && count=$_f1
    return 0
  fi
  [[ "$_f1" =~ ^[A-Za-z0-9_-]+$ ]] && [[ "$_f2" =~ ^[0-9]+$ ]] && { stored_id=$_f1; count=$_f2; }
}

main() {
  _mem="${CC_PROJECT_ROOT:-.}/.claude/memory"
  if [ -e "$_mem" ] && [ ! -d "$_mem" ]; then exit 0; fi
  mkdir -p "$_mem" 2>/dev/null || exit 0

  # Read threshold
  _thresh=""
  IFS= read -r _thresh < "${_mem}/context-threshold.txt" 2>/dev/null || _thresh=""
  _thresh="${_thresh%$'\r'}"
  _thresh="${_thresh#$'\xef\xbb\xbf'}"
  [[ "$_thresh" =~ ^[1-9][0-9]*$ ]] || _thresh=25
  critical=$_thresh
  warning=$(( (critical * 80) / 100 ))

  # A count left by another session says nothing about this session's context (BUG-056).
  session_id=$(read_session_id)
  read_state "${_mem}/turn-count.txt"
  if [ -n "$session_id" ] && [ "$session_id" != "$stored_id" ]; then count=0; fi
  [ -n "$session_id" ] || session_id=$stored_id

  new_count=$(( count < 99999 ? count + 1 : 99999 ))

  _target="${_mem}/turn-count.txt"
  _tmp="${_mem}/turn-count.txt.tmp"
  printf '%s%d\n' "${session_id:+$session_id }" "$new_count" > "$_tmp" && mv -f "$_tmp" "$_target" \
    || { rm -f "$_tmp" 2>/dev/null; exit 0; }

  [ -n "${CC_GUARD_DEBUG:-}" ] && printf '[context-guard] root=%s session=%s count=%d critical=%d warning=%d\n' \
    "${CC_PROJECT_ROOT:-.}" "$session_id" "$new_count" "$critical" "$warning" >&2

  if [ "$new_count" -ge 99999 ]; then
    printf '🚨 CONTEXT CRITICAL: Turn 99999/%d (counter saturated) — run /cc-compact NOW.\n' "$critical"
  elif [ "$new_count" -ge "$critical" ]; then
    printf '🚨 CONTEXT CRITICAL: Turn %d/%d — run /cc-compact NOW before context overflows.\n' "$new_count" "$critical"
  elif [ "$warning" -gt 0 ] && [ "$new_count" -ge "$warning" ]; then
    printf '⚠ CONTEXT WARNING: Turn %d/%d — consider running /cc-compact soon.\n' "$new_count" "$critical"
  fi
}
main || exit 0
