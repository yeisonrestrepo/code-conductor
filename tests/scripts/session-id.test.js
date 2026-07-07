import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const SCRIPT = fileURLToPath(new URL('../../scripts/session-id.mjs', import.meta.url));
const NO_GIT_ENV = { ...process.env, PATH: '' };
delete NO_GIT_ENV.CLAUDE_CODE_SESSION_ID;
const dirs = [];
function repo() { const d = mkdtempSync(join(tmpdir(), 'sid-')); dirs.push(d); mkdirSync(join(d, '.git')); return d; }
function run(cwd, env) { return spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8', env: env ?? process.env }); }
afterEach(() => { while (dirs.length) { try { rmSync(dirs.pop(), { recursive: true }); } catch {} } });

describe('session-id.mjs', () => {
  it('prints CLAUDE_CODE_SESSION_ID verbatim when set', () => {
    const cwd = repo();
    const r = run(cwd, { ...process.env, CLAUDE_CODE_SESSION_ID: 'sess-123' });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('sess-123');
    expect(existsSync(join(cwd, '.conductor', 'session-id'))).toBe(false); // env path is cacheless
  });

  it('generates and persists a UUID when env is unset', () => {
    const cwd = repo();
    const env = { ...process.env }; delete env.CLAUDE_CODE_SESSION_ID;
    const r = run(cwd, env);
    expect(r.status).toBe(0);
    const id = r.stdout.trim();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(readFileSync(join(cwd, '.conductor', 'session-id'), 'utf8').trim()).toBe(id);
  });

  it('returns the cached id on the second invocation', () => {
    const cwd = repo();
    const env = { ...process.env }; delete env.CLAUDE_CODE_SESSION_ID;
    const first = run(cwd, env).stdout.trim();
    const second = run(cwd, env).stdout.trim();
    expect(second).toBe(first);
  });

  it('prefers a pre-existing cache file over generating', () => {
    const cwd = repo();
    mkdirSync(join(cwd, '.conductor'));
    writeFileSync(join(cwd, '.conductor', 'session-id'), 'cached-xyz\n');
    const env = { ...process.env }; delete env.CLAUDE_CODE_SESSION_ID;
    expect(run(cwd, env).stdout.trim()).toBe('cached-xyz');
  });

  it('no-git fallback: script-dir parent is root at scripts/ (dev checkout)', () => {
    const tree = mkdtempSync(join(tmpdir(), `sid-nogit-${randomUUID()}-`));
    dirs.push(tree);
    const scriptsDir = join(tree, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    cpSync(SCRIPT, join(scriptsDir, 'session-id.mjs'));
    const r = spawnSync(process.execPath, [join(scriptsDir, 'session-id.mjs')],
      { cwd: scriptsDir, encoding: 'utf8', env: NO_GIT_ENV });
    expect(r.status).toBe(0);
    expect(existsSync(join(tree, '.conductor', 'session-id'))).toBe(true);
  });

  it('no-git fallback: goes up one extra level when deployed under .claude/scripts', () => {
    const tree = mkdtempSync(join(tmpdir(), `sid-nogit-claude-${randomUUID()}-`));
    dirs.push(tree);
    const scriptsDir = join(tree, '.claude', 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    cpSync(SCRIPT, join(scriptsDir, 'session-id.mjs'));
    const r = spawnSync(process.execPath, [join(scriptsDir, 'session-id.mjs')],
      { cwd: scriptsDir, encoding: 'utf8', env: NO_GIT_ENV });
    expect(r.status).toBe(0);
    expect(existsSync(join(tree, '.conductor', 'session-id'))).toBe(true);
    expect(existsSync(join(tree, '.claude', '.conductor'))).toBe(false);
  });
});
