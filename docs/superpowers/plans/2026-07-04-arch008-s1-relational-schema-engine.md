# ARCH-008-S1 Relational Schema Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `scripts/conductor-db.mjs` with an additive `user_version` 1→2 migration (three new tables) and five new fail-open subcommands, reusing the FEAT-005 degradation ladder.

**Architecture:** Purely engine-local and additive. `applySchema` gains three `CREATE TABLE IF NOT EXISTS` + two `CREATE INDEX IF NOT EXISTS` inside the existing `BEGIN IMMEDIATE`, and bumps `user_version` to 2. Five flat subcommands (`session`, `get-session`, `snapshot`, `get-snapshot`, `history`) route through the unchanged `withDb` ladder; `withDb` is extended to return its callback's value so query commands can print a row. Payload commands read their blob from stdin via a bounded `readStdinCapped`. No consumer wiring, no installer change.

**Tech Stack:** Node ≥22.5 `node:sqlite` (`DatabaseSync`), zero runtime deps, Vitest ^3 child-process (`spawnSync`) tests.

## Global Constraints

- `SCHEMA_VERSION = 2`; migration is additive and DROP-free (`CREATE ... IF NOT EXISTS` only); existing `task_state` rows and any third-party index survive.
- All failures NON-FATAL: one `CONDUCTOR_DB:` stderr line, exit 0. Write commands emit empty stdout; query commands emit one line on hit, **zero bytes** on miss/degradation (never `{}`, never `null`).
- Timestamps: Node `new Date().toISOString()` (ISO-8601 UTC ms) — never SQLite date functions.
- Size caps on `Buffer` byte length: `snap_json` ≤ 10 MiB (10485760), `content` ≤ 1 MiB (1048576). Keys/optional metadata ≤ `MAX_KEY_LEN = 512` chars.
- `git_commit_hash` and `session_id`: required non-empty via `validateKey` (trim → non-empty → ≤512, opaque, no hex check). `phase`/`spec`/`kind`: optional, empty allowed, untrimmed, ≤512.
- New multi-column statements use named (`$name` object) binding; FEAT-005 `record` keeps positional `?`.
- `engines.node` stays `>= 20`; below Node 22.5 every subcommand degrades (one `node:sqlite unavailable` line, exit 0).
- No FKs, no pruning, no env DB-path override, no shebang/flag self-injection in S1.
- BUG-003 invariant: no bulk rewrites of tracking files; surgical single-line edits only.
- Engine-file identifier/comment language: English. Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- **Modify** `scripts/conductor-db.mjs` (278 lines) — add constants, extend `applySchema`, retarget `openReady` version guard, change `withDb` to return `fn(db)`, add `validateKey` `usage` param + `validateOptional` + `readStdinCapped` helpers, add five `cmd*` handlers, extend `main` dispatch.
- **Modify** `tests/scripts/conductor-db.test.js` (437 lines) — retarget two version-coupled FEAT-005 tests; add describe blocks for migration, each subcommand, query round-trip, degraded-query, size cap, arg over-supply, empty payload, stdin no-hang, fixed key order, CR/whitespace, isolation guard.
- **Modify** `VERSION`, `package.json`, `package-lock.json` (two stale root-version refs), `CHANGELOG.md` — minor bump 1.19.0 → 1.20.0.
- **Modify** `AGENT-READABLE BACKLOG.md`, `.claude/memory/project.md` — surgical status/summary update on ship.

---

## Task 1: Schema v2 migration (additive tables + version guard)

**Files:**
- Modify: `scripts/conductor-db.mjs:19-25` (constants), `:64-86` (`applySchema`), `:169-199` (`openReady` guard)
- Test: `tests/scripts/conductor-db.test.js` (retarget `:86`, `:391-414`; add migration describe block)

**Interfaces:**
- Produces: `SCHEMA_VERSION = 2` constant; `applySchema(db)` now creates `task_state`, `sessions`, `snapshots`, `raw_history` + indexes `idx_snapshots_hash`, `idx_raw_history_session`, sets `user_version = 2`, all in one `BEGIN IMMEDIATE`. `openReady` bails when `ver > SCHEMA_VERSION`, migrates when `ver < SCHEMA_VERSION || !tableExists(db)`.

- [X] **[T-001] Step 1: Retarget the two version-coupled FEAT-005 tests (they will fail under v2 until steps below land)**

In `tests/scripts/conductor-db.test.js`, line 86, change:
```js
      expect(db.prepare('PRAGMA user_version').get().user_version).toBe(1);
```
to:
```js
      expect(db.prepare('PRAGMA user_version').get().user_version).toBe(2);
```

In the forward-compatibility describe block (lines 394–411), change the seed from `2` to `3` and the assertion from `2` to `3`:
```js
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
```

**Mock-db setup safety (existing + new seeds — no pre-migration structural conflict):**
The only *existing* mock-db setups in the suite are the seed blocks inside the two
retargeted tests (Step 1): the forward-compat test seeds `user_version = 3` with **no**
`task_state`, so the engine's `ver > SCHEMA_VERSION` guard bails *before* any DDL runs —
no table is ever created against it. The self-heal test seeds `user_version = 1` with no
table; the migration runs and creates every table fresh. Neither seed pre-creates a table
that the migration would then re-declare. The *new* v1-migration seed (Step 2) deliberately
issues a **bare `CREATE TABLE task_state …`** (no `IF NOT EXISTS`) to faithfully simulate a
real v1 db; this is safe because the engine's migration uses `CREATE TABLE IF NOT EXISTS`,
so re-declaring the seeded `task_state` is a no-op — SQLite never raises "table already
exists". No seed is modified beyond the two version-number changes in Step 1; every mock db
is created in its own `mkdtemp` repo, so no seed can collide with another test's schema.

- [X] **[T-001] Step 2: Add the migration describe block (failing tests first)**

Append to `tests/scripts/conductor-db.test.js`:
```js
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
```

- [X] **[T-001] Step 3: Run the new + retargeted tests to confirm they fail**

Run: `npx vitest run tests/scripts/conductor-db.test.js -t "migration"`
Expected: FAIL (tables/indexes absent, `user_version` still 1).

- [X] **[T-001] Step 4: Add constants**

In `scripts/conductor-db.mjs`, after line 23 (`const MAX_KEY_LEN = 512;`) add:
```js
const SCHEMA_VERSION = 2;
const MAX_SNAP_BYTES = 10 * 1024 * 1024;   // 10 MiB
const MAX_CONTENT_BYTES = 1024 * 1024;     // 1 MiB
const STDIN_CHUNK = 65536;
const U_SESSION = 'usage: conductor-db.mjs session <session_id> <phase> <spec> <git_commit_hash>';
const U_GET_SESSION = 'usage: conductor-db.mjs get-session <session_id>';
const U_SNAPSHOT = 'usage: conductor-db.mjs snapshot <git_commit_hash>';
const U_GET_SNAPSHOT = 'usage: conductor-db.mjs get-snapshot <git_commit_hash>';
const U_HISTORY = 'usage: conductor-db.mjs history <session_id> <kind>';
```

- [X] **[T-001] Step 5: Extend `applySchema` (reuse task_state literal in place; bump version to 2)**

Replace the body of `applySchema` (lines 71–85, the `BEGIN IMMEDIATE` block) so the `task_state` CREATE string literal is **kept in place** and the three new tables + two indexes are appended, and `user_version` is set to `SCHEMA_VERSION`:
```js
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
```
(The `PRAGMA journal_mode = WAL` line and comment above it, lines 65–70, stay unchanged.)

- [X] **[T-001] Step 6: Retarget the `openReady` version guard**

In `scripts/conductor-db.mjs`, replace lines 182–187:
```js
    if (ver > SCHEMA_VERSION) {
      warn(`db schema v${ver} newer than supported v${SCHEMA_VERSION}, skipping cache write`);
      db.close();
      return null;
    }
    if (ver < SCHEMA_VERSION || !tableExists(db)) applySchema(db);
```
(`ver < SCHEMA_VERSION` covers `ver === 0` and any pre-v2 db; `tableExists` still guards the interrupted-init self-heal.)

- [X] **[T-001] Step 7: Run the migration + retargeted + full FEAT-005 suite**

Run: `npx vitest run tests/scripts/conductor-db.test.js`
Expected: PASS (migration block green; self-heal, forward-compat, and `user_version=2` assertions green; all pre-existing record/init/CLI tests still green).

- [X] **[T-001] Step 8: Commit**

```bash
git add scripts/conductor-db.mjs tests/scripts/conductor-db.test.js
git commit -m "feat(ARCH-008-S1): additive v2 migration — sessions/snapshots/raw_history

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `session` upsert + `get-session` query (withDb return-value change)

**Files:**
- Modify: `scripts/conductor-db.mjs` — `validateKey` (`:27-32`), `withDb` (`:234`), add `validateOptional`, `upsertSession`, `cmdSession`, `cmdGetSession`, dispatch (`:268-273`)
- Test: `tests/scripts/conductor-db.test.js` (add sessions describe block)

**Interfaces:**
- Consumes: `SCHEMA_VERSION`, `U_SESSION`, `U_GET_SESSION`, `MAX_KEY_LEN` (Task 1).
- Produces: `validateKey(name, value, usage = USAGE)`; `validateOptional(name, value) → string|null`; `withDb(root, fn)` now returns `fn(db)`'s value (undefined on degradation); `cmdSession(args)` (4 args, upsert); `cmdGetSession(args)` (1 arg, prints fixed-key JSON + `\n`).

**`validateKey` and control/escape-only keys (clarification):** `validateKey` trims via
JS `String.prototype.trim()`, which strips only **whitespace** (space, `\t`, `\n`, `\r`,
`\f`, `\v`, and Unicode whitespace). A key made **exclusively of whitespace** therefore
collapses to `''` and is **rejected as empty**. A key made of **non-whitespace C0 control
characters** (e.g. `\x01\x02`) or literal backslash-escape text (e.g. the two chars `\` `n`)
is **not** stripped by `trim`, so it survives as a non-empty ≤512-char value and is
**accepted as an opaque key** — consistent with the spec's "opaque string, no format check"
rule. The length check runs on the trimmed value, so a control-char key is length-evaluated
by its raw character count. No control-character-specific rejection is added. Step 1's tests
pin both halves of this (whitespace-only rejected; control-char key accepted + round-trips).

- [X] **[T-002] Step 1: Write the failing sessions tests**

Append to `tests/scripts/conductor-db.test.js`:
```js
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
```

- [X] **[T-002] Step 2: Run to verify failure**

Run: `npx vitest run tests/scripts/conductor-db.test.js -t "session / get-session"`
Expected: FAIL (`unknown subcommand "session"`).

- [X] **[T-002] Step 3: Add the `usage` param to `validateKey`**

In `scripts/conductor-db.mjs`, change lines 27–29:
```js
function validateKey(name, value, usage = USAGE) {
  const v = String(value ?? '').trim();       // 1. trim FIRST (whitespace never counts)
  if (!v) { warn(`${name} is empty; ${usage}`); return null; }        // 2. empty-check on trimmed
```
(Default `usage = USAGE` keeps `record`/`init` behaviour byte-identical.)

- [X] **[T-002] Step 4: Add `validateOptional` (after `validateKey`, before `resolveRoot`)**

```js
// Optional metadata: empty allowed, NOT trimmed, capped at MAX_KEY_LEN. Returns
// the raw string (possibly '') on success, or null ONLY when over the cap. Callers
// must test `=== null` — '' is a valid accepted value, not a rejection.
function validateOptional(name, value) {
  const v = String(value ?? '');
  if (v.length > MAX_KEY_LEN) { warn(`${name} exceeds ${MAX_KEY_LEN} chars; rejected`); return null; }
  return v;
}
```

- [X] **[T-002] Step 5: Change `withDb` to return the callback's value**

In `scripts/conductor-db.mjs` line 234, change:
```js
    fn(db);
```
to:
```js
    return fn(db);
```
The `finally` block (checkpoint + close) still runs after the return; the `catch` path still falls through to `return undefined`, so degradation yields `undefined` (→ zero-byte stdout for queries). Write callbacks return `undefined` and are unaffected.

- [X] **[T-002] Step 6: Add `upsertSession` (after `upsert`)**

```js
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
```
(`started_at` is absent from the `DO UPDATE SET` list, so it is preserved across upserts.)

- [X] **[T-002] Step 7: Add `cmdSession` and `cmdGetSession` (after `cmdInit`)**

```js
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
```

- [X] **[T-002] Step 8: Wire dispatch**

In `main` (lines 270–272), add after the `init` line:
```js
  if (sub === 'session') return cmdSession(rest);
  if (sub === 'get-session') return cmdGetSession(rest);
```

- [X] **[T-002] Step 9: Run the sessions block + full suite**

Run: `npx vitest run tests/scripts/conductor-db.test.js`
Expected: PASS (sessions block green; FEAT-005 tests unaffected — `record`/`init` usage strings unchanged).

- [X] **[T-002] Step 10: Commit**

```bash
git add scripts/conductor-db.mjs tests/scripts/conductor-db.test.js
git commit -m "feat(ARCH-008-S1): session upsert + get-session query

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `readStdinCapped` + `snapshot` / `get-snapshot`

**Files:**
- Modify: `scripts/conductor-db.mjs` — add `readSync` import (`:15`), `readStdinCapped`, `cmdSnapshot`, `cmdGetSnapshot`, dispatch
- Test: `tests/scripts/conductor-db.test.js` (add snapshots describe block)

**Interfaces:**
- Consumes: `MAX_SNAP_BYTES`, `STDIN_CHUNK`, `U_SNAPSHOT`, `U_GET_SNAPSHOT`.
- Produces: `readStdinCapped(max) → { buf: Buffer|null, overCap: boolean }` (aborts once total > max; peak memory ~cap); `cmdSnapshot(args)` (1 arg + stdin blob, append-only insert); `cmdGetSnapshot(args)` (1 arg, prints newest `snap_json` byte-for-byte + one `\n`).

- [X] **[T-003] Step 1: Teach the `runDb` helper to forward stdin `input`**

The existing helper (lines 23–28) ignores `input`. Change it so stdin payloads reach the child:
```js
function runDb(args, { cwd, env, input } = {}) {
  return spawnSync(process.execPath, [...FLAG, SCRIPT, ...args], {
    cwd, encoding: 'utf8',
    env: env ?? process.env,
    input,
  });
}
```
(`input: undefined` is the spawnSync default, so record/init callers that omit it are unaffected — passing `undefined` closes the child's stdin at EOF, exactly as before.)

- [X] **[T-003] Step 2: Write the failing snapshots tests**

Append to `tests/scripts/conductor-db.test.js`:
```js
describe.skipIf(!HAS_SQLITE)('conductor-db snapshot / get-snapshot', () => {
  it('stores a snapshot from stdin and returns it byte-for-byte (+ one \\n)', () => {
    const payload = '{"v":1,"note":"hello"}';
    const w = runDb(['snapshot', 'deadbee'], { cwd: repo, input: payload });
    expect(w.status).toBe(0);
    expect(w.stdout).toBe('');
    const r = runDb(['get-snapshot', 'deadbee'], { cwd: repo });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(payload + '\n');
  });

  it('get-snapshot returns the NEWEST blob for a hash (ORDER BY id DESC)', () => {
    runDb(['snapshot', 'h1'], { cwd: repo, input: 'first' });
    runDb(['snapshot', 'h1'], { cwd: repo, input: 'second' });
    const r = runDb(['get-snapshot', 'h1'], { cwd: repo });
    expect(r.stdout).toBe('second\n');
  });

  it('round-trips a >128 KiB payload (proves no ARG_MAX ceiling — payload via stdin)', () => {
    const big = 'x'.repeat(200 * 1024);
    runDb(['snapshot', 'bigh'], { cwd: repo, input: big });
    const r = runDb(['get-snapshot', 'bigh'], { cwd: repo });
    expect(r.stdout).toBe(big + '\n');
  });

  it('rejects a payload over 10 MiB without writing (message cites the limit)', () => {
    const over = Buffer.alloc(MAX_SNAP + 1, 0x61);   // 10 MiB + 1 byte of 'a'
    const w = runDb(['snapshot', 'toobig'], { cwd: repo, input: over });
    expect(w.status).toBe(0);
    expect(w.stderr).toContain('snap_json exceeds 10485760 bytes (10 MiB); rejected');
    expect(runDb(['get-snapshot', 'toobig'], { cwd: repo }).stdout).toBe('');   // nothing stored
  });

  it('rejects an empty stdin stream as an argument violation', () => {
    const w = runDb(['snapshot', 'emptyh'], { cwd: repo, input: '' });
    expect(w.status).toBe(0);
    expect(w.stderr).toContain('snap_json is empty');
    expect(runDb(['get-snapshot', 'emptyh'], { cwd: repo }).stdout).toBe('');
  });

  it('rejects malformed UTF-8 (fatal decoder), never storing U+FFFD', () => {
    const bad = Buffer.from([0xff, 0xfe, 0x00, 0x80]);   // invalid UTF-8
    const w = runDb(['snapshot', 'badutf'], { cwd: repo, input: bad });
    expect(w.status).toBe(0);
    expect(w.stderr).toContain('snap_json is not valid UTF-8; rejected');
    expect(runDb(['get-snapshot', 'badutf'], { cwd: repo }).stdout).toBe('');
  });

  it('does not hang when stdin is closed with no data (spawnSync timeout guard)', () => {
    const w = spawnSync(process.execPath, [...FLAG, SCRIPT, 'snapshot', 'nohang'],
      { cwd: repo, encoding: 'utf8', timeout: 5000 });   // no `input` -> stdin closed at EOF
    expect(w.signal).toBe(null);          // not killed by timeout
    expect(w.status).toBe(0);
    expect(w.stderr).toContain('snap_json is empty');
  });

  it('rejects arg over-supply and whitespace-only hash', () => {
    expect(runDb(['snapshot', 'h', 'extra'], { cwd: repo, input: 'x' }).stderr)
      .toBe('CONDUCTOR_DB: usage: conductor-db.mjs snapshot <git_commit_hash>\n');
    expect(runDb(['snapshot', '   '], { cwd: repo, input: 'x' }).stderr)
      .toContain('git_commit_hash is empty');
  });

  it('get-snapshot miss writes zero bytes', () => {
    expect(runDb(['get-snapshot', 'absent'], { cwd: repo }).stdout).toBe('');
  });
});
```

Add the `MAX_SNAP` constant near the top of the test file (after line 17):
```js
const MAX_SNAP = 10 * 1024 * 1024;
```

- [X] **[T-003] Step 3: Run to verify failure**

Run: `npx vitest run tests/scripts/conductor-db.test.js -t "snapshot / get-snapshot"`
Expected: FAIL (`unknown subcommand "snapshot"`).

- [X] **[T-003] Step 4: Add `readSync` to the fs import**

In `scripts/conductor-db.mjs` line 15, change:
```js
import { mkdirSync, existsSync, renameSync, unlinkSync, statSync } from 'node:fs';
```
to:
```js
import { mkdirSync, existsSync, renameSync, unlinkSync, statSync, readSync } from 'node:fs';
```

- [X] **[T-003] Step 5: Add `readStdinCapped` (after `openConn`, before `compactStamp`)**

```js
// Bounded, memory-safe stdin reader. Loops readSync(0,...) into a fixed reusable
// chunk buffer and stops the instant the running total EXCEEDS `max` (returning an
// over-cap signal without draining a hostile stream), so peak memory is ~max+chunk.
// Never calls process.exit; a read error propagates to the caller's try/catch.
function readStdinCapped(max) {
  const chunk = Buffer.allocUnsafe(STDIN_CHUNK);
  const parts = [];
  let total = 0;
  for (;;) {
    let n;
    try { n = readSync(0, chunk, 0, STDIN_CHUNK, null); }
    catch (e) {
      if (e && e.code === 'EAGAIN') continue;   // non-blocking stdin not ready: retry
      if (e && e.code === 'EOF') break;          // some platforms signal EOF as throw
      throw e;
    }
    if (n === 0) break;                          // clean EOF
    total += n;
    if (total > max) return { buf: null, overCap: true };
    parts.push(Buffer.from(chunk.subarray(0, n)));
  }
  return { buf: Buffer.concat(parts), overCap: false };
}
```

- [X] **[T-003] Step 6: Add `cmdSnapshot` and `cmdGetSnapshot` (after `cmdGetSession`)**

```js
async function cmdSnapshot(args) {
  if (args.length !== 1) { warn(U_SNAPSHOT); return; }
  const gitHash = validateKey('git_commit_hash', args[0], U_SNAPSHOT);
  if (gitHash === null) return;
  if (process.stdin.isTTY) { warn(`snap_json is empty; ${U_SNAPSHOT}`); return; }  // no-hang guard
  let buf, overCap;
  try { ({ buf, overCap } = readStdinCapped(MAX_SNAP_BYTES)); }
  catch (e) { warn(`error reading stdin: ${(e && e.code) || (e && e.message)}, skipping cache write`); return; }
  if (overCap) { warn(`snap_json exceeds ${MAX_SNAP_BYTES} bytes (10 MiB); rejected`); return; }
  if (buf.length === 0) { warn(`snap_json is empty; ${U_SNAPSHOT}`); return; }
  let snapJson;
  try { snapJson = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { warn('snap_json is not valid UTF-8; rejected'); return; }
  const root = resolveRoot();
  await withDb(root, (db) => {
    db.prepare('INSERT INTO snapshots (git_commit_hash, created_at, snap_json) VALUES ($h, $c, $j)')
      .run({ $h: gitHash, $c: new Date().toISOString(), $j: snapJson });
  });
}

async function cmdGetSnapshot(args) {
  if (args.length !== 1) { warn(U_GET_SNAPSHOT); return; }
  const gitHash = validateKey('git_commit_hash', args[0], U_GET_SNAPSHOT);
  if (gitHash === null) return;
  const root = resolveRoot();
  const row = await withDb(root, (db) =>
    db.prepare('SELECT snap_json FROM snapshots WHERE git_commit_hash = $h ORDER BY id DESC LIMIT 1').get({ $h: gitHash })
  );
  if (row) { process.stdout.write(row.snap_json); process.stdout.write('\n'); }
}
```

**`get-snapshot` output encoding (delimiter is a discrete ASCII byte):** `row.snap_json`
is a JS **string** (SQLite `TEXT` → string); `process.stdout.write(row.snap_json)` re-encodes
it as UTF-8. Because the payload was validated with `TextDecoder('utf-8',{fatal:true})` on
ingest (Step 5/6), that re-encode is **byte-for-byte lossless** — the emitted bytes equal the
stored bytes. The delimiter is written in a **separate** `process.stdout.write('\n')` call;
Node encodes the single-char `'\n'` string as exactly one `0x0A` byte (ASCII, never a
multibyte sequence), so the delimiter cannot corrupt or merge with multibyte tail bytes of
`snap_json`. Writing the two pieces as distinct `write` calls (rather than
`snap_json + '\n'` concatenation) keeps the payload encode and the delimiter byte
independent; the delimiter is equivalently expressible as `Buffer.from('\n')` — identical
`0x0A` — and the plan uses the string form for readability with the same guarantee. No
`setEncoding`/locale conversion is applied to stdout.

- [X] **[T-003] Step 7: Wire dispatch**

In `main`, add after the `get-session` line:
```js
  if (sub === 'snapshot') return cmdSnapshot(rest);
  if (sub === 'get-snapshot') return cmdGetSnapshot(rest);
```

- [X] **[T-003] Step 8: Run the snapshots block + full suite**

Run: `npx vitest run tests/scripts/conductor-db.test.js`
Expected: PASS.

- [X] **[T-003] Step 9: Commit**

```bash
git add scripts/conductor-db.mjs tests/scripts/conductor-db.test.js
git commit -m "feat(ARCH-008-S1): stdin-bounded snapshot + get-snapshot

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `history` (append-only raw log via stdin)

**Files:**
- Modify: `scripts/conductor-db.mjs` — add `cmdHistory`, dispatch
- Test: `tests/scripts/conductor-db.test.js` (add raw_history describe block)

**Interfaces:**
- Consumes: `readStdinCapped`, `MAX_CONTENT_BYTES`, `U_HISTORY`, `validateKey`, `validateOptional`.
- Produces: `cmdHistory(args)` (2 args: `session_id` required, `kind` optional; `content` ← stdin ≤1 MiB; append-only insert).

**Insertion ordering under same-millisecond writes (rowid, not timestamp):** `raw_history`
orders by its `id INTEGER PRIMARY KEY` (rowid alias), **not** by `created_at`. SQLite assigns
each `INSERT` a rowid of `max(rowid)+1`, so ids are strictly monotonically increasing in
insertion order regardless of whether two rows share the same millisecond `created_at`.
Every `history` invocation is a **separate, sequential** process, and even concurrent writers
serialize on the write lock (`BEGIN IMMEDIATE` + `busy_timeout`), each obtaining a distinct
higher id — so `ORDER BY id` (used by the read-back helper and any future consumer) always
reflects true insertion order, with no tie-break ambiguity that a same-`created_at` sort
would introduce. The `snapshots` table shares this guarantee (`get-snapshot` uses
`ORDER BY id DESC`). Step 1's test asserts two same-run inserts read back in insertion order.

- [X] **[T-004] Step 1: Write the failing history tests**

Append to `tests/scripts/conductor-db.test.js`:
```js
describe.skipIf(!HAS_SQLITE)('conductor-db history', () => {
  const dbPath = () => join(repo, '.conductor', 'cache.db');
  async function historyRows(p) {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(p);
    try { return db.prepare('SELECT session_id, kind, content FROM raw_history ORDER BY id').all(); }
    finally { db.close(); }
  }

  it('appends rows from stdin (no query subcommand exists — read out-of-band)', async () => {
    runDb(['history', 's1', 'stdout'], { cwd: repo, input: 'line one' });
    runDb(['history', 's1', 'stderr'], { cwd: repo, input: 'line two' });
    const rows = await historyRows(dbPath());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ session_id: 's1', kind: 'stdout', content: 'line one' });
    expect(rows[1]).toMatchObject({ session_id: 's1', kind: 'stderr', content: 'line two' });
  });

  it('accepts an empty kind (optional) but rejects empty content', async () => {
    runDb(['history', 's2', ''], { cwd: repo, input: 'body' });
    const rows = await historyRows(dbPath());
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('');
    const w = runDb(['history', 's2', 'k'], { cwd: repo, input: '' });
    expect(w.stderr).toContain('content is empty');
  });

  it('rejects content over 1 MiB (message cites the limit)', () => {
    const over = Buffer.alloc(1024 * 1024 + 1, 0x62);
    const w = runDb(['history', 's3', 'k'], { cwd: repo, input: over });
    expect(w.status).toBe(0);
    expect(w.stderr).toContain('content exceeds 1048576 bytes (1 MiB); rejected');
  });

  it('rejects wrong arg count and whitespace-only session_id', () => {
    expect(runDb(['history', 's1'], { cwd: repo, input: 'x' }).stderr)
      .toBe('CONDUCTOR_DB: usage: conductor-db.mjs history <session_id> <kind>\n');
    expect(runDb(['history', 's1', 'k', 'extra'], { cwd: repo, input: 'x' }).stderr)
      .toBe('CONDUCTOR_DB: usage: conductor-db.mjs history <session_id> <kind>\n');
    expect(runDb(['history', '   ', 'k'], { cwd: repo, input: 'x' }).stderr)
      .toContain('session_id is empty');
  });
});
```

- [X] **[T-004] Step 2: Run to verify failure**

Run: `npx vitest run tests/scripts/conductor-db.test.js -t "history"`
Expected: FAIL (`unknown subcommand "history"`).

- [X] **[T-004] Step 3: Add `cmdHistory` (after `cmdGetSnapshot`)**

```js
async function cmdHistory(args) {
  if (args.length !== 2) { warn(U_HISTORY); return; }
  const sessionId = validateKey('session_id', args[0], U_HISTORY);
  if (sessionId === null) return;
  const kind = validateOptional('kind', args[1]);
  if (kind === null) return;
  if (process.stdin.isTTY) { warn(`content is empty; ${U_HISTORY}`); return; }  // no-hang guard
  let buf, overCap;
  try { ({ buf, overCap } = readStdinCapped(MAX_CONTENT_BYTES)); }
  catch (e) { warn(`error reading stdin: ${(e && e.code) || (e && e.message)}, skipping cache write`); return; }
  if (overCap) { warn(`content exceeds ${MAX_CONTENT_BYTES} bytes (1 MiB); rejected`); return; }
  if (buf.length === 0) { warn(`content is empty; ${U_HISTORY}`); return; }
  let content;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { warn('content is not valid UTF-8; rejected'); return; }
  const root = resolveRoot();
  await withDb(root, (db) => {
    db.prepare('INSERT INTO raw_history (session_id, created_at, kind, content) VALUES ($s, $c, $k, $ct)')
      .run({ $s: sessionId, $c: new Date().toISOString(), $k: kind, $ct: content });
  });
}
```

- [X] **[T-004] Step 4: Wire dispatch**

In `main`, add after the `get-snapshot` line:
```js
  if (sub === 'history') return cmdHistory(rest);
```

- [X] **[T-004] Step 5: Run the history block + full suite**

Run: `npx vitest run tests/scripts/conductor-db.test.js`
Expected: PASS.

- [X] **[T-004] Step 6: Commit**

```bash
git add scripts/conductor-db.mjs tests/scripts/conductor-db.test.js
git commit -m "feat(ARCH-008-S1): append-only history subcommand

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Degraded-path + isolation guard tests

**Files:**
- Test: `tests/scripts/conductor-db.test.js` (add degradation + guard describe block)

**Interfaces:**
- Consumes: `BLOCK` fixture pattern (`fixtures/block-sqlite.mjs`, lines 296–313), `readRows`, temp-repo harness.
- Produces: no engine change — these tests pin the fail-open query contract and the no-real-cache invariant.

- [X] **[T-005] Step 1: Write the degradation + guard tests**

Append to `tests/scripts/conductor-db.test.js`:
```js
describe.skipIf(!HAS_SQLITE)('conductor-db query degradation + isolation', () => {
  const BLOCK = fileURLToPath(new URL('./fixtures/block-sqlite.mjs', import.meta.url));

  it('a query with node:sqlite absent writes zero bytes + one stderr line, exit 0', () => {
    // Seed a real session first (with sqlite present), then query with sqlite blocked.
    runDb(['session', 's1', 'p', 's', '0000000'], { cwd: repo });
    const r = spawnSync(process.execPath, [...FLAG, '--import', BLOCK, SCRIPT, 'get-session', 's1'],
      { cwd: repo, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');                       // zero bytes, not {} or null
    expect(r.stderr).toContain('node:sqlite unavailable, skipping cache write');
  });

  it('a payload subcommand still validates stdin before the node:sqlite import fails', () => {
    const r = spawnSync(process.execPath, [...FLAG, '--import', BLOCK, SCRIPT, 'snapshot', 'h'],
      { cwd: repo, encoding: 'utf8', input: '' });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('snap_json is empty');   // stdin validated (read precedes withDb)
  });

  it('isolation guard: subcommands honor cwd and never touch the real project cache', () => {
    // Every runDb here targets the temp `repo`; assert the write landed there and
    // that nothing resolved to a different root. (Real-root protection is structural:
    // resolveRoot uses git toplevel / .git walk from cwd=repo.)
    runDb(['session', 'guard', 'p', 's', '0000000'], { cwd: repo });
    expect(existsSync(join(repo, '.conductor', 'cache.db'))).toBe(true);
    const outside = join(repo, '..', '.conductor', 'cache.db');
    expect(existsSync(outside)).toBe(false);            // parent dir untouched
  });
});
```

- [X] **[T-005] Step 1b: Add the migration-failure recovery test (open-probe corruption → v2 rebuild)**

This is the spec-mandated "migration-failure recovery" case and it also documents the
**file-descriptor discipline** the reviewer asked about. The corruption is seeded with
`writeFileSync`, which **opens, writes, and closes the fd synchronously before returning** —
so by the time the child engine runs there is **no lingering writer handle** on POSIX; no
manual `close`/fd-release call is needed for `backupAside`'s `renameSync` to succeed. (On
Windows, where a just-released handle can linger briefly, the suite's existing `afterEach`
already retries `rmSync` with `maxRetries`; the recovery `renameSync` targets the same
directory and is not blocked by the closed writer.) Append to the same describe block:
```js
  it('migration-failure recovery: corrupt bytes at the db path rebuild a fresh v2 db', async () => {
    const conductorDir = join(repo, '.conductor');
    const dbPath = join(conductorDir, 'cache.db');
    mkdirSync(conductorDir, { recursive: true });
    writeFileSync(dbPath, 'notadb corrupt bytes');   // fd opened+written+CLOSED synchronously here

    const r = runDb(['session', 's1', 'p', 's', '0000000'], { cwd: repo });
    expect(r.status).toBe(0);                          // fail-open
    expect(r.stderr).toBe('');                         // successful backupAside recovery is SILENT (zero CONDUCTOR_DB lines)

    const moved = readdirSync(conductorDir).filter((f) => f.startsWith('cache.db.corrupt.'));
    expect(moved).toHaveLength(1);                     // bad file moved aside, never rm -r'd

    const { DatabaseSync } = await import('node:sqlite');
    const check = new DatabaseSync(dbPath);            // fresh db opened cleanly
    try {
      expect(check.prepare('PRAGMA user_version').get().user_version).toBe(2);   // rebuilt at v2
      const t = check.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((x) => x.name);
      expect(t).toEqual(expect.arrayContaining(['raw_history', 'sessions', 'snapshots', 'task_state']));
      expect(check.prepare("SELECT session_id FROM sessions WHERE session_id='s1'").get().session_id).toBe('s1');  // write landed
    } finally { check.close(); }
  });
```
(`writeFileSync`, `mkdirSync`, `readdirSync` are already imported by the suite — lines 224, 315.)

- [X] **[T-005] Step 2: Run the degradation block + full suite**

Run: `npx vitest run tests/scripts/conductor-db.test.js`
Expected: PASS (all describe blocks green).

- [X] **[T-005] Step 3: Run the whole repo test-gate**

Run: `npm test`
Expected: PASS — total test count increased from 302 (new cases added), zero regressions.

- [X] **[T-005] Step 4: Commit**

```bash
git add tests/scripts/conductor-db.test.js
git commit -m "test(ARCH-008-S1): degraded-query + isolation guard coverage

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Version bump + changelog + tracking-file update

**Files:**
- Modify: `VERSION`, `package.json:3`, `CHANGELOG.md` (new top entry)
- Modify: `AGENT-READABLE BACKLOG.md` (`[ARCH-008-S1]` `[ ]` → `[X]`), `.claude/memory/project.md` (append ship line)

**Interfaces:** none (release bookkeeping).

- [X] **[T-006] Step 1: Bump `VERSION`**

Replace the single line `1.19.0` with `1.20.0`.

- [X] **[T-006] Step 2: Bump `package.json` version**

Line 3: `"version": "1.19.0",` → `"version": "1.20.0",`.

- [X] **[T-006] Step 2b: Sync the two root-version references in `package-lock.json`**

`package-lock.json` embeds the project's own version twice — at the top level (line 3) and
in the root `packages[""]` entry (line 8). Both are currently **stale at `1.17.0`** (they
were not bumped for 1.18.0 or 1.19.0). Surgically set **both** to `1.20.0` so the lockfile
matches `package.json`; do **not** run `npm install`/`--package-lock-only` (this repo is
zero-runtime-dependency and regeneration could churn the unrelated `0.27.7` dev-dep tree).
Only these two `"version": "1.17.0"` lines (the `name`-less/root entries) change; the
`0.27.7` dependency entries are untouched. Verify afterward:
```bash
grep -n '"version": "1.20.0"' package-lock.json   # expect exactly lines 3 and 8
grep -c '"version": "1.17.0"' package-lock.json    # expect 0
```

- [X] **[T-006] Step 3: Prepend the CHANGELOG entry**

Insert directly under the `# Changelog` header (before `## [1.19.0]`):
```markdown
## [1.20.0] - 2026-07-04

### Added
- `[ARCH-008-S1]` `scripts/conductor-db.mjs`: additive `user_version` 1→2 migration creating `sessions(session_id PK WITHOUT ROWID, started_at, updated_at, phase, spec, git_commit_hash)`, `snapshots(id INTEGER PK, git_commit_hash, created_at, snap_json)` + `idx_snapshots_hash`, and `raw_history(id INTEGER PK, session_id, created_at, kind, content)` + `idx_raw_history_session`, alongside the untouched `task_state`. Five fail-open subcommands: `session` (ON CONFLICT DO UPDATE upsert, preserves `started_at`), `get-session` (fixed-key single-line JSON), `snapshot` / `history` (payload from stdin via bounded `readStdinCapped`, 10 MiB / 1 MiB caps, strict UTF-8), `get-snapshot` (newest blob `ORDER BY id DESC LIMIT 1`, byte-for-byte). Query commands emit one line on hit, zero bytes on miss/degradation; writes stay empty-stdout/exit-0. No FKs, no pruning, no env override. Named `$name` binding for new statements.
- `[ARCH-008-S1]` `tests/scripts/conductor-db.test.js`: migration (v1→v2 in place, DROP-free, index accounting), each subcommand, query round-trip, >128 KiB stdin round-trip (no ARG_MAX ceiling), 10 MiB/1 MiB over-cap rejection, malformed-UTF-8 rejection, empty-stdin/TTY no-hang, fixed key order, CR/whitespace, degraded-query zero-byte output, and isolation guard.

### Changed
- `[ARCH-008-S1]` `scripts/conductor-db.mjs`: `withDb` now returns its callback's value (query support); `validateKey` gains an optional per-subcommand `usage` argument; `SCHEMA_VERSION` bumped to 2. `record`/`init` behaviour and stderr strings unchanged.
```

- [X] **[T-006] Step 4: Surgically flip the backlog sub-item**

In `AGENT-READABLE BACKLOG.md`, change the single line `### [ ] [ARCH-008-S1]` to `### [X] [ARCH-008-S1]` (one-line edit; leave the umbrella `[ARCH-008]` and sibling sub-items untouched — BUG-003 invariant).

- [X] **[T-006] Step 5: Append the ship line to project memory**

Append one dated line under the existing `## Spec: ARCH-008-S1` section in `.claude/memory/project.md`:
```markdown
- Shipped 2026-07-04 as v1.20.0 (schema engine only; ARCH-008-A/B still open).
```

- [X] **[T-006] Step 6: Final full test-gate**

Run: `npm test`
Expected: PASS.

- [X] **[T-006] Step 7: Commit**

```bash
git add VERSION package.json package-lock.json CHANGELOG.md "AGENT-READABLE BACKLOG.md"
git add -f .claude/memory/project.md
git commit -m "chore(ARCH-008-S1): release v1.20.0 — relational schema engine

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Test List

- [ ] Migration: init creates 4 tables + 2 indexes + `user_version=2`; v1→v2 in place preserves `task_state` rows; DROP-free third-party index survives (T-001)
- [ ] Retargeted FEAT-005: `user_version=2` post-record; forward-compat bail on seeded `user_version=3` (T-001)
- [ ] `session`/`get-session`: fixed-key JSON, `started_at` preservation, `""` not null, CR single-line, miss zero-bytes, whitespace/arg-count rejection (T-002)
- [ ] `snapshot`/`get-snapshot`: byte-exact round-trip, newest-wins, >128 KiB round-trip, 10 MiB over-cap, empty/malformed-UTF-8 rejection, no-hang, miss zero-bytes (T-003)
- [ ] `history`: append order, optional-kind/empty-content, 1 MiB over-cap, arg-count/whitespace rejection (T-004)
- [ ] Degradation: query with `node:sqlite` blocked → zero bytes + one line; payload validated pre-import; isolation guard (T-005)
- [ ] Repo-wide `npm test` gate green (T-005, T-006)

## Commit Order

1. T-001 — migration + retargeted tests (one commit)
2. T-002 — session/get-session (one commit)
3. T-003 — snapshot/get-snapshot (one commit)
4. T-004 — history (one commit)
5. T-005 — degradation + guard tests (one commit)
6. T-006 — release bookkeeping (one commit)

## Identified Risks

- **Ambiguity resolution (git_commit_hash):** the spec's Behavior section calls it optional on `sessions`, but the authoritative hardening/validation table classifies it required non-empty. **Resolved: required non-empty (validateKey) in all subcommands**, per user confirmation; callers pass the `"0000000"` sentinel when no commit exists. If a truly empty stored hash is ever needed, this is the single line to revisit.
- **Version-coupled existing tests:** the `user_version` bump breaks two FEAT-005 assertions; T-001 Step 1 retargets both *before* the engine change so the suite is green at each commit boundary — caught early by running T-001 Steps 3 and 7.
- **`withDb` return change:** the `finally` (checkpoint + close) still runs after `return fn(db)`; the `catch` still yields `undefined`. Risk that a write callback's `undefined` return is mistaken for degradation — mitigated because only query commands inspect the value; writes ignore it.
- **`readStdinCapped` EAGAIN spin:** a non-blocking stdin that never delivers could busy-loop; realistic callers pipe a finite payload and spawnSync closes stdin at EOF. The TTY guard + closed-pipe EOF cover the hang case; the T-003 no-hang test asserts termination under a 5 s spawnSync `timeout`.
- **10 MiB over-cap allocation in tests:** the over-cap test allocates ~10 MiB; acceptable for a single case. `readStdinCapped` itself never buffers past the cap (aborts at first chunk crossing it).
- **True TTY simulation:** not portably reproducible in `spawnSync`; the no-hang regression is covered via closed-pipe EOF + `timeout`, matching the spec's stated intent (never block an operator).
```
