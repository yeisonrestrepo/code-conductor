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
import { mkdirSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';

const PREFIX = 'CONDUCTOR_DB:';
const warn = (m) => process.stderr.write(`${PREFIX} ${m}\n`);

function resolveRoot() {
  const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  return resolve(out);
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
    db.exec('PRAGMA user_version = 1;');
    db.exec(
      "CREATE TABLE IF NOT EXISTS task_state (" +
      "plan_file TEXT NOT NULL, task_id TEXT NOT NULL, " +
      "state TEXT NOT NULL CHECK (state IN (' ', '>', 'X', '!')), " +
      "updated_at TEXT NOT NULL, " +
      "PRIMARY KEY (plan_file, task_id)) WITHOUT ROWID;"
    );
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

function openReady(DatabaseSync, dbPath) {
  const db = openConn(DatabaseSync, dbPath);
  const ver = db.prepare('PRAGMA user_version').get().user_version;
  if (ver === 0 || !tableExists(db)) applySchema(db);
  return db;
}

function upsert(db, planFile, taskId, state) {
  db.prepare(
    'INSERT INTO task_state (plan_file, task_id, state, updated_at) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT (plan_file, task_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at'
  ).run(planFile, taskId, state, new Date().toISOString());
}

async function withDb(root, fn) {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = join(root, '.conductor');
  const dbPath = join(dir, 'cache.db');
  mkdirSync(dir, { recursive: true });
  let db = null;
  try {
    db = openReady(DatabaseSync, dbPath);
    fn(db);
  } finally {
    if (db) { try { db.close(); } catch { /* ignore */ } }
  }
}

async function cmdRecord(args) {
  const [rawPlan, rawTask, rawState] = args;
  const root = resolveRoot();
  const planFile = normalizePlanFile(rawPlan, root);
  await withDb(root, (db) => upsert(db, planFile, rawTask, rawState));
}

async function cmdInit() {
  const root = resolveRoot();
  await withDb(root, () => { /* create/verify only */ });
}

async function main() {
  const [sub, ...rest] = process.argv.slice(2);
  if (sub === 'record') return cmdRecord(rest);
  if (sub === 'init') return cmdInit(rest);
}

main().then(() => process.exit(0)).catch((e) => {
  warn(`unexpected: ${e && e.message}`);
  process.exit(0);
});
