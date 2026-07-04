# FEAT-005 - Local Persistence Layer (SQLite Task-State Engine)

**Target version:** 1.19.0
**Complexity:** M
**Pillar:** 2 (Local Persistence and State Engine)

## Problem

Code Conductor has no durable, out-of-prompt store for execution state. The
`cc-implement` Step 6 "Hook" already reserves a slot to record task
ID + final state + timestamp into `.conductor/cache.db`, but no such database or
writer exists, so the step is a permanent no-op ("If `.conductor/cache.db`
exists…" — it never does). Task-completion history therefore lives only in the
plan markdown; there is no queryable record the framework can consult without
re-reading files into the LLM context. This blocks the whole Pillar 2 roadmap
(ARCH-008 time-travel, FEAT-011/012 SQLite-backed role handoffs), all of which
assume a working local database engine.

## Solution

Introduce a single dependency-free ES-module CLI, `scripts/conductor-db.mjs`,
that wraps Node's built-in `node:sqlite` (`DatabaseSync`) to own the
`.conductor/cache.db` file: schema creation, schema versioning via
`PRAGMA user_version`, WAL journaling, and one write path — an upsert of task
state keyed by `(plan_file, task_id)`. The `cc-implement` Step 6 hook is rewired
to shell out to this script instead of checking for a file that never exists.
The database is a local cache (gitignored), never read into the LLM context, and
every failure path degrades gracefully because the hook contract is explicitly
best-effort: the plan markdown remains the authoritative state record. Scope is
deliberately tight — only the engine and the `task_state` table ship here; the
`sessions`/`raw_history`/`snapshots` schema, git-hash time-travel, and metadata
caching are deferred to ARCH-008.

## Schema and CLI Contract

### DDL (schema v1)

Exact, deterministic DDL — all columns `TEXT` affinity, composite primary key,
`WITHOUT ROWID` (the PK is a natural composite key, so the rowid is dead weight):

```sql
PRAGMA journal_mode = WAL;
PRAGMA user_version = 1;
CREATE TABLE IF NOT EXISTS task_state (
  plan_file  TEXT NOT NULL,
  task_id    TEXT NOT NULL,
  state      TEXT NOT NULL CHECK (state IN (' ', '>', 'X', '!')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (plan_file, task_id)
) WITHOUT ROWID;
```

Upsert statement:

```sql
INSERT INTO task_state (plan_file, task_id, state, updated_at)
VALUES (?, ?, ?, ?)
ON CONFLICT (plan_file, task_id)
DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at;
```

### `<state>` validation

The allowed set is the four checkbox states: `' '` (pending), `'>'`
(in-progress), `'X'` (complete), `'!'` (failed). Validation is enforced twice —
in the CLI (before binding) and by the SQL `CHECK` constraint. Any other value is
rejected with a `CONDUCTOR_DB:` warning and exit 0; nothing is written. This
prevents arbitrary/corrupt state strings from ever reaching the table.

### Repository-root resolution

1. Primary: `git rev-parse --show-toplevel`.
2. Fallback A: walk up from `process.cwd()` looking for a `.git` entry; stop when
   `path.dirname(dir) === dir` (filesystem root) or after a hard cap of 40
   iterations (matching the project's existing traversal-cap convention). This
   bounds the walk and cannot loop.
3. Fallback B (deterministic): `path.resolve(dirname(fileURLToPath(import.meta.url)), '..')`
   — the script lives at `<root>/scripts/conductor-db.mjs`, so its parent's parent
   is the root by construction.

The resolved root is normalized with `path.resolve`, and the db path is built
with `path.join(root, '.conductor', 'cache.db')` so separators are OS-correct
(git returns forward slashes even on Windows; `path.resolve` normalizes them).

### Corrupt-backup naming and collisions

`<ts>` is a filesystem-safe, colon-free compact UTC stamp derived from
`new Date().toISOString().replace(/[-:.]/g, '')` → e.g. `20260704T141211123Z`
(no `:` or `.`, safe on Windows/NTFS). If `cache.db.corrupt.<ts>` already exists
(rapid back-to-back failures within the same millisecond), append an incrementing
numeric suffix `.1`, `.2`, … up to 100 attempts; if all are taken, warn and
proceed to recreate without preserving the older backup.

### CLI parsing and output discipline

- `argv[2]` is the subcommand: `record` or `init`. Parsing is strictly
  positional — there is no flag library. Any unknown subcommand, unexpected/extra
  positional argument, or stray flag yields a single `CONDUCTOR_DB:` usage warning
  on stderr and exit 0 (never a crash, never a non-zero exit).
- `record` requires exactly three positional args (`plan_file`, `task_id`,
  `state`); fewer or more → usage warning, exit 0.
- Both `record` and `init` are **completely silent on success**: no stdout, no
  diagnostic text, exit 0. `init` only creates/verifies the db and schema. Only
  the degraded/error paths ever emit (to stderr, `CONDUCTOR_DB:`-prefixed).
- The `DatabaseSync` connection is always closed with `db.close()` in a `finally`
  block before exit — this checkpoints and releases the WAL so no `-wal`/`-shm`
  residue or lock lingers.

## Behavior

### Main path

1. During `cc-implement` Step 6 (after a task flips to `[X]` or `[!]`), the hook
   probes `node --version`.
2. If Node `>= 22.5.0`, it invokes
   `node --experimental-sqlite scripts/conductor-db.mjs record <plan_file> <task_id> <state>`.
   The version gate below 22.5 prevents passing an unknown flag that would abort
   Node ("bad option"). The exact per-version flag/warning matrix (when the flag
   becomes a no-op or is dropped in later Node lines, and warning suppression via
   `NODE_NO_WARNINGS`) is resolved in `/cc-plan`; if any future Node rejects the
   flag, the invocation simply fails non-fatally and the write is skipped.
3. `conductor-db.mjs` resolves the repository root (`git rev-parse --show-toplevel`,
   falling back to walking up from the script's own directory), then opens
   `<root>/.conductor/cache.db`, creating the `.conductor/` directory and the
   database if absent.
4. On first open it applies schema v1: `PRAGMA journal_mode = WAL`,
   `PRAGMA user_version = 1`, and `CREATE TABLE IF NOT EXISTS task_state`.
5. It upserts the row: `INSERT … ON CONFLICT(plan_file, task_id) DO UPDATE`,
   writing `state` and `updated_at = new Date().toISOString()` (full millisecond
   ISO-8601 UTC, `YYYY-MM-DDTHH:MM:SS.sssZ`).
6. It exits 0. Nothing is printed to stdout on success; the plan file remains the
   authoritative record.

### Alternative paths

- **Deep subdirectory:** commands run from any nested path still resolve the same
  root-level `.conductor/cache.db` via `git rev-parse --show-toplevel`.
- **Repeated writes to the same task:** the upsert replaces the prior row for that
  `(plan_file, task_id)`, so the table always holds the latest state per task.
  Millisecond `updated_at` precision guarantees correct ordering of rapid
  `[>]`→`[X]` transitions within the same second.
- **Fresh database:** `record` self-initializes (create dir → create db → apply
  schema) before the first write, so no separate `init` invocation is required;
  an idempotent `init` subcommand is also exposed for explicit setup.
- **Node below 22.5:** the Step 6 hook skips the DB write entirely (never passes
  the flag), logs one `CONDUCTOR_DB:` warning, and continues.

### Error cases

Every failure is non-fatal and surfaces a single stderr line prefixed
`CONDUCTOR_DB:` (never stdout), then exits 0, honoring the Step 6 best-effort
contract:

- **`node:sqlite` unavailable** (older/unbuilt Node): dynamic `import('node:sqlite')`
  throws → `CONDUCTOR_DB: node:sqlite unavailable, skipping cache write` → exit 0.
- **Locked database** (`SQLITE_BUSY`): WAL mode makes this rare; if it still
  occurs, warn and exit 0.
- **Corrupt database:** on a malformed-image open error, rename the file aside to
  `cache.db.corrupt.<ts>` (colon-free `<ts>`, numeric suffix on collision — see
  Corrupt-backup naming) and recreate a fresh schema (mirrors the installer's
  `_backup_if_malformed` pattern), then retry the write once; if it still fails,
  warn and exit 0.
- **Denied directory/file write** (permission): warn naming the path and exit 0.
- **Invalid `<state>` / CLI misuse:** reject with a `CONDUCTOR_DB:` usage warning
  and exit 0; write nothing (see Schema and CLI Contract).
- **Missing/short args:** warn with usage and exit 0 (never crash the hook).

In all paths `db.close()` runs in a `finally` block before exit so the WAL is
checkpointed and no lock or `-wal`/`-shm` residue lingers.

## Acceptance Criteria

- [ ] `scripts/conductor-db.mjs` exists as a zero-dependency ES module exposing
      `record <plan_file> <task_id> <state>` and idempotent `init` subcommands.
- [ ] Opening/initializing creates `.conductor/cache.db` at the repo root with
      `journal_mode = WAL`, `user_version = 1`, and a `task_state` table whose
      primary key is `(plan_file, task_id)`.
- [ ] `record` upserts: a second `record` for the same `(plan_file, task_id)`
      replaces `state` and `updated_at` rather than inserting a duplicate row.
- [ ] `updated_at` is full-millisecond ISO-8601 UTC (matches
      `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/`).
- [ ] Root resolution works from a deep subdirectory (db lands at repo root, not
      the CWD).
- [ ] When `node:sqlite` is unavailable the script exits 0 and emits exactly one
      `CONDUCTOR_DB:`-prefixed stderr line; nothing on stdout.
- [ ] A corrupt `cache.db` is backed up aside (colon-free `<ts>` name, numeric
      suffix on collision) and recreated; the write then succeeds.
- [ ] `state` outside `{' ', '>', 'X', '!'}` is rejected (CLI + SQL `CHECK`),
      exits 0 with a `CONDUCTOR_DB:` warning, and writes nothing.
- [ ] Unknown subcommand / extra args / stray flags produce a single
      `CONDUCTOR_DB:` usage warning and exit 0; `init` and `record` are silent on
      success (no stdout); `db.close()` runs in a `finally` before exit.
- [ ] The resolved root is `path.resolve`-normalized and the db path built with
      `path.join`, verified on both POSIX and Windows separator forms.
- [ ] `cc-implement.md` Step 6 (both `.claude/commands/` and
      `project-template/.claude/commands/` mirrors) invokes the recorder behind a
      `node --version >= 22.5.0` pre-flight gate and passes `--experimental-sqlite`
      only when the gate passes.
- [ ] `.gitignore` ignores `.conductor/` (local cache never committed).
- [ ] `package.json` `engines.node` is `>=22.5`; framework still runs on Node 20
      with the cache silently disabled (graceful degradation).
- [ ] A Vitest suite covers schema/`user_version` creation, upsert-replaces-state,
      timestamp shape, `state`-enum rejection, CLI misuse, absent-`node:sqlite`
      degradation, and corrupt-db recovery. Temp dbs live under `os.tmpdir()` with
      unique `crypto.randomUUID()` filenames for parallel isolation; an
      `afterEach`/`finally` unlinks each db **and its `-wal`/`-shm` sidecars** so no
      dangling files pollute the workspace. It skips cleanly when the runner's Node
      lacks `node:sqlite`.
- [ ] Full Vitest suite green; VERSION + package.json bumped to 1.19.0; CHANGELOG
      `[1.19.0]` entry tagged `[FEAT-005]` with a dynamically resolved date.

## Out of Scope

- `sessions`, `raw_history`, and `snapshots` tables; git-commit-hash indexing;
  agent "time-travel" / rollback (all → ARCH-008).
- Caching file structures, interface hashes, or method signatures (backlog lists
  these under FEAT-005's prose but they overlap graphify/FEAT-019 and have no
  consumer yet → ARCH-008).
- Any further `claude-mem` removal — already purged in BUG-020; the remaining
  uninstall/healing logic in the installers is intentional and stays.
- Reading the database into the LLM context, or exposing a query interface to the
  agent (no consumer beyond the Step 6 writer in this scope).
- Migrating existing snapshot/session state; the store starts empty.

## System Impact

- **`scripts/conductor-db.mjs`** — new file; the entire engine.
- **`.claude/commands/cc-implement.md:118-120`** and
  **`project-template/.claude/commands/cc-implement.md:118-120`** — Step 6 "Hook"
  body rewritten from the file-existence no-op to the version-gated recorder
  invocation (surgical, mirrored edit in both).
- **`.gitignore`** — add `.conductor/` (idempotent append).
- **`package.json:5-7`** — `engines.node` `>=20` → `>=22.5`.
- **`tests/scripts/conductor-db.test.js`** — new Vitest suite.
- **`VERSION`, `CHANGELOG.md`** — release closeout to 1.19.0 (gated behind green
  suite, last).
- **`AGENT-READABLE BACKLOG.md`** — mark `[FEAT-005]` `[X]` on completion (and,
  separately, `[FEAT-013]` which shipped in 1.18.0 but is still unchecked).

### Files Requiring Full Read (deferred to /cc-plan)

_None. `cc-implement.md` (both mirrors) Step 6 was read (lines 116-137); the
integration point is fully understood. `/cc-plan` will read the full Step 6 /
Error Reference region before editing._

## Complexity Estimate

M — one new self-contained script plus a mirrored surgical hook edit and standard
release wiring; the nuance is entirely in the `node:sqlite` experimental-flag
version gating and graceful-degradation error matrix, not in volume of code.
