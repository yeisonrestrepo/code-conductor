# BUG-076 review-loop outcome not bound to the document being approved implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** `approve` and `delegate` at the spec and plan approvals refuse `ORCH_REVIEW_DOC_MISMATCH` when the role's review loop closed `clean`, `cap` or `unchanged` over a hash other than the document being approved; `review <role> --round <doc>` refuses `ORCH_REVIEW_OUT_OF_SCOPE` for a document outside the role's pinned docs folder; and a reviewed loop may be closed once more as `review <role> --close skipped:<reason>`, the recorded recovery after an edit.

**Spec:** `docs/superpowers/specs/2026-11-14-bug076-review-loop-outcome-not-bound-to-the-document-design.md` (approved 2026-11-14, sha256 `a878808b52d4219d9c6f98b82f4bbe62f26087095d5eeee58d2caf68d178f41a`). Issue #195.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>` and `-t <pattern>`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines stay untouched.
- No new dependency, no network, no workflow change, no hook, installer, SNAP-script or settings change. `scripts/orchestrate.mjs` and `cc-orchestrate.md` are not protected surfaces CONTRIBUTING names; no ritual applies.
- No change to the run-file schema or `isValidRun` (spec, System Impact).
- Functions of 30 lines or fewer, guard clauses, comments say why.
- Mirrors stay byte-identical: `.claude/commands/cc-orchestrate.md` = `project-template/.claude/commands/cc-orchestrate.md`. Every edit to one is made identically to the other in the same task.
- Tests are added, none skipped and none conditional, so `tools/skip-baseline.json` is untouched.
- Every file this plan edits is already tracked, so every staging step is `git add -u <path>` with an explicit path; only Task 0 stages a new file.

## Plan decisions

The spec leaves these to the plan, or they follow from reading the code it cites.

1. **One regex for the reviewed outcomes.** `REVIEWED_OUTCOME = /^(clean|cap|unchanged)$/`, next to `SKIP_OUTCOME` (`scripts/orchestrate.mjs:51`). `checkLoopClosed` binds only these (D2), and `review` re-closes only these (D4). Testing the outcome against this list, not "anything but a skip", keeps a hand-edited outcome that `REVIEW_OUTCOME` rejects from opening the re-close.
2. **`checkLoopClosed(run, what, rel, sha256)`.** The refusal text names the document and its hash, so the function takes both. `approve` and `delegateDefine` move their `documentHash` line above the call; the hash is computed from the same `content` the stale check uses (D3), so the order of refusals is `ORCH_REVIEW_OPEN`, `ORCH_REVIEW_DOC_MISMATCH`, `ORCH_DOC_HASH_STALE`, as the spec fixes. The `none` in the message is `loop.sha256 ?? 'none'`.
3. **`docsFolder(run, kind)`** is the expression `handedBackDoc` uses today (`scripts/orchestrate.mjs:989`), lifted into a one-line helper above it; `handedBackDoc` then calls it (D5). `review` passes `docsFolder(run, role)` to `openRound` as a new `folder` parameter before `model`, because `openRound` does not receive the run.
4. **Where the scope check sits in `openRound`.** After the existing round-await and `ORCH_REVIEW_CAP` checks and after `readDoc`, so R3, R17 and R18 keep their messages (D5), and before `documentHash`. An empty folder refuses (fail closed) and prints `none`. The check is `rel.startsWith(folder)`: the folder ends in `/` (`docScopes` writes `<dir>[/<group>]/**`), so `docs/specs-old/…` never matches `docs/specs/`.
5. **The re-close in `review`.** The `does not reopen` guard (`scripts/orchestrate.mjs:1233`) becomes `if (loop.outcome && !(flag === '--close' && REVIEWED_OUTCOME.test(loop.outcome)))`. `reviewWellFormed` already limits `--close` to a `SKIP_OUTCOME` argument, and the existing close branch, `closedLoop(loop, arg)`, keeps `round` and `sha256` and prints `review <role> closed <arg> at round <n>`; `clearReviewDir` already runs on every close. No other line of `review` changes. After a re-close the outcome is a skip, so R16's refusal holds for every form.
6. **`ORCH_REVIEW_OUT_OF_SCOPE` in the command text.** The loop already fails open on any `review` refusal with `skipped:verb` (`cc-orchestrate.md:109`). That line gains the new code next to `ORCH_REVIEW_DOC_MOVED`, so the recovery is named; no new reason is added.
7. **No existing fixture changes.** Every test outside `review loop over review files [FEAT-058]` closes its loops with `skipLoop` (`skipped:fixture`), which stays unbound. Inside that block, M1 and P3 approve the hash the loop closed over, and every `--round` uses `SPEC` or `PLAN`, which sit under the fixture's pinned `docs/specs/` and `docs/plans/` (`DEFAULT_PAIR`). Measured by `grep -n "CLEAN'\|'unchanged'\|closed clean\|review: {"` over `tests/scripts/orchestrate.test.js`: no match after line 1035.

## Baseline (measured on this branch, HEAD e98b4c9, before Task 1)

`npx vitest run tests/installer/commands-parity.test.js`: 89 passed. `npx vitest run tests/scripts/orchestrate.test.js`: 601 passed.

Line numbers below are from HEAD e98b4c9; locate by the quoted text if they move.

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-14-bug076-review-loop-outcome-not-bound-to-the-document.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file. No dependency.
- [X] [T-002] `.gitignore`: add the leaf `!/docs/superpowers/plans/2026-11-14-bug076-review-loop-outcome-not-bound-to-the-document.md` in sorted position, right after `!/docs/superpowers/plans/2026-11-13-feat061-role-agents-dispatched-by-phase-commands.md` and before `!/docs/superpowers/plans/2026-11-14-feat053-per-role-model-selection-for-role-agents-with.md`. Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` and `git add -f docs/superpowers/plans/2026-11-14-bug076-review-loop-outcome-not-bound-to-the-document.md` (new file at a tracked surface; `-f` on one explicit path, per the CLAUDE.md staging convention). Depends on T-002.
- [X] [T-004] Commit: `docs: plan for binding the review-loop outcome to the approved document [BUG-076]`. Depends on T-003.

---

### Task 1: The binding, the scope and the re-close in `orchestrate.mjs`

**Files:**
- Modify: `tests/scripts/orchestrate.test.js`
- Modify: `scripts/orchestrate.mjs`

- [X] [T-101] `tests/scripts/orchestrate.test.js`: insert a new `describe('review binding [BUG-076]', …)` right after the closing `});` of `describe('review loop over review files [FEAT-058]', …)` (line 1034) and before `describe('doc locations [FEAT-047]', …)`. It uses the file-level helpers `openFirst`, `reviseTo`, `writeReview`, `putDoc`, `loop`, `runText`, `docOf`, `reviewPath`, `approveArgs`, `awaiting`, `ROW` and `TWO_TASKS`. Depends on T-004.
  ```js
  describe('review binding [BUG-076]', () => {
    const EDITED = '# Demo spec, edited\n';
    const MORE_PLAN = `${TWO_TASKS}\nOne more line.\n`;
    // Closes the spec loop with `outcome` through the verb's own reads; returns the hash it closed over.
    function closeSpec(outcome) {
      openFirst('spec');
      if (outcome === 'clean') { writeReview('spec', 1, 'CLEAN'); orch(['review', 'spec', '--record']); }
      if (outcome === 'unchanged') reviseTo('spec', 1, '# Demo spec\n');
      if (outcome === 'cap') {
        reviseTo('spec', 1, '# Demo spec, v2\n');
        reviseTo('spec', 2, '# Demo spec, v3\n');
        writeReview('spec', 3, 'OPEN 1', [ROW]);
        orch(['review', 'spec', '--record']);
      }
      expect(loop('spec').outcome).toBe(outcome);
      return loop('spec').sha256;
    }
    const mismatch = (kind, outcome, closed) => `orchestrate: ORCH_REVIEW_DOC_MISMATCH: review ${kind} closed ${outcome} over sha256 ${closed}, not ${docOf(kind)} at ${sha(docOf(kind))}; close it with review ${kind} --close skipped:<reason>, then show the approval again`;
    const outOfScope = (rel, role, folder) => `orchestrate: ORCH_REVIEW_OUT_OF_SCOPE: ${rel} is not under the ${role} docs folder ${folder}`;
    const seedScopes = (edit) => { const run = runFile(); runFileText(JSON.stringify({ ...run, docs: { ...run.docs, scopes: edit(run.docs.scopes) } })); };
    const ROUNDS = { clean: 1, unchanged: 2, cap: 3 };
    // ...tests B1-B12 below
  });
  ```
  Tests:
  - B1 `it.each(['clean', 'cap', 'unchanged'])` **"B1 approve spec refuses ORCH_REVIEW_DOC_MISMATCH after a %s close over another hash, writing nothing"**: `const closed = closeSpec(outcome)`; `putDoc('spec', EDITED)`; `const before = runText()`; `orch(['approve', 'spec', SPEC, sha(SPEC)])` toMatchObject `{ status: 2, err: mismatch('spec', outcome, closed) }`; `runText()` is `before`.
  - B2 **"B2 approve plan refuses ORCH_REVIEW_DOC_MISMATCH after a clean close over another hash, writing nothing"**: `openFirst('plan')`; `writeReview('plan', 1, 'CLEAN')`; `orch(['review', 'plan', '--record'])`; `const closed = loop('plan').sha256`; `putDoc('plan', MORE_PLAN)`; `const before = runText()`; `orch(['approve', 'plan', PLAN, sha(PLAN)])` toMatchObject `{ status: 2, err: mismatch('plan', 'clean', closed) }`; `runText()` is `before`; `runFile().gate` is not `'define_approved'`.
  - B3 `it.each(['clean', 'cap', 'unchanged'])` **"B3 approve spec passes after a %s close when the document still hashes the loop sha256"**: `const closed = closeSpec(outcome)`; `orch(['approve', 'spec', SPEC, sha(SPEC)]).status` 0; `runFile().approvals.spec.sha256` is `closed`.
  - B4 **"B4 approve plan passes after a clean close when only a task box was ticked"**: `openFirst('plan')`; `writeReview('plan', 1, 'CLEAN')`; `orch(['review', 'plan', '--record'])`; `const closed = loop('plan').sha256`; `putDoc('plan', TWO_TASKS.replace('- [ ] **Step 1', '- [X] **Step 1'))`; `sha(PLAN)` is not `closed`; `orch(['approve', 'plan', PLAN, closed]).status` 0.
  - B5 **"B5 a clean loop with no recorded hash refuses as over sha256 none, writing nothing"**: `awaiting('spec')`; `putDoc('spec', '# Demo spec\n')`; `runFileText(JSON.stringify({ ...runFile(), review: { spec: { round: 1, outcome: 'clean', sha256: null } } }))`; `const before = runText()`; `orch(['approve', 'spec', SPEC, sha(SPEC)])` toMatchObject `{ status: 2, err: mismatch('spec', 'clean', 'none') }`; `runText()` is `before`.
  - B6 `it.each([['before any round', () => { awaiting('spec'); }], ['after round 1', () => { openFirst('spec'); }]])` **"B6 a skip %s never binds the approval"**: `open()`; `orch(['review', 'spec', '--close', 'skipped:owner']).status` 0; `putDoc('spec', EDITED)`; `orch(['approve', 'spec', SPEC, sha(SPEC)]).status` 0.
  - B7 `it.each([['spec', 'docs/notes.md'], ['spec', 'docs/specs-old/demo-design.md'], ['plan', SPEC]])` **"B7 %s --round refuses %s outside its docs folder, writing no loop"**: `awaiting(role)`; `mkdirSync(dirname(join(root, rel)), { recursive: true })`; `writeFileSync(join(root, rel), '# Elsewhere\n')`; `const before = runText()`; `orch(['review', role, '--round', rel])` toMatchObject `{ status: 2, err: outOfScope(rel, role, `${dirname(docOf(role))}/`) }`; `runText()` is `before`; `loop(role)` is undefined.
  - B8 `it.each([['an empty spec scope', (s) => ({ ...s, spec: [] })], ['no spec scope', ({ spec, ...rest }) => rest]])` **"B8 --round refuses any path with %s"**: `awaiting('spec')`; `putDoc('spec', '# Demo spec\n')`; `seedScopes(edit)`; `const before = runText()`; `orch(['review', 'spec', '--round', SPEC])` toMatchObject `{ status: 2, err: outOfScope(SPEC, 'spec', 'none') }`; `runText()` is `before`.
  - B9 **"B9 a grouped scope refuses a document of the docs folder outside the group"**: `awaiting('spec')`; `putDoc('spec', '# Demo spec\n')`; `seedScopes((s) => ({ ...s, spec: ['docs/specs/pillar-3/**'] }))`; `orch(['review', 'spec', '--round', SPEC])` toMatchObject `{ status: 2, err: outOfScope(SPEC, 'spec', 'docs/specs/pillar-3/') }`; `loop('spec')` is undefined.
  - B10 `it.each(['clean', 'cap', 'unchanged'])` **"B10 re-closes a %s loop as skipped:doc-changed with its round and hash, then approves the edited document"**: `const closed = closeSpec(outcome)`; `putDoc('spec', EDITED)`; `mkdirSync(join(root, REVIEW_DIR), { recursive: true })`; `writeFileSync(join(root, reviewPath('spec', 9)), 'stray\n')`; `orch(['review', 'spec', '--close', 'skipped:doc-changed'])` toMatchObject `{ status: 0, out: `review spec closed skipped:doc-changed at round ${ROUNDS[outcome]}` }`; `loop('spec')` toEqual `{ round: ROUNDS[outcome], outcome: 'skipped:doc-changed', sha256: closed }`; `existsSync(join(root, REVIEW_DIR))` false; `orch(['approve', 'spec', SPEC, sha(SPEC)])` toMatchObject `{ status: 0, out: `spec approved: sha256 ${sha(SPEC)}` }`.
  - B11 **"B11 a re-closed loop refuses every form"**: `closeSpec('clean')`; `orch(['review', 'spec', '--close', 'skipped:doc-changed']).status` 0; for each `args` of `[['--round', SPEC], ['--record'], ['--close', 'skipped:verb']]`, `orch(['review', 'spec', ...args])` toMatchObject `{ status: 2, err: 'orchestrate: review spec: the loop closed skipped:doc-changed; a closed loop does not reopen' }`.
  - B12 **"B12 a reviewed loop still refuses --round and --record"**: `closeSpec('clean')`; for each `args` of `[['--round', SPEC], ['--record']]`, `orch(['review', 'spec', ...args])` toMatchObject `{ status: 2, err: 'orchestrate: review spec: the loop closed clean; a closed loop does not reopen' }`; `loop('spec').outcome` is `'clean'`.
- [X] [T-102] `tests/scripts/orchestrate.test.js`: inside `describe('unattended mode [FEAT-054]', …)`, after the last test (`U39 [AC4b] resume keeps an attended run attended`) and before the describe's closing `});`, add the delegate case (it uses that block's `atSpec`, `delegateDoc`, `docSay`, `putReport`, `report` and `runBytes`). Depends on T-101.
  - U40 `it.each(['spec', 'plan'])` **"U40 [BUG-076] delegate %s refuses ORCH_REVIEW_DOC_MISMATCH over a clean loop of another hash, leaving delegated unset"**:
    ```js
    if (kind === 'spec') atSpec({ loop: false });
    else {
      atSpec();
      expect(delegateDoc('spec').status).toBe(0);
      expect(orch(['install', 'plan']).status).toBe(0);
      expect(orch(['handback', 'plan'], { input: docSay('plan', PLAN) }).status).toBe(0);
    }
    expect(orch(['review', kind, '--round', docOf(kind)]).status).toBe(0);
    writeReview(kind, 1, 'CLEAN');
    expect(orch(['review', kind, '--record']).status).toBe(0);
    const closed = loop(kind).sha256;
    putDoc(kind, kind === 'spec' ? '# Demo spec, edited\n' : `${TWO_TASKS}\nOne more line.\n`);
    putReport(kind, report(kind, sha(docOf(kind))));
    const before = runBytes();
    expect(orch(['delegate', kind, docOf(kind), sha(docOf(kind))])).toMatchObject({
      status: 2,
      err: `orchestrate: ORCH_REVIEW_DOC_MISMATCH: review ${kind} closed clean over sha256 ${closed}, not ${docOf(kind)} at ${sha(docOf(kind))}; close it with review ${kind} --close skipped:<reason>, then show the approval again`,
    });
    expect(runBytes()).toBe(before);
    expect(runFile().delegated?.[kind]).toBeUndefined();
    ```
- [X] [T-103] Red step: `npx vitest run tests/scripts/orchestrate.test.js -t "BUG-076"`. No existing test name contains `BUG-076` (measured by `grep -n "BUG-076" tests/scripts/orchestrate.test.js` before T-101: no match), so the predicted full match set is the 24 new tests: B1 ×3, B2, B3 ×3, B4, B5, B6 ×2, B7 ×3, B8 ×2, B9, B10 ×3, B11, B12, U40 ×2. **Red, 17:** B1 ×3, B2 and B5 (the approval succeeds today, exit 0), B7 ×3, B8 ×2 and B9 (the round opens today), B10 ×3 and B11 (the re-close refuses `does not reopen` today), U40 ×2 (the delegated review approves today). **Green, 7:** B3 ×3, B4, B6 ×2 and B12 (behavior this item keeps). Every other test is filtered out. Depends on T-102.
- [X] [T-104] `scripts/orchestrate.mjs`, after `const SKIP_OUTCOME = /^skipped:[a-z][a-z0-9-]{0,39}$/;` (line 51) add (plan decision 1): Depends on T-103.
  ```js
  // BUG-076: the outcomes that claim a reviewer read the bytes; only these bind the approval and may close again as a skip.
  const REVIEWED_OUTCOME = /^(clean|cap|unchanged)$/;
  ```
- [X] [T-105] `scripts/orchestrate.mjs`, `checkLoopClosed` (line 955) and its two callers (plan decision 2). Depends on T-104.
  - Replace the function, its FEAT-058 comment kept, with:
    ```js
    // FEAT-058: a skip stays possible but is never silent, so approve waits for a recorded outcome.
    // BUG-076: and a reviewed outcome stands only for the bytes the reviewer read; a skip claims no review (D2).
    function checkLoopClosed(run, what, rel, sha256) {
      const loop = isPlainObject(run.review) ? run.review[what] : undefined;
      if (!isPlainObject(loop) || !REVIEW_OUTCOME.test(loop.outcome ?? '')) {
        const state = isPlainObject(loop) && Number.isInteger(loop.round) ? `open at round ${loop.round}` : 'not run';
        throw new Refusal(`ORCH_REVIEW_OPEN: review ${what} is ${state}; close it before the approval`);
      }
      if (!REVIEWED_OUTCOME.test(loop.outcome) || loop.sha256 === sha256) return;
      throw new Refusal(`ORCH_REVIEW_DOC_MISMATCH: review ${what} closed ${loop.outcome} over sha256 ${loop.sha256 ?? 'none'}, not ${rel} at ${sha256}; close it with review ${what} --close skipped:<reason>, then show the approval again`);
    }
    ```
  - `approve` (lines 932-933): swap the two lines into `const sha256 = documentHash(what, content);` then `checkLoopClosed(run, what, rel, sha256);`.
  - `delegateDefine` (lines 1067-1068): the same swap, `const sha256 = documentHash(kind, content);` then `checkLoopClosed(run, kind, rel, sha256);`.
- [X] [T-106] `scripts/orchestrate.mjs`, the docs-folder helper (plan decision 3). Depends on T-105.
  - Above the comment `// The document the Define role named in its hand-back, …` (line 987) add:
    ```js
    // The role's pinned docs folder (FEAT-047): its scope glob without the trailing **, or '' when none was pinned.
    const docsFolder = (run, kind) => String(run.docs?.scopes?.[kind]?.[0] ?? '').replace(/\*\*$/, '');
    ```
  - `handedBackDoc` (line 989): `const folder = String(run.docs?.scopes?.[kind]?.[0] ?? '').replace(/\*\*$/, '');` → `const folder = docsFolder(run, kind);`.
- [X] [T-107] `scripts/orchestrate.mjs`, `review` and `openRound` (plan decisions 4 and 5). Depends on T-106.
  - `review` (line 1233): replace `if (loop.outcome) throw new Refusal(…does not reopen…);` with
    ```js
    // BUG-076: a reviewed loop may close once more as a skip, so an edit after it is on the record (D4).
    if (loop.outcome && !(flag === '--close' && REVIEWED_OUTCOME.test(loop.outcome))) throw new Refusal(`review ${role}: the loop closed ${loop.outcome}; a closed loop does not reopen`);
    ```
  - `review` (line 1234): `openRound(root, role, loop, arg, modelSegment(run, 'define-review'))` → `openRound(root, role, loop, arg, docsFolder(run, role), modelSegment(run, 'define-review'))`.
  - `openRound` (line 1246): signature `function openRound(root, role, loop, rel, folder, model)`; replace `const sha256 = documentHash(role, readDoc(root, rel, REVIEW_USAGE));` with
    ```js
    const bytes = readDoc(root, rel, REVIEW_USAGE);
    // BUG-076: after readDoc's own checks, so a bad path keeps its message; an unpinned folder refuses every path (D5).
    if (folder === '' || !rel.startsWith(folder)) throw new Refusal(`ORCH_REVIEW_OUT_OF_SCOPE: ${rel} is not under the ${role} docs folder ${folder || 'none'}`);
    const sha256 = documentHash(role, bytes);
    ```
  - `review` grows from 17 to 18 lines and `openRound` from 13 to 16, both under 30.
- [X] [T-108] Green step: `npx vitest run tests/scripts/orchestrate.test.js -t "BUG-076"`. Predicted: the same 24 tests, all **green**. Then `npx vitest run tests/scripts/orchestrate.test.js`: 625 passed (601 + 24), with R16, R18, R20, M1, P1-P3, U27, U29 and every `skipLoop` fixture unchanged and green. Depends on T-107.
- [X] [T-109] Stage: `git add -u scripts/orchestrate.mjs`, `git add -u tests/scripts/orchestrate.test.js`, `git add -u docs/superpowers/plans/2026-11-14-bug076-review-loop-outcome-not-bound-to-the-document.md`. Depends on T-108.
- [X] [T-110] Commit: `fix: bind the review-loop outcome to the approved document and scope its rounds [BUG-076]`. Depends on T-109.

---

### Task 2: `cc-orchestrate.md` names the mismatch and its recovery

**Files:**
- Modify: `tests/installer/commands-parity.test.js`
- Modify: `.claude/commands/cc-orchestrate.md`
- Modify: `project-template/.claude/commands/cc-orchestrate.md`

- [X] [T-201] `tests/installer/commands-parity.test.js`: inside `describe('cc-orchestrate review loop [FEAT-041 AC5, AC6, FEAT-058]', …)`, after the test `fails open with named reasons, never halts, and records every skip before the approval` (lines 378-383), add: Depends on T-110.
  ```js
  it.each(ORCH_MIRRORS)('[BUG-076] %s names the document mismatch, its recovery and the out-of-scope round', (rel) => {
    const t = read(rel);
    for (const p of ['On `ORCH_REVIEW_DOC_MISMATCH`, a refusal that writes nothing,', 'run `review <role> --close skipped:doc-changed`',
      '(`ORCH_NOT_UNATTENDED`, `ORCH_REVIEW_OPEN`, `ORCH_REVIEW_DOC_MISMATCH`, `ORCH_DOC_HASH_STALE`,',
      '`ORCH_REVIEW_DOC_MOVED` and `ORCH_REVIEW_OUT_OF_SCOPE` included.']) expect(t).toContain(p);
  });
  ```
- [X] [T-202] Red step: `npx vitest run tests/installer/commands-parity.test.js -t "BUG-076"`. Predicted full match set: the 2 new rows, both **red** (neither mirror holds the phrases). Every other test is filtered out. Depends on T-201.
- [X] [T-203] `.claude/commands/cc-orchestrate.md` and, identically, `project-template/.claude/commands/cc-orchestrate.md`. Depends on T-202.
  - After the bullet that starts `   - **The loop must be closed.** On \`ORCH_REVIEW_OPEN\`` (line 74) and before the bullet `   - **The script checks the hash.**` (line 75), insert one bullet with the same three-space indent:
    `   - **The review must cover the document.** On \`ORCH_REVIEW_DOC_MISMATCH\`, a refusal that writes nothing, the loop closed \`clean\`, \`cap\` or \`unchanged\` over other bytes than the document you are approving, usually because it was edited after the loop: run \`review <role> --close skipped:doc-changed\`, then show the approval again with the skip notice and the document's new hash.`
  - The unattended bullet (line 78): `(\`ORCH_NOT_UNATTENDED\`, \`ORCH_REVIEW_OPEN\`, \`ORCH_DOC_HASH_STALE\`,` → `(\`ORCH_NOT_UNATTENDED\`, \`ORCH_REVIEW_OPEN\`, \`ORCH_REVIEW_DOC_MISMATCH\`, \`ORCH_DOC_HASH_STALE\`,`.
  - The fail-open reason (line 109): `` - `verb`: the `review` verb refuses or errors otherwise, `ORCH_REVIEW_DOC_MOVED` included. `` → `` - `verb`: the `review` verb refuses or errors otherwise, `ORCH_REVIEW_DOC_MOVED` and `ORCH_REVIEW_OUT_OF_SCOPE` included. `` (plan decision 6).
  - Then `cmp .claude/commands/cc-orchestrate.md project-template/.claude/commands/cc-orchestrate.md` exits 0.
- [X] [T-204] Green step: `npx vitest run tests/installer/commands-parity.test.js`. Predicted: 91 passed (89 + 2), the mirror-identity test (line 201) and the fail-open reasons test (lines 378-383) included. Depends on T-203.
- [X] [T-205] Stage: `git add -u .claude/commands/cc-orchestrate.md`, `git add -u project-template/.claude/commands/cc-orchestrate.md`, `git add -u tests/installer/commands-parity.test.js`, `git add -u docs/superpowers/plans/2026-11-14-bug076-review-loop-outcome-not-bound-to-the-document.md`. Depends on T-204.
- [X] [T-206] Commit: `docs: cc-orchestrate names the review mismatch and its recorded recovery [BUG-076]`. Depends on T-205.

---

### Task 3: Full suite and closeout

**Files:**
- Modify: `docs/superpowers/plans/2026-11-14-bug076-review-loop-outcome-not-bound-to-the-document.md`

- [X] [T-301] Run `npm test`. Predicted: exit 0, every file green, 26 tests more than the pre-change suite (24 in `orchestrate.test.js`, 2 in `commands-parity.test.js`; no existing test edited), no new skip. Depends on T-206.
- [X] [T-302] Grep checks: `git grep -n "checkLoopClosed(" -- scripts` shows the definition and exactly two calls, each with four arguments; `cmp .claude/commands/cc-orchestrate.md project-template/.claude/commands/cc-orchestrate.md` exits 0; `git diff --stat origin/main -- VERSION package.json package-lock.json CHANGELOG.md "AGENT-READABLE BACKLOG.md" README.md .claude/memory .claude/hooks project-template/.claude/hooks .github/workflows .github/actions` prints nothing. Depends on T-301.
- [X] [T-303] Stage: `git add -u docs/superpowers/plans/2026-11-14-bug076-review-loop-outcome-not-bound-to-the-document.md` (ticks T-206 to T-302). Depends on T-302.
- [X] [T-304] Commit: `docs: close out the BUG-076 plan [BUG-076]`. Depends on T-303.

---

## Test List

- [X] Integration, AC1 (approve binds the hash): B1 (`clean`, `cap`, `unchanged` for spec), B2 (plan), B5 (a `clean` loop with no hash); each leaves the run file byte-identical.
- [X] Integration, AC2 (delegate binds the hash): U40 for spec and plan, run file byte-identical and `delegated.<kind>` unset.
- [X] Integration, AC3 (a match still passes): B3 (all three outcomes), B4 (ticked plan box), M1 and P3 unchanged.
- [X] Integration, AC4 (a skip stays unbound): B6 (before and after a round), P3 `skipped:owner`, R20 and every `skipLoop` fixture unchanged.
- [X] Integration, AC5 (scoped round): B7 (outside the folder, a prefix look-alike, the other role's folder), B8 (empty and missing scope), B9 (grouped scope); R18's three messages unchanged.
- [X] Integration, AC6 (re-close): B10 (record, `.conductor/review/` removed, approval of the edited document), B11 and R16 (a skipped loop refuses every form), B12 (a reviewed loop still refuses `--round` and `--record`).
- [X] Command pin, AC7: the BUG-076 rows in `commands-parity.test.js` for both mirrors, and the existing mirror-identity test.
- [X] AC8: `npm test` green (T-301).
- [X] No E2E/UI test: there is no UI.

## Commit Order

0. Task 0 — the plan and its `.gitignore` leaf (done by this session's commit).
1. Task 1 — the three `orchestrate.mjs` changes with their tests, one commit; the suite is green at it.
2. Task 2 — both `cc-orchestrate.md` copies and their pin, one commit, so the mirror test never sees one copy changed.
3. Task 3 — closeout of the plan ticks. The ticks of T-303 and T-304 are made after the last commit and ride whichever commit next stages this plan.

## Identified Risks

- **A fixture that closes a loop and then edits the document.** Plan decision 7 measured none outside the FEAT-058 block, and that block approves the hash it closed over. If one was missed, it fails in T-108's full-file run with `ORCH_REVIEW_DOC_MISMATCH` in its message, naming the fixture rather than this change.
- **B8 edits `docs.scopes` in place.** `isValidRun` does not read `docs` (`scripts/orchestrate.mjs:145-175` has no `docs` term), and at the `await spec` step only `install` reads the scopes (line 491), so the edited run stays live and `review` reaches `openRound`. If `liveRun` ever validated `docs`, B8 would fail by its refusal text, loudly.
- **The `cap` path in `closeSpec`.** It needs three rounds over three distinct documents: `reviseTo` writes `OPEN 1` with one row, records it and opens the next round over the new text. The third `--record` closes `cap` because `loop.round >= REVIEW_CAP`. `expect(loop('spec').outcome).toBe(outcome)` inside the helper fails at the helper, not at the assertion under test, if the drive goes wrong.
- **Windows-style paths.** A `rel` written with `\` does not start with the `/` folder and refuses out of scope. `handedBackDoc` already compares the same way, and the command text passes the `ops.f` path, which is `/`-separated, so this is consistent and fails closed.
- **Behavior change for users** (spec, System Impact): an approval after an edit made after the loop now needs one `review <role> --close skipped:doc-changed`. The command text names it (Task 2), and the refusal itself names the verb to run.
- **Mirror drift.** Each `cc-orchestrate.md` edit is made twice; the byte-identical test fails on any difference.
- **Line numbers drift.** References are from HEAD e98b4c9; locate by the quoted text if they move.
