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

# ── Pattern 4: cat + glob ──────────────────────────────────────────────────────
run "P4 cat *.md"                          'cat *.md'                  "block"
run "P4 cat src/**/*.ts"                   'cat src/**/*.ts'           "block"
run "P4 cat dir/??.sh"                     'cat dir/??.sh'             "block"
run "P4 cat {a,b}.ts"                      'cat {a,b}.ts'              "block"
run "P4 cat [abc].md"                      'cat [abc].md'              "block"
run "P4 cat '*.md' (quoted passes)"        "cat '*.md'"                "pass"
run "P4 cat \"*.ts\" (quoted passes)"      'cat "*.ts"'                "pass"
run "P4 cat \\*.ts (escaped passes)"       'cat \*.ts'                 "pass"
run "P4 cat \\\\*.ts (double-bs blocks)"   'cat \\*.ts'                "block"
run "P4 /bin/cat *.md (path-invoked)"      '/bin/cat *.md'             "block"
run "P4 concatenate *.md (word boundary)"  'concatenate *.md'          "pass"
# ── Pattern 5: cmd-subst + reading ────────────────────────────────────────────
run "P5 cat \$(ls)"                        'cat $(ls)'                 "block"
run "P5 cat with backtick"                 'cat `ls`'                  "block"
run "P5 cat src/\$(dir)/main.ts (prefix)"  'cat src/$(dir)/main.ts'   "block"
run "P5 cat \$(root)/pkg.json (exempt)"    'cat "$(git rev-parse --show-toplevel)"/package.json' "pass"
# ── Pattern 6: grep match-all ─────────────────────────────────────────────────
run "P6 grep -r '.*' ."                    "grep -r '.*' ."            "block"
run "P6 egrep -R '' ."                     "egrep -R '' ."             "block"
run "P6 git grep '.*'"                     "git grep '.*'"             "block"
run "P6 git grep '' (empty)"               "git grep ''"               "block"
run "P6 grep -r -F '.*' (fixed-strings)"   "grep -r -F '.*' ."         "pass"
run "P6 grep -r -e foo -e '.*' ."          "grep -r -e foo -e '.*' ."  "block"
run "P6 grep -r --regexp='.*' ."           "grep -r --regexp='.*' ."   "block"
run "P6 grep -r pattern src/ (targeted)"   'grep -r pattern src/'      "pass"
# ── Pattern 7: pager + glob ───────────────────────────────────────────────────
run "P7 less *.ts"                         'less *.ts'                 "block"
run "P7 head *.log"                        'head *.log'                "block"
run "P7 awk '{p}' *.ts"                    "awk '{p}' *.ts"            "block"
run "P7 sed -n p *.md"                     'sed -n p *.md'             "block"
run "P7 less 'file.ts' (quoted passes)"    "less 'file.ts'"            "pass"

# ── Pattern 8: ls -R ──────────────────────────────────────────────────────────
run "P8 ls -R ."                           'ls -R .'                   "block"
run "P8 ls -laR"                           'ls -laR'                   "block"
run "P8 ls --recursive src/"               'ls --recursive src/'       "block"
run "P8 ls -l (no R)"                      'ls -l .'                   "pass"
run "P8 rsync -R (not ls)"                 'rsync -R src/ dest/'       "pass"
# ── Pattern 9: shell loop ─────────────────────────────────────────────────────
run "P9 for f in *.ts"                     'for f in *.ts; do cat $f; done'   "block"
run "P9 while true"                        'while true; do less $f; done'     "block"
run "P9 until false"                       'until false; do grep -r . ; done' "block"
run "P9 for loop non-reader body blocked"  'for f in *.ts; do wc -l $f; done' "block"
run "P9 grep ... while_loop.ts (arg)"      'grep -r pat while_loop.ts'        "pass"
run "P9 cat for (literal filename passes)" 'cat for'                           "pass"
# ── Pattern 10: mapfile / readarray ───────────────────────────────────────────
run "P10 mapfile -t arr"                   'mapfile -t arr < src/main.ts'      "block"
run "P10 readarray lines"                  'readarray lines < *.log'           "block"
# ── Pattern 11: eval / source / dot ──────────────────────────────────────────
run "P11 eval cat"                         'eval "cat *.ts"'                   "block"
run "P11 source dump.sh"                   'source dump.sh'                    "block"
run "P11 . dump.sh (dot operator)"         '. dump.sh'                         "block"
run "P11 ./script.sh (path, not dot op)"   './script.sh'                       "pass"
# ── Pattern 12: alias remapping ──────────────────────────────────────────────
run "P12 alias c=cat"                      "alias c='cat'"                     "block"
run "P12 alias g=grep"                     "alias g='grep -r'"                 "block"
run "P12 alias e=echo (not a reader)"      "alias e='echo'"                    "pass"
# ── Obfuscation detection ─────────────────────────────────────────────────────
run "OBF \$\"cat\" prefix blocked"         '$"cat" *.ts'                       "block"
run "OBF c'a't (internal quote)"           "c'a't *.ts"                        "block"
# ── Edge cases: multi-line scripts ────────────────────────────────────────────
run "multi-line: cat glob on line 2"       $'echo start\ncat *.ts'        "block"
run "multi-line: all safe"                 $'ls -l .\necho done'           "pass"
run "multi-line: for loop on line 2"       $'echo prep\nfor f in *.ts; do echo $f; done' "block"
run "multi-line: continuation joins cat"   $'cat \\\n*.ts'                "block"
run "multi-line: find continuation valid"  $'find . \\\n-maxdepth 1'     "pass"
# ── Edge cases: nested subshells and process substitution ─────────────────────
run "nested: echo \$(cat *.ts)"            'echo $(cat *.ts)'             "block"
run "nested: echo \$(git log)"             'echo $(git log --oneline)'    "pass"
run "nested: sort < <(cat *.ts)"           'sort < <(cat *.ts)'           "block"
run "nested: x=\$((1+2)) safe"             'x=$((1+2)); echo $x'          "pass"
run "nested: wc -l \$(grep -r '.*' .)"     "wc -l \$(grep -r '.*' .)"    "block"
# ── Edge cases: complex quote / escape combinations ───────────────────────────
run "escape: double-backslash-star glob"   'cat \\*.ts'                   "block"
run "escape: single-backslash-star safe"   'cat \*.ts'                    "pass"
run "ansi-c: \$'cat' arg is fine"          "echo \$'cat'"                 "pass"
run "single-quote: backslash then quote"   "grep 'can'\\''t' file"        "pass"
run "nested-quote: outer-dq inner-sq"      'grep "it'\''s fine" file'     "pass"
run "json escape: embedded quote"          'echo "hello \"world\""'       "pass"
run "regex: grep -r specific-re"           'grep -r "fo[o]" src/'         "pass"
run "path-looking: dot in path is allowed" 'grep -r pattern src/main.ts'  "pass"
run "length: 8192-char command (boundary passes)" \
  "$(printf '%0.s#' {1..8192})" "pass"
run "length: 8193-char command (blocked)" \
  "$(printf '%0.s#' {1..8193})" "block"
run "malformed: unclosed single quote"     "cat '*.ts"                    "block"
run "malformed: unclosed double quote"     'grep -r "pat .'               "block"

echo ""
echo "Results: $PASS passed, $FAIL failed"
(( FAIL == 0 ))
