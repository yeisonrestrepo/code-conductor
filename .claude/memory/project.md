# Project Memory

Shared team memory. Committed to git. Updated automatically by /checkpoint.

## Stack
<!-- Set by /stack -->

## Architecture Decisions
<!-- Append by /checkpoint. Never delete entries. -->

## Active Conventions
<!-- Project-specific conventions established in this codebase -->

## Technical Debt
<!-- Known shortcuts, limitations, and deferred work -->

## Workarounds
<!-- Non-obvious solutions and why they exist -->

## Spec: contributing-and-license 2026-05-25

Add Apache 2.0 LICENSE, CONTRIBUTING.md (issue + PR workflow), and .github/pull_request_template.md (auto-fills PRs on GitHub).
- License: Apache 2.0, copyright 2026 Yeison Restrepo
- Three static files, no code changes

## Spec: cc-resume 2026-05-25

New `/cc-resume` command that restores full session context in a single invocation.
- Reads: CLAUDE.md, project.md, personal.md, latest spec + plan (mtime tiebreaker), git log + status
- Renders a structured Session Resume report, then runs `/cc-stack` to fully warm the session
- Guard: stops with `/cc-init` prompt if project identity is missing
- Scope: S — read-only synthesis, no new dependencies

## Checkpoint 2026-06-10 07:23

### Decisions
- BUG-002 (Spec Read Budget) fully implemented: 30-line cap on source file reads during /cc-spec phase
- Enforcement is prompt-only (cc-spec.md instruction block); hook-level enforcement deferred to FEAT-018
- Deferred-reads slot pre-rendered in System Impact template so agent always has a named place to record deferred files
- Task 3 pre-check pattern established: grep -c before any backlog checkbox edit; halt if count != 1

### Conventions
- Backlog checkbox edits require a pre-check grep (count=1) before proceeding
- Plan file insertion blocks use hyphen not em dash for markdown consistency

### Technical Debt
- claude-mem worker unreachable breaks Read/Edit tools via PreToolUse hook; workaround: use PowerShell for file reads and modifications
- AGENT-READABLE BACKLOG.md was untracked before this session; first commit added it as a new file

## Checkpoint 2026-06-10 (BUG-003)

### Decisions
- BUG-003 implemented: surgical 5-step plan-state ritual in cc-implement.md
- Task IDs `[T-NNN+]` mandated in cc-plan.md at generation time
- cc-resume.md extended to surface `[>]` and `[!]` markers in session report
- All six command files updated (`.claude` + `project-template` mirrors)
- Hook (Step 6) is a no-op conditional on `.conductor/cache.db`

### Conventions
- Plans must include `[T-NNN]` IDs on every task checkbox line
- 4-state checkbox protocol: `[ ]` pending, `[>]` in-progress, `[X]` complete, `[!]` failed
- Pre-flip uniqueness: Grep with `\[T-NNN\]` (plain pattern, no PCRE2); count must equal 1 before any Edit

### Technical Debt
- SQLite hook in cc-implement.md Step 6 is a no-op until FEAT-005 is implemented

## Checkpoint 2026-06-10 18:42 (implement phase)

### Decisions
- Version bumped to 1.8.0; CHANGELOG and README updated in a separate chore commit after the feature commit
- Read tool `offset` parameter is 1-based (offset: N returns line N); plan spec said `offset: N-1` but runtime behavior confirmed 1-based

### Workarounds
- `.claude/` and `docs/` are in `.gitignore`; committing files in those paths requires `git add -f`; applies to every future BUG/FEAT that touches `.claude/commands/`, `.claude/memory/`, or `docs/superpowers/`

## Checkpoint 2026-06-11 16:30 (BUG-004 + BUG-020)

### Decisions
- BUG-004 + BUG-020 implemented: `system-prompt.md` deleted from both locations; all behavior merged into `CLAUDE.md` as Zone 1 (project identity + dev commands) + Zone 2 (compacted agent rules)
- Live `CLAUDE.md` Zone 1 populated with actual project data; template retains blank placeholders
- Both files landed at 81 lines — well within 120-line ceiling; no trim passes required
- `install.sh` and `install.ps1` both had a `system-prompt.md` download step removed; README file tree updated to match
- Version bumped to 1.9.0; separate chore commit per personal.md preference

### Conventions
- `writing-plans` skill generates checkboxes without `[T-NNN]` IDs; `cc-implement` surgical ritual requires adapting to grep for `- [ ] **Step` instead of the T-NNN pattern when executing plans from that skill
- Live `.claude/system-prompt.md` was untracked (gitignored); deleted via filesystem only, not `git rm`

### Technical Debt
- `AGENT-READABLE BACKLOG.md` BUG-004 description still references "Superpowers" as the component; the actual fix targeted `CLAUDE.md` / `system-prompt.md` — description is now historically inaccurate but left as-is

## Spec: BUG-004 + BUG-020 CLAUDE.md Consolidation 2026-06-11

Merge `system-prompt.md` (127 lines, never read by Claude Code) into `CLAUDE.md` (currently empty placeholders) in one pass across both live workspace and `project-template/`. Delete both orphan `system-prompt.md` files.

- Zone 1: Project Identity, Development Commands (5 labels: Build/Test/Lint/Format/Setup), Architecture Notes, Conventions, Out of Scope, Active Stack Profiles
- Zone 2: Agent Identity (literal 2-sentence persona), Session Initialization, Dynamic Specialization, Operational Philosophy, Graph-First, Dependency Integrity, Sub-Agent Delegation, Response Tags, Verbosity MIN (with [VALIDATION]/[BUG] rules), Hard Constraints (5 bullets incl. BUG-003 invariant)
- Target: ≤120 lines; TERMINAL FAILURE halt if exceeded after 3 trim passes
- Step order: (1) diff live vs template, (2) delete template file, (3) delete live file, (4) rewrite template CLAUDE.md, (5) rewrite live CLAUDE.md with actual project data, (6) commit all four paths together
- Spec: `docs/superpowers/specs/2026-06-10-bug004-bug020-claude-md-consolidation-design.md`
- Complexity: S

## Spec: bug006-feat018-bash-scan-guard 2026-06-11

Add Guard 3 to `.claude/hooks/pre-tool-use.sh`: a Bash-tool interceptor that pattern-matches mass content-dump commands and hard-blocks them (`exit 1`). Also extend `skills/memory-first.md` with a "Hook enforcement" section, and mirror both files in `project-template/`.

- Guard fires when `CLAUDE_TOOL_NAME == "Bash"`; no other tool types are affected
- Preprocessing: (1) line continuation joining with odd-backslash-count rule; (2) comment stripping via three-state scanner (UNQUOTED/SINGLE_QUOTED/DOUBLE_QUOTED) with `i += 2` backslash escape advancement
- 9 blocked patterns: `find` without depth=1, `find -exec` viewer, `xargs` + viewer, `cat`/viewer + glob expansion, command substitution + reading utility, `grep` family match-all (with `-F` exemption), streaming/pager + glob, `ls -R`, shell loop + reader
- Static `BASH_SCAN_ALLOWLIST=()` — never agent-modified; path-based entries with `/`-terminated entries use path traversal guard for `..` components
- Spec: `docs/superpowers/specs/2026-06-11-bug006-feat018-bash-scan-guard-design.md`
- Complexity: M

## Checkpoint 2026-06-12 (BUG-006 + FEAT-018)

### Decisions
- Guard 3 fully implemented in `pre-tool-use.sh`: 12 patterns + obfuscation + allowlist check
- Unified 5-state scanner `_g3_scan MODE INPUT` (UNQUOTED/SINGLE_QUOTED/DOUBLE_QUOTED/ANSI_C_QUOTED/LOCALE_QUOTED); fail-closed on unclosed quotes (rc=2 → blocked)
- `BASH_SCAN_ALLOWLIST=()` — empty array, agent-immutable; directory entries use `[A-Za-z0-9_./@%*?-]*` suffix class with `../` traversal rejection; exact-token entries use whole-token boundary match
- ERE bracket expression quoting: `delim` uses `(^|[[:space:]|;()])` (named POSIX class) to avoid `\]` closing-bracket bug
- `_g3_grep_has_matchall_pattern` fixed: tokens containing `(` or `)` are skipped to prevent `$(grep` being misidentified as the pattern argument
- Test harness: `tests/guard3-test.sh`, 107 tests, run with `bash tests/guard3-test.sh`

### Conventions
- Guard 3 helpers named `_g3_*`; all take the preprocessed string as `$1`
- Pattern functions return 0 = pass, 1 = block (consistent with bash convention)
- `_g3_check_allowlist` called only when `_G3_HIT=1`; returns 0 = allow, 1 = block

### Technical Debt
- P5 (cmd-subst) exemption is heuristic; complex nested substitutions may produce false positives
- P3 (xargs) uses `read -ra` space-split; tab-separated args not parsed correctly
- Indirect variable dispatch (`$cmd *.ts`) is a documented blind spot — cannot be detected statically

### Version
1.10.0 released 2026-06-12

## Checkpoint 2026-06-16 (BUG-014 — verbosity-remind hooks, v1.11.0)

### Decisions
- Global hook at `$HOME/.claude/hooks/verbosity-remind.sh` traverses upward from `$PWD` looking for a project-level hook; stops at `$HOME` (not inclusive) to prevent self-reference — a hook found at `$HOME/.claude/hooks/verbosity-remind.sh` during traversal would be itself, causing silent exit 0 with no output
- `os.replace()` used instead of `os.rename()` in install.sh python3 merge block — `os.rename()` raises `FileExistsError` on Windows when destination exists; `os.replace()` is atomic on both POSIX and Windows (Python 3.3+)
- Settings merge uses exact-command idempotency check (full command string match, not substring) so re-runs with a changed hook path produce a fresh entry, not a false "already registered" skip

### Conventions
- Hook always exits 0 (`trap 'exit 0' EXIT ERR`) — Claude Code blocks prompt submission on non-zero hook exit
- Traversal cap: `_VERBOSITY_TRAVERSAL_CAP=40` (named constant, not magic number); covers paths up to 40 components deep
- Extraction loop guarded by `[ -f "$_mem_file" ] && [ -r "$_mem_file" ]` before `while ... done < "$_mem_file"` — missing file triggers ERR trap on the `<` redirect, causing silent exit 0 instead of MIN default
- Log format: `YYYY-MM-DD HH:MM:SS [<scope>] LEVEL message` (scope = global | project | install)
- Test harness: `tests/verbosity-hook-test.sh`, 18 assertions, EXIT:0 on Windows/MSYS2

### Technical Debt
- Installed hook at `~/.claude/hooks/verbosity-remind.sh` is manually copied; a fresh `bash install.sh` pulls from GitHub remote which does not yet have the v1.11.0 code — reinstalling before pushing to GitHub will overwrite with v1.10.0
- `os.rename` → `os.replace` fix in install.sh python3 block; the parallel perl/node fallback blocks were not audited for the same issue
- T-14 deep-path traversal test: verbosity.md must be at the BASE of a deep tree, not the LEAF — placing it at the leaf means it's found at iteration 0 before the cap fires (documented in test comments)

### Technical Notes
- bash resets `$PWD` on subprocess launch; tests using `PWD="$tmpdir" bash hook.sh` were all running from the actual repo CWD. Fixed with `(cd "$tmpdir" && bash hook.sh)` subshell pattern
- chmod 000 has no effect on Windows/MSYS2 NTFS — row 13 test skips with detection: `if [ -r "$file" ]; then echo SKIP`
- Python3 on Windows: avoid `os.rename()`, use `encoding="utf-8"` on all file opens, avoid `→` / Unicode arrows in heredoc strings written via cp1252 terminal

### Version
1.11.0 released 2026-06-16

## Spec: BUG-017 graphify-read-guard 2026-06-22

Guard 4 in `pre-tool-use.sh`: blocks `Read` tool on `graphify-out/**` and `node_modules/**` via python3 component-match. Installer idempotency fix: skip hook download if file already exists. CLAUDE.md session init updated to mandate **Glob** (NEVER Read) for existence checks.
- Scope: S — ~15 lines Guard 4 bash + installer one-liner guards + CLAUDE.md text change + ~10 Vitest tests
- Spec: `docs/superpowers/specs/2026-06-22-bug017-graphify-read-guard-design.md`
- vitest.config.js: `pool: 'forks'` → `pool: 'threads'` (fixes onTaskUpdate IPC timeout on Windows)
