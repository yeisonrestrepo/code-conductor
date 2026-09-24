---
description: "(Conductor) Map implementation steps from an approved spec"
---

## Phase entry - Resume Read

Before doing anything else, restore any stored context for the current commit by running `scripts/resume-read.mjs`. It resolves the current git hash, prefers a valid DB snapshot (`conductor-db get-snapshot`), falls back to the `.claude/memory/session-snapshot.json` handoff file, and prints a `RESUME_HIT` block on a hit / nothing on a miss. Capture its stdout **and** its exit code with the canonical per-platform form (each first probes for `node` and treats its absence as a clean miss, never an error):

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
**before any step of the approved plan's Task 0 executes**, including its `git add` /
`git add -f` and its `git commit`. Its position in this file is not the guarantee; the
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
