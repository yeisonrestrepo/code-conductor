# BUG-077 `approve spec` binds its path to the spec hand-back implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** `orchestrate.mjs approve spec <path> <sha256>` refuses with `ORCH_SPEC_NOT_HANDED_BACK`, writing nothing, when `<path>` is not one of the documents the latest `spec` hand-back names (`ops.f`, `:C`/`:M`) under the run's pinned spec folder. The filter moves out of `handedBackDoc` into a shared `handedBackDocs`, so `approve` and `delegate` read one definition. Both `cc-orchestrate.md` copies get one bullet that explains the refusal.

**Spec:** `docs/superpowers/specs/2026-11-19-bug077-unbound-approve-spec-path-allowing-approval-design.md` (sha256 `41b2b3e13b612a7e7b9bc5b2d95d8a8713eec64cc1967c561d4c97782512613d`). Issue #199.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>` and, inside `tests/scripts/orchestrate.test.js`, `-t '<pattern>'`.

## Owner decisions

These were decided by the owner when the plan phase opened. They are constraints on this plan, not open questions.

1. **Branch sync with `main` is a merge, never a rebase.** The branch takes `origin/main` with `git merge`, not `git pull` and not a rebase, and history is never rewritten. Why: resuming the run requires HEAD to descend from the commit where the spec approval was recorded, and a rebase would orphan that commit. The merge of `origin/main` at `112a5462` is already on this branch (`3ff10e6`). Every later step in this plan only adds commits.
2. **The only expected merge conflict is the `.gitignore` tracked-surface block (BUG-042).** Resolve it by keeping both leaves, in the full-path sort order `tests/unit/gitignore-block-parity.test.js` checks with `.sort()`, so a `bug077` leaf goes before a `bug083` leaf with the same date. No other line in the block moves. A conflict in any other file stops the work and goes back to the owner. The merge at `3ff10e6` follows this rule: the spec leaves at `.gitignore:266-267` read `bug077` then `bug083`. This plan's own leaf follows the same rule (plan decision 7).
3. **Commit identity is passed per command, never configured.** Any commit made for this item takes its identity from `-c user.name=… -c user.email=…` or the `GIT_AUTHOR_*` / `GIT_COMMITTER_*` variables. The global and repository git config stay unchanged.
4. **After the merge, the run continues with `resume`.** If `resume` refuses, `end` and `start` are not run: the refusal code goes back to the owner. Nothing in this plan's tasks runs `end` or `start` on that run. The fixture runs inside `tests/scripts/orchestrate.test.js` are separate temporary repositories and are not affected.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines stay untouched (spec, Out of Scope).
- **Four files change, plus this plan and its `.gitignore` leaf:** `scripts/orchestrate.mjs`, `tests/scripts/orchestrate.test.js`, `.claude/commands/cc-orchestrate.md`, `project-template/.claude/commands/cc-orchestrate.md`. Add `tests/installer/commands-parity.test.js` for the one parity assertion in plan decision 6. No hook, installer, SNAP script, settings file, workflow or dependency changes.
- **`approve plan`, `delegate spec` and `delegate plan` behave exactly as before.** Their refusal texts are byte-identical (spec, AC8).
- **No new run-file field and no new import** (spec, System Impact).
- Every file this plan edits after Task 0 is already tracked, so every staging step after Task 0 is `git add -u <path>` with an explicit path.
- The two `cc-orchestrate.md` copies stay byte-identical (checked by `diff` in T-302).
- `.claude/` is read-only for shell commands in some sandboxes. Edit `.claude/commands/cc-orchestrate.md` with a file-edit tool, not with `sed`.

## Review Focus

- **Check order.** The new check runs after `readDoc` and before `documentHash` / `checkLoopClosed` / the stale-hash comparison (spec, choice 3). So a missing file still says `cannot read <path>` (pinned by B6), and the usage refusals (A2 at `tests/scripts/orchestrate.test.js:1590-1602`) still come first.
- **A readable path under the folder that the hand-back does not name** (B2). This is the item's core case. The path is readable, its hash matches and the loop is closed, and it still refuses.
- **`ops.f` naming a file outside the folder** (B3, `README.md:M`). Membership in the filtered set covers the folder condition, so no separate folder check is needed.
- **Group scope, not just `docs.specs`** (B7, spec choice 1). The folder is `docsFolder(run, 'spec')`, which carries the group subfolder.
- **`delegate`'s exactly-one rule.** `handedBackDoc` keeps its refusal text byte for byte (U29 at `tests/scripts/orchestrate.test.js:4270-4283` pins both texts).
- **The fixture default.** `handbackLine` now names `SPEC` for the `spec` role. A test that needs a hand-back naming nothing must pass `{ f: [] }` explicitly. U29's second half is the only such test today (measured, plan decision 5).

## Plan decisions

1. **Helper extraction (`scripts/orchestrate.mjs:1068-1075`).** `handedBackDoc(run, kind)` is split in two:
   ```js
   // The documents the Define role named in its hand-back, inside its pinned folder: the brief's, never the orchestrator's pick.
   function handedBackDocs(run, kind) {
     const folder = docsFolder(run, kind);
     return snapFiles(run.handbacks.findLast((h) => h.role === kind)).filter((f) => /:[CM]$/.test(f)).map((f) => f.slice(0, -2))
       .filter((p) => folder !== '' && p.startsWith(folder) && p.endsWith('.md'));
   }

   function handedBackDoc(run, kind) {
     const folder = docsFolder(run, kind);
     const docs = handedBackDocs(run, kind);
     if (docs.length !== 1) throw new Refusal(`delegate ${kind}: the ${kind} hand-back names ${docs.length} document(s) under ${folder}; show the approval and wait for the owner`);
     return docs[0];
   }
   ```
   The existing comment moves above `handedBackDocs`, with "The document" changed to "The documents" because it now describes the set. `handedBackDoc` needs no comment of its own: its refusal names the exactly-one rule.
2. **The check (`scripts/orchestrate.mjs:995-1015`).** A new function goes directly above the three-line comment block that heads `approve` (the comment starts at line 995), so that block stays attached to `approve`:
   ```js
   // BUG-077: the owner's spec approval binds a document the spec hand-back named, as delegate's does.
   function checkSpecHandedBack(run, rel) {
     const named = handedBackDocs(run, 'spec');
     if (named.includes(rel)) return;
     throw new Refusal(`ORCH_SPEC_NOT_HANDED_BACK: approve spec: ${rel} is not a document the spec hand-back names under ${docsFolder(run, 'spec')} (${named.length ? named.join(', ') : 'none'}); show the approval for a named document`);
   }
   ```
   One line in `approve`, directly after `const content = readDoc(root, rel, APPROVE_USAGE);`:
   `  if (what === 'spec') checkSpecHandedBack(run, rel);`
   `handedBackDocs` is a `function` declaration, so it is hoisted and the forward reference from line ~1000 to ~1075 is fine (measured, plan decision 5). The refusal text matches the spec's Error cases character for character. `Refusal` already prefixes `orchestrate: ` and exits 2.
3. **Shared fixture (`tests/scripts/orchestrate.test.js:86-89`).** In `handbackLine`, `ops: { n: [], f: [], gate }` becomes `ops: { n: [], f: extra.f ?? (role === 'spec' ? [`${SPEC}:C`] : []), gate }`. This is the spec's "shared fixture" option. It fixes every `say('spec', …)` caller at once (`driveTo`, `awaiting`, the FEAT-058 and FEAT-056 suites) instead of editing the 20+ call sites one by one. It also keeps `snapOf(handbackLine('spec', …))` at line 2738 equal to what `say` sends. `docSay('spec', SPEC)` (line 3311) still works. Its `.replace('"f":[]', …)` no longer matches for `spec`, and the default already names `SPEC:C`.
4. **Fixtures that need a different hand-back.**
   - U29 (`tests/scripts/orchestrate.test.js:4280`). The hand-back that must name nothing becomes `` `Done.\n${handbackLine('spec', 'boundary_routed', { f: [] })}\n` ``, so its `0 document(s)` assertion keeps testing what it tested.
   - `doc locations [FEAT-047]`, `approveSpec` (`:1250-1255`). Today it approves `docs/specs/demo-design.md` in runs whose spec folder is `.claude/specs/` or `.claude/specs/pillar-3/`. That is this item's gap, and the new check refuses it. `approveSpec` takes the path: `const approveSpec = (rel) => { put(rel, '# Demo spec\n'); …install…; handback with handbackLine('spec', 'boundary_routed', { f: [`${rel}:C`] }); skipLoop; expect(orch(['approve', 'spec', rel, sha(rel)]).status).toBe(0); }`. Its two callers pass `'.claude/specs/demo-design.md'` (`:1279`) and `'.claude/specs/pillar-3/demo-design.md'` (`:1294`).
5. **Measured before writing this plan** (HEAD `3ff10e6`). The changes were applied to a scratch copy and run, then reverted (`git status` clean afterwards).
   - Baseline: `npx vitest run tests/scripts/orchestrate.test.js` gave **1083 passed (1083)**.
   - Decisions 1-3 plus the U29 change of decision 4 gave **2 failed, 1081 passed (1083)**. The two failures were exactly `doc locations [FEAT-047] > pins the discovered pair at start …` and `… > [AC7] groups both scopes under the backlog group`, both at the `approveSpec` status (`expected 2 to be +0`).
   - Adding the `approveSpec` change of decision 4, `-t 'doc locations \[FEAT-047\]'` gave **14 passed**.
   - With the new block of plan decision 6 added, `-t 'BUG-077'` gave **9 passed** with the fix and **5 failed, 4 passed** on the original `scripts/orchestrate.mjs`. B2, B3, both B5 cases and B7 were red. B1, both B4 cases and B6 were green, because they pin behavior that does not change.
   - Every `approve spec` case the spec lists (`:1024`, `:1045`, `:1124-1173`, `:1219`, `:1584-1608`, `:3465`) stayed green under the shared fixture with no per-test edit.
6. **New tests.**
   - `tests/scripts/orchestrate.test.js`: a new `describe('approve spec binds the spec hand-back [BUG-077]', …)` goes directly above `describe('Build and Verify review loop [FEAT-057]', …)` (line 1697). It uses the file-level `driveTo`, `skipLoop`, `handbackLine`, `approveArgs`, `runText`, `sha` and `agents`. Local helpers:
     - `put(rel, text = '# Demo spec\n')`.
     - `handedBack(f)`: `driveTo('spec')`, `install spec`, hand back `` `Done.\n${handbackLine('spec', 'boundary_routed', { f })}\n` ``, then `skipLoop('spec')`, each asserted at status 0.
     - `notNamed(rel, named, folder = 'docs/specs/')`: the full refusal string, with the `orchestrate: ` prefix.
     - `refuses(rel, named, folder)`: approve with `sha(rel)`, expect `{ status: 2, err: notNamed(…) }`, and expect `runText()` to be byte-identical before and after.

     Cases (`OTHER = 'docs/specs/other-design.md'`):
     - B1 [AC1]: `handedBack([SPEC:C])`. `approveArgs('spec')` gives status 0 and `spec approved: sha256 <sha>`, and `approvals.spec` has `{ path: SPEC, sha256 }`.
     - B2 [AC2]: `handedBack([SPEC:C])`, `put(SPEC)`, `put(OTHER, '# Other\n')`, then `refuses(OTHER, SPEC)`.
     - B3 [AC3]: `handedBack([SPEC:C, 'README.md:M'])`, `put('README.md', '# Readme\n')`, then `refuses('README.md', SPEC)`.
     - B4 [AC6], `it.each([SPEC, OTHER])`: `handedBack([SPEC:C, OTHER:M])`. Both files are written, and approving `rel` gives status 0.
     - B5 [AC7], `it.each`: `[]` and `[SPEC:D]`. `put(SPEC)`, then `refuses(SPEC, 'none')`.
     - B6 [AC4]: `handedBack([SPEC:C])`. `approve spec docs/specs/none.md <64 zeros>` gives status 2 and `orchestrate: cannot read docs/specs/none.md`.
     - B7 [AC5]: `agents()`, `put('.claude/specs/a.md', '# x\n')`, a `BACKLOG.md` with `## Pillar 3: X` holding `[FEAT-011]`, and `start FEAT-011`. Then `install spec`, a hand-back naming `.claude/specs/b-design.md:C`, `skipLoop`, `put` that file, and `refuses('.claude/specs/b-design.md', 'none', '.claude/specs/pillar-3/')`.
   - `tests/installer/commands-parity.test.js`: one `it('binds the spec approval to the spec hand-back [BUG-077]', () => { has('**The spec must be the one handed back.**', '`ORCH_SPEC_NOT_HANDED_BACK`'); });` goes directly after the FEAT-056 `it` that ends at line 403, inside `describe('cc-orchestrate review loop …')` (line 343). `has` (line 345) reads `ORCH_MIRRORS[0]`. The mirrors suite at line 197 keeps the two copies identical, and T-302's `diff` checks it too.
7. **The command bullet (AC9).** In both `cc-orchestrate.md` copies, insert one bullet in step 3 right after the `**The script checks the hash.**` bullet (line 76):
   `   - **The spec must be the one handed back.** On `ORCH_SPEC_NOT_HANDED_BACK`, a refusal that writes nothing, the path you passed is not a document the spec hand-back named under the run's spec folder: show the approval again with the path from the hand-back's `ops.f` and its hash, and wait for the owner. A hand-back that names no spec there leaves nothing to approve: run `end`, then `start`.`
   The step-3 unattended bullet is unchanged. It already routes owner approvals through `approve`.
8. **`.gitignore` leaf.** `!/docs/superpowers/plans/2026-11-19-bug077-unbound-approve-spec-path-allowing-approval.md` goes directly before the `2026-11-19-bug083` plan leaf, its full-path sorted position (owner decision 2). `tests/unit/gitignore-block-parity.test.js` checks it.

## Baseline (measured on this branch, HEAD 3ff10e6)

- `npx vitest run tests/scripts/orchestrate.test.js`: **1083 passed (1083)**, about 500 s in this sandbox.
- `tools/skip-baseline.json` lists no `tests/scripts/orchestrate.test.js` test.
- The full suite was not run for this plan. The BUG-083 plan measured five ENV failures on a sandbox with uid 0 and git 2.43.0: `tests/hooks/context-guard.test.js` "unreadable threshold file — fallback 25", `tests/hooks/verbosity-remind.test.js` "row13: unreadable project hook -> global retains authority", `tests/scripts/conductor-db.test.js` "degrades to exit 0 without throwing when the db dir is read-only", and `tests/unit/staging-convention.test.js` AC7 and AC8. None of them is in a file this plan touches. T-301 runs the suite on HEAD first when any red appears.

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-19-bug077-unbound-approve-spec-path-allowing-approval.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file from the approved spec `41b2b3e1…`. No dependency.
- [X] [T-002] `.gitignore`: insert the leaf of plan decision 8 before the `2026-11-19-bug083` plan leaf. Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` (tracked) and `git add docs/superpowers/plans/2026-11-19-bug077-unbound-approve-spec-path-allowing-approval.md` (new, re-included by its leaf). Depends on T-002.
- [X] [T-004] Commit: `docs: plan binding the approve spec path to the spec hand-back [BUG-077]`. Depends on T-003.

---

### Task 1: Tests first (red)

**Files:**
- Modify: `tests/scripts/orchestrate.test.js:86-89`, `:1250-1255`, `:1279`, `:1294`, `:1697`, `:4280`
- Modify: `tests/installer/commands-parity.test.js:403`

- [X] [T-101] `tests/scripts/orchestrate.test.js:86-89`: change the `handbackLine` default `f` (plan decision 3). Depends on T-004.
- [X] [T-102] `tests/scripts/orchestrate.test.js:4280`: pass the U29 no-document hand-back as `handbackLine('spec', 'boundary_routed', { f: [] })` (plan decision 4). Depends on T-101.
- [X] [T-103] `tests/scripts/orchestrate.test.js:1250-1255`, `:1279`, `:1294`: give `approveSpec` its `rel` parameter and pass the two in-scope paths (plan decision 4). Depends on T-102.
- [X] [T-104] `tests/scripts/orchestrate.test.js`: insert the `[BUG-077]` describe block above `describe('Build and Verify review loop [FEAT-057]'` (plan decision 6). Depends on T-103.
- [X] [T-105] `tests/installer/commands-parity.test.js`: add the `[BUG-077]` `it` after line 403 (plan decision 6). Depends on T-104.
- [X] [T-106] Red run: `npx vitest run tests/scripts/orchestrate.test.js -t 'BUG-077'`. Its full match set is the 9 new tests and nothing else. No existing title contains `BUG-077`. Predicted: **5 failed, 4 passed** (1083 skipped). Red: B2, B3, B5 (two cases), B7. Green: B1, B4 (two cases), B6. Any other split means a test is wrong: fix the test, not the prediction. Depends on T-105.
- [X] [T-107] Red run: `npx vitest run tests/installer/commands-parity.test.js -t 'BUG-077'`. Predicted: **1 failed** (the new test, at `toContain('**The spec must be the one handed back.**')`), and every other test in the file is skipped. Depends on T-106.

---

### Task 2: The check and the shared helper (green)

**Files:**
- Modify: `scripts/orchestrate.mjs:995-1015`, `scripts/orchestrate.mjs:1068-1075`
- Modify: `.claude/commands/cc-orchestrate.md:76`, `project-template/.claude/commands/cc-orchestrate.md:76`

- [X] [T-201] `scripts/orchestrate.mjs:1068-1075`: split `handedBackDoc` into `handedBackDocs` + `handedBackDoc` (plan decision 1). Depends on T-107.
- [X] [T-202] `scripts/orchestrate.mjs:995`: add `checkSpecHandedBack` above `approve`'s comment block, and add its call after `readDoc` in `approve` (plan decision 2). Depends on T-201.
- [X] [T-203] Green run: the T-106 command. Predicted: **9 passed** (1083 skipped). Depends on T-202.
- [X] [T-204] `.claude/commands/cc-orchestrate.md:76`: insert the bullet of plan decision 7 with a file-edit tool. Depends on T-203.
- [X] [T-205] `project-template/.claude/commands/cc-orchestrate.md:76`: insert the same bullet. Depends on T-204.
- [X] [T-206] Green run: `npx vitest run tests/installer/commands-parity.test.js`. Predicted: every test passes (spec, AC9). Depends on T-205.
- [X] [T-207] `npx vitest run tests/scripts/orchestrate.test.js`. Predicted: **1092 passed (1092)** (1083 baseline + 9 new). This shows `delegate`'s texts (U29), `approve plan` and every existing `approve spec` case unchanged (spec, AC4, AC8, AC10). Depends on T-206.

---

### Task 3: Full suite, scope check and commit

**Files:**
- Modify: `scripts/orchestrate.mjs`, `tests/scripts/orchestrate.test.js`, `tests/installer/commands-parity.test.js`, `.claude/commands/cc-orchestrate.md`, `project-template/.claude/commands/cc-orchestrate.md` (staged), this plan (checkboxes)

- [X] [T-301] Run `npm test`. Predicted: every file green, except environment failures limited to the five ENV tests under Baseline. On CI, where none of those causes applies, the exit status is 0 (spec, AC10). A red outside that set is called ENV only if it is caused by the sandbox (network, tmp permissions, missing `node:sqlite`) and the test's file is not one this plan touches. Report it with its name. Any other red is fixed. Depends on T-207.
- [X] [T-302] Scope check:
  - `git status --porcelain` lists exactly the five files of this task and this plan as modified.
  - `diff .claude/commands/cc-orchestrate.md project-template/.claude/commands/cc-orchestrate.md` prints nothing.
  - `git diff -U0 HEAD -- .claude/commands/cc-orchestrate.md | grep '^-[^-]'` prints nothing (one added bullet only).
  - `git diff --quiet HEAD -- VERSION CHANGELOG.md package.json package-lock.json README.md "AGENT-READABLE BACKLOG.md" .claude/memory .claude/hooks .claude/settings.json .github tools lib bin` exits 0.
  - Depends on T-301.
- [X] [T-303] Stage: `git add -u scripts/orchestrate.mjs tests/scripts/orchestrate.test.js tests/installer/commands-parity.test.js .claude/commands/cc-orchestrate.md project-template/.claude/commands/cc-orchestrate.md` (all tracked). Depends on T-302.
- [X] [T-304] Stage: `git add -u docs/superpowers/plans/2026-11-19-bug077-unbound-approve-spec-path-allowing-approval.md` (carries the ticks for T-101 to T-303). Depends on T-303.
- [X] [T-305] Commit: `fix: bind the approve spec path to the spec hand-back [BUG-077]`. Depends on T-304.

---

## Test List

- [X] Unit, AC1: B1, the one named document approves as before.
- [X] Unit, AC2: B2, a readable, hash-matching, loop-closed document the hand-back does not name refuses, and the run file is byte-identical.
- [X] Unit, AC3: B3, a named `README.md:M` outside the folder refuses.
- [X] Unit, AC4: B6 (a missing file keeps `cannot read`) plus the unchanged A2 usage refusals.
- [X] Unit, AC5: B7, with a group pinned, a path under `.claude/specs/` but outside `pillar-3/` refuses.
- [X] Unit, AC6: B4, either of two named documents approves.
- [X] Unit, AC7: B5, no document or only a `:D` entry refuses with `none`.
- [X] Unit, AC8: U29 unchanged in text, plus the existing `approve plan` and `delegate` suites green (T-207).
- [X] Parity, AC9: the `[BUG-077]` `it` in `commands-parity.test.js`, plus `diff` in T-302.
- [X] AC10: `npm test` (T-301). The existing `approve spec` cases are kept meaningful by the shared fixture (plan decision 3).
- [X] No integration or E2E/UI test: the verb is exercised end to end through the CLI fixture already, and there is no UI.

## Commit Order

1. Task 0 (T-004): this plan and its `.gitignore` leaf.
2. Task 3 (T-305): the tests, the fix, both command copies and the plan ticks for T-101 to T-303, all in one commit, so no commit has a red suite. The red runs in T-106 and T-107 happen in the working tree before the fix. The ticks for T-304, T-305 and the Test List ride a closeout commit.

## Identified Risks

- **A test that relied on the spec hand-back naming nothing.** Measured: only U29 and the two FEAT-047 fixtures (plan decision 5). Catch: T-207's full-file run. A new failure there points at a fixture, not at the fix.
- **Forward reference to `handedBackDocs`.** It is a hoisted `function` declaration, not a `const` arrow, so the call from `checkSpecHandedBack` works wherever the two sit. Catch: T-203.
- **The command bullet tells the orchestrator to `end` / `start`.** That is only for a hand-back that names no spec, which is the recovery the spec's Error cases give. It does not apply to the branch's own run, where owner decision 4 forbids `end` / `start` after a refused `resume`.
- **Runs already past the spec approval.** Approvals already recorded are not re-validated (spec, Out of Scope). `checkApprovedDocs` keeps protecting whatever path they hold.
- **Full-file run time.** `tests/scripts/orchestrate.test.js` takes about 500 s here. Use `-t` filters for the red and green runs and the full file once (T-207).
