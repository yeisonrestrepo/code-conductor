# FEAT-048 slice 5: context injection on Codex CLI

**Status:** Approved 2026-11-27 (the user asked to continue with the next #97 slice and ran the live probe)
**Item:** `[FEAT-048]` Multi-Harness Support, issue #97. Context injection is named as still open in the `[FEAT-063]` DONE line and in README's Codex table.
**Branch:** `feat/feat-048-context-injection`

## Problem

On Claude Code, two `UserPromptSubmit` hooks add context to every prompt: `verbosity-remind.sh` (the verbosity level line) and `context-guard.sh` (the turn counter that tells the model to run `/cc-compact`). `--project --codex` installs only the guard, so a Codex session gets neither.

## Measured on 2026-11-27 (Windows 11, live, scratchpad probe project)

| Fact | Codex CLI 0.171.0 / 0.172.0 |
|---|---|
| Event | `UserPromptSubmit` in `.codex/hooks.json` fires once per prompt, interactive and `codex exec`, after the hook is trusted in `/hooks`. Any edit to `hooks.json` drops the trust; `--dangerously-bypass-hook-trust` did not make an untrusted hook run |
| Payload | Claude's shape: `{"session_id", "turn_id", "transcript_path", "cwd", "hook_event_name":"UserPromptSubmit", ...}`; the hook's cwd is the project root |
| JSON reply | `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"…"}}` lands in the session as a `developer` message of kind `hooks.additional_context` |
| Plain text reply | `probe note: […]` and `⚠ CONTEXT WARNING: …` (context-guard's shape) land the same way |
| `verbosity-remind.sh`'s shape | `\n[VERBOSITY:MIN] …` fires but is **dropped**: interactive Codex shows `Hook failed: hook returned invalid user prompt submit JSON output`, since text that starts with `[` is read as JSON |
| `bash` on `PATH` | On this machine it is the WSL launcher (`WindowsApps\bash.exe`), which cannot run a Windows-native script path (`[BUG-062]`) |

**Antigravity CLI 1.5.15:** the binary has `UserPromptSubmit` hooks ("The following system message was injected by a UserPromptSubmit hook") behind `runsUserPromptSubmitHooks` / `agentPluginsSpec1Point1Enabled`; they did not fire in `agy -p` with either config shape. **OpenCode v1.19.6:** the plugin API has a `chat.message` hook with mutable `parts` (source only; OpenCode is not installed here). Both stay out of this slice.

## Variants considered

- **A. Point Codex at the two bash hooks directly:** the verbosity line is dropped (measured), and on Windows `bash` may be the WSL launcher. Rejected.
- **B. A Node adapter that runs both hooks and answers in JSON (chosen):** `.codex/hooks/conductor-context.mjs` runs `verbosity-remind.sh` and `context-guard.sh` from the project's `.claude/hooks/`, unchanged, with the Codex payload on stdin, joins their stdout, and prints the JSON reply. JSON is the one shape measured to land for every hook output. It reuses the `[BUG-094]` bootstrap, so Codex can start from a subdirectory.
- **C. Port the hooks to Node:** forks two hooks with their own tests and logging. Rejected.

## Solution

- `project-template/.codex/hooks/conductor-context.mjs`: the project root comes from the file's own location. For each of the two hooks that exists, it runs `bash .claude/hooks/<name>` with cwd at the root, the payload on stdin, `CC_PROJECT_ROOT` set (context-guard's own contract) and a timeout. On Windows it uses Git for Windows' `bash.exe` (found from `git --exec-path`, the rule `tests/helpers/bash-probe.js` uses) when present, else `bash`. It keeps the trimmed stdout of each hook that exited 0, joins them with a newline, and prints the JSON reply when the result is non-empty. **It fails open:** a missing hook, missing bash, a timeout or a non-zero exit adds nothing and never blocks the prompt, because these hooks are advisory and the Claude Code wiring (`exit 0` on every path) is fail-open too.
- `project-template/.codex/hooks.json` gains a `UserPromptSubmit` entry: the BUG-094 bootstrap with `conductor-context.mjs` as its target, printing nothing when it finds no adapter.
- `installCodexHook` also installs the adapter as a managed file and merges `hooks.json` with the fingerprints `conductor-guard.mjs` and `conductor-context.mjs`. The report line says the context hooks are installed.

## Behavior

- `--project --codex` installs both hook entries. Codex asks for trust again, because `hooks.json` changed; the installer line says so.
- Every Codex prompt then gets the verbosity line and, past the warning threshold, the context-guard line as developer context.
- Without `--codex` nothing under `.codex/` is written; a Claude Code install is unchanged byte for byte.

## Acceptance Criteria

- [ ] The adapter, given a Codex payload, runs both hooks and prints one JSON object whose `additionalContext` holds their output, the verbosity line included (tested with the shipped hooks in a temp project).
- [ ] It prints nothing when no hook gives output, when a hook is missing or exits non-zero, or when stdin is not JSON; it exits 0 on every path.
- [ ] `hooks.json` ships exactly one entry per fingerprint (`conductor-guard.mjs`, `conductor-context.mjs`), checked by the fingerprint coverage test; a re-run does not duplicate either, and host entries survive.
- [ ] `--project --codex` installs the adapter; without the flag nothing is written.
- [ ] Live: in a Codex session on the probe project, the verbosity line lands as `hooks.additional_context`.
- [ ] README's Codex section states what is injected and the trust step. Zero new runtime dependencies.

## Out of Scope

- Antigravity and OpenCode context injection (measured above; their own slices).
- Band agents on any harness.
- `PostCompact` (`post-compact.sh`): Codex lists a `PostCompact` event, but nothing is measured for it here.

## System Impact

- New `project-template/.codex/hooks/conductor-context.mjs`; `project-template/.codex/hooks.json`; `lib/installer/deploy.mjs` (`installCodexHook`, exported fingerprints).
- Tests: new `tests/hooks/codex-context.test.js`; `tests/installer/deploy.test.js`; the fingerprint coverage table in `tests/installer/templates.test.js`.
- README Codex section; wiki Getting-Started `--codex` row. `.gitignore`: leaf lines for this spec and its plan.

## Complexity Estimate

**S/M.** One adapter on an existing bootstrap pattern, one more hook entry and fingerprint, and a live check.
