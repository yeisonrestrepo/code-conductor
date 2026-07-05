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

1. **Resolve hash** — `git rev-parse HEAD`, lowercased, matched against `/^[0-9a-f]{7,40}$/`; on non-zero exit, git-absent, zero-commit, or format mismatch, use the `"0000000"` sentinel. Shell `timeout` is applied only when the binary exists (same rule as the ARCH-008-A writers).
2. **Query the DB (non-destructive)** — run `conductor-db.mjs get-snapshot <hash>` under the Node-flag probe (no-flag-first → `--experimental-sqlite --no-warnings` → skip). It prints one blob line on a hit and zero bytes on a miss or on any degradation (Node < 22.5, `node:sqlite` absent, corrupt DB). `get-snapshot` returns the **newest** row for the hash (`ORDER BY id DESC LIMIT 1`) — a mid-work `/cc-checkpoint` (v2) written after a `/cc-compact` (v1) at the same commit therefore resumes the checkpoint blob; this is intentional and consistent with "DB wins."
3. **Bind by precedence:**
   - **DB hit + valid blob** → bind context from the DB blob (DB wins). Then, if the handoff file exists, delete it (it is redundant/superseded) — silent, best-effort. Emit the banner. Exit 0.
   - **DB miss/degrade, or DB blob invalid** → fall back to the handoff file: read its bytes **into memory first**, then validate; on valid, bind file context and **only then** unlink the file (capture-before-delete, so a failed unlink can never resurface stale context next cycle). Emit the banner. Exit 0.
   - **No usable context** → exit 3 (clean miss), no stdout; the command proceeds fresh.
4. **Surface (on any hit)** — one banner line, e.g. `> Resumed from stored snapshot @ <hash> (phase: plan)`. When the bound blob is v2 (carries `pr`), append a `(checkpoint prose available)` note; the phase, spec stem, and pending-step summary are printed as structured lines the command adopts as its starting context.
5. **Trace** — each evaluation and deletion step appends one diagnostic line to `.conductor/last-write.log` (`resume: db-hit @<hash>`, `resume: file-bind+unlink`, `resume: file-invalid halt`, `resume: miss`); never printed to the UI.

### Alternative paths

- **Branch switch to a commit with a stored snapshot** — `get-snapshot` matches the new HEAD's hash, hit, context restored. Switching to a commit *without* a snapshot yields a miss → fresh start. This is the cross-branch isolation guarantee: context from branch A never leaks into branch B.
- **DB tail never persisted (ARCH-008-A fail-open)** — `get-snapshot` misses; the handoff file (written unconditionally by `/cc-compact`) is the fallback and is bound + deleted. This is the normal same-session `spec → plan → implement` flow.
- **Both DB row and handoff file present** — DB wins; the handoff file is deleted unread.
- **v2 checkpoint blob restored** — sys/ops/mem bind as working context; `pr` is not dumped in full, only flagged as available.

### Error cases

- **Handoff file present but invalid / unreadable** (malformed JSON, `SNAP_UNKNOWN_VERSION`, `SNAP_INVALID`, I/O error) on the fallback branch → **halt** (exit 4), leave the file on disk for manual inspection. This preserves `cc-implement`'s existing corrupt-handoff safety gate; a corrupt authoritative handoff must not be silently discarded. (A DB blob that fails validation does **not** halt — the DB is best-effort, so it degrades to the file/miss path.)
- **Unlink fails** (Windows AV/reader lock, EACCES/EPERM) → swallowed silently; the orphaned file is swept at the next compaction boundary by the ARCH-008-A `post-compact` hook. Phase entry never aborts on an unlink failure.
- **`node` binary absent** when the command tries to run `resume-read.mjs` → the command falls back to today's fresh-start behavior (the resume-read is an enhancement, not a prerequisite).

## Acceptance Criteria

- [ ] `scripts/resume-read.mjs` exists, is zero-dependency, and runs flag-free on any Node ≥ 14 (the `--experimental-sqlite` probe is confined to the `conductor-db` sub-call, exactly as in ARCH-008-A).
- [ ] On a DB hit with a valid blob, the script binds DB context, deletes the handoff file if present, prints the banner, and exits 0.
- [ ] On a DB miss with a valid handoff file, the script reads the bytes into memory, binds, then unlinks the file, prints the banner, exits 0.
- [ ] On a DB miss with an **invalid** handoff file, the script exits 4 and leaves the file on disk.
- [ ] On a total miss (no DB row, no handoff file), the script exits 3 with no stdout.
- [ ] Deletion of the handoff file occurs on **both** the DB-hit and DB-miss-valid paths; the DB-hit path never binds the file.
- [ ] Unlink failures are caught and non-fatal; the script never throws.
- [ ] The DB `get-snapshot` read is non-destructive (repeatable across successive branch switches).
- [ ] Both the DB blob and the handoff file are validated through `snap-validate.mjs`; no schema logic is duplicated in `resume-read.mjs`.
- [ ] `cc-spec`, `cc-plan`, and `cc-implement` phase-entry blocks (all six mirror files) call `resume-read.mjs` and adopt its output; the legacy `.md` handoff path is removed from all three.
- [ ] A branch-switch test proves context stored at commit A is restored at A and absent at B (no cross-branch contamination).
- [ ] All existing suites stay green; new `tests/scripts/resume-read.test.js` covers hit/miss/invalid/unlink-failure/branch-switch.

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
- **Reused unchanged:** `scripts/snap-validate.mjs` (v1+v2 validation), `scripts/conductor-db.mjs` (`get-snapshot`), the `.conductor/last-write.log` trace sink, the Node-flag probe, and the full-40 hash-resolution rule — all from ARCH-008-A/S1.
- **Release closeout (gated, last):** bump `VERSION` / `package.json` / `package-lock.json` 1.21.0 → 1.22.0, prepend the `CHANGELOG.md` `[1.22.0]` entry tagged `[ARCH-008-B]`, and flip **both** the `[ARCH-008-B]` checkbox and the umbrella `[ARCH-008]` checkbox (all three sub-specs now `[X]`) in `AGENT-READABLE BACKLOG.md` (surgical single-line edits, BUG-003 invariant).

### Files Requiring Full Read (deferred to /cc-plan)

_None. `snap-validate.mjs`, `conductor-db.mjs` (`get-snapshot`), and the six command files are already understood from the ARCH-008-A/S1 work; `/cc-plan` will read the exact phase-entry line ranges before task breakdown._

## Complexity Estimate

**M** — one new ~80-line script reusing established patterns (hash resolve, Node-flag probe, snap-validate, trace log), plus six mechanical command-file edits and one hermetic child-process test suite with a git-backed branch-switch fixture. No schema, dependency, or writer changes.
