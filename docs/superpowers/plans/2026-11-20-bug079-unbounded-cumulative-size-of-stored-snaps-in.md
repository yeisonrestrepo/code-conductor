# BUG-079 Bound the orchestrator run file below the hooks' read cap implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** The non-security `handback <role>` path serializes the run it is about to save once. It writes the run only if that text is at most `RUN_FILE_MAX_BYTES` = 8 MiB. Otherwise it halts `ORCH_RUN_FILE_FULL` and records nothing, so the run file always stays readable under the hooks' 10 MiB cap and Guard 6 keeps denying. Both `cc-orchestrate.md` copies get one sentence that names the halt and its recovery.

**Spec:** `docs/superpowers/specs/2026-11-20-bug079-unbounded-cumulative-size-of-stored-snaps-in-design.md` (sha256 `1503d4756a7fcf931cf4aa38baa41d9e8489b6f2cf895d8816f8c1c4642b1844`). Issue #213.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>` and, inside `tests/scripts/orchestrate.test.js`, `-t '<pattern>'`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines stay untouched (spec, Out of Scope).
- **Five files change, plus this plan and its `.gitignore` leaf:** `scripts/orchestrate.mjs`, `tests/scripts/orchestrate.test.js`, `tests/installer/commands-parity.test.js`, `.claude/commands/cc-orchestrate.md`, `project-template/.claude/commands/cc-orchestrate.md`. No hook, installer, SNAP script (`snap-contract.mjs`, `snap-validate.mjs`), settings file, workflow or dependency changes. The hooks' `BAND_ENVELOPE_MAX_BYTES` and the 64 KiB `SNAP_STORE_MAX_BYTES` stay as they are (spec, Out of Scope).
- **No existing test is edited** (spec, AC3). The new tests are added beside RS3/RS3b, and the one new named import goes into the existing import list.
- `resume`, `recordHandback`, `recordHalt`, `securityHandback` and every other `saveRun` call are not changed (spec, System Impact).
- Every file this plan edits after Task 0 is already tracked, so every staging step after Task 0 is `git add -u <path>` with an explicit path. `.claude/commands/` and `project-template/` paths sit under ignored directories, which is why plain `git add` is never used for them.
- The two `cc-orchestrate.md` copies stay byte-identical (checked by `cmp` in T-302 and by the mirrors suite at `tests/installer/commands-parity.test.js:199`).
- `.claude/` is read-only for shell commands in some sandboxes. Edit `.claude/commands/cc-orchestrate.md` with a file-edit tool, not with `sed`.

## Review Focus

- **One serialization, measured in bytes.** The check and the write use the same string, built by the same `serializeRun` that `saveRun` now calls. `Buffer.byteLength` counts UTF-8 bytes, not UTF-16 code units (spec, choice 2).
- **Strictly greater halts.** `bytes > RUN_FILE_MAX_BYTES` halts. A run of exactly the bound is written (spec, Alternative paths).
- **Nothing is recorded on the halt.** The throw comes before `writeAtomic`, so the file on disk is the pre-verb run. The CLI's `recordHalt` (`scripts/orchestrate.mjs:1550-1555`) then re-reads that run and adds only `halt`. AC2 checks this with `toEqual` on `handbacks`.
- **The audit path.** The check runs before the `auditFix` return (`:1019`), so a full run halts `ORCH_RUN_FILE_FULL` before an audit `RETURN` is routed. That keeps the order "saved first, then the audit halt lands on top". On a full run the audit entry is never saved.
- **Security is not covered.** `securityHandback` returns before the new call (`:1014`) and still uses `saveRun` (`:965`). It stores a parsed summary, not a SNAP (spec, Out of Scope).
- **The test's escaping.** The fixture's `pr` is all `\"` pairs, which are 2 bytes in the SNAP and 4 in the run file. The test asserts that a stored entry's escaped `snap` exceeds 120 KiB, so the fixture cannot quietly drop to an unescaped size.

## Plan decisions

1. **The constant (`scripts/orchestrate.mjs:112`).** Directly after `const SNAP_STORE_MAX_BYTES = 64 * 1024;` insert:
   ```js
   // BUG-079: the hooks stop reading the run file at 10 MiB; the 2 MiB below that is for the unchecked writes after a hand-back (a halt, approvals, dispatch fields).
   export const RUN_FILE_MAX_BYTES = 8 * 1024 * 1024;
   ```
   8 MiB is the spec's bound (choice 3), 8 388 608 bytes.
2. **Shared serialization and the bounded save (`scripts/orchestrate.mjs:239`).** Replace the one-line `saveRun` with:
   ```js
   const serializeRun = (run) => JSON.stringify(run, null, 2) + '\n';
   const saveRun = (root, run) => writeAtomic(join(root, RUN_FILE), serializeRun(run));

   // BUG-079: a hand-back stores its SNAP, so it is the write that could carry the run file past the hooks' read cap.
   function saveHandedBackRun(root, run, role) {
     const text = serializeRun(run);
     const bytes = Buffer.byteLength(text);
     if (bytes > RUN_FILE_MAX_BYTES) {
       throw new Halt('ORCH_RUN_FILE_FULL', `the run file would be ${bytes} bytes with this ${role} hand-back, over the ${RUN_FILE_MAX_BYTES}-byte bound that keeps it readable by the hooks; end, then start with a smaller plan`);
     }
     writeAtomic(join(root, RUN_FILE), text);
   }
   ```
   `saveRun`'s output is byte-identical to today's. The new function serializes once and writes the string it measured, so the check and the write cannot measure different bytes (spec, System Impact). The CLI prints `${e.code}: ${e.reason}` (`:1665`), which gives the spec's stderr text with `<8388608>` filled in. `Halt` already exists (`:160`). `Buffer` is the Node global that `parseHandback` already uses (`:669`).
3. **The call (`scripts/orchestrate.mjs:1017`).** In `handback`, `saveRun(root, recorded);` becomes `saveHandedBackRun(root, recorded, role);`. This is the only line changed in `handback`. The `:1016` `recordHandback(..., { snap })` and the comment at `:1018` stay.
4. **Tests (`tests/scripts/orchestrate.test.js`).**
   - Import: add `RUN_FILE_MAX_BYTES` to the named import list at line 13, after `RUN_FILE`.
   - Inside `describe('resume verb [FEAT-055]', …)`, directly above the `// Entry acceptance criteria.` comment that follows RS3b (line 3013), insert local helpers and three cases. They reuse the describe's `snapOf` and `editRun` and the file-level `driveTo`, `task`, `handbackLine`, `orch`, `runFile`, `envelope` and `REPO_ROOT`.
     ```js
     // BUG-079: the hooks' read cap on the run file, and a code SNAP at the 64 KiB cap whose pr is all \" pairs, so its escaped stored copy is about twice that.
     const HOOK_READ_CAP = 10485760;
     const MANY_TASKS = `# Demo Plan\n\n${Array.from({ length: 80 }, (_, i) => task(i + 1, [`src/t${i + 1}.js`])).join('\n')}\n## Test List\n`;
     const runSize = () => statSync(join(root, RUN_FILE)).size;
     function maxSay() {
       const line = handbackLine('code', 'build_executed');
       const room = 64 * 1024 - Buffer.byteLength(snapOf(line));
       return `Done.\n${line.replace('"pr":""', `"pr":"${'\\"'.repeat(Math.floor(room / 2))}"`)}\n`;
     }
     const maxPass = () => { expect(orch(['install', 'code']).status).toBe(0); return orch(['handback', 'code'], { input: maxSay() }); };
     // One real max-size hand-back, then copies of it seeded up to one entry below the bound, so the last ones run through the verb.
     function nearBound() {
       driveTo('code', { planText: MANY_TASKS });
       expect(maxPass().status).toBe(0);
       const entry = runFile().handbacks.at(-1);
       expect(Buffer.byteLength(JSON.stringify(entry.snap))).toBeGreaterThan(120 * 1024);
       const entryBytes = Buffer.byteLength(JSON.stringify(entry, null, 2)) + 8;
       const seeded = Math.floor((RUN_FILE_MAX_BYTES - runSize()) / entryBytes) - 1;
       editRun((run) => {
         const ids = run.tasks.ids.slice(run.tasks.done, run.tasks.done + seeded);
         run.handbacks.push(...ids.map((task) => ({ ...entry, task })));
         run.tasks.done += seeded;
       });
     }
     ```
     `entryBytes` slightly overstates an entry's indented size (the `+ 8` covers the comma, newline and the nesting indentation `JSON.stringify(entry, null, 2)` leaves out). So after seeding, the run is between one and two entries below the bound, and the real verb accepts at least one more hand-back before one halts. The seeded copies carry the plan's next task ids and advance `tasks.done`, as real hand-backs would, so the next `install code` dispatches a real remaining task (80 tasks; about 63 are used). Measured on a scratch copy (plan decision 6): the SNAP is 65 535 or 65 536 bytes (`room` is odd or even with the task id's length), its escaped stored copy is about 128 KiB (130 943 bytes for task 2), and each test takes about 2.4 s.
     - **RS3c [AC1]** `'RS3c[BUG-079 AC1] many max-size hand-backs keep the run file under the hooks\' cap until one halts ORCH_RUN_FILE_FULL'`: `nearBound()`, then up to five `maxPass()` calls. After each one, `runSize()` is `<= RUN_FILE_MAX_BYTES` and `< HOOK_READ_CAP`, and the loop stops at the first non-zero status. At least one pass is accepted, and the last one has status 1 with stderr matching `/^ORCH_RUN_FILE_FULL: /`.
     - **RS3d [AC2]** `'RS3d[BUG-079 AC2] the halting hand-back is not recorded and the halt names the size, the bound and the recovery'`: `nearBound()`. Take `before = runFile().handbacks` before each `maxPass()` while the status is 0 (at most five times). Then `runFile().halt.code` is `'ORCH_RUN_FILE_FULL'`, and stderr matches `/^ORCH_RUN_FILE_FULL: the run file would be \d+ bytes with this code hand-back, over the 8388608-byte bound that keeps it readable by the hooks; end, then start with a smaller plan$/`. The size it names is `> RUN_FILE_MAX_BYTES`, `runFile().handbacks` `toEqual(before)`, and `runSize()` is `<= HOOK_READ_CAP`.
     - **RS3e [AC4]** `'RS3e[BUG-079 AC4] the run file bound sits at least 1 MiB below both hooks\' read cap'`: for `.claude/hooks/pre-tool-use.mjs` and `project-template/.claude/hooks/pre-tool-use.mjs` under `REPO_ROOT`, read the file and match `/^const BAND_ENVELOPE_MAX_BYTES = (\d+);$/m` (today line 166 in both, `10485760`). Then `RUN_FILE_MAX_BYTES <= cap - 1024 * 1024`. A missing match throws on `[1]` and fails the test, which is the intended signal if the hook's line changes shape.
   - `tests/installer/commands-parity.test.js`: directly after the `[BUG-077]` `it` (lines 405-407), inside `describe('cc-orchestrate review loop …')` (line 343), add:
     ```js
     it('names the run file bound halt and its recovery [BUG-079]', () => {
       has('`ORCH_RUN_FILE_FULL`', 'the hand-back is not recorded, and recovery is `end`, then `start` with a smaller plan');
     });
     ```
5. **The command sentence (AC5).** In both `cc-orchestrate.md` copies, line 37 is the `handback <role>` halts paragraph. It ends with ``Recovery is `resume` or `end`, then `start`.``. Append, after one space, on the same line:
   `` `handback <role>` also halts `ORCH_RUN_FILE_FULL` when recording the hand-back would carry the run file past `RUN_FILE_MAX_BYTES` (8388608 bytes), the bound that keeps it under the hooks' read cap; the hand-back is not recorded, and recovery is `end`, then `start` with a smaller plan, because `resume` keeps the stored records and the redone hand-back halts again. ``
   This is the one sentence the spec asks for. It names the halt, says the hand-back is not recorded, gives `end`, then `start`, and says why `resume` does not help. Line 32 says `resume` is the other recovery wherever a halt names `end`, then `start`. That rule still holds, because `resume` succeeds here; the sentence explains why it ends in the same halt.
6. **Measured before writing this plan** (HEAD `e8e8eae`, git 2.43.0, uid 1001). Plan decisions 1-5 were applied to a scratch copy of the tree outside the repository and run there. The repository's working tree was not touched.
   - `npx vitest run tests/scripts/orchestrate.test.js -t 'BUG-079'` with the fix gave **3 passed** (1125 skipped). On the original `scripts/orchestrate.mjs` it gave **3 failed**. RS3c and RS3d fail at a `maxPass` status (`expected 1 to be +0`), because the undefined import makes `seeded` `NaN` and the seeded run file invalid. RS3e fails with `actual value must be number or bigint, received "undefined"`.
   - `npx vitest run tests/installer/commands-parity.test.js` with decisions 4-5 gave **94 passed (94)**.
   - The full-file result is under Baseline.
7. **`.gitignore` leaf.** `!/docs/superpowers/plans/2026-11-20-bug079-unbounded-cumulative-size-of-stored-snaps-in.md` goes directly before the `2026-11-20-bug088` plan leaf (line 184). That is its full-path sorted position, which `tests/unit/gitignore-block-parity.test.js` checks.

## Baseline (measured on this branch, HEAD e8e8eae)

- `tests/scripts/orchestrate.test.js` holds 1125 tests. `tools/skip-baseline.json` lists none of them.
- With plan decisions 1-5 applied to the scratch copy, `npx vitest run tests/scripts/orchestrate.test.js` gave **1128 passed (1128)** in about 550 s, RS3 and RS3b included.
- The full suite was not run for this plan. Earlier plans on this sandbox measured environment failures in files this plan does not touch (`tests/hooks/context-guard.test.js`, `tests/hooks/verbosity-remind.test.js`, `tests/scripts/conductor-db.test.js`, `tests/unit/staging-convention.test.js`). T-301 runs the suite on HEAD first when any red appears.

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-20-bug079-unbounded-cumulative-size-of-stored-snaps-in.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file from the approved spec `1503d475…`. No dependency.
- [X] [T-002] `.gitignore`: insert the leaf of plan decision 7 before the `2026-11-20-bug088` plan leaf. Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` (tracked) and `git add docs/superpowers/plans/2026-11-20-bug079-unbounded-cumulative-size-of-stored-snaps-in.md` (new, re-included by its leaf). Depends on T-002.
- [X] [T-004] Commit: `docs: plan bounding the orchestrator run file size [BUG-079]`. Depends on T-003.

---

### Task 1: Tests first (red)

**Files:**
- Modify: `tests/scripts/orchestrate.test.js:13`, `:3013`
- Modify: `tests/installer/commands-parity.test.js:407`

- [X] [T-101] `tests/scripts/orchestrate.test.js:13`: add `RUN_FILE_MAX_BYTES` to the named import (plan decision 4). Depends on T-004.
- [X] [T-102] `tests/scripts/orchestrate.test.js:3013`: insert the BUG-079 helpers and RS3c, RS3d and RS3e above `// Entry acceptance criteria.` (plan decision 4). Depends on T-101.
- [X] [T-103] `tests/installer/commands-parity.test.js:407`: add the `[BUG-079]` `it` after the `[BUG-077]` one (plan decision 4). Depends on T-102.
- [X] [T-104] Red run: `npx vitest run tests/scripts/orchestrate.test.js -t 'BUG-079'`. Its full match set is RS3c, RS3d and RS3e. No existing title contains `BUG-079`. Predicted: **3 failed** (1125 skipped), with the failure messages of plan decision 6. Any other split means a test is wrong: fix the test, not the prediction. Depends on T-103.
- [X] [T-105] Red run: `npx vitest run tests/installer/commands-parity.test.js -t 'BUG-079'`. Its full match set is the new test only. Predicted: **1 failed** (at `toContain('`ORCH_RUN_FILE_FULL`')`), and every other test in the file is skipped. Depends on T-104.

---

### Task 2: The bound and the documentation (green)

**Files:**
- Modify: `scripts/orchestrate.mjs:112`, `:239`, `:1017`
- Modify: `.claude/commands/cc-orchestrate.md:37`, `project-template/.claude/commands/cc-orchestrate.md:37`

- [X] [T-201] `scripts/orchestrate.mjs:112`: add `RUN_FILE_MAX_BYTES` with its comment after `SNAP_STORE_MAX_BYTES` (plan decision 1). Depends on T-105.
- [X] [T-202] `scripts/orchestrate.mjs:239` (now `:241`): replace `saveRun` with `serializeRun`, `saveRun` and `saveHandedBackRun` (plan decision 2). Depends on T-201.
- [X] [T-203] `scripts/orchestrate.mjs:1017` (now about `:1030`): in `handback`, change `saveRun(root, recorded);` to `saveHandedBackRun(root, recorded, role);` (plan decision 3). Depends on T-202.
- [X] [T-204] Green run: the T-104 command. Predicted: **3 passed** (1125 skipped). Depends on T-203.
- [X] [T-205] `.claude/commands/cc-orchestrate.md:37`: append the sentence of plan decision 5 with a file-edit tool. Depends on T-204.
- [X] [T-206] `project-template/.claude/commands/cc-orchestrate.md:37`: append the same sentence. Depends on T-205.
- [X] [T-207] Green run: `npx vitest run tests/installer/commands-parity.test.js`. Predicted: **94 passed (94)**, including the mirrors suite (spec, AC5). Depends on T-206.
- [X] [T-208] `npx vitest run tests/scripts/orchestrate.test.js`. Predicted: **1128 passed (1128)** (1125 baseline + 3 new), with RS3 and RS3b unmodified and green (spec, AC3). Depends on T-207.

---

### Task 3: Full suite, scope check and commit

**Files:**
- Modify: `scripts/orchestrate.mjs`, `tests/scripts/orchestrate.test.js`, `tests/installer/commands-parity.test.js`, `.claude/commands/cc-orchestrate.md`, `project-template/.claude/commands/cc-orchestrate.md` (staged), this plan (checkboxes)

- [X] [T-301] Run `npm test`. Predicted: every file green, apart from environment failures in files this plan does not touch. On CI the exit status is 0 (spec, AC6). A red counts as ENV only if the sandbox causes it (network, tmp permissions, uid, missing `node:sqlite`) and the test's file is not one this plan touches. Report it with its name. Any other red is fixed. Depends on T-208.
- [X] [T-302] Scope check:
  - `git status --porcelain` lists exactly the five files of this task and this plan as modified.
  - `cmp .claude/commands/cc-orchestrate.md project-template/.claude/commands/cc-orchestrate.md` prints nothing.
  - `git diff -U0 HEAD -- tests/scripts/orchestrate.test.js | grep '^-[^-]'` prints only the old import line 13 (no existing test edited, spec AC3).
  - `git diff --quiet HEAD -- VERSION CHANGELOG.md package.json package-lock.json README.md "AGENT-READABLE BACKLOG.md" .claude/memory .claude/hooks project-template/.claude/hooks .claude/settings.json scripts/snap-contract.mjs scripts/snap-validate.mjs .github tools lib bin` exits 0.
  - Depends on T-301.
- [X] [T-303] Stage: `git add -u scripts/orchestrate.mjs tests/scripts/orchestrate.test.js tests/installer/commands-parity.test.js .claude/commands/cc-orchestrate.md project-template/.claude/commands/cc-orchestrate.md` (all tracked). Depends on T-302.
- [X] [T-304] Stage: `git add -u docs/superpowers/plans/2026-11-20-bug079-unbounded-cumulative-size-of-stored-snaps-in.md` (carries the ticks for T-101 to T-303). Depends on T-303.
- [X] [T-305] Commit: `fix: bound the orchestrator run file below the hooks' read cap [BUG-079]`. Depends on T-304.

---

## Test List

- [X] Integration (CLI), AC1: RS3c, many 64 KiB hand-backs that double under escaping, the last ones through the real `handback code` verb. The file stays at most 8 MiB and under 10 MiB until one halts `ORCH_RUN_FILE_FULL`.
- [X] Integration (CLI), AC2: RS3d. The halting hand-back leaves `handbacks` equal to before, `halt.code` is `ORCH_RUN_FILE_FULL`, the file stays at most 10 MiB, and the exact stderr text names the size, the bound and the recovery.
- [X] Unit, AC3: every existing `tests/scripts/orchestrate.test.js` case unmodified and green, RS3 and RS3b included (T-208, T-302).
- [X] Unit, AC4: RS3e, `RUN_FILE_MAX_BYTES` at least 1 MiB below `BAND_ENVELOPE_MAX_BYTES` in both hook copies.
- [X] Parity, AC5: the `[BUG-079]` `it` in `commands-parity.test.js`, the mirrors suite, and `cmp` in T-302.
- [X] AC6: `npm test` (T-301).
- [X] No E2E/UI test: the verb is exercised end to end through the CLI fixture, and there is no UI.

## Commit Order

1. Task 0 (T-004): this plan and its `.gitignore` leaf.
2. Task 3 (T-305): the tests, the fix, both command copies and the plan ticks for T-101 to T-303, all in one commit, so no commit has a red suite. The red runs in T-104 and T-105 happen in the working tree before the fix. The ticks for T-304, T-305 and the Test List ride a closeout commit.

## Identified Risks

- **The fixture SNAP stops validating or stops doubling.** If `snap-validate` ever rejects a long `pr` of `\"` pairs, `nearBound`'s first `maxPass` fails at status 1 with `ORCH_HANDBACK_INVALID`. If the padding stops doubling under escaping, the `> 120 KiB` assertion fails. Either way the test fails loudly, never with a false pass. Catch: T-104 and T-204.
- **Seeding lands past the bound.** If `entryBytes` understated an entry, the first real pass after seeding would halt and RS3c's "at least one accepted" would fail. The `+ 8` and the `- 1` keep one to two entries of room (measured, plan decision 6). Catch: T-204.
- **Run time.** Each of RS3c and RS3d writes and re-reads an ~8 MiB run file a handful of times, about 2.4 s each in the scratch run. That is well under the 30 s `testTimeout`. Catch: T-204, T-208.
- **A future field grows the run after the check.** The 2 MiB headroom covers the unchecked writes (spec, choice 3), and RS3e fails if the bound is moved within 1 MiB of the hooks' cap. Bounding other growth sources is out of scope.
- **`resume` after the halt.** It is unchanged and ends in the same halt. The command sentence names `end`, then `start` and says why (spec, Alternative paths).
- **Full-file run time.** `tests/scripts/orchestrate.test.js` takes several minutes here. Use `-t` filters for the red and green runs and run the full file once (T-208).
