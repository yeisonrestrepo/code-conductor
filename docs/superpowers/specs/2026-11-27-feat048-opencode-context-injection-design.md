# FEAT-048 slice 7: context injection on OpenCode

- **Item:** `[FEAT-048]` multi-harness support, issue #97
- **Status:** approved (autonomous workflow, pre-approved)
- **Date:** 2026-11-27
- **Builds on:** slice 6 (PR #365)

## Problem

On Claude Code, two `UserPromptSubmit` hooks add a line to every prompt:

- `verbosity-remind.sh` adds the verbosity line;
- `context-guard.sh` adds the turn warning that says when to run `/cc-compact`.

Slice 5 brought both to Codex CLI. OpenCode gets neither, because `--opencode` installs no prompt hook.

## Measured (OpenCode 1.19.6, Windows 11, 2026-11-27)

The live probe was run in the scratchpad with the free `opencode/big-pickle` model.

1. **A pushed part reaches the model.** A plugin's `chat.message` hook pushed `{type: "text", synthetic: true, text: "CONTEXT-MARKER: ZEBRA-4417"}` onto `output.parts`. The model quoted the marker exactly.
2. **The hook also fires for a subagent's prompt.** It fired for the prompt that `task` sends a subagent (`agent: "probe-ro"`), and the subagent quoted the marker too. Claude Code runs `UserPromptSubmit` only for the user's own prompt.
3. **The hook fires before the message is saved.** In `session/prompt.ts`, the parts are already resolved and are saved after the hook returns. A part needs an id that starts with `prt` (`session/schema.ts`). OpenCode generates it as `prt_` plus 12 hex digits of `timestamp * 0x1000 + counter`, plus 14 base62 characters (`id/id.ts`).

## Options

| | Approach | Verdict |
|---|---|---|
| A | Add `chat.message` to `conductor-guard.js` | Rejected. The guard fails closed, but these hooks only advise and must fail open. Keeping them apart keeps each file to one rule. |
| B | Append the line to the user's own text part | Rejected. It would change what the user is shown to have typed. |
| **C** | **A separate `.opencode/plugin/conductor-context.js` that runs the unchanged hooks and pushes one synthetic part** | **Chosen** |

## Design (option C)

`ConductorContext({ directory, client })` returns only `chat.message`. For each message:

1. **Skip subagent sessions.** `client.session.get` gives the session; if it has a `parentID`, nothing is added. If the lookup fails, the hook goes on, because the hooks only advise.
2. **Run the hooks.** Each of `verbosity-remind.sh` and `context-guard.sh` runs from `.claude/hooks/` with the project's bash:
   - on Windows, Git for Windows' bash from `git --exec-path`, as the Codex adapter does (`[BUG-062]`);
   - stdin is `{session_id, cwd, hook_event_name: "UserPromptSubmit", prompt}`, where `prompt` is the message's text parts joined;
   - the environment adds `CC_PROJECT_ROOT` and `CLAUDE_PROJECT_DIR`;
   - the timeout is 10 s.

   Only trimmed stdout from an exit-0 run is kept.
3. **Add the part.** When the joined output is non-empty, the hook pushes one synthetic text part with a fresh `prt_` id and the message's `sessionID` and `messageID`.
4. **Fail open.** Any throw is caught, and the message goes on unchanged.

The hook runner repeats about 20 lines of `.codex/hooks/conductor-context.mjs`. Each harness's files are installed independently, so neither may import the other.

**Installer.** With `--opencode`, `installOpencodePlugin` also installs `.opencode/plugin/conductor-context.js` through `installManagedFile`, so it gets the same symlink rule (`[BUG-087]`) and backup (`[BUG-069]`). It reports `code-conductor: installed the OpenCode context plugin at .opencode/plugin/conductor-context.js`.

## Known limits

- **No turn reset on compaction.** OpenCode compaction does not run `post-compact.sh`, so `context-guard.sh`'s counter is not reset there. It is reset by a new session id, as on Claude Code.
- **The part is not shown.** It is synthetic and goes only to the model.

## Acceptance

- **AC1:** with the shipped hooks, one message gains exactly one synthetic text part starting with `[VERBOSITY:MIN]`, with a `prt_` id of the shipped length and the message's ids.
- **AC2:** the hooks receive the payload on stdin, including the session id and the prompt text, and `CC_PROJECT_ROOT`. Their output is joined in order, each trimmed.
- **AC3:** a hook that exits non-zero is skipped. No hooks, or empty output, adds no part.
- **AC4:**
  - a session with a `parentID` gets no part;
  - a failed lookup or no `client` still gets the part.
- **AC5:** a throwing hook runner never throws out of `chat.message`.
- **AC6:**
  - the module exports only `ConductorContext`, which registers only `chat.message`;
  - the template ships only the two plugins plus the renders under `.opencode/`.
- **AC7:** `deployProject` with `opencode` installs and reports the context plugin; without `opencode` it doesn't.

## Docs

- **`README.md`, OpenCode section:** the "Verbosity and context hooks" row becomes "Installed", and the layout tree and option row are updated.
- **`.github/wiki/pages/Getting-Started.md`:** the `--opencode` row.
