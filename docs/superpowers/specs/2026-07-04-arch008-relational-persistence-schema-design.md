# ARCH-008 Relational Persistence Schema — Design Spec

**Backlog item:** `[ARCH-008-S1]` Relational Schema Engine (Foundation) — sub-item of `[ARCH-008]` (Pillar 2)
**Date:** 2026-07-04
**Builds on:** `[FEAT-005]` SQLite task-state engine (v1.19.0)
**Followed by:** `[ARCH-008-A]` write wiring, `[ARCH-008-B]` resume-read wiring
**Scope decision:** schema engine layer only — no consumer wiring

---

## Problem

FEAT-005 established `.conductor/cache.db` with a single `task_state` table and a
fail-open engine (`scripts/conductor-db.mjs`). ARCH-008 requires three additional
git-linked tables — `sessions`, `raw_history`, `snapshots` — to give the agent a
queryable, commit-hash-indexed home for session tracking, raw execution logs, and
compacted state timelines. Without them there is nowhere to persist checkpoint /
compact output relationally, and no substrate for future session resumption or
time-travel rollback.

claude-mem is **already fully purged** by `[BUG-020]` (install steps removed, heal
logic added to both installers, `enabledPlugins` key dropped, prose references
replaced). ARCH-008's "purge claude-mem" criterion is therefore already satisfied;
this spec covers only the remaining open work: the relational schema.

## Solution

Extend `scripts/conductor-db.mjs` with an additive `user_version` 1→2 migration
that creates the three new tables alongside the untouched `task_state`, plus five
new flat subcommands (`session`, `get-session`, `snapshot`, `get-snapshot`,
`history`). All commands reuse the existing `withDb` degradation ladder
(node:sqlite import guard, corrupt-db recovery, WAL checkpoint + close). Write
commands keep the FEAT-005 fire-and-forget contract (empty stdout, exit 0 on any
failure); query commands print a single-line result to stdout on hit and an
**empty string** on miss or any degradation, preserving fail-open semantics for
callers. `snapshots` stores each compacted state as one verbatim SNAP v1 JSON blob.
No `/cc-checkpoint`, `/cc-compact`, or phase-entry consumer is wired in this spec.

## Behavior

### Main path

1. A caller invokes one of the new subcommands against `.conductor/cache.db`.
2. The engine resolves the repo root, opens the db, and reads `PRAGMA user_version`.
3. If `ver === 0 || ver < 2 || the core table is missing`, `applySchema` runs one
   atomic `BEGIN IMMEDIATE` → `PRAGMA user_version = 2` → four
   `CREATE TABLE IF NOT EXISTS` (including the existing `task_state`) + two
   `CREATE INDEX IF NOT EXISTS` → `COMMIT`. Migration is additive: existing
   `task_state` rows and structure are preserved.
4. The subcommand's statement executes:
   - **`session <session_id> <phase> <spec> <git_commit_hash>`** — atomic upsert into
     `sessions`. On first insert, `started_at` and `updated_at` are set to now.
     On conflict (`session_id` exists), `updated_at`, `phase`, `spec`,
     `git_commit_hash` are updated but **`started_at` is preserved** (never
     overwritten).
   - **`snapshot <git_commit_hash>`** — `snap_json` is read from **stdin** (not argv;
     see the ARG_MAX note below); append-only `INSERT` into `snapshots` with a fresh
     `id` and `created_at`.
   - **`history <session_id> <kind>`** — `content` is read from **stdin** (not argv);
     append-only `INSERT` into `raw_history`.
   - **`get-session <session_id>`** — `SELECT` the row; on hit print it as one-line
     JSON to stdout; on miss print nothing.
   - **`get-snapshot <git_commit_hash>`** — `SELECT snap_json ... WHERE git_commit_hash = ?
     ORDER BY id DESC LIMIT 1`; on hit print `snap_json` verbatim to stdout; on miss
     print nothing.
5. WAL checkpoint (TRUNCATE), close, exit 0.

### Alternative paths

- **Pre-existing v1 db** (task_state only, `user_version = 1`): first v2 command
  triggers the additive migration; `task_state` data survives; new tables appear;
  `user_version` becomes 2.
- **Duplicate snapshots for one commit**: allowed. `snapshots` is append-only
  (autoincrement `id` + non-unique index on `git_commit_hash`), so many snapshots
  may share a `git_commit_hash`; `get-snapshot` returns the newest by `id`.
- **Empty git hash**: the `"0000000"` sentinel (from non-git or no-commit
  workspaces) is a valid `git_commit_hash` value and is stored/queried like any
  other.
- **Optional session fields**: `phase`, `spec`, `git_commit_hash` may be empty
  strings; they are stored as-is. `session_id` must be non-empty.

### Error cases

- **node:sqlite unavailable / corrupt db / mkdir failure**: existing `withDb`
  ladder applies — one `CONDUCTOR_DB:` stderr line, exit 0. Write commands write
  nothing; **query commands print an empty string** (never `{}`, never `null`), so
  callers uniformly treat empty stdout as "no data".
- **`snap_json` over the hard cap (10 MiB = 10 × 1024 × 1024 bytes)**: rejected
  before any db work with a `CONDUCTOR_DB:` stderr line; exit 0; nothing written.
  Protects against disk bloat from rogue/looping callers.
- **Wrong arg count / empty required key**: rejected via the existing
  `validateKey` + strict arg-count pattern; usage line to stderr; exit 0.
- **Forward-compat (`user_version > 2`)**: `SCHEMA_VERSION` is bumped to 2; the
  existing guard bails (never downgrades, never writes a newer-schema db).

## Precise Definitions (design hardening — 2026-07-04)

### Exact DDL (all `CREATE ... IF NOT EXISTS`, run inside the v2 migration)

```sql
-- Existing FEAT-005 table. The migration REUSES the current CREATE TABLE string
-- literal already present in applySchema IN PLACE (it is not re-typed or copied to
-- a new location), so drift is impossible by construction regardless of line moves.
-- Line numbers cited elsewhere are indicative only; the binding anchor is "the same
-- source literal already in applySchema", verified by grep on the statement text.
CREATE TABLE IF NOT EXISTS task_state (
  plan_file  TEXT NOT NULL,
  task_id    TEXT NOT NULL,
  state      TEXT NOT NULL CHECK (state IN (' ', '>', 'X', '!')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (plan_file, task_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS sessions (
  session_id      TEXT NOT NULL,
  started_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  phase           TEXT NOT NULL DEFAULT '',
  spec            TEXT NOT NULL DEFAULT '',
  git_commit_hash TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (session_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS snapshots (
  id              INTEGER PRIMARY KEY,          -- rowid alias; append-only, no AUTOINCREMENT
  git_commit_hash TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  snap_json       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_hash ON snapshots (git_commit_hash);

CREATE TABLE IF NOT EXISTS raw_history (
  id         INTEGER PRIMARY KEY,               -- rowid alias; append-only, no AUTOINCREMENT
  session_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT '',
  content    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_raw_history_session ON raw_history (session_id);
```

**Nullability:** every column is `NOT NULL`; optional metadata (`phase`, `spec`,
`git_commit_hash` on `sessions`; `session_id`, `kind` on `raw_history`) carries
`DEFAULT ''`, so a stored value is always a string — `get-session` can never emit
`null`. `AUTOINCREMENT` is intentionally omitted from both rowid tables: the tables
are append-only (S1 never deletes), so the plain `INTEGER PRIMARY KEY` rowid is
monotonic for our usage and `ORDER BY id DESC LIMIT 1` always yields the latest
insert, without the `sqlite_sequence` overhead.

### Timestamps

`started_at`, `updated_at`, `created_at` are computed in the **Node.js runtime**
via `new Date().toISOString()` (ISO-8601 UTC, millisecond precision, e.g.
`2026-07-04T18:08:00.123Z`) — **not** via SQLite `CURRENT_TIMESTAMP` / `datetime()`.
This mirrors FEAT-005's `upsert` (line 205) exactly and keeps timestamps
independent of SQLite's session clock. The columns are **TEXT** holding the ISO-8601
string — **not** integer Unix epochs — and because ISO-8601 UTC with fixed-width
fields is lexicographically ordered identically to chronological order, `ORDER BY
created_at`/`id` and string comparisons sort deterministically and parse identically
across platforms. `history`'s `created_at` is likewise stamped from the Node runtime
(`new Date().toISOString()`), never from SQLite `CURRENT_TIMESTAMP`/`datetime()`, so
all three tables share one clock source and format.

### `sessions` upsert (conflict target for WITHOUT ROWID)

```sql
INSERT INTO sessions (session_id, started_at, updated_at, phase, spec, git_commit_hash)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(session_id) DO UPDATE SET
  updated_at      = excluded.updated_at,
  phase           = excluded.phase,
  spec            = excluded.spec,
  git_commit_hash = excluded.git_commit_hash;
```

`ON CONFLICT(session_id)` names the `WITHOUT ROWID` primary-key index explicitly
(SQLite requires the conflict target to match a unique index/PK). **`started_at` is
deliberately absent from the `DO UPDATE SET` list**, so the original creation
timestamp is preserved across every subsequent upsert; on first insert both
`started_at` and `updated_at` receive the same `new Date().toISOString()` value.

This is an **`ON CONFLICT DO UPDATE`** sequence, explicitly **not** `INSERT OR
REPLACE`: `INSERT OR REPLACE` deletes the conflicting row and re-inserts, which would
discard the original `started_at` (and reset it to the new value). The targeted
`DO UPDATE` list touches only the four mutable columns and leaves `started_at`'s
stored value in place, so creation time is genuinely preserved across every upsert.

### Migration error handling

`applySchema` runs inside `BEGIN IMMEDIATE` with `ROLLBACK` on error (FEAT-005
lines 71–85). A migration failure propagates to `openReady` → `withDb`'s `catch`,
which emits one `CONDUCTOR_DB: <code> writing <dbPath>: <message>, skipping cache
write` line to stderr and **exits 0** (fail-open). If the failure is a corruption
signature, the existing ladder moves the file aside (`backupAside`) and retries
once on a fresh file. No migration path throws to the process top level as fatal.

The single `backupAside` + retry **follows the exact same stderr pattern — no
separate warning block**. `backupAside` is silent by FEAT-005 design; a successful
recovery produces **zero** `CONDUCTOR_DB:` lines (the fresh db is created and the
write proceeds). Only if the retry itself throws does the standard `withDb` `catch`
line appear. S1 adds no distinct "recovered"/"backed up" diagnostic.

### Corrupt-file move-aside failure (EXDEV / EPERM / EROFS)

`backupAside` (FEAT-005, reused unchanged) moves a corrupt db or a squatting
non-regular file aside before a fresh db is created. Its ladder, and what happens when
a restricted filesystem rejects the operation:

1. **`renameSync(path, target)`** to `<path>.corrupt.<stamp>` (numeric `.1`–`.100`
   suffixes on collision). Atomic and content-preserving. If it throws — `EXDEV`
   (cross-device; unlikely since the target is the same directory), `EPERM`/`EACCES`
   (permissions), `EROFS` (read-only), or a lock — it is caught and the ladder falls
   through.
2. **Type-aware fallback.** A regular file → `unlinkSync(path)` (remove it so a fresh
   db can be created). A **directory** → give up: `warn("cannot move aside directory
   at <path> (rename failed); skipping cache write")`, return `false` — never
   `unlink`/`rmdir`/`rm -r` a directory. If the path vanished between attempts, treat
   as cleared.
3. **Both rename and unlink fail** (e.g. `EPERM`/`EROFS` locked regular file):
   `warn("cannot move aside file at <path>; skipping cache write")`, return `false`.

When `backupAside` returns `false`, `openReady` returns `null` and `withDb` skips the
write — one `CONDUCTOR_DB:` line already emitted, **exit 0**. On a fully restricted
filesystem the cache therefore self-disables gracefully; it never throws, never
force-deletes, and never blocks the caller. S1 adds no new move-aside logic.

### Corruption timing: open-probe recovery vs steady-state degradation

`SQLITE_CORRUPT` (and its siblings — "malformed", "not a database", "file is
encrypted") is handled differently by **when** it surfaces:

- **At open time** — during `openReady`'s initial `PRAGMA user_version` probe (or the
  connection open itself): `isCorruptionError` matches, so the disaster-recovery loop
  runs — `backupAside` moves the bad file aside and the schema is re-applied once on a
  fresh db, so subsequent writes proceed. This is the only place recovery fires.
- **Steady-state, after a successful open** — a `SQLITE_CORRUPT` thrown mid-operation,
  e.g. during a `get-session`/`get-snapshot` `SELECT` or a write `INSERT`, is caught
  by **`withDb`'s `catch`**, which emits one `CONDUCTOR_DB: <code> writing <path>: …,
  skipping cache write` line and **exits 0 without invoking `backupAside`**. The
  possibly-corrupt file is **left intact** for inspection; a read returns a zero-byte
  (miss-equivalent) stdout.

The rationale: destroying the db is only justified when it blocks the engine from
opening at all (open-probe path, where a write could not otherwise proceed). A
corruption surfacing mid-query may be transient or partial, and silently nuking the
file on a read path would be more destructive than degrading; so steady-state
corruption degrades non-destructively rather than triggering recovery. S1 preserves
this FEAT-005 split unchanged.

### Journal mode & synchronous on a pre-existing db

`journal_mode` is a persistent db-header setting; `synchronous` is per-connection.
On the steady-state path (`user_version` already 2) the migration does **not** run,
so a user's custom `journal_mode`/`synchronous` is left untouched. On the one-time
v1→v2 migration, `applySchema` re-asserts `PRAGMA journal_mode = WAL` best-effort
(unchanged from FEAT-005), so a custom non-WAL journal on a v1 db is switched to WAL
during that single migration. S1 never issues `PRAGMA synchronous`; it stays at
SQLite's per-connection default.

### Lock contention & OS-level access failures

The reused `openConn` arms `PRAGMA busy_timeout = 2000` (2 s) on every connection;
there is **no additional application-level retry loop**. A `SQLITE_BUSY` that
outlasts 2 s surfaces to `withDb`'s `catch`, is logged under `CONDUCTOR_DB:`, and
exits 0. An OS-level failure that is **not** a corruption signature — `EACCES`/
`EPERM` permission denial, a mandatory OS file lock, `EROFS` — is rethrown by
`openReady` (it is not corruption), caught by `withDb`, logged as one `CONDUCTOR_DB:`
line, and exits 0. For a **query** in this state the callback never runs, so stdout
receives **zero bytes** — indistinguishable to the caller from a clean miss except
that a clean miss emits no stderr line. The exit-0 + empty-stdout contract therefore
holds whether the db is missing, locked, permission-denied, or simply has no matching
row.

### Validation & exact stderr strings

| Parameter | Rule | Reject message (`CONDUCTOR_DB: ` prefix, one line) |
|---|---|---|
| `session_id`, `git_commit_hash` | `validateKey`: trim → non-empty → ≤512 chars; **opaque string, no hex/format check** | `<name> is empty; <usage>` / `<name> exceeds 512 chars; rejected` |
| `phase`, `spec`, `kind` | optional; empty allowed; **not trimmed**; ≤512 chars | `<name> exceeds 512 chars; rejected` |
| `snap_json` (stdin) | non-empty stream (empty rejected); `Buffer.byteLength ≤ 10485760` (10 MiB), measured on the read buffer | empty → `snap_json is empty; <usage>` · over → `snap_json exceeds 10485760 bytes (10 MiB); rejected` |
| `content` (stdin) | non-empty stream (empty rejected); `Buffer.byteLength ≤ 1048576` (1 MiB), measured on the read buffer | empty → `content is empty; <usage>` · over → `content exceeds 1048576 bytes (1 MiB); rejected` |
| wrong arg count | strict per-subcommand count; **too few OR too many** both reject | the subcommand's usage line, e.g. `usage: conductor-db.mjs snapshot <git_commit_hash>` |

`snap_json` and `content` are payload columns (`NOT NULL`): an empty **stdin** stream
is an **argument violation**, not a valid empty payload. Size limits evaluate
**UTF-8 byte length** (`Buffer.byteLength`) on the buffer read from stdin, never JS
`String.length`. All key and metadata fields share one bound, `MAX_KEY_LEN = 512` chars: `session_id`
and `git_commit_hash` (required, non-empty, ≤512) and `phase`/`spec`/`kind` (optional,
empty allowed, ≤512) are all capped identically for structural consistency.
`git_commit_hash` is an **opaque index key** — validated only as a
non-empty ≤512-char string; no hexadecimal or length-40/64 check, so the `"0000000"`
sentinel and any future non-hex identifier are accepted without rejection. Because
`validateKey` **trims first, then empty-checks**, a `session_id` or `git_commit_hash`
consisting entirely of whitespace collapses to `""` and is **rejected as empty**
despite meeting the raw length — no all-blank key is ever stored.

**ARG_MAX / stdin delivery:** the OS caps exec arguments (Linux `MAX_ARG_STRLEN` =
128 KiB per single arg; overall `ARG_MAX` typically ~2 MiB), so a multi-MiB payload
**cannot** be passed as an argv element — the `exec` would fail with `E2BIG` before
the script runs, making an argv-based 10 MiB cap unenforceable. Therefore `snapshot`
and `history` read their payload from **stdin**.

**Bounded, memory-safe stdin read (not `readFileSync(0)`):** a `readStdinCapped(max)`
helper loops `fs.readSync(0, chunk, …)` into a fixed reusable chunk buffer, appending
raw bytes to a list and tracking the running total. The instant the total **exceeds**
`max` it stops reading and returns an over-cap signal — it does **not** drain the rest
of a hostile stream — so peak memory is bounded to ~`max + chunk`, never the full
payload. Plain `readFileSync(0)` is avoided precisely because it would buffer an
unbounded stream into memory before any size check could run. The accumulated bytes
stay a raw **`Buffer`**; the size check is `buf.length` (already byte count). Only
after the non-empty + within-cap checks pass is the buffer **decoded with strict
UTF-8** — `new TextDecoder('utf-8', { fatal: true }).decode(buf)` — so an over-cap or
empty stream never allocates the decoded string. On the over-cap abort, the exact
stderr line is `CONDUCTOR_DB: snap_json exceeds 10485760 bytes (10 MiB); rejected`
(or `CONDUCTOR_DB: content exceeds 1048576 bytes (1 MiB); rejected` for `history`) —
the message cites the **limit**, not the actual size, since the reader stops counting
at the cap.

**Malformed UTF-8 is a validation failure, not silent loss:** `buf.toString('utf8')`
would replace invalid byte sequences with U+FFFD and persist a corrupted-but-valid
string; the `fatal: true` decoder instead throws on the first invalid sequence, and
the handler rejects with `CONDUCTOR_DB: snap_json is not valid UTF-8; rejected` (or
`content is not valid UTF-8; rejected`), exit 0, nothing written. `snap_json` is
expected to be valid JSON text (hence valid UTF-8), so this fails loud rather than
storing replacement characters into the TEXT column. `session_id`, `kind`, `git_commit_hash`, `phase`, `spec`
stay small argv values, safely under any per-arg limit.

**stdin read errors:** `readStdinCapped` **propagates** its stream error (it neither
swallows it nor calls `process.exit` itself). The catch lives one level up, in the
`cmdSnapshot`/`cmdHistory` handler, which wraps the read in `try/catch`. Crucially the
read runs **before** `withDb` is invoked, so on an abrupt upstream pipe closure or
crash (`EPIPE`, `EIO`, or any read throw) the handler reports one line —
`CONDUCTOR_DB: error reading stdin: <code/message>, skipping cache write` — and simply
`return`s **without ever calling `withDb`**; the db is never opened. Process
termination remains the single top-level `main().then(() => process.exit(0))`; the
helper does not exit on its own, keeping exit control in one place. (This error path
therefore does not pass through `withDb`'s own `catch`, which only guards failures
after the db is opened.)

**stdin EOF / no-hang guard:** before reading, the payload subcommands check
`process.stdin.isTTY`; if stdin is a TTY (interactive, no pipe), the engine does
**not** call `readStdinCapped` — it treats the payload as absent and rejects
immediately (`snap_json is empty` / `content is empty`, exit 0), so an operator who
runs `snapshot <hash>` by hand never hangs waiting for a terminal EOF. For a
non-TTY stdin (pipe/redirect), `readFileSync(0)` reads to EOF and correctness relies
on the caller closing the stream — guaranteed by the pipe pattern the writer
(`[ARCH-008-A]`) uses (`… | node conductor-db.mjs snapshot <hash>`), where the pipe
closes when the producer exits. S1 adds no arbitrary read timeout (a synchronous
stdin read cannot safely be timed out mid-call); the TTY guard covers the realistic
hang case.

**Fail-fast, one message:** validation is sequential and short-circuits (as in
FEAT-005's `cmdRecord`). The first parameter that fails emits its single
`CONDUCTOR_DB:` line and returns (exit 0); later parameters are not evaluated, so
multiple simultaneous violations never produce multiple stderr lines. Arg-count is
checked first, before any per-parameter validation.

**Control characters in optional metadata:** `phase`, `spec`, `kind` accept raw
non-printable / control characters as long as they are ≤512 chars — they are stored
verbatim and, on `get-session` read-back, escaped by `JSON.stringify` (`\n`,
`\uXXXX`), so the single-line stdout contract holds. No stripping or content
sanitization is performed. Per-subcommand usage constants (payload subcommands take
their blob on stdin, so it is not an argv placeholder):
`session <session_id> <phase> <spec> <git_commit_hash>`,
`get-session <session_id>`, `snapshot <git_commit_hash>` (snap_json ← stdin),
`get-snapshot <git_commit_hash>`, `history <session_id> <kind>` (content ← stdin).

### Query output contract

- **`get-session`** — `SELECT session_id, started_at, updated_at, phase, spec,
  git_commit_hash FROM sessions WHERE session_id = ?`. On hit, **do not**
  `JSON.stringify(row)` directly (that would trust the driver's key-insertion order);
  instead construct a new object with explicit, fixed key assignment
  `{ session_id: row.session_id, started_at: row.started_at, updated_at: row.updated_at,
  phase: row.phase, spec: row.spec, git_commit_hash: row.git_commit_hash }` and print
  `JSON.stringify(that) + "\n"`. Key order is thus guaranteed by our code, independent
  of how `node:sqlite`'s `.get()` orders columns. The mandated key order is exactly
  `session_id, started_at, updated_at, phase, spec, git_commit_hash`, so a
  deterministic test can assert against, e.g.,
  `{"session_id":"s1","started_at":"2026-07-04T18:08:00.000Z","updated_at":"2026-07-04T18:09:00.000Z","phase":"impl","spec":"none","git_commit_hash":"0000000"}\n`. `JSON.stringify` escapes any interior
  newline/control char as `\n`/`\uXXXX`, so output is guaranteed single-line without
  manual stripping. Because every column is `NOT NULL DEFAULT ''`, empty optional
  fields serialize as `""` — never `null`, never a fabricated fallback.
  `JSON.stringify` escapes **all** C0 control characters (U+0000–U+001F), so a stored
  carriage return (`\r`, U+000D) is emitted as the two characters `\r`, not a literal
  CR — no bare CR/LF ever reaches stdout, and terminal/line parsers see exactly one
  line.
- **`get-snapshot`** — `SELECT snap_json FROM snapshots WHERE git_commit_hash = ?
  ORDER BY id DESC LIMIT 1`. On hit, the stored `snap_json` is returned
  **byte-for-byte as stored**, followed by exactly **one** `\n` delimiter appended by
  the command (`process.stdout.write(row.snap_json); process.stdout.write("\n")`). The
  trailing newline is a line delimiter, **not** part of the stored payload — if the
  blob was stored with its own trailing newline, that byte is preserved and the single
  delimiter is added after it (so a self-terminated blob yields two newlines). Callers
  that capture via `$(…)` have the single trailing newline stripped by the shell; a
  byte-exact consumer should slice off the final `\n`. An **empty stored payload** is
  unreachable through the engine (the `snapshot` writer rejects an empty stdin stream
  and `snap_json` is `NOT NULL`), but if one were injected externally, `get-snapshot`
  applies the uniform rule and emits just the lone `\n` delimiter (one byte) — still
  distinguishable from a clean **miss** (zero bytes, `[ -z "$out" ]` true).
- **Miss or any degradation** (no row, node:sqlite absent, corrupt db): write
  **zero bytes** to stdout — no `{}`, no `null`, no newline — and exit 0. Callers
  test `[ -z "$out" ]` for "no data". The single trailing `\n` appears only on a hit.

### Explicitly deferred (out of scope for S1)

- **Retention / pruning:** `snapshots` and `raw_history` are append-only with **no
  pruning** in S1 — time-travel intentionally needs full history. Per-row caps
  (10 MiB snap_json, 1 MiB content) bound single-row bloat; unbounded *row-count*
  growth is acknowledged and deferred to a future maintenance subcommand or to
  `[ARCH-008-A]`/`[ARCH-008-B]`. Superseded snapshots for one hash are retained.
- **DB-path override env/flag:** none added. Isolation comes from `resolveRoot`
  resolving the current git top-level, so each test's `mkdtemp` + `git init` cwd
  already gets its own `.conductor/cache.db`. No `CONDUCTOR_DB_PATH` in S1.
- **Foreign keys:** no `FOREIGN KEY` / `REFERENCES` between any tables — a dangling
  `session_id` in `raw_history`/`snapshots` must never fail a write; this preserves
  the fire-and-forget, non-fatal contract.

### WAL checkpoint cost

S1 keeps FEAT-005's per-close `PRAGMA wal_checkpoint(TRUNCATE)` (lines 238–244)
unchanged. Writes here are low-frequency (one per phase transition / task / snapshot,
not a hot loop), so the truncate cost — bounded by the frames written in that single
call, worst case one 10 MiB snapshot — is acceptable, and it guarantees sidecar
collapse on network/oddball filesystems. No switch to `PRAGMA wal_autocheckpoint`.

### Index accounting

FEAT-005 declares **zero** explicit `CREATE INDEX` statements (`task_state` relies
on its `WITHOUT ROWID` primary-key clustering). The v2 migration therefore adds
**exactly two** explicit indexes — `idx_snapshots_hash`, `idx_raw_history_session` —
for a post-migration total of two named secondary indexes it declares. The migration
is **purely additive**: it issues only `CREATE TABLE/INDEX IF NOT EXISTS` and never
`DROP` anything, so any secondary index a third-party utility previously added to
`task_state` (or any table) is **retained untouched** — S1 neither depends on nor
removes external indexes.

### user_version read placement & concurrent init

The `PRAGMA user_version` read stays **outside** any transaction (as in FEAT-005
`openReady` line 181) — a cheap, lock-free probe. Correctness under concurrent
initialization does **not** depend on the read being transactional: `applySchema`
does all its work inside `BEGIN IMMEDIATE` (which acquires the write lock, so a
second racing process blocks up to `busy_timeout`), and every statement is
idempotent — `CREATE TABLE/INDEX IF NOT EXISTS` and an unconditional
`PRAGMA user_version = 2`. A lost race therefore just re-applies the identical schema
harmlessly; there is no read-modify-write hazard to protect. The forward-compat guard
(`ver > 2`) is likewise a pure read that only ever *bails* — S1 never writes a version
above 2 — so it needs no transaction either.

**No noisy log duplication:** a successful (re)application of the schema is
**silent** — `applySchema` emits no `CONDUCTOR_DB:` line on success and the WAL pragma
swallows failure. So even under heavy parallel init where several processes each
re-run the idempotent migration, no benign duplicate log lines appear; the only line
that can surface is a genuine `SQLITE_BUSY` when a process waits past the 2 s timeout,
which is real contention worth reporting, not duplication.

### Forward-compatibility bail — exact output

When `user_version > 2`, the engine writes exactly one line to stderr —
`CONDUCTOR_DB: db schema v<ver> newer than supported v2, skipping cache write` —
closes the handle, and **exits 0** (never a non-zero code; the cache is
non-authoritative and must never break a caller). For a query subcommand in this
state stdout receives zero bytes. No downgrade and no write ever occurs.

### resolveRoot outside any git workspace

`resolveRoot` (unchanged from FEAT-005) tries `git rev-parse --show-toplevel`, then a
bounded 40-level `.git` walk up from `cwd`, then finally falls back to the script's
own location: `resolve(dirname(fileURLToPath(import.meta.url)), '..')` — i.e. the
conductor install root that contains `scripts/conductor-db.mjs`. Run entirely outside
any git repo, the cache is thus created at `<conductor-install>/.conductor/cache.db`,
not tied to the user's cwd. This is acceptable because the cache is non-authoritative
and callers supply the `"0000000"` sentinel for `git_commit_hash` when no commit
exists; the engine never errors on the absence of git.

**Non-git multi-project collision (documented limitation):** because every non-git
workspace collapses to the *same* `<conductor-install>/.conductor/cache.db`, two
distinct non-git directories share one cache. Rows only actually collide when they
share a caller-supplied key — the same `session_id` (upsert overwrites) or the same
`git_commit_hash` for `get-snapshot` (the `"0000000"` sentinel is shared, so a
snapshot query could return another non-git project's latest blob). S1 does **not**
add per-directory namespacing to the fallback path; the intended and primary use is
inside a git repo, where `resolveRoot` yields a unique root per project and the real
commit hash disambiguates. Callers operating outside git should namespace
`session_id` and avoid relying on the `"0000000"` snapshot key. Fuller isolation is
deferred to `[ARCH-008-A]`/`[ARCH-008-B]`, which run in git workspaces.

### Recursive directory creation

Inherited from FEAT-005 `withDb`: before opening the db the engine ensures
`<root>/.conductor` exists via `mkdirSync(dir, { recursive: true })`, after first
moving aside any non-directory squatting that path (non-destructive rename, never
`rm -r`). No caller needs to pre-create the directory.

### Node runtime floor

`node:sqlite` requires **Node ≥ 22.5.0** (experimental, behind
`--experimental-sqlite`); the flag is no longer required once the module reaches
stable (**Node 24+**). `engines.node` stays `>= 20`: on any Node below 22.5 the
dynamic `import('node:sqlite')` throws and `withDb` degrades (`node:sqlite
unavailable, skipping cache write`, exit 0). The `cc-implement` Step 6 gate already
encodes this (version ≥ 22.5 check + no-flag-first probe); S1 adds no new floor.

On a sub-22.5 Node the degradation is uniform across **all** subcommands: the dynamic
`import('node:sqlite')` inside `withDb` throws, `withDb` emits the single line
`CONDUCTOR_DB: node:sqlite unavailable, skipping cache write`, and returns. For write
subcommands nothing is persisted; for **query** subcommands (`get-session`,
`get-snapshot`) `withDb` returns `undefined`, so stdout receives **zero bytes** —
identical to a clean miss except for that one stderr line — and the process exits 0.
Payload subcommands still read and validate stdin first (the read precedes `withDb`),
so a malformed/over-cap payload is still rejected on old Node; a valid payload is read
and then harmlessly discarded when the import fails. No subcommand ever throws fatally
or produces non-empty stdout when `node:sqlite` is absent.

### Contention vs crash message patterns

A `SQLITE_BUSY` that outlasts the 2 s `busy_timeout` is reported through the
`withDb` write-error format — `CONDUCTOR_DB: SQLITE_BUSY writing <dbPath>:
<message>, skipping cache write` — carrying the SQLite error **code** and the db
path. This is **distinct** from an unexpected top-level crash, which the `main().catch`
handler reports as `CONDUCTOR_DB: unexpected: <message>` (no code, no path). Callers
and log scrapers can therefore separate ordinary lock contention from a genuine engine
fault by the message shape; both still exit 0.

### snap_json is opaque text (no JSON validation)

`snapshot` stores the stdin bytes **verbatim as opaque text**; it does **not**
`JSON.parse` or otherwise structurally validate the payload. The `snap_json` column
name is descriptive of intended content, not an enforced constraint. Rationale: the
producer (`/cc-compact` → `[ARCH-008-A]`) already validates SNAP v1 via
`scripts/snap-validate.mjs` before writing, so re-validating here would duplicate that
logic and couple the engine to the SNAP schema, breaking forward compatibility with
any future snapshot format. Only non-empty + ≤10 MiB are enforced.

### Parameter binding style

The new multi-column statements bind with **named parameters** (object binding),
e.g. `INSERT INTO sessions (...) VALUES ($session_id, $started_at, $updated_at,
$phase, $spec, $git_commit_hash)` run with `{ $session_id, $started_at, … }`, so a
6-column insert cannot silently misalign positional arguments. `node:sqlite`
`StatementSync` supports object binding for `$name` placeholders. The existing
FEAT-005 `record`/`upsert` statement keeps its positional `?` binding unchanged (not
touched by S1).

### WAL on network filesystems

WAL is best-effort, unchanged from FEAT-005: `applySchema` wraps
`PRAGMA journal_mode = WAL` in `try/catch`, so a network/virtualized mount whose
shared-memory + POSIX locking cannot support WAL simply proceeds under the default
rollback journal — the engine is fully correct without WAL. If a WAL shared-memory
protocol error (`SQLITE_IOERR_SHMOPEN`, `SQLITE_PROTOCOL`, "disk I/O error") instead
surfaces later during a write, it is caught by `withDb`'s `catch`, logged as one
`CONDUCTOR_DB: <code> writing <path>: …, skipping cache write` line, and exits 0. WAL
is never a hard requirement; its absence or failure degrades, never crashes.

### Windows path handling

The db path is built with `path.join`/`path.resolve`, which on win32 natively
normalize mixed `/` and `\` separators, so `resolveRoot`'s script-dir fallback
(`resolve(dirname(fileURLToPath(import.meta.url)), '..')`) yields a valid Windows path
regardless of separator style in `import.meta.url`. No manual separator handling is
needed for the db path. (The POSIX-forcing in `normalizePlanFile` applies only to the
`task_state` *key*, not to the db path, and the new subcommands take opaque keys that
are never path-normalized.)

### Shebang / experimental-sqlite flag

The script embeds **no shebang** and no self-injected flag: a shebang cannot portably
carry `--experimental-sqlite` across platforms. Flag selection stays the invoker's
responsibility, exactly as FEAT-005 established — the `cc-implement` Step 6 gate (and
the `[ARCH-008-A]`/`[ARCH-008-B]` callers, and the tests) probe `node:sqlite` no-flag
first and pass `--experimental-sqlite` only on Node 22.5 ≤ v < stable (Node 24). On
such a version without the flag, `import('node:sqlite')` throws and the engine
degrades (`node:sqlite unavailable, skipping cache write`, exit 0). S1 introduces no
new flag-handling mechanism.

### Test isolation of process.exit

Tests spawn `conductor-db.mjs` as a **child process** (`spawnSync`, the FEAT-005
harness), so the engine's top-level `process.exit(0)` only sets the *child's* exit
code that assertions read — it can never terminate the Vitest runner. No
`process.exit` stubbing or interception is required; child-process isolation is the
mechanism.

## Acceptance Criteria

- [ ] `SCHEMA_VERSION` is `2`; `applySchema` creates `sessions`, `snapshots`,
      `raw_history`, and `task_state` idempotently in one atomic transaction and
      sets `user_version = 2`.
- [ ] Running any v2 command against a pre-existing v1 db migrates it to v2 while
      preserving all `task_state` rows and structure.
- [ ] `sessions` is `WITHOUT ROWID` keyed by `session_id`; the upsert preserves the
      original `started_at` on conflict and updates the other columns.
- [ ] `snapshots` is append-only (autoincrement `id`) with index
      `idx_snapshots_hash` on `git_commit_hash`; `get-snapshot` uses
      `ORDER BY id DESC LIMIT 1`.
- [ ] `raw_history` is append-only with index `idx_raw_history_session` on
      `session_id`.
- [ ] `snapshot` rejects any `snap_json` argument larger than 10 MiB without
      touching the db.
- [ ] Query subcommands print a single-line result on hit and an **empty string**
      (not `{}` / not `null`) on miss or any degradation; exit 0 in all cases.
- [ ] No foreign-key constraints exist between any tables (explicitly omitted to
      keep every write fire-and-forget and non-fatal).
- [ ] Existing `record` (task_state) and `init` subcommands are unchanged and still
      pass their FEAT-005 tests.
- [ ] The migration reuses the existing `task_state` `CREATE TABLE` string literal
      in place (not re-typed); a grep on the statement text confirms a single
      occurrence, so line shifts cannot cause drift.
- [ ] All timestamps use Node `new Date().toISOString()` (ISO-8601 UTC ms), not
      SQLite date functions.
- [ ] The `sessions` upsert uses `ON CONFLICT(session_id) DO UPDATE` and omits
      `started_at` from the SET list (creation time preserved).
- [ ] `snap_json` (10 MiB) and `content` (1 MiB) caps are enforced on
      `Buffer.byteLength(v,'utf8')`, not `String.length`.
- [ ] `get-session` emits fixed-key single-line `JSON.stringify(row)`; empty optional
      fields serialize as `""`, never `null`.
- [ ] Hit output ends in exactly one `\n`; miss/degradation writes zero bytes to
      stdout; exit 0 in all cases.
- [ ] The migration adds exactly two explicit indexes (`idx_snapshots_hash`,
      `idx_raw_history_session`); no foreign keys anywhere.
- [ ] No env/flag DB-path override and no retention/pruning are introduced in S1.
- [ ] `get-session` output is built from an explicitly ordered object (not
      `JSON.stringify(row)` directly), so key order does not depend on the driver.
- [ ] Empty `snap_json` and empty `content` are rejected as argument violations with
      the `is empty` message; validation fails fast (first violation only, one line);
      arg-count (too few OR too many) is checked before per-parameter checks.
- [ ] Control characters in `phase`/`spec`/`kind` are stored verbatim and escaped on
      `get-session` read-back; no sanitization.
- [ ] Migration re-asserts WAL best-effort; `synchronous` is never set; steady-state
      (v2) opens leave existing db settings untouched.
- [ ] Corruption recovery (`backupAside` + retry) emits no extra warning block; a
      successful recovery produces zero `CONDUCTOR_DB:` lines.
- [ ] Query exit-0 + empty-stdout holds for missing, locked, and permission-denied
      dbs alike; only a clean row-miss emits no stderr line.
- [ ] `snapshot` and `history` read their payload from stdin (`readFileSync(0)`), not
      argv; the byte cap is enforced on the read buffer before insert; empty stdin
      rejects. A >128 KiB payload round-trips (proving no ARG_MAX ceiling).
- [ ] CLI placeholder is `git_commit_hash` (matches the column); it is validated only
      as a non-empty ≤512-char opaque string — no hex/format check.
- [ ] Forward-compat bail prints `db schema v<ver> newer than supported v2, skipping
      cache write` and exits 0; `user_version` read is outside the transaction, with
      concurrency safety from `applySchema`'s `BEGIN IMMEDIATE` + idempotent DDL.
- [ ] Engine requires Node ≥ 22.5 for `node:sqlite`; below that it degrades (exit 0);
      `engines.node` stays `>= 20`.
- [ ] A payload subcommand with a TTY stdin rejects immediately (no `readFileSync(0)`
      call) and never hangs; a piped stream reads to EOF.
- [ ] The migration is DROP-free: any pre-existing third-party index on `task_state`
      survives the v1→v2 migration untouched.
- [ ] Whitespace-only `session_id`/`git_commit_hash` is rejected as empty; stored
      carriage returns are escaped so `get-session` stays single-line.
- [ ] Concurrent re-application of the schema emits no `CONDUCTOR_DB:` lines on
      success (no benign log duplication).
- [ ] stdin is read by a bounded `readStdinCapped` (chunked `readSync`) that aborts
      once the cap is exceeded — peak memory ~cap, not the full stream — keeps bytes
      as a `Buffer`, and decodes to string only after non-empty + within-cap pass.
- [ ] A stdin read error (`EPIPE`/`EIO`/abrupt close) is caught → one `error reading
      stdin: …` line → exit 0, db never opened.
- [ ] `snapshot` stores the payload as opaque text — no `JSON.parse`/structural
      validation; only non-empty + ≤10 MiB enforced.
- [ ] New multi-column statements use named (`$name` object) binding; FEAT-005
      `record` keeps its positional binding.
- [ ] Tests spawn the engine via `spawnSync`; no `process.exit` interception is used
      or needed.
- [ ] Payloads are decoded with `TextDecoder('utf-8',{fatal:true})`; malformed UTF-8
      is rejected (`… is not valid UTF-8; rejected`), never stored as U+FFFD.
- [ ] Open-probe corruption triggers `backupAside` recovery; corruption after a
      successful open degrades via `withDb` (one line, exit 0) with the file left
      intact — reads return zero-byte stdout.
- [ ] On Node < 22.5 every subcommand degrades to one `node:sqlite unavailable` line +
      exit 0; queries emit zero bytes; payload subcommands still validate stdin first.

## Out of Scope

- Wiring `/cc-checkpoint` or `/cc-compact` to write `sessions` / `snapshots`
  (follow-up spec).
- Phase-entry resume / branch-switch restore reads (follow-up spec).
- A query/read subcommand for `raw_history` (table + append only; RAG/audit reads
  are future — YAGNI).
- Any installer, `claude-mem`, or dependency-manifest change (already handled by
  BUG-020).
- Cross-branch "time-travel" rollback logic beyond storing rows indexed by hash.

## System Impact

- **`scripts/conductor-db.mjs`** — new schema version, `applySchema` extension,
  five new subcommands, `withDb` extended to return the callback's value for
  queries. Existing write path and degradation ladder reused unchanged.
- **`tests/scripts/conductor-db.test.js`** — new describe blocks for migration,
  each subcommand, query round-trip, degraded-query empty output, size cap,
  forward-compat. Existing FEAT-005 tests must stay green. Mandatory added cases:
  - **Isolation guard:** every case spawns `conductor-db.mjs` with `cwd` set to its
    own `mkdtemp` + `git init` repo (never the real project root); a dedicated guard
    test asserts the real repo-root `.conductor/cache.db` is not created by the suite
    — no test may write to the actual global project cache.
  - **Migration-failure recovery:** force a migration failure (corrupt/`notadb`
    bytes at the db path) and assert exit 0, one `CONDUCTOR_DB:` line, the bad file
    moved aside, and a fresh valid **v2** db (`user_version = 2`, all four tables) as
    the recovered state.
  - **Arg over-supply:** each subcommand invoked with one extra unmapped argument
    (e.g. `get-session <id> extra`) triggers the strict arg-count violation and its
    usage line — over-supply rejects exactly like under-supply.
  - **Empty payloads:** `snapshot <hash> ""` and `history <id> <kind> ""` reject with
    the `is empty` message; nothing is written.
  - **Locked/permission-denied query:** with the db open but access-denied, a
    `get-*` prints zero bytes and exits 0 (degradation branch, one stderr line).
  - **Fixed key order:** assert `get-session` stdout equals the exact expected
    single-line JSON string with keys in the mandated order.
  - **CR/whitespace edge cases:** a `phase`/`spec` containing `\r` round-trips and
    `get-session` stdout stays one line (CR escaped); a whitespace-only `session_id`
    or `git_commit_hash` is rejected as empty.
  - **stdin no-hang:** a payload subcommand invoked with a TTY stdin (no pipe)
    rejects immediately as empty and never blocks.
  - **Teardown:** an `afterEach` removes each `mkdtemp` repo with
    `rmSync(dir, { recursive: true, force: true })` (retry on transient
    `EBUSY`/`ENOTEMPTY`, matching FEAT-005) so no temp storage accumulates on the host.
- **`VERSION` / `package.json` / `CHANGELOG.md`** — minor version bump on ship.
- No consumer command markdown changes in this spec.

### Files Requiring Full Read (deferred to /cc-plan)

- `scripts/conductor-db.mjs` — the plan must full-read this ~278-line engine to
  place the migration, subcommands, and `withDb` return-value change precisely
  against the existing `applySchema`, `openReady`, `withDb`, and dispatch logic.

## Complexity Estimate

**M** — engine-local and additive: one idempotent migration, five new subcommands
following an established validation/degradation pattern, no consumers and no
installer changes.
