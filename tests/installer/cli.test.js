import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../bin/code-conductor.mjs';

const binPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'code-conductor.mjs');
let home, cwd, logs;
const log = (stream, msg) => logs.push(`${stream}:${msg}`);
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cc-run-h-'));
  cwd = mkdtempSync(join(tmpdir(), 'cc-run-c-'));
  logs = [];
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); rmSync(cwd, { recursive: true, force: true }); });

describe('run', () => {
  it('deploys the global set and exits 0', () => {
    const rc = run([], { HOME: home }, { cwd, log });
    expect(rc).toBe(0);
    expect(existsSync(join(home, '.claude', 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(home, '.claude', 'skills'))).toBe(true);
    expect(existsSync(join(home, '.claude', 'settings.json'))).toBe(true);
    expect(readFileSync(join(home, '.claude', 'memory', 'conductor-version.md'), 'utf8').trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it('registers the verbosity hook idempotently across two runs', () => {
    run([], { HOME: home }, { cwd, log });
    run([], { HOME: home }, { cwd, log });
    const s = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
    const hits = s.hooks.UserPromptSubmit.filter(e => e.hooks.some(h => h.command.includes('verbosity-remind.sh')));
    expect(hits).toHaveLength(1);
  });
  it('with --project also deploys into cwd/.claude', () => {
    const rc = run(['--project'], { HOME: home }, { cwd, log });
    expect(rc).toBe(0);
    expect(existsSync(join(cwd, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(cwd, '.claude', '.claude'))).toBe(false);
    expect(existsSync(join(cwd, '.claude', 'commands'))).toBe(true);
  });
  it('exits 1 when the --project target exists as a non-directory file', () => {
    writeFileSync(join(cwd, '.claude'), 'i am a file');
    const rc = run(['--project'], { HOME: home }, { cwd, log });
    expect(rc).toBe(1);
    expect(logs.some(l => l.startsWith('stderr:') && /not a directory/.test(l))).toBe(true);
  });
  it('exits 1 when home cannot be resolved', () => {
    const rc = run([], {}, { cwd, log });
    expect(rc).toBe(1);
    expect(logs.some(l => l.startsWith('stderr:') && /home/i.test(l))).toBe(true);
  });
  it('exits 1 on Node below the >=20 floor', () => {
    const rc = run([], { HOME: home, node: '18.19.1' }, { cwd, log });
    expect(rc).toBe(1);
    expect(logs.some(l => l.startsWith('stderr:') && /Node >=20/.test(l))).toBe(true);
    expect(existsSync(join(home, '.claude'))).toBe(false);
  });
  it('exits 2 on a mid-copy write failure (PARTIAL_WRITE)', () => {
    // Plant a plain FILE at <home>/.claude so mkdirSync(target) throws EEXIST
    // after pre-flight passed — the copy phase has begun → exit 2.
    writeFileSync(join(home, '.claude'), 'not a dir');
    const rc = run([], { HOME: home }, { cwd, log });
    expect(rc).toBe(2);
    expect(logs.some(l => l.startsWith('stderr:') && /PARTIAL_WRITE/.test(l))).toBe(true);
  });
  it('is silent on stdout at MIN (no informational output)', () => {
    run([], { HOME: home }, { cwd, log });
    expect(logs.filter(l => l.startsWith('stdout:'))).toHaveLength(0);
  });
  it('warns but succeeds on an invalid --verbosity', () => {
    const rc = run(['--verbosity', 'loud'], { HOME: home }, { cwd, log });
    expect(rc).toBe(0);
    expect(logs.some(l => l.startsWith('stderr:') && /invalid/i.test(l))).toBe(true);
  });
  it('treats a trailing --verbosity with no value as invalid, not a crash', () => {
    const rc = run(['--verbosity'], { HOME: home }, { cwd, log });
    expect(rc).toBe(0);
    expect(readFileSync(join(home, '.claude', 'memory', 'verbosity.md'), 'utf8')).toMatch(/VERBOSITY: MIN/);
  });
  it('accepts the inline --verbosity=LEVEL form', () => {
    const rc = run(['--verbosity=INFO'], { HOME: home }, { cwd, log });
    expect(rc).toBe(0);
    expect(readFileSync(join(home, '.claude', 'memory', 'verbosity.md'), 'utf8')).toMatch(/VERBOSITY: INFO/);
  });
  it('tolerates whitespace inside the inline value', () => {
    run(['--verbosity= VERBOSE '], { HOME: home }, { cwd, log });
    expect(readFileSync(join(home, '.claude', 'memory', 'verbosity.md'), 'utf8')).toMatch(/VERBOSITY: VERBOSE/);
  });
  it('resolves conflicting --verbosity flags last-wins', () => {
    run(['--verbosity', 'MIN', '--verbosity', 'VERBOSE'], { HOME: home }, { cwd, log });
    expect(readFileSync(join(home, '.claude', 'memory', 'verbosity.md'), 'utf8')).toMatch(/VERBOSITY: VERBOSE/);
  });
  it('prints the version and exits 0 for --version', () => {
    const rc = run(['--version'], { HOME: home }, { cwd, log });
    expect(rc).toBe(0);
    expect(logs.some(l => l.startsWith('stdout:') && /\d+\.\d+\.\d+/.test(l))).toBe(true);
  });
  it('warns but still succeeds on unrecognized flags', () => {
    const rc = run(['--bogus', 'stray'], { HOME: home }, { cwd, log });
    expect(rc).toBe(0);
    expect(logs.some(l => l.startsWith('stderr:') && /unrecognized/.test(l) && /--bogus/.test(l))).toBe(true);
    expect(existsSync(join(home, '.claude', 'CLAUDE.md'))).toBe(true);
  });
  it('deploys correctly into a home path that contains spaces', () => {
    const spaced = mkdtempSync(join(tmpdir(), 'cc has space-'));
    const rc = run(['--project'], { HOME: spaced }, { cwd: spaced, log });
    expect(rc).toBe(0);
    expect(existsSync(join(spaced, '.claude', 'CLAUDE.md'))).toBe(true);
    const s = JSON.parse(readFileSync(join(spaced, '.claude', 'settings.json'), 'utf8'));
    // the bash hook command embeds the spaced path unmodified (fs handles it natively).
    expect(s.hooks.UserPromptSubmit.some(e => e.hooks.some(h => h.command.includes('verbosity-remind.sh')))).toBe(true);
    rmSync(spaced, { recursive: true, force: true });
  });
});

describe('committed entry script', () => {
  it('carries the executable bit', () => {
    if (process.platform === 'win32') return;
    expect(statSync(binPath).mode & 0o111).toBeGreaterThan(0);
  });
  it('starts with the node shebang', () => {
    expect(readFileSync(binPath, 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);
  });
});
