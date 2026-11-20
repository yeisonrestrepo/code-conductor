# BUG-078 — Fix-round write scope includes the approved plan

**Status:** Approved 2026-11-20 by independent review (round 1)

**Item:** `[BUG-078]` (intake of issue #203). Pillar 5: infrastructure, ecosystem and quality assurance.

## Problem

When an audit returns the change, `auditFix` (`scripts/orchestrate.mjs:715`) computes the fix round's write scope
with `fixScope` (`:336`), and `codeScope` (`:562`) recomputes it the same way when `install code` writes the fix-round
envelope and when `handback code` checks the hand-back against it. `fixScope` first checks that every file the audit
named is a file the approved plan's tasks declare and is neither the plan nor the spec (`:337`-`:340`), then builds
the scope with `taskScope({ id: 'fix round N', files }, run.plan)` (`:341`). `taskScope` (`:324`) always appends its
second argument, so the fix-round scope ends in `run.plan`. (The issue cites `:173` and `:188`; the code has moved
since, and the lines above are the current ones.)

Guard 5 enforces the envelope's `ops.scope`, so it lets the fix-round `code` agent write to the approved plan. The
plan is in a normal task's scope for one reason: the task agent ticks its checkboxes. A fix round ticks no boxes. Its
brief says so (`.claude/commands/cc-orchestrate.md:206`: "do not edit the spec or the plan, and tick no boxes"), and
`fixScope` itself refuses the plan as a fix target. Today only that sentence keeps the agent off the plan.

The limit, as the entry states it: any change to the plan other than checkbox ticks is still caught, because
`checkApprovedDocs` halts with `ORCH_APPROVED_DOC_CHANGED` on the next `install audit` and in `auditFix` before
another fix round. Checkbox ticks get through, and they do not move `tasks.done`. So this is defense in depth, not an
exploitable bypass, and the fix is the entry's: let Guard 5 enforce what the brief states only in words.

## Solution

Build the fix-round scope from the files the audit named, without the plan. `fixScope` keeps its checks and its halts
and stops passing `run.plan` into the scope. A normal task's scope is unchanged: its files plus the plan.

**Choice: one shared check helper, not an optional `planRel`.** The empty-scope and cap checks in `taskScope`
(`:325`-`:330`) must still run on the fix-round scope. Making `planRel` optional would put "no plan" behind an
`undefined` argument that a reader of the call site cannot see. Instead the plan extracts those checks into one
internal function that takes an id and the scope entries and returns the scope or halts with the existing codes and
messages. `taskScope(task, planRel)` keeps its exported signature and behavior and calls it with
`[...task.files, planRel]`; `fixScope` calls it with the audit's files only. The halts keep their wording
(`ORCH_EMPTY_SCOPE: fix round N declares no files`, `ORCH_SCOPE_OVER_CAP: fix round N needs K scope entries; the cap
is 20`), so no documented message changes.

**Choice: no hook change.** Guard 5 already enforces exactly the envelope's `ops.scope`; the defect is the scope the
script writes, not the guard. The hand-back check `claimHalt` (`:999`) recomputes the scope through `codeScope`, so it
follows the new scope with no change: a fix-round hand-back naming the plan in `ops.f` now halts
`ORCH_HANDBACK_OUT_OF_SCOPE`, as a hand-back naming any other file outside its scope does.

**Choice: correct the `code` role profile in the same change.** `.claude/agents/code.md:8` (and its byte-identical
copy `project-template/.claude/agents/code.md:8`) tells the agent "its `ops.scope` is the task's files plus the plan
file". After this fix that is false in a fix round, so the sentence gains a clause: in a fix round the scope is the
files the review names, without the plan. This is one sentence in a file this item's behavior makes stale, not a
scope expansion. `.claude/agents/plan.md:12` describes a task's scope ("its files plus the plan file", hence the
19-file limit), which is still true, and stays as it is.

## Behavior

### Main path

1. An audit returns the change with blockers or majors in `src/a.js` and `src/b.js`, both files of the approved plan.
2. `handback audit` records the fix and prints
   `audit round 1: RETURN with 2 blocker/major finding(s); fix round 1 of N: review … sha256 …; scope src/a.js, src/b.js`.
   The plan path no longer ends the scope list.
3. `install code --check` and `install code` print and write an envelope whose `ops.scope` is
   `["src/a.js", "src/b.js"]`.
4. The fix-round agent edits `src/a.js` and `src/b.js`. A write to the plan (a checkbox tick included) is denied by
   Guard 5 as a write outside the scope.
5. `handback code` with `ops.scope` `["src/a.js", "src/b.js"]` and `ops.f` inside it is recorded as today: the fix
   round, no task, `tasks.done` unchanged.

### Alternative paths

- **A normal plan task.** `install code` for a plan task still writes the task's files plus the plan, and the agent
  still ticks its boxes. `approve plan` still checks every task's scope with the plan included, so the 19-file task
  limit and its `ORCH_SCOPE_OVER_CAP` halt at 20 files are unchanged.
- **A fix round naming 20 plan files.** The scope is 20 entries and passes the cap; before this fix it was 21 with
  the plan and halted. A fix round naming 21 files still halts `ORCH_SCOPE_OVER_CAP: fix round 1 needs 21 scope
  entries; the cap is 20`, with the audit entry recorded and no `fix` record, as today.
- **A fix-round hand-back that lists the plan in `ops.f`.** It halts `ORCH_HANDBACK_OUT_OF_SCOPE` and is not
  recorded (the scope check BUG-075 added), naming the plan path and the fix scope.
- **A fix round installed by the previous script and handed back by this one** (an upgrade in the middle of a fix
  round). The installed envelope's scope ends in the plan and the recomputed one does not, so `handback code` halts
  `ORCH_HANDBACK_SCOPE_MISMATCH` without recording, the existing halt for an envelope that does not match its
  position. Recovery is the one `cc-orchestrate.md` documents for that halt: `resume` or `end`, then `start`; the
  next `install code` writes the new scope.

### Error cases

- Every halt `fixScope` raises today is raised with the same code and message: `ORCH_FIX_SCOPE_UNAPPROVED` for a file
  outside the plan or one of the approved documents, `ORCH_EMPTY_SCOPE` for a fix record with no files (a hand-edited
  run file), `ORCH_SCOPE_OVER_CAP` past 20 entries or past the 300-character element cap.
- No new halt code, no new message, no new field in the run file.

## Acceptance Criteria

- [ ] **AC1 (the entry's fix).** After an audit `RETURN`, the fix-round envelope's `ops.scope` (from both
  `install code --check` and `install code`) is exactly the files the audit named, in order, and does not contain
  `run.plan`. A test asserts it (the entry's requested test).
- [ ] **AC2.** `handback audit`'s RETURN line ends `scope <files>` without the plan path.
- [ ] **AC3.** A fix-round hand-back whose `ops.f` names the plan halts `ORCH_HANDBACK_OUT_OF_SCOPE`, unrecorded; one
  whose `ops.f` stays inside the fix files is recorded as a fix round with `tasks.done` unchanged.
- [ ] **AC4 (no regression for tasks).** A plan task's envelope scope is still its files plus the plan, and a task of
  20 files still halts `ORCH_SCOPE_OVER_CAP` at `approve plan`.
- [ ] **AC5.** A fix round of 21 plan files halts `ORCH_SCOPE_OVER_CAP: fix round 1 needs 21 scope entries; the cap is
  20` with the audit entry recorded and no `fix` record; one of 20 files passes.
- [ ] **AC6.** `fixScope`'s existing halts are unchanged: the `ORCH_FIX_SCOPE_UNAPPROVED` cases (a file outside the
  plan, a different spelling, the plan, the spec) keep their tests and messages.
- [ ] **AC7.** `.claude/agents/code.md` and `project-template/.claude/agents/code.md` say that a fix round's scope is
  the files the review names, without the plan, and stay byte-identical.
- [ ] **AC8.** `npm test` passes; the existing fix-round tests that expected the plan at the end of the scope
  (`tests/scripts/orchestrate.test.js:1848` C5, `:1858` C6, `:2052` E1, `:2108` the cap test) are updated to the new
  scope, not deleted.

## Out of Scope

- Guard 5 and the hooks (`.claude/hooks/pre-tool-use.mjs` and the OpenCode guard): unchanged.
- `checkApprovedDocs` and `ORCH_APPROVED_DOC_CHANGED`: unchanged; they remain the check for non-checkbox edits.
- The brief's dispatch-table row (`.claude/commands/cc-orchestrate.md:206`): its instruction stays; it is now also
  enforced.
- Records: the `[BUG-078]` line under "Known limits" in `README.md` (`:502`), `CHANGELOG.md`, `VERSION` and the
  backlog are written by the release.
- Any change to a normal task's scope or to the 20-entry cap.

## System Impact

- `scripts/orchestrate.mjs`: `taskScope` (`:324`) split into the shared check and its scope construction; `fixScope`
  (`:336`-`:342`) builds its scope without the plan. Callers reviewed: `codeScope` (`:562`-`:566`), `auditFix`
  (`:715`-`:726`), `approvePlan` (`:1070`), `claimHalt` (`:999`-`:1010`, which follows `codeScope`).
- `tests/scripts/orchestrate.test.js`: the fix-round tests listed in AC8, plus the new assertions of AC1 to AC5.
- `.claude/agents/code.md:8`, `project-template/.claude/agents/code.md:8`: one sentence.
- No dependency, workflow, network, installer or settings change. The change narrows a write scope; it does not
  widen any permission.

### Files Requiring Full Read (deferred to /cc-plan)

- `scripts/orchestrate.mjs` — the regions named above, to place the extracted check and keep it under 30 lines.
- `tests/scripts/orchestrate.test.js` — the fix-round describe blocks around `:1815`-`:1900` and `:2030`-`:2180`, to
  update the expectations and place the new tests.

## Complexity Estimate

S — one function's scope construction in one script, one sentence in a mirrored role profile, and test
expectations that follow.
