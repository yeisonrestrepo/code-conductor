# FEAT-055 resume verb for halted orchestrated runs implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** a new `resume` verb takes a halted run back to the last gate record that still validates (both approvals re-hashed and anchored to a commit HEAD descends from, then each Build task hand-back whose stored SNAP still validates and whose `sys.c` HEAD descends from), drops and redoes everything after it, and clears the halt; `approve` records `commit` and `handback` records `snap` so the check has something to read; `end` and `start` do not change.

**Spec:** `docs/superpowers/specs/2026-11-13-feat055-resume-verb-for-halted-orchestrated-runs-design.md` (approved 2026-11-13, sha256 `908e0befe66bb28484ae40b2cc5a9c18c23297a660c2a1c5a3f0632c13eba889`). Issue #185.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines stay untouched. `README.md:484` (`A halted run cannot be resumed, only ended and restarted.`) is a Known-limits line that this change makes stale; it is left for the owner's release, as CONTRIBUTING says.
- No new dependency (`node:child_process` is already imported), no network, no installer, hook, settings or workflow change. `.github/wiki/pages/` is documentation, not `.github/workflows/` or `.github/actions/`.
- `scripts/orchestrate.mjs` is the router, not one of the protected surfaces CONTRIBUTING names (hooks, installer, SNAP scripts, settings); no ritual applies. Guard 6, `pre-tool-use.mjs`, `snap-validate.mjs` and `tests/hooks/guard6.test.js` do not change (spec, System Impact).
- Functions of 30 lines or fewer, guard clauses, comments say why.
- Mirrors stay byte-identical: `.claude/commands/cc-orchestrate.md` = `project-template/.claude/commands/cc-orchestrate.md`. Every edit to one is made identically to the other in the same task.
- Tests are added, none skipped and none conditional, so `tools/skip-baseline.json` is untouched on every CI leg.
- Every file this plan edits is already tracked, so every staging step is `git add -u <path>` with an explicit path; only Task 0 stages a new file.

## Plan decisions

The spec leaves these to the plan, or they follow from reading the code it cites.

1. **`snap` is the SNAP JSON text, verbatim** (the string after `SNAP_HANDBACK ` that `parseHandback` validates, already trimmed). Storing the string, not a re-serialized object, lets `resume` re-run `snap-validate.mjs` on exactly the bytes that passed at hand-back time.
2. **The `security` entry stores no `snap`.** FEAT-059 C6 keeps everything the security agent wrote out of the run file except the script's own summary, and the existing test `E2b … end prints the entry` (`tests/scripts/orchestrate.test.js:1930`) pins that entry's keys as `['role', 'gate', 'at', 'security']`. `resume` never reads a security entry (Verify records are always dropped), so storing its SNAP line would widen what the run file carries for no reader. Every other role's entry stores `snap`.
3. **Shared helper, not catch-and-rethrow.** `checkApprovedDocs` is split into `approvedDocHalt(root, run, kind)`, which returns the `Halt` it would throw (or `null`), and the existing loop that throws it. `resume` turns the returned failure into a `Refusal` with the same message, so both verbs build one text.
4. **Approval check order**, per approval, spec first: `ORCH_APPROVAL_UNHASHED` (no `path`/`sha256`), then `ORCH_RESUME_UNANCHORED` for an absent or `null` `commit`, then `ORCH_APPROVED_DOC_CHANGED`, then the ancestry question (`ORCH_RESUME_HISTORY_REWRITTEN` on exit 1, `ORCH_RESUME_UNANCHORED` on any other answer). This is the order of the spec's main-path step 3. Before any approval: usage, `ORCH_RESUME_NO_RUN`, `ORCH_RESUME_NOT_HALTED`, `ORCH_NO_SESSION_ID`, `ORCH_RESUME_NO_GATE`, the error table's order.
5. **Ancestry never passes a non-hex name to git.** `ancestry(root, commit)` answers `null` (git cannot answer) unless `commit` matches `/^[0-9a-f]{7,64}$/`, the `sys.c` pattern `snap-validate.mjs:37` enforces, so a hand-edited value that starts with `-` can never reach `git merge-base` as an option. Measured on git in this sandbox: `--is-ancestor` exits 0 for an ancestor, 1 for a commit HEAD does not descend from, and 128 for an object that does not exist (`ffff…` or `0000000`).
6. **A task entry holds** only when its `task` equals `tasks.ids[i]` for its position, its `snap` is a string that `snap-validate.mjs` passes, the parsed SNAP names `sys.role` `code`, and its `sys.c` is an ancestor of HEAD. The position check costs one comparison and stops a hand-edited entry from being counted as another task.
7. **`kept` counts records, approvals included.** The spec's main-path line reads `kept 6 record(s), dropped 1` for spec, plan, tasks 1 and 2 and both approvals, so `kept` is the kept hand-back entries plus the kept approvals, and `dropped` is the hand-back entries removed. The `resumes` entry carries the same two numbers.
8. **The next step** is `describeStep(nextStep(run))`, with ` (task <done + 1> of <ids.length>)` appended for a plan task.
9. **The approval's `commit`** comes from a new `headObject(root)` helper (`git rev-parse HEAD`, kept only when it matches `OBJECT_NAME`, else `null`). `resolveSecurity` already computes exactly that for `security.base` and is changed to call it, so the two records use one definition.
10. **Wiki pages.** The spec's System Impact does not list them, but `.github/wiki/pages/FAQ.md:80` (`A halted run cannot be resumed`), `.github/wiki/pages/Orchestrator-Guide.md:78` (`halts the run terminally`) and `.github/wiki/pages/C4-Components.md:139` (`A halted run cannot resume`, and the verb list) become false the moment this verb ships. Task 4 corrects those three sentences and nothing else. The README Known-limits line is not touched (Global Constraints).

## Baseline (measured on this branch, HEAD 027d8b0, before Task 1)

`npx vitest run tests/scripts/orchestrate.test.js tests/installer/commands-parity.test.js tests/wiki/wiki-gen.test.js`: 3 files, 534 passed (orchestrate 426, commands-parity 86, wiki-gen 22).

Line numbers below are from HEAD 027d8b0; locate by the quoted text if they move.

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-13-feat055-resume-verb-for-halted-orchestrated-runs.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file. No dependency.
- [X] [T-002] `.gitignore`: add the leaf `!/docs/superpowers/plans/2026-11-13-feat055-resume-verb-for-halted-orchestrated-runs.md` in sorted position, right after `!/docs/superpowers/plans/2026-11-13-feat034-security-agent-verify-band.md` and before `!/docs/superpowers/plans/2026-11-13-feat057-review-loop-for-the-build-and-verify-bands.md`. Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` and `git add -f docs/superpowers/plans/2026-11-13-feat055-resume-verb-for-halted-orchestrated-runs.md` (new file at a tracked surface; `-f` on one explicit path, per the CLAUDE.md staging convention). Depends on T-002.
- [X] [T-004] Commit: `docs: plan for the resume verb for halted orchestrated runs [FEAT-055]`. Depends on T-003.

---

### Task 1: `approve` records its commit and `handback` records its SNAP

**Files:**
- Modify: `tests/scripts/orchestrate.test.js`
- Modify: `scripts/orchestrate.mjs`

- [X] [T-101] `tests/scripts/orchestrate.test.js`: rename and widen the A3 test (line 1399). Depends on T-004.
  - Name: `'A3 both approvals record exactly at, by, path and a lower-case sha256, from an upper-case argument'` → `'A3 both approvals record exactly at, by, path, commit and a lower-case sha256, from an upper-case argument [FEAT-055]'`.
  - Line 1409: `expect(Object.keys(a).sort()).toEqual(['at', 'by', 'path', 'sha256']);` → `expect(Object.keys(a).sort()).toEqual(['at', 'by', 'commit', 'path', 'sha256']);`. The rest of the test stays; the fixture root is not a git repository, so `commit` is `null` there (RS2 pins the value).
- [X] [T-102] `tests/scripts/orchestrate.test.js`: append `describe('resume verb [FEAT-055]', …)` at the end of the file, with its helpers and the three record tests. Depends on T-101. Test names are the filter set predicted in T-103.
  ```js
  describe('resume verb [FEAT-055]', () => {
    const THREE_TASKS = `# Demo Plan\n\n${task(1, ['src/a.js'])}\n${task(2, ['src/b.js'])}\n${task(3, ['src/c.js'])}\n## Test List\n`;
    const gitRoot = () => { fixtureGit('init', '-q'); fixtureCommit(); };
    const head = () => fixtureGit('rev-parse', 'HEAD').stdout.trim();
    const snapOf = (line) => line.slice('SNAP_HANDBACK '.length);
    const anchoredSay = (c) => `Done.\nObservation: fine.\n${handbackLine('code', 'build_executed', { sys: { c } })}\n`;
    // A task hand-back as the contract asks: sys.c is the c of the envelope the agent was dispatched with.
    const codePass = () => { expect(orch(['install', 'code']).status).toBe(0); return orch(['handback', 'code'], { input: anchoredSay(envelope().sys.c) }); };
    function built(done, { planText = THREE_TASKS, start = [] } = {}) {
      driveTo('code', { planText, start, prep: gitRoot });
      for (let i = 0; i < done; i++) expect(codePass().status).toBe(0);
    }
    // A halt with role null that lands on no entry; the agents come back so the resumed run can dispatch.
    const haltAgentMissing = () => {
      rmSync(join(root, '.claude', 'agents', 'code.md'));
      expect(orch(['install', 'code']).err).toMatch(/^ORCH_AGENT_MISSING: /);
      agents();
    };
    const haltInvalid = () => expect(orch(['handback', 'code'], { input: 'Done.\nSNAP_HANDBACK {"v":3}\n' }).err).toMatch(/^ORCH_HANDBACK_INVALID: /);
    const editRun = (edit) => { const run = runFile(); edit(run); runFileText(JSON.stringify(run, null, 2) + '\n'); };
    // A real commit object that HEAD no longer descends from.
    const droppedCommit = () => { fixtureGit('commit', '-q', '--allow-empty', '-m', 'dropped'); const c = head(); fixtureGit('reset', '-q', 'HEAD~1'); return c; };
    const runBytes = () => (existsSync(join(root, RUN_FILE)) ? readFileSync(join(root, RUN_FILE), 'utf8') : null);
    const resumed = (code, gate, kept, dropped, next) => `run FEAT-011 resumed after ${code} from ${gate}: kept ${kept} record(s), dropped ${dropped}; next: ${next}`;
    const roles = () => runFile().handbacks.map((h) => (h.task ? `${h.role}:${h.task}` : h.role));
  ```
  Record tests:
  - RS1 **"RS1 approve records HEAD as each approval's commit in a git repository"**: `driveTo('code', { prep: gitRoot })`; `runFile().approvals.spec.commit` and `runFile().approvals.plan.commit` both `toBe(head())`, and `head()` matches `/^[0-9a-f]{40}$/`.
  - RS2 **"RS2 approve records a null commit outside a git repository"**: `driveTo('code')`; both `runFile().approvals.<kind>.commit` are `toBeNull()`.
  - RS3 **"RS3 handback stores the validated SNAP line verbatim as snap"**: `driveTo('code')`; `runFile().handbacks[0].snap` is `snapOf(handbackLine('spec', 'boundary_routed'))` and `handbacks[1].snap` is `snapOf(handbackLine('plan', 'boundary_routed'))`; then `orch(['install', 'code'])` and `orch(['handback', 'code'], { input: say('code', 'build_executed') })`; `runFile().handbacks[2].snap` is `snapOf(handbackLine('code', 'build_executed'))`.
- [X] [T-103] Red step: `npx vitest run tests/scripts/orchestrate.test.js -t "FEAT-055"`. Predicted full match set, 4 tests, all **red**: A3 (no `commit` key), RS1 and RS2 (`commit` is `undefined`), RS3 (`snap` is `undefined`). Every other test is filtered out. Depends on T-102.
- [X] [T-104] `scripts/orchestrate.mjs`: the shared HEAD helper. Depends on T-103.
  - After `const headCommit = …` (lines 365-368) add:
    ```js
    // A full object name or null: what an approval and the security seat anchor to (FEAT-055, FEAT-034).
    const headObject = (root) => { const head = gitValue(root, ['rev-parse', 'HEAD'], ''); return OBJECT_NAME.test(head) ? head : null; };
    ```
  - `resolveSecurity` (lines 333-334): replace `const head = gitValue(root, ['rev-parse', 'HEAD'], '');` and `const base = OBJECT_NAME.test(head) ? head : null;` with `const base = headObject(root);`. Same value, one definition. `headObject` is a `const` arrow declared below `resolveSecurity`, which is only called at runtime after module evaluation, so the order is safe.
- [X] [T-105] `scripts/orchestrate.mjs`, `approve` (line 774): `const approval = { at: new Date().toISOString(), by: gitValue(root, ['config', 'user.name'], 'unknown'), path: rel, sha256 };` → `const approval = { at: new Date().toISOString(), by: gitValue(root, ['config', 'user.name'], 'unknown'), path: rel, sha256, commit: headObject(root) };`. Add to the comment above `approve` (line 763): `// FEAT-055: and HEAD at that moment, so resume can tell whether history still holds it.` Depends on T-104.
- [X] [T-106] `scripts/orchestrate.mjs`, the SNAP line rides the entry. Depends on T-105.
  - `parseHandback` (lines 468-477): its last line `return env;` → `return { env, snap: json };`, and above the function add `// FEAT-055: the validated text is returned too, so resume can validate the same bytes again.`
  - `handback` (line 746): `const env = parseHandback(text);` → `const { env, snap } = parseHandback(text);`.
  - `handback` (line 753): `const recorded = recordHandback(run, role, env.ops.gate, verdict?.verdict);` → `const recorded = recordHandback(run, role, env.ops.gate, verdict?.verdict, { snap });`.
  - `securityHandback` is not changed (plan decision 2); its call at line 750 still passes `text` only.
  - `auditFix` rewrites the last entry as `{ ...entry, fix }` (line 495), so an audit entry keeps its `snap`.
  - `grep -n "parseHandback(" scripts/orchestrate.mjs` prints the definition and the one call in `handback`.
- [X] [T-107] Green step: `npx vitest run tests/scripts/orchestrate.test.js -t "FEAT-055"`. Predicted: the same 4 tests, all **green**. Then `npx vitest run tests/scripts/orchestrate.test.js`: 429 passed (426 + RS1, RS2, RS3), including `E2b` at line 1930 (no `snap` on the security entry). Depends on T-106.
- [X] [T-108] Stage: `git add -u scripts/orchestrate.mjs`, `git add -u tests/scripts/orchestrate.test.js`, `git add -u docs/superpowers/plans/2026-11-13-feat055-resume-verb-for-halted-orchestrated-runs.md`. Depends on T-107.
- [ ] [T-109] Commit: `feat: approvals record their commit and hand-backs their SNAP line [FEAT-055]`. Depends on T-108.

---

### Task 2: The `resume` verb

**Files:**
- Modify: `tests/scripts/orchestrate.test.js`
- Modify: `scripts/orchestrate.mjs`

- [X] [T-201] `tests/scripts/orchestrate.test.js`, the two existing tests that pin text this task changes. Depends on T-109 (ticks ride this group).
  - Line 345: name `'refuses every verb but end once a run has halted (D12)'` → `'refuses every verb but resume and end once a run has halted (D12, FEAT-055)'`; line 351: expected `'orchestrate: run FEAT-011 halted with ORCH_AGENT_MISSING; recover with end, then start (D12)'` → `'orchestrate: run FEAT-011 halted with ORCH_AGENT_MISSING; recover with resume, or end then start (D12, FEAT-055)'`.
  - Line 1029: name `'[FEAT-061] names review and envelope in the usage line'` → `'[FEAT-061, FEAT-055] names review, resume and envelope in the usage line'`; line 1030: expected string → `'orchestrate: usage: orchestrate.mjs start|install|handback|approve|hash|review|resume|envelope|end'`.
  - No `start` or `end` test is edited (spec AC3).
- [X] [T-202] `tests/scripts/orchestrate.test.js`: inside `describe('resume verb [FEAT-055]', …)`, after RS3, add the resume tests. Depends on T-201. Test names are the filter set predicted in T-203.

  Entry acceptance criteria:
  - RS4 **"RS4 [AC1] a conflict on task 2 of 3 keeps both approvals and re-dispatches task 2"**: `built(2)`; `expect(orch(['handback', 'code'], { input: anchoredSay(head()) }).err).toMatch(/^ORCH_HANDBACK_CONFLICT: /)`; `const approvals = JSON.stringify(runFile().approvals)`; `r = orch(['resume'])` toEqual `{ status: 0, out: resumed('ORCH_HANDBACK_CONFLICT', 'define_approved', 5, 1, 'install code (task 2 of 3)'), err: '' }`; `JSON.stringify(runFile().approvals)` is `approvals`; `runFile()` toMatchObject `{ halt: null, role: null, gate: 'define_approved', tasks: { done: 1 } }`; `roles()` toEqual `['spec', 'plan', 'code:Task 1']`; `JSON.parse(orch(['install', 'code', '--check']).out).ops.scope` toEqual `['src/b.js', PLAN]`.
  - RS5 **"RS5 [AC1] a halt with code dispatched on task 2 keeps both approvals and re-dispatches task 2"**: `built(1)`; `orch(['install', 'code'])` status 0; `haltInvalid()`; `runFile().role` is `'code'`; `orch(['resume']).out` is `resumed('ORCH_HANDBACK_INVALID', 'define_approved', 5, 0, 'install code (task 2 of 3)')`; `runFile()` toMatchObject `{ halt: null, role: null, tasks: { done: 1 } }`; the `--check` scope is `['src/b.js', PLAN]`.
  - RS6 `it.each` **"RS6 [AC1] a conflict on the approved %s keeps its entry and continues with %s"**, rows `['spec', 'install plan', 'boundary_routed', 2]` and `['plan', 'install code (task 1 of 2)', 'define_approved', 4]`: `driveTo(kind === 'spec' ? 'plan' : 'code', { prep: gitRoot })`; `orch(['handback', kind], { input: say(kind, 'boundary_routed') }).err` matches `/^ORCH_HANDBACK_CONFLICT: /`; `const approvals = JSON.stringify(runFile().approvals)`; `orch(['resume']).out` is `resumed('ORCH_HANDBACK_CONFLICT', gate, kept, 0, next)`; `runFile().gate` is `gate`; `roles().at(-1)` is `kind`; approvals unchanged; `orch(['install', kind === 'spec' ? 'plan' : 'code', '--check']).status` is 0.
  - RS7 `it.each` **"RS7 [AC2] an edited approved %s refuses ORCH_APPROVED_DOC_CHANGED and writes nothing"**, rows `['spec', () => writeFileSync(join(root, SPEC), '# Demo spec, revised\n')]` and `['plan', () => plan(THREE_TASKS.replace('thing 2', 'thing two'))]`: `built(1)`; `haltAgentMissing()`; `edit()`; `const before = runBytes(); const env = envelopeText();`; `r = orch(['resume'])`; `r.status` is 2; `r.err` matches ``new RegExp(`^orchestrate: ORCH_APPROVED_DOC_CHANGED: ${kind} `)`` and ends with `; recover with end, then start`; `runBytes()` is `before`; `envelopeText()` is `env`.
  - RS8 **"RS8 [AC2] a ticked plan checkbox is not a change: the resume succeeds"**: `built(1)`; `haltAgentMissing()`; `plan(THREE_TASKS.replace('- [ ] **Step 1', '- [X] **Step 1'))`; `orch(['resume']).status` is 0; `runFile().halt` is `null`.
  - RS9 **"RS9 [AC3] start in the run's own session still refuses ORCH_RUN_ACTIVE on a halted run"**: `built(1)`; `haltAgentMissing()`; `const before = runBytes()`; `orch(['start', 'FEAT-011'])` toMatchObject `{ status: 1, err: 'ORCH_RUN_ACTIVE: run FEAT-011 is live in this session; end it first' }`; `runBytes()` is `before`.
  - RS10 **"RS10 [AC3] end on a resumed and re-halted run prints the record and removes every run file"**: `built(1)`; `haltAgentMissing()`; `orch(['resume']).status` is 0; `orch(['install', 'code']).status` is 0; `haltInvalid()`; write `.conductor/handback/code-2.txt` and `.conductor/review/spec-1.md` (`mkdirSync` recursive, any text); `r = orch(['end'])`; `r.status` is 0; `JSON.parse(r.out)` toMatchObject `{ item: 'FEAT-011', halt: { code: 'ORCH_HANDBACK_INVALID' } }` and its `resumes` has length 1 with `halt.code` `'ORCH_AGENT_MISSING'`; `existsSync` is false for `RUN_FILE`, `ENVELOPE_FILE`, `HANDBACK_DIR` and `REVIEW_DIR`.

  Issue #185's validation:
  - RS11 `it.each` **"RS11 [AC4] %s cuts the sequence there"**, rows `[name, index, edit, done, kept, dropped, next]`, each after `built(2)` and `haltAgentMissing()`, then `editRun((run) => edit(run.handbacks[index]))`, then `orch(['resume']).out` is `resumed('ORCH_AGENT_MISSING', 'define_approved', kept, dropped, next)`, `runFile().tasks.done` is `done`, `runFile().resumes[0]` toMatchObject `{ kept, dropped }`:
    - `a corrupted snap on task 2` → `3`, `(h) => { h.snap = '{"v":3}'; }`, `1`, `5`, `1`, `'install code (task 2 of 3)'`
    - `a corrupted snap on task 1` → `2`, same edit, `0`, `4`, `2`, `'install code (task 1 of 3)'`
    - `a task entry with no snap (written before FEAT-055)` → `3`, `(h) => { delete h.snap; }`, `1`, `5`, `1`, `'install code (task 2 of 3)'`
  - RS12 **"RS12 [AC5] a task entry whose sys.c HEAD does not descend from is cut"**: `built(0)`; `orch(['install', 'code'])` status 0; `const c = droppedCommit()`; `orch(['handback', 'code'], { input: anchoredSay(c) }).status` is 0; `haltAgentMissing()`; `orch(['resume']).out` is `resumed('ORCH_AGENT_MISSING', 'define_approved', 4, 1, 'install code (task 1 of 3)')`; `runFile().tasks.done` is 0.
  - RS13 **"RS13 [AC5] a task entry whose sys.c is the c of the envelope install code wrote is kept"**: `built(0)`; `orch(['install', 'code'])` status 0; `const c = envelope().sys.c`; `c` is `head()`; `orch(['handback', 'code'], { input: anchoredSay(c) }).status` is 0; `haltAgentMissing()`; `orch(['resume']).status` is 0; `runFile().tasks.done` is 1; `JSON.parse(runFile().handbacks[2].snap).sys.c` is `c`.
  - RS14 **"RS14 [AC5] HEAD reset to before the plan approval's commit refuses ORCH_RESUME_HISTORY_REWRITTEN"**: `driveTo('plan', { prep: gitRoot })`; `const base = head()`; `fixtureGit('commit', '-q', '--allow-empty', '-m', 'later')`; `const later = head()`; `orch(['install', 'plan'])`, `orch(['handback', 'plan'], { input: say('plan', 'boundary_routed') })`, `skipLoop('plan')`, `orch(approveArgs('plan')).status` is 0; `runFile().approvals.plan.commit` is `later`; `haltAgentMissing()`; `fixtureGit('reset', '-q', 'HEAD~1')`; `const before = runBytes(); const env = envelopeText();`; `orch(['resume'])` toMatchObject `{ status: 2, err: \`orchestrate: ORCH_RESUME_HISTORY_REWRITTEN: HEAD ${base} does not descend from the plan approval's commit ${later}; recover with end, then start\` }`; `runBytes()` is `before`; `envelopeText()` is `env`.

  Anything after the gate is redone:
  - RS15 **"RS15 [AC6] a Verify halt keeps every task, drops every audit and fix entry, and redoes Verify"**: `built(2, { planText: TWO_TASKS, start: ['--audit-rounds', '1'] })`; `const returned = auditReport('VERDICT: RETURN', ['- [blocker] src/a.js:10 — breaks AC1'])`; `orch(['install', 'audit'])`, `orch(['handback', 'audit'], { input: returned }).status` is 0; `orch(['install', 'code'])`, `orch(['handback', 'code'], { input: say('code', 'build_executed') }).status` is 0; `orch(['install', 'audit'])`, `orch(['handback', 'audit'], { input: returned }).err` matches `/^ORCH_AUDIT_RETURN: /`; `orch(['resume']).out` is `resumed('ORCH_AUDIT_RETURN', 'build_executed', 6, 3, 'install audit')`; `runFile()` toMatchObject `{ gate: 'build_executed', tasks: { done: 2 } }`; `roles()` toEqual `['spec', 'plan', 'code:Task 1', 'code:Task 2']`; `orch(['install', 'audit', '--check']).status` is 0.
  - RS16 **"RS16 [AC6] a Define halt after the spec approval drops the plan entry and its loop and redoes the plan"**: `driveTo('plan', { prep: gitRoot })`; `plan('# Plan\n\nNo tasks here.\n')`; `orch(['install', 'plan'])`, `orch(['handback', 'plan'], { input: say('plan', 'boundary_routed') })`, `skipLoop('plan')`; `orch(approveArgs('plan')).err` matches `/^ORCH_EMPTY_SCOPE: /`; `orch(['resume']).out` is `resumed('ORCH_EMPTY_SCOPE', 'boundary_routed', 2, 1, 'install plan')`; `runFile()` toMatchObject `{ gate: 'boundary_routed', approvals: { plan: null } }`; `roles()` toEqual `['spec']`; `Object.keys(runFile().review)` toEqual `['spec']`; `orch(['install', 'plan', '--check']).status` is 0.

  Refusals write nothing:
  - RS17 `it.each` **"RS17 [AC7] %s refuses with exit 2 and writes nothing"**, rows `[name, setup, args, sid, prefix]`, each after `built(1)` and `haltAgentMissing()`, then `setup()`, then `const before = runBytes(); const env = envelopeText();`, then `r = orch(args, { sid })`; `r.status` is 2; `r.err.startsWith(prefix)` is true; `runBytes()` is `before`; `envelopeText()` is `env`. Default `args` is `['resume']` and default `sid` is `'sess-1'`:
    - `an argument after resume` → `() => {}`, `['resume', 'now']`, prefix `'orchestrate: usage: orchestrate.mjs resume'`
    - `ORCH_RESUME_NO_RUN with no run file` → `() => rmSync(join(root, RUN_FILE))`, prefix `'orchestrate: ORCH_RESUME_NO_RUN: '`
    - `ORCH_RESUME_NO_RUN with an invalid run file` → `() => runFileText('{"v":1}\n')`, same prefix
    - `ORCH_RESUME_NOT_HALTED` → `() => editRun((r) => { r.halt = null; })`, prefix `'orchestrate: ORCH_RESUME_NOT_HALTED: run FEAT-011 is not halted; continue with install code'`
    - `ORCH_NO_SESSION_ID with no id` → `() => {}`, sid `null`, prefix `'orchestrate: ORCH_NO_SESSION_ID: '`
    - `ORCH_NO_SESSION_ID with an empty id` → `() => {}`, sid `''`, same prefix
    - `ORCH_RESUME_NO_GATE` → `() => editRun((r) => { r.approvals = { spec: null, plan: null }; })`, prefix `'orchestrate: ORCH_RESUME_NO_GATE: '`
    - `ORCH_APPROVAL_UNHASHED` → `() => editRun((r) => { delete r.approvals.spec.sha256; })`, prefix `'orchestrate: ORCH_APPROVAL_UNHASHED: '`
    - `ORCH_RESUME_UNANCHORED with no commit` → `() => editRun((r) => { delete r.approvals.plan.commit; })`, prefix `'orchestrate: ORCH_RESUME_UNANCHORED: the plan approval records no commit'`
    - `ORCH_RESUME_UNANCHORED with a null commit` → `() => editRun((r) => { r.approvals.spec.commit = null; })`, prefix `'orchestrate: ORCH_RESUME_UNANCHORED: the spec approval records a null commit'`
    - `ORCH_RESUME_UNANCHORED when git cannot answer` → `() => editRun((r) => { r.approvals.plan.commit = 'f'.repeat(40); })`, prefix `'orchestrate: ORCH_RESUME_UNANCHORED: the plan approval commit '`
    - `ORCH_APPROVED_DOC_CHANGED` → `() => writeFileSync(join(root, SPEC), '# Changed\n')`, prefix `'orchestrate: ORCH_APPROVED_DOC_CHANGED: spec '`
    - `ORCH_RESUME_HISTORY_REWRITTEN` → `() => { const c = droppedCommit(); editRun((r) => { r.approvals.plan.commit = c; }); }`, prefix `'orchestrate: ORCH_RESUME_HISTORY_REWRITTEN: '`

  The record:
  - RS18 **"RS18 [AC8] a resume records itself, binds the caller's session and removes the envelope"**: `built(1)`; `haltAgentMissing()`; `const halt = runFile().halt`; `orch(['resume'], { sid: 'sess-2' }).out` is `resumed('ORCH_AGENT_MISSING', 'define_approved', 5, 0, 'install code (task 2 of 3)')`; `runFile().session_id` is `'sess-2'`; `runFile().resumes` toEqual `[{ at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), halt, kept: 5, dropped: 0 }]`; `existsSync(join(root, ENVELOPE_FILE))` is false; `orch(['install', 'code', '--check'], { sid: 'sess-2' }).status` is 0 and `orch(['install', 'code', '--check']).err` is `'orchestrate: run FEAT-011 belongs to another session; end it, or start to replace it'`.
  - RS19 **"RS19 [AC8] a second halt after a resume is resumed again and appends its own entry"**: `built(1)`; `haltAgentMissing()`; `orch(['resume']).status` is 0; `orch(['install', 'code']).status` is 0; `haltInvalid()`; `orch(['resume']).status` is 0; `runFile().resumes.map((x) => x.halt.code)` toEqual `['ORCH_AGENT_MISSING', 'ORCH_HANDBACK_INVALID']`.
  - RS20 **"RS20 [AC8] isValidRun accepts a run file with or without the new fields"**: `const base = { v: 1, session_id: 's', item: 'FEAT-011', gate: 'boundary_routed', approvals: { spec: null, plan: null }, handbacks: [], tasks: { ids: [], done: 0 } }`; `isValidRun(base)` is true; `isValidRun({ ...base, resumes: [{ at: 'x', halt: { code: 'C', reason: 'r', at: 'x' }, kept: 2, dropped: 0 }], handbacks: [{ role: 'spec', gate: 'boundary_routed', at: 'x', snap: '{}' }], approvals: { spec: { at: 'x', by: 'b', path: SPEC, sha256: 'a'.repeat(64), commit: null }, plan: null } })` is true.
  - Close the describe with `});`.
- [X] [T-203] Red step: `npx vitest run tests/scripts/orchestrate.test.js -t "FEAT-055"`. Predicted full match set, 39 tests: **green** 6 (A3, RS1, RS2, RS3 from Task 1; RS9, because `start` already refuses a halted run of its own session; RS20, because `isValidRun` ignores extra fields today); **red** 33 (the renamed D12 test and the renamed usage-line test, whose new texts are not printed yet, and every other new test, 31 including the 13 RS17 rows, since `resume` is still an unknown verb and is refused with the general usage line). Depends on T-202.
- [X] [T-204] `scripts/orchestrate.mjs`, text the verb changes. Depends on T-203.
  - Line 71 comment: `// A halt stops the run and is recorded in it (D12). A refusal is a misuse of the CLI:` → `// A halt stops the run and is recorded in it (D12); resume clears it from the last gate whose record still validates (FEAT-055). A refusal is a misuse of the CLI:`. The next comment line stays.
  - Line 135 comment: `// Every verb but start and end drives a run that must exist, be this session's, and not be halted.` → `// Every verb but start, resume and end drives a run that must exist, be this session's, and not be halted.`
  - Line 141: `recover with end, then start (D12)` → `recover with resume, or end then start (D12, FEAT-055)`.
- [X] [T-205] `scripts/orchestrate.mjs`, `checkApprovedDocs` (lines 405-416) becomes a shared helper and its loop (plan decision 3). Depends on T-204. Replace the function with:
  ```js
  // FEAT-056: after define_approved, a changed spec or plan means the run would execute text nobody approved.
  // FEAT-055: returned, not thrown, so resume refuses with the same text where install halts.
  function approvedDocHalt(root, run, kind) {
    const { path, sha256 } = run.approvals[kind] ?? {};
    if (typeof path !== 'string' || typeof sha256 !== 'string') {
      return new Halt('ORCH_APPROVAL_UNHASHED', `run ${run.item} records an approval without a document hash (started before FEAT-056); run end, then start`);
    }
    const now = currentHash(root, kind, path);
    if (now === sha256) return null;
    return new Halt('ORCH_APPROVED_DOC_CHANGED', `${kind} ${path} was approved at sha256 ${sha256} and ${now ? `now hashes ${now}` : 'can no longer be read'}`);
  }

  function checkApprovedDocs(root, run) {
    for (const kind of ['spec', 'plan']) {
      const failure = approvedDocHalt(root, run, kind);
      if (failure) throw failure;
    }
  }
  ```
  Messages and order are unchanged, so every FEAT-056 B-test stays green.
- [X] [T-206] `scripts/orchestrate.mjs`, the resume helpers. Insert after `checkLoopClosed` (ends line 799) and before `reviewWellFormed`. Depends on T-205.
  ```js
  const RESUME_USAGE = 'usage: orchestrate.mjs resume';
  const RESTART = 'recover with end, then start';
  const RECORD_KINDS = ['spec', 'plan'];

  // FEAT-055: every failure is a refusal, so a failed resume leaves the halt it was asked to clear as it was.
  function haltedRun(root, sessionId, args) {
    if (args.length > 0) throw new Refusal(RESUME_USAGE);
    let run = null;
    try { run = readRun(root); } catch { /* an invalid run file is judged below */ }
    if (!run) throw new Refusal(`ORCH_RESUME_NO_RUN: no valid run file at ${join(root, RUN_FILE)}`);
    if (!run.halt) throw new Refusal(`ORCH_RESUME_NOT_HALTED: run ${run.item} is not halted; continue with ${describeStep(nextStep(run))}`);
    if (!sessionId) throw new Refusal('ORCH_NO_SESSION_ID: CLAUDE_CODE_SESSION_ID is absent or empty, so Guard 6 could never bind this run');
    if (!run.approvals.spec) throw new Refusal(`ORCH_RESUME_NO_GATE: run ${run.item} records no spec approval, so no gate is left to resume from; ${RESTART}`);
    return run;
  }

  // 0: HEAD descends from commit; 1: it does not; anything else: git cannot answer. A non-hex name never reaches git as an option.
  function ancestry(root, commit) {
    if (typeof commit !== 'string' || !/^[0-9a-f]{7,64}$/.test(commit)) return null;
    return spawnSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: root, encoding: 'utf8' }).status;
  }

  const unanchored = (kind, reason) => new Refusal(`ORCH_RESUME_UNANCHORED: the ${kind} approval ${reason}; ${RESTART}`);

  // An approval is the owner's act, which the run cannot redo, so a failing one refuses the whole resume.
  function checkApproval(root, run, kind) {
    const failure = approvedDocHalt(root, run, kind);
    if (failure?.code === 'ORCH_APPROVAL_UNHASHED') throw new Refusal(failure.message);
    const { commit } = run.approvals[kind];
    if (commit === undefined) throw unanchored(kind, 'records no commit (approved before FEAT-055)');
    if (commit === null) throw unanchored(kind, 'records a null commit (approved outside a git repository or before its first commit)');
    if (failure) throw new Refusal(`${failure.message}; ${RESTART}`);
    const answer = ancestry(root, commit);
    if (answer === 1) {
      throw new Refusal(`ORCH_RESUME_HISTORY_REWRITTEN: HEAD ${gitValue(root, ['rev-parse', 'HEAD'], 'unknown')} does not descend from the ${kind} approval's commit ${commit}; ${RESTART}`);
    }
    if (answer !== 0) throw unanchored(kind, `commit ${String(commit)} cannot be checked against HEAD`);
  }
  ```
  `failure.message` is `<code>: <reason>`, the `Halt` constructor's text, so the refusal reads `orchestrate: ORCH_APPROVED_DOC_CHANGED: …` (spec AC2).
- [X] [T-207] `scripts/orchestrate.mjs`, the record walk, right after `checkApproval`. Depends on T-206.
  ```js
  // The conflict's last entry is ambiguous, except a spec or plan entry whose approval already stands.
  function candidateEntries(run) {
    const last = run.handbacks.at(-1);
    if (run.halt.code !== 'ORCH_HANDBACK_CONFLICT' || !last) return run.handbacks;
    return RECORD_KINDS.includes(last.role) && run.approvals[last.role] ? run.handbacks : run.handbacks.slice(0, -1);
  }

  // A task entry still describes the repository: its position, its SNAP and its commit all hold.
  function taskEntryHolds(root, entry, taskId) {
    if (entry.task !== taskId || typeof entry.snap !== 'string' || validate(`${entry.snap}\n`) !== '') return false;
    let env = null;
    try { env = JSON.parse(entry.snap); } catch { return false; }
    return env?.sys?.role === 'code' && ancestry(root, env.sys.c) === 0;
  }

  // Each approved document's entry, then Build's task entries up to the first that fails; Verify is always redone.
  function keptEntries(root, run) {
    const entries = candidateEntries(run);
    const approved = RECORD_KINDS.filter((k) => run.approvals[k]).map((k) => entries.find((h) => h.role === k)).filter(Boolean);
    if (!run.approvals.plan) return { kept: approved, tasks: 0 };
    const tasks = entries.filter((h) => h.role === 'code' && !('fix' in h));
    let n = 0;
    while (n < tasks.length && n < run.tasks.ids.length && taskEntryHolds(root, tasks[n], run.tasks.ids[n])) n += 1;
    return { kept: [...approved, ...tasks.slice(0, n)], tasks: n };
  }

  // Only approvePlan writes define_approved, and only the last task's hand-back forwards build_executed.
  const resumedGate = (run, tasks) => (!run.approvals.plan ? 'boundary_routed' : tasks < run.tasks.ids.length ? 'define_approved' : 'build_executed');

  // A dropped document's loop is cleared with it, so the redone document gets a fresh review loop.
  const resumedReview = (run, kept) => (isPlainObject(run.review)
    ? Object.fromEntries(Object.entries(run.review).filter(([k]) => kept.some((h) => h.role === k))) : run.review);

  function nextLine(run) {
    const step = nextStep(run);
    return step.task ? `${describeStep(step)} (task ${run.tasks.done + 1} of ${run.tasks.ids.length})` : describeStep(step);
  }
  ```
- [X] [T-208] `scripts/orchestrate.mjs`, the verb, right after `nextLine`. Depends on T-207.
  ```js
  // FEAT-055: back to the last gate whose record still validates; every record after it is dropped and redone.
  function resume(root, sessionId, args) {
    const run = haltedRun(root, sessionId, args);
    const approvals = RECORD_KINDS.filter((k) => run.approvals[k]);
    for (const kind of approvals) checkApproval(root, run, kind);
    const { kept, tasks } = keptEntries(root, run);
    const records = kept.length + approvals.length;
    const dropped = run.handbacks.length - kept.length;
    const { code, reason, at } = run.halt;
    const resumes = [...(Array.isArray(run.resumes) ? run.resumes : []), { at: new Date().toISOString(), halt: { code, reason, at }, kept: records, dropped }];
    const next = {
      ...run, session_id: sessionId, role: null, halt: null, gate: resumedGate(run, tasks),
      handbacks: kept, tasks: { ...run.tasks, done: tasks }, review: resumedReview(run, kept), resumes,
    };
    saveRun(root, next);
    // The halted agent's envelope; the hand-back and review files stay for the owner and are overwritten on re-dispatch.
    rmSync(join(root, ENVELOPE_FILE), { force: true });
    return `run ${run.item} resumed after ${code} from ${next.gate}: kept ${records} record(s), dropped ${dropped}; next: ${nextLine(next)}`;
  }
  ```
  `band`, `plan`, `tasks.ids`, `mode`, `test_command`, `audit_rounds`, `security`, `docs`, `ticket` and `approvals` ride through `...run` unchanged (spec main path, step 5). A `review` that was `undefined` stays `undefined`, which `JSON.stringify` omits.
- [X] [T-209] `scripts/orchestrate.mjs`, `cli` (lines 1035-1058). Depends on T-208.
  - In `verbs`, after `review: …` add `resume: () => resume(root, sid, argv.slice(1)),`.
  - Line 1047: the usage string → `'usage: orchestrate.mjs start|install|handback|approve|hash|review|resume|envelope|end'`.
  - Line 1054: `if (verb !== 'start' && verb !== 'envelope') recordHalt(root, e);` → `if (!['start', 'envelope', 'resume'].includes(verb)) recordHalt(root, e);`, with the comment `// resume never records a halt: one thrown by a helper it reuses must not overwrite the halt it was resuming (FEAT-055).` above it.
  - `grep -n "function resume\|resume: ()" scripts/orchestrate.mjs` prints one definition and one verb entry.
- [X] [T-210] Green step: `npx vitest run tests/scripts/orchestrate.test.js -t "FEAT-055"`. Predicted: the same 39 tests, all **green**. Then `npx vitest run tests/scripts/orchestrate.test.js`: 462 passed (429 + 33). Depends on T-209.
- [X] [T-211] Stage: `git add -u scripts/orchestrate.mjs`, `git add -u tests/scripts/orchestrate.test.js`, `git add -u docs/superpowers/plans/2026-11-13-feat055-resume-verb-for-halted-orchestrated-runs.md`. Depends on T-210.
- [ ] [T-212] Commit: `feat: resume a halted run from its last gate that still validates [FEAT-055]`. Depends on T-211.

---

### Task 3: `/cc-orchestrate` describes `resume`

**Files:**
- Modify: `tests/installer/commands-parity.test.js`
- Modify: `.claude/commands/cc-orchestrate.md`
- Modify: `project-template/.claude/commands/cc-orchestrate.md`

- [X] [T-301] `tests/installer/commands-parity.test.js`: in `describe('cc-orchestrate mirrors [FEAT-011 AC10]', …)`, after the FEAT-057 test that ends just before the describe's closing `});` at line 288, add: Depends on T-212 (ticks ride this group).
  ```js
  it('offers resume on a halt, names its refusals and reports each resume [FEAT-055]', () => {
    const text = read(ORCH_MIRRORS[0]);
    for (const phrase of ['A halt stops the run (D12, amended by FEAT-055).', '**Resume (FEAT-055).**', 'node "$S/orchestrate.mjs" resume',
      'run it only on the owner\'s word', 'continue at step 2 with the step it names', '`ORCH_RESUME_NO_RUN`', '`ORCH_RESUME_NOT_HALTED`',
      '`ORCH_NO_SESSION_ID`', '`ORCH_RESUME_NO_GATE`', '`ORCH_APPROVAL_UNHASHED`', '`ORCH_RESUME_UNANCHORED`', '`ORCH_APPROVED_DOC_CHANGED`',
      '`ORCH_RESUME_HISTORY_REWRITTEN`', 'each `resumes` entry']) expect(text).toContain(phrase);
    expect(text).not.toContain('A halt is terminal in v1');
  });
  ```
- [X] [T-302] Red step: `npx vitest run tests/installer/commands-parity.test.js`. Predicted full match set, 87 tests: the new test **red** (no new phrase present, and `A halt is terminal in v1` still is); the 86 others **green**. Depends on T-301.
- [X] [T-303] `.claude/commands/cc-orchestrate.md`, then the identical edit to `project-template/.claude/commands/cc-orchestrate.md`. Depends on T-302.
  - "On any halt", line 33: replace `A halt is terminal in v1 (D12). Recovery is \`node "$S/orchestrate.mjs" end\`, then a fresh \`start\`, each only on the owner's word.` with `A halt stops the run (D12, amended by FEAT-055). Recovery is \`node "$S/orchestrate.mjs" resume\` (below), or \`node "$S/orchestrate.mjs" end\`, then a fresh \`start\`, each only on the owner's word. Where a halt below names \`end\`, then \`start\`, \`resume\` is the other recovery; it refuses, writing nothing, when a record it would keep no longer validates.` The sentence after it (`install spec|plan` halts `ORCH_DOC_LOCATION_UNRESOLVED` …) stays.
  - After the security paragraph (line 39), the last paragraph before `## Steps`, add a blank line and:
    > `**Resume (FEAT-055).** Offer \`resume\` next to \`end\` when the run recorded the spec approval; run it only on the owner's word, as \`end\`. \`node "$S/orchestrate.mjs" resume\` takes no argument. It keeps both approvals when each approved document still hashes as approved and HEAD descends from the commit each approval recorded, then keeps the Build task hand-backs, in order, while each stored SNAP still validates and HEAD descends from its commit. Every record after the first that fails, and every Verify record (audit, fix round, security, qa), is dropped and redone. On success it prints \`run <ITEM> resumed after <code> from <gate>: kept <k> record(s), dropped <d>; next: <step>\`: print the run header again and continue at step 2 with the step it names (\`install <role> --check\`, the pause in step mode, \`install <role>\`, a fresh dispatch); never revive the halted agent. A refusal exits 2 and writes nothing, so the run stays halted: \`ORCH_RESUME_NO_RUN\` (no valid run file), \`ORCH_RESUME_NOT_HALTED\` (the run is live: continue with the step it names), \`ORCH_NO_SESSION_ID\`, \`ORCH_RESUME_NO_GATE\` (no spec approval), \`ORCH_APPROVAL_UNHASHED\` (approved before FEAT-056), \`ORCH_RESUME_UNANCHORED\` (an approval records no commit, or git cannot check it), \`ORCH_APPROVED_DOC_CHANGED\` (an approved document changed; a ticked plan checkbox is not a change) and \`ORCH_RESUME_HISTORY_REWRITTEN\` (HEAD no longer descends from an approval's commit). After any of them but \`ORCH_RESUME_NOT_HALTED\`, recovery is \`end\`, then \`start\`.`
  - Step 6, "Report": after the bullet `   - each review loop's outcome and round, from the record's \`review\` field;` add the bullet `   - each \`resumes\` entry: when it ran, the halt it cleared (code and reason), and how many records it kept and dropped;`.
  - The exit-code section (lines 23-26) is read and left as it is: a failed `resume` is an ordinary exit-2 refusal (spec, System Impact).
- [X] [T-304] Green step: `npx vitest run tests/installer/commands-parity.test.js`. Predicted: 87 passed (the byte-identical mirror test included). Depends on T-303.
- [X] [T-305] Stage: `git add -u .claude/commands/cc-orchestrate.md`, `git add -u project-template/.claude/commands/cc-orchestrate.md`, `git add -u tests/installer/commands-parity.test.js`, `git add -u docs/superpowers/plans/2026-11-13-feat055-resume-verb-for-halted-orchestrated-runs.md`. Depends on T-304.
- [ ] [T-306] Commit: `docs: cc-orchestrate offers resume after a halt [FEAT-055]`. Depends on T-305.

---

### Task 4: The wiki pages stop saying a halted run cannot resume

**Files:**
- Modify: `.github/wiki/pages/FAQ.md`
- Modify: `.github/wiki/pages/Orchestrator-Guide.md`
- Modify: `.github/wiki/pages/C4-Components.md`

- [X] [T-401] `.github/wiki/pages/FAQ.md`, "The orchestrator halted — how do I recover?" (lines 78-88). Depends on T-306 (ticks ride this group).
  - Line 80: `A halted run cannot be resumed, only ended and restarted:` → `Resume it, or end it and start again. \`resume\` (FEAT-055) keeps the approved spec and plan and every Build task hand-back that still validates, and redoes everything after; it refuses, writing nothing, when an approved document changed or HEAD no longer descends from an approval's commit:`.
  - In the code block, before `# End the current run (removes the run file and the band envelope)` add the two lines `# Resume from the last gate whose record still validates` and `node .claude/scripts/orchestrate.mjs resume`, then a blank line; the comment line becomes `# Or end the current run (removes the run file and the band envelope)`.
  - Line 88: `Then start fresh with \`/cc-orchestrate <ITEM>\`, which runs \`orchestrate.mjs start <ITEM>\` for you.` → `After \`resume\`, \`/cc-orchestrate\` continues with the step it prints. After \`end\`, start fresh with \`/cc-orchestrate <ITEM>\`, which runs \`orchestrate.mjs start <ITEM>\` for you.`
- [X] [T-402] `.github/wiki/pages/Orchestrator-Guide.md`, "Recovery" (lines 76-83). No dependency on T-401.
  - Line 78: `A failed validation halts the run terminally:` → `A failed validation halts the run:`. The rest of the line stays.
  - The code block becomes:
    ```
    node .claude/scripts/orchestrate.mjs resume   # keep the record up to the last gate that still validates, or
    node .claude/scripts/orchestrate.mjs end      # then
    /cc-orchestrate <ITEM>                        # fresh start
    ```
  - After the block, before the `The band flow and the SNAP handoff …` line, add a blank line and: `\`resume\` (FEAT-055) keeps both approvals and every Build task hand-back that still validates, and redoes the rest, Verify included; it refuses, writing nothing, when an approved document changed or HEAD no longer descends from an approval's commit.`
- [X] [T-403] `.github/wiki/pages/C4-Components.md`, line 139. No dependency on T-402. Replace `` The verbs are `start`, `install`, `handback`, `approve`, `hash`, `review` and `end`. `` with `` The verbs are `start`, `install`, `handback`, `approve`, `hash`, `review`, `resume` and `end`. `` and `A halted run cannot resume: end it, then start again.` with `` A halted run resumes from the last gate whose record still validates (`resume`, FEAT-055), or is ended and started again. `` The rest of the line stays.
- [X] [T-404] Run `npx vitest run tests/wiki/wiki-gen.test.js`. Predicted: 22 passed (the edited lines are prose outside every generated block). Depends on T-401, T-402, T-403.
- [X] [T-405] Stage: `git add -u .github/wiki/pages/FAQ.md`, `git add -u .github/wiki/pages/Orchestrator-Guide.md`, `git add -u .github/wiki/pages/C4-Components.md`, `git add -u docs/superpowers/plans/2026-11-13-feat055-resume-verb-for-halted-orchestrated-runs.md`. Depends on T-404.
- [ ] [T-406] Commit: `docs: the wiki describes resume after a halt [FEAT-055]`. Depends on T-405.

---

### Task 5: Full suite and closeout

**Files:**
- Modify: `docs/superpowers/plans/2026-11-13-feat055-resume-verb-for-halted-orchestrated-runs.md`

- [X] [T-501] Run `npm test`. Predicted locally: exit 0, every file green, 37 tests more than the pre-change suite (36 in `orchestrate.test.js`, 1 in `commands-parity.test.js`; A3, the D12 test and the usage-line test are renamed, not added), no new skip. CI legs: each leg's skipped set equals its `tools/skip-baseline.json` key, unchanged, because no added test is conditional. Depends on T-406.
- [X] [T-502] Grep checks: `git grep -n "halt is terminal\|cannot be resumed\|cannot resume" -- .claude/commands project-template/.claude/commands .github/wiki scripts` prints nothing; `git grep -n "recover with end, then start (D12)" -- scripts tests` prints nothing; `cmp .claude/commands/cc-orchestrate.md project-template/.claude/commands/cc-orchestrate.md` exits 0; `git diff --stat origin/main -- VERSION package.json package-lock.json CHANGELOG.md "AGENT-READABLE BACKLOG.md" README.md .claude/memory .github/workflows .github/actions` prints nothing. Depends on T-501.
- [X] [T-503] Stage: `git add -u docs/superpowers/plans/2026-11-13-feat055-resume-verb-for-halted-orchestrated-runs.md` (ticks T-406 to T-502). Depends on T-502.
- [ ] [T-504] Commit: `docs: close out the FEAT-055 plan [FEAT-055]`. Depends on T-503.

---

## Test List

- [X] Unit: `isValidRun` accepts a run file without any FEAT-055 field and one with `resumes`, `snap` and `commit` (RS20).
- [X] Integration (CLI, real argv/stdin/env contract, temp git repository): `approve` records `commit` equal to HEAD, and `null` outside git (RS1, RS2, A3); `handback` stores the validated SNAP text verbatim as `snap` (RS3).
- [X] Integration, entry AC1: a conflict on task 2 of 3 and a halt with `code` dispatched both keep the approvals byte-for-byte and re-dispatch task 2 (RS4, RS5); a conflict on an approved spec or plan keeps that entry and continues with `install plan` or task 1 (RS6).
- [X] Integration, entry AC2: an edited approved spec or plan refuses `ORCH_APPROVED_DOC_CHANGED` with the run file and envelope byte-identical (RS7); a ticked plan box resumes (RS8).
- [X] Integration, entry AC3: `start` still refuses `ORCH_RUN_ACTIVE` on its own halted run (RS9); `end` on a resumed, re-halted run prints the record with `resumes` and removes every run file (RS10); no existing `start` or `end` test is edited.
- [X] Integration, issue #185: a corrupted or missing `snap` cuts the sequence at that task (RS11); a `sys.c` HEAD does not descend from cuts it (RS12); the envelope's `c` is kept (RS13); HEAD reset past the plan approval's commit refuses `ORCH_RESUME_HISTORY_REWRITTEN` (RS14).
- [X] Integration, AC6: a Verify halt keeps every task, drops audits and fix rounds and redoes `audit` (RS15); a Define halt after the spec approval drops the plan entry and `review.plan` and redoes `plan` (RS16).
- [X] Integration, AC7: every row of the error table, 13 cases, exits 2 with its prefix, the run file's bytes and the envelope unchanged (RS17).
- [X] Integration, AC8: the `resumes` entry, the session binding, the envelope removal and the printed line (RS18); a second resume appends a second entry (RS19).
- [X] Regression: the D12 test pins the new `liveRun` text; the usage-line test names `resume`; the FEAT-059 `E2b` test still pins the security entry's keys without `snap`; every FEAT-056 B-test passes on the split `checkApprovedDocs`.
- [X] Command pin, AC9: `cc-orchestrate.md` amends D12, describes `resume` with its refusals and its continuation at step 2, and names `resumes` in the report; the mirrors stay byte-identical.
- [X] No E2E/UI test: there is no UI.

## Commit Order

0. Task 0 — the plan and its `.gitignore` leaf (done by this session's commit).
1. Task 1 — the two new record fields and their tests, one commit: the suite stays green because A3 is widened in the same commit.
2. Task 2 — the verb, the `liveRun` text, `cli`, and the two pinned tests that change with them, one commit.
3. Task 3 — both `cc-orchestrate.md` copies and their pin, one commit, so the mirror test never sees one copy changed.
4. Task 4 — the three wiki pages.
5. Task 5 — closeout of the plan ticks. The ticks of T-503 and T-504 are made after the last commit and ride whichever commit next stages this plan.

## Identified Risks

- **The fixture root must not sit inside a git work tree.** RS2 and A3 expect `commit: null`. Checked: `git -C "$TMPDIR" rev-parse --git-dir` fails here, and the FEAT-034 tests already rely on the same property for `security.base: null` (line 1742). If a CI leg ever ran inside a repository, RS2 would fail loudly, not silently.
- **Fixture hand-backs carry `sys.c: '0000000'`.** `handbackLine` defaults to it, git answers 128 for it, so such a task entry is always cut. Every resume test that expects a task kept builds it through `codePass`, which copies the envelope's `c`; only spec, plan, audit and fix entries use `say`, and `resume` never validates those.
- **`snap-validate.mjs` is spawned once per kept task entry.** A plan has at most a few dozen tasks, and each spawn is the same one `handback` already made; no timeout change is needed. The RS tests spawn at most three.
- **`git reset` in fixtures.** `droppedCommit` and RS14 move HEAD back over an empty commit with a mixed reset, so the working tree and index are untouched and only HEAD moves. The dropped object stays in the object store, which is what makes `--is-ancestor` exit 1 rather than 128.
- **Check order inside `checkApproval`.** `approvedDocHalt` is called first but its `ORCH_APPROVED_DOC_CHANGED` result is held until the commit fields are checked, so an approval that predates FEAT-055 refuses `ORCH_RESUME_UNANCHORED` even when its document also changed. RS17's rows change one field each, so the order is pinned by construction, not by accident.
- **An approval without its entry** (only reachable by hand-editing the run file) is kept without one, and `nextStep` would then route to that role's `install` under a standing approval. Not tested; the run file is the script's own record, and Guard 6 denies an agent's writes to it.
- **The CONFLICT exception reads `run.approvals[last.role]`.** A conflict on an unapproved spec or plan entry drops it (RS16's Define rule covers the unapproved plan), and a conflict on a `code` entry drops it (RS4).
- **The security entry keeps no `snap`** (plan decision 2). If a later item needs it, adding it is additive; `E2b` would be updated in that item.
- **Mirror drift.** Each `cc-orchestrate.md` edit is made twice; the byte-identical test fails on any difference.
- **Line numbers drift.** References are from HEAD 027d8b0; locate by the quoted text if they move.
