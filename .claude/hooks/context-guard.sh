#!/usr/bin/env bash
set +e
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

  # Read count
  _c=""
  IFS= read -r _c < "${_mem}/turn-count.txt" 2>/dev/null || _c=""
  _c="${_c%$'\r'}"
  _c="${_c#$'\xef\xbb\xbf'}"
  [[ "$_c" =~ ^[0-9]+$ ]] || _c=0
  count=$_c

  new_count=$(( count < 99999 ? count + 1 : 99999 ))

  _target="${_mem}/turn-count.txt"
  _tmp="${_mem}/turn-count.txt.tmp"
  printf '%d\n' "$new_count" > "$_tmp" && mv -f "$_tmp" "$_target" \
    || { rm -f "$_tmp" 2>/dev/null; exit 0; }

  [ -n "${CC_GUARD_DEBUG:-}" ] && printf '[context-guard] root=%s count=%d critical=%d warning=%d\n' \
    "${CC_PROJECT_ROOT:-.}" "$new_count" "$critical" "$warning" >&2

  if [ "$new_count" -ge 99999 ]; then
    printf '🚨 CONTEXT CRITICAL: Turn 99999/%d (counter saturated) — run /cc-compact NOW.\n' "$critical"
  elif [ "$new_count" -ge "$critical" ]; then
    printf '🚨 CONTEXT CRITICAL: Turn %d/%d — run /cc-compact NOW before context overflows.\n' "$new_count" "$critical"
  elif [ "$warning" -gt 0 ] && [ "$new_count" -ge "$warning" ]; then
    printf '⚠ CONTEXT WARNING: Turn %d/%d — consider running /cc-compact soon.\n' "$new_count" "$critical"
  fi
}
main || exit 0
