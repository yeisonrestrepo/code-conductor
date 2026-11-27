# FEAT-048 slice 6: band agents on OpenCode

- **Item:** `[FEAT-048]` multi-harness support, issue #97
- **Status:** approved (autonomous workflow, pre-approved)
- **Date:** 2026-11-27

## Problem

`--project --opencode` installs the guard plugin and the `cc-*` commands, but not the band agents in `.claude/agents/`. The plugin also blocks OpenCode's `task` tool, so no subagent can start. The pre-1.44.0 hardening spec (`2026-11-10-pre-1-44-hardening-design.md`, Choice 2) blocked `task` because nobody had verified that `tool.execute.before` fires for a subagent's tool calls. It deferred "re-enabling `task` once a live run shows hooks firing inside subagents".

So on OpenCode:

- `/cc-review --spec --plan` cannot hand the review to `audit`.
- `/cc-spec --delegate` and `/cc-plan --delegate` cannot dispatch their roles.
- Guards 5, 6 and 7 never apply, because the plugin never sends an `agent_type`.

## Measured (OpenCode 1.19.6, Windows 11, 2026-11-27)

The live probe was run in the scratchpad with the free `opencode/big-pickle` model, no sign-in, and a logging plugin.

1. **Hooks fire inside subagents.** A primary `build` session called `task` with `subagent_type: probe-sub`. The subagent's `bash` call reached `tool.execute.before` with the child's `sessionID`. A `throw` in the hook blocked it, and the subagent returned the block reason.
2. **The plugin can identify the subagent.** `client.session.get({ path: { id: sessionID } })` returned:
   - for the child: `agent: "probe-sub"` and `parentID: <primary session>`;
   - for the primary: `agent: "build"` and no `parentID`.

   The source shows why. `tool/task.ts` creates the child with `agent: next.name, parentID`, and `session/tools.ts` triggers `tool.execute.before` for every registry tool, with the running session's id.
3. **Wildcard deny confines an agent.** An agent with `permission: {"*": deny, read: allow, grep: allow, glob: allow}` saw exactly `glob`, `grep` and `read`. It had no shell and no write tool, and wrote no file.
4. **A task prompt's `@path` is attached without a tool call.** `task.ts` passes `params.prompt` through `resolvePromptParts`, which applies `FILE_REGEX` and attaches each file it names, as a command template does (from the source). Shell triggers are not run there: `ConfigMarkdown.shell` is applied only to command templates.
5. **`task_id` resumes any session.** With `task_id`, `task.ts` reuses that session and prompts it with `subagent_type`'s agent. The session's recorded `agent` is then not the agent running.
6. **`plan` is a built-in OpenCode agent**, the primary Plan mode. An agent file named `plan.md` would override it.

## Options

| | Approach | Verdict |
|---|---|---|
| A | Render the agents only, keep `task` blocked | Rejected: the agents could never run |
| B | Unblock `task`, send subagent calls as the primary's | Rejected: Guards 5 and 7 would never see a band role, so a role's scope and shell rules would be lost |
| **C** | **Render the agents as `conductor-<role>`, unblock `task` through the guard, and attribute each call to its session's agent** | **Chosen** |

## Design (option C)

### 1. Agent renders: `lib/installer/harness-commands.mjs`

`renderAgent(name, text)` turns `project-template/.claude/agents/<name>.md` into `.opencode/agent/conductor-<name>.md`:

```markdown
---
description: "<source description>"
mode: subagent
permission:
  "*": deny
  read: allow
  grep: allow
  glob: allow
  edit: allow      # only when the source lists Write or Edit
  bash: allow      # only when the source lists Bash
---

<AGENT_PREAMBLE>

<source body>
```

- **The tool map** is fixed: `Read→read`, `Grep→grep`, `Glob→glob`, `Write→edit`, `Edit→edit`, `Bash→bash`. A source tool outside the map throws, so the drift test fails rather than silently dropping a tool.
- **`"*": deny` first** denies every tool the source does not list, including `task`, `webfetch` and `todowrite` (measured 3).
- **Dropped:** `name`, `tools`, `default-model` and `omitClaudeMd`. OpenCode's own `tools` key has another shape, and the model is inherited.
- **The `conductor-` prefix** avoids overriding OpenCode's built-in `plan` (measured 6) and a host's own `code`, `docs` or `qa` agent.
- **`AGENT_PREAMBLE`** says the agent was written for Claude Code, so it uses its closest equivalent wherever it names a Claude Code tool.
- **Bodies are not neutralized.** OpenCode does not template an agent prompt, and no agent body holds a `` !` ``, `@path` or `$ARGUMENTS` today.
- **`renderAll`** adds the agent renders, and **`staleRenders`** also checks `.opencode/agent/`.

**`OPENCODE_NOTE`** in every rendered command gains one sentence: a code-conductor agent the command names, such as `audit`, is the OpenCode subagent `conductor-audit`.

### 2. The plugin: `project-template/.opencode/plugin/conductor-guard.js`

**`task` is mapped.** It is no longer blocked.

- `subagent_type` and `prompt` must be non-empty strings, else the call is blocked for the bad argument.
- `task_id` is blocked (measured 5), because attribution follows the session.
- A prompt with a `FILE_REGEX` match that has a non-empty capture is blocked (measured 4), because the attached file would bypass Guards 1 and 4. The reason tells the model to name the path without the `@`.
- Otherwise the call becomes one `{tool_name: "Agent", tool_input: {subagent_type: role, description, prompt}}` payload, so Guard 6's nested-dispatch check (R7) sees it.

**Every mapped call is attributed.** Before building payloads, the plugin calls `client.session.get` for `input.sessionID`.

- **Agent type.** When the session has a `parentID`, or its `agent` starts with `conductor-`, the payload carries `agent_type`: the session's `agent` with a leading `conductor-` removed.
- **Session id.** `session_id` is the root session's id, found by walking `parentID`. Claude Code sends the main session's id from a subagent too, and Guard 6 keys a run on it.
- **Caching.** Results are cached per session id, since a session's agent and parent never change.
- **Failing closed.** If the lookup fails, has no `data`, or finds a child with no `agent`, the call is blocked: "code-conductor guard could not identify the OpenCode session's agent". The same happens when the plugin was given no `client`.

**Unchanged:**

- Read-only tools still pass without a lookup or a guard run.
- An unknown tool is still blocked.

### 3. Installer: `lib/installer/deploy.mjs`

With `--opencode`, `.opencode/agent/` is copied like the commands. The report line reads `code-conductor: installed the band agents as OpenCode subagents in .opencode/agent/`. `copyRenderedCommands` takes its report line from the caller.

## Known limits (stated in README)

- **No orchestrated run on OpenCode.** `orchestrate.mjs start` needs `CLAUDE_CODE_SESSION_ID`, which OpenCode does not set, so `/cc-orchestrate` refuses with `ORCH_NO_SESSION_ID`. Out-of-run dispatches work: `/cc-review` → audit, and the `--delegate` forms.
- **Shared session id.** The guard's `session_id` for a subagent is the root session's. This matches Claude Code, and nothing on OpenCode starts a run, so Guard 6 never enforces a live run there.

## Acceptance

- **AC1:** for each of the 10 agents, the drift test re-renders `.opencode/agent/conductor-<name>.md`, and the committed file matches. A stale file fails the test.
- **AC2:**
  - The `audit` render has `"*": deny` and allows only `read`, `grep` and `glob`.
  - The `code` render also allows `edit` and `bash`.
  - A source with an unmapped tool throws.
- **AC3:**
  - A `task` call from a primary session runs the guard once, with `tool_name: "Agent"`, `subagent_type` with the prefix removed, and no `agent_type`.
  - A `task` call from a child session carries the child's `agent_type` and the root `session_id`.
- **AC4:** `task` is blocked:
  - with `task_id`;
  - with an `@path` in the prompt;
  - with a missing `subagent_type` or `prompt`.
- **AC5:** against the real guard:
  - in a child session of `conductor-audit`, `bash` is denied with Guard 7's `ROLE_SHELL_DENIED`;
  - in a child session of `conductor-code`, `bash` with no live run is denied with `ROLE_SHELL_UNRESOLVED`;
  - the same command from the primary session passes.
- **AC6:** a failed, empty, or missing `client` lookup blocks a mapped call with the identify reason. Read-only tools still pass with no client.
- **AC7:** `deployProject(..., { opencode: true })` writes the 10 agent renders and reports them; without `opencode` it writes none.
- **AC8:** every rendered command carries the agent-name sentence and still passes the OpenCode trigger regex test.

## Docs

- **`README.md`, OpenCode table:**
  - The Guards 5, 6, 7 row becomes "Enforced for subagents".
  - The `task` row becomes "Sent to the guard as `Agent`".
  - The band agents row is updated.
  - The layout tree gains `.opencode/agent/conductor-*.md`.
- **`.github/wiki/pages/Getting-Started.md`:** the `--opencode` row.
- **The hardening spec:** Choice 2 and its out-of-scope line get an in-place amendment that points here.
