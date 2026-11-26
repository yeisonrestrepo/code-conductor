# BUG-099 Install writes an unbounded build_tree fingerprint to the run file: implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** `install <role>` serializes the run it is about to save and halts `ORCH_RUN_FILE_FULL` when its byte length exceeds `RUN_FILE_MAX_BYTES` (8 MiB), before it writes the envelope or the run, so every run file a successful `install` leaves on disk stays readable by the hooks for the whole dispatch. The halt names the would-be size, the bound, the fingerprint's file count when `install code` or `install test-writer` computed one, and the recovery for that case. The four `/cc-orchestrate` copies and the README's Guard 5 paragraph name the halt.

**Spec:** `docs/superpowers/specs/2026-11-26-bug099-install-writes-an-unbounded-build-tree-design.md` (sha256 `e32d3366917b9b974a3f8803cf04f90f12bfe5035a400d230d1177305c7322de`), approved by independent review (round 1). Issue #340, follow-up of BUG-092.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>` and `-t '<pattern>'`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines stay untouched. The release rewrites them.
- **Eight files change, plus this plan and its `.gitignore` leaf:** `scripts/orchestrate.mjs`, `tests/scripts/orchestrate.test.js`, `.claude/commands/cc-orchestrate.md`, `project-template/.claude/commands/cc-orchestrate.md`, `project-template/.agents/skills/cc-orchestrate/SKILL.md`, `project-template/.agents/workflows/cc-orchestrate.md`, `tests/installer/commands-parity.test.js` and `README.md` (the spec's System Impact list), and nothing else.
- Not touched: `buildTree`, `treeFingerprint`, `splitCheck`, `handback`, `resume`, `recordHalt`, `saveRun`, the run-file shape, the halt-code set (`ORCH_RUN_FILE_FULL` already exists), `.claude/hooks/pre-tool-use.mjs` and its mirror, the SNAP contract and envelope versions, the installer, settings, `.github/workflows/`, `.github/actions/` and dependencies. No network is added.
- Every file this plan edits after Task 0 is already tracked and none sits under an ignored directory, so each is staged with `git add -u <path>`. This plan is new in Task 0 under the ignored `docs/superpowers/plans/` (so `git add -f`), and after that it is tracked and re-included by its leaf (so `git add -u`).
- `.claude/` is read-only for Bash in the build sandbox, so the edit under `.claude/` uses the Edit tool. The other files may use either.

## Files read in full (spec, Files Requiring Full Read)

- `scripts/orchestrate.mjs` (1955 lines): `RUN_FILE_MAX_BYTES` (`:118`); `Halt` (`:176`) and `isPlainObject` (`:181`); `writeAtomic` (`:195`); `readRun` (`:249`), which has no size cap, so a run file over the bound is still read by the CLI; `serializeRun` and `saveRun` (`:260-261`); `saveHandedBackRun` (`:264-271`); `treeFingerprint` (`:750-760`) and `buildTree` (`:763-767`); `changeNote` (`:770-778`); `install` (`:781-803`), which writes the envelope at `:798` and the run at `:801` after `if (check) return out;` (`:797`); `entryFields` (`:820`); `handback`'s `saveHandedBackRun` call (`:1228`); `resume` (`:1590-1615`), which drops `build_tree` (`:1602`) and keeps only the approvals and each task's `code` entry with its writer (`keptEntries`, `:1559`), so after a halt at `install code` of task 1 the next step is `install test-writer`; `recordHalt` (`:1812-1816`), which saves the run read from disk plus `halt` through `saveRun`; `cli` (`:1924-1950`), which calls `recordHalt` for every halt of `install`. Fix rounds reach `install` through the same function, so no separate path exists.
- `tests/scripts/orchestrate.test.js` (5898 lines): `RUN_FILE_MAX_BYTES` is imported (`:13`); `statSync` and `rmSync` are imported (`:3`); `runFile`, `runFileText`, `envelopeText` (`:58-62`); RS3c/RS3d's `nearBound` (`:3066-3077`), which seeds copies of a real max-size hand-back; the BUG-092 block `describe('test-surface split at hand-back [BUG-092]'` (`:5656`), its helpers `write`, `patchRun`, `writerDone`, `codeSay`, `atWriter`, `install`, `handBack` (`:5660-5679`), its last row `[AC12] resume drops the fingerprint, …` (`:5857-5869`) and its closing `});` (`:5870`), directly above `describe('control-plane paths for the release check [BUG-090]'` (`:5872`). A recorded hand-back stores its SNAP as a JSON string in `entry.snap`.
- `tests/installer/commands-parity.test.js`: `ORCH_MIRRORS` (`:198`, the two Claude Code copies), the BUG-092 block that lists the two harness copies (`:391-400`), and the `has` helper of `describe('cc-orchestrate review loop [FEAT-041 AC5, AC6, FEAT-058]'` (`:402-404`), which reads only `ORCH_MIRRORS[0]`; its BUG-079 row `names the run file bound halt and its recovery [BUG-079]` is `:468-470`.
- The four `cc-orchestrate` copies: the `install` halts paragraph is the line that starts ``install code|audit|qa` halts `ORCH_APPROVED_DOC_CHANGED``, at `.claude/commands/cc-orchestrate.md:35`, `project-template/.claude/commands/cc-orchestrate.md:35`, `project-template/.agents/skills/cc-orchestrate/SKILL.md:39` and `project-template/.agents/workflows/cc-orchestrate.md:38`. The four lines are byte-identical, and each ends ``install security` halts the same two codes.``
- `README.md:314` (Guard 5 in detail), which holds once ``install` records a fingerprint of the work tree's changed, non-ignored files for each `test-writer` and `code` dispatch, and `handback` halts``.

## Plan decisions

1. **One bounded serializer, two callers (spec System Impact).** In `scripts/orchestrate.mjs`, the BUG-079 comment and `saveHandedBackRun` (`:263-271`) are replaced by exactly:

   ```js
   // BUG-079, BUG-099: the serialized run, or ORCH_RUN_FILE_FULL when it would carry the run file past the hooks' read cap.
   function boundedRunText(run, write, recovery) {
     const text = serializeRun(run);
     const bytes = Buffer.byteLength(text);
     if (bytes <= RUN_FILE_MAX_BYTES) return text;
     throw new Halt('ORCH_RUN_FILE_FULL', `the run file would be ${bytes} bytes with this ${write}, over the ${RUN_FILE_MAX_BYTES}-byte bound that keeps it readable by the hooks; ${recovery}`);
   }
   const SMALLER_PLAN = 'end, then start with a smaller plan';

   // BUG-079: a hand-back stores its SNAP, so it is the write that could carry the run file past the hooks' read cap.
   const saveHandedBackRun = (root, run, role) => writeAtomic(join(root, RUN_FILE), boundedRunText(run, `${role} hand-back`, SMALLER_PLAN));

   // BUG-099: the fingerprint grows with the work tree, not the plan, so its recovery is a smaller tree.
   function installedRunText(run, role) {
     const files = run.build_tree?.files;
     if (!isPlainObject(files)) return boundedRunText(run, `${role} install`, SMALLER_PLAN);
     const write = `${role} install, whose fingerprint lists ${Object.keys(files).length} changed or untracked files`;
     return boundedRunText(run, write, 'hide generated files behind an ignore rule, then resume, or end, then start');
   }
   ```

   - **The hand-back message does not change.** `with this ${role} hand-back, over the …; end, then start with a smaller plan` is byte-for-byte BUG-079's, so RS3c and RS3d pass unchanged (spec AC6). The comparison stays `bytes > RUN_FILE_MAX_BYTES` halts and equal passes (spec, Alternative paths).
   - **The fingerprint clause (spec choice 2).** It appears only when `build_tree.files` exists. A fingerprint recorded as `unavailable` and every role other than `code` and `test-writer` get the no-fingerprint message and BUG-079's recovery (spec Error cases, second bullet). The two messages are the spec's Error-case texts with `<role>` and `<n>`, `<k>` filled in.
   - Sizes: `boundedRunText` 6 lines, `installedRunText` 6 lines.

2. **`install` checks before either write (spec choice 3).** In `install`, the four lines after `if (check) return out;` (`:798-801`) become:

   ```js
     const { dispatch_model: _previous, build_tree: _tree, ...kept } = run;
     const tree = buildTree(root, run, role);
     // BUG-099: checked before either write, so a halt leaves no envelope for a dispatch that never happens.
     const text = installedRunText({ ...kept, band: ROLE_BAND[role], role, ...(model ? { dispatch_model: model } : {}), ...(tree ? { build_tree: tree } : {}) }, role);
     writeAtomic(join(root, ENVELOPE_FILE), built.out);
     writeAtomic(join(root, RUN_FILE), text);
   ```

   The run object is the one `saveRun` received before; only its write moves behind the check, and the envelope write moves from before `buildTree` to after the check. The order of the two writes (envelope, then run) does not change. `--check` returns before this block, so it computes no fingerprint and runs no check (spec, Alternative paths). On a halt, `cli` runs `recordHalt`, which reads the run left on disk by the previous verb and saves it with `halt` only: no `build_tree`, the earlier `role` and `handbacks` (spec Error cases). `install` grows from 23 to 25 lines.

3. **The test block (spec AC1-AC5, choice 5).** In `tests/scripts/orchestrate.test.js`, inside the BUG-092 block so it reuses its git work-tree fixture and helpers: after the `[AC12] resume drops the fingerprint, …` row's closing `  });` (`:5869`) and before the block's closing `});` (`:5870`), insert one blank line and then exactly:

   ```js
     // BUG-099: the fingerprint grows with the work tree, so install checks the run file's bound before it writes anything.
     describe('run-file bound at install [BUG-099]', () => {
       const ROOM = 8 * 1024;
       const runSize = () => statSync(join(root, RUN_FILE)).size;
       // Pads the recorded test-writer hand-back's stored SNAP until the run file is `room` bytes under the bound (over it when negative).
       const padRun = (room) => patchRun((run) => {
         const entry = run.handbacks.findLast((h) => h.role === 'test-writer');
         const fill = RUN_FILE_MAX_BYTES - room - Buffer.byteLength(JSON.stringify(run, null, 2) + '\n');
         entry.snap = entry.snap.replace('"pr":""', `"pr":"${'x'.repeat(fill)}"`);
       });
       const generate = (n) => { for (let i = 0; i < n; i++) write(`gen/f${String(i).padStart(3, '0')}.txt`, `${i}\n`); };
       const writerHandedBack = () => { atWriter(); install('test-writer'); write('tests/a.test.js'); expect(handBack('test-writer', writerDone()).status).toBe(0); };
       const FULL = /^ORCH_RUN_FILE_FULL: the run file would be (\d+) bytes with this code install, whose fingerprint lists 202 changed or untracked files, over the 8388608-byte bound that keeps it readable by the hooks; hide generated files behind an ignore rule, then resume, or end, then start$/;

       it('[AC1] install code halts ORCH_RUN_FILE_FULL when its fingerprint would carry the run file past the bound', () => {
         writerHandedBack();
         padRun(ROOM);
         generate(200);
         const r = orch(['install', 'code']);
         expect(r.status).toBe(1);
         expect(r.err).toMatch(FULL);
         expect(Number(r.err.match(FULL)[1])).toBeGreaterThan(RUN_FILE_MAX_BYTES);
       });

       it('[AC2] the halted install leaves the run file under the bound, without a fingerprint, and writes no envelope', () => {
         writerHandedBack();
         padRun(ROOM);
         generate(200);
         const before = runFile();
         const envelope = envelopeText();
         expect(orch(['install', 'code']).status).toBe(1);
         const after = runFile();
         expect(runSize()).toBeLessThanOrEqual(RUN_FILE_MAX_BYTES);
         expect(after).not.toHaveProperty('build_tree');
         expect(after.role).toBe(before.role);
         expect(after.handbacks).toEqual(before.handbacks);
         expect(after.halt.code).toBe('ORCH_RUN_FILE_FULL');
         expect(envelopeText()).toBe(envelope);
       });

       it('[AC3] with the same padding and a smaller tree, install code succeeds under the bound', () => {
         writerHandedBack();
         padRun(ROOM);
         generate(20);
         install('code');
         expect(runFile().role).toBe('code');
         expect(Object.keys(runFile().build_tree.files)).toHaveLength(22);
         expect(runSize()).toBeLessThanOrEqual(RUN_FILE_MAX_BYTES);
       });

       it('[AC4] an install that records no fingerprint halts on a run over the bound with the smaller-plan recovery', () => {
         writerHandedBack();
         install('code');
         write('src/a.js', 'a2\n');
         expect(handBack('code', codeSay(['src/a.js:M'])).status).toBe(0);
         padRun(-1024);
         const before = runFile();
         const envelope = envelopeText();
         const r = orch(['install', 'audit']);
         expect(r.status).toBe(1);
         expect(r.err).toMatch(/^ORCH_RUN_FILE_FULL: the run file would be \d+ bytes with this audit install, over the 8388608-byte bound that keeps it readable by the hooks; end, then start with a smaller plan$/);
         expect(runFile().role).toBe(before.role);
         expect(runFile().handbacks).toEqual(before.handbacks);
         expect(runFile().halt.code).toBe('ORCH_RUN_FILE_FULL');
         expect(envelopeText()).toBe(envelope);
       });

       it('[AC5] after the halt, resume and a reduced tree let the re-dispatch install and record its fingerprint', () => {
         writerHandedBack();
         padRun(ROOM);
         generate(200);
         expect(orch(['install', 'code']).err).toMatch(FULL);
         expect(orch(['resume']).out).toMatch(/after ORCH_RUN_FILE_FULL .*; next: install test-writer/);
         rmSync(join(root, 'gen'), { recursive: true });
         install('test-writer');
         expect(handBack('test-writer', writerDone()).status).toBe(0);
         install('code');
         expect(runFile()).toMatchObject({ role: 'code', build_tree: { role: 'code', files: { [SPEC]: sha(SPEC), 'tests/a.test.js': sha('tests/a.test.js') } } });
       });
     });
   ```

   5 tests. How the bound is crossed (choice 5): `padRun` pads the stored SNAP of the recorded test-writer hand-back, which the router does not re-validate after it is recorded, until the run file is `ROOM` (8 KiB) under the bound. `generate(200)` adds 200 untracked, non-ignored files, so the `code` fingerprint holds 202 entries (the 200, the untracked spec `approveArgs` writes, and `tests/a.test.js`), about 18 KB of pretty-printed JSON, which crosses the 8 KiB room. `generate(20)` (22 entries, about 2 KB) stays under it. The bound, `treeFingerprint` and `install` are the real ones; only the starting size is set up. The `[AC4]` row pads the run 1 KiB over the bound after a recorded `code` hand-back, so `install audit`, which records no fingerprint, halts on the run's own size. The `[AC5]` row: after the halt, `resume` keeps only the approvals, because the task has no `code` entry, so the next step is `install test-writer`. The row removes `gen/`, re-dispatches the writer, and `install code` then records its fingerprint.

4. **The four `cc-orchestrate` copies (spec AC7).** In each `install` halts line named above, after ``install security` halts the same two codes.``, insert one space and then exactly:

   ``install <role>` also halts `ORCH_RUN_FILE_FULL` when the run file it would write exceeds `RUN_FILE_MAX_BYTES` (8388608 bytes), and installs no envelope. When the halt names the fingerprint `install code` or `install test-writer` takes of the changed and untracked files, hide generated files behind an ignore rule (or remove them), then `resume`, or `end`, then `start`; otherwise recovery is `end`, then `start` with a smaller plan.``

   The four lines stay byte-identical to each other, and the two Claude Code copies stay byte-identical as files (the existing mirror row).

5. **`tests/installer/commands-parity.test.js` (spec AC7).** Directly after the BUG-079 row (its closing `  });` at `:470`), insert one blank line and then exactly:

   ```js
     // BUG-099: the fingerprint makes install a write that can outgrow the bound, so every copy names its halt and both recoveries.
     it.each([...ORCH_MIRRORS, 'project-template/.agents/skills/cc-orchestrate/SKILL.md', 'project-template/.agents/workflows/cc-orchestrate.md'])('%s names the install bound halt and both recoveries [BUG-099]', (rel) => {
       expect(read(rel)).toContain('`install <role>` also halts `ORCH_RUN_FILE_FULL` when the run file it would write exceeds `RUN_FILE_MAX_BYTES` (8388608 bytes), and installs no envelope. When the halt names the fingerprint `install code` or `install test-writer` takes of the changed and untracked files, hide generated files behind an ignore rule (or remove them), then `resume`, or `end`, then `start`; otherwise recovery is `end`, then `start` with a smaller plan.');
     });
   ```

   4 rows. The spec says "a `has` case", but `has` reads only `ORCH_MIRRORS[0]`, and the two harness copies are not mirrored byte for byte, so an `it.each` over the four files beside the BUG-079 row pins the sentence in every copy, as the BUG-092 block does.

6. **README (spec AC8).** In `README.md:314`, ``… for each `test-writer` and `code` dispatch, and `handback` halts`` becomes ``… for each `test-writer` and `code` dispatch (it halts `ORCH_RUN_FILE_FULL` rather than write a fingerprint that would carry the run file past its 8 MiB bound), and `handback` halts``. One line changes; the Known-limits lines do not.

7. **Red predictions, measured on a copy of this branch (HEAD `46b9c91`, Node v24.22.2, git 2.43.0) with the tests of decisions 3 and 5 and the unchanged script and documents.**
   - Task 1, `npx vitest run tests/scripts/orchestrate.test.js -t 'BUG-099'`: the full match set is the 5 new tests (no existing title contains `BUG-099`). **Red 4:** `[AC1]`, `[AC2]`, `[AC4]`, `[AC5]`. **Green 1:** `[AC3]` (an install under the bound succeeds today too). So **4 failed | 1 passed | 1303 skipped (1308)**.
   - Task 3, `npx vitest run tests/installer/commands-parity.test.js` before the command edits: **4 failed | 128 passed (132)**, the four new rows red.

8. **`.gitignore` leaf.** `!/docs/superpowers/plans/2026-11-26-bug099-install-writes-an-unbounded-build-tree.md` goes directly after the `2026-11-26-bug092-test-surface-split-bypassable-through-the.md` plan leaf (`.gitignore:214`) and before the `2026-11-26-feat062-release-driver-support-for-prerelease-and-non.md` plan leaf, the full-path sort order of the block (BUG-042).

## Baseline (measured on this branch, HEAD 46b9c91, Node v24.22.2, git 2.43.0)

- `npx vitest run tests/installer/commands-parity.test.js`: **128 passed (128)**.
- `tests/scripts/orchestrate.test.js`: **1303** tests.
- After every change, measured on the copy: `tests/installer/commands-parity.test.js` **132 passed (132)**; `tests/scripts/orchestrate.test.js -t 'BUG-099'` **5 passed**; the whole `tests/scripts/orchestrate.test.js` **1308 passed (1308)** (1303 + 5, about 14 minutes), RS3c, RS3d and the BUG-092 block included. The suite grows by 9 tests. `npm test` was not run on the copy: the copy has no `.git`, so the suites that read the repository's own git state fail there by construction. This plan touches none of them, and in the branch's work tree T-501 predicts exit 0.

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-26-bug099-install-writes-an-unbounded-build-tree.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file from the approved spec `e32d3366…`. No dependency.
- [X] [T-002] `.gitignore`: insert the leaf of plan decision 8 after the `2026-11-26-bug092` plan leaf. Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` (tracked) and `git add -f docs/superpowers/plans/2026-11-26-bug099-install-writes-an-unbounded-build-tree.md` (new, under the ignored `docs/superpowers/plans/`). Depends on T-002.
- [X] [T-004] Commit: `docs: plan the run-file bound check at install [BUG-099]`. Depends on T-003.

---

### Task 1: Bound tests first (red)

**Files:**
- Test: `tests/scripts/orchestrate.test.js`

- [ ] [T-101] `tests/scripts/orchestrate.test.js`: the nested `describe('run-file bound at install [BUG-099]')` of plan decision 3, at the end of the BUG-092 block. Depends on T-004.
- [ ] [T-102] Red run: `npx vitest run tests/scripts/orchestrate.test.js -t 'BUG-099'`. Its full match set is the 5 tests of plan decision 7. Predicted: **4 failed | 1 passed | 1303 skipped (1308)**, `[AC3]` the one green. Any other split means a test is wrong: fix the test, not the prediction. Depends on T-101.

---

### Task 2: The bound check at install (green)

**Files:**
- Modify: `scripts/orchestrate.mjs`

- [ ] [T-201] `scripts/orchestrate.mjs`: replace `saveHandedBackRun` and its comment with `boundedRunText`, `SMALLER_PLAN`, `saveHandedBackRun` and `installedRunText` (plan decision 1). Depends on T-102.
- [ ] [T-202] `scripts/orchestrate.mjs`: the `install` edit of plan decision 2. Depends on T-201.
- [ ] [T-203] Green run: the T-102 command. Predicted: **5 passed | 1303 skipped (1308)**. Then the whole file: `npx vitest run tests/scripts/orchestrate.test.js -t 'BUG-079|BUG-092|BUG-099'`, predicted all passed with RS3c and RS3d unchanged, and `npx vitest run tests/scripts/orchestrate.test.js` (several minutes), predicted **1308 passed (1308)**. Depends on T-202.

---

### Task 3: The four `cc-orchestrate` copies and the README (red, then green)

**Files:**
- Modify: `.claude/commands/cc-orchestrate.md`
- Modify: `project-template/.claude/commands/cc-orchestrate.md`
- Modify: `project-template/.agents/skills/cc-orchestrate/SKILL.md`
- Modify: `project-template/.agents/workflows/cc-orchestrate.md`
- Modify: `README.md`
- Test: `tests/installer/commands-parity.test.js`

- [ ] [T-301] `tests/installer/commands-parity.test.js`: the `[BUG-099]` rows of plan decision 5, after the BUG-079 row. Depends on T-203.
- [ ] [T-302] Red run: `npx vitest run tests/installer/commands-parity.test.js`. Predicted: **4 failed | 128 passed (132)**. Depends on T-301.
- [ ] [T-303] `.claude/commands/cc-orchestrate.md` (Edit tool): the insertion of plan decision 4. Depends on T-302.
- [ ] [T-304] `project-template/.claude/commands/cc-orchestrate.md`, `project-template/.agents/skills/cc-orchestrate/SKILL.md` and `project-template/.agents/workflows/cc-orchestrate.md`: the same insertion. Then `cmp` of the two Claude Code copies prints nothing, and the four `install` halts lines (`:35`, `:35`, `:39`, `:38`) are byte-identical. Depends on T-303.
- [ ] [T-305] Green run: the T-302 command. Predicted: **132 passed (132)**, the byte-identical mirror row included. Depends on T-304.
- [ ] [T-306] `README.md`: the Guard 5 edit of plan decision 6. `git diff README.md` shows one changed line, `:314`. Depends on T-305.

---

### Task 4: Full suite, scope check and commit

**Files:**
- Modify: `docs/superpowers/plans/2026-11-26-bug099-install-writes-an-unbounded-build-tree.md` (ticks)

- [ ] [T-401] Run `npm test` (long: `orchestrate.test.js` alone takes several minutes; run it in the background if the shell times out). Predicted: exit 0, with `tests/scripts/orchestrate.test.js` at **1308 passed** and `tests/installer/commands-parity.test.js` at 132. A red counts as ENV only if the sandbox caused it (network, tmp permissions) and its file is not one this plan touches; report it by name. Any other red gets fixed. Depends on T-306.
- [ ] [T-402] Scope check: `git status --short` lists exactly the eight files of the Global Constraints and this plan, and no temporary file is left in the tree. `git diff --stat` shows no change to the BUG-099 spec, the hooks, `buildTree`, `treeFingerprint`, `splitCheck`, `resume`, `recordHalt`, the installer, `.github/workflows/`, `.github/actions/` or the README Known-limits lines. Depends on T-401.
- [ ] [T-403] Stage: `git add -u scripts/orchestrate.mjs tests/scripts/orchestrate.test.js .claude/commands/cc-orchestrate.md project-template/.claude/commands/cc-orchestrate.md project-template/.agents/skills/cc-orchestrate/SKILL.md project-template/.agents/workflows/cc-orchestrate.md tests/installer/commands-parity.test.js README.md` (all tracked). Depends on T-402.
- [ ] [T-404] Stage: `git add -u docs/superpowers/plans/2026-11-26-bug099-install-writes-an-unbounded-build-tree.md` (carries the ticks for T-101 to T-403). Depends on T-403.
- [ ] [T-405] Commit: `fix: halt an install whose run file would outgrow the hooks' read bound [BUG-099]`. Depends on T-404.

---

## Test List

- [ ] [T-601] `tests/scripts/orchestrate.test.js` (Task 1), AC1: `[AC1]`, the halt, its message with size, file count, bound and recovery, and the size over the bound.
- [ ] [T-602] `tests/scripts/orchestrate.test.js` (Task 1), AC2: `[AC2]`, the run file under the bound with no `build_tree`, the same `role` and `handbacks`, `halt.code` `ORCH_RUN_FILE_FULL`, and the envelope unchanged.
- [ ] [T-603] `tests/scripts/orchestrate.test.js` (Task 1), AC3: `[AC3]`, the same padding with a smaller tree succeeds under the bound.
- [ ] [T-604] `tests/scripts/orchestrate.test.js` (Task 1), AC4: `[AC4]`, `install audit` on a run over the bound halts with the smaller-plan recovery and writes no envelope.
- [ ] [T-605] `tests/scripts/orchestrate.test.js` (Task 1), AC5: `[AC5]`, `resume`, a reduced tree, the writer re-dispatched, and `install code` recording its fingerprint.
- [ ] [T-606] AC6: RS3c, RS3d and the BUG-092 block pass unchanged (T-203, T-401).
- [ ] [T-607] `tests/installer/commands-parity.test.js` (Task 3), AC7: the four `[BUG-099]` rows and the byte-identical mirror row.
- [ ] [T-608] AC8 has no test row: no test reads the README's Guard 5 paragraph, so T-306 checks it by diff. AC9: `npm test` (T-401). No E2E/UI test, since there is no UI. CI legs: no new test is conditionally skipped, so no leg's skipped set in `tools/skip-baseline.json` changes.

## Commit Order

1. Task 0 (T-004): this plan and its `.gitignore` leaf.
2. Task 4 (T-405): the tests, the script, the four command copies, the README and the plan ticks for T-101 to T-403 go in one commit, so no commit has a red suite. The red runs (T-102, T-302) happen in the working tree before each fix. The ticks for T-404, T-405 and the Test List ride the closeout commit.

## Identified Risks

- **`install qa` writes its change list before the check.** `changeNote` (`:770-778`) writes or removes `.conductor/change-files.txt` before the size check, so a `qa` install that halts on the bound leaves a fresh change list behind. Accepted: the file is under `.conductor/`, not part of the run or the envelope, the next `install qa` rewrites it, and a `qa` install adds no fingerprint, so it halts only on a run that a checked hand-back already left within a few bytes of the bound.
- **The padding goes past the 64 KiB SNAP cap.** The `padRun` helper grows a stored SNAP past what `handback` would accept. Measured: `install` does not re-validate stored SNAPs, so the padding counts only as bytes. If a later change re-validates them, the rows fail loudly at `padRun`'s first install, not silently.
- **A fixture size that drifts.** The rows depend on 200 files (about 18 KB) crossing 8 KiB of room and 20 files (about 2 KB) staying under it. Both margins are more than twice the room, so a few bytes of change in the run's shape do not flip a row. The exact count 202 in the message regex pins the fingerprint's contents, so a change to the fingerprint's exclusions fails `[AC1]` by name.
- **A halt between the two writes.** `writeAtomic` of the envelope can still fail on disk after the check (as today). The check removes only the size cause, and a disk error is reported as it is today.
- **The long suite timing out the shell.** T-401 notes the duration. A timeout is not a red.
