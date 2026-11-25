import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORPUS, DIALECT } from '../fixtures/guard3-corpus.js';

// BUG-094: the Codex hook must enforce the guard from any start directory and block when the
// guard cannot run. Every case runs the command shipped in the template hooks.json through a
// platform shell, the way Codex does, with the PreToolUse payload on stdin.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE = join(REPO_ROOT, 'project-template');
const HOOKS_JSON = join(TEMPLATE, '.codex', 'hooks.json');
const ADAPTER = join(TEMPLATE, '.codex', 'hooks', 'conductor-guard.mjs');
const GUARD = join(TEMPLATE, '.claude', 'hooks', 'pre-tool-use.mjs');
const IS_WINDOWS = process.platform === 'win32';

const made = [];
let shared;

// A child environment that cannot inherit another checkout's allowlist or a guard switch.
function codexEnv(extra) {
  const env = { ...process.env };
  for (const k of ['CLAUDE_PROJECT_DIR', 'CC_HOOK_ALLOW', 'CC_GUARD3_WARN', 'CC_HOOK_DEBUG', 'CC_FLOW_OFF']) delete env[k];
  return { ...env, CC_FLOW_OFF: '1', ...extra };
}

// A project laid out the way `code-conductor --project --codex` leaves it.
function scaffold() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cc-codex-')));
  made.push(dir);
  mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true });
  mkdirSync(join(dir, '.claude', 'memory'), { recursive: true });
  mkdirSync(join(dir, '.codex', 'hooks'), { recursive: true });
  mkdirSync(join(dir, 'sub', 'deep'), { recursive: true });
  copyFileSync(GUARD, join(dir, '.claude', 'hooks', 'pre-tool-use.mjs'));
  copyFileSync(HOOKS_JSON, join(dir, '.codex', 'hooks.json'));
  copyFileSync(ADAPTER, join(dir, '.codex', 'hooks', 'conductor-guard.mjs'));
  return dir;
}

const commandOf = (dir) => JSON.parse(readFileSync(join(dir, '.codex', 'hooks.json'), 'utf8')).hooks.PreToolUse[0].hooks[0].command;
const payloadText = (cwd, command) => JSON.stringify({ cwd, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });

// Shells Codex may use; each returns [file, args, extra spawn options] for one command line.
const SHELLS = {
  'sh -c': (c) => ['sh', ['-c', c], {}],
  'cmd.exe /d /s /c': (c) => ['cmd.exe', ['/d', '/s', '/c', `"${c}"`], { windowsVerbatimArguments: true }],
  'powershell -NoProfile -Command': (c) => ['powershell', ['-NoProfile', '-Command', c], {}],
  'pwsh -NoProfile -Command': (c) => ['pwsh', ['-NoProfile', '-Command', c], {}],
};
const PLATFORM_SHELL = IS_WINDOWS ? 'cmd.exe /d /s /c' : 'sh -c';

function runIn(shell, command, cwd, input) {
  const [file, args, extra] = SHELLS[shell](command);
  return spawnSync(file, args, { cwd, input, encoding: 'utf8', timeout: 60000, env: codexEnv({}), ...extra });
}

// Returns the deny reason, '' on allow; fails the test on any other output shape.
function verdict(res) {
  expect(res.status).toBe(0);
  const out = res.stdout.trim();
  if (!out) return '';
  const reply = JSON.parse(out);
  expect(reply.hookSpecificOutput.permissionDecision).toBe('deny');
  return reply.hookSpecificOutput.permissionDecisionReason;
}

const hook = (dir, cwd, input) => verdict(runIn(PLATFORM_SHELL, commandOf(dir), cwd, input));
const hookCommand = (dir, cwd, command) => hook(dir, cwd, payloadText(cwd, command));

function claudeStdout(dir, input) {
  const res = spawnSync(process.execPath, [join(dir, '.claude', 'hooks', 'pre-tool-use.mjs')], {
    cwd: dir, input, encoding: 'utf8', timeout: 60000, env: codexEnv({ CLAUDE_PROJECT_DIR: dir }),
  });
  expect(res.status).toBe(0);
  return res.stdout;
}

beforeAll(() => {
  shared = scaffold();
});
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

describe('Codex hook command: shipped form (BUG-094)', () => {
  const command = commandOf(TEMPLATE);
  it('is node -e with one quoted body that avoids every character a shell rewrites', () => {
    const m = /^node -e "([ -~]*)"$/.exec(command);
    expect(m).not.toBeNull();
    for (const ch of ['"', '$', '`', '\\', '%', '!']) expect(m[1]).not.toContain(ch);
  });
  it('names the adapter and no longer names the cwd-relative guard', () => {
    expect(command).toContain('conductor-guard.mjs');
    expect(command).not.toContain('pre-tool-use.mjs');
  });
});

for (const [name, start] of [['the root', ''], ['a subdirectory', join('sub', 'deep')]]) {
  describe(`Codex hook: Guard 3 corpus from ${name} (BUG-094)`, () => {
    const rows = [...CORPUS, ...DIALECT].filter((r) => (r.toolName ?? 'Bash') === 'Bash');
    it.each(rows.map((r) => [r.label, r]))('%s', (_label, row) => {
      const allowlist = join(shared, '.claude', 'memory', 'bash-scan-allowlist.txt');
      writeFileSync(allowlist, row.allowlist && row.allowlist.length ? row.allowlist.join('\n') + '\n' : '', 'utf8');
      const cwd = join(shared, start);
      const input = payloadText(cwd, row.command);
      const res = runIn(PLATFORM_SHELL, commandOf(shared), cwd, input);
      expect(res.status).toBe(0);
      expect(res.stdout).toBe(claudeStdout(shared, input));
      if (row.verdict === 'deny') expect(res.stdout).toMatch(/BASH SCAN BLOCKED/);
    });
  });
}

describe('Codex hook: shell matrix (BUG-094)', () => {
  const probe = (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;
  const available = {
    'sh -c': !IS_WINDOWS,
    'cmd.exe /d /s /c': IS_WINDOWS,
    'powershell -NoProfile -Command': IS_WINDOWS,
    'pwsh -NoProfile -Command': IS_WINDOWS && probe('pwsh', ['-NoProfile', '-NonInteractive', '-Command', 'exit 0']),
  };
  for (const shell of Object.keys(SHELLS)) {
    it.skipIf(!available[shell])(`${shell} denies a deny row and allows an allow row from a subdirectory`, () => {
      const cwd = join(shared, 'sub', 'deep');
      const command = commandOf(shared);
      writeFileSync(join(shared, '.claude', 'memory', 'bash-scan-allowlist.txt'), '', 'utf8');
      expect(verdict(runIn(shell, command, cwd, payloadText(cwd, 'cat *.log')))).toMatch(/BASH SCAN BLOCKED/);
      expect(verdict(runIn(shell, command, cwd, payloadText(cwd, 'echo probe-ok')))).toBe('');
    });
  }
});

describe('Codex hook: shadowing and nested layers (BUG-094)', () => {
  const ALLOW_ALL = "process.exit(0);\n";
  it('ignores a guard that sits alone in a subdirectory', () => {
    const dir = scaffold();
    try {
      mkdirSync(join(dir, 'sub', '.claude', 'hooks'), { recursive: true });
      writeFileSync(join(dir, 'sub', '.claude', 'hooks', 'pre-tool-use.mjs'), ALLOW_ALL);
      expect(hookCommand(dir, join(dir, 'sub'), 'cat *.log')).toMatch(/BASH SCAN BLOCKED/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  function nestedLayer(dir) {
    const sub = join(dir, 'sub');
    mkdirSync(join(sub, '.claude', 'hooks'), { recursive: true });
    mkdirSync(join(sub, '.codex', 'hooks'), { recursive: true });
    writeFileSync(join(sub, '.claude', 'hooks', 'pre-tool-use.mjs'), ALLOW_ALL);
    copyFileSync(HOOKS_JSON, join(sub, '.codex', 'hooks.json'));
    copyFileSync(ADAPTER, join(sub, '.codex', 'hooks', 'conductor-guard.mjs'));
    return sub;
  }
  it('judges a complete nested layer by its own guard (accepted residual risk)', () => {
    const dir = scaffold();
    try {
      expect(hookCommand(dir, nestedLayer(dir), 'cat *.log')).toBe('');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('blocks a nested hooks.json that has no adapter beside it, naming that path', () => {
    const dir = scaffold();
    try {
      const sub = nestedLayer(dir);
      rmSync(join(sub, '.codex', 'hooks', 'conductor-guard.mjs'));
      expect(hookCommand(dir, sub, 'cat *.log')).toContain(join(sub, '.codex', 'hooks', 'conductor-guard.mjs'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('Codex hook: fails closed (BUG-094)', () => {
  const withProject = (fn) => {
    const dir = scaffold();
    try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  const guardPath = (dir) => join(dir, '.claude', 'hooks', 'pre-tool-use.mjs');
  const run = (dir, command = 'echo hi') => hookCommand(dir, dir, command);

  it('blocks when no .codex/hooks.json exists in the start directory or above', () => {
    const command = commandOf(shared);
    const bare = realpathSync(mkdtempSync(join(tmpdir(), 'cc-codex-bare-')));
    made.push(bare);
    for (let d = bare; ; d = dirname(d)) {
      if (existsSync(join(d, '.codex', 'hooks.json'))) throw new Error(`precondition failed: ${d} holds .codex/hooks.json`);
      if (dirname(d) === d) break;
    }
    expect(parse(bare).root).toBeTruthy();
    expect(verdict(runIn(PLATFORM_SHELL, command, bare, payloadText(bare, 'echo hi')))).toContain('no .codex/hooks.json');
  });
  it('blocks when the adapter is missing, naming its path', () => withProject((dir) => {
    rmSync(join(dir, '.codex', 'hooks', 'conductor-guard.mjs'));
    expect(run(dir)).toContain(join(dir, '.codex', 'hooks', 'conductor-guard.mjs'));
  }));
  it('blocks when the adapter has a syntax error', () => withProject((dir) => {
    writeFileSync(join(dir, '.codex', 'hooks', 'conductor-guard.mjs'), 'export function main( {\n');
    expect(run(dir)).toContain('could not run');
  }));
  it('blocks when the guard is missing, naming it', () => withProject((dir) => {
    rmSync(guardPath(dir));
    expect(run(dir)).toContain('pre-tool-use.mjs');
  }));
  it('blocks when the guard prints something that is not JSON', () => withProject((dir) => {
    writeFileSync(guardPath(dir), "process.stdout.write('not json');\n");
    expect(run(dir)).toContain('not a JSON object');
  }));
  it('blocks when the guard prints JSON that is not an object', () => withProject((dir) => {
    writeFileSync(guardPath(dir), "process.stdout.write('5');\n");
    expect(run(dir)).toContain('not a JSON object');
  }));
  it('blocks when the guard exits non-zero, naming the status', () => withProject((dir) => {
    writeFileSync(guardPath(dir), 'process.exit(3);\n');
    expect(run(dir)).toContain('exit 3');
  }));
  it('blocks stdin that is not JSON', () => withProject((dir) => {
    expect(hook(dir, dir, 'not json')).toContain('could not read');
  }));
  it('blocks empty stdin', () => withProject((dir) => {
    expect(hook(dir, dir, '')).toContain('could not read');
  }));
});
