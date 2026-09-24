# FEAT-025 Implementation Plan — Bounded retention for the conductor cache DB

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `snapshots` and `raw_history` growing without bound by purging id-ordered excess rows after each append, fail-open, with no schema change.

**Architecture:** One `purgeTable(db, { table, key, keepPerKey, softCap, hardMax })` helper in `scripts/conductor-db.mjs` expresses the whole policy as three bounds applied in order — per-key trim (skipped when `keepPerKey` is `null`), soft cap with a newest-per-key floor, hard ceiling with no floor. It is called on the same `db` handle as the statement immediately after each `INSERT`, inside its own `try`/`catch`. `snapshots` uses all three bounds (3 / 200 / 500); `raw_history` is an ordered log and disables bound 1 (`null` / 1000 / 2000).

**Tech Stack:** Node >= 20 ESM (`node:sqlite` needs >= 22.5 and self-disables below), zero runtime dependencies, Vitest ^3.0.0.

**Spec:** `docs/superpowers/specs/2026-09-22-feat025-conductor-db-retention-purge-design.md` (revision 5, approved)

## Global Constraints

- Node `>=20` (`package.json` `engines.node`); zero runtime dependencies; `node:sqlite` only.
- `SCHEMA_VERSION` stays `2`. `applySchema` is not edited and no migration ships.
- The purge never reads the clock: no date function, no `created_at` comparison, no age window. An age window would evict the only snapshot for a long-idle HEAD and silently break `/cc-resume`.
- Every bound deletes oldest-first only. `id` is the rowid **without** `AUTOINCREMENT`, so deleting the highest row would let SQLite reuse its id and destroy `ORDER BY id DESC LIMIT 1` as a recency ordering.
- Every `excess` is computed in JavaScript from a `COUNT(*)` read **after the previous bound ran**; the `DELETE` is skipped when `excess <= 0`. No non-positive `LIMIT` is ever issued and no negative-limit guard exists in the SQL.
- Fail-open convention: one `CONDUCTOR_DB:` stderr line, exit 0, never throw. The purge's `try`/`catch` wraps the `purgeTable` call and nothing else.
- VERBOSITY: MIN response protocol; `[CHANGES]` always, `[VALIDATION]` after implementation tasks, `[BUG]` never suppressed.
- Plan-state updates are surgical single-line checkbox edits only (BUG-003 invariant). Never rewrite this file in bulk.
- Every commit must leave `npm test` green — the pre-commit hook runs the full suite and rejects otherwise.
- Use `git add` + plain `git commit`. Never `git commit <pathspec>`: the partial-commit temporary index makes `smoke.test.js > committed entry mode > is 100755 in git` fail falsely.
- Anchors below were verified against the working tree at `VERSION` = 1.24.1. Re-locate by symbol, never by line number.
- Comments explain why, never what. Functions do one thing. No speculative abstractions.
- `docs/` is gitignored. Per the FEAT-005 / FEAT-024 ritual this plan file is force-added to git at approval (Task 0); the **spec** is not, and stays on disk only.
- The `[FEAT-025]` backlog checkbox travels `[ ]` → `[>]` at plan approval (Task 0) → `[X]` at closeout (T-004-D). The closeout edit therefore expects `[>]`, not `[ ]`.

## File Structure

| File | Responsibility |
|---|---|
| `scripts/conductor-db.mjs` | Adds six module constants, the `purgeTable` helper, and the two call sites in `cmdSnapshot` / `cmdHistory`. Everything else — `applySchema`, `withDb`, `openReady`, `upsert`, `cmdGetSnapshot`, `cmdGetSession`, `cmdRecord` — is untouched. |
| `tests/scripts/conductor-db.test.js` | Gains one `describe` block, `conductor-db retention purge`, with its own out-of-band seeding helpers. The existing 57 tests are not edited. |
| `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md` | Release closeout only (Task 4). |

**Why out-of-band seeding.** Boundary cases need 200–2001 rows. Driving that through the CLI is 2000 process spawns; the tests instead bulk-insert on the runner's own `DatabaseSync` connection inside one transaction, then perform **one real CLI write** to trigger the purge. Every seed count in this plan is therefore stated **net of that triggering write**.

---

### Task 0: Save the plan and mark FEAT-025 in progress

**Files:**
- Add (forced): `docs/superpowers/plans/2026-09-24-feat025-conductor-db-retention-purge.md`
- Modify: `AGENT-READABLE BACKLOG.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the committed plan file the `cc-implement` locator greps, and the `[>]` state T-004-D flips.

- [X] [T-000-A] Mark the backlog entry in progress

Surgical single-line edit in `AGENT-READABLE BACKLOG.md` (BUG-003 invariant): on the `### [ ] \`[FEAT-025]\`` heading, `[ ]` becomes `[>]`. Change nothing else on the line. This is the FEAT-005 / FEAT-024 convention — an approved-but-unfinished item is visibly distinct from an untouched one, and the closeout has a unique token to flip.

- [X] [T-000-B] Commit the plan and the in-progress mark

`docs/` is gitignored, so the plan needs `-f`. The spec is deliberately left uncommitted.

```bash
git add -f docs/superpowers/plans/2026-09-24-feat025-conductor-db-retention-purge.md
git add "AGENT-READABLE BACKLOG.md"
git commit -m "docs: add the FEAT-025 retention purge implementation plan"
```

---

### Task 1: The helper, bound 1, the snapshots call site, and its fail-open guard

**Files:**
- Modify: `scripts/conductor-db.mjs` (constants after `STDIN_CHUNK`; `purgeTable` before `withDb`; call site inside `cmdSnapshot`)
- Test: `tests/scripts/conductor-db.test.js` (new `describe` block appended at end of file)

**Interfaces:**
- Consumes: nothing from Task 0 beyond the committed plan file.
- Produces: `purgeTable(db, { table, key, keepPerKey, softCap, hardMax })` — returns `undefined`, throws on SQL failure; the constants `SNAPSHOT_KEEP_PER_HASH`, `SNAPSHOT_SOFT_CAP`, `SNAPSHOT_HARD_MAX`, `HISTORY_KEEP_PER_SESSION`, `HISTORY_SOFT_CAP`, `HISTORY_HARD_MAX`; and the test helpers `withRunnerDb`, `seedSnapshots`, `seedHistory`, `countOf`, `distinctHashes`, `rowsForHash`, which Tasks 2 and 3 reuse verbatim.

- [X] [T-001-A] Write the failing tests for bound 1 and the fail-open path

Append this block to the end of `tests/scripts/conductor-db.test.js`:

```js
describe.skipIf(!HAS_SQLITE)('conductor-db retention purge', () => {
  const dbPath = () => join(repo, '.conductor', 'cache.db');

  // Boundary cases need hundreds of rows. Driving that through the CLI is
  // hundreds of process spawns, so rows are bulk inserted on the runner's own
  // connection and ONE real CLI write then triggers the purge. Every seed count
  // below is stated net of that write.
  async function withRunnerDb(fn) {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath());
    try { return fn(db); } finally { db.close(); }
  }

  const seedSnapshots = (hashes, createdAt = new Date().toISOString()) => withRunnerDb((db) => {
    db.exec('BEGIN');
    const st = db.prepare('INSERT INTO snapshots (git_commit_hash, created_at, snap_json) VALUES (?, ?, ?)');
    for (const h of hashes) st.run(h, createdAt, `seed-${h}`);
    db.exec('COMMIT');
  });

  const seedHistory = (sessions) => withRunnerDb((db) => {
    db.exec('BEGIN');
    const st = db.prepare("INSERT INTO raw_history (session_id, created_at, kind, content) VALUES (?, ?, 'k', 'c')");
    for (const s of sessions) st.run(s, new Date().toISOString());
    db.exec('COMMIT');
  });

  const countOf = (table) => withRunnerDb((db) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
  const distinctHashes = () => withRunnerDb((db) =>
    db.prepare('SELECT COUNT(DISTINCT git_commit_hash) AS n FROM snapshots').get().n);
  const rowsForHash = (h) => withRunnerDb((db) =>
    db.prepare('SELECT snap_json FROM snapshots WHERE git_commit_hash = ? ORDER BY id').all(h));

  beforeEach(() => { runDb(['init'], { cwd: repo }); });   // schema must exist before out-of-band seeding

  it('bound 1 boundary: 2 seeded + 1 write = 3 rows on one hash, nothing deleted', async () => {
    await seedSnapshots(['h1', 'h1']);
    const w = runDb(['snapshot', 'h1'], { cwd: repo, input: 'newest' });
    expect(w.status).toBe(0);
    expect(await countOf('snapshots')).toBe(3);
  });

  it('bound 1 boundary: 3 seeded + 1 write = 4 rows, trimmed to the newest 3', async () => {
    await seedSnapshots(['h1', 'h1', 'h1']);
    runDb(['snapshot', 'h1'], { cwd: repo, input: 'newest' });
    const rows = await rowsForHash('h1');
    expect(rows.map(r => r.snap_json)).toEqual(['seed-h1', 'seed-h1', 'newest']);
  });

  it('never deletes the row the current command inserted', async () => {
    await seedSnapshots(Array(10).fill('h1'));
    runDb(['snapshot', 'h1'], { cwd: repo, input: 'newest' });
    expect(await countOf('snapshots')).toBe(3);
    expect(runDb(['get-snapshot', 'h1'], { cwd: repo }).stdout).toBe('newest\n');
  });

  it('get-snapshot is unaffected for every hash that still has a row', async () => {
    await seedSnapshots(['a', 'a', 'a', 'b']);
    runDb(['snapshot', 'a'], { cwd: repo, input: 'a-new' });
    expect(runDb(['get-snapshot', 'a'], { cwd: repo }).stdout).toBe('a-new\n');
    expect(runDb(['get-snapshot', 'b'], { cwd: repo }).stdout).toBe('seed-b\n');
  });

  it('ignores the clock: 1970-stamped rows under every bound survive', async () => {
    await seedSnapshots(['c1', 'c2', 'c3'], '1970-01-01T00:00:00.000Z');
    runDb(['snapshot', 'c4'], { cwd: repo, input: 'now' });
    expect(await countOf('snapshots')).toBe(4);
  });

  it('a purge failure exits 0, keeps the inserted row, and warns exactly once', async () => {
    // A BEFORE DELETE trigger fires per row, so the fixture must seed PAST a
    // bound: 3 rows on one hash make the CLI write a 4th and give bound 1 a row
    // to delete. A 2-row fixture produces a DELETE that matches nothing, a
    // trigger that never fires, and a green test that asserted nothing.
    await seedSnapshots(['boom', 'boom', 'boom']);
    await withRunnerDb((db) => db.exec(
      "CREATE TRIGGER purge_boom BEFORE DELETE ON snapshots BEGIN SELECT RAISE(ABORT, 'boom'); END;"
    ));
    const w = runDb(['snapshot', 'boom'], { cwd: repo, input: 'survivor' });
    expect(w.status).toBe(0);
    expect(w.stdout).toBe('');
    // Scoped count: other legitimate non-fatal warns may co-occur on some hosts.
    const hits = w.stderr.split('\n').filter(l => l.includes('retention purge skipped (snapshots):'));
    expect(hits).toHaveLength(1);
    expect(await countOf('snapshots')).toBe(4);           // insert committed, nothing deleted
    expect(runDb(['get-snapshot', 'boom'], { cwd: repo }).stdout).toBe('survivor\n');
  });
});
```

- [X] [T-001-B] Run the new tests and verify they fail

Run: `npx vitest run tests/scripts/conductor-db.test.js -t 'retention purge'`
Expected: FAIL — `bound 1 boundary: 3 seeded + 1 write` reports 4 rows instead of 3, and the fail-open test finds 0 matching stderr lines.

- [X] [T-001-C] Add the retention constants

In `scripts/conductor-db.mjs`, immediately after the `const STDIN_CHUNK = 65536;` line:

```js
// FEAT-025 retention bounds. Row counts, never the clock: an age window would
// evict the only snapshot for a long-idle HEAD and silently break /cc-resume.
const SNAPSHOT_KEEP_PER_HASH = 3;
const SNAPSHOT_SOFT_CAP = 200;
const SNAPSHOT_HARD_MAX = 500;
const HISTORY_KEEP_PER_SESSION = null;   // an ordered log is truncated, never thinned
const HISTORY_SOFT_CAP = 1000;
const HISTORY_HARD_MAX = 2000;
```

- [X] [T-001-D] Add `purgeTable` with bound 1 only

In `scripts/conductor-db.mjs`, between `upsertSession` and `async function withDb`:

```js
// Bounded retention for the two append-only tables (FEAT-025). Bounds are
// applied in order and keyed on `id`; `table` and `key` are module constants,
// never user input, so interpolating them is safe where a bound parameter
// cannot be used.
//
// `id` is the rowid WITHOUT AUTOINCREMENT: SQLite assigns MAX(rowid) + 1, so
// deleting the highest row would let the next insert reuse its id and silently
// break `ORDER BY id DESC LIMIT 1` as a recency ordering. Every bound deletes
// oldest-first only, which is what keeps that ordering true.
function purgeTable(db, { table, key, keepPerKey, softCap, hardMax }) {
  const count = () => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  let n = count();

  // Bound 1 — keep the newest `keepPerKey` rows per key. `null` skips it:
  // thinning an ordered log in place would destroy it rather than bound it.
  // `n <= keepPerKey` skips it too — a total at or under the per-key budget
  // cannot have a key that exceeds it — so the ordinary write, which is every
  // write on a healthy db, issues no DELETE at all rather than a windowed one
  // matching zero rows. The recount runs only when the DELETE actually ran.
  if (keepPerKey !== null && n > keepPerKey) {
    db.prepare(
      `DELETE FROM ${table} WHERE id IN (SELECT id FROM (` +
      `SELECT id, ROW_NUMBER() OVER (PARTITION BY ${key} ORDER BY id DESC) AS rn FROM ${table}` +
      `) WHERE rn > $keep)`
    ).run({ $keep: keepPerKey });
    n = count();
  }
}
```

`n` is written and not yet read here; Task 2 consumes it. `softCap` and `hardMax` are
likewise destructured and unused until Task 2 — that is the TDD increment, not dead code
to prune.

- [X] [T-001-E] Wire the snapshots call site with its scoped `try`/`catch`

In `cmdSnapshot`, replace the `withDb` callback body so it reads:

```js
  await withDb(root, (db) => {
    db.prepare('INSERT INTO snapshots (git_commit_hash, created_at, snap_json) VALUES ($h, $c, $j)')
      .run({ $h: gitHash, $c: new Date().toISOString(), $j: snapJson });
    // Same connection, statement immediately after the already-autocommitted
    // INSERT — never a second withDb open, which would pay the checkpoint/close
    // cost twice and re-enter the recovery ladder for a best-effort cleanup.
    // The catch wraps the purge ALONE: a throw reaching withDb's catch would
    // misreport this committed write as "skipping cache write".
    try {
      purgeTable(db, {
        table: 'snapshots', key: 'git_commit_hash',
        keepPerKey: SNAPSHOT_KEEP_PER_HASH,
        softCap: SNAPSHOT_SOFT_CAP,
        hardMax: SNAPSHOT_HARD_MAX,
      });
    } catch (e) {
      warn(`retention purge skipped (snapshots): ${(e && e.code) || (e && e.message)}`);
    }
  });
```

- [X] [T-001-F] Run the full suite and verify it passes

Run: `npm test`
Expected: PASS — the six new tests green, the existing 57 in this file and the rest of the suite unchanged.

- [X] [T-001-G] Commit

```bash
git add scripts/conductor-db.mjs tests/scripts/conductor-db.test.js
git commit -m "feat: bound snapshots to 3 rows per commit hash [FEAT-025]"
```

---

### Task 2: Bounds 2 and 3

**Files:**
- Modify: `scripts/conductor-db.mjs` (`purgeTable` body only)
- Test: `tests/scripts/conductor-db.test.js` (append inside the existing `conductor-db retention purge` describe)

**Interfaces:**
- Consumes: `purgeTable` and all six constants from Task 1; the test helpers `seedSnapshots`, `countOf`, `distinctHashes` from Task 1.
- Produces: `purgeTable` honouring `softCap` and `hardMax`, which Task 3 relies on for `raw_history`.

**Dependency:** requires Task 1.

- [X] [T-002-A] Write the failing tests for bounds 2 and 3

Append inside the `conductor-db retention purge` describe block, after the fail-open test:

```js
  it('bound 2 boundary: 199 seeded + 1 write = 200 rows, nothing deleted', async () => {
    const seed = [];
    for (let i = 0; i < 99; i++) seed.push(`s${i}`, `s${i}`);   // 198 rows over 99 hashes
    seed.push('s99');                                           // 199 rows over 100 hashes
    await seedSnapshots(seed);
    runDb(['snapshot', 'fresh'], { cwd: repo, input: 'n' });
    expect(await countOf('snapshots')).toBe(200);
  });

  it('bound 2 boundary: 200 seeded + 1 write = 201 rows, trimmed to the soft cap', async () => {
    const seed = [];
    for (let i = 0; i < 100; i++) seed.push(`s${i}`, `s${i}`);  // 200 rows over 100 hashes
    await seedSnapshots(seed);
    runDb(['snapshot', 'fresh'], { cwd: repo, input: 'n' });
    expect(await countOf('snapshots')).toBe(200);
    expect(await distinctHashes()).toBe(101);                   // every hash keeps its floor row
  });

  it('bound 2 settles at max(softCap, distinctKeys) when every row is a floor', async () => {
    const seed = [];
    for (let i = 0; i < 299; i++) seed.push(`k${i}`);           // 299 single-row hashes
    await seedSnapshots(seed);
    runDb(['snapshot', 'k299'], { cwd: repo, input: 'n' });     // 300 rows, 300 hashes
    expect(await countOf('snapshots')).toBe(300);               // NOT 200 — the floor protects all of them
  });

  it('bound 3 boundary: 499 single-row hashes + 1 write = 500 rows, nothing deleted', async () => {
    const seed = [];
    for (let i = 0; i < 499; i++) seed.push(`m${String(i).padStart(4, '0')}`);
    await seedSnapshots(seed);
    runDb(['snapshot', 'm9999'], { cwd: repo, input: 'newest' });
    expect(await countOf('snapshots')).toBe(500);
  });

  it('bound 3 trims a floor-saturated table to exactly hardMax, oldest-first', async () => {
    const seed = [];
    for (let i = 0; i < 600; i++) seed.push(`m${String(i).padStart(4, '0')}`);
    await seedSnapshots(seed);
    runDb(['snapshot', 'm9999'], { cwd: repo, input: 'newest' });   // 601 rows, 601 hashes
    expect(await countOf('snapshots')).toBe(500);
    expect(runDb(['get-snapshot', 'm9999'], { cwd: repo }).stdout).toBe('newest\n');   // newest survives
    expect(runDb(['get-snapshot', 'm0000'], { cwd: repo }).stdout).toBe('');           // oldest evicted
  });
```

- [X] [T-002-B] Run the new tests and verify they fail

Run: `npx vitest run tests/scripts/conductor-db.test.js -t 'bound 2'`
Expected: FAIL — `bound 2 boundary: 200 seeded` reports 201 rows; `bound 3 trims` reports 601.

- [X] [T-002-C] Implement bounds 2 and 3

In `purgeTable`, append after the bound-1 block, consuming the `n` Task 1 already maintains:

```js
  // Bound 2 — soft cap with a newest-per-key floor. `n` reflects bound 1's
  // deletions: it was recounted iff bound 1 issued its DELETE, and is otherwise
  // unchanged by definition. Only `n - distinctKeys` rows are eligible, so the
  // table settles at max(softCap, distinctKeys) and every represented key keeps
  // the row `get-snapshot` reads.
  let excess = n - softCap;
  if (excess > 0) {
    db.prepare(
      `DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} ` +
      `WHERE id NOT IN (SELECT MAX(id) FROM ${table} GROUP BY ${key}) ` +
      `ORDER BY id ASC LIMIT $excess)`
    ).run({ $excess: excess });
    n = count();
  }

  // Bound 3 — hard ceiling, no floor. Same rule: `n` was recounted iff bound 2
  // issued its DELETE. Reachable only when more than `hardMax` distinct keys
  // each hold a floor row bound 2 could not touch; the oldest keys' rows go,
  // recent ones never do.
  excess = n - hardMax;
  if (excess > 0) {
    db.prepare(
      `DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} ORDER BY id ASC LIMIT $excess)`
    ).run({ $excess: excess });
  }
```

A write on a healthy db now costs exactly one `COUNT(*)` and zero `DELETE`s, which is
what the spec's "table under every bound" path describes.

- [X] [T-002-D] Run the full suite and verify it passes

Run: `npm test`
Expected: PASS — eleven tests in the new block, everything else unchanged.

- [X] [T-002-E] Commit

```bash
git add scripts/conductor-db.mjs tests/scripts/conductor-db.test.js
git commit -m "feat: add soft-cap and hard-ceiling bounds to the cache purge [FEAT-025]"
```

---

### Task 3: The `raw_history` call site and cross-table isolation

**Files:**
- Modify: `scripts/conductor-db.mjs` (call site inside `cmdHistory`)
- Test: `tests/scripts/conductor-db.test.js` (append inside the existing describe)

**Interfaces:**
- Consumes: `purgeTable`, `HISTORY_KEEP_PER_SESSION`, `HISTORY_SOFT_CAP`, `HISTORY_HARD_MAX` from Tasks 1–2; the helpers `seedHistory`, `seedSnapshots`, `countOf`.
- Produces: nothing later tasks consume.

**Dependency:** requires Task 2 (bound 1 is disabled here, so `raw_history` is held by bounds 2 and 3 alone).

- [X] [T-003-A] Write the failing tests for `raw_history` and isolation

Append inside the `conductor-db retention purge` describe block:

```js
  it('raw_history keeps every row of a session: bound 1 is disabled', async () => {
    await seedHistory(Array(10).fill('s1'));
    runDb(['history', 's1', 'k'], { cwd: repo, input: 'tail' });
    expect(await countOf('raw_history')).toBe(11);   // an ordered log is never thinned in place
  });

  it('raw_history bound 2 boundary: 999 seeded + 1 write = 1000 rows, nothing deleted', async () => {
    await seedHistory(Array(999).fill('s1'));
    runDb(['history', 's1', 'k'], { cwd: repo, input: 'tail' });
    expect(await countOf('raw_history')).toBe(1000);
  });

  it('raw_history bound 2 boundary: 1000 seeded + 1 write = 1001 rows, oldest end truncated', async () => {
    await seedHistory(Array(1000).fill('s1'));
    runDb(['history', 's1', 'k'], { cwd: repo, input: 'tail' });
    expect(await countOf('raw_history')).toBe(1000);
    const newest = await withRunnerDb((db) =>
      db.prepare('SELECT content FROM raw_history ORDER BY id DESC LIMIT 1').get());
    expect(newest.content).toBe('tail');
  });

  it('raw_history bound 3 trims a floor-saturated table to hardMax', async () => {
    await seedHistory(Array.from({ length: 2000 }, (_, i) => `s${i}`));   // 2000 distinct sessions
    runDb(['history', 's2000', 'k'], { cwd: repo, input: 'tail' });       // 2001 rows, all floors
    expect(await countOf('raw_history')).toBe(2000);
  });

  it('cross-table isolation: a snapshots purge deletes from no other table', async () => {
    await seedSnapshots(['x', 'x', 'x']);
    await seedHistory(['s1', 's1']);
    runDb(['record', 'plan.md', 'T-001', 'X'], { cwd: repo });
    runDb(['session', 'sess', 'plan', 'spec', 'x'], { cwd: repo });
    runDb(['snapshot', 'x'], { cwd: repo, input: 'n' });   // fires bound 1
    expect(await countOf('snapshots')).toBe(3);
    expect(await countOf('raw_history')).toBe(2);
    expect(await countOf('sessions')).toBe(1);
    expect(await countOf('task_state')).toBe(1);
  });

  it('cross-table isolation: a raw_history purge deletes from no other table', async () => {
    await seedSnapshots(['y', 'y']);
    await seedHistory(Array(1000).fill('s1'));
    runDb(['record', 'plan.md', 'T-001', 'X'], { cwd: repo });
    runDb(['session', 'sess', 'plan', 'spec', 'y'], { cwd: repo });
    runDb(['history', 's1', 'k'], { cwd: repo, input: 'tail' });   // fires bound 2
    expect(await countOf('raw_history')).toBe(1000);
    expect(await countOf('snapshots')).toBe(2);
    expect(await countOf('sessions')).toBe(1);
    expect(await countOf('task_state')).toBe(1);
  });
```

- [X] [T-003-B] Run the new tests and verify they fail

Run: `npx vitest run tests/scripts/conductor-db.test.js -t 'raw_history bound'`
Expected: FAIL — `raw_history bound 2 boundary: 1000 seeded` reports 1001 rows.

- [X] [T-003-C] Wire the `raw_history` call site

In `cmdHistory`, replace the `withDb` callback body so it reads:

```js
  await withDb(root, (db) => {
    db.prepare('INSERT INTO raw_history (session_id, created_at, kind, content) VALUES ($s, $c, $k, $ct)')
      .run({ $s: sessionId, $c: new Date().toISOString(), $k: kind, $ct: content });
    // Bound 1 is disabled for this table: keeping only the newest few rows per
    // session would destroy an ordered log rather than bound it. Same
    // connection, same scoped catch as the snapshots call site.
    try {
      purgeTable(db, {
        table: 'raw_history', key: 'session_id',
        keepPerKey: HISTORY_KEEP_PER_SESSION,
        softCap: HISTORY_SOFT_CAP,
        hardMax: HISTORY_HARD_MAX,
      });
    } catch (e) {
      warn(`retention purge skipped (raw_history): ${(e && e.code) || (e && e.message)}`);
    }
  });
```

- [X] [T-003-D] Run the full suite and verify it passes

Run: `npm test`
Expected: PASS — seventeen tests in the new block; the existing 57 in this file green.

- [X] [T-003-E] Commit

```bash
git add scripts/conductor-db.mjs tests/scripts/conductor-db.test.js
git commit -m "feat: bound raw_history with the shared retention purge [FEAT-025]"
```

---

### Task 4: Release closeout — 1.25.0

**Files:**
- Modify: `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`

**Interfaces:**
- Consumes: Tasks 1–3 committed and green.
- Produces: the published-ready 1.25.0 tree.

**Dependency:** requires Tasks 1–3. Everything below lands in **one** commit.

- [X] [T-004-A] Bump `VERSION` and `package.json`

`VERSION` becomes the single line `1.25.0` with a trailing newline. `package.json`'s `"version"` becomes `"1.25.0"`.

```bash
printf '1.25.0\n' > VERSION
npm pkg set version=1.25.0
```

- [X] [T-004-B] Sync the lockfile

It is stale at 1.23.3 — neither the 1.24.0 nor the 1.24.1 release commit touched it — so this also repairs two missed bumps. Both the root `"version"` and the `packages[""]` entry must read 1.25.0, which is why the check counts hits instead of printing them: a half-synced lockfile prints `1` and must fail the step, not scroll past it.

```bash
npm install --package-lock-only
grep -c '"version": "1.25.0"' package-lock.json   # expected: 2
```

- [X] [T-004-C] Add the CHANGELOG section

Resolve the date at closeout time — never hardcode it from the spec (the FEAT-005 convention):

```bash
date +%F
```

Insert directly above the existing `## [1.24.1]` heading in `CHANGELOG.md`, with `<date>` replaced by that output:

```markdown
## [1.25.0] - <date>

### Added

- **[FEAT-025]** Bounded retention for the conductor cache DB. `scripts/conductor-db.mjs` now purges excess rows after each append to `snapshots` and `raw_history` via a shared `purgeTable` helper applying three id-ordered bounds — never the clock. `snapshots`: at most 3 rows per commit hash, a soft cap of 200 with a newest-per-hash floor, and a floorless hard ceiling of 500. `raw_history`: the per-session trim is disabled (an ordered log is truncated, never thinned) and the table is held by a soft cap of 1000 and a hard ceiling of 2000. Deletion is always oldest-first, so `get-snapshot` still returns the newest blob for every hash that has one. Purge failures stay fail-open — one `CONDUCTOR_DB: retention purge skipped (<table>):` line and exit 0, with the inserted row already committed. No schema change; `SCHEMA_VERSION` remains 2.
```

- [X] [T-004-D] Flip the FEAT-025 checkbox

Surgical single-line edit in `AGENT-READABLE BACKLOG.md` (BUG-003 invariant): on the `### [>] \`[FEAT-025]\`` heading, `[>]` becomes `[X]`. Task 0 set that `[>]`; the uniqueness precheck looks for it, not for `[ ]`. Change nothing else on the line.

- [X] [T-004-E] Correct the FEAT-025 Components Affected line

The same entry's **Components Affected** line names `.claude/scripts/` and `project-template/.claude/scripts/` mirrors that do not exist — `scripts/conductor-db.mjs` is the single source, deployed under `.claude/scripts/` by the installer. Replace that one line with:

```markdown
* **Components Affected:** `scripts/conductor-db.mjs` (new `purgeTable` helper, two call sites), `tests/scripts/conductor-db.test.js`.
```

- [X] [T-004-F] Re-verify the backlog id ceiling

Run the **two-stage** pipeline — extract the bracketed ids, *then* the digits — over both the working tree and `origin/main`, taking the maximum. `origin/main` can carry an id filed on another branch since this one diverged; the working tree can carry one filed locally and not yet pushed, so checking either alone can miss a collision.

```bash
git fetch origin
{ grep -oE '\[(FEAT|BUG|ARCH)-[0-9]+\]' "AGENT-READABLE BACKLOG.md"
  git show origin/main:"AGENT-READABLE BACKLOG.md" \
    | grep -oE '\[(FEAT|BUG|ARCH)-[0-9]+\]'
} | grep -oE '[0-9]+' | sort -n | tail -1
```

Expected: `029`, making 030 free. If it prints anything higher, file the follow-up at the next free id instead of 030 and say so.

Never use the single-stage `grep -oE '[0-9]+$'` form recorded elsewhere in this repo: ids appear mid-line as `` `[FEAT-030]` ``, never at end-of-line, so the `$` anchor matches nothing and the pipeline exits 0 on empty output — a uniqueness guard that silently passes. Never `sort -u` the full id either; lexical order puts `BUG-027` above `FEAT-024`.

- [X] [T-004-G] File the FEAT-030 follow-up

Append to the end of `AGENT-READABLE BACKLOG.md` (the tail of PILLAR 5), verbatim:

```markdown

### [ ] `[FEAT-030]` Byte-Sum Bound for the Conductor Cache DB `snapshots` Table
* **Description:** FEAT-025 bounds `snapshots` by row count (3 per commit hash, soft 200, hard 500) and never by size. `snap_json` rows are not size-capped by that purge: a v2 checkpoint blob carries `pr` up to `snap-build.mjs`'s 10 MiB cap, so a single hash can legitimately hold 30 MiB and the table's theoretical ceiling is ~5 GB. Add an optional byte-sum bound that deletes oldest non-floor rows until `SUM(LENGTH(snap_json))` is under a budget.
* **Impact:** Closes the one growth mode FEAT-025 deliberately left open, for repos that checkpoint long prose frequently.
* **Components Affected:** `scripts/conductor-db.mjs` (`purgeTable`), `tests/scripts/conductor-db.test.js`.
* **Acceptance Criteria:** A byte budget bounds `SUM(LENGTH(snap_json))` on `snapshots`, deleting oldest-first under the same newest-per-key floor as FEAT-025 bound 2; the scan cost is paid only when a cheap row-count precondition indicates it may be needed; purge failures stay fail-open. Pick up only if a real `.conductor/cache.db` is observed above a few hundred MB — 28 KB measured 2026-09-22.
```

- [X] [T-004-H] Run the full suite

Run: `npm test`
Expected: PASS, green before the commit.

- [X] [T-004-I] Commit

Stage the five closeout files by name. Never `git add -A` here: it would sweep whatever
else happens to be in the working tree at closeout time — a scratch file, an unrelated
edit — into a release commit, where the slip is both silent and permanent. Every prior
closeout in this repo staged explicitly.

```bash
git add VERSION package.json package-lock.json CHANGELOG.md "AGENT-READABLE BACKLOG.md"
git status --short          # expect exactly these five, all staged
git commit -m "chore: release 1.25.0"
```

---

## Test List

- [X] [T-TEST-001] Bound 1 boundary on `snapshots`: 2 seeded + 1 write stays at 3; 3 seeded + 1 write trims to the newest 3.
- [X] [T-TEST-002] The row inserted by the current command is never a deletion candidate (10 seeded on one hash → 3 rows, `get-snapshot` returns the new blob).
- [X] [T-TEST-003] `get-snapshot` is unaffected for every hash that still has a row.
- [X] [T-TEST-004] The purge ignores the clock: 1970-stamped rows under every bound survive.
- [X] [T-TEST-005] Fail-open: a `BEFORE DELETE … RAISE(ABORT)` trigger, seeded past bound 1, yields exit 0, the inserted row present, the row count otherwise unchanged, and exactly one stderr line matching `retention purge skipped (snapshots):`.
- [X] [T-TEST-006] Bound 2 boundary on `snapshots`: 199 + 1 = 200 untouched; 200 + 1 = 201 trims to 200 with every hash keeping its floor row.
- [X] [T-TEST-007] Bound 2 settles at `max(softCap, distinctKeys)`: 300 single-row hashes stay at 300, not 200.
- [X] [T-TEST-008] Bound 3 boundary: 499 + 1 = 500 untouched; 600 + 1 = 601 trims to exactly 500, newest hash present, oldest hash evicted.
- [X] [T-TEST-009] `raw_history` bound 1 disabled: 10 seeded on one session + 1 write = 11 rows.
- [X] [T-TEST-010] `raw_history` bound 2 boundary: 999 + 1 = 1000 untouched; 1000 + 1 = 1001 trims to 1000 with the just-written row newest.
- [X] [T-TEST-011] `raw_history` bound 3: 2000 distinct sessions + 1 write = 2001 floors, trimmed to 2000.
- [X] [T-TEST-012] Cross-table isolation in both directions: a `snapshots` purge and a `raw_history` purge each leave the other three tables' row counts unchanged.
- [X] [T-TEST-013] Non-regression: the existing 57 tests in `tests/scripts/conductor-db.test.js` — including `user_version = 2` — stay green, as does the rest of `npm test`.

No integration seam outside this file and no UI is affected, so there is no E2E test.

## Commit Order

0. **Task 0** → `docs: add the FEAT-025 retention purge implementation plan` — the force-added plan file and the backlog `[ ]` → `[>]` mark.
1. **Task 1** → `feat: bound snapshots to 3 rows per commit hash [FEAT-025]` — constants, `purgeTable` with bound 1, the `cmdSnapshot` call site and its scoped catch, six tests.
2. **Task 2** → `feat: add soft-cap and hard-ceiling bounds to the cache purge [FEAT-025]` — bounds 2 and 3, five tests.
3. **Task 3** → `feat: bound raw_history with the shared retention purge [FEAT-025]` — the `cmdHistory` call site, six tests.
4. **Task 4** → `chore: release 1.25.0` — VERSION, package.json, lockfile sync, CHANGELOG, backlog flip + correction + FEAT-030 entry.

## Identified Risks

- **Deleting the newest row would break `/cc-resume`.** `id` is the rowid without `AUTOINCREMENT`, so a reused id destroys `ORDER BY id DESC LIMIT 1` as recency. Caught early by T-TEST-002 and by the bound-3 test asserting the just-written hash is still readable. Any future edit to `purgeTable` must preserve oldest-first deletion.
- **A purge throw reaching `withDb`'s catch.** It would print `…, skipping cache write` about a write that already committed. The `try`/`catch` must enclose the `purgeTable` call only — not the `INSERT`, not the callback body. T-TEST-005 asserts the exact message and its count.
- **A vacuous fail-open test.** A `BEFORE DELETE` trigger fires per row, so a `DELETE` matching nothing never fires it. The fixture seeds 3 rows on one hash precisely so the CLI write makes a 4th and bound 1 has something to delete. Do not "simplify" that seed.
- **Over-promising bound 2.** Asserting the table always reaches 200 would fail a correct implementation whenever `distinctKeys > softCap`. T-TEST-007 pins `max(softCap, distinctKeys)` instead.
- **`DELETE … ORDER BY … LIMIT` is not compiled in by default.** SQLite only accepts it with `SQLITE_ENABLE_UPDATE_DELETE_LIMIT`. Every bound therefore uses the portable `DELETE … WHERE id IN (SELECT id … ORDER BY id ASC LIMIT …)` form. A refactor to the direct form would throw a syntax error on the first purge — and, being fail-open, would degrade silently to "never purges".
- **Slow tests from CLI-driven seeding.** 600 process spawns per boundary case would add minutes. Seeding is out-of-band in a single transaction and only the triggering write goes through the CLI.
- **Stale seed arithmetic.** Every seed count is net of the triggering insert. A count that ignores it lands one row off the boundary and tests the wrong side of it.
- **Concurrent purges can over-delete by a bounded amount** (two processes compute the same `excess` and the second re-evaluates its `LIMIT` against an already-trimmed table). Accepted per the spec: bound 2's newest-per-key exclusion is re-evaluated by each statement, so no key's readable row is ever a candidate; the table can land below `softCap`, which costs forensic depth and nothing else.
- **Lockfile drift.** `package-lock.json` is stale at 1.23.3. T-004-B repairs it; `grep -c` must print `2` — one hit means the root was bumped and `packages[""]` was missed.
- **A release commit staging more than the release.** `git add -A` at closeout is the one place in this plan where a mistake is silent and permanent. T-004-I names the five paths and prints `git status --short` before committing.
- **Backlog checkbox state drift.** Task 0 sets `[>]` and T-004-D expects `[>]`. If Task 0 is skipped, T-004-D's edit finds `[ ]` and must be adjusted rather than forced — and the plan file will not be in git for the `cc-implement` locator to grep.
