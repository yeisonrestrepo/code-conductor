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

## Spec: FEAT-007 context-guard 2026-06-24

Turn-counter hook (`context-guard.sh` / `.ps1`) wired into `UserPromptSubmit` via upward-walk dispatcher (max 40 iter, fail-open). Increments `.claude/memory/turn-count.txt` atomically; emits ⚠ at 80% of threshold and 🚨 at threshold. Resets via `PostCompact` hook (`post-compact.sh` rewritten + new `post-compact.ps1`). Threshold configured in `.claude/memory/context-threshold.txt` (default 25; committed; `turn-count.txt` gitignored).
- Key decisions: atomic rename (same-dir temp), CR/BOM strip, no jq, node -e with `@'...'@` in PS, `main() || exit 0` outer trap, `Array.isArray` guard, exact-command idempotency, no `set -e`/`set -u`
- Spec: `docs/superpowers/specs/2026-06-24-feat007-context-guard-design.md`
- Complexity: M

## Checkpoint 2026-06-24 (FEAT-007 complete + BUG-015 spec)

### Decisions
- FEAT-007 fully implemented: `context-guard.sh/.ps1` (UserPromptSubmit) + `post-compact.sh/.ps1` rewrite; upward-walk bash dispatcher (40-iter cap); atomic rename pattern (`printf > .tmp && mv -f`); PS uses `[System.IO.File]::Replace` with `FileNotFoundException` fallback to `Move`
- `project-template/.claude/settings.json` extended: UPS array gains context-guard bash + PS entries; PostCompact gains `post-compact.ps1` entry; node heredoc used to merge settings idempotently in both installers
- PS 5.1 node invocation: `node -e $script $path` with `process.argv[1]` for path (NOT `process.argv[2]`); bash uses `node - path << 'JSEOF'` with `process.argv[2]`
- `turn-count.txt` gitignored; `context-threshold.txt` committed with default value of 25; `.gitattributes` eol rules added (`*.sh eol=lf`, `*.ps1 eol=crlf`)
- 19-case Vitest test suite added (`tests/hooks/context-guard.test.js`); covers all spec rows including saturation, BOM, CRLF, merge-conflict threshold, `warning=0` edge case, `CC_GUARD_DEBUG` stderr
- Version bumped to 1.15.0; FEAT-007 marked `[X]` in backlog

### Decisions (BUG-015 spec)
- BUG-015 next item: auto-generate CLAUDE.md fields from manifest detection at install time and `/cc-init` time
- Implementation: Option B (auto-detect + interactive fallback) via Option 2 (Node.js `scripts/detect-stack.mjs`)
- `detect-stack.mjs` design: single `readdir` sweep in `main()`; file list passed to all detectors; detector priority order: Flutter/Melos → Angular (version-pinned) → Next.js → NestJS → React → Vue → TS/Node → Go → Python → Rust → Java → fallback
- stdout = JSON only (`JSON.stringify(result, null, 2) + '\n'`, UTF-8 no BOM); stderr = all warnings/errors; exit 0 always; `{}` on any manifest error
- PS 5.1 capture: `| Out-String` required to prevent `System.Object[]` fragmentation; `ConvertFrom-Json` in isolated try/catch; no secondary unescape (parsed values already runtime strings)
- Placeholder matching: target `<command>` literal or blank after `:\s*` — CRLF-resilient, non-greedy, line-by-line; never raw key match
- Monorepo: `pnpm-workspace.yaml` / `pkg.workspaces` / `melos.yaml` → adjust commands (e.g. `pnpm -r build`, `melos bootstrap`)
- Angular version pin: extract major from `@angular/core` dep → append to stack string (e.g. `"Angular 20"`)
- All string values `.trim()`-ed before JSON output
- Spec: `docs/superpowers/specs/2026-06-24-bug015-auto-claude-md-design.md`

### Conventions
- Vitest mock pattern for fs-heavy scripts: `vi.mock('fs/promises')` in-memory; no real disk I/O in unit tests
- `install.sh` / `install.ps1` helper pattern for per-field idempotent CLAUDE.md writes: `_fill_claude_md` (bash) / `Set-ClaudeMdFields` (PS)

### Technical Debt
- `context-guard.ps1` not covered by the test suite (bash-only); PS hook requires manual verification on Windows
- BUG-015 implementation pending (spec approved, plan not yet written)

## Checkpoint 2026-06-25 (BUG-015 plan refinement — 15+ constraint rounds)

### Decisions
- BUG-015 plan (`docs/superpowers/plans/2026-06-24-bug015-auto-claude-md.md`) expanded to 130+ Global Constraints via 15+ iterative rounds; all constraints live in the plan's Global Constraints section
- **Fill regex final form:** `'^(\\s*-?\\s*Label:)\\s*(<[^>]*>)?\\s*(\\r?)$'` with `im` flags; group 1 preserves indentation, group 3 preserves CRLF; `$$$$` escapes `$` in replacement; label is always a hardcoded constant (no regex escaping needed)
- **Atomic write:** `writeFileSync(tmp)` → `renameSync(tmp, mdPath)` → catch → `writeFileSync(mdPath)` fallback + `unlinkSync(tmp)`; temp = `mdPath + '.tmp.' + process.pid`
- **process.exit(0) mandatory** at end of `main()` — pending readdir timeouts prevent event loop drain without it
- **PS BOM bug:** `[System.Text.Encoding]::UTF8` writes BOM in .NET 4.x; must use `[System.Text.UTF8Encoding]::new($false)`
- **PS GetTempFileName** creates empty `.tmp` base file — must delete base before appending `.mjs` extension
- **PS CLM guard:** check `$ExecutionContext.SessionState.LanguageMode` before .NET type calls; skip auto-fill if `ConstrainedLanguage`
- **PS `[Console]::OutputEncoding`** must be saved/restored in `try/finally` to avoid session side effects
- **TLS 1.2** must be set via `-bor` before any `Invoke-WebRequest`
- **Bun/Deno workspaces** out of scope for BUG-015; detected as package manager (bun.lockb) only
- **cc-resume extended** (T-007a added): fills blank command fields via detect-stack on session resume; never overwrites already-populated fields; user must manually clear stale values to re-detect after manifest changes
- **Detector priority order fixed:** Ionic → Capacitor → RNExpo → RNBare → Flutter → Angular → Next.js → NestJS → React → Vue → TSNode → Go → Python → Rust → Scala → SpringBoot → Quarkus → Java → .NET → iOS → Android
- **Fatal stderr shape standardized:** `{error, code}` on all paths (main catch, unhandledRejection, uncaughtException)
- **Process-level listeners required:** `process.on('unhandledRejection')` + `process.on('uncaughtException')` write `{}\n` to stdout + exit 0
- `e.isDirectory()` returns false for symlinked dirs in expandGlob — symlinked workspace dirs skipped in wildcard expansion, only reachable via literal patterns through `safeAddDir`
- All wildcard chars in negative patterns (`*`, `?`, `**`) make them no-ops — only literal-path exclusions work

### Conventions
- Round-by-round constraint review pattern: cross-reference all N items → list already-covered ones → add only genuine gaps (1-4 per round typically)
- Plan Global Constraints format: `**bold title:** explanation in imperative form`

### Technical Debt
- `scripts/detect-stack.mjs` + `tests/scripts/detect-stack.test.js` (T-001 + T-002) exist on disk, uncommitted — awaiting git commit
- T-003 through T-008 (install.sh, install.ps1, test harnesses, cc-init, cc-resume, metadata) all pending implementation
- 51-test Vitest suite at 51/51 passing (last confirmed after Round 8 additions)

## Checkpoint 2026-06-26 (BUG-015 complete — v1.16.0)

### Decisions
- `_fill_helper.cjs` chosen as standalone CommonJS test helper (not extracting `_fill_claude_md` from install.sh) — heredoc + eval backslash-halving layers in MSYS2 made the extracted function unreliable; standalone node script avoids all bash string-processing layers
- `_fill_helper.ps1` wrapper calls `_fill_helper.cjs` via temp JSON file — PS 5.1 strips double-quotes from native exe arguments, so JSON string cannot be passed directly as argv; `[System.IO.File]::WriteAllText` + file path workaround is authoritative for PS
- `_fill_helper.cjs` argv[2] dual-mode: if value starts with `{` → parse as JSON string; otherwise → read as file path (enables both bash and PS callers without code duplication)
- PS test harness uses local `Set-ClaudeMdFields` wrapper (calls `_fill_helper.ps1`) rather than extracting the function from install.ps1 — install.ps1's function contains a here-string with embedded JS that defeats both regex and `Invoke-Expression` extraction

### Conventions
- `tests/scripts/` hosts both `.sh` and `.ps1` test harnesses for installer functions; helper scripts (`_fill_helper.cjs`, `_fill_helper.ps1`) prefixed with `_` to distinguish from test runners
- Bash test harness uses `grep -qF -- "$_pattern"` (double-dash separator) to prevent patterns starting with `-` being parsed as grep flags

### Technical Debt
- PS test harness tests `_fill_helper.cjs` (via wrapper) not `Set-ClaudeMdFields` directly — PS-specific fill divergence (e.g. CLM guard, TLS setup) is not covered by automated tests
- `\t`, `\n`, `\r` sequences in fill values (e.g. Windows path `C:\to\setup`) are replaced with spaces by the `/\\[ntr]/g` regex in both `_fill_helper.cjs` and install.sh/ps1 — this is intentional (escape-sequence cleanup) but will mangle Windows paths containing `\t`, `\n`, `\r` components

### Version
1.16.0 released 2026-06-26 — BUG-015 complete

## Spec: FEAT-010 dense-prompt-protocol 2026-06-26

SNAP v1 — minified single-line JSON handoff replacing `session-snapshot.md`; ≥30% character reduction (measured: 51%); forward-compatible via `v` integer gate.
- Three blocks: `sys` (`ph`, `c`, `s`), `ops` (`n[]`, `f[]`), `mem` (`d[]`, `x[]`); strict allow-lists; all extra keys rejected
- Validator `scripts/snap-validate.mjs` ≤30 lines, ES module, explicit UTF-8, stderr-only output with `SNAP_ERROR:` prefix, exits 0/1 only
- `/cc-compact` writes JSON + idempotent `.gitignore` append; `/cc-implement` validates-then-deletes (step 8); `.md` fallback one session only (removed v1.18.0)
- Spec: `docs/superpowers/specs/2026-06-26-feat010-dense-prompt-protocol-design.md`
- Complexity: M; target version: 1.17.0

## Spec: FEAT-010 Dense Prompt Protocol Standard 2026-06-30

Replace `session-snapshot.md` with SNAP v1: minified single-line JSON envelope (`v`, `sys{ph,c,s}`, `ops{n,f}`, `mem{d,x}`), validated by `scripts/snap-validate.mjs` (≤30 lines, exits 0/1, all stderr lines prefixed `SNAP_ERROR:`, single-tier prefix, no second `SNAP_INVALID` variant).
- `/cc-compact` writes JSON; `/cc-implement` reads + deletes (destructive-read), one-session `.md` fallback removed in v1.18.0
- 4096-char max file size; array caps `ops.n≤3 ops.f≤20 mem.d≤10 mem.x≤5`; per-element caps 200-300 chars
- v2+ schema (`role`, `tk`, `scope`, `gate`, `p`) reserved for FEAT-011/012, not implemented here
- Spec: `docs/superpowers/specs/2026-06-26-feat010-dense-prompt-protocol-design.md`
- Complexity: M

## Spec: FEAT-013 Dynamic Stack Discovery 2026-07-04

Retire static `stack-profiles/` (18 files); rewire `/cc-stack` to invoke existing `detect-stack.mjs` and write detected stack + commands + an agent-generated ruleset into the project `CLAUDE.md` (not project.md — CLAUDE.md is the only file CC loads at runtime, per BUG-020). Detector-only: no static rulesets shipped; ruleset synthesized on the fly per detected stack.
- SQLite sink (FEAT-005 AC) deferred → CLAUDE.md is persistence sink until FEAT-005 lands; no rework expected
- Reuses BUG-015 CLAUDE.md fill machinery; surgical section/field edits only (BUG-003 invariant)
- Removes profile downloads from install.sh/install.ps1; removes Stack Profiles section + File Structure block from README
- Release closeout (final, gated behind green suite): VERSION + package.json → 1.18.0, README revision, CHANGELOG [1.18.0] entry tagged [FEAT-013]
- Reconcile /cc-stack write path with /cc-init + /cc-resume (both already fill CLAUDE.md via detect-stack) in /cc-plan
- Spec: `docs/superpowers/specs/2026-07-04-feat013-dynamic-stack-discovery-design.md`
- Complexity: S–M; target version 1.18.0
- STATUS: shipped v1.18.0 (commit bec0990); backlog checkbox still `[ ]` — mark `[X]`

## Spec: FEAT-005 SQLite Task-State Engine 2026-07-04

New `scripts/conductor-db.mjs` (zero-dep ES module) wrapping built-in `node:sqlite` to own `.conductor/cache.db`; makes the `cc-implement` Step 6 hook (currently a no-op) live. TIGHT scope: engine + single `task_state` table only; sessions/raw_history/snapshots + git-hash time-travel + metadata caching deferred to ARCH-008. claude-mem already purged in BUG-020 (nothing to remove).
- Schema v1: `task_state(plan_file, task_id, state CHECK IN (' ','>','X','!'), updated_at) WITHOUT ROWID`, PK `(plan_file, task_id)`, upsert; WAL mode; `user_version=1`; setup atomic via `BEGIN IMMEDIATE…COMMIT` (WAL set before txn)
- `plan_file` normalized to repo-relative POSIX key (dedup across CWDs); args capped 512 chars (reject not truncate); empty/whitespace rejected; `updated_at`=runtime `toISOString()` (ms), not mtime
- node:sqlite needs Node ≥22.5 → hook probes `node --version`, passes `--experimental-sqlite` only when ≥22.5; engines.node STAYS `>=20` (no bump), cache runtime-gated + self-disables below 22.5 (graceful degradation resolves the conflict)
- Root resolution: git rev-parse → bounded `.git` walk (40-cap, stops at fs root) → script-dir fallback; `path.resolve`+`path.join` normalized
- All failures non-fatal, exit 0, single `CONDUCTOR_DB:`-prefixed stderr line: absent node:sqlite, SQLITE_BUSY, corrupt db (rename aside colon-free `<ts>` + numeric collision suffix → unlink → give up), rename-fail ladder, non-regular-file at path (rename aside, never rm -r), `user_version>1` forward-compat no-write, CLI misuse; `db.close()` in finally
- `init` + `record` silent on success (no stdout); `.conductor/` via `mkdirSync recursive`; `.gitignore` add `.conductor/`
- Wiring: `cc-implement.md` Step 6 rewrite in BOTH mirrors (`.claude/commands/` + `project-template/.claude/commands/`, line 118-120); Vitest suite child-process (`spawnSync`) so `npm test` stays flag-free; temp dbs in os.tmpdir with `crypto.randomUUID()`, afterEach unlinks db+`-wal`+`-shm`; skips if runner Node lacks node:sqlite
- Release closeout (gated, last): assert VERSION+package.json=1.18.0, bump both → 1.19.0, CHANGELOG [1.19.0] tagged [FEAT-005], date via `date +%F`
- Spec: `docs/superpowers/specs/2026-07-04-feat005-sqlite-task-state-engine-design.md`
- Complexity: M; target version 1.19.0

## Plan: FEAT-005 SQLite Task-State Engine 2026-07-04

APPROVED. 11 tasks (T-001..T-011), one commit each, strict TDD red→green; every post-T-001 commit leaves the suite green so the pre-commit gate passes without `--no-verify`.
- T-001 skeleton (record happy path, schema v1, upsert, `.gitignore`); T-002 arg validation; T-003 CLI discipline; T-004 plan_file dedup pin; T-005 root-resolution fallbacks; T-006 absent-node:sqlite (via `--import` loader fixture); T-007 corrupt-db recovery + rename/unlink ladder + sidecar clear; T-008 non-regular-file-at-path + `.conductor`-as-file; T-009 user_version>1 forward-compat + table-exists self-heal; T-010 wire Step 6 both mirrors; T-011 release closeout 1.19.0 + backlog checkboxes.
- Single-file engine `scripts/conductor-db.mjs`; all connections via `openConn` (busy_timeout=2000); WAL best-effort (non-WAL FS ok); atomic `BEGIN IMMEDIATE` setup (user_version transactional — empirically confirmed); every close guarded+single (openReady closes before rethrow/return-null); `PRAGMA wal_checkpoint(TRUNCATE)` before close.
- Hook: no-flag-first→flag probe dispatch (unrecognized `--experimental-sqlite` contained in throwaway probe), `--no-warnings`, all 3 args double-quoted; `npm test` stays flag-free (spawnSync child adds flags).
- All failures exit 0, one `CONDUCTOR_DB:` stderr line; stdout always empty; ENOSPC/EDQUOT/EROFS covered by withDb catch + top-level main catch.
- Plan: `docs/superpowers/plans/2026-07-04-feat005-sqlite-task-state-engine.md`

## Checkpoint 2026-07-04 18:08 (FEAT-005 complete — v1.19.0)

### Decisions
- FEAT-005 shipped v1.19.0 (release commit ef93f4d): 11 tasks T-001..T-011, one commit each, strict TDD; every commit passed the pre-commit gate without `--no-verify`; final suite 302/302 green
- Engine `scripts/conductor-db.mjs` final shape as designed: single-file, all opens via `openConn` (busy_timeout=2000), atomic `BEGIN IMMEDIATE` schema, WAL best-effort, `wal_checkpoint(TRUNCATE)` before every guarded single close, forward-compat `user_version>1` no-write, corrupt/non-regular recovery renames aside (never `rm -r`)
- Step 6 hook wired in both mirrors (`.claude/commands/` + `project-template/`): version-gated (`node >= 22.5.0`), no-flag-first→flag probe dispatch, all 3 args double-quoted; `engines.node` stays `>=20` (cache self-disables below 22.5)
- `[FEAT-013]` backlog checkbox (shipped 1.18.0 but never marked) flipped `[X]` alongside `[FEAT-005]` in T-011

### Conventions
- writing-plans hybrid format: `- [ ] **[T-NNN] Step K: …**` repeats one task ID across its TDD step checkboxes; cc-implement 5-step ritual applied per step-line (uniqueness check per step, not per task ID)
- Node's `os.tmpdir()` returns the `/var` symlink on macOS while git toplevel + `process.cwd()` return physical `/private/var`; tests feeding an ABSOLUTE path into a git-rooted repo must `realpathSync(repo)` first or the repo-relative key never dedups (test-only; the real hook passes relative paths via physical cwd)
- TDD red-step guard: assert on a message string UNIQUE to the implemented branch (e.g. `skipping cache write`), never a loose substring the generic `main().catch` fallthrough also emits — otherwise the red step is falsely green and the test proves nothing

### Technical Debt
- Step 6 hook is executed prose (agent-interpreted), not a shell script — no automated test covers the markdown; correctness depends on the ritual reader honoring the probe order (verified only by mirror `diff`)
- `backupAside` numeric collision suffix caps at 100 backups per timestamp; beyond that it falls to the unlink/give-up ladder (non-fatal, but a pathological corrupt-loop could exhaust it)
- ARCH-008 deferred: sessions / raw_history / snapshots tables + git-hash time-travel + metadata caching are out of FEAT-005 scope (engine + single `task_state` table only)

## Spec: ARCH-008-S1 (Relational Schema Engine) 2026-07-04
- ARCH-008 decomposed into three sequential sub-specs: **S1** schema engine (this spec), **A** checkpoint/compact write wiring, **B** phase-entry resume read wiring; umbrella flips only when all three ship. claude-mem purge already satisfied by BUG-020.
- Scope (S1, engine-only, no consumers): `scripts/conductor-db.mjs` `user_version` 1→2 additive migration adding `sessions` (WITHOUT ROWID, `session_id` PK, `started_at` preserved on upsert), `snapshots` (append-only rowid + `idx_snapshots_hash`, one verbatim SNAP v1 blob), `raw_history` (append-only + `idx_raw_history_session`); `task_state` reused in place. Subcommands: `session`/`get-session`/`snapshot`/`get-snapshot`/`history`.
- Key hardening decisions: payloads (`snap_json`/`content`) via **stdin** (ARG_MAX), bounded `readStdinCapped` (chunked, aborts at cap, strict-UTF-8 `TextDecoder{fatal}`), 10 MiB/1 MiB caps on byte length; named `$name` bindings for new statements; timestamps Node ISO-8601 TEXT; queries print single line on hit / zero bytes on miss+degradation, exit 0; open-probe corruption → `backupAside` recovery, steady-state corruption → non-destructive degrade; forward-compat `v>2` bails exit 0.
- Spec: `docs/superpowers/specs/2026-07-04-arch008-relational-persistence-schema-design.md`. Hardened over 8 review rounds. Approved 2026-07-04.
- Shipped 2026-07-04 as v1.20.0 (schema engine only; ARCH-008-A/B still open).

## Spec: ARCH-008-A Checkpoint/Compact Write Wiring 2026-07-04
Wire `/cc-compact` + `/cc-checkpoint` to persist a `sessions` upsert + one `snapshots` row (git-hash-keyed) via the S1 subcommands; authoritative write first (handoff file / `project.md`), then a synchronous fail-open DB tail. Approved 2026-07-04 after 6 hardening rounds.
- **New scripts:** `scripts/session-id.mjs` (resolve `$CLAUDE_CODE_SESSION_ID` → `.conductor/session-id` cache → `crypto.randomUUID()`; atomic temp+rename, Windows EPERM/EACCES caught, first-writer-wins; root resolved like conductor-db) and `scripts/snap-build.mjs` (shared serializer: v1 when no prose, v2 when prose; index-based surrogate-safe raw-`pr` truncation to 10 MiB via bounded binary search ≤64 iters, skeleton computed with `pr:''` + `−2` quote accounting; strips extraneous input keys; empty stdin → non-zero exit).
- **SNAP v2:** superset of v1 with optional top-level `pr` (prose). `snap-validate.mjs` accepts `v∈{1,2}` (>2 → SNAP_UNKNOWN_VERSION), `pr` optional string (no separate cap; 4096 file cap dominates, NOT raised/bypassed for v2), version-aware top-level keys (v1 still rejects `pr`), all other v1 rules byte-identical. Checkpoint v2 blob is DB-only (never the handoff file).
- **Hash strategy (bug fix):** full-40 `git rev-parse HEAD` (NOT `--short`, which auto-scales/unstable across repo growth → breaks A/B match); `sys.c` regex broadened to `/^[0-9a-f]{7,40}$/` (backward-compatible; `0000000` sentinel valid); same value for `sys.c` + both DB keys. Git absent/zero-commit/restricted → `0000000`.
- **cc-checkpoint field derivation:** `pr`=verbatim appended `## Checkpoint` block; `ph`=`get-session` carry-forward else `impl`; `d`/`x`=regex-projected bullets (emphasis-stripped+trimmed headings, decision-set precedence, line-based); `n=[]`,`f=[]`,`s`=stem/none.
- **Fail-open discipline:** authoritative-write failure halts (no tail); DB tail synchronous, stderr→`.conductor/last-write.log` (never UI), `mkdir .conductor` before redirect; ~5s timeout via spawnSync native (tests) / shell `timeout` only if binary present (else internal `busy_timeout=2000`); partial tail failure (session ok/snapshot fail) accepted; bare `node` (probe only for the two conductor-db calls).
- **Hooks:** `post-compact.sh`/`.ps1` clear `.conductor/session-id` + sweep `session-id.*.tmp` (space-safe quoted, error-isolated); only rotates degraded fallback id — env-var path unaffected. Stale `v===1` reader comment → `v∈{1,2}`.
- Scope: `global/commands/` only (not project-template). Complexity L. Spec: `docs/superpowers/specs/2026-07-04-arch008-a-checkpoint-compact-write-wiring-design.md`.

## Checkpoint 2026-07-05 (ARCH-008-A complete — v1.21.0)

### Decisions
- ARCH-008-A shipped v1.21.0 (release commit 65e0ec6, plan-state 6f35e33): 8 tasks T-001..T-008, one commit each, strict TDD; final suite 351/351 green. Umbrella `[ARCH-008]` still open pending ARCH-008-B (resume-read wiring).
- `snap-build.mjs` must emit via an **async `process.stdout.write(s, () => process.exit(0))` drain callback**, NOT `process.stdout.write(...)` then immediate `process.exit(0)` (the plan's form) — the latter truncates the 10 MiB v2 blob past ~64 KiB on a pipe. `writeFileSync(1, …)` is also wrong: it throws EAGAIN on a non-blocking stdout pipe for large payloads.
- SNAP v2 shipped as designed: version-aware top-key allow-list (`v2` adds `pr`), `pr` optional string, `v>2 → SNAP_UNKNOWN_VERSION`, `sys.c` broadened to `/^[0-9a-f]{7,40}$/`; 4096-char file cap unchanged (v2's 10 MiB is DB-only).
- Full-40 `git rev-parse HEAD` (not `--short`) is the single value for `sys.c` + both DB keys; `0000000` sentinel on non-git/zero-commit/timeout.

### Conventions
- Child-process test suites that capture a payload larger than 1 MiB on stdout **must set `spawnSync(..., { maxBuffer })` above the payload cap** — the 1 MiB default overflows to ENOBUFS → SIGTERM → `status: null`, which masquerades as a script failure.
- SNAP validator line-count cap test tracks the real file size (was 30, now 32 after the v2 edits); update the assertion when the validator legitimately grows rather than forcing the code smaller.

### Technical Debt
- Two FEAT-010 validator tests (`v>1` rejection, 30-line cap) were contract-obsoleted by the approved v2 change and rewritten to `v>2` / 32-line — the plan's "43 existing tests stay green" assumption did not hold; the rewrite is contract-correct, not a regression.
- `/cc-compact` + `/cc-checkpoint` DB tails and the Windows `.ps1` post-compact mirrors are agent-interpreted prose / inspection-only (no `powershell` on the macOS host); correctness rests on the script-level suites + mirror `diff`, not an automated end-to-end of the command prose.

### Version
1.21.0 released 2026-07-05 — ARCH-008-A complete

## Spec: ARCH-008-B Phase-Entry Resume Read Wiring 2026-07-05
Wire phase entry (`cc-spec`/`cc-plan`/`cc-implement`, both mirrors) to restore context across branch switches/rollbacks via a new zero-dep `scripts/resume-read.mjs`. Approved 2026-07-05 after 8 hardening rounds. Target v1.22.0; flips `[ARCH-008-B]` + umbrella `[ARCH-008]`.
- **Precedence: DB snapshot WINS.** `resume-read` resolves the full-length git hash → `conductor-db get-snapshot <hash>` (non-destructive); hit+valid → bind DB, delete handoff file (superseded). DB miss/degrade/bypass → handoff-file fallback (the fail-open path for when ARCH-008-A's DB tail didn't persist). Newest-row-per-hash kept (`ORDER BY id DESC`); a mid-work checkpoint v2 can override a compact v1 at the same commit — intentional.
- **Exit codes:** 0 hit (stdout = `RESUME_HIT` block: source/commit/phase/spec/version/prose/pending) / 3 clean miss (zero bytes stdout) / 4 halt (readable-but-invalid handoff → agent stops phase entry, `SNAP_INVALID` line, leave file). Commands treat only 0+4 specially; every other code = proceed fresh.
- **Handoff-file branch nuance:** capture bytes into memory BEFORE unlink (atomic); read-error (EACCES/EIO) → degrade not halt; empty/whitespace → degrade not halt (checked before validation); valid-but-`sys.c`≠HEAD (stale remnant) → degrade+re-delete. Only readable+non-empty+invalid halts.
- **SHA-256:** DB-query gate `/^([0-9a-f]{40}|[0-9a-f]{64})$/`; sentinel/abbreviated bypass DB (avoids `0000000` cross-session collision). Companion: widen `snap-validate.mjs` `sys.c` `{7,40}`→`{7,64}` (+64-char test) so reader never halts on SHA-256 blob.
- **Robustness:** git via `execFileSync` 2000ms Node timeout (no GNU `timeout`), stderr suppressed, ENOENT/timeout→`0000000`; DB `get-snapshot` 5000ms (>conductor-db 2000ms busy_timeout), probes 2000ms; all node children via `process.execPath` + `env:process.env`; child script paths from `import.meta.url` dir; DB blob validated via `.conductor/resume-validate.<pid>.tmp.json` temp (try/finally unlink); traces = synchronous `appendFileSync` UTC-ISO `resume:` lines to `.conductor/last-write.log`; all paths root-relative (git-independent 3-tier root); all unlinks/JSON.parse/appends individually try/catch; top-level catch→exit 3; Node-14 syntax only.
- **Commands:** probe `node` presence (absent→miss, avoids PS `CommandNotFoundException`); PS isolates `$ErrorActionPreference`; parsers own CR-strip/blank-filter; PS multi-line capture = `string[]`. Legacy `.md` path removed (swept if found). `post-compact` hooks extended to also sweep `resume-validate.*.tmp.json`.
- Spec: `docs/superpowers/specs/2026-07-05-arch008-b-phase-entry-resume-read-design.md`. Complexity M.

## Spec: FEAT-023 Global Distribution Infrastructure via NPM CLI 2026-07-05
Replace `install.sh` (1563 lines) + `install.ps1` (918 lines) with one bundled Node CLI published to npm; `bin: code-conductor` enables both `npm i -g` and `npx`. Approved 2026-07-05. Complexity L.
- **Asset source: bundled** in the tarball via `files[]` (`global/`, `skills/`, `project-template/`, entry script); no GitHub fetch at install time. Asset root resolved from `import.meta.url` (must work from npx temp cache AND global prefix).
- **Invocation:** single entry `bin/code-conductor.mjs`, shebang `#!/usr/bin/env node`; `install.sh`/`install.ps1` deleted.
- **Scope: core + flags, NO deps.** Flags `--project` (unpack `project-template/`→`./.claude`), `--verbosity MIN|INFO|VERBOSE` (default MIN); write `conductor-version.md`. Dependency/plugin auto-install (Node, Playwright MCP, jq) dropped.
- **Deploy:** native `fs.mkdirSync`/`fs.cpSync` recursive (no shell); `fs.chmodSync +x` on Unix hooks (no-op/caught on Windows); home via `process.env.HOME || process.env.USERPROFILE`. Asset map: `global/*`→`~/.claude`, root `skills/*.md`→`~/.claude/skills`, `project-template/*`→`./.claude`.
- **Highest risk — port to Node:** the idempotent, backup-guarded `settings.json` verbosity-hook merge (install.sh:280–1005) kept in scope as "command registration"; must be idempotent + non-destructive on malformed JSON (back up + skip, never corrupt).
- **CI:** `.github/workflows/publish.yml` runs `vitest run` + `npm publish` on `v*` tag. `package.json` drops `private:true`, adds `name`.
- **Errors:** no HOME/USERPROFILE→exit non-zero, deploy nothing; unwritable target→surface path+fix; missing bundled asset dir→fail fast with expected path.
- **Deferred to /cc-plan full reads:** `install.sh` (merge subsystem ~280–1005), `install.ps1` (Windows parity), `global/settings.json` (exact hook entry shape).
- **Resolved decisions (2026-07-05):** `engines.node ">=20"`, `type:module`+`.mjs` bin; bare invocation = global setup (no subcommand), `--project` additive; global update overwrites managed assets (`CLAUDE.md`/`commands`/`hooks`/`skills`) but preserves `memory/*` + merges `settings.json`; `--project` merges never aborts; home-fail → exit 1 stderr; name `code-conductor` (gate on npm availability, fallback `@yeisonrestrepo/code-conductor`); publish `--provenance --access public` (`id-token:write`); shell scripts deleted LAST, gated on green `npm pack` smoke of global+`--project`; invalid `--verbosity`→warn+fallback MIN; malformed settings→`settings.json.malformed-backup.<UTC>` (kept, merge skipped); MIN = no info stdout (silent), warns/errs→stderr.
- **Resolved decisions round 2 (2026-07-05):** `--project` strictly `cwd/.claude` (no git-root search); cpSync non-transactional, no rollback, idempotent re-run = recovery; publish job in protected `npm-publish` Environment w/ required reviewer; `files[]` allowlist excludes tests/docs/config; malformed-settings backups capped at 5 most-recent (supersedes earlier "never pruned"); verbosity-hook upstream-schema validation OUT of scope (shape from bundled asset); read-only FS → exit 1 stderr EROFS message; smoke test extracts tarball + asserts asset paths physically present before deleting shell scripts.
- **Resolved decisions round 3 (2026-07-05):** exit codes 0 ok / 1 pre-flight-env (home, perm, EROFS, missing assets) / 2 mid-copy partial-write; fresh-machine settings = copy bundled `global/settings.json` then idempotent merge (no synthesized default); `bin` command always `code-conductor` even under scoped-name fallback; `--verbosity` persists to `~/.claude/memory/verbosity.md` (overwrites when flag given, else MIN-if-absent) + sets install log level; malformed-backup prune = lexical sort of fixed-width UTC suffix, keep newest 5; coverage ≥90% lines on new CLI modules (not repo-global); publish trigger = `release:[published]` (supersedes `v*` tag push); `fs.cpSync {recursive,force:true,dereference:false}`.
- **Resolved decisions round 4 (2026-07-05):** corrupt existing `verbosity.md` (no flag) → overwrite MIN + stderr warn, never abort; `package.json publishConfig.access:"public"` (for scoped fallback); publish workflow `runs-on: ubuntu-latest`; smoke/CI asserts committed `bin/code-conductor.mjs` has exec bit (git `100755`).
- Spec doc: `docs/superpowers/specs/2026-07-05-feat-023-npm-cli-distribution-design.md`.

## Checkpoint 2026-07-06 10:07 (FEAT-023 shipped + published — v1.23.0)

### Decisions
- FEAT-023 shipped v1.23.0: 10 TDD tasks (T-001..T-010), one commit each, replacing install.sh/install.ps1 with the bundled `code-conductor` npm CLI; final suite 430/430 green. Backlog `[FEAT-023]` flipped `[x]`.
- npm rejected the unscoped name `code-conductor` (403, too similar to existing `codeconductor`) — the spec's scoped fallback was taken: package renamed `@yeison.restrepo.r/code-conductor` (npm-suggested scope from the account username). The `bin` command stays `code-conductor` (spec invariant); only the package name is scoped.
- Provenance publish (E422) required `package.json` `repository.url` matching the OIDC repo claim; added `repository: {type:git, url:git+https://github.com/yeisonrestrepo/code-conductor.git}` + a manifest test guarding it.
- Distribution direction settled: code-conductor is an INSTALLER CLI (runs once, copies into ~/.claude), NOT an MCP server (no runtime JSON-RPC) and NOT yet a Claude Code plugin. `claude plugin install npx …` is invalid — CC plugins install from a marketplace repo (`.claude-plugin/marketplace.json` + `plugin.json`), never npm. A genuine plugin package would be a NEW `/cc-spec` (repo has NO plugin manifest today; `tests/plugin/*` only checks installed skills).
- Publish auth moved to npm OIDC trusted publishing (commit 49a4027): dropped `NODE_AUTH_TOKEN`/`NPM_TOKEN`, added `npm install -g npm@latest` (OIDC needs npm >=11.5.1), kept `--provenance --access public` + `id-token: write` + `npm-publish` environment. Token bootstrap only needed because trusted-publisher config requires the package to exist first.

### Conventions
- CLI is ESM `.mjs`, zero runtime deps, native `node:fs` only; `bin/code-conductor.mjs` thin (parseArgs + orchestrate + exit codes 0/1/2), logic in `lib/installer/{env,deploy,settings,config}.mjs`; tests under `tests/installer/*` are PERMANENT.
- `NPM_TOKEN` is an ENVIRONMENT secret on the protected `npm-publish` environment (never a repo secret) — inherits the required-reviewer gate; removed entirely once OIDC lands.
- Release requires the `v<version>` tag to point at the commit carrying that version+manifest; moving the tag does NOT retarget an existing GitHub Release (must delete+re-publish the Release).

### Technical Debt
- `git add -A` in the T-010 cutover swept the generated `coverage/` report tree into the commit; caught and fixed by `git rm -r --cached coverage` + gitignoring `coverage/` (amended into 4d987fa). `coverage/` is now in `.gitignore`.
- Publish workflow, Windows `chmod` no-op, and PS parity remain inspection-only (no `powershell`/live-registry on the macOS host); correctness rests on the script-level vitest suites + `npm pack` smoke, not an end-to-end publish.
- Scoped package may have published as RESTRICTED (anonymous `npm view` 404s); if public install is intended, run `npm access public @yeison.restrepo.r/code-conductor` or set visibility Public in npm settings — unverified this session.

### Version
1.23.0 published to npm as @yeison.restrepo.r/code-conductor — FEAT-023 complete.

## Spec: claude-md-merge-and-skill-registration 2026-09-22

Fix two install-time defects: `CLAUDE.md` clobbered on deploy, and bundled skills never registered.
Spec (r4): `docs/superpowers/specs/2026-09-22-claude-md-merge-and-skill-registration-design.md`

### Decisions
- **Managed-block sentinel** chosen over merge-only: conductor content lives between
  `<!-- cc:managed:start -->` / `<!-- cc:managed:end -->` and is replaced wholesale each
  upgrade; sections outside are host-owned and append-only. Merge-only would have frozen
  every future CLAUDE.md improvement for anyone already installed — silent staleness is a
  worse failure than the clobber it replaces.
- Migration from a sentinel-less host is the single destructive path: host sections matching
  a managed heading are removed to avoid duplicates; the timestamped backup is the recovery.
  Must be documented in README, not discovered by surprise.
- CLAUDE.md target validation is hoisted into `run()` pre-flight (before `writing = true`)
  so exit 1 falls out of the existing contract without touching the catch allowlist.
- Symlinked `CLAUDE.md`/`.gitignore` are resolved via `realpath` and merged through, temp
  file beside the resolved path so `renameSync` never replaces the link. Fatal exit 1 is
  reserved for the directory case.
- Frontmatter added to `code-simplifier` and `verbosity` (they have none, so they cannot
  register at all); Out of Scope amended to permit frontmatter-only edits.
- Stale flat-skill sweep compares against `SKILL.md` **and** `SKILL.md` minus frontmatter —
  otherwise the frontmatter addition permanently defeats the sweep.

### Conventions
- Backups: `<name>.installer-backup.<utcStamp>`, reusing the exported fixed-width `utcStamp`
  from `settings.mjs` (the pruner depends on lexical == chronological); retention 5 via a
  generalized `pruneBackups(path, suffix, keep)`. Never duplicate `utcStamp`.
- CLAUDE.md parsing: `/^## /` at column 0, outside fences (``` and ~~~, info strings
  allowed, unclosed fence runs to EOF); heading match normalizes case, inner whitespace,
  `\r` and trailing `#`. Setext H2 is explicitly unsupported.
- Writer discipline: host EOL detected and matched (LF default when no terminator),
  currency comparison EOL-normalized, trailing newline forced before append, atomic
  temp+rename in the target's own directory, whole-file copy path uses the same writer.
- `~/.claude/skills/<name>` must be unlinked *before* the skills `cpSync`, never after.
- `tests/plugin/code-conductor-plugin.test.js` gates on the real `homedir()` and is skipped
  in CI — CI coverage requires a hermetic `deployGlobal`-into-temp-home test.

### Technical Debt
- Same-second backup suffixes misorder lexically at `-10` vs `-2` (needs 11+ installs in one
  UTC second); accepted, not zero-padded.
- Managed block moved above host sections makes new sections insert above it rather than at
  EOF; cosmetic, accepted.

### Scope
Complexity L. Out of scope: PR Review and QA Review commands (item 3 of the original
report) — separate spec. VERSION → 1.24.0; both defects to be tracked in
`AGENT-READABLE BACKLOG.md`.

## Checkpoint 2026-09-22 11:53

### Decisions
- Spec `2026-09-22-claude-md-merge-and-skill-registration-design.md` approved at revision 4 after three adversarial review rounds; it is the binding authority for the next `/cc-plan`.
- Item 3 of the original defect report (PR Review + QA Review commands: unit, e2e, Playwright browser) is deferred to its own spec, not folded into this one.
- Two decisions in the spec's Decisions Taken table remain user-unconfirmed and carry the recommendation as default: adding frontmatter to `code-simplifier`/`verbosity`, and resolving symlinked CLAUDE.md via `realpath` rather than rejecting it.

### Conventions
- New installer validation must be hoisted into the pre-flight block in `bin/code-conductor.mjs` *before* `writing = true`; anything thrown after that flips the process exit code from 1 to 2 (partial-write contract).
- Session handoff blobs are built with `node scripts/snap-build.mjs` in this source repo — the `.claude/scripts/` path in the command text is the deployed layout, not the source layout.

### Technical Debt
- Neither defect is tracked in `AGENT-READABLE BACKLOG.md`; both entries still need to be added.
- `tests/installer/deploy.test.js` fixtures are single-token strings with no `##` headings, so the merge acceptance criteria would pass vacuously against them — fixtures must be rebuilt during implementation.

### Deferred reads (for /cc-plan)
- `tests/installer/deploy.test.js`, `lib/installer/settings.mjs`, and `bin/code-conductor.mjs` beyond lines 75-105 were never read in full under the spec read budget.

## Checkpoint 2026-09-22 13:22

### Decisions
- Plan `2026-09-22-claude-md-merge-and-skill-registration.md` executed end to end via `/cc-implement` (inline surgical ritual), not subagent-driven — the pending "choose execution mode" question is resolved and closed.
- `CLAUDE.md` and `.gitignore` are the only two merged root files (`MERGED_ROOT_FILES`); every other shipped asset keeps its force-overwrite.
- An absent bundled template is a skip (`'skipped-missing'`), not a fatal error: npm strips `.gitignore` from every tarball, so `project-template/.gitignore` is legitimately missing at install time. This preserves the pre-1.24 copy loop's behaviour, which simply never saw the file.
- Bundled skill names are derived from `readdirSync(assetRoot/skills)` directories at runtime rather than a constant list, so the unblock and stale-sweep passes cannot drift when a skill is added or renamed.
- Released as 1.24.0; `[BUG-027]` and `[BUG-028]` filed closed, `[BUG-029]` filed open. Backlog ceiling re-verified against `origin/main` immediately before appending each.

### Conventions
- The plan file's task lines are `- [ ] **[T-NNN]**` (bold-wrapped), so the `/cc-implement` locator pattern `\[ \] \[T-\d{3,}\]` does not match them — the bold markers must be allowed for in the pattern. Plans generated by `/cc-plan` should either drop the `**` or the ritual pattern should tolerate it.
- Numeric backlog ceilings must be read with the **two-stage** pipeline — extract the bracketed ids, then the digits: `grep -oE '\[(FEAT|BUG|ARCH)-[0-9]+\]' "AGENT-READABLE BACKLOG.md" | grep -oE '[0-9]+' | sort -n | tail -1`. Two wrong forms, both silent: `sort -u | tail` on the full ID sorts lexically, putting `BUG-027` above `FEAT-024` and hiding the real maximum; and the single-stage `grep -oE '[0-9]+$'` (recorded here in error until 2026-09-24) matches *nothing*, because ids appear mid-line as `` `[FEAT-030]` `` and never at end-of-line — it returns empty and exits 0, so the uniqueness guard passes on no data at all. Verified 2026-09-24: single-stage → empty, two-stage → `029`.
- Plan code blocks are extracted programmatically (locate the ```js fence, copy verbatim to the target path) rather than retyped — it eliminates transcription drift between plan and implementation.
- `docs/` is gitignored, so the plan's checkbox state is off the index by default; the git history remains the authoritative record of what shipped. **Amended 2026-09-24:** the completed plan's final checkbox state MAY be force-added (`git add -f`) as a closing `docs:` commit on the feature branch when the plan file is already tracked in that branch — see the Checkpoint 2026-09-24 18:06 ruling.

### Technical Debt
- `[BUG-029]` is open: `project-template/.gitignore` has never shipped to npm installs, so the 1.24.0 `*.installer-backup.*` / `*.installer-tmp.*` patterns do not reach npm users. The `skipped-missing` guard hides the crash, not the gap.
- `deployGlobal` merges `CLAUDE.md` *after* the asset `cpSync`, so a failure between the two leaves assets copied and the merge undone — repaired only by an idempotent re-run.
- `tests/plugin/code-conductor-plugin.test.js` still gates on the real `homedir()` and stays skipped in CI; the hermetic `deployGlobal`-into-temp-home coverage added in Task 5 is what actually proves the fix.
- The global template's managed block opens above its intro sentence, so a pre-sentinel host keeps a duplicate of that one line after the first upgrade — cosmetic, documented in the README rather than fixed.

### Workarounds
- The "replaces a FILE occupying skills/<name>" test aborts the whole vitest process natively (`libc++abi` filesystem_error from `cpSync`) in the pre-implementation red state; that hard abort is the expected failure signal, not a broken test.

---

## Spec: BUG-029 — Ship the project template's ignore rules to npm installs [2026-09-22]

**Spec file:** `docs/superpowers/specs/2026-09-22-bug029-template-gitignore-packaging-design.md` (revision 2, approved)

### Problem
npm unconditionally strips any file literally named `.gitignore` from every published tarball, so `project-template/.gitignore` has never shipped despite `project-template/` being in `package.json`'s `files`. Confirmed against the live tree: `npm pack --dry-run --json` returns 51 entries, all other `project-template/.claude/` dotfiles present, the ignore file absent. npm installs therefore leak `*.installer-backup.*` / `*.installer-tmp.*` into `git status`.

### Decisions
- Rename `project-template/.gitignore` → `project-template/gitignore` (undotted) and map source → target at deploy time; npm does not strip the undotted name.
- `MERGED_ROOT_FILES` changes from a `Set` to a `Map` of source name → target name (`CLAUDE.md`→`CLAUDE.md`, `gitignore`→`.gitignore`). The root-file copy loop must skip on the **source** name — skipping on the target name would deploy a stray `gitignore` file into the project root.
- `.npmignore` and a `prepack` rename hook were both rejected: each reintroduces a second source of truth for what ships.
- The `'skipped-missing'` guard in `lib/installer/file-merge.mjs` stays, demoted from load-bearing workaround to defence in depth.
- The merge engine (`appendMissingLinesText`) is untouched; its `have` set already makes the append idempotent across upgrades.

### Decisions (Part 2 — publish pipeline, folded into this spec 2026-09-22)
- `.github/workflows/publish.yml` fails at `npm install -g npm@latest` with `EBADENGINE`: the job pins Node 20 (20.20.2) but npm@latest is now 12.0.2, whose engine range is `^22.22.2 || ^24.15.0 || >=26.0.0`. The release carrying BUG-029 cannot be published until this is fixed, so it is in scope.
- Fix: pin the major — `npm install -g npm@^11.5.1`. Verified on the live registry 2026-09-22: npm@11 declares `node: "^20.17.0 || >=22.9.0"`, so it installs on Node 20 and still satisfies OIDC trusted publishing's >= 11.5.1 floor.
- The runner stays on `node-version: '20'`, matching `engines.node`'s floor and the Test workflow, so the tarball is validated on the minimum Node the package supports. Raising the runner to 22/24 and adding a Node matrix to Test are both out of scope.
- Pinning the major removes the failure class: an unpinned `@latest` re-breaks the release job on every npm major that drops a Node line.

### Conventions
- Spec anchors record the VERSION they were verified against and instruct the implementer to re-locate by symbol, not by line number. Verified at 1.24.0: `file-merge.mjs:64`, `deploy.mjs:8`, `deploy.mjs:145-150`.
- No shipped asset dir may contain a file npm strips. A new contract test enforces this across `global/`, `skills/`, `scripts/`, `project-template/` for `.gitignore`, `.npmrc`, `.npmignore`.
- Packaging assertions reuse `smoke.test.js`'s single `beforeAll` pack + `tar -xzf` extract (lines 16-19) and its existing `--project` install (line 50); `npm install <tgz>` into a temp prefix is explicitly not used. `tar` is already a hard dependency of the suite — on Windows, bsdtar (`tar.exe`, Windows 10 1803+) handles `-xzf` identically.

### Debt
- README:325's `.gitignore Note` claims the installer appends `.claude/memory/personal.md`; the template has never contained that line. Corrected as part of this spec since the section is being touched anyway.
- Projects installed from npm before this fix are not backfilled beyond what re-running the installer does.

### Complexity
S — one rename, one constant reshaped, two call sites, three test files.

---

## Spec: FEAT-025 — Bounded retention for the conductor cache DB [2026-09-24]

**Spec file:** `docs/superpowers/specs/2026-09-22-feat025-conductor-db-retention-purge-design.md` (revision 5, approved)

### Problem
`scripts/conductor-db.mjs` appends to `snapshots` (one row per `/cc-compact` and `/cc-checkpoint`, keyed by git commit hash) and `raw_history` with no eviction path. Only the newest row per hash is ever read (`ORDER BY id DESC LIMIT 1`), so older rows are dead weight the moment they are superseded — measured 2026-09-22: 8 rows, 28 133 bytes, **3 rows on one commit hash**. A v2 checkpoint blob carries `pr` up to `snap-build.mjs`'s 10 MiB cap, so rows are not small. `raw_history` has zero writers today (the `history` subcommand exists but nothing calls it).

### Decisions
- One `purgeTable` helper, up to three id-ordered bounds, **never the clock** (an age window would delete the only snapshot for a long-idle HEAD and break `/cc-resume`): (1) keep newest `keepPerKey` per key; (2) soft cap with a newest-per-key floor; (3) hard ceiling, floorless.
- `snapshots` = 3 / 200 / 500. `raw_history` = `HISTORY_KEEP_PER_SESSION = null` (bound 1 **disabled** — thinning an ordered log destroys it rather than bounding it) / 1000 / 2000. Bound 2's per-key floor is retained for `raw_history`, so a session's newest row survives until the hard ceiling.
- Bound 2 settles the table at **`max(softCap, distinctKeys)`**, not at `softCap` — only `count - distinctKeys` rows are eligible under the floor. Stating it as "trims to 200" would fail a correct implementation.
- Each bound recomputes `COUNT(*)` after the previous one; every `excess` is computed **in JavaScript** and the `DELETE` is skipped when `<= 0`, so no non-positive `LIMIT` is ever issued and no negative-limit guard exists in SQL.
- `purgeTable` is called **inside the same `withDb` callback** as the `INSERT`, same connection, statement immediately after — never a second `withDb` open (double checkpoint/close cost and re-entry into the recovery ladder). The `try`/`catch` wraps **only** the `purgeTable` call, so a purge throw cannot reach `withDb`'s catch and be misreported as `…, skipping cache write`.
- Failure message carries the table: `CONDUCTOR_DB: retention purge skipped (<table>): <code>`; exit stays 0.
- Load-bearing invariant: `id` is the rowid **without** `AUTOINCREMENT`, so deleting the highest row would let SQLite reuse its id and destroy `ORDER BY id DESC` as recency. All bounds delete oldest-first only.
- No schema change — `SCHEMA_VERSION` stays 2, `applySchema` untouched.
- Accepted risk (quantified, not hand-waved): bounds count rows, not bytes — 30 MiB worst case per hash under bound 1, ~5 GB theoretical at bound 3, vs 28 KB measured. Byte-sum bound deferred to `[FEAT-030]`, **whose backlog entry is filed in this spec's release closeout**.

### Conventions
- **Backlog id ceilings: two-stage pipeline over working tree ∪ `origin/main`, take the max, after `git fetch origin`.** See the corrected convention line above — the single-stage `[0-9]+$` form previously recorded here matched nothing and exited 0.
- `BEFORE DELETE` triggers fire per row, so a forced-failure test must **seed past a bound** (3 rows on one hash, CLI write makes a 4th) or the `DELETE` matches nothing, the trigger never fires, and the test is vacuous. `CREATE TRIGGER … RAISE(ABORT)` is the deterministic mechanism: cross-process, no mocking, no timing dependence.
- Boundary-test seed counts are stated **net of the triggering insert** — the CLI write adds a row before the purge sees the table.
- Fail-open stderr assertions count lines **matching the purge-failure message**, not total stderr lines; other legitimate non-fatal warns co-occur.
- Cross-table isolation is asserted even though the parameterized helper implies it: two lines of test that catch a wrong table name in a subquery.
- Release closeout travels in the spec so `/cc-plan` inherits it; CHANGELOG dates resolve via `date +%F` at closeout time (FEAT-005 convention), never hardcoded from the spec.

### Debt
- `package-lock.json` is stale at **1.23.3** — neither the 1.24.0 nor the 1.24.1 release commit synced it. The FEAT-025 closeout's `npm install --package-lock-only` repairs both missed bumps; future release commits must include the lockfile.
- FEAT-025's backlog **Components Affected** line names `.claude/scripts/` and `project-template/.claude/scripts/` mirrors that do not exist — `scripts/conductor-db.mjs` is the single source, deployed under `.claude/scripts/` at install time. Corrected in the closeout commit.
- `sessions` (one row per session) and `task_state` (per plan file + task id, old plans never evicted — 65 rows today) still grow without bound. Out of FEAT-025 scope, unfiled.
- Concurrent purges can over-delete by a bounded amount (both writers compute the same `excess`; the second `DELETE` re-evaluates against an already-trimmed table). Harmless at bound 2 — the newest-per-key exclusion is re-evaluated per statement, so `get-snapshot` is unaffected and only forensic depth is lost. At bound 3 it can touch floor rows of the oldest keys, which is that bound's floorless contract, reachable only in the >500-distinct-keys regime.

### Complexity
S — one new helper, two call sites, no schema change, no new dependency.

---

## Spec: FEAT-026 — Guided branch creation and commit drafting at the plan gate [2026-09-24]

**Spec file:** `docs/superpowers/specs/2026-09-24-feat026-guided-branch-and-commit-drafting-design.md` (revision 5, approved)

### Problem
Branch naming and commit-message formatting are conventions documented in `CONTRIBUTING.md:23` / `:37` and enforced nowhere. The failure is observed, not hypothetical: the FEAT-025 plan commit (`39f940e`) landed directly on `main` and had to be recovered with `git switch -c` plus `git branch -f main <prior>`. The plan phase is the exposure, because the plan commit is a feature's first write.

### Decisions
- **Trigger point: `cc-plan.md` and its `project-template/` mirror only — two files, one gate.** `/cc-spec` is deliberately untouched: the spec is never committed (`docs/` is gitignored; the shipped record is this summary), so no git write exists to protect at spec approval.
- **No standalone `/cc-branch` command.** The offer composes with the existing workflow instead of adding a surface.
- **Sequencing is the load-bearing requirement, not line position.** The block must run to completion — warning, offer, and either the confirmed `git switch` or an explicit decline — **before any step of the approved plan's Task 0 executes**, force-add and commit included. Under the FEAT-005/024 ritual Task 0 runs *at approval*; a block firing only at the phase-exit print would fire after the damage and reproduce the failure it exists to prevent. The AC asserts the ordering; "before the `/cc-compact` line in the Markdown" is necessary but not sufficient.
- **Validate, don't duplicate.** The gate reads the commit message from the approved plan's Task 0 step (the plan is the single source of truth and Task 0 runs it verbatim), validates it, and surfaces it in the confirmation. It synthesizes a message only when the plan carries none, and writes that synthesis back into Task 0. A gate that merely prints a subject nobody consumes would satisfy a naive AC while shipping decoration.
- **Validation rules anchored to what `CONTRIBUTING.md:37` literally says** — Conventional Commits, `feat:`/`fix:`/`docs:`/`chore:` as the documented set; other shipped types (`test:`, `ci:`, `refactor:`) pass with a note. **The id must appear in the subject; bracketed suffix and inline prose both pass.** A suffix-only rule would reject `docs: add the FEAT-025 retention purge implementation plan` — the only historical Task 0 message. Synthesis emits the suffix form; that is a synthesis choice, never a validation rule.
- **Default branch resolved from `refs/remotes/origin/HEAD`**, falling back to the literal set `{main, master}` — never hardcoded to `main`. Detached HEAD prints empty and exits 0, so empty is warned on distinctly, never read as "not on main".
- **Silence has exactly two conditions:** the current branch equals the derived name, or it is feature-shaped **and** its embedded id token matches the current item's id. Every other non-default branch reports both names and asks. Shape alone never buys silence: sitting on `feat/feat-025-…` while planning FEAT-026 is feature-shaped but unrelated, and is the second-most-likely version of the error. A hand-made branch with no extractable id token (`feat/retention-purge`) fails the id condition by design and falls through to report-and-ask — do not substitute fuzzy title matching.
- **Branch name derived from the active spec stem** (the value `/cc-compact` writes as `sys.s`): strip the date and `-design`, read the id token, `FEAT`/`ARCH` → `feat/`, `BUG` → `fix/`. Backlog lookup is the fallback, not the primary source — installed projects ship no backlog file.
- **Sanitization is two rules plus one gate:** lowercase + collapse non-alphanumerics to `-`, cap at 60 chars on a `-` boundary, then `git check-ref-format --branch "<name>"` as the authority. Per-character reject passes for `..`, `@{`, `~`, trailing `.lock` etc. are unreachable after rule one and are explicitly forbidden as speculative abstraction.
- **Deliberate narrowing, recorded so the `[X]` flip does not hide it:** the backlog AC says the message is drafted "from the resulting diff"; at the plan gate there is no diff — the plan commit's content is the plan file itself — so drafting/validating from type + stem + id is the correct reading and diff-derived drafting is out of scope.
- Every git write (`switch -c`, `switch`, `commit`) stays behind an explicit confirmation; declining is a no-op and the phase exits byte-identically to today. Absent git, absent repository, or any git failure skips the block without blocking the phase exit.

### Conventions
- The two `cc-plan.md` files are byte-identical **except** for `scripts/` vs `.claude/scripts/` script paths; any edit must preserve exactly that divergence, and the new test asserts it.
- No installer change is needed for a command edit: `deployProject` copies `project-template/.claude/` wholesale, so a modified command file ships with no manifest edit.
- Uncommitted-change refusal on `git switch -c` is reported verbatim and stops the gate — never stash, never force, never retry. (That refusal occurred in the FEAT-025 session.)

### Debt
- No test covers command-file *content* today — `tests/installer/templates.test.js` asserts only the `cc-stack:managed` marker — so FEAT-026 opens that surface with a mirror-parity test. Other command files remain uncovered.
- The gate is instruction prose executed by the agent, not code: its correctness cannot be unit-tested end to end, only its presence and mirror parity. The ordering AC is verified by walking a plan whose Task 0 commits the plan file.

### Complexity
S — two Markdown blocks and one test; the entire risk surface is precise instruction wording, not code paths.

---

## Checkpoint 2026-09-24 18:06

FEAT-026 shipped on `feat/feat-026-guided-branch-and-commit-drafting`; PR #25 open against `main`.

### Decisions
- **The "do not squash" caution on FEAT-026 is struck — squashing PR #25 is safe.** The `git branch --contains HEAD -r` hash check was T-000-B's one-time gate protecting the FEAT-025 *closeout* branch, and it was discharged when `61eacff` landed on `main`. Nothing in the shipped branch gate or in the workflow addresses the FEAT-026 feature commits by hash, and no future check re-runs against them. This caution resurfaced twice after correction, the second time escalated to "must" with a justification that does not hold; it is wrong, it is not a constraint, and it must not be re-derived.
- **Ruling on `757e142` ("docs: mark the FEAT-026 plan tasks complete"): kept, and the convention amended to match.** Committing the completed plan's checkbox flips contradicted the recorded convention as written. Of the two consistent resolutions offered, keeping the commit was chosen: dropping it would require rewriting an already-pushed branch (a force-push) for zero functional gain, whereas the flips accurately record the plan's terminal state and the plan file was already tracked in this branch from `ee814b5`. The convention line (`project.md:491`) now permits this closing `docs:` commit explicitly. Cost if wrong: one extra low-value commit per feature branch, trivially reversible.

### Conventions
- A completed plan's final checkbox state may land as a closing `docs:` commit on the feature branch via `git add -f`, but only when the plan file is already tracked there. The default remains: checkbox flips are on-disk working state, not per-task commits. Never commit intermediate `[>]` states.
- PR bodies must not carry merge-strategy constraints unless a live mechanism actually depends on commit identity. State the mechanism or omit the caution.

### Debt
- **T-T07 is open and unautomated by design.** The branch gate is instruction prose executed by the agent, so its runtime behavior cannot be unit-tested; `tests/installer/commands-parity.test.js` pins only its presence, mirror parity, ordering precondition, and the exact git invocations. **Discharge condition:** at the next real `/cc-plan` approval — now known to be **FEAT-016's plan** (spec approved 2026-09-24) — record in the task report (a) the observed execution order — that the gate resolved before any Task 0 write, `git add -f` and `git commit` included, (b) the derived branch name, and (c) the validated Task 0 commit subject. Until those three are recorded, the acceptance criterion is unverified.
- `git add` on a path under `.claude/` exits 1 with "paths are ignored by one of your .gitignore files" yet still stages the tracked file; it breaks `&&` chains. Run the `git commit` separately.

---

## Spec: FEAT-016 Interactive Assisted Onboarding (Interactive Fallback Wizard) [2026-09-24]

Approved 2026-09-24. Full spec on disk at `docs/superpowers/specs/2026-09-24-feat016-interactive-assisted-onboarding-design.md` (gitignored; this summary is the shipped record).

### Problem
`/cc-init` fills `CLAUDE.md` from `scripts/detect-stack.mjs`, which reads manifests. With no manifest — blank workspace or legacy codebase — there is no recovery path: Step 2's questionnaire is gated on `Name` being blank (wrong trigger), never covers the command fields, and `- Build: <command>` ships verbatim. The agent then reads the placeholder as an instruction and guesses — the exact BUG-015 failure that FEAT-013/BUG-015 closed only for manifest-bearing repos.

### Decisions
- **No LLM API binding.** The backlog's "low-cost model API bindings" component predates the npm CLI and is explicitly not implemented; the model already running the session does the formatting. `dependencies: {}` stays intact — zero network, zero API keys.
- **Split the wizard:** `scripts/init-wizard.mjs` (new) owns the deterministic half via subcommand argv — `report` | `check` | `apply`; `cc-init.md` prose keeps only the asking. `scripts/claude-md-fields.mjs` (new) exports the canonical field list and the `isResolved` predicate, imported by both it and `detect-stack.mjs`.
- **The script is mode-blind — no TTY probe, no `CI` check, asserted by test.** Agent-executed Bash never has a TTY, so a TTY probe would pin the interactive path permanently into non-interactive mode. The mode split lives entirely in the caller: prose asks and applies; CI runs `report` and stops.
- **Trigger is the observed end state**, not a guess at why: any field still blank or still `<command>` after detection gets asked about. A fully-detected repo asks nothing; a half-filled `CLAUDE.md` self-heals on re-run.
- **Skip writes the literal `N/A`, never leaves `<command>`.** `N/A` means "asked, there is none"; `<command>` means "never asked". The distinction is what stops the agent guessing at a tool that does not exist, and what stops a re-run re-asking.
- **Values pass on stdin, never argv** (`apply|check <field> --value-stdin`), pinned in prose as a quoted-delimiter heredoc (`<<'CC_VALUE'`) which disables all expansion. A developer answer is an arbitrary string reaching an agent-composed shell line; argv would make quotes/backticks/`$(...)` an injection surface and a guard-3 collision.
- **`check` is static and advisory only:** `npm run X` / `yarn X` / `pnpm run X` against `package.json` scripts. Other command shapes pass silently; no or unparseable manifest is silence, **not** a warning; `N/A` skipped. Never executes, never reaches the network.
- **Predicate is case-sensitive and trims surrounding whitespace.** Only exact lowercase `<command>` is a placeholder; `<COMMAND>` is a developer-authored value. Contradicts the `(any case)` wording currently in `cc-init.md` — that stale wording is struck in the same change. Trimming matters: without it `- Build: <command> ` slips through as resolved.

### Conventions
- The report contract is the one interface: `{ unresolved: [{field, raw, reason}], resolved: [field], absent: [{field, expected}] }`, `reason` restricted to `empty | placeholder`. stdout is pure JSON; any human-readable summary goes to stderr.
- `absent` is a third state — the canonical line was deleted. `apply` **refuses rather than inserts**, naming the line to restore; `expected` carries it verbatim so the prose never reconstructs it from a label.
- Fill semantics inherited verbatim from BUG-015: first occurrence of the canonical line, single-line replacement, no `g` flag, never an insertion.
- `apply` refuses an embedded newline (would break the fixed line layout everything greps by) and refuses an empty value (a skip maps to `N/A` at the caller, so empty stdin is always a caller bug).
- `cc-init.md`'s two mirrors are byte-identical today; referencing `node scripts/init-wizard.mjs` creates their first divergence, joining the existing `commands-parity.test.js` suite with the same `unnest` inverse rather than a second implementation of the rule. The template mirror is regenerated, never hand-edited.

### Debt
- **Deferred full read:** `scripts/detect-stack.mjs` (679 lines; only 30 read under the spec budget). `/cc-plan` must read its JSON emission path in full before wiring the shared field-list import. The spec assumes it can import a new sibling module without disturbing detection logic — unverified until plan time.
- **Residual live verification (T-T07-shaped):** the asking half is prose and cannot be tested end to end, only presence, ordering, and mirror parity. The first real `/cc-init` against a manifest-less repo records one line in the task report — the fields `report` returned, the questions asked, the resulting `CLAUDE.md` command lines. Until then the interactive AC is unverified.

### Complexity
M — two new scripts with real unit coverage, one command file rewritten plus its regenerated mirror, one existing test file extended. Risk concentrates in `apply`'s byte-exactness and the stdin value path, both directly testable.

## Checkpoint 2026-09-24 20:22

### Decisions

- **FEAT-016 shipped as specified** (PR #26, squash-merged as `6857596`, v1.27.0). Two new zero-dependency scripts: `scripts/claude-md-fields.mjs` (the eight canonical fields + the one resolved predicate) and `scripts/init-wizard.mjs` (`report | check | apply`). `dependencies: {}` is preserved — the backlog's "low-cost model API bindings" component was **not** implemented and its Components Affected line is corrected in the backlog itself.
- **`init-wizard.mjs` is mode-blind, permanently.** No TTY probe, no `process.stdin.isTTY`, no `CI` read — pinned by a test that greps the *whole source, comments included*. Agent-executed Bash never has a TTY, so any probe pins the interactive path into non-interactive mode forever. When that test tripped on a header comment that merely *spelled* the API, the comment was reworded rather than the grep narrowed: a comment-skipping grep is cleverness that rots, and the blunt form is the stronger guarantee.
- **Values reach `apply`/`check` on stdin only** (`--value-stdin` + a quoted heredoc delimiter), never argv. Argv would put a developer-typed string into an agent-composed command line — a quoting/injection surface and a guard-3 collision. A test round-trips backticks, `$(...)` and both quote species into `CLAUDE.md` byte-exact.
- **`writeFileSync` without temp+rename is accepted** for `apply`: one small single-line rewrite, every refusal path fails before the file is opened, and each refusal test asserts `CLAUDE.md` is untouched. Revisit only if a real truncation is observed.
- **`.claude/commands/cc-init.md` is now tracked.** `.claude/` is gitignored and only four command files had ever been force-added; the new parity test reads `cc-init.md`, so an untracked source would have failed in every fresh clone. Force-added in the same commit that created the divergence.

### Conventions

- **A substitution rule that must never fire is dead code and is not carried over.** `cc-init.md`'s mirror is regenerated with the single rule `node scripts/` → `node .claude/scripts/`; `cc-plan.md`'s second rule (`` running `scripts/ ``) has no occurrence here and was dropped rather than shipped unverifiable. The regeneration step first greps the source for any `scripts/` mention *outside* a `node …` invocation and halts on a hit, because `unnest` reverses only the `node ` form.
- **Backlog and tracking-file edits relocate by heading grep, never by line number** — reaffirmed across all three FEAT-016 backlog edits (`grep -n '^### \[ \] `\[FEAT-016\]`'`, an `awk` block scan for the Components line), each expecting exactly one match and halting on zero or many.
- **Within a task, edit before staging.** The FEAT-016 plan initially staged the backlog in step B and flipped its checkbox in step C; `cc-implement` executes in file order, so the flip would never have reached the commit. Filed as `[BUG-031]` so the *generator* stops emitting that order.
- **Template mirror parity now covers two command pairs.** `tests/installer/commands-parity.test.js` reuses one `unnest` inverse for both `cc-plan.md` and `cc-init.md` rather than forking the rule.

### Debt

- **T-T07 is DISCHARGED.** FEAT-026's branch gate ran live at FEAT-016's plan approval and all three observations are recorded in PR #26's body (discoverable from `main`): the gate resolved before any Task 0 write including `git add -f` and `git commit`; it derived `feat/feat-016-interactive-assisted-onboarding` from the spec stem; and it *validated* — did not synthesize — the subject `docs: add the FEAT-016 interactive assisted onboarding implementation plan`. It also correctly refused silence on `main`. Do not re-open this.
- **New residual, T-T07-shaped: FEAT-016's interactive half.** The asking prose cannot be tested end to end — only presence, ordering and mirror parity. **Discharge condition:** the first real `/cc-init` against a manifest-less repo records one line — the fields `report` returned, the questions asked, the resulting `CLAUDE.md` command lines. Not a release gate; v1.27.0 shipped without it by design.
- **`[BUG-031]` filed** against `/cc-plan`'s generation rules (edit-before-stage ordering). Id ceiling was 030, read with the two-stage pipeline over working tree ∪ `origin/main` after `git fetch`.
- Test baseline is now **583 passed / 12 skipped** (was 529/12).

## Spec: BUG-031 Plan Step Ordering 2026-09-24

- **Approved.** `docs/superpowers/specs/2026-09-24-bug031-plan-step-ordering-design.md` (untracked; `docs/` is gitignored, matching the last three cycles). Complexity S.
- **Decision:** the fix is one prose rule appended as the last bullet of `## Ordered Steps` in `.claude/commands/cc-plan.md`, pinned verbatim in the spec, plus a regenerated template mirror and one occurrence-counted parity anchor. A mechanical plan-markdown validator was considered and rejected under YAGNI; the rejection is recorded in the spec's Out of Scope so it is not silently re-litigated.
- **Convention:** a generation rule must define its own terms. "Commit group" is defined inside the rule text (the contiguous run of steps ending at a `git commit` step) because `cc-plan.md` is the only file the generator reads; pushing the definition into a spec only moves the ambiguity one level down.
- **Convention:** test anchors on command prose normalize whitespace (`s.replace(/\s+/g, ' ').trim()`) on both content and needle, count literally with `split(needle).length - 1`, and assert exactly once. No `new RegExp` built from prose (the clause contains `[X]`, a character class), and the needle constant is a quoted string, never a template literal (it contains backticks).
- **Convention:** before inserting text into a mirrored command file, grep the new text for every live mirror-`sed` pattern and halt on a hit; if the transform ever gains a third `-e`, the precondition grep gains its pattern in the same change.
- **Convention:** run the parity suite immediately after regenerating a mirror, not only at the `npm test` commit gate, so a dropped `-e` is attributed to the step that caused it.
- **Verified:** `.claude/commands/cc-plan.md` is tracked, so no repeat of FEAT-016's `git add -f` surprise. Both `-e` expressions are live for `cc-plan.md` (line 7 uses the second) - unlike `cc-init.md`, neither may be dropped. The anchor needle occurs 0 times in both mirrors today.
- **Correction (standing):** no em-dashes in any output. The rule lives in `global/memory/personal.md:9` and deploys to `~/.claude/memory/personal.md`; it was missed because a grep of the project-scoped `.claude/memory/personal.md` and both `CLAUDE.md` files does not reach it.
- **Debt (unfiled):** nothing in the documented lookup chain points at `~/.claude/memory/personal.md`. The Orchestrator Protocol starts at `.claude/memory/project.md` and the project CLAUDE.md calls `personal.md` "local only", so a project session never reads the global file where the tone rules live - a recorded rule the agent does not read is indistinguishable from no rule, which is the same failure shape BUG-031 fixes. Needs a backlog id (two-stage ceiling pipeline) when filed.

## Closeout: BUG-031 Plan Step Ordering 2026-09-25

- Shipped in `1.27.1`: one prose bullet appended to `## Ordered Steps` in both `cc-plan.md` mirrors, pinned by an occurrence-counted anchor in `tests/installer/commands-parity.test.js`.
- Convention reinforced: the template mirror is regenerated with the two-expression `sed` and the parity suite runs immediately after regeneration, not at the commit gate.
- Convention reinforced: a generation rule defines its own terms, because the generator reads only `cc-plan.md`.
- Anchor discipline: whitespace-normalize both sides, count literally with `split`, hold a backtick-bearing needle in a quoted string, never build a regex from prose.
- Open debt (unfiled): nothing in the documented lookup chain points at `~/.claude/memory/personal.md`, so `global/memory/personal.md` is a rule the executing agent may never read. Needs a backlog id via the two-stage ceiling pipeline.
- Rejected under YAGNI: a mechanical validator that parses generated plan markdown and rejects a `git add` preceding an edit of the same path.

## Checkpoint 2026-09-25 09:24

### Decisions

- **BUG-031 shipped as `1.27.1`** on `fix/bug-031-plan-step-ordering` in four commits: the plan (`746fbe7`), the rule plus regenerated mirror plus anchor (`b11e1f6`), the release closeout (`4cb2b20`), and the plan's terminal checkbox state (`4691f98`).
- **The fix is prose, not machinery.** One bullet at the end of `## Ordered Steps` in `cc-plan.md`, defining its own terms (a commit group is the contiguous run of steps ending at a `git commit` step), covering every `git add` form plus the implicit stage of `git commit -a`, exempting a file the task never edits, and naming the consequence. A mechanical plan-markdown validator was rejected under YAGNI and the rejection is recorded in the spec's Out of Scope.
- **A completed plan's terminal checkbox state lands as a closing `docs:` commit**, never as an amend of the release commit and never left dirty. The `[X]` state is terminal, the plan file is already tracked from Task 0, and a merged branch whose plan file misreports its own last step is worse than one extra commit.

### Conventions

- **Guards must be portable or they are theatre.** `\|` alternation is a GNU BRE extension; BSD `grep` (macOS default) reads it as a literal pipe, so an alternation guard matches nothing and "expect 0" is a guaranteed false pass. Every hazard grep in this cycle uses `grep -c -e PAT1 -e PAT2`.
- **A needle containing an apostrophe never travels inside `node -e '...'`.** Feed the script through `node --input-type=commonjs <<'JS' … JS`, the same inert-quoting trick the commit-message heredoc uses.
- **Regeneration is checked on both halves:** a positive grep proving the nested paths are present and a residual grep proving no bare path survived. A surprise residual hit is halt-and-look, never silenced by editing the template.
- **Anchor discipline (reaffirmed live):** whitespace-normalize both sides, count with `split(needle).length - 1`, assert exactly once, hold a backtick-bearing needle in a single-quoted string, and anchor both mirrors rather than trusting transform-equivalence.
- **Preconditions are dry-run before the edit, not discovered mid-edit.** The `awk` adjacency check proving `## Test List` sits at the bullet line + 2 turned T-001-D's three-line `old_string` from an assumption into a verified fact.

### Debt

- **Open, unfiled:** nothing in the documented lookup chain points at `~/.claude/memory/personal.md`. The Orchestrator Protocol starts at `.claude/memory/project.md` and the project `CLAUDE.md` calls `personal.md` "local only", so a project session never reads the global file where the tone rules live. A recorded rule the agent does not read is indistinguishable from no rule, the same failure shape BUG-031 fixed. To be filed at the next free id via the two-stage ceiling pipeline.
- **Residual, advisory by design:** the step-ordering rule is prose the generator must read. One confirming observation of a generated Task 0 obeying it (next cycle, `FEAT-009`) is worth recording in that plan's report, the way T-T07 was discharged.
- **Still open from FEAT-016:** the interactive `/cc-init` live-verification line, to be recorded at the first real run against a manifest-less repo. Not a release gate.
- Test baseline is now **585 passed / 12 skipped** (was 583/12).

## Spec: BUG-033 Hook Interpreter Wiring 2026-09-25

- **Approved with two folds.** `docs/superpowers/specs/2026-09-25-bug033-hook-interpreter-wiring-design.md` (untracked; `docs/` is gitignored). Ships as `1.27.2`, two commits, one release.
- **Live stopgap already applied** to the host `~/.claude/settings.json` (`python` to `python3`); the hook now exits 0 silently because `graphify` is absent and the payload catches `ImportError`.
- **Verified, and it changed the design:** hook commands run in shell form via `sh -c` on macOS/Linux and **Git Bash on Windows, or PowerShell when Git Bash is absent** (`https://code.claude.com/docs/en/hooks`). PowerShell does not expand a bare `~/...` passed to an external program, so the shipped `~` path is already broken on such hosts, independently of the interpreter name. The command therefore moves out of the shipped asset and into the installer, mirroring `verbosityHookCommand` (absolute path, forward slashes, built at install time).
- **Exec form (`args`) rejected:** a Claude Code build predating `args` would ignore the key and run bare `node`, starting a REPL. A hook that hangs is worse than a shell-form string the repo already proves works.
- **Coverage gap named:** `tests/installer/settings.test.js:27` is fixture input to `mergeVerbosityHook`, not an assertion about the shipped asset. No test reads `global/settings.json` today, which is exactly why the wrong interpreter shipped unnoticed; the release adds that assertion.
- **Convention:** the wrapper probes by scanning `PATH` for an executable, never by starting an interpreter, and the `graphify` import check stays in the Python payload. The child is spawned detached with stdio ignored, so its exit status can never surface as a hook error.
- **Degradation:** at most one `GRAPHIFY_HOOK:` stderr line, gated behind `CC_GRAPHIFY_DEBUG`, always exit 0 (`conductor-db.mjs:11` convention, `CC_GUARD4_DEBUG` / `CC_VERBOSITY_DEBUG` precedent).
- **Changelog carries the upgrade instruction** in one line: existing installations re-run the installer. The spec dies at merge; the changelog is what users read.
- **Complexity raised S to M** by the Windows finding: the release now also adds a command builder and an idempotent normalizer to `lib/installer/settings.mjs`, which rewrites a live host file and must leave entries it does not own alone.
- **Out of scope, filed separately:** `[BUG-034]` Guard 4 fail-open (next in line, ahead of other work), `[FEAT-021]` graphify replacement (reframed: first ask whether the graph rung is needed at all).
- **Ownership decision (round 2):** the graphify `UserPromptSubmit` entry is **agent-owned**. Normalization discards manual edits to it, including an env prefix such as `GRAPHIFY_STALE_MINUTES=120 python3 ...`; tuning belongs in the environment both the wrapper and the payload already read. Entries this repo does not own are never touched, and a test pins each half.
- **Shipped asset after stage 2 contains no graphify entry at all** (permissions block only, no `UserPromptSubmit` hook), mirroring the verbosity hook. The shipped-asset test is pinned in both states: stage 1 asserts the `python3` command, stage 2 asserts absence, so a leaked `~` path or placeholder fails the suite.

## Spec: BUG-036 pre-tool-use Hook Contract Repair 2026-09-25

- **Approved with one fold.** `docs/superpowers/specs/2026-09-25-bug036-pre-tool-use-hook-contract-design.md` (untracked; `docs/` is gitignored). Ships as **1.28.0** (minor: the hook's interface with Claude Code changes). Supersedes `[BUG-034]`, which is marked `[~]` superseded and **not** done.
- **The bug is far larger than filed.** Four independent defects, of which the filed fail-open is the fourth: (1) both `settings.json` files wire `PreToolUse` with `matcher: "Write|Edit|create_file|write_file"`, so `Read` never reaches the hook and Guards 1 and 4 are unreachable; (2) the platform passes `{tool_name, tool_input}` as **JSON on stdin**, not `CLAUDE_TOOL_NAME` / `CLAUDE_TOOL_INPUT` env vars, and Guard 4 is the only guard omitting the `${VAR:-}` default so it aborts under `set -u`; (3) `exit 1` does not block, only exit 2 or `hookSpecificOutput.permissionDecision: "deny"` does, and Guard 4 emits the legacy `{"decision":"block"}` with exit 1; (4) the `python3 -c` path check fails open.
- **Guard 3 has never shipped.** The repo-local `.claude/hooks/pre-tool-use.sh` is 519 lines with Guard 3; the shipped `project-template/` copy is 81 lines with zero occurrences of it. All 125 guard tests target the repo-local copy with synthetic env vars, so the suite proves matching logic and has never touched wiring, contract or blocking. Filed as `[BUG-037]`, next in queue.
- **Epistemic standard set for spec claims:** the defect is stated as **never verified**, not as drift, because the hooks reference documents no env-var contract even as deprecated and carries no version history, while it *does* annotate version floors where they exist (v2.1.267 for an unrelated `StopFailure` matcher), which makes the absence informative. Assumed contract pinned to the doc as read 2026-09-25; local Claude Code 2.1.282. Write spec claims you may need to defend later this way.
- **Design decisions recorded:** union matcher with internal dispatch (the script must read `tool_name` to dispatch anyway; per-matcher entries cannot express the unparseable case); one blocking mechanism, `permissionDecision` with exit 0, with exit 2 rejected because it makes a deliberate denial indistinguishable from a script abort; Guard 2 maps to `"ask"` as contract-forced, named rather than slipped in.
- **Fail policy, decided:** Case A (parsed payload, guard has no field to act on) allows; Case B (stdin does not parse) denies **pre-dispatch** with `CC_HOOK_ALLOW=1` and one stderr line; the canary (valid but unfamiliar shape) allows. Fail-closed is for unparseable, never for unfamiliar-but-valid.
- **`CC_HOOK_ALLOW` scope is pinned in the spec and in a negative test:** it bypasses Case B only and is not a guard kill switch. The test asserts a well-formed `graphify-out/` read is **still** denied with the override set, so no refactor can quietly widen it.
- **Guard 3's bash body is frozen as `tests/fixtures/guard3-reference.sh`**, shipping to no one, so its 108 cases stay green and stay the authority `[BUG-037]` ports against. Quarantine was rejected: it discards the only executable description of intended behavior exactly when a port needs it.
- **Standing rule carried into the plan:** 125 existing tests must pass against a new runtime and a new input contract with **no case quietly adjusted to fit**.
- **Chain:** the fix reaches users only by re-running the installer, and that same re-run triggers `[BUG-035]`'s settings overwrite, which the 1.28.0 changelog must name as a consequence of the instruction it gives.

## Checkpoint 2026-09-25 12:32

### Decisions

- **BUG-036 shipped as `1.28.0`** (minor, because the hook's interface with the platform changed) on `fix/bug-036-pre-tool-use-hook-contract` in six commits: the plan (`9333fca`), the Node front door plus harness plus re-pointed Guard 4 (`3210c49`), the wiring plus the frozen Guard 3 fixture (`6b94e9b`), the docs correction (`8273932`), the release (`e82a25b`), and the plan's terminal checkbox state (`fea3633`). Squash-merged as `1d81d8f` (PR #29). Test baseline moved **600/12 to 617/12**.
- **The shipped hook is one Node front door**, `pre-tool-use.mjs`, mirrored byte for byte into this repo's own `.claude/hooks/` so the project dogfoods the artifact it ships. `node:` builtins only, no `dependencies` entry, and the mirror is pinned by a parity test in `templates.test.js`.
- **Three judgment calls the spec did not spell out, each named in the plan and approved before code:** (1) Guard 2 registers for `Write`, `create_file`, `write_file` but **not** `Edit`, because gating the action the guard itself recommends would be a product regression shipped as a repair; `Edit` stays in the matcher with an empty dispatch. (2) For `Read`, Guard 4 decides **before** Guard 1: both exited 1 before, so no precedence was ever observable, and Guard 4 first spares a stat plus a full read on a path about to be denied and makes `row1`'s reason assertion machine-independent. (3) The spec's `row14`/`row15` reference was inverted against the file; the spec was corrected first.
- **A fifth defect, found in the plan phase and repaired here:** Guard 2 read a `"path"` key that neither `Write` nor `Edit` sends. The reader now accepts `file_path` with `path` as a compatibility fallback for an MCP-provided `create_file`/`write_file`.
- **`CC_HOOK_ALLOW` bypasses two pre-verdict conditions only**, unparseable stdin and a hook-internal failure, both meaning "no guard could inspect the call". The spec's scope pin was widened to name both after review caught that the top-level `catch` routes through the same denial. Words moved, code did not: a guard that crashes open would reopen the hole the audit closes.
- **The settings command is relative** (`node .claude/hooks/pre-tool-use.mjs`) where BUG-033 mandated absolute. That distinction is now recorded in the spec: BUG-033's rule exists because a **global** hook lives under a home only the installer knows and `~` dies under PowerShell; this is a **project** hook resolved against the session cwd, the same cwd the guards' own `stat` calls use.

### Conventions

- **A red state is verified by its shape, and the shape is predicted before the run.** Both hook suites were written before the artifact existed: predicted 30 failed / 0 passed at `expected 1 to be 0` from a module-resolution throw, and 583/30/12 for the full suite. Both matched exactly.
- **A flipped verdict lands in the same commit as the code that justifies it, and is written before that code exists** so it carries its own red state. Assertion mechanics may move freely (exit code, decision shape); a verdict moves only where the plan names it.
- **`git diff --cached --name-only` collapses a rename to one path.** A staged-path count that includes a `git mv` needs `--no-renames`, or the count comes up one short and looks like a missing `git add`.
- **`.gitignore:7` ignores `.claude/`**, so every *new* file under it needs `git add -f`, including `.claude/hooks/*.mjs` and `.claude/commands/*.md`. The existing tracked files there predate the rule; a plan that says plain `git add` for a new one will fail at the staging step.
- **A frozen corpus subject is a first-class artifact.** `tests/fixtures/guard3-reference.sh` carries a header stating it ships to no one, names the id that will port it, and says "do not edit to make a port pass". Its 108 cases stayed green through the strip, which is what proves the strip was clean.
- **Verify a state change by its semantics when the diff is noisy.** The backlog flip predicted `1 1` from `--numstat` and produced `14 1`, because the file still carried uncommitted spec-phase filings; asserting the four checkbox states directly was the correct check, and the count was the wrong instrument.
- **Direct-to-main commits (backlog filings, memory checkpoints) are permitted by an owner bypass of branch protection, not by policy. The convention is therefore OWNER-SCOPED: a collaborator lands the same class of commit via a PR they merge themselves, no review required. Do not weaken branch protection to widen the convention.** The rule "Changes must be made through a pull request" staying enforced for everyone else is a feature in a repository whose product is guardrails and whose backlog aims at supply-chain credibility (SBOM, signed builds, publish-from-CI). The bypass warning firing on every direct push is also a feature: it is the audit line recording that the exception was used. The day this repo has a second committer, this wording already covers them without a policy change.

### Debt

- **`[BUG-037]` is next in queue and is the reason Guard 3's slot exists.** The port owns the POSIX ERE to JavaScript RegExp translation, the 108-case re-run, added dialect-divergence cases, any untranslatable pattern becoming its own line item, `BASH_SCAN_ALLOWLIST` semantics, and whether a `CC_GUARD3_WARN=1` soft mode ships first.
- **`[BUG-035]` stays open and is named, not fixed, in the 1.28.0 changelog.** This release instructs a re-run of the installer, and that same re-run force-copies `settings.json` over the host's.
- **This repository now guards itself.** From `6b94e9b` onward, a `Read` over 150 lines with no `limit` is denied in this repo and a `Write` over an existing file asks. Whether the change took effect mid-session or waits for the next session was not observed; record it at the first live denial.
- **The retired `pre-tool-use.sh` is left inert on existing installations.** The installer does not delete what it no longer ships, and a sweeper is `[BUG-035]` territory.
- **Still open from FEAT-016:** the interactive `/cc-init` live-verification line, to be recorded at the first real run against a manifest-less repo. Not a release gate.
