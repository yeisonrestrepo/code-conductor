#!/usr/bin/env bash
# FROZEN CORPUS SUBJECT. NOT A SHIPPED ARTIFACT.
#
# The bash Guard 3 implementation as it stood at 1.27.2. It ships to no one: the
# installer deploys project-template/.claude/hooks/pre-tool-use.mjs, whose Guard 3
# slot is declared and empty. These twelve patterns are the behavioral authority
# the [BUG-037] port is verified against, exercised unchanged by the 108 cases in
# tests/hooks/guard3.test.js. Do not edit to make a port pass.
#
# Six sanctioned exceptions exist. The first two are recorded in
# docs/superpowers/specs/2026-09-25-bug037-guard3-port-and-first-ship-design.md:
#   1. The allowlist is populated from .claude/memory/bash-scan-allowlist.txt
#      instead of an array literal, so both subjects read one source.
#   2. The port escapes allowlist entries and matches them literally, where this
#      file interpolates them raw into an ERE. With entry file.ts, the command
#      "cat fileXts *.md" is therefore allowed here and denied there. That
#      inequality is asserted by design in the corpus EXCEPTIONS table; it is
#      not a port defect.
#   3. The P4 and P7 walks slice from the END of the match rather than by the
#      match LENGTH from position 0. The original form shaved len(match) bytes
#      off the FRONT and re-scanned, walking leftward until the cut landed inside
#      a quoted region, where _g3_scan's fail-closed clause reported a glob that
#      was never in the command. bash's [[ =~ ]] reports no index, so the length
#      slice was the form nearest to hand; it was never intended behavior, and
#      the index is in fact derivable, which is what the correction does.
#      Corrected in both subjects under [BUG-041], recorded in
#      docs/superpowers/specs/2026-09-28-bug041-guard3-refinement-design.md.
#   4. _g3_scan gained a third mode, "mask", which emits a length-preserved copy of
#      its input with every character inside a quoted span replaced by x and the
#      quote characters themselves kept. The dispatch builds that copy BEFORE the
#      newline-to-semicolon substitution and hands it to eleven of the thirteen
#      checks. P6 and P12 keep the unmasked string because they read quoted content
#      BY DESIGN: a grep pattern and an alias value are the data those checks exist
#      to inspect. The allowlist also reads the unmasked string. Without this, quoted
#      argv text was analyzed as code, which fired P9 on prose, code and regexes, OBF
#      on escape runs inside quoted patterns, P5 on an escaped backtick and P11 on an
#      English sentence's period. Added in both subjects under [BUG-043], recorded in
#      docs/superpowers/specs/2026-09-28-bug043-quoted-argv-blindness-design.md.
#   5. _g3_scan gained a SIXTH STATE, HEREDOC, entered on a heredoc introducer and
#      left on the line equal to the delimiter. Body characters are emitted blanked
#      and length-preserved and do NOT feed quote-parity tracking, so content being
#      WRITTEN can neither trip a pattern check nor produce a malformed denial. The
#      argument is the guard's purpose: a heredoc body is content being written and
#      is already inside the command string this scanner holds, so it cannot flood
#      anything, and no dump shape uses one (measured: an unredirected `cat <<EOF`
#      reads zero files). Four specimens across four consecutive sessions are corpus
#      rows. Two details are load-bearing and must not be "simplified": `<<<` is a
#      HERE-STRING and is excluded by the third-character test, because `cat <<< [x]`
#      denies P4 and must keep denying; and the terminator's newline is kept VERBATIM,
#      unlike quoted regions which mask newlines, because a command following a
#      heredoc would otherwise lose its command position and a real dump would stop
#      denying. Added in both subjects under [BUG-047], recorded in
#      docs/superpowers/specs/2026-09-29-bug047-heredoc-body-scanning-design.md.
#   6. _g3_check_allowlist covers a path written as ONE whole quoted token, "docs/x"
#      or 'docs/x', besides the bare form. The quote must open right after a
#      boundary and close right before one, so a quote mid-word is never a boundary:
#      a quote splitting a path cannot end the match before a ../ the traversal check
#      must see, and quote concatenation cannot cover a path the entry does not name.
#      The quoted suffix is the bare class plus a space and nothing wider, because $( )
#      executes inside double quotes and the mask leaves the allowlist deciding alone.
#      The bare boundaries are unchanged. An owner redesign under [BUG-045], which
#      replaced a boundary-append form that measurably opened four traversal shapes and
#      two concatenation shapes on both subjects. The quoted-path corpus rows record it.
# Nothing else in this file moves.

set -euo pipefail
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
  # Unified 6-state scanner (UNQUOTED / SINGLE_QUOTED / DOUBLE_QUOTED /
  #   ANSI_C_QUOTED / LOCALE_QUOTED / HEREDOC).  Two modes:
  #   "strip" — outputs comment-stripped string to stdout; returns 0 (ok) or 2 (malformed).
  #   "glob"  — returns 1 if an unquoted glob char found, 0 if not, 1 on malformed (fail-closed).
  # Malformed = state != UNQUOTED at end of input (unclosed quote).
  # SINGLE_QUOTED: \ is literal; ANY ' exits (including directly after \).
  local mode="$1" input="$2"
  local state="UNQUOTED" result=""
  local i=0 len=${#input} ch="" two=""
  local hd_pending="" hd_delim="" hd_dash=0
  while (( i < len )); do
    ch="${input:i:1}"; two="${input:i:2}"
    case "$state" in
      UNQUOTED)
        if   [[ "$two" == "\$'" ]]; then
          [[ "$mode" == "strip" || "$mode" == "mask" ]] && result+="$two"
          i=$((i+2)); state="ANSI_C_QUOTED"
        elif [[ "$two" == '$"' ]]; then
          [[ "$mode" == "strip" || "$mode" == "mask" ]] && result+="$two"
          i=$((i+2)); state="LOCALE_QUOTED"
        elif [[ "$ch" == '\' ]]; then
          [[ "$mode" == "strip" || "$mode" == "mask" ]] && result+="${input:i:2}"
          i=$((i+2))
        elif [[ "$ch" == "'" ]]; then
          [[ "$mode" == "strip" || "$mode" == "mask" ]] && result+="$ch"
          i=$((i+1)); state="SINGLE_QUOTED"
        elif [[ "$ch" == '"' ]]; then
          [[ "$mode" == "strip" || "$mode" == "mask" ]] && result+="$ch"
          i=$((i+1)); state="DOUBLE_QUOTED"
        elif [[ "$two" == '<<' ]] && [[ "${input:i+2:1}" != '<' ]]; then
          # Heredoc introducer. `<<<` is a HERE-STRING, not a heredoc, and excluding
          # it is load-bearing: `cat <<< [x]` denies P4 today and must keep denying.
          # The body does not begin until after this line's newline, so the delimiter
          # is recorded and the rest of the line keeps being scanned as command text.
          local j=$((i+2)) q="" w=""
          hd_dash=0
          [[ "${input:j:1}" == '-' ]] && { hd_dash=1; j=$((j+1)); }
          while [[ "${input:j:1}" == ' ' || "${input:j:1}" == $'\t' ]]; do j=$((j+1)); done
          [[ "${input:j:1}" == "'" || "${input:j:1}" == '"' ]] && { q="${input:j:1}"; j=$((j+1)); }
          while [[ "${input:j:1}" =~ [A-Za-z0-9_.-] ]]; do w+="${input:j:1}"; j=$((j+1)); done
          [[ -n "$q" && "${input:j:1}" == "$q" ]] && j=$((j+1))
          if [[ -n "$w" ]]; then
            # Delimiter quoting is recorded and then IGNORED: this scanner performs no
            # expansion, so <<'EOF' and <<EOF are the same to it. [BUG-047]
            hd_pending="$w"
            [[ "$mode" == "strip" || "$mode" == "mask" ]] && result+="${input:i:j-i}"
            i=$j
          else
            [[ "$mode" == "strip" || "$mode" == "mask" ]] && result+="$ch"
            i=$((i+1))
          fi
        elif [[ "$ch" == '#' ]] && [[ "$mode" == "strip" ]]; then
          # Comment: discard to end of line (preserve \n as separator)
          while (( i < len )) && [[ "${input:i:1}" != $'\n' ]]; do i=$((i+1)); done
        else
          # Regular UNQUOTED character
          if [[ "$mode" == "glob" ]] && [[ "$ch" =~ [*?{[] ]]; then
            return 1  # unquoted glob found
          fi
          [[ "$mode" == "strip" || "$mode" == "mask" ]] && result+="$ch"
          i=$((i+1))
          if [[ "$ch" == $'\n' && -n "$hd_pending" ]]; then
            hd_delim="$hd_pending"; hd_pending=""; state="HEREDOC"
          fi
        fi ;;
      HEREDOC)
        # One line at a time. Every non-newline character is blanked to 'x',
        # length-preserved because the P4/P7 walks slice by match LENGTH and a change
        # in length would desynchronise them.
        #
        # Newlines are kept VERBATIM here, unlike quoted regions, which mask them.
        # Quoted masking exists so a newline inside a string cannot become a
        # command-position anchor. Here the opposite is needed: the newline AFTER the
        # terminator must survive, or a command following the heredoc loses its command
        # position and `cat *.ts` after a heredoc stops denying. Body newlines are
        # harmless because everything around them is 'x'. [BUG-047]
        local hd_line="" hd_eol=$i hd_cmp="" hd_k=0
        while (( hd_eol < len )) && [[ "${input:hd_eol:1}" != $'\n' ]]; do hd_eol=$((hd_eol+1)); done
        hd_line="${input:i:hd_eol-i}"
        hd_cmp="$hd_line"
        if [[ "$hd_dash" == 1 ]]; then
          while [[ "$hd_cmp" == $'\t'* ]]; do hd_cmp="${hd_cmp#?}"; done
        fi
        # Only a line EQUAL to the delimiter terminates. A substring would end the
        # state early and expose the rest of the body to the patterns.
        #
        # THE TERMINATOR IS EMITTED VERBATIM, and that is load-bearing. The dispatch
        # runs this scanner TWICE, building the mask from strip's output, so the
        # transformation has to be IDEMPOTENT. A blanked terminator is unfindable on
        # the second pass: the scanner re-enters HEREDOC at the same introducer, never
        # terminates, and blanks every command after the heredoc. The symptom is a
        # genuine dump following a heredoc silently ceasing to deny, which is exactly
        # what the scope control caught. Body lines carry no such requirement, because
        # nothing downstream needs to find them again. [BUG-047]
        if [[ "$hd_cmp" == "$hd_delim" ]]; then
          [[ "$mode" == "strip" || "$mode" == "mask" ]] && result+="$hd_line"
          state="UNQUOTED"; hd_delim=""; hd_dash=0
        elif [[ "$mode" == "strip" || "$mode" == "mask" ]]; then
          hd_k=0
          while (( hd_k < ${#hd_line} )); do result+="x"; hd_k=$((hd_k+1)); done
        fi
        i=$hd_eol
        if (( i < len )); then
          [[ "$mode" == "strip" || "$mode" == "mask" ]] && result+=$'\n'
          i=$((i+1))
        fi
        ;;
      SINGLE_QUOTED)
        # \ is literal; any ' exits (there is no escape mechanism here)
        [[ "$mode" == "strip" ]] && result+="$ch"
        if [[ "$mode" == "mask" ]]; then
          if [[ "$ch" == "'" ]]; then result+="$ch"; else result+="x"; fi
        fi
        [[ "$ch" == "'" ]] && state="UNQUOTED"
        i=$((i+1)) ;;
      DOUBLE_QUOTED|LOCALE_QUOTED)
        if [[ "$ch" == '\' ]]; then
          [[ "$mode" == "strip" ]] && result+="${input:i:2}"
          [[ "$mode" == "mask" ]] && result+="xx"
          i=$((i+2))
        elif [[ "$ch" == '"' ]]; then
          [[ "$mode" == "strip" || "$mode" == "mask" ]] && result+="$ch"
          i=$((i+1)); state="UNQUOTED"
        else
          [[ "$mode" == "strip" ]] && result+="$ch"
          [[ "$mode" == "mask" ]] && result+="x"
          i=$((i+1))
        fi ;;
      ANSI_C_QUOTED)
        if [[ "$ch" == '\' ]]; then
          [[ "$mode" == "strip" ]] && result+="${input:i:2}"
          [[ "$mode" == "mask" ]] && result+="xx"
          i=$((i+2))
        elif [[ "$ch" == "'" ]]; then
          [[ "$mode" == "strip" || "$mode" == "mask" ]] && result+="$ch"
          i=$((i+1)); state="UNQUOTED"
        else
          [[ "$mode" == "strip" ]] && result+="$ch"
          [[ "$mode" == "mask" ]] && result+="x"
          i=$((i+1))
        fi ;;
    esac
  done
  # Fail-closed: unclosed quote is malformed input.
  #
  # HEREDOC is deliberately exempt, and the exemption must not be "normalised" away.
  # The rule exists because an unbalanced quote leaves AMBIGUITY about where command
  # text resumes, and the scanner refuses to guess. An unterminated heredoc leaves no
  # ambiguity: everything to end of input is body and there is no "after", so there is
  # nothing unread to protect. Bash agrees, measured rather than assumed: on GNU bash
  # 3.2.57, the interpreter this file runs under, a script ending mid-heredoc delivers
  # the body and exits 0 with NO warning; newer bash also warns and still proceeds.
  # Fail-closed here would deny every draft of a file write whose delimiter line has
  # not arrived yet, which is [BUG-047]'s own defect resurrected in a new state. The
  # departure from the pattern is correct BECAUSE the pattern's premise does not apply.
  if [[ "$state" != "UNQUOTED" && "$state" != "HEREDOC" ]]; then
    [[ "$mode" == "strip" || "$mode" == "mask" ]] && { printf '%s' "$result"; return 2; }
    return 1   # glob mode: fail-closed on malformed input
  fi
  [[ "$mode" == "strip" || "$mode" == "mask" ]] && printf '%s' "$result"
  return 0
}

# ── Guard 3 pattern functions (P4–P7) ─────────────────────────────────────────

_g3_p4_cat_glob() {
  local s="$1"
  local cat_re="${_G3_POS}${_G3_MOD}${_G3_PATH}cat([[:space:]]|$)"
  local rest="$s"
  while [[ "$rest" =~ $cat_re ]]; do
    local pre="${rest%%"${BASH_REMATCH[0]}"*}"
    local after="${rest:${#pre}+${#BASH_REMATCH[0]}}"
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
    local pre="${rest%%"${BASH_REMATCH[0]}"*}"
    local after="${rest:${#pre}+${#BASH_REMATCH[0]}}"
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
  # [BUG-045] A path is covered bare or as ONE whole quoted token. Inside quotes the
  # suffix is the same class plus a space; nothing wider, because $( ) still executes
  # inside double quotes and the mask hides quoted text from every pattern check.
  local _sfx='([A-Za-z0-9_./@%*?-]*)'
  local _qsfx='([A-Za-z0-9_./@%*? -]*)'
  local _dq='"' _sq="'"
  local entry form pat
  for entry in "${BASH_SCAN_ALLOWLIST[@]}"; do
    [[ -z "$entry" ]] && continue
    if [[ "${entry: -1}" == "/" ]]; then
      # Directory entry: suffix may contain globs (*?) but must not traverse up with ..
      for form in "${entry}${_sfx}" "${_dq}${entry}${_qsfx}${_dq}" "${_sq}${entry}${_qsfx}${_sq}"; do
        pat="${_bd}${form}${_ad}"
        [[ "$s" =~ $pat ]] || continue
        [[ "${BASH_REMATCH[2]}" =~ (^|/)\.\.(/|$) ]] && break
        return 0
      done
    else
      # Exact whole-token match, bare or whole-quoted
      for form in "${entry}" "${_dq}${entry}${_dq}" "${_sq}${entry}${_sq}"; do
        pat="${_bd}${form}${_ad}"
        [[ "$s" =~ $pat ]] && return 0
      done
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
# Populated from .claude/memory/bash-scan-allowlist.txt, resolved against the
# process cwd, so operator policy survives an installer re-run. Absent or
# unreadable means an empty list. Blank lines and # comments are skipped, and
# each entry is trimmed. This is one of the two sanctioned edits to this file;
# see the header.
BASH_SCAN_ALLOWLIST=()
_g3_allowlist_file=".claude/memory/bash-scan-allowlist.txt"
if [ -r "$_g3_allowlist_file" ]; then
  while IFS= read -r _g3_line || [ -n "$_g3_line" ]; do
    _g3_line="${_g3_line%$'\r'}"
    _g3_line="${_g3_line#"${_g3_line%%[![:space:]]*}"}"
    _g3_line="${_g3_line%"${_g3_line##*[![:space:]]}"}"
    [ -z "$_g3_line" ] && continue
    case "$_g3_line" in '#'*) continue ;; esac
    BASH_SCAN_ALLOWLIST+=("$_g3_line")
  done < "$_g3_allowlist_file"
fi
unset _g3_line _g3_allowlist_file

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
  # Build the masked copy BEFORE the newline substitution, so a newline inside a quoted
  # region can never become a command-position anchor. [BUG-043].
  _G3_MASK=$(_g3_scan "mask" "$_G3_PRE")

  _G3_PRE="${_G3_PRE//$'\n'/;}"
  _G3_MASK="${_G3_MASK//$'\n'/;}"

  # Run pattern checks; accumulate triggered pattern IDs for diagnostics
  # Exactly two checks read quoted content BY DESIGN and therefore receive the UNMASKED
  # string: P6 reads the grep pattern, P12 reads the alias value. Every other check reads
  # code and receives the mask. The allowlist also reads the unmasked string. [BUG-043].
  _G3_HIT=0; _G3_IDS=""
  _g3_p1_find_depth "$_G3_MASK" || { _G3_HIT=1; _G3_IDS+="P1 "; }
  _g3_p2_find_exec  "$_G3_MASK" || { _G3_HIT=1; _G3_IDS+="P2 "; }
  _g3_p3_xargs      "$_G3_MASK" || { _G3_HIT=1; _G3_IDS+="P3 "; }
  _g3_p4_cat_glob      "$_G3_MASK" || { _G3_HIT=1; _G3_IDS+="P4 "; }
  _g3_p5_cmdsubst      "$_G3_MASK" || { _G3_HIT=1; _G3_IDS+="P5 "; }
  _g3_p6_grep_matchall "$_G3_PRE" || { _G3_HIT=1; _G3_IDS+="P6 "; }
  _g3_p7_pager_glob    "$_G3_MASK" || { _G3_HIT=1; _G3_IDS+="P7 "; }
  _g3_p8_ls_recursive    "$_G3_MASK" || { _G3_HIT=1; _G3_IDS+="P8 "; }
  _g3_p9_shell_loop      "$_G3_MASK" || { _G3_HIT=1; _G3_IDS+="P9 "; }
  _g3_p10_slurp_builtins "$_G3_MASK" || { _G3_HIT=1; _G3_IDS+="P10 "; }
  _g3_p11_dynamic_exec   "$_G3_MASK" || { _G3_HIT=1; _G3_IDS+="P11 "; }
  _g3_p12_alias          "$_G3_PRE" || { _G3_HIT=1; _G3_IDS+="P12 "; }
  _g3_obfuscation        "$_G3_MASK" || { _G3_HIT=1; _G3_IDS+="OBF "; }

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
