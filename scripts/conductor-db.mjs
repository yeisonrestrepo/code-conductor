// scripts/conductor-db.mjs
//
// Local task-state cache writer for Code Conductor (FEAT-005).
// Wraps Node's built-in node:sqlite (DatabaseSync) to own <repo-root>/.conductor/cache.db.
//
// REQUIRES Node >= 22.5 with node:sqlite available. On older Node the dynamic
// import('node:sqlite') fails and the script degrades gracefully (warn, exit 0).
// The caller (cc-implement Step 6 hook / test helper) passes --experimental-sqlite
// only when Node >= 22.5. engines.node stays >=20; this cache self-disables below 22.5.
//
// All failures are NON-FATAL: one stderr line prefixed "CONDUCTOR_DB:" then exit 0.
// The plan markdown remains the authoritative task-state record.

import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, renameSync, unlinkSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PREFIX = 'CONDUCTOR_DB:';
const warn = (m) => process.stderr.write(`${PREFIX} ${m}\n`);

const VALID_STATES = new Set([' ', '>', 'X', '!']);
const MAX_KEY_LEN = 512;
const WALK_CAP = 40;
const USAGE = "usage: conductor-db.mjs record <plan_file> <task_id> <state> | init";
const SCHEMA_VERSION = 2;
const MAX_SNAP_BYTES = 10 * 1024 * 1024;   // 10 MiB
const MAX_CONTENT_BYTES = 1024 * 1024;     // 1 MiB
const STDIN_CHUNK = 65536;
const U_SESSION = 'usage: conductor-db.mjs session <session_id> <phase> <spec> <git_commit_hash>';
const U_GET_SESSION = 'usage: conductor-db.mjs get-session <session_id>';
const U_SNAPSHOT = 'usage: conductor-db.mjs snapshot <git_commit_hash>';
const U_GET_SNAPSHOT = 'usage: conductor-db.mjs get-snapshot <git_commit_hash>';
const U_HISTORY = 'usage: conductor-db.mjs history <session_id> <kind>';

function validateKey(name, value, usage = USAGE) {
  const v = String(value ?? '').trim();       // 1. trim FIRST (whitespace never counts)
  if (!v) { warn(`${name} is empty; ${usage}`); return null; }        // 2. empty-check on trimmed
  if (v.length > MAX_KEY_LEN) { warn(`${name} exceeds ${MAX_KEY_LEN} chars; rejected`); return null; }  // 3. length-check on trimmed
  return v;
}

// Optional metadata: empty allowed, NOT trimmed, capped at MAX_KEY_LEN. Returns
// the raw string (possibly '') on success, or null ONLY when over the cap. Callers
// must test `=== null` — '' is a valid accepted value, not a rejection.
function validateOptional(name, value) {
  const v = String(value ?? '');
  if (v.length > MAX_KEY_LEN) { warn(`${name} exceeds ${MAX_KEY_LEN} chars; rejected`); return null; }
  return v;
}

function resolveRoot() {
  // 1. Primary: git.
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (out) return resolve(out);
  } catch { /* fall through */ }
  // 2. Fallback A: bounded walk up from cwd looking for a .git entry.
  let dir = resolve(process.cwd());
  for (let i = 0; i < WALK_CAP; i++) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;   // filesystem root
    dir = parent;
  }
  // 3. Fallback B: this script lives at <root>/scripts/conductor-db.mjs.
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

function normalizePlanFile(planFile, root) {
  // Repo-relative, then force POSIX separators so a Windows `\` key never
  // duplicates the same plan's POSIX `/` key. `sep` is `\` on Windows, `/` on POSIX.
  // `resolve`/`relative` already collapse redundant separators (`a//b` -> `a/b`);
  // the trailing replace is a defensive guarantee that no `//` ever persists.
  return relative(root, resolve(process.cwd(), planFile))
    .split(sep).join('/')
    .replace(/\/{2,}/g, '/');
}

function applySchema(db) {
  // WAL is best-effort: on a network share / virtualized FS that lacks the
  // shared-memory + POSIX locking WAL needs, this either silently returns a
  // rollback journal (e.g. 'delete') or throws. Either way we proceed — the
  // engine works correctly under the default rollback journal; WAL is only an
  // optimization. A hard I/O failure surfaces later and degrades in withDb.
  try { db.exec('PRAGMA journal_mode = WAL;'); } catch { /* WAL unsupported: use default journal */ }
  db.exec('BEGIN IMMEDIATE;');
  try {
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
    db.exec(
      "CREATE TABLE IF NOT EXISTS task_state (" +
      "plan_file TEXT NOT NULL, task_id TEXT NOT NULL, " +
      "state TEXT NOT NULL CHECK (state IN (' ', '>', 'X', '!')), " +
      "updated_at TEXT NOT NULL, " +
      "PRIMARY KEY (plan_file, task_id)) WITHOUT ROWID;"
    );
    db.exec(
      "CREATE TABLE IF NOT EXISTS sessions (" +
      "session_id TEXT NOT NULL, started_at TEXT NOT NULL, updated_at TEXT NOT NULL, " +
      "phase TEXT NOT NULL DEFAULT '', spec TEXT NOT NULL DEFAULT '', " +
      "git_commit_hash TEXT NOT NULL DEFAULT '', " +
      "PRIMARY KEY (session_id)) WITHOUT ROWID;"
    );
    db.exec(
      "CREATE TABLE IF NOT EXISTS snapshots (" +
      "id INTEGER PRIMARY KEY, git_commit_hash TEXT NOT NULL, " +
      "created_at TEXT NOT NULL, snap_json TEXT NOT NULL);"
    );
    db.exec("CREATE INDEX IF NOT EXISTS idx_snapshots_hash ON snapshots (git_commit_hash);");
    db.exec(
      "CREATE TABLE IF NOT EXISTS raw_history (" +
      "id INTEGER PRIMARY KEY, session_id TEXT NOT NULL DEFAULT '', " +
      "created_at TEXT NOT NULL, kind TEXT NOT NULL DEFAULT '', content TEXT NOT NULL);"
    );
    db.exec("CREATE INDEX IF NOT EXISTS idx_raw_history_session ON raw_history (session_id);");
    db.exec('COMMIT;');
  } catch (e) {
    try { db.exec('ROLLBACK;'); } catch { /* ignore */ }
    throw e;
  }
}

// True iff the task_state table is physically present, independent of the
// user_version header. Guards the case where an interrupted run left a version
// header without the table (or vice-versa): we re-apply the idempotent schema.
function tableExists(db) {
  return !!db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'task_state'"
  ).get();
}

// Open the db and immediately arm a busy timeout so rapid back-to-back hook
// invocations wait up to 2s for a transient lock instead of failing on the first
// contention. Every connection in this script is opened through here.
//
// The busy_timeout pragma is an optimization, not a correctness requirement: if
// it throws after a successful open, that is a NON-FATAL boundary — we log one
// CONDUCTOR_DB line and return the (still fully usable) handle rather than
// aborting or leaking it. Without the timeout the connection simply falls back
// to the SQLITE_BUSY graceful-degradation path on contention.
function openConn(DatabaseSync, dbPath) {
  const db = new DatabaseSync(dbPath);
  try { db.exec('PRAGMA busy_timeout = 2000;'); }
  catch { warn('busy_timeout pragma failed, continuing without it'); }
  return db;
}

const compactStamp = () => new Date().toISOString().replace(/[-:.]/g, '');

// Best-effort removal of the WAL/SHM sidecars that belong to a db file we are
// replacing. A stale `-wal`/`-shm` whose header no longer matches the fresh db
// can panic the next connection open, so they must go with the main file.
function clearSidecars(dbPath) {
  for (const suffix of ['-wal', '-shm']) {
    // The common case is that the sidecar does not exist -> unlinkSync throws
    // ENOENT; that is expected and swallowed. Any other error (EACCES, locked
    // file) is likewise non-fatal here. The empty catch suppresses ALL of them.
    try { unlinkSync(`${dbPath}${suffix}`); } catch { /* ENOENT (absent) or locked: best-effort, ignore */ }
  }
}

// Move a corrupt/non-regular file aside; never recursively delete. Returns true
// if the path was cleared (renamed or removed) so a fresh db can be created.
function backupAside(path) {
  const base = `${path}.corrupt.${compactStamp()}`;
  let target = base;
  for (let i = 1; i <= 100 && existsSync(target); i++) target = `${base}.${i}`;

  const cleared = (() => {
    // Preferred: rename aside — atomic and content-preserving for files AND dirs.
    try { renameSync(path, target); return true; }
    catch { /* rename failed (locked / cross-device / perms): type-aware fallback */ }

    // Rename failed. The unlink fallback is valid ONLY for a regular file:
    //  - unlinkSync on a directory throws EISDIR (POSIX) / EPERM (Windows);
    //  - rmdirSync only removes an *empty* dir (ours may hold files) and a
    //    recursive delete is explicitly forbidden.
    // So: regular file -> unlinkSync; directory -> give up (warn, no write),
    // never unlink/rmdir/rm -r it. This is why we branch on statSync here rather
    // than blindly calling unlinkSync.
    let isDir = false;
    try { isDir = statSync(path).isDirectory(); }
    catch { return true; }   // path vanished between attempts: treat as cleared
    if (isDir) {
      warn(`cannot move aside directory at ${path} (rename failed); skipping cache write`);
      return false;
    }
    try { unlinkSync(path); return true; }
    catch { warn(`cannot move aside file at ${path}; skipping cache write`); return false; }
  })();

  // Only after the main file is cleared: drop its now-orphaned sidecars so the
  // fresh db opens against a clean slate (no mismatched journal headers).
  if (cleared) clearSidecars(path);
  return cleared;
}

function isCorruptionError(e) {
  const s = `${(e && e.code) || ''} ${(e && e.message) || ''}`.toLowerCase();
  return s.includes('not a database') || s.includes('malformed') ||
         s.includes('file is encrypted') || s.includes('notadb');
}

function openReady(DatabaseSync, dbPath) {
  // A directory or other non-regular file squatting the db path: move it aside
  // (its contents travel with the rename) — never recursively delete it.
  try {
    if (!statSync(dbPath).isFile()) {
      if (!backupAside(dbPath)) return null;
    }
  } catch { /* ENOENT: nothing there yet — normal first run */ }

  let db;
  try {
    db = openConn(DatabaseSync, dbPath);
    const ver = db.prepare('PRAGMA user_version').get().user_version;   // first I/O
    if (ver > SCHEMA_VERSION) {
      warn(`db schema v${ver} newer than supported v${SCHEMA_VERSION}, skipping cache write`);
      db.close();
      return null;
    }
    if (ver < SCHEMA_VERSION || !tableExists(db)) applySchema(db);
    return db;
  } catch (e) {
    // Close the (possibly half-usable) handle BEFORE any rethrow or return so
    // no path — corruption OR an unexpected non-corruption error — leaks it.
    try { if (db) db.close(); } catch { /* ignore */ }
    if (!isCorruptionError(e)) throw e;
    if (!backupAside(dbPath)) return null;
    db = openConn(DatabaseSync, dbPath);   // retry once on a fresh file
    applySchema(db);
    return db;
  }
}

function upsert(db, planFile, taskId, state) {
  db.prepare(
    'INSERT INTO task_state (plan_file, task_id, state, updated_at) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT (plan_file, task_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at'
  ).run(planFile, taskId, state, new Date().toISOString());
}

function upsertSession(db, sessionId, phase, spec, gitHash) {
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO sessions (session_id, started_at, updated_at, phase, spec, git_commit_hash) ' +
    'VALUES ($session_id, $started_at, $updated_at, $phase, $spec, $git_commit_hash) ' +
    'ON CONFLICT(session_id) DO UPDATE SET ' +
    'updated_at = excluded.updated_at, phase = excluded.phase, ' +
    'spec = excluded.spec, git_commit_hash = excluded.git_commit_hash'
  ).run({ $session_id: sessionId, $started_at: now, $updated_at: now, $phase: phase, $spec: spec, $git_commit_hash: gitHash });
}

async function withDb(root, fn) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    warn('node:sqlite unavailable, skipping cache write');
    return;
  }
  const dir = join(root, '.conductor');
  const dbPath = join(dir, 'cache.db');
  // If `.conductor` already exists but as a regular FILE (not a directory),
  // mkdirSync would throw EEXIST/ENOTDIR. Move the squatting file aside with the
  // same non-destructive rename used for a bad db, then create the directory.
  try {
    if (!statSync(dir).isDirectory()) { if (!backupAside(dir)) return; }
  } catch { /* ENOENT: nothing at the path yet — mkdir will create it */ }
  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {
    warn(`cannot create ${dir}: ${(e && e.code) || (e && e.message)}, skipping cache write`);
    return;
  }
  let db = null;
  try {
    db = openReady(DatabaseSync, dbPath);
    if (!db) return;             // skipped (unrecoverable or newer schema — Task 9)
    return fn(db);
  } catch (e) {
    warn(`${(e && e.code) || 'error'} writing ${dbPath}: ${e && e.message}, skipping cache write`);
  } finally {
    if (db) {
      // Force a full WAL flush + truncate before closing so the -wal/-shm
      // sidecars are collapsed into the main db on every filesystem (some
      // network/oddball FS skip the implicit close-time checkpoint). Best-effort:
      // a checkpoint failure must never mask the operation's own outcome.
      try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* best-effort flush */ }
      try { db.close(); } catch { /* ignore */ }
    }
  }
}

async function cmdRecord(args) {
  if (args.length !== 3) { warn(USAGE); return; }
  const [rawPlan, rawTask, rawState] = args;
  const root = resolveRoot();
  const planFile = validateKey('plan_file', normalizePlanFile(String(rawPlan ?? ''), root));
  if (planFile === null) return;
  const taskId = validateKey('task_id', rawTask);
  if (taskId === null) return;
  const state = String(rawState ?? '');
  if (!VALID_STATES.has(state)) { warn(`invalid state ${JSON.stringify(state)}; must be one of ' ' '>' 'X' '!'`); return; }
  await withDb(root, (db) => upsert(db, planFile, taskId, state));
}

async function cmdInit(args) {
  if (args.length !== 0) { warn(USAGE); return; }
  const root = resolveRoot();
  await withDb(root, () => { /* create/verify only */ });
}

async function cmdSession(args) {
  if (args.length !== 4) { warn(U_SESSION); return; }
  const [rawId, rawPhase, rawSpec, rawHash] = args;
  const sessionId = validateKey('session_id', rawId, U_SESSION);
  if (sessionId === null) return;
  const phase = validateOptional('phase', rawPhase);
  if (phase === null) return;
  const spec = validateOptional('spec', rawSpec);
  if (spec === null) return;
  const gitHash = validateKey('git_commit_hash', rawHash, U_SESSION);
  if (gitHash === null) return;
  const root = resolveRoot();
  await withDb(root, (db) => upsertSession(db, sessionId, phase, spec, gitHash));
}

async function cmdGetSession(args) {
  if (args.length !== 1) { warn(U_GET_SESSION); return; }
  const sessionId = validateKey('session_id', args[0], U_GET_SESSION);
  if (sessionId === null) return;
  const root = resolveRoot();
  const row = await withDb(root, (db) =>
    db.prepare(
      'SELECT session_id, started_at, updated_at, phase, spec, git_commit_hash FROM sessions WHERE session_id = $id'
    ).get({ $id: sessionId })
  );
  if (row) {
    const out = {
      session_id: row.session_id, started_at: row.started_at, updated_at: row.updated_at,
      phase: row.phase, spec: row.spec, git_commit_hash: row.git_commit_hash,
    };
    process.stdout.write(JSON.stringify(out) + '\n');
  }
}

async function main() {
  const [sub, ...rest] = process.argv.slice(2);
  if (sub === 'record') return cmdRecord(rest);
  if (sub === 'init') return cmdInit(rest);
  if (sub === 'session') return cmdSession(rest);
  if (sub === 'get-session') return cmdGetSession(rest);
  warn(`unknown subcommand ${JSON.stringify(sub ?? '')}; ${USAGE}`);
}

main().then(() => process.exit(0)).catch((e) => {
  warn(`unexpected: ${e && e.message}`);
  process.exit(0);
});
