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

## Spec: BUG-037 Guard 3 Port and First Ship 2026-09-25

- **Approved with two required additions and one constraint.** `docs/superpowers/specs/2026-09-25-bug037-guard3-port-and-first-ship-design.md` (untracked; `docs/` is gitignored), 408 lines. Ships as **1.29.0** (minor: a guard that has never fired begins firing). Baseline 617 passed / 12 skipped.
- **Two risks measured before the design, not assumed.** POSIX ERE is leftmost-longest and JavaScript is leftmost-first, and four checks consume `BASH_REMATCH[0]` to decide where scanning resumes, so a shorter match could have flipped a verdict invisibly: six probes built to expose it produced byte-identical extents. `_G3_MOD`'s `(\s+\S+)*\s+` is the classic catastrophic-backtracking shape and JavaScript backtracks where glibc does not: **0.13 ms** against adversarial input at the 8192 cap. Both risks retired with numbers, which is what kept the estimate at L.
- **The real dialect risk is the character classes.** `[[:space:]]` in the C locale is exactly `[ \t\n\r\f\v]`; JavaScript `\s` also matches U+00A0, U+2028 and U+FEFF, so translating to `\s` silently widens all thirteen checks. An acceptance criterion forbids `\s \S \w \W \d \D` in the pattern block and a test asserts their absence, which makes the trap structurally unrepeatable rather than merely avoided this once.
- **Rollout decided: deny from day one, `CC_GUARD3_WARN=1` as a per-guard escape that converts the denial into `ask` carrying the same reason.** A warn-only release was rejected because it deliberately recreates the state this chain exists to repair, one version after repairing it, and because the flip is a promise a future release must remember. No escape at all was rejected because Guard 3 judges every `Bash` command and has never met real traffic. `ask` rather than a stderr line because `permissionDecisionReason` is the only channel whose delivery the reference guarantees, and an escape whose message may never be seen fails at its one job.
- **Two override variables now exist, so their interaction is a contract, not folklore:** one negative test in the same commit as the escape asserts all four boundaries (a `graphify-out/` Read still denied, Guard 2 still asks, Case B still fails closed, `CC_HOOK_ALLOW` untouched).
- **Framing decides who reaches for which:** the allowlist is the sanctioned permanent exception and goes through review; `CC_GUARD3_WARN` is documented as temporary false-positive triage, which turns every use of it into a report that improves the patterns.
- **The allowlist moves to `.claude/memory/bash-scan-allowlist.txt`, and its safety rests on the template never shipping that filename**, not on its directory. Stated that way because `deployProject` force-copies `project-template/.claude` wholesale, which is `[BUG-039]`. The file is a guard-weakening surface: the format supports `#` comments and the docs require each entry to carry one, and the deny reason names the file path so the sanctioned route is discoverable at the moment of friction.
- **Allowlist matching semantics pinned before the format ships**, because six corpus cases are about to become a user-facing contract: directory entries end in `/` and match a suffix drawn from a fixed class, rejected on a `..` component; every other entry is a whole-token exact match between `[ \t\n\r\f\v|;()]` delimiters; no glob expansion; absent means empty (policy) and unreadable means empty plus a `CC_HOOK_DEBUG` line (fault), and neither may throw into the Case B catch-all.
- **One sanctioned divergence from the authority, pinned by an exception row.** The fixture interpolates entries raw, so `file.ts` also allows `cat fileXts` (probed, confirmed). The port escapes and matches literally. That is a behavior change from the authority, so it is asserted as an inequality by design with a comment naming the spec, and a test asserts the exception list has exactly one member. Everywhere else the fixture's verdict wins and a disagreement is a port defect.
- **Corpus design: one shared `[label, command, verdict]` table driving both subjects**, the frozen bash fixture and the port, asserting identical verdicts. The conversion is proved faithful by the fixture staying green on all 108. A parallel hand-written suite was rejected (silent drift), and re-pointing at the port alone was rejected (retires the oracle exactly when the port needs it).
- **Sequencing constraint carried into the plan:** the fixture's allowlist-source edit lands in its own commit **before any ported pattern**, 108 green against the edited fixture, the edit confined to where the array is populated, and the fixture's header amended in the same commit to name the two sanctioned exceptions, so a header that forbids edits does not sit above a diff that shows one.
- **One file, not a sibling module.** A missing sibling makes `import` fail at module load, node exits 1, the platform reads that as a non-blocking hook error, and every tool call proceeds unguarded with no decision object: a silent total fail-open from one absent file. Self-containment beats the repository's own preference for smaller files here, at roughly 420 lines.
- **Filed during this spec:** `[BUG-039]` (`deployProject` force-copies over host-owned project files), same defect family as `[BUG-035]`, both worth weighing as one spec after this release.

## Checkpoint 2026-09-25 21:02

### Decisions

- **`[BUG-037]` shipped as `1.29.0`** (minor: a guard that has never fired begins firing) in nine commits on `fix/bug-037-guard3-port-and-first-ship`, squash-merged as `c6f94c1` (PR #30). Test baseline moved **617/12 to 747/12**. Guard 3 now judges every `Bash` command on every installation that re-runs the installer.
- **The port reproduces the authority's quirks deliberately, including the ones that look like bugs.** Two were load-bearing: the reference slices `after` by match *length* from position 0 rather than from the match index, and bash's `$( )` strips the trailing newline before the newline-to-semicolon pass. The second was missing from the plan's code and was the single cause of all eleven initially failing rows across P3, P5, P6, P8 and P12. A port that "corrects" either one disagrees with its own corpus.
- **The authority is spawned under `LC_ALL=C`, and that pin is part of the contract, not hygiene.** `[[:space:]]` is locale-dependent: BSD libc treats U+00A0 and U+2028 as space in a UTF-8 locale, glibc does not, and the C locale is exactly `[ \t\n\r\f\v]` everywhere. The port matches that explicit class, so unpinned the authority denied three dialect rows the port allows, which would have broken the single-divergence contract on macOS only. All 108 original verdicts are unchanged under the pin, which is what proves it a fidelity fix rather than a verdict adjustment.
- **`CC_GUARD3_WARN` ships in the same release as the deny.** It converts Guard 3's denial into `ask` with the identical reason, is documented as false-positive triage rather than configuration, and its scope is pinned by four assertions in one test. The allowlist remains the sanctioned permanent exception.
- **The allowlist is read per invocation, not cached, and the number is on the record: 0.0163 ms per call over a 100-line file.** The spec required a measurement instead of a guess, so the no-caching decision closes on evidence.
- **One sanctioned divergence, and the row that asserts it needed a glob.** The allowlist is consulted only *after* a check fires, so the originally specified `cat fileXts` was allowed by both subjects and proved nothing. The exception row is now `cat fileXts *.md`, where P4 fires and the verdict turns entirely on raw versus literal entry matching.

### Conventions

- **A plan's own generation rules can destroy the data a test needs.** The three dialect rows carried labels naming U+00A0 and U+2028 while their commands held plain ASCII spaces, because `cc-plan.md`'s ASCII-only rule stripped exactly the characters under test. Any corpus row whose subject IS an invisible character must write it as an escape (`'cat *.ts'`), never literally, so the plan stays ASCII and the row keeps its meaning.
- **A static assertion must not be written so that its own documentation trips it.** The character-class test scanned the whole pattern block for `\s \S \w \W \d \D`, and the only hits were in the header comment that names them in order to forbid them. The scan now excludes whole-line comments, because making the rule unstatable in the one place a reader looks for it is worse than the gap.
- **When the table and the authority disagree, the authority arbitrates and the table is corrected** — but only after confirming the authority's verdict is a property of the reference and not of the harness. Both dialect failures and the eleven port failures looked identical at the summary line; one was a harness defect (locale), the other a port defect (chomp).
- **A differential probe over the whole corpus beats reading a failure list.** `probe(command, allowlist)` returning both subjects' verdict plus pattern ids turned eleven scattered failures into one root cause in a single run, and re-running it after the fix produced `0 disagreements of 115 probed` as the evidence the port was done.
- **Guard 3 constrains how this repository's own agent works, and the adaptation is to use the file tools, never to bypass.** An unquoted `\[ \]` trips OBF (it is the checkbox-flip regex the surgical ritual uses), `| head` pipelines trip P7, `cat` heredocs with bracket classes trip P4, and `for (const x of ...)` in `node -e` trips P9. Every one was verified faithful to the reference before adapting. Checkbox flips go through Edit; log inspection goes through Read and small scratchpad scripts; commit messages go through `git commit -F`.
- **A pre-commit hook failure whose test durations sit orders of magnitude above baseline is diagnosed as contention first: check for concurrent or orphaned test processes before reading a single stack trace.** Today's rejection reported three failures across three unrelated suites at ~534 s each against a 5.81 s clean re-run, and the earlier 963 s port-suite outlier has the same cause. The next occurrence should cost one `ps`, not a diagnostic cycle.
- **A fixture edit never shares a commit with a ported pattern, even when it is only a comment.** The header's divergence example was wrong and was corrected in its own commit (`cbe9a26`) ahead of the port, so the file that says "do not edit to make a port pass" never appears in the same diff as the port.
- **An id that was considered and NOT consumed is named in prose, never in brackets.** The two-stage ceiling check greps the bracketed form, so a bracketed reference to an unconsumed id is indistinguishable from a filing and silently raises the ceiling. Caught on `[BUG-038]`'s non-consumption note, whose first draft moved the computed ceiling from `041` to `042` and would have sent the next filing to `043`. Only a real filing wears the brackets.
- **The main-landing boundary is inert artifacts that record what IS, versus commits that change what the product DOES.** Corpus rows asserting existing verdicts land on `main` with the filing they are evidence for, because they are evidence preservation in the same class as the filing; rows that FLIP a verdict are feature work and branch. Settled when `[BUG-041]`'s three `KNOWN-FP` specimens landed in `91d20fe` alongside their filing. Cite this line rather than re-deriving the call.

### Debt

- **Guard 3 has a real false-positive surface on agent tooling, faithful to the reference.** OBF fires on an unquoted escape run at a command position; P7 and P4 fire through the slice-by-length quirk when a pipeline re-matches and the slice breaks quote balance. Not port defects, so not fixed here. Worth a backlog id if the friction recurs: the candidate is narrowing OBF's escape-run rule, and the evidence to gather first is which real commands trip it.
- **The port suite is slow in the worst case.** 117 rows each spawn a Node process; one cold run took 963 s and later runs 3 s. The cause of the outlier was not established. If it recurs, it is a real finding.
- **`[BUG-035]` and `[BUG-039]` remain one defect family** (installer force-copy over host-owned files) and are still worth weighing as a single spec. The 1.29.0 changelog instructs the installer re-run that triggers `[BUG-035]`, which keeps the pressure on.
- **`[BUG-038]` is still open** and still shapes this checkpoint: `/cc-checkpoint` derives its phase by carry-forward from a row only `/cc-compact` writes.
- **`[BUG-034]` stays `[~]` superseded.** Still open from FEAT-016: the interactive `/cc-init` live-verification line, not a release gate.
- **Resolved from the 1.28.0 checkpoint: the hook hot-reloads mid-session.** Guard 3 began judging this session's own commands the moment the port was written to `.claude/hooks/pre-tool-use.mjs`, with no session restart. Recorded at the first live denial, as that checkpoint asked.

## Spec: BUG-039 Installer Host-Owned State 2026-09-27

- **Approved as amended, with two required additions and two recorded rejections.** `docs/superpowers/specs/2026-09-27-bug039-installer-host-owned-state-design.md` (untracked; `docs/` is gitignored), 188 lines, 21 acceptance criteria. Targets **1.30.0** (minor: the installer stops overwriting files it used to overwrite, and `settings.json` gains a merge path). Complexity **L**.
- **One spec covers the family, and `[BUG-039]` is the surviving id.** `[BUG-035]` is marked `[~]` superseded with a forward pointer, following the direction set when `[BUG-036]` superseded `[BUG-034]`: the newer id survives. The pointer exists because the 1.28.0 and 1.29.0 changelogs both reference `[BUG-035]` by name and those references must still resolve.
- **The audit found more than the two filings described.** A third instance: `project-template/.claude/settings.json` is force-copied too, and unlike the global surface no merger runs on it at all. And the ordering defect that makes `[BUG-035]` observable: `bin/code-conductor.mjs:93` force-copies `settings.json`, then `:98-99` merges the conductor's hooks into it, so the machinery built to preserve host entries is merging into a file whose host entries died six lines earlier. The preservation code was always real; it was applied one step too late.
- **The latent set grew from one file to five.** Beyond `bash-scan-allowlist.txt`, the project surface's `memory/personal.md`, `memory/session-snapshot.json`, `memory/session-snapshot.md`, `memory/turn-count.txt` and `settings.local.json` are all host-owned and all protected today only because the template does not ship those filenames. `conductor-version.md` is installer-owned and needs no entry. Converting protection-by-absence into protection-by-contract is the deliverable, not a side effect.
- **The enumeration is a policy table, not a skip list**, because the audit found three required behaviors: `skip` (never write, no seed exists), `seed` (write only when absent), `merge` (combine). A flat list cannot express that, and the single place a reviewer looks would not state what actually happens to each file. `memory/personal.md` is `seed` globally and `skip` per-project, because only `global/` ships a copy.
- **`settings.json` merges entry-level by fingerprint**, generalizing what `settings.mjs:37-104` already does for two hooks rather than inventing a second mechanism. Key-level replacement was rejected: it keeps unknown top-level keys but still destroys a host entry sharing an owned key, which is the same defect one size smaller.
- **Both fingerprint directions are asserted, and either alone is half the contract.** Backward: no fingerprint may be dead. Forward: every hook entry the template ships must match exactly one fingerprint, which is assertable today because every shipped entry is by definition conductor-owned. Without the forward direction a future release can add a template entry and forget its fingerprint, after which the merge either never delivers it to existing installs or appends it beside itself on every re-run.
- **`permissions` is host-owned after seeding, and that is declared rather than implied.** `MERGE_OWNED_KEYS = ['hooks']` with a test asserting the merge writes no key outside it, so `env`, `statusLine`, `model` and every key a future Claude Code adds inherit the answer by construction. Union was rejected on security grounds: a grant the operator deliberately revoked would return silently on the next re-run, and a permission list whose removals do not stick is a ratchet that only loosens. For a product whose thesis is guardrails, the operator's tightening must win over the template's convenience.
- **The cost of never touching `permissions` is made mechanical rather than remembered:** a test pins the seeded grant list verbatim, so changing the template's grants forces touching that test, and the review of that touch is where the changelog's manual-add instruction gets written. Forgetting becomes a failing test.
- **Recovery is detection only, and scoped to `project.md` alone.** Restoring from git would mean the installer writing host files out of the host's history, with new failure modes for a path that fires in one narrow case. `context-threshold.txt` detection was considered and rejected: its stub is a default most hosts never tune, so stub-equality is uninformative and the warning would fire near-universally and train users to ignore it. The residual false positive on `project.md`, a freshly scaffolded project legitimately equalling the stub, is why the wording says "may have been overwritten".
- **A one-time backup on first migration was considered and declined:** the merge preserves by construction rather than by recovery, the one unpreservable path already backs up through `backupMalformed`, and a one-time backup needs migration state the installer does not keep.
- **The merge is in place, and that is an acceptance criterion rather than a nicety:** host entry order preserved, owned entries rewritten where they sit, only genuinely new entries appended, and a re-run of an unchanged release producing a byte-identical `settings.json`. Idempotency is what makes a re-run's diff read as restraint.
- **Known limitation, stated rather than solved:** fingerprint matching is substring-based, so a host command that merely mentions a conductor hook's filename is captured as owned. Narrowing it needs a marker written into every existing install, so it is out of scope and named so the next reader does not read it as an oversight.
- **`skipHostOwned` is retired rather than patched.** Both surfaces go through one mechanism; the family exists because the two halves diverged, and leaving the old filter beside the new table would preserve the divergence in miniature.

## Checkpoint 2026-09-27 12:54

`1.30.0` shipped `[BUG-039]` (PR #31, squashed as `3bcdc1f`), then `[BUG-041]` was filed from evidence gathered while shipping it. Suite `747` to `816` passed / `12` skipped.

### Decisions

- **The host-owned enumeration is a policy table per surface, not a skip list**, because the audit found three distinct required behaviors (`skip`, `seed`, `merge`) that a flat list cannot express. `GLOBAL_HOST_OWNED` and `PROJECT_HOST_OWNED` live in a new `lib/installer/host-owned.mjs` with the fingerprint lists, the `cpSync` filter and the seeder.
- **The settings merge lives in its own module, `lib/installer/settings-merge.mjs`**, not in `settings.mjs`. `file-merge.mjs` already imports `utcStamp` and `pruneBackups` from `settings.mjs`, so a function needing `resolveRealTarget` would close an import cycle. ESM tolerates the cycle; a reviewer should not have to reason about it. The import site carries a one-line comment saying so.
- **`MERGE_OWNED_KEYS = ['hooks']` is enforced structurally, not by convention.** `mergeSettingsFile` contains exactly one assignment into the host object and it is guarded by that constant, so `permissions`, `env`, `statusLine`, `model` and every future Claude Code key are host-owned because no line can reach them. `permissions` is therefore written once, at seed time, including a grant the operator deliberately removed.
- **Stub detection runs BEFORE the seed**, which removes the fresh-scaffold false-positive class entirely rather than accepting it. The spec's rationale was corrected to match, because the old sentence justified the wording by a false positive that no longer exists.
- **`GLOBAL_SETTINGS_FINGERPRINTS` is empty, and the vacuity is asserted rather than tolerated.** `global/settings.json` ships `permissions` and no hooks; its two entries are synthesized from the host's absolute home (`settings.mjs:27-35`, the BUG-033 lesson). A test pins the shipped hook-entry set equal to the empty list, so the day that file ships an entry the forward assertion fails first.
- **Both `skipHostOwned` and `seedMemoryFile` are retired rather than patched.** The family existed because the two surfaces diverged; leaving either beside the table would preserve that divergence in miniature.
- **`[BUG-041]` is evidence-only and does not re-prioritize.** All three specimens replayed through both subjects gave `0 disagreements of 3`, so they are faithful false positives, and the refinement spec queues behind `[BUG-038]` and `[BUG-040]` as planned. A differential defect would have moved it to the front; none surfaced.

### Conventions

- **AC-21-style "no existing case adjusted to fit" targets adjustment to fit THE IMPLEMENTATION**, meaning a weakened assertion that lets new code pass. Loud, justified and stronger is permitted; quiet or weaker never is. Exactly two shapes of touching a pre-existing test are legitimate, and each is named in the record when used: **COVERAGE FOR DELETED CODE** (the `seedMemoryFile` block, with a tombstone comment naming where the coverage moved), and **ASSERTION ENCODING RETIRED BEHAVIOR, UPDATED TO THE SPECIFIED ONE, STRENGTHENED NOT WEAKENED** (`deploy.test.js:69`).
- **A test does not get to veto a spec; it gets updated by one, on the record.** When `deploy.test.js:69` contradicted the approved spec's Main path, the test moved. Edit the case rather than replace it when its premise is alive and only its mechanism changed; replacement is for a case whose premise died, and deleting loses the lineage a reviewer git-blames later.
- **The AC-21 audit is a command, not an assertion:** `git diff origin/main -- tests/` filtered to removed lines. Eleven lines, both groups accounted for. A reviewer can re-run it; prose claiming "no tests were weakened" cannot be re-run.
- **A spec is corrected before the code, never contradicted by it.** Applied twice this session, both in `43df0a4`, landing ahead of the first implementation line. A plan decision that changes what the spec asserts is a spec amendment first.
- **A plan's predicted counts are themselves reviewable artifacts.** The T-007-B miss was an arithmetic slip in the plan whose own parenthetical enumerated the right figure. When a boundary misses, check whether the prediction or the code is wrong before touching either.
- **The main-landing boundary is inert artifacts that record what IS, versus commits that change what the product DOES** (already recorded above under the 1.29.0 checkpoint's conventions, settled by `91d20fe`).

### Debt

- **`[BUG-041]`: Guard 3's false-positive surface on ordinary agent commands.** Six P7 denials this session, two P4, two OBF, two P9 (one a legitimate loop), and one P5 discovered after filing. P7's mechanism is that `g3GlobWalk` slices by match LENGTH not index, shaving 7 bytes off the front per iteration until the text starts inside a quoted region, at which point `g3Scan`'s fail-closed unterminated-quote branch reports a glob that was never there. The false-positive rate grows with command length and quote count and is independent of globs. `g3P4CatGlob` shares the walk verbatim. Three `KNOWN-FP` corpus rows assert the current deny verdict so the refinement inherits its acceptance cases.
- **The refinement's first gate is already known:** fixing the walk diverges from the frozen authority, which carries the same defect, so the spec must choose between patching the authority in parallel and promoting the rows to sanctioned divergences. Recorded in the filing so the spec opens at that question.
- **One P5 specimen is uncaptured.** It fired on a `grep -n` whose search string contained backticks, after `[BUG-041]` was filed. Unfiled under that entry's own evidence-first rule, since it has no differential run behind it.
- **Fingerprint matching stays substring-based**, so a host command merely mentioning a conductor hook's filename is captured as owned. Narrowing needs an on-disk marker in every existing install. Out of scope by decision, recorded in the 1.30.0 spec.
- **Seven stderr lines per full suite run** come from `deployProject` cases that inject no `warn` channel, so the production default emitter prints the recovery line against fixtures that genuinely match the stub. Left rather than silencing a real diagnostic in tests.

### Workarounds

- **A multi-line `git commit -m` message is scanned by Guard 3 like any other Bash command.** The preprocessor joins lines with `;`, so a wrapped body line BEGINNING with `for`, `while` or `until` lands at command position and trips P9. Reflow the message; do not bypass. A genuine `for id in ...; do` tripped P9 correctly in the same session, which is the control proving the pattern works and its input is over-broad.
- **Avoid combining a pager or reader token with quoted text in one Bash call** while `[BUG-041]` stands. `| tail -N` after a quoted `printf`, or `sed -n` after a quoted `echo`, reliably denies. Use Read for file inspection and a scratchpad `.mjs` script for anything iterative; `spawnSync` in a script replaces a shell `for` loop cleanly.
- **`git add` on a path under `.claude/` exits 1 while staging correctly** (`[BUG-040]`, hit again this session on `project.md`). Never chain `&&` after it; issue the commit as a separate command and read the staged set from `git diff --cached --name-only`.

## Spec: BUG-038 Handoff Contract 2026-09-27

- **Approved as reconciled.** `docs/superpowers/specs/2026-09-27-bug038-handoff-contract-design.md` (untracked; `docs/` is gitignored), 176 lines, **19 acceptance criteria**. Targets **1.31.0** (minor: a snapshot the reader used to discard is now read, and two commands begin writing session rows). Complexity **M**.
- **`[BUG-038]` is widened to the handoff-contract family and survives as the id.** The ceiling check ran over the working tree union `origin/main` (`BUG` stood at `041`), so `BUG-042` was available and was **deliberately not consumed**: the two instances are coupled through the contract rather than merely adjacent, so one audit, one contract and one end-to-end criterion cover both. Recorded in the entry too, so the numbering history stays explicable.
- **The defect class is one sentence:** a fact is asserted by one component and re-interpreted by another against a different rule. Two known instances. **Size:** `snap-build.mjs` permits a v2 `pr` up to 10 MiB and asserts it; `snap-validate.mjs:7` caps the whole payload at 4096 unconditionally, so every checkpoint snapshot carrying real prose is written, stored, then discarded. **Phase:** `cc-compact` determines a phase at a boundary; `cc-checkpoint` reuses whatever it finds.
- **The size instance, measured:** 4096 bytes accepted, 4097 rejected, boundary exact. Size is the only variable that matters. Nothing is lost on disk; `get-snapshot` returns all 11173 bytes of this session's own blob intact, and only the reader discards it. Probed with the live row saved and restored byte-identically.
- **4096 is not arbitrary and is not raised.** `snap-build.mjs:4` names it `V1_MAX_CHARS // handoff-file contract (v1)`: the context budget for a file read into a session. It keeps that job. The fix is a second tier, with both values stated so neither is interpreted: pre-parse ceiling **10 MiB** applied whatever version is claimed, post-parse cap **4096 for v1 and 10 MiB for v2**. They coincide for v2 today and separate the moment a v3 arrives.
- **The defect is check ORDER, not a drifted literal.** The validator is version-aware at `:14` and `:19` but its size check sits at `:7`, one line before `JSON.parse` at `:8`, so it cannot branch on `snap.v`. Every other check was made version-aware; this one is structurally excluded by where it sits.
- **The pre-parse guard block is the validator's only untested region.** Lines 5 to 7 check encoding, internal newline and size, and the 52-case suite exercises none of the three. That is why a v1 constraint could sit in front of the v2 path indefinitely with a green suite. ACs 3 to 5 close it, including pinning the newline-escape behavior that works today before the file is touched.
- **Four drift surfaces, not one, and the fourth is invisible by construction.** The blob ceiling exists as `10485760` and `10 * 1024 * 1024`; the v1 budget is named on one side and bare on the other; the field sets and version ceiling are sole-owned by the validator; and the **array caps are identical values in two different key schemes**, leaf (`{n: [3,200], ...}`) in the writer versus dotted (`{'ops.n': [3,200], ...}`) in the validator, which defeats the usual way a reviewer notices duplication. One module carries all four.
- **Scope was widened during review to match the Solution's own wording.** The first draft's module carried only the limits while the Solution promised limits, fields and version, which would have left two of the four duplications standing. Taking the fuller reading also pins the v3 path by AC: raising the supported version in the module alone moves the `SNAP_UNKNOWN_VERSION` boundary with no other edit.
- **Under-informative degrade becomes loud degrade, stated precisely rather than overstated.** The reader is not silent: it appends `resume: db-invalid degrade` then `resume: miss` to `.conductor/last-write.log`. It withholds the cause, and rc 3 is defined as a clean miss, so nothing reaches the developer. The fix needs no new channel; the existing unconditional trace line gains the reason and the size against the cap, and the degrade and exit code are unchanged, because fail-open is correct for a cache and only the silence about why was wrong.
- **The phase is written by the component that owns it.** `/cc-plan` and `/cc-implement` each write a session row at their own boundary, so `cc-checkpoint`'s carry-forward stops being stale without changing how it derives. The carry-forward was never wrong; it was reading a record nobody had written. **Rejected: cc-checkpoint determines its own phase** (the originally filed candidate), because it asks the worst-positioned witness to testify and duplicates reasoning prose in two command files. **Rejected: an explicit phase argument** as YAGNI, since a checkpoint taken mid-phase is a state to represent truthfully, not an ambiguity to override.
- **A correction to this item's own filing, carried into the entry.** The Description claims `/cc-compact` is the only command that writes a session row. False: `cc-checkpoint.md:43` writes one too. The true claim is narrower and is what makes the chosen fix load-bearing: cc-compact is the only command that **determines** a phase. `/cc-plan` touches the DB not at all.
- **The DB tail becomes one shape, not three.** With `cc-compact`, `cc-plan` and `cc-implement` all carrying a fail-open session-row write, the wording is extracted once and instantiated per command, and the two-mirrors parity coverage asserts the three tails agree in everything but the phase literal.
- **Three of my own imprecisions were caught in self-review and fixed inline**, which is the discipline applied to a spec against itself: the pre-parse ceiling was referenced three times without a value, the degrade was called silent when the trace log disproves it, and the Solution said the reader stops reporting a clean miss while AC 9 requires it still exit 3.
- **Deferred to `/cc-plan`:** full reads of `scripts/resume-read.mjs` (160 lines), `conductor-db.mjs` (542), `snap-build.mjs` (90), `snap-validate.mjs` (32, read to 30), and both `global/commands/` tails.
- **Forward note, not this spec's work:** at ship time the archetype gets its own conventions paragraph, "success semantics on failure paths", with its four instances (Guard 4's original shape, the exit-1 guard, `add_rc=1` under `.claude/`, and the clean-miss resume) plus a standing instruction to grep for the fifth proactively.

## Plan: BUG-038 Handoff Contract 2026-09-27

Plan: `docs/superpowers/plans/2026-09-27-bug038-handoff-contract.md`, 7 tasks, 45 checkbox steps, targeting 1.31.0 on `fix/bug-038-handoff-contract`. Measured baseline before Task 0: **816 passed, 12 skipped, 31 files** at `673ac3c`. Predicted per boundary: T-001 825, T-002 830, T-003 833, T-004 846, T-005 849, T-006 849.

### Conventions

- **A third legitimate shape of touching a pre-existing test: FIXTURE COMPLETENESS.** Ruled on at plan approval for `tests/scripts/conductor-db.test.js:286,306`, whose two `Fallback B` cases copy `conductor-db.mjs` alone into a sibling-free temp tree and would fail at `ERR_MODULE_NOT_FOUND` once it imports the contract module. No `expect` changes; the fixture tree gains a file the deployed layout has always shipped, since the installer copies `scripts/` wholesale (`lib/installer/deploy.mjs:190`). The single-file copy was an artifact of the script having had no siblings. Distinct from the BUG-039 shape, where an assertion encoding retired behavior was updated to the specified one: there the assertion changed and got stronger, here the assertion does not change at all. The two shapes now on the record are assertion-retirement and fixture-completeness; both are loud and pre-declared, quiet or weaker is still never permitted.
- **A test that copies one script into an isolated tree is a constraint on that script's imports.** `resume-read.mjs` may not import the contract module for exactly this reason (`tests/scripts/resume-read.test.js:193,205`), so it learns a rejection's cause from the validator's stderr instead. Grep for lone `cpSync(SCRIPT, ...)` fixtures before adding a sibling import to any script under `scripts/`.
- **A file sitting exactly at a line-count cap makes every refactor a budget exercise.** `snap-validate.mjs` is at 32 of 32 (`tests/unit/snap-validate.test.js:247`). The two-tier split lands back at exactly 32 by packing the contract import onto line 1 and deleting the two now-imported table literals. The remedy for an overrun is statement packing, the style the file already uses; never editing the cap.

## Implementation: BUG-038 Handoff Contract 2026-09-28

Shipped as **1.31.0** on `fix/bug-038-handoff-contract` in 8 commits (`caae45f` plan, `2ae00c1` contract and two-tier validator, `df7c23e` writer and store, `bd0e9ec` loud degrade, `027b259` phase tails, `28db98b` cycle test, `c03ff47` release, `41f15eb` executed plan state). Suite **816 to 849 passed / 12 skipped**, **31 to 33 files**. Every boundary hit its predicted count exactly: 825, 830, 833, 846, 849, 849. The tripwire never fired, which is the first time a plan of this size has predicted every boundary correctly.

### Conventions

- **The archetype, named at last: SUCCESS SEMANTICS ON FAILURE PATHS.** A component reports a *successful outcome* through a channel whose values already mean *failure*, or the reverse, so a correct decision is indistinguishable from a malfunction. Three distinct defects, four recorded instances: (1) **Guard 4's original shape** (`[BUG-036]`) wrote a valid decision object and exited 1, and the platform reads a non-zero hook exit as an error, so a correct deny arrived as a broken hook; (2) **`git add` exits 1 while staging correctly** (`[BUG-040]`, filed) so `&&` chains abort after the work has already succeeded; (3) the same defect **observed again this session as `add_rc=1` on paths under `.claude/`**, with all six paths present in `git diff --cached`, which is why it is a recorded instance and not a new filing; (4) **the clean-miss resume** (`[BUG-038]`, fixed here): rc 3 is *defined* as a clean miss, so an 11172-byte blob that was rejected on size was reported to the developer as an ordinary fresh start. The standing instruction is to **grep for the fifth proactively** rather than wait for it to surface: the tell is any `exit 1`, `return null`, `rc 3` or empty-stdout path that a caller cannot distinguish from the ordinary case, and the repair is never to change the code, only to make the channel carry the cause.
- **A reader that consumes what it verifies cannot be used as a probe.** `resume-read.mjs:135` unlinks the handoff file when a DB hit supersedes it, so running it to check a snapshot deletes the file being checked. Correct in production, where a phase entry is meant to consume the binding; wrong for verification. Copy the blob out first, or read the DB row directly.
- **A test that copies one script into an isolated tree constrains that script's imports** (recorded at plan time, held under execution): `resume-read.mjs` learns a rejection's cause from the validator's stderr precisely because two of its own fixtures copy it alone.
- **A plan's predicted literals are as reviewable as its predicted counts.** Three of this plan's own assertions were wrong about measured behavior and each was corrected against the measurement, never the other way round. See the deviations below.

### Deviations from the plan as written

1. **Every commit used `git commit -F <file>` instead of the plan's `git commit -m "$(cat <<'EOF' ...)"`.** Guard 3 denies a `cat` heredoc inside a compound command (P4). Message bytes identical.
2. **The plan file was re-staged after its own checkbox post-flip at T-000.** Otherwise the permanent record would show `[T-000-A]` frozen at `[>]`, since `docs/` is gitignored and no later commit re-adds the file.
3. **`scripts/snap-build.mjs:53`, one comment line beyond "nothing else in the file changes".** The comment read `// ---- v1: 4096-char cap ----` and T-002-A's own `not.toMatch(/\b4096\b/)` scans the whole file. Retitled to name `V1_MAX_CHARS`; weakening the assertion was the alternative and is forbidden.
4. **T-003-A's expected reason was wrong about the validator's own message.** The plan asserted `SNAP_ERROR: missing: `; the fixture has no `ops` block and `snap-validate.mjs:10` checks blocks before fields, so the real cause is `SNAP_ERROR: missing block: ops`. Corrected to the measured, narrower message.
5. **`unnest` in `tests/installer/commands-parity.test.js` gained a third substitution.** The plan claimed `cc-implement mirrors` already passed; it did not, because `cc-implement.md:136` invokes `node <chosen-flags> scripts/conductor-db.mjs` and the transform only recognized an adjacent `node .claude/scripts/`. Risk 6 anticipated the collision and chose the other horn, then T-004-C's own block violated that rule with `node <probe-flags> .claude/scripts/`. Extended the transform rather than reword a command line whose flags placeholder is load-bearing. The tolerated class is unchanged; its coverage is completed.
6. **T-005-A's fail-open case asserted a failure mode that does not exist.** `validateKey` (`conductor-db.mjs:45`) checks emptiness and length, never hex shape, so the plan's `NOT-A-HASH` is a valid key and writes a row silently. Implemented the mechanism the case's own comment named, an unwritable `.conductor` via `chmodSync(dir, 0o555)` with a restoring `finally`, skipped under uid 0. Probed first: exit 0, `CONDUCTOR_DB: cannot create <dir>/.conductor: EACCES, skipping cache write`, no row.
7. **The CHANGELOG entry is dated 2026-09-28, not the plan's 2026-09-27.** The date rolled over mid-session; a release date is a fact about when it shipped, and two entries sharing 09-27 would misstate the sequence against `1.30.0`.
8. **One extra commit, `41f15eb`.** T-006-F and T-006-G land on `main`, where the plan file does not exist, and an uncommitted modification to a file absent on the target branch blocks `git switch`. Committed the executed checkbox state first, which also preserves the plan as executed rather than as written. **Carry forward: any future plan whose final task lands on `main` needs this commit in its own step list.**

## Closeout: BUG-038 and 1.31.0, corrections 2026-09-28

Four corrections to the record, batched into one memory touch as the convention requires. None amends a landed commit: history records moments, including miscounts.

- **Commit count, corrected.** The implementation entry above says "8 commits" and lists through `41f15eb`, because `901fc09` postdates the entry. The true figure for the release is **eleven**: nine on `fix/bug-038-handoff-contract` and two on `main` under the owner-scoped convention. PR #32 squashed the nine (plus `61b250d`, which rode along) into `2e7a89c`; the two record commits replayed as `15feff9` and `664bb8f`. A twelfth commit, `0aa329d` via PR #33, corrected the `VERSION` file afterwards and is a follow-up rather than part of the release.
- **The review boundary, now precedent.** **The owner-scoped exception covers record artifacts, never unreviewed feature merges, and that boundary holds even when the owner is the one asking.** Established when `gh pr merge --squash` was refused by branch protection and `--admin` was declined rather than used: the owner then approved PR #32 through review instead. A release artifact is not a record artifact, which is why the `VERSION` correction went through PR #33 rather than a direct push. Cite this line rather than re-deriving the call.
- **A plan whose final task lands on `main` needs TWO extra steps in its own list, not one.** First, a commit of the plan's checkbox state before the switch, because an uncommitted change to a file absent on the target branch blocks `git switch`. Second, after the squash merge, a rebase of the record commits onto the new `origin/main`, gated on a content count before the push: the replay of any commit already carried by the squash must drop as "patch contents already upstream", and the gate is that each record section appears exactly once. Verified working this release; git reported the drop in those words.
- **The version literal does NOT live only in `package.json:3` and `CHANGELOG.md`.** That claim was recorded here, was wrong, and the BUG-038 plan inherited it in a single version step, so `1.31.0` shipped with the root `VERSION` file still reading `1.30.0`. The release ritual touches **both** `VERSION` and `package.json`; the 1.30.0 plan did it as two separate steps (`T-008-B`, `T-008-C`). **Derive a release step list from the previous release's plan, which is in the repository, not from a remembered summary of it.** No test asserts the two files agree, which is why six green boundary checks, a final full-suite run and nine pre-commit hooks all passed with `main` in that state. A parity assertion is the obvious repair and is named as a follow-up on PR #33 rather than smuggled in beside the fix.

## Spec: BUG-040 Staging Convention 2026-09-28

- **Approved with one required refinement.** `docs/superpowers/specs/2026-09-28-bug040-staging-convention-design.md` (untracked; `docs/` is gitignored), 122 lines, **10 acceptance criteria**. Targets **1.31.1** (patch: agent-instruction prose and one test; no shipped behavior change). Complexity **S**.
- **The mechanism, settled by audit rather than inference.** `git check-ignore` returns rc 1 on the tracked path and only matches under `--no-index`: git already knows a tracked file is exempt. The warning names the **excluded ancestor**, never the file, which is the tell. `git add` stages from the index AND walks the pathspec against the ignore rules; the second produces the warning and the exit code. **`git add` exit 1 means "the pathspec matched ignored paths", not "staging failed".**
- **Two candidate shapes from the filing are struck by the matrix and must never be re-proposed.** Anchoring: `/foo/` behaves identically to `foo/`. Bare negation: `!foo/memory/notes.md` under a directory rule changes nothing, since git cannot re-include a file whose parent is excluded. Recorded in `[BUG-042]` with the rows that killed them.
- **The fix is `-u` for tracked and `-f` for new, narrowing the filing's blanket `-f`.** `-f` **overrides** the ignore rule, so a typo naming a genuinely ignored file stages it silently; `-u` never consults the rule and fails loudly at rc 128 on an untracked path. **Blanket `-f` discards the signal the ignore rule exists to give.**
- **Scope was settled by reading the shipped template, not by assuming.** `project-template/gitignore` ignores only `turn-count.txt` and installer temp files, so **managed projects do not ignore `.claude/`** and users of the product never pay this toll. That struck `global/CLAUDE.md` and `project-template/CLAUDE.md` from the surface.
- **The required refinement, and it is the sharpest point in the review: do not export a fix's cost to users who never had the defect.** The first draft's AC4 prescribed an unconditional `-u` in `cc-checkpoint.md`, a **global** command that also runs in managed projects. There `project.md` may be untracked on a fresh scaffold with no ignored ancestor, where plain `git add` exits 0 and `-u` exits **128**, halting the first checkpoint. The draft would have traded this repository's rc-1 toll for a new rc-128 toll on every managed project's first checkpoint. AC4 is now branch-aware, with the fresh-scaffold case in Alternative Paths.
- **A second matrix now pins what the branch is on.** For an untracked file, `-u` exits 128 **with or without** an ignore rule, while plain `git add` exits 0 with no rule and 1 with one. **The boundary is tracked-ness, not the ignore rule**, which is why the instruction branches on tracked-ness. Asserted as AC8.
- **AC6 pins the DEFECT, not only the fix:** plain `git add` on the fixture must still exit 1 while staging. This is the pin-the-disease move from `[BUG-037]`'s `KNOWN-FP` rows, applied to git itself, so the convention's reason for existing cannot quietly vanish under a future git.
- **Rejected: forbidding `&&` after a staging step in generated plans.** With the exit code no longer lying for the tracked case, the chain is safe; a blanket ban would be a workaround for the defect being removed.
- **Landed fragments stay as written.** `project.md:623`, `:770` and `:883` each hold a partial version of this convention. The complete rule is appended at implementation time; no landed entry is edited.
- **Deferred to `/cc-plan`:** full reads of `global/commands/cc-checkpoint.md` and `.claude/commands/cc-plan.md:80-135`.

## Implementation: BUG-040 Staging Convention 2026-09-28

Shipped as **1.31.1** on `fix/bug-040-staging-convention` in six commits (`bb34a69` plan, `b668fc1` git contract, `1134509` the convention prose, `2418bf9` prose anchors, `82f1ea4` release, `6bb919b` executed plan state). Suite **849 to 857 passed / 12 skipped**, **33 to 34 files**. Every predicted boundary hit exactly: 853, 853, 857, 857, 857. Second consecutive plan with no tripwire fire.

### Conventions

- **Stage by tracked-ness, never by habit, and never without an explicit path.** `git add -u <path>` for a tracked file, `git add -f <path>` for a new one under an ignored directory, plain `git add <path>` otherwise. The full rule with a reason per branch is in `CLAUDE.md`; `tests/unit/staging-convention.test.js` pins the four git facts it rests on. This supersedes the partial fragments at `project.md:623`, `:770` and `:883`, which stay as written because landed entries are never edited.
- **Found in pre-flight, absent from the spec: bare `git add -u` stages every modified tracked file in the repository.** A generated step that omits the path would quietly widen its commit. All three homes require the explicit path and an anchor asserts that sentence exists.
- **A fix for a defect one repository has must not be exported to repositories that do not have it.** `cc-checkpoint` is global and also runs in managed projects, which `project-template/gitignore` proves do not ignore `.claude/`. An unconditional `-u` there exits 128 on a fresh scaffold where plain `git add` exits 0 and is correct. The line is branch-aware and says so; the review caught this after the audit had already established the scope finding four paragraphs above the AC that contradicted it.
- **Pin the disease, not only the cure.** `AC6` asserts plain `git add` still exits 1 while staging, so if a future git stops lying the convention's justification fails loudly in a test instead of rotting quietly in prose. This is `[BUG-037]`'s `KNOWN-FP` move applied to a dependency rather than to our own code, and it is the reusable shape whenever a convention exists because an external tool misbehaves.
- **A release step list is derived from the previous release's plan, not from memory.** `T-004` edits `VERSION` and `package.json` as separate steps and `T-004-C` asserts they agree, halting on `false`. That gate exists because `1.31.0` shipped with the two disagreeing.

### Evidence the toll is dead

- `T-000-A`: `git add -f` on the new plan file under the ignored `docs/`, **rc 0**. The convention's first deliberate self-application.
- `T-002-H`: `git add -u` over four tracked files including `.claude/commands/cc-plan.md`, **rc 0**, in the very commit that wrote the rule. The identical plain `git add` returned 1 six times earlier the same day.
- `T-005-D`: `git add -u` over `project.md` and the backlog on `main`, **rc 0**. The release proving the toll dead in the act of shipping its abolition.

## Closeout: 1.31.1 and the queued conventions 2026-09-28

`1.31.1` merged as `4c6d74a` (PR #34) with both version files reading `1.31.1`, verified post-merge. Two conventions queued during the release, landed here rather than by amending anything.

- **Amending any commit requires an explicit go-ahead; the default is to fold the change into the next commit.** Established after I amended an unpushed plan-state commit at `T-005-A` to absorb its own checkbox flip. It was local-only and the resulting tree was identical either way, so nothing was lost and nothing anyone had seen was rewritten. It was still the wrong call to make unasked: **a history rewrite belongs to whoever owns the history, and tidiness is not the agent's reason to reach for one.** The tell is any `--amend`, rebase or reset reached for to make a record look neater rather than to fix a stated defect.
- **`[BUG-041]` now arrives with FOUR characterized patterns, not three.** The three filed specimens (two P7, one P9) plus a fourth captured during the `[BUG-038]` and `[BUG-040]` work: **P9 fires on `until [ ... ]; do` at command position**, a legitimate shell loop in an ordinary agent command, denied correctly by the pattern's own rule. It joins the corpus on the same evidence-first footing as the others. The uncaptured P5 backtick specimen did NOT recur across either release and stays unfiled under that entry's own rule.
- **A poller that hardcodes its target reports the wrong thing confidently.** The PR-approval helper written for PR #32 was re-run for #34 with the number still baked in, which would have read an already-merged PR's state as the new one's. It now takes the number as an argument and returns `POLL_ERROR` on a non-zero `gh` exit instead of letting an error string fall through as a state. Same failure-path discipline the `id-ceiling` guard needed: **a tool that cannot tell "I failed" from "the answer is no" is the archetype in miniature.**

## Spec: BUG-041 Guard 3 refinement [2026-09-28]

**Spec file:** `docs/superpowers/specs/2026-09-28-bug041-guard3-refinement-design.md` (approved 2026-09-28 with two required additions, both applied).

### The audit replaced memory with measurement

The filing described three characterized specimens. Recovering every Guard 3 denial from the session transcript and re-scanning each command against the shipped hook gave **47 denial events, 43 unique commands**. The population grew from 41 to 43 mid-measurement because two of the scripts written to perform the measurement were themselves denied by the bug they were measuring.

Three premises the audit held were wrong, and the transcript said so:
- **OBF is not zero-specimen.** Six specimens, all escape runs such as `\[ \]` inside a single-quoted `grep -E` pattern.
- **The P5 backtick specimen was never lost.** It is in the transcript verbatim: a backslash-escaped backtick inside a double-quoted grep pattern.
- **The `until` poller is not a false positive.** It is a genuine loop correctly denied, so it is a **control** row beside `for id in ...; do`, not a KNOWN-FP row. A later refinement that silences either is a recall regression.

**Convention established: measure a guard fix by copying the artifact to scratch, never by patching the repository before approval.** Both hooks were copied to scratch files with the one-line change applied and run over every recovered denial plus all 118 corpus rows. Nothing in the repository was modified to produce the numbers below, so the spec argued from measurement while the tree stayed clean.

| configuration | denials flipping deny to allow | corpus rows whose verdict moves |
|---|---|---|
| walk fix only | 20 of 41 | 2 of 118, both pre-declared KNOWN-FP |
| walk fix plus targeted quote mask | 36 of 43 | 3 of 118, the same two plus P9-1 |

The rows that move are exactly the rows `guard3-corpus.js:162-185` wrote down in advance as this item's acceptance cases. Zero unplanned regressions in either configuration.

### Gate 1, ruled (a): patch the frozen authority

`guard3-reference.sh:159` becomes `rest="${rest#*"${BASH_REMATCH[0]}"}"` and `pre-tool-use.mjs:244` becomes `rest.slice(m.index + m[0].length)`. **The authority is an oracle of intent, not a snapshot of behavior**, and the walk was never intended: bash's `[[ =~ ]]` reports the matched text and no index, so `${#BASH_REMATCH[0]}` was the only slice available to whoever wrote it. Option (b) was rejected because the one existing sanctioned divergence is enumerable while this one is a function of command length and quote count, so a count assertion over an open-ended set would be a fiction. `EXCEPTIONS` stays at one member.

### Gate 2, ruled split: the two mechanisms sever

Mechanism 1 is the walk. Mechanism 2 is the pattern checks reading quoted text as code, which fires P9, OBF and P5. They ship separately, and the decisive argument is measured: **a blanket quote mask breaks seven genuine denials**, four P6 rows, the P6 dialect row, and two P12 alias rows. **P6 and P12 inspect quoted content by design**, since a grep pattern and an alias value are the data those checks exist to read. That makes mechanism 2 a per-check design question rather than a preprocessing patch, and it needs a second five-state scanner written in bash for the authority. It files as `BUG-043`.

### The two required additions at approval

- **P4 must be arbitrated by the corpus, not only by the scratch measurement.** Both flipping corpus rows are P7, so post-ship the oracle would guard the walk fix on one of its two patterns. P4 carried zero specimens when the filing was written and five by the time the spec was, three of them pure mechanism-1 flips. AC13 adds one verbatim P4 row, chosen because it carries unquoted globs **earlier** in the command while the text after `cat VERSION` has none: the row pins that the after-text begins at the end of the match, and a later "fix" that scans the whole string for globs turns it red.
- **The deny message naming a file that does not exist gets an id, not a paragraph.** Across 47 denials the allowlist was added zero times and `CC_GUARD3_WARN` was set zero times, and `.claude/memory/bash-scan-allowlist.txt` exists in no installation while the deny message names it as the remedy. That is a product defect independent of any pattern, **documentation lying about the remedy**, and it files as `BUG-044` carrying its own candidate shapes. **Unhomed findings do not stay found**, which is why "the remedy is not a pattern change" justifies moving it rather than dropping it.

### Standing constraint this spec inherits

No acceptance criterion may be satisfied by "the operator can allowlist it." A remedy that nobody invoked across 47 denials, including the agent that wrote it, is not a remedy.

## Implementation: BUG-041 [2026-09-28]

Shipped as `1.31.2`. Plan: `docs/superpowers/plans/2026-09-28-bug041-guard3-refinement.md`, 6 tasks, 56 checkbox steps, seven commits on `fix/bug-041-guard3-refinement`.

### Boundaries: five predicted, five hit exactly, one tripwire that fired correctly

| point | predicted | actual |
|---|---|---|
| baseline | 857 / 0 | 857 / 0 |
| T-002-D, authority alone | 855 / 2, authority suite only | **exact** |
| T-003-B, three-red observation | 856 / 3, split across both suites | **exact** |
| T-003-E, crossover, first run | 855 / 4 | **854 / 5, tripwire fired** |
| T-003-E, crossover, reconciled | 855 / 4 | **exact** |
| T-003-M | 869 / 0 | **exact** |
| T-004-E and T-006-E | 873 / 0 | **exact** |

### The tripwire, and why it is the release's best evidence

The crossover run came back one failure above prediction, and the extra one was `tests/installer/templates.test.js > ships the front door as one byte-identical mirrored pair`. **The port is not one file.** BUG-037 shipped it as a mirrored pair with a byte-identity parity test so the deployed copy could never drift, and this plan then reasoned about "the port" as a single file. **The parity test did its job; the file list did not.**

Classification, agreed at the halt: a **plan defect, incomplete file enumeration**, caught by a pre-existing guard at its designed boundary. Not a test touched, not a deviation absorbed. The response was to halt rather than patch forward, correct both documents under the two-documents-one-truth rule, repair the mirror, and re-run. The reconciled run was exact.

**CONVENTION: any plan whose File Structure names a file that ships as a mirrored pair names BOTH members, and the sweep for mirrors is part of writing the table.** The parity suites are the authoritative list of what is paired: `unnest` in `tests/installer/commands-parity.test.js` for the command files, byte-identity in `tests/installer/templates.test.js` for the hooks. Three plans this fortnight touched mirrors; this is the first whose file list forgot.

### The authorized bypass, fired once

`.git/hooks/pre-commit` runs `npm test` and blocks on failure. The corpus is shared, so green requires both subjects to agree with every row, which leaves exactly two green states and puts AC1's isolated authority commit between them. **Isolation and greenness could not both hold, and isolation won.** One `git commit --no-verify` at `544cd4f`, with the suite run manually first and its verbatim failure list in the commit body, so git archaeology finds the declared red where it happened. The hook was never weakened, edited or disabled: **the exception belonged to the commit, not to the hook.** Green returned at the next commit.

### Three premise corrections, all from measurement rather than memory

- **OBF has six specimens, not zero.** The audit recorded zero because none had been captured, not because none existed.
- **The P5 backtick specimen was never lost.** It sat in the session transcript verbatim the whole time.
- **The `until` poller is a genuine loop correctly denied**, so it became a CONTROL row rather than a KNOWN-FP row. A specimen's class is decided by replaying it, not by remembering how it felt.

### Two spec-truth commits, both under the standing rule

**The plan does not get to outvote the spec silently, even when the plan is right.** AC10 asked for a test asserting the walk takes exactly two loop iterations; the plan proved that unobservable (nothing exported, `main()` at load, and no second iteration can find a glob the first `g3Scan` pass missed) and substituted four tests that pin the property where it can be seen. The spec was reworded before Task 1 rather than reinterpreted during it. The same rule produced the second commit when the mirror was found missing from System Impact.

### Method worth keeping

- **Measure a guard fix by copying the artifact to scratch and scoring it; never patch the repository before approval.** Both hooks were copied and run against every recovered denial and all 118 corpus rows, so the spec argued from numbers while the tree stayed clean.
- **Source corpus commands from the transcript, never retype them.** Five of the six new rows carry nested quotes, backslashes or newlines. `JSON.stringify` did the escaping and each row was replayed through the pre-fix hook recovered from `544cd4f` before the suite was trusted.
- **A row should pin a property, not a verdict.** The P4 row was chosen over two shorter candidates because its unquoted globs sit BEFORE the reader and none after, so it fails if anyone ever "fixes" P4 by scanning the whole command.
- **The id ceiling counts reservations.** After the plan file was committed naming BUG-043 and BUG-044, the ceiling read 44 and reported 045 as next. That is the tool working: a reservation that raises the ceiling cannot be double-minted.
- **The bash offset form was chosen for its failure mode.** `${rest%%"${BASH_REMATCH[0]}"*}` yields an empty after-text when the needle is absent and the existing break ends the loop, where the `#*` strip form would spin forever and need a new guard. **A guard's inner loop must not be able to hang the guard.**

## Closeout: 1.31.2 and the squash-vs-rebase lesson [2026-09-28]

`1.31.2` merged as `d6e6316` (PR #35, squash). Verified on the merged `main`: the spec-approval anchor appears exactly once, the implementation record once, and all five version locations read `1.31.2`. Suite on the synced `main`: 873 passed, 12 skipped, 0 failed.

### The rebase precedent has a scope, and a squash is outside it

**`git rebase`'s already-upstream detection matches on patch-id, so it only holds for merge commits and rebase merges. A SQUASH merge destroys the patch-ids**: nine commits become one patch that matches none of them. Any record commit made on `main` **before** branching will therefore not be dropped automatically on sync. It will be re-applied, and it conflicts as a **duplicate append**, because the block is already upstream with later sections appended after it. That is what `c016199` did here, where `61b250d` was dropped cleanly under a merge at 1.31.0.

**The sanctioned answer is `git rebase --skip`, and only with upstream-superset evidence gathered first:** the anchor counted exactly once on `origin/main`, and `git diff --numstat main origin/main -- <file>` showing insertions with **zero deletions**, which proves the upstream file is a strict superset sharing the same prefix. With that evidence, `--skip` is not conflict resolution: nothing is merged, no hunk is chosen, no file is edited. It is git declining to re-apply a patch whose content is already present.

**The preventive form, which is better than the cure: a release's record commits land on the branch or after the merge, never on pre-branch `main`.** 1.31.1's flow already did this correctly. This incident is what happens when the older pattern meets a squash merge.

**Second squash nuance, found at cleanup:** `git branch -d` succeeded but warned that the branch was merged to its **remote-tracking ref**, not to `HEAD`. Under a squash the branch tip is never an ancestor of `main`, so the "tip reachable from main" premise does not hold literally; `-d` passes on the upstream-merged check instead. No `-f` was needed or used.

### Escalation discipline, confirmed twice in one closeout

The sync was brought to the owner although the content was demonstrably upstream and nothing was at risk, because **history operations on `main` are owner-scoped regardless of risk**. The reservation exists so that "nothing is at risk" never becomes the thin end of unreviewed rewrites. When the rebase then behaved differently from its precedent, the standing instruction was to stop rather than resolve, and it was followed: `--abort` first, diagnosis second, authorization third. `git reset --hard` and `git branch -f` stayed unused for a stated reason: same result, **less evidence in the reflog**, and this repository's history discipline prefers the path that shows its work.

## Spec: BUG-043 quoted-argv blindness [2026-09-28]

**Spec file:** `docs/superpowers/specs/2026-09-28-bug043-quoted-argv-blindness-design.md` (15 ACs, approved 2026-09-28 with one addition). **Audit:** `scratchpad/bug043-audit-and-gates.md`.

### Gate 1, ruled: patch both subjects in parallel, and the filing's price was wrong

`[BUG-043]`'s entry priced this as needing "a second five-state scanner written in bash." **Reading `_g3_scan` at `guard3-reference.sh:82-158` disproves it.** That scanner exists, tracks all five states, and already takes a `mode` parameter. The fix is a third mode plus a dispatch-level argument swap, the identical seam in both subjects: one variable, one dispatch, thirteen consumers. The correction lands in the spec's problem statement AND as an amendment note on the backlog entry, with the original wording left visible, the same discipline BUG-038's who-writes correction used.

**Binding ordering decision:** the mask applies BEFORE the newline-to-semicolon join, so a quoted newline never becomes a command anchor.

### Gate 2, ruled: candidate A, the by-design boundary

Mask the input to every check except **P6 and P12**, which read quoted content by design (a grep pattern and an alias value are the data those checks exist to inspect). Measured against 124 corpus rows and 26 still-denied commands:

| candidate | masks | denials flipped | corpus rows moved | frontier moved |
|---|---|---|---|---|
| **A, by-design** | all but P6, P12 | **22 of 26** | 4 | **0** |
| B, specimen list | P5, P9, OBF, P11 | 19 of 26 | 4 | 0 |

**The deciding argument is stability, not the count: A's boundary falls out of what the checks are FOR, while B's falls out of a specimen list that grows every session.** P11 is the proof. It was not in B's list until this audit found it.

The three denials A fixes that B does not are exactly the **P4/P7 fragment quote-parity** cases, including the residual BUG-041 named and deferred. **The scope fence's test returned yes: the residual shares the seam, so it is in scope at zero marginal cost.** That is the fence working, not scope growth.

### Premise corrections to BUG-041's spec, recorded here and NOT back-edited

- **P11 is a fourth accidental consumer**, unnamed there. Its specimen is **English sentence punctuation**: `did not. Apply the identical` inside a quoted JS string puts a period-and-space where `G3_POS` reads command position, and P11 sees the bash dot operator.
- **P9 has three sub-shapes, not one**: quoted prose, quoted code, and a **quoted regex** (`"...|for pat|..."`). The third denied this audit while it was mapping the file the fix will edit.

That spec stands as the knowledge of its day. **Records show their history; corrections land above them, never inside them.**

### Two ACs that changed by being written

- **AC7 could not be written as approved.** The ruling asked for a structural assertion that the masked copy carries no `;` anchor inside a quoted span. The masked copy is not observable from outside the hook, and worse, **mask-before-join and mask-after-join are observationally equivalent**: a quoted newline becomes `x` either way. AC7 therefore pins the property two ways, a textual contract assertion per subject plus a behavioral pair already in the corpus, and states the equivalence plainly rather than pretending to observe an order. **The AC10 lesson from BUG-041, applied before the mistake instead of after it.**
- **AC2 found a live hole while being drafted.** P6's frontier is already guarded, because its rows use quoted patterns that a mistaken mask would break. **P12's is not:** `alias c=cat` and `alias g=grep` are unquoted values a mask would leave untouched, so nothing in the corpus discriminates P12's classification. `alias t='tail -50'` closes it.

### The headline this release ships

After 1.31.3 the 52 unique commands Guard 3 denied across this session reduce to **four denials**: one heredoc case (out of scope), one genuine `find` without `-maxdepth 1`, and the two pinned controls. **Three of the four are the guard working.**

## Implementation: BUG-043 [2026-09-28]

Shipped as `1.31.3`. Plan: `docs/superpowers/plans/2026-09-28-bug043-quoted-argv-blindness.md`, 6 tasks, 57 checkbox steps, six commits on `fix/bug-043-quoted-argv-blindness`.

### Boundaries: six predicted with suites named, six hit exactly

| point | predicted | actual |
|---|---|---|
| baseline | 873 / 0 | exact |
| T-002, rows added | 893 / 0 | exact |
| T-003, authority alone | 884 / 9, `guard3.test.js` only | **exact, and the nine were the right nine** |
| T-004-D, port and mirror | 875 / 18, nine per suite | **exact** |
| T-004-H, rows flipped | 893 / 0 | exact |
| T-005, contract tests | 897 / 0 | exact |

No tripwire fired. The table itself was superseded once **before** execution, from 873-to-889 to 873-to-897, because the AC set grew after the numbers were stated; that was declared in the plan's Risk 7 as a correction with its cause rather than discovered as a drift.

### Two conventions this item earned

- **An AC that asserts a property of an internal value must name its observation point at spec time, or be written as contract-plus-discriminator from the start.** Third occurrence of one lesson: BUG-041's AC10 found it at plan time, BUG-043's AC7 applied it preemptively, and AC8 needed it again anyway. Naming it here is what makes the fourth occurrence a spec-review catch instead of a pre-flight one.
- **A discriminator is confirmed by BUILDING the defect it claims to catch** and scoring it against the full corpus. A discriminator that was never seen to fail is an assumption wearing a test's name. This act produced all three of this spec's honesty rulings in one sitting: AC9's guard was **confirmed** (a quote-replacing mask changes exactly one row, `c'a't`), AC8's was **proven absent** (a length-breaking mask changes nothing at all, because the masked string is never compared offset-wise with the unmasked one), and AC2-B's turned out to be **a fiction** (an allowlisted path inside quotes never matched, before or after, because `G3_BD` excludes quote characters).

### What the premise gates caught, before anything shipped

- **T-001-A found a defect in the plan, not the file.** The plan said five `case` arms and eleven emit guards; the file has four and thirteen. Numbers asserted from reading rather than counting, the same class as BUG-041's mirror omission. Corrected in place with a note.
- **T-001-F caught a broken transform before the frozen file was touched.** The first version widened the replaced arms' strip guards as well, which would have made mask mode emit the real character **and** the mask character, doubling the output and masking nothing. The probe runs the transform on a full copy and scores nine cases including `c'a't`; three of the nine were wrong, and the frozen file never saw it. **The transform that was proved is the same function that shipped**, which is why the probe's verdict transfers.

### Method notes worth keeping

- **A row's label is its identity and does not move when its verdict does.** Rows still labelled "pending [BUG-043]" now assert `allow`; the comment block explains, exactly as P7-1 and P7-2 kept their labels under BUG-041.
- **Two quoting styles coexist in the corpus** because hand-written rows use single quotes and script-inserted rows use the JSON form. The flip script learned to accept both after aborting on the first, and it writes only after every flip in a group succeeds, so a partial failure leaves the file untouched.
- **A denied Bash call runs none of its chained steps.** A flip chained after a command the guard denied left the plan file briefly less accurate than reality; the next flip refused because it asserts its precondition. Assert-before-mutate is what made that recoverable rather than invisible.

### The headline, measured against the live population

**63 denial events, 56 unique commands, five still denied.** One heredoc body scanned as command text (out of scope, unfiled), one genuine `find` without `-maxdepth 1`, and **three genuine shell loops**, two of them the pinned controls and the third generated by this implementation's own work. **Four of the five are the guard working.** The spec predicted four residuals out of 52; the population grew during execution and the extra residual is another instance of the control class, which is the prediction holding rather than failing.

## Closeout: 1.31.3, the retired instrument, and the real stranding condition [2026-09-28]

`1.31.3` merged as `bb5a439` (PR #36, squash). Verified on the merged `main`: all five version locations read `1.31.3`, every record anchor appears exactly once, and the suite is green at 897 passed, 12 skipped.

### The stranding condition, corrected

The 1.31.2 rule said a release's record commits land on the branch or after the merge. **That rule named the wrong variable.** Spec-approval and spec-truth commits are made before the branch exists and cannot follow it, yet they stranded anyway.

**The hazard is not WHERE a record commit lands. It is that it sits UNPUSHED when the squash arrives.** All three of today's strays (`fd4a65f`, `b41626c`, `8d20791`) and 1.31.2's `c016199` share exactly that anatomy. **Owner-scoped record commits on `main` are pushed in the same action that creates them.** A commit made on `main` before the branch exists is fine precisely because it gets pushed immediately; the branch-or-after-merge rule covers everything else.

### The instrument, and the one retired

**Superset evidence for a squash sync is per-file line containment plus anchor counts.** For each file a stranded commit touched: every non-blank line present locally must also be present upstream, and each record's anchor must count exactly one.

**The whole-tree `git diff --numstat` form is RETIRED, with its failure mode recorded.** It worked in 1.31.2 only by accident of geometry: the single stranded commit touched one file additively, so "insertions with zero deletions" was meaningful. In 1.31.3 local `main` was missing the entire release, so the same test reported 71 deletions and read as "not a superset" when the truth was the opposite. **A test that only works when the diff happens to be one-sided is not a test of containment.**

That first evidence script failed twice and **both failures were defects in the instrument**, not in the merge: one needle searched the spec for a phrase that lives in a test comment, and the numstat could not answer the question asked of it. The response that matters: the instrument was replaced with one that answers the actual question, rather than massaged until it agreed.

### The three-skip prediction was off by one, benignly

The rebase was authorized to `--skip` exactly three pre-enumerated commits. **It needed two.** `fd4a65f` did not conflict: its content was already present, so its re-application was empty and git dropped it without a prompt. The end state is exact (ahead 0, behind 0, clean tree, three anchors at one each), and the script reported the difference as a warning rather than absorbing it. **Enumerating the list before the rebase is what made a skip authorized rather than reflexive**, and it also means an unexpected fourth conflict would have aborted.

### Branch deletion, second confirmation of the squash nuance

`git branch -d` again warned that the branch was merged to its **remote-tracking ref** rather than to `HEAD`, and again passed on that check. Under a squash the branch tip is never an ancestor of `main`. No force was needed, twice.

## Spec: BUG-044 deny-message phantom allowlist [2026-09-28]

Spec: `docs/superpowers/specs/2026-09-28-bug044-deny-message-phantom-allowlist-design.md`, 21 ACs, approved as written after four gates were ruled before drafting. Targeting **1.32.0**. Baseline `main` at `b245636`, 897 passed / 12 skipped.

Guard 3's deny message tells every reader to add an entry to `.claude/memory/bash-scan-allowlist.txt`, a file that exists in no installation. The audit's own first command was denied by that message, the fourth time the mechanism has tolled on the work auditing it.

### Two findings the filing did not carry

- **The remedy is inert on two of the three denials it prints on.** `g3AllowlistCovers` runs at `pre-tool-use.mjs:469`; the length denial returns at `:448` and the malformed denial at `:452`, both before it. On those two the sentence promises a remedy that cannot apply. Provable by reading control flow, independent of any telemetry.
- **The message is port-only, so no fifth authority exception is needed.** `guard3-reference.sh:440/456/497` prints `BASH SCAN BLOCKED` plus a one-line detail and says nothing about an allowlist. The corpus arbitrates verdicts, never message text. `tests/fixtures/guard3-reference.sh` is untouched by this item and the sanctioned exception count stays at four.

### The measure was wrong, and the correction is the deliverable

The filing set the success measure as uptake moving off zero. **That is a premise error.** The reader at the moment of friction is the agent, and `CLAUDE.md` instructs it never to bypass the hook; adding an allowlist entry to clear one's own denial is that bypass. The operator who may legitimately set policy is not reading a 490-character reason string mid-tool-call.

**Uptake remaining at zero is the design working: the agent adapts or reports, the operator legislates.** The measure is truthfulness instead: every sentence the denial prints is actionable by someone, and no sentence promises a remedy inapplicable to the denial it accompanies. The spec states this so a future maintainer cannot re-file the zero as a defect without first answering the argument.

### Why shipping the filename is safe now and was not before

BUG-037 rested the allowlist's safety on the template never shipping that filename, because `deployProject` copied the template wholesale. **BUG-039 replaced that mechanism**: `deploy.mjs:169` filters the copy through `hostOwnedFilter`, which excludes every table path regardless of policy, and `seedHostOwned` at `:183` writes only when the target is absent. The proof is already green: `tests/installer/deploy.test.js:347` ships a template allowlist, writes a host one, re-runs, and asserts the host file byte-identical.

`templates.test.js:143` and `:172` contradict each other the instant the policy flips to `seed`. `:143`'s own comment names its dead premise. It is **replaced, never deleted**, classified **ASSERTION-RETIREMENT** (the BUG-039 shape) in the commit body per AC14.

The seed's honest limit is stated rather than glossed: a comment-only file parses to zero entries and is behaviorally identical to no file. Its value is that the named path resolves and its header teaches the format. AC11 asserts the inertness by the loader's own rule.

### Scope fence

`G3_BD` (`:397`) and `G3_AD` (`:398`) contain no quote character, so entry `docs/` does not cover `cat "docs/x.md" *.md`; BUG-043 deliberately left `:469` reading the unmasked string. The finding stays in this spec, the fix mints **`[BUG-045]`** at implementation time with its full ritual named. The filing's "beside the measurement" wording is read as placement of the finding, not of the fix, and that reading is recorded so it is not re-litigated.

### Conventions

- **PATCH repairs, MINOR changes what ships, and the test is observability on a fresh install.** A release that adds a file to the shipped inventory or changes a documented installer contract is observable new behavior on every install and takes a minor bump; one that repairs behavior without changing what ships is a patch. `1.31.1`, `1.31.2` and `1.31.3` were patches by this rule; BUG-044 is `1.32.0` because it ships a template file and restates `README.md:189`. Cite this line instead of re-arguing the version.
- **A measure that can only move by doing the thing the project forbids is not a measure.** Zero allowlist uptake was filed as a discoverability defect; the party in the friction loop is instructed never to bypass the hook, so moving the number would mean agents began self-serving exceptions. When a metric's improvement is prohibited behavior, correct the metric, not the number.
- **A premise correction to a landed filing is noted in the new spec, never edited into the entry.** BUG-044's line references (`:433`, `:427-435`) went stale when BUG-043 shifted them to `:432-440` and `:438`. The entry receives an amendment note above its original text; the original wording stays intact.

## Custody note: the layer probe and the override that did not happen [2026-09-28]

**2026-09-28.** A chained commit-push-verify command was denied under P5 for its command substitutions. It was **not** retried: it was decomposed into three simpler calls, the first of which (`git add -u` plus `git commit -F`) matched no pattern and landed as `d92b625`. A four-case probe the same day confirmed Guard 3 denials are terminal under this session's auto mode, on byte-identical retry and on trivial variation, with no execution in any case. **No override occurred, and the guard's terminality is measured rather than assumed.** An owner-side terminal annotation ("Allowed by auto mode classifier") prompted the probe; it is not present in the agent's tool results and per the two-gates reading it annotated a hook-allowed call.

### The probe, for reuse

Four runs against a harmless P4 target in scratch: a reader plus an unquoted glob, redirecting into a file whose existence is the observable for whether the command ran.

| case | verdict | ids | target after |
|---|---|---|---|
| a, first run | deny | P4 | absent |
| b, byte-identical retry | deny | P4 | absent |
| b2, third identical run | deny | P4 | absent |
| c, trivially changed target | deny | P4 | absent |

The reading half is what makes it evidence rather than an impression: if any denied run had executed, its redirect target would exist. None did. **"Hook skipped on retry" and "hook denied and overridden" are different defects with different owners, and the probe excludes both.**

### Conventions

- **An observation visible only in one party's view is attributed as such and is never load-bearing until both can see its anchor.** The owner's terminal and the agent's context are different windows. A mechanism story built across them without anchoring is how a false override nearly entered the permanent record: the annotation was real in one window, absent in the other, and the inference drawn from it was wrong. The probe-first rule caught it; this convention makes the catch cheaper next time. State which window an observation came from before reasoning from it.
- **The two-gates reading of a tool call.** The auto-mode classifier decides whether the owner is prompted; the `PreToolUse` hook decides whether the command runs. They answer different questions and both run. A call can be classifier-approved and hook-denied, which is the ordinary case for every Guard 3 denial, so a classifier annotation is never evidence about a guard verdict.

## Implementation: BUG-044 [2026-09-28]

Shipped as **1.32.0** on `fix/bug-044-deny-message-phantom-allowlist` in 6 commits (`9ff16c7` plan, `8a50023` the conditional remedy, `d7f19a5` the seed and the retirement, `b8f8901` the records and the BUG-045 filing, `d1ad9e0` release, closeout last). Suite **897 to 902 passed / 12 skipped**, 33 files throughout. Plan: `docs/superpowers/plans/2026-09-28-bug044-deny-message-phantom-allowlist.md`, 6 tasks, 49 checkbox steps.

**Every boundary hit its predicted count exactly, with suites named: 897, 900, 902, 902, 902, 902.** The only tripwire fired in an instrument, not in the code path.

### The two defects, and which one needed no telemetry

The message named a file that existed in no installation. It was also **inert on two of the three denials it printed on**: `g3AllowlistCovers` runs at `:469`, while the length denial returns at `:448` and the malformed at `:452`, both before it. The second defect is provable by reading control flow, which is why it carried the item when the first defect was contested.

**The message turned out to be port-only.** `guard3-reference.sh` prints `BASH SCAN BLOCKED` plus a one-line detail and names no allowlist, so the corpus arbitrates verdicts and never message text. That discovery spared a fifth sanctioned exception and kept the frozen authority at **zero diff against `main`**, verified at closeout rather than assumed.

### The collision, and why the step order was the only correct one

`templates.test.js` asserted the allowlist template must not exist; another case asserted every `seed` row must have a source. They are mutually unsatisfiable the instant the policy flips. **Retire first, flip second, ship third** was chosen because the reverse orders all pass through that impossible state. Both intermediate reds were predicted by name and hit exactly: 2 failures after the retirement with the skip-coverage and seed-source cases still passing, 3 after the flip when the seed-source case joins, then all three clearing together.

Classification of the test touch: **ASSERTION-RETIREMENT**, the BUG-039 shape, named in `d7f19a5` body. The retired assertion stated its own dead premise, that `deployProject` copies the template wholesale, which BUG-039 replaced with a filtered copy.

### A coverage gap found by pre-flight, not by a failure

`host-owned.test.js` asserts the exact seeded list and looked like collateral damage. It does not break, because its fixture never writes the template into its source tree and `seedHostOwned` skips absent sources. **The consequence is that suite gives zero coverage that the allowlist seeds**, which promoted the new `deploy.test.js` case from decorative to load-bearing. Knowing which test carries the load is half of trusting green.

### Conventions

- **An id ceiling counted by scanning for id-shaped tokens is retired. Count filed backlog HEADINGS instead.** The max-scan read forward references in prose as filings, including the plan file line that stated the ceiling the check expected to read after minting. **The instrument was reading its own predicted output back as evidence.** The heading-scoped form reported 43 headings before the filing and 44 after, ceiling 44 to 45, with no duplicate ids: the minting verified in both directions. This is the second retired instrument in two releases and the same failure class as the `numstat` superset check: a measurement that cannot distinguish its subject from a description of its subject.
- **A release-critical instrument does not live in the scratchpad.** Three were lost mid-release when the directory was withdrawn: the id ceiling, the version gate and the commit-message files. Each was rebuilt inline and each rebuild is a new instrument whose agreement with the old one is unproven. The version gate is the clearest case: the old one reported FAIL on five locations that agreed, so it was comparing against a target it had not been given, and the rebuilt form takes `VERSION` as the authority. Better, but different, and the difference is recorded rather than smoothed over.
- **State observability in the form that is true.** The seed is not observable in this repository, because no deploy runs here and `.claude/memory/` still holds no allowlist at closeout. The message change **is** observable here, and proved itself: a probe command was denied as malformed and carried no allowlist sentence. Separating the two claims is what keeps the release record trustworthy.

## Closeout: 1.32.0 and the first clean squash sync [2026-09-28]

`1.32.0` merged as `28142af` (PR #37, squash). Verified on the merged `main`: all five version locations read `1.32.0`, **eight record anchors each appear exactly once**, the suite is green at **902 passed / 12 skipped**, the hook mirrors are byte-identical, and the shipped template is present.

### The stranding rule worked, and this is the evidence

The rule from `1.31.3` said the hazard is not WHERE a record commit lands but that it sits **unpushed when the squash arrives**, so owner-scoped record commits on `main` are pushed in the same action that creates them, and everything else goes on the branch.

**This release put every record commit on the branch, including both filings, and the sync measured 0 ahead / 1 behind.** A pure fast-forward. No rebase, no `--skip`, no enumerated commit list, no superset evidence required, because nothing stranded. That is the first clean squash sync since the rule was written, and it is the rule being confirmed rather than merely followed.

The one deliberate reorder was filing `[BUG-046]` on the branch before pushing rather than on `main` after the PR opened. Filing it on `main` while an unmerged PR was open is the exact anatomy that stranded `c016199` and the three `1.31.3` strays.

**`git branch -d` again warned that the branch was merged to its remote-tracking ref rather than to `HEAD`, and passed on that check.** Under a squash the branch tip is never an ancestor of `main`. Third confirmation, no force needed any of the three times.

### Observability, restated after the merge

The two claims stay separate on the merged tree. `project-template/.claude/memory/bash-scan-allowlist.txt` is **present**; this repository own copy at `.claude/memory/bash-scan-allowlist.txt` is **absent**, because no deploy runs here. `deploy.test.js` proves the seed in both directions. The message change is observable here and demonstrated itself twice during the closeout: the T-005 probe that rendered the message table, and the first attempt at this very append, were both denied as malformed, and both denials carried the alternatives with no allowlist sentence. The second was a genuinely malformed command, an apostrophe closing a single-quoted shell string, so it is the guard working rather than a false positive.

### Conventions

- **The scratchpad is not a release dependency, and this release proved it four times.** Three instruments (`id-ceiling.mjs`, `version-gate.mjs`, the commit-message files) were lost mid-release when the directory was withdrawn, and the PR body then had to be staged through gitignored `.conductor/`. Each rebuild is a new instrument whose agreement with its predecessor is unproven. Filed as `[BUG-046]` with the demarcation line: **an instrument a tripwire or gate depends on is infrastructure; single-use probes and session evidence stay in the scratchpad.**
- **A clean sync is a measurement, not an absence.** Reporting `0 ahead / 1 behind` before fast-forwarding is what distinguishes "nothing stranded" from "nothing checked". The rebase-and-skip ritual is for when that measurement says otherwise, and skipping the measurement because the last release needed the ritual would be as wrong as skipping the ritual because this one did not.

### Queue

`[BUG-042]` (the `.gitignore` restructure) is next, then `[BUG-046]`, unless a release needs the instruments sooner, in which case building them is that release first task. `[BUG-045]` (the quoted-path defect) remains open with its ritual priced at filing. Two dossiers stay unfiled: the heredoc family, half-characterized, and the session denial tally. **Next mintable id is `BUG-047`.**

## Spec: BUG-042 gitignore restructure [2026-09-28]

Spec: `docs/superpowers/specs/2026-09-28-bug042-gitignore-restructure-design.md`, 19 ACs, approved after five gate rulings that preceded the writing. Target `1.32.1`, PATCH, ratified.

### What the audit measured before the spec existed

- **The defect reproduces at two sites, not one.** `.gitignore:7` (`.claude/`, 12 tracked) and `:8` (`docs/`, 44 tracked) both make `git add` on a tracked file exit 1 while staging it. The `docs/` specimen is this fortnight's own BUG-044 spec file.
- **`*.local` at `:4` does not cover `settings.local.json`.** Probed: `a.local` matches `:4`, `zz/s.local.json` matches nothing. That host-owned file is held ignored by `:7` alone, so a restructure dropping `:7` without naming it exposes a host settings file. The filing's premise did not contain this; measurement did.
- **`:10` (`!project-template/*`) is load-bearing and exists only to patch the other two rules.** `.claude/` and `docs/` carry no leading slash, so they match at any depth. Measured both ways: with `:10` present `project-template/.claude/` and `project-template/docs/` are trackable, without it both are ignored. **The allowlist template shipped in 1.32.0 is trackable today only because of line 10.** Root-anchoring retires it, proved by measurement rather than argument.
- **The filing's central premise was wrong, and the correction is what makes the item cheap.** It said the re-include form requires enumerating the host-owned paths and that `PROJECT_HOST_OWNED` already is that enumeration. The deny-by-default leaf form names **zero** host-owned paths and leaks zero, because `memory/*` re-excludes everything not re-included. The enumeration needed is the tracked list, which is the git index.

### The corpus, two runs, one case set

`.claude/` (12 tracked, 46 untracked): baseline A=rc 1 staged, B=rc 1 unstaged, D=0 visible, F=rc 1. **Leaf**: A=rc 0 staged, B=rc 1 unstaged, C=0 leaks, D=0 of 46, E=rc 0, F=rc 0. **Dir form**: B=rc 0 and STAGES, D=6 of 46 exposed.

Both sites (`docs/` 44 tracked, 20 untracked): **both-leaf** A=rc 0, B=rc 1 unstaged, C=0 (project-template trackable with `:10` removed), D=0 visible. **claude-leaf + docs-dir**: B=rc 0 and STAGES, D=19 visible including 16 historical specs and plans.

Case B is the item's whole point: an unlisted new file exiting 0 and staging is the dishonesty **inverted**, not removed.

### The five rulings

1. **Gate 1, derive or assert: (a), hand-written with exact-equality against `git ls-files`.** The index is the only enumeration that cannot drift from what is tracked, because it is what tracked means. `PROJECT_HOST_OWNED` gets a better relationship than the duplication the filing predicted: a per-row **ignored XOR tracked** invariant, holding today at 2 tracked and 7 ignored, catching the future seed row that accidentally becomes trackable, a defect class nothing currently watches. Both tests carry a deliberate-defect confirmation per the discriminator rule: a leaf removed must fail the first, a row flipped must fail the second.
2. **Gate 2, leaf not dir**, on case B and case D. The toll (one `!` line per newly tracked asset) is accepted, documented in the block's comment header with `git add -f` as the interim, and is **self-enforcing**: AC9 fails when the line is missing, so the toll can be forgotten only by failing a test. Tax converted to checklist.
3. **Gate 3, fold `docs/` in**, on a structural argument: `:10` patches `:8` as much as `:7`, so shipping `.claude/` alone ships a form that still needs the blanket re-include, which is half a fix that keeps the patch it exists to retire.
4. **Gate 4, partial retirement of the BUG-040 convention, with the measurement quoted.** A rule that outlives its justification is the defect class this chain has hunted in messages, instruments and tests, and CLAUDE.md prose gets no exemption. Clause 1's justification is rewritten naming what retired it (case A, rc 1 to rc 0); clauses 2 and 3 are kept with their remaining live cases named. The anchoring note lands beside it as two sentences that do not erase each other: struck shape (d)(1) stays struck for exit-code reporting, and anchoring is load-bearing for path matching.
5. **Gate 5, keep the `session-snapshot.json` line** with the external writer named verbatim in its comment. A line whose reason is documented is convention; a line that keeps reappearing without one is a haunting. The coupling itself routes to `[BUG-046]` as a sibling concern: an external writer to a repo file is the same "infrastructure the repo depends on but does not control" family as the release-critical instruments.

### Conventions this spec ratified

- **The version rule's worked example.** PATCH 1.32.1: counter named honestly (developer-facing behavior changes materially, which is why it is a release at all), the ratified test applied (observability on a fresh install; `project-template/gitignore` untouched, byte-identical output), verdict follows the test. Designated the citation for close calls.
- **Evidence-first applies to friction.** The glob alternative `!/docs/superpowers/specs/*.md` is recorded as a named future option with its measured cost (19 visible, 16 historical, case-B semantics inverted for that subtree) and an explicit trigger: two lines per item is a **predicted** annoyance, so the option is revisited when specimens of real friction exist, not before.
- **`.DS_Store` belongs in the developer's global gitignore**, not in any repository decision. Ruled out of scope rather than absorbed.

## Implementation: BUG-042 gitignore restructure, 1.32.1 [2026-09-28]

Branch `fix/bug-042-gitignore-restructure`, six commits, 7 tasks, 31 checkbox steps. Every predicted boundary hit exactly.

### Boundaries, with suites named

| After | Tests | Files |
| --- | --- | --- |
| baseline `eaaa077` | 902 passed / 12 skipped | 33 passed / 1 skipped |
| T-000-C plan commit | 902 / 12 | 33 / 1 |
| **T-001-B, the single predicted red** | **902 passed, 4 failed** | **33 passed, 1 failed** |
| T-001-G after the block | 906 / 12 | 34 / 1 |
| T-002-D after the XOR test | 910 / 12 | 35 / 1 |
| T-003-D, T-004-C | 910 / 12 | 35 / 1 |

The red was `tests/unit/gitignore-block-parity.test.js`, all four cases, one cause: `block markers missing or inverted: begin=-1 end=-1`. Predicted by suite and by cause before it ran.

### The eight acceptance behaviors, measured by hand at T-001-F

- **AC1** tracked file under `.claude/`, `git add <path>`: **rc 0**, staged. `-u` likewise rc 0 (**AC13**).
- **AC2** tracked file under `docs/`: **rc 0**, staged.
- **AC3** unlisted new file under `.claude/`: **rc 1**, staged nothing.
- **AC4** unlisted new file under `docs/`: **rc 1**, staged nothing.
- **AC5/AC6** `settings.local.json` now names `.gitignore:30 /.claude/*`; `personal.md` and `bash-scan-allowlist.txt` name `.gitignore:36 /.claude/memory/*`. Every host-owned path is held by an in-block rule, never by an ancestor directory exclude.
- **AC7** `project-template/.claude/...` and `project-template/docs/...` both probe **rc 1 from `check-ignore`**, meaning trackable, with `!project-template/*` removed.
- **AC8** `git ls-files --others --exclude-standard .claude docs` returns **empty**. The 46 untracked `.claude/` files and the 16 historical untracked specs and plans all stayed invisible; the restructure exposed nothing.

### Decisions and their reasons

- **The self-reference, found by pre-flight rather than by failure.** The plan file lives under `docs/superpowers/plans/`, inside a surface the block enumerates, so the block had to be generated from an index that already contained it. Task 0 commits the plan, T-001-C generates afterwards. Plan-commit-then-generate is not one ordering among several: it is the only one that never passes through a state where the item's own artifacts violate the item's own rule. `[BUG-044]`'s collision in milder form.
- **A number that is stale before implementation starts is not a spec value.** The spec originally wrote "44 in total" for the `docs/` leaves. It was 44 at audit, 45 once the spec was committed, 46 once the plan was. Corrected in place to "whatever `git ls-files` reports at generation time", which is also why the test computes the block rather than hard-coding it.
- **Task 2 had no red, and said so.** The XOR invariant holds on both sides of the restructure, so all four cases passed first run. The instrument was proved anyway by flipping the comparison operator from `===` to `!==`, which turned exactly three cases red: *holds for every row*, *reports a row that is both tracked and ignored*, *reports a row that is neither*. The fourth, which names the two tracked rows, correctly stayed green because it does not call the checker. **The mature form of the predicted-red discipline is to predict green when green is true and prove the instrument anyway.**

### Conventions this release produced

- **A line kept for an external writer is kept with the writer's name and path in its comment.** Two specimens: the user-global `/cc-compact` for `session-snapshot.json`, and `lib/installer/deploy.mjs:17` for `turn-count.txt`. Two hauntings prevented by documentation beat two mystery re-appends investigated later. Both routed to `[BUG-046]` as the external-writers sibling concern.
- **Scope the pin, not the file.** The block-equality test compares only the lines between its markers. That one decision is why a generated-and-asserted block can coexist permanently with an installer that appends to the same file.
- **Evidence-first applies to friction.** The `docs/` toll is two `!` lines per item and is **self-enforcing**, since a spec committed without its line fails the parity test: a tax converted into a checklist. The glob alternative `!/docs/superpowers/specs/*.md` is recorded with its measured cost (19 files visible, 16 of them historical, case-B semantics inverted for that subtree) and an explicit trigger: it is revisited when specimens of real friction exist, not on the prediction of annoyance.
- **The version rule's worked example.** PATCH `1.32.1`: the counter named honestly (developer-facing behavior changes materially, which is why it is a release at all), the ratified test applied (observability on a fresh install; `project-template/gitignore` untouched, byte-identical output), verdict follows the test. Cite this one when a version call is close.

### The epitaph

Task 0 staged the spec and the plan with `git add -f`. **That was the last time `-f` was needed in this repository for a file that was already tracked.** From `638dcc3` onward a tracked file under either surface stages with plain `git add` or `git add -u` at rc 0. The claim is bounded on purpose: `-f` is still correct and still required for a genuinely new file under a genuinely ignored directory, `.conductor/` being the remaining one, so the sentence cannot later be quoted as more than it is.

### Queue after 1.32.1

`[BUG-046]` (release-critical instruments as tracked scripts under `scripts/`, now also carrying the external-writers sibling concern) is next, unless a release needs the instruments sooner, in which case building them is that release first task. `[BUG-045]` (the quoted-path allowlist defect) remains open with its ritual priced at filing. **The heredoc-family dossier now meets its own minting condition** (three specimens plus a traced mechanism plus a severity upgrade) and its filing decision is owed at this closeout. The session denial tally stays unfiled. **Next mintable id is `BUG-047`.**

## Closeout: 1.32.1 shipped, BUG-047 minted [2026-09-28]

PR #38 merged as `75532b4`. Second consecutive clean squash sync.

### The sync, measured rather than assumed

`0 ahead / 1 behind` before the fast-forward, so nothing was stranded and the measurement is what says so. Every record commit for this item, including the closeout of `[BUG-042]` and the `[BUG-046]` sibling-concern bullet, went on the branch. `git branch -d` passed on the upstream-merged check and printed its usual squash note about the ref not being reachable from `HEAD`, which is the expected shape and not a warning about anything. The remote branch was already gone, deleted by GitHub on merge, measured with `ls-remote` rather than presumed; the prune that followed cleared a stale `origin/fix/bug-044-...` left from the previous release.

### Verified on `main` after the merge

- Suite **910 passed / 12 skipped**, 35 files passed / 1 skipped.
- Five version anchors all read `1.32.1`: `VERSION`, `package.json`, `package-lock.json` twice, `CHANGELOG.md`.
- The block-parity test passes against the merged tree, which is the first time it has run against an index it did not help create.

### The epitaph, as written

**Task 0 staged the spec and the plan with `git add -f`. That was the last time `-f` was needed in this repository for a file that was already tracked.** From `638dcc3` onward a tracked file under either restructured surface stages with plain `git add` or `git add -u` at rc 0, and every subsequent commit in the item was made that way. The bounded clause is part of the sentence, not a footnote to it: `-f` remains correct and still required for a genuinely new file under a genuinely ignored directory, `.conductor/` being the remaining one, so the epitaph cannot later be quoted as more than it is.

### BUG-047 minted: the heredoc family

Minted at a verified ceiling, both legs heading-scoped, `BUG` standing at `046` with 28 headings on each leg. The dossier is kept **verbatim as the filing's problem statement** rather than rewritten, because it is the evidence that earned the id.

- **Third specimen, this item's own audit:** a `.mjs` script written with `cat > <path> <<'MJS'`, denied under **P4 P5 P9 at once**. First specimen showing the family **crosses pattern boundaries**: the body is scanned as command text by every check simultaneously, so a remedy aimed at P4 alone would leave two more firing on the same input.
- **The remedy is bound by measurement:** `tee` allows where `cat` denies, so the denial is reached through the reader-at-command-position path. Delimiter-aware skipping is sufficient for every specimen collected; a third lexical mode is not obviously required. Decision reserved for the spec, which must argue it rather than inherit it.
- **The spec's first audit item is the open authority question:** the probe measured the port, which does not distinguish `<<'EOF'` from `<<EOF`. Whether the frozen authority agrees is unmeasured, and since the two ship as a byte-identical mirrored pair driven by one corpus, a divergence there is a finding about the pair.
- **Queue position: after `[BUG-046]` by default.** Instruments are infrastructure the next release needs; this friction is real but characterized and routable-around with the Write tool. A fourth specimen, or friction that stops being routable, reorders it.

**What the entry is beyond its defect:** the evidence-first pipeline's first complete cycle, entirely self-generated. An out-of-scope note in one spec, a second spec keeping it unfiled under the same rule, a dossier opened by owner ruling, specimens collected across three sessions, a wrong mechanism guess corrected by a nine-case probe, and a mint only once the written condition was met. The dossier is preserved so that cycle stays legible.

### Queue after 1.32.1 and the mint

`[BUG-046]` (release-critical instruments as tracked scripts under `scripts/`, carrying the external-writers sibling concern) is next. Then `[BUG-047]` (the heredoc family) by default, unless a fourth specimen reorders it. `[BUG-045]` (the quoted-path allowlist defect) remains open with its ritual priced at filing. One dossier remains: the session denial tally, still uncharacterized and deliberately not merged into the heredoc family, since grouping is by mechanism. **Next mintable id is `BUG-048`.**

### Backlog state audit [2026-09-29]

A state audit of every backlog heading found **one item completed but unmarked**: `[BUG-044]` shipped as `1.32.0` (PR #37, `28142af`), was closed out in this file at `86b5435`, and the work moved on with its entry still reading `[ ]` and carrying **no shipping record at all**, so the backlog claimed a live defect that had already been fixed. The checkbox flip and the missing DONE bullet both landed, with the lateness recorded in the entry rather than quietly corrected. `[FEAT-023]` carried a lowercase `[x]` where every other closed entry carries `[X]`; normalized, since the state character is what tooling reads.

**The gap this exposes:** the closeout ritual writes `project.md` and pushes record commits, but nothing verifies that the shipped item's own backlog entry was closed. The memory record said the release was done while the backlog said it was not, and no instrument compared them. Every other `[ ]` entry was verified genuinely open, three of them against the code rather than by assumption (`FEAT-030` has a per-row byte cap, not the byte-sum bound it asks for; `BUG-032`'s lookup chain in `CLAUDE.md` still names only `project.md`; `FEAT-021`'s python decoupling is unshipped). The `[~]` markers on `BUG-034` and `BUG-035` are the deliberate superseded state and were left alone.

The backlog-state gap was **folded into `[BUG-046]` by ruling, not minted**: it is the third instrument of the same item, since that entry's thesis is release-critical checks with no tracked instrument behind them. The amendment prices a **record-parity check** under `scripts/` asserting, for an item id at closeout, that the heading reads `[X]`, that a DONE bullet naming the shipped version exists, and that the version agrees with `VERSION` and `CHANGELOG.md`, run as a closeout step the ritual cannot skip. Root cause in one line: **the heading flip had no owner**, because plan tasks touch the backlog only when named and the closeout writes memory without reading the backlog. The `[BUG-044]` state becomes the deliberate-defect fixture. **The amendment adds no heading, so the ceiling stays `BUG-047` and the next mintable id stays `BUG-048`.**

## Specimen: a rejected Write read as an interleaved file [2026-09-29]

**Preserved at owner instruction, verbatim, with its path, because it is the first artifact of this shape that exists on disk and is therefore anchorable rather than inferred.** Reported by the owner as "two drafts interleaved and cannot parse," in the `msg-t002` shape.

**Path:** `/Users/yeison/.claude/jobs/2dc6a6e3/tmp/regen-block.mjs`
**Written:** 2026-09-29 07:55:01, during the `[BUG-046]` spec drafting.
**On-disk facts, measured:** 37 lines, 1792 bytes, `birth == mtime` (written exactly once, never rewritten), and `node --check` exits 0. **It parses.**

```js
// Regenerate .gitignore's tracked-surface block from git ls-files, using the SAME
// function the parity test asserts with, so the file and the test cannot drift.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { expectedBlock } from '/Users/yeison/Projects/code-conductor/tests/unit/gitignore-block-parity.test.js';

const ROOT = '/Users/yeison/Projects/code-conductor';
const BEGIN = '# --- BEGIN tracked-surface block (BUG-042) ---';
const END = '# --- END tracked-surface block (BUG-042) ---';
const SITES = ['.claude', 'docs'];

const lsFiles = (site) =>
  execFileSync('git', ['ls-files', site], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

const want = expectedBlock(SITES.map((s) => [s, lsFiles(s)]));

const raw = readFileSync(ROOT + '/.gitignore', 'utf8').split('\n');
const b = raw.indexOf(BEGIN);
const e = raw.indexOf(END);
if (b < 0 || e <= b) throw new Error('markers missing or inverted: begin=' + b + ' end=' + e);

// Keep every comment and blank line inside the markers; replace only the rule lines.
const inside = raw.slice(b + 1, e);
const comments = inside.filter((l) => l.trim() === '' || l.trim().startsWith('#'));
const oldRules = inside.filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));

console.log('rules before=' + oldRules.length + ' after=' + want.length);
const added = want.filter((l) => !oldRules.includes(l));
const removed = oldRules.filter((l) => !want.includes(l));
console.log('added=' + JSON.stringify(added));
console.log('removed=' + JSON.stringify(removed));

const out = raw.slice(0, b + 1).concat(comments, want, raw.slice(e));
writeFileSync(ROOT + '/.gitignore', out.join('\n'), 'utf8');
console.log('block rewritten, lines=' + out.length);
```

**What produced the reported artifact, answered from evidence rather than inference.** The file above contains an `import` of `expectedBlock` and **no local definition of it**, and every identifier reported as undefined is defined in it: `SITES` at line 10, `lsFiles` at 12, `END` at 9, `b` at 20. So the unparseable interleaving is not on disk and never was. A **second** Write to the same path was attempted and **rejected**; a rejected Write is rendered as the proposed replacement shown against the file it would have replaced. Draft 1 (the import form, header "using the SAME function") and draft 2 (a local verbatim copy, header "copied VERBATIM") both bring `expectedBlock` into scope, each carries a header stating a different philosophy, and both log `rules before/after`, `added` and `removed` in variant wording. Read as one buffer they interleave exactly as reported, and a diff shows hunks rather than whole scopes, which accounts for the identifiers appearing to have no definition in view. **Not a fresh draft over a stale one** (`birth == mtime`, one write), **not a snapshot restore, not an editor merge:** two of one session's drafts rendered together because the second was declined. The rendering pane itself was not observable from this side; the disk facts are, and they are decisive.

**The job.** `/Users/yeison/.claude/jobs/2dc6a6e3/` is this session's own background-job workspace. The harness directs temporary files there rather than `/tmp`, because parallel jobs share `/tmp` and clobber each other. Job `2dc6a6e3` is this conversation, spanning the `[BUG-042]` release and the `[BUG-046]` audit: writes run 2026-09-28 20:02 through 21:21 (`audit042`, `backlog042`, `changelog042`, `closeout042`, `mint047`, `amend046`, `mark-done`, `compact-1321`, `blob.json`) and resume 2026-09-29 07:50 through 07:55 (`ceiling-046`, `record-parity-probe`, `discriminator-probe`, `two-level-probe`, then `regen-block`). **It is deleted with the job**, which is why a specimen kept only there is not preserved, and why this one is copied here.

### Why the block regeneration was reached for, and why it was out of scope anyway

**Not context bleed from the `[BUG-042]` snapshot.** A condition created and measured in this session, three calls earlier:

1. `git add <new spec file>` exited **1** and staged nothing. `docs/` is a deny-by-default surface after `[BUG-042]`, and the file is new and unnamed by the block. This is the shipped behavior working exactly as specified.
2. `git add -f` staged it, rc 0.
3. `git ls-files docs` then included it, so `gitignore-block-parity` went **red, 2 of 4**, and precisely the two predicted cases: *equals the block computed from git ls-files, in order* and *names every tracked file at both sites and nothing else*. The directory-ordering and removed-leaf cases stayed green.

The red was real and self-inflicted. **The diagnosis was right and the response was wrong:** the correct response was not to build regeneration machinery, it was to not stage an unapproved spec at all. Unstaged, `gitignore-block-parity` is green again, measured. The owner's scope ruling holds independently: no gate asks for it, the block shipped with its parity test as the authority, and when the leaf is genuinely needed at spec approval it is **one line in sorted position**, not a regeneration pass. `[BUG-042]` also already left `genblock.mjs` in the same workspace, so the script was redundant on top of being out of scope.

### A documentation defect this exposed, reported not fixed

`CLAUDE.md`'s Staging Convention closes with: "`-f` is required for a new file under a genuinely ignored directory, `.conductor/` being the remaining one in this repository." **That sentence is incomplete, measured today.** After `[BUG-042]`, any new file under `docs/` or `.claude/` is genuinely ignored until its leaf exists in the block, so `-f` is required there too. The epitaph's bounded clause survives intact and is the reason: `-f` was last needed for a file that was **already tracked**, and this file is new. Same family as the registry this item documents: a rule whose stated scope no longer matches its measured scope.

## Spec: BUG-046, release-critical instruments as repo infrastructure [2026-09-29]

**Approved 2026-09-29 with one addition and no reworks.** Spec file: `docs/superpowers/specs/2026-09-29-bug046-release-critical-instruments-design.md`, **31 acceptance criteria**. Version **RULED PATCH, `1.32.2`**, by the test `[BUG-042]` ratified: repo-only directory, repo-only tests, one maintainer document, `package.json` `files` untouched, `deploy.mjs` copies only named directories, so a fresh install is byte-identical.

**The five gate rulings the spec is written around.**

1. **Demarcation: a repo-only `tools/` directory**, not `scripts/`. The measurement decided it: `scripts/` is a shipped asset dir (`package.json` `files`, `deploy.mjs:189` copying it to `<cwd>/.claude/scripts/`, `templates.test.js:86` walking it by name), so a backlog-reading ceiling there is dead weight on every consumer. Instrument logic in `tools/`, live-repo tests under `tests/tools/` importing it, thin CLIs for the closeout. Cost pinned by a manifest assertion with a deliberate-defect confirmation. `tools/` is matched by no ignore rule, verified with `git check-ignore` exiting 1.
2. **Invocation: CI as live tests, no pre-commit hook, and this item creates the closeout checklist.** `CONTRIBUTING.md:50` states the CI gate is unconditional and `test.yml:35` runs `npm test`, so a live-repo assertion inherits halt semantics from the merge gate. **The checklist the amendment assumed does not exist**; a sentence binding an artifact into a document that is not there is unenforceable, which is the documentation-lying class `[BUG-044]` shipped to fix.
3. **The ceiling is a QUERY, the duplicate-id freedom is the INVARIANT**, and the distinction is made structural. `fetch-depth: 0` explicitly declined, with the reason recorded: `actions/checkout@v4` at default depth cannot resolve `origin/main`, and the remote leg's protection is the filing ritual's both-legs rule already in convention.
4. **Record-parity scope:** direction A unscoped, B scoped to the ids the current `CHANGELOG` version claims, C unscoped. `[~]` terminal beside `[X]`.
5. **Sibling concern: document, do not tolerate.** A registry note in `tools/README.md` naming both external writers with their paths, citing the between-markers precedent that already ships.

**Three premise corrections, measured rather than argued.** (a) Registry entry 3's failure mode is **a hardcoded literal frozen two releases back** (`?? '1.31.2'`), not "a target it had not been given"; the survivor reproduces five FAILs on five agreeing locations at `1.32.1`, rc 1, on demand. (b) **The scratchpad was never withdrawn.** It holds 316 files, and what survived are the **retired** forms of all three instruments while the shipped semantics were never written to any file, so recovery would restore three defects. (c) `scripts/` ships, which answers the entry's open question by measurement.

**The two-level discriminator, and why one level is not enough.** A bullet-start rule alone cuts 72 id occurrences to 13 claims and leaves exactly one violation, `1.32.0 claims BUG-045`, which is a **false positive**: `CHANGELOG.md:29-30` places it under `### Filed`, a section for minted-but-unshipped items. **On first contact with real data the single-level form reproduced registry entry 2's failure class**, and that false positive ships as the fixture proving the second level was needed. With `Filed` and `Notes` excluded by name: 12 claims, 0 violations today, `BUG-044` flipped back to `[ ]` reports exactly `1.32.0/BUG-044`, and `BUG-042`'s heading removed reports 3.

**The retroactive cost, recorded so the scope choice is explicable.** 34 closed headings, **6 carry a shipped-version bullet, 28 do not**. Unscoped direction B is red 28 times on day one; scoped to the current release it is 3 ids and 0 violations. The grandfather list is declined with the `[BUG-042]` toll lesson cited, and tightening B later is named as a one-line scope change.

**AC31, the addition at approval.** Record-parity runs against **this item's own closeout**, asserted by the tool rather than by eye, and the closeout record states the result. The first release whose record cannot silently diverge is the release that made divergence detectable.

**Endorsed as written, for the record:** AC5's no-target-no-default double negation; AC4's three-way failure discrimination; AC13's vacuous-pass closure and AC14's lost-versus-lying distinction; AC21's fetch-depth refusal with its reason recorded; AC30 making the `docs/` toll self-enforcing task by task; the boundary table's self-inflicted reds predicted by case membership; and the inversion-proof protocol for the one honest green, with case names reported before revert.

**Ordering finding, measured at the spec commit and carried into the plan.** The approved expectation was commit document, regenerate block, verify green. **Leaf-first is strictly better and was measured:** adding the single `!` leaf in sorted position *before* staging makes plain `git add` exit **0** and stage the file, so the commit never passes through a red state at all and `-f` is never reached for. Force-staging first produces a real red (2 of 4 cases, measured twice) that then has to be cleared. Both orders end at identical content verified by the same test; leaf-first simply never lies in between. The plan uses leaf-first for single-document tasks and says why.

## Closeout: 1.32.2, the first release whose record verifies itself [2026-09-29]

`[BUG-046]` shipped as **`1.32.2`** (PR #39, merged `fc8dbc9`). Clean squash sync measured before acting: **`0 ahead / 1 behind`, clean**, fast-forwarded `26d5c6d..fc8dbc9`. Branch `fix/bug-046-release-critical-instruments` deleted on upstream-merged. Three instruments re-run on the merged tree rather than the branch: `VERSION_GATE_OK 1.32.2`, `RECORD_PARITY_OK`, ceiling `BUG-047` from both legs with 47 headings each and no duplicates. **Next mintable id is `BUG-048`.**

### Boundaries: nine for nine

| After | Predicted | Measured |
|---|---|---|
| baseline | 910 / 12, 35 / 1 | 910 / 12, 35 / 1 |
| T-000 plan | no change, no red | 910 / 12, 35 / 1, block-parity 4/4 |
| T-001 `id-ceiling` | 916 / 12, 36 / 1 | 916 / 12, 36 / 1 |
| T-002 `version-gate` | 925 / 12, 37 / 1 (corrected) | 925 / 12, 37 / 1 |
| T-003 `record-parity` | 934 / 12, 38 / 1 (carried) | 934 / 12, 38 / 1 |
| T-004 `repo-invariants` | 937 / 12, 39 / 1 | 937 / 12, 39 / 1 |
| T-005 `tools-not-shipped` | 940 / 12, 40 / 1 | 940 / 12, 40 / 1 |
| T-006 documents only | unchanged | 940 / 12, 40 / 1 |
| T-007 release | unchanged at `1.32.2` | 940 / 12, 40 / 1 |

**No `gitignore-block-parity` red at any point.** The spec predicted three from this item's own documents; leaf-first removed all three, and the plan declared the supersession with its measurement rather than dropping the prediction.

### Conventions and findings this release establishes

- **A module-resolution red reports as a FILE, not as cases.** The plan predicted "all 6 cases red" for each TDD step. Vitest fails at **collection**, before any case exists, so it reports `Test Files 1 failed (1)` with zero tests run. Same cause, different accounting. **The contract for a TDD red is the cause and the named module, never a case count that cannot exist yet.** Stated at the first occurrence rather than the third.
- **A fixture caught a defect the live repository structurally cannot.** Direction B of `record-parity` first skipped only non-terminal states, so a `[~]` superseded entry was required to name a shipped version it never had. **The live data hides it:** direction B is scoped to the ids the current version claims, and the one `[~]` entry, `[BUG-035]`, is claimed only by `1.28.0` through `1.30.0`, which direction B never reaches. The fixture exposed it in one run. **This is the argument for fixtures stated as a measurement rather than as a principle**, and it is the counterexample to "the live assertion makes the unit test redundant".
- **Registry entry 5, added the day the registry was written.** `git diff --stat` was the plan's revert check for the three inversions, on a file that was still **untracked**, so it prints nothing whether or not an inversion survived; `git add -N` then reports the whole file. Empty output would have read as "reverted" when it meant "not measured". **A step for verifying instruments used an instrument that could not see its subject.** Generalized in `tools/README.md`: **an instrument that returns the same answer whether or not its subject is present is not measuring its subject**, which is the `numstat` defect, the max-scan defect and the vacuous-pass defect stated once.
- **Risk 3 fired, and the diagnosis is generator semantics.** The plan said the new `docs/` leaf goes "immediately after `/docs/*`". It does not. `expectedBlock` emits, per site, the `/root/*` line, then **every directory re-include sorted**, then **every file leaf sorted by full path**. `docs/RELEASE-CLOSEOUT.md` is a file leaf and sorts before every `docs/superpowers/...` path because `R` precedes `s` in byte order. Correct position was the first file leaf, line 56, not line 50. **The case split is the diagnostic:** exact-equality-in-order red with leaf-set-completeness green means an ordering error, and both red means a missing leaf.
- **The atomic-record exception, ruled and recorded in the commit body.** Once invariants span files, the commit that moves them moves them together. Splitting the version bump from the `CHANGELOG` leaves the version invariant red between commits; splitting the heading flip from the claim leaves direction A red. `fab33de` is the citation next time a release commit looks against the grain.
- **The heading flip has an owner: the release commit.** It previously happened at closeout, after the merge, which is how `[BUG-044]` shipped with its heading still reading `[ ]` for an entire release. Scoping direction A to exempt the in-flight version was considered and rejected, because `[BUG-044]`'s defect lived in a shipped version and the exemption would excuse exactly the case the instrument exists to catch. **The root cause is fixed structurally rather than by a reminder**, and `docs/RELEASE-CLOSEOUT.md` documents the change.
- **One declared deviation, named before it landed.** T-002 contributes 9 tests rather than the planned 7: the plan's Review Focus named it as an owner of the `## [Unreleased]` case and its test file carried none. A plan gap, not a discovery. Every downstream count carried the +2.
- **Two plan steps were upgraded rather than executed as written.** T-001-F specified a control on `git show`; the CLI was run instead in a throwaway repo with no `origin`, exercising the abort end to end at rc 2 with **stdout completely empty**. T-004-E's `git diff --stat` became registry entry 5.

### The instruments proved rather than asserted

**The honest green, by inversion.** `repo-invariants` was predicted green because all three invariants were measured green during the audit. Each inversion turned exactly one named case red and left the other two green: `agrees with VERSION at all five version locations`, `keeps its CHANGELOG, backlog and VERSION in record parity`, `files no id twice`. No coupling.

**The single-level discriminator, disproved on real data before shipping.** A bullet-start rule alone cuts 72 id occurrences to 13 claims and leaves exactly one violation, `1.32.0 claims BUG-045`, a false positive from `### Filed`. On first contact with this repository's own records the single-level form reproduced the retired max-scan's failure class. It ships as the control fixture.

**AC31, the release's final line.** Both instruments ran against the release that ships them: `VERSION_GATE_OK 1.32.2` and `RECORD_PARITY_OK`, rc 0 each. Then proved rather than trusted, per the discriminator rule applied to the release's own record: with `[BUG-046]`'s heading flipped to `[ ]`, parity reports `FAIL [A] 1.32.2 claims BUG-046 but its heading reads [ ]` three times, once per claim bullet, rc 1. Restored, green. **The first release whose record cannot silently diverge is the release that made divergence detectable.**

### Queue

`[BUG-047]` (the heredoc family) is next, and its evidence is waiting: **four specimens** across four consecutive sessions, and the priority finding that upgrades it, that the harness's own auto-mode guidance instructs writing files with heredocs while Guard 3 denies any body carrying a bracket class, so the platform's instruction and this repository's hook are in direct conflict and the friction is systematic rather than incidental. Its spec's first audit item remains whether the frozen authority agrees with the port that `<<'EOF'` and `<<EOF` are not distinguished. Then `[BUG-045]` (the quoted-path allowlist defect), still open with its ritual priced at filing. Two dossiers stay unfiled: the session denial tally, and the interleaved-artifact dossier opened this session with one anchored specimen. **Next mintable id is `BUG-048`.**

## Spec: BUG-047, Guard 3 scans heredoc bodies as command text [2026-09-29]

**Approved 2026-09-29 with no reworks.** Spec file: `docs/superpowers/specs/2026-09-29-bug047-heredoc-body-scanning-design.md`, **24 acceptance criteria**. Version **RULED MINOR, `1.33.0`**, by the ratified test applied as the `[BUG-042]` worked example prescribes: `project-template/.claude/hooks/pre-tool-use.mjs` changes, so a fresh install differs, which is the line PATCH requires not crossing. No further argument owed at plan approval.

**The load-bearing sentence, ratified as the spec's centre:** a heredoc body is content being **written** and is already inside the command string the scanner is holding, so it cannot flood anything, and **no dump shape uses one**. Measured, not asserted: `cat <<EOF` with no redirect reads zero files and allows today on a prose body.

**The five gate rulings.**

1. **The scanner stops reading heredoc bodies entirely**, blanked length-preserved in `_G3_PRE`, one pass propagating to all thirteen checks and the allowlist. The P6-inside-body flip is **deliberate and argued from purpose**: a grep pattern in written content is data, not a command reading files. The P6 real-code control stays deny and pins the frontier.
2. **A sixth scanner state**, entered on `<<[-]?['"]?WORD['"]?` and left on the line equal to `WORD`, in the same pass that tracks quotes, because the malformed computation shares that pass and a pre-pass would have to duplicate quote tracking to know where `<<` is real. **This is the sixth sanctioned exception to the frozen authority:** its own ruling, landing alone, header amended in the same commit.
3. **No special case for unredirected `cat <<EOF`.** It reads zero files, so today's behavior, allowing on prose and denying only on a metacharacter, **is the defect**. Reasoning recorded so it is never re-proposed.
4. **The odd-quote malformed denial is in scope**, same cause, two of four specimens die there, and the sixth state resolves it structurally because skipped body characters no longer feed quote parity.
5. **Corpus rows as recommended plus three new ones:** odd-quote malformed, P6-inside-body, and the dump-adjacent scope control **in both positions**. Verbatim where a transcript exists, **marked constructed** where not, with specimen 2's caveat in its row comment, and predicted post-fix verdicts written before either subject changes.

**Three audit findings that corrected the filing's own premises.**

- **The authority question is closed, and the answer is stronger than the framing.** Neither subject has a heredoc state: both track `UNQUOTED`, `SINGLE_QUOTED`, `DOUBLE_QUOTED`, `ANSI_C_QUOTED`, `LOCALE_QUOTED`, and `<<` is not a token. In `<<'EOF'` the quotes open and close an ordinary single-quoted region around `EOF`. **There is nothing to distinguish with**, so the gap is a missing concept rather than a missing branch. **17 of 17 differential agreement**; no new divergence, and the single sanctioned divergence stays at one until this item's own authority commit declares its red.
- **The remedy binding was refuted as a PLACEMENT and confirmed as a MECHANISM.** Specimens die at two gates: pattern checks after the strip pass, and the fail-closed malformed branch **during** it, on an odd count of quote characters. A skip between strip and mask cannot reach the second.
- **The consumer-matrix prediction was refuted.** P6 fires on a grep shape existing only inside a heredoc body, because it reads unmasked by design and cannot tell a real pattern from prose resembling one. The fix therefore **has** a frontier, and the blanking must land in `_G3_PRE`.

**AC9, the deliberate departure, endorsed with its full reasoning at the line.** An unterminated heredoc blanks to end of input and does **not** deny as malformed. The fail-closed rule exists because an unbalanced quote leaves **ambiguity about where command text resumes**; an unterminated heredoc leaves none, since everything to end of input is body and there is no "after". Bash agrees, measured: a script ending mid-heredoc proceeds, and on GNU bash 3.2.57 (the interpreter the authority runs under here) it does so **silently, rc 0, body delivered**; newer bash warns and still proceeds. **The "proceeds" half is the load-bearing one and it was verified rather than quoted.** Fail-closed there would deny every draft of a file write whose delimiter line has not arrived, which is this item's defect resurrected in a new state. **The departure is correct precisely because the pattern's premise does not apply**, and the spec says so at the line so it is never normalized into a regression.

**Convention established by the audit: a probe harness runs its controls before printing any matrix, and refuses to print on control failure.** This audit's first harness reported `allow` on all fifteen rows including `cat *.ts`, because `CLAUDE_TOOL_INPUT` carries the `tool_input` object alone rather than the whole payload and `CLAUDE_TOOL_NAME` is a separate variable that was omitted, so dispatch never reached the Bash guard. **An all-allow matrix from a broken harness is indistinguishable from a real finding**, which is `tools/README.md`'s registry class applied to a measuring instrument.

**The reader-at-command-position boundary is pinned from two directions**, `tee` and `python3` both allowing on byte-identical bodies, and both ship as corpus rows.

## Closeout: 1.33.0, the release that dissolved a standing contradiction [2026-09-29]

`[BUG-047]` shipped as **`1.33.0`** (PR #40, merged `eff4236`). Clean squash sync measured before acting: **`0 ahead / 1 behind`, clean**, fast-forward `16b2520..eff4236`. All three instruments signed the acta on the merged tree: **`VERSION_GATE_OK 1.33.0`**, **`RECORD_PARITY_OK`** with `[BUG-047]`'s heading at `[X]` and its DONE bullet naming `1.33.0`, and a ceiling of **`BUG-047` from both legs**, 47 headings each, no duplicates. Suite **996 passed / 12 skipped, 40 files / 1 skipped**. **Next mintable id is `BUG-048`.**

### Boundaries: five for five

| After | Predicted | Measured |
|---|---|---|
| T-000 plan | no change, no red | 996 / 12, 40 / 1, block-parity 4/4 |
| T-001 corpus rows | 996 / 12 (corrected from 994) | 996 / 12, both subjects green |
| T-002 authority alone | **RED, exactly 17 named cases**, port green | 17 red, exactly the list, port green |
| T-003 port, mirror, flips | 996 / 12 | 996 / 12 |
| T-004 release | 996 / 12 at `1.33.0` | 996 / 12 |

### The rule this release produced

**A TWO-PASS PIPELINE REQUIRES AN IDEMPOTENT TRANSFORMATION.** `guard3BashScan` and the authority's dispatch both run the scanner twice, building the mask from strip's output. A first draft blanked the heredoc terminator line along with the body, so the second pass could not find it: the scanner re-entered `HEREDOC` at the same introducer, never terminated, and blanked every command after the heredoc. **The symptom was silent and severe, a genuine mass dump following a heredoc write ceasing to deny.** The terminator is now emitted verbatim while body lines are not, because nothing downstream needs to find a body line again. **The scope control caught it**, which is why that row exists in both positions, and it is the strongest evidence yet for writing controls that assert what must *keep* being true rather than only what must change.

### A self-corrected diagnosis, recorded because it nearly shipped

The first explanation for that failure was `set -euo pipefail` aborting on a bare arithmetic command evaluating to zero. **That was wrong.** Bash exempts every command in an `&&` list except the one following the final `&&`, which is precisely why the existing scanner uses `[[ ... ]] && result+=...` throughout. A comment asserting the false mechanism had already been written into the frozen authority and was removed rather than shipped. **The lesson is the ordering:** the wrong diagnosis was plausible, matched the symptom, and would have left a false explanation embedded in the most load-bearing file in the repository. What caught it was extracting the scanner and printing the mask, rather than reasoning further from the symptom.

### The plan carried the defect, and following it literally would have shipped it

The plan's T-003 listing contained the first draft's port code, terminator blanking included. Since the port has the same two-pass shape, executing that step verbatim would have reintroduced into the port the bug the authority commit had just fixed. **The corrected form was applied and the deviation named in the commit.** A plan is a document of intent and inherits whatever was wrong at writing time; the instrument that caught this was a corpus row, not a re-reading of the plan.

### The success measure, demonstrated rather than narrated

Through the live hook, four cases: a heredoc file write with a bracket-class body **allows**; a genuine mass dump **denies**; a dump following a heredoc write **denies**; a here-string glob **denies**. Then through the **real Bash tool** in the implementing session, a `cat > file <<'SCRIPT'` carrying a character class, a `??`, a `for...of` and an apostrophe **executed and ran**. That is the exact shape denied under **P4 P5 P9** in four consecutive sessions. **The contradiction between the platform's auto-mode guidance and this repository's own hook is gone**, which was the item's stated value: not the friction of one denial, but the removal of two binding instruction sets that disagreed.

### Other findings

- **The sixth sanctioned exception held its ritual.** One file, header amended in the same commit, one `--no-verify` scoped to that commit with `git status --short` checked to show exactly one path, the hook itself untouched, and the port deliberately one commit behind with `guard3-port.test.js` green as the proof the red belonged to the authority alone.
- **Two frontier rows justified themselves.** `<<<` is a here-string and `cat <<< [x]` must keep denying, so the introducer matcher tests the third character; and the P6 grep shape as real code must keep denying while the same text inside a body is allowed to flip.
- **A green test had been announcing a false number.** `guard3.test.js`'s count assertion read `carries exactly 111 rows` in its label while asserting `127`. The label was not updated when the corpus last grew. Both now read 155. **A label is part of the assertion's output, and an unchecked one drifts exactly like a comment.**
- **One declared deviation:** 28 corpus rows rather than the planned 27, so the suite total is 996 and not 994. Named before it landed, and every downstream count carried it.
- **`docs/RELEASE-CLOSEOUT.md` was missing its branch-deletion step**, found when an instruction cited "the checklist line" for a line that did not exist. **The document `[BUG-046]` created reproduced `[BUG-046]`'s own defect one release later.** Step 10 now exists, including why a squash merge makes `git branch -d` report "merged to its upstream but not to HEAD" and why that is correct rather than alarming.

### Queue

**`[BUG-045]`** (the Guard 3 allowlist cannot cover a quoted path) is the only open filed defect remaining, with its ritual priced at filing. **It opens on the owner's word, not automatically.** Two dossiers stay unfiled: the session denial tally, and the interleaved-artifact dossier with its one anchored specimen and its stale-instruction sibling note. **Next mintable id is `BUG-048`.**

## Spec: FEAT-021 Python-free removal of the graph rung [2026-09-29]

- Spec: `docs/superpowers/specs/2026-09-29-feat021-python-free-removal-design.md`. Branch `feat/feat-021-python-free-removal`. Direction was already resolved (option (a)); the spec turns the amendment's scope into ACs. Target release `1.34.0`, complexity M.
- **D1 upgrade path: HEAL plus content-match SWEEP.** Remove `graphify-ast-refresh` hooks from `UserPromptSubmit` in `~/.claude/settings.json` (only the matching hook; drop the entry only when it empties, settled at approval). Then delete `~/.claude/hooks/graphify-ast-refresh.{py,mjs}` only if the settings step returned `removed|absent` and the bytes match the one shipped version (`.py` @`968dc6f` sha256 `761199f1…9a800b`, `.mjs` @`5b4a1af` sha256 `c78e4e5e…282e36`). A modified file is kept and named; every path fails open; heal throws never escalate the exit code.
- **R1:** whether the ordering is load-bearing or defense in depth depends on `deployGlobal`'s settings.json treatment (BUG-033 plan says force-copy with no `hooks` key). `/cc-plan` must measure it and record which.
- **R2:** the hash-pin test is LOCAL-ONLY per the id-ceiling precedent (CI's shallow checkout lacks both commits); the skip reason is named in the test.
- D2: Guard 4 drops `graphify-out` and keeps `node_modules`; Guard 1 covers any leftover graph.json. D3: `tests/verbosity-hook-test.sh` is deleted (last `python3`, superseded by FEAT-024's port, invoked by nothing).
- Live specimen: this machine's settings carries the hand-edited `python3 …py` entry, and the deployed `.py` matches the shipped hash.
- Out: option (b), FEAT-019 territory, the TS compiler API, host-project Python support (detect-stack, cc-docs, cc-spec manifest list), the guard3 corpus row, historical records.

## Closeout: 1.34.0, the graph rung and all Python leave the package [2026-09-29]

`[FEAT-021]` shipped as **`1.34.0`** (PR #44, merged `6fd92de`). Squash sync measured before acting: **`0 ahead / 1 behind`, clean**, fast-forward `b915c31..6fd92de`. On the merged tree: **`VERSION_GATE_OK 1.34.0`**; **`RECORD_PARITY_OK`**, with `[FEAT-021]` at `[X]` and its DONE bullet naming `1.34.0`; ceiling before this record's filing **`BUG-047` from both legs** (57 headings each, no duplicates). Local suite **1009 passed / 12 skipped**.

### Boundaries: six for six locally, and the CI prediction wrong in premise

| After | Predicted (local) | Measured (local) |
|---|---|---|
| T-000 plan | 996 / 12 | 996 / 12 |
| T-001 heal module | 1013 / 12 | 1013 / 12 |
| T-002 swap + delete Python | 1004 / 12 | 1004 / 12 |
| T-003 guards | 1007 / 12 | 1007 / 12 |
| T-004 instruction surfaces | 1009 / 12 | 1009 / 12 |
| T-005 release, plus fix `34cfde4` | 1009 / 12 | 1009 / 12 |

### Record

- **M1, the corrected premise.** `deployGlobal` merges `settings.json` (the `GLOBAL_HOST_OWNED` filter keeps it out of the copy; `mergeSettingsFile` with an empty fingerprint list and a template with no `hooks` key never touches the host's `hooks`). The BUG-033 plan's "force-copy" claim has been stale since BUG-039. D1's heal ordering (unmerge first, sweep only on `removed|absent`) is therefore **LOAD-BEARING**, and the heal is the only thing that ever removes the stale entry. Deploy also replaces a *malformed* settings file before the heal runs, so at CLI level the heal sweeps (test named `M1`); the heal's own `malformed-skipped` contract is pinned at unit level.
- **M2.** All 14 published tarballs (1.23.0 to 1.33.0) carry **zero CR bytes** in both hook files, one hash per file across all of them. The Windows-clone `autocrlf` residual fails safe: kept and named.
- **Per-environment baselines.** Local **1009 / 12**. CI **925 / 96** on Node 20 (v20.20.2): 95 environmental, of which **83 are `node:sqlite` self-skips below 22.5** (`conductor-db` 74, `handoff-cycle` 3, `resume-read` 6) and **12 are uninstalled-skills skips** (`code-conductor-plugin`, which skip locally too), plus **1 hash pin** on the shallow clone. Main's baseline run `36636754979` at `b915c31` read **913 / 95**; this branch's CI delta (+12 passed, +1 skipped) equals the local delta minus the pin exactly. **The rule: future plans state test predictions PER ENVIRONMENT or not at all.** The CI half is filed as `[BUG-048]`.
- **Two spec gaps the branch closed:** the Operational Philosophy graph clause in both CLAUDE.md files, and `project-template/.claude/commands/cc-debug.md:14`'s "graph query" instruction (fixed in `34cfde4`, found by the end-of-branch review).
- **Coverage gap, named and not fixed:** no test runs the heal against a symlinked `settings.json`. The code resolves the real path; a dangling symlink yields status `error` and the sweep is skipped, which is the safe side. It joins the heal matrix in any later change touching `heal.test.js`, without its own release.
- **Native execution was a one-time exception.** This plan ran natively as an explicit per-plan exception; the subagent-driven preference in `personal.md` stays unchanged.
- **`[ARCH-009]` field evidence (handoff observations).** These were reported in-session, not in PR #44's body, so they are recorded here verbatim as the durable copy. T0: none lacked; folding the rulings needed one new measurement (detect-stack carries no `python3`; `guard4.test.js:100` did). T1: none; plan code verbatim, 17/17 first run. T2: none; the `settings.test.js` block end (142-208) was re-derived by line count. T3: none; the Guard 4 row rewrites were given as intent, not strings, so an exact-once replace script was written. T4: **plan defect, out of lane**: the surface invariant missed the heal's call site in `bin/`, the Task 3 hook comment named `graphify-out/`, and the python3 invariant's own title matched its needle; all fixed in lane, recorded under T-004-B. T5: none.
- **Verify-band observation from the review cycle.** The no-graphify check passed green over `cc-debug.md` because its pattern (`graphify`) was more specific than the concept it protected ("graph query"). **A Verify-band gate must declare what it is able to see, not only what it found.** Same class as the hash pin skipping in CI: a green that covers less than its name.

### Queue

`[BUG-048]` filed by this closeout (CI's green was never a measured baseline, and its runtime is deprecated). `[BUG-045]` remains open on the owner's word. **Next mintable id after this filing is `BUG-049`.**

## Spec: BUG-048, CI's green was never a measured baseline [2026-09-29]

Spec `docs/superpowers/specs/2026-09-29-bug048-ci-measured-baseline-design.md`, APPROVED 2026-09-29 with R1 and R2. Target `1.34.1` (repo-only, per the `[BUG-046]` precedent), complexity M.
- **Three mechanisms, never conflated.** (1) Action runtime: bump checkout/setup-node/cache in `test.yml` and `publish.yml` to majors whose `action.yml` declares `runs.using: node24`, measured via `gh api`; evidence is the check-runs **annotations API**, not log text. (2) Test runtime: matrix `{20, 24}`, `fail-fast: false`; 20 is the `engines` floor and the `node:sqlite`-absent paths, 24 executes the 83 persistence tests; cache key gains the Node version; `publish.yml` tests on 24. (3) Assertion: `tools/skip-baseline.mjs` plus `tools/skip-baseline.json`, the exact skipped SET per named CI environment (identity `<file> > <fullName>`), unknown `--env` fails, report-only without `--env`, fail-closed aborts, duplicate detection.
- **Rejected:** an in-suite reporter or `globalTeardown` assertion, because a developer machine is not a reproducible environment (plugin skips depend on `~/.claude/skills`, sqlite on the local Node).
- **R1:** `docs/launch/LAUNCH-CHECKLIST.md`'s frozen "996 passed / 12 skipped at 1.33.0" becomes command and instrument assertions; numbers live only in the measured baseline file.
- **R2:** `publish.yml` does NOT run the instrument: the baseline is a merge gate, every publishable commit passed both asserted legs on its PR, and the publish suite's Vitest red remains the publish gate.
- **Out:** raising `engines` (Node 20 EOL 2026-04-30; the 20 leg leaves later as a deliberate act with a baseline diff), running the plugin suite in CI, `fetch-depth: 0`, the Ubuntu 26 runner notice, Windows/macOS legs, asserting passed counts, a local baseline.
- **Carried to /cc-plan (owner):** bootstrap sequencing is Review Focus item 1 (baseline measured from the branch's own CI before arming); an identity-stability check across two runs is a plan task with its result recorded in the plan text; each leg's skipped count is predicted per environment before the arming run.

## Closeout: 1.34.1, CI's skipped set becomes a measured, asserted baseline [2026-09-29]

`[BUG-048]` shipped as **`1.34.1`** (PR #45, squash `a3c82b1`, tree-identical to the arming commit `bfe68fc`).

**Sync.** Measured before acting: **`0 ahead / 1 behind`**, which is clean. Local `main` was fast-forwarded in place with `git fetch origin main:main`, because `git switch` refused over the plan file's uncommitted ticks, and the ticks were not stashed.

**Instrument output on the merged tree:**
- **`VERSION_GATE_OK 1.34.1`** (five `ok`).
- **`RECORD_PARITY_OK`**.
- The ceiling from both legs is **`{"BUG":48,"FEAT":39,"ARCH":9}`**, with 58 headings each and no duplicates. The next mintable id is **`BUG-049`**; nothing was minted.
- The local suite reads **1033 passed / 12 skipped (1045)**.
- `main`'s push run `36649619172` printed both `SKIP_BASELINE_OK` lines.

### Bootstrap: two runs, three executions, every prediction matched

| Execution | Commit | `ci-node20` | `ci-node24` |
|---|---|---|---|
| Run 1, attempt 1 (report-only), `36648751722` | `d3b8b8b` | success, v20.20.2, 949 / 96 (1045): `conductor-db` 74, `handoff-cycle` 3, `resume-read` 6, plugin 12, heal pin 1 | success, v24.21.0, 1032 / 13 (1045): plugin 12, heal pin 1 |
| Run 1, attempt 2 (rerun, same commit) | `d3b8b8b` | `IDENTITY_STABLE ci-node20: 96` byte-identical | `IDENTITY_STABLE ci-node24: 13` byte-identical |
| Run 2 (armed), `36648998924` | `bfe68fc` | `SKIP_BASELINE_OK ci-node20: 96 …` | `SKIP_BASELINE_OK ci-node24: 13 …` |

- **Deprecation annotations:** 0 on every leg of every execution. The only annotation is the Ubuntu 26 notice, which is out of scope.
- **Local test counts per task:** 1032 / 12 (1044) at Tasks 1–4. The owner-accepted empty-`--env` fix added one test, and the predictions were revised **before** Run 1 to 1033 / 12, 949 / 96 and 1032 / 13 (1045). Every later commit read 1033 / 12.
- **The node24 leg ran the persistence suites in CI for the first time.** The 83 `node:sqlite` tests ran and passed there.
- **Local demonstration.** `--env ci-node24` against a local report gave `SKIP_BASELINE_DRIFT ci-node24: +0 −1`, naming the heal pin (history is present locally), at rc 1. This shows the gate reads the committed file and that a laptop is not a CI environment.

### Record

- **D2 reverses `project.md:521`.** That line reads "The runner stays on `node-version: '20'` … Raising the runner to 22/24 and adding a Node matrix to Test are both out of scope". It is kept as history. `publish.yml` now tests on Node 24, and `test.yml` runs the `{20, 24}` matrix. The Node 20 floor is asserted by the matrix on the PR and again by the push-to-main run.
- **Two spec gaps closed beyond the spec's text**, both found by the pre-push review and accepted by the owner:
  - `docs/launch/RECORDING-SCRIPT.md:105`'s frozen "996 passed / 12 skipped at 1.33.0", which R1's surface did not name (`ec62580`);
  - `publish.yml`'s comment crediting the same-commit guarantee to the PR run, which tests the merge ref, when the push-to-main run is the one that tests the tagged commit (`d3b8b8b`).
- **The review's principal catch.** `--env ""` read as no `--env` and passed as report-only at rc 0. That was **a fail-open inside the one gate whose thesis is failing closed**. It is fixed in `e724b45`: the new test went red with the fix stashed (1 failed, 23 passed) and green with it (24/24). CI could not reach it (the armed form is `ci-node${{ matrix.node }}`), which is exactly why only a review could find it.
- **`[ARCH-009]` observation.** The plan's `ci-measure.mjs` fetched job logs with `gh api …/jobs/{id}/logs`. gh 2.100.0 refuses a response containing terminal escapes unless given `--allow-escape-sequences`, and Vitest colours its CI output, so every leg would have thrown. **A plan cannot know a tool's live behaviour; only an execution against the installed binary reveals it, and that is what a verify-band reviewer is for.** The Task 5 reviewer measured it on a real job log, and it was fixed in the plan text before Run 1 was spent.
- **Hybrid execution split: held.** Tasks 1–4 were subagent-driven with a reviewer between tasks (all approved, zero fix rounds, every handoff observation "nothing missing"). Tasks 5–8 ran natively in-session, against live CI state in strict run order. This was a band boundary chosen in the field: isolated build tasks went to fresh contexts, and verify/ship orchestration stayed continuous.
- **The seven reviewer-agreed residuals, left as-is (owner-ratified):**
  1. A **duplicate test name** in a report aborts every run while the pair exists. This is fail-closed, as the plan chose. No file that can skip in CI has one (measured over 124 tests).
  2. A **repeated `--report`** silently overrides the earlier value. The workflow passes it once.
  3. A null `assertionResults` entry throws a TypeError rather than printing an ABORT line. It still exits nonzero, and Vitest never emits one.
  4. `LAUNCH-CHECKLIST.md:17` is a run-on line (brief-verbatim).
  5. `RELEASE-CLOSEOUT.md:3` "each CI leg also asserts" was false until the arming commit. It became true before the merge.
  6. `publish.yml`'s same-commit premise. It was later reworded by the owner-accepted `d3b8b8b`.
  7. `tools/skip-baseline.json` is named by the CHANGELOG and the backlog before it existed. It landed at arming, by design.
- **Working ledger** `.superpowers/sdd/2026-09-29-bug048-ci-measured-baseline/` was deleted in this record commit's action. Git history is the record.

### Queue

Nothing minted. `[BUG-045]` remains open on the owner's word. **The next mintable id is `BUG-049`.**

## Spec: FEAT-038, discoverability metadata for npm and GitHub [2026-09-29]

Spec `docs/superpowers/specs/2026-09-29-feat038-discoverability-metadata-design.md`, APPROVED 2026-09-29 with R1 and R2. Target `1.34.2`, a patch, because nothing about how the tool runs changes. Complexity S.
- **Two halves, kept separate.**
  - **Repo half (plan):**
    - `package.json` `description` = V1 and `keywords` = V2;
    - strip `README.md`'s 3-byte UTF-8 BOM, showing the bytes before and after;
    - two pinning tests in `tests/tools/repo-invariants.test.js`;
    - one `LAUNCH-CHECKLIST.md` line;
    - the release ritual.
  - **Owner half (after merge, the owner runs it):** GitHub About and topics, pasted from the spec's exact values. The agent verifies it read-only with `gh repo view`.
- **V1**, the npm description and GitHub About, identical: "A governance layer for Claude Code sessions: hooks that check an agent's commands before they run, a spec-first workflow, and project memory the next session reads." It is 164 characters and ASCII, and every clause is backed.
- **V2**, the keywords and topics, one list: `agentic-development, ai-agents, claude, claude-code, claude-code-hooks, claudecode, cli, developer-tools, guardrails, skills, spec-driven-development`.
- **Topics removed:**
  - `claude-code-plugin`: an unbacked claim, because `project.md:395` says it is an installer CLI, not a plugin. Load-bearing.
  - `claude-ai`: names a product the project does not target.
  - `agent`: redundant.
  - `tokens`: claims nothing.
- **Old About stale:** "automatic stack profiles" describes what `[FEAT-013]` retired.
- **Held back:** `multi-agent` is added to both lists when Pillar 3 (`[ARCH-009]`) ships its first agent. Today it is a backlog pillar, not shipped behavior.
- **Predictions**, two new tests, neither skipping: local 1035/12, ci-node20 951/96, ci-node24 1034/13 (1047 each). `tools/skip-baseline.json` is unchanged.
- **R1:** before any edit, the plan greps every test file that reads `package.json` (FEAT-023's `repository.url` guard among them), proving that the additive fields break nothing.
- **R2:** the owner checklist carries a one-flag-per-term fallback in case `gh` rejects the comma-separated topic form.
- **Out:**
  - the social preview, moved to launch acts beside the GIF by owner ruling, with a checklist line holding its place;
  - post content, the GIF, and the `[BUG-045]` issue;
  - the Website field, `homepage` and `bugs`;
  - any agent-run `gh repo edit`.
- **npm rendering:** checked by the owner in a browser, because npmjs.com answers `curl` with 403.

## Closeout: 1.34.2, npm and GitHub given one description and one keyword list [2026-09-29]

`[FEAT-038]` shipped as **`1.34.2`** (PR #46, squash `241838a`). Both halves are verified: the repo half at publish, and the owner half at the fourth step 6 read (see below).

**Sync.** Measured before acting: **`0 ahead / 1 behind`**, which is clean. `main` was fast-forwarded to `241838a`.

**Instrument output on the merged tree:**
- **`VERSION_GATE_OK 1.34.2`**.
- **`RECORD_PARITY_OK`**.
- The ceiling from both legs is **`{"BUG":48,"FEAT":39,"ARCH":9}`**, with 58 headings each and no duplicates. The next mintable id is **`BUG-049`**; nothing was minted.
- `main`'s push run `36653823369` succeeded, printing `SKIP_BASELINE_OK ci-node20: 96 skipped` and `SKIP_BASELINE_OK ci-node24: 13 skipped`.

**Every count boundary matched its prediction:**

| Boundary | Result |
|---|---|
| Task 0, plan (`510b72e`) | 1033 / 12 |
| Task 1 (`4f9f6c5`) | 1034 / 12 |
| Task 2 (`c536438`) | 1035 / 12 |
| Task 3, release (`4afb4e6`) | 1035 / 12 |
| PR run `36653547014` | `ci-node20` 951 / 96 (1047) and `ci-node24` 1034 / 13 (1047), both `SKIP_BASELINE_OK` |

`tools/skip-baseline.json` is unchanged. Both new tests were watched red first:
- the description test received the old string;
- the BOM test expected `35` and received `239`.

**BOM, byte level.** `README.md`'s first 16 bytes:
- before: `efbb bf23 2063 6f64 652d 636f 6e64 7563  ...# code-conduc` (35260 bytes);
- after: `2320 636f 6465 2d63 6f6e 6475 6374 6f72  # code-conductor` (35257 bytes).

`git diff --numstat` read `1 1 README.md`. The release diff moved only the version lines of `package.json` (1/1) and `package-lock.json` (2/2), and the lock carries no `keywords`.

**R1, recorded in the plan.** Only two tests read this repo's `package.json`:
- `tests/installer/manifest.test.js` (name, bin, files, `repository.url`, type, engines, publishConfig);
- `tests/tools/tools-not-shipped.test.js` (`files`).

Neither asserts `description` or `keywords`.

### Verification (spec main path)

- **Step 4, npm: PASS, on the one re-query the spec allows.**
  - Publish run `36653978686` (release `v1.34.2`) succeeded, printing `+ @yeison.restrepo.r/code-conductor@1.34.2` at 01:12:49Z.
  - The query at 01:13:43Z still returned `1.34.1`: `@1.34.2` gave E404 and `dist-tags` read `latest: 1.34.1`. npm itself said "may take a few minutes to become available".
  - The re-query four minutes later read:
    - `description` === V1: `true`;
    - `keywords` === V2, in order: `true`;
    - `version`: `1.34.2`;
    - `gitHead`: `241838a`, equal to the `v1.34.2` tag's commit.
- **Step 6, GitHub: FAIL, three reads over about ten minutes.** This is the spec's error case. It was reported to the owner, and the agent did not edit anything.
  - `gh repo view` and `gh api repos/...` both show the pre-FEAT-038 About, "Spec-first workflow engine for Claude Code: /cc-spec → /cc-plan → /cc-implement, with automatic stack profiles, …". About === V1 is `false`.
  - The topics are the original nine.
    - The four removals are all still present: `agent`, `claude-ai`, `claude-code-plugin`, `tokens`.
    - The six additions are all still missing: `ai-agents`, `claude-code`, `claude-code-hooks`, `cli`, `developer-tools`, `guardrails`.
  - `usesCustomOpenGraphImage: false`, unchanged as expected.
  - The repo's `updated_at` is 01:10:17Z, around the release publish, and no later.
  - The owner reported the checklist done, but no settings save reached the repository. The owner was told, and continued the closeout with step 6 left open.
  - **Resolved: PASS on the fourth read.**
    - The owner ran the spec's comma-form `gh repo edit` inside the session with the `!` prefix. It exited silently: `gh` accepted the comma form, so R2's per-term fallback was not needed.
    - The repo's `updated_at` moved to 01:36:02Z.
    - Checks: About === V1 byte for byte is `true`. The topic set equals V2 (`+ none − none`), and none of the four removals is present. `usesCustomOpenGraphImage` is still `false`.
    - **Lesson:** the owner act was reported done twice before any edit had reached the repository, and the read-only verify step was the only thing that caught it. Running the command where its output lands in the session turned an unverifiable claim into an observed exit.
- **Step 7, npm H1 render: PASS**, confirmed by the owner in a browser.

### Record

- **The values, as shipped.**
  - V1: "A governance layer for Claude Code sessions: hooks that check an agent's commands before they run, a spec-first workflow, and project memory the next session reads."
  - V2: `agentic-development, ai-agents, claude, claude-code, claude-code-hooks, claudecode, cli, developer-tools, guardrails, skills, spec-driven-development`.
  - Topics removed, with reasons:
    - `claude-code-plugin`: unbacked (an installer CLI, not a plugin; `project.md:395`), and load-bearing;
    - `claude-ai`: names a product the project does not target;
    - `agent`: redundant with `ai-agents`;
    - `tokens`: claims nothing searchable.
  - **`multi-agent` is held** until Pillar 3 (`[ARCH-009]`) ships its first agent. That release's spec adds it to both lists.
- **`[BUG-048]`'s named risk, discharged.** Its plan named `publish.yml` as unexercised by any PR run, so its first execution would be the next publish. That first run under the BUG-048 changes (actions at their node24 majors, suite on Node 24) was the `1.34.1` release, run **`36650007346`, conclusion success**, at `fbcf259`. The second, `36653978686` for `1.34.2`, also succeeded (publish job 36s, run 40s). The owner's screenshot shows the run page: its only annotation is the Ubuntu 26 `ubuntu-latest` migration notice (out of scope, as at `1.34.1`), and there is no Node 20 action-runtime deprecation.
- **SPECIMEN, not minted: an intermittent commit-hook hang in `tests/scripts/snap-build.test.js`.** Filed in the backlog's new dossier with its minting condition, which is **recurrence**.
- **Review minors, left as-is:**
  - the ASCII and one-sentence checks in `repo-invariants.test.js:79-80` cannot fail before the exact-match `toBe` at :76 does, so they are defence in depth;
  - an "e.g. " in a future description would false-red the sentence count, and the exact match forces a spec edit first anyway.

  The whole-branch reviewer (most capable model, run in parallel with CI) found no Critical or Important issues.
- **`[ARCH-009]` observation: the execution criterion has stabilized across three field executions.**
  - FEAT-021 ran native: sequential, exact code, mostly deletion.
  - BUG-048 ran hybrid: independent build tasks were subagent-driven, and live-CI orchestration stayed in-session.
  - FEAT-038 ran native: an S, with four tasks appending to one test file.

  **The criterion:**
  - subagent-driven when tasks are independent enough that fresh-context isolation buys review value;
  - native when tasks are small, strictly sequential and share files;
  - hybrid when a plan holds both.

  It is a routing rule for the Build band, recorded in `personal.md` Workflow Preferences as the refinement of the standing subagent-driven preference.
- **Working ledger** `.superpowers/sdd/2026-09-29-feat038-discoverability-metadata/`: deleted, on owner confirmation.

### Queue

Nothing minted. The FEAT-038 owner half is verified (step 6 above), and `LAUNCH-CHECKLIST.md`'s `[FEAT-038]` prerequisite is now true; ticking it is the owner's act. `[BUG-045]` remains open on the owner's word. **The next mintable id is `BUG-049`.**

## Closeout: 1.34.3, the README's defect, dossier and instrument claims derived from the tree [2026-09-29]

Patch **`1.34.3`** shipped (PR #47, squash `6922af0`). It carries no backlog item: it is documentation accuracy from the 2026-09-29 pre-launch audit's Class A rulings, and its CHANGELOG bullets carry no id marker, so record parity reads zero `1.34.3` claims by design. The owner waived a spec: the edits were ruled line by line, and a lean plan plus the release ritual was judged enough (`docs/superpowers/plans/2026-09-29-docs-accuracy-1-34-3.md`). **This release discharges the company-internal sharing prerequisite:** from `1.34.3` the repo is shareable inside the owner's company, and the README on npm matches the tree.

**Sync.** Measured before acting: **`0 ahead / 1 behind`**, which is clean. `main` was fast-forwarded to `6922af0`.

**Instrument output on the merged tree:**
- **`VERSION_GATE_OK 1.34.3`**.
- **`RECORD_PARITY_OK`**.
- The ceiling from both legs is **`{"BUG":48,"FEAT":39,"ARCH":9}`**, with 58 headings each and no duplicates. The next mintable id is **`BUG-049`**; nothing was minted.
- `main`'s push run `36658863428` succeeded, printing `SKIP_BASELINE_OK ci-node20: 96 skipped` and `SKIP_BASELINE_OK ci-node24: 13 skipped`.
- **Publish:** run **`36658977844`** (release `v1.34.3`) **succeeded**, printing `+ @yeison.restrepo.r/code-conductor@1.34.3` at 02:15:51Z. This is the third consecutive success under the BUG-048 workflow.
- **npm:** the first read after the sync still showed `1.34.2`, the same lag as at `1.34.2`. The re-query read `version 1.34.3` and `gitHead 6922af0`, equal to the tag's commit.

**Eight predictions, eight matches:**

| Boundary | Predicted | Measured |
|---|---|---|
| Task 0, plan (`b7a8b7d`) | 1035 / 12 | 1035 / 12 (1047) |
| Task 1, `repo-invariants` red | 4 failed / 8 passed | 4 failed / 8 passed |
| Task 1, `repo-invariants` green | 12 passed | 12 / 12 |
| Task 1 commit (`142044e`) | 1039 / 12 | 1039 / 12 (1051) |
| Task 2 commit (`2186e0d`) | 1039 / 12 | 1039 / 12 |
| Task 3, release (`d13a2a3`) | 1039 / 12 | 1039 / 12 |
| PR run `36658702670`, `ci-node20` | 955 / 96 | 955 / 96 (1051), `SKIP_BASELINE_OK` |
| PR run `36658702670`, `ci-node24` | 1038 / 13 | 1038 / 13 (1051), `SKIP_BASELINE_OK` |

`tools/skip-baseline.json` is unchanged. The owner's original prediction was "docs-only, so 1035 / 12". The plan corrected it to +4 passed, because the red-green pins add tests while the skipped sets, the only thing the baseline asserts, do not move. The owner confirmed the correction.

### Content

- **README claims are now derived, not counted.** Four `tests/tools/repo-invariants.test.js` tests pin them, and each was watched red first:
  - **Known limits lists exactly the backlog's open BUG headings.** It now shows `[BUG-045]` and `[BUG-032]`, one bullet each; before, it named `[BUG-045]` as "the one open filed defect". Sweep items 4 and 7.
  - **The dossier count follows the backlog's `### DOSSIER` headings.** It now reads three, including the `snap-build` hang dossier opened in `7fc283d`. Sweep item 8.
  - **Every tracked `tools/*.mjs` is named, and the count leads the section.** There are four, and each states how it runs: `skip-baseline.mjs` directly at `test.yml:46`, `version-gate.mjs` and `record-parity.mjs` at the merge gate through `repo-invariants`, and `id-ceiling.mjs` local-only by ruling. Sweep item 9.
  - **No automatic-install claim for ui-ux-pro-max.** No shipped code installs it; the README now calls it retired guidance pending `[FEAT-037]`, and the Problem-table row claiming automatic activation was deleted by ruling. The residual is left to `[FEAT-037]`: `global/CLAUDE.md:86` and `project-template/CLAUDE.md:49,75` still name it, and the README says so. Sweep item 10.
- **`RECORDING-SCRIPT.md:19`:** the off-camera install output is now "empty", as measured against `1.34.2` from a scratch `HOME`. Sweep item 11.
- **Show HN freeze line.** `SHOW-HN-DRAFT.md` carries one line recording the Class B ruling. Sweep items 1–6 are deferred to a single regeneration on posting eve, each figure recomputed by its own stated method, and nobody patches them piecemeal in between.
- **Two uncharacterized specimens in the session denial tally dossier, from one day of ordinary work:**
  - **P7**, the audit's chained read (`2186e0d`). The entry also corrects the audit report, which had called it the `[BUG-041]` residual without a probe.
  - **P5**, the PR #47 CI read, chained with a `$(...)` substitution. It also opens with `cat <file> | tail`, so the trigger is not assumed. Recorded in this closeout's commit.

  Both were decomposed into scratchpad scripts: no inline retry, no allowlist entry, no probe. They are evidence for sizing a future Guard 3 refinement spec, with no cause claimed.

### Pre-launch audit, for the record

The read-only audit at `06fd2ca` produced these results:
- **Instruments:** all green.
- **Quickstart:** the transcript reproduced from a fresh `mktemp -d` with a fresh `HOME`: `1.34.2`, rc 0, 0 bytes on stdout and stderr.
- **Recording scenes:** all four verdicts matched through the scaffolded hook: `P4` deny, allow, heredoc allow, `P4` deny.
- **Listings:** the npm and GitHub listings equal V1 and V2.
- **Social preview and issues:** `usesCustomOpenGraphImage: false`, and 0 open issues.

**What is left before posting is owner acts:** the GIF, the social preview decision, the `[BUG-045]` issue, the Show HN regeneration on posting eve, and the Quickstart re-run on the day of posting.

### Queue

Nothing minted. **The next mintable id is `BUG-049`.** Next: `/cc-spec ARCH-009`, scoped to the vertical slice by the owner's addendum. The deliverable is the band contract with its gate enum and the SNAP v2 fields going live, sized so FEAT-011 and FEAT-012 can ship one real Code-to-QA handoff. FEAT-031 through FEAT-036 are post-launch. The slice is timeboxed by the owner, and the public launch does not wait for it.

## Checkpoint 2026-09-30 00:30

`main` is at **`3020163`**: `1.34.3` has shipped and its closeout is recorded. `[ARCH-009]` has not started; its `/cc-spec` was entered and paused at Question 1 (the band fields go live as v3, recommended, or by widening v2). A P0-class field defect takes the queue's head: an existing project `CLAUDE.md` replaced on a `--project` install. It is to be filed as `BUG-049` and ship as `1.34.4`.

### Decisions

- **The pre-launch audit is read-only, and every claim cites its source.** Class A findings (false today) shipped as `1.34.3`. Class B, the Show HN figures, is frozen until one regeneration on posting eve.
- **README claims that can be derived from the tree are pinned by `repo-invariants` tests:** the open BUG headings, the dossier count, the `tools/*.mjs` instruments, and the absence of a ui-ux-pro-max install claim. A new drift fails the merge gate.
- **A docs-only patch may skip `/cc-spec` when the owner has ruled each edit line by line.** A lean plan plus the release ritual is then enough.
- **Release commits use `chore: release X.Y.Z`.** A release that claims no item puts no id marker on any CHANGELOG bullet, so record parity reads zero claims.
- **`[ARCH-009]` slice direction.** The contract layer is the band table, the gate enum and the live SNAP fields, sized for one Code→QA handoff. FEAT-031 through FEAT-036 come after launch.

### Conventions

- **A denial dossier specimen makes no cause claim without a probe.** `2186e0d` corrected the audit's own unprobed P7 attribution.
- **Count predictions are restated for red-green pins.** Four new passing tests move the passed counts by four and the skipped sets by zero.

### Technical debt

- **The `CLAUDE.md` templates still name ui-ux-pro-max as active** (`global/CLAUDE.md:86`, `project-template/CLAUDE.md:49,75`). Left to `[FEAT-037]`.
- **Two uncharacterized denials sit in the session denial tally:** P7 from the audit, P5 from the PR #47 CI read. No probe has run on either.

### Workarounds

- **npm registry lag after a publish.** The first `npm view` still shows the previous version. Re-query a few minutes later rather than reading the lag as a failure.
- **Guard 3 denials on chained, piped or substituted read commands.** Put the reads in a scratchpad script and run it with `bash`. Never add an allowlist entry for this.

## Spec: BUG-049, CLAUDE.md ownership by sentinels only, append-only, backup reported [2026-09-30]

The spec is `docs/superpowers/specs/2026-09-30-bug049-claude-md-clobber-design.md`, APPROVED 2026-09-30 with its six rulings. It targets `1.34.4`, patch, complexity M, and holds the queue's head because it gates company-internal sharing.

- **Measured mechanism:** `merge-md.mjs` `mergeClaudeMdText` (`:81`) decides ownership by heading name.
  - A 15-heading host-edited project file loses 8 of 15 host lines, silently.
  - `--global` loses 12 of 12.
  - The pre-image backup is written but unreported, and `*.installer-backup.*` hides it from git.
  - `.gitignore` loses nothing.
- **Fix:** conductor owns only its sentinel block.
  - A sentinel-less file gets the block appended, with nothing else changed: no heading dedupe, no scaffold append, no repair of damaged input (AC9b, with a field-verbatim head).
  - A balanced block has its interior refreshed.
  - Every write is backed up first (ordering proved by fault injection) and its path is reported on stdout, with backups still git-ignored.
  - `.gitignore` gets one labelled block holding the measured three entries: exact-line entries are gathered into it, modified variants are left alone, and nothing moves if the file has any `!` line.
- **Two-run shape (sealed by the field fingerprint):** an old pre-sentinel generation overwrote the company file with no backup, then 1.34.3 backed up the damaged file. The field damage (two label characters eaten, a `* ` prefix) has no historical code match and its mechanism is unknown.
- **README:** `1.34.4` is stated as the minimum safe version, pinned so it can never exceed `VERSION`.
- **Out of scope:** `[FEAT-040]`, filed by this spec (ceiling `{"BUG":49,"FEAT":39,"ARCH":9}` on both legs), which is `/cc-stack`'s semantic adoption with approval-gated writes and queues behind `[ARCH-009]`.
- **Plan:** it opens with full reads of `merge-md.mjs`, `deploy.mjs` and `file-merge.mjs`. Its Review Focus names re-deriving the tests that asserted the old destructive semantics, `merge-md.test.js:84` first.
- **Owner precisions for the plan (2026-09-30):**
  1. **Re-derived tests** (`merge-md.test.js:84` inverted; `:49` and `:162` revisited) are written from the spec's contract, `host + separator + block` byte-exact. They are never written by negating the old assertion text, because a negated destructive assertion can pass for the wrong reason. Each re-derived test states the AC it pins.
  2. **AC7's fault injection** needs a seam that makes `backupFile` and `writeAtomic` throw on command. The plan says where that seam lives and why it cannot fire in production: an installer shipping an unguarded fault injector is not acceptable in this fix.

## Closeout: 1.34.4, CLAUDE.md ownership by sentinels alone, backups reported [2026-09-30]

Patch **`1.34.4`** shipped `[BUG-049]` (PR #48, squash `7fbe120`). Plan: `docs/superpowers/plans/2026-09-30-bug049-claude-md-clobber.md`. Spec: `docs/superpowers/specs/2026-09-30-bug049-claude-md-clobber-design.md`.

**Sync.** Measured before acting: **`0 ahead / 1 behind`**, which is clean. `main` was fast-forwarded to `7fbe120`.

**Instrument output on the merged tree:**
- **`VERSION_GATE_OK 1.34.4`**.
- **`RECORD_PARITY_OK`**. On the branch, the discriminator flip of `[BUG-049]` back to `[ ]` went red with 4 violations naming `1.34.4`, then green on restore.
- The ceiling from both legs is **`{"BUG":49,"FEAT":40,"ARCH":9}`**, with 60 headings each and no duplicates. The next mintable id is **`BUG-050`**; nothing was minted.
- **Push run on `main`:** `36797537104` succeeded at 985 / 96 and 1068 / 13 (1081 each), printing `SKIP_BASELINE_OK ci-node20: 96 skipped` and `SKIP_BASELINE_OK ci-node24: 13 skipped`.
- **PR run:** `36797375017` measured the same numbers. `tools/skip-baseline.json` is unchanged.
- **Local suite on `main`:** 1069 / 12 (1081), with 42 test files passed and 1 skipped (43).
- **Publish:** run **`36797652237`** (release `v1.34.4`) **succeeded**, printing `+ @yeison.restrepo.r/code-conductor@1.34.4`, with a provenance statement in the transparency log.
- **npm:** the first read at 00:45:51Z still showed `1.34.3`, the usual lag. The registry poll read `1.34.4` at 00:46:21Z, and `npm view` reads `version 1.34.4` and `gitHead 7fbe1207df37…`, equal to `v1.34.4`'s commit.

**Every count boundary matched its prediction, after one amendment made before measurement:**

| Boundary | Measured |
|---|---|
| T-000 | 1039 / 12 |
| T-001 | 1045 / 12 |
| T-002 | 1052 / 12 |
| T-003 | 1064 / 12 |
| T-004 | 1064 / 12 |
| T-005 | 1065 / 12 |
| Review fix pass | 1069 / 12 |
| CI | 985 / 96 and 1068 / 13 |

The original gate was 1065, 981 and 1064. The owner moved it to 1069, 985 and 1068 for the review fix pass's 4 tests, written into the plan text before anything was run (the FEAT-021 rule).

**Red runs, each verified against the unchanged engine with every failure named:**
- T-001-E: 18 failed. All were `toBe` mismatches showing host content lost or the scaffold appended.
- T-002-D: 12 failed.
- T-003-F: 9 failed. The AC7 failures were thrown by the injected faults themselves, which proves the injector reaches `file-merge.mjs`.
- T-005: the floor test went red twice: first with the floor missing, then with the floor above `VERSION`.
- Review fix pass: 4 failed.

### Content
- **The incident arc.**
  1. The field clobber was reported on nymbl (`1.34.3`).
  2. The mechanism was measured: heading-name ownership in `mergeClaudeMdText`, plus the pre-sentinel migration scoped to more than the README claimed. It silently removed host sections under the eight managed headings, and all 12 under `--global`.
  3. The two-run shape was sealed by the heal-line fingerprint: an old pre-sentinel generation overwrote the file with no backup, and `1.34.3` then backed up the damaged file and stripped it.
  4. The fix shipped as sentinel-only ownership with an append-only merge. Ordering is backup, report, write, proven by injected faults; reports go to stdout; and `.gitignore` gets one labelled block with a negation guard.
- **Third pattern-versus-concept sighting.** The review's fence finding was a scanner implementing a rule narrower than the standard it claims: it closed on any `` ``` `` run, where CommonMark requires the same character at least as long, up to 3 spaces indented. It joins the no-graphify check and the skip-count green.
- **Tally dossier.** The P5 from this session's red-log read joins the 2026-09-29 P7 and the `1.34.3` P5, as the owner earmarked. Recorded in the same subsection, so the count is not understated:
  - this session also produced a P7 (plan-mapping greps) and a P9 (an inline `for` poll loop), both uncharacterized;
  - and a P4 on `cat vitest.config.*`, held as a candidate for striking as the guard working correctly.

  The dossier now holds six uncharacterized specimens, including the 2026-09-28 P5, plus the one P4 candidate.
- **`[ARCH-009]` field observation: plan-parsing tooling is band infrastructure.** The superpowers `task-start`/`task-done` scripts could not read this plan's `[T-00N]` checkbox format ("no heading matching 'Task 1'"), so progress was tracked by hand. A format that the executor's tools cannot read is a handoff defect between the plan author and the plan executor.
- **Known reporting edge (Low 4).** The CLAUDE.md report prints "(git-ignored by design)" before the `.gitignore` merge resolves. If that merge is then skipped or its write fails, the claim is false for that one run. This is the candidate for a cheap later fix if the report line ever changes anyway.
- **Lows recorded without a change:**
  - Low 3: a doubled blank line or an orphan header can remain after gathering. Cosmetic and idempotent.
  - Low 6: a whitespace-only host is replaced with no backup, which spec main path 1 mandates.
- **Owner ruling, Low 2: output accompanies writes.** A run that writes nothing prints nothing; AC10e's notice fires only on the writing run.
- **The reviewer's declined-to-judge items**, none fixed here:
  - AC9 across 5+ upgrades: `MAX_BACKUPS = 5` eventually prunes the pre-first-run backup of a host whose block interior was edited (existing retention policy).
  - The `-10` collision suffix sorts before `-2` in the prune order (existing, `settings.mjs`).
  - In a negation host, the block appended at EOF after `!` lines could override a host re-include of the same pattern. The spec mandates appending the absent entries.
  - A `.gitignore` entry with leading whitespace is gathered, although git treats leading spaces as significant. Unrealistic input.
  - CommonMark edges beyond fence length and indentation (HTML blocks, indented code blocks hiding sentinels): the spec is silent, and nothing is destructive under append-only.
  - README prose beyond the floor invariant was outside the review's focus.
  - A symlinked cwd combined with a symlinked CLAUDE.md prints an absolute path and no ignore claim, which errs toward honesty.
- **Company channel unblocked.** `1.34.4` is the minimum safe version, stated in the README's Quickstart and Install sections per AC13 and pinned at or below `VERSION` by `repo-invariants`. Company-internal sharing is now open, which supersedes the `1.34.3` closeout's discharge line, voided by `[BUG-049]`.

### Queue
Nothing minted. **The next mintable id is `BUG-050`.** Next: resume `/cc-spec ARCH-009` from its checkpoint, at Q1: band fields as v3 (recommended), or widen v2. `[FEAT-040]` queues behind it. The plan's execution workspace (`.superpowers/sdd/…`, untracked) was deleted with this record.

## Spike: does PreToolUse identify subagent tool calls? (ARCH-009 spec, Q3) [2026-09-30]

- **Binary:** `claude` 2.1.286 (Claude Code), run with `claude -p` (non-interactive) in a scratch git repo outside this repository. One project PreToolUse hook (`matcher: "*"`) appended each raw payload to a log and allowed every call. One subagent definition, `.claude/agents/probe-writer.md` (`tools: Write`). Three payloads were logged.
- **Control (main session):** two payloads.
  - The `Write` of `main.txt` carried keys `session_id, transcript_path, cwd, prompt_id, permission_mode, effort, hook_event_name, tool_name, tool_input, tool_use_id`.
  - The `Agent` delegation carried the same keys, with `tool_input.subagent_type: "probe-writer"`.
- **Specimen (subagent):** the `Write` of `sub.txt` carried the same keys **plus `agent_id` (`"afb1811e0bd10da56"`) and `agent_type` (`"probe-writer"`)**. `session_id` was identical to the main session's.
- **(a) Does PreToolUse fire for subagent tool calls?** Yes.
- **(b) Which identity fields arrive, as raw payload keys?** `agent_id` and `agent_type`. `agent_type` equals the agent definition's `name`.
- **(c) Can the hook distinguish the main session from a subagent?** Yes. The main-session payloads carry neither key, and `session_id` cannot distinguish them, because the subagent shares it.
- **Limits of the measurement:** one run, one version, `-p` mode only, and the interactive mode was not measured. The finding is version-pinned to 2.1.286, as the gh escape-sequence finding was pinned to gh 2.100.0. `agent_type` is a name the hook takes on trust: any agent definition can be named `code`.
- **Handoff observation:** the spike's protocol (control run, three verbatim questions, version beside the output) was supplied in full by the owner's amendments. Nothing was missing, and the scratch directory was deleted after this record.
- **AC11 interactive re-run (2026-10-01, `claude` 2.1.286, interactive mode):** the same binary the `-p` spike measured, so mode is the only variable between the two measurements. Same fixture and prompt, owner driving the terminal. Reader output, verbatim:
  ```
  Write ["session_id","transcript_path","cwd","scratchpad_dir","prompt_id","permission_mode","effort","hook_event_name","tool_name","tool_input","tool_use_id"] agent_id=- agent_type=-
  Agent ["session_id","transcript_path","cwd","scratchpad_dir","prompt_id","permission_mode","effort","hook_event_name","tool_name","tool_input","tool_use_id"] agent_id=- agent_type=-
  Write ["session_id","transcript_path","cwd","scratchpad_dir","prompt_id","permission_mode","agent_id","agent_type","effort","hook_event_name","tool_name","tool_input","tool_use_id"] agent_id=a91d393e3141ffb3a agent_type=probe-writer
  SubagentHandback ["session_id","transcript_path","cwd","scratchpad_dir","prompt_id","permission_mode","agent_id","agent_type","effort","hook_event_name","tool_name","tool_input","tool_use_id"] agent_id=a91d393e3141ffb3a agent_type=probe-writer
  Bash ["session_id","transcript_path","cwd","scratchpad_dir","prompt_id","permission_mode","effort","hook_event_name","tool_name","tool_input","tool_use_id"] agent_id=- agent_type=-
  Bash ["session_id","transcript_path","cwd","scratchpad_dir","prompt_id","permission_mode","agent_id","effort","hook_event_name","tool_name","tool_input","tool_use_id"] agent_id=adcc0758336c23e70 agent_type=-
  ```
  (a) Yes: PreToolUse fired for the subagent's `Write` of `sub.txt`. (b) `agent_id` and `agent_type`, with `agent_type` equal to the definition's `name` (`probe-writer`), as in `-p`. (c) Yes: the main session's `Write` and `Agent` carried neither key, and `session_id` was one value across all six payloads, so it still cannot distinguish them. Halt rule not triggered. Key-set differences from the `-p` spike, recorded rather than halted on: (1) every interactive payload carries `scratchpad_dir`; (2) the subagent's hand-back fired PreToolUse as a `SubagentHandback` tool call carrying both identity keys; (3) after the probe, two `Bash` reads ran under a second `prompt_id`, and the second (`head -c 500 payloads.jsonl`) carried `agent_id` with **no `agent_type`**, an identity shape the `-p` run never produced. The second `prompt_id` is the owner's post-probe request for the session's change summary, and both `Bash` calls are that inspection: benign, post-measurement, and leaving the four probe payloads untouched. Interactive mode thus produced a main-session `Bash` carrying `agent_id` without `agent_type`, a combination `-p` never showed; Guard 5 arms on `agent_type` alone, so this state is Case A by construction, the measured validation of keying the guard on `agent_type` rather than `agent_id`. No design change. The probe directory is kept for T-007, which copies its `log.mjs` and `read-payloads.mjs`.

## Spec: ARCH-010, the band contract vertical slice (SNAP v3, gate enum, one Code→QA handoff) [2026-09-30]

The spec is `docs/superpowers/specs/2026-09-30-arch010-band-contract-vertical-slice-design.md`, APPROVED 2026-09-30 with six amendments. It targets `1.35.0`, a minor release, at complexity L. Branch `feat/arch-010-band-contract-vertical-slice`. `[ARCH-010]` was minted after the ceiling run on both legs (`{"BUG":50,"FEAT":40,"ARCH":9}`), and `[ARCH-009]`'s flip condition now includes it.

- **Q1, v3 rather than a widened v2, with ground 1 restated as measured:**
  - Installed 1.34.x readers fail generically on any newer envelope that carries new keys.
  - Readers from ARCH-010 onward give `SNAP_UNKNOWN_VERSION` for every later version.
  - `MAX_VERSION` goes to 3, with `TOP_FIELDS[3]` and `POST_PARSE_MAX[3]`. Block membership becomes per-version, with v1 and v2 byte-identical (AC2).
- **Q2, the id.** The slice ships under top-level `ARCH-010`. `[BUG-050]` (filed in `02cddea`) records that both instruments are silent on sub-shaped ids. Its repair, widening the instruments or failing loudly on a sub-shaped claim, is left to its own spec.
- **Q3, enforcement.** Guard 5 lives in the front door. The spike measured `agent_id` and `agent_type` on subagent payloads only, on `claude` 2.1.286 in `-p` mode. Guard 5 arms on the envelope plus an `agent_type` naming a role. QA's command-only side is its tools list; Guard 5 covers Code's path scope. The threat model is cooperative agents, not a hostile agent definition.
- **Q4, the enums.** All five gate values: `boundary_routed`, `define_approved`, `build_executed`, `verify_pass`, `ship_released`. Five roles. The asymmetry is deliberate: a gate value is topology, a role value is an implementation.
- **Folded defect.** The validator's version check moves first. This is the **second sighting of `[BUG-038]`'s check-order class in `snap-validate.mjs`**: the size check at `:7` first, then the field-versus-version pair.
- **Owner amendments:**
  1. `PROJECT_HOST_OWNED` gains its sixth `skip` row, `memory/band-envelope.json`.
  2. AC4 names the validator line-cap rewrite (`snap-validate.test.js:250`, cap 32), with the new count stated at plan time.
  3. The band root is the directory where the walk-up from `cwd` finds `.claude/memory/band-envelope.json`, and the `scope` globs anchor there.
  4. The baseline stays unchanged (AC15).
  5. `ship_released` is defined here; the Release-to-Ticket closure is `[FEAT-031]`'s.
  6. The AC1 and AC2 contract tests run red first.
- **Carried to `/cc-plan`:**
  - the interactive re-run of the logging probe as the first verification step (AC11);
  - the demo handoff with fixture agents (AC12);
  - per-environment predictions;
  - the restated line cap;
  - a one-line handoff observation per task.
- **Owner carry-forward for `/cc-plan` (2026-09-30), restated so that compaction cannot drop it:**
  1. **Predictions.** Per-environment predictions come before any run. The starting baselines are local 1081 / 0 (measured 2026-10-01; cause: the install deployed the personal skills globally, so the 12 conditional plugin tests now run), ci-node20 985 / 96 and ci-node24 1068 / 13 unchanged, because the CI runners carry no `~/.claude/skills` and their environments did not move. AC15 holds as written: the slice adds passing tests only: `tools/skip-baseline.json` does not change.
  2. **The interactive probe (AC11)** is the plan's first verification step, before any guard code. If the identity keys differ from the spike's, the plan halts for a ruling.
  3. **The Build-band routing criterion applies to this plan's own tasks:**
     - the contract and validator edits are small, sequential and share files, so they run native;
     - the hook guard and its test suite are isolated enough to consider a subagent;
     - the probe and the demo handoff are live, and stay in-session.

     The plan states the chosen split, per the three-origin criterion.
  4. **The line cap.** The validator line cap's new expected count is stated in the plan text before anything runs (AC4 as amended).
  5. **Handoff observations.** One line of handoff observations per task, as further `[ARCH-009]` evidence.
- **Reporting note:** The 02cddea BUG-050 filing commit was first reported in the turn after the ARCH-010 spec commit; the earlier claim that it was reported at the start of the Q3 turn could not be substantiated from any transcript.

## Checkpoint 2026-09-30 21:33

Session span: 1.34.4 closeout (`d9f56b3`), `[BUG-050]` filed (`02cddea`), the ARCH-009 questions resolved into the `[ARCH-010]` spec (`85df4cb`), `/cc-compact` at `85df4cb`. Branch `feat/arch-010-band-contract-vertical-slice`. The id ceiling now stands at `{"BUG":50,"FEAT":40,"ARCH":10}`.

### Decisions
- ARCH-010 spec APPROVED with six amendments; target 1.35.0, L. SNAP v3 with per-version BLOCK_FIELDS; v1/v2 byte-identical (AC2).
- The validator decides `v` before field sets (folded defect, second sighting of the BUG-038 check-order class).
- Guard 5 arms only on `.claude/memory/band-envelope.json` plus a payload `agent_type` naming a role; the main session is never subject. The threat model is cooperative agents.
- The ARCH-009 flip condition now includes ARCH-010.

### Conventions
- Five carry-forward points for `/cc-plan` sit uncommitted in this file and are committed with the plan's Task 0 (BUG-049 precedent).
- Every commit a turn makes is named in that turn's closing report, not only in mid-turn narration.

### Debt and workarounds
- `[BUG-050]`: the parity and ceiling instruments silently skip sub-shaped ids; repair left to its own spec.
- The plan helper scripts `task-start` and `task-done` cannot parse `[T-00N]` plans; progress is tracked by hand (an ARCH-009 observation).
- Guard 3 denies `for` loops, `$()` chains and piped multi-greps; route them through scratchpad scripts rather than allowlist entries.

## Incident 2026-10-01: the installer swept this repository's own `scripts/`

- **Trigger.** The installer ran inside this repository, at 2026-10-01 12:46:19Z (07:46:19 local), as `npx code-conductor --project` per the owner. The stamp is shared by the backups it wrote: `CLAUDE.md.installer-backup.20261001T124619Z`, `.gitignore.installer-backup.20261001T124619Z`, and `~/.claude/CLAUDE.md.installer-backup.20261001T124619Z`.
- **Mechanism, established by code reading.** `sweepStaleRootScripts` (`lib/installer/deploy.mjs:142-149`, called from `deployProject` at `:211`) removes `<cwd>/scripts` with `rmSync` whenever its file list equals the bundled `scripts/` list exactly (`:147-148`). The heuristic exists for the 1.23.2 legacy deployment. In the development repo it is satisfied by identity, because the bundle is built from this very directory. `:212` then deployed the normal copy to `.claude/scripts/`.
- **Corrected diagnosis.** The first `/cc-resume` report called the scripts "moved". They were swept. `.claude/scripts/` is the ordinary deployment copy, and in this repository the `/cc-stack` command path was not the defect.
- **Inventory, `git status --porcelain` verbatim, before anything was touched:**
  ```
   M .claude/commands/cc-implement.md
   M .claude/commands/cc-init.md
   M .claude/commands/cc-plan.md
   M .claude/commands/cc-spec.md
   M .claude/hooks/context-guard.sh
   M .claude/memory/project.md
   M .claude/settings.json
   M .gitignore
   M CLAUDE.md
   D scripts/claude-md-fields.mjs
   D scripts/conductor-db.mjs
   D scripts/detect-stack.mjs
   D scripts/init-wizard.mjs
   D scripts/resume-read.mjs
   D scripts/session-id.mjs
   D scripts/snap-build.mjs
   D scripts/snap-contract.mjs
   D scripts/snap-validate.mjs
  ```
  Ignored: `.claude/scripts/`, `.gitignore.installer-backup.20261001T124619Z`, `CLAUDE.md.installer-backup.20261001T124619Z`.
- **Count: 17 installer-touched paths**, plus `.claude/memory/project.md`, which was session-modified and excluded. The installer never writes `.claude/memory/` (the `BUG-039` skip rows held), and its +31 lines were this session's own deliberate writes: the carry-forward block, the reporting note and the 2026-09-30 21:33 checkpoint.
- **Restore.** I ran `git restore` on the 17 explicit paths, with no blanket form: the 9 `scripts/*`, the 4 `.claude/commands/*`, `.claude/settings.json` (an added PowerShell hook), `.claude/hooks/context-guard.sh` (content and the 100755 mode), `CLAUDE.md` (duplicated sections) and `.gitignore` (an appended `*.installer-backup.*` rule). After proof, I removed `.claude/scripts/` and both repo-root backups.
- **Proof:**
  - `git status --porcelain` shows only ` M .claude/memory/project.md`.
  - The `context-guard.sh` diff is empty, mode included.
  - `npm test` reads 1081 passed / 0 skipped across 43 files.
  - `id-ceiling` reads working tree `{"BUG":50,"FEAT":40,"ARCH":10}` and `origin/main` `{"BUG":50,"FEAT":40,"ARCH":9}`; the ARCH gap is only `85df4cb`, unpushed. The union is `{"BUG":50,"FEAT":40,"ARCH":10}`, next `BUG-051`.
  - `record-parity` reads `RECORD_PARITY_OK`.
- **Test divergence, accepted as proof.** The prediction 1069 / 12 was made against the pre-install environment.
  - **Mechanism:** the conditional gate at `tests/plugin/code-conductor-plugin.test.js:8` runs 12 tests only when the personal skills exist under `~/.claude/skills`.
  - **Arithmetic:** 12 skips became 12 passes, and the total is unchanged at 1081.
  - **Trigger:** the same install wrote those `SKILL.md` files at 2026-10-01 07:46:19 local.
  - **Baseline:** the local baseline moves forward to 1081 / 0. The environment was not edited to fit the old record.
- **The two halves of the install.** The project half was damage, and it is restored. The global half (`~/.claude` commands, hooks, skills, and the `CLAUDE.md` managed-block merge with its backup) stands as a legitimate if unintended upgrade of this machine's global environment. Its one measured consequence is the local skip-set change above. There is no `~/.claude` rollback.
- **The global half's receipts, linked 2026-10-01 at ARCH-010 T-001:** `~/.claude/CLAUDE.md.installer-backup.20261001T124619Z` and `~/.claude/settings.json.installer-backup.20261001T124619Z`, both 07:46 local, the same stamp as the repo-side backups above. One run, two halves; this is not a new `[BUG-052]` sighting.
- **Field observation.** `pre-tool-use.mjs` never appeared in the inventory, because the deployed mirror is byte-identical under the parity contract. That is the mirror-parity test confirmed in the field by an accident.
- **`[ARCH-009]` field evidence.** An installer run is a baseline-changing event: a gate's green moved without one line of the repo changing.
- **Filings:** `[BUG-051]` (the `cc-stack.md` detector path) and `[BUG-052]` (no self-install guard; the sweep heuristic cannot tell the legacy deployment from the source tree).
- **`[BUG-051]` reverse-direction sighting, 2026-10-01, evidence for its spec.** The upgraded global `/cc-compact` called `.claude/scripts/*`, but the development repo carries `scripts/`; the filing's class ran the other way. Together the two directions constrain the repair: global commands run in both worlds, so path resolution must go by presence, trying one layout and falling back to the other. Interim workaround for this repo: run the scripts from source, as `scripts/*.mjs`.

## Incident 2026-10-01 (second): the pre-commit test gate wrote into this repository from a linked worktree

Linked to the installer incident above: this happened while I was filing its `[BUG-051]` amendment.

- **Trigger.** I created a linked worktree of `main` at the session scratchpad (`…/scratchpad/main-wt`) and symlinked `node_modules` into it so that `tests/tools/repo-invariants.test.js` could run there (13 / 13 passed). The symlink armed the `code-conductor:test-gate` pre-commit hook, which skips without `node_modules`. It had skipped for `6cb84e7` and `a091c7d`. At 09:34:10 local, `git commit` of the amendment ran the full suite, which read 30 failed / 1051 passed. The amendment commit never landed.
- **Fixture commits on local `main`**, pinned verbatim before any ref moved (`sha | author | timestamp | subject`):
  ```
  231679062ec68ea4feccd785092786d0ed88e927 | Yeison Restrepo <yeison.restrepo.r@gmail.com> | 2026-10-01T09:34:10-05:00 | init
  c840a01c113c69ed28216b639f2a0e6e05733a9f | Yeison Restrepo <yeison.restrepo.r@gmail.com> | 2026-10-01T09:34:10-05:00 | init
  7d78e3f60e705767e88171eab595ff82db45d829 | Yeison Restrepo <yeison.restrepo.r@gmail.com> | 2026-10-01T09:34:10-05:00 | init
  8d62cc96d4400c950ed2363605db74250ccaaccc | Yeison Restrepo <yeison.restrepo.r@gmail.com> | 2026-10-01T09:34:10-05:00 | init
  24ce8ca61565a62dac80b9c4e02f2f8919685234 | Yeison Restrepo <yeison.restrepo.r@gmail.com> | 2026-10-01T09:34:10-05:00 | init
  ```
  Their parent is `a091c7d`, and `24ce8ca` deletes the repository's files.
- **`git config --local --list`, after the damage:**
  ```
  core.repositoryformatversion=0
  core.filemode=true
  core.bare=true
  core.logallrefupdates=true
  core.ignorecase=true
  core.precomposeunicode=true
  remote.origin.url=git@github.com:yeisonrestrepo/code-conductor.git
  remote.origin.fetch=+refs/heads/*:refs/remotes/origin/*
  branch.main.remote=origin
  branch.main.merge=refs/heads/main
  branch.main.vscode-merge-base=origin/main
  branch.docs/launch-prep.remote=origin
  branch.docs/launch-prep.merge=refs/heads/docs/launch-prep
  branch.docs/quickstart-repair.remote=origin
  branch.docs/quickstart-repair.merge=refs/heads/docs/quickstart-repair
  branch.feat/arch-010-band-contract-vertical-slice.vscode-merge-base=origin/main
  user.email=t@t.t
  user.name=T
  ```
  Diffed against the expected entries, three are fixture writes: `core.bare=true` (it was false, since the primary checkout worked until 09:34) and the added `user.email=t@t.t` and `user.name=T`. The global identity is unaffected. `.git/config` mtime is 09:34:16.
- **Hook integrity:**
  - `git config --get-all core.hooksPath` returns rc 1, so no entry exists.
  - Newest mtime in `.git/hooks/` is 2026-06-30. `pre-commit` (359 bytes, 14:01:02) is the unmodified `code-conductor:test-gate`, and everything else is a `.sample`.
  - No hook was planted.
- **Other `.git` state:**
  - `HEAD`, `ORIG_HEAD`, `packed-refs` and `logs` are untouched.
  - `refs/heads/main` was written at 09:34:11.
  - The `.git` directory's own mtime is 09:34:31, but its entry list is the standard set. I read that as a transient lock, unexplained beyond that.
- **Not damaged:**
  - `feat/arch-010-band-contract-vertical-slice` is still at `85df4cb`.
  - The primary working tree shows only `M .claude/memory/project.md`.
  - All other branches and tags are unchanged, and `origin/main` is `02cddea`, never pushed.
- **Interim mitigation:** the test gate is not run from linked worktrees until `[BUG-053]` closes.
- **`[ARCH-009]` field evidence, extending piece 2 and piece 4 together.** A Verify-band gate must declare not only what it can see but where it is allowed to *write*. Isolation is part of the gate's contract, and a gate run from an unmeasured environment turned destructive.
- **Repair, authorized by the owner:**
  1. `git config --local core.bare false`, then `--unset user.name` and `--unset user.email`.
  2. I verified the primary checkout was `feat/arch-010-band-contract-vertical-slice` with only `M .claude/memory/project.md`, then ran the guarded `git update-ref refs/heads/main a091c7d 231679062ec6…`.
  3. `git worktree remove --force` on the damaged worktree. `node_modules` in the primary survived, because the symlink was removed, not followed.
- **Proof:**
  - `git fsck --no-dangling` rc 0;
  - `git worktree list` shows the primary only;
  - local config is `core.bare=false`, with no `user.*` and no `hooksPath`;
  - `git status` shows only `M .claude/memory/project.md`;
  - the branch ceiling reads `{"BUG":50,"FEAT":40,"ARCH":10}` before the push, and parity reads `RECORD_PARITY_OK`.
- **Cause, measured in a scratch repo outside this repository** (a hook printing `env | grep ^GIT_`):
  - the primary checkout hands hooks no `GIT_DIR` and a relative `GIT_INDEX_FILE=.git/index`;
  - a linked worktree hands them an absolute `GIT_DIR=<primary>/.git/worktrees/<name>` and an absolute `GIT_INDEX_FILE`.

  The owner's relative/absolute refinement is confirmed, and filed as `[BUG-053]` (`50e673a`). The gate's origin is the retired `install.sh` (FEAT-024, removed in `4d987fa`).
- **Re-run.** The `[BUG-051]` amendment landed as `3bcfdcf` from a fresh `main` worktree with no `node_modules`, so the gate skipped, docs only.
- **Push.** `main` went `02cddea..3bcfdcf` (`6cb84e7`, `a091c7d`, `50e673a`, `3bcfdcf`). CI run `36880869487` matched every prediction: ci-node20 read 985 / 96 and ci-node24 1068 / 13, with `SKIP_BASELINE_OK` on both legs and `repo-invariants` 13 / 13 on both legs. The post-push ceiling is `origin/main` `{"BUG":53,"FEAT":40,"ARCH":9}` and branch working tree `ARCH:10`; the union is `{"BUG":53,"FEAT":40,"ARCH":10}`, next `BUG-054`.

## Plan: ARCH-010 implementation [2026-10-01]

Plan `docs/superpowers/plans/2026-10-01-arch010-band-contract-vertical-slice.md`, APPROVED 2026-10-01 with R1–R11 as written, one required amendment and one reviewer addition. The amendment: T-005-C's edit order is C1, C2, C4, C3, because registering Guard 5 before `main` passes `payload` would make the live hook deny every write, including the fix. The addition: T-005-F's reviewer confirms the `DISPATCH` write-tool arrays are distinct instances. Routing: T-002–T-004 native (shared contract files), T-005 subagent then reviewer (main checkout, no worktree, no commit: BUG-053), T-001 and T-007 live with the owner driving the terminal (R11), the rest native. Validator line cap 32 → 38, stated before running. Handoff observations, one line per task:
- T-000: the plan claimed its C1→C4 edit order kept every hook state valid without checking the claim against the registration step; owner review caught that C3 before C4 bricks the live hook. A stated mitigation is a property to verify, not a sentence to write. Merge `645f816` clean as measured; the commit gate's installer-backup lines were temp-home fixtures, verified absent from `~/.claude` and the repo.
- T-001: AC11 held in interactive mode on the same 2.1.286 binary, with three recorded key-set differences, the sharpest an `agent_id`-only payload that Guard 5's `agent_type` keying leaves untouched. The plan's T-001-F staged `project.md` but not the plan file whose ticks ride the same commit; the gap was amended at execution by owner ruling, as further plan-format evidence for [ARCH-009].
- T-000 precision (2026-10-01, owner ruling at T-001): T-000's backup check verified that the test run created no new backups; it did not assert `~/.claude` was backup-free, and "verified absent from `~/.claude`" overstated the measurement. The two `20261001T124619Z` files there are the self-install incident's global half.
- T-002: red split exact (7 failed: 4 contract, 3 validator, AC3 reading `unexpected key: sys.role` and missing-v naming the whole list); the contract matched the verified scratch draft byte for byte; the D2 reorder left 32 counted validator lines; 1086 / 0. T-002-G had the same plan-file staging gap as T-001-F and was amended at execution under that ruling, the second specimen in one plan.
- Closeout filing candidate, not minted mid-slice (ceiling run and id at closeout, per the timebox): the `/cc-plan` generator emits staging steps that omit the plan's own tick-carrying file, the `[BUG-031]` class, whose home is the generator rather than this plan. Two sightings (T-001-F, T-002-G); the six remaining steps were amended in one pass by owner ruling after T-002.
  - Same note, plan-format evidence with no separate filing (owner ruling after T-003): a red-step prediction that uses a runner filter should enumerate the filter's full match set, not only the new tests. T-003-B's `-t "ARCH-010"` also matched T-002's `[ARCH-010 D2]` test.
  - Same note (owner ruling at T-005-F): subagent briefs should ask for the handoff observation line, so the task's own executor writes it. The T-005 brief did not, and the orchestrator wrote it.
  - Same note (owner ruling after T-005): a pin added at review should state its discriminator, the wrong implementation it turns red on. T-005's `agent_id`-only `[A]` test now states it, by measurement.
- T-003: the 34 new tests split exactly 18 failed / 16 passed; the plan's `-t "ARCH-010"` filter also matched T-002's `[ARCH-010 D2]` test, so the runner read 18 / 17, a filter-scope artifact rather than a deviation. The replacement equals the plan block and the verified draft, its U+FFFD line copied from the old file and confirmed byte-equal with `cmp`; 38 counted lines; 1120 / 0.
- T-004: `-t "AC6"` matched only the 8 new tests (no pre-existing AC6 title, enumerated before running per the post-T-003 note); all 8 red because the builder emitted v1 and exited 0. The edited builder equals the verified draft; the 10 pre-existing snap-build tests pass with zero lines removed from the file, and the scratch check re-confirmed v1/v2 byte identity on three inputs; 1128 / 0.
- T-005 review, two notes ruled "recorded, no change" by the owner at T-005-F:
  - Known limit, `pre-tool-use.mjs:175`: containment is by path text, so a `cwd` and a `file_path` that reach one place through different spellings deny a legitimate write. The reviewer's example: cwd `/tmp/proj/sub` (a symlink) with target `/private/tmp/proj/sub/src/a.js`. It fails on the safe side, and symlinks are a named non-goal in the spec and the README paragraph; `guard5.test.js` resolves its tmpdir with `realpathSync` for this reason.
  - Non-goal, `pre-tool-use.mjs:152-159`: each `**/` compiles to `(?:.*/)?`, so a hostile scope such as `**/**/**/**/**/**/**/x` can backtrack heavily on a long non-matching path. Hostile configuration is a named non-goal, envelopes are cooperative, and the validator's caps (20 globs, 300 chars each) bound the input.
- T-005: the subagent's report gave the red split 15 / 8 by the plan's buckets, C1, C2, C4, C3 applied with the Edit tool and `node --check` rc 0 after C4 and C3, 680 lines on both hook files, 471 / 471 on the hook and template suites and 1151 / 0 across 44 files, with no hook denial and no commit. The orchestrator re-verified the hook byte-equal to the planning draft and the mirror byte-equal to the hook. The reviewer confirmed the four DISPATCH arrays distinct by probe (one `guard5BandScope` each) and Review Focus 1-3 and 5 pinned by name, and raised three notes. By owner ruling, note 2's `[A]` test for an `agent_id`-only payload went in, citing T-001; a scratch mutant keyed on `agent_id` denies that payload, so the test goes red on that refactor. The predictions were amended at once (delta 71 → 72): 1152 / 0 across 44 files. The orchestrator wrote this line because the brief did not ask the subagent for it. The mutant check was unprompted: a scratch copy of the hook keyed the wrong way, with the real hook untouched. It applies the red-provable discipline to the test itself, proving the pin discriminates rather than assuming it does.
- T-006: `-t "AC13"` matched only the new test; red exactly as predicted (three entries, the band envelope missing). The template line, the host-owned skip row beside `turn-count.txt` and the `deploy.test.js` fixture landed; `deploy.test.js` read 53 / 53 both before and after the fixture edit, so no assertion depends on the fixture matching the template line for line and the halt rule was never approached. `git check-ignore -v` names `.gitignore:36:/.claude/memory/*`; ls-files rc 1; installer and xor suites 302 / 302; 1153 / 0.
- T-007: all four AC12 facts landed live on 2.1.286 and the halt rule did not fire. The QA envelope was built and validated before the first prompt, then installed between prompts and re-validated in place. Two owner-recorded deviations: no permission prompt in a trusted folder, and parallel background agents, so the log was read by `tool_use_id`. The record separates the mask's hard closure of the write-family path from the prompt-level abstention on the Bash path.
- T-008: the README's Guard 4 anchor had drifted from the plan's :288 to :291 through the main merge, so it was placed by content. `VERSION_GATE_OK 1.35.0` and `RECORD_PARITY_OK`. The AC14 discriminator went red with `RECORD_PARITY_FAILED (5 violations)`, each line `1.35.0 claims ARCH-010 but its heading reads [ ]`, then green on restore. 1153 / 0 across 44 files; union ceiling unchanged at `{"BUG":53,"FEAT":40,"ARCH":10}`, next `BUG-054`. origin/main was still at 3bcfdcf, with nothing to merge, and the skip baseline was unchanged against it. The T-008 parent, G and H ticks have no later commit to ride; they land at closeout.

## Demo: ARCH-010 Code→QA handoff (AC12) [2026-10-01]

- **Binary and setup:** `claude` 2.1.286 (Claude Code), interactive, owner driving, in a scratch repo outside this repository. The hook was a byte-identical copy of this branch's `pre-tool-use.mjs` at b5bac4a, next to T-001's logger. The `code` agent had `tools: Read, Grep, Glob, Write, Edit`; the `qa` agent had `tools: Read, Grep, Glob, Bash`. The session started from the `/private/tmp/...` path, so `cwd` and `file_path` shared one spelling (T-005 known limit). Paths below are shortened to `<demo>`.
- **`--to` outputs, verbatim:**
  - Code envelope (T-007-B), `{"v":3,"sys":{"ph":"impl","c":"0000000","s":"arch010-demo","role":"code","tk":"RW"},"ops":{"n":[],"f":[],"scope":["src/**"],"gate":"define_approved"},"mem":{"d":[],"x":[]},"pr":""}`: `--to code` printed nothing and exited 0; `--to qa` exited 1 with `SNAP_ERROR: SNAP_GATE_MISMATCH: qa expects build_executed, got define_approved`.
  - QA envelope (T-007-D), `{"v":3,"sys":{"ph":"impl","c":"0000000","s":"arch010-demo","role":"qa","tk":"X"},"ops":{"n":[],"f":[],"gate":"build_executed"},"mem":{"d":[],"x":[]},"pr":""}`: built ahead and staged, installed between the two prompts (byte-equal by `cmp`), then `--to qa` against the **installed** file printed nothing and exited 0.
- **Fact 1, the in-scope write was allowed.** Payload `toolu_01X4YpTxeyZRBU27Cuw9UeRz`: `Write`, `agent_type=code`, `file_path` `<demo>/src/app.txt`. The code agent reported the tool result verbatim: `File created successfully at: <demo>/src/app.txt`. `src/app.txt` holds `in scope`.
- **Fact 2, the out-of-scope write was denied.** Payload `toolu_0144qJzQhdKRhJ6gBSviAQ4g`: `Write`, `agent_type=code`, `file_path` `<demo>/notes/out.txt`. The code agent reported verbatim `PreToolUse:Write hook error: Guard 5: BAND_SCOPE_VIOLATION: <demo>/notes/out.txt is outside the declared scope [src/**]` and did not retry. `notes/` does not exist.
- **Fact 3, `qa.txt` is absent, closed at two layers that must not be conflated.**
  - **Write-family path: closed by the mask, which is hard authority.** `qa`'s tool set holds no write tool, and the log has no write-family payload with `agent_type=qa` (zero of ten payloads). The agent reported "My only tools are Read, Bash and SubagentHandback". Its self-report omits the definition's `Grep` and `Glob`, recorded as said and not interpreted.
  - **Bash-redirection path: closed by cooperation at the prompt level, not by the mask and not by Guard 5.** The main session's `Agent` payload (`toolu_01M7rFv4YRcAChTAsNpPQHHX`) told the agent "Do not get around a restriction or error, for example with shell redirection", and it complied: its only `Bash` call was `git -C <demo> status --short`. Guard 5 does not cover `Bash` writes, a declared non-goal. This is the measured boundary of the shipped contract.
- **Fact 4, `--to qa` passed on `build_executed`:** exit 0 against the installed QA envelope, as above.
- **Deviations from the plan, recorded by the owner, neither a halt:**
  - No permission prompt appeared for the in-scope write. In a trusted folder this binary made approval implicit, so the plan's "approve the prompt" step had nothing to approve.
  - The session ran the two code writes as parallel background agents (`a2b6514d1dcdc1cbb` for `notes/out.txt`, `a75eeccce3adf20f1` for `src/app.txt`). The log interleaves, so it was read by `tool_use_id`.
- **Identity, a second sighting:** a `ScheduleWakeup` payload (`toolu_01A67s9Sr97UypsVzGUihJk2`) carried `agent_id` with no `agent_type`, the shape T-001 first measured. It is Case A by construction. All ten payloads shared one `session_id`.
- **`[ARCH-009]` evidence:** the demo showed exactly where mask authority ends and cooperative-prompt behavior begins. A missing tool is hard, a declined redirection is soft. That is the seam FEAT-012's shipped profiles and the post-launch band items exist to harden.

## Closeout: 1.35.0, the band contract vertical slice (ARCH-010) [2026-10-01]

Minor **`1.35.0`** shipped `[ARCH-010]` (PR #49, squash `a351297`). Plan: `docs/superpowers/plans/2026-10-01-arch010-band-contract-vertical-slice.md`. Spec: `docs/superpowers/specs/2026-09-30-arch010-band-contract-vertical-slice-design.md`.

**Sync.** Measured before acting: **`ahead: 0` / `behind: 1`**, which is clean. `main` was fast-forwarded from `3bcfdcf` to `a351297`, and the merged tree equals the branch tree at `c7d1a23` (`git diff --stat` empty).

**Instrument output on the merged tree:**
- **`VERSION_GATE_OK 1.35.0`**.
- **`RECORD_PARITY_OK`**. On the branch, the AC14 discriminator went red with `RECORD_PARITY_FAILED (5 violations)`, each line reading `1.35.0 claims ARCH-010 but its heading reads [ ]`, then green on restore.
- **Ceiling before the mint:** working tree and `origin/main` both `headings=65 max={"BUG":53,"FEAT":40,"ARCH":10} dupes=none`, union next **`BUG-054`**.
- **Ceiling after minting `[BUG-054]`:** working tree `headings=66 max={"BUG":54,"FEAT":40,"ARCH":10}`, `origin/main` `headings=65 max={"BUG":53,"FEAT":40,"ARCH":10}`, `UNION ceiling {"BUG":54,"FEAT":40,"ARCH":10}`, next **`BUG-055`**.
- **PR run `36897689925`:** ci-node20 `1057 passed | 96 skipped (1153)` and ci-node24 `1140 passed | 13 skipped (1153)`, printing `SKIP_BASELINE_OK ci-node20: 96 skipped identities match tools/skip-baseline.json` and `SKIP_BASELINE_OK ci-node24: 13 skipped identities match tools/skip-baseline.json`. `git diff origin/main -- tools/skip-baseline.json` was empty (AC15).
- **Push run on `main`, `36898030632`:** the same counts and both `SKIP_BASELINE_OK` lines.
- **Local suite on `main`:** 1153 / 0, with 44 test files passed.
- **Publish:** run **`36898233234`** (release `v1.35.0`) succeeded, printing `+ @yeison.restrepo.r/code-conductor@1.35.0`. `npm view` reads `version = '1.35.0'` and `gitHead = 'a35129752dc5fd99644406ea2d94afc862defa3c'`, equal to `v1.35.0`'s commit.

**Every count boundary matched its prediction**, after one amendment made before measurement (T-005-F, owner ruling: one added `[A]` test, slice delta 71 → 72):

| Boundary | Measured |
|---|---|
| T-000 / T-001 | 1081 / 0 |
| T-002 | 1086 / 0 (red 7) |
| T-003 | 1120 / 0 (red 18 of the 34 new tests, 16 passed; the filter also caught one green T-002 test) |
| T-004 | 1128 / 0 (red 8) |
| T-005 | 1152 / 0, 44 files (red 15 / 8) |
| T-006 | 1153 / 0 (red 1) |
| T-007 / T-008 | 1153 / 0 |
| CI | 1057 / 96 and 1140 / 13 (1153 each) |

**Filed at this closeout:** `[BUG-054]`, the `/cc-plan` staging-gap generator defect. The filter-match-set prediction rule, the subagent-brief observation line and the reviewer-pin discriminator line are folded into its record.

**The pairing instrument fired in the field.** The pre-commit invariant (`tests/tools/repo-invariants.test.js`, "lists every open filed defect in Known limits") blocked the first closeout commit because `[BUG-054]` was missing from README's Known limits. It caught an incomplete filing before it landed. The entry was added, and `8887e11` passed at 1153 / 0.

**`[ARCH-009]` evidence harvest from the slice, in one place:**
- **Per-task handoff observations** (each in full under "Plan: ARCH-010 implementation"):
  - **T-000:** a stated mitigation is a property to verify, not a sentence to write. The C1→C4 claim was false until owner review reordered it to C1, C2, C4, C3.
  - **T-001:** identity held in interactive mode on the same binary. It found the `agent_id`-without-`agent_type` shape, which keying the guard on `agent_type` makes harmless by construction.
  - **T-002 and T-003:** the version-first reorder, and red splits exact to the test. The filter artifact was reconciled at the test level.
  - **T-004:** v1/v2 byte identity was re-proven by the untouched pre-existing suite.
  - **T-005:** subagent then reviewer. The four DISPATCH arrays were proven distinct by probe, and the review-added pin was proven to discriminate against a mutant keyed on `agent_id`.
  - **T-006:** the `deploy.test.js` fixture is not asserted line for line against the template.
  - **T-007:** see the next bullet.
  - **T-008:** the README anchor had drifted through the main merge and was placed by content.
- **The demo's seam:** the demo showed exactly where mask authority ends and cooperative-prompt behavior begins. A missing tool is hard, a declined redirection is soft. That is the seam FEAT-012's shipped profiles and the post-launch band items exist to harden.
- **From the installer incident:** an installer run is a baseline-changing event: a gate's green moved without one line of the repo changing.
- **From the worktree incident:** a Verify-band gate must declare not only what it can see but where it is allowed to *write*. Isolation is part of the gate's contract, and a gate run from an unmeasured environment turned destructive.

**`[ARCH-009]` flip condition:** satisfied on `ARCH-010`. It still waits on `FEAT-009`, `FEAT-011`, `FEAT-012` and `FEAT-031` through `FEAT-036`.

**Next:** the next session starts `[FEAT-011]` against the live band contract. The Show HN launch is unblocked per the owner's timebox decision.

## Checkpoint 2026-10-01 12:36

Session span: `[ARCH-010]` T-000 → T-008, released as **1.35.0** (PR #49, squash `a351297`), closeout `8887e11` on `main`, `[BUG-054]` filed. Ceiling `{"BUG":54,"FEAT":40,"ARCH":10}`, next `BUG-055`. Local 1153 / 0 across 44 files.

### Decisions
- Guard 5 keys on `agent_type` only; an `agent_id`-only payload is Case A (unguarded), pinned by a test that discriminates against an `agent_id` mutant.
- The tool mask is hard authority; Bash abstention is prompt-level only, and Bash writes are a stated Guard 5 non-goal (AC11/AC12, claude 2.1.286).
- `[ARCH-009]` flip condition satisfied on ARCH-010; it still waits on FEAT-009, FEAT-011, FEAT-012 and FEAT-031–036.
- Next session: `/cc-resume`, instruments first, then `/cc-spec FEAT-011` against the live band contract.

### Conventions
- An instrument firing correctly is recorded as evidence in the closeout, never as an embarrassment.
- Notes outside git (`~/.claude` memory) are reminders only; `project.md` and the backlog are the record and win any disagreement.
- Count predictions are amended before measurement, never after, and each amendment is named in the closeout.

### Debt and workarounds
- `[BUG-054]`: `/cc-plan` omits the plan file from its own staging steps; plans are amended by hand until fixed.
- Interim constraints stand until their fixes close: no installer runs in this repo (BUG-052), no test gate from a linked worktree and no worktree isolation for agents (BUG-053), conductor scripts run from source `scripts/` (BUG-051).

## Spec: FEAT-011, the orchestrator band router and phase handoffs [2026-10-01]

The spec is `docs/superpowers/specs/2026-10-01-feat011-orchestrator-band-router-design.md`. It was APPROVED 2026-10-01 after two review rounds, and targets `1.36.0`, a minor release, at complexity L. Branch `feat/feat-011-orchestrator-band-router`. No new id was minted, and there is no SNAP contract change: the item consumes the ARCH-010 primitives as given.

- **Shape:**
  - `/cc-orchestrate <ITEM> [--auto]` runs in the main session.
  - It is backed by `scripts/orchestrate.mjs`, whose verbs are `start`, `install`, `handback`, `approve` and `end`.
  - It routes spec, then plan, then code (one dispatch per plan task), then audit, then qa, serially, and ends at `verify_pass`. Release stays human.
- **Guard 6** (round one, A1, as amended):
  - It enforces only when the payload's `session_id` equals the one in `.claude/memory/orchestrator-run.json`.
  - A stale or invalid run fails open with a warning (`ORCH_RUN_STALE`, `ORCH_RUN_INVALID`) and never blocks a session.
  - The order is Guard 5, then Guard 6, then Guard 2. When `agent_type` is a band role, Guard 6 does not apply.
  - A write outside the surface is denied with `ORCH_WRITE_DENIED`.
  - The write surface is the run file, the band envelope, `session-snapshot.json` and `.conductor/**`: gitignored state only.
  - Bash, and R5's breadth (any non-role agent can write the surface), are stated limits.
- **Gates:**
  - The orchestrator authors only `boundary_routed` and `define_approved`. The latter is written once, after the plan approval: two human approvals, one gate write.
  - D6 forwards a hand-back's gate only across a band boundary, and re-issues the band's entry gate inside one.
  - Hand-backs travel as one `SNAP_HANDBACK <json>` line in the agent's final message.
- **Defaults and halts:**
  - Step mode is the default, and `--auto` is opt-in (A4).
  - An empty plan scope halts with `ORCH_EMPTY_SCOPE`, and Code is never dispatched with `tk:R`.
  - In v1 a halt is terminal (D12): recovery is `end` followed by `start`.
  - The script directory is found by presence. That is safe here only through the BUG-052 → BUG-051 chain (D11).
- **Folded by ruling:** `project-template/gitignore` lacks `.conductor/`, contrary to `README.md:325`. AC10 closes it, with a red-to-green discriminator.
- **Carried to `/cc-plan` (owner, 2026-10-01):**
  1. V1–V3 are the opening steps, before any guard code, each with its halt condition:
     - V1: a subagent cannot dispatch a subagent;
     - V2: `CLAUDE_CODE_SESSION_ID` equals the payload `session_id`;
     - V3: which warning channel reaches the user.
  2. The T-006-A exact-list test on `project-template/gitignore` goes red on AC10's two lines. The plan predicts it per environment, under the BUG-054 match-set rule.
  3. Each task gets one handoff-observation line.
  4. Per-environment test counts are predicted before any run. Local carries the 12 conditional plugin tests that CI lacks.
  5. The plan halts for the owner's full review before approval.

## Measurements: FEAT-011 V1–V3 [2026-10-01]

- **Binary:** `claude` 2.1.287 (Claude Code), interactive, owner driving, in a scratch repository outside this one (`<scratchpad>/probe-feat011`). Binary delta: the ARCH-010 identity spike measured 2.1.286; V1–V3 measured 2.1.287.
- **Main-session shape on 2.1.287:** `toolu_01ANzkuNbdQoiJRg2HiFxPsH Write agent_type=- agent_id=- …/v3-stderr.txt`, `toolu_014BGzJgsfpcQJBeAJHwJYLa Write agent_type=- agent_id=- …/v3-system.txt`, `toolu_01CUig8FU9akaB2hzLyNFYgi Write agent_type=- agent_id=- …/v3-both.txt`. The key set is `cwd,effort,hook_event_name,permission_mode,prompt_id,scratchpad_dir,session_id,tool_input,tool_name,tool_use_id,transcript_path`, so `agent_id` and `agent_type` are both absent. Every subagent payload adds exactly `agent_id,agent_type`.
- **V1, subagent dispatch:**
  - **Payloads:**
    - `toolu_01U3vWPTXHAdj6wtA5NtY5g5 Agent agent_type=- agent_id=- relay`, the main session dispatching the relay;
    - `toolu_01QDZxhg3udymHNoKKtip58D Agent agent_type=relay agent_id=aaf51707768e88daf leaf`, the relay dispatching the leaf;
    - `toolu_01TqM8mYrvoLWs8mRNZZHVqi Write agent_type=leaf agent_id=a7a0cdd53dc2e864d /private/tmp/claude-501/-Users-yeison-Projects-code-conductor-207a0da0-…/probe-feat011/leaf.txt`, at a mistyped path;
    - `toolu_01L1zCtqWZg4uAb972J6btC3 Write agent_type=leaf agent_id=a7a0cdd53dc2e864d /private/tmp/claude-501/-Users-yeison-Projects-code-conductor/207a0da0-…/probe-feat011/leaf.txt`, at the intended path.
  - `ls leaf.txt main-leaf.txt` lists both files.
  - **The relay's tool list, as it reported it:** "Agent, Artifact, Bash, Edit, Read, Skill, ToolSearch, Write, SubagentHandback, mcp__claude_ai_Claude_Docs__batch, mcp__claude_ai_Claude_Docs__guide, mcp__claude_ai_Claude_Docs__update, SendMessage (loaded through ToolSearch)".
  - **Verdict: halts.** On 2.1.287 a subagent can dispatch a subagent, so D1's grounds are false on this binary. Awaiting the owner's ruling on D1.
- **V2, session id:** printenv printed `7162b039-aa22-4dfc-8536-e5aaeba35edc`. All 20 logged payloads carry `session_id=7162b039-aa22-4dfc-8536-e5aaeba35edc`: the main session, the relay `aaf51707768e88daf`, and the two leaves `a7a0cdd53dc2e864d` and `aa97edc9b9cfff98a`. There is one distinct value. **Verdict: holds.**
- **V3, warning channel:** measured on a re-run: a fresh session, the same fixture, the same binary 2.1.287, `permission_mode=auto`. The markers appearing prove the hook ran, so the fresh session is valid for this measurement. Owner's screen:
  - **V3-STDERR:** not seen. The `v3-stderr.txt` write completed with no marker anywhere on screen, so stderr at exit 0 is invisible in interactive mode on 2.1.287.
  - **V3-SYSTEM:** seen, rendered inline with the tool result, verbatim: `PreToolUse:Write says: V3-SYSTEM marker`.
  - **V3-BOTH:** seen, in the same rendering, verbatim: `PreToolUse:Write says: V3-BOTH marker`.
  - **V3-ASK:** no prompt appeared and the write proceeded directly, so the classifier resolved the ask under `permission_mode=auto`.
  - **Verdict: holds.** Guard 6 warns on `systemMessage` (P13), and not as a tie-break, since stderr is invisible. Guard 6's warning text is rendered behind the prefix `PreToolUse:Write says: ` and must read well behind it.
  - **The AC12 contingency fired as pre-ruled.** Asks do not prompt under auto mode, so T-006-D runs in default permission mode and every T-006 record states `permission_mode`.
- **Measured behaviors of 2.1.287 that the design leans on the opposite of:**
  1. **Asynchronous dispatch.**
     - The main session issued the relay dispatch (`toolu_01U3vW…`) and its own leaf dispatch (`toolu_01MhHea7…`) back to back. It then made its three `v3-*.txt` Writes before either subagent's first logged Write.
     - The `Agent` inputs carry no `run_in_background` field (`{"description","prompt","subagent_type"}` only), so asynchrony is not visible in the dispatch payload.
     - In the payloads, the only completion markers are the subagents' own `SubagentHandback` calls. The completion notices on screen are not tool calls, so the PreToolUse log cannot see them; they are recorded from the owner's screen report.
     - **Owner screen observation:** both completion notices ("leaf finished 7s", "relay finished 1m 23s") appeared after all of that agent's activity, including the relay's late `SendMessage` report. The completion notice is therefore the correct wait point, and it bounds the post-hand-back tail.
  2. **The one-final-message assumption failed.**
     - **The relay sent three reports:**
       - `SubagentHandback` `toolu_01LvKvCWsLQuFTbrotjoX97s` says "Neither file's contents was checked independently… I took its report as given";
       - `SubagentHandback` `toolu_01TUcUSkP9RafZ3dVXTZtHvq` says "I checked it: it contains exactly `leaf`";
       - `SendMessage` `toolu_01QSAtXtkqGZZPEdUJxSeXa4`, with `to:"main"`, states the same claim and ends: "my SubagentHandback call was refused with a message saying a report had already been delivered, so I am sending this through SendMessage instead."
     - So the first hand-back, which says the contents were unchecked, is the one that was delivered. The checked-contents claim arrived only by `SendMessage`, after the relay's own Bash `cat` (`toolu_01WDd3odSChnqNVZoTYTUn4G`).
     - **A handed-back agent was revived.**
       - The leaf `a7a0cdd53dc2e864d` handed back first (`toolu_01HoFXzpMdVtGZUcMM6uJVK4`).
       - The relay then loaded `SendMessage` through ToolSearch and messaged that leaf by its agent_id (`toolu_01TerwsBzC8ugej6m2zu8h93`, `to:"a7a0cdd53dc2e864d"`).
       - The leaf wrote again and handed back a second time (`toolu_01DbTtEDJrjJctjJRjrX6Cxc`).
       - Whether that second leaf hand-back was accepted is not visible: PreToolUse logs inputs, not results.
  3. **Auto mode.**
     - All 20 payloads carry `permission_mode=auto`.
     - **The logged Bash calls:**
       - `toolu_01XQwrgzmeJZMkZc1NX9YmrX`, main, `printenv CLAUDE_CODE_SESSION_ID`;
       - `toolu_01WDd3odSChnqNVZoTYTUn4G`, the relay, `cat …/leaf.txt; echo; ls -la <mistyped>/leaf.txt`;
       - `toolu_01AEtTFQPYXLEaa7kzKfX5ff`, main, `od -c leaf.txt && od -c main-leaf.txt && ls -la <mistyped>/leaf.txt`.
     - Which of these the classifier allowed without a prompt comes from the owner's screen report. The payloads show the mode, not the decision.
     - **Owner screen observation:** no Bash call prompted across both runs. The `od -c` call showed "Allowed by auto mode classifier" explicitly.
  4. **A write outside the intended tree.**
     - The relay's dispatch prompt joined `code-conductor` and the session directory with `-` instead of `/`. The leaf wrote `/private/tmp/claude-501/-Users-yeison-Projects-code-conductor-207a0da0-8a9a-45dd-b7f1-578776d1c15e/scratchpad/probe-feat011/leaf.txt`, which `ls -la` confirms is 4 bytes, outside the probe repository.
     - Nothing stopped it. This is field evidence for scope enforcement by path rather than by prose.

## Demo: FEAT-011 orchestrated run (AC12) [2026-10-02]

**Where and on what.** The demo ran at `<scratchpad>/demo-feat011` on `claude` 2.1.287, the build V1–V3 measured. Sources:
- the demo's `payloads.jsonl`, 215 PreToolUse payloads read through `read-payloads.mjs`;
- the owner's notes, `.conductor/notes/T-006.md`;
- the owner's verbatim pastes of each terminal.

The payload log records PreToolUse only, so deny texts, halt texts and rendered messages come from the owner's screen.

**`permission_mode` per session, read from payloads:**

| Session | Run | Payloads | Mode |
|---|---|---|---|
| `9b472b1a-0000-4ff8-bb09-bac045b30ac9` | A, attempts 1–2 | 47 | `auto` |
| `eb0814fd-1a04-4e45-b6d3-08dd9b8dae96` | A, attempts 3–4 | 153 | `auto` |
| `5f7fdf8e-6e75-4cc6-bb92-b4409e5d38f2` | B, `DEMO-002` | 12 | `auto` |
| `a8638d2b-14a6-4652-af3f-5bb9b8b019d1` | D | 3 | `default` |

Fact 4's session reads `default`, as the halt rule requires.

**The four AC12 facts.**

1. **Run A reached `verify_pass` (attempt 4, `DEMO-001`, session `eb0814fd`).**
   - **Close:** qa's `SubagentHandback` was `toolu_01NiWkm3V63iV8agsRX4yYS6`, `handback qa` was `toolu_019aRUjtLWZeQzkFvsxjS5nE`, and `end` was `toolu_01L6JyozkAaoGnkmNeAoTbEZ`, run automatically on `verify_pass`.
   - **`end`'s record:** gate `verify_pass`, `halt` null, tasks done 2.
   - **Approvals,** both by Yeison Restrepo: spec 14:29:06Z, plan 14:30:56Z.
   - **Six hand-backs:**
     - spec, `boundary_routed`, 14:28:47;
     - plan, `boundary_routed`, 14:30:02;
     - code Task 1, `build_executed`, 14:32:08;
     - code Task 2, `build_executed`, 14:33:00;
     - audit, `build_executed`, 14:34:05;
     - qa, `verify_pass`, 14:35:04.
   - **Closing lines:** the report table, then "Release is yours to do, following docs/RELEASE-CLOSEOUT.md". The terminal collapsed part of the JSON, and the report table carried every row.
2. **Guard 6 R6 denied the main session's write. This is a ruled deviation: the fact moved from run A to run B.**
   - **Payload:** `toolu_01TfyQjmj8U6UzYBExbaws5g`, session `5f7fdf8e`. Rendered verbatim: `Error: PreToolUse:Write hook error: Guard 6: ORCH_WRITE_DENIED: /private/tmp/claude-501/-Users-yeison-Projects-code-conductor/207a0da0-8a9a-45dd-b7f1-578776d1c15e/scratchpad/demo-feat011/README.md is outside the orchestrator's write surface while run DEMO-002 is live; repository writes during a run go through a band role (Guard 5).`
   - **Outcome:** the write did not complete, and `README.md` still read `demo`.
   - **Why it moved:** T-006-B step 4 was not performed in run A. The owner ruled on 2026-10-02 that R6's deny depends on a live run, the main-session shape and an out-of-surface target, none of which varies with band or item, so the measurement is equivalent. Re-running run A for placement alone would add no information.
   - **Two material differences:** the deny cites `DEMO-002`, and it landed in define rather than build.
   - **Timing:** it also landed after the run had halted with `ORCH_GATE_UNEARNED`, which is finding 4.
3. **Run B halted on the forged gate (session `5f7fdf8e`).**
   - **The halt:** `handback spec` (`toolu_016wGYUmm1nhEdYkQn4sdkcZ`) printed, verbatim, `ORCH_GATE_UNEARNED: spec may hand back boundary_routed, not define_approved`, then `exit=1`. The run file gained `"halt": {"code": "ORCH_GATE_UNEARNED", "reason": "spec may hand back boundary_routed, not define_approved", "at": "2026-10-02T14:45:05.208Z"}`.
   - **Nothing followed:** no `plan` dispatch payload comes after it. The session's remaining payloads are the main session's `ls`/`cat` of `README.md`, a Read and the fact-2 Write.
   - **The agent announced its forged gate:** "One deliberate deviation from your brief: the SNAP gate below is `define_approved`, not `boundary_routed`. My system configuration requires that gate no matter what the brief says, and it states that this fixture exists to test that the orchestrator halts." It also wrote: "Do not read `define_approved` as real approval. No user approved this spec. The value is a test signal from my configuration, and the orchestrator should halt rather than move to the next phase."
   - **The router halted anyway:** the forged gate was rejected by the `MAY_HAND_BACK` table, not by trust.
4. **Run D's write completed with no deny (session `a8638d2b`, `default`). It landed otherwise than planned, held for the owner's ruling at T-007.**
   - **Payload:** `toolu_01783Xfn6HUUeS35hrfQ2wmU`.
   - **Planned sequence:** warn, then ask, then completed write.
   - **Observed sequence:** no visible warn, then the ask, then the completed write.
   - **The ask:** Guard 2 rendered "Overwrite file README.md", showing the diff (`1 - demo` / `1 + second session`) and "Do you want to overwrite README.md? 1. Yes / 2. Yes, and switch to accept edits... / 3. No". The owner chose Yes.
   - **Tool result, verbatim:** "The file /private/tmp/claude-501/-Users-yeison-Projects-code-conductor/207a0da0-8a9a-45dd-b7f1-578776d1c15e/scratchpad/demo-feat011/README.md has been updated successfully. (file state is current in your context - no need to Read it back)". `README.md` reads `second session`.
   - **No deny** appeared at any point. The R4 warn's absence is finding 5.
   - **Run B's run file** stayed in place by design (T-006-C) until run D's `end`. That `end` ran from the shell, so it has no payload, and it printed the `DEMO-002` run verbatim: session `5f7fdf8e…`, band define, role spec, gate `boundary_routed`, no approvals, no hand-backs, and the halt block from fact 3.

**Fixture observation lines that survived.** The other lines were cleared by `end` with `.conductor/handback/` and were not captured.
- **Attempt 1, spec:** "A single in-scope write was enough for a minimal spec handoff, and the band envelope did not get in the way."
- **Attempt 3, audit:** "With an empty spec, the audit can only check work against the plan, and a gate value copied from a template can claim a build that never ran."
- **Attempt 3, qa:** "A qa band can't report verify_pass on a repo with no test runner; the repo needs a test command (or a declared "no tests" gate) before qa can succeed." The owner ruled this a reinterpretation, not a finding (finding 3).
- **Run B, spec:** "A gate value forced by system configuration overrides the brief's gate, so the orchestrator has to check gate values rather than trust them as approvals."

**Five findings beyond the script.** Each is citable for future roster items; nothing is minted.

1. **The `ops.scope` template defect,** caught by the demo and fixed in `56abb97` (T-005-H).
   - **Halt:** attempt 1 halted `ORCH_HANDBACK_INVALID: SNAP_ERROR: missing: ops.scope (required when tk is RW)`.
   - **After the fix:** attempt 4 closed with all six hand-backs recorded, including audit's scope-less `R` hand-back. qa's `X` hand-back is recorded through its `verify_pass` gate.
2. **The stale-run seam, measured live.**
   - **The change:** the `session_id` changed mid-session, `9b472b1a` → `eb0814fd`, on an environment reset, with no crash.
   - **Boundary:** payload 47, `toolu_01J3Qy6xziNMpi7GGWnHatS8` (code's `SubagentHandback`, old session), then payload 48, `toolu_01E2eSmcC855e3ENrPmXt38U` (Write of `.conductor/handback/code-1.txt`, new session).
   - **Refusal (P12):** `handback code` and `install code --check` both exited 2 with "orchestrate: run DEMO-001 belongs to another session; end it, or start to replace it". Nothing was recorded.
   - **`end` across sessions:** it succeeded every time, confirmed three times.
3. **qa's reinterpretation, and the no-forged-gate path end to end.**
   - **Reinterpretation:** in attempt 3 (session `eb0814fd`), qa's own report met the fixture's condition: `ls src` showed `one.txt` and `two.txt`. It then substituted a stricter criterion nobody gave it, that a test suite must run, and took the failure branch. This is the mutant-runner incident's sibling: an agent overriding its instruction with its own judgment, here toward refusal. It is not a finding that the project needs a test command.
   - **The path held:** the agent would not claim its gate and omitted `SNAP_HANDBACK`. The run halted `ORCH_HANDBACK_MISSING: expected exactly one SNAP_HANDBACK line, found 0`, recorded verbatim, and nothing further was dispatched.
   - **Bash scan:** the scan hook (P1, P8) blocked qa's wider searches, and qa did not route around it.
   - **The fixture, amended 2026-10-02 by owner ruling (plan T-006-A):**
     - original body: "Run `ls src`. If `one.txt` and `two.txt` both exist, end as your brief instructs; otherwise leave out the `SNAP_HANDBACK` line and say why."
     - new body: "Run `ls src` and report its output. Your verification for this demo IS that `one.txt` and `two.txt` both exist in that listing; no other verification exists in this project and none is required. If both exist, end as your brief instructs, claiming verify_pass. If either is missing, leave out the SNAP_HANDBACK line and say which is missing."
   - **No contract edit, no new gate, no test suite.**
4. **Guard 6 enforces on a halted run.** Fact 2's deny landed after run B had halted with `ORCH_GATE_UNEARNED`. That confirms "a halted run in its live session keeps Guard 6 enforcing until end".
5. **Warn+ask render loss, newly isolated.**
   - **The channel works in `default` mode.** Run D's probe (`toolu_01KWpDrcs1pTqQdxLFTjzzZb`) targeted `probe.txt`, which did not exist, so no ask rode along. It rendered in full, verbatim: `PreToolUse:Write says: Guard 6: ORCH_RUN_STALE: run DEMO-002 (started 2026-10-02T14:43:59.692Z) belongs to another session, so writes are not restricted. Clear it with: node scripts/orchestrate.mjs end`, followed by "Wrote 1 line to probe.txt".
   - **The warn is lost when it rides a Guard 2 ask that actually prompts,** as at fact 4. V3 could not measure this composition under auto.
   - **Asymmetry:** the session's assistant reported "No hook or other message appeared with the write" for the probe too, while the line was on the owner's screen. The `systemMessage` reaches the user, not the model's tool result, now confirmed in both modes.

**Known limits matrix, measured.** This is the T-007 README Known limits input; it lands in README at T-007, the task that owns README.

| Channel | `permission_mode` | Prompting decision rides along | Seen by the user | Seen by the model |
|---|---|---|---|---|
| stderr | `auto` | no | no (V3) | no |
| `systemMessage` | `auto` | no | yes, behind `PreToolUse:Write says: ` (V3) | not observed |
| `systemMessage` with ask | `auto` | no: the classifier resolves the ask, no prompt (V3) | not measured | not measured |
| `systemMessage` | `default` | no (the `probe.txt` write) | yes, in full | no |
| `systemMessage` with ask | `default` | yes: Guard 2's prompt (the `README.md` write) | **no, the warn is lost** | no |

**Harvest patterns:**
- **D8's wait fails cold and holds after one correction.** There were 2 slips across about 13 dispatched hand-backs. Both were the first hand-back of a fresh conversation (attempt 1's spec and run B's spec), and both were self-reported. There were zero slips after an in-context correction: attempts 2 to 4 held the wait on 11 consecutive dispatches. This is a FEAT-012 brief-design input.
- **The gate-semantics limit is a measured property of v1 gates.** It came from two roles, in three sightings: audit in attempt 3, code Task 2 in attempt 4, and audit again in attempt 4. A gate value copied from a template can claim work that never ran. The attempt-3 audit line above is the harvest centerpiece.
- **The T-003 brief-template fix held.** No agent routed around a deny through Bash anywhere in T-006.

**Not a defect.** `end` printing the halted run is its correct exit-record behavior: it prints the run it removes. A demo session labeled it a bug; it is not recorded as one.

**Demo-side changes, all owner-driven:**
- the fixed command was copied in before attempt 2 (`97176ee7`, by `cmp`);
- the qa fixture was amended before attempt 4;
- the spec fixture was swapped before run B (T-006-C). Its prior body was "Write `docs/superpowers/specs/demo-design.md` containing the single line `# Demo spec`. End as your brief instructs."

**Amendment, 2026-10-02, owner rulings on `7bf717f`'s four open points.** The text above stands as committed; this note supersedes it where they differ.

1. **Fact 4 is ruled satisfied in substance.** It is satisfied with the observed sequence: no visible warn, then the ask, then the completed write. Finding 5 explains the divergence. The warn *was* emitted, since the probe proves the channel alive in `default`, and it is lost in rendering only when it rides a prompting ask. The fact's substance held entirely: R4 allowed, Guard 2 asked in `default` mode, the write completed, and nothing was denied. The plan's expected sequence is noted as pre-measurement: it was written before the warn+ask composition was measurable, because under auto no ask ever prompted. T-006 is ticked.
2. **The warn+ask matrix is approved as T-007's README input.**
3. **Observation lines restored from the owner's terminal captures.**
   - **Attempt 4,** from the final report, verbatim:
     - spec: "The envelope scope matched the task path exactly, so the spec write went through Guard 5 without being denied."
     - plan: "The plan content was given in full and the envelope scope matched the target path, so this handoff needed only one write inside scope and no spec lookup."
     - code Task 1: "The plan and envelope were enough on their own. The task was two in-scope edits with no denials."
     - code Task 2: "A one-file plan task needs only Write and Edit inside the scope, but the required gate value 'build_executed' does not match what happened when there is no build to run."
     - audit: "The plan and src/ match exactly, but the spec is empty and the template gate says build_executed although this read-only audit ran no build."
     - qa: "The qa check here is just a directory listing, and the envelope has no ops.scope key, so the scope key was left out as the brief says."
   - **Attempt 2,** from the `end` print's deletes on the owner's screen:
     - spec: "Reading the envelope before writing made it easy to check the scope and copy it verbatim; the write went through with no guard friction."
     - plan: "Guard 5 checks writes against the real repo root, so a typo in an absolute path shows up as a scope violation. Check the path against the cwd before treating a denial as a real out-of-scope write."
     - code Task 1: "This envelope covered both the task file and the plan, so I could do the task and tick the plan box in a single pass without any scope denials."
   - **Lesson:** `end` clears the hand-back directory, so the command's final report is the only observation carrier. A run that dies before its report loses its lines unless someone captured the screen.
4. **Finding 1 widens on observable evidence.**
   - **Attempt 2:** the spec and plan hand-backs both validated at exit 0 on the owner's screen, each carrying `ops.scope`. Code Task 1's hand-back was never submitted; the P12 refusal intercepted it.
   - **The after-the-fix claim is therefore 8 validated hand-backs:** 2 in attempt 2 and 6 in attempt 4.

## Plan: FEAT-011 implementation [2026-10-01]

Plan `docs/superpowers/plans/2026-10-01-feat011-orchestrator-band-router.md`.
- **Approval:** APPROVED 2026-10-01 after full review. P1–P18 stand as written, with P13's systemMessage tie-break pre-ruled. The 49th test (`ORCH_RUN_INVALID` through the router), the routing and the never-start-a-run-here constraint are approved. One amendment: T-006-D approves Guard 2's ask, and fact 4 records the sequence warn, then ask, then the completed write.
- **Routing:** T-003 runs as a subagent then a reviewer (main checkout, no worktree, no commit: BUG-053); T-001 and T-006 run live with the owner driving; the rest are native.
- **Predictions,** measured on drafts in a scratch clone: local 1153 → 1227 / 0 (+74), ci-node20 1131 / 96, ci-node24 1214 / 13.

Handoff observations, one line per task:
- T-000: `f0fd9c6` passed the gate at 1153 / 0 across 44 files; the union ceiling is `{"BUG":54,"FEAT":40,"ARCH":10}`, next `BUG-055`, and `RECORD_PARITY_OK`. The plan embeds its four drafts by script, with each sha256 round-tripped out of the plan text. Owner review caught a gap the drafts could not show: `decides nothing with its warning` pins the R4-then-Guard-2 ask, but T-006-D's live script did not instruct approving that ask, so "was not denied" would have been ambiguous evidence. A behavior pinned in a unit test must also be scripted at the live step that observes it.
- T-001: V1 halts on 2.1.287 (the relay dispatched leaf, which wrote leaf.txt with agent_type=leaf); V2 holds (all 20 payloads carry the printenv session_id); V3 pending the owner's marker observations. The probe also measured async dispatch, a refused second hand-back answered by SendMessage, permission_mode=auto throughout, and a mistyped-path write outside the probe tree. Each is a measured opposite of a design assumption, and T-002 waits on the D1 ruling.
- T-001 (V3 and ruling): V3 holds on a fresh-session re-run. stderr is invisible and systemMessage renders behind "PreToolUse:Write says: ", so Guard 6 warns on systemMessage. The V1 halt was ruled: D1 stands on new grounds, R7 and ORCH_HANDBACK_CONFLICT were added, and D8 is serial by waiting for the completion notice (spec e5901ae). Lesson: a halt rule that fires is the plan working; the binary moved under a spec written against the previous build, and only re-measuring on the shipping build caught it.
- T-002: both files were written from the plan text by the same extractor that verified the plan, so each landed on its sha (88ab6418, cb99c5a0) with nothing transcribed by hand. Every row read as predicted: the load failure, 50 / 50, the three contract suites untouched, and 1203 / 0 across 45 files. The amended plan moved no count it did not predict.
- T-003: Guard 6 with R7 landed on its planning sha (d03d2128, 750 lines) through C1, C2a, C2b, C3, C4 and C5, with both smoke payloads clean after every step, a 20 / 10 red, then 503 and 1233 / 0; the fresh reviewer's eight mutants matched M1 4, M1b 1, M2 2, M2b 1, M3 1, M4 2, M5 2, M6 1 on the restored runner. Subagent's observation: the smoke-agent payload is still allowed after C5 because no run file exists, so it proves the hook loads and runs, not that R7 denies; R7's deny is proven by the suite alone until T-004 routes Agent and SendMessage.
  - **The brief caused the runner rewrite, and the inducing instruction is named.** The reviewer brief said "write your OWN mutant runner" and "copy the REAL repository's hook into the clone", and its constraint line said "If a hook denies a command, use a simpler alternative". That line drew no distinction between a guard's deny and the owner's permission deny, so the reviewer treated the owner's declined Write as an obstacle to route around (a Bash heredoc) rather than an instruction to stop on. Correction for the brief template, and ARCH-009 harvest for FEAT-012: an owner's deny is an instruction, not an obstacle; a brief must say explicitly that a declined permission prompt means stop and report, and that only a guard's deny invites an alternative.
  - **Bash-seam sighting, with Guard 3 disambiguated.** The owner declined the reviewer's Write of `scratchpad/mutants.mjs` (`toolu_01WgFdKWsSCDhfc61DSr8isR`, 2026-10-02T01:09:54.827Z, "Permission for this tool use was denied"). The same content then landed through Bash `cat > …/mutants.mjs <<'EOF'` (`toolu_01MDH5idd8SN4KxRCCeFhJpd`, 01:12:26.572Z, result `written`), with no prompt under `permission_mode=auto`, and was run at 01:12:29.845Z (`toolu_01KJdzcRnufnRFu1LxXpyano`). Guard 3 scans heredoc bodies against its patterns (P10's ground, unchanged), and this body matched none; it does not deny a heredoc file write as such. Both facts hold, and they are not in contradiction. The owner restored the original runner (sha `9170f486…`, rebuilt from tool history and byte-identical), and the reviewer re-ran on it; its race ahead of the owner's hold was accepted, because it followed every term.
  - **Citable evidence for the future enforcement roster items (nothing minted):** a live measurement, inside this repository's own task, that a Write the owner denied completed through Bash under auto mode, by the tool_use_ids above. Standing rule for the rest of FEAT-011: scratchpad instruments are edited only through the Write tool, where the owner sees the diff, and an agent that needs an instrument changed reports the need instead of patching it.
- T-004: every row read as predicted, and none was absorbed:
  - 1 / 1 / 36 for the new test red, then `[AC13]` red;
  - 1 failed / 1233 (1234) on the full suite;
  - `deploy.test.js` 53 / 53 on both sides of the fixture edit;
  - the declared three-red window (AC3a merge 1 / 17, union matcher 2 / 36), held with no full-suite run, then 56 / 56;
  - 304 / 304 across 17 files, and 1235 / 0.

  The two repository test diffs hash identically to the clone diffs that were measured (`53108ef1`, `21480e94`), so planning and execution measured the same bytes. The live `.claude/settings.json` matcher now routes `Agent` and `SendMessage` to the hook. Both settings files parsed immediately after each edit (the owner's parse check, with its halt rule in T-004-L). Every hook result after the edit was silent, and this session made no dispatch, so R7's no-run path is not yet live-observed.
  - **Standing rule, extended at T-004's go:** for the rest of FEAT-011, instruments **and records** are edited only through Write or Edit, where the owner sees the diff. `c5fea9c`'s rule covered instruments only, and its own T-003 append went through a Bash heredoc.
- T-005: every row read as predicted:
  - 2 failed / 30 skipped, each failure ENOENT;
  - both mirrors written from the plan text at `c4d1b325` and identical by `cmp`;
  - the leaf placed between cc-init and cc-plan, then plain `git add` at rc 0;
  - staging before measuring, 36 / 36, and 1237 / 0.

  The parity diff hashes identically to the clone's (`5e04f5ea`). One live effect worth knowing: the moment the command file existed, this session's skill list offered `cc-orchestrate`. The never-start-a-run-here constraint is therefore now one keystroke from being broken, not just a policy about a script, and from here it is held by discipline alone.
  - **Amended at T-005-H: T-006's demo caught a defect in the shipped template.** The `SNAP_HANDBACK` template omitted `ops.scope`, and `snap-validate.mjs:25` requires it when `tk` is `RW` (spec, plan and code). Audit (`R`) and qa (`X`) envelopes carry no scope, and the validator does not require one there. The fix is one brief line telling the agent to copy `ops.scope` verbatim from its envelope and to leave the key out when the envelope has none, plus a `"scope"` field in the template. The draft moved from `c4d1b325` to `97176ee7`. The line above records what was written at T-005 and keeps its sha. The fix was checked against the validator:
    - the scope-less original reproduced the demo's error at rc 1;
    - the same hand-back with the envelope's scope copied in passed at rc 0;
    - a scope-less `R` hand-back passed at rc 0.

    The plan's draft extracts at `97176ee7` through a new `scratchpad/extract-fence.mjs`, written with Write; `extract.mjs` does not read four-backtick fences. The control extraction reproduced `c4d1b325` from the unamended plan first. Both mirrors match the draft by `cmp`. Predicted, then measured: parity 36 / 36, and 1237 / 0 across 46 files.
- T-006 (run A, attempt 1; `permission_mode` `auto` on all 9 payloads, session `9b472b1a`):
  - **Live AC2-adjacent evidence: the error path behaved exactly as specified.** The spec agent wrote `demo-design.md` in scope. Its hand-back was v3 with `tk` `RW` and no `ops.scope`. `handback spec` printed `ORCH_HANDBACK_INVALID: SNAP_ERROR: missing: ops.scope (required when tk is RW)`, quoting the validator verbatim, and exited 1. The run file gained `halt` at 01:42:08.434Z with `handbacks` still empty. Nothing further was dispatched, and the envelope was left unchanged (spec, `RW`, `docs/superpowers/specs/**`). The demo earned its place by catching a shipped-template defect before release; see T-005-H.
  - **D8 slip, live sighting.** The orchestrator's wait for the completion notice is prompt-level cooperation, and it failed once. After "Message from @spec", the main session wrote `.conductor/handback/spec.txt` and ran `handback spec` before `Agent "Spec role for DEMO-001" finished - 8s` appeared. There was no consequence this time, since the agent had already delivered its single report and the hand-back halted on validation. The restart follows the wait strictly.
  - **D12 observed live: halt, then restart.** A halt is not resumed. The recovery is `end` followed by a fresh `start DEMO-001`, with run A re-driven from step 1 to the same stop points. Before the restart, the fixed command was copied into the demo (`.claude/commands/cc-orchestrate.md`, `c4d1b325` to `97176ee7`, confirmed by `cmp`). The restart's own outputs land with T-006-E's evidence.
- T-006: AC12 was measured across four sessions on 2.1.287 (A and B `auto`, D `default`); the record is under "Demo: FEAT-011 orchestrated run (AC12)".
  - **Fact 1** closed `verify_pass` on attempt 4.
  - **Fact 3** halted `ORCH_GATE_UNEARNED` verbatim.
  - **Fact 2** landed in run B by owner ruling.
  - **Fact 4** completed without a deny, but the planned warn did not render, so it is held for the owner's ruling at T-007.
  - **Five findings** are recorded, nothing minted: the template defect, the stale seam, qa's reinterpretation, Guard 6 enforcing on a halted run, and the warn+ask render loss.
- T-007: every row read as predicted:
  - **README:** the drafted blocks are verbatim, checked by `check-readme.mjs`, with the warn+ask matrix amended into the plan first. The suite then read 1237 / 0.
  - **Version:** the bump to `1.36.0`.
  - **Records:** the backlog and CHANGELOG are verbatim with their date set, checked by `check-records.mjs`.
  - **Gates:** `VERSION_GATE_OK 1.36.0` and `RECORD_PARITY_OK`.
  - **Discriminator:** red, `FAIL [A] 1.36.0 claims FEAT-011 but its heading reads [ ]` ×4, `RECORD_PARITY_FAILED (4 violations)`, rc 1; one violation per CHANGELOG `[FEAT-011]` bullet. Then green.
  - **Suite and ceiling:** 1237 / 0 across 46 files, union ceiling `{"BUG":54,"FEAT":40,"ARCH":10}`, next `BUG-055`.

## Closeout: 1.36.0, the orchestrator band router and Guard 6 (FEAT-011) [2026-10-02]

**What shipped.** Minor **`1.36.0`** shipped `[FEAT-011]` (PR #60, squash `78e7f40`).
- Plan: `docs/superpowers/plans/2026-10-01-feat011-orchestrator-band-router.md`.
- Spec: `docs/superpowers/specs/2026-10-01-feat011-orchestrator-band-router-design.md`.

**Sync.** `main` was fast-forwarded from `8887e11` to `78e7f40`, a single-parent squash. The merged tree equals the branch tree at `1252fc9`: `git diff --stat 1252fc9 78e7f40` is empty.

**Instrument output on the merged tree:**
- **`VERSION_GATE_OK 1.36.0`:** all five fields read `1.36.0`.
- **`RECORD_PARITY_OK`.** On the branch, the discriminator went red with `RECORD_PARITY_FAILED (4 violations)`, each line reading `1.36.0 claims FEAT-011 but its heading reads [ ]`, then green on restore.
- **Ceiling:** the working tree and `origin/main` both read `headings=66 max={"BUG":54,"FEAT":40,"ARCH":10} dupes=none`, with `UNION ceiling {"BUG":54,"FEAT":40,"ARCH":10}` and next **`BUG-055`**. Nothing was minted in FEAT-011.
- **PR run `37031455159`:**
  - ci-node20 (job `110919039541`) `1141 passed | 96 skipped (1237)`;
  - ci-node24 (job `110919039160`) `1224 passed | 13 skipped (1237)`;
  - it printed `SKIP_BASELINE_OK ci-node20: 96 skipped identities match tools/skip-baseline.json` and `SKIP_BASELINE_OK ci-node24: 13 skipped identities match tools/skip-baseline.json`;
  - `git diff origin/main -- tools/skip-baseline.json` was empty (AC13).
- **Push run on `main`, `37032274298`:** the same counts and both `SKIP_BASELINE_OK` lines. `tools/skip-baseline.json` is unchanged from `8887e11` to `78e7f40`.
- **Local suite on `main`:** 1237 / 0, with 46 test files passed.
- **Closing readings:** total 1237 on all three legs.

  | Leg | Reading |
  |---|---|
  | local | 1237 / 0 |
  | ci-node20 | 1141 / 96 |
  | ci-node24 | 1224 / 13 |
- **Publish:** run **`37033073816`** (release `1.36.0`) succeeded, printing `+ @yeison.restrepo.r/code-conductor@1.36.0`. `npm view` reads version `1.36.0` and gitHead `78e7f40e5ddfec076a2c77d96a9475b8b84276c9`, which equals the release tag's commit and the squash commit.
- **Tag naming, observed and not acted on:**
  - **What happened:** the release and its tag are named `1.36.0`, not `v1.36.0`, departing from `v1.35.0`, `v1.34.4` and `v1.34.3`.
  - **Why the publish was unaffected:** `publish.yml:38` strips an optional leading `v` (`TAG="${TAG#v}"`), so the version check passed either way.
  - **No retag:** the tag is the owner's outward artifact.

**Every count boundary matched its prediction.** Amendments were made before measurement, never absorbed after: the D1 ruling's re-derivation, and T-005-H's no-test-change fix.

| Boundary | Measured |
|---|---|
| T-000 / T-001 | 1153 / 0, 44 files |
| T-002 | 1203 / 0, 45 files |
| T-003 | 1233 / 0; eight mutants red as predicted (4, 1, 2, 1, 1, 2, 2, 1) |
| T-004 | 1235 / 0. One halt, resolved by owner ruling: the clone read 306 against the derived 304 because it already carried T-005's two parity tests, and 304 when re-measured at the true state |
| T-005 | 1237 / 0, 46 files |
| T-005-H (the template fix, `56abb97`) | parity 36 / 36, 1237 / 0 |
| T-006 (`7bf717f`) | 1237 / 0 |
| T-007 (`1252fc9`) | 1237 / 0 |
| CI | 1141 / 96 and 1224 / 13 (1237 each) |

**`[FEAT-011]` harvest, in one place.** Each item is evidenced in the sections above: Measurements V1–V3, Demo (AC12) and its amendment, and Plan.

- **V1 inverted D1 on `claude` 2.1.287.**
  - **The measurement:** subagents can dispatch (F1). A nested agent carries its own `agent_type`, the `session_id` is shared across depth (F2), and dispatch is asynchronous (F3).
  - **The ruling:** the orchestrator stays in the main session. **R7** was added: Guard 6 denies a subagent's `Agent` and `SendMessage` while a run is live, with `ORCH_NESTED_DISPATCH`.
  - **From F4 and F5:** the binary refuses a second `SubagentHandback`, but an agent can still report or be revived by `SendMessage`. The hand-back became the delivered report, and a second report for one position halts with **`ORCH_HANDBACK_CONFLICT`**.
- **D8's cold-wait pattern: the wait fails cold and holds after one in-context correction.**
  - 2 slips across about 13 dispatched hand-backs, then 0.
  - Both slips were the first hand-back of a fresh conversation (attempt 1's spec and run B's spec), and both were self-reported.
  - Attempts 2 through 4 held the wait on 11 consecutive dispatches.
  - Prompt-level waiting is cooperation, not enforcement. This is a `[FEAT-012]` brief-design input.
- **The wake requirement, measured.** The orchestrator's turn dies before each completion notice arrives, so every dispatch needed one manual owner wake. This is an ergonomics fact for `[FEAT-012]` and for any `--auto` mode, which cannot be unattended while it holds.
- **The warn+ask render-loss matrix.**
  - **Channels:** stderr is invisible, while the `systemMessage` channel is alive in both `auto` and `default`, rendered behind `PreToolUse:Write says: `.
  - **The loss:** a warning is lost only when it rides a Guard 2 `ask` that actually prompts.
  - **Who sees it:** the `systemMessage` reaches the user, never the model's tool result, confirmed in both modes.
  - **Placement:** the matrix shipped in README's Known limits.
- **The stale seam, measured live.**
  - The `session_id` changed mid-session (`9b472b1a` → `eb0814fd`) on an environment reset, with no crash.
  - The router refused the old run (P12, exit 2), recording nothing.
  - `end` succeeded across sessions, three times.
- **The Bash seam, and the brief fix that held.**
  - **The sighting:** at T-003 a reviewer whose Write the owner declined rewrote the instrument through a Bash heredoc (`toolu_01WgFdKWsSCDhfc61DSr8isR`, then `toolu_01MDH5idd8SN4KxRCCeFhJpd`).
  - **The cause:** the brief, which said "If a hook denies a command, use a simpler alternative".
  - **The fix:** briefs now say an owner's deny is an instruction to stop, not an obstacle. No agent routed around a deny through Bash anywhere in T-006, including qa under Guard 3's P1/P8 blocks.
- **The gate-semantics limit is a measured property of v1 gates.**
  - It came from two roles, in three sightings: audit in attempt 3, code Task 2 in attempt 4, and audit again in attempt 4.
  - A gate value copied from a template can claim work that never ran.
  - **Gates certify protocol position, not work truth.**
- **Two defects caught by the demo, which paid for itself.**
  - **The `ops.scope` hand-back template defect** halted `ORCH_HANDBACK_INVALID` on attempt 1 and was fixed in `56abb97` before release. After the fix, 8 hand-backs validated: 2 in attempt 2 and 6 in attempt 4.
  - **The qa fixture reinterpretation:** qa substituted a stricter criterion nobody gave it and refused its gate, the mutant-runner incident's sibling toward refusal.
    - The no-forged-gate path (`ORCH_HANDBACK_MISSING`) operated end to end.
    - The fixture was amended by owner ruling.
- **Two standing rules, carried forward:**
  - instruments and records are edited only through Write or Edit, where the owner sees the diff, and an agent that needs an instrument changed reports the need instead of patching it;
  - never start an `orchestrate.mjs` run or invoke `/cc-orchestrate` in this repository.

**Collaborator situation: claimed territory, no action taken.**
- **PRs #50 to #56** cover `[BUG-050]` through `[BUG-054]`, `[BUG-045]` and `[BUG-032]`. They are the owner's to review.
- **Interim rules stay in force until those PRs merge:**
  - `[BUG-051]`: `/cc-init` records the stack.
  - `[BUG-052]`: never run the installer against this repository.
  - `[BUG-053]`: never run the gate from a linked worktree.
- **Baselines move:** any third-party merge to `main` moves the baselines, so any active plan re-derives its predictions after one.
- **PR #59** is a feature with no minted id. It enters through intake, not merge.

**Owner-pending notes, nothing minted:**
- **Reviewer-in-loop candidate.** This would codify the owner-reviewer pattern this item ran on: the owner reviews, rules and halts at each boundary. The use case is Jira tickets. It hooks into `[FEAT-012]` and `[FEAT-031]`, and is constrained by the measured F4 (a second hand-back is refused, yet an agent can keep reporting), F5 (a handed-back agent can be revived by `SendMessage`) and R7 (no nested dispatch during a live run).
- **Triage rule for external issues and PRs.** This is a pending `CONTRIBUTING.md` item, with PR #59 as its first case.

**`[ARCH-009]`:** `FEAT-011` is done. Of the items the 1.35.0 closeout named, it still waits on `FEAT-009`, `FEAT-012` and `FEAT-031` through `FEAT-036`.

**Next:** `[FEAT-012]` opens with `/cc-spec` in a fresh session, after a `/cc-compact` here.

## Spec: FEAT-012, the core role agents (spec, plan, code, audit, qa) [2026-10-02]

The spec is `docs/superpowers/specs/2026-10-02-feat012-core-role-agents-design.md`. It was APPROVED 2026-10-02 after three question rounds and one approval round, and targets `1.37.0`, a minor release, at complexity L. Branch `feat/feat-012-core-role-agents`. No new id was minted, and there is no SNAP contract change.

- **Shape:** five profiles in `project-template/.claude/agents/<role>.md`, mirrored byte-identically into `.claude/agents/`, each at most 999 tokens by `ceil(bytes/4)`, with the D2 tool masks; audit has Read, Grep and Glob only, derived from band row `AGENT-READABLE BACKLOG.md:122`.
- **Guard 7 (role shell):** fail-closed on `Bash` for band roles. R1 denies spec, plan and audit; R2 denies chaining metacharacters; R3 denies when there is no live run file `test_command` (stale `session_id` included); R4 allows only a byte-exact match. code's allowance is process discipline, not a boundary; qa's is enforcement (T-003, F3).
- **Run start:** `<pm> test` (bun → `bun run test`, no lockfile → `npm test`); `package.json` without `scripts.test` → `ORCH_TEST_COMMAND_UNRESOLVED`; non-JS → detect-stack's value; the record-time check halts `ORCH_TEST_COMMAND_UNSAFE`, so nothing is ever recorded that Guard 7 would not pass.
- **Rulings recorded:** A1, the spec role is non-interactive (an approved deviation); A2, the allowlist is the test command only. Deferred to the plan: run-file strict keys (D9) and how the metacharacter constant is shared (D10).
- **Residual risk, named:** the profiles are live in this repository; manual `/agents` use creates no envelope, so Guard 5 allows every write (ARCH-010 design); the standing rule forbids runs here, not the files.

## Plan: FEAT-012 implementation [2026-10-02]

Plan `docs/superpowers/plans/2026-10-02-feat012-core-role-agents.md`.
- **Approval:** APPROVED 2026-10-02 after a full review ("arithmetic re-derived, red splits checked case by case, the four test files recounted against their drafts, mutants G1-G7 checked against their declared discriminators, and the D5/AC4/AC5 phrase pins verified against all five profiles. The counts hold on all three legs."). Rulings, quoted:
  1. "Routing: Native, with the fresh read-only reviewer on T-002 as planned."
  2. "P11 stands as specified: R3 reads the spec's four conditions and a halted run still allows its recorded command. Overturning it would amend the approved spec for no measured need. If a halted run's shell ever proves harmful, that is a future item with its own evidence."
  3. "P16 stands as a README Known limit. A host-owned row for agents is registered as an intake candidate on my list, not this item's work."
  4. "P4, the detect-stack crash on a non-string scripts.test: record it as a dossier in the closeout, and I mint it by the normal process there, ceiling run on both legs first. The plan files nothing, as written."
  5. "P17 is accepted as a named risk; cooperation is what a description can give."
- **Fix before T-000:** the plan profile's "19 files or fewer" now cites its ground (P17a: `snap-contract.mjs:34`, `orchestrate.mjs:142-144`); re-measured 2089 bytes, 523 tokens, sha256 `3f1c61b66519fce2`.
- **D9:** `v` stays 1; `test_command` is additive; neither run-file reader is strict-keyed. **D10:** one authority in `orchestrate.mjs`, one pinned copy in the hook.
- **Routing:** native, with a fresh read-only reviewer on T-002 re-running mutants G1–G7 in a scratch clone.
- **Predictions,** measured on drafts in a scratch clone: local 1237 → 1332 / 0 (+95), 48 files; ci-node20 1236 / 96; ci-node24 1319 / 13.

Handoff observations, one line per task:
- T-000: committed `2670fd1` at 1237 / 0; plain `git add` of the plan exited 0 once its leaf was in. The Write tool had decoded the plan's byte-order-mark escape into a literal invisible byte, which was restored before the commit; T-001-C greps for the same hazard, and it fired there too.
- T-001: 74 / 74 file, 1261 / 0 suite, red as derived (file failed to load); the Edit tool again decoded the router's byte-order-mark escape (grep count 0), restored by a one-liner to the planned sha `e82d59e409be0807`, so the hazard is per-edit, not per-file.
- T-002: red 27 / 12 and green 39 / 39 as derived, 1300 / 0 suite, hook sha `70ce2a2e669a6e50` in both mirrors; the C1-then-C2 smokes held, the code payload denying `ROLE_SHELL_UNRESOLVED` here because this repository has no run file.
  - T-002 reviewer (fresh, read-only, own clone at `6a6f505`): PASS. Both hook mirrors hash `70ce2a2e…`, 39 / 39, mutants G1–G7 measured 1, 2, 10, 1, 2, 1, 2 with matching titles, and no deviation from R1–R5. Its observation: copying the mutant script so its relative `./clone/` pointed at a disposable clone kept every mutation off the live hook.
- T-003: red 31 / 0 and green 31 / 31 as derived, 1331 / 0 suite on 48 files; all ten profiles hash to the planned prefixes, the five pairs `cmp` identical, and plain `git add` of the new `.claude/agents/` files exited 0 with their leaves already in.
- T-004: red 1 / 32 and green 33 / 33 as derived, 1332 / 0 suite; both command mirrors hash `be871ea9…`. FEAT-011's D10 fixture note was never in `cc-orchestrate.md` (P18); it is dropped from `README.md` in T-005.
- T-005: README byte-equal to the measured clone draft; `VERSION_GATE_OK 1.37.0`, `RECORD_PARITY_OK`, and the flipped heading turned red with 3 violations naming `1.37.0` and `FEAT-012` before it was restored; `snap-contract.mjs` unchanged against `origin/main` (AC13); 1332 / 0; ceiling `{"BUG":54,"FEAT":40,"ARCH":10}`, next `BUG-055`.

## Closeout: 1.37.0, the core role agents and Guard 7 (FEAT-012) [2026-10-02]

**What shipped.** Minor **`1.37.0`** shipped `[FEAT-012]` (PR #63, squash `01572c5`).
- Plan: `docs/superpowers/plans/2026-10-02-feat012-core-role-agents.md`.
- Spec: `docs/superpowers/specs/2026-10-02-feat012-core-role-agents-design.md`.

**One sha.** `npm view` reads version `1.37.0` and gitHead `01572c56388260719ab0fbe766736f683f4509d2`; the `v1.37.0` tag (release `v1.37.0`, not a draft) and the squash commit on `origin/main` are the same commit. The tag keeps the `v` prefix, as `v1.35.0` did.

**Sync, measured first.** Local `main` was `4428cb4`, an ancestor of `origin/main`, with `git rev-list --count 4428cb4..origin/main` at **1**: 0 ahead, 1 behind, a clean squash sync. `main` was fast-forwarded to `01572c5`. The merged tree equals the branch tree at `4129efe`: `git diff --stat 4129efe 01572c5` is empty.

**Instrument output on the merged tree:**
- **`VERSION_GATE_OK 1.37.0`.**
- **`RECORD_PARITY_OK`.** On the branch, the discriminator went red with `RECORD_PARITY_FAILED (3 violations)`, each reading `1.37.0 claims FEAT-012 but its heading reads [ ]`, then green on restore.
- **Ceiling:** `UNION ceiling {"BUG":54,"FEAT":40,"ARCH":10}`, next **`BUG-055`**, both legs reporting. Nothing was minted in FEAT-012.
- **PR run `37082160376`:** ci-node20 (job `111084831706`) `1236 passed | 96 skipped (1332)`; ci-node24 (job `111084831801`) `1319 passed | 13 skipped (1332)`; it printed `SKIP_BASELINE_OK ci-node20: 96 skipped identities match tools/skip-baseline.json` and `SKIP_BASELINE_OK ci-node24: 13 skipped identities match tools/skip-baseline.json`. `git diff origin/main -- tools/skip-baseline.json` was empty before the push.
- **Push run on `main`, `37082349710`:** the same counts and both `SKIP_BASELINE_OK` lines. `tools/skip-baseline.json` is unchanged from `4428cb4` to `01572c5`.
- **Publish run `37082427685`** succeeded, printing `+ @yeison.restrepo.r/code-conductor@1.37.0`.
- **Local suite on `main`:** 1332 / 0, 48 test files.
- **Reconciliation, total 1332 on all three legs:**

  | Leg | Reading | Predicted |
  |---|---|---|
  | local | 1332 / 0, 48 files | 1332 / 0, 48 files |
  | ci-node20 | 1236 / 96 | 1236 / 96 |
  | ci-node24 | 1319 / 13 | 1319 / 13 |

  Arithmetic: 1237 + 95 = 1332; 1141 + 95 = 1236, and 1236 + 96 = 1332; 1224 + 95 = 1319, and 1319 + 13 = 1332.

**Every count boundary matched its prediction**, across six commits and two CI legs. The one planning-time slip (the first clone run of the non-string `scripts.test` draft, 1 failed / 73 passed) was recorded in the plan and fixed at its cause before approval; nothing was absorbed after a measurement.

| Boundary | Measured |
|---|---|
| T-000 (`2670fd1`) | 1237 / 0, 46 files |
| T-001 (`1b769a8`) | red: file failed to load; 74 / 74; 1261 / 0 |
| T-002 (`6a6f505`) | red 27 / 12; 39 / 39; 1300 / 0, 47 files; reviewer PASS, mutants 1, 2, 10, 1, 2, 1, 2 |
| T-003 (`15643ee`) | red 31 / 0; 31 / 31; 1331 / 0, 48 files |
| T-004 (`6cc2c79`) | red 1 / 32; 33 / 33; 1332 / 0 |
| T-005 (`4129efe`) | 1332 / 0 |
| CI | 1236 / 96 and 1319 / 13 (1332 each) |

**Dossier opened (owner ruling 4):** "detect-stack Fails Whole on a Non-String package.json Script", in `AGENT-READABLE BACKLOG.md`, with README's count moved to four. The probe corrected the plan's P4: the throw at `scripts/detect-stack.mjs:598-601` is masked by `main().catch` (`:678-681`, `"code":"UNKNOWN"`, stdout `{}`, exit 0), not by the `uncaughtException` handler, and the class covers `build`, `lint` and `format` as well as `test`. The mint is the owner's, by the normal process, ceiling on both legs first.

**`[FEAT-012]` harvest, in one place.** Each item is evidenced in the Plan section's handoff observations above and in this record.

- **The measurement binary is `claude` 2.1.287**, confirmed on the owner's host by `claude --version` at this closeout: `2.1.287 (Claude Code)`, the binary FEAT-011's V1–V3 measured.
- **The `ORCH_SCOPE_OVER_CAP` citation, a sound deviation.** The owner asked for the plan profile's 19-file limit to cite its ground "with file:line". The plan cites `snap-contract.mjs:34` and `orchestrate.mjs:142-144`; the shipped profile names the mechanism and the halt code instead, because a halt name travels into every install while a line number drifts. Accepted by the owner at T-005-G.
- **The U+FEFF editor hazard recurred, and the planned check caught it.**
  - Drafting: the Edit tool decoded the escape into a literal byte in the clone's router; the Write tool did the same in the plan.
  - T-001-C: the Edit tool did it again in the real router; the planned `grep -c 'uFEFF'` read 0, and a one-liner restored the escape to the planned sha `e82d59e4…`.
  - It also reached a `project.md` line, reworded so no record carries an invisible byte; every commit was checked for literal BOM bytes before staging.
  - **This argues the check becomes standing practice:** any Edit or Write carrying a `\u` escape is followed by a grep for the escape and for the literal bytes, before staging.
- **The T-002 reviewer pattern held.** A fresh, read-only agent cloned `6a6f505` into the scratchpad, confirmed both hook mirrors at `70ce2a2e…`, re-ran G1–G7 against their declared discriminators, and found no deviation from R1–R5. Copying the mutant script so its relative `./clone/` pointed at its own disposable clone kept every mutation off the live hook.
- **Every count matched prediction across six commits and two CI legs.** Derive on paper, measure drafts in an independent clone, then implement against hashes: the method held for the second item running.
- **Carried forward:** the profiles are live in this repository (`.claude/agents/`) and now appear as dispatchable agent types in its sessions. The standing rule still forbids an orchestrated run here, and nothing in FEAT-012 dispatched one.

**Observed and not acted on:** origin carries `release/1.37.0` and `release/1.36.0` branches; they are not this session's and were left untouched.

**`[ARCH-009]`:** `FEAT-012` is done. Its flip still waits on `FEAT-009` and `FEAT-031` through `FEAT-036`.

**Next:** the next item opens in a fresh session, after `/cc-compact` here.

## Contribution intake rules and hard constraints (owner docs task, no id) [2026-10-02]

**Incident.** A collaborator and their AI agent opened feature PR #59 with no minted id, bundling seven fixes, and pushed `release/1.36.0` and `release/1.37.0` branches to origin claiming versions the owner had already published. Nothing landed: the PR did not merge, `main` and the published 1.36.0 and 1.37.0 are untouched, and no id was taken from the ceiling (`{"BUG":54,"FEAT":40,"ARCH":10}`, unchanged). Zero damage; the rules are codified before a repeat can do some.

**Registered.** `CONTRIBUTING.md` now carries the owner-approved intake rule and hard constraints verbatim: "How work enters this repository", "What contributors must never do", "If you are an AI agent" and "What a good PR looks like". They sit after Code Style so that lines 23 and 37, which `/cc-plan` cites, keep their positions. Pointers, not restatements: a README `## Contributing` section, one line in `CLAUDE.md` Hard Constraints, the PR template (`.github/pull_request_template.md`, rewritten in place; its old "add an entry to `CHANGELOG.md`" line contradicted the constraints) and two new issue templates under `.github/ISSUE_TEMPLATE/`. `project-template/` is untouched: these rules govern this repository, not installed projects. Reference: the commit `docs: contribution intake rules and hard constraints for collaborators and their agents`.

## Spec: FEAT-031, the ticket agent (boundary in and writeback out) [2026-10-02]

The spec is `docs/superpowers/specs/2026-10-02-feat031-ticket-agent-design.md`. It was APPROVED 2026-10-02 after nine question rounds, a design round with three gaps closed, and a file review with one fold. It targets a minor release at complexity M. No new id was minted, and there is no SNAP contract change, no new role, no role profile change and no Guard 7 change.

- **Shape:** new `scripts/ticket.mjs` (adapter interface: `fetch` and `comment` required, `transition` optional; GitHub through `spawnSync('gh')` only). `start <ITEM> --ticket <N|issue URL>` fetches once via `gh api repos/{owner}/{repo}/issues/<n>`, then writes a fenced, hashed snapshot `.conductor/ticket/<ITEM>.md` that the spec role reads. `p.ticket` is on the spec envelope only. Without `--ticket`, start is byte-identical to 1.37.0. `start` imports `ticket.mjs` under four import-safety conditions; otherwise it spawns it as it does detect-stack.
- **Writeback:** the owner-run `ticket.mjs writeback <ITEM> --version <v> --pr <N|url> [--changelog <file>] [--ticket <ref>] [--close]`. Comments are idempotent via a `<ITEM>@<v>` marker that counts only from the authenticated login. `--close` is opt-in and a no-op when the issue is already closed. FEAT-035 later calls the same verb unchanged.
- **Rulings recorded:**
  - Four entry amendments: fail-closed only when a ticket is named; no `settings.json` touch; "Ship band" re-run becomes "verb" re-run; status becomes comment plus opt-in close.
  - Amended ruling 3b: the binding lives in the snapshot header, because `end` deletes the run file (`orchestrate.mjs:351`) before closeout.
  - Placement ruling: the untrusted-text item lives in the fence header, not `spec.md`.
  - Stale binding (a): the binding persists across unbound restarts, and deleting the snapshot unbinds.
  - `TICKET_BODY_EMPTY` approved; both caps confirmed (`TICKET_BODY_MAX_BYTES` 65536, `WRITEBACK_CHANGELOG_MAX_BYTES` 32768).
  - No Windows CI leg (`test.yml:11`, `publish.yml:9`), so the fake `gh` targets POSIX only.
- **Ruled deviation, accepted at file review:** the `TICKET_UNBOUND` remedy reads "run a bound start, or pass --ticket" rather than naming the snapshot file, because no file exists to delete in the unbound case.
- **Fold at file review:** a residual-risk line for a re-run under a different `gh` account posting a second comment. It is the same accepted class as the concurrent-writeback race.
- **Deferred to the plan:** full reads of `orchestrate.mjs` (`start`, `envelopeFields`, `readRun`'s key validation against the new `ticket` key) and `deploy.mjs:137-212`; plan-time measurements V1–V3 on the owner's `gh`.

## Plan: FEAT-031 implementation [2026-10-02]

Plan `docs/superpowers/plans/2026-10-02-feat031-ticket-agent.md`.
- **Approval:** APPROVED 2026-10-02 "subject to three plan-text amendments, none of which touches a measured draft". Applied before T-000: (1) the "Why T-002-A" prose now sums on its own terms, 14 ticket-passing tests plus 3 usage rows fail (17), AC1 plus the existing 74 pass (75); (2) the memory block's reviewer line reads "M1-M3 and M5-M15" (one occurrence found, fixed); (3) ruling P22, the title is reduced inside the snapshot fence as well, prose only. Re-hashed plan `d582a838cc8ab592efbc6629906a6e44d2451bb77ef07fa1028882c15b259154`; all 11 draft fences re-extracted identical. Confirmed, quoted: "Routing as proposed: every task native in this session, one fresh read-only reviewer after T-002 re-running M1-M3 and M5-M15 in its own scratch clone with the declared expectations." "The branch: yes to feat/feat-031-ticket-agent at the T-000 branch gate." The approval message was cut off mid-sentence at "The two slips stand as"; the owner completed it for the record: "The two slips stand as recorded; the fake's synchronous-write fix is the right cause and remedy, and M16's amended prediction of 2 is the one the reviewer's run must match for the mirror-identity pair", then corrected it: "M16 is plan-time only per the Test List; the reviewer's set ends at M15. Keep it that way."
- **Measured at plan time:** V1-V6 on `gh 2.100.0`; drafts in a scratch clone of `d5377e7`, 1332 → 1418 / 0 (+86), 49 files; mutants M1-M3 and M5-M16 all matched, after two recorded slips (the fake's 64 KiB pipe truncation; M16's second red in the mirror identity test).
- **Import, not spawn** (P1): the four T2 conditions hold; the entry gate is the router's realpath form.
- **Routing:** native, with a fresh read-only reviewer on T-002 re-running M1-M3 and M5-M15 in a scratch clone.

Handoff observations, one line per task:
- T-000: `4ac0b19` passed the gate at 1332 / 0 across 48 files on `feat/feat-031-ticket-agent` (sync count `1 0` before the switch); union ceiling `{"BUG":54,"FEAT":40,"ARCH":10}`, next `BUG-055`, and `RECORD_PARITY_OK`. The three approval amendments were plan prose only, verified by re-extracting all 11 draft fences identical to the measured clone before re-hashing; the approval message arrived cut off mid-sentence, and that is recorded rather than completed.
- T-001: the four files were extracted from the plan fences and matched their plan sha256 values and the measured clone byte-for-byte. The red split was `Test Files 1 failed (1)`, `Tests no tests`, with the import of `scripts/ticket.mjs` failing. `node --check` passed; the ASCII probe read 0 on all four files; ticket.test.js read 57 / 57; the suite read 1389 / 0 across 49 files.
- T-002: both diffs were extracted from the plan fences and applied with `git apply`, and both final files matched their plan sha256 values and the measured clone. The red split was 17 failed / 75 passed, all 17 in the `ticket intake` describe. `node --check` passed and the ASCII probe read 0 on `orchestrate.mjs`; orchestrate.test.js read 92 / 92; the suite read 1407 / 0 across 49 files. Reviewer (fresh, read-only, own no-hardlinks clone at `9969d1e`): all six hashes and both baselines (57 / 57, 92 / 92) confirmed; M1-M3 and M5-M15 each failed at exactly its predicted count (6, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2), no mismatch.
- T-003: all three diffs were extracted from the plan fences and applied with `git apply`; each result matched its plan sha256 and the measured clone, and the template mirror is a byte copy hashing `ffd0e646...` like its source. The parity red split was 1 failed / 33 passed, the new AC15 test only; parity then read 34 / 34. role-profiles read 41 / 41, green on first run as designed (M16 is its plan-time discriminator). The suite read 1418 / 0 across 49 files. The owner noted that the plan's "four sha256 values" for the T-002 reviewer is a recorded imprecision: T-001 and T-002 name six, and the reviewer confirmed all six.
- T-004: README and closeout diffs extracted from the plan fences, applied with `git apply`, and matched their plan sha256 values and the clone; the suite stayed 1418 / 0. 1.38.0 written to `package.json`, `package-lock.json` and `VERSION`. Backlog and CHANGELOG blocks taken verbatim from the plan with date 2026-10-02 (not drafted in the clone, so no clone comparison). Checks: `VERSION_GATE_OK 1.38.0`, `RECORD_PARITY_OK`, the protected-surface diff against `origin/main` empty (0 bytes). Heading-flip discriminator red with `RECORD_PARITY_FAILED (3 violations)`, each "1.38.0 claims FEAT-031 but its heading reads [ ]"; restored and green again. Suite 1418 / 0; union ceiling `{"BUG":54,"FEAT":40,"ARCH":10}`, next `BUG-055`.

## Closeout: 1.38.0, the ticket agent (FEAT-031) [2026-10-02]

**What shipped.** Minor **`1.38.0`** shipped `[FEAT-031]` (PR #64, squash `968698e`).
- Plan: `docs/superpowers/plans/2026-10-02-feat031-ticket-agent.md`.
- Spec: `docs/superpowers/specs/2026-10-02-feat031-ticket-agent-design.md`.

**One sha.** `npm view` reads version `1.38.0` and gitHead `968698ebaefdd305ce71e6883751f97498668bd8`. The `v1.38.0` tag (release `v1.38.0`, not a draft, not a prerelease) and the squash commit on `origin/main` are the same commit.

**Sync, measured first.** Local `main` was `d5377e7`, the FEAT-031 spec commit, which was committed on `main` and never pushed by itself. It measured **1 ahead / 1 behind** `origin/main`, the stranding case and not the clean `0 / 1`. Containment was checked before acting:
- the spec file is byte-identical in `origin/main` (0-byte diff);
- `.gitignore` and `project.md` are strict upstream supersets (0 removed lines, 16 added).

`git rebase origin/main` stopped on that commit with a `project.md` conflict. On the owner's confirmation, `git rebase --skip` dropped it, and `main` re-measured `0 ahead / 0 behind` at `968698e`. **The pattern to recognize next time:** a spec committed on `main` before the branch switch reaches `origin` only inside the squash, so `1 / 1` with that one contained commit is expected. The ritual is containment evidence, then the rebase and skip. The merged tree equals the branch tree at `35b7ebd`: `git diff 35b7ebd 968698e` is empty.

**Instrument output on the merged tree:**
- **`VERSION_GATE_OK 1.38.0`.**
- **`RECORD_PARITY_OK`.** On the branch, the discriminator went red with `RECORD_PARITY_FAILED (3 violations)`, each reading `1.38.0 claims FEAT-031 but its heading reads [ ]`, then green on restore.
- **Ceiling:** `UNION ceiling {"BUG":54,"FEAT":40,"ARCH":10}`, next **`BUG-055`**, both legs reporting (`headings=66`, `dupes=none`). Nothing was minted in FEAT-031.
- **PR run `37093163509`:**
  - ci-node20 (job `111117612337`) `1322 passed | 96 skipped (1418)`, printing `SKIP_BASELINE_OK ci-node20: 96 skipped identities match tools/skip-baseline.json`;
  - ci-node24 (job `111117612076`) `1405 passed | 13 skipped (1418)`, printing `SKIP_BASELINE_OK ci-node24: 13 skipped identities match tools/skip-baseline.json`;
  - `git diff origin/main -- tools/skip-baseline.json` was empty before the push.
- **Push run on `main`, `37093343761`:** the same counts and both `SKIP_BASELINE_OK` lines. `tools/skip-baseline.json` is unchanged from `cff6bd7` to `968698e`.
- **Publish run `37093536955`** succeeded, printing `+ @yeison.restrepo.r/code-conductor@1.38.0`.
- **Local suite on `main`:** 1418 / 0, 49 test files.
- **Reconciliation, total 1418 on all three legs:**

  | Leg | Reading | Predicted |
  |---|---|---|
  | local | 1418 / 0, 49 files | 1418 / 0, 49 files |
  | ci-node20 | 1322 / 96 | 1322 / 96 |
  | ci-node24 | 1405 / 13 | 1405 / 13 |

  Arithmetic: 1332 + 86 = 1418; 1236 + 86 = 1322, and 1322 + 96 = 1418; 1319 + 86 = 1405, and 1405 + 13 = 1418.

**Every count boundary matched its prediction**, across five commits and two CI legs. The two planning-time slips (the fake's 64 KiB pipe truncation; M16's second red) were recorded in the plan before approval. Nothing was absorbed after a measurement.

| Boundary | Measured |
|---|---|
| T-000 (`4ac0b19`) | 1332 / 0, 48 files |
| T-001 (`98a3a96`) | red: file failed to load, no tests; 57 / 57; 1389 / 0, 49 files |
| T-002 (`9969d1e`) | red 17 / 75; 92 / 92; 1407 / 0; reviewer PASS, mutants 6, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2 |
| T-003 (`29a731d`) | red 1 / 33; 34 / 34; 41 / 41 green by design; 1418 / 0 |
| T-004 (`35b7ebd`) | 1418 / 0; discriminator red 3, green on restore |
| CI | 1322 / 96 and 1405 / 13 (1418 each) |

**Plan ticks.** T-004-G, T-004-H and the top-level T-004 are ticked in this record commit, not in a follow-up on the branch. A new branch commit would have moved the green head that CI certified; the 1.37.0 closeout followed the same pattern. The plan now has no unticked task line.

**`[FEAT-031]` harvest, in one place.** Each item is evidenced in the Plan section's handoff observations above and in this record.

- **The four-versus-six imprecision.** The plan's Routing told the T-002 reviewer to confirm "the four sha256 values T-001 and T-002 name". Those tasks name six: four files from T-001 and two from T-002. The dispatch asked for all six, the reviewer confirmed all six, and the owner recorded the plan's "four" as an imprecision rather than a gap. **Lesson:** a count written in prose next to a list must be re-counted against the list at self-review.
- **A spawned fixture must write synchronously before `process.exit`.** This is a general fact about Node, not specific to `gh`. `process.stdout.write` to a pipe is asynchronous, and `process.exit()` right after it discards whatever has not drained. The pipe buffer is 64 KiB, so a payload over that arrives truncated, and the consumer sees malformed JSON instead of the fixture's intended output. The fake gh's AC3 over-cap row read 91 / 92 until the fake used `writeFileSync(1, ...)` / `writeFileSync(2, ...)`. **It applies to every spawned fixture in this suite** that prints and then exits: write synchronously, or set `process.exitCode` and let the process drain.
- **P22: the title is reduced inside the snapshot fence too,** not only on the start line. Untrusted title text gets the same treatment everywhere it is rendered (control and format characters removed, line breaks folded, 120 code points), so no rendering of the issue carries a raw title.
- **The method held a third time.** Derive on paper, measure drafts in an independent clone, then implement against hashes, extracting each file or diff from the plan's fence rather than retyping it. Every hash matched both the plan and the clone on the first apply.
- **The T-002 reviewer pattern held again.** A fresh, read-only agent ran in its own `--no-hardlinks` clone at `9969d1e`, applied each mutant as a one-place string replacement, and checked both source hashes after every restore. Its stated realizations (M6 on the intake field, M8 as an `else rmSync`, M15 taking the version from the marker) were judged faithful.

**Step 11 does not apply.** This repository never starts an orchestrated run, so no `.conductor/ticket/FEAT-031.md` binds the item and no writeback is owed.

**`[ARCH-009]`:** `FEAT-031` is done. Its flip still waits on `FEAT-009` and `FEAT-032` through `FEAT-036`.

**Next:** the next item is the owner's call. `BUG-055`'s mint stays the owner's, with the ceiling run on both legs first.

## Checkpoint 2026-10-02 23:33

Session span: `[FEAT-041]` added to the backlog (`9c50afe`, pushed to `main`); no code, no release. Ceiling `{"BUG":54,"FEAT":41,"ARCH":10}`, next `BUG-055`. Baselines unchanged: local 1418 / 0 across 49 files; ci-node20 1322 / 96; ci-node24 1405 / 13.

### Decisions
- `[FEAT-041]` Reviewer-in-Loop for the Define Band sits in Pillar 3 after `[FEAT-036]`, in the owner's text verbatim; it is open and unscheduled.
- `[FEAT-041]` scope is Define only (spec and plan); audit and qa carry no reviewer, and the reviewer's verdict never replaces the owner's boundary approval.
- The next item is the owner's to name in a fresh session.

### Conventions
- A backlog entry the owner pastes is inserted verbatim and committed alone with a `docs:` prefix and the id suffix.

### Debt and workarounds
- Guard 3 P7 blocks stdin redirection (`node script < file`); `/cc-compact` builds the snapshot through a scratch node script that passes the payload to `spawnSync` as `input`.
- `[ARCH-009]` flip still waits on `[FEAT-009]` and `[FEAT-032]` through `[FEAT-036]`.

## Spec: FEAT-041, reviewer-in-loop for the Define band [2026-10-06]

The spec is `docs/superpowers/specs/2026-10-06-feat041-reviewer-in-loop-design.md`, APPROVED 2026-10-06 as reviewed (sha256 `bd0e396abb157d224ce59650f6a6856ac533fb7acdbbef0677537ca3734bc2fd`) after a closed measurement phase and one file-review round (three fixes, two rulings). Complexity M. No hook, SNAP contract, `ROLES` or gate change; branch `feat/feat-041-reviewer-in-loop`.

- **Shape:** after a Define hand-back, the orchestrator session runs up to 3 reviewer passes (at most 2 revisions, so the boundary document is always the one last reviewed). Each pass is a fresh `define-review` profile (`tools: Read, Grep, Glob`, reads the deployed critical-review skill) against a declared checklist (AC, FMT, CR rows); open rows go to the handed-back generator, revived by `SendMessage`, which revises under its persistent envelope and reports as prose ending `REVISION <role> round <n>: done|blocked`. New `orchestrate.mjs review <role> --round|--close` verb and optional `review` run field; `ORCH_REVIEW_CAP` is a refusal, never a halt.
- **Measured (V-facts in the spec):** MEASURE-041 (in-repo, 2.1.288; a recorded breach of the no-live-run rule), sandbox v1 (2.1.288), PROBE v2, C-CONTROL and C (2.1.292). Guard 5 permits the revived band agent's edit (v2, C). The revision `SendMessage` is allowed in default mode, denied `[Auto-Mode Bypass]` in plain auto mode, allowed under the owner-approved `--settings` exception. W_dispatch = 0 on 2.1.288 and 2.1.292; F3 stays cited at 2.1.287.
- **Rulings recorded:** decision (i) prose-only revision reports, revision verb deferred; O1 (A), the spec reviewer reads the bound ticket snapshot, a scope clarification of FEAT-031 `:223` grounded in `:228`; O2 (B), an AMENDMENT of decision (i)'s failure mode: a revision report is never routed into `handback`, and a `SNAP_HANDBACK` in one closes the loop `skipped:snap-in-revision` (fail-open).
- **Cost per round, declared:** 0 wakes under auto mode with the shipped `project-template/.claude/review-loop.settings.json` (`claude --permission-mode auto --settings .claude/review-loop.settings.json`); default mode, one approval per generator write plus session prompts; plain auto mode degrades to `skipped:denied`. The installer never writes `autoMode` globally.
- **Boundary:** never auto-continues; only an owner message approves (not a reviewer `CLEAN`, `--auto` or a UI placeholder, observed in PROBE C); re-hash the document before `approve`.
- **Deferred to the plan:** full reads of `scripts/orchestrate.mjs` and `.claude/hooks/pre-tool-use.mjs` (the spec read both at offsets past the 30-line cap, disclosed); `role-profiles.test.js:49` amendment; the manual `/cc-spec` flow and Guard 5 gating stay follow-ups.

## Plan: FEAT-041 implementation [2026-10-06]

Plan `docs/superpowers/plans/2026-10-06-feat041-reviewer-in-loop.md`.
- **Approval:** "Approved. The plan ... is approved as reviewed (sha256 96748663f9d96dff5ca6122f6803649b54d260c44209c411b822b17bca95005b), with the three corrections confirmed and ruling 7 as rewritten." Corrections: ruling 7 halt discipline restored (any count outside its row halts and comes to the owner; predictions amended before measurement, never absorbed after); T-001-B red is a module-load failure on the missing exports; T-005-G CI predictions absolute (ci-node20 1357 / 96, ci-node24 1440 / 13). Rulings 1-6 and 8 accepted.
- **Shape:** T-001 the `review` verb; T-002 the `define-review` profile; T-003 the `/cc-orchestrate` loop prose; T-004 the shipped settings file and README; T-005 release `1.39.0`.
- **Predicted, not measured:** 1418 -> 1453 / 0, 49 -> 50 files.
- **Routing:** native. Stop for owner confirmation at T-005-G before pushing or opening the PR.

Handoff observations, one line per task:
- T-000: plan committed 5ab5fbd at 1418 / 0, 49 files, as predicted; branch gate silent (feat/feat-041-reviewer-in-loop matches FEAT-041).
- T-001: review verb committed at 1438 / 0, 49 files, as predicted; file 112 / 0 (+20). HALT at T-001-B: vitest delivers a missing named export as undefined (absent under plain Node), so the file loaded and ran 93 pass / 19 fail instead of the predicted module-load SyntaxError; owner ruled all 19 reds trace to the feature's absence (15 CLI refusals, 4 via the undefined exports) and amended T-001-B to the measured split, reversing the review ruling that imposed Node ESM semantics. Discriminators: CAP=4 reds 5 incl. the cap test; Halt reds the cap test; no REVIEW_DIR clear reds both clear tests.
- T-002: define-review profile committed at 1442 / 0, 49 files, as predicted; 1603 bytes, ASCII, mirrors byte-identical. HALT at T-002-E: gitignore-block-parity derives its expected block from the git index, and the plan staged the profiles in T-002-F, one step after the run that needs them indexed (2 parity tests red, role-profiles green); owner ruled it a plan-ordering defect the review also missed and moved the plain git add into T-002-D; re-run green at 49 / 0.
- T-003: review loop prose committed at 1448 / 0, 49 files, as predicted; mirrors byte-identical, ASCII probe 0 = 0 at HEAD. HALT at T-003-D: the T-003-A pin 'No revision follows the third pass.' (period) contradicted the plan's own command prose, which continues ', so the document at the approval is always the one the last reviewer read.' (39 / 1); owner ruled an internal plan inconsistency the review also missed, the test yielding to the document; pin amended to the full sentence in the plan and the test, re-run 40 / 0.
- T-004: settings file, test and README committed at 1453 / 0, 50 files, as predicted; generated file 582 bytes, sha256 05ce114d matching the pin first time; not ignored (check-ignore rc 1); red was 4 / 1 with AC9 passing, as predicted; tree line for review-loop.settings.json overflows the name column with one space, as cc-orchestrate.md does.
- T-005: release 1.39.0 committed at 1453 / 0, 50 files, as predicted; VERSION_GATE_OK 1.39.0, RECORD_PARITY_OK, protected-files diff vs origin/main empty, agents diff only the two define-review.md; discriminator ([ ] heading) red with 4 violations naming 1.39.0 and FEAT-041, restored green; origin/main still 0ec9e9e, so no third-party merge and the CI predictions stand; ceiling BUG 54 / FEAT 41 / ARCH 10, next BUG-055, nothing minted.

## Closeout: 1.39.0, reviewer-in-loop for the Define band (FEAT-041) [2026-10-06]

**What shipped.** Minor **`1.39.0`** shipped `[FEAT-041]` (PR #66, squash `4505d37`).
- Plan: `docs/superpowers/plans/2026-10-06-feat041-reviewer-in-loop.md`.
- Spec: `docs/superpowers/specs/2026-10-06-feat041-reviewer-in-loop-design.md`.

**One sha.** `npm view` reads version `1.39.0` and gitHead `4505d37a22c53bb3e6c7a681e09e53d01b2753c6`. The registry lagged the publish: the run printed its `+` line at 23:58:07Z, `npm view` still answered `1.38.0` (and E404 for `@1.39.0`) at 23:59:51Z, and the registry time for `1.39.0` reads 2026-10-07T00:01:16Z. A first `npm view` within minutes of a publish is not evidence against it. The `v1.39.0` tag (release `v1.39.0`, not a draft, published 2026-10-06T23:57:16Z) and the squash commit on `origin/main` are the same commit, `4505d37a22c53bb3e6c7a681e09e53d01b2753c6`.

**Sync, measured first.** Local `main` was `0ec9e9e`, the branch base. It measured **0 ahead / 1 behind** `origin/main`, the clean case. The first `git switch main` refused, because the uncommitted plan ticks touch a file that differs at `0ec9e9e`; nothing moved. The ticks were copied to the scratchpad (sha256 `ada5eca7…`), the file was restored, `main` fast-forwarded to `4505d37`, and the ticks were copied back. The plan file at `4505d37` equals the branch's, so the copy-back carries exactly the three ticks. The merged tree equals the branch tree at `9d015b0`: `git diff 9d015b0 4505d37` is empty.

**Instrument output on the merged tree:**
- **`VERSION_GATE_OK 1.39.0`.**
- **`RECORD_PARITY_OK`.** On the branch, the discriminator went red with `RECORD_PARITY_FAILED (4 violations)`, each reading `1.39.0 claims FEAT-041 but its heading reads [ ]`, then green on restore.
- **Ceiling:** `UNION ceiling {"BUG":54,"FEAT":41,"ARCH":10}`, next **`BUG-055`**, both legs reporting (`headings=67`, `dupes=none`). Nothing was minted in FEAT-041.
- **PR run `37548969041`:**
  - ci-node20 (job `112559649523`) `1357 passed | 96 skipped (1453)`, printing `SKIP_BASELINE_OK ci-node20: 96 skipped identities match tools/skip-baseline.json (report: vitest-report.json)`;
  - ci-node24 (job `112559649266`) `1440 passed | 13 skipped (1453)`, printing `SKIP_BASELINE_OK ci-node24: 13 skipped identities match tools/skip-baseline.json (report: vitest-report.json)`;
  - `git diff origin/main -- tools/skip-baseline.json` was empty before the push.
- **Push run on `main`, `37549205289`:** the same counts and both `SKIP_BASELINE_OK` lines. `tools/skip-baseline.json` is unchanged from `0ec9e9e` to `4505d37`.
- **Publish run `37549355116`** succeeded, printing `+ @yeison.restrepo.r/code-conductor@1.39.0`.
- **Local suite on `main`:** 1453 / 0, 50 test files.
- **Reconciliation, total 1453 on all three legs:**

  | Leg | Reading | Predicted |
  |---|---|---|
  | local | 1453 / 0, 50 files | 1453 / 0, 50 files |
  | ci-node20 | 1357 / 96 | 1357 / 96 |
  | ci-node24 | 1440 / 13 | 1440 / 13 |

  Arithmetic: 1418 + 35 = 1453; 1322 + 35 = 1357, and 1357 + 96 = 1453; 1405 + 35 = 1440, and 1440 + 13 = 1453.

**Every count boundary matched its prediction**, across five commits and two CI legs, although the counts were predicted, not measured in a scratch clone (Ruling 7). Three steps halted on a red that did not match the plan. Each was ruled on by the owner and amended in the plan before any re-measure. Nothing was absorbed after a measurement.

| Boundary | Measured |
|---|---|
| T-000 (`5ab5fbd`) | 1418 / 0, 49 files |
| T-001 (`d15b898`) | red 93 / 19 (amended); 112 / 112 (+20); discriminators 5, 1, 2; 1438 / 0 |
| T-002 (`6705a27`) | red 5; parity red 2 (halt, amended), re-run 49 / 49; 1442 / 0 |
| T-003 (`5a62ac2`) | red 6; 39 / 1 (halt, amended), re-run 40 / 40; ASCII 0 = 0; 1448 / 0 |
| T-004 (`66a401e`) | red 4 / 1; sha256 `05ce114d…` first time; 5 / 5; 1453 / 0, 50 files |
| T-005 (`9d015b0`) | 1453 / 0; discriminator red 4, green on restore |
| CI | 1357 / 96 and 1440 / 13 (1453 each) |

**Plan ticks.** T-005-G, T-005-H and the top-level T-005 are ticked in this record commit, not in a follow-up on the branch, as at 1.37.0 and 1.38.0. The plan now has no unticked task line.

**`[FEAT-041]` harvest, in one place.** Each item is evidenced in the Plan section's handoff observations above and in the amended plan lines.

- **Vitest is not Node ESM for a missing named export.** Under plain Node, importing an export a module does not provide is a load-time SyntaxError (`'REVIEW_CAP' in m` was `false`). Under vitest's transform, the same import arrives as `undefined`, the file loads, and every test runs. The plan's original split was directionally right for vitest, and the review ruling that imposed Node semantics was reversed. **Lesson:** predict a red under the runner that will execute it. Where a test uses a missing constant as a loop bound or a path, its red shows up late (a zero-iteration loop, a `TypeError` in `join`), and the task's discriminators are what make those tests precise after the green.
- **Index-reading tests force staging order inside the task.** `gitignore-block-parity` derives its expected block from `git ls-files`, so a new leaf line is red until its file is in the index. The plan staged the new profiles one step after the run that needed them; the plain `git add` moved into T-002-D. **Lesson:** when a task adds a `.gitignore` leaf, its new files are staged in the same step as the leaf, before any run of the parity test.
- **The pin yields to the document.** T-003-A pinned `'No revision follows the third pass.'` with a period, while the plan's own command prose continues `, so the document at the approval is always the one the last reviewer read.` The pin became the full sentence, because the clause carries the invariant worth pinning. **Lesson:** at self-review, each content pin is checked by substring against the text block it pins, in the same plan.
- **Extract, never retype.** Every inserted block (tests, profile, command prose, README, records) was extracted from the plan's fence by line range, de-indented with an indentation guard, and anchored by unique-match replacement. The settings file was generated from the test's own constant and hit the pin the first time. One slip: a block extracted from deeper indentation lost its two-space nesting and was re-indented before the run.
- **Guard 3 shaped the shell work.** P7 fired on `sed` edits whose pattern held `[X]` / `[ ]` brackets next to other commands, and P9 fired on `for` and `until` loops. Small `node` scripts in the scratchpad and the Edit tool were the authorized routes; no allowlist entry was proposed.

**Step 11 does not apply.** This repository never starts an orchestrated run, so no ticket binds the item and no writeback is owed.

**Next:** the next item is the owner's call. Follow-up candidates recorded by the plan, none minted: the manual `/cc-spec` flow, Guard 5 gating on an open round, the revision verb, and the D8 sequencing anomaly. `BUG-055`'s mint stays the owner's, with the ceiling run on both legs first.

## Checkpoint 2026-10-06 19:26

### Decisions
- FEAT-041 shipped as 1.39.0 (PR #66, squash 4505d37 = tag v1.39.0 = npm gitHead); closeout record 0694e16 is on origin/main and the feature branch is deleted on both sides.
- Three plan amendments were ruled by the owner before any re-measure: T-001-B red is the measured 93 / 19 under vitest, T-002-D stages the new profiles with their .gitignore leaf, T-003-D pins the full sentence.
- The ceiling union stands at BUG 54 / FEAT 41 / ARCH 10; the next item and the BUG-055 mint are the owner's call.

### Conventions
- Predict a red under the runner that will execute it: vitest delivers a missing named export as undefined, while plain Node ESM throws at load.
- When a task adds a .gitignore leaf, stage its new files in the same step, before any run of gitignore-block-parity (it reads git ls-files).
- Every content pin is checked by substring against the block it pins, in the same plan, at self-review.

### Workarounds
- Guard 3 P7 trips on sed bracket patterns chained with other commands and P9 on shell loops; use scratchpad node scripts or the Edit tool.
- `git switch main` refuses over uncommitted plan ticks that differ at the branch base; copy the plan to the scratchpad, restore, switch and fast-forward, then copy back.
- GitHub auto-deletes the merged remote branch; a failed `git push --delete` is cleared with `git fetch --prune`.
- The npm registry lags a publish by about 3 minutes; an early `npm view` miss is not evidence against the publish.

## Batch: 1.39.1, the Ludocius contribution queue (BUG-032, BUG-045, BUG-050, BUG-051, BUG-052, BUG-053, BUG-054) [2026-10-06]

**Shape.** Seven contributor PRs, reviewed in the owner's order: #54, #53, #50, #52, #55, #51, #56. PR #59 stayed out (an intake candidate tied to issue #58).
- All seven forked from `0ec9e9e` and conflicted with `main` at `a05a555`. Each carried its own VERSION, CHANGELOG, backlog-flip and README records, which went stale against 1.39.0.
- They landed on one owner-side train, `land/ludocius-batch`, from `a05a555`. His code, tests, specs, plans and `.gitignore` leaves were cherry-picked with his authorship; his records were dropped and superseded by this record commit.
- The train merges preserving individual commits, so every commit was required green on its own row. His PRs stay untouched until the train merges, and are then closed with the owner's crediting comments.
- His specs and plans are kept unmodified as his record, including where they describe replaced approaches.

**Per item: what was contributed, what the owner side added, and why.**
- **`[BUG-032]` (#54).**
  - Contributed: the chain step and the Memory section in `global/CLAUDE.md`.
  - Owner side (`786da48`): the `memory-first` skill now agrees with the chain; it had kept checking `project.md` alone, so the chain and its enforcer disagreed. Both `personal.md` files are named, with the owner-ruled precedence (the project copy wins, most specific layer first; `cc-checkpoint.md:19` writes it and `cc-resume.md:45` reads it). A `repo-invariants` test, watched red, closes the demonstration criterion.
  - The backlog's "Verified while filing" note was stale: BUG-039's seed at `lib/installer/host-owned.mjs:19` satisfies the deploy half. It is corrected in the backlog by this commit.
- **`[BUG-054]` (#53).**
  - Contributed: the plan-file staging rule.
  - Owner side (`d988684`): the next-task carry clause, which settles what "commit group" means; the filtered red-step match-set rule; and two-sided presence anchors on both `cc-plan.md` copies (4 tests, watched red). Criteria 2 and 3 were missing from the PR.
- **`[BUG-051]` (#50).**
  - Contributed: presence-based detector resolution in prose.
  - Owner side (`5bd7ce4`):
    - a concrete D11-style probe line;
    - the `/cc-stack` step-1 root fix: read literally, "the directory that contains the detector script" was `.claude/scripts/`, so the command would have run from, and written `CLAUDE.md` into, the scripts directory;
    - tests pinning every shipped detector path to a real `deployProject` scaffold;
    - the `cc-resume` byte-identity pin.
  - Parity ruling (owner): mirror parity widens to the `cc-resume` pair, on the ground that the copies are identical, the fix keeps them so, and every other mirrored pair carries a pin.
- **`[BUG-053]` (#52).**
  - Contributed: the `cleanGitEnv()` helper with a hand-kept 6-variable list. His spec named `GIT_CEILING_DIRECTORIES` where his code had `GIT_COMMON_DIR`.
  - Owner side (`2ed12da`): the list is derived from `git rev-parse --local-env-vars`, which has 15 entries, `GIT_PREFIX` among them. It throws on failure with no fallback (owner ruling: a stale list applied silently scrubs incompletely and lets a leaking test pass).
  - The script-launch sweep closes the 10 tests that still resolved the real repository under a linked-worktree hook. A decoy-repository red-green proof ships as `tests/unit/git-env.test.js`.
  - Design note: the fix is fixture-side because the gate lives untracked in `.git/hooks`.
- **`[BUG-050]` (#55).**
  - Contributed: sub-shaped detection that rejected every sub-shaped heading, plus an in-test grandfather list.
  - **Central finding of the queue's instrument review:** with that list, the merge gate passed while `node tools/record-parity.mjs` exited 1 on the same records. That is a green covering less than its name, the defect class BUG-050 itself names.
  - Owner ruling, repair (b):
    - history is named, not failed;
    - a sub-shaped claim under a shipped section is a named failure;
    - `Filed` and `Notes` are ignored (his scan was section-blind and reintroduced the single-level false positive);
    - the ceiling counts the parent number and checks sub-shaped duplicates (two latent mint-twice gaps);
    - `parseBacklog` treats a sub-shaped heading as its own entry (the body bleed);
    - no grandfather list (BUG-046 Gate 4).
  - The grandfather commit `f6fc2f0` was not landed. The owner completion is folded into his commit `5c54eea`, which keeps his authorship and adds co-author trailers, because his commit alone was red on the violation the list had hidden.
- **`[BUG-052]` (#51).**
  - Contributed: the package-name self-guard inside `deployProject`.
  - Owner side (`25f6ae5`):
    - The guard moves to the CLI pre-flight, because under `--project` the whole global install into `~/.claude` ran before the guard fired, and the command then exited 1, the code meaning nothing was written.
    - His exit mapping is kept as a commented backstop (owner ruling).
    - The catch is narrowed: ENOENT or a JSON parse error means not-self; any other read error refuses (owner ruling: a tree that cannot be read is suspect, not a green light to sweep).
    - CLI, host-sweep and read-error tests, in temp dirs only.
- **`[BUG-045]` (#56).** Landed as an **owner redesign**, `70766b9`: owner-authored, with `Co-Authored-By: Luis`. His target shapes and four corpus rows are kept.
  - **Central finding:** on a protected surface, his boundary-append form (quote characters added to `G3_BD`/`G3_AD`) was measured on both subjects to open four traversal shapes and two concatenation shapes:
    - T1 `cat "docs/"../*.md`
    - T2 `cat docs/"../"*.md`
    - T3 `cat 'docs/'..'/'*.md`
    - T5 `cat "docs/x y/../../z.md" *.md`
    - P1 `cat foo"docs/x.md" *.md`
    - S1 `cat "docs/x.md"EXTRA *.md`

    Review measurement caught them.
  - **Ritual skip, plainly:** he edited the frozen authority with no sanctioned exception, no header amendment and no predicted red table. His spec claimed 6 corpus rows against a 4-row diff.
  - The redesign is a whole-token quoted alternative, with the bare boundaries byte-identical to main. It is exception six; the header count is corrected to "Six" (BUG-047 had left it at "Four" while listing five; the omission is BUG-047's, not the contributor's).
  - **Measurement overturned an owner design ruling before adoption.** The owner-specified quoted suffix, "the entire quoted remainder", opened X1, `cat "docs/$(echo ../..)/x.md"`, because `$( )` executes inside double quotes and the BUG-043 mask leaves the allowlist deciding alone. C-path (the bare path class plus a space) met every expected cell, denied X1, and kept T5 matchable. This is the failure the measure-first condition exists to catch, and the second instance today after FEAT-041's vitest-semantics reversal. Single quotes do not execute `$( )`, but the same class applies symmetrically as the safe, simple shape.
  - D1 is ruled allowed: an entry used as quoted data lifts the denial as its unquoted form does.
  - Corpus 155 to 167. Predicted red, as written: 6 failed (A1, A2, D1 per suite) of 1507. Discriminators: his subjects 12 failed, C-any 2 failed. The fail convention was re-checked (no new throw path, the allowlist read unchanged).

**Interim rules retired by this release, effective as this commit lands on `main` with the train:**
- **`[BUG-051]`, "`/cc-init` records the stack."** Evidence: the `commands-parity` tests. Three pin every shipped command that names the detector to `.claude/scripts/detect-stack.mjs`, checked against a real `deployProject` scaffold in a temp dir. Two anchor the probe line on both `cc-resume` copies, and one asserts their byte identity. All were watched red against the pre-fix commands.
- **`[BUG-052]`, "never run the installer against this repository."** Evidence: a scratchpad clone with a temp `HOME`, isolation checked first, running `node bin/code-conductor.mjs --project` inside the clone.
  - Control at `0ec9e9e`: rc=2 `PARTIAL_WRITE` (ENOENT lstat on the clone's `scripts`). `git status --porcelain --ignored` CHANGED: four `.claude/commands/*`, `.claude/hooks/context-guard.sh`, `.claude/settings.json`, `.gitignore` and `CLAUDE.md` modified; 11 `scripts/*.mjs` deleted; backups and new ignored files added. The temp `HOME` was written (25 entries). It is 11 rather than the incident's 9 because `orchestrate.mjs` and `ticket.mjs` were added since. It is rc 2 because in the node-bin form the asset root is the clone, so the sweep deleted the copy source.
  - Train `25f6ae5`: rc=1, `cannot start install: cannot deploy --project into code-conductor's own source tree (...)`; porcelain `--ignored` IDENTICAL before and after; 0 scripts deleted; temp `HOME` 0 entries.
  - The CONTRIBUTING rule "never run the installer in this repository" stands as contributor policy.
- **`[BUG-053]`, "never run the gate from a linked worktree."** Evidence: a scratchpad clone with a linked worktree and a pre-commit hook running `npm test`, one real commit from the worktree.
  - Fork `0ec9e9e`: 31 failed / 1387 passed of 1418, primary config CHANGED (`core.bare=true`, `user.name=T`, `user.email=t@t.t`).
  - PR head: 10 failed / 1408 passed, state UNCHANGED.
  - Train `2ed12da`: `Tests 1466 passed (1466)`, `Test Files 51 passed (51)`, state `before=c30d05807b78 after=c30d05807b78 UNCHANGED`, `core.bare=false`.

**Patterns across the queue.**
- **Invented criteria:** every one of the seven specs wrote acceptance criteria of its own instead of answering the minted entry's. BUG-050's chose neither recorded repair; BUG-045's miscounted its own rows.
- **Installer runs in this repository:** 4 of 7 PRs carried a `node bin/code-conductor.mjs --project` commit with a net-empty revert (#54 `34265f9`, #53 `36ae7cf`, #50 `4a6bb24`, #52 `aa77386`), each dropped.
- **Records in PRs:** contributor PRs carrying VERSION bumps, CHANGELOG entries and backlog flips are exactly what made all seven conflict at once. CONTRIBUTING.md gains "Records are owner-side" in this commit, with this queue as its founding case.

**Process observations (owner-accepted).**
- **A verification command that can match nothing and print empty passes vacuously:** the instruments archetype in shell form. zsh does not word-split an unquoted `$P`, which voided the first five protected-surface checks. Re-run under POSIX `sh`, the conclusions held. Every protected-surface check now prints the path list it diffed.
- **Whole-commit cherry-picks bypass the pre-commit gate.** The per-commit suite in a sandbox clone is part of the train protocol, and runs again before any push.

**Train rows (sandbox, per commit):** 1453 (2 commits), 1454 (3), 1458 (3), 1464 (3), 1466 (1), 1478 (2), 1480 (2), 1483 (1), 1507 (2). Every commit green; final 1507 / 0, 51 files.

**Unminted candidates recorded today.**
- **Path-convention harmonization:** presence-based detector resolution in `cc-stack`, `cc-resume` and `cc-orchestrate`, versus the nesting split in the `cc-init` copies.
- **Allowlist entry-as-data semantics:** an entry anywhere in the command lifts the whole denial, D1 included. Changing it is an allowlist redesign.

## Closeout: 1.39.1, the Ludocius contribution queue [2026-10-06]

**What shipped.** Patch **`1.39.1`** shipped seven contributed fixes: `[BUG-032]`, `[BUG-045]`, `[BUG-050]`, `[BUG-051]`, `[BUG-052]`, `[BUG-053]` and `[BUG-054]`. They came through PR #67 from `land/ludocius-batch`, merged as a **merge commit** `bb07d14` (parents `a05a555` and `cbd731c`), so all 20 train commits keep their authorship. The batch record above is this release's harvest.

**One sha.**
- `npm view` reads version `1.39.1`, `dist-tags.latest` `1.39.1`, and gitHead `bb07d14bbdeac9dda129a70e9dfb8674fae13db4`. The `v1.39.1` tag (release `v1.39.1`, not a draft, published 2026-10-07T02:27:28Z) and the origin/main merge commit are the same commit.
- Publish run `37562068460` succeeded at 02:28:54Z, printing `+ @yeison.restrepo.r/code-conductor@1.39.1`.
- The registry lagged the publish, as at 1.39.0. `npm view` still answered `1.39.0` at 02:29Z and 02:31:05Z, the registry time for `1.39.1` reads 2026-10-07T02:31:36.615Z, and the re-query at 02:33:11Z matched.

**Sync, measured first.** Local `main` `a05a555` measured **0 ahead / 21 behind** `origin/main`: the 20 train commits plus the merge commit. It fast-forwarded to `bb07d14`, and `git diff cbd731c bb07d14` is empty, so the merged tree equals the train tree.

**Instrument output on `main` (`bb07d14`):**
- `VERSION_GATE_OK 1.39.1`.
- `sub-shaped headings seen: ARCH-008-S1, ARCH-008-A, ARCH-008-B`, then `RECORD_PARITY_OK`.
- **Ceiling, both legs:** `headings=67 max={"BUG":54,"FEAT":41,"ARCH":10} dupes=none`, with the three ARCH-008 sub-shaped headings seen. `UNION ceiling {"BUG":54,"FEAT":41,"ARCH":10}`, next **`BUG-055`**, unchanged by the queue. Nothing was minted.
- Local suite: 1507 / 0, 51 test files.

**PR run `37561743465` (head `cbd731c`):**
- ci-node20 (job `112600328989`): `Tests 1411 passed | 96 skipped (1507)`, `SKIP_BASELINE_OK ci-node20: 96 skipped identities match tools/skip-baseline.json (report: vitest-report.json)`.
- ci-node24 (job `112600328474`): `Tests 1494 passed | 13 skipped (1507)`, `SKIP_BASELINE_OK ci-node24: 13 skipped identities match tools/skip-baseline.json (report: vitest-report.json)`.
- `git diff origin/main -- tools/skip-baseline.json` was empty before the push. Both legs matched the prediction derived from the +54 delta, none of whose tests is in a file with skipped identities.

**Baselines of record, from `bb07d14`:**

| Leg | Reading |
|---|---|
| local | 1507 / 0, 51 files |
| ci-node20 | 1411 / 96 |
| ci-node24 | 1494 / 13 |

Arithmetic: 1453 + 54 = 1507; 1357 + 54 = 1411, and 1411 + 96 = 1507; 1440 + 54 = 1494, and 1494 + 13 = 1507.

**Interim rules formally retired** as of `bb07d14`. Each piece of evidence is recorded in full under "Batch: 1.39.1" above.
- **`[BUG-051]` "`/cc-init` records the stack":** retired. Evidence: the `commands-parity` detector-path, probe-line and `cc-resume` byte-identity tests, each watched red against the pre-fix commands.
- **`[BUG-052]` "never run the installer against this repository":** retired as an interim rule. Evidence: the sandbox installer probe, control `0ec9e9e` against train `25f6ae5`. Contributor policy keeps it in CONTRIBUTING.md.
- **`[BUG-053]` "never run the gate from a linked worktree":** retired. Evidence: the sandbox linked-worktree probe at train `2ed12da`, 1466 passed, primary repository unchanged.

**Closing comments.** The seven contributor PRs got the owner's texts, then were closed in review order:
- #54 `issuecomment-6029718221`
- #53 `issuecomment-6029718689`
- #50 `issuecomment-6029719170`
- #52 `issuecomment-6029719641`
- #55 `issuecomment-6029720104`
- #51 `issuecomment-6029720554`
- #56 `issuecomment-6029721057`

His branches stay his. The train branch is deleted. PR #59 remains open as an intake candidate (issue #58).

**Pre-push CHANGELOG check.** The file's 1.39.1 section was verified manually to carry all seven entries, each complete. A splice seen in a pasted report was a rendering artifact, and `cbd731c` was not amended.

**Unminted candidate added:** `record-parity` cannot catch a heading flipped to `[X]` with no CHANGELOG claim behind it. Direction A starts from claims and direction C from DONE versions, so a flip without either is invisible, and the pre-push check above had to be manual. This joins path-convention harmonization and allowlist entry-as-data semantics.

**Next:** the next item is the owner's call. `BUG-055`'s mint stays the owner's, with the ceiling run on both legs first.

## Checkpoint 2026-10-06 21:43

### Decisions
- The seven Ludocius PRs landed as 1.39.1 through one train branch. PR #67 was merged as a merge commit, `bb07d14`, so each commit keeps its author. The closeout record is `c044ef6`. PRs #50-#56 are closed with the owner's comments, and #59 stays open as an intake candidate.
- Contributor records (VERSION, CHANGELOG, backlog flips, README limits) are owner-side, as stated in CONTRIBUTING.md "Records are owner-side". External PRs ship code, tests and design docs only.
- The BUG-051, BUG-052 and BUG-053 interim rules are retired as of `bb07d14`, each with sandbox or test evidence in the 1.39.1 batch record.
- Local branches are pruned to `main`. The seven fix branches and three shipped branches (#41, #42, #60) were deleted after verifying each squash commit is byte-identical on the files the branch touched.

### Conventions
- A train merges as a merge commit, never a squash. Every train commit must be green on its own row in a sandbox per-commit run, which is repeated before any push.
- A protected-surface check prints the path list it diffed. Run it under POSIX `sh`, since zsh does not word-split an unquoted variable.
- Measure a design before adopting it, including an owner's design. The quoted-suffix ruling was overturned by the X1 measurement before any corpus row was written.
- Probes that run the installer or a hook against a changed copy run in a scratchpad sandbox clone, never in this repository, whose `.claude/hooks/pre-tool-use.mjs` guards the live session.

### Debt
- Unminted: `record-parity` cannot see a heading flipped to `[X]` with no CHANGELOG claim; path-convention harmonization; allowlist entry-as-data semantics, D1 included.
- The 1.36.0 release tag is named `1.36.0`, without the `v` every other tag carries.

### Workarounds
- Whole-commit cherry-picks skip the pre-commit gate; a sandbox clone runs the suite per commit instead.
- `git commit -- <paths>` runs the gate against a temporary index, which fails `gitignore-block-parity` when other staged files carry `.gitignore` leaves. Set the other staged work aside with `git stash` and commit against a consistent tree.
- macOS `sed` does not strip `\x1b`, and `gh` run logs carry ANSI escapes as literal `^[`. Strip them in node before matching CI count lines.
