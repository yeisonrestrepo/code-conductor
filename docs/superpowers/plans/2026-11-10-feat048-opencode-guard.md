# FEAT-048 slice 1: OpenCode guard plugin — implementation plan

**Spec:** `docs/superpowers/specs/2026-11-10-feat048-opencode-guard-design.md` (draft, pending owner approval)
**Item:** `[FEAT-048]`, issue #97. First vertical slice only.

## Protected surfaces touched

- The installer: `bin/code-conductor.mjs` (one flag, the usage line, one warning) and `lib/installer/deploy.mjs` (`deployProject` skips `.opencode` unless asked, and reports the install).
- The hook `pre-tool-use.mjs` is **not** touched, in either copy. The plugin spawns it.
- No settings file changes.

## Predicted red table (written before any run)

Local: Windows 11, Node 24.16.0. Subjects: the three test files below, run before the implementation exists.

| Suite | Test | Predicted before | Why |
|---|---|---|---|
| `tests/hooks/opencode-guard.test.js` | whole file | red: file fails to load | `project-template/.opencode/plugin/conductor-guard.js` does not exist, so the `beforeAll` import throws and every test in the file fails |
| `tests/installer/deploy.test.js` | `writes no .opencode/ without the opencode option` | red | the fixture template has `.opencode/`, and the copy loop copies every root entry |
| | `installs the plugin byte for byte and reports it…` | red | the file is copied, but no report line is emitted |
| | `keeps the host project's own .opencode/ files` | green | `cpSync` already merges into an existing directory |
| | `ships the real plugin in the template` | red | no plugin in the template yet |
| `tests/installer/cli.test.js` | `lists --opencode in --help` | red | not in `USAGE` |
| | `installs the OpenCode plugin with --project --opencode` | red | `--opencode` is unrecognized, and the template has no plugin |
| | `writes no .opencode/ for --project alone` | green | no `.opencode/` in the template yet |
| | `warns and writes nothing … without --project` | red | the flag is reported as unrecognized |

After the implementation every row is green. Every other suite is predicted unchanged.

CI legs: the new tests spawn `node` and need no bash, so each leg of `.github/workflows/test.yml` (ubuntu and windows, Node 20 and 24) is predicted to add these tests as passed and skip none. `tools/skip-baseline.json` is therefore unchanged.

## Steps

1. Write the three test files' new cases (above). Run them; record the red result against the table.
2. Add `project-template/.opencode/plugin/conductor-guard.js`: the tool map, the payload builder, the guard spawn, the decision reader and the exported `ConductorGuard`. Functions under 30 lines, no imports outside `node:`.
3. `lib/installer/deploy.mjs`: `deployProject` takes `opencode` (default `false`), skips the `.opencode` template entry without it, and reports `code-conductor: installed the OpenCode guard plugin at .opencode/plugin/conductor-guard.js` with it.
4. `bin/code-conductor.mjs`: parse `--opencode`, add `[--opencode]` to `USAGE`, warn `code-conductor: --opencode needs --project; no OpenCode files were written` when `--project` is absent, and pass the option through.
5. Run the targeted files green. Then the full suite once, `npx vitest run --maxWorkers=2 --minWorkers=1`, and compare counts with `main`.
6. Docs: README install flags table, a short "OpenCode" subsection with what is enforced and what is lost, and the wiki Getting-Started flags table.
7. `.gitignore`: leaf lines for this spec and plan in sorted position (`gitignore-block-parity` passes).

## Follow-up slices (named, not planned here)

OpenCode commands and agents (generated, with a drift test); tool-name-independent command bodies; context injection; Codex CLI; Antigravity. Each needs its own spec once the owner approves this one.
