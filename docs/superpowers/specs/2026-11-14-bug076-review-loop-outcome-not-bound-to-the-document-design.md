# BUG-076: Review-loop outcome not bound to the document being approved

**Status:** Approved 2026-11-14 by independent review (round 1)
**Item:** BUG-076 (intake of issue #195)
**Date:** 2026-11-14

## Problem

Since FEAT-058, `approve <spec|plan> <doc> <sha256>` refuses with `ORCH_REVIEW_OPEN` until the role's Define review loop records an outcome. The check, `checkLoopClosed` (`scripts/orchestrate.mjs:955-960`), only asks whether `run.review[<role>].outcome` matches `REVIEW_OUTCOME`. It never compares the loop's recorded `sha256` with the document being approved. `delegateDefine` (`scripts/orchestrate.mjs:1065-1084`) calls the same check, so the unattended path has the same gap.

The loop's entry point is just as loose. `review <role> --round <doc>` (`openRound`, `scripts/orchestrate.mjs:1246-1258`) accepts any relative path that `readDoc` (`scripts/orchestrate.mjs:298-301`) can open. It does not limit the path to the role's pinned docs folder, `run.docs.scopes[<role>]`, which FEAT-047 records at `start`.

So a loop can close `clean` over one document while the owner approves a different document of the same role. The document can also be the same path edited after the loop closed. The run record then shows a clean review of a document no reviewer read. The owner's approval is still bound to the hash the owner was shown (FEAT-056), so the human gate is not bypassed. This is a gap in the integrity of the record, which is what the backlog entry and the issue describe.

## Solution

Two checks in `scripts/orchestrate.mjs`, one documented recovery in `cc-orchestrate.md`, and tests.

1. **Bind the outcome to the hash (approve and delegate).** `checkLoopClosed` takes the `documentHash` of the bytes being approved. When the loop closed `clean`, `cap` or `unchanged`, it requires `loop.sha256` to equal that hash. If it does not, it refuses with `ORCH_REVIEW_DOC_MISMATCH` and writes nothing. A `skipped:<reason>` outcome stays unbound.
2. **Scope the round (openRound).** `review <role> --round <doc>` refuses with `ORCH_REVIEW_OUT_OF_SCOPE` and writes nothing when `<doc>` is not under the role's pinned docs folder.
3. **A recorded way out.** A loop that closed `clean`, `cap` or `unchanged` may be closed again as `review <role> --close skipped:<reason>`. This is the only change to a closed loop. It keeps `round` and `sha256` and replaces the outcome with the skip, so the record says honestly that the approved document was not the one reviewed. `cc-orchestrate.md` names this recovery for `ORCH_REVIEW_DOC_MISMATCH` with the reason `skipped:doc-changed`.

### Decisions this spec takes

- **D1: bind by hash, not by path.** The entry allows either `sha256` or `doc`. The hash is the stronger binding: if the bytes match, the reviewer read exactly the bytes being approved, whatever the path. A path match alone would still pass an edited document. FEAT-058 E2 also removes `doc` when a loop closes (`closedLoop`, `scripts/orchestrate.mjs:1243`). Keeping `sha256` alone needs no new field in the run file. The comparison uses `documentHash(<role>, …)`, the function `approve` already uses. For a plan it reads every task checkbox as `[ ]`, so progress ticks never cause a mismatch.
- **D2: a skip stays unbound.** A skip claims no review: `skipped:<reason>` before round 1 has `sha256: null`. Requiring a match would make the FEAT-058 fail-open path impossible to use. The entry names only `clean`, `cap` and `unchanged`.
- **D3: refusal order.** The order is `ORCH_REVIEW_OPEN`, then `ORCH_REVIEW_DOC_MISMATCH`, then `ORCH_DOC_HASH_STALE`. Both review refusals come before the owner's hash check, as `ORCH_REVIEW_OPEN` already does. Their recovery changes the loop outcome the orchestrator shows, so the approval must be shown again in either case. The mismatch is computed from the bytes on disk, the same bytes the stale check hashes.
- **D4: re-close as a skip instead of reopening.** Owners often ask for an edit at the approval, and `cc-orchestrate.md:75` already covers that with "show it again with its new hash". With binding alone, that ordinary flow would refuse and leave the loop with no way forward, because "a closed loop does not reopen" (`scripts/orchestrate.mjs:1233`, test R16). Reopening the loop for new rounds would reverse a FEAT-058 decision and raise questions about the round budget. A visible skip keeps FEAT-058's rule that a skip is possible but never silent, and it is the smallest change that makes the record true. The re-close is allowed only over `clean`, `cap` and `unchanged`. A loop already closed `skipped:…` still refuses every form, so R16 holds as written.
- **D5: the scope is the pinned folder.** The folder is `run.docs.scopes[<role>][0]` without its trailing `**`, the same value `handedBackDoc` (`scripts/orchestrate.mjs:988-994`) reads. One small helper serves both. `rel` must start with that folder. A missing or empty scope refuses (fail closed). The check runs after `readDoc`'s path checks, so an absolute path, a `..` segment and an unreadable file keep their current messages (test R18). The round is scoped to the folder, not to the exact hand-back document. The entry asks for the folder, and the hash binding in D1 already ties the approval to what was reviewed.

## Behavior

### Main path

1. `spec` hands back `docs/specs/demo-design.md`. `review spec --round docs/specs/demo-design.md` opens round 1, because the path is under the pinned spec folder `docs/specs/`.
2. The loop closes `clean` with `sha256 = H`.
3. `approve spec docs/specs/demo-design.md H` succeeds as today. `run.review.spec` is `{ round, outcome: 'clean', sha256: H }`, and `run.approvals.spec.sha256` is `H`.
4. The same holds for `plan`. Ticking a task box after the loop closes leaves its `documentHash` unchanged, so approval still succeeds.

### Alternative paths

- **Edited after a clean, cap or unchanged close.** The owner asks for a change, and the spec now hashes `H2 ≠ H`. `approve spec <doc> H2` refuses with `ORCH_REVIEW_DOC_MISMATCH` and writes nothing. The orchestrator runs `review spec --close skipped:doc-changed`, which prints `review spec closed skipped:doc-changed at round <n>`. The record becomes `{ round: n, outcome: 'skipped:doc-changed', sha256: H }`, and `.conductor/review/` is deleted. The orchestrator shows the approval again with the skip notice, and `approve spec <doc> H2` succeeds.
- **Skipped loop.** After `skipped:<reason>`, at any round, the approval is not bound, exactly as today (test P3 `skipped:owner`, R20).
- **Unattended.** `delegate <spec|plan> <doc> <sha256>` runs the same check in the same position. On `ORCH_REVIEW_DOC_MISMATCH`, the orchestrator waits for the owner, as it does for every other `delegate` refusal (`cc-orchestrate.md:78`). Nothing is written, so `ORCH_DELEGATED_ONCE` is not spent.
- **Grouped docs folder (FEAT-047).** With a group, the pinned folder is `<dir>/<group>/`. A path in `<dir>/` outside the group is out of scope.

### Error cases

- `approve` or `delegate` over a `clean`, `cap` or `unchanged` loop whose `sha256` is not the document's hash. This includes a hand-edited run with `sha256: null` and a `clean` outcome. The command refuses with: `ORCH_REVIEW_DOC_MISMATCH: review <role> closed <outcome> over sha256 <loop sha256 or none>, not <doc> at <hash>; close it with review <role> --close skipped:<reason>, then show the approval again`. Exit 2, no write, no halt.
- `review <role> --round <doc>` with `<doc>` outside the pinned folder refuses with `ORCH_REVIEW_OUT_OF_SCOPE: <doc> is not under the <role> docs folder <folder or none>`. Exit 2, no write, no halt.
- `review <role> --close skipped:<reason>` over a loop already closed `skipped:…` still refuses with `review <role>: the loop closed <outcome>; a closed loop does not reopen`. `--round` and `--record` over any closed loop refuse the same way, as today.

## Acceptance Criteria

1. Backlog bullet "does not compare the loop's recorded `sha256` … with the document passed to `approve`": `approve spec` and `approve plan` refuse `ORCH_REVIEW_DOC_MISMATCH`, leaving the run file byte-identical, when the loop closed `clean`, `cap` or `unchanged` over a hash other than the approved document's. A test covers each outcome for spec and at least one for plan.
2. The same refusal applies to `delegate <spec|plan>`, and it leaves `run.delegated` unset.
3. An approval whose document hash equals `loop.sha256` passes for `clean`, `cap` and `unchanged`. M1 and P3 stay green. A plan whose boxes were ticked after the close still passes.
4. `skipped:<reason>` outcomes, with or without a hash, never trigger the mismatch (P3, R20 and the `skipLoop` fixtures stay green).
5. Backlog bullet "accepts any relative path `readDoc` can open": `review <role> --round <doc>` refuses `ORCH_REVIEW_OUT_OF_SCOPE`, with no loop written, for a readable `.md` outside `run.docs.scopes[<role>]`, and for any path when the scope is missing. R18's three messages are unchanged.
6. `review <role> --close skipped:<reason>` over a `clean`, `cap` or `unchanged` loop records `{ round, outcome: 'skipped:<reason>', sha256 }` with the earlier round and hash, then deletes `.conductor/review/`. After that, `approve` of the edited document succeeds. Over a skipped loop it still refuses (R16).
7. Both mirrors of `cc-orchestrate.md` name `ORCH_REVIEW_DOC_MISMATCH` and the recovery `review <role> --close skipped:doc-changed`. The unattended paragraph lists `ORCH_REVIEW_DOC_MISMATCH` among the `delegate` refusals. The mirrors stay identical, and `commands-parity.test.js` asserts the new phrases.
8. `npm test` passes.

## Out of Scope

- Reopening a closed loop for new reviewer rounds over an edited document (D4). That would be a FEAT-058 design change.
- Binding the round, or `approve`, to the exact document the hand-back names. `delegate` already does this for itself (`handedBackDoc`). The entry asks for the folder scope only.
- Keeping the replaced outcome (`clean` and so on) in the record after a re-close. The `sha256` that stays shows which bytes were reviewed.
- The Build and Verify review loop (FEAT-057), `hash`, and `approve`'s own path checks.
- Records the owner writes at release: `CHANGELOG.md`, the backlog box, `VERSION`.

## System Impact

- `scripts/orchestrate.mjs`: `checkLoopClosed` gets a hash parameter and the mismatch refusal. `approve` and `delegateDefine` compute the hash before calling it. A docs-folder helper is shared by `handedBackDoc` and `openRound`. `openRound` gets the scope refusal. `review` allows `--close skipped:` over a non-skip closed loop. No new dependency, no network, no change to the run-file schema or `isValidRun`.
- `.claude/commands/cc-orchestrate.md` and `project-template/.claude/commands/cc-orchestrate.md`: approval bullets and the unattended refusal list, kept identical. This is command text, not a protected surface (hooks, installer, SNAP scripts and settings are untouched).
- `tests/scripts/orchestrate.test.js`: new cases in `review loop over review files [FEAT-058]`. `tests/installer/commands-parity.test.js`: new phrases.
- Behavior change for users: an approval after an edit made after the loop now needs one explicit `--close skipped:doc-changed`. Runs that already skip are unaffected.

### Files Requiring Full Read (deferred to /cc-plan)

- `tests/scripts/orchestrate.test.js` (3604 lines): the FEAT-054 delegate tests and any fixture that closes a loop and then edits the document before approving, which would now refuse.
- `scripts/orchestrate.mjs` `review`/`openRound` (lines 1224-1258) for where the re-close branch fits.

## Complexity Estimate

Small. About 25 changed lines in `scripts/orchestrate.mjs`, a few sentences in each command mirror, and about 10 tests. Risk is low and comes mainly from existing fixtures that approve a document edited after its loop closed.
