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
- Repo path contains spaces → all `conductor-db` argv and the PowerShell cache-clear path are
  double-quoted.
- **ARG_MAX safety (Q2):** the ≤10 MiB SNAP blob is **exclusively piped via stdin** to
  `conductor-db snapshot`, whose only argv is the small hash scalar; likewise `session`/
  `get-session` carry only short scalars (id/ph/s/c). No large payload ever appears in argv, so
  the OS `ARG_MAX` / `MAX_ARG_STRLEN` per-argument ceiling can never be breached.

**Boundary conditions:** non-git workspace / no commits → `sys.c` and the hash key both use
`"0000000"` (valid under both schemas); empty prose → v1 (not v2); concurrent
checkpoint-then-compact on one commit → two `snapshots` rows, `get-snapshot` returns the
newest (`ORDER BY id DESC`); `pr` with embedded quotes/newlines/emoji → raw-value truncation
+ re-serialize keeps JSON structurally valid.

## Behavior

### Main path

**`scripts/session-id.mjs`** (zero-dep, any Node ≥ 14; prints one line, exit 0). **Root
resolution (Q2):** identical to `conductor-db.mjs` — `git rev-parse --show-toplevel`, else a
bounded `.git` upward walk from cwd (40-iteration cap, stops at fs root), else the script's own
`../` (it lives in `scripts/`, so `dirname(fileURLToPath(import.meta.url))/..`). The cache path
is always `<root>/.conductor/session-id`, so it is canonical regardless of how deeply nested the
invocation cwd is. Steps:
1. Read `$CLAUDE_CODE_SESSION_ID`; trim. If non-empty → print it and exit. *(Primary path is
   cacheless: the env var is unique per session and identical across every invocation, so
   consecutive commands in one session bind to the same `sessions` row and cross-session
   leakage is impossible.)*
2. Else read `<repo-root>/.conductor/session-id`; if present and non-empty → print it, exit.
3. Else generate `crypto.randomUUID()` and persist it **atomically (Q7)**: write to a
   same-dir temp file `.conductor/session-id.<pid>.tmp`, then `renameSync` it onto
   `.conductor/session-id` (create `.conductor/` first — it is already gitignored).
   **Concurrency guard:** the `renameSync` is wrapped in `try/catch`. On **any** rename error —
   `EEXIST` (POSIX concurrent winner) or Windows-specific **`EPERM`/`EACCES`** (the target briefly
   locked by another process — antivirus or a concurrent reader — common under multi-process
   execution) **(Q5)** — the script **re-reads** `.conductor/session-id`; if it is now present and
   non-empty, it adopts that id (**first-writer-wins**); otherwise it falls back to the in-memory
   UUID. It **never rethrows** the rename error, so rapid concurrent runs never corrupt the file,
   diverge onto different ids, or crash on a Windows lock. **Temp-file lifecycle (Q4):** on the
   happy path the temp is consumed by the rename; on any failure path the script best-effort
   `unlinkSync`s its own `session-id.<pid>.tmp` so it does not leak. As a backstop against temps
   orphaned by an abrupt process kill (between write and rename), the `post-compact` hook also
   sweeps `.conductor/session-id.*.tmp` (below), bounding any accumulation to one pre-compact
   window.
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
  `Buffer.byteLength(JSON.stringify(obj), 'utf8')`. **Surrogate-boundary guard (Q3-surr):** after
  the final `n` is chosen — for **both** the binary-search result and the fallback slice — if the
  last retained UTF-16 unit (`pr.charCodeAt(n−1)`) is a high surrogate (0xD800–0xDBFF), `n` is
  decremented by one so no half of a surrogate pair is ever retained at the truncation boundary.
  Re-serializing after each raw-value cut guarantees the emitted JSON is always structurally valid
  and correctly accounts for stringify escaping.
- **Bounded binary search (Q2 search):** the search is inherently `O(log₂(pr.length))` ≈ 24
  probes for a 10 MiB input, but is **hard-capped at 64 iterations** as a defensive stop.
  **Skeleton accounting (Q5):** `skeletonBytes` is computed once as
  `Buffer.byteLength(JSON.stringify({ ...fields, pr: '' }), 'utf8')` — this **already includes the
  full `,"pr":""` structural prefix** (the key, colon, and the two empty-value quote bytes). Each
  probe's total is then `skeletonBytes + Buffer.byteLength(JSON.stringify(prCandidate), 'utf8') − 2`,
  where the `− 2` removes the empty-string quotes already counted in the skeleton so the value's
  interior bytes are added exactly once. The `"pr":` key prefix is thus accounted for precisely,
  with no double-count, while re-stringifying only the candidate value (not the whole object) each
  probe. On the (monotonic-length-function-impossible) event of
  non-convergence within the cap, `snap-build` falls back to a **conservative byte-budget slice**:
  `keepChars = Math.max(0, Math.floor((MAX_SNAP_BYTES − skeletonBytes − 2) / 6))` then
  `pr.slice(0, keepChars)` (surrogate back-off). The **multiplier 6 (Q3)** is the worst-case
  UTF-8+JSON bytes per UTF-16 unit — a control char escapes to `\uXXXX` (6 bytes), the maximum
  single-unit stringify expansion; the `−2` reserves the enclosing quotes. The **`Math.max(0, …)`
  clamp (Q-neg) is mandatory**: a negative `keepChars` passed to `slice(0, negative)` would, by
  JS semantics, index **from the end** of `pr` (returning a near-whole or empty tail) rather than
  truncating — silently defeating the cap. Clamping to 0 guarantees a genuine prefix. This yields
  an under-cap valid blob in a single operation; CPU is bounded with no timeout needed.
- **Empty/zero-byte stdin (Q6):** `snap-build` reads a JSON **object** on stdin; a zero-byte or
  empty stream makes `JSON.parse` throw → treated as **malformed input → non-zero exit, no
  stdout** (the caller skips the DB write, fail-open). *(This is `snap-build`'s field-object
  input, distinct from `conductor-db snapshot`'s separate "content is empty" stdin check.)*
- **Flat→nested mapping (Q1 map):** the stdin object is flat; `snap-build` builds the nested SNAP
  object as `sys = {ph, c, s}`, `ops = {n, f}`, `mem = {d, x}`, with top-level `v` and optional
  `pr`. It reads **only** these whitelisted keys — **any extraneous stdin key is ignored and
  never copied to the output** (Q10), so the emitted blob always conforms to the schema and
  cannot leak an unexpected key that would fail `snap-validate`.
- **Version/`pr` invariant (Q9):** `snap-build` emits `v:2` **iff** a non-empty `pr` is
  supplied, and `v:1` otherwise — so `v` and `pr`-presence are equivalent, and there is never a
  snap-build-produced `v:2` blob lacking `pr`. `v` is the **sole** structural differentiator;
  downstream code needs no separate "is this really v2?" probe. (The validator still
  independently *accepts* a hand-written `v:2`-without-`pr` blob, per the strictly-optional rule.)
- **Non-`pr` fail-safe (Q5):** the truncation loop only ever shrinks `pr`. Before it runs,
  `snap-build` measures the serialized size of the `pr`-less skeleton (arrays already normalized
  and capped, so the skeleton is ~10 KB max); in the pathological event the skeleton alone
  exceeds its cap (4096 in v1, 10 MiB in v2), `snap-build` writes a stderr diagnostic, **exits
  non-zero, and emits nothing** — an unrecoverable input the caller skips (fail-open).

**`/cc-compact`** (edited): unchanged authoritative behavior first — derive `sys.c` (full-40
`git rev-parse HEAD`, lowercased, `/^[0-9a-f]{7,40}$/`, `"0000000"` fallback — see Hash
strategy), gather `ph/s/n/f/d/x`
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
(synchronous): derive `sys.c` (same full-40 Hash-strategy rule), resolve the id, and build a **v2** blob by
piping to `snap-build.mjs` with the following field derivation:
- **`pr` — prose capture (Q3):** the `pr` value is the **verbatim `## Checkpoint …` section body
  the command just composed and appended to `project.md`** — the same in-context string, captured
  before the DB tail runs (not read from CLI args; there are none). This guarantees `project.md`
  and the DB snapshot's `pr` are byte-identical. `pr` is therefore always non-empty for a real
  checkpoint, so the blob is always v2.
- **`ph` — phase without ambient state (Q2 phase):** run `conductor-db get-session "<id>"`
  **with a bounded outer execution timeout (Q5, ~5 s)** and reuse the returned row's `phase` if
  non-empty (carry-forward — the state lives in the DB row, not the process); if there is no prior
  row, its phase is empty, the DB is unavailable, **or the call times out under disk contention**,
  default to `"impl"` (the phase during which checkpoints are routinely taken; a valid enum
  member). The timeout ensures a contended DB never blocks the checkpoint. *(All DB-tail process
  calls — `get-session`, `session`, `snapshot` — carry the same bound; a timeout is a best-effort
  miss, never a block.)* **Timeout mechanism (Q7):** the realistic block source (a DB write lock)
  is already capped at 2 s by `conductor-db`'s internal `PRAGMA busy_timeout = 2000`; the outer
  ~5 s bound is defense-in-depth, enforced via **`spawnSync`'s native `timeout: 5000`** in the
  Vitest harness (SIGTERM on expiry → `status===null`/`signal` set → treated as best-effort
  failure) and via shell `timeout` in the command prose (best-effort — where `timeout` is
  unavailable, the 2 s `busy_timeout` still bounds real contention).
- **`d` / `x` — structured projection (Q4):** best-effort parse of the just-written section.
  Headings are matched by regex `/^#{2,4}[ \t]+(.+?)[ \t]*$/` and classified case-insensitively:
  the captured heading text is first **normalized (Q3-emphasis, Q5-ws)** — **all** `*`, `_`, and
  `` ` `` characters removed (not just surrounding pairs, so `** Decisions **` and `Dec*is*ions`
  both normalize cleanly), then leading/trailing whitespace `.trim()`-ed and lowercased — so
  `### **Technical Debt**` and `### _Decisions_` classify identically to their plain forms.
  Internal whitespace is intentionally **not** collapsed: the classification keywords are single
  contiguous words (`decision`/`convention`/`debt`/`workaround`/`limitation`) matched as
  substrings, so inter-word spacing never affects a match. Then, case-insensitively, a heading
  whose normalized
  text contains `decision` or `convention` opens a `d` block, and one containing `debt`,
  `workaround`, or `limitation` opens an `x` block. (Emphasis-stripping is applied to the heading
  **classification** only; bullet content is captured verbatim.) **Precedence (Q2):** the `d`
  (decision/convention) set is tested **first** and wins — a heading matching *both* keyword sets
  (e.g. "Decisions and Technical Debt") opens exactly one block, a `d` block; each heading opens at
  most one block. Within a block, bullet lines matching
  `/^[ \t]*[-*][ \t]+(\S.*?)[ \t]*$/` contribute their trimmed capture; non-bullet lines are
  ignored. This tolerates minor markdown variation (`-`/`*` bullets, extra whitespace, heading
  level 2–4). **Parent heading (Q1):** the `## Checkpoint …` heading matches the heading regex but
  its text contains none of the keywords, so it opens **no** block and **closes** any open one —
  bullets before the first `### Decisions`/`### Technical Debt` subheading are never captured (no
  false positives). **Multi-line bullets (Q4):** extraction is **line-based** — only the marker
  line's text enters `d`/`x`; wrapped continuation lines (indented, no marker) are ignored. The
  complete multi-line text always survives verbatim in `pr`. `snap-build` then dedups/caps
  (`d≤10×300`, `x≤5×200`). If the block is not cleanly structured, `d`/`x` may be empty arrays
  (valid) — the full verbatim block always lives in `pr`, the audit source of truth.
- **Defaults:** `n=[]`, `f=[]` (no compaction next-steps/files at checkpoint time), `s=`the active
  spec stem or `"none"`.

Run `conductor-db.mjs session ...` + `conductor-db.mjs snapshot "<c>"` (v2 blob on stdin). Report
the checkpoint as usual regardless of the tail's outcome.

**DB-tail output isolation (Q6, both commands):** the synchronous tail redirects the child
`session-id.mjs` / `snap-build.mjs` / `conductor-db.mjs` stdout **and** stderr to
`.conductor/last-write.log` (best-effort, overwritten each run, gitignored under `.conductor/`).
The lone `CONDUCTOR_DB:` degradation line therefore never reaches the Claude Code UI; the tail
surfaces nothing to the user while leaving a debug trail. **Explicitly (Q6-mute):** child stderr is
**fully suppressed from the terminal** — every DB-tail call redirects both streams to the log
(`> .conductor/last-write.log 2>&1`), and the command reports nothing from the tail's output (only
its exit is observed). It is **not** sent to `/dev/null`: the diagnostic is preserved in the log,
merely never printed to the user. **Directory precondition (Q1):** before **any** redirected
call, the tail ensures `.conductor/` exists (`mkdir -p .conductor` / PS
`New-Item -ItemType Directory -Force`, best-effort) so the `> .conductor/last-write.log`
redirection can never fail with a missing-path error; if that mkdir itself fails, the tail is
skipped (fail-open) rather than emitting a fatal redirect error.

**`last-write.log` concurrency (Q8):** the log is a **best-effort diagnostic**, not a
correctness artifact. It is written in **overwrite mode (`>`, not append)** and is **not
lock-synchronized** — interleaving or last-writer-wins is acceptable for a debug trail, and any
write/lock error is swallowed (non-fatal, like the rest of the tail). In the normal workflow
`/cc-checkpoint` and `/cc-compact` run **sequentially** (checkpoint before compact), so real
contention is rare; if strict per-run isolation is ever needed, a `.<pid>` suffix is the
follow-up. No lock is taken and no write-lock error can surface to the user.

**CLI argument quote-safety (Q3):** arbitrary content (`pr` / `snap_json`) is **never** placed in
argv — it is piped via **stdin** (the S1 ARG_MAX + injection-safety principle). The argv scalars
are passed as **double-quoted shell variable expansions** (`"$id"`, `"$ph"`, `"$s"`, `"$c"`);
inside double quotes the shell performs no word-splitting, globbing, or re-parsing of the value's
characters, so an embedded quote or space is inert. Every scalar source is additionally
constrained to a quote-free character set — `s` matches `[a-zA-Z0-9._-]`, `ph` is an enum, `c` is
`[0-9a-f]{7,40}`/`0000000`, and `id` is a UUID — so a double quote cannot occur in practice; the
double-quoted-expansion pattern is defense-in-depth.

**Node-flag probe scope (Q14):** the probe is **unchanged** and is applied **only** to the two
`conductor-db` calls (which import `node:sqlite`). `session-id.mjs` and `snap-build.mjs` import
nothing from `node:sqlite`, so they are invoked as plain `node scripts/<name>.mjs` — no flags, no
probe, any Node ≥ 14. No conditional-logic change to the probe is required.

**Node invocation (Q5):** the command prose uses **bare `node`** (relying on PATH), matching the
existing `cc-implement` Step 6 hook and the probe itself — Claude Code is a Node process, so
`node` is on PATH; if it were absent, the whole tail simply degrades fail-open. The Vitest
harness spawns children via `process.execPath` (hermetic), but no absolute-path resolution is
added to the command prose.

**`scripts/snap-validate.mjs`** (edited, backward-compatible):
- Accept `v ∈ {1, 2}`; `v > 2` → `SNAP_UNKNOWN_VERSION` (unchanged single-tier error prefix).
- Top-level allowed keys are **version-aware**: v1 → `{v, sys, ops, mem}` (unchanged — still
  rejects `pr`); v2 → additionally allows `pr`.
- `pr` is **strictly optional**: a v2 blob without `pr` is valid. When present, `pr` must be a
  string; **no dedicated length cap (Q12)** — it is bounded transitively by the existing
  4096-char overall file cap, which `snap-validate` enforces on `raw.length` **before** parsing,
  so an oversized `pr` never even reaches the type check. A separate absolute `pr` cap would be
  dead code: large prose never reaches this file validator (it lives only in the DB), and
  oversized/corrupt DB payloads are guarded at write time by `conductor-db`'s 10 MiB cap and are
  read by ARCH-008-B via direct parsing, never fed to this file validator.
- **4096 cap is NOT bypassed or raised for v2 (Q1):** the cap is a property of the **file
  handoff channel**, not of the schema version, and it is checked on `raw.length` before the
  version is known. No false rejection of valid prose can arise, because valid v2 prose payloads
  are **never presented to the file validator** — they travel the DB channel (10 MiB,
  `conductor-db`-guarded). Making the cap version-conditional would add coupling to guard a case
  the data flow never produces; the cap stays a flat 4096 for every file. (A future feature that
  needs v2 *files* > 4096 is a separate follow-up.)
- Every v1 rule is untouched **except the `sys.c` regex**, which is broadened from
  `/^[0-9a-f]{7}$/` to **`/^[0-9a-f]{7,40}$/` (Q7)** — see "Hash strategy" below. This is
  backward-compatible: legacy 7-char blobs and the `"0000000"` sentinel still pass, under **both**
  schemas. All other v1 rules (sub-block key allow-lists, `sys.ph ∈ {spec,plan,impl,rev}`, array
  caps, `ops.f` action-code check) are byte-identical.

**Hash strategy (Q7) — full 40-char, not `--short`:** `git rev-parse --short HEAD` **auto-scales**
its abbreviation length in large repos (git widens it to stay unambiguous), and that length is
**not stable across repo growth** — the same commit could abbreviate to 7 chars at write time and
8+ later, breaking ARCH-008-B's key match. Both commands therefore derive the **full 40-char hash
via `git rev-parse HEAD`** (fixed-length, unambiguous, stable), lowercased and validated against
`/^[0-9a-f]{7,40}$/`; a non-zero exit, timeout, or format mismatch falls back to the `"0000000"`
sentinel (7 zeros, still valid under the broadened regex). **Zero-commit repos (Q1):** in a
freshly-initialized repo with no commits, `git rev-parse HEAD` exits non-zero (`fatal: … unknown
revision 'HEAD'`); this error is caught like any other and yields the `"0000000"` sentinel — the
commands never fail on a first-run/empty repo. This supersedes the earlier
"short 7-hex" default. `sys.c`, the `sessions.git_commit_hash`, and the `snapshots.git_commit_hash`
key are all this same 40-char value, so A writes and B reads an identical, growth-stable key.

### Alternative paths

- **No `$CLAUDE_CODE_SESSION_ID`:** fallback cache then generated UUID (above). The cache is
  invalidated by the `post-compact` hook (below), bounding its lifetime to one pre-compact
  window.
- **Empty prose at checkpoint:** `snap-build` emits v1 (not v2); still a valid snapshot row.
- **Non-git workspace / no commits:** `sys.c` and the snapshot/session hash key both use
  `"0000000"`; the row is stored under that sentinel.
- **Repeated / concurrent compaction/checkpoint on one commit (Q13):** the `snapshots` insert
  is **append-only** — every write gets a fresh auto-incrementing `id` primary key and **never
  overwrites** a prior row, even for the identical commit hash; concurrent writers serialize on
  `conductor-db`'s `BEGIN IMMEDIATE` + `busy_timeout=2000`, each obtaining a distinct `id`.
  `get-snapshot` (ARCH-008-B) returns the newest via `ORDER BY id DESC`. The `sessions` write, by
  contrast, is an **upsert** keyed by `session_id` (preserving `started_at`), so re-running within
  one session updates the same row rather than adding one.

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
- **Corrupt / locked / hung / absent git (Q11, Q2-git):** the hash derivation runs
  `git rev-parse HEAD` with a **bounded timeout**; a non-zero exit, a timeout/hang, **a
  command-not-found (git binary absent from PATH), a permission/exec restriction (EACCES)**, or
  output not matching `/^[0-9a-f]{7,40}$/` (after lowercasing) **all** fall back to `"0000000"`.
  The commands never block on a stuck git nor hard-fail on a git-less or restricted host; the
  `"0000000"` sentinel is a valid `sys.c` under both schemas.
- **Aborted / reset stdin pipe during a large payload (Q4-pipe):** the payload is delivered as a
  single buffered stdin write (spawnSync/shell pipe writes the whole buffer, then closes stdin),
  and `conductor-db` reads to EOF via `readStdinCapped` **before** its single `INSERT`. So an abort
  manifests as either (a) the child is killed before the `INSERT` → nothing is committed (no
  partial row), or (b) a stdin read error → `withDb` catch → one log line, exit 0, no write, or
  (c) a truncation ending on an invalid UTF-8 boundary → `TextDecoder{fatal}` rejects it, no write.
  A truncated-but-valid-UTF-8 blob is not reachable via buffered delivery; even if one were stored
  (snapshot is opaque by S1 design), ARCH-008-B's defensive `JSON.parse` treats it as a miss
  (fresh-start). Fail-open throughout — no crash, no corrupt committed row.
- **`post-compact` cache clear (Q7/Q4-sweep):** `.sh` uses `rm -f`; `.ps1` uses
  `Remove-Item -Force -ErrorAction SilentlyContinue` with the `Join-Path` results passed as
  **literal double-quoted strings** (space-safe repo paths). It deletes **only**
  `.conductor/session-id` **and** any orphaned `.conductor/session-id.*.tmp` (wildcard sweep) —
  never `.conductor/` itself or any other file, even if the directory would be left empty (it
  normally holds `cache.db`). Each stays inside its hook's existing exit-0 guard, so a delete
  failure never crashes the hook. **Sweep error isolation (Q6-sweep):** a locked or
  permission-denied temp is fully isolated — `.ps1` via `-ErrorAction SilentlyContinue`, `.sh` via
  `rm -f … 2>/dev/null` plus the existing `main || exit 0` guard — so an un-unlinkable file under
  active process contention is simply left in place (swept on a later run) and never aborts the
  hook or surfaces an error.
- **Deletion does NOT force a new session in the primary path (Q6):** `/compact` clears history
  but stays the **same Claude Code invocation** with the same `$CLAUDE_CODE_SESSION_ID`, so the
  next command re-resolves the **identical** id and upserts the **same** `sessions` row — the
  cache deletion is a no-op for env-var sessions. Its **only** effect is in the degraded
  no-env-var path, where it intentionally **rotates the fallback UUID at the compact boundary**
  to bound stale-id leakage (Q1/Q8 session-id). It is a leakage-bounding measure, not a
  deliberate session reset.
- **Session-id fragmentation (Q8/Q4-disconnect, accepted residual):** if `$CLAUDE_CODE_SESSION_ID`
  is absent **and** `.conductor/session-id` cannot be written across repeated invocations, each run
  emits a fresh **unpersisted in-memory UUID**. By construction an unpersisted id **inherently
  cannot bind sequential invocations** — each command becomes its own `sessions`/`snapshots`
  row (documented, not a defect). This compound edge cannot occur under real Claude Code (the env
  var is always set); when it does it is non-fatal and does **not** affect ARCH-008-B resume,
  which keys on `git_commit_hash`, not `session_id`. No extra mechanism is added (YAGNI).
- **Partial DB-tail failure (Q6):** the tail runs `session` (upsert) **then** `snapshot`
  (insert) as two independent, non-transactional, fail-open processes. If `session` succeeds but
  `snapshot` fails (or vice-versa), the partial result is **accepted and non-fatal**: ARCH-008-B
  tolerates a `sessions` miss and a `snapshots` miss **independently** (a snapshot miss degrades
  to fresh-start, the designed miss behavior). No rollback or compensation is attempted — each
  call is already exit-0 fail-open, and no cross-process transaction spans the two.
- **Authoritative-write failure halts the tail (Q3-halt):** if the primary write fails —
  `session-snapshot.json` for `/cc-compact`, or the `project.md` append for `/cc-checkpoint` —
  the command **reports the error and stops; the (synchronous) DB tail does not run** and, for
  compact, the compact prompt is not printed. The tail only ever executes **after** the
  authoritative record is safely persisted, so the DB never holds a snapshot for a checkpoint/
  compaction that did not actually land on disk.
- **Shell `timeout` availability (Q8-timeout):** the command wraps a DB-tail call with shell
  `timeout` **only when the binary exists** (`command -v timeout` / `command -v gtimeout`
  succeeds); otherwise it runs the call **unwrapped**, bounded by `conductor-db`'s internal 2 s
  `busy_timeout`. The wrapper is never invoked blindly, so a host without GNU `timeout` (e.g.
  stock macOS) never fails with command-not-found.

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
      `SNAP_UNKNOWN_VERSION`, treats `pr` as optional (string-typed, no separate cap), broadens
      `sys.c` to `/^[0-9a-f]{7,40}$/`, and keeps every other v1 rule byte-identical. All 43
      existing validator tests stay green (7-char and `"0000000"` still pass); new tests cover
      8–40-char `sys.c` and `v:2`+`pr`.
- [ ] Both commands derive the hash via full-40 `git rev-parse HEAD` (not `--short`),
      validate `/^[0-9a-f]{7,40}$/`, and fall back to `"0000000"`; the same value is used for
      `sys.c`, the `sessions` hash, and the `snapshots` key (growth-stable A/B match).
- [ ] `/cc-compact` writes the v1 handoff file first (authoritative; failure suppresses the DB
      tail and the compact prompt), then best-effort synchronously upserts one `sessions` row
      and inserts one `snapshots` row keyed by the short git hash; the compact prompt prints
      regardless of the tail outcome.
- [ ] `/cc-checkpoint` updates `project.md` first (authoritative), then best-effort
      synchronously writes one `sessions` upsert + one v2 `snapshots` row (prose in `pr`); DB
      failure never blocks or reverts the `project.md` update.
- [ ] `snap-build` maps flat input to `sys/ops/mem` sub-blocks and **strips** any extraneous
      stdin key from the output; a `v:2` blob is emitted iff a non-empty `pr` is supplied (`v` is
      the sole differentiator); a `pr`-less skeleton exceeding its cap exits non-zero with no
      stdout.
- [ ] `/cc-checkpoint` sets `pr` to the verbatim appended `## Checkpoint` block, derives `ph` by
      `get-session` carry-forward (else `"impl"`), and projects `d`/`x` from the section bullets.
- [ ] Each `snapshots` write is append-only with a fresh auto-incrementing `id` (never
      overwrites, even on an identical commit hash); the `sessions` write upserts by `session_id`.
- [ ] The DB tail redirects all child stdout+stderr to `.conductor/last-write.log`; no
      `CONDUCTOR_DB:` line reaches the UI. The short-hash derivation falls back to `"0000000"` on
      git non-zero exit, timeout, or format mismatch.
- [ ] Every `conductor-db` argument is double-quoted; the `post-compact.ps1` cache-clear path
      is double-quoted, uses `Remove-Item -Force -ErrorAction SilentlyContinue`, and removes only
      `.conductor/session-id` (never the directory). `session-id.mjs`/`snap-build.mjs` run
      flag-free (no probe).
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
- **Modified:** `scripts/snap-validate.mjs` (v2 + optional `pr` + `sys.c` → `/^[0-9a-f]{7,40}$/`),
  `global/commands/cc-compact.md`,
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
