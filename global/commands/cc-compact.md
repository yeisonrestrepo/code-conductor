---
description: "(Conductor) Serialize phase state and prompt for context compaction"
---

Run `git rev-parse --short HEAD` to get the current commit SHA. Lowercase the trimmed result; if it does not match `/^[0-9a-f]{7}$/` after lowercasing (and slicing to 7 chars if longer, or padding with trailing zeros if shorter), or if the command exits non-zero (non-git workspace, no commits yet), use `"0000000"`.

Determine `sys.s`: take the active specification file path from this phase's context, split on `/` and `\`, keep the last segment, strip a trailing `.md` extension, truncate to 200 characters. If no active spec file exists, use `"none"`.

Collect from the current conversation context:
- **Phase** (`sys.ph`): `spec` | `plan` | `impl` | `rev`, the phase that just completed
- **Decisions** (`mem.d`): finalized decisions this phase, max 10 elements, each ≤300 chars (JSON-serialized length)
- **Pending** (`ops.n`): next immediate step(s), max 3 elements, each ≤200 chars
- **Files Touched** (`ops.f`): each entry `<relpath>:C|M|D` (uppercase only); replace any backslash in the path with `/`; if the path contains a literal `:`, percent-encode it as `%3A` before appending the suffix; max 20 elements, each ≤300 chars
- **Constraints** (`mem.x`): hard constraints next phase must respect, max 5 elements, each ≤200 chars

For all four array fields: filter out empty/whitespace-only strings, deduplicate by exact case-sensitive string equality (first occurrence wins), then truncate each surviving element to its per-element cap (Unicode-safe: `Array.from(str).slice(0, cap).join('')`), then if the array still exceeds its cap, drop from the **head** (oldest first) until it fits. Empty arrays are valid and must still be serialized (never omitted).

Serialize as a single-line JSON object with exactly these top-level keys: `v` (always `1`), `sys` (`{ph, c, s}`), `ops` (`{n, f}`), `mem` (`{d, x}`). Key order within objects does not matter. If the total serialized length exceeds 4096 characters, iteratively drop the oldest element from the longest of `mem.d` / `ops.f` and re-serialize until it fits. Stop condition: if `mem.d` and `ops.f` are both already empty and the payload still exceeds 4096 characters, stop trimming and write the file as-is rather than looping forever; the validator will then correctly reject it with `SNAP_ERROR: payload too large`, surfacing the problem instead of silently hanging. (Given the per-field caps defined elsewhere in this spec, `sys.c` + `sys.s` + `ops.n` + `mem.x` alone never exceed roughly 2000 characters combined, so this floor cannot actually be reached today, but the loop must still have an explicit termination condition rather than relying on that being true forever.)

Write the single JSON line, followed by exactly one trailing newline, to `.claude/memory/session-snapshot.json`.

If `.claude/memory/session-snapshot.md` exists, delete it as part of this write.

Idempotently append `.claude/memory/session-snapshot.json` to the project's `.gitignore`: read the file; if any line, after stripping leading/trailing whitespace, exactly equals `.claude/memory/session-snapshot.json`, skip the append. Otherwise, check whether the last byte of `.gitignore` is a newline; if not, prepend a newline before the appended entry. If `.gitignore` cannot be read or written (permission or lock error), log a non-fatal warning to stderr and continue; do not block the snapshot write.

If writing the snapshot fails (e.g., missing `.claude/memory/` directory), report the error and stop. Do NOT output the compact prompt.

Once the snapshot is written successfully, output exactly:

> Snapshot written. Run `/compact` now to clear history.
