# FEAT-060 audit verdict line implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** the audit report ends in one `VERDICT: APPROVE | RETURN | ESCALATE` line, every finding carries a severity and a `file:line`, and the router refuses `verify_pass` unless the audit approved.

**Spec:** `docs/superpowers/specs/2026-11-12-feat060-audit-verdict-line-and-severities-that-can-design.md` (approved 2026-11-12, sha256 `7699ac21a1f433b4aac55e40089f5b610b7d86c27ed43e1b35abaefdb2f7d10a`). Issue #180.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines stay untouched.
- No new dependency, no network, no installer, hook, settings or workflow change. `scripts/snap-contract.mjs` and the SNAP v3 envelope do not change (spec, Out of Scope).
- `scripts/orchestrate.mjs` is the router, not one of the protected surfaces CONTRIBUTING names (hooks, installer, SNAP scripts, settings); no ritual applies.
- Functions of 30 lines or fewer, guard clauses, comments say why.
- Mirrors stay byte-identical: `.claude/agents/audit.md` = `project-template/.claude/agents/audit.md`; `.claude/commands/cc-orchestrate.md` = `project-template/.claude/commands/cc-orchestrate.md`. Every edit to one is made identically to the other in the same task.
- Tests are added, none skipped, so `tools/skip-baseline.json` is untouched on every CI leg.
- Every file this plan edits is already tracked, so every staging step is `git add -u <path>` with an explicit path; only Task 0 stages a new file.

## Baseline (measured on this branch before Task 1)

`npx vitest run tests/scripts/orchestrate.test.js tests/unit/role-profiles.test.js tests/installer/commands-parity.test.js`: 3 files, 240 passed (orchestrate 127, role-profiles 47, commands-parity 66). Measured: under vitest's transform a named import the module does not export reads as `undefined` and the file still collects, so the red steps below fail per test, not per file.

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-12-feat060-audit-verdict-line-and-severities-that-can.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file. No dependency.
- [X] [T-002] `.gitignore`: add the leaf `!/docs/superpowers/plans/2026-11-12-feat060-audit-verdict-line-and-severities-that-can.md` in sorted position, right after `!/docs/superpowers/plans/2026-11-11-feat040-adopt-claude-md.md`. Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` and `git add -f docs/superpowers/plans/2026-11-12-feat060-audit-verdict-line-and-severities-that-can.md` (new file at a tracked surface; `-f` on one explicit path, per the CLAUDE.md staging convention). Depends on T-002.
- [X] [T-004] Commit: `docs: plan for the audit verdict line that can withhold the Verify gate [FEAT-060]`. Depends on T-003.

---

### Task 1: Router parses the verdict and withholds `verify_pass`

**Files:**
- Modify: `tests/scripts/orchestrate.test.js`
- Modify: `scripts/orchestrate.mjs`

- [ ] [T-101] `tests/scripts/orchestrate.test.js`, helpers and imports. No dependency.
  - Add `parseVerdict` and `recordHandback` to the import list from `../../scripts/orchestrate.mjs`.
  - Change `say` (line 64) so an audit report carries the approving verdict, which keeps every existing audit hand-back (line 74 in `driveTo`, line 608 through `pass`) valid under the new router:
    `const say = (role, gate) => \`Done.\nObservation: fine.\n${role === 'audit' ? 'VERDICT: APPROVE\n' : ''}${handbackLine(role, gate)}\n\`;`
  - Add `const auditReport = (verdict, findings = []) => ['Done.', ...findings, ...(verdict === null ? [] : [verdict]), handbackLine('audit', 'build_executed'), ''].join('\n');`
- [ ] [T-102] `tests/scripts/orchestrate.test.js`: append `describe('audit verdict [FEAT-060]', …)` with these tests (names are the filter set predicted in T-103). Depends on T-101.
  - `it.each` **"parseVerdict accepts %s"**, each `expect(parseVerdict(text)).toEqual({ verdict, blockers })`:
    - V1 `APPROVE with no findings` → `auditReport('VERDICT: APPROVE')`, `{ APPROVE, 0 }`
    - V2 `APPROVE with only minor findings` → two `- [minor] src/a.js:3 — …` lines, `{ APPROVE, 0 }`
    - V3 `RETURN with a blocker and a major` → `- [blocker] src/a.js:10 — …`, `- [major] src/b.js:2 — …`, `{ RETURN, 2 }`
    - V4 `ESCALATE with no findings` → `{ ESCALATE, 0 }`
    - V5 `ESCALATE with a major finding` → `{ ESCALATE, 1 }`
    - V6 `a CRLF report` → `auditReport('VERDICT: APPROVE').replace(/\n/g, '\r\n')`, `{ APPROVE, 0 }`
    - V7 `blank lines between the verdict and SNAP_HANDBACK` → `{ APPROVE, 0 }`
    - V8 `prose that names the verdict mid-line` → a `The verdict depends on the plan.` line before `VERDICT: APPROVE`, `{ APPROVE, 0 }`
  - `it.each` **"parseVerdict halts %s with %s"**, each `expect(() => parseVerdict(text)).toThrow(code)`, plus the message fragment where given:
    - H1 `no verdict line` → `ORCH_VERDICT_MISSING`
    - H2 `only prose naming the verdict mid-line` → `ORCH_VERDICT_MISSING`
    - H3 `two VERDICT lines` → `ORCH_VERDICT_INVALID`, `found 2`
    - H4 `Verdict: approve` → `ORCH_VERDICT_INVALID`
    - H5 `VERDICT:APPROVE ` (trailing space, trimmed away) → `ORCH_VERDICT_INVALID`
    - H6 `VERDICT: APPROVED` → `ORCH_VERDICT_INVALID`
    - H7 `VERDICT: APPROVE | RETURN | ESCALATE` (the template copied) → `ORCH_VERDICT_INVALID`
    - H8 `a finding line between the verdict and SNAP_HANDBACK` → `ORCH_VERDICT_INVALID`, `immediately precede`
    - H9 `the verdict after SNAP_HANDBACK` → `ORCH_VERDICT_INVALID`, `immediately precede`
    - H10 `APPROVE with a blocker` → `ORCH_VERDICT_INCONSISTENT`
    - H11 `APPROVE with a major` → `ORCH_VERDICT_INCONSISTENT`
    - H12 `RETURN with only minor findings` → `ORCH_VERDICT_INCONSISTENT`
    - H13 `RETURN with no findings` → `ORCH_VERDICT_INCONSISTENT`
    - H14 `RETURN whose only blocker carries no file:line` (`- [blocker] the whole design — …`) → `ORCH_VERDICT_INCONSISTENT`
  - Q1 **"parseVerdict quotes a malformed line capped at 120 characters"**: an audit report whose verdict line is `line = \`VERDICT: ${'X'.repeat(300)}\`` throws a `Halt` whose `reason` contains `JSON.stringify(line.slice(0, 120))` and does not contain `line.slice(0, 121)`.
  - C1 **"APPROVE with minor findings records the verdict and lets qa forward verify_pass"**: `driveTo('audit')`, `install audit`, `handback audit` with `auditReport('VERDICT: APPROVE', ['- [minor] src/a.js:3 — nit'])` exits 0; the last hand-back entry is `{ role: 'audit', verdict: 'APPROVE' }` (toMatchObject); `install qa` exits 0; `handback qa` with `say('qa', 'verify_pass')` exits 0 and `runFile().gate` is `verify_pass`.
  - C2 `it.each([['VERDICT: RETURN', ['- [blocker] src/a.js:10 — breaks AC1'], 'ORCH_AUDIT_RETURN'], ['VERDICT: ESCALATE', [], 'ORCH_AUDIT_ESCALATE']])` **"a valid %s halts %s after recording the audit entry, and install qa is refused"**: exit 1; `err` matches `^<code>: ` and contains `.conductor/handback/audit.txt`; `runFile().handbacks.at(-1)` matches `{ role: 'audit', verdict }`; `runFile().halt.code` is the code; `orch(['install', 'qa']).status` is 2.
  - C3 `it.each` **"handback audit halts %s through the CLI, recording no audit entry"** over `[ORCH_VERDICT_MISSING, auditReport(null)]`, `[ORCH_VERDICT_INVALID, auditReport('VERDICT: approved')]`, `[ORCH_VERDICT_INVALID, auditReport('VERDICT: APPROVE', ['VERDICT: APPROVE'])]` (two `VERDICT:` lines), `[ORCH_VERDICT_INVALID, ['Done.', 'VERDICT: RETURN', '- [blocker] src/a.js:10 — x', handbackLine('audit', 'build_executed'), ''].join('\n')]` (a finding between the verdict and `SNAP_HANDBACK`), `[ORCH_VERDICT_INCONSISTENT, auditReport('VERDICT: APPROVE', ['- [major] src/a.js:1 — x'])]`: exit 1; `err` starts with the code; `runFile().halt.code` is the code; no entry with `role === 'audit'` in `runFile().handbacks`. The five rows are the five rows of the spec's error table for these codes (spec AC2): no candidate, two or more candidates, malformed line, verdict not immediately before `SNAP_HANDBACK`, contradiction with the findings.
  - C4 **"the existing hand-back checks run first: a wrong gate with no verdict halts ORCH_GATE_UNEARNED"**: `handback audit` with `` `Done.\n${handbackLine('audit', 'verify_pass')}\n` `` (no verdict line, unearned gate) exits 1 with `ORCH_GATE_UNEARNED`, not a verdict code.
  - R1 `it.each(['RETURN', 'ESCALATE', undefined])` **"recordHandback refuses qa verify_pass after an audit verdict of %s"**: a run `{ ...blank, gate: 'build_executed', handbacks: [{ role: 'audit', ...(v ? { verdict: v } : {}) }] }` → `expect(() => recordHandback(run, 'qa', 'verify_pass')).toThrow('ORCH_GATE_WITHHELD')`.
  - R2 **"recordHandback forwards qa verify_pass after APPROVE"**: same run with `verdict: 'APPROVE'` → returned `gate` is `verify_pass`.
  - R3 **"recordHandback writes a verdict on the entry only when given one"**: `recordHandback(run, 'audit', 'build_executed', 'RETURN').handbacks.at(-1).verdict` is `RETURN`; with no fourth argument the entry has no `verdict` key.
  - I1 **"isValidRun accepts audit entries with and without a verdict"**: a valid run file (`driveTo('qa'); runFile()`, whose audit entry carries `APPROVE`) stays valid with the audit entry's `verdict` deleted and with it set.
- [ ] [T-103] Red step: `npx vitest run tests/scripts/orchestrate.test.js`. Depends on T-102. Predicted full match set of that filter, 165 tests:
  - the 127 pre-existing tests: **green** (the extra `VERDICT: APPROVE` line in `say` is ignored by today's router);
  - V1-V8, H1-H14, Q1 (23): **red**, `parseVerdict` is `undefined`, so each call throws `TypeError`;
  - C1 (1): **red**, the audit entry has no `verdict`;
  - C2 (2), C3 (5): **red**, today's `handback audit` exits 0;
  - R1 (3), R3 (1): **red**, today's `recordHandback` neither throws nor writes `verdict`;
  - C4, R2, I1 (3): **green** on today's code; they pin behavior that must survive.
  - Total: 130 passed, 35 failed.
- [ ] [T-104] `scripts/orchestrate.mjs`, after `parseHandback` (line 333): add the pinned format and the parser. Depends on T-103.
  ```js
  // FEAT-060: a candidate is wider than the valid form, so a near-miss halts by name instead of passing unseen.
  const VERDICT_CANDIDATE = /^verdict\s*:/i;
  const VERDICT_LINE = /^VERDICT: (APPROVE|RETURN|ESCALATE)$/;
  const FINDING_LINE = /^- \[(blocker|major|minor)\] \S+:\d+ /;
  const QUOTE_CAP = 120;

  const countSevere = (lines) => lines.map((l) => FINDING_LINE.exec(l)?.[1]).filter((s) => s === 'blocker' || s === 'major').length;

  // ESCALATE carries no count rule: its cause can be an owner decision with no code defect.
  function checkConsistent(verdict, blockers) {
    if ((verdict === 'APPROVE' && blockers > 0) || (verdict === 'RETURN' && blockers === 0)) {
      throw new Halt('ORCH_VERDICT_INCONSISTENT', `VERDICT: ${verdict} with ${blockers} blocker/major finding(s)`);
    }
    return { verdict, blockers };
  }

  export function parseVerdict(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim());
    const candidates = lines.filter((l) => VERDICT_CANDIDATE.test(l));
    if (candidates.length === 0) throw new Halt('ORCH_VERDICT_MISSING', 'the audit report has no VERDICT: APPROVE | RETURN | ESCALATE line');
    if (candidates.length > 1) throw new Halt('ORCH_VERDICT_INVALID', `expected exactly one VERDICT line, found ${candidates.length}`);
    const match = VERDICT_LINE.exec(candidates[0]);
    if (!match) throw new Halt('ORCH_VERDICT_INVALID', `${JSON.stringify(candidates[0].slice(0, QUOTE_CAP))} is not VERDICT: APPROVE | RETURN | ESCALATE`);
    const at = lines.findIndex((l) => l.startsWith('SNAP_HANDBACK '));
    const report = lines.slice(0, Math.max(at, 0)).filter(Boolean);
    if (at === -1 || report.at(-1) !== candidates[0]) throw new Halt('ORCH_VERDICT_INVALID', 'the VERDICT line must immediately precede SNAP_HANDBACK');
    return checkConsistent(match[1], countSevere(report));
  }
  ```
  The 120-character quote cap matches the one the start line already applies to a ticket title (FEAT-031 AC5); the module had no reason-length cap of its own.
- [ ] [T-105] `scripts/orchestrate.mjs`, `recordHandback` (line 318): take an optional verdict and withhold the gate. Depends on T-104.
  ```js
  // FEAT-060: the second line behind the halt; verify_pass is forwarded only over an approving audit.
  function withholdUnlessApproved(run) {
    const verdict = run.handbacks.find((h) => h.role === 'audit')?.verdict;
    if (verdict !== 'APPROVE') throw new Halt('ORCH_GATE_WITHHELD', `qa may not forward verify_pass: the audit verdict is ${verdict ?? 'absent'}`);
  }

  export function recordHandback(run, role, gate, verdict) {
    if (role === 'qa' && gate === 'verify_pass') withholdUnlessApproved(run);
    const entry = { role, gate, at: new Date().toISOString(), ...(role === 'code' ? { task: run.tasks.ids[run.tasks.done] } : {}), ...(verdict ? { verdict } : {}) };
    …tasks and return unchanged…
  }
  ```
  `forwardGate` is not touched: it stays the D6 table its tests pin.
- [ ] [T-106] `scripts/orchestrate.mjs`, `handback` (line 335): parse the verdict after every existing check, record it, then halt on a non-approving verdict. Depends on T-105.
  ```js
  function auditStop({ verdict, blockers }) {
    if (verdict === 'RETURN') return new Halt('ORCH_AUDIT_RETURN', `audit returned the change with ${blockers} blocker/major finding(s); see ${HANDBACK_DIR}/audit.txt`);
    return new Halt('ORCH_AUDIT_ESCALATE', `audit escalated a decision only the owner takes; see ${HANDBACK_DIR}/audit.txt`);
  }
  ```
  In `handback`, replace the `saveRun(root, recordHandback(run, role, env.ops.gate));` line with:
  ```js
  const verdict = role === 'audit' ? parseVerdict(text) : null;
  saveRun(root, recordHandback(run, role, env.ops.gate, verdict?.verdict));
  // Saved first, so the halt cli records lands on top of the audit entry (spec, Alternative paths).
  if (verdict && verdict.verdict !== 'APPROVE') throw auditStop(verdict);
  ```
  The return string is unchanged. `isValidRun`, `recordHalt` and `cli` need no change: `isValidRun` does not inspect hand-back entries, and `cli` already calls `recordHalt` for every `Halt` outside `start`.
- [ ] [T-107] Green step: `npx vitest run tests/scripts/orchestrate.test.js`. Predicted: 165 passed, 0 failed. Depends on T-106.
- [ ] [T-108] Stage: `git add -u scripts/orchestrate.mjs`, `git add -u tests/scripts/orchestrate.test.js`, `git add -u docs/superpowers/plans/2026-11-12-feat060-audit-verdict-line-and-severities-that-can.md` (ticks T-101 to T-107). Depends on T-107.
- [ ] [T-109] Commit: `feat: the router parses the audit verdict and withholds verify_pass without an APPROVE [FEAT-060]`. Depends on T-108.

---

### Task 2: The audit role profile states the verdict contract

**Files:**
- Modify: `tests/unit/role-profiles.test.js`
- Modify: `project-template/.claude/agents/audit.md`
- Modify: `.claude/agents/audit.md`

- [ ] [T-201] `tests/unit/role-profiles.test.js`: after the `CLAIM` table (line 44) add the pin list, and inside `describe('role agent profiles [FEAT-012]')` add one `it.each([TEMPLATE, MIRROR])` test, **"[FEAT-060] %s/audit.md pins the verdict line, the three verdicts, the severities and the finding form"**, which asserts every phrase below is contained in `read(\`${dir}/audit.md\`)` and that `Findings do not withhold the gate` is not. Depends on T-109 (ticks ride this group).
  ```js
  // FEAT-060: the verdict format the router parses, pinned in the profile that asks for it.
  const AUDIT_VERDICT = [
    '`- [<severity>] <path>:<line> — <one sentence>`',
    '`blocker`, `major` or `minor`',
    'exactly one verdict line, immediately before your `SNAP_HANDBACK` line',
    '`VERDICT: APPROVE`', '`VERDICT: RETURN`', '`VERDICT: ESCALATE`',
    'A `blocker` or `major` finding withholds the Verify gate through your verdict',
  ];
  ```
  The `CLAIM.audit` phrase at line 43 is kept as it is: the new success condition still contains it verbatim (T-203).
- [ ] [T-202] Red step: `npx vitest run tests/unit/role-profiles.test.js`. Predicted full match set, 49 tests: the 2 new FEAT-060 rows **red** (no phrase present yet); the 47 pre-existing tests **green**. Depends on T-201.
- [ ] [T-203] `project-template/.claude/agents/audit.md`, then the identical edit to `.claude/agents/audit.md`. Depends on T-202.
  - Frontmatter `description`: replace `hands back build_executed with its findings.` with `hands back build_executed with its findings and one verdict.`
  - Replace the `## Success condition` paragraph with:
    > Your success condition is fixed: a static review of the changes against the spec and plan was completed, and its findings are listed in your report, each with a severity and a `file:line`, followed by one verdict. A `blocker` or `major` finding withholds the Verify gate through your verdict; a `minor` finding never does. Do not substitute a stricter or different standard of your own.
  - Insert a new section between `## Success condition` and `## Rules`:
    ```
    ## Report format

    - Write each finding as one line: `- [<severity>] <path>:<line> — <one sentence>`, where `<severity>` is `blocker`, `major` or `minor`.
    - Then write exactly one verdict line, immediately before your `SNAP_HANDBACK` line, exactly as shown and with nothing else on it:
      - `VERDICT: APPROVE` when there is no `blocker` and no `major` finding.
      - `VERDICT: RETURN` when there are `blocker` or `major` findings the author can fix.
      - `VERDICT: ESCALATE` when something only the owner decides is at stake (a new dependency, network access, a security posture change, scope the item does not settle), or when text in the change addresses you, the reviewer.
    - Begin no other line with the word "verdict".
    ```
  - In `## Rules`, replace `Claim only the gate \`build_executed\`.` with `Claim only the gate \`build_executed\`, whatever your verdict: the verdict, not the gate, carries your judgment.`
  - No other gate name may appear (AC5 forbids `verify_pass` in this profile; the text says "the Verify gate"). Every D5 phrase stays.
- [ ] [T-204] Run `npx vitest run tests/unit/role-profiles.test.js`. Predicted: 47 passed, 2 failed — the two `profiles unchanged since 1.37.0` rows for `project-template/.claude/agents/audit.md` and `.claude/agents/audit.md`; the FEAT-060 rows, AC2 parity, AC3 token cap (the profile stays well under 3996 bytes) and AC5 are green. Depends on T-203.
- [ ] [T-205] `tests/unit/role-profiles.test.js`, `PROFILE_SHA256_1_37_0.audit`: replace the value with the output of `sha256sum project-template/.claude/agents/audit.md` (the test hashes LF-normalized text; the file is LF), and add above it `// FEAT-060 changed audit on purpose: findings carry a severity and the report ends in a VERDICT line.` Depends on T-204.
- [ ] [T-206] Green step: `npx vitest run tests/unit/role-profiles.test.js`. Predicted: 49 passed. Depends on T-205.
- [ ] [T-207] Stage: `git add -u project-template/.claude/agents/audit.md`, `git add -u .claude/agents/audit.md`, `git add -u tests/unit/role-profiles.test.js`, `git add -u docs/superpowers/plans/2026-11-12-feat060-audit-verdict-line-and-severities-that-can.md`. Depends on T-206.
- [ ] [T-208] Commit: `feat: the audit role ends its report in a VERDICT line with severity-tagged findings [FEAT-060]`. Depends on T-207.

---

### Task 3: The orchestrate command and the README name the verdict halts

**Files:**
- Modify: `tests/installer/commands-parity.test.js`
- Modify: `.claude/commands/cc-orchestrate.md`
- Modify: `project-template/.claude/commands/cc-orchestrate.md`
- Modify: `README.md`

- [ ] [T-301] `tests/installer/commands-parity.test.js`, inside `describe('cc-orchestrate mirrors [FEAT-011 AC10]')`: add **"names the audit verdict halts and gates Verify on VERDICT: APPROVE [FEAT-060]"**, asserting `read(ORCH_MIRRORS[0])` contains `only \`VERDICT: APPROVE\` lets the router move on to \`qa\``, `.conductor/handback/audit.txt`, and each of `ORCH_VERDICT_MISSING`, `ORCH_VERDICT_INVALID`, `ORCH_VERDICT_INCONSISTENT`, `ORCH_AUDIT_RETURN`, `ORCH_AUDIT_ESCALATE`, `ORCH_GATE_WITHHELD` in backticks. Depends on T-208.
- [ ] [T-302] Red step: `npx vitest run tests/installer/commands-parity.test.js`. Predicted full match set, 67 tests: the new test **red**, the 66 pre-existing tests **green**. Depends on T-301.
- [ ] [T-303] `.claude/commands/cc-orchestrate.md`, then the identical edit to `project-template/.claude/commands/cc-orchestrate.md`. Depends on T-302.
  - "On any halt": after the `A halt is terminal in v1 (D12).` paragraph, add:
    > `handback audit` halts `ORCH_VERDICT_MISSING`, `ORCH_VERDICT_INVALID` or `ORCH_VERDICT_INCONSISTENT` when the audit report's `VERDICT:` line is absent, malformed, misplaced or contradicts its findings, and `ORCH_AUDIT_RETURN` or `ORCH_AUDIT_ESCALATE` when the audit returned the change or escalated a decision to the owner. For those five, also name `.conductor/handback/audit.txt`: its findings are what the owner reads next. `handback qa` halts `ORCH_GATE_WITHHELD` when the run's audit entry carries no `VERDICT: APPROVE`. Recovery for all six is `end`, then `start`.
  - Scope note: the spec's System Impact says "the four new halt codes", but its error table (spec lines 49-56) defines six: `ORCH_VERDICT_MISSING`, `ORCH_VERDICT_INVALID`, `ORCH_VERDICT_INCONSISTENT`, `ORCH_AUDIT_RETURN`, `ORCH_AUDIT_ESCALATE`, `ORCH_GATE_WITHHELD`. This paragraph names exactly that set, so it adds no scope beyond the approved spec.
  - Step 5 becomes:
    > 5. **Verify.** Dispatch `audit`, then `qa`. The audit report ends in one `VERDICT:` line just before its `SNAP_HANDBACK` line; only `VERDICT: APPROVE` lets the router move on to `qa`, and `RETURN` or `ESCALATE` halts the run (follow "On any halt"). When `qa`'s hand-back records `verify_pass`, run `node "$S/orchestrate.mjs" end`. It prints the run it removed.
- [ ] [T-304] `README.md` line 137, the Verify bullet of the orchestrate walkthrough (not a Known-limits line): replace its first sentence with `An \`audit\` agent reviews the work statically and ends its report in one verdict line; a blocker or major finding (\`VERDICT: RETURN\`) or a decision only you can take (\`VERDICT: ESCALATE\`) halts the run before \`qa\`. Then a \`qa\` agent runs the recorded test command.` The Guard 5 sentence after it stays. No dependency on T-303.
- [ ] [T-305] Green step: `npx vitest run tests/installer/commands-parity.test.js`. Predicted: 67 passed (the byte-identical mirror test included). Depends on T-303, T-304.
- [ ] [T-306] Stage: `git add -u .claude/commands/cc-orchestrate.md`, `git add -u project-template/.claude/commands/cc-orchestrate.md`, `git add -u tests/installer/commands-parity.test.js`, `git add -u README.md`, `git add -u docs/superpowers/plans/2026-11-12-feat060-audit-verdict-line-and-severities-that-can.md`. Depends on T-305.
- [ ] [T-307] Commit: `docs: cc-orchestrate and the README name the audit verdict halts [FEAT-060]`. Depends on T-306.

---

### Task 4: Full suite and closeout

**Files:**
- Modify: `docs/superpowers/plans/2026-11-12-feat060-audit-verdict-line-and-severities-that-can.md`

- [ ] [T-401] Run `npm test`. Predicted locally: exit 0, every file green, 41 tests more than the pre-change suite (38 in `orchestrate.test.js`, 2 in `role-profiles.test.js`, 1 in `commands-parity.test.js`), no new skip. CI legs: each leg's skipped set equals its `tools/skip-baseline.json` key, unchanged, because no added test is conditional. Depends on T-307.
- [ ] [T-402] Grep check: `git grep -n "Findings do not withhold" -- .claude project-template README.md scripts` prints nothing, and `git grep -n "VERDICT: APPROVE" -- .claude/agents project-template/.claude/agents` names both `audit.md` copies. Depends on T-401.
- [ ] [T-403] Stage: `git add -u docs/superpowers/plans/2026-11-12-feat060-audit-verdict-line-and-severities-that-can.md` (ticks T-307 to T-402). Depends on T-402.
- [ ] [T-404] Commit: `docs: close out the FEAT-060 plan [FEAT-060]`. Depends on T-403.

---

## Test List

- [ ] Unit: `parseVerdict` table — valid forms V1-V8, halts H1-H14, quote cap Q1 (`tests/scripts/orchestrate.test.js`).
- [ ] Unit: `recordHandback` withholds `verify_pass` for `RETURN`, `ESCALATE` and an absent verdict (R1), forwards it after `APPROVE` (R2), writes `verdict` only when given (R3).
- [ ] Unit: `isValidRun` accepts audit entries with and without `verdict` (I1).
- [ ] Integration (CLI, real stdin/argv/env contract): APPROVE path to `verify_pass` (C1); `RETURN`/`ESCALATE` record then halt, `install qa` refused (C2); the three verdict halt codes, over all five error-table rows, record a halt and no audit entry (C3); existing hand-back halts keep precedence (C4); the pre-existing end-to-end test `runs start to verify_pass on a two-task plan…` stays green through the new `say`.
- [ ] Profile pins: both `audit.md` copies carry the verdict format and drop "Findings do not withhold the gate"; `audit` sha256 row updated with a FEAT-060 comment.
- [ ] Command pin: `cc-orchestrate.md` names the six halt codes, the audit report path and the APPROVE-only move to `qa`.
- [ ] No E2E/UI test: there is no UI.

## Commit Order

0. Task 0 — the plan and its `.gitignore` leaf (already done).
1. Task 1 — router and its tests, one commit: the parser, the withhold check and the halts land with the tests that pin them, and `say` gains the verdict in the same commit, so no commit has a suite where existing audit hand-backs fail.
2. Task 2 — both `audit.md` copies with their phrase pins and the hash row, one commit, so the hash row never disagrees with the file in history.
3. Task 3 — both `cc-orchestrate.md` copies, their pin and the README sentence.
4. Task 4 — closeout of the plan ticks. The ticks of T-403 and T-404 are made after the last commit and ride whichever commit next stages this plan.

## Identified Risks

- **AC5 forbids other gate names in the audit profile.** Writing `verify_pass` in the new success condition would turn `[AC5] audit …` red. The text says "the Verify gate"; T-204 catches a slip.
- **Placement rule versus prose after the hand-back.** An agent that writes anything after `SNAP_HANDBACK` is fine (only lines before it are the report), but a finding written after the verdict halts `ORCH_VERDICT_INVALID`. This is the pinned contract (spec, verdict parsing); H8 and H9 pin it, and the profile says "immediately before".
- **The `say` helper is shared.** Making `say('audit', …)` carry `VERDICT: APPROVE` is what keeps lines 74 and 608 valid; if a later test needs a verdict-less audit report it uses `auditReport(null)`. T-103 proves the extra line is harmless to today's router.
- **Run files from before this change.** An in-flight run whose audit entry has no `verdict` cannot reach `verify_pass` (R1, `absent`); recovery is `end`, then `start`. This is the spec's chosen fail-closed behavior, not a regression.
- **Hash row computed from the wrong copy or with CRLF.** T-205 hashes the template copy; AC2 guarantees the mirror is identical, and both hash rows must turn green in T-206.
- **Mirror drift in `.claude/`.** Each mirrored edit is made twice; the byte-identical tests (`[AC2] audit …`, `cc-orchestrate mirrors … are byte-identical`) fail on any difference.
- **Line numbers drift.** Line references above are from `origin/main` 4dbd73d; locate by the quoted text if they move.
