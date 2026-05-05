# Changelog

All notable changes to code-conductor are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.1] - 2026-05-04

### Fixed

- **Installer hang on blank screen** — version fetch (`VERSION` file lookup) was running before any output, causing a blank terminal if the request was slow or the file didn't exist yet. Moved the banner print before the fetch and added a 5-second timeout (`-TimeoutSec 5` / `--max-time 5`) to both `install.ps1` and `install.sh`.

---

## [1.1.0] - 2026-05-04

### Fixed

- **Windows installer:** re-saved as UTF-8 with BOM to prevent PowerShell 5.1 parse errors — box-drawing characters in the script were being misread as Windows-1252, with byte `0x94` interpreted as a closing `"` and breaking string literals
- **claude-mem (Windows):** added `npm config set legacy-peer-deps true` around the install call to resolve an ERESOLVE peer dependency conflict between `tree-sitter@0.21.1` and `tree-sitter@0.22.4`
- **Graphify (Windows):** replaced `graphify install` with `python -m graphify install` to fix a false-positive `[OK]` status — `CommandNotFoundException` does not update `$LASTEXITCODE`, so the old code always reported success even when the command was not on PATH
- **Graphify (macOS/Linux):** same fix applied to `install.sh` — replaced `graphify install` with `python3 -m graphify install`

### Added

- **Command palette identifier:** all 10 commands now include a `description` frontmatter field showing `(Conductor)` so they are easy to identify alongside commands from other sources in the Claude Code command palette
- **Version tracking:** both installers now save the installed version to `~/.claude/memory/conductor-version.md` and display it in the install banner; re-running the installer shows an update notice when a newer version is available

---

## [1.0.0] - initial release

- Global core: spec-first workflow, token efficiency rules, memory conventions, safety guards
- Project template: `/spec` `/plan` `/review` `/debug` `/refactor` `/test` `/docs`
- Stack profiles: JavaScript, TypeScript, Python, Java, Go, Rust, React, Angular, Next.js, NestJS, Django, Flask
- Skills: `code-simplifier`, `ui-ux`, `verbosity`, `memory-first`, `agent-delegation`
- Hooks: `pre-tool-use` (large-file + duplicate-file guards), `post-compact` (checkpoint reminder)
- Dependencies: `claude-mem`, Playwright MCP, Superpowers plugin, Graphify
