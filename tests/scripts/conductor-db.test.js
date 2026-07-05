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

  it('WAL journal_mode and user_version=2 are set', async () => {
    runDb(['record', 'plan.md', 'T-001', 'X'], { cwd: repo });
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath());
    try {
      expect(db.prepare('PRAGMA user_version').get().user_version).toBe(2);
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

import { writeFileSync, readdirSync, readFileSync } from 'node:fs';

describe.skipIf(!HAS_SQLITE)('conductor-db corrupt-db recovery', () => {
  const conductorDir = () => join(repo, '.conductor');
  const dbPath = () => join(conductorDir(), 'cache.db');

  it('backs up a corrupt db aside (colon-free name), clears stale sidecars, recreates it', async () => {
    mkdirSync(conductorDir(), { recursive: true });
    writeFileSync(dbPath(), 'this is not a sqlite database');   // garbage main file
    writeFileSync(`${dbPath()}-wal`, 'stale wal');              // orphaned sidecars whose
    writeFileSync(`${dbPath()}-shm`, 'stale shm');              // headers would panic a fresh open
    const r = runDb(['record', 'plan.md', 'T-001', 'X'], { cwd: repo });
    expect(r.status).toBe(0);

    const backups = readdirSync(conductorDir()).filter((f) => f.startsWith('cache.db.corrupt.'));
    expect(backups).toHaveLength(1);
    expect(backups[0]).not.toContain(':');          // Windows-safe
    // The stale sidecars were cleared. (The fresh db may create its own `-wal`/
    // `-shm`; assert only that no sidecar still carries the OLD 'stale' bytes,
    // which avoids coupling to the script's own WAL lifecycle across platforms.)
    for (const suffix of ['-wal', '-shm']) {
      const p = `${dbPath()}${suffix}`;
      if (existsSync(p)) expect(readFileSync(p, 'utf8')).not.toContain('stale');
    }
    const rows = await readRows(dbPath());           // fresh db opened cleanly, write succeeded
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe('X');
  });

  it('degrades to exit 0 without throwing when the db dir is read-only', () => {
    // Force every recovery hop (rename/unlink/create) to fail; the script must
    // still exit 0 and never throw. (Skipped where chmod is a no-op, e.g. Windows.)
    mkdirSync(conductorDir(), { recursive: true });
    writeFileSync(dbPath(), 'not a database');
    let readonly = false;
    try { execFileSync('chmod', ['555', conductorDir()]); readonly = true; } catch { /* skip */ }
    if (!readonly) return;
    try {
      const r = runDb(['record', 'plan.md', 'T-001', 'X'], { cwd: repo });
      expect(r.status).toBe(0);
      expect(r.stderr).toContain('CONDUCTOR_DB:');
    } finally {
      execFileSync('chmod', ['755', conductorDir()]);   // let afterEach clean up
    }
  });
});

describe.skipIf(!HAS_SQLITE)('conductor-db non-regular file at db path', () => {
  const conductorDir = () => join(repo, '.conductor');
  const dbPath = () => join(conductorDir(), 'cache.db');

  it('renames a directory-at-path aside (never rm -r) and creates a fresh db', async () => {
    mkdirSync(dbPath(), { recursive: true });                  // cache.db is a DIRECTORY
    writeFileSync(join(dbPath(), 'keep.txt'), 'sentinel');     // proves no rm -r
    const r = runDb(['record', 'plan.md', 'T-001', 'X'], { cwd: repo });
    expect(r.status).toBe(0);

    const moved = readdirSync(conductorDir()).filter((f) => f.startsWith('cache.db.corrupt.'));
    expect(moved).toHaveLength(1);
    expect(existsSync(join(conductorDir(), moved[0], 'keep.txt'))).toBe(true);   // contents survived the move
    const rows = await readRows(dbPath());                      // cache.db is now a real db
    expect(rows).toHaveLength(1);
  });

  it('moves a .conductor squatting FILE aside and creates the directory', async () => {
    writeFileSync(conductorDir(), 'i am a file, not a directory');   // .conductor is a regular file
    const r = runDb(['record', 'plan.md', 'T-001', 'X'], { cwd: repo });
    expect(r.status).toBe(0);
    // The squatting file was renamed aside (never deleted); .conductor is now a dir.
    const moved = readdirSync(repo).filter((f) => f.startsWith('.conductor.corrupt.'));
    expect(moved).toHaveLength(1);
    const rows = await readRows(dbPath());                            // fresh db created inside the new dir
    expect(rows).toHaveLength(1);
  });
});

describe.skipIf(!HAS_SQLITE)('conductor-db forward compatibility', () => {
  const dbPath = () => join(repo, '.conductor', 'cache.db');

  it('does not write or downgrade a db whose user_version is newer than the supported schema', async () => {
    // Simulate a FUTURE schema: valid sqlite file, user_version = 3, no task_state table.
    const { DatabaseSync } = await import('node:sqlite');
    mkdirSync(join(repo, '.conductor'), { recursive: true });
    const seed = new DatabaseSync(dbPath());
    seed.exec('PRAGMA user_version = 3;');
    seed.close();

    const r = runDb(['record', 'plan.md', 'T-001', 'X'], { cwd: repo });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('CONDUCTOR_DB:');
    expect(r.stderr.toLowerCase()).toContain('newer');

    const check = new DatabaseSync(dbPath());
    try {
      expect(check.prepare('PRAGMA user_version').get().user_version).toBe(3);   // not downgraded
      const t = check.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='task_state'").get();
      expect(t).toBeUndefined();                                                 // no table created, no write
    } finally { check.close(); }
  });
});

// Pinned regression: the table-existence self-heal (added in T-001's openReady
// via `|| !tableExists(db)`) must survive later edits. Passes from T-001 onward.
describe.skipIf(!HAS_SQLITE)('conductor-db schema self-heal', () => {
  const dbPath = () => join(repo, '.conductor', 'cache.db');

  it('self-heals an interrupted state: user_version=1 but task_state table missing', async () => {
    // Simulate a crash between the version bump and CREATE (or a later DROP):
    // the header claims v1 yet the table is absent. openReady must detect this
    // via tableExists (independent of user_version) and re-apply the schema.
    const { DatabaseSync } = await import('node:sqlite');
    mkdirSync(join(repo, '.conductor'), { recursive: true });
    const seed = new DatabaseSync(dbPath());
    seed.exec('PRAGMA user_version = 1;');   // header says v1, but no table created
    seed.close();

    const r = runDb(['record', 'plan.md', 'T-001', 'X'], { cwd: repo });
    expect(r.status).toBe(0);
    const rows = await readRows(dbPath());   // table recreated, write landed — no "no such table" crash
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe('X');
  });
});

describe.skipIf(!HAS_SQLITE)('conductor-db v2 migration', () => {
  const dbPath = () => join(repo, '.conductor', 'cache.db');
  async function tables(p) {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(p);
    try {
      return db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
    } finally { db.close(); }
  }

  it('init creates all four tables, two indexes, and user_version=2', async () => {
    runDb(['init'], { cwd: repo });
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath());
    try {
      expect(db.prepare('PRAGMA user_version').get().user_version).toBe(2);
      const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
      expect(t).toEqual(expect.arrayContaining(['raw_history', 'sessions', 'snapshots', 'task_state']));
      const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name").all().map((r) => r.name);
      expect(idx).toEqual(['idx_raw_history_session', 'idx_snapshots_hash']);
    } finally { db.close(); }
  });

  it('migrates a pre-existing v1 db in place, preserving task_state rows', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    mkdirSync(join(repo, '.conductor'), { recursive: true });
    const seed = new DatabaseSync(dbPath());
    seed.exec('PRAGMA user_version = 1;');
    seed.exec("CREATE TABLE task_state (plan_file TEXT NOT NULL, task_id TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN (' ','>','X','!')), updated_at TEXT NOT NULL, PRIMARY KEY (plan_file, task_id)) WITHOUT ROWID;");
    seed.prepare('INSERT INTO task_state VALUES (?,?,?,?)').run('legacy.md', 'T-000', 'X', '2026-01-01T00:00:00.000Z');
    seed.close();

    const r = runDb(['init'], { cwd: repo });
    expect(r.status).toBe(0);
    const check = new DatabaseSync(dbPath());
    try {
      expect(check.prepare('PRAGMA user_version').get().user_version).toBe(2);
      const row = check.prepare("SELECT state FROM task_state WHERE plan_file='legacy.md' AND task_id='T-000'").get();
      expect(row.state).toBe('X');                                  // pre-existing row survived
      expect(check.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table' AND name='sessions'").get().c).toBe(1);
    } finally { check.close(); }
  });

  it('DROP-free: a pre-existing third-party index on task_state survives the migration', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    mkdirSync(join(repo, '.conductor'), { recursive: true });
    const seed = new DatabaseSync(dbPath());
    seed.exec('PRAGMA user_version = 1;');
    seed.exec("CREATE TABLE task_state (plan_file TEXT NOT NULL, task_id TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN (' ','>','X','!')), updated_at TEXT NOT NULL, PRIMARY KEY (plan_file, task_id)) WITHOUT ROWID;");
    seed.exec('CREATE INDEX idx_thirdparty ON task_state (updated_at);');
    seed.close();

    runDb(['init'], { cwd: repo });
    const check = new DatabaseSync(dbPath());
    try {
      expect(check.prepare("SELECT count(*) c FROM sqlite_master WHERE type='index' AND name='idx_thirdparty'").get().c).toBe(1);
    } finally { check.close(); }
  });
});

describe.skipIf(!HAS_SQLITE)('conductor-db session / get-session', () => {
  it('creates a session and reads it back as fixed-key single-line JSON', async () => {
    runDb(['session', 's1', 'impl', 'my-spec', '0000000'], { cwd: repo });
    const r = runDb(['get-session', 's1'], { cwd: repo });
    expect(r.status).toBe(0);
    const obj = JSON.parse(r.stdout);
    expect(Object.keys(obj)).toEqual(['session_id', 'started_at', 'updated_at', 'phase', 'spec', 'git_commit_hash']);
    expect(obj).toMatchObject({ session_id: 's1', phase: 'impl', spec: 'my-spec', git_commit_hash: '0000000' });
    expect(r.stdout.endsWith('\n')).toBe(true);
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
  });

  it('upsert preserves started_at and updates the mutable columns', async () => {
    runDb(['session', 's2', 'spec', 'a', '0000000'], { cwd: repo });
    const first = JSON.parse(runDb(['get-session', 's2'], { cwd: repo }).stdout);
    await new Promise((res) => setTimeout(res, 5));
    runDb(['session', 's2', 'impl', 'b', 'abc123'], { cwd: repo });
    const second = JSON.parse(runDb(['get-session', 's2'], { cwd: repo }).stdout);
    expect(second.started_at).toBe(first.started_at);          // creation time preserved
    expect(second.updated_at >= first.updated_at).toBe(true);   // refreshed
    expect(second).toMatchObject({ phase: 'impl', spec: 'b', git_commit_hash: 'abc123' });
  });

  it('empty optional fields serialize as "" never null; CR stays single-line', async () => {
    runDb(['session', 's3', '', 'has\rcr', '0000000'], { cwd: repo });
    const r = runDb(['get-session', 's3'], { cwd: repo });
    expect(r.stdout.trim().split('\n')).toHaveLength(1);        // \r escaped, one line
    const obj = JSON.parse(r.stdout);
    expect(obj.phase).toBe('');
    expect(obj.spec).toBe('has\rcr');
  });

  it('get-session miss writes zero bytes, exit 0', () => {
    const r = runDb(['get-session', 'nope'], { cwd: repo });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('rejects whitespace-only session_id as empty', () => {
    const r = runDb(['session', '   ', 'p', 's', '0000000'], { cwd: repo });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('session_id is empty');
    expect(r.stdout).toBe('');
  });

  it('accepts a non-whitespace control-char session_id as an opaque key (not rejected by trim)', () => {
    const key = '\x01\x02ctrl';                    // C0 controls: trim leaves them intact
    const w = runDb(['session', key, 'p', 's', '0000000'], { cwd: repo });
    expect(w.status).toBe(0);
    expect(w.stderr).toBe('');                          // accepted, no rejection line
    const r = runDb(['get-session', key], { cwd: repo });
    expect(JSON.parse(r.stdout).session_id).toBe(key);  // stored + read back verbatim
  });

  it('rejects wrong arg count (too few AND over-supply) with the usage line', () => {
    const few = runDb(['session', 's1', 'impl'], { cwd: repo });
    expect(few.stderr).toBe(`CONDUCTOR_DB: ${'usage: conductor-db.mjs session <session_id> <phase> <spec> <git_commit_hash>'}\n`);
    const many = runDb(['get-session', 's1', 'extra'], { cwd: repo });
    expect(many.stderr).toBe(`CONDUCTOR_DB: ${'usage: conductor-db.mjs get-session <session_id>'}\n`);
  });
});
