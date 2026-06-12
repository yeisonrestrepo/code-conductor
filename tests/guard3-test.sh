#!/usr/bin/env bash
# Guard 3 test harness. Run from repo root: bash tests/guard3-test.sh
set -euo pipefail

HOOK=".claude/hooks/pre-tool-use.sh"
PASS=0; FAIL=0

# Pure-Bash JSON string builder: escapes a raw shell command for embedding in JSON.
_json_cmd() {
  local s="$1"
  s="${s//\\/\\\\}"    # \ -> \\
  s="${s//\"/\\\"}"    # " -> \"
  s="${s//$'\n'/\\n}"  # newline -> \n
  s="${s//$'\t'/\\t}"  # tab -> \t
  s="${s//$'\r'/\\r}"  # CR -> \r
  printf '{"command":"%s"}' "$s"
}

run() {
  local label="$1" cmd="$2" expect="$3"
  export CLAUDE_TOOL_NAME="Bash"
  export CLAUDE_TOOL_INPUT="$(_json_cmd "$cmd")"
  bash "$HOOK" >/dev/null 2>&1; local rc=$?
  unset CLAUDE_TOOL_NAME CLAUDE_TOOL_INPUT
  if { [[ "$expect" == "block" ]] && (( rc != 0 )); } \
  || { [[ "$expect" == "pass"  ]] && (( rc == 0 )); }; then
    echo "  PASS: $label"; PASS=$((PASS+1))
  else
    echo "  FAIL: $label  [expected=$expect rc=$rc]"; FAIL=$((FAIL+1))
  fi
}

# ── Sanity ────────────────────────────────────────────────────────────────────
run "empty command passes"                 ""            "pass"
(
  export CLAUDE_TOOL_NAME="Read"
  export CLAUDE_TOOL_INPUT='{"file_path":"/tmp/x"}'
  bash "$HOOK" >/dev/null 2>&1 \
    && echo "  PASS: Read tool bypasses Guard 3" \
    || echo "  FAIL: Read tool blocked by Guard 3"
)

# ── Preprocessing: line continuation (verified via a later pattern that blocks 'cat')
# After joining, 'cat *.ts' must still appear as a single logical command.
run "continuation joined: cat over two lines"  $'cat \\\n*.ts'   "block"
run "even backslashes: not joined"             $'ls\\\\\ncat *.ts' "block"
run "CRLF continuation normalised"            $'cat \\\r\n*.ts'  "block"

# ── Preprocessing: comment stripping
run "unquoted hash stripped; cat *.ts blocked" 'cat *.ts # safe comment'  "block"
run "hash in double quotes is literal"         'grep "#pat" file.txt'      "pass"
run "hash in single quotes is literal"         "grep '#pat' file.txt"      "pass"
run "backslash-hash in UNQUOTED is literal"    'grep \#pat file.txt'       "pass"

echo ""
echo "Results: $PASS passed, $FAIL failed"
(( FAIL == 0 ))
