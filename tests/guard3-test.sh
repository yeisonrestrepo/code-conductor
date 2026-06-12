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
  local label="$1" cmd="$2" expect="$3" rc=0
  export CLAUDE_TOOL_NAME="Bash"
  export CLAUDE_TOOL_INPUT="$(_json_cmd "$cmd")"
  bash "$HOOK" >/dev/null 2>&1 && rc=0 || rc=$?
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

# ── Pattern 1: find without/wrong depth ───────────────────────────────────────
run "P1 find . (no depth)"                    'find .'                        "block"
run "P1 find -maxdepth 2"                     'find src/ -maxdepth 2'         "block"
run "P1 find --maxdepth=5"                    'find / --maxdepth=5'           "block"
run "P1 find -maxdepth 1 passes"              'find . -maxdepth 1'            "pass"
run "P1 find --maxdepth=1 passes"             'find . --maxdepth=1'           "pass"
run "P1 find -maxdepth +1 (+ stripped)"       'find . -maxdepth +1'           "pass"
run "P1 find -maxdepth +2 blocked"            'find . -maxdepth +2'           "block"
run "P1 findall not triggered (word-boundary)"  'findall . -maxdepth 5'       "pass"
# ── Pattern 2: find -exec content dump ────────────────────────────────────────
run "P2 find -exec cat"                       'find . -exec cat {} \;'        "block"
run "P2 find -execdir grep"                   'find . -maxdepth 1 -execdir grep -r . {} \;' "block"
run "P2 find -ok sh -c"                       "find . -ok sh -c 'cat {}' \\;" "block"
run "P2 find -exec echo (not a reader)"       'find . -maxdepth 1 -exec echo {} \;' "pass"
# ── Pattern 3: xargs + viewer ─────────────────────────────────────────────────
run "P3 xargs cat"                            'ls | xargs cat'                "block"
run "P3 xargs -0 less"                        'find . | xargs -0 less'        "block"
run "P3 xargs -I {} cat {}"                   'xargs -I {} cat {}'            "block"
run "P3 xargs -d - cat (bare - consumed)"     'xargs -d - cat'                "block"
run "P3 xargs -d -- cat (-- consumed)"        'xargs -d -- cat'               "block"
run "P3 xargs -d -x cat (-x not consumed)"    'xargs -d -x cat'               "block"
run "P3 xargs -i boolean (no extra token)"    'xargs -i cat'                  "block"
run "P3 xargs sh (shell interpreter)"         'find . | xargs sh -c cat'      "block"
run "P3 xargs echo (not a reader)"            'ls | xargs echo'               "pass"

echo ""
echo "Results: $PASS passed, $FAIL failed"
(( FAIL == 0 ))
