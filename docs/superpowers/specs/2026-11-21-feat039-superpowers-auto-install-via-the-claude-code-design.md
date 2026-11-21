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
4. With consent, it runs `claude plugin install superpowers@claude-plugins-official` through `spawnSync`, with `stdio: ['ignore', 'pipe', 'pipe']`, `timeout: 60000` and `windowsHide: true`. On `win32` it runs with `shell: true`, so an npm-installed `claude.cmd` resolves. The argument list is fixed literals and no user input reaches the shell.
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
| No `claude` binary on PATH | `spawnSync` error `ENOENT`, or on `win32` the shell's "not recognized" exit with no plugin output | `claude CLI not found on PATH` |
| Older Claude Code with no `plugin` subcommand | non-zero exit (for example `error: unknown command 'plugin'`) with no `already installed` | `claude plugin install failed (exit N)` |
| Network failure, marketplace unreachable | non-zero exit | `claude plugin install failed (exit N)` |
| Marketplace schema error, plugin not found | non-zero exit | `claude plugin install failed (exit N)` |
| Hang or slow network | `spawnSync` error `ETIMEDOUT` or a `SIGTERM` kill after 60 s | `timed out after 60s` |
| The prompt's `readSync` throws (`EAGAIN`, `EOF`, closed TTY) | caught | `declined` |
| Any other throw inside the step | caught at the step boundary | `unexpected error: <message>` |

Choices behind the table:

- **One generic non-zero reason.** The CLI's error text for an old version, a network failure and a schema error is not ours and changes between Claude Code releases. Parsing it apart would be fragile, and the user's next action is the same in every case. The line includes the exit code. The first line of the CLI's stderr, cut to 200 characters, follows as a second stderr line only when it is non-empty, so a user can still see why. Choice: the entry asks for "one visible line printing the manual command". That line is the one-line contract. The diagnostic tail is optional context and is never the only output.
- **60 s timeout, not 5 s.** The `curl --max-time 5` precedent sets the rule (every network call is bounded) and not the number. That curl reads one small file. A plugin install clones a repository, and 5 s would fail most real installs. 60 s bounds a hang while leaving room for a normal install.
- **No stdin to the child.** With `stdin: 'ignore'` the CLI cannot open a prompt the user would never see behind the installer. This is the entry's "never runs detached input prompts".
- **The `already installed` check runs before the failure classification**, so a CLI that reports an existing install with a non-zero exit is still a success.

The fail-open shape follows `scripts/conductor-db.mjs:7`: a missing capability warns and exits 0, and it never fails the caller.

## Acceptance Criteria

- [ ] `lib/installer/plugins.mjs` exports `SUPERPOWERS_PLUGIN === 'superpowers@claude-plugins-official'`. A test asserts that literal value, and the spawned argv, every printed manual command and the pre-check key are all built from that constant (a test asserts each one contains it).
- [ ] No `claude` on PATH: the installer exits 0, prints the one fallback line with the manual command, and the deployed files are identical to a run without the step.
- [ ] A stub `claude` that exits non-zero with `error: unknown command 'plugin'` gives exit 0 and the fallback line.
- [ ] A stub `claude` that exits non-zero with a network or schema error message gives exit 0 and the fallback line with the exit code.
- [ ] A stub `claude` that sleeps past the timeout gives exit 0 and the `timed out` line. The test injects a short timeout so it runs in well under the suite's per-test limit.
- [ ] The child is spawned with stdin `'ignore'` (asserted on the injected spawn's options) and with the timeout set.
- [ ] A registry file listing `superpowers@claude-plugins-official` gives `already installed`, no prompt and no spawn. A stub exiting non-zero with `already installed` gives success, not the fallback line.
- [ ] Two consecutive installer runs against the same temp home, with a stub that records the install into the registry file, give the same files. The second run spawns nothing and asks nothing.
- [ ] Interactive: with consent `y` the step spawns. With `n`, an empty line or a read error it does not spawn and prints the `declined` fallback line. With `--with-plugins` it does not ask.
- [ ] Non-interactive without `--with-plugins`: nothing is spawned and the fallback line names `--with-plugins`. With `--with-plugins`: the step spawns with no prompt.
- [ ] `USAGE` and the README flags table list `--with-plugins`. The README dependencies row for superpowers says the installer offers it (with consent, or `--with-plugins` when non-interactive) and keeps the manual `/plugin install superpowers@claude-plugins-official` line as the fallback.
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

- `bin/code-conductor.mjs`: `parseArgs` gains `withPlugins` (`--with-plugins`, matched exact-case like every other flag, last-wins being a no-op for a boolean). `USAGE` gains the flag. `run()` calls `offerSuperpowers` after `deployProject` and before `return 0`, inside its own try so the deploy's exit classes (`0`/`1`/`2`, lines 96–142) are untouched. `run()`'s third parameter gains injectable `isInteractive`, `ask`, `spawn` and `pluginTimeoutMs` for tests. Their defaults are `process.stdin.isTTY && process.stdout.isTTY`, a `readSync(0)` line reader, `child_process.spawnSync` and `60000`. `run()` stays synchronous. Choice: a synchronous `readSync` prompt keeps `run()`'s sync contract, which every existing CLI test and the `process.exit(run(...))` entry rely on. Making `run()` async would ripple through every test for one prompt.
- `lib/installer/plugins.mjs` (new): the constant, the pre-check, the consent decision, the spawn, and the outcome classifier returning `{ status: 'installed'|'already'|'skipped'|'failed', lines }`. `bin` emits the lines, the same split `healGraphifyHook` uses (`bin/code-conductor.mjs:118-121`).
- `tests/installer/plugins.test.js` (new): unit tests over the classifier and consent with an injected spawn. It also has CLI-level tests with a stub `claude` written into a temp dir that becomes the whole PATH. The stub is a Node script, made executable on POSIX, plus a `claude.cmd` wrapper (`@node "%~dp0claude.mjs" %*`) on Windows. This follows the fake-binary precedent (`tests/hooks/guard4.test.js:114`, PATH set to a fake bin) and stays cross-platform, unlike the POSIX-only fake that `[BUG-059]` replaced.
- `tests/installer/cli.test.js`: existing assertions on exact stderr or stdout for a full `run()` must account for the new fallback line. Assertions on `USAGE` gain the flag. The full list is for `/cc-plan` to find by grep.
- `README.md`: the dependencies row (line 85) and the flags table (around line 389). `.github/wiki/pages/Getting-Started.md` names the manual step and gets the same wording. The plan confirms its lines by grep.
- Network and security: the installer now starts one subprocess that downloads and installs third-party code. It happens only after explicit consent, it is bounded by the timeout, and it never runs in the test suite. No new dependency.
- Assumption to verify in `/cc-plan`: the registry path and shape (`~/.claude/plugins/installed_plugins.json`, an object `plugins` keyed `name@marketplace`) are Claude Code's, not ours. If they drift, the pre-check misses and the step falls back to the offer plus the `already installed` classification. That costs one extra prompt and never a failure, so the pre-check is an optimization the step does not depend on.

### Files Requiring Full Read (deferred to /cc-plan)

- `bin/code-conductor.mjs`: read here through its first 30 lines plus targeted greps. The plan needs the full `run()` body (lines 70–143) to place the step and the injected parameters.
- `tests/installer/cli.test.js`: which assertions pin exact output or `USAGE`.
- `lib/installer/heal.mjs`: the `{ status, lines }` return shape that `plugins.mjs` mirrors.

## Complexity Estimate

M: one new module of about 80 lines and a small CLI change, but it needs a cross-platform stub binary, an injectable prompt and spawn, and adjustments to existing CLI output assertions.
