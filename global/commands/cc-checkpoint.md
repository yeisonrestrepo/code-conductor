---
description: "(Conductor) Save session decisions, conventions, and debt to memory"
---

Read the conversation history from the current session.

Identify and extract:
1. **Decisions made** — architectural choices, approach selections, rejected alternatives
2. **Conventions established** — naming patterns, file organization, code style choices
3. **Technical debt** — shortcuts taken, known limitations, deferred work
4. **Workarounds** — non-obvious solutions and why they were needed

**Update `.claude/memory/project.md`** (append only, never delete):
- Add a timestamped section: `## Checkpoint [YYYY-MM-DD HH:MM]`
- List decisions, conventions, and debt from this session

**Update `.claude/memory/personal.md`** (local only):
- Add any developer preferences observed this session

**Report:**
- Timestamp of this checkpoint
- What was saved to project.md (2–3 bullets)
- What was saved to personal.md (1–2 bullets)

Suggest running `/cc-checkpoint` automatically: before `/compact`, after completing a feature, after any key architectural decision.

---

## Fail-open DB tail (best-effort, synchronous)

Run **only after** the `project.md` append succeeded (authoritative). Any failure here is non-fatal — never block or revert the `project.md` update.

1. Ensure `.conductor/` exists (`mkdir -p .conductor`, best-effort); if that fails, skip the tail.
2. Derive `c` — the **full-40** `git rev-parse HEAD` (lowercased, `/^[0-9a-f]{7,40}$/`, `"0000000"` fallback on non-zero/timeout/git-absent/format-mismatch; shell `timeout` only if the binary exists).
3. Resolve the id: `id="$(node .claude/scripts/session-id.mjs 2>>.conductor/last-write.log)"`.
4. Derive `ph` by carry-forward: with a bounded ~5 s outer timeout (only if `timeout` exists; `conductor-db`'s internal 2 s `busy_timeout` bounds real contention otherwise), run `node <probe-flags> .claude/scripts/conductor-db.mjs get-session "$id"`; if it prints a row whose `phase` is a non-empty enum member, reuse it. On no row, empty phase, DB unavailable, or timeout, default to `"impl"`.
5. Set `pr` to the **verbatim `## Checkpoint …` section body** just appended to `project.md` (the same in-context string) — so `project.md` and the snapshot's `pr` are byte-identical. `pr` is always non-empty here, so the blob is always **v2**.
6. Project `d` / `x` from that section (best-effort): match headings `/^#{2,4}[ \t]+(.+?)[ \t]*$/`; normalize the heading text by removing all `*`, `_`, `` ` `` then `.trim()` + lowercase; a heading containing `decision` or `convention` opens a `d` block, one containing `debt`, `workaround`, or `limitation` opens an `x` block. **The `d` set is tested first and wins** (a heading matching both opens one `d` block). The parent `## Checkpoint …` heading matches no keyword, so it opens no block and closes any open one. Within a block, bullet lines `/^[ \t]*[-*][ \t]+(\S.*?)[ \t]*$/` contribute their trimmed capture (line-based; continuation lines ignored — the full text survives in `pr`). If unstructured, `d`/`x` may be empty (valid).
7. Defaults: `n=[]`, `f=[]`, `s`= the active spec stem or `"none"`.
8. Build the v2 blob: pipe `{ph, c, s, n, f, d, x, pr}` on **stdin** to `node .claude/scripts/snap-build.mjs`; capture its stdout. If it exits non-zero, skip the DB write (fail-open).
9. Write the rows (both argv double-quoted; blob on stdin; all output to the log):

   `node <probe-flags> .claude/scripts/conductor-db.mjs session "$id" "$ph" "$s" "$c" >> .conductor/last-write.log 2>&1`
   `printf '%s' "$snap_json" | node <probe-flags> .claude/scripts/conductor-db.mjs snapshot "$c" >> .conductor/last-write.log 2>&1`

All DB-tail redirects use **append mode (`>>`)** so concurrent runs never truncate a preceding trace. **Cross-platform note:** the forms above are Unix-canonical; on Windows/PowerShell realize the same semantics — set `$OutputEncoding = [System.Text.UTF8Encoding]::new($false)` before piping, capture `$id = node …`, pipe `$snap_json | node … snapshot "$c"`, append the log via `… 2>&1 | Out-File -Append -Encoding utf8 .conductor/last-write.log` (not `*>>`), and `New-Item -ItemType Directory -Force .conductor`.

**No checkpoint post-hook needed (fail-open, no orphaned state):** unlike `/cc-compact`, `/cc-checkpoint` does not clear history, so no `post-compact` hook fires after it — and none is needed. A mid-tail failure leaves no stale telemetry to clean: the session id is unchanged (same env-var session), a partial write (session ok / snapshot fail, or vice-versa) is **accepted** — ARCH-008-B tolerates each miss independently with no rollback — and the only temp file (`session-id.*.tmp`) is cleaned by `session-id.mjs` itself and swept at the next compaction boundary (T-006). Adding a dedicated checkpoint cleanup hook would be YAGNI.

Report the checkpoint as usual regardless of the tail's outcome.
