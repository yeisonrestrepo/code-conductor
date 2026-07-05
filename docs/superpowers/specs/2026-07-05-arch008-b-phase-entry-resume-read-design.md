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

1. **Resolve hash** — `git rev-parse HEAD` via Node's `execFileSync('git', ['rev-parse','HEAD'], { encoding:'utf8', timeout: 2000, stdio: ['ignore','pipe','ignore'] })`, wrapped in `try/catch`. `execFileSync` **throws** on git-absent (`ENOENT`), non-zero exit (non-repo / zero-commit → `fatal:`), and the 2000 ms timeout (`ETIMEDOUT`, `SIGTERM`) — every one of these is caught by the same `catch`, which falls back to the `"0000000"` sentinel. A successful result is trimmed, lowercased, and matched against `/^[0-9a-f]{7,40}$/`; a format mismatch also yields the sentinel. The 2000 ms timeout is a **Node-level child timeout**, not the GNU `timeout` binary — portable to native Windows PowerShell and Git Bash alike, so `resume-read.mjs` never depends on GNU coreutils. git's stderr is routed to `stdio[2] = 'ignore'` so no git diagnostic (`fatal: not a git repository`, `fatal: ambiguous argument 'HEAD'`) ever reaches the terminal, and any that `execFileSync` surfaces in the thrown error is discarded inside the catch.
2. **DB-query gate (exact-40 only)** — the DB is queried **only** when the resolved hash matches `/^[0-9a-f]{40}$/` (exactly forty hex). The `snapshots` table is keyed by the writers' full-40 `git rev-parse HEAD`, and `get-snapshot` does an exact-equality lookup (`WHERE git_commit_hash = $h`) — the engine performs **no** abbreviated/prefix matching, so a short or sentinel hash could never hit a stored full-40 key anyway. Any non-40 value — the `"0000000"` sentinel, or any abbreviated form — therefore **bypasses the DB entirely** and goes straight to the handoff-file branch (step 4, miss path). This also closes the sentinel-collision hole: `"0000000"` is a key shared by every non-git context, so querying it would risk binding an unrelated session's row; the session-local handoff file is the only safe source there. Trace: `resume: sentinel-bypass` (sentinel) or `resume: nonfull-hash-bypass` (other non-40).
3. **Query the DB (non-destructive)** — for an exact-40 hash, run `conductor-db.mjs get-snapshot <hash>` under the Node-flag probe (no-flag-first → `--experimental-sqlite --no-warnings` → skip), each child spawned with an explicit **5000 ms Node-level `spawnSync` timeout**. It prints one blob line on a hit and zero bytes on a miss or on any degradation (Node < 22.5, `node:sqlite` absent, corrupt DB). A spawn that times out, is killed, or exits non-zero is treated as a **miss/degrade** (empty blob → fall to the file branch), so a DB lock or corruption can never hang phase entry. An **absent, uninitialized, or schema-less DB** (no `.conductor/cache.db`, or a file lacking the `snapshots` table) is handled entirely inside `conductor-db` (fail-open: it self-initializes or degrades, prints zero bytes to stdout, exits 0) — `resume-read` simply sees empty output and treats it as a miss. `conductor-db`'s child **stdout and stderr are both captured by the `spawnSync` pipe** (not inherited), so any `CONDUCTOR_DB:` degradation line is routed to the trace log, never the terminal. `get-snapshot` returns the **newest** row for the hash (`ORDER BY id DESC LIMIT 1`) — a mid-work `/cc-checkpoint` (v2) written after a `/cc-compact` (v1) at the same commit therefore resumes the checkpoint blob; this is intentional and consistent with "DB wins."
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
7. **Trace** — every evaluation and deletion step is written **directly by the script** via synchronous `appendFileSync('.conductor/last-write.log', line, { flag: 'a' })` (after a best-effort `mkdirSync('.conductor', { recursive: true })`), never via stderr. Traces do **not** ride the shell's `2>>` redirect: the script owns its log destination unconditionally, so a command that forgets the redirect still logs, and there is no double-write or destination conflict. The synchronous append with the `'a'` flag maps to a single `O_APPEND` write per line, which the OS serializes — so two concurrent phase entries never interleave or truncate each other's trace. Every append is wrapped in `try/catch` (best-effort; a locked/inaccessible log never aborts phase entry). Vocabulary: `resume: db-hit`, `resume: db-invalid degrade`, `resume: file-bind+unlink`, `resume: file-invalid halt`, `resume: file-stale-hash degrade`, `resume: sentinel-bypass`, `resume: nonfull-hash-bypass`, `resume: legacy-md-swept`, `resume: miss`. stderr is reserved exclusively for the exit-4 halt reason; stdout is reserved exclusively for the `RESUME_HIT` block.

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

**Emitter/parser boundary rules.** The script emits **`\n`-only** line separators and **no trailing blank line** (the final byte is the newline after the last content line). The phase-command parser is nonetheless tolerant, so a CRLF-injecting PowerShell pipeline or a stray blank line never breaks it: (1) split the captured text on `\n`; (2) strip a trailing `\r` from every line (CRLF-safe); (3) drop any leading/trailing wholly-blank lines; (4) require `lines[0].trim() === 'RESUME_HIT'` — anything else is treated as a miss; (5) `key: value` lines split on the **first** `': '` with both sides trimmed; (6) the `pending:` block is every subsequent line matching `^\s*-\s+` up to EOF or the first blank line, each item’s capture trimmed. Unknown keys are ignored (forward-compatible).

The `prose:` value is derived from exactly one JSON key — the **top-level `pr`** field of the SNAP v2 schema: `prose: available` iff `typeof snap.pr === 'string' && snap.pr.length > 0`, else `prose: none` (all v1 blobs, which have no `pr`, report `none`). `version:` is `snap.v`; `phase:` is `snap.sys.ph`; `spec:` is `snap.sys.s`; `commit:` is the resolved hash; `pending:` items are `snap.ops.n`.

### Paths and validation mechanism

- **Every path is resolved against the discovered project `root`, never the current working directory.** `HANDOFF`, `LEGACY_MD`, the `.conductor/` directory, `.conductor/last-write.log`, and the validation temp are all `join(root, …)`. This is essential because a phase command may be invoked from a nested subdirectory; a CWD-relative `.conductor/last-write.log` would scatter logs (and worse, split the session-id/snapshot state) across subdirectories. `root` is resolved once at startup with the same git-toplevel → bounded `.git` upward walk → script-parent fallback as `session-id.mjs`.
- **Handoff file** — a single module constant `HANDOFF = join(root, '.claude/memory/session-snapshot.json')` is the *only* spelling of the path, reused verbatim in every operational branch (existence check, capture-read, validation, unlink, hash-stale re-delete). **Legacy** `LEGACY_MD = join(root, '.claude/memory/session-snapshot.md')` is used only by the sweep.
- **Validation temp** — `join(root, '.conductor', 'resume-validate.' + process.pid + '.tmp.json')`. The uniqueness token is explicitly `process.pid` (a positive integer on every platform Node supports), so concurrent phase entries never collide and the filename is portable — no `os`/random dependency.
- **Validation reuses `snap-validate.mjs` unchanged** — which validates a **file path only** (it `readFileSync`s `argv[2]`; it has no stdin or in-memory-string surface). `resume-read` keys the pass/fail decision **solely off the child's exit code**: `snap-validate` exits `0` for a valid blob and `1` for any failure (writing a `SNAP_ERROR: …` line to stderr and nothing to stdout). So `spawnSync(...).status === 0` ⇒ valid; any non-zero (or a null status from spawn failure/timeout) ⇒ invalid. `resume-read` does **not** parse `snap-validate`'s stderr text — a non-zero exit is sufficient (DB blob → degrade; handoff file → halt exit 4, which subsumes both `SNAP_INVALID` and `SNAP_UNKNOWN_VERSION`). So:
  - The **handoff file** is validated at its own `HANDOFF` path (it already exists on disk). Capture-before-delete still holds: its bytes are read into memory for *binding* first; validation reads the same path; the unlink happens only after both.
  - The **DB blob** (an in-memory string with no path) is written to a temp file `join(root, '.conductor', 'resume-validate.<pid>.tmp.json')`, validated by spawning `snap-validate.mjs` against that temp. The temp `writeFileSync` is itself wrapped: a filesystem error (`EACCES`, `ENOSPC`, `EROFS`, read-only `.conductor`) is caught and **degrades the DB blob to unusable** — the script falls through to the file branch rather than crashing. The temp `unlinkSync` runs in a **`try/finally`** so the temp is removed even when validation (or the write) throws — no accumulation of `resume-validate.*.tmp.json` on a validation failure. Both the write-catch and the finally-unlink are silent/best-effort. No validation logic is duplicated or rewritten.

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

The command then branches on `resume_rc`:
- **`0`** → parse the `RESUME_HIT` block and adopt it (+ echo the banner).
- **`3`** → proceed fresh (empty capture — covers a true miss, a bypass, and an absent `node`).
- **`4`** → **operational halt.** The command MUST stop phase entry immediately: it does **not** run the phase's normal work, and instead emits a single halt line to the user — `SNAP_INVALID: corrupt handoff at .claude/memory/session-snapshot.json — inspect or remove it, then re-run.` — and enters standby awaiting user action. This is the same halt contract `cc-implement` already uses for `SNAP_INVALID` / `SNAP_UNKNOWN_VERSION`; exit 4 simply routes into it. The corrupt file is left on disk (the script did not delete it).

**PowerShell multi-line capture:** `$resume_out = node …` binds a **`string[]` array** when the script prints multiple lines (PowerShell splits native-command stdout on newlines), a single string for one line, and `$null` for zero output. The command normalizes before parsing: treat `$resume_out` as the line array directly (`$lines = @($resume_out)`) — `$lines[0]` is the `RESUME_HIT` sentinel, subsequent entries are the `key: value` / `- item` lines — or equivalently `($resume_out -join "\`n")` to reconstruct the block. A `$null`/empty `$resume_out` with `resume_rc = 3` is a miss. The Unix form captures the whole block as one newline-delimited string and splits on `\n`.

The `2>>` redirect only sinks any incidental stderr (the exit-4 halt reason) away from the UI; it is **not** the trace channel — the script writes traces itself via `appendFileSync` (see step 7), so the two never conflict.

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
- [ ] The DB blob is validated by writing it to a `.conductor/resume-validate.<pid>.tmp.json` temp and spawning the unmodified `snap-validate.mjs`; the handoff file is validated at its own path; the temp is unlinked best-effort. `snap-validate.mjs` is not modified.
- [ ] `node` absence is probed by each command (`command -v node` / `Get-Command node`) and treated as a clean miss (`resume_rc=3`), never a terminating error — verified for the PowerShell mirror by inspection.
- [ ] `prose: available|none` is derived solely from the top-level `pr` key (`available` iff a non-empty string), and `version:` from `snap.v`.
- [ ] The handoff path is a single `HANDOFF` constant reused across the existence-check, capture-read, validation, unlink, and hash-stale branches; no path string is duplicated inline.
- [ ] The git resolution `try/catch` demonstrably catches `ENOENT` (git absent), non-zero exit, and `ETIMEDOUT`/`SIGTERM` (timeout), each falling back to `"0000000"`.
- [ ] The DB is queried only when the resolved hash matches `/^[0-9a-f]{40}$/`; the sentinel and any non-40 value bypass the DB (no abbreviated lookup is ever attempted).
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
- **Reused unchanged:** `scripts/snap-validate.mjs` (v1+v2 validation), `scripts/conductor-db.mjs` (`get-snapshot`), the `.conductor/last-write.log` trace sink, the Node-flag probe, and the full-40 hash-resolution rule — all from ARCH-008-A/S1.
- **Release closeout (gated, last):** bump `VERSION` / `package.json` / `package-lock.json` 1.21.0 → 1.22.0, prepend the `CHANGELOG.md` `[1.22.0]` entry tagged `[ARCH-008-B]`, and flip **both** the `[ARCH-008-B]` checkbox and the umbrella `[ARCH-008]` checkbox (all three sub-specs now `[X]`) in `AGENT-READABLE BACKLOG.md` (surgical single-line edits, BUG-003 invariant).

### Files Requiring Full Read (deferred to /cc-plan)

_None. `snap-validate.mjs`, `conductor-db.mjs` (`get-snapshot`), and the six command files are already understood from the ARCH-008-A/S1 work; `/cc-plan` will read the exact phase-entry line ranges before task breakdown._

## Complexity Estimate

**M** — one new ~80-line script reusing established patterns (hash resolve, Node-flag probe, snap-validate, trace log), plus six mechanical command-file edits and one hermetic child-process test suite with a git-backed branch-switch fixture. No schema, dependency, or writer changes.
