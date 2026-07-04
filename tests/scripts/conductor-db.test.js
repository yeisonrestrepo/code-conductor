import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../scripts/conductor-db.mjs', import.meta.url));

// The runner's Node needs the experimental flag only on 22.5.x–22.x; adding it
// on >=22.5 is harmless (accepted no-op on 23+). `--no-warnings` suppresses the
// `ExperimentalWarning: SQLite ...` stderr line (emitted on 22.5–22.x) so exact
// stderr assertions below hold on every Node. Mirrors the cc-implement hook flags.
const [maj, min] = process.versions.node.split('.').map(Number);
const NEEDS_FLAG = maj > 22 || (maj === 22 && min >= 5);
const FLAG = NEEDS_FLAG ? ['--experimental-sqlite', '--no-warnings'] : [];

// node:sqlite present on this runner? If not, the whole suite is meaningless.
let HAS_SQLITE = false;
try { execFileSync(process.execPath, [...FLAG, '-e', "require('node:sqlite')"], { stdio: 'ignore' }); HAS_SQLITE = true; } catch { /* skip below */ }

function runDb(args, { cwd, env } = {}) {
  return spawnSync(process.execPath, [...FLAG, SCRIPT, ...args], {
    cwd, encoding: 'utf8',
    env: env ?? process.env,
  });
}

// Reads rows back using an out-of-band DatabaseSync in the runner itself.
async function readRows(dbPath) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath);
  try { return db.prepare('SELECT plan_file, task_id, state, updated_at FROM task_state ORDER BY task_id').all(); }
  finally { db.close(); }
}

let repo;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), `cc-db-${randomUUID()}-`));
  execFileSync('git', ['init', '-q'], { cwd: repo });   // primary root path
});
afterEach(() => {
  // On Windows the db + `-wal`/`-shm` sidecars can stay briefly locked after the
  // child exits (delayed handle release), so a bare rmSync races and throws
  // EBUSY/EPERM. `maxRetries`/`retryDelay` (Node fs) back off, and the try/catch
  // makes teardown best-effort — a stuck temp dir must never fail an otherwise
  // green test. `os.tmpdir()` is reaped by the OS regardless.
  try {
    rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  } catch { /* leave it for the OS temp reaper; do not fail the suite */ }
});

describe.skipIf(!HAS_SQLITE)('conductor-db record (happy path)', () => {
  const dbPath = () => join(repo, '.conductor', 'cache.db');

  it('creates the db and records one row', async () => {
    const r = runDb(['record', 'plan.md', 'T-001', 'X'], { cwd: repo });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(existsSync(dbPath())).toBe(true);
    const rows = await readRows(dbPath());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ plan_file: 'plan.md', task_id: 'T-001', state: 'X' });
  });

  it('upserts: second record for same key replaces state, no duplicate row', async () => {
    runDb(['record', 'plan.md', 'T-001', '>'], { cwd: repo });
    runDb(['record', 'plan.md', 'T-001', 'X'], { cwd: repo });
    const rows = await readRows(dbPath());
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe('X');
  });

  it('updated_at is full-millisecond ISO-8601 UTC', async () => {
    runDb(['record', 'plan.md', 'T-001', 'X'], { cwd: repo });
    const [row] = await readRows(dbPath());
    expect(row.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('WAL journal_mode and user_version=1 are set', async () => {
    runDb(['record', 'plan.md', 'T-001', 'X'], { cwd: repo });
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath());
    try {
      expect(db.prepare('PRAGMA user_version').get().user_version).toBe(1);
      expect(String(db.prepare('PRAGMA journal_mode').get().journal_mode).toLowerCase()).toBe('wal');
    } finally { db.close(); }
  });

  it('stores a single-quote in plan_file/task_id verbatim (parameter-bound, no panic)', async () => {
    const r = runDb(['record', "it's-plan.md", "T-001'; DROP TABLE task_state;--", 'X'], { cwd: repo });
    expect(r.status).toBe(0);
    const rows = await readRows(dbPath());
    expect(rows).toHaveLength(1);
    expect(rows[0].plan_file).toBe("it's-plan.md");
    expect(rows[0].task_id).toBe("T-001'; DROP TABLE task_state;--");   // stored literally, not executed
  });
});

describe.skipIf(!HAS_SQLITE)('conductor-db record (input validation)', () => {
  const dbPath = () => join(repo, '.conductor', 'cache.db');

  it('rejects a state outside the enum: exit 0, warns, writes nothing', async () => {
    const r = runDb(['record', 'plan.md', 'T-001', 'Z'], { cwd: repo });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('CONDUCTOR_DB:');
    expect(r.stderr.toLowerCase()).toContain('state');
    expect(existsSync(dbPath()) ? await readRows(dbPath()) : []).toHaveLength(0);
  });

  it('rejects a multi-character state before the SQL CHECK (exact Set membership)', async () => {
    const r = runDb(['record', 'plan.md', 'T-001', 'XX'], { cwd: repo });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('CONDUCTOR_DB:');
    expect(r.stderr.toLowerCase()).toContain('state');
    expect(existsSync(dbPath()) ? await readRows(dbPath()) : []).toHaveLength(0);
  });

  it('rejects empty / whitespace-only task_id', async () => {
    const r = runDb(['record', 'plan.md', '   ', 'X'], { cwd: repo });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('CONDUCTOR_DB:');
    expect(existsSync(dbPath()) ? await readRows(dbPath()) : []).toHaveLength(0);
  });

  it('rejects a plan_file longer than 512 chars (not truncated)', async () => {
    const huge = 'a'.repeat(600);
    const r = runDb(['record', huge, 'T-001', 'X'], { cwd: repo });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('CONDUCTOR_DB:');
    expect(existsSync(dbPath()) ? await readRows(dbPath()) : []).toHaveLength(0);
  });

  it('trims a valid task_id before storing', async () => {
    runDb(['record', 'plan.md', '  T-007  ', 'X'], { cwd: repo });
    const rows = await readRows(dbPath());
    expect(rows[0].task_id).toBe('T-007');
  });

  it('applies the 512 cap AFTER trimming (surrounding whitespace does not count)', async () => {
    const padded = '  ' + 'T'.repeat(512) + '  ';   // 516 raw chars, 512 after trim
    const r = runDb(['record', 'plan.md', padded, 'X'], { cwd: repo });
    expect(r.status).toBe(0);
    const rows = await readRows(dbPath());
    expect(rows).toHaveLength(1);
    expect(rows[0].task_id.length).toBe(512);        // trimmed to exactly the cap, accepted
  });
});

describe.skipIf(!HAS_SQLITE)('conductor-db CLI discipline', () => {
  const dbPath = () => join(repo, '.conductor', 'cache.db');

  it('unknown subcommand: exit 0, one exact usage line, no db', async () => {
    const r = runDb(['frobnicate'], { cwd: repo });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    // Exactly one line, exact text (the token is JSON.stringify'd so it is quoted).
    expect(r.stderr).toBe(
      'CONDUCTOR_DB: unknown subcommand "frobnicate"; ' +
      'usage: conductor-db.mjs record <plan_file> <task_id> <state> | init\n'
    );
    expect(existsSync(dbPath())).toBe(false);
  });

  it('no subcommand at all: exit 0, usage line naming the empty subcommand', async () => {
    const r = runDb([], { cwd: repo });
    expect(r.status).toBe(0);
    // sub is undefined -> `sub ?? ''` -> JSON.stringify('') -> the empty quoted token.
    expect(r.stderr).toBe(
      'CONDUCTOR_DB: unknown subcommand ""; ' +
      'usage: conductor-db.mjs record <plan_file> <task_id> <state> | init\n'
    );
  });

  it('subcommand matching is case-sensitive: RECORD is unknown, not dispatched', async () => {
    const r = runDb(['RECORD', 'plan.md', 'T-001', 'X'], { cwd: repo });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe(
      'CONDUCTOR_DB: unknown subcommand "RECORD"; ' +
      'usage: conductor-db.mjs record <plan_file> <task_id> <state> | init\n'
    );
    expect(existsSync(dbPath())).toBe(false);   // never reached record's body
  });

  it('record with too few args: exit 0, usage warning, writes nothing', async () => {
    const r = runDb(['record', 'plan.md'], { cwd: repo });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('CONDUCTOR_DB:');
    expect(existsSync(dbPath()) ? await readRows(dbPath()) : []).toHaveLength(0);
  });

  it('record with too many args: exit 0, exact usage line, no db created', async () => {
    const r = runDb(['record', 'plan.md', 'T-001', 'X', 'extra'], { cwd: repo });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    // Strict `!== 3` reject, symmetric with init's `!== 0`; runs before any db work.
    expect(r.stderr).toBe(
      'CONDUCTOR_DB: usage: conductor-db.mjs record <plan_file> <task_id> <state> | init\n'
    );
    expect(existsSync(dbPath())).toBe(false);
  });

  it('init is silent on success and creates the db', async () => {
    const r = runDb(['init'], { cwd: repo });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(existsSync(dbPath())).toBe(true);
  });

  it('init with any trailing arg: exit 0, exact usage line, no db created', async () => {
    const r = runDb(['init', 'oops'], { cwd: repo });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe(
      'CONDUCTOR_DB: usage: conductor-db.mjs record <plan_file> <task_id> <state> | init\n'
    );
    // The arg-count guard runs BEFORE resolveRoot/withDb, so nothing is created.
    expect(existsSync(dbPath())).toBe(false);
  });
});
