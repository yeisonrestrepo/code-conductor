# BUG-077: Unbound `approve spec` path allowing the approval hash to protect the wrong file

**Status:** Approved 2026-11-19 by independent review (round 1)
**Item:** BUG-077 (intake of issue #199)
**Date:** 2026-11-19

## Problem

`orchestrate.mjs approve spec <path> <sha256>` (`approve`, `scripts/orchestrate.mjs:998-1015`) accepts any path that `readDoc` (`scripts/orchestrate.mjs:371-374`) can open under the run root. `readDoc` only rejects an empty path, an absolute path and a `..` segment. Nothing checks that the path is the document the `spec` role named in its hand-back (`ops.f`), or that it sits inside the run's pinned spec folder.

The approval it records, `{ at, by, path, sha256, commit }`, is what FEAT-056's post-approval check reads. On every role `install` after the plan approval, `checkApprovedDocs` (`scripts/orchestrate.mjs:592-597`) re-hashes `run.approvals.spec.path`. If the owner approved a path other than the real spec (a typo, a sibling draft, a stale file the orchestrator showed by mistake), that check protects the wrong file. Later edits to the real spec are never detected, and the run builds from a spec nobody approved.

The issue rates this as hardening, not an exploitable flaw: the owner sees the path they approve. The delegated path already has the binding. `delegateDefine` (`scripts/orchestrate.mjs:1173-1192`) refuses a `rel` that differs from `handedBackDoc(run, kind)` (`scripts/orchestrate.mjs:1069-1075`), the single document the hand-back names inside the pinned folder. The owner's verb has no such check, so the two approval paths disagree on what may be approved.

## Solution

`approve spec` refuses, writing nothing, when `<path>` is not one of the documents the latest `spec` hand-back names inside the spec role's pinned folder. The set of named documents is computed by the same filter `handedBackDoc` already uses (`ops.f` entries ending `:C` or `:M`, suffix dropped, path under the pinned folder, ending `.md`), extracted into one helper that both `approve` and `delegate` call, so the two verbs cannot drift. The refusal has its own code, `ORCH_SPEC_NOT_HANDED_BACK`, and names the path and the documents the hand-back does name. The two copies of `cc-orchestrate.md` gain one bullet that tells the orchestrator what the refusal means and what to do.

### Choices the entry leaves open

1. **Which folder.** The entry says "outside `run.docs.specs`". The run's pinned spec scope is `run.docs.scopes.spec[0]`, which is `docs.specs` plus the group subfolder when a group is pinned (`docScopes`, `scripts/orchestrate.mjs:332-340`). This spec uses the scope, through the existing `docsFolder` helper, because it is the folder Guard 5 lets the `spec` role write in and the one `delegate` already checks. A file in `docs.specs` but outside the group could not have been written by the role, so accepting it would keep a smaller version of the same gap.
2. **"Differs from `ops.f`" when `ops.f` names several documents.** `ops.f` is a list. `delegate` needs exactly one document because no human picks. `approve` is the owner's verb, and the owner sees the path, so it accepts any member of the set. One named document is the common case and then the rule is "equal to it". The entry's two conditions become one: membership in the filtered set implies the folder condition.
3. **Where the check runs.** Right after `readDoc` and before `documentHash`, `checkLoopClosed` and the `ORCH_DOC_HASH_STALE` comparison. `readDoc` keeps owning the path-shape refusals (usage text for an absolute or `..` path, `cannot read <path>` for a missing file), so their text does not change. A readable path that is not the spec then refuses on that fact, not on a hash or loop mismatch it would also produce.
4. **Plan approvals.** The entry and the issue are about `approve spec`. `approve plan` is left unchanged (see Out of Scope).

No owner decision is needed. The change narrows what one verb accepts. It adds no network, no dependency and no permission, and the entry decides the fix shape.

## Behavior

### Main path

1. The `spec` role hands back with `ops.f` naming `docs/specs/demo-design.md:C`. The run's spec scope is `docs/specs/**`.
2. The orchestrator shows that path and its hash, and the owner approves.
3. `approve spec docs/specs/demo-design.md <sha256>` reads the file (`readDoc`), passes the new check, then runs the remaining checks unchanged: `documentHash`, `checkLoopClosed`, the `ORCH_DOC_HASH_STALE` comparison. It records the approval exactly as today and prints `spec approved: sha256 <sha256>`.

### Alternative paths

- **Several named documents.** `ops.f` names two `.md` files `:C`/`:M` under the scope. `approve spec` accepts either one. The owner's message decides which.
- **Group pinned.** The scope is `docs/specs/<group>/**`. Only paths under `docs/specs/<group>/` that the hand-back names are accepted.
- **Modified, not created.** A `:M` entry counts like `:C`, as in `delegate` (a revised spec in a resumed or reworked run).
- **Delegated run.** `delegate spec` keeps its exactly-one rule and its refusal text byte for byte. It now reads the set from the shared helper.
- **Plan.** `approve plan` behaves exactly as before.

### Error cases

All refusals exit 2 through `Refusal`, as every other `approve` refusal does, and write nothing to the run file.

- **Path not named.** `approve spec docs/specs/other.md <sha256>` when the hand-back names only `docs/specs/demo-design.md` refuses with `ORCH_SPEC_NOT_HANDED_BACK: approve spec: docs/specs/other.md is not a document the spec hand-back names under docs/specs/ (docs/specs/demo-design.md); show the approval for a named document`.
- **Path outside the folder.** `approve spec README.md <sha256>`, even when `ops.f` lists `README.md:M`, refuses with the same code. The filter drops `README.md`, so the list in parentheses holds only the folder's documents.
- **Hand-back names no document under the folder.** The parenthesised list reads `none`. No path can be approved. The recovery is the one the run already has for a hand-back that cannot proceed: `end`, then `start`. The spec role is expected to name the spec it wrote. A hand-back that names none has nothing an approval could bind to, and approving an unnamed file is the gap this item closes.
- **Deleted entry.** `docs/specs/demo-design.md:D` does not count as named. The filter already excludes `:D`.
- **Existing refusals keep their text and order.** Wrong step, wrong kind, a missing path or hash, a non-hex hash, an absolute or `..` path, and an unreadable file refuse exactly as today, because all of them run before the new check. A bad-shape path such as `../x.md` is never in the set, but it still gets the usage refusal (see AC4).

## Acceptance Criteria

- [ ] AC1: `approve spec <p> <sha>` where `<p>` is the one document the latest spec hand-back names under the pinned scope approves exactly as today (same stdout, same `approvals.spec` fields).
- [ ] AC2: `approve spec <p> <sha>` where `<p>` exists, hashes `<sha>` and has a closed review loop over that hash, but is not named by the hand-back, exits 2 with `ORCH_SPEC_NOT_HANDED_BACK` naming `<p>`, the folder and the named list, and the run file is byte-identical afterwards (entry: "refuse (writing nothing) … differs from the recorded spec hand-back's `ops.f`").
- [ ] AC3: `approve spec <p> <sha>` where `ops.f` lists `<p>:M` but `<p>` is outside the pinned spec scope exits 2 with the same code and writes nothing (entry: "refuse … when `rel` is outside `run.docs.specs`").
- [ ] AC4: the existing refusals that run before the new check (wrong step, wrong kind, no path, no hash, non-hex hash, absolute path, `..` path, unreadable file) keep their exact text.
- [ ] AC5: with a group pinned, a path under `docs.specs` but outside the group folder refuses `ORCH_SPEC_NOT_HANDED_BACK`.
- [ ] AC6: when `ops.f` names two documents under the scope, either one is accepted.
- [ ] AC7: a hand-back that names no document under the scope refuses with the named list `none`.
- [ ] AC8: `delegate spec` and `delegate plan` keep their exactly-one rule and their refusal text unchanged, and `approve plan` accepts the same inputs as before.
- [ ] AC9: both `cc-orchestrate.md` copies carry the same new bullet for `ORCH_SPEC_NOT_HANDED_BACK`, and `tests/installer/commands-parity.test.js` stays green.
- [ ] AC10: `npm test` exits 0. Existing `approve spec` cases whose fixture hand-back carries `"f":[]` are updated to name the fixture spec, so they keep testing what they tested.

## Out of Scope

- `approve plan`. It has the same unbound path, but its approval also fixes `run.plan` and the task list it executes, so the owner reviews the tasks the path yields, and the entry does not name it. A follow-up issue for the plan binding is recommended, not done here.
- `review spec --round <doc>`: BUG-076 already bound the loop to the pinned folder.
- `hash`: read-only and run-free. It records nothing, so it has nothing to bind.
- Runs whose approvals were recorded before this change. An approval already in a run file is not re-validated: `checkApprovedDocs` keeps protecting the recorded path.
- Hand edits of the run file, a known limit stated in `cc-orchestrate.md`.
- Records: `VERSION`, `CHANGELOG.md`, the backlog and the README Known-limits lines are written at release.

## System Impact

- `scripts/orchestrate.mjs`: a helper returning the hand-back's named documents under the pinned folder, extracted from `handedBackDoc` (`:1069-1075`), which then wraps it unchanged in behavior. Plus one check in `approve` (`:998-1015`), applied only when `what === 'spec'`. No new import, no new run-file field.
- `.claude/commands/cc-orchestrate.md` and `project-template/.claude/commands/cc-orchestrate.md`: one bullet in step 3 ("The two define approvals"), next to the `ORCH_DOC_HASH_STALE` bullet, saying the refusal writes nothing and means the path is not the spec the hand-back named: show the approval again with the hand-back's path. The unattended bullet already says the owner approves with `approve`, which still holds for a named document.
- `tests/scripts/orchestrate.test.js`: new cases for AC1-AC8. The shared hand-back fixture (`handbackLine`'s `f: []`, `:86-89`, used by `say`) or the `approveArgs` path (`:63-70`) must make the fixture spec named. The existing `docSay` helper (`:3311`) shows the pattern. Every `approve spec` test that reaches the new check is affected, at least `:1024`, `:1045`, `:1124-1173`, `:1219`, `:1584-1608` and `:3465`.
- No hook, installer, SNAP script or settings file changes. No workflow change. No dependency.

### Files Requiring Full Read (deferred to /cc-plan)

- `tests/scripts/orchestrate.test.js` (4423 lines): the fixture helpers (`say`, `approveArgs`, the run-start helpers) and every `approve spec` case, to choose between changing the shared fixture hand-back and naming the spec per test.
- `scripts/orchestrate.mjs` around `approve`, `handedBackDoc` and `delegateDefine` (`:998-1192`) for the exact extraction.

## Complexity Estimate

S. One shared helper extracted from existing code, one guarded check in one verb, two identical doc bullets. Most of the work is updating test fixtures that hand back no file.
