# Changelog


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

