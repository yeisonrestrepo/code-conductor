# Changelog

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

