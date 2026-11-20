# BUG-071: OpenCode guard evaluates bash commands without the tool's working directory

**Status:** Draft (pending independent review)
**Item:** BUG-071 (intake of issue #162; reported by the automated security review of the 1.44.0 release candidate, #157)
**Date:** 2026-11-20

## Problem

`project-template/.opencode/plugin/conductor-guard.js` maps OpenCode's `bash` call to the Claude Code `Bash` payload with `command` only:

```js
bash: (a, _d, t) => (typeof a.command === 'string' ? one('Bash', { command: a.command }) : badArg(t, 'command', 'a string')),
```

Every other argument of the call is dropped without a check. If OpenCode's `bash` tool runs the command in a directory named by an argument, the guard judges the command as if it ran in the project directory, while OpenCode runs it somewhere else.

What that costs, measured against `.claude/hooks/pre-tool-use.mjs`:

- **Guard 3 does not read `cwd` at all.** `guard3BashScan(input)` scans the command text, and its allowlist is read from `CLAUDE_PROJECT_DIR` (`g3ReadAllowlist`), never from the payload's `cwd`. So Guard 3's pattern verdicts do not change with the directory. What changes is what an allowlist entry covers. Entries are literal paths, usually relative to the project (`docs/notes.md`). An allowlisted `cat docs/notes.md` run with a working-directory argument of `/some/other/tree` reads `/some/other/tree/docs/notes.md`, a file the operator never allowlisted, and the guard lets it through.
- **Forwarding the directory as the payload's `cwd` would not fix this.** Because Guard 3 ignores `cwd`, a forwarded `cwd` leaves every Guard 3 verdict unchanged, allowlist included. The only consumers of a Bash payload's `cwd` are Guard 7's band lookup, which does not apply under OpenCode (the plugin blocks `task`, and OpenCode sends no `agent_type`), and the flow-event log path.
- **The argument's name is unverified.** OpenCode's `bash` schema has not been checked against a running OpenCode, and this spec is written without one. The plugin cannot rely on one name (`workdir`, `cwd`, `directory` or another).

The user who installed `--opencode` believes Guard 3's allowlist covers the paths they listed. Under a working-directory argument it covers paths in whatever directory the model chose.

## Solution

The plugin checks the arguments of a `bash` call against a closed set and blocks the call before the guard runs when it carries any argument outside that set. The set is the three arguments whose meaning the guard does not depend on: `command`, `description` and `timeout`. A working-directory argument, under any name, is outside the set, so the call is blocked with a reason that tells the model to drop it and to put any `cd` inside `command`, where Guard 3 sees it. A call with only known arguments maps to the same `Bash { command }` payload as today. The README's OpenCode table gains one row saying so.

### The choice this spec makes, and why

The entry offers two fix shapes: block a `bash` call that carries a working-directory argument, or forward it as the payload's `cwd` once the argument name is verified. This spec takes the first, in its name-agnostic form:

1. **Block, not forward.** Forwarding cannot be done safely today (the name is unverified), and it would not close the gap even with the right name, because Guard 3 does not read `cwd` (see Problem). Blocking closes it now.
2. **A closed set of known arguments, not a blocklist of directory names.** Blocking only `workdir` would miss the call if OpenCode names the argument `cwd` or `directory`, and the name is exactly what is unverified. A closed set needs no name. It is also the rule the plugin already applies to tools ("an unknown tool is never trusted", file header): an unknown argument of a mapped tool is not trusted either.
3. **The cost is accepted.** If OpenCode's `bash` does take a directory argument and a model passes it, that call is blocked and the model reruns it without the argument. If a future OpenCode adds another argument to `bash`, calls that carry it are blocked until the plugin names it. Both fail closed, with a reason that names the argument, which is the posture the hardening already chose for the plugin.

`description` and `timeout` stay allowed because neither changes what the command does or where: one labels the call, the other bounds its run time.

## Behavior

### Main path

1. OpenCode calls `tool.execute.before({ tool: 'bash', … }, { args })`.
2. The plugin checks `args.command` is a string, as today. Missing or not a string blocks with the existing `argument "command" is missing or not a string` reason.
3. The plugin lists the own keys of `args` whose value is not `undefined` and that are not `command`, `description` or `timeout`.
4. None: the plugin maps the call to `Bash { command }` and runs the guard as today. Guard 3's verdict is the call's verdict.

### Alternative paths

- **`args` with a working-directory argument** (for example `{ command: 'git status', workdir: '/tmp' }`): blocked before the guard runs, with the reason
  `code-conductor guard blocked "bash": argument "workdir" is not supported; the guard checks a command as if it runs in the project directory, so drop the argument and put any cd in the command, where the guard sees it`.
- **Several unknown arguments**: one block, the reason names every unknown key, sorted and comma-separated (`arguments "cwd", "workdir" are not supported; …`).
- **A known optional argument present** (`description`, `timeout`): the call proceeds; neither value reaches the payload, as today.
- **An unknown key whose value is `undefined`**: treated as absent, so an object built with optional keys left unset is not blocked.
- **A `cd` inside the command** (`cd /x && cat y`): unchanged. Guard 3 sees the whole command text, as on Claude Code.

### Error cases

- **`args` missing or not an object**: unchanged; the plugin uses `{}` and the `command` check blocks.
- **The guard cannot run**: unchanged; the existing fail-closed path applies only to calls that reach the guard. A call blocked for an unknown argument never spawns the guard.

## Acceptance Criteria

- [ ] AC1: a `bash` call with a working-directory argument (`workdir`, `cwd`, `directory` each tested) is blocked before the guard runs: the stub guard in `tests/hooks/opencode-guard.test.js` records no payload, the reason contains `"bash"` and the argument's name, and it does not match `code-conductor guard could not run`.
- [ ] AC2: a `bash` call with any other key outside `command`, `description`, `timeout` is blocked the same way, and a call with two unknown keys names both, sorted, in one reason.
- [ ] AC3: a `bash` call with `command`, `description` and `timeout` reaches the guard with exactly the payload `tool_input` `{ command }` (stub guard records one payload), and is allowed when the guard allows.
- [ ] AC4: an unknown key whose value is `undefined` does not block.
- [ ] AC5: the existing suite stays green unchanged, including the Guard 3 corpus through `bash` (its rows pass `description`) and the `bash without command` argument check.
- [ ] AC6: the README's OpenCode table (the `On OpenCode | Status` table under `### OpenCode`) gains a row stating that a `bash` call with an argument other than `command`, `description` or `timeout`, a working directory included, is blocked, because the guard checks commands as if they run in the project directory.
- [ ] AC7: the plugin still imports only `node:` builtins; `package.json` `dependencies` stays `{}`.

## Out of Scope

- **Forwarding a working directory as the payload's `cwd`.** Not useful while Guard 3 ignores `cwd`; revisit only with a verified OpenCode `bash` schema and a guard that reads `cwd`.
- **Making Guard 3's allowlist relative to the command's directory.** That is a change to the hook and the frozen Guard 3 authority (`tests/fixtures/guard3-reference.sh`), and it concerns Claude Code too (`cd x && cat y`).
- **Allowing a working-directory argument that resolves to the project directory.** It needs the verified argument name; a follow-up once a live OpenCode confirms the schema.
- **Unknown-argument checks for the other mapped tools** (`read`, `write`, `edit`, `multiedit`, patch). Their target is their path argument, which the guard already sees; no gap is reported for them. A second finding goes to its own issue (CONTRIBUTING, agent rule 4).
- **The README "Known limits" line for BUG-071** and every other record (`VERSION`, `CHANGELOG.md`, backlog, memory): written by the release.
- The hook `.claude/hooks/pre-tool-use.mjs` and its template copy: not changed.

## System Impact

- `project-template/.opencode/plugin/conductor-guard.js`: the `bash` entry of `MAPPED` gains the closed-set check (a small named helper plus the `BASH_ARGS` set), and the header comment's "Every tool is one of three kinds" paragraph gains one sentence on unknown arguments. Installed projects receive it on their next `--project --opencode`; the installer and its overwrite rules (BUG-069, BUG-087) are untouched.
- `tests/hooks/opencode-guard.test.js`: new cases for AC1 to AC4, using the existing `stubProject()` and `payloads()` helpers.
- `README.md`: one row in the OpenCode status table (AC6). Not the Known limits section.
- Installer tests that name the plugin (`tests/installer/cli.test.js`, `templates.test.js`, `deploy.test.js`) assert its path, its install and its overwrite messages, not its contents, so they need no edit; the plan confirms this by grep.
- `tools/skip-baseline.json`: no change expected; the new tests do not skip on any leg.

### Files Requiring Full Read (deferred to /cc-plan)

_None. The plugin (157 lines) and the relevant part of the hook (`guard3BashScan`, `g3ReadAllowlist`, `payloadCwd` users) were read for this spec; the plan reads `tests/installer/templates.test.js` and `tests/installer/deploy.test.js` around their plugin assertions._

## Complexity Estimate

S: one mapping entry in one adapter file, a handful of tests and one README row, with no change to the guard, the installer or any protected script.
