# FEAT-048 slice 2: guard enforcement on Antigravity CLI and Codex CLI

**Status:** Approved 2026-11-23
**Item:** `[FEAT-048]` Multi-Harness Support, issue #97. Slice 1 (OpenCode) shipped in 1.44.0.
**Branch:** `feat/feat-048-codex-antigravity-guards`

## Problem

code-conductor's guards are enforced on Claude Code and OpenCode only. A team on Google's Antigravity CLI (`agy`) or OpenAI's Codex CLI gets no enforcement: Guard 3 does not scan its shell calls and Guards 1 and 4 do not see its reads. The October proofs of concept judged both harnesses viable, but only offline, and one of their assumptions turned out to be wrong when measured (below).

## Measured on 2026-11-23 (Windows 11, Node 24)

| Fact | Antigravity CLI 1.5.15 | Codex CLI 0.171.0 |
|---|---|---|
| Sign-in for a live run | Google account, done | ChatGPT account, done |
| Hook file | `<project>/.agents/hooks.json`, Claude-shaped `{hooks:{PreToolUse:[{matcher,hooks:[{type,command}]}]}}`, **live: fires** | `<project>/.codex/hooks.json`, `hooks` feature `stable` |
| Payload | `{cwd, workspacePaths[], hookEventName, toolCall:{name,args,id}, ...}` | Not measured yet (POC: same as Claude's) |
| Shell tool | `run_command`, `args.CommandLine` (**live**) | `Bash`-shaped per POC, not measured |
| Read tool | `read_file`, `args.Path` (**live**; the POC's `view_file`/`AbsolutePath` was wrong) | No read tool; reads go through the shell |
| Block reply | stdout `{"decision":"deny","reason":"…"}` → the agent sees `tool call denied by pre-tool hook: <reason>` (**live**) | POC: Claude's `hookSpecificOutput.permissionDecision: deny` |
| Trust gate | None in `-p` mode | A project's hooks run only after the user trusts them once (`/hooks`); `--dangerously-bypass-hook-trust` exists for automation |
| Other | `UserPromptSubmit` exists in the binary but did not fire in `-p` mode | On Windows the default sandbox rejected every shell call (`blocked by policy`) in this project |

## Solution

One thin adapter per harness wraps the **unchanged** `project-template/.claude/hooks/pre-tool-use.mjs`, as the OpenCode plugin does. The adapter turns the harness's pre-tool event into the guard's `{tool_name, tool_input, cwd}` payload, runs the guard with `node`, and turns a deny back into that harness's block reply. The installer writes the harness files only when asked (`--antigravity`, `--codex`, each with `--project`), so a Claude Code install stays byte-for-byte the same. Codex is claimed as guarded only after its own live check passes. If the check fails, Codex is documented as "workflow only, no enforcement" and leaves this slice.

## Behavior

### Main path (Antigravity)
1. `code-conductor --project --antigravity` writes `.agents/hooks.json` and `.agents/hooks/conductor-guard.mjs` next to the usual `.claude/` install.
2. agy calls the adapter on every `PreToolUse` with the payload above on stdin.
3. The adapter maps `run_command` → `Bash {command}`, `read_file` → `Read {file_path}`, and the write/edit tools → `Write`/`Edit` (argument names measured live in the plan phase, never guessed). It runs the project's guard and prints `{"decision":"deny","reason":<guard reason>}` on a deny or ask; it prints nothing on an allow.

### Main path (Codex)
1. `--codex` writes `.codex/hooks.json`, which points `PreToolUse` at the same guard, through a Codex adapter only if the live payload differs from Claude's.
2. The README tells the user to trust the hooks once in `/hooks`.

### Alternative paths
- A tool on the adapter's fixed read-only list (measured from the harness's tool list) passes without running the guard.
- `--antigravity` or `--codex` without `--project` warns and writes nothing, like `--opencode`.
- The host project already has `.agents/hooks.json` or `.codex/hooks.json`: our entry is merged in and existing entries are kept (precedent: BUG-069 for `.opencode/`).

### Error cases (fail closed, as in the OpenCode hardening)
- Any unmapped, non-read-only tool (MCP, browser, subagent, unknown) is blocked with a reason naming the tool.
- A mapped call with missing or malformed arguments is blocked before the guard runs.
- `node` is missing, the guard crashes, or its output is not JSON: the call is blocked.

## Acceptance Criteria
- [ ] A Claude Code install with neither flag stays byte-for-byte the same (installer test).
- [ ] The Antigravity adapter passes the same guard fixtures as the Claude hook for Guard 3 (Bash) and Guards 1 and 4 (Read), checked offline with recorded live payloads and no model call.
- [ ] Live, on agy 1.5.15: a Guard 3 command and a Guard 4 read are blocked, and a plain `echo` passes. The transcripts are kept as PR evidence.
- [ ] Each fail-closed case above has its own test.
- [ ] Codex: a live run shows a Guard 3 command blocked after hook trust. Without that, Codex ships as "workflow only, no enforcement" and nothing claims it is guarded.
- [ ] The README has an Antigravity subsection and a Codex subsection, each listing what is lost compared with Claude Code (as the OpenCode one does).
- [ ] The guard logic is never forked, and there are zero new runtime dependencies.

## Out of Scope
- Translating commands, agents, skills or `CLAUDE.md`/`AGENTS.md` for either harness, and the drift test for that.
- Context injection (`UserPromptSubmit`) on either harness.
- Gemini CLI: Google retired its personal sign-in in favour of Antigravity (measured 2026-11-23).
- The Antigravity IDE and App; only the `agy` CLI is targeted.
- Making Codex's Windows sandbox allow shell calls.

## System Impact
- `bin/code-conductor.mjs` and `lib/installer/*`: two new flags, mirroring `--opencode`.
- `project-template/`: `.agents/` and `.codex/` files. The `.gitignore` tracked-surface block needs the new leaves.
- `project-template/.claude/hooks/pre-tool-use.mjs`: read only, never changed.
- Tests: new `tests/hooks/antigravity-guard.test.js` and `tests/hooks/codex-guard.test.js`; additions to `tests/installer/deploy.test.js` and `tests/installer/cli.test.js`.
- README, wiki install page, backlog entry and CHANGELOG at release.

### Files Requiring Full Read (deferred to /cc-plan)
- `project-template/.opencode/plugin/conductor-guard.js`: the read-only list, fail-closed rules and patch parsing to mirror.
- `lib/installer/deploy.mjs`: how `--opencode` is wired and merged (BUG-069).

## Complexity Estimate
**M.** There are two small adapters and two installer flags on an existing pattern, but each needs live verification against a signed-in CLI.

## Pre-flight analysis (critical-review)
- **Happy path:** agy calls `run_command "cat big.log"` → the adapter builds a Bash payload → the guard denies → agy shows the denial and the command never runs.
- **Failure points:** hook command resolution (relative path vs. agy's cwd on Windows, since `cmd.exe` runs it as written); write/edit argument names not yet measured; agy renaming tools in a minor release (unknown tools fail closed, so the result is a visible block, not a silent bypass); Codex hook trust not granted (no enforcement, documented).
- **Boundary conditions:** paths with spaces in the hook command; `read_file` with no line range; very large `CodeContent`, which must go to the guard on stdin, never in argv; several workspace paths (`workspacePaths[]`), where `cwd` is the project root the guard is given.
