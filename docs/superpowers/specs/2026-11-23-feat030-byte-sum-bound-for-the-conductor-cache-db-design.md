# FEAT-030 — Byte-Sum Bound for the Conductor Cache DB `snapshots` Table

**Status:** Draft (pending independent review)

**Item:** `[FEAT-030]` (intake of issue #146). Pillar 5: infrastructure, ecosystem and quality assurance.
Components named by the entry: `scripts/conductor-db.mjs` (`purgeTable`), `tests/scripts/conductor-db.test.js`.

## Problem

FEAT-025 bounds the `snapshots` table of `.conductor/cache.db` by row count only. `purgeTable`
(`scripts/conductor-db.mjs:308`) applies three id-ordered bounds after each `snapshot` write
(call site at `:471`, constants at `:33`-`:35`):

1. at most `SNAPSHOT_KEEP_PER_HASH` = 3 rows per `git_commit_hash`;
2. a soft cap of `SNAPSHOT_SOFT_CAP` = 200 rows, deleting oldest-first but never the newest row of a hash
   (the floor: `id NOT IN (SELECT MAX(id) … GROUP BY git_commit_hash)`, `:336`);
3. a floorless hard ceiling of `SNAPSHOT_HARD_MAX` = 500 rows.

None of them looks at size. Each `snap_json` row is capped only at intake, at `MAX_SNAP_BYTES` =
`PRE_PARSE_MAX_BYTES` = 10 MiB (`scripts/snap-contract.mjs:10`, checked at `scripts/conductor-db.mjs:456`).
One hash can therefore hold 30 MiB, and 500 rows can hold about 5 GB. A repository that checkpoints long
prose often grows its cache file far past anything the cache needs, with no signal: the plan markdown stays
the authoritative record, so nothing breaks, the disk just fills.

Pickup condition waived by the owner 2026-11-23: the script ships to every installed project, so this repository's cache size does not gate it.

## Solution

Add a fourth bound to `purgeTable`, a byte budget, enabled for `snapshots` only. After the three row bounds have
run, and only when the remaining row count `n` could possibly exceed the budget (`n × MAX_SNAP_BYTES > budget`),
compute the table's byte sum. If it is over the budget, delete the oldest rows that are not the newest row of
their hash, in one statement, until the sum is at or under the budget. The newest row of every hash is never
deleted by this bound, exactly as with bound 2. A failure anywhere in it stays inside the existing fail-open
`catch` around the purge.

### Choices the entry leaves open

**What "optional" means: an optional `purgeTable` parameter, always on for `snapshots`.** The byte bound is a
new optional option of `purgeTable`. The `snapshots` call site passes it; the `raw_history` call site
(`:517`) does not, so `raw_history` behaves exactly as today. There is no user-facing switch, environment
variable or config key: none of the six existing retention numbers has one, a default-off switch would leave
the growth mode open for every repository that never learns of it, and a new configuration surface is not
something the entry asks for.

**Budget: 256 MiB (`SNAPSHOT_BYTE_BUDGET = 268435456`).** The entry's own trigger is a cache "above a few
hundred MB"; 256 MiB sits at the low end of that, is 20× smaller than today's ceiling, and still holds about
25 maximum-size blobs or many thousands of typical ones (the whole measured cache was 28 KB).

**Size measure: bytes, `LENGTH(CAST(snap_json AS BLOB))`.** The intake cap is in bytes and disk use is in bytes.
`LENGTH(snap_json)` on a `TEXT` value counts characters, which for UTF-8 is never more than the byte count, so
bounding the byte sum also bounds `SUM(LENGTH(snap_json))`, the quantity the entry names. The `CAST … AS BLOB`
form is used rather than `octet_length()` because it works on every SQLite build `node:sqlite` ships, while
`octet_length()` needs SQLite 3.43 or later.

**The cheap precondition: `n × MAX_SNAP_BYTES > budget`.** Every row the CLI writes is at most `MAX_SNAP_BYTES`
bytes: the buffer is checked against that cap before decoding (`:456`), it is decoded as strict UTF-8 (`:459`),
and the database text encoding is SQLite's default UTF-8, so the stored text has exactly the buffer's bytes.
Hence `n` rows cannot hold more than `n × MAX_SNAP_BYTES` bytes, and when that product is within the budget the
sum cannot be over it. Below the threshold (25 rows or fewer at 256 MiB) no size query runs at all; `n` is
the count `purgeTable` already maintains, recounted only when a previous bound's `DELETE` ran, so the
precondition itself costs no extra query on a write where no row bound fired. The maximum row size is passed
to `purgeTable` with the budget, not read from a global, so the precondition and the cap it relies on are named
together at the call site.

**Placement: last, after bound 3.** The row bounds are cheaper and can bring `n` under the precondition
threshold, which skips the size scan. Bound 3 has no floor and may delete floor rows; running the byte bound
after it means the byte bound never has to reason about rows a later bound would remove.

**One windowed `DELETE`, no loop.** The excess `E = sum − budget` is computed once. Among the non-floor rows,
ordered by `id` ascending, a running sum of sizes is taken with a window function; a row is deleted when the
running sum of the rows strictly before it is below `E`. That deletes the shortest oldest-first prefix whose
sizes add up to at least `E`, or every non-floor row if they do not. It uses the portable
`DELETE … WHERE id IN (SELECT id …)` form that FEAT-025 uses (`DELETE … ORDER BY … LIMIT` is not compiled into
SQLite by default), and window functions, which bound 1 already relies on.

**Testability: export `purgeTable` behind a main guard.** A real end-to-end test of a 256 MiB budget would have to
write over 256 MiB to the temp directory, which is too slow and too large for the CI legs. Instead
`conductor-db.mjs` exports `purgeTable` and the `snapshots` retention options object it passes, and runs
`main()` only when it is the invoked script, using the guard the repository already uses
(`pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url`, as in `scripts/release.mjs:968` and
`scripts/orchestrate.mjs:1734`). Unit tests then drive `purgeTable` on a `DatabaseSync` with small budgets, and
one test pins the values the `snapshots` call site uses. CLI behavior is unchanged when the script is run.

## Behavior

### Main path

1. `conductor-db snapshot <hash>` inserts the row, as today.
2. `purgeTable` runs bounds 1–3 for `snapshots`, as today.
3. With the byte option present, `purgeTable` checks `n × maxRowBytes > budget` against its current `n`.
   False: return, no further query.
4. True: run `SELECT SUM(LENGTH(CAST(snap_json AS BLOB)))` over the table. At or under the budget: return.
5. Over: run the single windowed `DELETE` of the oldest non-floor rows covering the excess. Return.
6. The command exits 0 with the inserted row committed; `get-snapshot` still returns the newest row for every
   hash that has one.

### Alternative paths

- **Floor rows alone exceed the budget.** The bound deletes every non-floor row and stops; the sum stays above
  the budget. This is the floor the entry asks for. The worst case after this feature is therefore the floor
  rows that survive bound 3: up to 500 distinct hashes of up to 10 MiB each. In the growth mode the entry names
  (frequent checkpoints of long prose, several rows per hash) the sum drops to the budget.
- **Exactly at the budget.** Not over; nothing is deleted.
- **Table under the precondition threshold.** No size query is issued, whatever the sizes are.
- **Rows larger than `MAX_SNAP_BYTES` inserted outside the CLI.** The precondition assumes the CLI's intake cap; a
  row written out-of-band can make the sum exceed the budget while the precondition is false, and the bound
  then does nothing until the row count passes the threshold. Accepted: the bound covers what the CLI writes.
- **Empty table, or a `NULL` sum.** Not possible after an insert into a `NOT NULL` column, but a `NULL` or `0`
  sum is treated as under the budget.
- **`raw_history` writes.** No byte option is passed; behavior identical to today.
- **Importing the module.** Importing `conductor-db.mjs` (the tests do) does not run `main()`.

### Error cases

- **The size query or the `DELETE` throws** (locked database, I/O error, a trigger, a missing SQL feature). The
  throw leaves `purgeTable` and is caught by the existing `catch` that wraps the purge alone (`:468`-`:478`):
  one `CONDUCTOR_DB: retention purge skipped (snapshots): <code|message>` line, exit 0, the inserted row already
  committed. No new error path, no new message.
- **A partially applied purge.** Each bound is its own statement; a throw in the byte bound leaves bounds 1–3's
  deletions in place, as a throw in bound 3 leaves bounds 1–2's today.

## Acceptance Criteria

- [ ] With the byte option, a table whose byte sum is over the budget ends at or under the budget after
  `purgeTable`, when its non-floor rows are enough to cover the excess.
- [ ] The rows deleted are the shortest oldest-first (by `id`) prefix of the non-floor rows whose sizes cover the
  excess: without the last deleted row the sum would still be over the budget.
- [ ] The newest row of every `git_commit_hash` survives the byte bound, including when the floor rows alone
  exceed the budget (the sum then stays above it and every non-floor row is gone).
- [ ] A sum exactly equal to the budget deletes nothing.
- [ ] The size is counted in bytes: a non-ASCII `snap_json` counts its UTF-8 byte length, so the byte sum, and
  with it `SUM(LENGTH(snap_json))`, ends at or under the budget.
- [ ] When `n × maxRowBytes` is not over the budget, no size query runs: a fixture whose sum is over the budget
  but whose row count is under the threshold is left untouched.
- [ ] Without the byte option, `purgeTable` behaves as before; the existing FEAT-025 tests pass unchanged, and
  `raw_history` is never byte-bounded.
- [ ] The `snapshots` call site passes a 256 MiB budget with `maxRowBytes` equal to `PRE_PARSE_MAX_BYTES`, pinned
  by a test against the exported options.
- [ ] A throw inside the byte bound propagates out of `purgeTable`, and through the CLI it produces exactly one
  `retention purge skipped (snapshots):` line, exit 0, and the inserted row present (fail-open).
- [ ] Importing `scripts/conductor-db.mjs` does not run the CLI; running it as a script behaves as before.
- [ ] `npm test` passes on the local Node; no new dependency; `SCHEMA_VERSION` stays 2.

## Out of Scope

- A user-facing switch, environment variable or config key for the budget.
- A byte bound on `raw_history` (its rows are capped at 1 MiB and its count at 2000, a 2 GB ceiling with a
  much smaller realistic size; the entry names `snapshots` only).
- `VACUUM` or `auto_vacuum`: deleted pages are reused by later writes but the file does not shrink. Shrinking
  the file is a separate change.
- Changing the intake cap, the row bounds, or the schema.
- Bounding floor rows by size (would break the newest-per-hash guarantee `get-snapshot` relies on).
- Records (`VERSION`, `CHANGELOG.md`, backlog, memory): written by the release.

## System Impact

- `scripts/conductor-db.mjs`: `purgeTable` gains the optional byte option and a fourth bound, split into its own
  helper to keep functions short; a new constant `SNAPSHOT_BYTE_BUDGET`; the `snapshots` call site passes the
  option through an exported options object; `purgeTable` is exported; `main()` runs behind a main guard
  (adds `pathToFileURL` to the `node:url` import). The script is shipped by the installer
  (`tests/installer/deploy.test.js` copies it), so the shipped CLI changes; its command-line behavior does not.
- `tests/scripts/conductor-db.test.js`: new unit tests for the byte bound against an in-process `DatabaseSync`,
  the options pin, the import guard, and a CLI fail-open case.
- Callers of the CLI (`scripts/resume-read.mjs`, the checkpoint flow, `tests/scripts/handoff-cycle.test.js`,
  `tests/scripts/resume-read.test.js`) are unaffected: no output, exit code or argument changes.
- No hook, installer, settings or workflow change. No new dependency. No CI skip-set change expected: the new
  tests skip where the existing `node:sqlite` tests skip, which the plan must confirm against
  `tools/skip-baseline.json`.

### Files Requiring Full Read (deferred to /cc-plan)

- `scripts/conductor-db.mjs` — `purgeTable` (`:308`-`:355`), the `snapshots` call site (`:463`-`:480`) and
  `main()`'s tail were seen only through searches, past the 30-line cap.
- `tests/scripts/conductor-db.test.js` — the FEAT-025 retention describe block, its out-of-band seeding helper
  and its `node:sqlite` skip condition.

## Complexity Estimate

S — one new bound in one helper plus a main guard, with unit tests on a small in-process database; no schema,
interface or dependency change.

## Owner decisions

- Pickup condition (decided 2026-11-23): proceed now. The entry's gate on observing a cache above a few hundred
  MB is waived: `scripts/conductor-db.mjs` ships to every installed project, and the 28 KB figure measures only
  this repository's cache. The rest of the spec stands as written.
