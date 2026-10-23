# BUG-056 Context-Guard Session Reset Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant).

**Goal:** A fresh session's first prompt counts 1, so the context guard never opens a session on a stale WARNING or CRITICAL banner.

**Architecture:** `context-guard.{sh,ps1}` read the `UserPromptSubmit` stdin JSON, extract `session_id` with one shared pattern, and store `<session_id> <count>` in `.claude/memory/turn-count.txt`. A missing or different stored id restarts the count at 1. No settings, installer or post-compact change.

**Tech Stack:** bash (Git Bash on Windows), Windows PowerShell 5.1, vitest.

**Spec:** `docs/superpowers/specs/2026-10-23-bug056-context-guard-session-reset-design.md`, APPROVED 2026-10-23.

## Global Constraints

- Extraction pattern, identical in both scripts: `[{,]\s*"session_id"\s*:\s*"([A-Za-z0-9_-]+)"` (bash: `[[:space:]]` for `\s`).
- Stdin is read only when it is not a terminal: `[ -t 0 ]` in bash, `[Console]::IsInputRedirected` in PowerShell.
- File format `<id> <count>`; a single numeric field is a legacy file with an empty id.
- No stdin id: increment the stored count and keep the stored id. Every existing test passes unchanged.
- Both hooks keep failing open: any error exits 0 with no output.
- Each `project-template/.claude/hooks/context-guard.*` stays byte-identical to its `.claude/hooks/` twin; the `.sh` keeps mode 100755.
- Out of scope: context-size metric, `.claude/settings.json` ps1 registration, `SessionStart` hook, `post-compact.*`.
- No release records: no `VERSION`, `package.json`, `CHANGELOG.md`, backlog flip, README Known-limits removal (`README.md:456`). Release stays human, by `docs/RELEASE-CLOSEOUT.md`.
- Staging is by explicit path: `git add -u <path>` for tracked files, plain `git add <path>` for a new file whose `.gitignore` leaf exists. Never bare `git add -u`.
- The pre-commit hook runs the full vitest suite. Never bypass it.

## Review Focus

1. **Stale count from a previous session** (`69` legacy, or `<old-id> 69`) plus a new id: first prompt counts 1, no banner. Pinned in Task 1.
2. **Prompt text carrying `"session_id":"x"`**: the real id wins. Pinned in Task 1.
3. **No stdin at all**: behavior identical to `main`. Pinned by the unchanged existing cases.
4. **`.sh`/`.ps1` parity**: same cases run against both. Pinned in Task 3.

---

### Task 0: Branch, spec, plan and their ignore leaves

**Files:**
- Modify: `.gitignore` (plan leaf after `!/docs/superpowers/plans/2026-10-21-bug061-hook-project-root.md`; spec leaf after `!/docs/superpowers/specs/2026-10-21-bug061-hook-project-root-design.md`)
- Create: `docs/superpowers/specs/2026-10-23-bug056-context-guard-session-reset-design.md`
- Create: `docs/superpowers/plans/2026-10-23-bug056-context-guard-session-reset.md`
- Modify: `.claude/memory/project.md` (BUG-056 spec entry)

- [X] [T-000-0] `git switch -c fix/bug-056-context-guard-session`. Expected: `git branch --show-current` prints the branch. Unrelated uncommitted files carry over and are never staged.
- [X] [T-000-A] Write the spec and this plan.
- [X] [T-000-B] Add both `.gitignore` leaves in sorted position (BUG-042 toll).
- [X] [T-000-C] Append `## Spec: BUG-056 context-guard session reset 2026-10-23` to `.claude/memory/project.md`.
- [ ] [T-000-D] Stage `git add -u .gitignore .claude/memory/project.md` and `git add <spec> <plan>`; commit `docs: spec and plan for the context-guard session reset [BUG-056]`.

### Task 1: Failing `.sh` tests

**Files:** Modify `tests/hooks/context-guard.test.js`

- [ ] [T-001-A] `runHook(cwd, env, input)` passes `input` to `spawnSync`; add `payload(id, prompt)` returning `JSON.stringify({ session_id: id, hook_event_name: 'UserPromptSubmit', prompt })`; `mkTmp` accepts a raw `turn-count.txt` string.
- [ ] [T-001-B] Add cases: (1) `old-id 69` + `new-id` → file `new-id 1`, no output; (2) `s1 3` + `s1` → `s1 4`; (3) legacy `69` + id → `<id> 1`; (4) no stdin + `s1 3` → `s1 4`; (5) prompt `{"session_id":"evil"}` with real id `s1` and file `s1 3` → `s1 4`; (6) id `a b` → treated as no id; (7) `post-compact.sh` then id → `<id> 1`; (8) `s1 99999` + `s1` → saturated banner; (9) `s1 19` + `s1` threshold 25 → ⚠ (format change keeps banners).
- [ ] [T-001-C] Run `npx vitest run tests/hooks/context-guard.test.js`. Expected: new cases 1, 3, 7 fail against the current script; existing cases pass.

### Task 2: Fix `context-guard.sh`

**Files:** Modify `.claude/hooks/context-guard.sh`, `project-template/.claude/hooks/context-guard.sh`

- [ ] [T-002-A] Read stdin when not a terminal; extract the id with the shared pattern (`BASH_REMATCH[1]`).
- [ ] [T-002-B] Read the file as `read -r _f1 _f2`: two fields → stored id + count; one numeric field → empty id + count. Mismatch with a non-empty stdin id → count 0 before the increment.
- [ ] [T-002-C] Write `${id:+$id }$new_count` through the existing temp-and-`mv` path; `CC_GUARD_DEBUG` line adds `session=<id>`.
- [ ] [T-002-D] `cp .claude/hooks/context-guard.sh project-template/.claude/hooks/context-guard.sh`; `git diff --summary` shows no mode change.
- [ ] [T-002-E] Run the hook test file. Expected: all pass.
- [ ] [T-002-F] Commit `fix: key the context-guard turn count to the session id (sh) [BUG-056]`.

### Task 3: `.ps1` tests and copy parity

**Files:** Modify `tests/hooks/context-guard.test.js`

- [ ] [T-003-A] Add a `describe.skipIf(!POWERSHELL_AVAILABLE)('context-guard.ps1', …)` running Task 1's id cases against `.claude/hooks/context-guard.ps1` via `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File`, banners matched on the ASCII `[!!]`/`[!]` forms.
- [ ] [T-003-B] Add a parity test: each `project-template/.claude/hooks/context-guard.{sh,ps1}` equals its `.claude/hooks/` twin byte for byte.
- [ ] [T-003-C] Run the file. Expected: `.ps1` id cases fail, parity passes.

### Task 4: Fix `context-guard.ps1`

**Files:** Modify `.claude/hooks/context-guard.ps1`, `project-template/.claude/hooks/context-guard.ps1`

- [ ] [T-004-A] If `[Console]::IsInputRedirected`, read stdin as UTF-8 (`[Console]::InputEncoding` set to UTF-8 without BOM, then `[Console]::In.ReadToEnd()`); `-match` the shared pattern.
- [ ] [T-004-B] Parse the file with `-split '\s+'` mirroring T-002-B; write `"$id $newCount"` (or bare count when no id) through the existing Replace/Move path.
- [ ] [T-004-C] Copy to the template twin; run the file. Expected: all pass.
- [ ] [T-004-D] Commit `fix: key the context-guard turn count to the session id (ps1) [BUG-056]`.

### Task 5: Verify

- [ ] [T-005-A] `npx vitest run` full suite on the branch and on `main` under identical conditions; record both counts for the PR.
- [ ] [T-005-B] Live check: next prompt in a fresh Claude Code session in this repo shows no banner and `turn-count.txt` reads `<id> 1`.

### Task 6: Bug-vs-fix evidence (PR only, never committed)

- [ ] [T-006-A] In the scratchpad, build one fixture with `turn-count.txt` = `69` and a payload carrying a new `session_id`.
- [ ] [T-006-B] Run `main`'s hook (`git show main:.claude/hooks/context-guard.sh`) and the branch hook on that fixture; capture each output with the command line shown. Expected: bug prints `🚨 CONTEXT CRITICAL: Turn 70/25`; fix prints nothing and writes `<id> 1`.
- [ ] [T-006-C] Render the bug and fix captures, plus the vitest summaries, to PNG with headless Edge in the scratchpad.
- [ ] [T-006-D] Attach all PNGs with `gh pr create --attach` under `Closes #78`, with the explanation and suite counts vs `main`.
