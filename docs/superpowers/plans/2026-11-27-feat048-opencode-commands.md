# Plan: FEAT-048 slice 4, `cc-*` commands on OpenCode

**Spec:** `docs/superpowers/specs/2026-11-27-feat048-opencode-commands-design.md` (approved 2026-11-27)
**Status:** Approved 2026-11-27 (pre-approved with the spec)
**Branch:** `feat/feat-048-opencode-commands`
**Test command:** `npx vitest run`

## Tasks

- [ ] **T1 (tests first): renderer.** In `tests/installer/harness-commands.test.js`: `renderCommand` returns an `opencode` render whose frontmatter is the source description, whose body is `OPENCODE_PREAMBLE` plus the body with `` !` `` → `` ! ` `` and attachable `@x` → `@ x`; a source without those tokens keeps its body byte for byte; OpenCode v1.19.6's `SHELL_REGEX`, `FILE_REGEX` (non-empty names) and `$N` regex find nothing in any committed `.opencode/command/cc-*.md`; the drift count becomes three renders per source. Expected red.
- [ ] **T2: renderer.** `lib/installer/harness-commands.mjs`: `neutralizeForOpencode`, `OPENCODE_PREAMBLE`, the `opencode` render, `.opencode/command/<name>.md` in `renderAll`, `.opencode/command` in `staleRenders`. Run `node lib/installer/harness-commands.mjs --write`. Green.
- [ ] **T3 (tests first): install.** `tests/installer/deploy.test.js`: with `opencode: true` the commands land in `.opencode/command/` and the report line is said; without the flag nothing under `.opencode/`; a host `.opencode/command/mine.md` survives and a stale `cc-spec.md` is overwritten. `tests/installer/templates.test.js`: the `[BUG-069]` pin allows the plugin plus exactly the rendered command set. Expected red.
- [ ] **T4: install.** `lib/installer/deploy.mjs`: `if (opencode) copyRenderedCommands(templateRoot, cwd, '.opencode/command', 'OpenCode commands', report)`. Green.
- [ ] **T5: docs.** README OpenCode section: the `--opencode` option row and the OpenCode table row name the commands and the two rewrites; the layout tree line.
- [ ] **T6: verify.** Full suite green with counts against `main`; `dependencies` still `{}`.
