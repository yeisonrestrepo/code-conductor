# FEAT-039: Superpowers auto-install via the Claude Code plugin CLI

**Status:** Draft (pending independent review)

**Item:** `[FEAT-039]` (issue #148). This spec answers the item's backlog entry; where the entry leaves a choice open, the choice and its reason are named in place.

**Approval:** this change makes the installer start a subprocess that fetches and installs third-party code over the network. That is installer network and security posture, so the spec and the plan need an owner approval, not a delegated one.

## Problem

Six commands depend on the superpowers plugin: `/cc-spec` (`brainstorming`), `/cc-plan` (`writing-plans`), and `/cc-debug`, `/cc-refactor`, `/cc-review`, `/cc-test` (`subagent-driven-development`). The installer does not install it. The only instruction is the README dependencies row (`README.md:85`), which tells the user to install it by hand from Claude Code's `/plugin` marketplace. A user who skips or misses that row first finds out when a `Skill(...)` call fails inside one of those commands. It is the worst first-run failure the project has, and the last manual dependency step.

## Solution

A new module, `lib/installer/plugins.mjs`, exports the plugin spec string as one constant, `SUPERPOWERS_PLUGIN = 'superpowers@claude-plugins-official'`, and one function, `offerSuperpowers(...)`. It runs as the last setup step of `code-conductor`, after the global hook merges and the optional project deploy. The function decides whether it has consent, runs `claude plugin install superpowers@claude-plugins-official` with a timeout and no stdin, and classifies the outcome. Every outcome other than success or already-installed becomes one visible line that prints the manual command `/plugin install superpowers@claude-plugins-official`. The step never throws and never changes the installer's exit code. Consent follows the `[FEAT-037]` rule that third-party code is offered and never silently run: an interactive TTY run asks first (default No), and a non-interactive run installs only when the new `--with-plugins` flag is passed. `claude-plugins-official` is the official Anthropic-managed marketplace, which Claude Code already knows, so no marketplace registration step is needed.

## Behavior

### Main path

1. The user runs `code-conductor` (with or without `--project`) in a terminal. The global deploy, the verbosity merge, the graphify heal and, with `--project`, the project deploy all complete as today.
2. The plugin step runs. It first runs a **local pre-check**: it reads `<home>/.claude/plugins/installed_plugins.json`, the registry where Claude Code records installed plugins. If the file parses and its `plugins` object has the key `superpowers@claude-plugins-official`, the step prints `code-conductor: superpowers plugin already installed` to stdout and ends. Nothing is spawned or asked.
3. If superpowers is not known to be installed and stdin and stdout are both TTYs, the step asks on stdout: `Install the superpowers plugin (third-party code, from the claude-plugins-official marketplace) with 'claude plugin install superpowers@claude-plugins-official'? [y/N] `. It reads one line synchronously from stdin. Only `y` or `yes` (case-insensitive, trimmed) is consent.
4. With consent, it runs `claude plugin install superpowers@claude-plugins-official` through `spawnSync`, with `timeout: 60000`, `windowsHide: true`, and stdin `'ignore'`. The child's stdout and stderr go to two files in a fresh `mkdtempSync` directory under `os.tmpdir()`, passed as file descriptors (`stdio: ['ignore', outFd, errFd]`), not to pipes. The step reads both files after `spawnSync` returns and removes the directory in a `finally`. On POSIX the call is `spawnSync('claude', ['plugin', 'install', SUPERPOWERS_PLUGIN], …)` with no shell. On `win32` it is ``spawnSync(`claude plugin install ${SUPERPOWERS_PLUGIN}`, { shell: true, … })``: one command string and no args array, so an npm-installed `claude.cmd` resolves and Node's DEP0190 warning (args passed together with `shell: true`) does not fire. The command string is built only from fixed literals and the constant; no user input reaches the shell.
5. Exit status 0 prints `code-conductor: installed the superpowers plugin; run /reload-plugins in any open Claude Code session` to stdout. The installer exits 0.

### Alternative paths

- **Non-interactive, `--with-plugins` given** (CI, scripts, piped stdin): the flag is the consent. No prompt; steps 4 and 5 run.
- **Interactive, `--with-plugins` given:** the flag is already consent, so the prompt is skipped.
- **Non-interactive, no flag:** nothing is spawned. One stderr line: `code-conductor: superpowers plugin not installed (non-interactive run; pass --with-plugins to install it); install it inside Claude Code: /plugin install superpowers@claude-plugins-official`.
- **Interactive, the user answers anything but yes** (including an empty line or EOF): nothing is spawned. One stderr line, with the reason `declined`.
- **Already installed, the pre-check misses it** (registry file absent, unreadable, or in a schema this release does not know): the step goes on to ask or install. If `claude plugin install` exits non-zero and its combined output matches `/already installed/i`, the step reports it as already installed (stdout, step 2's line) and the result counts as success.
- **Idempotence:** a second consecutive run finds the plugin through the pre-check (or the already-installed classification) and changes nothing. Two runs leave the same end state, and the second never asks again.
- **`--no-deps`** stays the compatibility no-op it is today and does not affect this step. `--with-plugins` alone controls non-interactive consent. Choice: reusing `--no-deps` as an opt-out would give a retired flag a new meaning. Under the consent rule, a run without `--with-plugins` already installs nothing unless the user answers yes, so there is nothing to opt out of.

### Error cases

Each case prints exactly one stderr line, `code-conductor: superpowers plugin not installed (<reason>); install it inside Claude Code: /plugin install superpowers@claude-plugins-official`. Nothing else changes, and the installer's exit code is whatever the deploy produced (0 on a successful deploy):

| Condition | How it is detected | `<reason>` |
|---|---|---|
| No `claude` binary on PATH | `spawnSync` error `ENOENT`, or on `win32` the shell's "not recognized" exit (status 9009, or stderr matching `/is not recognized/i`) | `claude CLI not found on PATH` |
| Older Claude Code with no `plugin` subcommand | non-zero exit (for example `error: unknown command 'plugin'`) with no `already installed` | `claude plugin install failed (exit N)` |
| Network failure, marketplace unreachable | non-zero exit | `claude plugin install failed (exit N)` |
| Marketplace schema error, plugin not found | non-zero exit | `claude plugin install failed (exit N)` |
| Hang or slow network | `spawnSync` error `ETIMEDOUT` or a `SIGTERM` kill after the timeout | `timed out after <T>` |
| The prompt's `readSync` throws (`EAGAIN`, `EOF`, closed TTY) | caught | `declined` |
| Any other throw inside the step | caught at the step boundary | `unexpected error: <message>` |

Choices behind the table:

- **One generic non-zero reason.** The CLI's error text for an old version, a network failure and a schema error is not ours and changes between Claude Code releases. Parsing it apart would be fragile, and the user's next action is the same in every case. The line includes the exit code. The first line of the CLI's stderr, cut to 200 characters, follows as a second stderr line only when it is non-empty, so a user can still see why. Choice: the entry asks for "one visible line printing the manual command". That line is the one-line contract. The diagnostic tail is optional context and is never the only output.
- **60 s timeout, not 5 s.** The `curl --max-time 5` precedent sets the rule (every network call is bounded) and not the number. That curl reads one small file. A plugin install clones a repository, and 5 s would fail most real installs. 60 s bounds a hang while leaving room for a normal install.
- **`<T>` comes from the effective timeout**, not a literal: whole seconds when the value is a multiple of 1000 (`60s` for the default), otherwise milliseconds (`300ms` for a test's injected value). A test with a short injected timeout then prints its own value, not `60s`.
- **Files, not pipes, for the child's output.** `spawnSync` returns only when the child has exited and every pipe it handed out is closed. On timeout it kills the direct child, but a grandchild that inherited the pipes keeps them open: on `win32` the direct child is `cmd.exe` and `claude` is its grandchild, and on any platform the CLI may start its own child (for example a `git clone`). With pipes, such a grandchild would hold `spawnSync` past the timeout. With file descriptors there is no pipe to wait on, so `spawnSync` returns as soon as the direct child is killed, on every platform. A grandchild that outlives the kill may finish on its own; the step does not wait on it, and the next run's pre-check sees whatever it left. The test with the sleeping stub (below) checks this bound on the Windows leg, where the stub really is a grandchild of `cmd.exe`.
- **No stdin to the child.** With `stdin: 'ignore'` the CLI cannot open a prompt the user would never see behind the installer. This is the entry's "never runs detached input prompts".
- **The `already installed` check runs before the failure classification**, so a CLI that reports an existing install with a non-zero exit is still a success.

The fail-open shape follows `scripts/conductor-db.mjs:7`: a missing capability warns and exits 0, and it never fails the caller.

## Acceptance Criteria

- [ ] `lib/installer/plugins.mjs` exports `SUPERPOWERS_PLUGIN === 'superpowers@claude-plugins-official'`. A test asserts that literal value, and the spawned argv, every printed manual command and the pre-check key are all built from that constant (a test asserts each one contains it).
- [ ] No `claude` on PATH: the installer exits 0, prints the one fallback line with the manual command, and the deployed files are identical to a run without the step.
- [ ] A stub `claude` that exits non-zero with `error: unknown command 'plugin'` gives exit 0 and the fallback line.
- [ ] A stub `claude` that exits non-zero with a network or schema error message gives exit 0 and the fallback line with the exit code.
- [ ] A stub `claude` that sleeps past the timeout gives exit 0 and the `timed out after 300ms` line (the reason carries the injected value). The test injects a 300 ms timeout against a stub that sleeps 5 s and asserts `run()` returned in under 3 s, so the bound is checked on every leg, Windows included, where the stub runs as a grandchild of `cmd.exe`. It stays well under the suite's 30 s per-test limit (`vitest.config.js:10`).
- [ ] The child is spawned with stdin `'ignore'`, stdout and stderr as file descriptors (not `'pipe'`), and the timeout set (asserted on the injected spawn's options). On `win32` the injected spawn receives one command string and no args array.
- [ ] A registry file listing `superpowers@claude-plugins-official` gives `already installed`, no prompt and no spawn. A stub exiting non-zero with `already installed` gives success, not the fallback line.
- [ ] Two consecutive installer runs against the same temp home, with a stub that records the install into the registry file, give the same files. The second run spawns nothing and asks nothing.
- [ ] Interactive: with consent `y` the step spawns. With `n`, an empty line or a read error it does not spawn and prints the `declined` fallback line. With `--with-plugins` it does not ask.
- [ ] Non-interactive without `--with-plugins`: nothing is spawned and the fallback line names `--with-plugins`. With `--with-plugins`: the step spawns with no prompt.
- [ ] `USAGE` and the README flags table list `--with-plugins`, and the README `--no-deps` row no longer says the CLI "installs no dependencies". The README dependencies row for superpowers says the installer offers it (with consent, or `--with-plugins` when non-interactive) and keeps the manual `/plugin install superpowers@claude-plugins-official` line as the fallback.
- [ ] No test spawns a real `claude` or touches the network. Existing `run()` tests stay green: they run non-interactive without the flag, so the step only adds one stderr line, which tests asserting exact output account for.
- [ ] `package.json` `dependencies` stays `{}`. No skip is added to `tools/skip-baseline.json` on any leg, and the stub works on Windows as well as POSIX.

## Out of Scope

- Records: `CHANGELOG.md`, `VERSION`, the backlog entry and its DONE line, `.claude/memory/**`, the README "Known limits" lines. The release writes them, including the CHANGELOG line the entry's Components list names.
- Any other plugin or skill, including the `[FEAT-037]` `npx skills` stack. The function and the flag cover superpowers alone. `--with-plugins` is plural so that a later item can extend it without renaming the flag.
- Uninstalling, updating or pinning superpowers to a revision. `claude plugin install` decides what it fetches.
- Marketplace registration. `claude-plugins-official` is built in.
- Running `/reload-plugins` for the user. An open session has to do that; the success line says so.
- The OpenCode track. OpenCode does not load Claude Code plugins.
- Recording the consent answer for later runs. The pre-check already makes a second run silent once the plugin is installed. A declined answer is asked again on the next run, which is the consent rule working.

## System Impact

- `bin/code-conductor.mjs`: `parseArgs` gains `withPlugins` (`--with-plugins`, matched exact-case like every other flag, last-wins being a no-op for a boolean). `USAGE` gains the flag. `run()` calls `offerSuperpowers` after `deployProject` and before `return 0`, inside its own try so the deploy's exit classes (`0`/`1`/`2`, lines 96–142) are untouched. `run()`'s third parameter gains injectable `isInteractive`, `ask`, `spawn`, `pluginTimeoutMs` and `pluginEnv` for tests. Their defaults are `process.stdin.isTTY && process.stdout.isTTY`, a `readSync(0)` line reader, `child_process.spawnSync`, `60000` and `process.env`. `pluginEnv` is the `env` the child gets, so a CLI test controls the child's PATH without touching the test process's own. `run()` stays synchronous. Choice: a synchronous `readSync` prompt keeps `run()`'s sync contract, which every existing CLI test and the `process.exit(run(...))` entry rely on. Making `run()` async would ripple through every test for one prompt.
- `lib/installer/plugins.mjs` (new): the constant, the pre-check, the consent decision, the spawn, and the outcome classifier returning `{ status: 'installed'|'already'|'skipped'|'failed', lines }`. `bin` emits the lines, the same split `healGraphifyHook` uses (`bin/code-conductor.mjs:118-121`).
- `tests/installer/plugins.test.js` (new): unit tests over the classifier and consent with an injected spawn. It also has CLI-level tests with a stub `claude` in a temp dir:
  - **Stub body.** `claude.mjs`, a Node script that does what the case needs (print an error and exit non-zero, sleep, or write the registry entry into the temp home). Every path it uses is written into it as an absolute literal, so it needs no PATH lookup of its own.
  - **Launcher, interpreter by absolute path.** The launcher never looks `node` up on PATH. On POSIX it is an executable `claude` shell script, `#!/bin/sh` then `exec "<process.execPath>" "<stubDir>/claude.mjs" "$@"`. `/bin/sh` is absolute, and the script avoids `dirname` and every other PATH-resolved command. On Windows it is `claude.cmd`, `@"<process.execPath>" "%~dp0claude.mjs" %*`. `process.execPath` is the Node running the suite, quoted, so a path with spaces works.
  - **Child env.** `pluginEnv` is a copy of `process.env` with every key matching `/^path$/i` deleted (Windows env keys are case-insensitive, and the copy carries `Path`) and `PATH` set to the stub dir alone. Everything else is kept, so Windows still has `ComSpec`, `SystemRoot` and `PATHEXT`. Node's `shell: true` takes `cmd.exe` from the parent's `ComSpec`, not from PATH. The stub dir as the whole PATH (rather than prepended) means no test can reach a real `claude` installed on the machine running the suite.
  - **"No `claude` on PATH".** The same env with an empty temp dir as the whole PATH. On POSIX `spawnSync` gets `ENOENT`. On `win32` `cmd.exe` still starts (absolute `ComSpec`) and reports `claude` as not recognized, which is the other detection in the table. One fixture covers both legs, with no skip.
  - **Precedent and difference.** The fake-bin idea follows `tests/hooks/guard4.test.js:114`. That test is `skipIf(WIN32)` because it replaces PATH and then needs PATH to find its interpreter (line 110). This stub avoids both problems: its interpreter is absolute and `cmd.exe` comes from `ComSpec`. It stays cross-platform, unlike the POSIX-only fake that `[BUG-059]` replaced. Temp dirs are removed with `rmSync(..., { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })`, so a Windows orphan from the sleeping stub that briefly holds a file does not fail cleanup.
- `tests/installer/cli.test.js`: existing assertions on exact stderr or stdout for a full `run()` must account for the new fallback line. Assertions on `USAGE` gain the flag. The full list is for `/cc-plan` to find by grep.
- `README.md`: the dependencies row (line 85) and the flags table (around line 389). The flags table gains a `--with-plugins` row, and the `--no-deps` row (`README.md:389`) loses its justification "since the npm CLI installs no dependencies", which this change makes inaccurate. The row then reads as a compatibility no-op that copies agent files only and does not affect the plugin offer. `.github/wiki/pages/Getting-Started.md` names the manual step and gets the same wording. The plan confirms its lines by grep.
- Network and security: the installer now starts one subprocess that downloads and installs third-party code. It happens only after explicit consent, it is bounded by the timeout, and it never runs in the test suite. No new dependency.
- Risk, Windows timeout: the bound rests on file-descriptor stdio (Error cases, "Files, not pipes"). If the Windows leg shows `spawnSync` still waiting past the timeout, the plan stops and reports it rather than skipping the test.
- Assumption to verify in `/cc-plan`: the registry path and shape (`~/.claude/plugins/installed_plugins.json`, an object `plugins` keyed `name@marketplace`) are Claude Code's, not ours. If they drift, the pre-check misses and the step falls back to the offer plus the `already installed` classification. That costs one extra prompt and never a failure, so the pre-check is an optimization the step does not depend on.

### Files Requiring Full Read (deferred to /cc-plan)

- `bin/code-conductor.mjs`: read here through its first 30 lines plus targeted greps. The plan needs the full `run()` body (lines 70–143) to place the step and the injected parameters.
- `tests/installer/cli.test.js`: which assertions pin exact output or `USAGE`.
- `lib/installer/heal.mjs`: the `{ status, lines }` return shape that `plugins.mjs` mirrors.

## Complexity Estimate

M: one new module of about 80 lines and a small CLI change, but it needs a cross-platform stub binary, an injectable prompt and spawn, and adjustments to existing CLI output assertions.
