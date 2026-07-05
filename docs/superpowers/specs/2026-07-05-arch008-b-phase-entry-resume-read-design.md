# ARCH-008-B — Phase-Entry Resume Read Wiring

**Date:** 2026-07-05
**Milestone:** ARCH-008 (sub-spec B of three: S1 schema → A writers → **B readers**)
**Depends on:** `[ARCH-008-A]` (shipped v1.21.0), `[ARCH-008-S1]` (shipped v1.20.0)
**Complexity:** M

---

## Problem

ARCH-008-A wired `/cc-compact` and `/cc-checkpoint` to persist SNAP blobs into the `snapshots` table keyed by the current git commit hash, but nothing reads them back. The headline ARCH-008 acceptance behavior — "reload full agent awareness by matching database state to the current Git commit identifier" — is unrealized: a developer who switches branches or rolls back to a commit that has a stored snapshot gets a cold, fresh-start phase entry with no memory of the decisions/pending-steps captured there. The per-phase handoff file (`.claude/memory/session-snapshot.json`) only bridges a single `/compact` boundary within one linear session; it does not survive a branch switch, and it is deleted on first read.

## Solution

Add one zero-dependency script, `scripts/resume-read.mjs`, that resolves the current full-40 git hash, queries `conductor-db get-snapshot <hash>` (a non-destructive read), validates any returned blob through the existing `snap-validate.mjs`, and prints a compact structured context summary plus a one-line "Resumed from stored snapshot" banner on a hit. The three phase-entry commands (`cc-spec`, `cc-plan`, `cc-implement`, in both `.claude/commands/` and `project-template/.claude/commands/` mirrors) each collapse their ad-hoc snapshot-read block into a single call to this script and adopt whatever it prints. The **DB snapshot is authoritative** when present and valid; the handoff file is the fail-open fallback for when ARCH-008-A's best-effort DB tail did not persist. Either way the handoff file is deleted once its content is captured or superseded, so no orphaned handoff files accumulate. A miss (no DB row, no handoff file) degrades silently to today's fresh-start behavior.

## Behavior

### Main path

Phase entry (`cc-spec` / `cc-plan` / `cc-implement`) runs `node scripts/resume-read.mjs` from the repo root, which performs:

1. **Resolve hash** — `git rev-parse HEAD` via Node's `execFileSync('git', ['rev-parse','HEAD'], { encoding:'utf8', timeout: 2000, stdio: ['ignore','pipe','ignore'] })`, wrapped in `try/catch`. `execFileSync` **throws** on git-absent (`ENOENT`), non-zero exit (non-repo / zero-commit → `fatal:`), and the 2000 ms timeout (`ETIMEDOUT`, `SIGTERM`) — every one of these is caught by the same `catch`, which falls back to the `"0000000"` sentinel. A successful result is trimmed, lowercased, and matched against `/^[0-9a-f]{7,64}$/` (wide enough to accept both a 40-char SHA-1 and a 64-char SHA-256 object id, so a valid full-length SHA-256 hash is never mistaken for garbage and overwritten by the sentinel); a format mismatch also yields the sentinel. The 2000 ms timeout is a **Node-level child timeout**, not the GNU `timeout` binary — portable to native Windows PowerShell and Git Bash alike, so `resume-read.mjs` never depends on GNU coreutils. git's stderr is routed to `stdio[2] = 'ignore'` so no git diagnostic (`fatal: not a git repository`, `fatal: ambiguous argument 'HEAD'`) ever reaches the terminal, and any that `execFileSync` surfaces in the thrown error is discarded inside the catch.
2. **DB-query gate (full-length object hash only)** — the DB is queried **only** when the resolved hash is a full-length git object id: `/^([0-9a-f]{40}|[0-9a-f]{64})$/` — **40 hex for a SHA-1 repository or 64 hex for a SHA-256 (`git init --object-format=sha256`) repository.** The `snapshots` table is keyed by the writers' full `git rev-parse HEAD` output (whatever width the repo's object format yields), and `get-snapshot` does an exact-equality lookup (`WHERE git_commit_hash = $h`) with **no** abbreviated/prefix matching, so a stored 64-char SHA-256 key matches a 64-char lookup and a 40-char SHA-1 key matches a 40-char lookup. Any value that is neither 40 nor 64 hex — the `"0000000"` sentinel or any abbreviated form — **bypasses the DB entirely** and goes to the handoff-file branch (step 4, miss path). This also closes the sentinel-collision hole: `"0000000"` is shared by every non-git context, so querying it would risk binding an unrelated session's row; the session-local handoff file is the only safe source there. Trace: `resume: sentinel-bypass` (sentinel) or `resume: nonfull-hash-bypass` (other non-40/64). **Companion validator change:** because a SHA-256 handoff/blob carries a 64-char `sys.c`, this milestone broadens `snap-validate.mjs`'s `sys.c` regex from `/^[0-9a-f]{7,40}$/` to `/^[0-9a-f]{7,64}$/` so the reader never halts on a legitimate SHA-256 snapshot (the writers already emit the full 64-char hash unchanged — no writer change needed).
3. **Query the DB (non-destructive)** — for a full-length hash (40- **or** 64-char, per the Step 2 gate), run `conductor-db.mjs get-snapshot <hash>` under the Node-flag probe (no-flag-first → `--experimental-sqlite --no-warnings` → skip), each child spawned with `process.execPath` (see *Child-process invariants* below). The two capability-probe children carry a **2000 ms** `spawnSync` timeout (they only `require('node:sqlite')`), while the `get-snapshot` child carries a **5000 ms** timeout — deliberately **longer** than git's 2000 ms because, unlike the near-instant local `git rev-parse`, this child must cover Node cold-start + `node:sqlite` open + a query whose *own* internal `busy_timeout` is already 2000 ms; a 2000 ms outer bound would guillotine a query that `conductor-db`'s internal wait would have satisfied. All three still bound the call so a lock or corruption can never hang phase entry. It prints one blob line on a hit and zero bytes on a miss or on any degradation (Node < 22.5, `node:sqlite` absent, corrupt DB). A spawn that times out, is killed, or exits non-zero is treated as a **miss/degrade** (empty blob → fall to the file branch), so a DB lock or corruption can never hang phase entry. An **absent, uninitialized, or schema-less DB** (no `.conductor/cache.db`, or a file lacking the `snapshots` table) is handled entirely inside `conductor-db` (fail-open: it self-initializes or degrades, prints zero bytes to stdout, exits 0) — `resume-read` simply sees empty output and treats it as a miss. `conductor-db`'s child **stdout and stderr are both captured by the `spawnSync` pipe** (not inherited), so any `CONDUCTOR_DB:` degradation line is routed to the trace log, never the terminal. `get-snapshot` returns the **newest** row for the hash via the S1 contract `SELECT snap_json FROM snapshots WHERE git_commit_hash = $h ORDER BY id DESC LIMIT 1`, where `id` is the table's `INTEGER PRIMARY KEY` autoincrement rowid — so `id DESC` deterministically selects the most-recently-inserted row when several snapshots share one commit hash. A mid-work `/cc-checkpoint` (v2) written after a `/cc-compact` (v1) at the same commit therefore resumes the checkpoint blob; this is intentional and consistent with "DB wins." `resume-read` relies on this ordering rather than re-deriving it.
4. **Bind by precedence:**
   - **DB hit + valid blob** → bind context from the DB blob (DB wins). Then, if the handoff file exists, delete it (it is redundant/superseded) — silent, best-effort. Emit the hit block. Exit 0. Trace: `resume: db-hit @<hash>`.
   - **DB blob present but fails validation** → the DB is best-effort, so **degrade** (do not halt): fall through to the handoff-file branch. Trace: `resume: db-invalid degrade`.
   - **DB miss/degrade/bypass** → fall back to the handoff file. First test existence (`existsSync(HANDOFF)`); if absent → miss. If present, read its bytes **into memory first** inside a `try/catch`:
     - **read fails** (`EACCES` permission denied, `EIO`, `EBUSY`, lock) → this is a transient access problem, **not** proof of corruption, so it **degrades to a clean miss** (exit 3, file left on disk), never a halt. Trace: `resume: file-unreadable degrade`. (This deliberately separates "cannot read" from "read but invalid": only the latter halts, so a permission blip never traps the user in a halt state.)
     - read succeeds, then validate:
       - **structurally invalid** (readable but malformed JSON / bad schema / unknown version) → **halt** (exit 4), leave the file on disk. Trace: `resume: file-invalid halt`.
       - **valid but `sys.c` ≠ the current resolved hash** → the file is a stale remnant of a prior commit (e.g. left behind by an earlier failed unlink); **do not bind it**. Best-effort delete it and degrade to a clean miss (exit 3). Trace: `resume: file-stale-hash degrade`. (When both the file's `sys.c` and the current hash are the `"0000000"` sentinel they match, so a legitimate non-git handoff still binds.)
       - **valid and `sys.c` matches** → bind file context and **only then** unlink the file (capture-before-delete, so a failed unlink can never resurface stale context next cycle). Emit the hit block. Exit 0. Trace: `resume: file-bind+unlink`.
   - **No usable context** → exit 3 (clean miss), **zero bytes on stdout** (not even a trailing newline); the command proceeds fresh. Trace: `resume: miss`.
5. **Legacy `.md` sweep** — if a legacy `.claude/memory/session-snapshot.md` is found at any point, delete it unread (best-effort, silent); it is never bound. This completes the v1.18.0 deprecation. Trace: `resume: legacy-md-swept`.
6. **Surface (on any hit)** — stdout carries a stable machine-readable block (see *Stdout contract* below) that the command adopts as its starting context; the command then echoes one human banner to the UI, e.g. `> Resumed from stored snapshot @ <hash> (phase: plan)`, adding `(checkpoint prose available)` when the block reports `prose: available`.
7. **Trace** — every evaluation and deletion step is written **directly by the script** via synchronous `appendFileSync(join(root, '.conductor', 'last-write.log'), line, { encoding: 'utf8', flag: 'a' })` (after a best-effort `mkdirSync(join(root, '.conductor'), { recursive: true })`), never via stderr. Each line is prefixed with an ISO-8601 timestamp and the `resume:` namespace — `new Date().toISOString() + ' resume: ' + <token> + '\n'` (e.g. `2026-07-05T10:33:00.000Z resume: db-hit`) — so a resume trace is unambiguously distinguishable from the ARCH-008-A `CONDUCTOR_DB:` / command-tail lines that share the same log. Traces do **not** ride the shell's `2>>` redirect: the script owns its log destination unconditionally, so a command that forgets the redirect still logs, and there is no double-write or destination conflict. The synchronous append with the `'a'` flag maps to a single `O_APPEND` write per line, which the OS serializes — so two concurrent phase entries never interleave or truncate each other's trace. Every append is wrapped in its **own** `try/catch` (best-effort): if the log is concurrently locked, read-only, or otherwise unwritable (`EACCES`, `EBUSY`, `EROFS`, `ENOSPC`), the exception is swallowed and the script continues — a trace write can never crash the process or abort phase entry. Tracing is diagnostic, never load-bearing. Vocabulary: `resume: db-hit`, `resume: db-invalid degrade`, `resume: file-bind+unlink`, `resume: file-invalid halt`, `resume: file-unreadable degrade`, `resume: file-stale-hash degrade`, `resume: sentinel-bypass`, `resume: nonfull-hash-bypass`, `resume: legacy-md-swept`, `resume: miss`. stderr is reserved exclusively for the exit-4 halt reason; stdout is reserved exclusively for the `RESUME_HIT` block.

### Stdout contract

On a **hit** (exit 0), stdout is exactly this line-oriented block — a fixed `RESUME_HIT` sentinel first line, then `key: value` lines, then a `pending:` list — so the phase commands parse it deterministically:

```
RESUME_HIT
source: db            # db | file
commit: 65e0ec6a1f...  # the resolved hash (or 0000000)
phase: plan            # spec | plan | impl | rev
spec: 2026-07-05-arch008-b-phase-entry-resume-read-design   # or "none"
version: 2             # 1 | 2
prose: available       # available | none
pending:
- first pending step
- second pending step
```

`pending:` is always emitted; with no pending steps it is followed by zero `- ` lines. On a **miss** (exit 3) and only then, stdout is empty (zero bytes). On a **halt** (exit 4), stdout is empty and the reason is on stderr / in the trace log.

**Emitter/parser boundary rules — and which side owns what.** The **script (emitter)** guarantees a clean payload: `\n`-only line separators and **no trailing blank line** (the final byte is the newline after the last content line). The **`.claude/commands/` template parsers (consumers) are the entities responsible for defensive normalization** — the script does not pre-sanitize for them, because the noise they must tolerate (CRLF, stray blanks) is introduced *downstream* by the shell/PowerShell capture pipeline, not by the script. Each command's parsing prose therefore performs: (1) split the captured text on `\n`; (2) **strip a trailing `\r` from every line** (CRLF-safe — PowerShell pipelines are the common CR source); (3) **drop any leading/trailing wholly-blank lines**; (4) require `lines[0].trim() === 'RESUME_HIT'` — anything else is treated as a miss; (5) `key: value` lines split on the **first** `': '` with both sides trimmed; (6) the `pending:` block is every subsequent line matching `^\s*-\s+` up to EOF or the first blank line, each item's capture trimmed. Unknown keys are ignored (forward-compatible).

The `prose:` value is derived from exactly one JSON key — the **top-level `pr`** field of the SNAP v2 schema: `prose: available` iff `typeof snap.pr === 'string' && snap.pr.length > 0`, else `prose: none` (all v1 blobs, which have no `pr`, report `none`). `version:` is `snap.v`; `phase:` is `snap.sys.ph`; `spec:` is `snap.sys.s`; `commit:` is the resolved hash; `pending:` items are `snap.ops.n`.

### Paths and validation mechanism

- **Every path is resolved against the discovered project `root`, never the current working directory.** `HANDOFF`, `LEGACY_MD`, the `.conductor/` directory, `.conductor/last-write.log`, and the validation temp are all `join(root, …)`. This is essential because a phase command may be invoked from a nested subdirectory; a CWD-relative `.conductor/last-write.log` would scatter logs (and worse, split the session-id/snapshot state) across subdirectories.
- **`root` resolution is git-independent — three tiers, no tier past the first requires the git binary:**
  1. **git toplevel** — `execFileSync('git', ['rev-parse','--show-toplevel'], …)` in a `try`; the fastest path when git is present.
  2. **bounded `.git` upward walk** — if tier 1 throws (git absent/`ENOENT`, or not a repo), walk up from `process.cwd()` up to 40 levels testing `existsSync(join(dir, '.git'))`. This uses only `fs.existsSync` — **no git binary** — so it fully recovers the project root on a machine without git installed, as long as a `.git` directory exists on disk.
  3. **script-parent fallback** — if neither tier finds a root (no git, no discoverable `.git`), fall back to `join(dirname(fileURLToPath(import.meta.url)), '..')` — the parent of `scripts/`, i.e. the repo root by the script's own location. This tier cannot fail and needs nothing external.
  Because tiers 2 and 3 need no git, project-root-relative path resolution stays fully operational even when git is completely unavailable. This mirrors `session-id.mjs`'s `resolveRoot`.
- **Handoff file** — a single module constant `HANDOFF = join(root, '.claude/memory/session-snapshot.json')` is the *only* spelling of the path, reused verbatim in every operational branch (existence check, capture-read, validation, unlink, hash-stale re-delete). **Legacy** `LEGACY_MD = join(root, '.claude/memory/session-snapshot.md')` is used only by the sweep.
- **Validation temp** — `join(root, '.conductor', 'resume-validate.' + process.pid + '.tmp.json')`. The uniqueness token is explicitly `process.pid` (a positive integer on every platform Node supports), so concurrent phase entries never collide and the filename is portable — no `os`/random dependency.
- **Validation reuses `snap-validate.mjs` unchanged** — which validates a **file path only** (it `readFileSync`s `argv[2]`; it has no stdin or in-memory-string surface). `resume-read` keys the pass/fail decision **solely off the child's exit code**: `snap-validate` exits `0` for a valid blob and `1` for any failure (writing a `SNAP_ERROR: …` line to stderr and nothing to stdout). So `spawnSync(...).status === 0` ⇒ valid; any non-zero (or a null status from spawn failure/timeout) ⇒ invalid. `resume-read` does **not** parse `snap-validate`'s stderr text — a non-zero exit is sufficient (DB blob → degrade; handoff file → halt exit 4, which subsumes both `SNAP_INVALID` and `SNAP_UNKNOWN_VERSION`). So:
  - The **handoff file** is validated at its own `HANDOFF` path (it already exists on disk). Capture-before-delete still holds: its bytes are read into memory for *binding* first; validation reads the same path; the unlink happens only after both.
  - The **DB blob** (an in-memory string with no path) must be bridged to the path-only validator through a temp file. Its full lifecycle:
    1. **Path** — `TMP = join(root, '.conductor', 'resume-validate.' + process.pid + '.tmp.json')` (root-relative, pid-unique).
    2. **Create** — `mkdirSync(join(root, '.conductor'), { recursive: true })` best-effort, then `writeFileSync(TMP, blob, 'utf8')`. This write is wrapped in `try/catch`: a filesystem error (`EACCES`, `ENOSPC`, `EROFS`, read-only `.conductor`) is caught and **degrades the DB blob to unusable** — the script falls through to the file branch rather than crashing.
    3. **Validate** — spawn `snap-validate.mjs` (via `process.execPath`) with `TMP` as `argv[2]`; the exit code is the verdict.
    4. **Cleanup** — the `unlinkSync(TMP)` runs in a **`finally`** attached to the write/validate `try`, so the temp is removed even when the write or the validation throws — no `resume-validate.*.tmp.json` ever accumulates. The finally-unlink is itself silent/best-effort.
    No validation logic is duplicated or rewritten (aside from the `sys.c` regex widening noted in step 2).

  **Temp cleanup on external termination — no signal listener.** The temp exists only across the synchronous, sub-second `spawnSync(snap-validate)` call, and the `finally` removes it on every normal or throwing return. A `process.on('SIGINT'/'SIGTERM')` handler is deliberately **not** added: `spawnSync` blocks the event loop, so a signal handler cannot reliably interpose mid-call, and a `SIGKILL` defeats any handler regardless — the added complexity buys almost nothing. The residual risk (a hard kill in the millisecond window leaving one `resume-validate.<pid>.tmp.json`) is bounded and harmless: the file is pid-named (no collision), tiny, and gitignored. It is reclaimed by extending the ARCH-008-A `post-compact` hooks' existing temp sweep to also remove `.conductor/resume-validate.*.tmp.json` (a one-line addition alongside the existing `session-id.*.tmp` sweep, both mirrors).

### Child-process invariants

- **`process.execPath`, never `'node'`.** Every spawned Node child — the `conductor-db.mjs` flag-probes and `get-snapshot` call, and the `snap-validate.mjs` validation — is launched with `process.execPath` (the exact interpreter running `resume-read.mjs`), not the bare string `'node'`. This guarantees the child runs the same Node version and environment as the parent, which is essential for the `--experimental-sqlite` capability probe to be meaningful and to avoid picking up a different `node` from a shadowed PATH. (The one non-Node child, `git`, is still located via PATH by `execFileSync('git', …)`, matching `session-id.mjs`.)
- **Child *script* paths are resolved from this script's own directory, not the CWD.** `conductor-db.mjs` and `snap-validate.mjs` are addressed as `join(dirname(fileURLToPath(import.meta.url)), 'conductor-db.mjs')` / `'snap-validate.mjs'` — i.e. relative to `resume-read.mjs`'s location in `scripts/` — so invocation from any nested subdirectory resolves the siblings correctly. A bare `scripts/conductor-db.mjs` (CWD-relative) would fail from a subdirectory.
- **Explicit `utf8` on all I/O.** Every `readFileSync` / `writeFileSync` / `appendFileSync` passes `'utf8'` (or `{ encoding: 'utf8' }`), and every `spawnSync` passes `{ encoding: 'utf8' }`, so no operation ever returns or misinterprets a raw `Buffer` — eliminating platform-dependent decoding mismatches.
- **Explicit parent-environment forwarding.** Every `spawnSync` / `execFileSync` call passes `env: process.env` explicitly (not relying on the implicit default), so the child inherits the exact `PATH`, `CLAUDE_CODE_SESSION_ID`, and every other variable of the phase-entry process — guaranteeing the `git` lookup and the `node` children resolve the same binaries and see the same environment as the parent.
- **`.conductor/` is created before any write.** Every path that writes into `.conductor/` (the trace log and the validation temp) is preceded by a best-effort `mkdirSync(join(root, '.conductor'), { recursive: true })`. `recursive: true` is idempotent (no throw if it already exists) and creates intermediate directories, so a pristine/uninitialized workspace never triggers an `ENOENT` on the first append/write.
- **Every unlink is individually isolated.** All four deletion sites — the handoff delete on a DB hit, the hash-stale re-delete, the validation-temp `finally` unlink, and the legacy-`.md` sweep — are each wrapped in their **own** local `try { unlinkSync(...) } catch {}`. A lock/permission exception on one never propagates and never prevents the others; no unlink can throw out of the script.
- **Every `JSON.parse` of external content is in `try/catch`.** Both parse sites — the DB blob (to read `sys.c`/`sys.ph`/etc. for binding) and the handoff file content (for binding and the hash-stale check) — wrap `JSON.parse` in `try/catch`, so malformed/corrupted content can never throw an unhandled exception. A parse failure on the **DB blob** degrades to the file/miss path; a parse failure on the **handoff file** is treated as invalid → halt (exit 4) — though in practice `snap-validate` has already passed the same bytes, so this is a defensive backstop that must still never crash. (`snap-validate` runs first as the schema gate; the in-script `JSON.parse` is only to *extract fields*, not to re-validate.)

### Shell capture syntax (command files)

The six command files are agent-interpreted prose, not literal scripts, but they specify one canonical capture form per platform so the phase command reliably reads the block and the exit code. **Each form first probes for `node` and treats its absence as a clean miss** — never an error — because on native PowerShell an unresolved `node` raises a terminating `CommandNotFoundException` that would abort the whole phase-entry block:

- **Unix / Git Bash:**
  ```sh
  if command -v node >/dev/null 2>&1; then
    resume_out="$(node scripts/resume-read.mjs 2>>.conductor/last-write.log)"; resume_rc=$?
  else resume_rc=3; resume_out=""; fi
  ```
- **PowerShell:**
  ```powershell
  if (Get-Command node -ErrorAction SilentlyContinue) {
    $__eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
      $__nap = $PSNativeCommandUseErrorActionPreference; $PSNativeCommandUseErrorActionPreference = $false
    }
    try {
      $resume_out = node scripts/resume-read.mjs 2>> .conductor/last-write.log; $resume_rc = $LASTEXITCODE
    } catch { $resume_rc = 3; $resume_out = "" }
    finally {
      $ErrorActionPreference = $__eap
      if (Test-Path variable:__nap) { $PSNativeCommandUseErrorActionPreference = $__nap }
    }
  } else { $resume_rc = 3; $resume_out = "" }
  ```
  A caller-global `$ErrorActionPreference = 'Stop'` (and, on PS 7.3+, `$PSNativeCommandUseErrorActionPreference = $true`) would otherwise turn the native command's stderr writes into a terminating error mid-assignment and abort the whole phase-entry block; the mirror **locally forces `Continue` and disables native-error-action mapping**, saved/restored in `finally`, and wraps the call in `try/catch` so nothing the child writes to stderr can terminate the command. On any catch it degrades to a miss (`rc = 3`).

The command then branches on `resume_rc` — treating **only `0` and `4` as meaningful; every other code is a miss**:
- **`0`** → parse the `RESUME_HIT` block and adopt it (+ echo the banner).
- **`4`** → **operational halt.** The command MUST stop phase entry immediately: it does **not** run the phase's normal work, and instead emits a single halt line to the user — `SNAP_INVALID: corrupt handoff at .claude/memory/session-snapshot.json — inspect or remove it, then re-run.` — and enters standby awaiting user action. This is the same halt contract `cc-implement` already uses for `SNAP_INVALID` / `SNAP_UNKNOWN_VERSION`; exit 4 simply routes into it. The corrupt file is left on disk (the script did not delete it).
- **`3` or any other code** → **proceed fresh.** Exit 3 is the designed clean miss (true miss, bypass, degrade, absent `node`), but the branch is written as a catch-all: any *unexpected* termination code — a Node crash (`1`), OOM (`134`), a signal-derived code (`137`, `143`), or anything else an external runtime issue produces — is treated identically to a miss. Only an explicit `4` ever halts; nothing an unexpected exit code can do will trap the user or abort the phase. The capture is ignored on this branch.

**PowerShell multi-line capture:** `$resume_out = node …` binds a **`string[]` array** when the script prints multiple lines (PowerShell splits native-command stdout on newlines), a single string for one line, and `$null` for zero output. The command normalizes before parsing: treat `$resume_out` as the line array directly (`$lines = @($resume_out)`) — `$lines[0]` is the `RESUME_HIT` sentinel, subsequent entries are the `key: value` / `- item` lines — or equivalently `($resume_out -join "\`n")` to reconstruct the block. A `$null`/empty `$resume_out` with `resume_rc = 3` is a miss. The Unix form captures the whole block as one newline-delimited string and splits on `\n`.

The `2>>` redirect only sinks any incidental stderr (the exit-4 halt reason) away from the UI; it is **not** the trace channel — the script writes traces itself via `appendFileSync` (see step 7), so the two never conflict.

### Alternative paths

- **Branch switch to a commit with a stored snapshot** — `get-snapshot` matches the new HEAD's hash, hit, context restored. Switching to a commit *without* a snapshot yields a miss → fresh start. This is the cross-branch isolation guarantee: context from branch A never leaks into branch B.
- **DB tail never persisted (ARCH-008-A fail-open)** — `get-snapshot` misses; the handoff file (written unconditionally by `/cc-compact`) is the fallback and is bound + deleted. This is the normal same-session `spec → plan → implement` flow.
- **Both DB row and handoff file present** — DB wins; the handoff file is deleted unread.
- **v2 checkpoint blob restored** — sys/ops/mem bind as working context; `pr` is not dumped in full, only flagged as available.

### Error cases

- **Handoff file readable but invalid** (successfully read, then malformed JSON / `SNAP_UNKNOWN_VERSION` / `SNAP_INVALID`) → **halt** (exit 4), leave the file on disk for manual inspection. This preserves `cc-implement`'s existing corrupt-handoff safety gate; a corrupt authoritative handoff must not be silently discarded. (A DB blob that fails validation does **not** halt — the DB is best-effort, so it degrades to the file/miss path.)
- **Handoff file present but unreadable** (`EACCES` permission denied, `EIO`, `EBUSY` lock — the read itself throws) → **degrade to a clean miss** (exit 3), leave the file on disk. A read-permission blip is a transient access failure, not evidence of corruption, so it must not trigger the halt state; the phase proceeds fresh and a later run with restored permissions can consume the file normally. This is deliberately distinct from the readable-but-invalid case above.
- **Handoff file valid but hash-stale** (`sys.c` ≠ current HEAD — a remnant of a prior commit left by a failed unlink) → not bound; best-effort re-delete + degrade to a clean miss (exit 3). This is the guard against stale context floating in after an unlink failure.
- **Unlink fails** (Windows AV/reader lock, EACCES/EPERM) → swallowed silently; the orphaned file is swept at the next compaction boundary by the ARCH-008-A `post-compact` hook, and the hash-stale guard above prevents it being bound in the interim. Phase entry never aborts on an unlink failure.
- **`node` binary absent** when the command tries to run `resume-read.mjs` → the command falls back to today's fresh-start behavior (the resume-read is an enhancement, not a prerequisite).
- **git slow / hung** (slow disk, network filesystem) → the 2000 ms Node child timeout fires, `execFileSync` throws, the hash resolves to the `"0000000"` sentinel → sentinel-bypass → file branch. Phase entry never hangs on git.
- **Total root-resolution failure at startup** → `resolveRoot` always returns a value (its final fallback is the script's own parent directory), but as belt-and-suspenders the **entire script body runs inside one top-level `try/catch`**: any unhandled initialization error — even one thrown before the trace log is reachable — is caught and the process exits **3** (clean miss, zero stdout), never a stack trace or non-zero crash. The phase command then proceeds fresh.

## Acceptance Criteria

- [ ] `scripts/resume-read.mjs` exists, is zero-dependency, and runs flag-free on any Node ≥ 14 (the `--experimental-sqlite` probe is confined to the `conductor-db` sub-call, exactly as in ARCH-008-A). Its JavaScript uses **only Node-14-compatible syntax** — no logical-assignment operators (`||=`, `&&=`, `??=`, all Node ≥ 15), no `Array.prototype.at` (Node ≥ 16.6), no `structuredClone` (Node ≥ 17), no top-level `await`, no `Error.cause`. Nullish `??` and optional chaining `?.` are permitted (Node 14). This is verified by an assertion in the test suite and by keeping the file parseable under a Node-14-equivalent check.
- [ ] The git hash is resolved with a **2000 ms Node-level `execFileSync` child timeout** (not the GNU `timeout` binary) and git stderr is suppressed (`stdio[2] = 'ignore'`); a hang, missing git, or non-repo resolves to `"0000000"` and never leaks a git diagnostic to the UI.
- [ ] When the resolved hash is the `"0000000"` sentinel, the DB query is **bypassed** and the file branch is used directly.
- [ ] On a DB hit with a valid blob, the script binds DB context, deletes the handoff file if present, prints the `RESUME_HIT` block, and exits 0.
- [ ] On a DB miss with a valid, hash-matching handoff file, the script reads the bytes into memory, binds, then unlinks the file, prints the block, exits 0.
- [ ] On a DB miss with an **invalid** handoff file, the script exits 4 and leaves the file on disk.
- [ ] On a DB miss with a **valid but hash-stale** handoff file (`sys.c` ≠ current HEAD), the script does not bind it, best-effort deletes it, and exits 3.
- [ ] On a total miss (no DB row, no handoff file), the script exits 3 with **exactly zero bytes on stdout** (no blank line) so a `$(...)` capture yields an empty string.
- [ ] The stdout hit-block matches the fixed `RESUME_HIT` / `key: value` / `pending:` contract; the phase commands parse it deterministically.
- [ ] Deletion of the handoff file occurs on the DB-hit, DB-miss-valid-match, and hash-stale paths; the DB-hit path never binds the file.
- [ ] A DB blob that fails validation **degrades** to the file/miss path (trace `resume: db-invalid degrade`) and never halts.
- [ ] A legacy `.claude/memory/session-snapshot.md`, if present, is swept unread (best-effort).
- [ ] Unlink failures are caught and non-fatal; the script never throws.
- [ ] The DB `get-snapshot` read is non-destructive (repeatable across successive branch switches).
- [ ] Both the DB blob and the handoff file are validated through `snap-validate.mjs`; no schema logic is duplicated in `resume-read.mjs`.
- [ ] `cc-spec`, `cc-plan`, and `cc-implement` phase-entry blocks (all six mirror files) call `resume-read.mjs` with the canonical per-platform capture syntax and adopt its output; the legacy `.md` handoff path is removed from all three.
- [ ] Traces are written by the script via synchronous `appendFileSync(..., { flag: 'a' })` directly to `.conductor/last-write.log`, never through the shell `2>>` redirect; the log append is best-effort and never aborts phase entry.
- [ ] The DB blob is validated by writing it to a `.conductor/resume-validate.<pid>.tmp.json` temp and spawning `snap-validate.mjs`; the handoff file is validated at its own path; the temp is unlinked best-effort. `snap-validate.mjs`'s validation *logic* is reused as-is — the only change to it is the `sys.c` length-ceiling widening ({7,40}→{7,64}) tracked separately above.
- [ ] `node` absence is probed by each command (`command -v node` / `Get-Command node`) and treated as a clean miss (`resume_rc=3`), never a terminating error — verified for the PowerShell mirror by inspection.
- [ ] `prose: available|none` is derived solely from the top-level `pr` key (`available` iff a non-empty string), and `version:` from `snap.v`.
- [ ] The handoff path is a single `HANDOFF` constant reused across the existence-check, capture-read, validation, unlink, and hash-stale branches; no path string is duplicated inline.
- [ ] The git resolution `try/catch` demonstrably catches `ENOENT` (git absent), non-zero exit, and `ETIMEDOUT`/`SIGTERM` (timeout), each falling back to `"0000000"`.
- [ ] The DB is queried only when the resolved hash matches `/^([0-9a-f]{40}|[0-9a-f]{64})$/` (SHA-1 or SHA-256 full object id); the sentinel and any other non-full value bypass the DB (no abbreviated lookup is ever attempted).
- [ ] `snap-validate.mjs`'s `sys.c` regex is widened to `/^[0-9a-f]{7,64}$/` and covered by a 64-char accept test, so a SHA-256 handoff/blob validates and the reader does not halt on it.
- [ ] Every `spawnSync`/`execFileSync` forwards `env: process.env` explicitly.
- [ ] `mkdirSync(join(root,'.conductor'), { recursive: true })` precedes every trace append and temp write; a pristine workspace never `ENOENT`s.
- [ ] Each of the four unlink sites is individually `try/catch`-isolated; no unlink throws out of the script.
- [ ] Trace-log appends are individually `try/catch`-guarded; a locked/read-only log never crashes the process.
- [ ] No `SIGINT`/`SIGTERM` listener is added; the temp is cleaned by the `finally`, and a hard-kill leak is reclaimed by the extended `post-compact` `resume-validate.*.tmp.json` sweep.
- [ ] Step 1's hash-acceptance regex is `/^[0-9a-f]{7,64}$/` so a full-length SHA-256 hash is accepted, not overwritten by the sentinel; Step 3 describes a "full-length (40- or 64-char)" hash consistently with the Step 2 gate.
- [ ] `root` resolution has three tiers (git toplevel → `.git` walk via `existsSync` → script-parent) and stays fully operational with git completely absent (tiers 2–3 need no git binary).
- [ ] Both external `JSON.parse` sites (DB blob, handoff file) are `try/catch`-wrapped; a parse failure never crashes — DB-blob parse failure degrades, handoff parse failure halts (exit 4).
- [ ] The `get-snapshot` child timeout (5000 ms) is deliberately longer than git's (2000 ms) to clear `conductor-db`'s internal 2000 ms `busy_timeout`; the two capability probes use 2000 ms.
- [ ] The `get-snapshot` child is spawned with an explicit **5000 ms** `spawnSync` timeout; a timeout/kill/non-zero exit degrades to the file branch (never hangs).
- [ ] The DB-blob validation temp is removed in a `try/finally` (no `resume-validate.*.tmp.json` accumulates when validation throws), and a filesystem error writing the temp degrades to the file branch instead of crashing.
- [ ] On `resume_rc = 4`, each command halts phase entry with the fixed `SNAP_INVALID: corrupt handoff …` line and enters standby, leaving the file on disk — verified for both mirrors by inspection.
- [ ] The command parsing accounts for PowerShell binding multi-line stdout as a `string[]` (normalize via `@($resume_out)` / `-join`), and an empty/`$null` capture as a miss.
- [ ] `.conductor/last-write.log`, `.conductor/`, `HANDOFF`, `LEGACY_MD`, and the validation temp are all `join(root, …)` (root-relative), so invoking a command from a nested subdirectory places them under the project root, not the CWD.
- [ ] The validation temp token is exactly `process.pid`.
- [ ] `resume-read` decides validity from `snap-validate`'s **exit code only** (0 valid / non-zero invalid), not by parsing its stderr.
- [ ] The entire script runs inside a top-level `try/catch`; any unhandled startup error exits 3 with zero stdout (never a stack trace).
- [ ] The PowerShell mirror locally sets `$ErrorActionPreference='Continue'` (and disables `$PSNativeCommandUseErrorActionPreference` on 7.3+), restored in `finally`, and wraps the call in `try/catch` so a caller-global `Stop` cannot terminate phase entry.
- [ ] The emitter uses `\n`-only separators with no trailing blank line; the parser strips `\r`, ignores trailing blank lines, and bounds the `pending:` block at the first blank line or EOF.
- [ ] An absent/uninitialized/schema-less `.conductor/cache.db` yields an empty `get-snapshot` (fail-open, exit 0) → treated as a miss; the child's `CONDUCTOR_DB:` stderr is captured to the trace log, never the terminal.
- [ ] The DB-blob validation temp lifecycle is explicit: `join(root,'.conductor','resume-validate.'+process.pid+'.tmp.json')`, created with `writeFileSync(..., 'utf8')` in a `try` whose `finally` unlinks it; a write FS error degrades to the file branch.
- [ ] All spawned Node children use `process.execPath`, never the string `'node'`; `git` alone is located via PATH.
- [ ] `conductor-db.mjs` and `snap-validate.mjs` child paths are resolved from `dirname(fileURLToPath(import.meta.url))`, not CWD-relative.
- [ ] Every trace line is `<ISO-8601> resume: <token>` so it is distinguishable from other producers in `.conductor/last-write.log`.
- [ ] Every `readFileSync`/`writeFileSync`/`appendFileSync` specifies `'utf8'`; every `spawnSync` specifies `{ encoding: 'utf8' }`.
- [ ] The command templates (not the script) own CR-stripping and blank-line filtering of the captured block.
- [ ] The command branches treat **only** `0` (adopt) and `4` (halt) specially; `3` and every other/unexpected code proceed fresh.
- [ ] A handoff-file **read error** (`EACCES`/`EIO`/`EBUSY`) degrades to a miss (exit 3), distinct from a readable-but-invalid file which halts (exit 4).
- [ ] `get-snapshot`'s `ORDER BY id DESC LIMIT 1` (on the `INTEGER PRIMARY KEY` rowid) is relied on to pick the latest of multiple same-hash rows; `resume-read` does not re-sort.
- [ ] A branch-switch test proves context stored at commit A is restored at A and absent at B (no cross-branch contamination).
- [ ] All existing suites stay green; new `tests/scripts/resume-read.test.js` covers hit/miss/invalid/hash-stale/unlink-failure/sentinel-bypass/node-absent/branch-switch.

## Out of Scope

- Writing snapshots (owned by ARCH-008-A) and the schema/subcommands (ARCH-008-S1) — unchanged.
- `raw_history` / `history` consumption, timeline replay, or any multi-row aggregation — only the single newest `get-snapshot` row is read.
- Interactive "which snapshot?" selection or cross-commit merge — newest-row-for-current-hash only.
- Migrating or backfilling snapshots for commits predating ARCH-008-A.
- The legacy `.md` handoff format — removed here, not carried forward.
- `claude-mem` purge — already satisfied by `[BUG-020]`.

## System Impact

- **New:** `scripts/resume-read.mjs`, `tests/scripts/resume-read.test.js`.
- **Modified (phase-entry read block → `resume-read.mjs` call, legacy `.md` path removed):**
  - `.claude/commands/cc-spec.md`, `project-template/.claude/commands/cc-spec.md`
  - `.claude/commands/cc-plan.md`, `project-template/.claude/commands/cc-plan.md`
  - `.claude/commands/cc-implement.md`, `project-template/.claude/commands/cc-implement.md`
- **Modified (small companion changes):**
  - `scripts/snap-validate.mjs` — widen the `sys.c` regex `/^[0-9a-f]{7,40}$/` → `/^[0-9a-f]{7,64}$/` so a SHA-256 (64-char) `sys.c` validates; `tests/unit/snap-validate.test.js` gains a 64-char accept case (and the existing 41-char reject case is retargeted to 65-char).
  - `.claude/hooks/post-compact.sh` / `.ps1` and their `project-template/` mirrors — extend the existing temp sweep to also remove `.conductor/resume-validate.*.tmp.json` (one line beside the `session-id.*.tmp` sweep).
- **Reused unchanged:** `scripts/conductor-db.mjs` (`get-snapshot`), the `.conductor/last-write.log` trace sink, the Node-flag probe, and the hash-resolution rule (regex now `{40}|{64}`) — all from ARCH-008-A/S1.
- **Release closeout (gated, last):** bump `VERSION` / `package.json` / `package-lock.json` 1.21.0 → 1.22.0, prepend the `CHANGELOG.md` `[1.22.0]` entry tagged `[ARCH-008-B]`, and flip **both** the `[ARCH-008-B]` checkbox and the umbrella `[ARCH-008]` checkbox (all three sub-specs now `[X]`) in `AGENT-READABLE BACKLOG.md` (surgical single-line edits, BUG-003 invariant).

### Files Requiring Full Read (deferred to /cc-plan)

_None. `snap-validate.mjs`, `conductor-db.mjs` (`get-snapshot`), and the six command files are already understood from the ARCH-008-A/S1 work; `/cc-plan` will read the exact phase-entry line ranges before task breakdown._

## Complexity Estimate

**M** — one new ~80-line script reusing established patterns (hash resolve, Node-flag probe, snap-validate, trace log), plus six mechanical command-file edits and one hermetic child-process test suite with a git-backed branch-switch fixture. No schema, dependency, or writer changes.
