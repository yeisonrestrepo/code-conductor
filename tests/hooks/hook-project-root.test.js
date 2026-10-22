import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE_HOOK = join(REPO_ROOT, 'project-template/.claude/hooks/pre-tool-use.mjs');
const COMMAND = JSON.parse(readFileSync(join(REPO_ROOT, 'project-template/.claude/settings.json'), 'utf8'))
  .hooks.PreToolUse[0].hooks[0].command;
const ROOTED = 'process.env.CLAUDE_PROJECT_DIR || process.cwd()';
const INLINE = /^node -e "([^"]+)"$/;
const HAS_BASH = !spawnSync('bash', ['--version'], { stdio: 'pipe', timeout: 5000 }).error;

// The registered command is run the way Claude Code runs it, through a shell, and its
// inline script is also run with no shell at all, which is what cmd or PowerShell amount
// to for a command that carries no expansion syntax. The root has a space in its path
// because Windows home directories often do. [BUG-061]
let base, root, sub;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'cc root-'));
  root = join(base, 'my project');
  sub = join(root, 'src', 'deep');
  mkdirSync(join(root, '.claude', 'hooks'), { recursive: true });
  mkdirSync(sub, { recursive: true });
  copyFileSync(TEMPLATE_HOOK, join(root, '.claude', 'hooks', 'pre-tool-use.mjs'));
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const writeAllowlist = (dir, entries) => {
  mkdirSync(join(dir, '.claude', 'memory'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'memory', 'bash-scan-allowlist.txt'), entries.join('\n') + '\n', 'utf8');
};

// Strip every variable that could steer the hook, then set only what the test names.
function runHook({ cwd, projectDir, command = 'cat docs/*.md', viaShell = true }) {
  const env = { ...process.env };
  for (const k of ['CLAUDE_PROJECT_DIR', 'CC_HOOK_ALLOW', 'CC_GUARD3_WARN']) delete env[k];
  if (projectDir !== undefined) env.CLAUDE_PROJECT_DIR = projectDir;
  const [file, args] = viaShell ? ['bash', ['-c', COMMAND]] : [process.execPath, ['-e', COMMAND.match(INLINE)[1]]];
  const r = spawnSync(file, args, {
    cwd, env, encoding: 'utf8', timeout: 15000,
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
  });
  if (r.error) throw new Error(`hook spawn failed: ${r.error.message}`);
  const out = r.stdout.trim();
  return { status: r.status, stderr: r.stderr, decision: out === '' ? null : JSON.parse(out).hookSpecificOutput };
}

describe.skipIf(!HAS_BASH)('[BUG-061] hook resolves against CLAUDE_PROJECT_DIR', () => {
  it('[BUG-061] AC2 loads the hook from a subdirectory cwd', () => {
    const r = runHook({ cwd: sub, projectDir: root });
    expect(r.stderr).not.toMatch(/MODULE_NOT_FOUND|Cannot find module/);
    expect(r.status).toBe(0);
    expect(r.decision.permissionDecision).toBe('deny');
  });

  it('[BUG-061] AC3 honours the root allowlist from a subdirectory cwd', () => {
    writeAllowlist(root, ['docs/']);
    const r = runHook({ cwd: sub, projectDir: root });
    expect(r.status).toBe(0);
    expect(r.decision).toBeNull();
  });

  it('[BUG-061] AC3 denies the same command when no root entry covers it', () => {
    writeAllowlist(root, ['src/']);
    const r = runHook({ cwd: sub, projectDir: root });
    expect(r.status).toBe(0);
    expect(r.decision.permissionDecision).toBe('deny');
    expect(r.decision.permissionDecisionReason).toMatch(/BASH SCAN BLOCKED/);
  });

  it('[BUG-061] reads the root allowlist, not one in the subdirectory cwd', () => {
    writeAllowlist(sub, ['docs/']);
    const r = runHook({ cwd: sub, projectDir: root });
    expect(r.status).toBe(0);
    expect(r.decision.permissionDecision).toBe('deny');
  });

  it('[BUG-061] AC4 falls back to cwd when CLAUDE_PROJECT_DIR is unset', () => {
    writeAllowlist(root, ['docs/']);
    const r = runHook({ cwd: root });
    expect(r.status).toBe(0);
    expect(r.decision).toBeNull();
  });
});

describe('[BUG-061] allowlist root in both hook copies', () => {
  it.each(['.claude/hooks/pre-tool-use.mjs', 'project-template/.claude/hooks/pre-tool-use.mjs'])(
    '[BUG-061] AC6 %s roots the allowlist at CLAUDE_PROJECT_DIR', (rel) => {
      const src = readFileSync(join(REPO_ROOT, rel), 'utf8');
      expect(src).toContain(`readFileSync(join(${ROOTED}, ...G3_ALLOWLIST_REL), 'utf8')`);
    });
});

describe('[BUG-061] command runs under any shell', () => {
  it('[BUG-061] the command carries no shell expansion syntax', () => {
    expect(COMMAND).toMatch(INLINE);
    expect(COMMAND).not.toMatch(/[$%`^]/);
  });

  // The deny half proves the hook loaded, so the allow half cannot pass on a script
  // that imported nothing.
  it('[BUG-061] the inline script roots the allowlist with no shell from a subdirectory cwd', () => {
    expect(runHook({ cwd: sub, projectDir: root, viaShell: false }).decision.permissionDecision).toBe('deny');
    writeAllowlist(root, ['docs/']);
    const r = runHook({ cwd: sub, projectDir: root, viaShell: false });
    expect(r.status).toBe(0);
    expect(r.decision).toBeNull();
  });
});
