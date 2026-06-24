#!/usr/bin/env bash
# Guards: (1) large-file Read without limit, (2) duplicate file creation.

set -euo pipefail

# ── Guard 1: Large-file Read without limit ─────────────────────────────────────
if [ "${CLAUDE_TOOL_NAME:-}" = "Read" ]; then
  READ_PATH=$(echo "${CLAUDE_TOOL_INPUT:-}" | grep -o '"file_path":"[^"]*"' | head -1 | sed 's/"file_path":"//;s/"//' || true)
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
      echo "   1. Check .claude/memory/project.md"
      echo "   2. Query graphify for structural questions"
      echo "   3. Use Grep/Glob for pattern searches"
      echo "   4. Read with explicit offset + limit"
      echo ""
      exit 1
    fi
  fi
fi

# ── Guard 3 helpers (defined before Guard 3 block; added incrementally per task) ─

# Pure-Bash JSON string extractor. Finds "command":<value> in CLAUDE_TOOL_INPUT
# and unescapes the JSON string without any external tools.
# Outputs the raw shell command string to stdout.
_g3_extract_command() {
  local json="$1"
  # Find the start of the "command" value: skip to after "command":"
  local after="${json#*\"command\"}"    # everything after the key name
  after="${after#*:}"                   # skip colon (and any whitespace before it is gone)
  after="${after#[[:space:]]}"          # trim leading whitespace
  after="${after#\"}"                   # consume opening "
  # Walk character-by-character to the closing unescaped "
  local result="" i=0 len=${#after} ch="" next=""
  while (( i < len )); do
    ch="${after:i:1}"
    if [[ "$ch" == '\' ]]; then
      next="${after:i+1:1}"
      case "$next" in
        '"')  result+='"';    i=$((i+2)) ;;
        '\')  result+='\';    i=$((i+2)) ;;
        'n')  result+=$'\n';  i=$((i+2)) ;;
        't')  result+=$'\t';  i=$((i+2)) ;;
        'r')  result+=$'\r';  i=$((i+2)) ;;
        '/')  result+='/';    i=$((i+2)) ;;
        *)    result+="\\$next"; i=$((i+2)) ;;  # other \X: keep \X (preserve escape info)
      esac
    elif [[ "$ch" == '"' ]]; then
      break   # closing double-quote
    else
      result+="$ch"; i=$((i+1))
    fi
  done
  printf '%s' "$result"
}

_g3_join_continuations() {
  local input="$1" result="" line=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"           # strip trailing CR (CRLF normalisation)
    local tmp="$line" bs=0
    while [[ "$tmp" == *\\ ]]; do tmp="${tmp%\\}"; bs=$((bs+1)); done
    if (( bs % 2 == 1 )); then
      result+="${line%\\} "        # odd backslashes: line continuation
    else
      result+="$line"$'\n'         # even backslashes: real newline
    fi
  done <<< "$input"
  printf '%s' "$result"
}

_g3_scan() {
  # Unified 5-state scanner (UNQUOTED / SINGLE_QUOTED / DOUBLE_QUOTED /
  #   ANSI_C_QUOTED / LOCALE_QUOTED).  Two modes:
  #   "strip" — outputs comment-stripped string to stdout; returns 0 (ok) or 2 (malformed).
  #   "glob"  — returns 1 if an unquoted glob char found, 0 if not, 1 on malformed (fail-closed).
  # Malformed = state != UNQUOTED at end of input (unclosed quote).
  # SINGLE_QUOTED: \ is literal; ANY ' exits (including directly after \).
  local mode="$1" input="$2"
  local state="UNQUOTED" result=""
  local i=0 len=${#input} ch="" two=""
  while (( i < len )); do
    ch="${input:i:1}"; two="${input:i:2}"
    case "$state" in
      UNQUOTED)
        if   [[ "$two" == "\$'" ]]; then
          [[ "$mode" == "strip" ]] && result+="$two"
          i=$((i+2)); state="ANSI_C_QUOTED"
        elif [[ "$two" == '$"' ]]; then
          [[ "$mode" == "strip" ]] && result+="$two"
          i=$((i+2)); state="LOCALE_QUOTED"
        elif [[ "$ch" == '\' ]]; then
          [[ "$mode" == "strip" ]] && result+="${input:i:2}"
          i=$((i+2))
        elif [[ "$ch" == "'" ]]; then
          [[ "$mode" == "strip" ]] && result+="$ch"
          i=$((i+1)); state="SINGLE_QUOTED"
        elif [[ "$ch" == '"' ]]; then
          [[ "$mode" == "strip" ]] && result+="$ch"
          i=$((i+1)); state="DOUBLE_QUOTED"
        elif [[ "$ch" == '#' ]] && [[ "$mode" == "strip" ]]; then
          # Comment: discard to end of line (preserve \n as separator)
          while (( i < len )) && [[ "${input:i:1}" != $'\n' ]]; do i=$((i+1)); done
        else
          # Regular UNQUOTED character
          if [[ "$mode" == "glob" ]] && [[ "$ch" =~ [*?{[] ]]; then
            return 1  # unquoted glob found
          fi
          [[ "$mode" == "strip" ]] && result+="$ch"
          i=$((i+1))
        fi ;;
      SINGLE_QUOTED)
        # \ is literal; any ' exits (there is no escape mechanism here)
        [[ "$mode" == "strip" ]] && result+="$ch"
        [[ "$ch" == "'" ]] && state="UNQUOTED"
        i=$((i+1)) ;;
      DOUBLE_QUOTED|LOCALE_QUOTED)
        if [[ "$ch" == '\' ]]; then
          [[ "$mode" == "strip" ]] && result+="${input:i:2}"
          i=$((i+2))
        elif [[ "$ch" == '"' ]]; then
          [[ "$mode" == "strip" ]] && result+="$ch"
          i=$((i+1)); state="UNQUOTED"
        else
          [[ "$mode" == "strip" ]] && result+="$ch"
          i=$((i+1))
        fi ;;
      ANSI_C_QUOTED)
        if [[ "$ch" == '\' ]]; then
          [[ "$mode" == "strip" ]] && result+="${input:i:2}"
          i=$((i+2))
        elif [[ "$ch" == "'" ]]; then
          [[ "$mode" == "strip" ]] && result+="$ch"
          i=$((i+1)); state="UNQUOTED"
        else
          [[ "$mode" == "strip" ]] && result+="$ch"
          i=$((i+1))
        fi ;;
    esac
  done
  # Fail-closed: unclosed quote is malformed input
  if [[ "$state" != "UNQUOTED" ]]; then
    [[ "$mode" == "strip" ]] && { printf '%s' "$result"; return 2; }
    return 1   # glob mode: fail-closed on malformed input
  fi
  [[ "$mode" == "strip" ]] && printf '%s' "$result"
  return 0
}

# ── Guard 3 pattern functions (P4–P7) ─────────────────────────────────────────

_g3_p4_cat_glob() {
  local s="$1"
  local cat_re="${_G3_POS}${_G3_MOD}${_G3_PATH}cat([[:space:]]|$)"
  local rest="$s"
  while [[ "$rest" =~ $cat_re ]]; do
    local mlen=${#BASH_REMATCH[0]}
    local after="${rest:mlen}"
    _g3_scan "glob" "$after" || return 1   # rc=1 means glob found → block
    rest="$after"
    [[ -z "$rest" ]] && break
  done
  return 0
}

_g3_p5_cmdsubst() {
  local s="$1"
  local util_re="${_G3_POS}${_G3_MOD}${_G3_PATH}${_G3_READERS}([[:space:]]|$)"
  [[ "$s" =~ $util_re ]] || return 0
  local after="${s#*${BASH_REMATCH[0]}}"
  # Exempt: argument is exactly "$(cmd)"/literal-path  (with or without surrounding quotes)
  local exempt_re='^"?\$\(([^)]+)\)"?(/[A-Za-z0-9_./@%-]+)"?$'
  [[ "$after" =~ $exempt_re ]] && return 0
  local _p5_dp='\$\('
  [[ "$after" =~ $_p5_dp ]] && return 1   # unquoted var → ERE; matches literal $(
  [[ "$after" == *'`'* ]]   && return 1   # glob match for backtick
  return 0
}

_g3_grep_has_matchall_pattern() {
  local s="$1"
  local matchall_re='(\.\*|\.|\.\+|\^|"")'
  # Check every -e pattern (loop to handle multiple -e flags)
  local rest="$s"
  while [[ "$rest" =~ [[:space:]]-e[[:space:]]+([^[:space:]]+) ]]; do
    local pat="${BASH_REMATCH[1]//\'/}"; pat="${pat//\"/}"
    [[ "$pat" =~ ^($matchall_re)$ ]] && return 0
    rest="${rest#*${BASH_REMATCH[0]}}"
  done
  if [[ "$s" =~ --regexp[=[:space:]]+([^[:space:]]+) ]]; then
    local pat="${BASH_REMATCH[1]//\'/}"; pat="${pat//\"/}"
    [[ "$pat" =~ ^($matchall_re)$ ]] && return 0
  fi
  local -a toks; read -ra toks <<< "$s"
  local seen_cmd=0 pat=""
  for tok in "${toks[@]}"; do
    [[ "$tok" =~ ^(git|grep|egrep|fgrep|-r|-R|--recursive|-[a-zA-Z]+)$ ]] && { seen_cmd=1; continue; }
    (( seen_cmd == 0 )) && continue
    [[ "$tok" == *'('* || "$tok" == *')'* ]] && continue  # skip subshell/process-subst tokens
    [[ "$tok" =~ ^- ]] && continue
    [[ "$tok" =~ ^(/|./|../|~/) ]] && continue
    [[ "$tok" =~ [/] ]] && [[ ! "$tok" =~ [*+?[\](){}^\$|\\] ]] && continue
    pat="${tok//\'/}"; pat="${pat//\"/}"
    break
  done
  [[ -z "$pat" ]] && return 0
  [[ "$pat" =~ ^($matchall_re)$ ]] && return 0
  return 1
}

_g3_p6_grep_matchall() {
  local s="$1"
  [[ "$s" =~ [[:space:]]-F([[:space:]]|$) ]]             && return 0
  [[ "$s" =~ [[:space:]]--fixed-strings([[:space:]]|$) ]] && return 0
  if [[ "$s" =~ ${_G3_POS}${_G3_MOD}(grep|egrep|fgrep)([[:space:]]|$) ]]; then
    [[ "$s" =~ [[:space:]](-r|-R|--recursive)([[:space:]]|$) ]] || return 0
    _g3_grep_has_matchall_pattern "$s" && return 1
  fi
  if [[ "$s" =~ ${_G3_POS}git[[:space:]]+grep([[:space:]]|$) ]]; then
    _g3_grep_has_matchall_pattern "$s" && return 1
  fi
  return 0
}

_g3_p7_pager_glob() {
  local s="$1"
  local pager_re="${_G3_POS}${_G3_MOD}${_G3_PATH}(less|more|head|tail|sed|awk)([[:space:]]|$)"
  local rest="$s"
  while [[ "$rest" =~ $pager_re ]]; do
    local mlen=${#BASH_REMATCH[0]}
    local after="${rest:mlen}"
    _g3_scan "glob" "$after" || return 1   # rc=1 means glob found → block
    rest="$after"
    [[ -z "$rest" ]] && break
  done
  return 0
}

_g3_p8_ls_recursive() {
  local s="$1"
  [[ "$s" =~ ${_G3_POS}${_G3_MOD}${_G3_PATH}ls([[:space:]]|$) ]] || return 0
  [[ "$s" =~ [[:space:]]--recursive([[:space:]]|$) ]]                    && return 1
  [[ "$s" =~ [[:space:]]-R([[:space:]]|$) ]]                             && return 1
  [[ "$s" =~ [[:space:]]-[a-zA-Z]*R[a-zA-Z]*([[:space:]]|$) ]]          && return 1
  return 0
}

_g3_p9_shell_loop() {
  local s="$1"
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
  [[ "$s" =~ ${_G3_POS}(eval|source)([[:space:]]|$) ]] && return 1
  [[ "$s" =~ ${_G3_POS}\.[[:space:]] ]]                && return 1
  [[ "$s" =~ ${_G3_POS}\.$  ]]                         && return 1
  return 0
}

_g3_p12_alias() {
  local s="$1"
  [[ "$s" =~ ${_G3_POS}alias[[:space:]] ]] || return 0
  if [[ "$s" =~ alias[[:space:]]+[A-Za-z_][A-Za-z_0-9]*=(.+) ]]; then
    local val="${BASH_REMATCH[1]}"
    val="${val#\'}"; val="${val%\'}"; val="${val#\"}"; val="${val%\"}"
    [[ "$val" =~ ^(${_G3_READERS}|eval|source|\.)[[:space:]] ]] && return 1
    [[ "$val" =~ ^(${_G3_READERS}|eval|source|\.)$ ]]           && return 1
  fi
  return 0
}

_g3_obfuscation() {
  local s="$1"
  local _obf_dollar_dq='^\$"'
  [[ "$s" =~ $_obf_dollar_dq ]]                              && return 1
  [[ "$s" =~ ${_G3_POS}(\\.)+([[:space:]]|$) ]]             && return 1
  [[ "$s" =~ ${_G3_POS}[a-zA-Z]\'[a-zA-Z]+\'[a-zA-Z] ]]    && return 1
  return 0
}

# Returns 0 (allow) if the preprocessed command string is covered by BASH_SCAN_ALLOWLIST;
# returns 1 (do not allow) otherwise. Called only when a pattern has already fired.
_g3_check_allowlist() {
  local s="$1"
  (( ${#BASH_SCAN_ALLOWLIST[@]} == 0 )) && return 1

  # Delimiter: space/tab/newline, ;, |, (, )  — common shell command separators.
  # Written as a bracket class that is safe in ERE without backslash escaping issues.
  local _bd='(^|[[:space:]|;()])'
  local _ad='([[:space:]|;()]|$)'
  local entry
  for entry in "${BASH_SCAN_ALLOWLIST[@]}"; do
    [[ -z "$entry" ]] && continue
    if [[ "${entry: -1}" == "/" ]]; then
      # Directory entry: suffix may contain globs (*?) but must not traverse up with ..
      local pat="${_bd}${entry}([A-Za-z0-9_./@%*?-]*)${_ad}"
      if [[ "$s" =~ $pat ]]; then
        local suffix="${BASH_REMATCH[2]}"
        [[ "$suffix" =~ (^|/)\.\.(/|$) ]] && continue
        return 0
      fi
    else
      # Exact whole-token match
      local pat="${_bd}${entry}${_ad}"
      [[ "$s" =~ $pat ]] && return 0
    fi
  done
  return 1
}

# ── Guard 3 regex constants ────────────────────────────────────────────────────
# All patterns below are POSIX ERE (GNU libc implementation).
# Rules: no \b (use ([[:space:]]|^|$) word boundaries), no backreferences,
#        no non-greedy quantifiers, no named groups, POSIX bracket expressions only.

# Command-execution-position operator or keyword — used as prefix before utility names.
# Note: | in character class is literal; no escaping needed inside [...].
_G3_POS='(^|[|;{([!&]|`|&&|\|\||;;|\$\(|<\(|>\(|(then|else|elif|do)[[:space:]]|![[:space:]])[[:space:]]*'
# Optional prefix-modifier chain (env, exec, time, nohup, coproc, command, builtin)
_G3_MOD='((env|exec|time|nohup|coproc|command|builtin)([[:space:]]+[^[:space:]]+)*[[:space:]]+)?'
# Optional path prefix before binary name (e.g. /bin/, ./scripts/)
_G3_PATH='([A-Za-z0-9_./@%-]*/)?'
# Monitored reading/viewing utilities
_G3_READERS='(cat|less|more|head|tail|sed|awk|grep|egrep|fgrep|mapfile|readarray)'
# Shell interpreters blocked in find -exec and xargs
_G3_SHELLS='(sh|bash|dash|zsh|ksh|fish)'

_g3_p1_find_depth() {
  local s="$1"
  [[ "$s" =~ ${_G3_POS}${_G3_MOD}${_G3_PATH}find([[:space:]]|$) ]] || return 0
  if [[ "$s" =~ -(-)?maxdepth[=[:space:]]+([+]?)([0-9]+) ]]; then
    [[ "${BASH_REMATCH[3]}" == "1" ]] && return 0
    return 1  # depth != 1 -> block
  fi
  return 1    # no depth flag -> block
}

_g3_p2_find_exec() {
  local s="$1"
  [[ "$s" =~ ${_G3_POS}${_G3_MOD}${_G3_PATH}find([[:space:]]|$) ]] || return 0
  [[ "$s" =~ -(exec|execdir|ok|okdir)[[:space:]] ]]              || return 0
  [[ "$s" =~ -(exec|execdir|ok|okdir)[[:space:]]+(${_G3_READERS}|${_G3_SHELLS})([[:space:]]|$) ]] \
    && return 1
  return 0
}

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

# ── Guard 3: Bash command scan ─────────────────────────────────────────────────
# BASH_SCAN_ALLOWLIST: exact literal path tokens the guard permits.
# Operators add entries here. Agents must NEVER modify this array.
BASH_SCAN_ALLOWLIST=()

if [ "${CLAUDE_TOOL_NAME:-}" = "Bash" ]; then
  _G3_CMD=$(_g3_extract_command "${CLAUDE_TOOL_INPUT:-}")

  if [ -z "${_G3_CMD:-}" ]; then
    unset _G3_CMD; exit 0
  fi

  # Length guard: fail-closed on oversized input to protect the scanner from abuse
  if (( ${#_G3_CMD} > 8192 )); then
    printf '\n⛔ BASH SCAN BLOCKED\n' >&2
    printf '   Command string exceeds maximum scan length (8192 chars).\n\n' >&2
    unset _G3_CMD; exit 1
  fi

  # Step 4a: join line continuations
  _G3_JOINED=$(_g3_join_continuations "$_G3_CMD")
  unset _G3_CMD

  # Step 4b: strip comments via unified scanner (mode="strip")
  _G3_SCAN_RC=0
  _G3_PRE=$(_g3_scan "strip" "$_G3_JOINED") || _G3_SCAN_RC=$?
  unset _G3_JOINED

  # Fail-closed: malformed input (rc=2 means unclosed quote)
  if (( _G3_SCAN_RC == 2 )); then
    printf '\n⛔ BASH SCAN BLOCKED\n' >&2
    printf '   Malformed shell syntax (unclosed quote) — blocked as a precaution.\n\n' >&2
    unset _G3_PRE; exit 1
  fi

  # Normalise real newlines to semicolons (simplifies all pattern regexes)
  _G3_PRE="${_G3_PRE//$'\n'/;}"

  # Run pattern checks; accumulate triggered pattern IDs for diagnostics
  _G3_HIT=0; _G3_IDS=""
  _g3_p1_find_depth "$_G3_PRE" || { _G3_HIT=1; _G3_IDS+="P1 "; }
  _g3_p2_find_exec  "$_G3_PRE" || { _G3_HIT=1; _G3_IDS+="P2 "; }
  _g3_p3_xargs      "$_G3_PRE" || { _G3_HIT=1; _G3_IDS+="P3 "; }
  _g3_p4_cat_glob      "$_G3_PRE" || { _G3_HIT=1; _G3_IDS+="P4 "; }
  _g3_p5_cmdsubst      "$_G3_PRE" || { _G3_HIT=1; _G3_IDS+="P5 "; }
  _g3_p6_grep_matchall "$_G3_PRE" || { _G3_HIT=1; _G3_IDS+="P6 "; }
  _g3_p7_pager_glob    "$_G3_PRE" || { _G3_HIT=1; _G3_IDS+="P7 "; }
  _g3_p8_ls_recursive    "$_G3_PRE" || { _G3_HIT=1; _G3_IDS+="P8 "; }
  _g3_p9_shell_loop      "$_G3_PRE" || { _G3_HIT=1; _G3_IDS+="P9 "; }
  _g3_p10_slurp_builtins "$_G3_PRE" || { _G3_HIT=1; _G3_IDS+="P10 "; }
  _g3_p11_dynamic_exec   "$_G3_PRE" || { _G3_HIT=1; _G3_IDS+="P11 "; }
  _g3_p12_alias          "$_G3_PRE" || { _G3_HIT=1; _G3_IDS+="P12 "; }
  _g3_obfuscation        "$_G3_PRE" || { _G3_HIT=1; _G3_IDS+="OBF "; }

  if (( _G3_HIT )); then
    # Allowlist check: if the flagged command is covered by an explicit operator entry, pass it.
    _g3_check_allowlist "$_G3_PRE" && { unset _G3_PRE _G3_HIT _G3_IDS; exit 0; }
    # Debug logging: export GUARD3_DEBUG=1 in the terminal to diagnose false positives
    if [[ "${GUARD3_DEBUG:-0}" == "1" ]]; then
      printf '[Guard3 DEBUG] preprocessed: %s\n' "$_G3_PRE"            >&2
      printf '[Guard3 DEBUG] matched patterns: %s\n' "${_G3_IDS%" "}"  >&2
    fi

    printf '\n⛔ BASH SCAN BLOCKED\n'                                                 >&2
    printf '   Command triggered a mass content-dump pattern.\n'                      >&2
    printf '   Pattern IDs: %s\n\n' "${_G3_IDS%" "}"                                 >&2
    printf '   Authorized search alternatives (see skills/memory-first.md):\n'       >&2
    printf '   1. Grep tool  — targeted content search with file/pattern scope\n'    >&2
    printf '   2. Glob tool  — path listing only, no file content\n'                 >&2
    printf '   3. Read tool  — with explicit offset + limit (max 150 lines)\n\n'     >&2
    printf '   If this path must be scanned broadly, add it to BASH_SCAN_ALLOWLIST\n' >&2
    printf '   in .claude/hooks/pre-tool-use.sh (operator action only).\n\n'         >&2
    unset _G3_PRE _G3_HIT _G3_IDS; exit 1
  fi
  unset _G3_PRE _G3_HIT _G3_IDS
fi

# ── Guard 4 — block Read on graphify-out/ and node_modules/ (BUG-017) ─────────────────────
# To reset to GitHub upstream: delete .claude/hooks/pre-tool-use.sh, then re-run installer.
if [ "$CLAUDE_TOOL_NAME" = "Read" ]; then
    _g4_result=$(printf '%s' "$CLAUDE_TOOL_INPUT" | python3 -c '
import json, sys, posixpath
raw = sys.stdin.buffer.read().decode("utf-8", errors="replace")
d = json.loads(raw)
fp = d.get("file_path", "").strip()
fp_n = posixpath.normpath(fp.replace("\\", "/"))
parts = [p.lower() for p in fp_n.split("/") if p and p != "."]
blocked = {"graphify-out", "node_modules"}
print("BLOCK" if any(p in blocked for p in parts) else "OK")
' 2>/dev/null) || true
    if [ "$_g4_result" = "BLOCK" ]; then
        echo '{"decision":"block","reason":"Guard 4: direct reads of graphify-out/ and node_modules/ are forbidden. Use Glob for existence checks or the graphify skill: /graphify query \"<question>\"."}'
        exit 1
    fi
    # Debug: set CC_GUARD4_DEBUG=1 to log fail-open events to stderr for diagnostics.
    if [ -n "${CC_GUARD4_DEBUG:-}" ] && [ "$_g4_result" != "OK" ]; then
        printf '[Guard 4 debug] fail-open: _g4_result="%s"\n' "$_g4_result" >&2
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
