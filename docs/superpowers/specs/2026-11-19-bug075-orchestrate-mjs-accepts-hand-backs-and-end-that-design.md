# BUG-075: orchestrate.mjs accepts hand-backs and `end` that contradict the work claimed

**Status:** Draft (pending independent review)
**Item:** BUG-075 (intake of issue #175)
**Date:** 2026-11-19

## Problem

`scripts/orchestrate.mjs` writes the run record from what the agents and the orchestrating session claim, and it checks only the shape of those claims. Three gaps let the record say something the run did not do:

1. **Hand-back scope.** `handback <role>` (`handback`, `parseHandback`, ~L664-995) checks that the report carries exactly one `SNAP_HANDBACK` line, that the SNAP validates as v3/v4, that `sys.role` is the dispatched role and that `ops.gate` is in `MAY_HAND_BACK[role]`. It never compares the hand-back's `ops.scope` with the scope the script installed, nor the paths in `ops.f` with that scope. The issue's reproduction recorded a `code` hand-back with `ops.scope: ["**"]` and `ops.f` naming out-of-scope and `../` paths at rc 0. Guards 5 and 7 still deny the writes themselves; the record, however, now lists them as the task's work.
2. **`end` without Verify.** `end` (~L1491) removes the run file and prints it whatever the run's position. `cc-orchestrate.md` step 5 runs `end` only after `qa` records `verify_pass`, and the halt recovery runs it only after a halt, but the script enforces neither: the issue ended a live run with no audit or qa hand-back, and the live FEAT-047 run ended at `build_executed`. The printed record is what step 6 reports from, so an unverified run reads as finished.
3. **Approver identity.** `approve spec|plan` (~L1019) records `by: git config user.name`. That is the identity configured on the machine, not the person who approved; on a shared or borrowed checkout it names someone who took no part, and on an unconfigured one it records `unknown`.

A fourth symptom the issue names is a `code` hand-back of `build_executed` whose report says the suite exited 1 (FEAT-045). See "Choices the entry leaves open", item 4: the `code` role's contract makes that hand-back legitimate, and the fix for gap 2 is what stops it from ending as a pass.

## Solution

`handback` gains one claim check, run after the existing shape checks and before the entry is recorded: for a role whose installed envelope carries `ops.scope`, the hand-back's `ops.scope` must equal the scope the script computes for that position, and every `ops.f` path must be a clean relative path that the scope covers; for a role whose envelope has no scope, the hand-back must carry none. A failure halts the run with a new code and records nothing. `end` refuses, writing nothing, unless the run is halted, its last record is `qa`'s `verify_pass`, or the owner passes `--abandon`, in which case the removed record is printed under a line that says it was abandoned unverified. `approve` records `by: "owner"`, the role that gives the approval, mirroring the `by: "define-review"` the delegated approval already records. `resume` applies the same claim check to the code hand-backs it would keep. The band flow, the SNAP contract and the role files are unchanged.

### Choices the entry leaves open

1. **Where the expected scope comes from.** The script recomputes it, with the same functions the install used (`codeScope` for a code task or fix round, `docScopes` for `spec` and `plan`), and never reads it back from `.claude/memory/band-envelope.json`: that file is on the orchestrator's write surface, so a value read from it is again a claim. The comment above `codeScope` already applies the same rule to the run file.
2. **What "covered" means.** A code scope is a list of exact paths (the task's files plus the plan), so an `ops.f` path is covered when it equals one of them. A `spec`/`plan` scope is one folder glob, so a path is covered when `globToRegExp` of an entry matches it, the matcher the script already uses for the same globs. Before matching, a path is rejected outright when it is absolute (a leading `/` or a drive letter), or has an empty, `.` or `..` segment: no normalization is attempted, because a path that needs normalizing is not the one the scope names. `snap-validate.mjs` already rejects backslashes and a missing action code.
3. **Which roles.** The check runs for every role, keyed on the computed scope rather than a role list: `spec`, `plan` and `code` carry one; `audit`, `qa` and `security` carry none, and the hand-back must then leave the key out, as every role file already says ("if your envelope has no scope, leave the key out"). `ops.f` of a scopeless (read-only) role is not checked: those roles hold no write tool, and their role files do not define what `ops.f` lists.
4. **A red suite in a `code` hand-back.** Not rejected by this item. `.claude/agents/code.md` ("Success condition") fixes the gate's meaning: "A red suite is reported as red; the gate claims only that the run happened and was reported", and the exit status lives in free report text, not in the SNAP. Halting on it would change the band flow (a red task would stop the Build band instead of reaching the audit) and the code role's contract, which the entry says this item does not imply. What makes a red suite unable to end as a pass is gap 2: `qa` hands back `verify_pass` only when it re-ran the suite as a non-author and it exited 0 (`qa.md`), and `end` now requires that record. Whether a red code hand-back should also halt was a product decision; it is settled under Owner decisions below: it keeps being accepted.
5. **The `end` escape.** An owner must still be able to drop a live run (on `ORCH_RUN_ACTIVE`, after declining a pause, or to restart). That stays possible, but only explicitly: `end --abandon`. A halted run needs no flag, because ending it is already the documented recovery.
6. **Approver identity.** The script cannot observe a person: the verb is run by the orchestrating session on the owner's word. The only truthful fixed value is the role that approves, so `by` becomes `"owner"`, and the delegated path keeps `"define-review"`. The approval's other keys are unchanged (the FEAT-055 A3 test pins `at, by, path, commit, sha256`); the session that approved is already `run.session_id`. Old run files keep whatever `by` they recorded; nothing reads `by` to decide anything (`grep` shows its only writers at ~L1019 and ~L1201 and no reader).

### Owner decisions

- **Red suite in a `code` hand-back: keep accepting it.** A `code` hand-back that reports a red suite stays accepted, as `.claude/agents/code.md` defines it today. No `TESTS:` report line is added, and neither the code role's report nor the Build band flow changes. The pass claim stays with the non-author `verify_pass` that `end` now requires (choice 4).
- **The rest of the spec stands as proposed:** the expected scope is recomputed from `codeScope`/`docScopes` and never read from `band-envelope.json`; the new codes `ORCH_HANDBACK_SCOPE_MISMATCH`, `ORCH_HANDBACK_OUT_OF_SCOPE` and `ORCH_END_UNVERIFIED`; `end --abandon`; and `approve` recording `by: "owner"`.

## Behavior

### Main path

1. `install code` installs task T's envelope with scope `[<T's files>, <plan>]`. The agent hands back `ops.scope` equal to that list and `ops.f` naming only those files (`<path>:C|M|D`). `handback code` recomputes the scope, finds it equal, finds every `ops.f` path covered, and records the entry exactly as today.
2. `spec`/`plan` hand back `ops.scope` equal to their folder glob and `ops.f` naming the one document under it; recorded as today. `checkSpecHandedBack` keeps working, since the path it binds is now known to be in scope.
3. `audit`, `security` and `qa` hand back with no `ops.scope`; recorded as today.
4. After `qa` records `verify_pass`, `end` removes the run files and prints the record unchanged, byte for byte as today (step 6 of `cc-orchestrate.md` parses it).
5. `approve spec|plan` records `by: "owner"`.

### Alternative paths

- **Halted run.** `end` on a run with a `halt` object removes and prints it as today: this is the documented recovery and needs no flag.
- **No run file.** `end` prints `no run file` and exits 0, as today.
- **Unreadable or invalid run file.** `end` removes it as today; refusing would leave the owner no way to clear a broken record except deleting it by hand.
- **Owner abandons a live run.** `end --abandon` on a live, unverified run removes the run files and prints `run <ITEM> abandoned at <gate> before verify_pass` on its first line, then the record. `--abandon` on a run that `end` would accept anyway behaves as plain `end` (no abandon line): the flag permits, it never relabels a verified run.
- **Fix round.** The expected scope is the fix round's `fixScope`, as `install code` computed it; the plan file stays in scope so the agent may tick its box.
- **Resume.** `resume` runs the claim check on each code hand-back it would keep, against that task's recomputed scope. The first record that fails is dropped with everything after it, as a record whose SNAP no longer validates is today.
- **Pre-FEAT-047 run** (no doc locations): `install spec|plan` already halts `ORCH_DOC_LOCATION_UNRESOLVED`, so no spec/plan hand-back reaches the new check without a scope.

### Error cases

- `ops.scope` absent, or different from the computed scope (any order, element or length difference, including `["**"]`), on a role with a scope; or present on a role without one → halt `ORCH_HANDBACK_SCOPE_MISMATCH: <role> was installed with scope <expected>, the hand-back names <claimed|none>`. Nothing is recorded, the run gets its `halt`, rc as other halts.
- An `ops.f` path that is absolute, has an empty, `.` or `..` segment, or is not covered by the scope → halt `ORCH_HANDBACK_OUT_OF_SCOPE: <role> lists <path> in ops.f, outside its scope <scope>`, naming the first such path. Nothing is recorded.
- The plan cannot be read while recomputing a code scope → the existing `cannot read <plan>` halt that `codeScope` already raises.
- `end` on a live run whose last record is not `qa`'s `verify_pass`, without `--abandon` → refusal `ORCH_END_UNVERIFIED: run <ITEM> is at <next step> with no verify_pass; end it only after qa, after a halt, or with end --abandon on the owner's word`, exit 2, nothing written or removed.
- `end` with any other argument → refusal with the verb's usage, exit 2, nothing removed.
- Recovery for both new halts is `resume` or `end`, then `start`, as for every hand-back halt; `cc-orchestrate.md`'s halt list names them and the hand-back file the owner reads.

## Acceptance Criteria

- [ ] A `code` hand-back with `ops.scope: ["**"]` halts `ORCH_HANDBACK_SCOPE_MISMATCH`; the run file gains a `halt` and no new hand-back entry, and `tasks.done` is unchanged.
- [ ] A `code` hand-back with the installed scope but an `ops.f` entry outside it (another repo file, `../x:M`, `/abs:M`, `a/./b:M`, `a//b:M`) halts `ORCH_HANDBACK_OUT_OF_SCOPE` naming that path, and records nothing.
- [ ] A `code` hand-back whose `ops.scope` lists the same entries in another order halts `ORCH_HANDBACK_SCOPE_MISMATCH` (the role copies it verbatim).
- [ ] A conforming `code` hand-back (task files and the plan in `ops.f`) is recorded exactly as before; the same holds for a fix round against its `fixScope`.
- [ ] A `spec` or `plan` hand-back whose `ops.f` names a file outside its folder glob halts `ORCH_HANDBACK_OUT_OF_SCOPE`; one under the folder is recorded as before.
- [ ] An `audit`, `security` or `qa` hand-back that carries an `ops.scope` halts `ORCH_HANDBACK_SCOPE_MISMATCH`; one without it is recorded as before.
- [ ] The expected scope is recomputed: editing `.claude/memory/band-envelope.json` to `["**"]` after `install code` and handing back `["**"]` still halts.
- [ ] `end` on a live run with no `qa` `verify_pass` exits 2 with `ORCH_END_UNVERIFIED` and leaves the run file and envelope in place.
- [ ] `end` after `qa`'s `verify_pass`, on a halted run, on an invalid run file, and with no run file, behaves byte for byte as today.
- [ ] `end --abandon` on a live unverified run removes the run files and prints the abandon line, then the record; on a verified run it prints the record alone.
- [ ] `approve spec` and `approve plan` record `by: "owner"`, whatever `git config user.name` is (set or unset); the delegated approval still records `by: "define-review"`.
- [ ] `resume` drops a kept code hand-back whose stored SNAP fails the claim check, and every record after it.
- [ ] Existing tests that call `end` on a live unverified run for cleanup pass `--abandon`; the full `npm test` is green.
- [ ] `cc-orchestrate.md` names the two new halt codes, `ORCH_END_UNVERIFIED`, and `end --abandon` as the owner-word way to drop a live run; no role file and no SNAP schema changes.

## Out of Scope

- Halting on a red suite in a `code` hand-back (settled under Owner decisions: kept accepted); the `code` role's report format.
- Checking `ops.f` of read-only roles, and checking that `ops.f` matches the files the agent actually changed on disk (git diff against the task): Guards 5 and 7 own the writes; this item owns the record.
- Any change to the SNAP schema, `snap-validate.mjs`, the band order, `MAY_HAND_BACK`, the guards, or the role files under `.claude/agents/`.
- Rewriting `by` in existing run files, or recording any personal identity.
- The installer and `project-template/` copies beyond what the repo's existing sync tests already require of `scripts/orchestrate.mjs` and `cc-orchestrate.md`.

## System Impact

- `scripts/orchestrate.mjs`: `handback` (new claim check after the gate check), a small scope-check helper reused by `resume`'s kept-record loop (`keptEntries` / `taskEntryHolds`), `end` (guard and `--abandon`), `approve` (~L1019 `by`), the verb dispatch for `end`'s argument (~L1603), and possibly `gitValue` if `approve` was its last caller.
- `.claude/commands/cc-orchestrate.md`: halt list (step 2.6 / "On any halt"), step 5's `end`, the `ORCH_RUN_ACTIVE` "offer end" line, and the Resume paragraph's mention of `end`.
- `tests/scripts/orchestrate.test.js`: new cases for each criterion; existing live-run `end` cleanups gain `--abandon`; L199 and the A3 test (~L1605) gain the `"owner"` value.
- Any installed or template copy of `orchestrate.mjs` / `cc-orchestrate.md` that a parity test pins (to be confirmed in `/cc-plan`).

### Files Requiring Full Read (deferred to /cc-plan)

- `scripts/orchestrate.mjs` (1620 lines): `handback` past the gate check (~L985-995), `end` and the verb dispatch (~L1491, ~L1590-1610), `keptEntries` / `taskEntryHolds` / `resume` (~L1278-1345), `docScopes` / `envelopeFields` (~L332-345, ~L555-580), `fixDue`.
- `tests/scripts/orchestrate.test.js`: every `orch(['end'])` call site (about 20) to classify live-run cleanups versus post-verify or post-halt ends.

## Complexity Estimate

M: three independent checks in one script plus a documentation update, but the `end` guard touches about twenty existing test call sites and the scope check has to reuse the install-time scope functions for three role kinds and for resume.
