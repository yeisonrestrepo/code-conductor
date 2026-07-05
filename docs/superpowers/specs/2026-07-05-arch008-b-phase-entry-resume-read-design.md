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

1. **Resolve hash** — `git rev-parse HEAD` via Node's `execFileSync('git', ['rev-parse','HEAD'], { encoding:'utf8', timeout: 2000, stdio: ['ignore','pipe','ignore'] })`, trimmed and lowercased, matched against `/^[0-9a-f]{7,40}$/`; on non-zero exit, git-absent (`ENOENT`), zero-commit, timeout, or format mismatch, use the `"0000000"` sentinel. The 2000 ms timeout is a **Node-level child timeout**, not the GNU `timeout` binary — it is portable to native Windows PowerShell and Git Bash alike, so `resume-read.mjs` never depends on GNU coreutils. git's stderr is routed to `stdio[2] = 'ignore'` so no git diagnostic (`fatal: not a git repository`, `fatal: ambiguous argument 'HEAD'`) ever reaches the terminal.
2. **Sentinel bypass** — if the resolved hash is the `"0000000"` sentinel, **skip the DB query entirely** and go straight to the handoff-file branch (step 3, miss path). A sentinel is a shared key across every non-git / zero-commit context, so a `get-snapshot "0000000"` would collide with unrelated sessions' sentinel-keyed rows; the session-local handoff file is the only safe source there. Trace: `resume: sentinel-bypass`.
3. **Query the DB (non-destructive)** — otherwise run `conductor-db.mjs get-snapshot <hash>` under the Node-flag probe (no-flag-first → `--experimental-sqlite --no-warnings` → skip). It prints one blob line on a hit and zero bytes on a miss or on any degradation (Node < 22.5, `node:sqlite` absent, corrupt DB). `get-snapshot` returns the **newest** row for the hash (`ORDER BY id DESC LIMIT 1`) — a mid-work `/cc-checkpoint` (v2) written after a `/cc-compact` (v1) at the same commit therefore resumes the checkpoint blob; this is intentional and consistent with "DB wins."
4. **Bind by precedence:**
   - **DB hit + valid blob** → bind context from the DB blob (DB wins). Then, if the handoff file exists, delete it (it is redundant/superseded) — silent, best-effort. Emit the hit block. Exit 0. Trace: `resume: db-hit @<hash>`.
   - **DB blob present but fails validation** → the DB is best-effort, so **degrade** (do not halt): fall through to the handoff-file branch. Trace: `resume: db-invalid degrade`.
   - **DB miss/degrade/bypass** → fall back to the handoff file: read its bytes **into memory first**, then validate:
     - **structurally invalid / unreadable** → **halt** (exit 4), leave the file on disk. Trace: `resume: file-invalid halt`.
     - **valid but `sys.c` ≠ the current resolved hash** → the file is a stale remnant of a prior commit (e.g. left behind by an earlier failed unlink); **do not bind it**. Best-effort delete it and degrade to a clean miss (exit 3). Trace: `resume: file-stale-hash degrade`. (When both the file's `sys.c` and the current hash are the `"0000000"` sentinel they match, so a legitimate non-git handoff still binds.)
     - **valid and `sys.c` matches** → bind file context and **only then** unlink the file (capture-before-delete, so a failed unlink can never resurface stale context next cycle). Emit the hit block. Exit 0. Trace: `resume: file-bind+unlink`.
   - **No usable context** → exit 3 (clean miss), **zero bytes on stdout** (not even a trailing newline); the command proceeds fresh. Trace: `resume: miss`.
5. **Legacy `.md` sweep** — if a legacy `.claude/memory/session-snapshot.md` is found at any point, delete it unread (best-effort, silent); it is never bound. This completes the v1.18.0 deprecation. Trace: `resume: legacy-md-swept`.
6. **Surface (on any hit)** — stdout carries a stable machine-readable block (see *Stdout contract* below) that the command adopts as its starting context; the command then echoes one human banner to the UI, e.g. `> Resumed from stored snapshot @ <hash> (phase: plan)`, adding `(checkpoint prose available)` when the block reports `prose: available`.
7. **Trace** — every evaluation and deletion step appends one diagnostic line to `.conductor/last-write.log` (vocabulary: `resume: db-hit`, `resume: db-invalid degrade`, `resume: file-bind+unlink`, `resume: file-invalid halt`, `resume: file-stale-hash degrade`, `resume: sentinel-bypass`, `resume: legacy-md-swept`, `resume: miss`); never printed to the UI.

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

### Shell capture syntax (command files)

The six command files are agent-interpreted prose, not literal scripts, but they specify one canonical capture form per platform so the phase command reliably reads the block and the exit code:

- **Unix / Git Bash:** `resume_out="$(node scripts/resume-read.mjs 2>>.conductor/last-write.log)"; resume_rc=$?`
- **PowerShell:** `$resume_out = node scripts/resume-read.mjs 2>> .conductor/last-write.log; $resume_rc = $LASTEXITCODE`

The command then branches on `resume_rc`: `0` → parse the `RESUME_HIT` block and adopt it (+ echo the banner); `3` → proceed fresh (empty capture); `4` → halt for manual inspection (corrupt handoff).

### Alternative paths

- **Branch switch to a commit with a stored snapshot** — `get-snapshot` matches the new HEAD's hash, hit, context restored. Switching to a commit *without* a snapshot yields a miss → fresh start. This is the cross-branch isolation guarantee: context from branch A never leaks into branch B.
- **DB tail never persisted (ARCH-008-A fail-open)** — `get-snapshot` misses; the handoff file (written unconditionally by `/cc-compact`) is the fallback and is bound + deleted. This is the normal same-session `spec → plan → implement` flow.
- **Both DB row and handoff file present** — DB wins; the handoff file is deleted unread.
- **v2 checkpoint blob restored** — sys/ops/mem bind as working context; `pr` is not dumped in full, only flagged as available.

### Error cases

- **Handoff file present but invalid / unreadable** (malformed JSON, `SNAP_UNKNOWN_VERSION`, `SNAP_INVALID`, I/O error) on the fallback branch → **halt** (exit 4), leave the file on disk for manual inspection. This preserves `cc-implement`'s existing corrupt-handoff safety gate; a corrupt authoritative handoff must not be silently discarded. (A DB blob that fails validation does **not** halt — the DB is best-effort, so it degrades to the file/miss path.)
- **Handoff file valid but hash-stale** (`sys.c` ≠ current HEAD — a remnant of a prior commit left by a failed unlink) → not bound; best-effort re-delete + degrade to a clean miss (exit 3). This is the guard against stale context floating in after an unlink failure.
- **Unlink fails** (Windows AV/reader lock, EACCES/EPERM) → swallowed silently; the orphaned file is swept at the next compaction boundary by the ARCH-008-A `post-compact` hook, and the hash-stale guard above prevents it being bound in the interim. Phase entry never aborts on an unlink failure.
- **`node` binary absent** when the command tries to run `resume-read.mjs` → the command falls back to today's fresh-start behavior (the resume-read is an enhancement, not a prerequisite).
- **git slow / hung** (slow disk, network filesystem) → the 2000 ms Node child timeout fires, `execFileSync` throws, the hash resolves to the `"0000000"` sentinel → sentinel-bypass → file branch. Phase entry never hangs on git.

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
- [ ] A branch-switch test proves context stored at commit A is restored at A and absent at B (no cross-branch contamination).
- [ ] All existing suites stay green; new `tests/scripts/resume-read.test.js` covers hit/miss/invalid/hash-stale/unlink-failure/sentinel-bypass/branch-switch.

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
