# Changelog

## [1.23.1] - 2026-07-06
### Fixed
- `deployProject` no longer nests a second `.claude/` under `<cwd>/.claude` when scaffolding with `--project`; `CLAUDE.md`/`.gitignore` now land at the project root and commands/hooks/memory/settings land directly under `.claude/`, matching `project-template`'s on-disk layout.

## [1.23.0] - 2026-07-05
### Changed
- Distribution moved from shell installers to the `@yeison.restrepo.r/code-conductor` npm CLI (`npx @yeison.restrepo.r/code-conductor`; the installed command is `code-conductor`). `install.sh` and `install.ps1` removed. (FEAT-023)

## [1.22.0] - 2026-07-05

### Added
- `[ARCH-008-B]` Phase-entry resume-read wiring: `scripts/resume-read.mjs` restores agent context across branch switches and rollbacks by reading the DB snapshot for the current git commit (DB wins), falling back to the `.claude/memory/session-snapshot.json` handoff. The `cc-spec`/`cc-plan`/`cc-implement` phase-entry blocks (both mirrors) now call it; a hit prints a `RESUME_HIT` block, a miss proceeds fresh, a corrupt handoff halts (exit 4). Completes the `[ARCH-008]` milestone (S1 schema → A writers → B readers).

### Changed
- `scripts/snap-validate.mjs`: `sys.c` length ceiling widened `{7,40}`→`{7,64}` to accept SHA-256 (64-char) commit hashes.
- `post-compact` hooks (both mirrors): also sweep leaked `.conductor/resume-validate.*.tmp.json` validation temps.

## [1.21.0] - 2026-07-04

### Added
- `[ARCH-008-A]` `scripts/session-id.mjs`: zero-dep session-id resolver — emits `$CLAUDE_CODE_SESSION_ID` verbatim when set (cacheless), else a `looksValid`-gated `.conductor/session-id` cache read, else a fresh `crypto.randomUUID()` persisted via atomic temp+rename. First-writer-wins on `EEXIST`/`EPERM`/`EACCES`; unwritable shared dir falls back to an in-memory UUID; runs flag-free on any Node ≥ 14.
- `[ARCH-008-A]` `scripts/snap-build.mjs`: canonical SNAP serializer reading a flat `{ph,c,s,n,f,d,x,pr?}` JSON object on stdin. Emits **v1** (`{v:1,sys,ops,mem}`, 4096-char head-drop trim) when `pr` is absent/empty, **v2** (`+pr`, 10 MiB byte cap) otherwise; strips extraneous keys, normalizes arrays (filter/dedup/per-element cap/head-drop), and truncates an over-cap `pr` with a surrogate-safe bounded binary search.
- `[ARCH-008-A]` `tests/scripts/session-id.test.js`, `tests/scripts/snap-build.test.js`: hermetic child-process suites (env-verbatim / generate+persist / cache-reuse; v1/v2 selection, key-stripping, 10 MiB truncation, surrogate-safety, malformed/empty/missing-scalar rejection, round-trip validation against `snap-validate`).

### Changed
- `[ARCH-008-A]` `scripts/snap-validate.mjs`: accepts SNAP **v2** — optional top-level `pr` (string; version-aware allow-list still rejects `pr` on v1), `v ∈ {1,2}` (`v>2` → `SNAP_UNKNOWN_VERSION`), and a broadened `sys.c` hash regex `/^[0-9a-f]{7,40}$/` (backward-compatible; `0000000` sentinel valid). The 4096-char file cap is unchanged.
- `[ARCH-008-A]` `/cc-compact` + `/cc-checkpoint`: after the authoritative write, run a synchronous fail-open DB tail persisting one `sessions` upsert + one git-hash-keyed `snapshots` row via the S1 subcommands (session id + snap-build blob on stdin, argv double-quoted, append-mode log, Node-flag probe). Hash source is the full-40 `git rev-parse HEAD` (not `--short`). `/cc-checkpoint` captures the verbatim `## Checkpoint` block as v2 `pr`.
- `[ARCH-008-A]` `post-compact.sh`/`.ps1` (live + template): clear `.conductor/session-id` and sweep `session-id.*.tmp` on compaction. `cc-implement.md` reader comment corrected for SNAP v2 (`v ∈ {1,2}`).

## [1.20.0] - 2026-07-04

### Added
- `[ARCH-008-S1]` `scripts/conductor-db.mjs`: additive `user_version` 1→2 migration creating `sessions(session_id PK WITHOUT ROWID, started_at, updated_at, phase, spec, git_commit_hash)`, `snapshots(id INTEGER PK, git_commit_hash, created_at, snap_json)` + `idx_snapshots_hash`, and `raw_history(id INTEGER PK, session_id, created_at, kind, content)` + `idx_raw_history_session`, alongside the untouched `task_state`. Five fail-open subcommands: `session` (ON CONFLICT DO UPDATE upsert, preserves `started_at`), `get-session` (fixed-key single-line JSON), `snapshot` / `history` (payload from stdin via bounded `readStdinCapped`, 10 MiB / 1 MiB caps, strict UTF-8), `get-snapshot` (newest blob `ORDER BY id DESC LIMIT 1`, byte-for-byte). Query commands emit one line on hit, zero bytes on miss/degradation; writes stay empty-stdout/exit-0. No FKs, no pruning, no env override. Named `$name` binding for new statements.
- `[ARCH-008-S1]` `tests/scripts/conductor-db.test.js`: migration (v1→v2 in place, DROP-free, index accounting), each subcommand, query round-trip, >128 KiB stdin round-trip (no ARG_MAX ceiling), 10 MiB/1 MiB over-cap rejection, malformed-UTF-8 rejection, empty-stdin/TTY no-hang, fixed key order, CR/whitespace, degraded-query zero-byte output, and isolation guard.

### Changed
- `[ARCH-008-S1]` `scripts/conductor-db.mjs`: `withDb` now returns its callback's value (query support); `validateKey` gains an optional per-subcommand `usage` argument; `SCHEMA_VERSION` bumped to 2. `record`/`init` behaviour and stderr strings unchanged.

## [1.19.0] - 2026-07-04

### Added
- `[FEAT-005]` `scripts/conductor-db.mjs`: zero-dependency ES-module CLI wrapping Node's built-in `node:sqlite` (`DatabaseSync`); owns `.conductor/cache.db` with `record <plan_file> <task_id> <state>` and idempotent `init` subcommands. Schema v1 `task_state(plan_file, task_id, state CHECK IN (' ','>','X','!'), updated_at) WITHOUT ROWID`, PK `(plan_file, task_id)`, WAL journaling, `user_version=1` set atomically via `BEGIN IMMEDIATE`. Repo-relative POSIX `plan_file` key (dedup across CWDs), 512-char arg cap, ms ISO-8601 `updated_at`. All failures non-fatal (single `CONDUCTOR_DB:` stderr line, exit 0): absent `node:sqlite`, corrupt/non-regular file (renamed aside, never `rm -r`), `SQLITE_BUSY`, `user_version > 1` forward-compat, CLI misuse.
- `[FEAT-005]` `tests/scripts/conductor-db.test.js`: Vitest child-process (`spawnSync`) suite covering schema/`user_version`, upsert, timestamp shape, state-enum/empty/over-length rejection, CLI discipline, `plan_file` dedup, git/`.git`-walk/script-dir root resolution, absent-`node:sqlite` degradation (via `--import` loader fixture), corrupt-db recovery, non-regular-file handling, and forward-compat no-write. Temp dbs under `os.tmpdir()` with `crypto.randomUUID()` names; `-wal`/`-shm` sidecars cleaned up; skips when the runner lacks `node:sqlite`.

### Changed
- `[FEAT-005]` `/cc-implement` Step 6 hook (both `.claude/commands/` and `project-template/.claude/commands/` mirrors): rewired from a `.conductor/cache.db`-existence no-op to a `node --version >= 22.5.0`-gated `conductor-db.mjs record` invocation; the cache self-disables below 22.5, so `engines.node` stays `>=20`.
- `[FEAT-005]` `.gitignore`: ignores `.conductor/` (local cache, never committed).

## [1.18.0] - 2026-07-04

### Removed
- `stack-profiles/` static profile directory (17 files) [FEAT-013]
- Stack-profile downloads from `install.sh` and `install.ps1` [FEAT-013]

### Changed
- `/cc-stack` now runs `detect-stack.mjs` and writes detected commands plus a generated ruleset into the project `CLAUDE.md` instead of loading a static profile [FEAT-013]
- `README.md` replaces the Stack Profiles documentation with dynamic-detection wording [FEAT-013]

## [1.17.0] - 2026-06-30

### Added
- `[FEAT-010]` `scripts/snap-validate.mjs`: ≤30-line dependency-free Node.js ≥18 validator for SNAP v1, the minified single-line JSON handoff format; exits 0/1 only, all errors prefixed `SNAP_ERROR:` on stderr
- `[FEAT-010]` `tests/unit/snap-validate.test.js`: 43-case Vitest suite covering schema violations, primitive/array-type mutations, version boundary values, array/element caps, directory-as-path (EISDIR), line-count enforcement, a zero-console.* static check, and the >=15% character-reduction assertion against the legacy markdown format

### Changed
- `[FEAT-010]` `/cc-compact` (global command): now writes `.claude/memory/session-snapshot.json` (SNAP v1) instead of `session-snapshot.md`; idempotently gitignores the new file; deletes legacy `.md` on write
- `[FEAT-010]` `/cc-implement` (project command, both `.claude/commands/` and `project-template/.claude/commands/`): Phase entry now validates and reads SNAP v1 JSON via the destructive-read pattern, with a one-session `.md` fallback for backward compatibility

## [1.16.0] — 2026-06-26

### Added
- `scripts/detect-stack.mjs`: auto-detects project stack from manifests (20+ ecosystems: JS/TS, Go, Python, Rust, Scala, Spring Boot, Quarkus, Java, .NET, iOS, Android, Flutter, React Native, Ionic, Capacitor). Emits JSON to stdout; exits 0 always.
- `_fill_claude_md` (bash) / `Set-ClaudeMdFields` (PS): surgically fill CLAUDE.md blank/`<command>` fields from detected JSON; never overwrite user-customized values.
- `install.sh --project` / `install.ps1 -Project`: now auto-detect stack and fill CLAUDE.md at install time; Node.js ≥ 18 validated before calling detect-stack.
- `/cc-init` Step 2: rewired to run detect-stack and skip interactive questions for auto-detected fields.
- `/cc-resume` Step 2: now auto-fills blank command fields via detect-stack on session resume when manifests have changed.

## [1.15.0] - 2026-06-24

### Added
- `[FEAT-007]` `context-guard.sh` / `context-guard.ps1` — `UserPromptSubmit` hook that atomically increments `.claude/memory/turn-count.txt`; emits ⚠ at 80% of threshold and 🚨 at threshold; threshold read from `.claude/memory/context-threshold.txt` (default 25); counter saturates at 99999; `CC_GUARD_DEBUG=1` enables stderr diagnostics; fail-open (`set +e` / outer try-catch)
- `[FEAT-007]` `post-compact.sh` / `post-compact.ps1` — `PostCompact` hook rewritten to atomically reset turn counter to 0 after `/compact`; prints last checkpoint timestamp from `project.md`
- `[FEAT-007]` `project-template/.claude/memory/context-threshold.txt` — default threshold of 25 turns (BOM-free UTF-8 LF)
- `[FEAT-007]` `tests/hooks/context-guard.test.js` — 19-case Vitest suite covering counter increment, warning/critical thresholds, saturation, PostCompact reset, corrupt/empty/BOM/CRLF/merge-conflict thresholds, `CC_GUARD_DEBUG` stderr, `warning=0` edge case, and no-`.claude/` directory scenario

### Changed
- `[FEAT-007]` `project-template/.claude/settings.json` — `UserPromptSubmit` array extended with context-guard bash upward-walk dispatcher and PowerShell hook; `PostCompact` array extended with `post-compact.ps1` entry
- `[FEAT-007]` `.claude/settings.json` — mirrored to match project-template hook wiring
- `[FEAT-007]` `install.sh` — downloads `context-guard.sh`, `post-compact.sh`, and `context-guard.ps1`; injects context-guard `UserPromptSubmit` commands and `post-compact.ps1` `PostCompact` command via node heredoc; appends `*.sh eol=lf` / `*.ps1 eol=crlf` to `.gitattributes`; adds `.claude/memory/turn-count.txt` to `.gitignore`
- `[FEAT-007]` `install.ps1` — mirrors `install.sh` changes for Windows; uses `node -e $script $path` with `process.argv[1]` for settings injection; idempotent `.gitattributes` and `.gitignore` appends via `[System.IO.File]::AppendAllText`
- `[FEAT-007]` `project-template/.gitignore` — `.claude/memory/turn-count.txt` excluded from git
- `[FEAT-007]` `.gitignore` — `.claude/memory/turn-count.txt` excluded from git
- `[FEAT-007]` `.gitattributes` — `*.sh text eol=lf` and `*.ps1 text eol=crlf` eol rules


## [1.14.0] - 2026-06-23

### Removed
- `[BUG-020]` claude-mem installation steps removed from `install.sh` and `install.ps1`; silent `npx --yes claude-mem uninstall` call added to heal existing installs; `claude-mem@thedotmack` key removed from `enabledPlugins` in `~/.claude/settings.json` on install
- `[BUG-020]` Orphaned superpowers-cached `critical-review` skill glob-deleted on install (all superpowers versions)

### Added
- `[BUG-020]` code-conductor Claude Code plugin (`~/.claude/plugins/cache/code-conductor/code-conductor/<version>/`) - owns `critical-review`, `memory-first`, and `agent-delegation` skills; installed and enabled by both installers
- `[BUG-020]` `"code-conductor@code-conductor": true` injected into `~/.claude/settings.json` `enabledPlugins` by both installers; `Skill({ skill: "critical-review" })` now resolves without superpowers dependency

### Changed
- `[BUG-020]` 6 prose references to `claude-mem` replaced with `.claude/memory/project.md` in `global/CLAUDE.md`, `skills/memory-first.md`, `skills/agent-delegation.md`, `README.md`, `.claude/hooks/pre-tool-use.sh`, `project-template/.claude/hooks/pre-tool-use.sh`


## [1.13.0] - 2026-06-22

### Added
- `[BUG-017]` Guard 4 in `.claude/hooks/pre-tool-use.sh` and `project-template/.claude/hooks/pre-tool-use.sh` — blocks `Read` tool on paths containing `graphify-out` or `node_modules` as exact path components; python3 component-match with normpath traversal fix; fail-open on python3 absence
- `[BUG-017]` `tests/hooks/guard4.test.js` — 17 Vitest tests covering blocked paths, case variants, traversal escape, fail-open scenarios, and non-Read tool skip

### Changed
- `[BUG-017]` `install.sh` / `install.ps1` — hook download is now idempotent (skips if `.claude/hooks/pre-tool-use.sh` already exists); added repository-root sentinel guard and parent-directory warning
- `[BUG-017]` `CLAUDE.md` / `project-template/CLAUDE.md` — Session Initialization mandates `Glob` (NEVER `Read`) for existence checks; explicit Guard 4 constraint documented


## [1.12.0] - 2026-06-22

### Added
- `package.json` + `vitest.config.js` — Vitest ^3.0.0 test harness with `pool: forks` + `singleFork: true` (FEAT-024)
- `tests/hooks/guard3.test.js` — 108 Layer 1 tests for `.claude/hooks/pre-tool-use.sh` Guard 3 patterns P1-P12, obfuscation detection, and allowlist (FEAT-024)
- `tests/hooks/verbosity-remind.test.js` — 19 Layer 1 tests for global/project verbosity-remind hooks; `describe.skipIf(!BASH)` Windows guard (FEAT-024)
- `tests/unit/placeholder.test.js` — Layer 2 scaffold stub for future JS module tests (FEAT-024)
- `.github/workflows/test.yml` — GitHub Actions CI on `ubuntu-latest` / Node 20 with Vitest transform cache (FEAT-024)
- `install.sh` — Node >=20 / npm >=10 engine check + pre-commit test gate (`# code-conductor:test-gate` heredoc, idempotent) (FEAT-024)
- `install.ps1` — Node >=20 / npm >=10 engine check + pre-commit test gate (UTF-8 no BOM, LF-normalized via `.Replace`) (FEAT-024)
- `CONTRIBUTING.md` — "Bypassing the Pre-Commit Hook" section with `--no-verify` policy and manual validation checklist (FEAT-024)

### Changed
- `install.ps1` line 225 — em dash (`—`) replaced with `--` to fix `MissingEndCurlyBrace` parse error in Windows PowerShell 5.1 subprocess invocations


## [1.11.0] - 2026-06-16

### Added
- `global/hooks/verbosity-remind.sh` -- global `UserPromptSubmit` hook; re-injects active verbosity level before every response; defers to project hook via upward traversal (BUG-014)
- `project-template/.claude/hooks/verbosity-remind.sh` -- project-scoped hook; emits level-aware verbosity reminder; reads nearest `.claude/memory/verbosity.md` via ancestor traversal (BUG-014)
- `CC_VERBOSITY_SKIP` bypass flag for CI/CD environments
- `install.sh` / `install.ps1` -- `_merge_settings_json` / `Merge-SettingsJson` function; jq -> python3 -> manual fallback; preserves third-party hooks; idempotent re-runs (BUG-014)

### Changed
- `skills/verbosity.md` -- Application section updated to describe hook-driven enforcement (BUG-014)
- `project-template/.claude/settings.json` -- `UserPromptSubmit` array added with embedded traversal command

