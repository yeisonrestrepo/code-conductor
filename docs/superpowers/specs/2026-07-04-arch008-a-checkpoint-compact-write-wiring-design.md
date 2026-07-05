# ARCH-008-A — Checkpoint/Compact Write Wiring

**Status:** Draft (awaiting approval)
**Date:** 2026-07-04
**Depends on:** `[ARCH-008-S1]` (shipped v1.20.0)
**Successor:** `[ARCH-008-B]` (phase-entry resume read)

## Problem

`[ARCH-008-S1]` shipped the relational storage substrate — `sessions` / `snapshots` /
`raw_history` tables plus the `session` / `snapshot` subcommands in
`scripts/conductor-db.mjs` — but **no consumer writes to it**. `/cc-compact` still only
writes the `.claude/memory/session-snapshot.json` handoff file, and `/cc-checkpoint` only
appends prose to `project.md`. Without a writer, the git-hash-indexed store stays empty, so
the umbrella ARCH-008 goal (reload agent awareness by matching DB state to the current git
commit) has nothing to read. This spec wires the two write-side commands so every checkpoint
and compaction persists a `sessions` upsert and one `snapshots` row keyed by the current git
commit hash.

## Solution

Add two zero-dependency helper scripts and rewire the two global commands. `scripts/session-id.mjs`
resolves a stable per-session identifier (`$CLAUDE_CODE_SESSION_ID`, else a cached fallback,
else a fresh `crypto.randomUUID()`). `scripts/snap-build.mjs` becomes the single canonical
SNAP serializer: it emits strict **SNAP v1** for compactions (no prose) and **SNAP v2** — a
v1 superset with one optional top-level `pr` (prose) property — for checkpoints. `scripts/snap-validate.mjs`
is extended to accept `v ∈ {1, 2}` with `pr` strictly optional, leaving every v1 rule
byte-identical. `/cc-compact` and `/cc-checkpoint` each perform their existing authoritative
write first (the handoff file / `project.md`), then run a **best-effort, synchronous,
fail-open DB tail** that resolves the session id, builds the SNAP blob, and calls
`conductor-db session` + `conductor-db snapshot` through the same Node-flag probe the
`cc-implement` Step 6 hook already uses. Any failure in the tail is non-fatal and never
blocks or reverts the authoritative write.

## Pre-Flight Analysis (critical-review Phase 1)

**Happy path:** In a Claude Code session on a committed repo, `/cc-checkpoint` appends to
`project.md`, then resolves `$CLAUDE_CODE_SESSION_ID`, builds a v2 blob (prose in `pr`), and
synchronously upserts one `sessions` row + inserts one `snapshots` row keyed by the short git
hash; `/cc-compact` writes the v1 handoff file, then persists the matching v1 blob to the DB.

**Failure points:**
- `node:sqlite` absent / Node < 22.5 → `conductor-db` degrades (one `CONDUCTOR_DB:` line,
  exit 0); the tail swallows it and the authoritative write stands.
- `$CLAUDE_CODE_SESSION_ID` unset (command run outside Claude Code) → fallback cache, else
  generated UUID; never empty.
- Malformed stdin into `snap-build` → non-zero exit, no output, DB write skipped, command
  continues.
- Over-cap prose (v2 blob > 10 MiB) → `pr` truncated predictably before the DB write.
- Repo path contains spaces → all three `conductor-db` args and the PowerShell cache-clear
  path are double-quoted.

**Boundary conditions:** non-git workspace / no commits → `sys.c` and the hash key both use
`"0000000"` (valid under both schemas); empty prose → v1 (not v2); concurrent
checkpoint-then-compact on one commit → two `snapshots` rows, `get-snapshot` returns the
newest (`ORDER BY id DESC`); `pr` with embedded quotes/newlines/emoji → raw-value truncation
+ re-serialize keeps JSON structurally valid.

## Behavior

### Main path

**`scripts/session-id.mjs`** (zero-dep, any Node ≥ 14; prints one line, exit 0):
1. Read `$CLAUDE_CODE_SESSION_ID`; trim. If non-empty → print it and exit. *(Primary path is
   cacheless: the env var is unique per session and identical across every invocation, so
   consecutive commands in one session bind to the same `sessions` row and cross-session
   leakage is impossible.)*
2. Else read `<repo-root>/.conductor/session-id`; if present and non-empty → print it, exit.
3. Else generate `crypto.randomUUID()`, best-effort write it to `.conductor/session-id`
   (create `.conductor/` if needed; `.conductor/` is already gitignored), print it, exit.
4. Any I/O error is non-fatal: a value is always printed (fall back to a fresh in-memory
   UUID if the cache cannot be read or written).

**`scripts/snap-build.mjs`** (zero-dep, any Node ≥ 14; reads one JSON object on stdin, prints
the canonical single-line SNAP JSON, exit 0 on success):
- Input keys: `ph`, `c`, `s` (scalars), `n`, `f`, `d`, `x` (arrays), `pr` (optional string).
- Array normalization (identical to the retired cc-compact prose rules): filter
  empty/whitespace-only, dedup by exact string equality (first wins), truncate each element to
  its per-field cap, then head-drop (oldest first) until the array fits its element-count cap
  (`ops.n≤3`, `ops.f≤20`, `mem.d≤10`, `mem.x≤5`; element caps 200/300/300/200).
- **Version selection:** if `pr` is absent or empty → emit **v1** `{v:1, sys, ops, mem}`
  (byte-identical to today's compaction blob). If `pr` is a non-empty string → emit **v2**
  `{v:2, sys, ops, mem, pr}`.
- **Size cap by mode:** v1 → 4096 chars (drop oldest of `mem.d`/`ops.f` and re-serialize until
  it fits, matching the handoff-file contract). v2 → 10 MiB bytes
  (`MAX_SNAP_BYTES = 10485760`): truncate the **raw `pr` string value before serialization**
  via **index-based `pr.slice(0, n)`** (no `Array.from`, no spread — avoids call-stack and
  10 MiB code-point-array reallocation), using a **binary search on `n`** against
  `Buffer.byteLength(JSON.stringify(obj), 'utf8')`, backing off one UTF-16 unit if the cut
  lands on a lone high surrogate. Re-serializing after each raw-value cut guarantees the
  emitted JSON is always structurally valid and correctly accounts for stringify escaping.

**`/cc-compact`** (edited): unchanged authoritative behavior first — derive `sys.c`
(`git rev-parse --short HEAD`, `/^[0-9a-f]{7}$/`, `"0000000"` fallback), gather `ph/s/n/f/d/x`
from context, pipe them (no `pr`) to `snap-build.mjs` → v1 line, write it to
`.claude/memory/session-snapshot.json`, delete any legacy `.md`, idempotently gitignore the
`.json`. **If that file write fails, stop — do not run the DB tail and do not print the
compact prompt** (unchanged). Then the **fail-open DB tail** (synchronous): resolve the id via
`session-id.mjs`, and via the Node-flag probe run `conductor-db.mjs session "<id>" "<ph>"
"<s>" "<c>"` and `conductor-db.mjs snapshot "<c>"` (v1 blob piped on stdin). Finally print the
existing `> Snapshot written. Run /compact now to clear history.` line regardless of the
tail's outcome.

**`/cc-checkpoint`** (edited): unchanged authoritative behavior first — append the timestamped
`## Checkpoint` section to `project.md` (and `personal.md`). Then the **fail-open DB tail**
(synchronous): derive `sys.c` (same short-hash rule), resolve the id, build a **v2** blob by
piping to `snap-build.mjs` with `pr` = the checkpoint prose block just written to `project.md`
and compaction-only fields defaulted (`n=[]`, `f=[]`, `ph`=current/last phase or `"impl"`,
`s`=`"none"` when no active spec, `d`/`x` mapped from the checkpoint's decisions/constraints
where available). Run `conductor-db.mjs session ...` + `conductor-db.mjs snapshot "<c>"` (v2
blob on stdin). Report the checkpoint as usual regardless of the tail's outcome.

**`scripts/snap-validate.mjs`** (edited, backward-compatible):
- Accept `v ∈ {1, 2}`; `v > 2` → `SNAP_UNKNOWN_VERSION` (unchanged single-tier error prefix).
- Top-level allowed keys are **version-aware**: v1 → `{v, sys, ops, mem}` (unchanged — still
  rejects `pr`); v2 → additionally allows `pr`.
- `pr` is **strictly optional**: a v2 blob without `pr` is valid. When present, `pr` must be a
  string; **no dedicated length cap** — it is bounded transitively by the existing 4096-char
  overall file cap (large prose never reaches the file validator; it lives only in the DB
  under `conductor-db`'s 10 MiB cap).
- Every v1 rule is untouched: sub-block key allow-lists, `sys.ph ∈ {spec,plan,impl,rev}`,
  array caps, `ops.f` action-code check, and the `sys.c` `/^[0-9a-f]{7}$/` test — under which
  `"0000000"` is valid for **both** schemas.

### Alternative paths

- **No `$CLAUDE_CODE_SESSION_ID`:** fallback cache then generated UUID (above). The cache is
  invalidated by the `post-compact` hook (below), bounding its lifetime to one pre-compact
  window.
- **Empty prose at checkpoint:** `snap-build` emits v1 (not v2); still a valid snapshot row.
- **Non-git workspace / no commits:** `sys.c` and the snapshot/session hash key both use
  `"0000000"`; the row is stored under that sentinel.
- **Repeated compaction/checkpoint on one commit:** each writes its own append-only
  `snapshots` row; `get-snapshot` (ARCH-008-B) returns the newest via `ORDER BY id DESC`.

### Error cases

- **`node:sqlite` absent / Node < 22.5:** `conductor-db` prints one `CONDUCTOR_DB:` line and
  exits 0; the tail treats it as best-effort and the authoritative write stands.
- **`snap-build` malformed input** (unparseable stdin, missing required scalar such as `sys.c`):
  writes a stderr diagnostic, **exits non-zero, emits nothing**; the caller skips the DB write
  and continues (fail-open).
- **`snap-build` over-cap v2 blob (> 10 MiB):** `pr` is truncated predictably (raw-value,
  index-sliced, binary-searched) so a valid blob is always emitted.
- **DB / pipeline failure inside `/cc-checkpoint` or `/cc-compact`:** the tail is fail-open —
  the `project.md` update (checkpoint) or the `session-snapshot.json` write + compact prompt
  (compact) proceed uninterrupted and are never reverted.
- **`post-compact` cache clear:** `.sh` uses `rm -f`; `.ps1` uses
  `Remove-Item -Force -ErrorAction SilentlyContinue` with the `Join-Path` result passed as a
  **literal double-quoted string** (space-safe repo paths). Each stays inside its hook's
  existing exit-0 guard, so a delete failure never crashes the hook.

## Acceptance Criteria

- [ ] `scripts/session-id.mjs` prints `$CLAUDE_CODE_SESSION_ID` when set; else the cached
      value; else a fresh `crypto.randomUUID()` (also written to `.conductor/session-id`);
      always prints exactly one non-empty line and exits 0.
- [ ] Consecutive invocations within one session return the same id (env-var path); the
      fallback cache returns a stable id across invocations until the `post-compact` hook
      clears it.
- [ ] `scripts/snap-build.mjs` emits strict **v1** (byte-identical to the current compaction
      blob) when no `pr` is given, and **v2** with a top-level `pr` when a non-empty prose
      string is given.
- [ ] `snap-build` v2 mode truncates the **raw `pr` value** (index-based slice + binary
      search on `Buffer.byteLength`, surrogate-safe) so the serialized blob is ≤ 10 MiB and
      always valid JSON; v1 mode enforces the 4096-char cap.
- [ ] `snap-build` exits non-zero with no stdout on malformed input; the caller skips the DB
      write.
- [ ] `scripts/snap-validate.mjs` accepts `v ∈ {1, 2}`, rejects `v > 2` with
      `SNAP_UNKNOWN_VERSION`, treats `pr` as optional (string-typed, no separate cap), keeps
      every v1 rule byte-identical, and validates `"0000000"` `sys.c` under both schemas. All
      43 existing validator tests stay green.
- [ ] `/cc-compact` writes the v1 handoff file first (authoritative; failure suppresses the DB
      tail and the compact prompt), then best-effort synchronously upserts one `sessions` row
      and inserts one `snapshots` row keyed by the short git hash; the compact prompt prints
      regardless of the tail outcome.
- [ ] `/cc-checkpoint` updates `project.md` first (authoritative), then best-effort
      synchronously writes one `sessions` upsert + one v2 `snapshots` row (prose in `pr`); DB
      failure never blocks or reverts the `project.md` update.
- [ ] Every `conductor-db` argument is double-quoted; the `post-compact.ps1` cache-clear path
      is double-quoted and uses `Remove-Item -Force -ErrorAction SilentlyContinue`.
- [ ] All new scripts have Vitest child-process (`spawnSync`) coverage; the repo-wide
      `npm test` gate is green.

## Out of Scope

- **Phase-entry resume reads** (`get-snapshot` on phase entry) — that is `[ARCH-008-B]`.
- **`raw_history` wiring** — no command writes raw logs in this spec.
- **Raising the 4096-char handoff-file cap** — large prose lives only in the DB (10 MiB).
- **New `sys.ph` enum values** (e.g. a dedicated `chk`) — checkpoints reuse the existing enum.
- **`project-template/.claude/commands/` copies of cc-compact/cc-checkpoint** — these are
  global commands; no template copies exist. (Only the mirrored `cc-implement` reader comment
  is touched, below.)
- **Pruning / retention / env DB-path override / foreign keys** — unchanged from S1.

## System Impact

- **New:** `scripts/session-id.mjs`, `scripts/snap-build.mjs`, and their Vitest suites under
  `tests/scripts/`.
- **Modified:** `scripts/snap-validate.mjs` (v2 + optional `pr`), `global/commands/cc-compact.md`,
  `global/commands/cc-checkpoint.md`, `.claude/hooks/post-compact.sh`,
  `.claude/hooks/post-compact.ps1` (+ their `project-template/.claude/hooks/` mirrors), one
  stale comment in `.claude/commands/cc-implement.md` and its `project-template` mirror
  (`Exit 0 already guarantees v === 1` → `v ∈ {1,2}`; readers bind only `sys/ops/mem` fields
  and ignore `pr`).
- **Reviewed, unchanged:** `scripts/conductor-db.mjs` — its `snapshot` subcommand already
  applies uniform constraints (10 MiB cap, strict UTF-8, non-empty) to both compaction- and
  checkpoint-derived payloads with no per-source branching; `engines.node` stays `>= 20`
  (the two new scripts need only `crypto`/`Buffer`, so they run flag-free on any Node; the
  Node-flag probe still gates only the `conductor-db` calls).
- **`.gitignore`:** no change — `.conductor/` already covers `.conductor/session-id`.

### Files Requiring Full Read (deferred to /cc-plan)

_None. `snap-validate.mjs` (30 lines), `cc-compact.md`, `cc-checkpoint.md`, `post-compact.sh`,
and the S1 `conductor-db.mjs` subcommands were all read within budget during design._

## Complexity Estimate

**L** — two new zero-dep scripts with their own test suites, a backward-compatible schema/
validator bump (SNAP v2), two command rewires onto a shared serializer, a cross-platform hook
one-liner, and a mirrored stale-comment correction; all writes are additive and fail-open, but
the surface spans scripts, commands, hooks, and the validator across both mirrors.
