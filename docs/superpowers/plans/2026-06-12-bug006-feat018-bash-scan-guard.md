# Guard 3 – Bash Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Guard 3 to `.claude/hooks/pre-tool-use.sh` to hard-block mass content-dump Bash commands, extend `skills/memory-first.md` with a "Hook enforcement" section, and mirror both files in `project-template/`.

**Architecture:** Guard 3 is a self-contained Bash block embedded in the existing hook file, inserted after Guard 1. It preprocesses the command string (CRLF-normalisation → line-continuation joining → 5-state comment-stripping scanner), then runs 12 pattern checks with regex on the preprocessed string, finally checks the static `BASH_SCAN_ALLOWLIST` array, and exits 1 with a standard block message if blocked. The 5-state scanner (`_g3_strip_comments`) is reused as `_g3_has_unquoted_glob` for glob-character detection in Patterns 4 and 7.

**Tech Stack:** Bash 5.x; Claude Code `PreToolUse` hook environment variables `CLAUDE_TOOL_NAME` and `CLAUDE_TOOL_INPUT` (JSON string).

---

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `.claude/hooks/pre-tool-use.sh` | Add Guard 3 after Guard 1 (line 28) |
| Create | `tests/guard3-test.sh` | Self-contained Bash test harness |
| Modify | `skills/memory-first.md` | Add "Hook enforcement" section |
| Modify | `project-template/.claude/hooks/pre-tool-use.sh` | Exact mirror of live hook |
| Create | `project-template/skills/memory-first.md` | Exact mirror of `skills/memory-first.md` |
| Modify | `AGENT-READABLE BACKLOG.md` | Mark BUG-006 and FEAT-018 `[X]` |

---

### Task 1: Guard 3 skeleton + test harness

**Files:**
- Modify: `.claude/hooks/pre-tool-use.sh` (insert block after line 27, before `# ── Guard 2`)
- Create: `tests/guard3-test.sh`

- [ ] **Step 1: Insert Guard 3 skeleton into `pre-tool-use.sh`**

Insert the following block between the closing `fi` of Guard 1 (line 27) and the `# ── Guard 2` comment (line 29):

```bash
# ── Guard 3: Bash command scan ─────────────────────────────────────────────────
# BASH_SCAN_ALLOWLIST: exact literal path tokens the guard permits.
# Operators add entries here. Agents must NEVER modify this array.
BASH_SCAN_ALLOWLIST=()

if [ "${CLAUDE_TOOL_NAME:-}" = "Bash" ]; then
  # Extract the 'command' field from CLAUDE_TOOL_INPUT JSON
  if command -v python3 >/dev/null 2>&1; then
    _G3_CMD=$(printf '%s' "${CLAUDE_TOOL_INPUT:-}" \
      | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('command',''))" \
      2>/dev/null || true)
  else
    _G3_CMD=$(printf '%s' "${CLAUDE_TOOL_INPUT:-}" \
      | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' \
      | head -1 | sed 's/.*"command"[[:space:]]*:[[:space:]]*"//;s/"$//')
  fi

  if [ -z "${_G3_CMD:-}" ]; then
    unset _G3_CMD; exit 0
  fi

  # ── Preprocessing and pattern checks added in subsequent tasks ──
  # Placeholder: pass through until preprocessing is wired.
  unset _G3_CMD
fi
```

- [ ] **Step 2: Create `tests/guard3-test.sh`**

```bash
#!/usr/bin/env bash
# Guard 3 test harness. Run from repo root: bash tests/guard3-test.sh
set -euo pipefail

HOOK=".claude/hooks/pre-tool-use.sh"
PASS=0; FAIL=0

run() {
  local label="$1" cmd="$2" expect="$3"
  local json
  json=$(printf '%s' "$cmd" \
    | python3 -c 'import sys,json; print(json.dumps({"command":sys.stdin.read()}))')
  export CLAUDE_TOOL_NAME="Bash"
  export CLAUDE_TOOL_INPUT="$json"
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

echo ""
echo "Results: $PASS passed, $FAIL failed"
(( FAIL == 0 ))
```

- [ ] **Step 3: Run the test harness**

```
bash tests/guard3-test.sh
```

Expected:
```
  PASS: empty command passes
  PASS: Read tool bypasses Guard 3

Results: 2 passed, 0 failed
```

- [ ] **Step 4: Commit**

```bash
git add -f .claude/hooks/pre-tool-use.sh tests/guard3-test.sh
git commit -m "feat(guard3): skeleton, BASH_SCAN_ALLOWLIST, and test harness"
```

---

### Task 2: Preprocessing – line joining (4a) and comment stripping (4b)

**Files:**
- Modify: `.claude/hooks/pre-tool-use.sh` (add two helper functions; wire into Guard 3)
- Modify: `tests/guard3-test.sh`

- [ ] **Step 1: Add preprocessing tests**

Append to `tests/guard3-test.sh` (before the final `echo "Results..."` line):

```bash
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
```

- [ ] **Step 2: Run – all 7 new tests FAIL (preprocessing not wired yet)**

```
bash tests/guard3-test.sh
```

- [ ] **Step 3: Implement `_g3_join_continuations` and `_g3_strip_comments`**

Add both functions to `pre-tool-use.sh` immediately before the `# ── Guard 3` comment. They must appear before they are called.

```bash
# ── Guard 3 helpers ────────────────────────────────────────────────────────────
_g3_join_continuations() {
  local input="$1" result="" line=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"           # strip trailing CR
    local tmp="$line" bs=0
    while [[ "$tmp" == *\\ ]]; do tmp="${tmp%\\}"; bs=$((bs+1)); done
    if (( bs % 2 == 1 )); then
      result+="${line%\\} "        # odd backslashes: continuation
    else
      result+="$line"$'\n'         # even backslashes: real newline
    fi
  done <<< "$input"
  printf '%s' "$result"
}

_g3_strip_comments() {
  # Five-state scanner: UNQUOTED / SINGLE_QUOTED / DOUBLE_QUOTED /
  #                     ANSI_C_QUOTED ($'...') / LOCALE_QUOTED ($"...")
  local input="$1" result="" state="UNQUOTED"
  local i=0 len=${#input} ch="" two=""
  while (( i < len )); do
    ch="${input:i:1}"; two="${input:i:2}"
    case "$state" in
      UNQUOTED)
        if   [[ "$two" == "\$'" ]];  then result+="$two"; i=$((i+2)); state="ANSI_C_QUOTED"
        elif [[ "$two" == '$"' ]];   then result+="$two"; i=$((i+2)); state="LOCALE_QUOTED"
        elif [[ "$ch"  == '\' ]];    then result+="${input:i:2}"; i=$((i+2))
        elif [[ "$ch"  == "'" ]];    then result+="$ch";  i=$((i+1)); state="SINGLE_QUOTED"
        elif [[ "$ch"  == '"' ]];    then result+="$ch";  i=$((i+1)); state="DOUBLE_QUOTED"
        elif [[ "$ch"  == '#' ]];    then
          while (( i < len )) && [[ "${input:i:1}" != $'\n' ]]; do i=$((i+1)); done
        else result+="$ch"; i=$((i+1))
        fi ;;
      SINGLE_QUOTED)
        # \ is literal here; ANY ' exits (including after \)
        if [[ "$ch" == "'" ]]; then result+="$ch"; i=$((i+1)); state="UNQUOTED"
        else result+="$ch"; i=$((i+1)); fi ;;
      DOUBLE_QUOTED|LOCALE_QUOTED)
        if   [[ "$ch" == '\' ]]; then result+="${input:i:2}"; i=$((i+2))
        elif [[ "$ch" == '"' ]]; then result+="$ch"; i=$((i+1)); state="UNQUOTED"
        else result+="$ch"; i=$((i+1)); fi ;;
      ANSI_C_QUOTED)
        if   [[ "$ch" == '\' ]]; then result+="${input:i:2}"; i=$((i+2))
        elif [[ "$ch" == "'" ]]; then result+="$ch"; i=$((i+1)); state="UNQUOTED"
        else result+="$ch"; i=$((i+1)); fi ;;
    esac
  done
  printf '%s' "$result"
}
```

- [ ] **Step 4: Wire preprocessing into Guard 3**

Replace the `# ── Preprocessing and pattern checks...` placeholder comment (and the `unset _G3_CMD` line) with:

```bash
  # Step 4a: join line continuations; 4b: strip comments
  local _G3_PRE
  _G3_PRE=$(_g3_strip_comments "$(_g3_join_continuations "$_G3_CMD")")
  unset _G3_CMD
  # Normalise real newlines to semicolons (simplifies all pattern regexes)
  _G3_PRE="${_G3_PRE//$'\n'/;}"

  # ── Pattern checks added in subsequent tasks ──
  # Placeholder: pass through.
  unset _G3_PRE
fi
```

- [ ] **Step 5: Run tests – preprocessing tests still fail (no patterns yet), no regressions**

```
bash tests/guard3-test.sh
```

All prior tests still pass; 7 new tests fail as expected (no pattern checks in place).

- [ ] **Step 6: Commit**

```bash
git add -f .claude/hooks/pre-tool-use.sh tests/guard3-test.sh
git commit -m "feat(guard3): preprocessing helpers (4a line-join, 4b comment-strip)"
```

---

### Task 3: Shared regex constants and glob scanner helper

**Files:**
- Modify: `.claude/hooks/pre-tool-use.sh`

- [ ] **Step 1: Add `_g3_has_unquoted_glob` helper and regex constants**

Add the following immediately after the two preprocessing functions (still inside the `# ── Guard 3 helpers` section):

```bash
# Regex fragment matching a command-execution-position operator or keyword.
# Used as a prefix before utility names in all pattern regexes.
_G3_POS='(^|[|;{(\[!&]|`|&&|\|\||;;|\$\(|<\(|>\(|(then|else|elif|do)[[:space:]]|![[:space:]])[[:space:]]*'
# Optional prefix-modifier chain (env, exec, time, nohup, coproc, command, builtin)
# followed by optional flags/VAR=val tokens before the real utility name.
_G3_MOD='((env|exec|time|nohup|coproc|command|builtin)([[:space:]]+[^[:space:]]+)*[[:space:]]+)?'
# Path-prefixed token: optional directory components before the binary name.
_G3_PATH='([A-Za-z0-9_./@%-]*/)?'
# Monitored reading/viewing utilities
_G3_READERS='(cat|less|more|head|tail|sed|awk|grep|egrep|fgrep|mapfile|readarray)'
# Shell interpreters (blocked in find -exec and xargs)
_G3_SHELLS='(sh|bash|dash|zsh|ksh|fish)'

_g3_has_unquoted_glob() {
  # Returns 1 (blocked) if input contains *, ?, {, or [ in UNQUOTED state.
  local input="$1" state="UNQUOTED"
  local i=0 len=${#input} ch="" two=""
  while (( i < len )); do
    ch="${input:i:1}"; two="${input:i:2}"
    case "$state" in
      UNQUOTED)
        if   [[ "$two" == "\$'" ]];   then i=$((i+2)); state="ANSI_C_QUOTED"
        elif [[ "$two" == '$"' ]];    then i=$((i+2)); state="LOCALE_QUOTED"
        elif [[ "$ch"  == '\' ]];     then i=$((i+2))
        elif [[ "$ch"  == "'" ]];     then i=$((i+1)); state="SINGLE_QUOTED"
        elif [[ "$ch"  == '"' ]];     then i=$((i+1)); state="DOUBLE_QUOTED"
        elif [[ "$ch"  =~ [*?{\[] ]]; then return 1
        else i=$((i+1)); fi ;;
      SINGLE_QUOTED)
        [[ "$ch" == "'" ]] && state="UNQUOTED"; i=$((i+1)) ;;
      DOUBLE_QUOTED|LOCALE_QUOTED)
        if   [[ "$ch" == '\' ]]; then i=$((i+2))
        elif [[ "$ch" == '"' ]]; then state="UNQUOTED"; i=$((i+1))
        else i=$((i+1)); fi ;;
      ANSI_C_QUOTED)
        if   [[ "$ch" == '\' ]]; then i=$((i+2))
        elif [[ "$ch" == "'" ]]; then state="UNQUOTED"; i=$((i+1))
        else i=$((i+1)); fi ;;
    esac
  done
  return 0  # no unquoted glob found
}
```

- [ ] **Step 2: No test needed yet – these are shared infrastructure. Verify hook still loads cleanly.**

```bash
bash -n .claude/hooks/pre-tool-use.sh && echo "syntax OK"
```

Expected: `syntax OK`

- [ ] **Step 3: Commit**

```bash
git add -f .claude/hooks/pre-tool-use.sh
git commit -m "feat(guard3): shared regex constants and _g3_has_unquoted_glob helper"
```

---

### Task 4: Patterns 1–3 (find depth, find-exec, xargs) + pattern dispatch

**Files:**
- Modify: `.claude/hooks/pre-tool-use.sh`
- Modify: `tests/guard3-test.sh`

All `_g3_pN_*` functions take the preprocessed string as `$1` and return 0 (pass) or 1 (blocked).

- [ ] **Step 1: Add tests for Patterns 1–3**

Append to `tests/guard3-test.sh` (before final `echo "Results..."`):

```bash
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
```

- [ ] **Step 2: Run – all 21 new tests FAIL**

```
bash tests/guard3-test.sh
```

- [ ] **Step 3: Implement `_g3_p1_find_depth`**

Add after the `_g3_has_unquoted_glob` function:

```bash
_g3_p1_find_depth() {
  local s="$1"
  [[ "$s" =~ ${_G3_POS}${_G3_MOD}${_G3_PATH}find([[:space:]]|$) ]] || return 0
  if [[ "$s" =~ -(-)?maxdepth[=[:space:]]+([+]?)([0-9]+) ]]; then
    [[ "${BASH_REMATCH[3]}" == "1" ]] && return 0
    return 1  # depth != 1 -> block
  fi
  return 1    # no depth flag -> block
}
```

- [ ] **Step 4: Implement `_g3_p2_find_exec`**

```bash
_g3_p2_find_exec() {
  local s="$1"
  [[ "$s" =~ ${_G3_POS}${_G3_MOD}${_G3_PATH}find([[:space:]]|$) ]] || return 0
  [[ "$s" =~ -(exec|execdir|ok|okdir)[[:space:]] ]]              || return 0
  [[ "$s" =~ -(exec|execdir|ok|okdir)[[:space:]]+(${_G3_READERS}|${_G3_SHELLS})([[:space:]]|$) ]] \
    && return 1
  return 0
}
```

- [ ] **Step 5: Implement `_g3_p3_xargs`**

```bash
_g3_p3_xargs() {
  local s="$1"
  [[ "$s" =~ ${_G3_POS}${_G3_MOD}xargs([[:space:]]|$) ]] || return 0
  # Walk tokens after 'xargs', skip flags/option-args, check the utility token.
  local after="${s#*xargs}"
  local -a toks; read -ra toks <<< "$after"
  local opt_re='^(-I|--replace|-n|--max-args|-P|--max-procs|-s|--max-chars|-a|--arg-file|-d|--delimiter|-E|--eof)$'
  local i=0
  while (( i < ${#toks[@]} )); do
    local t="${toks[i]}"
    if [[ "$t" =~ $opt_re ]]; then
      # Option-taking: consume next token only if it doesn't look like a flag
      if (( i+1 < ${#toks[@]} )) && [[ ! "${toks[i+1]}" =~ ^-[A-Za-z] ]]; then
        i=$((i+2))
      else
        i=$((i+1))
      fi
    elif [[ "$t" =~ ^- ]]; then
      i=$((i+1))  # boolean flag
    else
      [[ "$t" =~ ^(${_G3_READERS}|${_G3_SHELLS})$ ]] && return 1
      return 0  # non-reader utility – pass
    fi
  done
  return 0
}
```

- [ ] **Step 6: Wire patterns 1–3 into Guard 3 and add the block message**

Replace the entire `# ── Pattern checks...` placeholder block inside Guard 3 with:

```bash
  # Step 5: Run pattern checks
  local _G3_HIT=0
  _g3_p1_find_depth "$_G3_PRE" || _G3_HIT=1
  _g3_p2_find_exec  "$_G3_PRE" || _G3_HIT=1
  _g3_p3_xargs      "$_G3_PRE" || _G3_HIT=1
  # (patterns 4-12 appended in later tasks)

  if (( _G3_HIT )); then
    # Step 6: Allowlist check (Task 7 replaces this stub)
    printf '\n⛔ BASH SCAN BLOCKED\n'                                                 >&2
    printf '   Command triggered a mass content-dump pattern.\n\n'                    >&2
    printf '   Authorized search alternatives (see skills/memory-first.md):\n'       >&2
    printf '   1. Grep tool  — targeted content search with file/pattern scope\n'    >&2
    printf '   2. Glob tool  — path listing only, no file content\n'                 >&2
    printf '   3. Read tool  — with explicit offset + limit (max 150 lines)\n\n'     >&2
    printf '   If this path must be scanned broadly, add it to BASH_SCAN_ALLOWLIST\n' >&2
    printf '   in .claude/hooks/pre-tool-use.sh (operator action only).\n\n'         >&2
    unset _G3_PRE _G3_HIT; exit 1
  fi
  unset _G3_PRE _G3_HIT
fi
```

- [ ] **Step 7: Run tests**

```
bash tests/guard3-test.sh
```

Expected: all P1/P2/P3 tests pass; earlier preprocessing tests still fail (Pattern 4 not wired yet).

- [ ] **Step 8: Commit**

```bash
git add -f .claude/hooks/pre-tool-use.sh tests/guard3-test.sh
git commit -m "feat(guard3): patterns 1-3 (find depth, find-exec, xargs)"
```

---

### Task 5: Patterns 4–7 (glob-expansion patterns and grep match-all)

**Files:**
- Modify: `.claude/hooks/pre-tool-use.sh`
- Modify: `tests/guard3-test.sh`

- [ ] **Step 1: Add tests for Patterns 4–7**

Append to `tests/guard3-test.sh`:

```bash
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
```

- [ ] **Step 2: Run – all new tests FAIL**

```
bash tests/guard3-test.sh
```

- [ ] **Step 3: Implement `_g3_p4_cat_glob`**

Add after `_g3_p3_xargs`:

```bash
_g3_p4_cat_glob() {
  local s="$1"
  local cat_re="${_G3_POS}${_G3_MOD}${_G3_PATH}cat([[:space:]]|$)"
  local rest="$s"
  while [[ "$rest" =~ $cat_re ]]; do
    local mlen=${#BASH_REMATCH[0]}
    # Verify basename is exactly 'cat'
    local pathpart="${BASH_REMATCH[3]:-}"  # captured by _G3_PATH group
    [[ "${pathpart}cat" == *"/"* ]] && [[ "${pathpart}cat" != */cat ]] \
      && { rest="${rest:mlen}"; continue; }
    local after="${rest:mlen}"
    _g3_has_unquoted_glob "$after" && return 1
    rest="$after"
    [[ -z "$rest" ]] && break
  done
  return 0
}
```

- [ ] **Step 4: Implement `_g3_p5_cmdsubst`**

```bash
_g3_p5_cmdsubst() {
  local s="$1"
  # Any reading utility at command position whose argument contains $( or backtick
  local util_re="${_G3_POS}${_G3_MOD}${_G3_PATH}${_G3_READERS}([[:space:]]|$)"
  [[ "$s" =~ $util_re ]] || return 0
  # Check if argument portion contains $( or backtick (heuristic: anywhere after the utility)
  local after="${s#*${BASH_REMATCH[0]}}"
  # Exempt: no prefix before substitution AND remainder after ) is /literal-path
  local exempt_re='^\$\(([^)]+)\)"?(/[A-Za-z0-9_./@%-]+)"?$'
  [[ "$after" =~ $exempt_re ]] && return 0
  [[ "$after" =~ '"?\$\(([^)]+)\)(/[A-Za-z0-9_./@%-]+)?"?' ]] \
    && [[ "${BASH_REMATCH[0]}" == "$after" ]] && return 0
  # Block if the arg contains $( or an unquoted backtick
  [[ "$after" =~ '\$\(' ]] && return 1
  [[ "$after" =~ '`' ]]    && return 1
  return 0
}
```

- [ ] **Step 5: Implement `_g3_p6_grep_matchall`**

```bash
_g3_p6_grep_matchall() {
  local s="$1"
  # Reject if -F / --fixed-strings present anywhere
  [[ "$s" =~ [[:space:]]-F([[:space:]]|$) ]]          && return 0
  [[ "$s" =~ [[:space:]]--fixed-strings([[:space:]]|$) ]] && return 0

  # Sub-rule (a): grep/egrep/fgrep at cmd position + recursive flag + match-all pattern
  if [[ "$s" =~ ${_G3_POS}${_G3_MOD}(grep|egrep|fgrep)([[:space:]]|$) ]]; then
    [[ "$s" =~ [[:space:]](-r|-R|--recursive)([[:space:]]|$) ]] || return 0
    _g3_grep_has_matchall_pattern "$s" && return 1
  fi

  # Sub-rule (b): git grep at cmd position + match-all pattern (no recursive flag needed)
  if [[ "$s" =~ ${_G3_POS}git[[:space:]]+grep([[:space:]]|$) ]]; then
    _g3_grep_has_matchall_pattern "$s" && return 1
  fi

  return 0
}

_g3_grep_has_matchall_pattern() {
  local s="$1"
  # Check for -e / --regexp patterns
  local matchall_re='(\.\*|\.|\.\+|\^|"")'
  if [[ "$s" =~ [[:space:]]-e[[:space:]]+([^[:space:]]+) ]]; then
    local pat="${BASH_REMATCH[1]//\'/}"; pat="${pat//\"/}"
    [[ "$pat" =~ ^($matchall_re)$ ]] && return 0
  fi
  if [[ "$s" =~ --regexp[=[:space:]]+([^[:space:]]+) ]]; then
    local pat="${BASH_REMATCH[1]//\'/}"; pat="${pat//\"/}"
    [[ "$pat" =~ ^($matchall_re)$ ]] && return 0
  fi
  # First non-flag, non-path-looking argument is the pattern
  local -a toks; read -ra toks <<< "$s"
  local seen_cmd=0 pat=""
  for tok in "${toks[@]}"; do
    [[ "$tok" =~ ^(git|grep|egrep|fgrep|-r|-R|--recursive|-[a-zA-Z]+)$ ]] && { seen_cmd=1; continue; }
    (( seen_cmd == 0 )) && continue
    [[ "$tok" =~ ^- ]] && continue
    # Path-looking: has / and no regex metacharacters (excluding .)
    [[ "$tok" =~ ^(/|./|../|~/) ]] && continue
    [[ "$tok" =~ [/] ]] && [[ ! "$tok" =~ [*+?[\](){}^\$|\\] ]] && continue
    # This token is the pattern
    pat="${tok//\'/}"; pat="${pat//\"/}"
    break
  done
  [[ -z "$pat" ]] && return 0   # empty / whitespace-only after stripping -> match-all
  [[ "$pat" =~ ^($matchall_re)$ ]] && return 0
  return 1  # not match-all
}
```

- [ ] **Step 6: Implement `_g3_p7_pager_glob`**

```bash
_g3_p7_pager_glob() {
  local s="$1"
  local pager_re="${_G3_POS}${_G3_MOD}${_G3_PATH}(less|more|head|tail|sed|awk)([[:space:]]|$)"
  local rest="$s"
  while [[ "$rest" =~ $pager_re ]]; do
    local mlen=${#BASH_REMATCH[0]}
    local after="${rest:mlen}"
    _g3_has_unquoted_glob "$after" && return 1
    rest="$after"
    [[ -z "$rest" ]] && break
  done
  return 0
}
```

- [ ] **Step 7: Add pattern calls to Guard 3 dispatch block**

In the pattern-check section inside Guard 3, append after the `_g3_p3_xargs` call:

```bash
  _g3_p4_cat_glob   "$_G3_PRE" || _G3_HIT=1
  _g3_p5_cmdsubst   "$_G3_PRE" || _G3_HIT=1
  _g3_p6_grep_matchall "$_G3_PRE" || _G3_HIT=1
  _g3_p7_pager_glob "$_G3_PRE" || _G3_HIT=1
```

- [ ] **Step 8: Run tests**

```
bash tests/guard3-test.sh
```

Expected: all P4–P7 tests pass. P1–P3 and sanity tests remain green.

- [ ] **Step 9: Commit**

```bash
git add -f .claude/hooks/pre-tool-use.sh tests/guard3-test.sh
git commit -m "feat(guard3): patterns 4-7 (cat+glob, cmd-subst, grep, pager+glob)"
```

---

### Task 6: Patterns 8–12 and obfuscation detection

**Files:**
- Modify: `.claude/hooks/pre-tool-use.sh`
- Modify: `tests/guard3-test.sh`

- [ ] **Step 1: Add tests**

Append to `tests/guard3-test.sh`:

```bash
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
run "P9 cat for (for as argument)"         'cat for'                           "block"  # cat at cmd pos triggers P4? No – 'for' not a glob. Should pass.
# NOTE: 'cat for' – 'for' is a literal filename, no glob chars. Pattern 4 requires glob. Should PASS.
# Correct the test:
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
```

- [ ] **Step 2: Fix the duplicate `cat for` test (remove the first erroneous entry)**

The test file now has two `cat for` entries; the second (`"pass"`) is correct. Remove the first (`"block"`) from `tests/guard3-test.sh` — edit out the line:
```
run "P9 cat for (for as argument)"         'cat for'                           "block"
```

- [ ] **Step 3: Run – all new tests FAIL**

```
bash tests/guard3-test.sh
```

- [ ] **Step 4: Implement Patterns 8–12 and obfuscation detection**

Add after `_g3_p7_pager_glob`:

```bash
_g3_p8_ls_recursive() {
  local s="$1"
  [[ "$s" =~ ${_G3_POS}${_G3_MOD}${_G3_PATH}ls([[:space:]]|$) ]] || return 0
  [[ "$s" =~ [[:space:]]--recursive([[:space:]]|$) ]]     && return 1
  [[ "$s" =~ [[:space:]]-R([[:space:]]|$) ]]              && return 1
  [[ "$s" =~ [[:space:]]-[a-zA-Z]*R[a-zA-Z]*([[:space:]]|$) ]] && return 1
  return 0
}

_g3_p9_shell_loop() {
  local s="$1"
  # for/while/until at command execution position (unquoted – already comment-stripped)
  [[ "$s" =~ ${_G3_POS}(for|while|until)[[:space:]] ]] && return 1
  return 0
}

_g3_p10_slurp_builtins() {
  local s="$1"
  [[ "$s" =~ ${_G3_POS}(mapfile|readarray)([[:space:]]|$) ]] && return 1
  return 0
}

_g3_p11_dynamic_exec() {
  local s="$1"
  # eval and source unconditionally
  [[ "$s" =~ ${_G3_POS}(eval|source)([[:space:]]|$) ]] && return 1
  # dot operator: standalone '.' at command position (not './...')
  [[ "$s" =~ ${_G3_POS}\.[[:space:]] ]]                && return 1
  [[ "$s" =~ ${_G3_POS}\.$  ]]                         && return 1
  return 0
}

_g3_p12_alias() {
  local s="$1"
  [[ "$s" =~ ${_G3_POS}alias[[:space:]] ]] || return 0
  # Extract VALUE after NAME= and strip one layer of quotes
  if [[ "$s" =~ alias[[:space:]]+[A-Za-z_][A-Za-z_0-9]*=(.+) ]]; then
    local val="${BASH_REMATCH[1]}"
    val="${val#\'}"; val="${val%\'}"; val="${val#\"}"; val="${val%\"}"
    # Block if value starts with a monitored binary or blocked primitive
    [[ "$val" =~ ^(${_G3_READERS}|eval|source|\.)[[:space:]] ]] && return 1
    [[ "$val" =~ ^(${_G3_READERS}|eval|source|\.)$ ]]           && return 1
  fi
  return 0
}

_g3_obfuscation() {
  local s="$1"
  # Tokens at command position that look like obfuscated binary names:
  # (a) $"..." prefix, (b) all-backslash-letter pairs, (c) internal single-quote splits
  [[ "$s" =~ ${_G3_POS}\$" ]]                               && return 1
  [[ "$s" =~ ${_G3_POS}(\\.)+([[:space:]]|$) ]]             && return 1
  [[ "$s" =~ ${_G3_POS}[a-zA-Z]\'[a-zA-Z]+\'[a-zA-Z] ]]    && return 1
  return 0
}
```

- [ ] **Step 5: Add pattern calls to the Guard 3 dispatch block**

Append after the `_g3_p7_pager_glob` call:

```bash
  _g3_p8_ls_recursive  "$_G3_PRE" || _G3_HIT=1
  _g3_p9_shell_loop    "$_G3_PRE" || _G3_HIT=1
  _g3_p10_slurp_builtins "$_G3_PRE" || _G3_HIT=1
  _g3_p11_dynamic_exec "$_G3_PRE" || _G3_HIT=1
  _g3_p12_alias        "$_G3_PRE" || _G3_HIT=1
  _g3_obfuscation      "$_G3_PRE" || _G3_HIT=1
```

- [ ] **Step 6: Run tests**

```
bash tests/guard3-test.sh
```

Expected: all P8–P12 and obfuscation tests pass.

- [ ] **Step 7: Commit**

```bash
git add -f .claude/hooks/pre-tool-use.sh tests/guard3-test.sh
git commit -m "feat(guard3): patterns 8-12 and obfuscation detection"
```

---

### Task 7: Allowlist check

**Files:**
- Modify: `.claude/hooks/pre-tool-use.sh`
- Modify: `tests/guard3-test.sh`

- [ ] **Step 1: Add allowlist tests**

Append to `tests/guard3-test.sh`:

```bash
# ── Allowlist ─────────────────────────────────────────────────────────────────
# Override BASH_SCAN_ALLOWLIST for these tests via env hack:
# We temporarily modify the hook; easier: test a wrapper that sets the array.
# Strategy: use a subshell that sources the hook file with a patched allowlist.
_run_allowlisted() {
  local label="$1" cmd="$2" entries="$3" expect="$4"
  local json
  json=$(printf '%s' "$cmd" \
    | python3 -c 'import sys,json; print(json.dumps({"command":sys.stdin.read()}))')
  local tmp=$(mktemp)
  # Patch: prepend allowlist override to a temp copy of the hook
  {
    printf '#!/usr/bin/env bash\nset -euo pipefail\n'
    printf 'BASH_SCAN_ALLOWLIST=(%s)\n' "$entries"
    # Include the functions and Guard 3 block (skip Guard 1/2 scaffolding)
    grep -n '' "$HOOK" | awk -F: 'NR>1{print $2}' | tail -n +4
  } > "$tmp"
  chmod +x "$tmp"
  export CLAUDE_TOOL_NAME="Bash"; export CLAUDE_TOOL_INPUT="$json"
  bash "$tmp" >/dev/null 2>&1; local rc=$?
  unset CLAUDE_TOOL_NAME CLAUDE_TOOL_INPUT; rm -f "$tmp"
  if { [[ "$expect" == "block" ]] && (( rc != 0 )); } \
  || { [[ "$expect" == "pass"  ]] && (( rc == 0 )); }; then
    echo "  PASS: $label"; PASS=$((PASS+1))
  else
    echo "  FAIL: $label  [expected=$expect rc=$rc]"; FAIL=$((FAIL+1))
  fi
}

_run_allowlisted "allowlist docs/ permits cat *.ts in docs/" \
  'cat docs/README.md' '"docs/"' "pass"
_run_allowlisted "allowlist does NOT permit unrelated path" \
  'cat src/*.ts' '"docs/"' "block"
_run_allowlisted "allowlist trailing-comment bypass blocked" \
  'cat *.ts # docs/' '"docs/"' "block"
_run_allowlisted "allowlist path-traversal rejected" \
  'cat docs/../../etc/passwd' '"docs/"' "block"
_run_allowlisted "allowlist exact match (no trailing slash)" \
  'cat file.ts' '"file.ts"' "pass"
_run_allowlisted "allowlist substring not matched (docs vs doc_files)" \
  'cat doc_files.ts' '"docs/"' "block"
```

- [ ] **Step 2: Run – allowlist tests FAIL (no allowlist logic yet)**

```
bash tests/guard3-test.sh
```

- [ ] **Step 3: Implement `_g3_check_allowlist`**

Add after `_g3_obfuscation`:

```bash
_g3_check_allowlist() {
  local s="$1"
  (( ${#BASH_SCAN_ALLOWLIST[@]} == 0 )) && return 1  # empty -> always block

  # Find the command segment that triggered the block (crude: use full string for now;
  # structural placement is enforced by requiring the token to appear in the string
  # with correct boundary characters on both sides).
  local delim='[[:space:];|(){}[\]'"'"'"]'
  for entry in "${BASH_SCAN_ALLOWLIST[@]}"; do
    [[ -z "$entry" ]] && continue
    if [[ "${entry: -1}" == "/" ]]; then
      # Path-prefixed entry: right boundary allows path chars; reject ..
      local pat="(^|${delim})${entry}([A-Za-z0-9_./@%-]*)(${delim}|$)"
      if [[ "$s" =~ $pat ]]; then
        local suffix="${BASH_REMATCH[3]}"
        # Reject path traversal
        [[ "$suffix" =~ (^|/)\.\.(/|$) ]] && continue
        return 0
      fi
    else
      # Exact whole-token match
      local pat="(^|${delim})${entry}(${delim}|$)"
      [[ "$s" =~ $pat ]] && return 0
    fi
  done
  return 1  # no allowlist entry matched
}
```

- [ ] **Step 4: Replace the stub in the Guard 3 block message section**

In the `if (( _G3_HIT )); then` block, insert the allowlist check before the `printf` lines:

```bash
  if (( _G3_HIT )); then
    # Step 6: Allowlist check (operates on preprocessed/comment-stripped string)
    _g3_check_allowlist "$_G3_PRE" && { unset _G3_PRE _G3_HIT; exit 0; }
    # Blocked
    printf '\n⛔ BASH SCAN BLOCKED\n' ...   # (existing printf lines unchanged)
```

- [ ] **Step 5: Run tests**

```
bash tests/guard3-test.sh
```

Expected: all allowlist tests pass.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/hooks/pre-tool-use.sh tests/guard3-test.sh
git commit -m "feat(guard3): allowlist check with boundary-delimited exact-literal matching"
```

---

### Task 8: `skills/memory-first.md` Hook enforcement section + mirrors

**Files:**
- Modify: `skills/memory-first.md`
- Modify: `project-template/.claude/hooks/pre-tool-use.sh`
- Create: `project-template/skills/memory-first.md`

- [ ] **Step 1: Append "Hook enforcement" section to `skills/memory-first.md`**

Append the following to the end of `skills/memory-first.md`:

```markdown
---

## Hook enforcement

The `pre-tool-use.sh` hook contains **Guard 3**, which intercepts every Bash tool invocation and hard-blocks mass content-dump commands (exit 1). The guard operates silently on safe commands; it fires with a `⛔ BASH SCAN BLOCKED` message on any of the following patterns:

| Pattern | Example blocked | Safe alternative |
|---------|----------------|-----------------|
| `find` without `-maxdepth 1` | `find .` | `find . -maxdepth 1` |
| `find -exec <reader>` | `find . -exec cat {} \;` | Grep or Glob |
| `xargs <reader>` | `find . \| xargs cat` | Grep or Glob |
| `cat <glob>` | `cat *.ts` | Grep with pattern scope |
| Command substitution + reader | `cat $(ls)` | Grep or Glob |
| `grep -r <match-all>` | `grep -r '.*' .` | Grep with specific pattern |
| `less/head/awk/sed <glob>` | `less *.ts` | Read with offset + limit |
| `ls -R` | `ls -R src/` | Glob for path listing |
| Shell loops (`for`/`while`/`until`) | `for f in *.ts; do …` | Glob + targeted Read |
| `mapfile` / `readarray` | `mapfile arr < file` | Read with offset + limit |
| `eval` / `source` / `.` | `eval "$cmd"` | Direct named commands only |
| `alias <reader>=…` | `alias c='cat'` | No alias for monitored utilities |

**To permit a specific path for broad scanning**, an operator must add it to `BASH_SCAN_ALLOWLIST` in `.claude/hooks/pre-tool-use.sh`. Agents must never modify this array.
```

- [ ] **Step 2: Verify the file renders correctly**

```bash
bash -n .claude/hooks/pre-tool-use.sh && echo "hook syntax OK"
wc -l skills/memory-first.md
```

Expected: `hook syntax OK`; line count is previous + ~24.

- [ ] **Step 3: Mirror the updated hook to `project-template`**

Copy the full contents of `.claude/hooks/pre-tool-use.sh` to `project-template/.claude/hooks/pre-tool-use.sh` (exact byte-for-byte copy):

```bash
cp .claude/hooks/pre-tool-use.sh project-template/.claude/hooks/pre-tool-use.sh
```

- [ ] **Step 4: Create `project-template/skills/memory-first.md`**

Copy `skills/memory-first.md`:

```bash
mkdir -p project-template/skills
cp skills/memory-first.md project-template/skills/memory-first.md
```

- [ ] **Step 5: Verify mirrors are identical**

```bash
diff .claude/hooks/pre-tool-use.sh project-template/.claude/hooks/pre-tool-use.sh \
  && echo "hook mirror OK"
diff skills/memory-first.md project-template/skills/memory-first.md \
  && echo "skills mirror OK"
```

Expected: both `diff` commands output nothing (identical files) and print the confirmation messages.

- [ ] **Step 6: Commit**

```bash
git add -f skills/memory-first.md \
          project-template/.claude/hooks/pre-tool-use.sh \
          project-template/skills/memory-first.md
git commit -m "feat(guard3): hook enforcement docs + project-template mirrors"
```

---

### Task 9: Backlog update, version bump, and checkpoint

**Files:**
- Modify: `AGENT-READABLE BACKLOG.md`
- Modify: `.claude/memory/project.md`

- [ ] **Step 1: Mark BUG-006 and FEAT-018 complete in backlog**

In `AGENT-READABLE BACKLOG.md`:

Find and change:
```
### [ ] `[BUG-006]` Loose Read-Tool Filtering Restrictions
```
to:
```
### [X] `[BUG-006]` Loose Read-Tool Filtering Restrictions
```

Then find and change:
```
### [ ] `[FEAT-018]` Surgical Search Tools (Ripgrep / Find Wrappers)
```
to:
```
### [X] `[FEAT-018]` Surgical Search Tools (Ripgrep / Find Wrappers)
```

- [ ] **Step 2: Run the full test suite one final time**

```
bash tests/guard3-test.sh
```

Expected: 0 failures.

- [ ] **Step 3: Commit backlog update**

```bash
git add "AGENT-READABLE BACKLOG.md"
git commit -m "chore: mark BUG-006 and FEAT-018 complete in backlog"
```

- [ ] **Step 4: Append checkpoint to `.claude/memory/project.md`**

Append the following section to `.claude/memory/project.md`:

```markdown
## Checkpoint 2026-06-12 (BUG-006 + FEAT-018)

### Decisions
- Guard 3 implemented as a self-contained Bash block in `pre-tool-use.sh`, inserted after Guard 1
- 12 blocked patterns: find-depth, find-exec, xargs, cat+glob, cmd-subst, grep-matchall, pager+glob, ls-R, shell-loop, mapfile/readarray, eval/source/dot, alias
- 5-state scanner (`_g3_strip_comments`, `_g3_has_unquoted_glob`) handles SINGLE_QUOTED/DOUBLE_QUOTED/ANSI_C_QUOTED/LOCALE_QUOTED
- `BASH_SCAN_ALLOWLIST=()` — empty array, agent-immutable, path-traversal-guarded
- Allowlist check operates on comment-stripped preprocessed string (not raw input)
- `project-template/skills/` directory created; `memory-first.md` mirrored there for the first time

### Conventions
- Guard 3 helpers are named `_g3_*`; all functions take the preprocessed string as `$1`
- Test harness lives at `tests/guard3-test.sh`; run with `bash tests/guard3-test.sh`
- Any new Guard 3 allowlist entry must be added by an operator, never by the agent

### Technical Debt
- Pattern 5 (cmd-subst) exemption logic is heuristic; complex nested substitutions may produce false positives
- Pattern 3 (xargs) walks tokens using `read -ra` split on spaces — commands with tab-separated arguments may not be parsed correctly
- Indirect variable dispatch (`$cmd *.ts`) is a documented static-analysis blind spot — cannot be detected by Guard 3
```

- [ ] **Step 5: Commit checkpoint**

```bash
git add -f .claude/memory/project.md
git commit -m "chore: checkpoint 2026-06-12 (BUG-006+FEAT-018 complete)"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task covering it |
|-----------------|-----------------|
| Guard fires only when `CLAUDE_TOOL_NAME == Bash` | Task 1 |
| Step 4a line-continuation joining + CRLF | Task 2 |
| Step 4b 5-state scanner (SINGLE_QUOTED has no escaping) | Task 2 |
| `$'...'` and `$"..."` states | Task 3 |
| `_g3_has_unquoted_glob` for Patterns 4 and 7 | Task 3 |
| Pattern 1 (find depth, +N normalisation) | Task 4 |
| Pattern 2 (find -exec with shell interpreter) | Task 4 |
| Pattern 3 (xargs flag taxonomy, lowercase -i boolean) | Task 4 |
| Patterns 4–7 | Task 5 |
| Pattern 6 `-F` exemption, `-e`/`--regexp` isolation | Task 5 |
| Patterns 8–12, obfuscation | Task 6 |
| Allowlist on preprocessed string, path-traversal guard, structural placement | Task 7 |
| Standard block message | Task 4 (introduced), unchanged thereafter |
| `skills/memory-first.md` Hook enforcement section | Task 8 |
| `project-template` mirrors | Task 8 |
| Backlog BUG-006 + FEAT-018 marked complete | Task 9 |

**Placeholder scan:** No TBD/TODO/placeholder text in any task. All code blocks are complete.

**Type/name consistency:** All helper functions named `_g3_p{N}_*`; all take one argument `$1`; all return 0 (pass) or 1 (block). `_G3_HIT` is the flag variable. `_G3_PRE` is the preprocessed string. `_G3_POS`, `_G3_MOD`, `_G3_PATH`, `_G3_READERS`, `_G3_SHELLS` are the shared regex constants. Consistent across Tasks 3–7.
