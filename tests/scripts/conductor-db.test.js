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

import { mkdirSync, realpathSync } from 'node:fs';

describe.skipIf(!HAS_SQLITE)('conductor-db plan_file normalization', () => {
  const dbPath = () => join(repo, '.conductor', 'cache.db');

  it('same plan from two different CWDs yields exactly one row', async () => {
    const nested = join(repo, 'a', 'b', 'c');
    mkdirSync(nested, { recursive: true });
    // Canonicalize the root: on macOS os.tmpdir() is the /var symlink while git's
    // toplevel (and the child's process.cwd()) are the physical /private/var path.
    // An absolute plan arg in symlink form would not be realpath'd by path.resolve,
    // producing a cross-namespace key that never dedups. The real hook passes
    // repo-relative paths (always physical via cwd), so this only affects the test.
    const plan = join(realpathSync(repo), 'docs', 'plan.md');

    // Absolute path from repo root, then the same plan referenced from a deep CWD.
    runDb(['record', plan, 'T-001', '>'], { cwd: repo });
    runDb(['record', '../../../docs/plan.md', 'T-001', 'X'], { cwd: nested });

    const rows = await readRows(dbPath());
    expect(rows).toHaveLength(1);
    expect(rows[0].plan_file).toBe('docs/plan.md');   // repo-relative POSIX
    expect(rows[0].state).toBe('X');
  });

  it('a plan resolving outside the root is stored verbatim (../ key), not rejected', async () => {
    // Reference a file one level above the repo root: normalization yields a
    // leading `../`. Per the outside-root constraint this is accepted and stored,
    // subject only to the empty/512-char caps.
    const r = runDb(['record', '../outside-plan.md', 'T-001', 'X'], { cwd: repo });
    expect(r.status).toBe(0);
    const rows = await readRows(dbPath());
    expect(rows).toHaveLength(1);
    expect(rows[0].plan_file.startsWith('../')).toBe(true);
  });
});

import { cpSync } from 'node:fs';

const NO_GIT_ENV = { ...process.env, PATH: '' };

describe.skipIf(!HAS_SQLITE)('conductor-db root resolution fallbacks', () => {
  it('Fallback A: finds repo root via .git walk when git is unavailable', async () => {
    // repo already has a real .git (from beforeEach git init). Disable git and
    // run from a deep subdir; the walk must climb to `repo`.
    const nested = join(repo, 'x', 'y');
    mkdirSync(nested, { recursive: true });
    const r = runDb(['record', 'plan.md', 'T-001', 'X'], { cwd: nested, env: NO_GIT_ENV });
    expect(r.status).toBe(0);
    expect(existsSync(join(repo, '.conductor', 'cache.db'))).toBe(true);
  });

  it('Fallback B: script-dir parent is root when git fails and no .git exists', async () => {
    // Copy the script into an isolated tree with NO .git anywhere, so both git
    // and the .git-walk fail and only the script-dir fallback remains.
    const tree = mkdtempSync(join(tmpdir(), `cc-db-nogit-${randomUUID()}-`));
    try {
      const scriptsDir = join(tree, 'scripts');
      mkdirSync(scriptsDir, { recursive: true });
      cpSync(SCRIPT, join(scriptsDir, 'conductor-db.mjs'));
      const r = spawnSync(process.execPath,
        [...FLAG, join(scriptsDir, 'conductor-db.mjs'), 'record', 'plan.md', 'T-001', 'X'],
        { cwd: scriptsDir, encoding: 'utf8', env: NO_GIT_ENV });
      expect(r.status).toBe(0);
      // <root> = scripts/.. = tree ; db lands at tree/.conductor/cache.db
      expect(existsSync(join(tree, '.conductor', 'cache.db'))).toBe(true);
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!HAS_SQLITE)('conductor-db node:sqlite unavailable', () => {
  const BLOCK = fileURLToPath(new URL('./fixtures/block-sqlite.mjs', import.meta.url));

  it('exits 0 with exactly one CONDUCTOR_DB stderr line, nothing on stdout, no db', () => {
    const r = spawnSync(process.execPath,
      [...FLAG, '--import', BLOCK, SCRIPT, 'record', 'plan.md', 'T-001', 'X'],
      { cwd: repo, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr.trim().split('\n')).toHaveLength(1);
    expect(r.stderr).toContain('CONDUCTOR_DB:');
    expect(r.stderr.toLowerCase()).toContain('node:sqlite');
    // The intentional degradation message — distinguishes the handled branch from
    // the generic `main().catch` "unexpected:" fallthrough (which also mentions node:sqlite).
    expect(r.stderr).toContain('skipping cache write');
    expect(existsSync(join(repo, '.conductor', 'cache.db'))).toBe(false);
  });
});
