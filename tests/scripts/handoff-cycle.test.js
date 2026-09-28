// The criterion that spans both halves of BUG-038: a plan-boundary session row,
// a checkpoint carry-forward, a v2 snapshot too large for the old cap, and a
// resume read that reports the phase the boundary actually wrote.
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sqliteAvailable, dbFlags } from '../helpers/sqlite.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DB = join(REPO_ROOT, 'scripts/conductor-db.mjs');
const BUILD = join(REPO_ROOT, 'scripts/snap-build.mjs');
const RESUME = join(REPO_ROOT, 'scripts/resume-read.mjs');

// The phase literals come from the command files, so a doc edit cannot silently
// drift from the behavior this test asserts.
function phaseFromTail(rel) {
  const text = readFileSync(join(REPO_ROOT, rel), 'utf8');
  const a = text.indexOf('<!-- SESSION-ROW-TAIL:BEGIN -->');
  const b = text.indexOf('<!-- SESSION-ROW-TAIL:END -->');
  const m = /conductor-db\.mjs session "\$id" "([^"]+)"/.exec(text.slice(a, b));
  return m && m[1];
}

const trees = [];
afterEach(() => { while (trees.length) { try { rmSync(trees.pop(), { recursive: true, force: true }); } catch {} } });

function mkRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'cycle-'));
  trees.push(dir);
  const g = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  g(['init', '-q']);
  g(['config', 'user.email', 't@t.t']);
  g(['config', 'user.name', 'T']);
  writeFileSync(join(dir, 'f'), 'x', 'utf8');
  writeFileSync(join(dir, '.gitignore'), '.conductor/\n', 'utf8');
  g(['add', '.']);
  g(['commit', '-q', '-m', 'init']);
  mkdirSync(join(dir, '.claude', 'memory'), { recursive: true });
  return { dir, head: g(['rev-parse', 'HEAD']).trim() };
}

const db = (dir, args, input) =>
  spawnSync(process.execPath, dbFlags().concat([DB, ...args]),
    { cwd: dir, input, encoding: 'utf8', env: process.env });

describe.skipIf(!sqliteAvailable())('the checkpoint-to-resume handoff cycle', () => {
  it('resumes the phase the boundary wrote, through a blob the old cap discarded', () => {
    const { dir, head } = mkRepo();
    const planPhase = phaseFromTail('.claude/commands/cc-plan.md');
    expect(planPhase).toBe('plan');

    // 1. The plan boundary writes its own session row (Task 4's tail).
    expect(db(dir, ['session', 'sess-1', planPhase, 'my-spec', head]).status).toBe(0);

    // 2. The checkpoint carry-forward reads the newest row.
    const got = db(dir, ['get-session', 'sess-1']);
    expect(got.status).toBe(0);
    expect(JSON.parse(got.stdout).phase).toBe(planPhase);

    // 3. It builds a v2 blob whose prose is far past the old 4096 cap.
    const prose = '## Checkpoint\n' + 'decision line\n'.repeat(500);
    const built = spawnSync(process.execPath, [BUILD], {
      input: JSON.stringify({ ph: planPhase, c: head, s: 'my-spec', n: ['next'], f: [], d: [], x: [], pr: prose }),
      encoding: 'utf8',
    });
    expect(built.status).toBe(0);
    const blob = built.stdout.trim();
    expect(blob.length).toBeGreaterThan(4096);
    expect(db(dir, ['snapshot', head], blob).status).toBe(0);

    // 4. The next phase entry resumes it instead of discarding it.
    const r = spawnSync(process.execPath, [RESUME], { cwd: dir, encoding: 'utf8', env: process.env });
    expect(r.status).toBe(0);
    const lines = r.stdout.split('\n');
    expect(lines[0]).toBe('RESUME_HIT');
    expect(lines).toContain('source: db');
    expect(lines).toContain(`phase: ${planPhase}`);
    expect(lines).toContain('version: 2');
    expect(lines).toContain('prose: available');
  });

  it('records the phase that just completed, not the one the last compaction left', () => {
    const { dir, head } = mkRepo();
    const implPhase = phaseFromTail('.claude/commands/cc-implement.md');
    expect(implPhase).toBe('impl');
    // spec (compact), then plan (the new tail), then impl (the new tail).
    db(dir, ['session', 'sess-2', 'spec', 'my-spec', head]);
    db(dir, ['session', 'sess-2', 'plan', 'my-spec', head]);
    db(dir, ['session', 'sess-2', implPhase, 'my-spec', head]);
    const got = db(dir, ['get-session', 'sess-2']);
    expect(JSON.parse(got.stdout).phase).toBe(implPhase);
  });

  // Skipped as root, where the permission bit this case depends on is not enforced.
  it.skipIf(process.getuid && process.getuid() === 0)(
    'survives a DB write failure at the boundary: no row, no crash, exit 0', () => {
      const { dir, head } = mkRepo();
      expect(head).toMatch(/^[0-9a-f]{40}$/);   // a real hash: the failure is the FS, not the input
      // An unwritable .conductor is the realistic tail failure; conductor-db is
      // fail-open by contract and must still exit 0 with its CONDUCTOR_DB: line.
      chmodSync(dir, 0o555);
      try {
        const r = db(dir, ['session', 'sess-3', 'plan', 'my-spec', head]);
        expect(r.status).toBe(0);
        expect(r.stderr).toContain('CONDUCTOR_DB:');
        const got = db(dir, ['get-session', 'sess-3']);
        expect(got.stdout).toBe('');   // the row really is absent
      } finally {
        chmodSync(dir, 0o755);         // restore, or afterEach cannot remove the tree
      }
    });
});
