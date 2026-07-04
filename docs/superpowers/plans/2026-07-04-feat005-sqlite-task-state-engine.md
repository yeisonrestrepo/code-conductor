# FEAT-005 SQLite Task-State Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this repo, `/cc-implement` drives execution via the surgical 5-step ritual; task IDs use the `[T-NNN]` form.

**Goal:** Ship `scripts/conductor-db.mjs`, a zero-dependency ES-module CLI wrapping Node's built-in `node:sqlite` that owns `.conductor/cache.db`, and rewire the `cc-implement` Step 6 hook to call it so task-state history is durably recorded outside the LLM context.

**Architecture:** One self-contained script exposes two positional subcommands — `record <plan_file> <task_id> <state>` and `init`. It resolves the repo root (git → bounded `.git` walk → script-dir fallback), creates `.conductor/`, opens/repairs the db, applies schema v1 atomically on first use, and upserts one row keyed by `(plan_file, task_id)`. Every failure is non-fatal: a single `CONDUCTOR_DB:`-prefixed stderr line then exit 0. The plan markdown stays authoritative. The `--experimental-sqlite` flag is a launch concern of the caller (hook + test helper), never baked into `npm test`.

**Tech Stack:** Node.js `node:sqlite` (`DatabaseSync`), ES modules, Vitest ^3 (child-process `spawnSync` tests), markdown command files.

## Global Constraints

- **engines.node stays `>=20`** — no bump. The cache's Node `>=22.5` need is runtime-gated (hook version probe + the script's dynamic `import('node:sqlite')`) and self-disables below 22.5. No `engines` change means no npm warning on Node 20.
- **All failure paths exit 0** — the script never exits non-zero and never throws to the shell; the Step 6 hook contract is best-effort. Coverage is layered so **no error class escapes**: (1) `withDb`'s `try/catch` wraps `openReady` + the write and turns any thrown error — including disk-full `ENOSPC`, quota `EDQUOT`, read-only-fs `EROFS`, and I/O `SQLITE_IOERR` during the upsert/commit — into a single `CONDUCTOR_DB:` warning + `return`; (2) the top-level `main().then(() => process.exit(0)).catch(...)` is the final backstop that catches anything escaping `withDb` (e.g. an `ENOSPC` thrown from `resolveRoot`'s incidental I/O) and still `process.exit(0)`s with one warning. So a full disk degrades non-fatally exactly like every other failure; the plan markdown stays authoritative.
- **Every degraded/error message** is a single line on **stderr**, prefixed exactly `CONDUCTOR_DB:` (space after colon).
- **Subcommand matching is strictly case-sensitive.** Only the exact lowercase tokens `record` and `init` dispatch; `RECORD`, `Init`, `ReCoRd`, etc. are **not** normalized — they fall through to the unknown-subcommand branch (one usage line, exit 0, no db), before any arity check. The Step 6 hook always emits lowercase, so this strictness is safe and keeps dispatch deterministic; there is no case-folding of the subcommand token.
- **stdout is ALWAYS empty — on every path, for both subcommands.** Success `record`, success `init`, every degraded path, and every CLI-misuse path all leave stdout completely empty; only stderr ever carries a `CONDUCTOR_DB:` line. The script contains **zero** `console.log` / `process.stdout.write` / bare `console.*`-to-stdout calls — `warn` is the only output function and it writes exclusively to `process.stderr`. This guarantees no downstream markdown orchestrator (the Step 6 hook, a piping caller) ever ingests stray output. A `grep -nE "console\.log|process\.stdout|console\.info" scripts/conductor-db.mjs` must return nothing.
- **`db.close()` runs in a `finally`** before every exit, preceded by an explicit best-effort `PRAGMA wal_checkpoint(TRUNCATE);`, so the `-wal`/`-shm` sidecars are flushed into the main db and truncated on every target filesystem (not all honor the implicit close-time checkpoint) and no lock lingers. Both the checkpoint and the close are guarded (`if (db)` + their own try/catch): the `DatabaseSync` constructor may throw before a handle exists (closing `null` would raise a masking `TypeError`), and a checkpoint failure must never mask the write's own result. **Every exit path closes exactly one handle exactly once, with no leak:** `withDb`'s `finally` closes the handle it received from `openReady`; and `openReady` closes its *own* handle before it rethrows an unexpected error or returns `null` (corruption-recovery, `user_version > 1`) — so a handle that never makes it back to `withDb` is still released. This matters under the test suite's tight spawn loops, where a leaked handle would hold a lock and stall later tests.
- **WAL is best-effort, not mandatory.** `PRAGMA journal_mode = WAL` is wrapped so a network share / virtualized or overlay filesystem that cannot support WAL's shared-memory + byte-range locking never aborts setup: SQLite either silently returns a rollback journal (`delete`/`truncate`) or throws, and in both cases the engine proceeds and works correctly under the default rollback journal (WAL only optimizes concurrency). If such a filesystem instead rejects locking outright and a later read/write throws `SQLITE_IOERR`/`SQLITE_BUSY`, that surfaces in `withDb`'s catch and degrades to warn + exit 0. The `journal_mode = WAL` assertion in tests holds only because the test tmpdir is a local FS; production must not depend on WAL actually being active.
- **`PRAGMA busy_timeout = 2000;` is set immediately on every connection open** (in `openConn`, before the first `PRAGMA user_version` read / `BEGIN IMMEDIATE`), so rapid consecutive Step 6 hook invocations wait up to 2s for a transient lock instead of failing instantly with `SQLITE_BUSY`. This is the first line of defense; the `SQLITE_BUSY` graceful-degradation path remains the backstop if the timeout is exhausted. **Failure boundary:** if the pragma itself throws after a successful open (unexpected operational error), it is non-fatal — `openConn` catches it, emits exactly one `CONDUCTOR_DB: busy_timeout pragma failed, continuing without it` stderr line, and returns the still-usable handle (never leaks or closes it, never aborts the write). The connection then simply relies on the `SQLITE_BUSY` degradation path if contention later occurs.
- **Schema v1 DDL is exact:** `task_state(plan_file TEXT NOT NULL, task_id TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN (' ', '>', 'X', '!')), updated_at TEXT NOT NULL, PRIMARY KEY (plan_file, task_id)) WITHOUT ROWID`. `PRAGMA journal_mode = WAL` runs **outside** the transaction; `PRAGMA user_version = 1` **and** `CREATE TABLE IF NOT EXISTS task_state` run together inside **one explicit `BEGIN IMMEDIATE … COMMIT`** (with `ROLLBACK` on any error). `BEGIN IMMEDIATE` takes the write lock up front, so two Step 6 hooks racing to initialize the same fresh db serialize: one wins the lock and creates the schema atomically, the other blocks (up to `busy_timeout`) then sees a fully-formed v1 schema — never a half-created table or a version/table mismatch. A crash mid-setup leaves either no db or a complete one, never a partial structure. **`PRAGMA user_version = 1` is valid and transactional inside `BEGIN IMMEDIATE`** — unlike `journal_mode` (a file/connection-level switch that cannot change mid-transaction and so runs *outside*), `user_version` writes the database header page, which participates in the transaction: it commits with `COMMIT` and reverts with `ROLLBACK` (empirically confirmed on `node:sqlite`). So pairing it with `CREATE TABLE` in one transaction is both permitted and exactly what makes the version bump and the table appear atomically together.
- **Schema readiness is checked by table presence, not by `user_version` alone.** `openReady` applies the idempotent schema when `ver === 0` **or** when `task_state` is physically absent (`!tableExists(db)`), so an interrupted run that left a version header without the table (or a later `DROP`) self-heals on the next invocation instead of crashing the upsert with "no such table". `ver > 1` still short-circuits to no-write before this check.
- **`state` enum** is exactly the four checkbox states and nothing else — a **closed enumeration, not free text**. The two enforcement layers must hold **character-for-character identical** literals:
  - CLI: `const VALID_STATES = new Set([' ', '>', 'X', '!']);` — a single ASCII space `U+0020`, a greater-than `>`, a capital `X`, an exclamation `!`. Checked as `VALID_STATES.has(state)` *before* binding.
  - SQL: `CHECK (state IN (' ', '>', 'X', '!'))` in the DDL — same four literals, same order.
  Any value outside this set is rejected at the CLI (warn + exit 0, no write); the SQL `CHECK` is the independent backstop. Neither list may drift from the other, and no arbitrary text is ever stored.
  - `VALID_STATES.has(state)` is **exact whole-string equality**, so it inherently rejects any multi-character input (`"XX"`, `"X "`, `">>"`) and the empty string *before* the DB statement runs — a member is a single character, so nothing longer than one char can ever match. No separate `state.length === 1` guard is needed: the Set membership test already short-circuits multi-character and malformed states, and the SQL `CHECK` never sees them.
  - The comparison is **case-sensitive**: the valid state is the uppercase `X` (and `>` / `!` / space), so a lowercase `x` is **not** a member and is rejected. This is intentional — the `cc-implement` checkbox ritual emits canonical uppercase state characters, so casing is fully controlled at the source and there is no auto-uppercasing; a `x`/`X` mismatch signals a malformed caller, not something to silently coerce.
- **All dynamic values are parameter-bound, never string-concatenated.** Every `plan_file`, `task_id`, `state`, and `updated_at` reaches SQLite through `?` placeholders + `stmt.run(...)`; no value is ever interpolated into a SQL string. This guarantees a `plan_file` or `task_id` containing a single quote (e.g. `it's-plan.md`) is stored literally and can never break out of the statement or trigger a syntax/execution panic. Only the static, value-free DDL (the enum `CHECK` literals) appears as inline SQL text.
- **`plan_file` key** = repo-relative POSIX path, resolved relative to the **repository root, never the CWD**: `relative(root, resolve(cwd, plan_file))` first anchors any absolute-or-relative input to a single root-relative form (so the same plan keyed from `/repo` and from `/repo/a/b/c` collapses to one identical row — row identity is independent of the execution working directory), then **every OS path separator converted to `/`** via `.split(sep).join('/')` (on Windows `sep` is `\`, so `docs\plan.md` becomes `docs/plan.md`; on POSIX it is a no-op). This backslash→forward-slash normalization happens **before persistence**, so the same plan recorded on Windows and on POSIX produces one identical key — no duplicate registry rows split by separator style. Redundant consecutive slashes are collapsed (`docs//plan.md` → `docs/plan.md`): `path.resolve`/`relative` already do this, and a trailing `.replace(/\/{2,}/g, '/')` defensively guarantees no `//` is ever persisted (so `docs/plan.md` and `docs//plan.md` cannot become two rows). `task_id` used verbatim after trim.
- **Paths outside the repo root are accepted, not rejected.** If normalization yields a key beginning with `../` (the resolved plan lives outside the root — rare: a plan referenced from a sibling checkout), it is stored **verbatim** as that `../…` POSIX key. It is *not* a rejection case: the plan markdown is still the authoritative record and a best-effort cache row for an out-of-tree plan is harmless. The only rejection criteria for a key are the two universal ones — **empty after trim** and **over 512 chars** — which apply equally to in-tree and out-of-tree keys. Rationale: rejecting on `../` would silently drop legitimate multi-checkout workflows, and the key is only ever a local cache lookup, never a filesystem path the tool dereferences, so an escaping key carries no traversal risk.
- **`task_id` is case-sensitive and stored verbatim** (only `.trim()` is applied — no uppercasing, lowercasing, or case-folding). The 4-state plan ritual already generates canonical uppercase IDs (`[T-001]`, `[T-001-A]`), so case collisions do not arise in practice; imposing case-insensitivity would be *wrong* — it would silently merge two IDs the plan format treats as distinct. `T-001` and `t-001` therefore key to two different rows by design, not by defect.
- **Args validation order is trim → empty-check → length-check, all on the trimmed value.** `validateKey` computes `const v = String(x ?? '').trim()` **first**, then rejects if `v` is empty, then rejects if `v.length > 512`. So the 512-char cap measures the **trimmed** length — surrounding whitespace is stripped before the guard and never counts toward the limit (e.g. `"  " + 511·'a' + "  "` trims to 511 and passes). For `plan_file` the pipeline is normalize → then `validateKey` (trim + checks), so the cap applies post-normalization *and* post-trim. Over-cap is **rejected, not truncated** (truncation would corrupt the key). The 512 limit is measured with JavaScript `String.prototype.length` — **UTF-16 code units, not UTF-8 bytes** — so a multi-byte character counts as 1 code unit (or 2 for an astral/surrogate-pair codepoint), never its byte length. This is deliberate: the cap is a coarse hygiene bound to reject absurd inputs, not a storage-byte guarantee, and `node:sqlite` binds any length safely regardless. Both the CLI check and any documentation state the unit explicitly as code units to avoid a bytes-vs-chars ambiguity.
- **`updated_at` is an ISO-8601 UTC *string*, not a Unix epoch integer.** The schema column is `TEXT` affinity and the value constructor is exactly `new Date().toISOString()` → `YYYY-MM-DDTHH:MM:SS.sssZ` (full millisecond precision, always `Z`, matching `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/`). It is written at script runtime, never derived from the plan file's filesystem mtime. Column type and value form must stay aligned: if one ever changes to epoch millis, both must — but v1 is fixed as the ISO string. **`updated_at` reflects the recording host's system clock and guarantees no strict cross-environment ordering.** Within one machine it is effectively monotonic at millisecond resolution (good enough to order rapid `[>]`→`[X]` transitions), but if hooks run across machines/containers with unsynchronized clocks, a later real-world event can carry an earlier timestamp. It is a best-effort "when this host recorded the transition" marker, **not** a distributed causal-ordering primitive; no consumer may rely on it for cross-host sequencing. This is acceptable in scope — the store is a single-developer local cache, and the plan markdown remains the authoritative ordered record.
- **`.conductor` squatting as a regular file is resolved structurally, not fatally.** Two distinct non-directory-in-the-way cases exist and both rename aside (never delete): (1) the **directory path** `.conductor` already exists as a regular file → `withDb` detects `!statSync(dir).isDirectory()` before `mkdirSync`, moves the file aside via `backupAside` (`.conductor.corrupt.<ts>`), then creates the directory; (2) the **db path** `.conductor/cache.db` exists as a directory/non-regular file → `openReady`'s pre-open guard (T-008) moves it aside. If the aside-move fails in either case, warn + exit 0. The error boundary is: a non-directory where a directory is expected is repaired by rename, and only an *unrecoverable* rename/permission failure degrades to no-write.
- **Missing OS write permission is non-fatal and explicitly logged.** Root *resolution* never writes (git exec failures are caught; `existsSync` returns `false` rather than throwing on a permission-denied ancestor; the script-dir fallback is pure computation), so it cannot fail on permissions. The write boundaries are two, each caught and logged before `exit 0`:
  - `mkdirSync('.conductor')` denied → `CONDUCTOR_DB: cannot create <dir>: EACCES, skipping cache write` (the mkdir try/catch in `withDb`).
  - Opening/writing `cache.db` denied (EACCES/EPERM, not a corruption code) → re-thrown from `openReady`, caught by `withDb`'s outer catch → `CONDUCTOR_DB: EACCES writing <dbPath>: <message>, skipping cache write`.
  Both name the offending path, emit exactly one stderr line, write nothing, and exit 0; a read-only environment degrades cleanly and the plan file stays authoritative.
- **`.conductor/` created via `mkdirSync(dir, { recursive: true })` — always with `recursive: true`.** Recursive mode makes creation idempotent (a pre-existing directory is a no-op, not an `EEXIST` throw) and materializes any missing parent segments, so nested or unusual execution topologies (deep roots, first run, concurrent creation) are all handled cleanly. Never call the non-recursive form.
- **Corrupt/non-regular file at the db path** is renamed aside to `cache.db.corrupt.<ts>` (`<ts>` = `toISOString().replace(/[-:.]/g,'')`, colon-free), numeric `.1`–`.100` suffix on collision. The rename-fail fallback is **type-aware**: a regular file → `unlinkSync`; a **directory → give up (warn + exit 0), never `unlinkSync` (EISDIR/EPERM), never `rmdirSync`, never `rm -r`**. Rename itself (the preferred path) already moves a directory aside with its contents intact. **Whenever the main db file is cleared, its `-wal` and `-shm` sidecars are also best-effort unlinked** (`clearSidecars`): a stale sidecar whose header no longer matches the freshly created db can panic the next connection open, so the fresh db must start against a clean slate.
- **`user_version > 1`** → warn + exit 0, no write, and crucially **no recovery** (forward-compat, never downgrade). A future schema (v2, v3, …) written by a newer conductor-db is a *valid, well-formed* SQLite file: reading `PRAGMA user_version` succeeds and returns e.g. `2`, so the `ver > 1` branch runs and returns `null` **before** any recovery code. Recovery (`backupAside`/recreate) only ever fires on a *thrown* malformed-image error, which a newer-but-valid db never raises — so a forward-version db is never renamed aside, unlinked, or recreated. The distinction is explicit: newer-version ≠ corrupt. This holds for any `ver` value `> 1`, not just `2`.
- **Both `cc-implement.md` mirrors** (`.claude/commands/` and `project-template/.claude/commands/`) are edited identically and surgically (BUG-003 invariant — one region, no bulk rewrite).
- **`npm test` stays flag-free.** Tests spawn `conductor-db.mjs` as a child (`spawnSync`) and the test helper adds `--experimental-sqlite --no-warnings` itself when the runner's Node is `>= 22.5`, mirroring the hook. `--no-warnings` suppresses Node's `ExperimentalWarning` for `node:sqlite` (emitted on 22.5–22.x) so the suite's exact-stderr assertions hold on every Node line; it never suppresses the recorder's own `CONDUCTOR_DB:` output (direct `process.stderr` writes, not process warnings).
- **Release closeout is gated last:** only after the full suite is green — assert VERSION + package.json are at `1.18.0`, then bump both to `1.19.0` and add a `CHANGELOG` `[1.19.0]` entry tagged `[FEAT-005]` with a `date +%F` date.

---

## File Structure

- **`scripts/conductor-db.mjs`** (create) — the entire engine. Single file: arg dispatch, root resolution, `.conductor/` creation, db open/repair, schema v1, upsert, graceful-degradation matrix.
- **`tests/scripts/conductor-db.test.js`** (create) — Vitest suite; drives the script as a child process; owns temp-dir + `-wal`/`-shm` cleanup.
- **`tests/scripts/fixtures/block-sqlite.mjs`** (create) — `--import` loader that makes `import('node:sqlite')` reject, so the absent-`node:sqlite` degradation path is testable on a Node that has sqlite.
- **`.claude/commands/cc-implement.md`** (modify — the `### Step 6: Hook` region) — Step 6 hook body. Locate by heading anchor, never by line number (line numbers drift across cycles).
- **`project-template/.claude/commands/cc-implement.md`** (modify — the `### Step 6: Hook` region) — identical mirror.
- **`.gitignore`** (modify) — add `.conductor/`.
- **`VERSION`, `package.json`, `CHANGELOG.md`** (modify) — release closeout to 1.19.0.
- **`AGENT-READABLE BACKLOG.md`** (modify) — mark `[FEAT-005]` `[X]` (and `[FEAT-013]`, shipped 1.18.0 but still unchecked).

---

## Task 1: Engine skeleton — record happy path, schema v1, upsert

**Files:**
- Create: `scripts/conductor-db.mjs`
- Create: `tests/scripts/conductor-db.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Produces: CLI `node scripts/conductor-db.mjs record <plan_file> <task_id> <state>` and `init`. Internal functions later tasks extend: `resolveRoot()`, `withDb(root, fn)`, `openConn(DatabaseSync, dbPath)`, `openReady(DatabaseSync, dbPath)`, `applySchema(db)`, `tableExists(db)`, `upsert(db, planFile, taskId, state)`, `normalizePlanFile(planFile, root)`, `validateKey(name, value)`, `warn(msg)`, `cmdRecord(args)`, `cmdInit(args)`, `main()`.
- Produces (test helper): `runDb(args, { cwd, env }) -> { status, stdout, stderr }` and `readRows(dbPath) -> Array<{plan_file,task_id,state,updated_at}>` in the test file.

**Scope reconciliation (read before implementing).** The plan header's Architecture paragraph describes the *finished* engine — git → `.git`-walk → script-dir root resolution, and corrupt/non-regular-file repair. Task 1 deliberately implements **only the happy path**: git-only `resolveRoot` (no fallbacks) and a bare `openReady` (no repair). This is intentional TDD staging, not an omission — each deferred capability arrives with its own red→green test so no later test is dead-on-arrival:

| Deferred capability | Lands in |
|---------------------|----------|
| `.git`-walk + script-dir root fallbacks | T-005 |
| `import('node:sqlite')` degradation      | T-006 |
| Corrupt-db backup + recreate ladder      | T-007 |
| Non-regular-file-at-path handling        | T-008 |
| `user_version > 1` forward-compat        | T-009 |

An implementer executing tasks out of order must not "helpfully" pre-add these to Task 1 — doing so turns the later tasks' Step 2 (verify-it-fails) green and breaks the TDD contract.

- [ ] **[T-001] Step 1: Add `.conductor/` to `.gitignore`**

Append one line so dev-time db writes are never committed. `.gitignore` currently ends at `.claude/memory/session-snapshot.json` (line 16). Add:

```
.conductor/
```

- [ ] **[T-001] Step 2: Write the failing test (happy path + upsert)**

Create `tests/scripts/conductor-db.test.js`:

```js
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
```

- [ ] **[T-001] Step 3: Run the test, verify it fails**

Run: `npm test -- tests/scripts/conductor-db.test.js`
Expected: FAIL — the script file does not exist yet (child exits non-zero / `Cannot find module`).

- [ ] **[T-001] Step 4: Write the minimal implementation**

Create `scripts/conductor-db.mjs`:

```js
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
```

- [ ] **[T-001] Step 5: Run the test, verify it passes**

Run: `npm test -- tests/scripts/conductor-db.test.js`
Expected: PASS (4 tests in the happy-path block; the suite skips entirely if `HAS_SQLITE` is false).

- [ ] **[T-001] Step 6: Commit**

```bash
git add scripts/conductor-db.mjs tests/scripts/conductor-db.test.js .gitignore
git commit -m "feat(FEAT-005): conductor-db engine skeleton — record happy path + schema v1"
```

Note: the full `npm test` suite has no red tests here (this is the first green feature commit), so the pre-commit test-gate passes normally — no `--no-verify` needed.

---

## Task 2: Argument validation — state enum, empty/whitespace, length cap

**Files:**
- Modify: `scripts/conductor-db.mjs`
- Modify: `tests/scripts/conductor-db.test.js`

**Interfaces:**
- Consumes: `cmdRecord`, `normalizePlanFile`, `warn` from Task 1.
- Produces: `validateKey(name, value) -> string | null`; `VALID_STATES` set; `MAX_KEY_LEN = 512`; `USAGE` string. `cmdRecord` now rejects bad input before any db work.

- [ ] **[T-002] Step 1: Write the failing tests**

Append to `tests/scripts/conductor-db.test.js`:

```js
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
```

- [ ] **[T-002] Step 2: Run the tests, verify they fail**

Run: `npm test -- tests/scripts/conductor-db.test.js -t "input validation"`
Expected: FAIL — Task 1 has no CLI validation; the enum case surfaces a raw SQL `CHECK` error (wrong message / possibly a created db), the whitespace case stores `'   '`, over-length stores 600 chars, and the trim case stores `'  T-007  '`.

- [ ] **[T-002] Step 3: Write the implementation**

In `scripts/conductor-db.mjs`, add constants below `warn`:

```js
const VALID_STATES = new Set([' ', '>', 'X', '!']);
const MAX_KEY_LEN = 512;
const USAGE = "usage: conductor-db.mjs record <plan_file> <task_id> <state> | init";

function validateKey(name, value) {
  const v = String(value ?? '').trim();       // 1. trim FIRST (whitespace never counts)
  if (!v) { warn(`${name} is empty; ${USAGE}`); return null; }        // 2. empty-check on trimmed
  if (v.length > MAX_KEY_LEN) { warn(`${name} exceeds ${MAX_KEY_LEN} chars; rejected`); return null; }  // 3. length-check on trimmed
  return v;
}
```

Replace `cmdRecord` with:

```js
async function cmdRecord(args) {
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
```

**No literal `"undefined"` may ever be stored or validated.** A missing positional is `undefined`, and `String(undefined)` is the seven-character string `"undefined"` — which would silently pass a naive non-empty check and land in the database as a real key/value. Two guards prevent this, and both must be present:

1. **Coercion via `?? ''`, never bare `String(x)`.** Every raw arg is funneled through `?? ''` before coercion (`validateKey` does `String(value ?? '').trim()`; `state` uses `String(rawState ?? '')`). An absent positional therefore becomes `''`, which the empty-string check (T-002) and the `VALID_STATES` check reject — it never becomes `"undefined"`.
2. **Arg-count gate (added in T-003).** `cmdRecord` rejects any `args.length !== 3` up front, so a short `record` never reaches coercion at all. This is the primary defense; the `?? ''` coercion is the belt-and-suspenders backstop for the window before T-003 lands and for any future caller that bypasses the gate.

Never write `String(rawPlan)` / `String(rawTask)` / `String(rawState)` without the `?? ''`. A grep for `String(raw` in the finished script must show `?? ''` on every hit.

- [ ] **[T-002] Step 4: Run the tests, verify they pass**

Run: `npm test -- tests/scripts/conductor-db.test.js -t "input validation"`
Expected: PASS (4 tests).

- [ ] **[T-002] Step 5: Commit**

```bash
git add scripts/conductor-db.mjs tests/scripts/conductor-db.test.js
git commit -m "feat(FEAT-005): validate state enum, empty args, 512-char cap"
```

---

## Task 3: CLI discipline — unknown subcommand, arg count, silent init

**Files:**
- Modify: `scripts/conductor-db.mjs`
- Modify: `tests/scripts/conductor-db.test.js`

**Interfaces:**
- Consumes: `cmdRecord`, `cmdInit`, `warn`, `USAGE`, `withDb` from Tasks 1–2.
- Produces: `main` rejects unknown subcommands; `cmdRecord` enforces exactly 3 args; `cmdInit` enforces 0 args and stays silent on success.

- [ ] **[T-003] Step 1: Write the failing tests**

Append to `tests/scripts/conductor-db.test.js`:

```js
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
```

- [ ] **[T-003] Step 2: Run the tests, verify they fail**

Run: `npm test -- tests/scripts/conductor-db.test.js -t "CLI discipline"`
Expected: FAIL — Task 1's `main`/`cmdRecord`/`cmdInit` do not warn on unknown subcommand, do not count args, and `record plan.md` throws inside `resolveRoot`/normalize before any guard.

- [ ] **[T-003] Step 3: Write the implementation**

In `scripts/conductor-db.mjs`, add an arg-count guard at the top of `cmdRecord` (first line inside the function):

```js
  if (args.length !== 3) { warn(USAGE); return; }
```

**`record` is a strict exact-arity gate, symmetric with `init`.** The check is `!== 3`, not `< 3`, so it rejects **both** too few **and** too many positionals — a fourth trailing argument (`record plan.md T-001 X extra`) is a hard reject-with-usage, never silently ignored. This runs as the first statement, before `resolveRoot()`/`normalizePlanFile()`/`withDb()`, so a malformed `record` opens no db and creates no `.conductor/` directory — exactly the layout `cmdInit`'s `args.length !== 0` gate establishes. Neither subcommand ever tolerates extra trailing parameters.

Replace `cmdInit` with:

```js
async function cmdInit(args) {
  if (args.length !== 0) { warn(USAGE); return; }
  const root = resolveRoot();
  await withDb(root, () => { /* create/verify only */ });
}
```

**Exact contract for `init` with trailing/unexpected parameters.** `init` takes **zero** positionals. Any trailing argument (`init oops`, `init --force`, `init a b`) is rejected by the `args.length !== 0` guard, which runs **before** `resolveRoot()`/`withDb()` — so no repo resolution, no `.conductor/` directory, and no db are created. It emits exactly this one stderr line and exits 0:

```
CONDUCTOR_DB: usage: conductor-db.mjs record <plan_file> <task_id> <state> | init
```

There is no partial-init side effect and no "ignore the extras and proceed" behavior: unexpected parameters are always a hard reject-with-usage, mirroring `record`'s `args.length !== 3` gate.

Replace `main` with:

```js
async function main() {
  const [sub, ...rest] = process.argv.slice(2);
  if (sub === 'record') return cmdRecord(rest);
  if (sub === 'init') return cmdInit(rest);
  warn(`unknown subcommand ${JSON.stringify(sub ?? '')}; ${USAGE}`);
}
```

**Exact contract for an invalid/unknown subcommand.** Any `argv[2]` that is not `record` or `init` — including a missing subcommand (`undefined`) and a stray leading flag like `--help` — takes this single branch. It emits exactly one line on **stderr** and nothing on stdout, then `main().then(process.exit(0))` exits 0:

```
CONDUCTOR_DB: unknown subcommand "<token>"; usage: conductor-db.mjs record <plan_file> <task_id> <state> | init
```

`<token>` is `JSON.stringify(sub ?? '')`, so it is always double-quoted (an absent subcommand renders as `""`). No database is opened or created on this path — `resolveRoot`/`withDb` are never reached. This is the same exit-0, one-`CONDUCTOR_DB:`-line discipline every other degraded path follows.

- [ ] **[T-003] Step 4: Run the tests, verify they pass**

Run: `npm test -- tests/scripts/conductor-db.test.js -t "CLI discipline"`
Expected: PASS (5 tests).

- [ ] **[T-003] Step 5: Commit**

```bash
git add scripts/conductor-db.mjs tests/scripts/conductor-db.test.js
git commit -m "feat(FEAT-005): CLI discipline — unknown subcommand, arg count, silent init"
```

---

## Task 4: `plan_file` normalization — dedup across CWDs

**Files:**
- Modify: `tests/scripts/conductor-db.test.js`

**Interfaces:**
- Consumes: `normalizePlanFile` (already introduced in Task 1 and used by `cmdRecord`). This task adds the dedup **proof** test. `normalizePlanFile` already produces a repo-relative POSIX key, so this test locks in the behavior against regression.

- [ ] **[T-004] Step 1: Write the failing test**

Append to `tests/scripts/conductor-db.test.js`:

```js
import { mkdirSync } from 'node:fs';

describe.skipIf(!HAS_SQLITE)('conductor-db plan_file normalization', () => {
  const dbPath = () => join(repo, '.conductor', 'cache.db');

  it('same plan from two different CWDs yields exactly one row', async () => {
    const nested = join(repo, 'a', 'b', 'c');
    mkdirSync(nested, { recursive: true });
    const plan = join(repo, 'docs', 'plan.md');

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
```

- [ ] **[T-004] Step 2: Run the test, verify it passes (guard against silent regression)**

Run: `npm test -- tests/scripts/conductor-db.test.js -t "normalization"`
Expected: PASS — `normalizePlanFile` (Task 1) already normalizes to a repo-relative POSIX key, so both invocations collapse to `docs/plan.md`. If this test *fails*, `normalizePlanFile` was broken by an earlier edit; fix it before continuing.

(This task has no red→green code delta: normalization is intrinsic to the key. The test exists because the dedup property is an explicit acceptance criterion and must be pinned.)

- [ ] **[T-004] Step 3: Commit**

```bash
git add tests/scripts/conductor-db.test.js
git commit -m "test(FEAT-005): pin plan_file repo-relative dedup across CWDs"
```

---

## Task 5: Root resolution fallbacks — `.git` walk and script-dir

**Files:**
- Modify: `scripts/conductor-db.mjs`
- Modify: `tests/scripts/conductor-db.test.js`

**Interfaces:**
- Consumes: `resolveRoot` from Task 1 (git-only).
- Produces: `resolveRoot()` gains Fallback A (bounded `.git` walk, `WALK_CAP = 40`) and Fallback B (script-dir `../`). `existsSync`, `dirname`, `fileURLToPath` imported.

- [ ] **[T-005] Step 1: Write the failing tests**

Append to `tests/scripts/conductor-db.test.js`. These force `git` to fail by launching the child with an empty `PATH` (node itself is spawned by absolute `process.execPath`, so it still runs; the script's `execFileSync('git', …)` gets ENOENT and falls through):

```js
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
```

- [ ] **[T-005] Step 2: Run the tests, verify they fail**

Run: `npm test -- tests/scripts/conductor-db.test.js -t "root resolution"`
Expected: FAIL — Task 1's `resolveRoot` calls `execFileSync('git', …)`; with `PATH=''` that throws ENOENT and is **unhandled**, so the child hits `main().catch` (exit 0) but writes no db — the `existsSync` assertions fail.

- [ ] **[T-005] Step 3: Write the implementation**

In `scripts/conductor-db.mjs`, extend the imports:

```js
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
```

Add the cap constant near the other constants:

```js
const WALK_CAP = 40;
```

Replace `resolveRoot` with:

```js
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
```

- [ ] **[T-005] Step 4: Run the tests, verify they pass**

Run: `npm test -- tests/scripts/conductor-db.test.js -t "root resolution"`
Expected: PASS (2 tests). Re-run the full file to confirm no regression: `npm test -- tests/scripts/conductor-db.test.js`.

- [ ] **[T-005] Step 5: Commit**

```bash
git add scripts/conductor-db.mjs tests/scripts/conductor-db.test.js
git commit -m "feat(FEAT-005): root resolution fallbacks — .git walk + script-dir"
```

---

## Task 6: Graceful degradation when `node:sqlite` is unavailable

**Files:**
- Modify: `scripts/conductor-db.mjs`
- Create: `tests/scripts/fixtures/block-sqlite.mjs`
- Modify: `tests/scripts/conductor-db.test.js`

**Interfaces:**
- Consumes: `withDb` from Task 1.
- Produces: `withDb` wraps `import('node:sqlite')` in try/catch and warns `node:sqlite unavailable, skipping cache write` on failure. Test fixture forces that failure on a sqlite-capable Node.

- [ ] **[T-006] Step 1: Create the loader fixture**

Create `tests/scripts/fixtures/block-sqlite.mjs` — a module-customization loader that makes `import('node:sqlite')` reject, so the absent-sqlite branch is reachable on Node 26:

```js
// Registered via `node --import`. Makes any resolve of node:sqlite fail so the
// conductor-db degradation path can be exercised on a Node that ships sqlite.
import { register } from 'node:module';
register(new URL('./block-sqlite-hooks.mjs', import.meta.url));
```

Create `tests/scripts/fixtures/block-sqlite-hooks.mjs`:

```js
export async function resolve(specifier, context, next) {
  if (specifier === 'node:sqlite' || specifier === 'sqlite') {
    const err = new Error("Cannot find module 'node:sqlite'");
    err.code = 'ERR_MODULE_NOT_FOUND';
    throw err;
  }
  return next(specifier, context);
}
```

- [ ] **[T-006] Step 2: Write the failing test**

Append to `tests/scripts/conductor-db.test.js`:

```js
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
    expect(existsSync(join(repo, '.conductor', 'cache.db'))).toBe(false);
  });
});
```

- [ ] **[T-006] Step 3: Run the test, verify it fails**

Run: `npm test -- tests/scripts/conductor-db.test.js -t "node:sqlite unavailable"`
Expected: FAIL — Task 1's `withDb` calls `await import('node:sqlite')` with no try/catch; with the blocker registered it rejects, bubbles to `main().catch`, which prints `unexpected: …` (wrong message, wrong shape).

- [ ] **[T-006] Step 4: Write the implementation**

In `scripts/conductor-db.mjs`, replace the first two lines of `withDb` (the import) so the failure is caught:

```js
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
  mkdirSync(dir, { recursive: true });
  let db = null;
  try {
    db = openReady(DatabaseSync, dbPath);
    fn(db);
  } finally {
    if (db) { try { db.close(); } catch { /* ignore */ } }
  }
}
```

- [ ] **[T-006] Step 5: Run the test, verify it passes**

Run: `npm test -- tests/scripts/conductor-db.test.js -t "node:sqlite unavailable"`
Expected: PASS (1 test).

- [ ] **[T-006] Step 6: Commit**

```bash
git add scripts/conductor-db.mjs tests/scripts/fixtures/block-sqlite.mjs tests/scripts/fixtures/block-sqlite-hooks.mjs tests/scripts/conductor-db.test.js
git commit -m "feat(FEAT-005): graceful degradation when node:sqlite is unavailable"
```

---

## Task 7: Corrupt-db recovery + rename-fail ladder

**Files:**
- Modify: `scripts/conductor-db.mjs`
- Modify: `tests/scripts/conductor-db.test.js`

**Interfaces:**
- Consumes: `openReady`, `applySchema`, `withDb`, `warn` from earlier tasks.
- Produces: `compactStamp()`, `backupAside(path) -> boolean`, `isCorruptionError(e) -> boolean`; `openReady` now moves a corrupt db aside and recreates; `withDb` catches residual write failures (`SQLITE_BUSY`, permission) → warn + exit 0.

- [ ] **[T-007] Step 1: Write the failing tests**

Append to `tests/scripts/conductor-db.test.js`:

```js
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
```

- [ ] **[T-007] Step 2: Run the tests, verify they fail**

Run: `npm test -- tests/scripts/conductor-db.test.js -t "corrupt-db recovery"`
Expected: FAIL — Task 1's `openReady` runs `PRAGMA user_version` on the garbage file, which throws `SQLITE_NOTADB`; unhandled, the child exits 0 (via `main().catch`) but leaves the corrupt file in place and writes no row, so no backup exists and `readRows` finds an unreadable db.

- [ ] **[T-007] Step 3: Write the implementation**

In `scripts/conductor-db.mjs`, add `renameSync, unlinkSync, statSync` to the fs import and add these helpers above `openReady`:

```js
import { mkdirSync, existsSync, renameSync, unlinkSync, statSync } from 'node:fs';
```

```js
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
```

Replace `openReady` with:

```js
function openReady(DatabaseSync, dbPath) {
  let db;
  try {
    db = openConn(DatabaseSync, dbPath);
    const ver = db.prepare('PRAGMA user_version').get().user_version;   // first I/O
    if (ver === 0 || !tableExists(db)) applySchema(db);
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
```

Replace `withDb` so a null `openReady` result and residual write errors both degrade cleanly:

```js
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
    fn(db);
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
```

**`finally` must guard `db.close()` — the handle may never have been created.** In `withDb`, `db` is initialized to `null` and only assigned from `openReady()`'s return value. If the `DatabaseSync` constructor throws (locked file, ENOENT race, unopenable path), `openReady` either returns `null` (recovery gave up) or throws — in both cases the assignment `db = openReady(...)` leaves `db` as `null`, never a half-built handle. The `finally` therefore **must** gate on `if (db)` before calling `db.close()`; calling `.close()` on `null`/`undefined` would raise a `TypeError` that masks the original failure. The same `if (db)` guard applies to `openReady`'s internal cleanup (`try { if (db) db.close(); } catch {}` on the corruption branch, where `db` is `undefined` if the first constructor threw). Never write an unguarded `db.close()` anywhere in this script; every close site is `if (db) { try { db.close(); } catch { /* ignore */ } }` or equivalent. A `grep -n "\.close()" scripts/conductor-db.mjs` must show every hit fronted by an `if (db)`/`if (...db)` guard or inside its own try/catch.

- [ ] **[T-007] Step 4: Run the tests, verify they pass**

Run: `npm test -- tests/scripts/conductor-db.test.js -t "corrupt-db recovery"`
Expected: PASS (2 tests; the read-only case self-skips where `chmod` is a no-op). Re-run the full file to confirm no regression.

- [ ] **[T-007] Step 5: Commit**

```bash
git add scripts/conductor-db.mjs tests/scripts/conductor-db.test.js
git commit -m "feat(FEAT-005): corrupt-db recovery + rename/unlink degradation ladder"
```

---

## Task 8: Non-regular file at the db path

**Files:**
- Modify: `scripts/conductor-db.mjs`
- Modify: `tests/scripts/conductor-db.test.js`

**Interfaces:**
- Consumes: `backupAside`, `openReady`, `statSync` from earlier tasks.
- Produces: a pre-open `statSync` guard in `openReady` that renames a directory (or other non-regular file) aside before opening — never `rm -r`.

- [ ] **[T-008] Step 1: Write the failing test**

Append to `tests/scripts/conductor-db.test.js`:

```js
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
```

- [ ] **[T-008] Step 2: Run the test, verify it fails**

Run: `npm test -- tests/scripts/conductor-db.test.js -t "non-regular file"`
Expected: FAIL — Task 7's `openReady` calls `new DatabaseSync(<dir>)`; opening a directory as a db throws an error that is not a corruption error, so it re-throws → caught by `withDb` as a generic write error → no backup, no fresh db.

- [ ] **[T-008] Step 3: Write the implementation**

`statSync` is already imported (added in T-007 for `backupAside`); confirm the fs import reads `import { mkdirSync, existsSync, renameSync, unlinkSync, statSync } from 'node:fs';` and do not duplicate it.

Add a pre-open guard as the first statements inside `openReady` (before `new DatabaseSync`):

```js
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
    const ver = db.prepare('PRAGMA user_version').get().user_version;
    if (ver === 0 || !tableExists(db)) applySchema(db);
    return db;
  } catch (e) {
    // Close the (possibly half-usable) handle BEFORE any rethrow or return so
    // no path — corruption OR an unexpected non-corruption error — leaks it.
    try { if (db) db.close(); } catch { /* ignore */ }
    if (!isCorruptionError(e)) throw e;
    if (!backupAside(dbPath)) return null;
    db = openConn(DatabaseSync, dbPath);
    applySchema(db);
    return db;
  }
}
```

- [ ] **[T-008] Step 4: Run the test, verify it passes**

Run: `npm test -- tests/scripts/conductor-db.test.js -t "non-regular file"`
Expected: PASS (1 test).

- [ ] **[T-008] Step 5: Commit**

```bash
git add scripts/conductor-db.mjs tests/scripts/conductor-db.test.js
git commit -m "feat(FEAT-005): move a non-regular file at db path aside, never rm -r"
```

---

## Task 9: `user_version > 1` forward-compat no-write

**Files:**
- Modify: `scripts/conductor-db.mjs`
- Modify: `tests/scripts/conductor-db.test.js`

**Interfaces:**
- Consumes: `openReady`, `warn` from earlier tasks.
- Produces: `openReady` returns `null` (no write) when the existing db's `user_version > 1`, emitting the newer-schema warning.

- [ ] **[T-009] Step 1: Write the failing test**

Append to `tests/scripts/conductor-db.test.js`:

```js
describe.skipIf(!HAS_SQLITE)('conductor-db forward compatibility', () => {
  const dbPath = () => join(repo, '.conductor', 'cache.db');

  it('does not write or downgrade a db whose user_version is newer than v1', async () => {
    // Simulate a post-ARCH-008 db: valid sqlite file, user_version = 2, no task_state table.
    const { DatabaseSync } = await import('node:sqlite');
    mkdirSync(join(repo, '.conductor'), { recursive: true });
    const seed = new DatabaseSync(dbPath());
    seed.exec('PRAGMA user_version = 2;');
    seed.close();

    const r = runDb(['record', 'plan.md', 'T-001', 'X'], { cwd: repo });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('CONDUCTOR_DB:');
    expect(r.stderr.toLowerCase()).toContain('newer');

    const check = new DatabaseSync(dbPath());
    try {
      expect(check.prepare('PRAGMA user_version').get().user_version).toBe(2);   // not downgraded
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
```

- [ ] **[T-009] Step 2: Run the test, verify it fails**

Run: `npm test -- tests/scripts/conductor-db.test.js -t "forward compatibility"`
Expected: FAIL — Task 8's `openReady` only special-cases `ver === 0`; for `ver === 2` it skips schema but returns the open db, so `upsert` runs against a table that does not exist and throws (caught as a generic write error with the wrong message), and the newer-schema warning is absent.

- [ ] **[T-009] Step 3: Write the implementation**

In `scripts/conductor-db.mjs`, update the version branch inside `openReady` (the `try` block) to gate on `> 1`:

```js
  let db;
  try {
    db = openConn(DatabaseSync, dbPath);
    const ver = db.prepare('PRAGMA user_version').get().user_version;
    if (ver > 1) {
      warn(`db schema v${ver} newer than supported v1, skipping cache write`);
      db.close();
      return null;
    }
    if (ver === 0 || !tableExists(db)) applySchema(db);
    return db;
  } catch (e) {
```

- [ ] **[T-009] Step 4: Run the test, verify it passes**

Run: `npm test -- tests/scripts/conductor-db.test.js -t "forward compatibility"`
Expected: PASS (1 test). Then run the entire suite to confirm the engine is fully green: `npm test`.
Expected: all suites PASS.

- [ ] **[T-009] Step 5: Commit**

```bash
git add scripts/conductor-db.mjs tests/scripts/conductor-db.test.js
git commit -m "feat(FEAT-005): forward-compat — never downgrade or write a newer-schema db"
```

---

## Task 10: Wire the `cc-implement` Step 6 hook (both mirrors)

**Files:**
- Modify: `.claude/commands/cc-implement.md` — the `### Step 6: Hook` region (locate by anchor)
- Modify: `project-template/.claude/commands/cc-implement.md` — same region, identical mirror

**Interfaces:**
- Consumes: `scripts/conductor-db.mjs record <plan_file> <task_id> <state>` CLI from Tasks 1–9.
- Produces: a version-gated hook that invokes the recorder. Both files are byte-identical at Step 6; apply the same `Edit` to each.

**Do not use line numbers.** These command files are edited every cycle, so any hardcoded line range drifts. Locate the region by its heading text (`### Step 6: Hook`) and match the exact paragraph below as the `Edit` `old_string`. Because that paragraph string is unique within the file, the `Edit` tool anchors correctly regardless of where the section currently sits.

- [ ] **[T-010] Step 1: Replace the Step 6 body in the live command**

First locate the region without assuming a position:

Run: `grep -n "### Step 6: Hook" .claude/commands/cc-implement.md`
Expected: exactly one match (note the line for the verification step; do not hardcode it into the edit).

Use `Edit` (surgical, one region) with this exact `old_string` — the current paragraph that follows the heading:

```markdown
### Step 6: Hook

Runs after both success (`[X]`) and failure (`[!]`) paths. If `.conductor/cache.db` exists, attempt to record task ID + final state + timestamp. If the write fails for any reason, log a non-fatal warning and continue. The plan file is the authoritative state record.
```

Replace it with:

```markdown
### Step 6: Hook

Runs after both success (`[X]`) and failure (`[!]`) paths. Record the task's final state to the local cache, best-effort:

1. Probe `node --version`. If it is missing or below `22.5.0`, skip the cache write (the `node:sqlite` engine needs `>= 22.5`); the plan file remains authoritative.
2. Decide how to launch so that an unrecognized flag can never fatally abort Node at startup. Probe with throwaway children, in order:
   a. **No flag first:** run `node --no-warnings -e "require('node:sqlite')"`. Exit 0 means `node:sqlite` is stable on this Node — launch the recorder **without** `--experimental-sqlite`.
   b. **Flag second:** else run `node --experimental-sqlite --no-warnings -e "require('node:sqlite')"`. Exit 0 means the flag is needed and recognized — launch the recorder **with** `--experimental-sqlite --no-warnings`.
   c. **Neither:** else skip the cache write. Both a too-old Node and a future Node that removed/renamed the flag land here.

   Each probe is a disposable child; a non-zero exit — including a fatal `bad option: --experimental-sqlite` from a Node that does not recognize the flag — is caught and simply advances to the next branch. The fatal startup error is therefore always contained inside a probe whose failure is expected; it never propagates and never aborts the hook.
3. Launch the chosen form, from the repo root, with the active plan file path, the task ID, and the just-written state character (`X` or `!`):

   `node <chosen-flags> scripts/conductor-db.mjs record "<plan_file>" "<task_id>" "<state>"`

   All three arguments **must** be wrapped in double quotes exactly as shown. A repository path can contain spaces (e.g. `/Users/me/My Projects/repo/docs/plan.md`); unquoted, the shell word-splits it into several argv entries and the recorder sees `!== 3` positionals, silently rejecting a legitimate write. `--no-warnings` (in both probe and launch) suppresses Node's `ExperimentalWarning: SQLite is an experimental feature` line so it never pollutes hook stderr; it does not affect the recorder's own `CONDUCTOR_DB:` diagnostics (those are direct `process.stderr` writes, not process warnings).

   The recorder self-initializes `.conductor/cache.db`, upserts the row, and exits 0 on every path. If the launch fails for any reason (permission error, unexpected abort), it is non-fatal: log a warning and continue. The plan file is the authoritative state record.
```

- [ ] **[T-010] Step 2: Verify the live edit landed (anchor-based, no line numbers)**

Run: `awk '/^### Step 6: Hook$/{f=1} f{print} /^### Repeat from Step 1\.$/{exit}' .claude/commands/cc-implement.md`
Expected: prints the new numbered hook body, starting at `### Step 6: Hook` and ending at `### Repeat from Step 1.`; the `conductor-db.mjs record` invocation and the `>= 22.5.0` gate are present.

- [ ] **[T-010] Step 3: Apply the identical replacement to the template mirror**

Repeat the exact same `Edit` on `project-template/.claude/commands/cc-implement.md` — locate the `### Step 6: Hook` region by heading anchor (same original paragraph, same replacement). Do not rely on a line number.

- [ ] **[T-010] Step 4: Confirm both mirrors match (anchor-based)**

Run: `diff <(awk '/^### Step 6: Hook$/{f=1} f{print} /^### Repeat from Step 1\.$/{exit}' .claude/commands/cc-implement.md) <(awk '/^### Step 6: Hook$/{f=1} f{print} /^### Repeat from Step 1\.$/{exit}' project-template/.claude/commands/cc-implement.md)`
Expected: no output (the two Step 6 regions are identical).

- [ ] **[T-010] Step 5: Commit**

```bash
git add -f .claude/commands/cc-implement.md project-template/.claude/commands/cc-implement.md
git commit -m "feat(FEAT-005): wire cc-implement Step 6 hook to conductor-db recorder"
```

(`.claude/` is gitignored except `project-template/*`; `git add -f` is required for the live command file, per the repo's standing workaround.)

---

## Task 11: Release closeout — 1.19.0 (gated behind green suite)

**Files:**
- Modify: `VERSION`
- Modify: `package.json:3`
- Modify: `CHANGELOG.md`
- Modify: `AGENT-READABLE BACKLOG.md`

**Interfaces:**
- Consumes: a fully green `npm test` from Tasks 1–10.

- [ ] **[T-011] Step 1: Gate — run the full suite and assert current version**

Run: `npm test`
Expected: all suites PASS.
Run: `cat VERSION && node -p "require('./package.json').version"`
Expected: both print `1.18.0`. If either differs, stop and reconcile before bumping.

- [ ] **[T-011] Step 2: Bump `VERSION`**

Replace the single line `1.18.0` with:

```
1.19.0
```

- [ ] **[T-011] Step 3: Bump `package.json` version**

`Edit` line 3 of `package.json`:

```json
  "version": "1.19.0",
```

Leave `"engines": { "node": ">=20" }` unchanged (Global Constraint: no engines bump).

- [ ] **[T-011] Step 4: Add the CHANGELOG entry**

Resolve the date: `date +%F` (e.g. `2026-07-04`). Insert a new top entry directly under the `# Changelog` heading, above `## [1.18.0]`:

```markdown
## [1.19.0] - 2026-07-04

### Added
- `[FEAT-005]` `scripts/conductor-db.mjs`: zero-dependency ES-module CLI wrapping Node's built-in `node:sqlite` (`DatabaseSync`); owns `.conductor/cache.db` with `record <plan_file> <task_id> <state>` and idempotent `init` subcommands. Schema v1 `task_state(plan_file, task_id, state CHECK IN (' ','>','X','!'), updated_at) WITHOUT ROWID`, PK `(plan_file, task_id)`, WAL journaling, `user_version=1` set atomically via `BEGIN IMMEDIATE`. Repo-relative POSIX `plan_file` key (dedup across CWDs), 512-char arg cap, ms ISO-8601 `updated_at`. All failures non-fatal (single `CONDUCTOR_DB:` stderr line, exit 0): absent `node:sqlite`, corrupt/non-regular file (renamed aside, never `rm -r`), `SQLITE_BUSY`, `user_version > 1` forward-compat, CLI misuse.
- `[FEAT-005]` `tests/scripts/conductor-db.test.js`: Vitest child-process (`spawnSync`) suite covering schema/`user_version`, upsert, timestamp shape, state-enum/empty/over-length rejection, CLI discipline, `plan_file` dedup, git/`.git`-walk/script-dir root resolution, absent-`node:sqlite` degradation (via `--import` loader fixture), corrupt-db recovery, non-regular-file handling, and forward-compat no-write. Temp dbs under `os.tmpdir()` with `crypto.randomUUID()` names; `-wal`/`-shm` sidecars cleaned up; skips when the runner lacks `node:sqlite`.

### Changed
- `[FEAT-005]` `/cc-implement` Step 6 hook (both `.claude/commands/` and `project-template/.claude/commands/` mirrors): rewired from a `.conductor/cache.db`-existence no-op to a `node --version >= 22.5.0`-gated `conductor-db.mjs record` invocation; the cache self-disables below 22.5, so `engines.node` stays `>=20`.
- `[FEAT-005]` `.gitignore`: ignores `.conductor/` (local cache, never committed).
```

- [ ] **[T-011] Step 5: Check the backlog checkboxes**

Per the BUG-003 invariant, edit **one checkbox at a time**. First confirm each pattern is unique:

Run: `grep -nc "FEAT-005" "AGENT-READABLE BACKLOG.md" && grep -nc "FEAT-013" "AGENT-READABLE BACKLOG.md"`

Then surgically flip the `[FEAT-005]` task checkbox to `[X]` (single-line `Edit`), and separately flip the `[FEAT-013]` checkbox to `[X]` (it shipped in 1.18.0 but was never marked). If either grep shows a count other than the expected single task line, stop and resolve manually before editing.

- [ ] **[T-011] Step 6: Final full-suite run and commit**

Run: `npm test`
Expected: all suites PASS (release must ship green).

```bash
git add VERSION package.json CHANGELOG.md "AGENT-READABLE BACKLOG.md"
git commit -m "chore(FEAT-005): release v1.19.0 — SQLite task-state engine"
```

---

## Test List

- [ ] Unit: `record` happy path — db created, one row, correct `state` (T-001)
- [ ] Unit: upsert replaces state, no duplicate row (T-001)
- [ ] Unit: `updated_at` matches `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/` (T-001)
- [ ] Unit: `journal_mode = WAL`, `user_version = 1` (T-001)
- [ ] Unit: state-enum rejection, empty/whitespace rejection, 512-char cap, trim (T-002)
- [ ] Unit: unknown subcommand, arg-count, silent `init` (T-003)
- [ ] Unit: `plan_file` repo-relative dedup across two CWDs (T-004)
- [ ] Unit: root resolution via `.git` walk and script-dir fallback, git disabled (T-005)
- [ ] Unit: absent `node:sqlite` → one `CONDUCTOR_DB:` line, exit 0, no db (T-006)
- [ ] Unit: corrupt-db backed up aside + recreated; read-only-dir full degrade (T-007)
- [ ] Unit: directory-at-path renamed aside (contents survive), fresh db created (T-008)
- [ ] Unit: `user_version > 1` → no write, no downgrade, warning (T-009)
- [ ] Integration (seam): `cc-implement` Step 6 both mirrors invoke the recorder behind the version gate (T-010; verified by `diff`, prose seam — no runtime test)
- [ ] E2E: n/a (no UI)

## Commit Order

1. T-001 — engine skeleton + happy-path suite + `.gitignore` (green feature commit; gate passes)
2. T-002 — input validation
3. T-003 — CLI discipline
4. T-004 — normalization dedup test
5. T-005 — root-resolution fallbacks
6. T-006 — absent-`node:sqlite` degradation + loader fixture
7. T-007 — corrupt-db recovery ladder
8. T-008 — non-regular-file handling
9. T-009 — forward-compat no-write
10. T-010 — Step 6 hook wiring (both mirrors, `git add -f`)
11. T-011 — release closeout 1.19.0 + backlog checkboxes (gated behind green suite)

Each task is a single commit. Every commit after T-001 is TDD red→green **within the task** but leaves the whole suite green at commit time, so the pre-commit test-gate passes without `--no-verify`.

## Identified Risks

- **`--experimental-sqlite` rejected by a future Node line (fatal startup abort).** A Node that does not recognize the flag exits at startup with `bad option: --experimental-sqlite` (non-zero, fatal). The hook contains this by probing **no-flag-first, then flag** with disposable `-e "require('node:sqlite')"` children: a stable-sqlite Node never passes the flag at all, and a Node that removed the flag fails only inside the throwaway flag-probe (expected non-zero → advance to skip), never in the real recorder launch. So the fatal abort is always contained and the write simply degrades. The test helper still gates the flag to `>= 22.5` and runs under a controlled CI Node where the flag is accepted; T-006's degradation assertions and the `HAS_SQLITE` probe catch regressions.
- **Node `ExperimentalWarning` polluting stderr.** On Node 22.5–22.x, `--experimental-sqlite` prints an `ExperimentalWarning` to stderr that is *not* `CONDUCTOR_DB:`-prefixed. Both the hook invocation and the test helper add `--no-warnings` to silence it, so it never reaches a downstream orchestrator or breaks the suite's exact-stderr assertions. Even absent the flag, the warning is on stderr (never stdout), so a hypothetical leak would not corrupt any stdout-consuming pipeline — but it is suppressed regardless.
- **`node:sqlite` corruption-error message text varies by version.** `isCorruptionError` matches several substrings (`not a database`, `malformed`, `file is encrypted`, `notadb`). Risk: a version phrases it differently → the error re-throws and is caught by `withDb` as a generic write error (still exit 0, still non-fatal, but no auto-recovery). Caught by T-007; widen the substring set if it ever misses.
- **`chmod`-based read-only test is a no-op on Windows/CI-as-root.** The T-007 read-only case self-skips when `chmod` is unavailable or ineffective, so it never produces a false failure; the deterministic corrupt-recovery case still runs everywhere.
- **Module-customization loader API drift.** The absent-sqlite test relies on `module.register` + a `resolve` hook intercepting a `node:` builtin. If that API changes, T-006 breaks (not the production script). Mitigation: the fixture is isolated to tests; the production path (`try/catch` around `import`) is version-agnostic.
- **Root-resolution writing into the real repo.** If a test ran from a non-git temp dir without git disabled, the script-dir fallback would target the real repo's `.conductor/`. Mitigation: every default test `git init`s its temp repo; the fallback-B test copies the script into an isolated tree and disables git — never the real repo.
- **Both mirrors drifting.** T-010 edits two files that must stay identical; the `diff` verification step (T-010 Step 4) fails loudly if they diverge.
