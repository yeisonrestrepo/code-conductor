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
