# FEAT-041 Reviewer-in-Loop for the Define Band Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native tasks). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before each define approval in `/cc-orchestrate`, run an advisory review loop: a fresh read-only `define-review` agent checks the spec or plan against a declared checklist, the handed-back generator revises through `SendMessage`, at most 3 reviewer passes and 2 revisions, fail-open, and the owner's approval is never automated. Ship as `1.39.0`.

**Architecture:**
- **`scripts/orchestrate.mjs`** gains one verb, `review <spec|plan> --round | --close <outcome>`, an optional `review` run field, `REVIEW_DIR` cleared with the run, and `ORCH_REVIEW_CAP` as a refusal (rc 2), never a halt.
- **`define-review`** (new profile, both agent mirrors), `tools: Read, Grep, Glob`. It is not in `ROLES` or `BAND_ROLES`, hands back no SNAP line and certifies no gate.
- **`/cc-orchestrate`** (both mirrors, byte-identical) carries the loop, both briefs, the checklist, the delivery-channel rule, fail-open, the amended brief line, and the boundary additions.
- **`project-template/.claude/review-loop.settings.json`** ships the owner-approved auto mode exception. `README.md` declares the three configurations and their costs.

**Tech Stack:** Node >= 20 ESM, zero-dependency scripts, vitest.

**Spec:** `docs/superpowers/specs/2026-10-06-feat041-reviewer-in-loop-design.md`, APPROVED 2026-10-06 (`f4ed518`, sha256 `bd0e396abb157d224ce59650f6a6856ac533fb7acdbbef0677537ca3734bc2fd`).

## Global Constraints

- **Release:** `1.39.0`, a minor release. Branch `feat/feat-041-reviewer-in-loop`.
- **Cap, verbatim:** `REVIEW_CAP = 3` reviewer passes, so at most 2 revisions. The single new code is `ORCH_REVIEW_CAP`, and it is a refusal. No other code is minted.
- **Verdict lines, verbatim:**
  - `REVIEW <role> round <n>: CLEAN`
  - `REVIEW <role> round <n>: OPEN <k>`
  - `REVISION <role> round <n>: done`
  - `REVISION <role> round <n>: blocked <reason>`
- **Unchanged, asserted in T-005:**
  - `.claude/hooks/pre-tool-use.mjs` and its mirror (Guards 5, 6 and 7);
  - `scripts/snap-contract.mjs` (`ROLES`), `snap-validate.mjs` and `snap-build.mjs`;
  - the five role profiles in both mirrors (the 1.37.0 sha256 pins);
  - `lib/installer/*`;
  - `package.json` `dependencies`.
- **The exception text** is byte-identical to the owner-approved wording of 2026-10-06. The file's sha256 is `05ce114dfb80f28eedc7e3537092356b6bea1c7ba68afe9ae2316212b75e6d4c` (582 bytes, measured at plan time from `PROBE-C.md:29` through real shell quoting).
- **Never global:** nothing writes `autoMode` into `~/.claude/settings.json` or `.claude/settings.json`.
- **Baseline:** this item adds passing tests only, so `tools/skip-baseline.json` does not change.
- **Staging:**
  - `git add -u <path>` for a tracked file.
  - Plain `git add <path>` for a new file outside an ignored directory (`tests/`, `project-template/`).
  - A new file under `/.claude/*` or `/docs/*`: its leaf joins the `.gitignore` block first, then plain `git add`.
  - Never a bare `git add -u`.
  - Every task's staging line names this plan file (`[BUG-054]` interim rule).
- **Interim constraints, binding on every task:**
  - never run the installer in this repository (`[BUG-052]`); the T-004 tests deploy only into temp dirs;
  - never run the pre-commit test gate from a linked worktree, so no `isolation: "worktree"` (`[BUG-053]`);
  - run conductor scripts from source `scripts/` (`[BUG-051]`).
- **Never start an `orchestrate.mjs` run or invoke `/cc-orchestrate` in this repository.** Every router call runs inside a test tmpdir. A live-loop measurement, if wanted, goes to a disposable sandbox install outside the repository, and the owner runs it.
- **Owner-only actions:** the merge and the GitHub Release `v1.39.0`. The agent opens the PR and stops at green.

## Pre-flight analysis (critical-review Phase 1)

**Happy path.** `spec` hands back; the orchestrator opens round 1, dispatches `define-review`, gets `OPEN 2`, revives `spec` with the two rows, gets `REVISION spec round 1: done`, and opens round 2. That reviewer reports `CLEAN`, so the orchestrator closes the loop `clean` and presents the spec with its sha256, the outcome and both verdict lines. It approves only on the owner's message, after re-hashing the spec.

**Failure points.**
- **The classifier denies the revision `SendMessage`** (plain auto mode, measured). The loop closes `skipped:denied` and goes to the boundary. It does not retry and takes no other route.
- **The revision report arrives twice**, as a message and as a hand-back frame (measured). The loop takes the first delivery and ignores later copies. It never routes a revision report into `handback`, where it would halt with `ORCH_HANDBACK_CONFLICT` (`orchestrate.mjs:297`).
- **The persistent envelope lets the generator edit after presentation.** Re-hashing before `approve` catches it.
- **`cli` destructures only `[verb, a, b]`** (`orchestrate.mjs:398`), so `--close <outcome>` would lose its value. The verb takes `argv.slice(1)`.
- **A malformed `review` field.** `isValidRun` does not check it (it is optional), so `{ ...run.review }` on a string would spread characters. The verb reads it only through `isPlainObject`.
- **Stale reports colliding across runs** (`spec-1-review.txt`). `clearRunFiles` removes `REVIEW_DIR` on `end` and on a stale-run `start`.
- **A halted run.** `liveRun` refuses the verb; the loop treats that as an error and fails open. The run's own halt handling is unchanged.

**Boundary conditions.**
- `--close` at round 0: `skipped:*` is accepted (the verb erred before any pass), `clean` is refused, and `cap` is refused below round 3.
- Round 3 then `--round`: refused with `ORCH_REVIEW_CAP`, `halt` stays `null`.
- Outcome charset: `skipped:<reason>` takes a reason of `[a-z][a-z0-9-]{0,39}`, so an empty, uppercase, spaced or overlong reason is refused.
- Extra argv, a missing flag, or a flag with the wrong arity: refused with the usage line.
- `review plan` while `spec` is awaited, or the reverse: refused, naming the real next step.
- A CRLF checkout of the settings file on Windows: the pin hashes the LF-normalized text, as `role-profiles.test.js` does.
- Re-hashing on hosts without `shasum`: the command names `sha256sum` and PowerShell's `Get-FileHash` beside it.

## Rulings in this plan (each is the owner's to overturn)

1. **The amended brief line keeps its first clause.** The dispatch brief is shared by all five roles. Line 78 becomes "Verify your work before you hand back. Your hand-back is the run's only record. After it, the orchestrator may send you revision requests; answer them as prose, without a `SNAP_HANDBACK` line." The spec's replacement text is verbatim after the kept "Verify your work before you hand back." For `code`, `audit` and `qa` the "may" never fires; scoping the sentence to the spec and plan rows instead would leave line 78's refusal sentence standing, and it contradicts the loop.
2. **The loop lives inside step 3, so nothing is renumbered.** The spec cites "step 6's report", and step 6 stays step 6. Step 3 opens with "Before each, run "The review loop" below for that role." The loop itself is its own section, `## The review loop (FEAT-041)`.
3. **Step 2.6.4 is scoped.** "If a second `SNAP_HANDBACK` from that agent reaches you for the same position" gains ", outside a revision report of the review loop," so O2's `skipped:snap-in-revision` and the existing `ORCH_HANDBACK_CONFLICT` route never meet.
4. **The `skipped:` reason vocabulary** is fixed in the command text: `dispatch`, `unparsed`, `denied`, `blocked`, `snap-in-revision`, `verb`, `owner`. The verb accepts any reason matching the charset; the command names these seven.
5. **The verb's close rules** (the spec says only "records the outcome"): `clean` needs round >= 1; `cap` needs round 3; `skipped:*` is accepted at any round, including 0.
6. **The unbound spec reviewer's source** is "the backlog entry for `<ITEM>`, found with Grep". The spec says "the item's backlog entry" and names no path a host project is guaranteed to have.
7. **Test counts below are predicted, not measured in a scratch clone (ACCEPTED by the owner for this item).** FEAT-031 measured its drafts at plan time; this plan did not. Precisely because of that, the standing halt discipline applies unchanged: any count outside its predicted row halts the task before its commit, whether or not a test failed. A mismatched count with zero failures is a halt like any other, and it comes to the owner for an amendment ruling. A prediction is amended before it is measured, never absorbed after.
8. **Routing: native.** Five serial tasks. T-001's verb is the only code with branching logic, and its tests drive the real CLI.

## Review Focus

1. **A revision report reaching `handback`.** A reasonable owner expects a duplicate revision delivery to be ignored, not to halt the run. Pinned by T-003's channel test (the command text) and by the unchanged `ORCH_HANDBACK_CONFLICT` tests.
2. **A corrupt `review` field in the run file** (a string, an array, a loop without an integer round). Expected: the verb starts that role's loop fresh and never crashes. Pinned in T-001 (`[RF2]`).
3. **The owner typing mid-loop.** Expected: the loop closes `skipped:owner` and the message is the owner's word. Pinned in T-003's fail-open test (the text names `skipped:owner`).
4. **Windows.** A CRLF checkout must not break the sha256 pin, and the re-hash must have a PowerShell form. Pinned in T-004 (normalized hash) and T-003 (`Get-FileHash`).
5. **Approval drift.** A loop outcome or a UI suggestion must never count as approval. Pinned in T-003's boundary test.

---

- [X] [T-000] **Plan commit.** First run the branch gate (`/cc-plan` Phase exit). The current branch is `feat/feat-041-reviewer-in-loop`, which matches the item, so the gate is silent.
  - [X] [T-000-A] Modify `.gitignore`: insert `!/docs/superpowers/plans/2026-10-06-feat041-reviewer-in-loop.md` immediately after `!/docs/superpowers/plans/2026-10-02-feat031-ticket-agent.md` (:108), in sorted position.
  - [X] [T-000-B] Modify `.claude/memory/project.md`: append at the end of the file
    ```markdown

    ## Plan: FEAT-041 implementation [<date>]

    Plan `docs/superpowers/plans/2026-10-06-feat041-reviewer-in-loop.md`.
    - **Approval:** <the owner's approval words and rulings, quoted>.
    - **Shape:** T-001 the `review` verb; T-002 the `define-review` profile; T-003 the `/cc-orchestrate` loop prose; T-004 the shipped settings file and README; T-005 release `1.39.0`.
    - **Predicted, not measured:** 1418 -> 1453 / 0, 49 -> 50 files.
    - **Routing:** native.

    Handoff observations, one line per task:
    ```
  - [X] [T-000-C] `git add -u .gitignore .claude/memory/project.md`, then `git add docs/superpowers/plans/2026-10-06-feat041-reviewer-in-loop.md` (plain, now that its leaf exists).
  - [X] [T-000-D] Commit `docs: add the FEAT-041 reviewer-in-loop implementation plan [FEAT-041]`. Expected: the hook suite passes at **1418 / 0, 49 files**.
  - [X] [T-000-E] Append `- T-000: <one line of handoff observation>` under the plan section. This line rides T-001's commit.

- [X] [T-001] **The `review` verb** (spec (e) round counter; AC2-AC4). Native. Depends on T-000.

  **Files:**
  - Modify: `scripts/orchestrate.mjs`
  - Test: `tests/scripts/orchestrate.test.js`

  **Interfaces:**
  - Produces: `export const REVIEW_DIR = '.conductor/review'`, `export const REVIEW_CAP = 3`; the CLI `review <role> --round` prints `review <role> round <n> of 3`; `review <role> --close <outcome>` prints `review <role> closed <outcome> at round <n>`; the run field `review: { <role>: { round: <int>, outcome: null | 'clean' | 'cap' | 'skipped:<reason>' } }`.
  - Consumes: `liveRun`, `nextStep`, `describeStep`, `saveRun`, `isPlainObject`, `Refusal` (all existing).

  - [X] [T-001-A] **Write the failing tests.** In `tests/scripts/orchestrate.test.js`, add `REVIEW_CAP, REVIEW_DIR` to the import list from `../../scripts/orchestrate.mjs` (alphabetical among the constants, after `ROLE_ARTIFACTS`). Append at the end of the file:
    ```js
    // Drives a fresh run into the await window after `role`'s hand-back, where the loop runs (FEAT-041).
    function awaiting(role) {
      driveTo(role);
      orch(['install', role]);
      orch(['handback', role], { input: say(role, 'boundary_routed') });
    }
    const loop = (role) => runFile().review?.[role];
    const USAGE = 'orchestrate: usage: orchestrate.mjs review <spec|plan> --round | --close <clean|cap|skipped:<reason>>';

    describe('review loop round counter [FEAT-041 AC2-AC4]', () => {
      it('refuses --round outside the await window, writing nothing', () => {
        driveTo('spec');
        const before = readFileSync(join(root, RUN_FILE), 'utf8');
        expect(orch(['review', 'spec', '--round'])).toMatchObject({ status: 2, err: 'orchestrate: review spec: the next step is install spec' });
        expect(readFileSync(join(root, RUN_FILE), 'utf8')).toBe(before);
      });

      it('opens round 1 after the spec hand-back and records it', () => {
        awaiting('spec');
        expect(orch(['review', 'spec', '--round'])).toMatchObject({ status: 0, out: 'review spec round 1 of 3' });
        expect(loop('spec')).toEqual({ round: 1, outcome: null });
      });

      it('refuses a fourth round with ORCH_REVIEW_CAP, a refusal that sets no halt', () => {
        awaiting('spec');
        for (let n = 1; n <= REVIEW_CAP; n++) expect(orch(['review', 'spec', '--round']).out).toBe(`review spec round ${n} of 3`);
        expect(orch(['review', 'spec', '--round'])).toMatchObject({ status: 2, err: 'orchestrate: ORCH_REVIEW_CAP: review spec has run 3 rounds; close it with --close cap' });
        expect(runFile().halt).toBeNull();
        expect(loop('spec')).toEqual({ round: 3, outcome: null });
      });

      it('closes clean, and a closed loop refuses --round and a second --close', () => {
        awaiting('spec');
        orch(['review', 'spec', '--round']);
        expect(orch(['review', 'spec', '--close', 'clean'])).toMatchObject({ status: 0, out: 'review spec closed clean at round 1' });
        for (const args of [['--round'], ['--close', 'cap']]) {
          expect(orch(['review', 'spec', ...args])).toMatchObject({ status: 2, err: 'orchestrate: review spec: the loop closed clean; a closed loop does not reopen' });
        }
        expect(loop('spec')).toEqual({ round: 1, outcome: 'clean' });
      });

      it('accepts cap only at round 3', () => {
        awaiting('spec');
        orch(['review', 'spec', '--round']);
        expect(orch(['review', 'spec', '--close', 'cap'])).toMatchObject({ status: 2, err: 'orchestrate: review spec: cap needs round 3; the loop is at round 1' });
        orch(['review', 'spec', '--round']);
        orch(['review', 'spec', '--round']);
        expect(orch(['review', 'spec', '--close', 'cap'])).toMatchObject({ status: 0, out: 'review spec closed cap at round 3' });
      });

      it('refuses clean before any pass, and accepts a skip at round 0', () => {
        awaiting('spec');
        expect(orch(['review', 'spec', '--close', 'clean'])).toMatchObject({ status: 2, err: 'orchestrate: review spec: clean needs a reviewer pass; none has run' });
        expect(orch(['review', 'spec', '--close', 'skipped:verb'])).toMatchObject({ status: 0, out: 'review spec closed skipped:verb at round 0' });
        expect(loop('spec')).toEqual({ round: 0, outcome: 'skipped:verb' });
      });

      it.each(['skipped:', 'skipped:Denied', 'skipped:a b', `skipped:${'a'.repeat(41)}`, 'done'])('refuses the outcome %j, writing nothing', (outcome) => {
        awaiting('spec');
        expect(orch(['review', 'spec', '--close', outcome])).toMatchObject({ status: 2, err: USAGE });
        expect(loop('spec')).toBeUndefined();
      });

      it('refuses a malformed call with the usage line', () => {
        awaiting('spec');
        for (const args of [['spec'], ['spec', '--open'], ['spec', '--round', 'x'], ['spec', '--close'], ['spec', '--close', 'clean', 'x']]) {
          expect(orch(['review', ...args])).toMatchObject({ status: 2, err: USAGE });
        }
        expect(loop('spec')).toBeUndefined();
      });

      it('runs a separate loop for plan in its own window, and refuses spec there', () => {
        awaiting('plan');
        expect(orch(['review', 'plan', '--round']).out).toBe('review plan round 1 of 3');
        expect(orch(['review', 'spec', '--round'])).toMatchObject({ status: 2, err: 'orchestrate: review spec: the next step is approve plan' });
        expect(runFile().review).toEqual({ plan: { round: 1, outcome: null } });
      });

      it('[AC4] approve ignores an open loop and keeps its record', () => {
        awaiting('spec');
        orch(['review', 'spec', '--round']);
        expect(orch(['approve', 'spec']).status).toBe(0);
        expect(runFile()).toMatchObject({ approvals: { spec: { by: expect.any(String) } }, review: { spec: { round: 1, outcome: null } } });
      });

      it('[AC4] isValidRun accepts a run with and without review', () => {
        const run = { v: 1, session_id: 's', item: 'FEAT-041', ...blank };
        expect(isValidRun(run)).toBe(true);
        expect(isValidRun({ ...run, review: { spec: { round: 1, outcome: 'clean' } } })).toBe(true);
      });

      it('[AC4] end prints the review record and removes .conductor/review', () => {
        awaiting('spec');
        orch(['review', 'spec', '--round']);
        mkdirSync(join(root, REVIEW_DIR), { recursive: true });
        writeFileSync(join(root, REVIEW_DIR, 'spec-1-review.txt'), 'REVIEW spec round 1: CLEAN\n');
        expect(JSON.parse(orch(['end']).out).review).toEqual({ spec: { round: 1, outcome: null } });
        expect(existsSync(join(root, REVIEW_DIR))).toBe(false);
      });

      it('a start over a stale run clears .conductor/review', () => {
        orch(['start', 'FEAT-011'], { sid: 'old-session' });
        mkdirSync(join(root, REVIEW_DIR), { recursive: true });
        writeFileSync(join(root, REVIEW_DIR, 'spec-1-review.txt'), 'stale\n');
        expect(orch(['start', 'FEAT-012']).status).toBe(0);
        expect(existsSync(join(root, REVIEW_DIR))).toBe(false);
      });

      it('refuses on a halted run, writing nothing', () => {
        awaiting('spec');
        runFileText(JSON.stringify({ ...runFile(), halt: { code: 'SNAP_ERROR', reason: 'x', at: 'y' } }));
        const r = orch(['review', 'spec', '--round']);
        expect(r.status).toBe(2);
        expect(r.err).toContain('halted with SNAP_ERROR');
        expect(loop('spec')).toBeUndefined();
      });

      it('[RF2] starts fresh over a corrupt review field instead of crashing', () => {
        awaiting('spec');
        runFileText(JSON.stringify({ ...runFile(), review: 'corrupt' }));
        expect(orch(['review', 'spec', '--round']).out).toBe('review spec round 1 of 3');
        runFileText(JSON.stringify({ ...runFile(), review: { spec: { round: 'two', outcome: null } } }));
        expect(orch(['review', 'spec', '--round']).out).toBe('review spec round 1 of 3');
        expect(runFile().review).toEqual({ spec: { round: 1, outcome: null } });
      });

      it('names review in the usage line', () => {
        expect(orch(['nope']).err).toBe('orchestrate: usage: orchestrate.mjs start|install|handback|approve|review|end');
      });
    });
    ```
  - [X] [T-001-B] Run `npx vitest run tests/scripts/orchestrate.test.js`. **Expected, as measured 2026-10-06 (AMENDED by owner ruling after a halt):** the file loads under vitest, whose transform delivers a missing named export as `undefined`; the exports are verified absent under plain Node (`'REVIEW_CAP' in m === false`). 112 tests run (92 existing + 20 new): 93 pass, 19 fail. The one passing new test is `[AC4] isValidRun accepts a run with and without review`. 15 fail on the CLI's refusal of the unknown `review` verb (the old usage line `orchestrate: usage: orchestrate.mjs start|install|handback|approve|end`, or the empty stdout that goes with it; the 5 `it.each` rows included). 4 fail tracing to the undefined exports: the cap test on its fourth-call assertion after a zero-iteration loop (`n <= REVIEW_CAP` is false); the end and stale-start tests crashing in `mkdirSync(join(root, REVIEW_DIR))` with `TypeError: The "path" argument must be of type string. Received undefined`; and the approve test on the never-written `review` field. All 19 trace to the feature's absence and none to a defective test; T-001-E's discriminators exercise the four less precise reds after the green. The review ruling that imposed a module-load SyntaxError (Node ESM semantics) is reversed: the plan's original split was directionally right for vitest, and this measured split is the authority. The per-test accounting lives in T-001-D.
  - [X] [T-001-C] **Implement.** In `scripts/orchestrate.mjs`:
    1. After the `HANDBACK_DIR` export (:23), add:
       ```js
       // FEAT-041: the Define review loop's reports, cleared with the run like the hand-backs.
       export const REVIEW_DIR = '.conductor/review';
       // Three reviewer passes, so at most two revisions, each re-reviewed (FEAT-041 (d)).
       export const REVIEW_CAP = 3;
       const REVIEW_OUTCOME = /^(clean|cap|skipped:[a-z][a-z0-9-]{0,39})$/;
       const REVIEW_USAGE = 'usage: orchestrate.mjs review <spec|plan> --round | --close <clean|cap|skipped:<reason>>';
       ```
    2. After `approve` (ends :328), add:
       ```js
       // FEAT-041 (e): the review loop's round counter. Advisory: approve never reads it, and the
       // cap is a refusal, never a halt, so the loop can never freeze the run.
       function review(root, sessionId, [role, flag, outcome, extra]) {
         const run = liveRun(root, sessionId);
         const wellFormed = extra === undefined && (flag === '--round' ? outcome === undefined : flag === '--close' && outcome !== undefined);
         if (!wellFormed) throw new Refusal(REVIEW_USAGE);
         const step = nextStep(run);
         if (step.await !== role) throw new Refusal(`review ${role}: the next step is ${describeStep(step)}`);
         const loops = isPlainObject(run.review) ? run.review : {};
         const loop = isPlainObject(loops[role]) && Number.isInteger(loops[role].round) ? loops[role] : { round: 0, outcome: null };
         if (loop.outcome) throw new Refusal(`review ${role}: the loop closed ${loop.outcome}; a closed loop does not reopen`);
         const next = flag === '--round' ? openRound(role, loop) : closeLoop(role, loop, outcome);
         saveRun(root, { ...run, review: { ...loops, [role]: next } });
         return flag === '--round' ? `review ${role} round ${next.round} of ${REVIEW_CAP}` : `review ${role} closed ${next.outcome} at round ${next.round}`;
       }

       function openRound(role, loop) {
         if (loop.round >= REVIEW_CAP) throw new Refusal(`ORCH_REVIEW_CAP: review ${role} has run ${REVIEW_CAP} rounds; close it with --close cap`);
         return { round: loop.round + 1, outcome: null };
       }

       function closeLoop(role, loop, outcome) {
         if (!REVIEW_OUTCOME.test(outcome)) throw new Refusal(REVIEW_USAGE);
         if (outcome === 'clean' && loop.round === 0) throw new Refusal(`review ${role}: clean needs a reviewer pass; none has run`);
         if (outcome === 'cap' && loop.round < REVIEW_CAP) throw new Refusal(`review ${role}: cap needs round ${REVIEW_CAP}; the loop is at round ${loop.round}`);
         return { round: loop.round, outcome };
       }
       ```
    3. In `clearRunFiles` (:376-379), add a third line: `rmSync(join(root, REVIEW_DIR), { recursive: true, force: true });`
    4. In `cli`'s `verbs` (:401-407), add `review: () => review(root, sid, argv.slice(1)),` between `approve` and `end`. Change the usage refusal (:409) to `'usage: orchestrate.mjs start|install|handback|approve|review|end'`.
  - [X] [T-001-D] Run `npx vitest run tests/scripts/orchestrate.test.js`. Expected: PASS, the whole file loading and running. The new describe `review loop round counter [FEAT-041 AC2-AC4]` passes exactly 20 tests (15 `it` plus 5 `it.each` rows), and the file's total is its pre-T-001 count plus 20 with zero failures. Any other count halts the task (Ruling 7). Then `grep -rn "start|install|handback|approve|end" scripts tests .claude/commands project-template README.md` and expect no remaining match of the old usage text.
  - [X] [T-001-E] **Discriminators**, each reverted after its red run:
    - change `REVIEW_CAP` to `4`, expecting the cap test red;
    - throw `new Halt('ORCH_REVIEW_CAP', ...)` in `openRound`, expecting the cap test red on `status` and `halt`;
    - delete the `REVIEW_DIR` line from `clearRunFiles`, expecting both clear tests red.
  - [X] [T-001-F] Run `npm test`. Expected: **1438 / 0, 49 files** (predicted). Append `- T-001: <one line>` under the plan section of `.claude/memory/project.md`. Then `git add -u scripts/orchestrate.mjs tests/scripts/orchestrate.test.js .claude/memory/project.md docs/superpowers/plans/2026-10-06-feat041-reviewer-in-loop.md`. Commit `feat: add the review loop round counter to the router [FEAT-041]`.

- [X] [T-002] **The `define-review` profile** (spec (e) profile; AC1, AC10). Native. Independent of T-001; runs after it.

  **Files:**
  - Create: `project-template/.claude/agents/define-review.md`
  - Create: `.claude/agents/define-review.md`
  - Modify: `.gitignore`
  - Test: `tests/unit/role-profiles.test.js`

  **Interfaces:**
  - Produces: the agent type `define-review`, `tools: Read, Grep, Glob`, that T-003 dispatches by name, and the verdict format T-003's reviewer brief repeats.

  - [X] [T-002-A] **Write the failing tests.** In `tests/unit/role-profiles.test.js`:
    1. Replace the test at :48-50 with:
       ```js
       it('ships exactly the five ROLES plus define-review in both agents directories [FEAT-041]', () => {
         const expected = [...ROLES, 'define-review'].map((r) => `${r}.md`).sort();
         for (const dir of [TEMPLATE, MIRROR]) expect(readdirSync(join(ROOT, dir)).sort()).toEqual(expected);
       });
       ```
    2. Append at the end of the file:
       ```js
       // FEAT-041 (e): the reviewer profile. Not a band role: outside ROLES, no SNAP line, no gate.
       const REVIEWER = 'define-review';
       const REVIEWER_PHRASES = [
         '~/.claude/skills/critical-review/SKILL.md',
         '- [<row>] <what is missing> (lines <a-b> | absent)',
         'REVIEW <role> round <n>: CLEAN',
         'REVIEW <role> round <n>: OPEN <k>',
         'You have no shell and no write tools.',
         'A hook or owner denial is an instruction to stop and report, never an obstacle to route around.',
         'Never dispatch or message another agent.',
       ];

       describe('define-review profile [FEAT-041 AC1]', () => {
         it('names itself, carries Read, Grep, Glob exactly, and stays out of ROLES', () => {
           const text = profile(REVIEWER);
           expect(field(text, 'name')).toBe(REVIEWER);
           expect(field(text, 'tools').split(', ')).toEqual(['Read', 'Grep', 'Glob']);
           expect(ROLES).not.toContain(REVIEWER);
         });

         it('is byte-identical in the .claude/agents mirror', () => {
           expect(read(`${MIRROR}/${REVIEWER}.md`)).toBe(profile(REVIEWER));
         });

         it('measures at most 999 tokens as ceil(bytes / 4)', () => {
           expect(Math.ceil(Buffer.byteLength(profile(REVIEWER), 'utf8') / 4)).toBeLessThanOrEqual(999);
         });

         it('carries the verdict format, the skill path, and the no-write and no-dispatch rules, and names no gate', () => {
           const text = profile(REVIEWER);
           for (const phrase of REVIEWER_PHRASES) expect(text).toContain(phrase);
           for (const gate of GATES) expect(text).not.toContain(gate);
         });
       });
       ```
  - [X] [T-002-B] Run `npx vitest run tests/unit/role-profiles.test.js`. Expected: FAIL on the amended directory test and the four new tests (the file is absent).
  - [X] [T-002-C] **Create** `project-template/.claude/agents/define-review.md` with exactly:
    ````markdown
    ---
    name: define-review
    description: Reviewer in the Define band's review loop of a /cc-orchestrate run (FEAT-041). Checks a spec or plan against the checklist rows in its brief, read-only, and reports open rows in a fixed format. Not a band role. No shell. Dispatched only by /cc-orchestrate during a run; never use it for ad-hoc work.
    tools: Read, Grep, Glob
    ---

    You are the `define-review` reviewer of a code-conductor orchestrated run. The orchestrator dispatched you, fresh for this round, with a brief naming the item, the round, the document under review, its source, and the checklist rows.

    ## Your job

    Read `~/.claude/skills/critical-review/SKILL.md` and apply its Phase 1 and Phase 2 to the checklist rows in your brief. Read the document and its source as they stand now, in slices of 150 lines or fewer. Judge the document against those rows only. You are not told what earlier rounds found, by design.

    ## Report format

    - One line per unmet row: `- [<row>] <what is missing> (lines <a-b> | absent)`.
    - Anything else you noticed goes under a `Notes:` block. A note never counts as a row.
    - Your last line is exactly one of `REVIEW <role> round <n>: CLEAN`, when no row is open, or `REVIEW <role> round <n>: OPEN <k>`, where `<k>` is the number of row lines you wrote.

    ## Rules

    - You have no shell and no write tools. Write nothing.
    - A hook or owner denial is an instruction to stop and report, never an obstacle to route around.
    - Never dispatch or message another agent.
    - You are not a band role: write no hand-back line and claim no gate. Your report is advice; the owner decides.
    ````
    Then `cp project-template/.claude/agents/define-review.md .claude/agents/define-review.md`.
  - [X] [T-002-D] Modify `.gitignore`: insert `!/.claude/agents/define-review.md` immediately after `!/.claude/agents/code.md` (:40), in sorted position. Then `git add project-template/.claude/agents/define-review.md .claude/agents/define-review.md` (plain: the first sits outside any ignored directory, and the second's leaf now exists). **AMENDED 2026-10-06 by owner ruling after a halt:** the staging moves here from T-002-F because `gitignore-block-parity` derives its expected block from the git index, so T-002-E needs the profiles indexed (a plan-ordering defect the plan review also missed).
  - [X] [T-002-E] Run `npx vitest run tests/unit/role-profiles.test.js tests/unit/gitignore-block-parity.test.js`. Expected: PASS. The 1.37.0 sha256 pins for the five role profiles stay green, which is how the test asserts that no role profile changed.
  - [X] [T-002-F] Run `npm test`. Expected: **1442 / 0, 49 files** (predicted). Append `- T-002: <one line>` under the plan section. Then `git add -u .gitignore tests/unit/role-profiles.test.js .claude/memory/project.md docs/superpowers/plans/2026-10-06-feat041-reviewer-in-loop.md`. Commit `feat: add the define-review reviewer profile [FEAT-041]`.

- [X] [T-003] **The loop in `/cc-orchestrate`** (spec (b), (d), delivery channel, fail-open, boundaries; AC5, AC6). Native. Depends on T-001 (the verb's exact strings) and T-002 (the agent name and format).

  **Files:**
  - Modify: `.claude/commands/cc-orchestrate.md`
  - Modify: `project-template/.claude/commands/cc-orchestrate.md`
  - Test: `tests/installer/commands-parity.test.js`

  - [X] [T-003-A] **Write the failing tests.** In `tests/installer/commands-parity.test.js`, append after the `cc-orchestrate mirrors` describe:
    ```js
    describe('cc-orchestrate review loop [FEAT-041 AC5, AC6]', () => {
      const text = () => read(ORCH_MIRRORS[0]);
      const has = (...phrases) => { const t = text(); for (const p of phrases) expect(t).toContain(p); };

      it('runs the loop before each define approval, with its verb calls and report files', () => {
        has('## The review loop (FEAT-041)', 'Before each, run "The review loop" below for that role.',
          'node "$S/orchestrate.mjs" review <role> --round', 'Dispatch a fresh `define-review` agent',
          '.conductor/review/<role>-<n>-review.txt', '.conductor/review/<role>-<n>-revision.txt',
          'review <role> --close clean', 'review <role> --close cap', 'No revision follows the third pass, so the document at the approval is always the one the last reviewer read.');
      });

      it('briefs the reviewer and the generator in the declared formats and checklist', () => {
        has('REVIEW <role> round <n>: CLEAN', 'REVIEW <role> round <n>: OPEN <k>',
          'REVISION <role> round <n>: done', 'REVISION <role> round <n>: blocked <reason>',
          '~/.claude/skills/critical-review/SKILL.md', '| AC |', '| FMT |', '| CR |',
          'never pass it an earlier round\'s findings');
      });

      it('takes the first revision delivery on any channel and never routes it to handback', () => {
        has('on any channel (a message, a hand-back frame or a completion notice)',
          'Ignore later copies of the same round\'s report.', 'A revision report is never passed to `handback`.',
          'outside a revision report of the review loop', 'review <role> --close skipped:snap-in-revision');
      });

      it('fails open with named reasons and never halts', () => {
        has('review <role> --close skipped:<reason>', 'A loop error never halts the run.', '`skipped:owner`');
        for (const reason of ['dispatch', 'unparsed', 'denied', 'blocked', 'snap-in-revision', 'verb']) has(`- \`${reason}\`: `);
      });

      it('approves only on an owner message, after a re-hash', () => {
        has('**Only an owner message approves.**', 'a suggestion in the input box are not approvals',
          '**Re-hash before approve.**', 'shasum -a 256 <doc>', 'Get-FileHash -Algorithm SHA256 <doc>');
      });

      it('amends the brief line and names the zero-wake launch in the run header', () => {
        has('Your hand-back is the run\'s only record. After it, the orchestrator may send you revision requests; answer them as prose, without a `SNAP_HANDBACK` line.',
          'claude --permission-mode auto --settings .claude/review-loop.settings.json');
        expect(text()).not.toContain('your first hand-back is final, and a second is refused');
      });
    });
    ```
  - [X] [T-003-B] Run `npx vitest run tests/installer/commands-parity.test.js`. Expected: FAIL on the six new tests only.
  - [X] [T-003-C] **Edit `.claude/commands/cc-orchestrate.md`**, five edits:
    1. **Run header (step 1).** After the line `   Print the run header: the item, the mode (...), the test command, the ticket and snapshot for a bound run, and the first role, \`spec\`.`, add:
       ```markdown
       Add one line: `Review loop: zero owner wakes only when launched with claude --permission-mode auto --settings .claude/review-loop.settings.json; README "Review loop configurations" names the costs of every other launch.`
       ```
       Indent it three spaces, as the line above.
    2. **Step 2.6.4.** Replace `If a second \`SNAP_HANDBACK\` from that agent reaches you for the same position, write it` with `If a second \`SNAP_HANDBACK\` from that agent reaches you for the same position, outside a revision report of the review loop, write it`. The rest of the item is unchanged.
    3. **Step 3.** Replace the step's first line `3. **The two define approvals.** These pause in both modes.` and insert three bullets above the existing `**After spec:**` bullet, which stays as it is, as does `**After plan:**`:
       ```markdown
       3. **The two define approvals.** These pause in both modes. Before each, run "The review loop" below for that role.
          - **What you show:** the document path; its sha256 now (`shasum -a 256 <doc>` or `sha256sum <doc>`; in PowerShell, `Get-FileHash -Algorithm SHA256 <doc>`); the loop outcome (`clean` at round `<n>`, `cap` with the final reviewer's rows verbatim, or `skipped:<reason>` with a notice naming what failed); and each round's verdict line with the reviewer's notes.
          - **Only an owner message approves.** An approval is a message the owner sends that itself says to approve. A reviewer's `CLEAN`, a loop outcome, `--auto` and a suggestion in the input box are not approvals.
          - **Re-hash before approve.** Immediately before `approve`, hash the document again. If the hash differs from the one you showed, show the document again instead of approving.
       ```
    4. **Step 6, Report.** After the bullet `   - both approvals, with who approved and when;`, add `   - each review loop's outcome and round, from the record's \`review\` field;`.
    5. **The brief (:78).** Replace `Verify your work before you hand back: your first hand-back is final, and a second is refused.` with `Verify your work before you hand back. Your hand-back is the run's only record. After it, the orchestrator may send you revision requests; answer them as prose, without a \`SNAP_HANDBACK\` line.` (Ruling 1).
    6. **New section.** Insert immediately before `## The dispatch brief`:
       ````markdown
       ## The review loop (FEAT-041)

       After `spec` and after `plan` hand back, and before that role's approval, run this loop. It is advisory: it never gates, never halts the run, and never replaces the owner's approval. `<role>` is `spec` or `plan`; `<doc>` is the document path from the hand-back's `ops.f`.

       1. **Open a round.** Run `node "$S/orchestrate.mjs" review <role> --round`. It prints `review <role> round <n> of 3`.
       2. **Review.** Dispatch a fresh `define-review` agent with the `Agent` tool and the reviewer brief below. Never revive an earlier reviewer, and never pass it an earlier round's findings. Wait for its completion notice.
       3. **Record.** Write its report verbatim with the Write tool to `.conductor/review/<role>-<n>-review.txt`. Its last line is `REVIEW <role> round <n>: CLEAN` or `REVIEW <role> round <n>: OPEN <k>`.
       4. **Clean.** On `CLEAN`, run `review <role> --close clean` and go to the approval.
       5. **Open, a pass remaining.** On `OPEN <k>` below round 3, use `SendMessage` to the `<role>` agent you dispatched, by its agent id, with the revision brief below and the open rows verbatim. Wait for the first delivery on any channel (a message, a hand-back frame or a completion notice) whose last line is `REVISION <role> round <n>: done` or `REVISION <role> round <n>: blocked <reason>`. Ignore later copies of the same round's report. Write it verbatim to `.conductor/review/<role>-<n>-revision.txt`. On `done`, go back to 1.
       6. **Open at the cap.** On `OPEN <k>` at round 3, run `review <role> --close cap`. No revision follows the third pass, so the document at the approval is always the one the last reviewer read.

       A revision report is never passed to `handback`. If one carries a `SNAP_HANDBACK` line, run `review <role> --close skipped:snap-in-revision` and flag the report at the approval.

       **Fail-open.** On any loop error, run `review <role> --close skipped:<reason>`, and carry on if that also fails. Do not retry, take no other route, and go to the approval with a notice naming what failed. The reasons:
       - `dispatch`: the reviewer dispatch fails;
       - `unparsed`: the reviewer's last line does not parse;
       - `denied`: the `SendMessage` is denied (plain auto mode);
       - `blocked`: a revision ends `blocked`;
       - `snap-in-revision`: a revision report carries a `SNAP_HANDBACK` line;
       - `verb`: the `review` verb refuses or errors.

       A loop error never halts the run. If the owner sends any message during the loop, close it with `skipped:owner` and handle the message as the owner's word. You wait only on notifications the loop caused.

       ### The checklist

       Only these rows keep the loop going. Anything else a reviewer reports goes in its `Notes:` and never triggers a revision.

       | Row | Spec document | Plan document |
       |---|---|---|
       | AC | Every acceptance criterion in the source is addressed, citing the spec lines that address it. | Every acceptance criterion of the approved spec maps to at least one task, citing plan lines. |
       | FMT | The `/cc-spec` sections are present: Problem, Solution, Behavior (Main path, Alternative paths, Error cases), Acceptance Criteria, Out of Scope, System Impact, Complexity Estimate. | Every task is a `### Task N` heading with a `**Files:**` block (`approve plan` halts with `ORCH_EMPTY_SCOPE` without them). |
       | CR | critical-review Phase 1: the happy path, the failure points and the boundary conditions are each addressed in Behavior. | critical-review Phase 1 per task: its failure point and its verification step are named. |

       ### The reviewer brief

       ```text
       You are the define-review reviewer for <ITEM>, round <n> of 3, reviewing the <role> document.
       Document: <doc>
       Source: <spec: the ticket snapshot .conductor/ticket/<ITEM>.md for a bound run, otherwise the backlog entry for <ITEM>, found with Grep; plan: the approved spec>
       Read ~/.claude/skills/critical-review/SKILL.md and apply its Phases 1 and 2 to these rows only:
       <the role's AC, FMT and CR rows from the checklist, verbatim>
       Report each unmet row as one line: - [<row>] <what is missing> (lines <a-b> | absent)
       Put anything else under Notes:. Write nothing. Do not dispatch or message other agents.
       End with exactly one line: REVIEW <role> round <n>: CLEAN, or REVIEW <role> round <n>: OPEN <k>, where <k> is the number of row lines.
       ```

       ### The revision brief

       ```text
       Revision round <n> for <ITEM>. A reviewer found these open rows in your document <doc>:
       <the reviewer's row lines, verbatim>
       Revise <doc> with the Edit tool to address them. Guard 5 still holds your envelope's scope.
       Report the revision as prose. Do not emit any SNAP_HANDBACK line: your hand-back is already recorded.
       End with exactly one line: REVISION <role> round <n>: done, or REVISION <role> round <n>: blocked <reason>.
       ```
       ````
  - [X] [T-003-D] `cp .claude/commands/cc-orchestrate.md project-template/.claude/commands/cc-orchestrate.md`. Run `npx vitest run tests/installer/commands-parity.test.js`. Expected: PASS, the byte-identity test included.
  - [X] [T-003-E] **ASCII probe.** Run `LC_ALL=C grep -c '[^ -~]' .claude/commands/cc-orchestrate.md` and compare with the same count on `git show HEAD:.claude/commands/cc-orchestrate.md`. Expected: equal. The edits add no non-ASCII byte (FEAT-012's decoded-escape hazard).
  - [X] [T-003-F] Run `npm test`. Expected: **1448 / 0, 49 files** (predicted). Append `- T-003: <one line>` under the plan section. Then `git add -u .claude/commands/cc-orchestrate.md project-template/.claude/commands/cc-orchestrate.md tests/installer/commands-parity.test.js .claude/memory/project.md docs/superpowers/plans/2026-10-06-feat041-reviewer-in-loop.md`. Commit `feat: run the define review loop in /cc-orchestrate [FEAT-041]`.

- [X] [T-004] **The shipped configuration and the README** (spec (f), (c); AC7-AC9). Native. Depends on T-003 (the run header names the README section).

  **Files:**
  - Create: `project-template/.claude/review-loop.settings.json`
  - Modify: `README.md`
  - Test: `tests/installer/review-loop-settings.test.js` (new)

  - [X] [T-004-A] **Write the failing tests.** Create `tests/installer/review-loop-settings.test.js`:
    ```js
    import { describe, it, expect, beforeEach, afterEach } from 'vitest';
    import { createHash } from 'node:crypto';
    import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join, dirname } from 'node:path';
    import { fileURLToPath } from 'node:url';
    import { deployGlobal, deployProject } from '../../lib/installer/deploy.mjs';

    const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const REL = 'project-template/.claude/review-loop.settings.json';
    // The owner-approved exception of 2026-10-06, byte for byte (FEAT-041 (f)). Changing it is an owner decision.
    const EXCEPTION = "Orchestrator revision rounds (code-conductor FEAT-041): during a live /cc-orchestrate run, the main session may use SendMessage to a spec or plan band agent that has already handed back, asking it to revise its own document under docs/superpowers/specs/ or docs/superpowers/plans/ and to report the revision as prose without a SNAP_HANDBACK line. This is the project's reviewer-in-loop protocol, not an evasion of oversight: the agent's edits remain subject to the project's PreToolUse guards, and the owner's boundary approval still follows.";
    const SHA256 = '05ce114dfb80f28eedc7e3537092356b6bea1c7ba68afe9ae2316212b75e6d4c';
    const LAUNCH = 'claude --permission-mode auto --settings .claude/review-loop.settings.json';
    const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
    const quiet = { warn: () => {}, report: () => {} };

    let home, cwd;
    beforeEach(() => {
      home = mkdtempSync(join(tmpdir(), 'cc-rl-home-'));
      cwd = mkdtempSync(join(tmpdir(), 'cc-rl-proj-'));
    });
    afterEach(() => {
      rmSync(home, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    });

    describe('review loop configuration [FEAT-041 AC7-AC9]', () => {
      it('[AC7] holds exactly $defaults and the approved exception', () => {
        expect(JSON.parse(read(join(ROOT, REL)))).toEqual({ autoMode: { allow: ['$defaults', EXCEPTION] } });
      });

      it('[AC7] is pinned by its sha256', () => {
        expect(createHash('sha256').update(read(join(ROOT, REL))).digest('hex')).toBe(SHA256);
      });

      it('deploys to .claude/review-loop.settings.json unchanged', () => {
        deployProject(ROOT, cwd, quiet);
        expect(read(join(cwd, '.claude', 'review-loop.settings.json'))).toBe(read(join(ROOT, REL)));
      });

      it('[AC9] the installer writes no autoMode to the global or project settings', () => {
        deployGlobal(ROOT, home, quiet);
        deployProject(ROOT, cwd, quiet);
        for (const path of [join(home, '.claude', 'settings.json'), join(cwd, '.claude', 'settings.json')]) {
          expect(existsSync(path)).toBe(true);
          expect(read(path)).not.toContain('autoMode');
        }
      });

      it('[AC8] README declares the three configurations and the launch line', () => {
        const text = read(join(ROOT, 'README.md'));
        for (const phrase of ['### Review loop configurations', LAUNCH, '| Default (ask) permission mode |', '| Plain auto mode |', 'skipped:denied']) {
          expect(text).toContain(phrase);
        }
      });
    });
    ```
  - [X] [T-004-B] Run `npx vitest run tests/installer/review-loop-settings.test.js`. Expected: FAIL on four tests (AC9 already passes, because nothing writes `autoMode` today).
  - [X] [T-004-C] **Create** `project-template/.claude/review-loop.settings.json` from the test's own constant, so no hand-typed byte can drift:
    ```sh
    node -e "const fs = require('node:fs'); const t = fs.readFileSync('tests/installer/review-loop-settings.test.js', 'utf8'); const x = JSON.parse(t.match(/^const EXCEPTION = (\".*\");\$/m)[1]); fs.writeFileSync('project-template/.claude/review-loop.settings.json', JSON.stringify({ autoMode: { allow: ['\$defaults', x] } }) + '\n');"
    ```
    This exact command was dry-run at plan time in the session scratchpad against a fixture holding the constant, and produced the pinned hash. Then `shasum -a 256 project-template/.claude/review-loop.settings.json`, expecting `05ce114dfb80f28eedc7e3537092356b6bea1c7ba68afe9ae2316212b75e6d4c`. A mismatch halts the task: the test constant was mistyped, and the pin, measured from the probe, is the authority.
  - [X] [T-004-D] **Edit `README.md`.** Read lines 225-250 and 425-432 first.
    1. Insert immediately before the line `## Skills`:
       ```markdown
       ### Review loop configurations

       Before each define approval, `/cc-orchestrate` runs a review loop (`[FEAT-041]`): a fresh read-only `define-review` agent checks the spec or plan against a declared checklist, and while rows stay open the orchestrator sends them back to the role that wrote the document, up to three reviewer passes and two revisions. It is advisory: it never gates, never halts the run, and never replaces your approval, which only a message you send gives. What a round costs depends on how you launched Claude Code, measured on `claude` 2.1.292:

       | Configuration | Per round |
       |---|---|
       | Auto mode with the shipped exception: `claude --permission-mode auto --settings .claude/review-loop.settings.json` | 0 owner wakes, 0 prompts |
       | Default (ask) permission mode | 0 wakes; one approval per revision write, plus the orchestrator's `review` calls and report writes |
       | Plain auto mode | the auto mode classifier denies the first revision request; the loop closes `skipped:denied`, and you get round 1's findings, unrevised |

       `.claude/review-loop.settings.json` holds one auto mode allow rule that names this protocol. The installer never writes `autoMode` into `~/.claude/settings.json`, and Claude Code ignores `autoMode` in project settings, so the rule applies only when you pass the file yourself. Read it before you pass it: a cloned repository could ship a different file under the same name.

       ```
    2. In Known limits, after the bullet ending `never the truth of the work beyond that claim.` (:130), add:
       ```markdown
       - **The review loop (`1.39.0`) is process discipline.** The spec or plan envelope stays installed after its hand-back, so the role can revise. Outside a round, its writes are bounded by its tool mask, Guard 5's scope, the re-hash before `approve`, and your review. Gating Guard 5 on an open round is a follow-up candidate.
       ```
    3. At :129, change `.claude/agents/{spec,plan,code,audit,qa}.md` to `.claude/agents/{spec,plan,code,audit,qa,define-review}.md`.
    4. In the file tree (:429), change `Band roles: spec, plan, code, audit, qa (FEAT-012)` to `Band roles: spec, plan, code, audit, qa (FEAT-012); define-review (FEAT-041)`. Below the `settings.json` line at :428, add a `review-loop.settings.json` line in the same column style, described as `Auto mode exception for the review loop (FEAT-041)`.
  - [X] [T-004-E] Run `git check-ignore -v project-template/.claude/review-loop.settings.json`. Expected: exit 1, so the file is not ignored. Run `npx vitest run tests/installer/review-loop-settings.test.js`. Expected: PASS.
  - [X] [T-004-F] Run `npm test`. Expected: **1453 / 0, 50 files** (predicted). Append `- T-004: <one line>` under the plan section. Then:
    - `git add project-template/.claude/review-loop.settings.json tests/installer/review-loop-settings.test.js`;
    - `git add -u README.md .claude/memory/project.md docs/superpowers/plans/2026-10-06-feat041-reviewer-in-loop.md`.

    Commit `feat: ship the review loop auto mode exception and declare its costs [FEAT-041]`.

- [ ] [T-005] **Release `1.39.0`.** Native. Depends on T-001 to T-004.

  **Files:**
  - Modify: `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `README.md`

  - [ ] [T-005-A] Set `1.39.0` in `VERSION`, in `package.json` `version`, and in `package-lock.json` (the root `version` and `packages[""].version`).
  - [ ] [T-005-B] **`README.md`:** in the `/cc-orchestrate` row of the Project commands table (:237), after `the spec and plan approvals always pause.`, add: `Before each, a review loop checks the document with a fresh read-only \`define-review\` agent and sends open rows back to its author, at most three passes; it is advisory and fails open (see Review loop configurations).`
  - [ ] [T-005-C] **Records.**
    - **`AGENT-READABLE BACKLOG.md`:** at the line that `` grep -n '^### \[ \] `\[FEAT-041\]`' `` reports (:217), change `### [ ]` to `### [X]`. Insert as its first bullet:
      ```markdown
      * **DONE, shipped as `1.39.0` on <date>.** Before each define approval, `/cc-orchestrate` runs an advisory review loop: a fresh `define-review` agent (`Read, Grep, Glob`; not a band role, no SNAP line, no gate) checks the spec or plan against the declared AC, FMT and CR rows, and while rows stay open the orchestrator revives the handed-back generator through `SendMessage` to revise under its still-installed envelope, reporting as prose. Hard cap 3 reviewer passes, at most 2 revisions; `orchestrate.mjs review <role> --round|--close` counts rounds in an optional run field, and `ORCH_REVIEW_CAP` is a refusal, never a halt. Fail-open on any error; only an owner message approves, after a re-hash. Zero wakes per round holds under `claude --permission-mode auto --settings .claude/review-loop.settings.json`, the shipped owner-approved exception; default mode and plain auto mode have declared, measured costs. No hook, SNAP contract, `ROLES` or gate change. Out of scope, as specified: code, audit and QA reviewers, the manual `/cc-spec` flow, a revision verb, gating Guard 5 on an open round, the D8 anomaly, and global `autoMode`.
      ```
    - **`CHANGELOG.md`:** insert above `## [1.38.0]`:
      ```markdown
      ## [1.39.0] - <date>

      ### Added
      - **[FEAT-041]** A review loop before each define approval in `/cc-orchestrate`. A fresh read-only `define-review` agent checks the spec or plan against a declared checklist; open rows go back to the role that wrote the document through `SendMessage`, at most three reviewer passes and two revisions. Advisory and fail-open; the approval stays the owner's message, taken after a re-hash of the document.
      - **[FEAT-041]** `orchestrate.mjs review <spec|plan> --round | --close <clean|cap|skipped:<reason>>`, the loop's round counter, recorded in an optional `review` run field. `ORCH_REVIEW_CAP` refuses a fourth round without halting the run.
      - **[FEAT-041]** `.claude/review-loop.settings.json`, an auto mode allow rule for the loop's revision requests, applied only when passed with `claude --permission-mode auto --settings .claude/review-loop.settings.json`. The installer never writes `autoMode` globally.

      ### Changed
      - **[FEAT-041]** The role dispatch brief: a hand-back is the run's only record, and later revision requests are answered as prose without a `SNAP_HANDBACK` line.
      ```

    If the release commit lands on another date, use that date in both places.
  - [ ] [T-005-D] Run the release checks:
    - `node tools/version-gate.mjs`, expecting `VERSION_GATE_OK 1.39.0`;
    - `node tools/record-parity.mjs`, expecting `RECORD_PARITY_OK`;
    - `git diff origin/main -- scripts/snap-contract.mjs scripts/snap-validate.mjs scripts/snap-build.mjs .claude/hooks/pre-tool-use.mjs project-template/.claude/hooks/pre-tool-use.mjs lib/installer .claude/settings.json project-template/.claude/settings.json global/settings.json` empty (Global Constraints);
    - `git diff --name-only origin/main -- .claude/agents project-template/.claude/agents` listing only the two `define-review.md` files.

    **Discriminator:** flip the FEAT-041 heading back to `### [ ]` and expect a red run naming `1.39.0` and `FEAT-041`. Restore `[X]` and re-run green.
  - [ ] [T-005-E] Run `npm test`, expecting **1453 / 0, 50 files**. Then `node tools/id-ceiling.mjs`, and report the union and the next ids. Nothing is minted.
  - [ ] [T-005-F] Append `- T-005: <one line>` under the plan section. Then `git add -u VERSION package.json package-lock.json CHANGELOG.md "AGENT-READABLE BACKLOG.md" README.md .claude/memory/project.md docs/superpowers/plans/2026-10-06-feat041-reviewer-in-loop.md`. Commit `chore: release 1.39.0 [FEAT-041]`.
  - [ ] [T-005-G] **Confirm with the owner, then** push with `git push -u origin feat/feat-041-reviewer-in-loop` and open the PR against `main`. Expected CI (`[BUG-048]`, absolute per environment):
    - ci-node20 **1357 passed / 96 skipped**;
    - ci-node24 **1440 passed / 13 skipped**;
    - both legs printing `SKIP_BASELINE_OK`;
    - `git diff origin/main -- tools/skip-baseline.json` empty.

    Any other count halts before the PR is reported green (Ruling 7). If any third-party PR merges into `main` before T-005 runs, the baselines move, and every prediction in this plan is re-derived before anything is measured.
  - [ ] [T-005-H] **Stop at the green PR.** Report both `SKIP_BASELINE_OK` lines, both run ids and the PR URL. The owner merges and publishes the GitHub Release `v1.39.0`.

## Test List

- [ ] CLI through the router, `tests/scripts/orchestrate.test.js`, +20 (AC2-AC4, Review Focus 2).
- [ ] Unit, `tests/unit/role-profiles.test.js`, +4 and one amended (AC1).
- [ ] Content pins, `tests/installer/commands-parity.test.js`, +6 (AC5, AC6); the existing byte-identity test covers the mirror.
- [ ] Installer and content, `tests/installer/review-loop-settings.test.js` (new), +5 (AC7-AC9).
- [ ] `.gitignore` block parity, existing (AC10).
- No E2E: no UI is affected. No live loop: the standing rule forbids a run here, and the loop's live behavior was measured in the sandbox (PROBE v2, PROBE C).

## Commit Order

1. T-000: `docs: add the FEAT-041 reviewer-in-loop implementation plan [FEAT-041]`, at 1418 / 0.
2. T-001: `feat: add the review loop round counter to the router [FEAT-041]`, at 1438 / 0.
3. T-002: `feat: add the define-review reviewer profile [FEAT-041]`, at 1442 / 0.
4. T-003: `feat: run the define review loop in /cc-orchestrate [FEAT-041]`, at 1448 / 0.
5. T-004: `feat: ship the review loop auto mode exception and declare its costs [FEAT-041]`, at 1453 / 0, 50 files.
6. T-005: `chore: release 1.39.0 [FEAT-041]`, at 1453 / 0.

## Identified Risks

- **Live-session hazard: the profile and the command are live here.** `.claude/agents/define-review.md` and the amended `.claude/commands/cc-orchestrate.md` load in this repository's sessions as soon as they are written.
  - **Bounded by:** the standing rule (no run here), the profile's read-only mask, and its description's "never use it for ad-hoc work". No hook changes.
- **The exception text drifting from the approved wording.** The sandbox file it was measured from lives in `/private/tmp` and may vanish.
  - **Prevented by:** T-004-C generating the file from the test constant, and the sha256 pin measured at plan time from `PROBE-C.md:29`.
  - **Caught by:** T-004-C's `shasum` check and the AC7 tests.
- **The new verb breaking existing verbs.** `cli`'s usage text and `clearRunFiles` change.
  - **Caught by:** the full `orchestrate.test.js` in T-001-D and T-001-E's discriminators.
- **The T-004 deploy tests touching real paths.** `deployGlobal` and `deployProject` run against the real asset root.
  - **Bounded by:** both targets being fresh `mkdtemp` dirs; `sweepStaleRootScripts` sweeps only `<cwd>/scripts`, which is the temp dir (`[BUG-052]` concerns the repository as `cwd`, never as asset root).
- **Unmeasured counts (Ruling 7).** The predictions were derived, not measured, so a drift is more likely here than in a measured plan.
  - **Caught by:** each task's `npm test` before staging; the commit hook runs the full suite again.
  - **Response:** any count outside its predicted row, including a drift with zero failures, halts the task before its commit and goes to the owner for an amendment ruling. Nothing is committed on an unpredicted count.
- **Prose that tests cannot exercise.** The loop's behavior in a live session is process discipline. The pins assert that the text is present, never that a session obeys it. The sandbox measurements are the evidence, cited in the spec.

## Handoff (not plan tasks)

After the owner merges and releases, run `RELEASE-CLOSEOUT` steps 6-10:
- `npm view` shows `1.39.0`;
- sync `main`, reporting the measurement first;
- the closeout record in `project.md`, with the instruments' output and the per-task observation harvest;
- the ceiling before any mint;
- push the record commit in the same action;
- delete the branch, local and remote.

Recorded follow-up candidates, not minted: the manual `/cc-spec` flow, Guard 5 gating on an open round, the revision verb, and the D8 sequencing anomaly.
