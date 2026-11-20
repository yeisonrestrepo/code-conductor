# BUG-078 Keep the approved plan out of the fix-round write scope: implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** after an audit `RETURN`, the fix round's write scope (the `ops.scope` that `handback audit` prints, that `install code --check` and `install code` write, and that `handback code` checks) is exactly the files the audit named, without the approved plan, so Guard 5 enforces the brief's "do not edit the spec or the plan, and tick no boxes". A normal task's scope stays its files plus the plan.

**Spec:** `docs/superpowers/specs/2026-11-20-bug078-fix-round-write-scope-includes-the-approved-plan-design.md` (sha256 `ff6536e53439d328d37f8b65692111f1ec6f435e1e258f41c730db917e3712a1`). Issue #203.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>` and `-t '<pattern>'`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines (the `[BUG-078]` line at `README.md:502` included) stay untouched.
- **Five files change, plus this plan and its `.gitignore` leaf:** `scripts/orchestrate.mjs`, `tests/scripts/orchestrate.test.js`, `.claude/agents/code.md`, `project-template/.claude/agents/code.md`, `tests/unit/role-profiles.test.js`. No hook, SNAP script, installer, settings file, workflow or dependency changes (spec, Out of Scope). The fifth file is not in the spec's System Impact list; it is forced by AC7 (see plan decision 4).
- The change narrows a write scope and widens nothing: no new halt code, no new message, no new run-file field (spec, Error cases).
- Every file this plan edits after Task 0 is already tracked and none sits under an ignored directory, except this plan. It is under the ignored `docs/superpowers/plans/`, is new in Task 0 (so `git add -f`), and is tracked afterwards and re-included by its leaf (so `git add -u`). `.claude/agents/code.md` is tracked and re-included by the `/.claude/*` block, so `git add -u` stages it.

## Files read in full (spec, Files Requiring Full Read)

- `scripts/orchestrate.mjs:323-342`: `taskScope` (`:324-332`, the D9 comment at `:323`) and `fixScope` (`:336-342`, the FEAT-057 comment at `:334-335`). Callers, by `grep -n 'taskScope\|fixScope\|codeScope'`: `codeScope` (`:562-566`) calls `fixScope` for a fix step and `taskScope` for a task; `auditFix` (`:715-726`) calls `fixScope` and prints `scope ${scope.join(', ')}` (`:725`); `envelopeFields` (`:577`), the hand-back check (`:987`) and `:1326` go through `codeScope`; `approvePlan` (`:1070`) calls `taskScope(t, approval.path)` per task. `taskScope` is exported and imported by the tests (`tests/scripts/orchestrate.test.js:14`).
- `tests/scripts/orchestrate.test.js`: helpers `task` (`:86`), `handbackLine` (`:90-96`, the code scope defaults to the installed one), `auditReport` (`:98`), `driveTo` (`:122`); `describe('scope [FEAT-011 AC8]')` `:224-270` (`taskScope` rows `:228-229`, empty task `:232-234`, empty plan at `approve plan` `:236-247`, the 19/20-file cap rows `:249-254`, the envelope row `:269`); `describe('hand-back claims, end and approver [BUG-075]')` `:1801-1900` (`haltsUnrecorded`, `outside`, C5 `:1848-1856`, C6 `:1858-1864`); `describe('Build and Verify review loop [FEAT-057]')` `:1952-2196` (`returned` `:1953`, `pass` `:2014`, `BLOCKER_A` `:2016`, `SELF_PLAN` `:2051`, E1 `:2053-2084`, the `ORCH_FIX_SCOPE_UNAPPROVED` rows `:2086-2100`, the cap test `:2108-2115`). The other `ops.scope ... PLAN` expectations (`:3088`, `:3098`) are plan tasks after `resume`, not fix rounds, and stay as they are. `tools/skip-baseline.json` names no `orchestrate.test.js` test, so renaming E1 changes no skip set.
- `.claude/agents/code.md:8` and `project-template/.claude/agents/code.md:8` (byte-identical, `cmp` clean). `tests/unit/role-profiles.test.js:104` asserts the mirror is byte-identical and `:149-170` pins each profile's sha256 (`code: '12361f33…'`), with a comment per item that changed one on purpose.

## Plan decisions

1. **The shared check (`scripts/orchestrate.mjs`), replacing `taskScope` at `:323-332`:**
   ```js
   // D9: an empty scope is a plan defect, never a read-only fallback; scopes are never truncated.
   // The empty check reads the declared files, so the plan alone never passes as a task's scope.
   function checkedScope(id, files, added) {
     if (files.length === 0) throw new Halt('ORCH_EMPTY_SCOPE', `${id} declares no files`);
     const scope = [...new Set([...files, ...added])];
     const [cap, elemCap] = V3_CAPS['ops.scope'];
     if (scope.length > cap) throw new Halt('ORCH_SCOPE_OVER_CAP', `${id} needs ${scope.length} scope entries; the cap is ${cap}`);
     const long = scope.find((p) => elementLength(p) > elemCap);
     if (long) throw new Halt('ORCH_SCOPE_OVER_CAP', `${id} has a ${elementLength(long)}-character path; the cap is ${elemCap}`);
     return scope;
   }

   export function taskScope(task, planRel) {
     return checkedScope(task.id, task.files, [planRel]);
   }
   ```
   **Why the helper takes the declared files and the added entries separately, not one entry list.** The spec's choice is one internal check shared by both scopes, with `taskScope`'s exported signature and messages kept. If the helper took only `[...task.files, planRel]`, its empty check would see the plan and never fire, so a task with no files would pass with scope `[plan]` and the `ORCH_EMPTY_SCOPE` rows (`:232`, `:236`, `:3258`) would go red. Passing the declared files and the entries added to them keeps the empty check on what the task or the audit declared and the cap check on the whole scope. Every call site states what it adds (`[planRel]` or `[]`), so "no plan" is never an invisible `undefined` (the spec's reason for not making `planRel` optional). Codes, messages, order and de-duplication are those of today's `taskScope`. Both functions stay under 30 lines.
2. **`fixScope` (`:336-342`).** Its checks and `ORCH_FIX_SCOPE_UNAPPROVED` halt stay as they are. Its last line `return taskScope({ id: \`fix round ${round}\`, files }, run.plan);` becomes `return checkedScope(\`fix round ${round}\`, files, []);`, and one comment line is appended to the FEAT-057 comment above the function: `// A fix round ticks no boxes, so the plan stays out of its write scope and Guard 5 enforces that (BUG-078).` `codeScope`, `auditFix`, `claimHalt` and `approvePlan` are not edited: they follow the new scope (spec, Solution).
3. **Tests (`tests/scripts/orchestrate.test.js`).** Existing fix-round expectations are updated, never deleted (AC8); new rows are added next to them.
   - **C5 (`:1848`, AC1 and AC3):** `envelope().ops.scope` equals `['src/a.js']`; the hand-back's `f` becomes `['src/a.js:M']` and is recorded with `{ role: 'code', fix: 1 }`; the row reads `const done = runFile().tasks.done;` before the hand-back and asserts `expect(runFile().tasks.done).toBe(done)` after it, so the fix round leaves `tasks.done` unchanged.
   - **New C5b, after C5: `'C5b [BUG-078] a fix-round hand-back naming the plan in ops.f halts ORCH_HANDBACK_OUT_OF_SCOPE'` (AC3).** Same setup as C5; then `haltsUnrecorded('code', codeSay({ f: ['src/a.js:M', \`${PLAN}:M\`] }), outside('code', PLAN, JSON.stringify(['src/a.js'])))`.
   - **C6 (`:1858`):** the expected scope becomes `JSON.stringify(['src/a.js'])`.
   - **E1 (`:2053`, AC1 and AC2):** title becomes `'[E1] a returned audit dispatches a fix scoped to the blocker and major files, without the plan [BUG-078]'`; the RETURN line ends `scope src/a.js, src/b.js`; the `--check` and installed `ops.scope` both equal `['src/a.js', 'src/b.js']`, and one added line asserts `expect(envelope().ops.scope).not.toContain(PLAN)` (the entry's requested test).
   - **Cap test (`:2108`, AC5):** becomes `it.each([[20, 'passes'], [21, 'halts']])('[BUG-078] a fix round of %i plan files %s at the scope cap of 20', …)`. The plan is `task(1, …)` with 10 files and `task(2, …)` with `n - 10` files (each task stays under the 19-file task limit, so `approve plan` passes), and the audit names every one as `[major]`. `passes`: status 0, `runFile().handbacks.at(-1).fix.files` has length 20, and `install code --check`'s `ops.scope` has length 20 and does not contain `PLAN`. `halts`: status 1, err `ORCH_SCOPE_OVER_CAP: fix round 1 needs 21 scope entries; the cap is 20`, the audit entry recorded with `verdict: 'RETURN', round: 1` and no `fix` property (today's assertions).
   - **New row in `describe('scope [FEAT-011 AC8]')`, after the empty-plan row (`:247`, AC4):** `'[BUG-078] a plan task of 20 files still halts ORCH_SCOPE_OVER_CAP at approve plan'`. It mirrors the empty-plan row with `plan(\`# Plan\n\n${task(1, Array.from({ length: 20 }, (_, i) => \`src/f${i}.js\`))}\`)` and expects status 1, err `ORCH_SCOPE_OVER_CAP: Task 1 needs 21 scope entries; the cap is 20`, and `runFile().halt.code` `ORCH_SCOPE_OVER_CAP`. The `taskScope` rows (`:228-229`, `:249-254`) and the envelope row (`:269`) are unchanged and keep covering "files plus the plan" (AC4).
   - The four `ORCH_FIX_SCOPE_UNAPPROVED` rows (`:2086-2100`) are not edited (AC6).
4. **The `code` role profile (AC7).** `.claude/agents/code.md:8` and `project-template/.claude/agents/code.md:8`: the sentence `Read the envelope first: its \`ops.scope\` is the task's files plus the plan file.` becomes `Read the envelope first: its \`ops.scope\` is the task's files plus the plan file; in a fix round it is the files the review names, without the plan.` Nothing else in either file changes. `.claude/` is read-only for Bash in the build sandbox, so the `.claude/agents/code.md` edit uses the Edit tool. Because `tests/unit/role-profiles.test.js` pins every profile's sha256, the same change sets `code:` in `PROFILE_SHA256_1_37_0` (`:157`) to `21c2587a37aa105b9df4ad0f70429c5011c2cbef51b0033fa395a5039cf8a70e` (measured on this branch by applying the sentence above to a copy in tmp) and adds the comment line `// BUG-078 changed code on purpose: a fix round's scope is the files the review names, without the plan.` above it, as the file's own rule says ("A later item that changes a profile on purpose updates its row in the same commit"). `.claude/agents/plan.md:12` describes a task's scope and stays as it is (spec, Solution).
5. **Red predictions, reasoned against the current code.** Today `fixScope` appends the plan, so: C5 (scope is `['src/a.js', PLAN]`) **red**; C5b (the plan is in scope, so the hand-back is recorded) **red**; C6 (the halt names a scope with the plan) **red**; E1 (line and scopes end in the plan) **red**; cap row 20 (21 entries today, halts) **red**; cap row 21 (22 entries today, so the message says `needs 22`) **red**. The new approve-plan row is **green** before and after: task scopes do not change.
6. **`.gitignore` leaf.** `!/docs/superpowers/plans/2026-11-20-bug078-fix-round-write-scope-includes-the-approved-plan.md` goes directly after the `2026-11-19-bug087` plan leaf (`.gitignore:183`) and before the `2026-11-20-bug079` plan leaf, the full-path sort order of the block (BUG-042).

## Baseline (measured on this branch, HEAD 4a8d7eb, Node v24.22.2, uid 1001)

- `npx vitest run tests/scripts/orchestrate.test.js`: **1128 passed (1128)**, about 540 s.
- `npx vitest run tests/scripts/orchestrate.test.js -t 'BUG-075|FEAT-057|scope \[FEAT-011'`: **83 passed | 1045 skipped (1128)**, about 80 s.

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-20-bug078-fix-round-write-scope-includes-the-approved-plan.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file from the approved spec `ff6536e5…`. No dependency.
- [X] [T-002] `.gitignore`: insert the leaf of plan decision 6 after the `2026-11-19-bug087` plan leaf. Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` (tracked) and `git add -f docs/superpowers/plans/2026-11-20-bug078-fix-round-write-scope-includes-the-approved-plan.md` (new, under the ignored `docs/superpowers/plans/`). Depends on T-002.
- [X] [T-004] Commit: `docs: plan keeping the approved plan out of the fix-round write scope [BUG-078]`. Depends on T-003.

---

### Task 1: Tests first (red)

**Files:**
- Modify: `tests/scripts/orchestrate.test.js`

- [X] [T-101] `tests/scripts/orchestrate.test.js`, C5 (`:1848`): update the scope, the hand-back's `f` and add the `tasks.done` assertion (plan decision 3). Depends on T-004.
- [X] [T-102] `tests/scripts/orchestrate.test.js`: insert C5b after C5 (plan decision 3). Depends on T-101.
- [X] [T-103] `tests/scripts/orchestrate.test.js`, C6: expected scope `JSON.stringify(['src/a.js'])` (plan decision 3). Depends on T-102.
- [X] [T-104] `tests/scripts/orchestrate.test.js`, E1 (`:2053`): new title, RETURN line, both `ops.scope` expectations and the `not.toContain(PLAN)` line (plan decision 3). Depends on T-103.
- [X] [T-105] `tests/scripts/orchestrate.test.js`, cap test (`:2108`): replace it with the 20/21 `it.each` (plan decision 3). Depends on T-104.
- [X] [T-106] `tests/scripts/orchestrate.test.js`, `describe('scope [FEAT-011 AC8]')`: insert the approve-plan 20-file row after the empty-plan row (plan decision 3). Depends on T-105.
- [X] [T-107] Red run: `npx vitest run tests/scripts/orchestrate.test.js -t 'BUG-075|FEAT-057|scope \[FEAT-011'`. Its full match set is every row of the three describe blocks: the 83 of the baseline (C5, C6, E1 and the old cap test among them) minus the old cap test, plus C5b, the two cap rows and the approve-plan row, so 86 rows. Predicted: **6 failed | 80 passed | 1045 skipped (1131)**. Red: C5, C5b, C6, E1, cap row 20, cap row 21 (plan decision 5). Green: the other 80, the approve-plan row and the four `ORCH_FIX_SCOPE_UNAPPROVED` rows included. Any other split means a test is wrong: fix the test, not the prediction. Depends on T-106.

---

### Task 2: Build the fix-round scope without the plan (green)

**Files:**
- Modify: `scripts/orchestrate.mjs`
- Modify: `.claude/agents/code.md`
- Modify: `project-template/.claude/agents/code.md`
- Modify: `tests/unit/role-profiles.test.js`

- [X] [T-201] `scripts/orchestrate.mjs:323-332`: replace `taskScope` with `checkedScope` and the one-line `taskScope` of plan decision 1. Depends on T-107.
- [X] [T-202] `scripts/orchestrate.mjs`, `fixScope`: append the BUG-078 comment line and return `checkedScope(\`fix round ${round}\`, files, [])` (plan decision 2). Depends on T-201.
- [X] [T-203] Green run: the T-107 command. Predicted: **86 passed | 1045 skipped (1131)**. Depends on T-202.
- [X] [T-204] `.claude/agents/code.md:8` (Edit tool): the new sentence of plan decision 4. Depends on T-203.
- [X] [T-205] `project-template/.claude/agents/code.md:8`: the same sentence; then `cmp .claude/agents/code.md project-template/.claude/agents/code.md` prints nothing and `sha256sum` of both prints `21c2587a…`. If the hash differs, the edit differs from plan decision 4: fix the edit. Depends on T-204.
- [X] [T-206] `tests/unit/role-profiles.test.js:157`: the BUG-078 comment line and the new `code:` hash (plan decision 4). Depends on T-205.
- [X] [T-207] Run: `npx vitest run tests/unit/role-profiles.test.js`. Predicted: every test passes (the mirror row and both `code.md` hash rows included). Depends on T-206.

---

### Task 3: Full suite, scope check and commit

**Files:**
- Modify: `docs/superpowers/plans/2026-11-20-bug078-fix-round-write-scope-includes-the-approved-plan.md` (ticks)

- [X] [T-301] Run `npm test` (long: `orchestrate.test.js` alone takes about 9 minutes; run it in the background if the shell times out). Predicted: exit 0 (AC8), with `tests/scripts/orchestrate.test.js` at **1131 passed** (1128 + 3 net new rows). A red is called ENV only if the sandbox caused it (network, tmp permissions) and its file is not one this plan touches; report it with its name. Any other red is fixed. Depends on T-207.
- [X] [T-302] Scope check: `git status --short` lists exactly `scripts/orchestrate.mjs`, `tests/scripts/orchestrate.test.js`, `.claude/agents/code.md`, `project-template/.claude/agents/code.md`, `tests/unit/role-profiles.test.js` and this plan; no temporary file is left in the tree. `git diff --stat` shows no change to the spec. Depends on T-301.
- [X] [T-303] Stage: `git add -u scripts/orchestrate.mjs tests/scripts/orchestrate.test.js .claude/agents/code.md project-template/.claude/agents/code.md tests/unit/role-profiles.test.js` (all tracked). Depends on T-302.
- [X] [T-304] Stage: `git add -u docs/superpowers/plans/2026-11-20-bug078-fix-round-write-scope-includes-the-approved-plan.md` (carries the ticks for T-101 to T-303). Depends on T-303.
- [X] [T-305] Commit: `fix: keep the approved plan out of the fix-round write scope [BUG-078]`. Depends on T-304.

---

## Test List

- [ ] Integration, AC1 and AC2: E1. The RETURN line ends `scope src/a.js, src/b.js`; `install code --check` and `install code` write `ops.scope` `['src/a.js', 'src/b.js']`, without `run.plan`.
- [ ] Integration, AC3: C5 (a hand-back inside the fix files is recorded as fix round 1, `tasks.done` unchanged) and C5b (a hand-back naming the plan halts `ORCH_HANDBACK_OUT_OF_SCOPE`, unrecorded); C6 updated.
- [ ] Integration, AC4: the new approve-plan 20-file row; the unchanged `taskScope` rows and envelope row.
- [ ] Integration, AC5: the 20/21-file fix-round cap rows.
- [ ] Integration, AC6: the four unchanged `ORCH_FIX_SCOPE_UNAPPROVED` rows.
- [ ] Unit, AC7: `tests/unit/role-profiles.test.js` mirror and hash rows.
- [ ] AC8: `npm test` (T-301).
- [ ] No E2E/UI test: the change is a script's scope computation and one profile sentence; there is no UI. Guard 5 is unchanged and already tested to enforce exactly `ops.scope`.

## Commit Order

1. Task 0 (T-004): this plan and its `.gitignore` leaf.
2. Task 3 (T-305): the tests, the script change, both profiles, the hash pin and the plan ticks for T-101 to T-303, in one commit, so no commit has a red suite. The red run in T-107 happens in the working tree before the fix. The ticks for T-304, T-305 and the Test List ride the closeout commit.

## Identified Risks

- **The empty check moving onto the plan entry.** A helper fed `[...files, plan]` would let a task with no files pass. Caught by the `ORCH_EMPTY_SCOPE` rows at `:232`, `:236` and `:3258`, which run in T-107/T-203 (`:232`, `:236`) and T-301.
- **A task's scope losing the plan.** Caught by `:228-229`, `:249-254`, `:269` and the new approve-plan row, all expected green throughout.
- **The profile edit drifting between the two copies or from the predicted bytes.** T-205 checks `cmp` and the predicted hash before the pin is written.
- **An upgrade in the middle of a fix round.** An envelope installed by the old script ends in the plan, so `handback code` halts `ORCH_HANDBACK_SCOPE_MISMATCH`; recovery is the documented `resume` or `end`, then `start` (spec, Alternative paths). No code handles it, by design.
- **The profile still tells a fix agent to tick boxes.** `code.md:12` ("When the task is done, tick its checkboxes in the plan") is unchanged by the spec; in a fix round the brief says "tick no boxes" and Guard 5 now denies the write. Changing that line is outside this item's scope.
- **The long suite timing out the shell.** T-301 notes the duration; a timeout is not a red.
