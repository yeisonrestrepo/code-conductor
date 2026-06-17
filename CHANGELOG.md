# Changelog


## [1.11.0] - 2026-06-16

### Added
- `global/hooks/verbosity-remind.sh` -- global `UserPromptSubmit` hook; re-injects active verbosity level before every response; defers to project hook via upward traversal (BUG-014)
- `project-template/.claude/hooks/verbosity-remind.sh` -- project-scoped hook; emits level-aware verbosity reminder; reads nearest `.claude/memory/verbosity.md` via ancestor traversal (BUG-014)
- `CC_VERBOSITY_SKIP` bypass flag for CI/CD environments
- `install.sh` / `install.ps1` -- `_merge_settings_json` / `Merge-SettingsJson` function; jq -> python3 -> manual fallback; preserves third-party hooks; idempotent re-runs (BUG-014)

### Changed
- `skills/verbosity.md` -- Application section updated to describe hook-driven enforcement (BUG-014)
- `project-template/.claude/settings.json` -- `UserPromptSubmit` array added with embedded traversal command

