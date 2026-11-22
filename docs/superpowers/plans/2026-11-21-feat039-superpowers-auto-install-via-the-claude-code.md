# FEAT-039 Superpowers auto-install via the Claude Code plugin CLI: implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** the installer's last setup step offers the superpowers plugin. It runs `claude plugin install superpowers@claude-plugins-official` only with consent (a default-No prompt on a TTY run, or `--with-plugins`), bounded by a 60 s timeout, with no stdin and file-descriptor stdio. Every outcome other than installed or already installed becomes one stderr line that prints `/plugin install superpowers@claude-plugins-official`, and the step never changes the exit code. The README and the wiki Getting-Started page say so.

**Spec:** `docs/superpowers/specs/2026-11-21-feat039-superpowers-auto-install-via-the-claude-code-design.md` (sha256 `7a8192bb27f799ccdb5d42f5d57adb6cbe450c0f07f4c8c0feb5a47f921d7e0a`). Issue #148.

**Approval:** this plan sets how the installer starts a subprocess that fetches third-party code over the network (installer network and security posture). The spec and the plan need an owner approval, not a delegated one.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md` (the entry's Components list names it; the release writes that line), `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines stay untouched.
- **Six files change, plus this plan and its `.gitignore` leaf:** `lib/installer/plugins.mjs` (new), `tests/installer/plugins.test.js` (new), `bin/code-conductor.mjs`, `tests/installer/cli.test.js`, `README.md`, `.github/wiki/pages/Getting-Started.md`. That is the spec's System Impact list.
- Not touched: `package.json` (`dependencies` stays `{}`, no devDependency), `tools/skip-baseline.json` (no new skip on any leg), `.github/workflows/`, `.github/actions/`, the hooks, `scripts/`, `lib/installer/deploy.mjs` and every other installer module, `tests/installer/smoke.test.js` (plan decision 7), the spec.
- Staging forms: `lib/installer/plugins.mjs` and `tests/installer/plugins.test.js` are new and neither `lib/` nor `tests/` is ignored (`git check-ignore` prints nothing for either path), so plain `git add <path>`. The other four files are tracked: `git add -u <path>`. This plan is new in Task 0 under the ignored `docs/superpowers/plans/` (so `git add -f`) and tracked afterwards (so `git add -u`).
- The step must not run the installer on this repository (CONTRIBUTING): every check goes through tests in temp directories.

## Files read in full (spec, Files Requiring Full Read)

- `bin/code-conductor.mjs` (158 lines): `USAGE` `:11`; `parseArgs` `:25-63`, the `--no-deps` branch and its comment `:32-35`; `run(argv, env, { cwd, log, nodeVersion })` `:70`; the try `:108-124`, where `deployProject` is `:123` and `return 0` is `:124`; the exit classes `:125-143`. `healGraphifyHook`'s call site `:118-121` is the `{ status, lines }` split this step mirrors.
- `lib/installer/heal.mjs` (98 lines): `healGraphifyHook` `:87-98` returns `{ status, lines }`, catches everything, and `bin` emits a fixed stdout line for one status and each of `lines` on stderr with the `code-conductor: ` prefix.
- `tests/installer/cli.test.js` (425 lines): imports `run` at `:6`; `log` pushes `` `${stream}:${msg}` `` (`:9`); `beforeEach`/`afterEach` `:11-16`. 71 `run(` calls: 68 pass exactly `{ cwd, log }`, `:104` and `:115` add `nodeVersion`, `:282` passes `{ cwd: spaced, log }`. The only assertion the new non-interactive stderr line breaks is `:234` (`expect(logs.some(l => l.startsWith('stderr:'))).toBe(false)`); `:135` counts stdout lines only, and the skipped step writes nothing to stdout. `USAGE` is checked by `includes` only (`:188`, `:212`, `:267`, `:342`), so a new `[--with-plugins]` token breaks none of them.

## Plan decisions

1. **Registry assumption (spec, System Impact).** A local Claude Code 2.1.319 with no user-installed plugin has no `~/.claude/plugins/installed_plugins.json`, so the shape (`plugins` keyed `name@marketplace`) could not be confirmed against a populated file here. The spec makes the pre-check an optimization: a miss costs one prompt and the `already installed` classification still makes it a success. The pre-check therefore reads only that path, accepts any `plugins` object that has the key, and treats every read or parse failure as a miss. The same CLI's `claude plugin install --help` confirms the `plugin install <plugin>` form with `plugin@marketplace`.

2. **The module, verbatim.** `lib/installer/plugins.mjs`:

   ```js
   import { spawnSync } from 'node:child_process';
   import { closeSync, mkdtempSync, openSync, readFileSync, readSync, rmSync } from 'node:fs';
   import { tmpdir } from 'node:os';
   import { join } from 'node:path';

   // FEAT-039: the one place the plugin spec lives. Every command string, prompt and
   // registry key below is built from it, so a marketplace rename is a one-line change
   // that tests/installer/plugins.test.js pins.
   export const SUPERPOWERS_PLUGIN = 'superpowers@claude-plugins-official';
   export const MANUAL_COMMAND = `/plugin install ${SUPERPOWERS_PLUGIN}`;
   export const DEFAULT_TIMEOUT_MS = 60000;
   const MARKETPLACE = SUPERPOWERS_PLUGIN.slice(SUPERPOWERS_PLUGIN.indexOf('@') + 1);
   export const CONSENT_PROMPT = `Install the superpowers plugin (third-party code, from the ${MARKETPLACE} marketplace) with 'claude plugin install ${SUPERPOWERS_PLUGIN}'? [y/N] `;
   export const NOTICES = {
     installed: 'installed the superpowers plugin; run /reload-plugins in any open Claude Code session',
     already: 'superpowers plugin already installed',
   };

   export const fallbackLine = (reason) => `superpowers plugin not installed (${reason}); install it inside Claude Code: ${MANUAL_COMMAND}`;
   export const formatTimeout = (ms) => (ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`);

   // Claude Code's registry, not ours: a miss only costs the offer, never a failure.
   export function isRegistered(home) {
     try {
       const registry = JSON.parse(readFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8'));
       const plugins = registry?.plugins;
       return typeof plugins === 'object' && plugins !== null && Object.hasOwn(plugins, SUPERPOWERS_PLUGIN);
     } catch { return false; }
   }

   // Synchronous so run() keeps its sync contract; one byte at a time so nothing past the
   // answer is consumed. EOF ends the line, so a closed stdin reads as a declined answer.
   export function readLine(fd = 0, read = readSync) {
     const byte = Buffer.alloc(1);
     let line = '';
     while (line.length < 256 && read(fd, byte, 0, 1, null) === 1) {
       const ch = byte.toString('latin1');
       if (ch === '\n') break;
       line += ch;
     }
     return line;
   }

   const askOnTerminal = (question) => { process.stdout.write(question); return readLine(); };

   // FEAT-037 consent rule: third-party code is offered, never silently run.
   function refusalReason({ withPlugins, isInteractive, ask }) {
     if (withPlugins) return null;
     if (!isInteractive) return 'non-interactive run; pass --with-plugins to install it';
     let answer;
     try { answer = ask(CONSENT_PROMPT); } catch { return 'declined'; }
     return /^(y|yes)$/i.test(String(answer ?? '').trim()) ? null : 'declined';
   }

   function removeQuietly(rm, dir) {
     // Best-effort: on win32 an orphaned grandchild can still hold the files (EBUSY), and the
     // outcome is already fixed, so a cleanup error must never become the reported reason.
     try { rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* leftover tmp dir is harmless */ }
   }

   // Files, not pipes: a grandchild that inherited a pipe (cmd.exe's claude, or a git clone)
   // would hold spawnSync past the timeout; with file descriptors there is nothing to wait on.
   function spawnInstall({ spawn, timeoutMs, env, platform, rm }) {
     const dir = mkdtempSync(join(tmpdir(), 'cc-plugin-'));
     const outPath = join(dir, 'out');
     const errPath = join(dir, 'err');
     const fds = [];
     try {
       fds.push(openSync(outPath, 'w'), openSync(errPath, 'w'));
       const options = { stdio: ['ignore', fds[0], fds[1]], timeout: timeoutMs, windowsHide: true, env };
       // win32: one string and no args array, so claude.cmd resolves and DEP0190 does not fire.
       // The string holds only literals and the constant; no user input reaches the shell.
       const result = platform === 'win32'
         ? spawn(`claude plugin install ${SUPERPOWERS_PLUGIN}`, { ...options, shell: true })
         : spawn('claude', ['plugin', 'install', SUPERPOWERS_PLUGIN], options);
       return { ...result, stdoutText: readFileSync(outPath, 'utf8'), stderrText: readFileSync(errPath, 'utf8') };
     } finally {
       for (const fd of fds) closeSync(fd);
       removeQuietly(rm, dir);
     }
   }

   const failed = (reason, diagnostic = '') => ({
     status: 'failed',
     lines: diagnostic ? [fallbackLine(reason), `claude plugin install said: ${diagnostic}`] : [fallbackLine(reason)],
   });

   function notFound(result, platform) {
     if (result.error?.code === 'ENOENT') return true;
     return platform === 'win32' && (result.status === 9009 || /is not recognized/i.test(result.stderrText));
   }

   // The CLI's error text is not ours and changes between releases, so every other
   // non-zero exit is one generic reason plus the first stderr line as context.
   export function classifyInstall(result, { timeoutMs, platform }) {
     if (notFound(result, platform)) return failed('claude CLI not found on PATH');
     if (result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM') return failed(`timed out after ${formatTimeout(timeoutMs)}`);
     if (result.error) return failed(`unexpected error: ${result.error.message}`);
     if (result.status === 0) return { status: 'installed', lines: [] };
     if (/already installed/i.test(`${result.stdoutText}\n${result.stderrText}`)) return { status: 'already', lines: [] };
     const firstLine = result.stderrText.split(/\r?\n/, 1)[0].trim().slice(0, 200);
     return failed(`claude plugin install failed (exit ${result.status})`, firstLine);
   }

   // Never throws: like healGraphifyHook, every outcome is a status plus lines for bin to emit.
   export function offerSuperpowers({ home, withPlugins = false, isInteractive = false, ask = askOnTerminal, spawn = spawnSync, timeoutMs = DEFAULT_TIMEOUT_MS, env = process.env, platform = process.platform, rm = rmSync } = {}) {
     try {
       if (isRegistered(home)) return { status: 'already', lines: [] };
       const reason = refusalReason({ withPlugins, isInteractive, ask });
       if (reason) return { status: 'skipped', lines: [fallbackLine(reason)] };
       return classifyInstall(spawnInstall({ spawn, timeoutMs, env, platform, rm }), { timeoutMs, platform });
     } catch (e) {
       return { status: 'failed', lines: [fallbackLine(`unexpected error: ${e.message}`)] };
     }
   }
   ```

   Choices the spec leaves to the plan, made here:
   - **A spawn error other than `ENOENT`/`ETIMEDOUT`** (for example `EACCES` on a non-executable `claude`) gets `unexpected error: <message>`: it is neither a missing CLI nor a CLI that ran and failed, and the table's catch-all reason names it truthfully.
   - **The diagnostic line** reads `claude plugin install said: <first stderr line>`, prefixed `code-conductor: ` by `bin` like every other line, so the user sees whose words it carries. It is the literal first line, trimmed and cut to 200 characters, and omitted when empty.
   - **`platform` and `rm` are injectable** on `offerSuperpowers` so a unit test checks the win32 command-string shape on any leg and makes cleanup throw. `bin` never passes either.
   - **Where the defaults live.** `run()` resolves `isInteractive` (`Boolean(process.stdin.isTTY && process.stdout.isTTY)`) and `pluginEnv` (`process.env`); `ask`, `spawn` and the timeout are passed through as given, and an `undefined` falls to `offerSuperpowers`'s defaults (`askOnTerminal`, `spawnSync`, `DEFAULT_TIMEOUT_MS`). The effective defaults are the spec's.
   - Every function stays under 30 lines (`offerSuperpowers` 10, `spawnInstall` 19, `classifyInstall` 9).

3. **`bin/code-conductor.mjs` edits.**
   - `:9`, after the `config.mjs` import, add: `import { offerSuperpowers, NOTICES } from '../lib/installer/plugins.mjs';`
   - `:11` `USAGE` becomes: ``const USAGE = `Usage: code-conductor [--project|-Project] [--no-deps|-NoDeps] [--verbosity|-Verbosity MIN|INFO|VERBOSE] [--opencode] [--with-plugins] [--version] [--help]`;``
   - `:26` the `opts` literal gains `withPlugins: false` after `noDeps: false`.
   - `:32-34` the comment above `--no-deps` becomes:
     ```js
         // Accepted no-op since FEAT-023 removed the shell installers: recognized so callers
         // carried over from install.sh get no misleading "unrecognized" warning. It does not
         // affect the superpowers offer, which only --with-plugins or the prompt controls.
     ```
   - after the `--opencode` branch (`:37`), add:
     ```js
         // FEAT-039: consent to install the superpowers plugin without asking; the only way a
         // non-interactive run installs it. Matched exact-case like every other flag.
         else if (a === '--with-plugins') opts.withPlugins = true;
     ```
   - `:69-70` the comment and signature become:
     ```js
     // log(stream, msg) is injected so tests capture output without spawning a process. The
     // plugin options (FEAT-039) let tests replace the TTY check, the prompt, the spawn, the
     // timeout and the child's env, so no test can prompt or reach a real claude.
     export function run(argv, env = process.env, { cwd = process.cwd(), log, nodeVersion = process.versions.node, isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY), ask, spawn, pluginTimeoutMs, pluginEnv = process.env } = {}) {
     ```
   - between `:123` (`deployProject`) and `:124` (`return 0`), add:
     ```js
         offerPlugins(emit, { home, withPlugins: opts.withPlugins, isInteractive, ask, spawn, timeoutMs: pluginTimeoutMs, env: pluginEnv });
     ```
   - before `function pkgVersion` (`:65`), add:
     ```js
     // FEAT-039: the last setup step, fail-open. Its own try keeps it out of run()'s exit
     // classes: nothing here can turn a finished deploy into an exit 1 or 2.
     function offerPlugins(emit, options) {
       try {
         const result = offerSuperpowers(options);
         if (NOTICES[result.status]) emit('stdout', `code-conductor: ${NOTICES[result.status]}`);
         for (const line of result.lines) emit('stderr', `code-conductor: ${line}`);
       } catch { /* fail-open: a reporting error never changes the exit code */ }
     }
     ```
   `--help`, `--version`, a pre-flight failure and a mid-copy failure all return before the step, so it runs only after a completed deploy.

4. **`tests/installer/cli.test.js` edits.**
   - `:6` becomes `import { run as runCli } from '../../bin/code-conductor.mjs';` and a new line after it: `import { fallbackLine } from '../../lib/installer/plugins.mjs';`
   - after `const log = …` (`:9`), add:
     ```js
     // FEAT-039: every run() here is non-interactive with a spawn that records its calls, so
     // no test prompts or starts a real claude whatever the runner's TTY; afterEach asserts
     // nothing was spawned.
     let spawned;
     const run = (argv, env, options) => runCli(argv, env, { isInteractive: false, spawn: (...args) => { spawned.push(args); return { status: 1 }; }, ...options });
     ```
     The wrapper covers all 71 calls, the `nodeVersion` and `cwd: spaced` ones included, without editing them.
   - `beforeEach` gains `spawned = [];`. `afterEach` gains `expect(spawned).toEqual([]);` before the `rmSync` calls.
   - `:234` becomes `expect(logs.filter(l => l.startsWith('stderr:'))).toEqual([`stderr:code-conductor: ${fallbackLine('non-interactive run; pass --with-plugins to install it')}`]);` so the test still proves `-Verbosity INFO` warns about nothing and names the one line it now expects.
   - after the `lists --opencode in --help (FEAT-048)` test (`:210-213`), add:
     ```js
       it('lists --with-plugins in --help (FEAT-039)', () => {
         run(['--help'], { HOME: home }, { cwd, log });
         expect(logs.some(l => l.startsWith('stdout:') && l.includes('[--with-plugins]'))).toBe(true);
       });
     ```

5. **`tests/installer/plugins.test.js` (new).** Imports from `vitest`, `node:fs` (`chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync, writeSync, openSync, closeSync, existsSync`), `node:os`, `node:path`, `node:url`, the module of decision 2 and `run` from `bin`. Temp dirs are removed with `rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })`.

   Fixtures, verbatim:

   ```js
   const RM = { recursive: true, force: true, maxRetries: 10, retryDelay: 200 };
   const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
   const temps = [];
   const tempDir = (prefix) => { const d = realpathSync(mkdtempSync(join(tmpdir(), prefix))); temps.push(d); return d; };
   afterEach(() => { for (const d of temps.splice(0)) rmSync(d, RM); });

   // An injected spawn that writes what a CLI would print into the fds it is given.
   function fakeSpawn({ status = 0, out = '', err = '', error, signal = null } = {}) {
     const calls = [];
     const spawn = (...args) => {
       calls.push(args);
       const { stdio } = args.at(-1);
       if (out) writeSync(stdio[1], out);
       if (err) writeSync(stdio[2], err);
       return { status, signal, error };
     };
     return { spawn, calls };
   }

   // Stub claude: the interpreter by absolute path, so the child's PATH can hold the stub
   // dir alone and still no test reaches a real claude (spec, System Impact).
   function stubClaude(body) {
     const dir = tempDir('cc-claude-stub-');
     writeFileSync(join(dir, 'claude.mjs'), body(dir));
     if (process.platform === 'win32') {
       writeFileSync(join(dir, 'claude.cmd'), `@"${process.execPath}" "%~dp0claude.mjs" %*\r\n`);
     } else {
       writeFileSync(join(dir, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${join(dir, 'claude.mjs')}" "$@"\n`);
       chmodSync(join(dir, 'claude'), 0o755);
     }
     return dir;
   }

   // Windows env keys are case-insensitive and the copy carries Path: drop every spelling.
   function pathOnly(dir) {
     const env = { ...process.env };
     for (const key of Object.keys(env)) if (/^path$/i.test(key)) delete env[key];
     return { ...env, PATH: dir };
   }

   const failing = (message, code = 1) => () => `process.stderr.write(${JSON.stringify(`${message}\n`)}); process.exit(${code});\n`;
   const registryPath = (home) => join(home, '.claude', 'plugins', 'installed_plugins.json');
   const writeRegistry = (home, plugins) => { mkdirSync(dirname(registryPath(home)), { recursive: true }); writeFileSync(registryPath(home), JSON.stringify({ version: 2, plugins })); };

   // Relative path -> content, with the home path masked so two homes compare equal.
   function snapshot(home) {
     const mask = (s) => s.split(home).join('<home>').split(JSON.stringify(home).slice(1, -1)).join('<home>');
     return Object.fromEntries(readdirSync(home, { recursive: true }).map(String).sort()
       .filter((p) => statSync(join(home, p)).isFile())
       .map((p) => [p.replaceAll('\\', '/'), mask(readFileSync(join(home, p), 'utf8'))]));
   }
   ```

   The 35 tests, by describe block (names verbatim; each line says what it asserts):

   `describe('superpowers plugin spec [FEAT-039]')`
   1. `pins the plugin spec string` — `SUPERPOWERS_PLUGIN === 'superpowers@claude-plugins-official'`.
   2. `builds every command, prompt and registry key from the constant` — `MANUAL_COMMAND`, `fallbackLine('x')` and `CONSENT_PROMPT` each contain `SUPERPOWERS_PLUGIN`; a fake spawn's argv (POSIX) contains it; `isRegistered` is true for a registry keyed by it.

   `describe('isRegistered')`
   3. `misses an absent, malformed or foreign registry` — false for no file, `{not json`, `{"plugins":null}`, `{"plugins":[]}` and a registry keyed `other@claude-plugins-official`.

   `describe('formatTimeout')`
   4. `prints whole seconds or milliseconds` — `60000` → `60s`, `300` → `300ms`, `1500` → `1500ms`.

   `describe('readLine')`
   5. `reads one line from a descriptor and an empty line at EOF` — a temp file `yes\r\nrest`: `readLine(fd)` is `yes\r` (the caller trims), then a fresh fd on an empty file gives `''`.

   `describe('offerSuperpowers: consent')` (each uses a temp `home` and `fakeSpawn()`)
   6. `treats a registered plugin as already installed without asking or spawning` — status `already`, `lines` `[]`, ask never called, `calls` empty.
   7. `skips a non-interactive run without --with-plugins and names the flag` — status `skipped`, one line containing `--with-plugins` and `MANUAL_COMMAND`, no spawn.
   8. `installs a non-interactive run with --with-plugins without asking` — status `installed`, one spawn, no ask.
   9. `does not ask an interactive run that passed --with-plugins` — one spawn, ask never called.
   10–11. `it.each(['y', ' YES '])('installs on the answer %j', …)` — ask called once with `CONSENT_PROMPT`, one spawn.
   12–14. `it.each([['n', () => 'n'], ['an empty line', () => ''], ['a read error', () => { throw Object.assign(new Error('EAGAIN'), { code: 'EAGAIN' }); }]])('declines on %s', …)` — status `skipped`, `lines` `[fallbackLine('declined')]`, no spawn.

   `describe('offerSuperpowers: the spawn')`
   15. `spawns claude with no stdin, file-descriptor output and the timeout` — `platform: 'linux'`, `timeoutMs: 1234`: args `['claude', ['plugin', 'install', SUPERPOWERS_PLUGIN], options]`; `options.stdio[0] === 'ignore'`; `stdio[1]` and `stdio[2]` are integers (not `'pipe'`); `options.timeout === 1234`; `options.windowsHide === true`; `options.env` is the injected env; no `shell`.
   16. `passes one command string and no args array on win32` — `platform: 'win32'`: `calls[0].length === 2`, `calls[0][0] === `claude plugin install ${SUPERPOWERS_PLUGIN}``, `calls[0][1].shell === true`, `Array.isArray(calls[0][1])` false.

   `describe('offerSuperpowers: outcomes')` (all with `withPlugins: true`)
   17. `reports exit 0 as installed` — status `installed`, `lines` `[]`.
   18. `counts a non-zero exit that says already installed as success` — `{ status: 1, out: 'Plugin superpowers is already installed\n' }` → status `already`, `lines` `[]`.
   19. `reports any other non-zero exit with its code and the first stderr line` — `{ status: 3, err: `${'x'.repeat(250)}\nsecond\n` }` → `lines[0] === fallbackLine('claude plugin install failed (exit 3)')`, `lines[1] === `claude plugin install said: ${'x'.repeat(200)}``, length 2.
   20. `prints the fallback line alone when stderr is empty` — `{ status: 1 }` → `lines` `[fallbackLine('claude plugin install failed (exit 1)')]`.
   21. `reports ENOENT as a missing CLI` — `{ status: null, error: Object.assign(new Error('spawnSync claude ENOENT'), { code: 'ENOENT' }) }` → `[fallbackLine('claude CLI not found on PATH')]`.
   22. `reports cmd.exe's not-recognized exit as a missing CLI on win32` — `platform: 'win32'` with `{ status: 9009 }` and with `{ status: 1, err: "'claude' is not recognized as an internal or external command\n" }`: both give the not-found line.
   23. `reports a timeout with the effective value` — `timeoutMs: 300`, `{ status: null, signal: 'SIGTERM', error: Object.assign(new Error('spawnSync claude ETIMEDOUT'), { code: 'ETIMEDOUT' }) }` → `[fallbackLine('timed out after 300ms')]`.
   24. `turns a throw inside the step into one unexpected-error line` — a spawn that throws `new Error('boom')` → status `failed`, `[fallbackLine('unexpected error: boom')]`.

   `describe('offerSuperpowers: best-effort cleanup')` (`rm` throws `Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' })`)
   25. `keeps the timeout reason when the temp dir cannot be removed` — the test 23 result → `[fallbackLine('timed out after 300ms')]`; no line contains `unexpected error`.
   26. `keeps the installed status when the temp dir cannot be removed` — exit 0 → status `installed`, `lines` `[]`.

   `describe('installer with a stub claude [FEAT-039]')` (each `run(argv, { HOME: home }, { cwd, log, isInteractive: false, pluginEnv })` with a temp `home` and `cwd`; `pluginEnv = pathOnly(stubDir)`; `stderrOf()` and `stdoutOf()` filter `logs`)
   27. `degrades to one fallback line and the same files when claude is not on PATH` — `pathOnly(tempDir('cc-claude-none-'))`, `['--with-plugins']` → rc `0`; the stderr lines that name `superpowers` are exactly `[`code-conductor: ${fallbackLine('claude CLI not found on PATH')}`]` (on POSIX by `ENOENT`, on win32 by `cmd.exe`'s not-recognized exit); `snapshot(home)` equals `snapshot(otherHome)` after `run([], { HOME: otherHome }, { cwd, log: () => {}, isInteractive: false, spawn: () => { throw new Error('spawned'); } })`.
   28. `degrades when the CLI has no plugin subcommand` — stub `failing("error: unknown command 'plugin'")` → rc `0`, stderr contains `code-conductor: ${fallbackLine('claude plugin install failed (exit 1)')}` and `code-conductor: claude plugin install said: error: unknown command 'plugin'`.
   29–30. `it.each([['a network failure', 'fetch failed: getaddrinfo ENOTFOUND github.com', 2], ['a marketplace schema error', 'Plugin "superpowers" not found in marketplace "claude-plugins-official"', 1]])('degrades on %s with the exit code', …)` — rc `0`, the fallback line with `(exit <code>)` and the said-line with the message.
   31. `treats a CLI that reports an existing install as success` — stub `failing('Plugin superpowers@claude-plugins-official is already installed')` → rc `0`, stdout contains `code-conductor: ${NOTICES.already}`, no stderr line names `superpowers`.
   32. `installs through the CLI and tells the user to reload plugins` — stub writes `JSON.stringify(process.argv.slice(2))` to `<stubDir>/argv.json` and exits 0 → rc `0`; `argv.json` equals `['plugin', 'install', SUPERPOWERS_PLUGIN]`; stdout contains `code-conductor: ${NOTICES.installed}`, which contains `/reload-plugins`.
   33. `bounds a hanging CLI by the injected timeout` — stub `setTimeout(() => {}, 5000);`, `pluginTimeoutMs: 300` → rc `0`; `Date.now() - start < 3000` around `run()`; the stderr line naming `superpowers` is `code-conductor: ${fallbackLine('timed out after 300ms')}`; no line contains `unexpected error`.
   34. `leaves the same files after two runs and does not ask or spawn the second time` — `isInteractive: true`, `ask` counts calls and answers `y`, no flag; the stub appends one line to `<stubDir>/calls.log` and writes `{ version: 2, plugins: { [SUPERPOWERS_PLUGIN]: [{ scope: 'user' }] } }` to the home's registry path (absolute literal) → after run 1: one ask, one line in `calls.log`, `snap1 = snapshot(home)`; after run 2: still one ask and one line, `snapshot(home)` equals `snap1`, stdout of run 2 is `[`stdout:code-conductor: ${NOTICES.already}`]`.

   `describe('docs name the plugin offer [FEAT-039]')`
   35. `README and the wiki Getting-Started page document --with-plugins and the fallback` — both files contain `--with-plugins` and `/plugin install superpowers@claude-plugins-official`; neither contains `installs no dependencies`.

   Every stub body is ESM (`import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';` where it writes) and writes only absolute paths given as `JSON.stringify` literals. No test is skipped on any platform.

6. **Docs, old → new** (both files tracked; the `|` cell count of each table row stays the same).
   - `README.md:85`, third cell `Install from Claude Code's `/plugin` marketplace, then run `/reload-plugins`, **before** using these commands; without it, their `Skill(...)` calls fail` → `The installer offers it: an interactive run asks first (default No), and a non-interactive run installs it only with `--with-plugins`. If it cannot install it, it prints the manual fallback and still succeeds: run `/plugin install superpowers@claude-plugins-official` inside Claude Code, then `/reload-plugins`, **before** using these commands; without it, their `Skill(...)` calls fail`.
   - `README.md:389`, `--no-deps` row description → `Accepted for compatibility with the retired shell installers; a no-op that copies agent files only and does not affect the superpowers offer (see `--with-plugins`)`.
   - `README.md`, new row after the `--opencode` row (`:391`): `| `--with-plugins` | Install the superpowers plugin without asking, through `claude plugin install superpowers@claude-plugins-official` (60 s timeout). A non-interactive run installs it only with this flag; an interactive run asks instead. If the install cannot run, the installer prints `/plugin install superpowers@claude-plugins-official` and still exits 0 |`
   - `.github/wiki/pages/Getting-Started.md:9`, third cell `Install from Claude Code's `/plugin` marketplace, then `/reload-plugins`` → `The installer offers it (it asks first; a non-interactive run needs `--with-plugins`). Fallback: `/plugin install superpowers@claude-plugins-official` inside Claude Code, then `/reload-plugins``.
   - `Getting-Started.md:33`, `--no-deps` description → `Accepted for compatibility with the retired shell installers; a no-op that does not affect the superpowers offer`.
   - `Getting-Started.md`, new row after the `--opencode` row (`:35`): `| `--with-plugins` | Install the superpowers plugin without asking (`claude plugin install superpowers@claude-plugins-official`); a non-interactive run installs it only with this flag. On any failure the installer prints the manual command and still exits 0 |`
   - `Getting-Started.md:39`, the sentence `The installer installs no dependencies: Claude Code, the Superpowers plugin and `gh` are yours to set up (see Prerequisites).` → `The installer offers the superpowers plugin (it asks first, or installs it with `--with-plugins` when non-interactive); Claude Code and `gh` stay yours to set up (see Prerequisites).`

7. **Other callers of the installer.** `grep -rn "code-conductor.mjs" tests` finds `run()` imported only by `cli.test.js` (decision 4) and the new file. `tests/installer/smoke.test.js:54,64` starts the packed `bin` as a child with `execFileSync` and the default `stdio: 'pipe'`, so the child's stdin is a pipe and never a TTY, whatever the runner's terminal: the step takes the non-interactive, no-flag path, spawns nothing and adds one stderr line no smoke assertion reads. It needs no edit. `tests/tools/repo-invariants.test.js:77-82` (no `graphify` outside two files) is unaffected: the new module names no graphify.

8. **The leaf for `.gitignore`**, inserted between the `2026-11-21-bug058-…` plan leaf (`:193`) and the `2026-11-21-feat052-…` plan leaf (`:194`), in sorted position:

   ```text
   !/docs/superpowers/plans/2026-11-21-feat039-superpowers-auto-install-via-the-claude-code.md
   ```

## Baseline (measured on this branch, HEAD 0255e2f, Node v24.22.2)

- `npx vitest run tests/installer/cli.test.js tests/installer/smoke.test.js tests/tools/repo-invariants.test.js`: **87 passed (87)** (`cli.test.js` 64).
- Two consecutive `run([])` calls on one temp home leave byte-identical files (15 files), so decision 5 test 34 measures only the plugin step.

### Task 0: Commit this plan

**Files:** `docs/superpowers/plans/2026-11-21-feat039-superpowers-auto-install-via-the-claude-code.md`, `.gitignore`

- [X] [T-001] Create this plan file from the approved spec `7a8192bb…`. No dependency.
- [X] [T-002] `.gitignore`: insert the leaf of plan decision 8. Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` (tracked) and `git add -f docs/superpowers/plans/2026-11-21-feat039-superpowers-auto-install-via-the-claude-code.md` (new, under the ignored `docs/superpowers/plans/`). Depends on T-002.
- [X] [T-004] Commit: `docs: plan the superpowers auto-install via the Claude Code plugin CLI [FEAT-039]`. Depends on T-003.

### Task 1: The plugin tests first (red)

**Files:** `tests/installer/plugins.test.js`

- [X] [T-101] `tests/installer/plugins.test.js` (create): the fixtures and the 35 tests of plan decision 5. Depends on T-004.
- [X] [T-102] Red run: `npx vitest run tests/installer/plugins.test.js`. Predicted: the file fails to load (`Failed to load` / cannot find `lib/installer/plugins.mjs`), **Test Files 1 failed (1)**, no test collected. Any other result means the test file is wrong. Depends on T-101.

### Task 2: The module (green for the unit tests)

**Files:** `lib/installer/plugins.mjs`

- [X] [T-201] `lib/installer/plugins.mjs` (create): the module of plan decision 2, verbatim. Depends on T-102.
- [X] [T-202] Run: the T-102 command. Predicted: **9 failed | 26 passed (35)**: tests 1–26 green; red are the eight stub tests 27–34 (`run()` does not call the step yet and treats `--with-plugins` as unrecognized) and test 35 (the docs are unchanged). Any other split means a test or the module is wrong: fix it, not the prediction. Depends on T-201.

### Task 3: The CLI step and the existing CLI tests (green for the stub tests)

**Files:** `bin/code-conductor.mjs`, `tests/installer/cli.test.js`

- [X] [T-301] `bin/code-conductor.mjs` (modify): the import, `USAGE`, the `opts` literal, the `--no-deps` comment, the `--with-plugins` branch, `offerPlugins`, the `run()` signature and comment, and the call before `return 0`, all of plan decision 3. Depends on T-202.
- [X] [T-302] `tests/installer/cli.test.js` (modify): the import, the `run` wrapper and `spawned`, the `beforeEach`/`afterEach` lines, the `:234` assertion and the `--with-plugins` help test, all of plan decision 4. Depends on T-301.
- [X] [T-303] Run: `npx vitest run tests/installer/plugins.test.js tests/installer/cli.test.js tests/installer/smoke.test.js`. Predicted: **1 failed | 106 passed (107)**: `plugins.test.js` 34 green and test 35 red; `cli.test.js` **65 passed** (64 + the help test); `smoke.test.js` **7 passed**. Depends on T-302.

### Task 4: README and wiki (green)

**Files:** `README.md`, `.github/wiki/pages/Getting-Started.md`

- [X] [T-401] `README.md` (modify): the `:85` cell, the `:389` row and the new `--with-plugins` row of plan decision 6. Depends on T-303.
- [X] [T-402] `.github/wiki/pages/Getting-Started.md` (modify): the `:9` cell, the `:33` row, the new `--with-plugins` row and the `:39` sentence of plan decision 6. Depends on T-401.
- [X] [T-403] Run: the T-303 command plus `tests/wiki/wiki-gen.test.js`. Predicted: every test green; `plugins.test.js` **35 passed**, `cli.test.js` **65**, `smoke.test.js` **7**. Depends on T-402.

### Task 5: Full suite, scope check and commit

**Files:** every file of Tasks 1–4, and this plan (ticks)

- [X] [T-501] Run `npm test` (long; run it in the background if the shell times out). Predicted: exit 0, with `tests/installer/plugins.test.js` at **35**, `tests/installer/cli.test.js` at **65** and no new skipped test. A red is called ENV only if the sandbox caused it (network, tmp permissions) and its file is not one this plan touches; report it with its name. Any other red is fixed. Depends on T-403.
- [X] [T-502] Scope check: `git status --short` lists exactly the six files of the Global Constraints and this plan; no temporary file is left in the tree (the stub dirs and `cc-plugin-*` dirs live under `os.tmpdir()`). `git diff --stat` shows no change to the spec, `package.json`, `tools/skip-baseline.json`, `.github/workflows/`, `.github/actions/` or any installer module other than the new one. `grep -n '"dependencies": {}' package.json` still matches. Depends on T-501.
- [X] [T-503] Stage: `git add lib/installer/plugins.mjs tests/installer/plugins.test.js` (new, not under an ignored directory). Depends on T-502.
- [X] [T-504] Stage: `git add -u bin/code-conductor.mjs tests/installer/cli.test.js README.md .github/wiki/pages/Getting-Started.md` (tracked). Depends on T-503.
- [X] [T-505] Stage: `git add -u docs/superpowers/plans/2026-11-21-feat039-superpowers-auto-install-via-the-claude-code.md` (carries the ticks for T-101 to T-504). Depends on T-504.
- [X] [T-506] Commit: `feat: offer the superpowers plugin through the Claude Code plugin CLI at install [FEAT-039]`. Depends on T-505.

## Test List

- [ ] Unit, the constant (AC1): tests 1–2.
- [ ] Unit, the pre-check and helpers: tests 3–5.
- [ ] Unit, consent (AC "Interactive", AC "Non-interactive"): tests 6–14.
- [ ] Unit, spawn options and the win32 shape (AC "stdin `'ignore'`… file descriptors… timeout"): tests 15–16.
- [ ] Unit, classification (AC "already installed", error table): tests 17–24.
- [ ] Unit, best-effort cleanup (AC "Temp-directory cleanup"): tests 25–26.
- [ ] Integration, stub `claude` through `run()` (AC "No `claude` on PATH", "unknown command", "network or schema", "sleeps past the timeout", "already installed", "Two consecutive installer runs"): tests 27–34, cross-platform with no skip.
- [ ] Docs (AC "`USAGE` and the README", AC wiki): test 35 and the `cli.test.js` help test.
- [ ] Isolation (AC "No test spawns a real `claude`"): the `cli.test.js` wrapper and its `afterEach`, every new `run()` call with `isInteractive` and a `spawn` or a stub-only `pluginEnv`; decision 7 for the smoke child.
- [ ] Full suite (AC "`dependencies` stays `{}`… no skip"): T-501 and T-502.
- [ ] No E2E/UI test: there is no UI. A real install against the marketplace is not run by any test (spec, System Impact); the PR description says so.

## Commit Order

1. Task 0 (T-004): this plan and its `.gitignore` leaf.
2. Task 5 (T-506): the new module and test file, the `bin` and `cli.test.js` edits, the README and wiki edits and the plan ticks for T-101 to T-505, in one commit, so no commit has a red suite. The red runs (T-102, T-202, T-303) happen in the working tree. The ticks for T-505 and T-506 ride the closeout commit.

## Identified Risks

- **Windows timeout bound.** It rests on file-descriptor stdio (spec, "Files, not pipes"). Test 33 checks it on the Windows leg, where the stub is a grandchild of `cmd.exe`. If that leg shows `run()` past 3 s, stop and report it; do not skip the test (spec, System Impact).
- **Windows deploy time inside test 33.** The 3 s bound includes the deploy in `run()`. The deploy of `cli.test.js` runs in well under a second locally; if the Windows leg is close to the bound, report it rather than raising the number, which the spec fixes.
- **A real `claude` reached by a test.** The `cli.test.js` wrapper makes every call non-interactive with a recording spawn, `afterEach` fails a test that spawned, and every stub `pluginEnv` holds only its own dir as PATH. The smoke child is non-interactive by its piped stdin (decision 7).
- **The registry shape drifts** (decision 1). Cost: one extra prompt; the `already installed` classification still reports success. Nothing fails.
- **A CLI that needs a confirmation.** `claude plugin install --help` says a marketplace-declared command must be confirmed with `-y` when not interactive. With stdin `'ignore'` such an install exits non-zero and takes the generic fallback, which is the spec's "never runs detached input prompts". The argv is the spec's and stays without `-y`.
- **`readLine` on a TTY.** `readSync(0)` can throw `EAGAIN` on a non-blocking stdin; the throw is a `declined` answer (tests 12–14), never a crash.
- **Coverage.** The default `askOnTerminal` writes to the real stdout and is only reached on a TTY run, so no test calls it; `readLine` is covered through a file descriptor (test 5). `npm test` asserts no coverage threshold.
