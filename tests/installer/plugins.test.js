import { describe, it, expect, afterEach } from 'vitest';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync, writeSync, openSync, closeSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SUPERPOWERS_PLUGIN, MANUAL_COMMAND, CONSENT_PROMPT, NOTICES,
  fallbackLine, formatTimeout, isRegistered, readLine, offerSuperpowers,
} from '../../lib/installer/plugins.mjs';
import { run } from '../../bin/code-conductor.mjs';

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
// win32 keeps System32 after the stub dir: with shell: true Node may resolve plain
// 'cmd.exe' through the child's PATH, and System32 holds no claude to reach.
function pathOnly(dir) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^path$/i.test(key)) delete env[key];
  if (process.platform !== 'win32') return { ...env, PATH: dir };
  return { ...env, PATH: `${dir};${join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')}` };
}

const failing = (message, code = 1) => () => `process.stderr.write(${JSON.stringify(`${message}\n`)}); process.exit(${code});\n`;
const registryPath = (home) => join(home, '.claude', 'plugins', 'installed_plugins.json');
const writeRegistry = (home, plugins) => { mkdirSync(dirname(registryPath(home)), { recursive: true }); writeFileSync(registryPath(home), JSON.stringify({ version: 2, plugins })); };

// Relative path -> content, with the home path masked so two homes compare equal.
function snapshot(home) {
  // Three spellings: native, JSON-escaped, and the forward-slash form hook commands use on win32.
  const spellings = [JSON.stringify(home).slice(1, -1), home, home.replaceAll('\\', '/')];
  const mask = (s) => spellings.reduce((acc, h) => acc.split(h).join('<home>'), s);
  return Object.fromEntries(readdirSync(home, { recursive: true }).map(String).sort()
    .filter((p) => statSync(join(home, p)).isFile())
    .map((p) => [p.replaceAll('\\', '/'), mask(readFileSync(join(home, p), 'utf8'))]));
}

const enoent = () => Object.assign(new Error('spawnSync claude ENOENT'), { code: 'ENOENT' });
const etimedout = () => Object.assign(new Error('spawnSync claude ETIMEDOUT'), { code: 'ETIMEDOUT' });

describe('superpowers plugin spec [FEAT-039]', () => {
  it('pins the plugin spec string', () => {
    expect(SUPERPOWERS_PLUGIN).toBe('superpowers@claude-plugins-official');
  });

  it('builds every command, prompt and registry key from the constant', () => {
    expect(MANUAL_COMMAND).toContain(SUPERPOWERS_PLUGIN);
    expect(fallbackLine('x')).toContain(SUPERPOWERS_PLUGIN);
    expect(CONSENT_PROMPT).toContain(SUPERPOWERS_PLUGIN);
    const home = tempDir('cc-plugins-home-');
    const { spawn, calls } = fakeSpawn();
    offerSuperpowers({ home, withPlugins: true, spawn, platform: 'linux' });
    expect(calls[0][1]).toContain(SUPERPOWERS_PLUGIN);
    writeRegistry(home, { [SUPERPOWERS_PLUGIN]: [{ scope: 'user' }] });
    expect(isRegistered(home)).toBe(true);
  });
});

describe('isRegistered', () => {
  it('misses an absent, malformed or foreign registry', () => {
    const home = tempDir('cc-plugins-home-');
    expect(isRegistered(home)).toBe(false);
    mkdirSync(dirname(registryPath(home)), { recursive: true });
    writeFileSync(registryPath(home), '{not json');
    expect(isRegistered(home)).toBe(false);
    writeFileSync(registryPath(home), '{"plugins":null}');
    expect(isRegistered(home)).toBe(false);
    writeFileSync(registryPath(home), '{"plugins":[]}');
    expect(isRegistered(home)).toBe(false);
    writeRegistry(home, { 'other@claude-plugins-official': [{ scope: 'user' }] });
    expect(isRegistered(home)).toBe(false);
  });
});

describe('formatTimeout', () => {
  it('prints whole seconds or milliseconds', () => {
    expect(formatTimeout(60000)).toBe('60s');
    expect(formatTimeout(300)).toBe('300ms');
    expect(formatTimeout(1500)).toBe('1500ms');
  });
});

describe('readLine', () => {
  it('reads one line from a descriptor and an empty line at EOF', () => {
    const dir = tempDir('cc-plugins-readline-');
    const filled = join(dir, 'filled');
    const empty = join(dir, 'empty');
    writeFileSync(filled, 'yes\r\nrest');
    writeFileSync(empty, '');
    const fd = openSync(filled, 'r');
    const fdEmpty = openSync(empty, 'r');
    try {
      expect(readLine(fd)).toBe('yes\r');
      expect(readLine(fdEmpty)).toBe('');
    } finally {
      closeSync(fd);
      closeSync(fdEmpty);
    }
  });
});

describe('offerSuperpowers: consent', () => {
  const setup = () => ({ home: tempDir('cc-plugins-home-'), ...fakeSpawn() });
  const counter = (answer) => { const asked = []; return { asked, ask: (q) => { asked.push(q); return typeof answer === 'function' ? answer() : answer; } }; };

  it('treats a registered plugin as already installed without asking or spawning', () => {
    const { home, spawn, calls } = setup();
    writeRegistry(home, { [SUPERPOWERS_PLUGIN]: [{ scope: 'user' }] });
    const { asked, ask } = counter('y');
    const result = offerSuperpowers({ home, isInteractive: true, ask, spawn });
    expect(result).toEqual({ status: 'already', lines: [] });
    expect(asked).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('skips a non-interactive run without --with-plugins and names the flag', () => {
    const { home, spawn, calls } = setup();
    const result = offerSuperpowers({ home, isInteractive: false, spawn });
    expect(result.status).toBe('skipped');
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toContain('--with-plugins');
    expect(result.lines[0]).toContain(MANUAL_COMMAND);
    expect(calls).toEqual([]);
  });

  it('installs a non-interactive run with --with-plugins without asking', () => {
    const { home, spawn, calls } = setup();
    const { asked, ask } = counter('y');
    const result = offerSuperpowers({ home, withPlugins: true, isInteractive: false, ask, spawn });
    expect(result.status).toBe('installed');
    expect(calls).toHaveLength(1);
    expect(asked).toEqual([]);
  });

  it('does not ask an interactive run that passed --with-plugins', () => {
    const { home, spawn, calls } = setup();
    const { asked, ask } = counter('n');
    offerSuperpowers({ home, withPlugins: true, isInteractive: true, ask, spawn });
    expect(calls).toHaveLength(1);
    expect(asked).toEqual([]);
  });

  it.each(['y', ' YES '])('installs on the answer %j', (answer) => {
    const { home, spawn, calls } = setup();
    const { asked, ask } = counter(answer);
    const result = offerSuperpowers({ home, isInteractive: true, ask, spawn });
    expect(result.status).toBe('installed');
    expect(asked).toEqual([CONSENT_PROMPT]);
    expect(calls).toHaveLength(1);
  });

  it.each([
    ['n', () => 'n'],
    ['an empty line', () => ''],
    ['a read error', () => { throw Object.assign(new Error('EAGAIN'), { code: 'EAGAIN' }); }],
  ])('declines on %s', (_name, answer) => {
    const { home, spawn, calls } = setup();
    const result = offerSuperpowers({ home, isInteractive: true, ask: () => answer(), spawn });
    expect(result.status).toBe('skipped');
    expect(result.lines).toEqual([fallbackLine('declined')]);
    expect(calls).toEqual([]);
  });
});

describe('offerSuperpowers: the spawn', () => {
  it('spawns claude with no stdin, file-descriptor output and the timeout', () => {
    const home = tempDir('cc-plugins-home-');
    const { spawn, calls } = fakeSpawn();
    const env = { PATH: 'x' };
    offerSuperpowers({ home, withPlugins: true, spawn, platform: 'linux', timeoutMs: 1234, env });
    const [file, args, options] = calls[0];
    expect(calls[0]).toHaveLength(3);
    expect(file).toBe('claude');
    expect(args).toEqual(['plugin', 'install', SUPERPOWERS_PLUGIN]);
    expect(options.stdio[0]).toBe('ignore');
    expect(Number.isInteger(options.stdio[1])).toBe(true);
    expect(Number.isInteger(options.stdio[2])).toBe(true);
    expect(options.timeout).toBe(1234);
    expect(options.windowsHide).toBe(true);
    expect(options.env).toBe(env);
    expect(options).not.toHaveProperty('shell');
  });

  it('passes one command string and no args array on win32', () => {
    const home = tempDir('cc-plugins-home-');
    const { spawn, calls } = fakeSpawn();
    offerSuperpowers({ home, withPlugins: true, spawn, platform: 'win32' });
    expect(calls[0]).toHaveLength(2);
    expect(calls[0][0]).toBe(`claude plugin install ${SUPERPOWERS_PLUGIN}`);
    expect(calls[0][1].shell).toBe(true);
    expect(Array.isArray(calls[0][1])).toBe(false);
  });
});

describe('offerSuperpowers: outcomes', () => {
  const offer = (spawnOptions, extra = {}) => {
    const home = tempDir('cc-plugins-home-');
    const { spawn } = fakeSpawn(spawnOptions);
    return offerSuperpowers({ home, withPlugins: true, spawn, platform: 'linux', ...extra });
  };

  it('reports exit 0 as installed', () => {
    expect(offer({})).toEqual({ status: 'installed', lines: [] });
  });

  it('counts a non-zero exit that says already installed as success', () => {
    expect(offer({ status: 1, out: 'Plugin superpowers is already installed\n' })).toEqual({ status: 'already', lines: [] });
  });

  it('reports any other non-zero exit with its code and the first stderr line', () => {
    const { lines } = offer({ status: 3, err: `${'x'.repeat(250)}\nsecond\n` });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(fallbackLine('claude plugin install failed (exit 3)'));
    expect(lines[1]).toBe(`claude plugin install said: ${'x'.repeat(200)}`);
  });

  it('prints the fallback line alone when stderr is empty', () => {
    expect(offer({ status: 1 }).lines).toEqual([fallbackLine('claude plugin install failed (exit 1)')]);
  });

  it('reports ENOENT as a missing CLI', () => {
    expect(offer({ status: null, error: enoent() }).lines).toEqual([fallbackLine('claude CLI not found on PATH')]);
  });

  it("reports cmd.exe's not-recognized exit as a missing CLI on win32", () => {
    const expected = [fallbackLine('claude CLI not found on PATH')];
    expect(offer({ status: 9009 }, { platform: 'win32' }).lines).toEqual(expected);
    expect(offer({ status: 1, err: "'claude' is not recognized as an internal or external command\n" }, { platform: 'win32' }).lines).toEqual(expected);
  });

  it('reports a timeout with the effective value', () => {
    const result = offer({ status: null, signal: 'SIGTERM', error: etimedout() }, { timeoutMs: 300 });
    expect(result.lines).toEqual([fallbackLine('timed out after 300ms')]);
  });

  it('turns a throw inside the step into one unexpected-error line', () => {
    const home = tempDir('cc-plugins-home-');
    const result = offerSuperpowers({ home, withPlugins: true, spawn: () => { throw new Error('boom'); } });
    expect(result.status).toBe('failed');
    expect(result.lines).toEqual([fallbackLine('unexpected error: boom')]);
  });
});

describe('offerSuperpowers: best-effort cleanup', () => {
  const rm = () => { throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' }); };

  it('keeps the timeout reason when the temp dir cannot be removed', () => {
    const home = tempDir('cc-plugins-home-');
    const { spawn } = fakeSpawn({ status: null, signal: 'SIGTERM', error: etimedout() });
    const { lines } = offerSuperpowers({ home, withPlugins: true, spawn, platform: 'linux', timeoutMs: 300, rm });
    expect(lines).toEqual([fallbackLine('timed out after 300ms')]);
    expect(lines.some((l) => l.includes('unexpected error'))).toBe(false);
  });

  it('keeps the installed status when the temp dir cannot be removed', () => {
    const home = tempDir('cc-plugins-home-');
    const { spawn } = fakeSpawn();
    expect(offerSuperpowers({ home, withPlugins: true, spawn, platform: 'linux', rm })).toEqual({ status: 'installed', lines: [] });
  });
});

describe('installer with a stub claude [FEAT-039]', () => {
  let logs;
  const stderrOf = () => logs.filter((l) => l.startsWith('stderr:')).map((l) => l.slice('stderr:'.length));
  const stdoutOf = () => logs.filter((l) => l.startsWith('stdout:')).map((l) => l.slice('stdout:'.length));
  const superpowersLines = () => stderrOf().filter((l) => l.includes('superpowers'));
  const install = (argv, home, cwd, options) => {
    logs = [];
    return run(argv, { HOME: home }, { cwd, log: (stream, msg) => logs.push(`${stream}:${msg}`), isInteractive: false, ...options });
  };
  const fresh = () => ({ home: tempDir('cc-plugins-h-'), cwd: tempDir('cc-plugins-c-') });

  it('degrades to one fallback line and the same files when claude is not on PATH', () => {
    const { home, cwd } = fresh();
    const pluginEnv = pathOnly(tempDir('cc-claude-none-'));
    expect(install(['--with-plugins'], home, cwd, { pluginEnv })).toBe(0);
    expect(superpowersLines()).toEqual([`code-conductor: ${fallbackLine('claude CLI not found on PATH')}`]);
    const otherHome = tempDir('cc-plugins-h-');
    run([], { HOME: otherHome }, { cwd, log: () => {}, isInteractive: false, spawn: () => { throw new Error('spawned'); } });
    expect(snapshot(home)).toEqual(snapshot(otherHome));
  });

  it('degrades when the CLI has no plugin subcommand', () => {
    const { home, cwd } = fresh();
    const pluginEnv = pathOnly(stubClaude(failing("error: unknown command 'plugin'")));
    expect(install(['--with-plugins'], home, cwd, { pluginEnv })).toBe(0);
    expect(stderrOf()).toContain(`code-conductor: ${fallbackLine('claude plugin install failed (exit 1)')}`);
    expect(stderrOf()).toContain("code-conductor: claude plugin install said: error: unknown command 'plugin'");
  });

  it.each([
    ['a network failure', 'fetch failed: getaddrinfo ENOTFOUND github.com', 2],
    ['a marketplace schema error', 'Plugin "superpowers" not found in marketplace "claude-plugins-official"', 1],
  ])('degrades on %s with the exit code', (_name, message, code) => {
    const { home, cwd } = fresh();
    const pluginEnv = pathOnly(stubClaude(failing(message, code)));
    expect(install(['--with-plugins'], home, cwd, { pluginEnv })).toBe(0);
    expect(stderrOf()).toContain(`code-conductor: ${fallbackLine(`claude plugin install failed (exit ${code})`)}`);
    expect(stderrOf()).toContain(`code-conductor: claude plugin install said: ${message}`);
  });

  it('treats a CLI that reports an existing install as success', () => {
    const { home, cwd } = fresh();
    const pluginEnv = pathOnly(stubClaude(failing('Plugin superpowers@claude-plugins-official is already installed')));
    expect(install(['--with-plugins'], home, cwd, { pluginEnv })).toBe(0);
    expect(stdoutOf()).toContain(`code-conductor: ${NOTICES.already}`);
    expect(superpowersLines()).toEqual([]);
  });

  it('installs through the CLI and tells the user to reload plugins', () => {
    const { home, cwd } = fresh();
    const stubDir = stubClaude((dir) => `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(join(dir, 'argv.json'))}, JSON.stringify(process.argv.slice(2)));\n`);
    expect(install(['--with-plugins'], home, cwd, { pluginEnv: pathOnly(stubDir) })).toBe(0);
    expect(JSON.parse(readFileSync(join(stubDir, 'argv.json'), 'utf8'))).toEqual(['plugin', 'install', SUPERPOWERS_PLUGIN]);
    expect(stdoutOf()).toContain(`code-conductor: ${NOTICES.installed}`);
    expect(NOTICES.installed).toContain('/reload-plugins');
  });

  it('bounds a hanging CLI by the injected timeout', () => {
    const { home, cwd } = fresh();
    const pluginEnv = pathOnly(stubClaude(() => 'setTimeout(() => {}, 5000);\n'));
    const start = Date.now();
    const rc = install(['--with-plugins'], home, cwd, { pluginEnv, pluginTimeoutMs: 300 });
    expect(Date.now() - start).toBeLessThan(3000);
    expect(rc).toBe(0);
    expect(superpowersLines()).toEqual([`code-conductor: ${fallbackLine('timed out after 300ms')}`]);
    expect(stderrOf().some((l) => l.includes('unexpected error'))).toBe(false);
  });

  it('leaves the same files after two runs and does not ask or spawn the second time', () => {
    const { home, cwd } = fresh();
    const stubDir = stubClaude((dir) => `import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(join(dir, 'calls.log'))}, 'call\\n');
mkdirSync(${JSON.stringify(dirname(registryPath(home)))}, { recursive: true });
writeFileSync(${JSON.stringify(registryPath(home))}, JSON.stringify({ version: 2, plugins: { [${JSON.stringify(SUPERPOWERS_PLUGIN)}]: [{ scope: 'user' }] } }));
`);
    let asks = 0;
    const ask = () => { asks += 1; return 'y'; };
    const options = { isInteractive: true, ask, pluginEnv: pathOnly(stubDir) };
    const callLines = () => readFileSync(join(stubDir, 'calls.log'), 'utf8').split('\n').filter(Boolean);

    expect(install([], home, cwd, options)).toBe(0);
    expect(asks).toBe(1);
    expect(callLines()).toHaveLength(1);
    const snap1 = snapshot(home);

    expect(install([], home, cwd, options)).toBe(0);
    expect(asks).toBe(1);
    expect(callLines()).toHaveLength(1);
    expect(snapshot(home)).toEqual(snap1);
    expect(logs.filter((l) => l.startsWith('stdout:'))).toEqual([`stdout:code-conductor: ${NOTICES.already}`]);
  });
});

describe('docs name the plugin offer [FEAT-039]', () => {
  it('README and the wiki Getting-Started page document --with-plugins and the fallback', () => {
    for (const file of [join(ROOT, 'README.md'), join(ROOT, '.github', 'wiki', 'pages', 'Getting-Started.md')]) {
      expect(existsSync(file)).toBe(true);
      const text = readFileSync(file, 'utf8');
      expect(text).toContain('--with-plugins');
      expect(text).toContain('/plugin install superpowers@claude-plugins-official');
      expect(text).not.toContain('installs no dependencies');
    }
  });
});
