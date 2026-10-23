# BUG-056 Context-Guard Session Reset — Design

**Status:** APPROVED 2026-10-23
**Backlog:** `[BUG-056]` · **Issue:** #78

## Problem

`context-guard.{sh,ps1}` increments `.claude/memory/turn-count.txt` on every `UserPromptSubmit`, and only `post-compact.{sh,ps1}` resets it. A session that ends without a compaction leaves its count behind, so the next fresh session opens on a WARNING or CRITICAL banner against a near-empty context (reproduced live: `Turn 69/25` and `Turn 123/25` on a first prompt). The false alarm pushes a needless `/cc-compact` and teaches users to ignore the real one.

## Solution

Key the counter to the session. The guard reads `session_id` from the hook's stdin JSON and stores `<session_id> <count>` in `turn-count.txt`. When the stored id is missing or differs from the stdin id, the count restarts at 1. The fix lands in all four copies: `.sh` and `.ps1` in `.claude/hooks/` and `project-template/.claude/hooks/`. `settings.json` does not change. The PostCompact reset keeps working unchanged.

Rejected alternative: a `SessionStart` hook that resets the file. It needs a new settings entry carried through the installer merge, and it must special-case `--resume`, which should keep the count because the context comes back with the session.

## Behavior

### Main path

1. A prompt is submitted; the guard reads stdin (only when stdin is not a terminal) and extracts `session_id`.
2. Stored id equals the stdin id: count = stored count + 1. Otherwise: count = 1.
3. The guard writes `<id> <count>` atomically (temp file then rename, as today).
4. Thresholds and banners are unchanged.

### Alternative paths

- Legacy bare-number file (`69`): read as an empty stored id, so a stdin id is a mismatch and the count resets to 1. Existing installs are fixed on the first prompt after upgrade.
- After PostCompact writes `0`: same legacy branch, next prompt counts 1. `post-compact.*` does not change.
- `--resume` of the same session: ids match, count continues.
- No stdin, or no `session_id` in it (older Claude Code, manual run): today's behavior; the stored count increments and the stored id, if any, is kept.

### Error cases

- Malformed JSON or empty id: treated as no id. The hook never fails and always exits 0.
- Prompt text containing `"session_id":"…"`: the stdin JSON escapes it as `\"session_id\":\"…\"`, and the extraction pattern requires `{` or `,` (plus optional whitespace) directly before the key, so prompt text cannot set the id.
- Id containing characters outside `[A-Za-z0-9_-]`: not matched, treated as no id.

Extraction pattern, identical in both scripts (no JSON parser, which keeps `.sh` and `.ps1` in parity and avoids `ConvertFrom-Json` on very large prompts under PS 5.1):

```
[{,]\s*"session_id"\s*:\s*"([A-Za-z0-9_-]+)"
```

## Acceptance Criteria

- [ ] Stored id differs from the stdin id: count becomes 1, no banner.
- [ ] Same id: count increments per prompt; existing WARNING/CRITICAL cases still pass.
- [ ] Legacy bare-number file plus a stdin id: count resets to 1.
- [ ] No stdin id: identical to today; every existing test passes unchanged.
- [ ] A `"session_id"` inside the prompt text cannot override the real one.
- [ ] After `post-compact` runs, the next prompt counts 1.
- [ ] `.sh` and `.ps1` give the same result for every case above; each `project-template` copy is byte-identical to its `.claude/hooks/` twin.

## Out of Scope

- Replacing prompt count with a real context-size metric (e.g. `transcript_path` size). Follow-up candidate.
- `.claude/settings.json` not registering `context-guard.ps1` while the template does.
- A `SessionStart` hook.
- Release records (VERSION, CHANGELOG, backlog flip, README Known-limits removal at `README.md:456`).

## System Impact

- `.claude/hooks/context-guard.{sh,ps1}`, `project-template/.claude/hooks/context-guard.{sh,ps1}`
- `tests/hooks/context-guard.test.js` (stdin input, new cases, `.ps1` coverage, copy parity)
- Installer deploy/template tests: copies only, no logic change

## Complexity Estimate

**S.** One read-and-compare step in two scripts mirrored to four files, plus tests; no settings or installer logic change.
