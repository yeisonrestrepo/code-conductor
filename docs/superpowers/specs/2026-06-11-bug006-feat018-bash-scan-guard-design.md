# BUG-006 + FEAT-018: Bash Scan Guard and Surgical Search Enforcement

**Date:** 2026-06-11
**IDs:** BUG-006, FEAT-018
**Status:** Approved

---

## Problem

Two related defects in Pillar 1 (Context Reduction and Token Optimization):

**BUG-006 — Loose Read-Tool Filtering:** The Bash tool is unrestricted. The agent can run mass content-dump commands (`find .`, `ls -R`, `cat *.ts`, `grep -r '.*' .`) that flood the context window with megabytes of unscoped file content. The existing `pre-tool-use.sh` hook guards the `Read` tool for large files but does not intercept Bash tool calls at all.

**FEAT-018 — Surgical Search Not Enforced at Hook Level:** `skills/memory-first.md` documents the Grep → Glob → targeted-Read lookup chain, but BUG-002's implementation notes explicitly deferred hook-level enforcement to FEAT-018. The skill currently has no connection to a runtime guard, so the chain is advisory-only.

Combined impact: agents can bypass the memory-first protocol entirely by issuing a single Bash command that dumps the full repository into context.

---

## Solution

Add **Guard 3** to `pre-tool-use.sh` — a Bash-tool interceptor that pattern-matches mass-dump commands and hard-blocks them (`exit 1`) unless the full command string contains a token from the operator-managed `BASH_SCAN_ALLOWLIST` array. Extend `skills/memory-first.md` with a "Hook enforcement" section that names what Guard 3 blocks and lists the authorized alternatives, completing the FEAT-018 documentation side.

---

## Behavior

### Main path

1. Claude Code invokes the Bash tool with a command string.
2. The `PreToolUse` hook fires; `pre-tool-use.sh` is executed.
3. Guard 3 checks: is `CLAUDE_TOOL_NAME == "Bash"`? If not, skip Guard 3.
4. Guard 3 preprocesses the command string in two sequential normalization steps before any pattern evaluation:
   - **4a — Line continuation joining:** Scan each line's trailing characters before the newline; count the number of consecutive backslashes immediately preceding the newline. If that count is **odd**, the final backslash is a line-continuation escape — replace the entire backslash-newline sequence with a single space and join the line to the next. If the count is **even**, all backslashes are paired literal-escape sequences and the newline is a real line terminator; no joining is performed. (Example: `cmd \<newline>arg` has one backslash → odd → joined to `cmd arg`; `cmd \\<newline>arg` has two backslashes → even → not joined; `cmd \\\<newline>arg` has three backslashes → odd → the first two form a literal `\\` and the third is the continuation.)
   - **4b — Comment stripping:** Remove everything from the first unquoted, non-backslash-escaped `#` to end-of-line. A `\#` sequence is a literal hash and does not begin a comment (e.g., a regex argument of `\#foo` is preserved intact). **Tokenization strategy (pure Bash):** Use a three-state character scanner — UNQUOTED, SINGLE_QUOTED, DOUBLE_QUOTED — implemented as a `while` loop over `${cmd:i:1}` character indices. Rules: (a) In UNQUOTED state: a `\` causes the immediately following character to be consumed as a literal without state evaluation — the loop index must advance by an extra position (`i += 2` instead of `i += 1` for that iteration) to fully skip the escaped character so it is not re-evaluated; a `'` (not preceded by `\`) transitions to SINGLE_QUOTED; a `"` (not preceded by `\`) transitions to DOUBLE_QUOTED; a `#` (not preceded by `\`) begins a comment — everything from that index to end-of-line is removed. (b) In SINGLE_QUOTED state: no escape sequences are recognised; only a bare `'` exits back to UNQUOTED. (c) In DOUBLE_QUOTED state: a `\` causes the next character to be consumed as a literal with the same `i += 2` index advance; a `"` not preceded by `\` exits back to UNQUOTED. This produces the **comment-stripped string**, which is the base for all subsequent steps.
5. Guard 3 runs each blocked-pattern check against the comment-stripped string (see Blocked Patterns table). Patterns 4 and 7 (glob/multi-file expansion detection) use the three-state scanner defined in Step 4b to determine whether each expansion character (`*`, `**`, `?`, `{…}`, `[…]`) appears in UNQUOTED state — characters inside single or double quotes are not subject to shell glob expansion and must not trigger the block (e.g., `cat '*.md'` targets the literal filename `*.md` and must not be blocked; `cat *.md` expands to multiple files and must be blocked). Pattern 9 (loop keyword detection) also operates on the comment-stripped string with the three-state scanner to identify unquoted shell keywords. All patterns operate on the comment-stripped string with quotes intact. If no pattern matches, exit 0 (allow).
6. If a pattern matches, Guard 3 checks the comment-stripped command string for allowlist tokens. Each entry in `BASH_SCAN_ALLOWLIST` is checked as a whole token — the character immediately preceding the entry must be whitespace, `;`, `|`, `(`, `)`, `{`, `[`, `}`, `]`, `'`, `"`, or start-of-string; the character immediately following must be whitespace, `;`, `|`, `(`, `)`, `{`, `[`, `}`, `]`, `'`, `"`, or end-of-string. **Exception:** when the allowlist entry ends with `/`, alphanumeric characters and `_`, `-`, `.`, `/` are also permitted on the right side, because they indicate a file or subdirectory inside the allowed directory rather than a substring violation (e.g., an entry of `"docs/"` must match `docs/file.txt` and `docs/sub/page.md`). **Path traversal guard:** after a `/`-terminated match, scan the remaining path string up to the next whitespace or operator; if any path component in that string is `..` (i.e., the string contains `/../`, starts with `../`, ends with `/..`, or is exactly `..`), the allowlist match is rejected and the block proceeds — `docs/../../etc/passwd` must not be permitted through a `docs/` allowlist entry. The forward slash is **not** a delimiter on the left-side boundary check. Pure substring matching is not used.
7. If any allowlist token matches, exit 0 (allow).
8. Otherwise: print the standard block message to stderr and exit 1.

### Alternative paths

- **Allowlisted path:** If the command targets a path in `BASH_SCAN_ALLOWLIST`, the guard exits 0 and the command runs normally.
- **Non-Bash tool:** Guard 3 is skipped entirely; Guards 1 and 2 (existing) apply as before.
- **Empty or missing `CLAUDE_TOOL_INPUT`:** Guard 3 exits 0 (safe default, no false positives on empty input).
- **Chained safe + blocked command** (`ls -l && cat *.ts`, `echo ok; find . -maxdepth 2`): Guard 3 evaluates the **entire command string** as a unit. If any segment anywhere in the chain matches a blocked pattern, the entire tool invocation is blocked. The guard does not split on shell operators to evaluate segments independently — doing so would allow blocked commands to be smuggled after a safe prefix.

### Error cases

- **Comment-based bypass attempt** (`cat *.ts # docs/`): comment is stripped before allowlist check; `docs/` is never evaluated as an allowlist match.
- **Partial substring bypass** (`cat doc_files.ts` when allowlist contains `docs`): word-boundary check prevents `docs` from matching inside `doc_files`.
- **Chained safe + blocked command** (`ls -l && cat *.ts`): the entire command string is evaluated as a unit; the presence of a safe prefix does not exempt the blocked segment from triggering exit 1.
- **Backtick substitution bypass** (`` cat `ls` ``): Pattern 5 detects backtick form identically to `$(` form.
- **Agent attempts to modify `BASH_SCAN_ALLOWLIST`:** This is a strict constraint violation (see Hard Constraints). The agent must not alter the array.

---

## Blocked Patterns

All pattern checks run against the **comment-stripped** command string (quote normalization is pattern-specific — see step 5 of Main Path).

**Binary name word boundaries and command position:** All binary name matches (`cat`, `find`, `ls`, `grep`, `egrep`, `fgrep`, `less`, `more`, `head`, `tail`, `sed`, `awk`) must satisfy two conditions simultaneously:
1. **Word boundary** — the name must not be a substring of a longer word (e.g., `lsblk`, `concatenate`, `findall` must not trigger).
2. **Command execution position** — a token is in command execution position when it appears at the start of the command string, or immediately following a shell operator (`|`, `&&`, `||`, `;`, `;;`, `$(`, `<(`, `>(`, `` ` ``, `{`, `[`, `(`, or newline), or immediately following one of the shell keywords `then`, `else`, `elif`, or `do`. The bare `(` operator covers standard subshell blocks (e.g., `(cat *.ts)` — the `cat` immediately follows `(` and is in command execution position). Detection applies to the **entire path token**, not just the basename: if a path token is in command execution position and its last path component (basename) is a monitored binary, the block triggers (e.g., `/bin/cat *.ts` and `./scripts/cat *.ts` must be blocked — the full token `/bin/cat` is in command position, and its basename is `cat`). Conversely, a monitored name appearing as an intermediate path component in an argument token is not in command position and must not trigger (e.g., the `/find/` component of `grep -r x /path/to/find/results` is an argument, not a command token).
3. **Command prefix modifiers** — a binary name also satisfies command execution position when it appears after a recognized runner prefix (`env`, `exec`, `time`, or `nohup`), with zero or more intervening tokens that are either (a) flag arguments (tokens beginning with `-` or `--`), (b) environment variable assignments (tokens matching `[A-Za-z_][A-Za-z_0-9]*=.*`), or (c) option-arguments consumed by a known option-taking flag of the current prefix modifier. Known option-taking flags per modifier: `env` → `-u` (takes the variable name to unset); `exec` → `-a` (takes the name for argv[0]); `time` → `-o` (takes an output filename, non-POSIX); `nohup` → none. When a known option-taking flag is encountered, the immediately following token is consumed as its argument and skipped, even if that token begins with `-`. This ensures `env -u OLD_VAR cat *.ts`, `exec -a myname cat *.ts`, and `env VAR=val cat *.ts` all trigger the guard as if the utility were in bare command position; tokens after option-arguments continue the prefix scan until a non-flag, non-assignment, non-option-argument token is reached — that token is treated as the binary name.

| # | Category | Blocked examples | Detection rule |
|---|---|---|---|
| 1 | `find` missing or wrong depth | `find .`, `find src/ -maxdepth 2`, `find / --maxdepth=5` | Command contains `find` at command execution position and either has no depth-limiting flag, or has a depth-limiting flag whose resolved value is not `1`; both space-separated form (`-maxdepth 2`, `--maxdepth 2`) and equals-sign form (`-maxdepth=2`, `--maxdepth=2`) are detected — the numeric value is extracted regardless of separator |
| 2 | `find` exec content dump | `find . -exec cat {} \;`, `find . -exec less {} \;` | Command contains `find` + `-exec` + any reading/viewing utility |
| 3 | `xargs` + viewer/pager | `ls \| xargs cat`, `find . \| xargs -0 less`, `xargs -I {} cat {}`, `{ xargs head; }`, `xargs cat < file_list` | `xargs` at any command execution position followed by any reading utility; intermediate `xargs` flags are skipped during utility detection — **option-taking flags** (consume next token as argument): `-I`/`--replace`, `-n`/`--max-args`, `-P`/`--max-procs`, `-s`/`--max-chars`, `-a`/`--arg-file`, `-d`/`--delimiter`, `-E`/`--eof`; **boolean flags** (consume no extra token): `-0`/`--null`, `-r`/`--no-run-if-empty`, `-x`/`--exit`, `-t`/`--verbose`, `-p`/`--interactive`; **hyphen-starting arguments**: when an option-taking flag's immediately following token begins with `-`, it is consumed as the argument only if it is a bare `-` (exactly one hyphen, no following letters); if it begins with `-` followed by at least one letter (e.g., `-x`, `-0`) it is treated as another flag, not consumed as the option's argument (e.g., `xargs -d - cat` → `-d` consumes bare `-` as its delimiter argument → `cat` is the utility → blocked; `xargs -d -x cat` → `-d` does not consume `-x` → `-x` is treated as boolean flag → `cat` is the utility → blocked; `xargs -I {} cat` → `-I` consumes `{}` → `cat` is the utility → blocked) |
| 4 | `cat` + multi-file expansion | `cat *.md`, `cat src/**/*.ts`, `cat dir/??.sh`, `cat {a,b}.ts`, `cat [abc].md` | `cat` at command execution position followed by an argument token that, when scanned with the three-state scanner in UNQUOTED state, contains a glob or multi-file expansion character: `*`, `**`, `?`, `{…,…}` (brace expansion), or `[…]` (bracket set); expansion characters inside single or double quotes are NOT in UNQUOTED state and must not trigger (e.g., `cat '*.md'` must not block); backslash-escaped wildcard forms (`\*`, `\?`) in UNQUOTED state are consumed by the `i += 2` escape rule and must not trigger; double-backslash forms (`\\*`, `\\?`) in UNQUOTED state correctly yield a literal backslash followed by an active wildcard and MUST trigger |
| 5 | Command substitution + reading | `cat $(ls)`, `` cat `ls` ``, `less $(find .)`, `cat src/$(target_dir)/main.ts` | Command contains any reading utility at command execution position followed by an argument token that **contains** a command substitution expression anywhere within it — either `$(` (POSIX form) or an unquoted backtick `` ` `` (legacy form) — including when the substitution is embedded after a path prefix (e.g., `cat src/$(target_dir)/main.ts` must be blocked because the argument token contains `$(`); **exempt** only when both of these conditions hold: (1) there is no static path prefix before the substitution (the substitution is the first dynamic component in the token), and (2) the remainder of the shell word after the closing `)` or backtick — obtained by stripping the entire token's enclosing or boundary quotation marks first, then taking everything after the `)` or backtick — consists solely of a `/`-prefixed literal path with no further substitution or glob characters; stripping is applied to the full token boundary (opening and closing quotes of the enclosing word), not only to characters directly adjacent to the closing `)` (e.g., `cat "$(git rev-parse --show-toplevel)"/package.json` — no prefix before `$(`, remainder after `)` is `"/package.json"` → after stripping the surrounding `"` tokens, remainder is `/package.json` → allowed; `cat "$(git rev-parse --show-toplevel)/package.json"` — no prefix before `$(`, the whole token is double-quoted; after stripping the enclosing `"…"`, the post-`)` content is `/package.json` → allowed; `cat src/$(target_dir)/main.ts` — has `src/` prefix before `$(` → blocked) |
| 6 | `grep` family match-all | `grep -r '.*' .`, `egrep -R "" .`, `fgrep -r . src/`, `git grep '.*'`, `git grep ''` | Two sub-rules: (a) `grep`, `egrep`, or `fgrep` at command execution position with a recursive flag (`-r`, `-R`, or `--recursive`) and a match-all pattern (`.*`, `"."`, `.+`, `^`) — recursive flag required because these tools are not recursive by default; (b) `git grep` at command execution position with a match-all pattern only — no recursive flag required because `git grep` inherently searches the entire repository by default; **literal-match exemption**: if `-F` or `--fixed-strings` is present anywhere in the argument list, Pattern 6 must not fire regardless of the pattern value — `-F` disables regex interpretation so `.*` is a literal two-character string, not a match-all regex; for both sub-rules (when `-F`/`--fixed-strings` is absent), pattern argument isolation works as follows: (i) if one or more `-e` flags or `--regexp` options are present, each argument immediately following any `-e`, `--regexp PATTERN` (space form), or embedded in `--regexp=PATTERN` (equals form, value extracted after `=`) is treated as a pattern expression — if ANY such expression is match-all (or empty after quote stripping), the rule fires (e.g., `grep -r -e foo -e '.*' .` fires on the second `-e` argument; `grep -r --regexp='.*' .` fires on the `.*` value; `grep -r --regexp foo --regexp '.*' .` fires on the second `--regexp` argument); (ii) if `-f` is present (patterns loaded from a file), the file contents cannot be statically analysed — `-f` is out of scope for Pattern 6 and must not trigger the block; (iii) if neither `-e`/`--regexp` nor `-f` is present, the first non-flag, non-path-looking argument is treated as the pattern; (iv) **"path-looking" definition**: a token is path-looking if, after stripping surrounding quotes, it begins with `/`, `./`, `../`, or `~/`, OR consists solely of characters in `[A-Za-z0-9_./-]` while containing at least one `/` and no regex metacharacters (`*`, `.`, `+`, `?`, `[`, `]`, `(`, `)`, `{`, `}`, `^`, `$`, `|`, `\`) — such tokens are interpreted as file or directory paths; a token containing a regex metacharacter is NOT path-looking even if it also contains a `/` (e.g., `src/.*` is not path-looking because it contains `.` and `*`; `src/main.ts` is path-looking); (v) empty or whitespace-only pattern string after quote stripping is treated as match-all (e.g., `git grep ''` after quote stripping → block) |
| 7 | Streaming/paging + multi-file expansion | `less *.ts`, `head *.log`, `awk '{print}' *.ts`, `sed -n p *.md`, `less {a,b}.log`, `head [0-9].txt` | `less`, `more`, `head`, `tail`, `sed`, or `awk` at command execution position, followed by an argument token that, when scanned with the three-state scanner in UNQUOTED state, contains a glob or multi-file expansion character: `*`, `**`, `?`, `{…,…}` (brace expansion), or `[…]` (bracket set); expansion characters inside quotes must not trigger; `\*`/`\?` in UNQUOTED state are consumed as escaped literals and must not trigger; `\\*`/`\\?` in UNQUOTED state DO trigger |
| 8 | `ls -R` | `ls -R .`, `ls -laR`, `ls -lR src/`, `ls --recursive src/` | Command contains `ls` as an invoked command token and also contains: `--recursive`, a standalone `-R` token, or a short-flag cluster token that begins with a single hyphen and whose remaining characters are solely ASCII letters and include `R` (matching `-[a-zA-Z]*R[a-zA-Z]*`); the `R` check is anchored to tokens matching this pattern and must not fire on arbitrary substrings, path components, or parameters that happen to contain the letter `R` (e.g., `rsync -R`, `git diff -R`, paths like `/myRdir/` must not trigger) |
| 9 | Shell loop + reading | `for f in *.ts; do cat $f; done`, `while true; do less $f; done`, `until false; do grep -r . ; done` | Command contains `for`, `while`, or `until` satisfying both conditions: (a) encountered in UNQUOTED state by the three-state scanner defined in Step 4b, and (b) appearing at a command execution position as defined in the Blocked Patterns preamble (start of string, after a shell operator, or after `then`/`else`/`elif`/`do`); keywords encountered as plain arguments or path components must not fire (e.g., `grep -r pattern while_loop.ts` must not block on `while`, `cat for` must not block on `for`) |

**Reading/viewing utilities** (used across multiple rules): `cat`, `less`, `more`, `head`, `tail`, `sed`, `awk`, `grep`, `egrep`, `fgrep`.

---

## Allowlist

```bash
BASH_SCAN_ALLOWLIST=()
```

- Defined as a Bash array at the top of Guard 3.
- **Default is empty.** No paths are permitted for broad scans out of the box.
- Operators add entries as needed (e.g., `"docs/"`, `".claude/"`).
- **Agents must never modify this array.** See Hard Constraints.
- Token check: each entry is matched against the **comment-stripped** command string (quotes are preserved) using boundary delimiters (whitespace, `;`, `|`, `(`, `)`, `{`, `[`, `}`, `]`, `'`, `"`) on both sides. The forward slash is **not** a left-side delimiter. When an entry ends with `/`, the right-side boundary permits alphanumeric, `_`, `-`, `.`, and `/` (to allow files and subdirectories inside the allowed path), but the remaining path is validated: if it contains any `..` component, the match is rejected and the command is blocked. A substring-only match is not sufficient.

---

## Standard Block Message

When Guard 3 blocks a command, it prints to stderr:

```
⛔ BASH SCAN BLOCKED
   Command triggered a mass content-dump pattern.

   Authorized search alternatives (see skills/memory-first.md):
   1. Grep tool  — targeted content search with file/pattern scope
   2. Glob tool  — path listing only, no file content
   3. Read tool  — with explicit offset + limit (max 150 lines)

   If this path must be scanned broadly, add it to BASH_SCAN_ALLOWLIST
   in .claude/hooks/pre-tool-use.sh (operator action only).
```

---

## Acceptance Criteria

- [ ] Guard 3 fires only when `CLAUDE_TOOL_NAME == "Bash"`.
- [ ] All nine blocked-pattern categories from the table above are intercepted and hard-blocked (exit 1).
- [ ] Multi-line commands joined by trailing backslash-newline are collapsed correctly: a line ending in an **odd** number of consecutive backslashes is a continuation and is joined to the next line (backslash-newline replaced by a space); a line ending in an **even** number of backslashes is not a continuation and is left as a real line terminator (e.g., `cmd \\\<newline>arg` → odd count → joined; `cmd \\<newline>arg` → even count → not joined).
- [ ] Shell comments are stripped globally before any pattern check or allowlist evaluation; `\#` is treated as a literal hash and does not begin a comment.
- [ ] No quote stripping is applied globally or per-pattern; the comment-stripped string retains quotes for all pattern checks; Patterns 4 and 7 use the three-state scanner to detect expansion characters only in UNQUOTED state (e.g., `cat '*.md'` is NOT blocked; `cat *.md` IS blocked).
- [ ] All binary name matches satisfy both word boundary and command execution position requirements; a binary name appearing as a path component or string argument does not trigger a block (e.g., `grep -r x /path/to/find/results` must not block on `find`); a binary name invoked via an absolute or relative path (e.g., `/bin/cat *.md`, `./cat *.md`) is treated as in command execution position — the path-invoked form triggers the guard identically to the bare name.
- [ ] Command execution position recognises `{`, `[`, `(`, backtick `` ` ``, `<(`, `>(`, `;;`, `then`, `else`, `elif`, and `do` as valid preceding operators alongside `|`, `&&`, `||`, `;`, `$(`, and newline; bare `(` covers standard subshell blocks so `(cat *.ts)` is blocked.
- [ ] A blocked utility preceded by `env`, `exec`, `time`, or `nohup` is treated as being in command execution position and triggers the guard; intervening tokens that are flag arguments, environment variable assignments (matching `[A-Za-z_][A-Za-z_0-9]*=.*`), or option-arguments of the prefix's known option-taking flags are all skipped before reaching the utility name (e.g., `env -u OLD_VAR cat *.ts`, `exec -a myname cat *.ts`, `env VAR=val cat *.ts`, `env -i cat *.ts`, `time -p find .` all block).
- [ ] Unquoted-hash detection (Step 4b) and unquoted-keyword detection (Pattern 9) both use the three-state scanner (UNQUOTED / SINGLE_QUOTED / DOUBLE_QUOTED) implemented as a character-by-character Bash loop; in UNQUOTED state a leading `\` causes the next character to be consumed as a literal, preventing `\"` or `\'` from triggering erroneous state transitions.
- [ ] Patterns 4 and 7 do not block tokens where `*` or `?` are preceded by a single `\` (escaped wildcards are literals); double-backslash forms `\\*` and `\\?` do trigger the block because they represent a literal backslash followed by an active wildcard.
- [ ] Pattern 8 only fires on short-flag tokens whose full form matches `-[a-zA-Z]*R[a-zA-Z]*`; path components, parameters, and strings that merely contain the letter `R` do not trigger.
- [ ] Pattern 9 loop keywords (`for`, `while`, `until`) must satisfy both the UNQUOTED state condition and a command execution position check; bare keyword appearances as arguments or path components do not trigger.
- [ ] Pattern 3 detects `xargs` at any command execution position, not only in pipe-joined configurations (e.g., `{ xargs cat; }` and `xargs cat < file_list` are both blocked); option-taking `xargs` flags consume the immediately following token as their argument when: (a) the token does not begin with `-`, OR (b) the token is exactly a bare `-` (one hyphen, no letters); tokens beginning with `-` followed by at least one letter are always treated as another flag and never consumed as an option argument; boolean flags never consume a following token regardless of form (e.g., `xargs -d - cat` → `-d` consumes bare `-` → `cat` identified → blocked; `xargs -d -x cat` → `-d` does not consume `-x` → `-x` treated as boolean → `cat` identified → blocked).
- [ ] Pattern 5 fires on any argument token that **contains** a command substitution expression (`$(` or unquoted backtick) anywhere within it — including when the substitution is preceded by a static path prefix (e.g., `cat src/$(target_dir)/main.ts` is blocked); the exemption requires two conditions to both hold: (1) no static prefix precedes the substitution within the token, and (2) after stripping the token's **enclosing or boundary quotation marks** (the full opening and closing quotes of the shell word, not only characters adjacent to the closing `)`), the content following the substitution is a `/`-prefixed literal path with no further substitution or glob characters — both `cat "$(git rev-parse --show-toplevel)"/package.json` (separate unquoted suffix) and `cat "$(git rev-parse --show-toplevel)/package.json"` (suffix inside the same double-quoted word) satisfy this exemption and must pass through.
- [ ] Pattern 6 recursive flag is `-r`, `-R`, or `--recursive`; when `-F` or `--fixed-strings` is present, Pattern 6 does NOT fire regardless of pattern value (e.g., `grep -r -F '.*' .` passes through); Pattern 6 isolates the pattern argument via: (a) `-e`/`--regexp` forms — any match-all expression from a `-e ARG`, `--regexp ARG`, or `--regexp=ARG` fires the rule; (b) without those forms, the first non-flag, non-path-looking argument is the pattern — "path-looking" means a token that, after quote stripping, begins with `/`, `./`, `../`, or `~/`, or contains at least one `/` and no regex metacharacters; (c) `-f` (file-sourced patterns) is out of scope and must not trigger the block; `grep -r --regexp='.*' .` and `grep -r --regexp '.*' .` are both detected identically to `grep -r -e '.*' .`.
- [ ] Allowlist entries ending with `/` permit alphanumeric, `_`, `-`, `.`, and `/` characters on the right boundary, so `"docs/"` matches both `docs/file.txt` and `docs/sub/page.md` without treating them as substring violations; the **entire** remaining path component (from the allowlist prefix to the next whitespace or operator) is validated: if any path component in the remainder is `..`, the match is rejected and the block proceeds (e.g., `docs/../../etc/passwd` is blocked even when `"docs/"` is in the allowlist).
- [ ] Pattern 3 skips non-hyphen option-arguments of intermediate `xargs` flags (e.g., the `{}` replacement string after `-I`) before locating the reading utility.
- [ ] The three-state scanner advances the loop index by 2 (`i += 2`) when processing a backslash escape sequence in UNQUOTED or DOUBLE_QUOTED state, ensuring the escaped character is not re-evaluated in the next iteration (e.g., `\*` costs two index positions — position of `\` and position of `*` — so `*` is never seen as a standalone expansion character).
- [ ] Pattern 1 detects depth-limiting flags in both space-separated (`-maxdepth 2`) and equals-sign (`--maxdepth=2`) forms, extracting the numeric value regardless of separator.
- [ ] `<(` and `>(` are recognised as command execution position operators, closing the process-substitution bypass vector (e.g., `while read; do cat $f; done < <(ls *.ts)` is blocked).
- [ ] Allowlist boundary delimiters include `{` and `[` on both sides of each token for symmetry with the execution-position operator set.
- [ ] Patterns 4 and 7 detect brace expansions (`{a,b}`) and bracket sets (`[abc]`) in addition to `*`, `**`, and `?`.
- [ ] For the grep family (Pattern 6), an empty or whitespace-only pattern argument after quote stripping is treated as a match-all and triggers the block.
- [ ] The block message is written to stderr; it explicitly names `skills/memory-first.md` and lists the three authorized alternatives (Grep, Glob, Read with offset+limit).
- [ ] Allowlist token matching operates on the comment-stripped string (quotes preserved) using boundary delimiters (whitespace, `;`, `|`, `(`, `)`, `}`, `]`, `'`, `"`); the forward slash is NOT a delimiter so that path-based entries like `"docs/"` match as whole tokens; pure substring matching is not used.
- [ ] Pattern 5 detects both `$(` (POSIX) and backtick (legacy) command substitution forms.
- [ ] `git grep` with a match-all pattern is blocked without requiring a recursive flag; `grep`/`egrep`/`fgrep` require a recursive flag in addition to a match-all pattern.
- [ ] Pattern 8 intercepts clustered short flags containing `R` (e.g., `-laR`, `-lR`) as well as standalone `-R` and `--recursive`, anchored to `ls` at command execution position.
- [ ] A Bash command string containing a blocked pattern in any segment is blocked in full, regardless of safe commands chained before or after it via `&&`, `||`, `|`, or `;`.
- [ ] An empty `BASH_SCAN_ALLOWLIST` blocks all matching commands with no exceptions.
- [ ] A non-empty `BASH_SCAN_ALLOWLIST` allows commands whose comment-stripped string contains a matching whole token.
- [ ] `BASH_SCAN_ALLOWLIST` remains `()` in the committed hook; any agent modification to this array is a constraint violation and must be caught in review.
- [ ] Guards 1 and 2 (existing large-file Read guard and duplicate-file creation guard) are unmodified.
- [ ] `project-template/.claude/hooks/pre-tool-use.sh` is an exact mirror of the live hook.
- [ ] `skills/memory-first.md` contains a "Hook enforcement" section documenting the guard.
- [ ] `project-template/skills/memory-first.md` is an exact mirror of `skills/memory-first.md`.

---

## Out of Scope

- Glob tool interception (Glob returns paths only, no content — risk is low).
- Dynamic allowlist loading from an external file.
- Post-execution output filtering (hooks cannot intercept tool output).
- Enforcement on non-Bash tools beyond what Guards 1 and 2 already cover.
- PowerShell equivalents of the blocked patterns (Windows hook support is a separate item).

---

## System Impact

- **`.claude/hooks/pre-tool-use.sh`** — Guard 3 inserted after Guard 2. Guards 1 and 2 remain unchanged.
- **`project-template/.claude/hooks/pre-tool-use.sh`** — mirrored.
- **`skills/memory-first.md`** — new section appended; existing chain steps unchanged.
- **`project-template/skills/memory-first.md`** — new file; `project-template/skills/` directory created.
- **`.claude/settings.json`** — no change needed; PreToolUse hook matcher already covers all tool names via the existing command invocation.

### Deferred reads
- Full content of `pre-tool-use.sh` needed at implementation time (line offset for Guard 3 insertion point).
- Full content of `skills/memory-first.md` needed at implementation time (append point).

---

## Complexity Estimate

**M** — Two hook files, two skill files, pattern logic in pure Bash. No new dependencies. The comment-stripping and word-boundary logic require careful Bash regex work but are self-contained within one guard block.
