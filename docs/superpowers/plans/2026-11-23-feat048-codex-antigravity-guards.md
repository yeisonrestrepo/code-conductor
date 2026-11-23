# FEAT-048 slice 2: Antigravity CLI and Codex CLI guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the unchanged `pre-tool-use.mjs` guard on Antigravity CLI (`agy`) through a thin adapter, and on Codex CLI only if a live deny is proven.

**Architecture:** `project-template/.agents/hooks/conductor-guard.mjs` reads agy's `PreToolUse` payload on stdin, maps it to Claude's `{tool_name, tool_input, cwd}`, runs the project's guard with `process.execPath`, and prints `{"decision":"deny","reason":…}` on deny/ask. The installer writes `.agents/` (and `.codex/` if Task 5 passes) only under `--project --antigravity` / `--project --codex`, merging hooks files with the existing `mergeSettingsFile` (fingerprint-based, BUG-069 style).

**Tech Stack:** Node ≥22 ESM, `node:` builtins only, vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-feat048-codex-antigravity-guards-design.md`

## Global Constraints

- `project-template/.claude/hooks/pre-tool-use.mjs` is never edited; zero new runtime dependencies.
- A Claude Code install with neither flag stays byte-for-byte the same.
- `--antigravity` / `--codex` without `--project` warn and write nothing (same as `--opencode`).
- Every unmapped tool, malformed argument, guard crash, timeout or non-JSON guard output blocks the call.
- New files under `/docs/*` need `git add -f` plus a sorted leaf in the `.gitignore` tracked-surface block.
- Never `--dangerously-bypass-hook-trust`; never bare `git add -u`.

## Measured agy 1.5.15 contract (2026-11-23, live, scratchpad `probe/`)

| Item | Value |
|---|---|
| Hook command cwd | `<project>/.agents/` (a `.agents/…` relative path resolved to `.agents/.agents/…`) |
| Hook exit ≠ 0 | The tool call is blocked (native fail-closed) |
| Tools seen | `run_command`, `read_file`, `write_file`, `edit_file`; no list/grep/search tool exists |
| `run_command` args | `CommandLine`, `toolSummary`, `WaitMsBeforeAsync`, `BypassSandbox`, `IsDaemon`; no cwd arg |
| `read_file` args | `Path` (absolute), optional `StartLine`, `EndLine` (1-based, inclusive) |
| `write_file` args | `Path`, `Content` |
| `edit_file` args | `Path`, `Target`, `Replacement` |
| Every tool | may carry `toolSummary` |

## Review Focus

1. `read_file` with `StartLine` but no `EndLine` → Read with `offset` only, so Guard 1 still judges an unbounded read of a big file.
2. `run_command` with an argument agy adds in a future release → blocked with the argument named (BUG-071 rule), never passed silently.
3. A host `.agents/hooks.json` with its own `PreToolUse` entries → kept; ours upserted once; a re-run is `unchanged`.
4. Malformed host `.agents/hooks.json` → backed up and replaced (existing `mergeSettingsFile` behaviour).
5. Payload `toolCall` missing or not an object → blocked, adapter exits 0 with a deny JSON.

---

- [X] [T-000] Task 0: commit the spec and plan
  - [X] [T-000-A] Add leaves `!/docs/superpowers/plans/2026-11-23-feat048-codex-antigravity-guards.md` and `!/docs/superpowers/specs/2026-11-23-feat048-codex-antigravity-guards-design.md` to `.gitignore` in sorted position.
  - [X] [T-000-B] Run `npx vitest run tests/unit/gitignore-block-parity.test.js` after staging; expected PASS.
  - [X] [T-000-C] `git add -f docs/superpowers/specs/2026-11-23-feat048-codex-antigravity-guards-design.md docs/superpowers/plans/2026-11-23-feat048-codex-antigravity-guards.md` then `git add -u .gitignore .claude/memory/project.md`
  - [X] [T-000-D] `git commit -m "docs: add the FEAT-048 slice 2 Antigravity and Codex guard spec and plan"`

### Task 1: Antigravity adapter

**Files:**
- Create: `project-template/.agents/hooks/conductor-guard.mjs`
- Create: `tests/fixtures/antigravity-payloads.js` (recorded live payloads, trimmed: `cwd`, `hookEventName`, `toolCall`, `workspacePaths`)
- Test: `tests/hooks/antigravity-guard.test.js`

**Interfaces:**
- Produces: `mapToolCall(toolCall) -> { payload: {tool_name, tool_input} } | { block: string }` (exported for tests); script entry reads stdin, writes deny JSON or nothing, always exit 0 when it can write.
- Project root = `resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')`; guard = `<root>/.claude/hooks/pre-tool-use.mjs`; guard env `CLAUDE_PROJECT_DIR=<root>`, cwd `<root>`, timeout 60000 ms, input on stdin (never argv).

Mapping:
- `run_command` → `Bash {command: CommandLine}`; `CommandLine` must be a string; any key outside `{CommandLine, toolSummary, WaitMsBeforeAsync, BypassSandbox, IsDaemon}` blocks, naming it.
- `read_file` → `Read {file_path: Path, offset: StartLine, limit: EndLine - StartLine + 1}`; offset/limit only when integers; `Path` non-empty string.
- `write_file` → `Write {file_path: Path, content: Content}`; `edit_file` → `Edit {file_path: Path, old_string: Target, new_string: Replacement}`.
- Any other name → `code-conductor guard does not cover the Antigravity tool "<name>"; it is blocked until the guard maps it`.
- Guard decision parsing mirrors `readDecision` in `project-template/.opencode/plugin/conductor-guard.js:129-141` (deny and ask both block).

- [X] [T-001] Write the Antigravity adapter tests and adapter
  - [X] [T-001-A] Write `tests/hooks/antigravity-guard.test.js`: scaffold a temp project (copy guard + adapter into `.claude/hooks/` and `.agents/hooks/`), run `node .agents/hooks/conductor-guard.mjs` with cwd `<tmp>/.agents` and the payload on stdin. Tests: (1) every Bash row of `CORPUS`/`DIALECT` from `tests/fixtures/guard3-corpus.js` gives the same allow/deny as the Claude hook; (2) recorded `run_command "echo probe-ok"` → empty stdout; (3) `read_file` of a 300-line file with no range → deny naming Guard 1; with `StartLine:10, EndLine:20` → allow; (4) `read_file` under `node_modules/` → Guard 4 deny; (5) `write_file`/`edit_file` recorded payloads → allow; (6) unknown tool `browser_open` → deny with the uncovered reason; (7) `run_command` with `Cwd` → deny naming `"Cwd"`; (8) `run_command` with `CommandLine: 5` → deny; (9) missing `toolCall` → deny; (10) non-JSON stdin → deny; (11) guard file removed → deny naming the guard path; (12) guard replaced by a script printing `not json` → deny.
  - [X] [T-001-B] Run `npx vitest run tests/hooks/antigravity-guard.test.js`; expected: all FAIL (adapter missing).
  - [X] [T-001-C] Implement `project-template/.agents/hooks/conductor-guard.mjs` and `tests/fixtures/antigravity-payloads.js` per Interfaces; a top-level try/catch turns any throw into a deny JSON.
  - [X] [T-001-D] Run `npx vitest run tests/hooks/antigravity-guard.test.js tests/hooks/opencode-guard.test.js`; expected: all PASS.
  - [X] [T-001-E] `git add project-template/.agents/hooks/conductor-guard.mjs tests/hooks/antigravity-guard.test.js tests/fixtures/antigravity-payloads.js` and `git add -u docs/superpowers/plans/2026-11-23-feat048-codex-antigravity-guards.md`
  - [X] [T-001-F] `git commit -m "feat: add the Antigravity CLI guard adapter [FEAT-048]"`

### Task 2: `--antigravity` installer flag

**Files:**
- Create: `project-template/.agents/hooks.json` = `{"hooks":{"PreToolUse":[{"matcher":".*","hooks":[{"type":"command","command":"node hooks/conductor-guard.mjs"}]}]}}`
- Modify: `lib/installer/deploy.mjs:28,285-309` (skip `.agents` in the template-root copy loop; `antigravity` option; `installAntigravityGuard`)
- Modify: `bin/code-conductor.mjs:12,27,38,102,139`
- Test: `tests/installer/deploy.test.js`, `tests/installer/cli.test.js`

**Interfaces:**
- Consumes: `mergeSettingsFile(templatePath, settingsPath, ['conductor-guard.mjs'])` from `lib/installer/settings-merge.mjs`; the adapter file goes through the same `removePluginSymlink` + `mergeFileInto(..., replaceWithTemplate)` path the OpenCode plugin uses (generalize the two helpers to take the relative path instead of the `OPENCODE_PLUGIN` constant).
- Produces: `deployProject(assetRoot, cwd, { …, antigravity = false })`; report line `code-conductor: installed the Antigravity guard at .agents/hooks/conductor-guard.mjs`; CLI warning `code-conductor: --antigravity needs --project; no Antigravity files were written`.

- [X] [T-002] Wire `--antigravity` through the installer
  - [X] [T-002-A] Add deploy tests: no `.agents/` without the option (and full tree identical to a pre-change install); adapter byte-for-byte + hooks.json created with the option; host `.agents/hooks.json` with its own `PreToolUse` entry keeps it and gains ours once; second run reports `unchanged`; malformed host hooks.json is backed up; host `.agents/other.md` untouched; symlinked adapter path replaced, target untouched.
  - [X] [T-002-B] Add CLI tests: `--antigravity` without `--project` warns and writes nothing; usage line lists `--antigravity`.
  - [X] [T-002-C] Run `npx vitest run tests/installer/deploy.test.js tests/installer/cli.test.js`; expected: the new tests FAIL, existing ones PASS.
  - [X] [T-002-D] Create `project-template/.agents/hooks.json`; implement the deploy and CLI changes.
  - [X] [T-002-E] Run `npm test`; expected: full suite PASS (templates/parity tests updated only if they enumerate template files).
  - [X] [T-002-F] `git add project-template/.agents/hooks.json` and `git add -u lib/installer/deploy.mjs bin/code-conductor.mjs tests/installer/deploy.test.js tests/installer/cli.test.js docs/superpowers/plans/2026-11-23-feat048-codex-antigravity-guards.md`
  - [X] [T-002-G] `git commit -m "feat: install the Antigravity guard with --antigravity [FEAT-048]"`

### Task 3: live Antigravity evidence

**Files:** none in the repo; transcripts in the scratchpad, attached to the PR.

- [X] [T-003] Prove the install on agy 1.5.15
  - [X] [T-003-A] In a fresh scratch git project run `node <repo>/bin/code-conductor.mjs --project --antigravity`.
  - [X] [T-003-B] `agy -p` asking it to run `cat *.log` (Guard 3 blocks glob dumps; a single-file `cat` is allowed by design) → transcript shows `tool call denied by pre-tool hook: … Guard 3`.
  - [X] [T-003-C] `agy -p` asking it to read `node_modules/x/index.js` → Guard 4 denial; `echo ok` → runs.
  - [X] [T-003-D] Save the three transcripts and a screenshot under the scratchpad `evidence/` folder.

### Task 4: Codex live check (gate)

**Files:** none in the repo.

- [X] [T-004] Measure Codex 0.171 hooks live
  - [X] [T-004-A] Ask the user to open `codex` in scratchpad `probe/proj`, trust the hooks in `/hooks`, and ask Codex to run `echo hi`.
  - [X] [T-004-B] Read `probe/codex.log`: record the payload shape, the hook command cwd, and the tool name for shell calls.
  - [X] [T-004-C] Swap the probe hook for one printing Claude's `hookSpecificOutput.permissionDecision: deny` and confirm Codex blocks the call. If the Windows sandbox blocks every shell call before the hook, or no deny is observed, Task 5 takes its "workflow only" branch.

### Task 5: Codex install or documented gap

**Files (deny proven):** Create `project-template/.codex/hooks.json` pointing `PreToolUse` at `node <path-to>/.claude/hooks/pre-tool-use.mjs` relative to the cwd measured in T-004-B (or a Codex adapter beside it if the payload differs from Claude's); modify `lib/installer/deploy.mjs`, `bin/code-conductor.mjs`, tests as in Task 2 with fingerprint `pre-tool-use.mjs`, flag `--codex`.
**Files (no deny):** none; README states Codex is workflow only.

- [>] [T-005] Ship `--codex` or record the gap
  - [X] [T-005-A] If T-004-C proved a deny: repeat T-002-A..E for `--codex` (deploy/CLI tests first, red, then implementation, then `npm test` PASS), plus one live Codex transcript showing a Guard 3 block.
  - [ ] [T-005-B] If not: no code; carry the measured reason into Task 6.
  - [ ] [T-005-C] Stage the touched files with explicit paths (`git add` new, `git add -u` tracked, including the plan file) and `git commit -m "feat: install the Codex CLI guard with --codex [FEAT-048]"` (skip when T-005-B applies).

### Task 6: documentation

**Files:**
- Modify: `README.md:392,402-419,561` (flags table rows, `### Antigravity` and `### Codex` subsections each with a "lost compared with Claude Code" table, tree lines; replace "Codex CLI and Antigravity are not supported yet")
- Modify: `.github/wiki/pages/Getting-Started.md` (flag mention next to `--opencode`)
- Modify: `AGENT-READABLE BACKLOG.md` (FEAT-048 entry: slice 2 status)

- [ ] [T-006] Document both harnesses
  - [ ] [T-006-A] Write the README and wiki changes; the Antigravity table lists: no `UserPromptSubmit` context injection, no `cc-*` commands or agents, Guards 5–7 not enforced, needs `node` on `PATH`, unknown tools blocked.
  - [ ] [T-006-B] Run `npm test`; expected: full suite PASS (doc-parity tests included).
  - [ ] [T-006-C] `git add -u README.md .github/wiki/pages/Getting-Started.md "AGENT-READABLE BACKLOG.md" docs/superpowers/plans/2026-11-23-feat048-codex-antigravity-guards.md`
  - [ ] [T-006-D] `git commit -m "docs: document the Antigravity and Codex guards [FEAT-048]"`

### Task 7: PR

- [ ] [T-007] Open the PR and report on #97
  - [ ] [T-007-A] Push the branch; `gh pr create` with `Closes` only if Codex shipped, else `Refs #97`; body has the evidence screenshots and ends with `Code created by Claude Code (Claude Opus 5.5)`.
  - [ ] [T-007-B] Comment on #97 with the Claude / Codex / agy sample images and the measured contract table.

## Test List
- Unit: adapter mapping and fail-closed cases (Task 1)
- Integration: adapter → real guard via the Guard 3 corpus, Guards 1 and 4 (Task 1)
- Installer: flag, merge, byte-identical default install (Task 2, Task 5)
- Live E2E: agy transcripts (Task 3), Codex transcript (Task 5 if proven)

## Commit Order
T-000 spec+plan → T-001 adapter → T-002 installer flag → T-005 Codex (conditional) → T-006 docs. Ticks of each task's last commit ride the next commit's `git add -u` of the plan file.

## Identified Risks
- agy changes hook cwd or arg names in a minor release → unknown tools/args block visibly; T-003 rerun catches it.
- `cmd.exe` quoting: the hook command has no spaces or quotes (`node hooks/conductor-guard.mjs`), so project paths with spaces are safe.
- Codex hook trust never granted → Codex ships as workflow-only; nothing claims enforcement.
- `templates.test.js` may enumerate template files and fail on `.agents/` → update its expectation in T-002-E, not the template.
