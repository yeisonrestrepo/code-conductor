# FEAT-055 — Resume Verb for Halted Orchestrated Runs

**Status:** Approved 2026-11-13 by independent review (round 2)

**Item:** FEAT-055 (intake of issue #185). **Date:** 2026-11-13.

## Problem

A halt is terminal (D12). Every verb but `end` refuses a halted run (`liveRun`, `scripts/orchestrate.mjs:141`: `recover with end, then start (D12)`), and `.claude/commands/cc-orchestrate.md` ("On any halt") names `end`, then a fresh `start`, as the only recovery. `end` deletes the run file, so the fresh run starts again at `boundary_routed`: the spec and plan are re-dispatched, re-reviewed and re-approved, and every Build task already handed back is dispatched again.

That cost does not depend on where the halt happened. A halt in the last Build task, an `ORCH_HANDBACK_CONFLICT` on task 7 of 8 for example, throws away two owner approvals and seven recorded hand-backs whose documents and commits are still exactly as they were.

The run file also lacks what a safe resume would check. An approval records `{at, by, path, sha256}` (`scripts/orchestrate.mjs:774`), with no commit. A hand-back entry records `{role, gate, at, task | fix | round, verdict, ...}` (`scripts/orchestrate.mjs:463`), with neither the SNAP it was built from nor that SNAP's commit. So today nothing could prove that a kept record still describes the repository.

## Solution

Add a `resume` verb to `scripts/orchestrate.mjs`. It takes a halted run back to the last gate record that still validates and clears the halt, so the orchestrator continues with the step `nextStep` names. Records after the cut are dropped and redone. Validation follows issue #185:

- **the hand-back SNAP validates**: each kept hand-back entry stores its SNAP line from now on, and `resume` re-runs `snap-validate.mjs` on it;
- **the approved hashes still match the documents on disk**: both approvals are re-hashed with `documentHash`, the same measure `approve` and `checkApprovedDocs` use (plan checkbox ticks never count as a change);
- **HEAD descends from the commit the gate recorded**: each approval stores HEAD at approval time from now on, each hand-back entry carries its SNAP's `sys.c`, and `resume` checks `git merge-base --is-ancestor <commit> HEAD`. The agent writes `sys.c`; the contract is that it copies the `c` of the envelope it was dispatched with, which is HEAD at `install` time (`scripts/orchestrate.mjs:382`). `resume` does not compare the two: it accepts any `sys.c` that HEAD descends from, so an agent that reports its own later commit instead passes too. The plan pins the expected case in an AC5 test, with `sys.c` equal to the envelope's `c`.

An approval that fails any check refuses the whole resume, with a named error and nothing written: the owner's approval is never dropped silently. A hand-back entry that fails a check cuts the record there: it and everything after it are redone. `end` and `start` are not changed. `.claude/commands/cc-orchestrate.md` and its `project-template/` mirror describe the verb.

### The record sequence

`resume` reads the run as an ordered sequence of gate records. Only these are kept across a resume:

1. the `spec` hand-back entry, kept only together with the spec approval;
2. the spec approval;
3. the `plan` hand-back entry, kept only together with the plan approval;
4. the plan approval, which wrote `define_approved`;
5. the `code` hand-back entries for plan tasks (entries without `fix`), in order, one per task.

Every other entry, a `code` fix round, an `audit`, the `security` seat and `qa`, is Verify-band work and is always dropped. **Choice and why:** Build is the only band where per-task records advance the run (`tasks.done`), and the acceptance criterion asks that a Build halt re-dispatch *the halted task*, not the whole of Build. Verify records are verdicts on one specific diff; after a resume the diff is redone or extended, so the old verdicts no longer describe it, and an audit or security verdict kept across a resume would let a run reach `qa` on a review of a different change. Dropping them gives the fresh Verify pass its full `audit_rounds` budget. That buys no rounds beyond what `end` and `start` already give, since a fresh run also starts at round 1.

**Choice and why for Define:** a `spec` or `plan` hand-back without its approval is dropped. An unapproved document has passed no owner gate, and the halts that can land between a hand-back and its approval (`approve plan` halting `ORCH_EMPTY_SCOPE` or `ORCH_SCOPE_OVER_CAP`) are halts on that document, so keeping it would route straight back into the same halt. When the plan hand-back is dropped, the run's `review.plan` loop record is cleared with it, so the redone plan gets a fresh review loop. The same holds for `spec`. The `review` rule is stated once, in step 5 of the main path.

At least the spec approval must survive. Otherwise there is nothing to keep, and `resume` refuses `ORCH_RESUME_NO_GATE`, naming `end`, then `start`.

### What the run file gains

All new fields are additive and optional for `isValidRun`, so every run file valid today stays valid:

- `approvals.spec.commit` and `approvals.plan.commit`: `git rev-parse HEAD` at approval time, or `null` when HEAD does not resolve (no repository, no commit yet);
- each hand-back entry's `snap`: the SNAP JSON line `handback` parsed and validated, verbatim; the entry's commit is that line's `sys.c`;
- `resumes`: an array, one `{at, halt: {code, reason, at}, kept, dropped}` per resume, so the closing report can name every resume and what it discarded.

## Behavior

### Main path

The owner tells the orchestrator to resume a run that halted in Build, for example `ORCH_HANDBACK_CONFLICT` on task 3 of 5 (tasks 1 and 2 handed back cleanly).

1. The orchestrator runs `node "$S/orchestrate.mjs" resume`, with no other argument.
2. `resume` reads the run file and checks that it is valid and halted.
3. It checks both approvals: each has a `sha256` and a `commit`, the document at its `path` re-hashes to that `sha256`, and the commit is an ancestor of HEAD.
4. It walks the kept-entry sequence. The `spec` and `plan` entries are kept with their approvals. For each task entry in order, it re-validates the stored `snap` with `snap-validate.mjs` and checks that the SNAP's `sys.c` is an ancestor of HEAD. Tasks 1 and 2 pass. Task 3's entry is the one `ORCH_HANDBACK_CONFLICT` landed on, so it is dropped (see the alternative paths).
5. It writes the run in one atomic save:
   - `handbacks` is the kept prefix, and `tasks.done` is the number of kept task entries (2);
   - `gate` is the gate of the last kept record, the one `forwardGate` and `approvePlan` would have left there: `boundary_routed` (what `start` writes, `scripts/orchestrate.mjs:919`) when no plan approval is kept, since only `approvePlan` ever writes `define_approved` (`scripts/orchestrate.mjs:785`); `define_approved` when the plan approval is kept and at least one task is not; `build_executed` when every task is kept. Here it is `define_approved`;
   - `plan` and `tasks.ids` stay as they are: with the plan approval kept they are the approved plan's, and without it `approvePlan` never saved, so they are still `null` and `[]`;
   - `review` keeps `review.spec` and `review.plan` only when that document's hand-back entry is kept; a dropped `spec` or `plan` entry clears its `review` key, so the redone document gets a fresh loop;
   - `role` is `null`, `halt` is `null`, `session_id` is the calling session's id, and a `resumes` entry is appended;
   - `band` is left as it is. Nothing routes on it, and the `install` that dispatches the next agent rewrites it (`scripts/orchestrate.mjs:435`) before any agent runs;
   - `mode`, `test_command`, `audit_rounds`, `security`, `docs`, `ticket` and `approvals` are kept as they are.
6. It removes `.claude/memory/band-envelope.json`, the halted agent's envelope. It leaves `.conductor/handback/` and `.conductor/review/` in place: the owner may still be reading the halt's files there, and the orchestrator overwrites each name when the position is dispatched again.
7. It prints one line, exit 0:
   `run FEAT-NNN resumed after ORCH_HANDBACK_CONFLICT from define_approved: kept 6 record(s), dropped 1; next: install code (task 3 of 5)`.
8. The orchestrator prints the run header again and continues at step 2 of `/cc-orchestrate` with the step that line names: `install code --check`, the pause in step mode, `install code`, and a fresh `code` dispatch for task 3. Both approvals stand, so the Define band is not re-run.

### Alternative paths

- **Halt in Verify** (`ORCH_AUDIT_RETURN`, `ORCH_AUDIT_ESCALATE`, `ORCH_SECURITY_BLOCKED`, `ORCH_GATE_WITHHELD` and the rest). Every task entry is kept if it validates, so `gate` is `build_executed`, and every Verify entry and fix round is dropped. `next: install audit`: the run redoes Verify from audit round 1. Edits a fix-round agent made stay in the working tree, since the script never edits a tracked file, and the new audit reviews them.
- **Halt in Define after the spec approval** (for example `ORCH_EMPTY_SCOPE` from `approve plan`). The spec and its approval are kept, and the plan entry and the `review.plan` loop are dropped. No plan approval was ever saved, so `gate` is `boundary_routed`, never `define_approved`. `next: install plan`.
- **The halt landed on a recorded entry.** `ORCH_HANDBACK_CONFLICT` is raised against the last entry (`scripts/orchestrate.mjs:742`): an agent handed the same position back twice, so the entry is ambiguous. When `halt.code` is `ORCH_HANDBACK_CONFLICT`, `resume` drops the last entry before it walks the sequence, and that position is redone, with one exception: a `spec` or `plan` entry whose approval is recorded is kept. The conflict also fires there, because `role` is `null` between `approve spec` and `install plan`, and between `approve plan` and the first `install code`. **Choice and why:** the owner already approved the document on disk, and `resume` re-hashes it against the approval, so the second report cannot have changed what was approved; dropping the entry would leave an approval without its entry, which the record sequence forbids, and `nextStep` would ask for `install spec` or `install plan` again under a standing approval (`scripts/orchestrate.mjs:152,154`). So a conflict on an approved document's entry is resolved by keeping it, and the run continues with the step after that approval (`install plan`, or `install code` for the first task). A `spec` or `plan` entry without its approval is dropped by the Define rule anyway, and a `code` task entry is dropped and its task redone. Every other halt that lands on a saved entry (`handback audit`, `handback security`) is in Verify, whose entries are dropped anyway.
- **Halt with an agent dispatched** (`run.role` set, for example `ORCH_HANDBACK_INVALID` on task 3's report). No entry was recorded for task 3, so `tasks.done` already points at it. `resume` sets `role` to `null` and task 3 is re-dispatched. The halted agent's partial edits stay in the tree, and the fresh agent finds them. A plan box it ticked stays ticked, and that never changes the plan hash.
- **A task entry fails validation** (its SNAP no longer passes `snap-validate.mjs`, its `sys.c` does not resolve, or HEAD no longer descends from it, for example after a `git reset` past that task's commit). The sequence is cut at the first failing entry. It and every later task are redone, and `dropped` counts them. The first kept task after the cut is the first task re-dispatched.
- **An entry written before FEAT-055** has no `snap`. It fails validation and is cut, like any other failing entry. A run whose approvals predate FEAT-055 is refused first (see the error cases), so this happens only in a run that started under an older script and was approved under this one.
- **The run belongs to another session.** A halted run is never live, and `start` already replaces another session's run. `resume` binds the run to the calling session, so Guard 6 enforces it there from then on. It refuses when the calling session has no id (`ORCH_NO_SESSION_ID`), because Guard 6 could never bind the run.
- **A second halt after a resume.** It is recorded as before, and `resume` can run again: each resume appends its own `resumes` entry.
- **`end` instead of `resume`.** Unchanged: `end` prints the run, now with any `snap`, `commit` and `resumes` fields, and removes it. `start` is unchanged too: it still refuses `ORCH_RUN_ACTIVE` for this session's run, halted or not, and still replaces another session's.

### Error cases

Every failure is a `Refusal`: exit 2, a message on stderr that begins with its code, and nothing written. The run stays halted, with its halt record as it was, and the envelope file stays on disk. `resume` is added to the verbs `cli` never records a halt for, next to `start` and `envelope`, so a `Halt` thrown by a helper it reuses can never overwrite the halt being resumed.

| Code | When | Message names |
|---|---|---|
| `ORCH_RESUME_NO_RUN` | No run file, or one that `isValidRun` rejects. | the run file path |
| `ORCH_RESUME_NOT_HALTED` | The run has no halt. | its item and the step `nextStep` names: a live run continues with `install`, never `resume` |
| `ORCH_NO_SESSION_ID` | `CLAUDE_CODE_SESSION_ID` is absent or empty. | the variable, as `start` does |
| `ORCH_RESUME_NO_GATE` | No spec approval is recorded. | `end`, then `start` |
| `ORCH_APPROVAL_UNHASHED` | An approval has no `sha256` (approved before FEAT-056). | `end`, then `start` (the existing code, reused) |
| `ORCH_RESUME_UNANCHORED` | An approval has no `commit` (approved before FEAT-055), or its `commit` is `null`, or git cannot answer the ancestry question (exit code other than 0 or 1). | the approval, the reason, and `end`, then `start` |
| `ORCH_APPROVED_DOC_CHANGED` | An approved document re-hashes to another value or cannot be read. | the kind, path, approved hash and current hash (the message `checkApprovedDocs` builds, reused), and `end`, then `start` |
| `ORCH_RESUME_HISTORY_REWRITTEN` | HEAD does not descend from an approval's `commit` (`--is-ancestor` exits 1). | the approval, its commit and HEAD, and `end`, then `start` |
| usage | Any argument after `resume`. | `usage: orchestrate.mjs resume` |

**Choice and why, `ORCH_APPROVED_DOC_CHANGED`:** the acceptance criterion asks for a named error when an approved document changed. Reusing the code `install` already halts with, and that the command file already documents, gives the owner one name for one condition. `resume` raises it as a refusal, not a halt, because the run is already halted and a resume that fails must leave it exactly as it was.

**Choice and why, refusing on approvals and cutting on entries:** an approval is the owner's act, and the run cannot redo it on its own. Cutting there would quietly re-open Define and ask for an approval the owner already gave on a document that has since changed. A hand-back entry is the run's own work, which it can redo by itself.

`liveRun`'s refusal for a halted run changes from `recover with end, then start (D12)` to `recover with resume, or end then start (D12, FEAT-055)`, so a refused verb names the new recovery. That refusal covers `install`, `handback`, `approve` and `review`, never `start` or `end`.

## Acceptance Criteria

Each maps to the entry's acceptance criteria (the first three) or to the validation issue #185 names.

- [ ] **AC1 (entry: keeps both approvals, re-dispatches the halted task).** A test builds a run with both approvals recorded under this script, two of three task hand-backs recorded, and a halt on task 2's second hand-back (`ORCH_HANDBACK_CONFLICT`). `resume` exits 0, the run's `approvals` are byte-for-byte the same, `halt` is `null`, `tasks.done` is 1, `handbacks` holds spec, plan and task 1, and `install code --check` then names task 2. A second test halts with `run.role === 'code'` on task 2 (no entry recorded) and gets the same outcome. A third test halts `ORCH_HANDBACK_CONFLICT` on a second `plan` report after `approve plan`: `resume` keeps the plan entry and both approvals, `gate` stays `define_approved`, and `install code --check` names task 1; the same test for a second `spec` report after `approve spec` keeps the spec entry and is followed by `install plan --check`.
- [ ] **AC2 (entry: refuses with a named error when an approved document changed).** A test edits the approved spec (and, separately, the approved plan's text outside a checkbox) after a halt. `resume` exits 2 with stderr starting `orchestrate: ORCH_APPROVED_DOC_CHANGED:`, and the run file's bytes are unchanged. Ticking a plan checkbox does not trigger it: the resume succeeds.
- [ ] **AC3 (entry: `end` and `start` behave exactly as today).** The existing `end` and `start` tests pass unchanged. A test shows `end` on a halted, resumed and re-halted run prints the record and removes the run, envelope, hand-back and review files, as before, and a test shows that `start` in the run's own session still refuses `ORCH_RUN_ACTIVE` on a halted run.
- [ ] **AC4 (issue: the hand-back SNAP validates).** `handback` stores each entry's validated SNAP line as `snap`. A test corrupts a kept task entry's `snap` in the run file, and `resume` cuts there: that task and later ones are redone, and `dropped` counts them.
- [ ] **AC5 (issue: HEAD descends from the recorded commit).** In a temp git repository, `approve` records `commit` equal to HEAD. A test resets HEAD to before the plan approval's commit, and `resume` refuses `ORCH_RESUME_HISTORY_REWRITTEN` with nothing written. A test whose task entry carries a `sys.c` that HEAD does not descend from cuts the sequence at that task. A test whose task entry's `sys.c` is the `c` of the envelope `install code` wrote keeps that entry.
- [ ] **AC6 (anything after the gate is redone).** A test halting in Verify (`ORCH_AUDIT_RETURN`) shows that `resume` keeps every task entry, drops every audit and fix entry, sets `gate` to `build_executed`, and that `install audit --check` follows. A test halting in Define after the spec approval (`ORCH_EMPTY_SCOPE`) shows that the plan entry and `review.plan` are dropped, `review.spec` is kept, `gate` is `boundary_routed`, and `install plan --check` follows.
- [ ] **AC7 (refusals write nothing).** Each code in the error table has a test that asserts exit 2, the stderr prefix, unchanged run-file bytes, and an envelope file still in place.
- [ ] **AC8 (record).** A successful `resume` appends one `resumes` entry, `{at, halt, kept, dropped}`, binds `session_id` to the caller, removes the envelope file and prints the line in the main path. `isValidRun` accepts a run file without any of the new fields.
- [ ] **AC9 (docs).** `.claude/commands/cc-orchestrate.md` describes `resume` under "On any halt" (when to offer it, only on the owner's word, its refusals, and that the run then continues at step 2 with the step it prints). `D12` is amended there, the report step names each `resumes` entry, and `project-template/.claude/commands/cc-orchestrate.md` stays byte-identical (`tests/installer/commands-parity.test.js`).
- [ ] **AC10.** `npm test` passes.

## Out of Scope

- Keeping any Verify-band record (audit, fix round, security, qa) across a resume, and resuming mid-review-loop. The loop never halts the run.
- Resuming a run whose approvals were recorded before FEAT-055 or FEAT-056. Those runs recover with `end`, then `start`, as today.
- Reverting or inspecting working-tree edits made by an agent whose position is redone. The script never edits a tracked file.
- Changing `end`, `start`, the halt codes any other verb raises, Guard 6, or the SNAP contract.
- Automatic resume. `resume` runs only on the owner's word, exactly as `end` does today.
- A `resume` mode for the phase-command envelopes (`envelope` verb, FEAT-061). They carry no run.

## System Impact

- `scripts/orchestrate.mjs`:
  - a new `resume` verb, its helpers (approval check, entry walk, ancestry check through `spawnSync('git', ['merge-base', '--is-ancestor', …])`) and its usage line;
  - `approve` records `commit`;
  - `handback` (through `recordHandback`'s `extra` or `entryFields`) stores `snap`;
  - `liveRun`'s halted-run message changes;
  - `cli` gains the verb, adds it to the no-`recordHalt` exclusion, and adds it to the usage refusal;
  - `isValidRun` keeps accepting the new optional fields;
  - the D12 comment at line 71 is amended.
- `checkApprovedDocs` (`scripts/orchestrate.mjs:405`) already holds the hash comparison and its message. `resume` reuses that logic and raises a refusal instead of a halt, either through a shared helper that returns the failure or by catching and re-throwing it. The plan picks one.
- `.claude/commands/cc-orchestrate.md` and `project-template/.claude/commands/cc-orchestrate.md`: "On any halt", the D12 sentence, the exit-code section (nothing changes for exit 2, a refusal), and step 6 (the report names `resumes`).
- `tests/scripts/orchestrate.test.js`: new `resume` tests. The test `refuses every verb but end once a run has halted (D12)` (line 345) pins the old `liveRun` message and is updated with it, and its name now excepts `resume` as well.
- Callers checked: `nextStep`, `forwardGate`, `entryFields` and `fixDue` read `handbacks` and `tasks`. A truncated prefix is a state they already reach in a normal run (the run just after task *k*'s hand-back), so routing after a resume needs no change. Guard 6 (`.claude/hooks/pre-tool-use.mjs:235-298`) reads only `session_id` from the run file, and `resume` writes it with the caller's id. `tests/hooks/guard6.test.js` needs no change.
- No new dependency, no network, no workflow, and no change to the installer, the hooks or the SNAP scripts.

### Files Requiring Full Read (deferred to /cc-plan)

- `scripts/orchestrate.mjs` (1060 lines; under the 30-line cap only its header was read, and the functions this spec cites were located by search): `liveRun`, `nextStep`, `recordHandback`/`entryFields`, `handback`, `approve`/`approvePlan`, `checkApprovedDocs`, `review`, `start`, `end`, `recordHalt`, `isValidRun`, `cli`.
- `tests/scripts/orchestrate.test.js`: its fixtures for building halted runs and temp git repositories.

## Complexity Estimate

M: one new verb of about 80 lines of logic in one script, two one-field record additions, a mirrored command-file section, and about a dozen tests. It has no new surface beyond the CLI verb and nothing in the protected hook, installer or SNAP code.
