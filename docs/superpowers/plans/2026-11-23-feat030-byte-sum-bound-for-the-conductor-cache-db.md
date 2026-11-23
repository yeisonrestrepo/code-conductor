# FEAT-030 Byte-sum bound for the conductor cache DB `snapshots` table implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** `purgeTable` gains a fourth, optional bound: a byte budget on `snapshots`. After bounds 1-3, and only when `n × maxRowBytes > budget`, it measures `SUM(LENGTH(CAST(snap_json AS BLOB)))` and, if that is over the budget, deletes in one windowed statement the shortest oldest-first run of non-floor rows (never the newest row of a hash) that covers the excess. The `snapshots` write passes a 256 MiB budget over `PRE_PARSE_MAX_BYTES` rows through an exported options object; `raw_history` passes nothing. `purgeTable` is exported and `main()` runs behind a main guard so the tests can drive the bound in-process.

**Spec:** `docs/superpowers/specs/2026-11-23-feat030-byte-sum-bound-for-the-conductor-cache-db-design.md` (sha256 `068c30c2fe5d6e1d61714d82efbcde25ba9b83b1f7a39efb674f8731c1591556`). Issue #146.

**Test command:** `npm test`. Filtered runs use `npx vitest run tests/scripts/conductor-db.test.js` with `-t 'FEAT-030'`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines stay untouched (spec, Out of Scope).
- **Three files change, plus this plan and its `.gitignore` leaf:** `scripts/conductor-db.mjs`, `tests/scripts/conductor-db.test.js`, `tools/skip-baseline.json`. No hook, installer, settings, workflow, schema or dependency change. `SCHEMA_VERSION` stays 2; the intake cap, the six row-bound constants and the `raw_history` call site stay as they are (spec, Out of Scope).
- **No existing test is edited** (spec, AC7). The new tests are appended at the end of `tests/scripts/conductor-db.test.js`; the only changed existing line is the `node:url` import (line 7), which gains `pathToFileURL`.
- `scripts/snap-contract.mjs` stays the only file spelling the 10 MiB cap as a literal (`tests/unit/snap-contract.test.js:13`): the new code and tests write `256 * 1024 * 1024` and import `PRE_PARSE_MAX_BYTES`, never `10485760` or `10 * 1024 * 1024`.
- Every file this plan edits after Task 0 is already tracked, so every staging step after Task 0 is `git add -u <path>` with an explicit path.

## Review Focus

- **The precondition is the spec's, strictly greater.** `n * maxRowBytes <= budget` returns before any size query. At the real values the threshold sits between 25 rows (262 144 000 bytes, under 268 435 456) and 26 rows (272 629 760, over); the two CLI tests pin both sides of it.
- **`n` after bound 3.** Today bound 3 does not recount, because nothing read `n` after it. The byte bound does, so bound 3 gains `n = count();` inside its `if`, the same "recount iff the DELETE ran" rule as bounds 1 and 2 (spec, choice 4).
- **The windowed DELETE.** `SUM(size) OVER (ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)` is the running sum of the non-floor rows strictly before each row (`NULL` for the first, hence `COALESCE(…, 0)`). A row goes when that is `< excess`: the shortest oldest-first prefix covering the excess, or every non-floor row. The floor subquery is bound 2's (`id NOT IN (SELECT MAX(id) … GROUP BY key)`).
- **Bytes, not characters.** `LENGTH(CAST(col AS BLOB))`, never `octet_length()` (spec, choice 3). The UTF-8 test fixture is one a character-counting bound would leave untouched (70 characters under a 100 budget, 130 bytes over it).
- **The main guard** is the one `scripts/release.mjs:968` uses, with its `try`: under `node -e` `process.argv[1]` is absent, and a path `realpathSync` cannot resolve returns `false` instead of throwing at import. `realpathSync` is already imported (`scripts/conductor-db.mjs:15`).
- **The CLI fail-open fixture.** Reaching the real budget would mean writing over 256 MiB, so the CLI test replaces `snapshots` out-of-band with a view over a renamed table whose `snap_json` is `json()` of a non-JSON value, plus `INSTEAD OF INSERT` / `DELETE` triggers. Bounds 1-3 read only `id` and `git_commit_hash`, so only the byte bound's size query evaluates `json()` and throws (`malformed JSON`, code `ERR_SQLITE_ERROR`). `withDb` re-applies the schema only when `user_version < 2` or `task_state` is missing (`scripts/conductor-db.mjs:262`), so the view survives the CLI's open. Measured: the warning fires at 26 rows and not at 25.

## Plan decisions

1. **`node:url` import (`scripts/conductor-db.mjs:17`).** `import { fileURLToPath } from 'node:url';` becomes `import { fileURLToPath, pathToFileURL } from 'node:url';`.
2. **The budget constant (`scripts/conductor-db.mjs:35`).** Directly after `const SNAPSHOT_HARD_MAX = 500;` insert:
   ```js
   // FEAT-030: the row bounds never look at size, and 500 rows of up to 10 MiB each reach ~5 GB.
   const SNAPSHOT_BYTE_BUDGET = 256 * 1024 * 1024;
   ```
3. **The exported options object (`scripts/conductor-db.mjs:43`).** Directly after the `U_HISTORY` line insert a blank line and:
   ```js
   // What the snapshots write passes to purgeTable. `maxRowBytes` is the intake cap the byte
   // bound's precondition relies on, so the two are named together here.
   export const SNAPSHOT_RETENTION = Object.freeze({
     table: 'snapshots', key: 'git_commit_hash',
     keepPerKey: SNAPSHOT_KEEP_PER_HASH,
     softCap: SNAPSHOT_SOFT_CAP,
     hardMax: SNAPSHOT_HARD_MAX,
     byteBound: Object.freeze({ column: 'snap_json', budget: SNAPSHOT_BYTE_BUDGET, maxRowBytes: MAX_SNAP_BYTES }),
   });
   ```
   `column` is in the option because `purgeTable` is table-generic (it interpolates module constants, never user input, as its header comment says).
4. **`purgeTable` (`scripts/conductor-db.mjs:308`-`:355`).**
   - Signature: `function purgeTable(db, { table, key, keepPerKey, softCap, hardMax }) {` becomes `export function purgeTable(db, { table, key, keepPerKey, softCap, hardMax, byteBound }) {`.
   - Bound 3: inside its `if (excess > 0) { … }`, after the `.run({ $excess: excess });`, add `n = count();`.
   - After bound 3's closing `}` and before the function's closing `}`, add a blank line and `  if (byteBound) purgeBytes(db, { table, key, ...byteBound }, n);`.
   - Directly after `purgeTable`'s closing `}` insert the helper:
   ```js

   // Bound 4 (FEAT-030) — byte budget with bound 2's newest-per-key floor. Every row
   // the CLI writes is at most `maxRowBytes`, so while `n * maxRowBytes` is within the
   // budget the sum cannot be over it and is never scanned. Over it, one DELETE takes
   // the shortest oldest-first run of non-floor rows whose sizes cover the excess.
   function purgeBytes(db, { table, key, column, budget, maxRowBytes }, n) {
     if (n * maxRowBytes <= budget) return;
     const size = `LENGTH(CAST(${column} AS BLOB))`;   // bytes; LENGTH on TEXT counts characters
     const sum = db.prepare(`SELECT SUM(${size}) AS s FROM ${table}`).get().s ?? 0;
     if (sum <= budget) return;
     db.prepare(
       `DELETE FROM ${table} WHERE id IN (SELECT id FROM (` +
       `SELECT id, SUM(${size}) OVER (ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS before ` +
       `FROM ${table} WHERE id NOT IN (SELECT MAX(id) FROM ${table} GROUP BY ${key})` +
       `) WHERE COALESCE(before, 0) < $excess)`
     ).run({ $excess: sum - budget });
   }
   ```
   `?? 0` covers the `NULL` sum of an empty table (spec, Alternative paths). The helper is 13 lines; `purgeTable` grows by three.
5. **The `snapshots` call site (`scripts/conductor-db.mjs:471`-`:476`).** The six-line `purgeTable(db, { table: 'snapshots', … hardMax: SNAPSHOT_HARD_MAX, });` becomes `      purgeTable(db, SNAPSHOT_RETENTION);`. The surrounding `try`/`catch` and its comment are unchanged. The `raw_history` call site (`:517`) is not touched.
6. **The main guard (`scripts/conductor-db.mjs:546`-`:549`).** The four-line `main().then(…).catch(…);` statement is replaced by (the comment block above it, `:541`-`:545`, stays):
   ```js
   // FEAT-030: the tests import purgeTable, so the CLI runs only when this file is the invoked script.
   function invokedDirectly() {
     try { return Boolean(process.argv[1]) && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; }
   }
   if (invokedDirectly()) {
     main().then(() => { process.exitCode = 0; }).catch((e) => {
       warn(`unexpected: ${e && e.message}`);
       process.exitCode = 0;
     });
   }
   ```
7. **Tests (`tests/scripts/conductor-db.test.js`).**
   - Line 7: `import { fileURLToPath } from 'node:url';` becomes `import { fileURLToPath, pathToFileURL } from 'node:url';`.
   - Append after the file's last line (the closing `});` of `conductor-db retention purge`), preceded by one blank line, exactly this block. It reuses the file-level `SCRIPT`, `CONTRACT`, `FLAG`, `HAS_SQLITE`, `CLEAN_ENV`, `runDb`, `repo`, `spawnSync`, `existsSync` and `join`. The module is loaded with a dynamic `import()` inside the tests so a missing export fails those tests (red) instead of the whole file at link time.
   ```js
   // FEAT-030: purgeTable is driven in-process, because an end-to-end test of the real
   // 256 MiB budget would have to write over 256 MiB. Small budgets exercise the same SQL.
   const SCRIPT_URL = pathToFileURL(SCRIPT).href;
   const SNAPSHOTS_DDL = 'CREATE TABLE snapshots (id INTEGER PRIMARY KEY, git_commit_hash TEXT NOT NULL, created_at TEXT NOT NULL, snap_json TEXT NOT NULL);';

   describe('conductor-db module surface [FEAT-030]', () => {
     it('SNAPSHOT_RETENTION pins the snapshots call site: a 256 MiB budget over PRE_PARSE_MAX_BYTES rows', async () => {
       const { SNAPSHOT_RETENTION } = await import(SCRIPT_URL);
       const { PRE_PARSE_MAX_BYTES } = await import(pathToFileURL(CONTRACT).href);
       expect(SNAPSHOT_RETENTION).toEqual({
         table: 'snapshots', key: 'git_commit_hash', keepPerKey: 3, softCap: 200, hardMax: 500,
         byteBound: { column: 'snap_json', budget: 256 * 1024 * 1024, maxRowBytes: PRE_PARSE_MAX_BYTES },
       });
     });

     it('importing the module does not run the CLI', () => {
       const r = spawnSync(process.execPath, [...FLAG, '--input-type=module', '-e', `await import(${JSON.stringify(SCRIPT_URL)});`], {
         cwd: repo, encoding: 'utf8', env: CLEAN_ENV,
       });
       expect(r.status).toBe(0);
       expect(r.stderr).toBe('');   // an unguarded main() would warn `unknown subcommand ""`
       expect(r.stdout).toBe('');
       expect(existsSync(join(repo, '.conductor'))).toBe(false);
     });
   });

   describe.skipIf(!HAS_SQLITE)('conductor-db byte budget [FEAT-030]', () => {
     let db, purgeTable, seen;
     beforeEach(async () => {
       ({ purgeTable } = await import(SCRIPT_URL));
       const { DatabaseSync } = await import('node:sqlite');
       db = new DatabaseSync(':memory:');
       db.exec(SNAPSHOTS_DDL);
       seen = [];
     });
     afterEach(() => { db.close(); });

     // Rows are [hash, snap_json] in insertion (id) order.
     const seed = (rows) => {
       const st = db.prepare("INSERT INTO snapshots (git_commit_hash, created_at, snap_json) VALUES (?, 'c', ?)");
       for (const [h, j] of rows) st.run(h, j);
     };
     // Records every statement purgeTable prepares; `failOn` makes the matching one throw.
     const spy = (failOn) => ({
       prepare(sql) {
         seen.push(sql);
         if (failOn && sql.includes(failOn)) throw new Error('boom');
         return db.prepare(sql);
       },
     });
     const opts = (budget, maxRowBytes, rowBounds = {}) => ({
       table: 'snapshots', key: 'git_commit_hash', keepPerKey: null, softCap: 1000, hardMax: 1000,
       ...rowBounds, byteBound: { column: 'snap_json', budget, maxRowBytes },
     });
     const ids = () => db.prepare('SELECT id FROM snapshots ORDER BY id').all().map((r) => r.id);
     const byteSum = () => db.prepare('SELECT SUM(LENGTH(CAST(snap_json AS BLOB))) AS s FROM snapshots').get().s;
     const charSum = () => db.prepare('SELECT SUM(LENGTH(snap_json)) AS s FROM snapshots').get().s;
     const sizeQueries = () => seen.filter((sql) => sql.includes('CAST(snap_json AS BLOB)'));
     const x = (n) => 'x'.repeat(n);

     it('over the budget: the shortest oldest-first non-floor prefix goes and the sum ends at or under it', () => {
       seed([['a', x(30)], ['a', x(30)], ['a', x(30)], ['a', x(30)], ['a', x(30)], ['b', x(20)]]);   // 170 bytes; floors are ids 5 and 6
       purgeTable(db, opts(100, 40));
       expect(ids()).toEqual([4, 5, 6]);   // ids 1-3 cover the 70-byte excess; without id 3 the sum would be 110
       expect(byteSum()).toBe(80);
     });

     it('floor rows alone over the budget: every non-floor row goes, every hash keeps its newest row', () => {
       seed([['a', x(50)], ['a', x(50)], ['b', x(50)], ['c', x(50)]]);
       purgeTable(db, opts(100, 50));
       expect(ids()).toEqual([2, 3, 4]);
       expect(byteSum()).toBe(150);   // still over: the floor is never byte-bounded
     });

     it('a sum exactly at the budget deletes nothing', () => {
       seed([['a', x(25)], ['a', x(25)], ['a', x(25)], ['a', x(25)]]);
       purgeTable(spy(), opts(100, 50));
       expect(sizeQueries()).toHaveLength(1);   // the sum was measured, then left alone
       expect(ids()).toEqual([1, 2, 3, 4]);
     });

     it('size is counted in UTF-8 bytes, not characters', () => {
       const e = 'é'.repeat(20);   // 20 characters, 40 bytes
       seed([['a', e], ['a', e], ['a', e], ['b', x(10)]]);   // 130 bytes, 70 characters
       purgeTable(db, opts(100, 40));
       expect(ids()).toEqual([2, 3, 4]);
       expect(byteSum()).toBe(90);
       expect(charSum()).toBeLessThanOrEqual(100);
     });

     it('row count at the precondition threshold: no size query runs and an over-budget table is untouched', () => {
       seed(Array.from({ length: 10 }, (_, i) => [`h${i}`, x(50)]));   // 500 bytes, but 10 rows x 10 = 100
       purgeTable(spy(), opts(100, 10));
       expect(sizeQueries()).toEqual([]);
       expect(ids()).toHaveLength(10);
     });

     it('one row past the precondition threshold: the size query runs and the bound applies', () => {
       seed([...Array.from({ length: 10 }, () => ['a', x(50)]), ['b', x(50)]]);   // 11 rows x 10 = 110
       purgeTable(spy(), opts(100, 10));
       expect(sizeQueries().length).toBeGreaterThan(0);
       expect(byteSum()).toBe(100);   // ids 1-9 go, the floors of a and b stay
     });

     it('without byteBound, purgeTable never measures size (the raw_history shape)', () => {
       seed(Array.from({ length: 30 }, (_, i) => [`h${i}`, x(1000)]));
       const { byteBound, ...rowOnly } = opts(1, 1);
       purgeTable(spy(), rowOnly);
       expect(byteBound).toBeDefined();
       expect(sizeQueries()).toEqual([]);
       expect(ids()).toHaveLength(30);
     });

     it("a throw in the byte bound leaves purgeTable and keeps the row bounds' deletions", () => {
       seed([['a', x(10)], ['a', x(10)], ['a', x(10)], ['a', x(10)], ['a', x(10)]]);
       expect(() => purgeTable(spy('CAST('), opts(1, 10, { keepPerKey: 3 }))).toThrow('boom');
       expect(ids()).toEqual([3, 4, 5]);   // bound 1 ran and its DELETE stands
     });
   });

   describe.skipIf(!HAS_SQLITE)('conductor-db byte budget through the CLI [FEAT-030]', () => {
     const dbPath = () => join(repo, '.conductor', 'cache.db');
     async function withRunnerDb(fn) {
       const { DatabaseSync } = await import('node:sqlite');
       const db = new DatabaseSync(dbPath());
       try { return fn(db); } finally { db.close(); }
     }
     // The real budget cannot be reached cheaply, so `snapshots` becomes a view whose
     // `snap_json` is json() of a non-JSON value: only the byte bound reads that column,
     // so only the byte bound throws ("malformed JSON"). Rows live in `snap_store`.
     const seedThrowingView = (count) => withRunnerDb((db) => {
       db.exec(
         'ALTER TABLE snapshots RENAME TO snap_store;' +
         'CREATE VIEW snapshots AS SELECT id, git_commit_hash, created_at, json(snap_json) AS snap_json FROM snap_store;' +
         'CREATE TRIGGER snap_ins INSTEAD OF INSERT ON snapshots BEGIN ' +
         'INSERT INTO snap_store (git_commit_hash, created_at, snap_json) VALUES (NEW.git_commit_hash, NEW.created_at, NEW.snap_json); END;' +
         'CREATE TRIGGER snap_del INSTEAD OF DELETE ON snapshots BEGIN DELETE FROM snap_store WHERE id = OLD.id; END;'
       );
       const st = db.prepare("INSERT INTO snap_store (git_commit_hash, created_at, snap_json) VALUES (?, 'c', 'not json')");
       for (let i = 0; i < count; i++) st.run(`v${i}`);
     });
     const stored = () => withRunnerDb((db) => db.prepare('SELECT git_commit_hash, snap_json FROM snap_store ORDER BY id').all());
     const purgeWarns = (stderr) => stderr.split('\n').filter((l) => l.includes('retention purge skipped (snapshots):'));

     beforeEach(() => { runDb(['init'], { cwd: repo }); });

     it('CLI: 25 rows after the write stay under the threshold, so no size query and no warning', async () => {
       await seedThrowingView(24);
       const w = runDb(['snapshot', 'last'], { cwd: repo, input: 'survivor' });
       expect(w.status).toBe(0);
       expect(purgeWarns(w.stderr)).toEqual([]);   // 25 x 10 MiB is under 256 MiB
       expect(await stored()).toHaveLength(25);
     });

     it('CLI: a byte-bound failure at 26 rows exits 0, keeps the inserted row, and warns exactly once', async () => {
       await seedThrowingView(25);
       const w = runDb(['snapshot', 'last'], { cwd: repo, input: 'survivor' });
       expect(w.status).toBe(0);
       expect(w.stdout).toBe('');
       expect(purgeWarns(w.stderr)).toHaveLength(1);   // 26 x 10 MiB is over 256 MiB
       const rows = await stored();
       expect(rows).toHaveLength(26);
       expect(rows.at(-1)).toEqual({ git_commit_hash: 'last', snap_json: 'survivor' });
     });
   });
   ```
   - The `module surface` describe has no `node:sqlite` skip: importing the module never loads `node:sqlite` (it is a dynamic import inside `withDb`), so these two tests also run on Node 20.
8. **CI skip baseline (`tools/skip-baseline.json`).** On the `ci-node20` leg `HAS_SQLITE` is false, so the ten tests in the two `node:sqlite` describes are skipped there and the leg's skip-set check is red until the same change lists them (CONTRIBUTING, "Test predictions are made per environment"). This corrects the spec's System Impact expectation of no skip-set change, which it asked the plan to confirm. Insert these ten lines, in this order, between line 33 (`…conductor-db CLI discipline unknown subcommand: exit 0, one exact usage line, no db",`) and line 34 (`…conductor-db corrupt-db recovery backs up …`), which is their sorted position (uppercase `C` sorts before `b`, `[` before `t`):
   ```
       "tests/scripts/conductor-db.test.js > conductor-db byte budget [FEAT-030] a sum exactly at the budget deletes nothing",
       "tests/scripts/conductor-db.test.js > conductor-db byte budget [FEAT-030] a throw in the byte bound leaves purgeTable and keeps the row bounds' deletions",
       "tests/scripts/conductor-db.test.js > conductor-db byte budget [FEAT-030] floor rows alone over the budget: every non-floor row goes, every hash keeps its newest row",
       "tests/scripts/conductor-db.test.js > conductor-db byte budget [FEAT-030] one row past the precondition threshold: the size query runs and the bound applies",
       "tests/scripts/conductor-db.test.js > conductor-db byte budget [FEAT-030] over the budget: the shortest oldest-first non-floor prefix goes and the sum ends at or under it",
       "tests/scripts/conductor-db.test.js > conductor-db byte budget [FEAT-030] row count at the precondition threshold: no size query runs and an over-budget table is untouched",
       "tests/scripts/conductor-db.test.js > conductor-db byte budget [FEAT-030] size is counted in UTF-8 bytes, not characters",
       "tests/scripts/conductor-db.test.js > conductor-db byte budget [FEAT-030] without byteBound, purgeTable never measures size (the raw_history shape)",
       "tests/scripts/conductor-db.test.js > conductor-db byte budget through the CLI [FEAT-030] CLI: 25 rows after the write stay under the threshold, so no size query and no warning",
       "tests/scripts/conductor-db.test.js > conductor-db byte budget through the CLI [FEAT-030] CLI: a byte-bound failure at 26 rows exits 0, keeps the inserted row, and warns exactly once",
   ```
   `ci-node24` and `ci-windows-node24` lists are unchanged: no new test is skipped there (no platform `skipIf`).
9. **`.gitignore` leaf.** `!/docs/superpowers/plans/2026-11-23-feat030-byte-sum-bound-for-the-conductor-cache-db.md` goes directly after the `2026-11-22-feat035-release-agent-ship-band.md` plan leaf (line 201), the last plan leaf. That is its sorted position, which `tests/unit/gitignore-block-parity.test.js` checks.

## Baseline (measured on a scratch copy of this branch, HEAD 8030b0e, Node 24.22.2)

- `tests/scripts/conductor-db.test.js` holds 74 tests: **74 passed (74)**. `tools/skip-baseline.json` lists 74 of them under `ci-node20`, 1 under `ci-windows-node24`, none under `ci-node24`.
- Tests only (plan decision 7) on the unchanged script: `npx vitest run tests/scripts/conductor-db.test.js -t 'FEAT-030'` gave **11 failed | 1 passed | 74 skipped (86)**. The pass is `CLI: 25 rows after the write stay under the threshold…`, which holds before the change too (no byte bound, no warning). Failure messages: `expected undefined to deeply equal { table: 'snapshots', …(5) }` (pin), `expected 'CONDUCTOR_DB: unknown subcommand ""; …' to be ''` (import guard), `purgeTable is not a function` (seven unit tests), `expected [Function] to throw error including 'boom' but got 'purgeTable is not a function'` (throw test), `expected [] to have a length of 1 but got +0` (CLI fail-open).
- With plan decisions 1-7 applied: the full file gave **86 passed (86)** in about 9 s. `tests/unit/snap-contract.test.js`, `tests/scripts/resume-read.test.js`, `tests/scripts/handoff-cycle.test.js` and `tests/installer/deploy.test.js` together gave **116 passed (116)**.
- The full suite was not run for this plan: the scratch copy has no `.git`. T-301 runs it on the branch.

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-23-feat030-byte-sum-bound-for-the-conductor-cache-db.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file from the approved spec `068c30c2…`. No dependency.
- [X] [T-002] `.gitignore`: insert the leaf of plan decision 9 after the `2026-11-22-feat035` plan leaf. Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` (tracked) and `git add docs/superpowers/plans/2026-11-23-feat030-byte-sum-bound-for-the-conductor-cache-db.md` (new, re-included by its leaf). Depends on T-002.
- [X] [T-004] Commit: `docs: plan the byte-sum bound for the conductor cache DB snapshots table [FEAT-030]`. Depends on T-003.

---

### Task 1: Tests first (red)

**Files:**
- Modify: `tests/scripts/conductor-db.test.js:7`, end of file

- [ ] [T-101] `tests/scripts/conductor-db.test.js:7`: add `pathToFileURL` to the `node:url` import (plan decision 7). Depends on T-004.
- [ ] [T-102] `tests/scripts/conductor-db.test.js`: append the FEAT-030 block of plan decision 7 after the last line. Depends on T-101.
- [ ] [T-103] Red run: `npx vitest run tests/scripts/conductor-db.test.js -t 'FEAT-030'`. Its full match set is the 12 new tests; no existing title contains `FEAT-030`. Predicted: **11 failed | 1 passed | 74 skipped (86)**, the pass being `CLI: 25 rows after the write stay under the threshold, so no size query and no warning`, with the failure messages listed under Baseline. Any other split means a test is wrong: fix the test, not the prediction. Depends on T-102.

---

### Task 2: The bound, the export and the guard (green)

**Files:**
- Modify: `scripts/conductor-db.mjs:17`, `:35`, `:43`, `:308`-`:355`, `:471`-`:476`, `:546`-`:549`

- [ ] [T-201] `scripts/conductor-db.mjs:17`: add `pathToFileURL` to the `node:url` import (plan decision 1). Depends on T-103.
- [ ] [T-202] `scripts/conductor-db.mjs:35`: add `SNAPSHOT_BYTE_BUDGET` with its comment after `SNAPSHOT_HARD_MAX` (plan decision 2). Depends on T-201.
- [ ] [T-203] `scripts/conductor-db.mjs` after the `U_HISTORY` line (now `:45`): add `SNAPSHOT_RETENTION` (plan decision 3). Depends on T-202.
- [ ] [T-204] `purgeTable` (now about `:320`): export it, add `byteBound` to its parameters, recount `n` inside bound 3, call `purgeBytes`, and add the `purgeBytes` helper after it (plan decision 4). Depends on T-203.
- [ ] [T-205] The `snapshots` call site in `cmdSnapshot` (now about `:503`): replace the inline options with `SNAPSHOT_RETENTION` (plan decision 5). Depends on T-204.
- [ ] [T-206] The file's tail (now about `:568`): wrap the `main()` call in the `invokedDirectly()` guard (plan decision 6). Depends on T-205.
- [ ] [T-207] Green run: the T-103 command. Predicted: **12 passed | 74 skipped (86)**. Depends on T-206.
- [ ] [T-208] `npx vitest run tests/scripts/conductor-db.test.js`. Predicted: **86 passed (86)**: the 74 FEAT-025 and earlier tests unmodified and green (spec, AC7) plus the 12 new. Depends on T-207.
- [ ] [T-209] `npx vitest run tests/unit/snap-contract.test.js tests/scripts/resume-read.test.js tests/scripts/handoff-cycle.test.js tests/installer/deploy.test.js`. Predicted: **116 passed (116)**: the literal-cap check, the CLI's callers and the installer copy are unaffected (spec, System Impact). Depends on T-208.

---

### Task 3: CI skip baseline

**Files:**
- Modify: `tools/skip-baseline.json:33`

- [ ] [T-301] `tools/skip-baseline.json`: insert the ten `ci-node20` lines of plan decision 8 between lines 33 and 34. Depends on T-209.
- [ ] [T-302] Check: `node -e "const d=require('./tools/skip-baseline.json');for(const[k,v]of Object.entries(d)){const s=[...v].sort();if(JSON.stringify(s)!==JSON.stringify(v)||new Set(v).size!==v.length)throw new Error(k)}console.log(d['ci-node20'].length)"` prints `119` (109 + 10) and throws for no key. Then `npx vitest run tests/tools/skip-baseline.test.js` passes. Depends on T-301.

---

### Task 4: Full suite, scope check and commit

**Files:**
- Modify: `scripts/conductor-db.mjs`, `tests/scripts/conductor-db.test.js`, `tools/skip-baseline.json` (staged), this plan (checkboxes)

- [ ] [T-401] Run `npm test`. Predicted: every file green, apart from environment failures in files this plan does not touch. On CI the exit status is 0 (spec, AC11). A red counts as ENV only if the sandbox causes it (network, tmp permissions, uid) and the test's file is not one this plan touches; report it with its name. Any other red is fixed. Depends on T-302.
- [ ] [T-402] Scope check:
  - `git status --porcelain` lists exactly `scripts/conductor-db.mjs`, `tests/scripts/conductor-db.test.js`, `tools/skip-baseline.json` and this plan as modified.
  - `git diff -U0 HEAD -- tests/scripts/conductor-db.test.js | grep '^-[^-]'` prints only the old line 7 import (no existing test edited, spec AC7).
  - `git diff -U0 HEAD -- tools/skip-baseline.json | grep -c '^+[^+]'` prints `10` and `git diff -U0 HEAD -- tools/skip-baseline.json | grep '^-[^-]'` prints nothing.
  - `grep -n "SCHEMA_VERSION = 2;\|HISTORY_HARD_MAX = 2000;\|table: 'raw_history'" scripts/conductor-db.mjs` prints all three (schema and the `raw_history` call site unchanged, spec AC7 and AC11).
  - `git diff --quiet HEAD -- VERSION CHANGELOG.md package.json package-lock.json README.md "AGENT-READABLE BACKLOG.md" .claude .github project-template lib bin scripts/snap-contract.mjs` exits 0.
  - Depends on T-401.
- [ ] [T-403] Stage: `git add -u scripts/conductor-db.mjs tests/scripts/conductor-db.test.js tools/skip-baseline.json` (all tracked). Depends on T-402.
- [ ] [T-404] Stage: `git add -u docs/superpowers/plans/2026-11-23-feat030-byte-sum-bound-for-the-conductor-cache-db.md` (carries the ticks for T-101 to T-403). Depends on T-403.
- [ ] [T-405] Commit: `feat: bound the conductor cache DB snapshots table by byte sum [FEAT-030]`. Depends on T-404.

---

## Test List

- [ ] Unit, AC1 and AC2: `over the budget: the shortest oldest-first non-floor prefix goes…` (ids 1-3 of a 170-byte table under a 100 budget go; without id 3 the sum would be 110).
- [ ] Unit, AC3: `floor rows alone over the budget…` (the only non-floor row goes, three hashes keep their newest row, the sum stays 150).
- [ ] Unit, AC4: `a sum exactly at the budget deletes nothing` (the sum query ran once and nothing was deleted).
- [ ] Unit, AC5: `size is counted in UTF-8 bytes, not characters` (130 bytes / 70 characters; one row goes, ending at 90 bytes).
- [ ] Unit, AC6: `row count at the precondition threshold…` (no statement mentions `CAST(snap_json AS BLOB)`, 10 rows of 50 bytes untouched) and `one row past the precondition threshold…` (the scan runs, the sum ends at 100).
- [ ] Unit, AC7: `without byteBound, purgeTable never measures size (the raw_history shape)`, plus the 74 existing tests unmodified (T-208, T-402).
- [ ] Unit, AC8: `SNAPSHOT_RETENTION pins the snapshots call site…` (`toEqual` against the 256 MiB budget and `PRE_PARSE_MAX_BYTES`); the CLI pair pins that the write really uses those values (threshold between 25 and 26 rows).
- [ ] Unit and integration (CLI), AC9: `a throw in the byte bound leaves purgeTable…` (throws `boom`, bound 1's DELETE stands) and `CLI: a byte-bound failure at 26 rows exits 0…` (status 0, empty stdout, one `retention purge skipped (snapshots):` line, the inserted row stored).
- [ ] Integration (CLI), AC10: `importing the module does not run the CLI` (empty stdout and stderr, no `.conductor/`); the 74 existing CLI tests cover running it as a script.
- [ ] AC11: `npm test` (T-401); no dependency change, `SCHEMA_VERSION` unchanged (T-402).
- [ ] No E2E/UI test: the change is a CLI-internal bound with no UI.

## Commit Order

1. Task 0 (T-004): this plan and its `.gitignore` leaf.
2. Task 4 (T-405): the tests, the bound, the skip baseline and the plan ticks for T-101 to T-403, in one commit, so no commit has a red suite or a red `ci-node20` skip check. The red run in T-103 happens in the working tree before the fix. The ticks for T-404, T-405 and the Test List ride a closeout commit.

## Identified Risks

- **The main guard misfires in an installed project.** If `invokedDirectly()` ever returned `false` for a real invocation, every cache write would silently stop (exit 0, no output, the plan markdown still authoritative). Node resolves the entry module through the same real path, and the 74 existing tests spawn the script by path on all three CI legs, Windows included, so a misfire turns them red. Catch: T-208 and CI.
- **The view fixture stops isolating the byte bound.** If a future change made bounds 1-3 read `snap_json`, the throw would come from them and the 25-row CLI test would start warning. That test is the guard: it fails rather than passing silently. Catch: T-207.
- **SQLite without window functions.** Bound 1 already needs them (SQLite 3.25+), so a build lacking them already fails today's purge, fail-open. No new requirement.
- **`ci-node20` skip set.** If a title in plan decision 7 is edited, its line in plan decision 8 must change with it, or that leg is red with the names to fix. Catch: T-302 checks order and uniqueness locally; the leg itself asserts the set.
- **Out-of-band rows above `MAX_SNAP_BYTES`.** Accepted by the spec (Alternative paths): the precondition assumes the CLI's intake cap.
- **The file does not shrink.** Deleted pages are reused; `VACUUM` is out of scope (spec, Out of Scope).
