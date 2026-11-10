# FEAT-048 slice 1: the OpenCode guard plugin

**Status:** Draft, awaiting owner approval
**Item:** `[FEAT-048]` Multi-Harness Support (Codex, Antigravity, OpenCode), issue #97
**Scope:** the first vertical slice of FEAT-048 only. The other slices are listed under "Follow-up slices" and are not built here.

## Problem

code-conductor enforces its guards only on Claude Code. The POC on issue #97 (2026-10-22) found that OpenCode has the strongest evidence of the three harnesses: its plugin hook `tool.execute.before` blocked Guard 3 and Guard 4 through a thin adapter around the unchanged `pre-tool-use.mjs`, with 9 of 9 checks run against OpenCode 1.18.33. Codex and Antigravity were checked offline only.

The guards are the part of the product that decides viability (issue #97: "A harness with no pre-tool hook can carry the workflow but cannot enforce it"). So the first slice is enforcement on OpenCode, shipped end to end: the adapter, the opt-in install, the tests and the docs.

## Why this slice first

| Candidate | Evidence today | Blocked on |
|---|---|---|
| **OpenCode guard plugin** | Live on 1.18.33 (POC), plus the offline parity test in this slice | Nothing |
| Codex hooks | Offline only | A Codex install and sign-in for a live run |
| Antigravity hook | Offline only, two argument names unverified | An `agy` install and sign-in |
| OpenCode commands and agents | Live load on 1.18.33 | Command bodies name Claude tools (`Read`, `Grep`, `Bash`, `.claude/`), the "tool-name-independent bodies" open item |
| Context injection | Not tested on any harness | A live run on each harness |

## Acceptance criteria answered

The backlog entry's criteria, and what this slice does with each:

1. **Claude Code installs do not change byte for byte.** The OpenCode files are written only when `--opencode` is passed together with `--project`. Without the flag, `deployProject` skips `project-template/.opencode/`, and a test pins that no `.opencode/` appears.
2. **A measured verdict per harness, and a harness that cannot block is never claimed as guarded.** OpenCode can block (the hook throws). The README states what is and is not enforced on OpenCode (see "What is lost" below). Codex and Antigravity keep their POC verdicts and are not claimed by this slice.
3. **The adapter passes the same guard fixtures as the Claude Code hook.** `tests/hooks/opencode-guard.test.js` drives the plugin with every Bash row of `tests/fixtures/guard3-corpus.js` (`CORPUS` and `DIALECT`, allowlists included) and asserts the corpus verdict, plus Guards 1, 2 and 4 and a reason-for-reason comparison against the hook spawned directly.
4. **Translated files are generated from `.claude/` sources and checked for drift.** Not reached: this slice translates no command, agent or instructions file. The plugin is the only OpenCode file, and it is an adapter, not a translation. The criterion binds the follow-up "OpenCode commands and agents" slice.
5. **Zero new runtime dependencies.** The plugin imports only `node:child_process` and `node:path`. It does not import `@opencode-ai/plugin`; OpenCode calls an exported async function whatever its types.

## Design

### The plugin: `project-template/.opencode/plugin/conductor-guard.js`

- Exports one function, `ConductorGuard`, because OpenCode treats every exported function of a plugin module as a plugin.
- Returns one hook, `tool.execute.before(input, output)`.
- Maps the OpenCode tool call to the Claude payload the guard already reads:

  | OpenCode `input.tool` | `output.args` | Claude payload |
  |---|---|---|
  | `bash` | `command` | `Bash`, `{ command }` |
  | `read` | `filePath`, `offset`, `limit` | `Read`, `{ file_path, offset, limit }` |
  | `write` | `filePath`, `content` | `Write`, `{ file_path, content }` |
  | `edit` | `filePath`, `oldString`, `newString` | `Edit`, `{ file_path, old_string, new_string }` |

  Any other tool is let through without spawning the guard, the same as a tool the Claude Code matcher does not name.
- Runs `node <directory>/.claude/hooks/pre-tool-use.mjs` with the payload on stdin and `CLAUDE_PROJECT_DIR` set to the OpenCode `directory`, so the guard finds the same allowlist and run file it uses under Claude Code.
- A `deny` or an `ask` decision throws `Error(permissionDecisionReason)`, which is how OpenCode blocks a call and shows the reason to the model.
- If the guard cannot run (spawn error, timeout, non-zero exit, or output that is not JSON), the call is blocked with a reason that names the guard path. This matches the guard's own rule that a call no guard could inspect fails closed.

### Choices this spec makes (owner decision)

1. **`ask` blocks.** A plugin has no way to ask the user. Guard 2 (overwrite an existing file) and `CC_GUARD3_WARN` return `ask`. This slice blocks them and passes the guard's reason through, which tells the model to edit instead. The alternative, letting an `ask` through, would silently drop Guard 2 on OpenCode.
2. **`node` from `PATH`, not `process.execPath`.** OpenCode runs plugins inside its own runtime, so `process.execPath` is the OpenCode binary, not Node. The POC drove the plugin from Node and could not see this. Node is already required to install code-conductor.
3. **Opt-in flag `--opencode`, only with `--project`.** The plugin needs the project's `.claude/hooks/pre-tool-use.mjs`, so it is a project install. `--opencode` without `--project` writes nothing for OpenCode and says so on stderr; the exit code stays 0, like other flag warnings.
4. **Plugin directory `.opencode/plugin/`** (singular), the path the POC measured OpenCode 1.18.33 loading. OpenCode's docs also name `.opencode/plugins/`; the singular path was the one verified.
5. **Synchronous spawn.** The guard runs once per mapped tool call, as under Claude Code. `spawnSync` keeps the adapter short; the cost is one Node start per call.
6. **The plugin source lives in `project-template/.opencode/`**, mirroring where it lands in the host project, like every other root entry of the template.

### Installer (protected surface, minimal change)

- `bin/code-conductor.mjs`: parse `--opencode`, add it to `USAGE`, warn when it is given without `--project`, pass `opencode` to `deployProject`.
- `lib/installer/deploy.mjs`: `deployProject` skips the `.opencode` template entry unless `opencode` is set, and reports one stdout line when it installs the plugin.

Nothing else in the installer changes: the global half, settings merges, `.claude/` copy and the `CLAUDE.md`/`.gitignore` merges are untouched.

### What is lost on OpenCode, compared with Claude Code

| Surface | On OpenCode after this slice |
|---|---|
| Guards 1, 2, 3, 4 | Enforced through the plugin. Guard 2's `ask` blocks (choice 1) |
| Guards 5, 6, 7 (band roles, orchestrator run, role shell) | Not enforced for subagents: `tool.execute.before` does not carry the subagent's name, so the guard sees no `agent_type` |
| Warnings (`systemMessage`) | Not shown: the plugin has no channel for an allowed call's warning |
| `apply_patch`, `multiedit`, `task` | Not routed to the guard |
| UserPromptSubmit context hooks (verbosity, context guard) | Not wired (follow-up slice) |
| `cc-*` commands and band agents | Not translated (follow-up slice). OpenCode falls back to `CLAUDE.md` when there is no `AGENTS.md`, and loads `.claude/skills` |

## Follow-up slices (not in this PR)

1. **OpenCode commands and agents**, generated from `.claude/` sources with a drift test (backlog criterion 4).
2. **Tool-name-independent command bodies**, so one source serves every harness.
3. **Context injection** (verbosity and context-guard) on each harness, tested live.
4. **Codex CLI**, after a live run (needs `codex` installed and signed in).
5. **Antigravity**, after a live run (needs `agy` installed and signed in, and the unverified argument names checked).

## Verification

- Offline: the plugin test above, the installer tests, the full suite on Windows and on both CI legs.
- Live: not run in this slice. No `opencode` binary is installed on the machine that built it, and the brief forbids installing one. A maintainer with OpenCode can check it with `opencode debug config` in a project installed with `--project --opencode`, then a session that runs `cat src/*.js`.

## Out of scope

- Any change to the guard `pre-tool-use.mjs` (it is wrapped, never edited).
- Codex, Antigravity, translation of commands, agents or `CLAUDE.md`.
- OpenCode's unreleased V2 plugin API.
