import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../scripts/resume-read.mjs', import.meta.url));
const HANDOFF_REL = '.claude/memory/session-snapshot.json';
const LEGACY_REL = '.claude/memory/session-snapshot.md';

const repos = [];
afterEach(() => { while (repos.length) { try { rmSync(repos.pop(), { recursive: true, force: true }); } catch {} } });

// A real one-commit git repo so `git rev-parse HEAD` yields a deterministic, controllable hash.
function mkRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'resume-'));
  repos.push(dir);
  const g = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  g(['init', '-q']);
  g(['config', 'user.email', 't@t.t']);
  g(['config', 'user.name', 'T']);
  writeFileSync(join(dir, 'f'), 'x', 'utf8');
  writeFileSync(join(dir, '.gitignore'), '.conductor/\n', 'utf8'); // mirror production: DB is never tracked
  g(['add', '.']);
  g(['commit', '-q', '-m', 'init']);
  const head = g(['rev-parse', 'HEAD']).trim();
  mkdirSync(join(dir, '.claude', 'memory'), { recursive: true });
  return { dir, head };
}
function run(dir) {
  return spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8', env: process.env });
}
function writeHandoff(dir, obj) { writeFileSync(join(dir, HANDOFF_REL), JSON.stringify(obj) + '\n', 'utf8'); }
function snap(head, extra = {}) {
  return { v: 1, sys: { ph: 'plan', c: head, s: 'my-spec' }, ops: { n: ['do a', 'do b'], f: [] }, mem: { d: [], x: [] }, ...extra };
}

describe('resume-read.mjs core (file branch)', () => {
  it('total miss: no DB, no handoff → exit 3, zero bytes on stdout', () => {
    const { dir } = mkRepo();
    const r = run(dir);
    expect(r.status).toBe(3);
    expect(r.stdout).toBe('');
  });

  it('valid, hash-matching handoff → binds, unlinks, exit 0, RESUME_HIT block', () => {
    const { dir, head } = mkRepo();
    writeHandoff(dir, snap(head));
    const r = run(dir);
    expect(r.status).toBe(0);
    const lines = r.stdout.split('\n');
    expect(lines[0]).toBe('RESUME_HIT');
    expect(lines).toContain('source: file');
    expect(lines).toContain('commit: ' + head);
    expect(lines).toContain('phase: plan');
    expect(lines).toContain('spec: my-spec');
    expect(lines).toContain('version: 1');
    expect(lines).toContain('prose: none');
    expect(lines).toContain('pending:');
    expect(lines).toContain('- do a');
    expect(lines).toContain('- do b');
    expect(existsSync(join(dir, HANDOFF_REL))).toBe(false); // unlinked after bind
  });

  it('v2 handoff with pr → prose: available', () => {
    const { dir, head } = mkRepo();
    writeHandoff(dir, snap(head, { v: 2, pr: 'a note' }));
    const r = run(dir);
    expect(r.status).toBe(0);
    expect(r.stdout.split('\n')).toContain('prose: available');
  });

  it('readable + non-empty + invalid handoff → exit 4, file left on disk', () => {
    const { dir } = mkRepo();
    writeFileSync(join(dir, HANDOFF_REL), '{ not valid json', 'utf8');
    const r = run(dir);
    expect(r.status).toBe(4);
    expect(r.stdout).toBe('');
    expect(existsSync(join(dir, HANDOFF_REL))).toBe(true);
  });

  it('empty handoff → degrade to miss (exit 3), file deleted, no halt', () => {
    const { dir } = mkRepo();
    writeFileSync(join(dir, HANDOFF_REL), '   \n', 'utf8');
    const r = run(dir);
    expect(r.status).toBe(3);
    expect(r.stdout).toBe('');
    expect(existsSync(join(dir, HANDOFF_REL))).toBe(false);
  });

  it('valid but hash-stale handoff → not bound, deleted, exit 3', () => {
    const { dir } = mkRepo();
    writeHandoff(dir, snap('b'.repeat(40))); // sys.c != current HEAD
    const r = run(dir);
    expect(r.status).toBe(3);
    expect(r.stdout).toBe('');
    expect(existsSync(join(dir, HANDOFF_REL))).toBe(false);
  });

  it('legacy .md is swept unread (best-effort), does not bind', () => {
    const { dir } = mkRepo();
    writeFileSync(join(dir, LEGACY_REL), '# old handoff', 'utf8');
    const r = run(dir);
    expect(r.status).toBe(3);
    expect(existsSync(join(dir, LEGACY_REL))).toBe(false);
  });

  it('writes an ISO-timestamped resume: trace line to .conductor/last-write.log', () => {
    const { dir, head } = mkRepo();
    writeHandoff(dir, snap(head));
    run(dir);
    const log = readFileSync(join(dir, '.conductor', 'last-write.log'), 'utf8');
    expect(log).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z resume: file-bind\+unlink$/m);
  });

  it('uses only Node-14-compatible syntax (no ||=/&&=/??=/.at(/structuredClone)', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src).not.toMatch(/\|\|=|&&=|\?\?=/);
    expect(src).not.toMatch(/\.at\(/);
    expect(src).not.toMatch(/structuredClone/);
  });
});

import { sqliteAvailable, dbFlags } from '../helpers/sqlite.js';
const DB = fileURLToPath(new URL('../../scripts/conductor-db.mjs', import.meta.url));
// Store a snapshot blob for a hash via the real conductor-db writer, into the repo's .conductor/cache.db.
function dbStore(dir, hash, obj) {
  const args = dbFlags().concat([DB, 'snapshot', hash]);
  const r = spawnSync(process.execPath, args, { cwd: dir, input: JSON.stringify(obj), encoding: 'utf8', env: process.env });
  expect(r.status).toBe(0);
}

describe.runIf(sqliteAvailable())('resume-read.mjs DB branch', () => {
  it('DB hit + valid blob → source: db, deletes handoff, exit 0', () => {
    const { dir, head } = mkRepo();
    dbStore(dir, head, snap(head, { sys: { ph: 'impl', c: head, s: 'db-spec' }, ops: { n: ['db pending'], f: [] } }));
    writeHandoff(dir, snap(head)); // present but superseded
    const r = run(dir);
    expect(r.status).toBe(0);
    const lines = r.stdout.split('\n');
    expect(lines[0]).toBe('RESUME_HIT');
    expect(lines).toContain('source: db');
    expect(lines).toContain('phase: impl');
    expect(lines).toContain('spec: db-spec');
    expect(lines).toContain('- db pending');
    expect(existsSync(join(dir, HANDOFF_REL))).toBe(false); // handoff deleted as superseded
    expect(existsSync(join(dir, '.conductor', 'cache.db'))).toBe(true); // non-destructive read
  });

  it('DB miss + valid handoff → falls through to file branch (source: file)', () => {
    const { dir, head } = mkRepo();
    writeHandoff(dir, snap(head));
    const r = run(dir);
    expect(r.status).toBe(0);
    expect(r.stdout.split('\n')).toContain('source: file');
  });

  it('branch-switch isolation: context stored at A is restored at A, absent at B', () => {
    const { dir, head } = mkRepo(); // commit A = head
    const g = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    dbStore(dir, head, snap(head, { sys: { ph: 'plan', c: head, s: 'branch-a' } }));
    // switch to a NEW commit B with no stored snapshot
    g(['checkout', '-q', '-b', 'other']);
    writeFileSync(join(dir, 'f2'), 'y', 'utf8');
    g(['add', '.']);
    g(['commit', '-q', '-m', 'B']);
    const rB = run(dir);
    expect(rB.status).toBe(3); // miss at B - no leak from A
    // switch back to A → restored
    g(['checkout', '-q', '-']);
    const rA = run(dir);
    expect(rA.status).toBe(0);
    expect(rA.stdout.split('\n')).toContain('spec: branch-a');
  });

  it('non-destructive: two successive reads at the same commit both hit', () => {
    const { dir, head } = mkRepo();
    dbStore(dir, head, snap(head, { sys: { ph: 'plan', c: head, s: 's' } }));
    expect(run(dir).status).toBe(0);
    expect(run(dir).status).toBe(0);
  });
});

describe('resume-read.mjs root resolution fallbacks (no git)', () => {
  const NO_GIT_ENV = { ...process.env, PATH: '' };

  it('tier 3: script-dir parent is root at scripts/ (dev checkout)', () => {
    const tree = mkdtempSync(join(tmpdir(), 'resume-nogit-'));
    repos.push(tree);
    const scriptsDir = join(tree, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    cpSync(SCRIPT, join(scriptsDir, 'resume-read.mjs'));
    const r = spawnSync(process.execPath, [join(scriptsDir, 'resume-read.mjs')],
      { cwd: scriptsDir, encoding: 'utf8', env: NO_GIT_ENV });
    expect(r.status).toBe(3); // total miss, but proves the trace file lands at the right root
    expect(existsSync(join(tree, '.conductor', 'last-write.log'))).toBe(true);
  });

  it('tier 3: goes up one extra level when deployed under .claude/scripts', () => {
    const tree = mkdtempSync(join(tmpdir(), 'resume-nogit-claude-'));
    repos.push(tree);
    const scriptsDir = join(tree, '.claude', 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    cpSync(SCRIPT, join(scriptsDir, 'resume-read.mjs'));
    const r = spawnSync(process.execPath, [join(scriptsDir, 'resume-read.mjs')],
      { cwd: scriptsDir, encoding: 'utf8', env: NO_GIT_ENV });
    expect(r.status).toBe(3);
    expect(existsSync(join(tree, '.conductor', 'last-write.log'))).toBe(true);
    expect(existsSync(join(tree, '.claude', '.conductor'))).toBe(false);
  });
});
