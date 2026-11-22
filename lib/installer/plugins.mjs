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
    // cwd is our empty temp dir: cmd.exe (and a PATH holding '.') resolves a bare `claude`
    // from the current directory first, so a claude.cmd committed to the project must not run.
    const options = { stdio: ['ignore', fds[0], fds[1]], timeout: timeoutMs, windowsHide: true, env, cwd: dir };
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

// Never throws: like the installer heal, every outcome is a status plus lines for bin to emit.
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
