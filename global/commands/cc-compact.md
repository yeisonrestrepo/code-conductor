---
description: "(Conductor) Serialize phase state and prompt for context compaction"
---

Run `git rev-parse HEAD` to get the current commit SHA (the **full 40-char** hash — NOT `--short`, whose abbreviation length auto-scales with repo size and is unstable across growth). Lowercase and trim it; if it does not match `/^[0-9a-f]{7,40}$/`, or the command exits non-zero (non-git workspace, no commits, git absent, or permission-denied), use `"0000000"`. Wrap the call with shell `timeout` only when `command -v timeout` (or `gtimeout`) succeeds; otherwise run it unwrapped. This same value is `sys.c` and the `sessions` / `snapshots` git-hash key.

Determine `sys.s`: take the active specification file path from this phase's context, split on `/` and `\`, keep the last segment, strip a trailing `.md` extension, truncate to 200 characters. If no active spec file exists, use `"none"`.

Collect from the current conversation context:
- **Phase** (`sys.ph`): `spec` | `plan` | `impl` | `rev`, the phase that just completed
- **Decisions** (`mem.d`): finalized decisions this phase, max 10 elements, each ≤300 chars (JSON-serialized length)
- **Pending** (`ops.n`): next immediate step(s), max 3 elements, each ≤200 chars
- **Files Touched** (`ops.f`): each entry `<relpath>:C|M|D` (uppercase only); replace any backslash in the path with `/`; if the path contains a literal `:`, percent-encode it as `%3A` before appending the suffix; max 20 elements, each ≤300 chars
- **Constraints** (`mem.x`): hard constraints next phase must respect, max 5 elements, each ≤200 chars

For all four array fields: filter out empty/whitespace-only strings, deduplicate by exact case-sensitive string equality (first occurrence wins), then truncate each surviving element to its per-element cap (Unicode-safe: `Array.from(str).slice(0, cap).join('')`), then if the array still exceeds its cap, drop from the **head** (oldest first) until it fits. Empty arrays are valid and must still be serialized (never omitted).

Serialize by piping a flat JSON object `{ph, c, s, n, f, d, x}` (no `pr`) on **stdin** to `node scripts/snap-build.mjs`; its stdout is the canonical single-line **v1** SNAP JSON. `snap-build` performs all array normalization (filter/dedup/per-element cap/head-drop) and the 4096-char size trim internally — do not pre-serialize. If `snap-build` exits non-zero (malformed field object), report the error and stop; do not write the handoff file, do not run the DB tail, do not print the compact prompt.

Write the single JSON line, followed by exactly one trailing newline, to `.claude/memory/session-snapshot.json`.

If `.claude/memory/session-snapshot.md` exists, delete it as part of this write.

Idempotently append `.claude/memory/session-snapshot.json` to the project's `.gitignore`: read the file; if any line, after stripping leading/trailing whitespace, exactly equals `.claude/memory/session-snapshot.json`, skip the append. Otherwise, check whether the last byte of `.gitignore` is a newline; if not, prepend a newline before the appended entry. If `.gitignore` cannot be read or written (permission or lock error), log a non-fatal warning to stderr and continue; do not block the snapshot write.

If writing the snapshot fails (e.g., missing `.claude/memory/` directory), report the error and stop. Do NOT output the compact prompt.

Once the snapshot is written successfully, output exactly:

> Snapshot written. Run `/compact` now to clear history.

---

## Fail-open DB tail (best-effort, synchronous)

After the handoff file is written and the compact prompt is ready — and **only** if the authoritative write succeeded — run this synchronous, fail-open tail. Any failure here is non-fatal: never revert the handoff file, never suppress the compact prompt.

1. Ensure `.conductor/` exists (`mkdir -p .conductor`, best-effort). If that fails, skip the tail entirely.
2. Resolve the session id: `id="$(node scripts/session-id.mjs 2>>.conductor/last-write.log)"`.
3. Upsert the session row (Node-flag probe applies — same as the cc-implement Step 6 hook: no-flag-first, else `--experimental-sqlite --no-warnings`, else skip):

   `node <probe-flags> scripts/conductor-db.mjs session "$id" "$ph" "$s" "$c" >> .conductor/last-write.log 2>&1`
4. Insert the snapshot row, piping the v1 blob on **stdin** (never argv):

   `printf '%s' "$snap_json" | node <probe-flags> scripts/conductor-db.mjs snapshot "$c" >> .conductor/last-write.log 2>&1`

All argv scalars are double-quoted. **Every** DB-tail redirect uses **append mode (`>>`)** — never `>` — so a rapid or parallel second run never truncates a preceding trace; the log is gitignored, best-effort, and per-run growth is one line at most (rotation is out of scope). The lone `CONDUCTOR_DB:` degradation line (Node < 22.5 / `node:sqlite` absent) lands only in `.conductor/last-write.log`, never the UI. Finally print `> Snapshot written. Run /compact now to clear history.` regardless of the tail's outcome.

**Cross-platform note:** the incantations above are the **Unix (bash) canonical form**; the `.md` file is an agent instruction, not a literal script — realize the same semantics on the host shell. On Windows/PowerShell: **first set `$OutputEncoding = [System.Text.UTF8Encoding]::new($false)`** (no-BOM UTF-8, so the piped snapshot string reaches Node's UTF-8 `TextDecoder` byte-clean); capture the id via `$id = node scripts/session-id.mjs`; pipe the blob with `$snap_json | node … snapshot "$c"`; append the log with `… 2>&1 | Out-File -Append -Encoding utf8 .conductor/last-write.log` (explicit UTF-8 append — never the bare `*>>`, whose default encoding is UTF-16LE on PS 5.1 and would corrupt the trace); ensure the dir with `New-Item -ItemType Directory -Force .conductor`. The stdin-only-for-payloads, double-quoted-argv, append-log, and fail-open rules are identical on both platforms.
