---
description: "(Conductor) Map implementation steps from an approved spec"
---

## Phase entry - Resume Read

Before doing anything else, restore any stored context for the current commit by running `.claude/scripts/resume-read.mjs`. It resolves the current git hash, prefers a valid DB snapshot (`conductor-db get-snapshot`), falls back to the `.claude/memory/session-snapshot.json` handoff file, and prints a `RESUME_HIT` block on a hit / nothing on a miss. Capture its stdout **and** its exit code with the canonical per-platform form (each first probes for `node` and treats its absence as a clean miss, never an error):

- **Unix / Git Bash:**
  ```sh
  if command -v node >/dev/null 2>&1; then
    resume_out="$(node .claude/scripts/resume-read.mjs 2>>.conductor/last-write.log)"; resume_rc=$?
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
      $resume_out = node .claude/scripts/resume-read.mjs 2>> .conductor/last-write.log; $resume_rc = $LASTEXITCODE
    } catch { $resume_rc = 3; $resume_out = "" }
    finally {
      $ErrorActionPreference = $__eap
      if (Test-Path variable:__nap) { $PSNativeCommandUseErrorActionPreference = $__nap }
    }
  } else { $resume_rc = 3; $resume_out = "" }
  ```

Branch on `resume_rc` - **only `0` and `4` are meaningful; every other code proceeds fresh:**

- **`0`** → parse the captured block and adopt it as this phase's starting context, then echo one banner to the user: `> Resumed from stored snapshot @ <commit> (phase: <phase>)`, appending ` (checkpoint prose available)` when the block reports `prose: available`. Parsing (the command owns normalization): split on `\n`; strip a trailing `\r` from every line; drop leading/trailing wholly-blank lines; require `lines[0].trim() === 'RESUME_HIT'` (anything else = miss); `key: value` lines split on the first `': '` (both sides trimmed); the `pending:` block is every subsequent `^\s*-\s+` line up to the first blank line or EOF, each item trimmed. Unknown keys are ignored. In PowerShell, `node …` binds `string[]` for multi-line output - normalize with `$lines = @($resume_out)`; a `$null`/empty capture with `resume_rc = 3` is a miss.
- **`4`** → **operational halt.** Do not run this phase's normal work. Emit exactly: `SNAP_INVALID: corrupt handoff at .claude/memory/session-snapshot.json - inspect or remove it, then re-run.` and enter standby awaiting user action. The corrupt file is left on disk (the script did not delete it).
- **`3` or any other code** → **proceed fresh** (clean miss, bypass, degrade, absent `node`, or any unexpected runtime code). Ignore the capture.

`resume-read.mjs` writes its own trace lines to `.conductor/last-write.log` via `appendFileSync`; the `2>>` redirect above only sinks the incidental exit-4 halt reason away from the UI - it is not the trace channel.

---

## Phase 0 — Skill activation

Before doing anything else, invoke both skills in order:

```
Skill({ skill: "writing-plans", args: "$ARGUMENTS" })
Skill({ skill: "critical-review" })
```

`writing-plans` structures the format and sequencing strategy. `critical-review` Phase 1 then runs the Pre-Flight Analysis on the implementation approach — surface failure points and boundary conditions before committing to an ordered step list. Do not generate steps until both have completed.

---

Require an approved spec before starting. If no spec is in `.claude/memory/project.md` or in the recent conversation, stop and say:
"No approved spec found. Run `/cc-spec [name]` first."

Read `.claude/memory/project.md` and this project's `CLAUDE.md` before doing anything else.

**Map the codebase structure** before reading any file content:
- List directories
- Identify files related to the spec using grep, not reads
- Note existing patterns to follow

**Generate a plan with:**

## Task ID Requirements

Every task checkbox line must carry a unique alphanumeric ID:

    - [ ] [T-001] Top-level task
    - [ ] [T-001-A] Sub-task A
    - [ ] [T-001-A-1] Sub-sub-task
    - [ ] [T-002] Next top-level task

Rules:
- Minimum 3 digits (`T-001`); no upper bound (`T-1000` is valid)
- Suffix depth is unlimited: `T-NNN(-[A-Z0-9]+)*`
- IDs must be unique within the file; verify before saving; no two tasks may share the same ID
- Generated checkbox lines must use plain ASCII `[ ]` (U+0020 space only between brackets); no Unicode invisible characters
- Apply to all generated task lines only; do not add IDs retroactively to existing plan files

## Ordered Steps

Each step must include:
- Exact file path(s)
- Action (create / modify / delete)
- What changes and why
- Whether it has a dependency on a previous step
- **Step ordering within a task.** A step that stages a file - any form of `git add` (`-f`,
  `-A`, `-u`, `--all`, `.`, or an explicit path) - must come after every step in the same
  commit group that edits that file. A commit group is the contiguous run of steps ending at a
  `git commit` step; a task with two commits has two groups. A step that stages implicitly,
  such as `git commit -a`, counts as its own staging step, so every edit of a file it will
  commit must precede it. A task that mixes edits with a commit orders its steps edit, then
  stage, then commit. A staging step for a file the task never edits is unaffected by this
  rule; never invent an edit step to satisfy it. `cc-implement` executes checkbox lines in file
  order, so a staging step placed above its edit commits the file's previous content while
  every checkbox still reports `[X]`, and the divergence surfaces only at whatever later task
  asserts on that file's expected state, pointing at the wrong task.
- **Staging form within a step.** Where a staged path sits under a directory the repository
  ignores, plain `git add <path>` exits 1 even when a tracked file staged correctly, because
  the pathspec matched the ignored ancestor. Generate `git add -u <path>` when the file is
  already tracked, `git add -f <path>` when it is new and under an ignored directory, and
  plain `git add <path>` otherwise. Always generate an explicit path: bare `git add -u`
  stages every modified tracked file in the repository. The branch is on tracked-ness, never
  on habit, because `-u` exits 128 on an untracked path whether or not an ignore rule exists.
- **Plan file in staging steps.** Every commit group that ticks checkboxes in the plan file must
  include a `git add -u <plan-file-path>` step after the checkbox edits so the ticked state
  rides the commit. Ticks from a task's final commit ride the next task's first commit, and
  the last task's ride the closeout commit. A tick made after a group's `git commit` step has
  run, including the tick on that step itself, cannot ride that commit, so it belongs to the
  next commit group that stages the plan file. Without this step, `cc-implement` marks
  checkboxes `[X]` but the committed file still shows the previous state.
- **Filtered red-step predictions.** When a red step runs the suite through a runner filter
  (`-t`, a file path or a name pattern), a filtered red-step prediction lists the filter's full
  match set: every test the filter selects with its expected state, not only the new tests.
  A filter that also matches already-green tests reads more passes than the new tests alone
  predict, and the mismatch halts a run that is otherwise correct.

## Test List
- [ ] Unit tests for [unit]
- [ ] Integration test for [seam]
- [ ] E2E test if UI is affected

## Commit Order
[Which steps to group into commits]

## Identified Risks
[What could go wrong and how to catch it early]

---

Execute one step at a time. Confirm between steps unless the developer explicitly says to proceed without confirmation.

---

## Phase exit

### Branch gate (runs before Task 0)

Once the plan is approved and saved, work through this gate, then print the exit
instruction in step 7.

**Precondition on Task 0.** This gate runs to completion — the warning, the offer, and
either the confirmed `git switch` or an explicit decline —
**before any step of the approved plan's Task 0 executes**, including its `git add`,
`git add -u` or `git add -f` and its `git commit`. Its position in this file is not the guarantee; the
execution order is.
Under the plan-commit ritual, Task 0 runs at approval, which is exactly when a plan commit
lands on the wrong branch.

Skip the whole gate silently when `git rev-parse --git-dir` fails or `git` is absent. The
gate is advisory: it must never block a completed plan from exiting its phase.

**1. Read the current branch** — `git branch --show-current`.

Empty output with exit 0 means **detached HEAD**. Warn with its own wording — "HEAD is
detached at `<short sha>`; a commit here belongs to no branch" — and never read empty as
"not on the default branch".

**2. Resolve the default branch** — `git symbolic-ref --short refs/remotes/origin/HEAD`,
stripping the leading `origin/`. On any non-zero exit, fall back to the literal set
`{main, master}`. Never hardcode `main`. When the current branch equals it, warn: "You are
on the default branch `<name>`; the plan commit would land there."

**3. Derive the proposed branch name** from the active spec stem already in phase context
(the same value `/cc-compact` writes as `sys.s`):

- strip the leading `YYYY-MM-DD-` and the trailing `-design`;
- read the leading id token — `feat025` → `FEAT-025`, `bug029` → `BUG-029`, `arch008` → `ARCH-008`;
- prefix: `FEAT`/`ARCH` → `feat/`, `BUG` → `fix/` (`CONTRIBUTING.md:23`);
- body: the rest of the stem, with the id token re-spelled `feat-025`;
- `2026-09-22-feat025-conductor-db-retention-purge-design` → `feat/feat-025-conductor-db-retention-purge`.

If the stem is missing or `none`, fall back to a root `AGENT-READABLE BACKLOG.md`: grep it
for the id under discussion and derive from that heading's title. If neither source yields
a name, still run steps 1-2 and their warnings, then ask the developer for a name rather
than proposing one.

**Sanitize before interpolating:** lowercase; collapse non-alphanumerics to a single `-`;
trim leading and trailing `-`; cap the part after the prefix at 60 characters, truncated on
a `-` boundary; always interpolate double-quoted. Then `git check-ref-format --branch
"<name>"` is the authority — if it fails, or the sanitized name is empty, ask the developer
for a name. **Do not write per-character reject passes** for `..`, `@{`, `~`, `^`, `\`, or a
trailing `.lock`: the collapse rule already removes every one of them, so such passes are
unreachable code.

**4. Decide whether to stay silent.** Silence requires one of exactly two conditions:

- (a) the current branch equals the derived name; or
- (b) the current branch is feature-shaped (`feat/`, `fix/`, `chore/`, `docs/`) **and** the
  id token embedded in its name matches the current item's id — `feat/feat-026-…` while
  planning `FEAT-026`.

Only then: no warning, no offer — go to step 7, because firing on every plan run is noise.
In every other case, report both the current branch and the derived one and ask which to
use; never switch silently. That explicitly includes a feature-shaped branch carrying a
**different** id (`feat/feat-025-…` while planning `FEAT-026`) — shape never wins over id,
or the new plan commit lands on the previous feature's branch. A feature-shaped branch with
no extractable id token (a hand-made `feat/retention-purge`) fails (b) by design and falls
through to report-and-ask; do not substitute fuzzy title matching.

**5. Validate the Task 0 commit message from the approved plan.** The plan is the single
source of truth for that message and Task 0 runs it verbatim, so this gate **validates** —
it does not duplicate. Check the subject for:

- **Conventional-Commits shape**, anchored to what `CONTRIBUTING.md:37` literally says:
  "Commit messages follow Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`". Those
  four are the documented set; another Conventional-Commits type this repository has shipped
  (`test:`, `ci:`, `refactor:`) passes with a note, since `CONTRIBUTING.md` neither lists nor
  forbids it.
- **The id appears somewhere in the subject.** Bracketed suffix (`feat: bound raw_history
  with the shared retention purge [FEAT-025]`) and inline prose (`docs: add the FEAT-025
  retention purge implementation plan`) both pass. Do not demand the suffix.

Report a malformed or absent message **before Task 0 begins**, proposing the corrected
subject, so the plan is fixed at its source rather than patched at commit time.

**Synthesize a message only when the plan carries none:** `<type>: <imperative summary>
[<ID>]` — the suffix form, chosen for synthesis because it is unambiguous to generate; `type`
is `docs` for a plan commit, since the plan file is documentation. On confirmation, write the
synthesized message into the plan's Task 0 commit step; never hold it only in this gate.

**6. Ask once, then act.** Present a single confirmation covering the current branch, the
warning if one applies, the proposed branch name, and the validated or corrected Task 0
subject.

- Pre-check with `git rev-parse --verify --quiet "refs/heads/<name>"` before offering `-c`.
  If the ref already exists, offer `git switch "<name>"` without `-c` instead, and name the
  distinction in the prompt.
- On **yes**: run `git switch -c "<name>"` (or the plain `git switch "<name>"`) and report
  the resulting branch.
- On **no**: print nothing further and continue. Declining is a no-op and the workflow
  proceeds exactly as it did before this gate existed.
- No git write — `switch -c`, `switch`, or `commit` — happens without this explicit
  confirmation.
- If `git switch` refuses because a tracked file would be overwritten, report git's own
  message verbatim and stop. Do not stash, do not force, do not retry.
- Any other git failure: warn once and continue to step 7.

**7. Exit.** Only now instruct the user:

> "Plan complete. Run `/cc-compact` now before starting implementation."

Do not proceed to implementation without user confirmation that `/cc-compact` has been run.

---

## Phase exit - session row

The plan phase has completed, which is the only moment at which "phase `plan` just
finished" is a fact rather than a deduction. Write it here, at its own boundary.
Run this after step 7's exit instruction has been printed.

<!-- SESSION-ROW-TAIL:BEGIN -->
**Preconditions.** `c` is the full-40 `git rev-parse HEAD`, lowercased, matching `/^[0-9a-f]{7,40}$/`, `"0000000"` on any failure; `s` is the active spec stem or `"none"`. Both are derived exactly as this command's body already specifies.

1. Ensure `.conductor/` exists (`mkdir -p .conductor`, best-effort). If that fails, skip the tail entirely.
2. Resolve the session id: `id="$(node .claude/scripts/session-id.mjs 2>>.conductor/last-write.log)"`.
3. Probe how to launch `node:sqlite`, the same probe the `cc-implement` Step 6 hook runs: no flag first, else `--experimental-sqlite --no-warnings`, else skip the write.
4. Upsert the session row. Every argv scalar is double-quoted, because a repository path can contain spaces:

   `node <probe-flags> .claude/scripts/conductor-db.mjs session "$id" "plan" "$s" "$c" >> .conductor/last-write.log 2>&1`
5. **Loud degrade.** If the probe skipped the write, or the write exited non-zero, append one line naming the reason:

   `printf '%s\n' "CC_DB_TAIL: session row not written (<reason>)" >> .conductor/last-write.log`

   A row that is simply absent is the shape that let the recorded phase go stale across two boundaries unnoticed. The absence is always reported.

Every redirect uses append mode (`>>`), never `>`, so a rapid or parallel second run never truncates a preceding trace. Any failure in this block is **non-fatal**: the command reports its normal outcome regardless.

**Cross-platform note.** The forms above are Unix-canonical; the `.md` file is an agent instruction, not a literal script. On Windows/PowerShell realize the same semantics: set `$OutputEncoding = [System.Text.UTF8Encoding]::new($false)` first, capture `$id = node .claude/scripts/session-id.mjs`, and append the log with `… 2>&1 | Out-File -Append -Encoding utf8 .conductor/last-write.log`, never the bare `*>>`, whose default encoding is UTF-16LE on PS 5.1 and would corrupt the trace. Ensure the directory with `New-Item -ItemType Directory -Force .conductor`.
<!-- SESSION-ROW-TAIL:END -->
