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
4. Guard 3 strips shell comments from the command string: everything from the first unquoted `#` to end-of-line is removed. This produces the **comment-stripped string**, which is the base for all subsequent steps.
5. Guard 3 runs each blocked-pattern check against the comment-stripped string (see Blocked Patterns table). Patterns 4 and 7 (glob/multi-file expansion detection) additionally apply **per-pattern quote normalization** — single and double quotes are stripped from the token under inspection before checking for expansion characters, so `cat '*.md'` is caught identically to `cat *.md`. Pattern 9 (loop keyword detection) operates on the comment-stripped string only, preserving quote context to distinguish unquoted shell keywords from literal string arguments. All other patterns also operate on the comment-stripped string. If no pattern matches, exit 0 (allow).
6. If a pattern matches, Guard 3 checks the comment-stripped command string for allowlist tokens. Each entry in `BASH_SCAN_ALLOWLIST` is checked as a whole token — delimited by whitespace, `/`, `;`, `|`, `(`, `)`, `}`, `]`, `'`, or `"` on both sides. Quotes are preserved in this string (not stripped globally), so they serve as valid token boundaries. Pure substring matching is not used.
7. If any allowlist token matches, exit 0 (allow).
8. Otherwise: print the standard block message to stderr and exit 1.

### Alternative paths

- **Allowlisted path:** If the command targets a path in `BASH_SCAN_ALLOWLIST`, the guard exits 0 and the command runs normally.
- **Non-Bash tool:** Guard 3 is skipped entirely; Guards 1 and 2 (existing) apply as before.
- **Empty or missing `CLAUDE_TOOL_INPUT`:** Guard 3 exits 0 (safe default, no false positives on empty input).

### Error cases

- **Comment-based bypass attempt** (`cat *.ts # docs/`): comment is stripped before allowlist check; `docs/` is never evaluated as an allowlist match.
- **Partial substring bypass** (`cat doc_files.ts` when allowlist contains `docs`): word-boundary check prevents `docs` from matching inside `doc_files`.
- **Agent attempts to modify `BASH_SCAN_ALLOWLIST`:** This is a strict constraint violation (see Hard Constraints). The agent must not alter the array.

---

## Blocked Patterns

All pattern checks run against the **comment-stripped** command string (quote normalization is pattern-specific — see step 5 of Main Path).

**Binary name word boundaries and command position:** All binary name matches (`cat`, `find`, `ls`, `grep`, `egrep`, `fgrep`, `less`, `more`, `head`, `tail`, `sed`, `awk`) must satisfy two conditions simultaneously:
1. **Word boundary** — the name must not be a substring of a longer word (e.g., `lsblk`, `concatenate`, `findall` must not trigger).
2. **Command execution position** — the name must appear as an executed command token: at the start of the command string, or immediately following a shell operator (`|`, `&&`, `||`, `;`, `$(`, or newline). A binary name appearing as a path component (preceded by `/`) or as a plain argument is not in command position and must not trigger a block (e.g., `grep -r pattern /path/to/find/results` must not block on `find`).

| # | Category | Blocked examples | Detection rule |
|---|---|---|---|
| 1 | `find` missing or wrong depth | `find .`, `find src/ -maxdepth 2`, `find / -maxdepth 5` | Command contains `find` and either has no `-maxdepth` flag, or has `-maxdepth` with a value other than `1` |
| 2 | `find` exec content dump | `find . -exec cat {} \;`, `find . -exec less {} \;` | Command contains `find` + `-exec` + any reading/viewing utility |
| 3 | `xargs` pipe to viewer/pager | `ls \| xargs cat`, `find . \| xargs -0 less`, `echo f \| xargs -I{} head {}` | Command contains `xargs` followed by any reading utility, with optional intermediate flags (`-0`, `-I`, `-n`, `-P`, etc.) permitted between `xargs` and the utility name — globally, regardless of what precedes the pipe |
| 4 | `cat` + multi-file expansion | `cat *.md`, `cat src/**/*.ts`, `cat dir/??.sh`, `cat {a,b}.ts`, `cat [abc].md` | `cat` at command execution position followed by a token containing a glob or multi-file expansion character: `*`, `**`, `?`, `{…,…}` (brace expansion), or `[…]` (bracket set); per-pattern quote normalization applied before this check |
| 5 | Command substitution + reading | `cat $(ls)`, `less $(find .)`, `head $(grep -r .)` | Command contains any reading utility (`cat`, `less`, `more`, `head`, `tail`, `sed`, `awk`) followed by `$(` with zero or more spaces between them |
| 6 | `grep` family match-all | `grep -r '.*' .`, `egrep -R "" .`, `fgrep -r . src/`, `git grep '.*' --` | `grep`, `egrep`, `fgrep`, or `git grep` at command execution position, with a recursive flag (`-r`, `-R`, or `--all`) and a match-all pattern (`.*`, `""`, `"."`, `.+`, `^`); additionally, if stripping quotes from the pattern argument produces an empty or whitespace-only string, treat it as a match-all (e.g., `grep -r '' .` after quote stripping yields an empty pattern → block) |
| 7 | Streaming/paging + multi-file expansion | `less *.ts`, `head *.log`, `awk '{print}' *.ts`, `sed -n p *.md`, `less {a,b}.log`, `head [0-9].txt` | `less`, `more`, `head`, `tail`, `sed`, or `awk` at command execution position, followed by a token containing a glob or multi-file expansion character: `*`, `**`, `?`, `{…,…}` (brace expansion), or `[…]` (bracket set); per-pattern quote normalization applied before this check |
| 8 | `ls -R` | `ls -R .`, `ls --recursive src/` | Command contains `ls` as an invoked command token and also contains `-R` or `--recursive`; must not fire for other commands that accept those flags (e.g., `rsync -R`, `git diff -R`) |
| 9 | Shell loop + reading | `for f in *.ts; do cat $f; done`, `while true; do less $f; done`, `until false; do grep -r . ; done` | Command contains `for`, `while`, or `until` as an unquoted shell keyword (not as a literal argument to `echo`, `printf`, `grep`, or similar — e.g., `echo "while true"` must not fire) co-occurring with any reading utility in the same command string |

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
- Token check: each entry is matched against the **comment-stripped** command string (quotes are preserved) using word-boundary delimiters (whitespace, `/`, `;`, `|`, `(`, `)`, `}`, `]`, `'`, `"`) on both sides of the token. A substring-only match is not sufficient.

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
- [ ] Shell comments are stripped globally before any pattern check or allowlist evaluation.
- [ ] Quote normalization (stripping single and double quotes) is applied only per-pattern for patterns 4 and 7; the comment-stripped string retains quotes for pattern 9 keyword detection and allowlist token boundary matching.
- [ ] All binary name matches satisfy both word boundary and command execution position requirements; a binary name appearing as a path component or string argument does not trigger a block (e.g., `grep -r x /path/to/find/results` must not block on `find`).
- [ ] Patterns 4 and 7 detect brace expansions (`{a,b}`) and bracket sets (`[abc]`) in addition to `*`, `**`, and `?`.
- [ ] For the grep family (Pattern 6), an empty or whitespace-only pattern argument after quote stripping is treated as a match-all and triggers the block.
- [ ] The block message is written to stderr; it explicitly names `skills/memory-first.md` and lists the three authorized alternatives (Grep, Glob, Read with offset+limit).
- [ ] Allowlist token matching operates on the comment-stripped string (quotes preserved) using word-boundary delimiters (whitespace, `/`, `;`, `|`, `(`, `)`, `}`, `]`, `'`, `"`); pure substring matching is not used.
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
