import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
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
