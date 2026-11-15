# BUG-080 unattended plan check does not escalate tasks that write guard-enforcement and control-plane files implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** In an unattended run, `delegate plan` turns a delegated `APPROVE` into `ESCALATE` when a plan task's `Files` entry reaches a new fixed list, `CONTROL_PLANE` (the hooks, the OpenCode guard plugin, the settings files, the Guard 3 allowlist, the agents, the commands, the skills, the `CLAUDE.md` files and the router with its imports and the scan, in both mirrors), recording the reason `task <id> declares <entry> inside the control-plane files`. The orchestrator write-surface check and its reason are unchanged and keep precedence.

**Spec:** `docs/superpowers/specs/2026-11-14-bug080-unattended-plan-check-does-not-escalate-tasks-design.md` (approved 2026-11-14, sha256 `75c7ba1a00eed485dae26d89b32c4399bc0ff534396a0a941a282cae6efd5649`). Issue #219.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>` and `-t <pattern>`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines stay untouched (the `[BUG-080]` Known-limits entry is updated at release; spec, Out of Scope).
- No new dependency, no network, no workflow change, no hook, installer, SNAP-script or settings change. `scripts/orchestrate.mjs` is not a protected surface CONTRIBUTING names; no ritual applies.
- `WRITE_SURFACE` and the hook's `ORCH_WRITE_SURFACE` are unchanged (AC6); `tests/hooks/guard6.test.js:215` keeps pinning one to the other.
- No change to `defineOutcome`, `delegatedEntry`, `ownerRequired`, the run-file shape or `isValidRun` (spec, System Impact).
- No change to `.claude/commands/cc-orchestrate.md` or its mirror: its unattended paragraph does not list which tasks escalate (spec, System Impact), so there is nothing to keep in step.
- Functions of 30 lines or fewer, guard clauses, comments say why.
- Tests are added, none skipped and none conditional, so `tools/skip-baseline.json` is untouched. U22 is not edited (AC4: its rows keep their reason byte for byte).
- Every file this plan edits is already tracked, so every staging step is `git add -u <path>` with an explicit path; only Task 0 stages a new file.

## Plan decisions

The spec fixes the list, the reach rule and the reason text; these follow from reading the code it cites.

1. **Where `CONTROL_PLANE` sits.** An exported constant right after `export const WRITE_SURFACE = [...]` (`scripts/orchestrate.mjs:22`), in the order of the spec's table, 28 entries, all lower-case. The tests read it as `orchestrateModule.CONTROL_PLANE` (the namespace import at `tests/scripts/orchestrate.test.js:11`), so the named-import line is not touched.
2. **`Files` entries as `surfaceTask` receives them.** `extractTasks` (`scripts/orchestrate.mjs:221`) reads only `- Create:`, `- Modify:` and `- Test:` lines under `**Files:**`, takes every backticked span, strips a `:N` or `:N-M` line suffix and a leading `./`. The reach rule therefore runs on that string; the reason quotes it in its original case, as U22's reason does.
3. **One shared reach helper, rule 3 as the spec words it.** `reachesDir(segs, dir)` walks the directory's segments: past the end of the glob → no; a glob segment that *contains* `**` → yes; a segment whose `globToRegExp` does not match → no; all matched → yes. `reachesList(glob, list)` applies `reachesDir` to `/**` entries and `globToRegExp(glob).test(p)` to fixed ones. `inSurface` becomes `ntfsAlias(glob) || reachesList(glob, WRITE_SURFACE)`; `inControlPlane` is `reachesList(taskGlob(entry), CONTROL_PLANE)`. The lower-casing and `./` strip move into `taskGlob`, the NTFS test into `ntfsAlias`, both unchanged.
4. **"Contains `**`" versus today's "starts with `**`".** Today's first-segment test is `first.startsWith('**') || globToRegExp(first).test('.conductor')`. Rule 3 says "contains". The two agree on every input where today escalates, and differ only on a segment with an inner `**` whose own pattern does not match the directory name: `.c**k/x` (which Guard 5's glob semantics match against `.conductor/handback/x`, so today misses a real reach) and `a**` (which cannot name a file under `.conductor`, a harmless extra escalation). The plan follows rule 3's wording: "starts with" would also miss `.c**` against the two-segment `.claude/hooks/**`, because the glob runs out after its first segment, and the extra escalations only ever ask the owner. Measured: no test in `tests/scripts/orchestrate.test.js` declares a glob with an inner `**` (`grep -n "[A-Za-z0-9._-]\*\*" tests/scripts/orchestrate.test.js` matches only the `**Files:**` literal at line 84), so no existing row changes outcome. A scratch run of the new predicates over every U22 row, every AC1-AC4 row and `src/a.js`, `tests/a.test.js`, `src/b.js` reproduced the spec's expected outcome for each and today's `inSurface` result for each U22 row.
5. **Why `inControlPlane` has no NTFS test.** `surfaceTask` runs `inSurface`, which escalates every NTFS alias with the write-surface reason, on all of a task's entries before `inControlPlane` (spec, reason precedence; rule 1 "applies to both lists because it is checked first"). A second test would be unreachable.
6. **Precedence inside `surfaceTask`.** Per task, in plan order: `t.files.find(inSurface)` first, then `t.files.find(inControlPlane)`; the first task with either wins. So `.claude/**` and `**/*.json` (U22) keep the write-surface reason, and AC5's Task 1 control-plane entry wins over Task 2's write-surface entry.
7. **Test rows.** One escalation helper, `expectEscalation(path, list)`, holds U22's four assertions with the list name as a parameter; U22 itself stays as written. New ids are U41-U45 (the block's last id is U40, used twice at lines 3636 and 3742), each tagged `[BUG-080 ACn]` so `-t "BUG-080"` selects exactly the new tests. AC4's three new rows (`*/hooks/x.sh`, `**/bash-scan-allowlist.txt`, `.claude/hooks./x`) are U44 rather than new U22 rows, so U22's list stays byte-identical.
8. **No existing fixture changes.** Every delegated plan in `describe('unattended mode [FEAT-054]', …)` is `TWO_TASKS` (`src/a.js`, `tests/a.test.js`, `src/b.js`) or U22's plan, measured by listing the `plan(` calls after line 3241; none reaches `CONTROL_PLANE`.

## Baseline (measured on this branch, HEAD 11b86a3, before Task 1)

`npx vitest run tests/scripts/orchestrate.test.js`: 626 passed (about 400 s; the U-rows spawn the CLI several times each). `grep -c "BUG-080" tests/scripts/orchestrate.test.js`: 0.

Line numbers below are from HEAD 11b86a3; locate by the quoted text if they move.

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-14-bug080-unattended-plan-check-does-not-escalate-tasks.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file. No dependency.
- [X] [T-002] `.gitignore`: add the leaf `!/docs/superpowers/plans/2026-11-14-bug080-unattended-plan-check-does-not-escalate-tasks.md` in sorted position, right after `!/docs/superpowers/plans/2026-11-14-bug076-review-loop-outcome-not-bound-to-the-document.md` and before `!/docs/superpowers/plans/2026-11-14-feat053-per-role-model-selection-for-role-agents-with.md`. Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` and `git add -f docs/superpowers/plans/2026-11-14-bug080-unattended-plan-check-does-not-escalate-tasks.md` (new file at a tracked surface; `-f` on one explicit path, per the CLAUDE.md staging convention). Depends on T-002.
- [X] [T-004] Commit: `docs: plan for escalating unattended plan tasks that write control-plane files [BUG-080]`. Depends on T-003.

---

### Task 1: `CONTROL_PLANE` and the shared reach helper in `orchestrate.mjs`

**Files:**
- Modify: `tests/scripts/orchestrate.test.js`
- Modify: `scripts/orchestrate.mjs`

- [X] [T-101] `tests/scripts/orchestrate.test.js`: inside `describe('write surface [FEAT-011 AC4]', …)` (line 468), after the test `declares exactly the four entries the spec enumerates` (its closing `});` at line 476) and before the describe's closing `});`, add the pin (plan decision 1). Depends on T-004.
  ```js
  it('[BUG-080] CONTROL_PLANE declares exactly the control-plane entries the spec lists', () => {
    expect(orchestrateModule.CONTROL_PLANE).toEqual([
      '.claude/hooks/**', 'project-template/.claude/hooks/**',
      '.opencode/plugin/**', 'project-template/.opencode/plugin/**',
      '.claude/settings.json', '.claude/settings.local.json', '.claude/review-loop.settings.json',
      'project-template/.claude/settings.json', 'project-template/.claude/settings.local.json', 'project-template/.claude/review-loop.settings.json',
      '.claude/memory/bash-scan-allowlist.txt', 'project-template/.claude/memory/bash-scan-allowlist.txt',
      '.claude/agents/**', 'project-template/.claude/agents/**',
      '.claude/commands/**', 'project-template/.claude/commands/**',
      '.claude/skills/**', 'project-template/.claude/skills/**',
      'claude.md', 'claude.local.md', '.claude/claude.md', 'project-template/claude.md',
      'scripts/orchestrate.mjs', 'scripts/snap-contract.mjs', 'scripts/ticket.mjs', 'scripts/doc-locations.mjs', 'scripts/security-scan.mjs',
      '.claude/scripts/**',
    ]);
  });
  ```
- [X] [T-102] `tests/scripts/orchestrate.test.js`: inside `describe('unattended mode [FEAT-054]', …)`, right after the closing `});` of the U22 `it.each` (line 3536, the test `U22 [AC6] delegate plan over an APPROVE report escalates a task that declares %s`) and before the next `it.each([` (`['no verdict line', …`), add the BUG-080 rows (plan decision 7). It uses the block's `atPlan`, `delegateDoc` and the file-level `plan`, `task`, `runFile`, `sha`, `PLAN`, `orch`, `approveArgs`. Depends on T-101.
  ```js
  // BUG-080: the U22 assertions, with the list the reason names as a parameter; Task 1 is an ordinary source file.
  function expectEscalation(path, list) {
    atPlan();
    plan(`# Demo Plan\n\n${task(1, ['src/a.js'])}\n${task(2, [path])}\n## Test List\n`);
    const reason = `task Task 2 declares ${path} inside the ${list}`;
    expect(delegateDoc('plan')).toEqual({ status: 0, out: `owner approval required: delegated review plan returned ESCALATE (${reason}); see .conductor/delegate/plan.md`, err: '' });
    expect(runFile().approvals.plan).toBeNull();
    expect(runFile().delegated.plan).toMatchObject({ verdict: 'ESCALATE', reason });
    expect(orch(approveArgs('plan')).status).toBe(0);
  }

  it.each([
    '.claude/hooks/pre-tool-use.mjs',
    'project-template/.claude/hooks/pre-tool-use.mjs',
    '.opencode/plugin/conductor-guard.js',
    'project-template/.opencode/plugin/conductor-guard.js',
    '.claude/settings.json',
    '.claude/settings.local.json',
    '.claude/review-loop.settings.json',
    'project-template/.claude/settings.json',
    'project-template/.claude/settings.local.json',
    'project-template/.claude/review-loop.settings.json',
    '.claude/memory/bash-scan-allowlist.txt',
    'project-template/.claude/memory/bash-scan-allowlist.txt',
    '.claude/agents/code.md',
    'project-template/.claude/agents/code.md',
    '.claude/commands/cc-orchestrate.md',
    'project-template/.claude/commands/cc-orchestrate.md',
    '.claude/skills/demo/SKILL.md',
    'project-template/.claude/skills/demo/SKILL.md',
    'CLAUDE.md',
    'CLAUDE.local.md',
    '.claude/CLAUDE.md',
    'project-template/CLAUDE.md',
    'scripts/orchestrate.mjs',
    'scripts/snap-contract.mjs',
    'scripts/ticket.mjs',
    'scripts/doc-locations.mjs',
    'scripts/security-scan.mjs',
    '.claude/scripts/orchestrate.mjs',
  ])('U41 [BUG-080 AC1] delegate plan over an APPROVE report escalates a task that declares the control-plane file %s', (path) => {
    expectEscalation(path, 'control-plane files');
  });

  it.each([
    '.claude/hooks/context-guard.sh',
    '.claude/hooks/new-hook.mjs',
    '.claude/scripts/security-scan.mjs',
    '.claude/hooks',
    '.claude/scripts',
    '.claude/hooks/*.mjs',
    '.claude/*/pre-tool-use.mjs',
    'project-template/**',
    '.claude/*.json',
    'scripts/*.mjs',
    '*.md',
    '.Claude/Hooks/pre-tool-use.mjs',
    '.claude/SETTINGS.json',
    'Scripts/Orchestrate.mjs',
  ])('U42 [BUG-080 AC2] delegate plan escalates the directory, glob or case form %s with the control-plane reason', (path) => {
    expectEscalation(path, 'control-plane files');
  });

  it.each([
    '.claude/hooksx/a.mjs',
    'docs/hooks/a.mjs',
    '.claude/settings.backup.json',
    'project-template/.claude/memory/project.md',
    '.claude',
    'project-template',
    'scripts/snap-build.mjs',
    'docs/CLAUDE.md',
    'tests/scripts/orchestrate.test.js',
  ])('U43 [BUG-080 AC3] delegate plan over an APPROVE report approves a task that declares the near miss %s', (path) => {
    atPlan();
    plan(`# Demo Plan\n\n${task(1, ['src/a.js'])}\n${task(2, [path])}\n## Test List\n`);
    expect(delegateDoc('plan')).toEqual({ status: 0, out: `plan approved by delegated review: define_approved, 2 task(s); sha256 ${sha(PLAN)}`, err: '' });
    expect(runFile().approvals.plan.by).toBe('define-review');
  });

  it.each([
    '*/hooks/x.sh',
    '**/bash-scan-allowlist.txt',
    '.claude/hooks./x',
  ])('U44 [BUG-080 AC4] a glob that reaches both lists, %s, keeps the write-surface reason', (path) => {
    expectEscalation(path, 'orchestrator write surface');
  });

  it('U45 [BUG-080 AC5] the first task in plan order names the reason: a control-plane Task 1 wins over a write-surface Task 2', () => {
    atPlan();
    plan(`# Demo Plan\n\n${task(1, ['.claude/hooks/pre-tool-use.mjs'])}\n${task(2, ['.conductor/notes.md'])}\n## Test List\n`);
    const reason = 'task Task 1 declares .claude/hooks/pre-tool-use.mjs inside the control-plane files';
    expect(delegateDoc('plan')).toEqual({ status: 0, out: `owner approval required: delegated review plan returned ESCALATE (${reason}); see .conductor/delegate/plan.md`, err: '' });
    expect(runFile().approvals.plan).toBeNull();
    expect(runFile().delegated.plan).toMatchObject({ verdict: 'ESCALATE', reason });
  });
  ```
- [X] [T-103] Red step: `npx vitest run tests/scripts/orchestrate.test.js -t "BUG-080"`. Before T-101 no test name contained `BUG-080` (baseline grep: 0), so the filter's full match set is the 56 new tests and every other test is filtered out. Predicted: **44 red** — the pin (`CONTROL_PLANE` is `undefined`), all 28 U41 rows and all 14 U42 rows (each approved by the delegated review today instead of escalating), and U45 (today's reason names Task 2 and the write surface); **12 green** — the 9 U43 rows (approved today, and still approved after the change) and the 3 U44 rows (today's `inSurface` already escalates them with the write-surface reason). A U43 or U44 row that is red here means a fixture problem, not the missing feature: stop and fix the test. Depends on T-102.
- [X] [T-104] `scripts/orchestrate.mjs`: after `export const WRITE_SURFACE = [RUN_FILE, ENVELOPE_FILE, '.claude/memory/session-snapshot.json', '.conductor/**'];` (line 22), add the constant (plan decision 1). Depends on T-103.
  ```js
  // Owner decision (BUG-080): the files that enforce the guards or steer later dispatches, in both mirrors. Same notation
  // as WRITE_SURFACE; a trailing `/**` protects the whole directory, so a file added to it is covered too.
  export const CONTROL_PLANE = [
    '.claude/hooks/**', 'project-template/.claude/hooks/**',
    '.opencode/plugin/**', 'project-template/.opencode/plugin/**',
    '.claude/settings.json', '.claude/settings.local.json', '.claude/review-loop.settings.json',
    'project-template/.claude/settings.json', 'project-template/.claude/settings.local.json', 'project-template/.claude/review-loop.settings.json',
    '.claude/memory/bash-scan-allowlist.txt', 'project-template/.claude/memory/bash-scan-allowlist.txt',
    '.claude/agents/**', 'project-template/.claude/agents/**',
    '.claude/commands/**', 'project-template/.claude/commands/**',
    '.claude/skills/**', 'project-template/.claude/skills/**',
    'claude.md', 'claude.local.md', '.claude/claude.md', 'project-template/claude.md',
    // The router, the three modules it imports at load time, and the scan; the installer deploys them to .claude/scripts/.
    'scripts/orchestrate.mjs', 'scripts/snap-contract.mjs', 'scripts/ticket.mjs', 'scripts/doc-locations.mjs', 'scripts/security-scan.mjs',
    '.claude/scripts/**',
  ];
  ```
- [X] [T-105] `scripts/orchestrate.mjs`: replace `inSurface` and `surfaceTask` (from the comment `// A glob reaches the surface when it matches a fixed path, …` above `function inSurface(entry)`, line 1040, through the closing `}` of `function surfaceTask(planText)`, line 1058) with the block below (plan decisions 3-6). `globToRegExp` above it is unchanged. Depends on T-104.
  ```js
  // A glob reaches a protected directory when its leading segments can name it; a segment holding `**` can name
  // anything beneath. A glob shorter than the directory names only the directory entry, never a file inside it.
  function reachesDir(segs, dir) {
    for (const [i, part] of dir.split('/').entries()) {
      if (i >= segs.length) return false;
      if (segs[i].includes('**')) return true;
      if (!globToRegExp(segs[i]).test(part)) return false;
    }
    return true;
  }
  function reachesList(glob, list) {
    const segs = glob.split('/');
    return list.some((p) => (p.endsWith('/**') ? reachesDir(segs, p.slice(0, -3)) : globToRegExp(glob).test(p)));
  }
  // Case-insensitive filesystems resolve differently-cased spellings to the same file; every protected path is lower-case.
  const taskGlob = (entry) => entry.replace(/^\.\//, '').toLowerCase();
  // NTFS aliases one file under other spellings: a data stream, an 8.3 short name, a trailing dot or space.
  const ntfsAlias = (glob) => glob.split('/').some((seg) => /[:~]|[. ]$/.test(seg));
  function inSurface(entry) {
    const glob = taskGlob(entry);
    return ntfsAlias(glob) || reachesList(glob, WRITE_SURFACE);
  }
  // No alias test: surfaceTask runs inSurface first, and it escalates every alias.
  const inControlPlane = (entry) => reachesList(taskGlob(entry), CONTROL_PLANE);

  // Owner decisions (FEAT-054, BUG-080): a plan whose task would write the run's own record, or the files that enforce
  // the guards and steer later dispatches, never passes on a delegated verdict. The write surface keeps its reason first.
  function surfaceTask(planText) {
    for (const t of extractTasks(planText)) {
      const path = t.files.find(inSurface);
      if (path !== undefined) return `task ${t.id} declares ${path} inside the orchestrator write surface`;
      const plane = t.files.find(inControlPlane);
      if (plane !== undefined) return `task ${t.id} declares ${plane} inside the control-plane files`;
    }
    return null;
  }
  ```
- [X] [T-106] Green step: `npx vitest run tests/scripts/orchestrate.test.js -t "BUG-080"`. Predicted: the same 56 tests, all **green**. Then `npx vitest run tests/scripts/orchestrate.test.js tests/hooks/guard6.test.js`: `orchestrate.test.js` 682 passed (626 + 56), U22's 18 rows and U16 included; `guard6.test.js` all green, its `ORCH_WRITE_SURFACE` parity pin (line 215) included (AC4, AC6). Depends on T-105.
- [X] [T-107] Stage: `git add -u scripts/orchestrate.mjs`, `git add -u tests/scripts/orchestrate.test.js`, `git add -u docs/superpowers/plans/2026-11-14-bug080-unattended-plan-check-does-not-escalate-tasks.md`. Depends on T-106.
- [X] [T-108] Commit: `fix: escalate unattended plan tasks that write guard-enforcement and control-plane files [BUG-080]`. Depends on T-107.

---

### Task 2: Full suite and closeout

**Files:**
- Modify: `docs/superpowers/plans/2026-11-14-bug080-unattended-plan-check-does-not-escalate-tasks.md`

- [X] [T-201] Run `npm test`. Predicted: exit 0, every file green, 56 tests more than the pre-change suite (all in `orchestrate.test.js`; no existing test edited), no new skip (AC7). Depends on T-108.
- [X] [T-202] Grep checks: `git grep -n "inControlPlane\|reachesDir\|reachesList" -- scripts` shows each defined once in `scripts/orchestrate.mjs` and used only there; `git grep -n "first.startsWith('\*\*')" -- scripts` shows no match (the old first-segment test is gone); `git diff --stat 11b86a3 -- .claude project-template lib tools` is empty (no hook, settings, command, installer or skip-baseline change). Depends on T-201.
- [X] [T-203] Stage: `git add -u docs/superpowers/plans/2026-11-14-bug080-unattended-plan-check-does-not-escalate-tasks.md` (ticks T-108 to T-202). Depends on T-202.
- [X] [T-204] Commit: `docs: close out the BUG-080 plan [BUG-080]`. Depends on T-203.

---

## Test List

- [X] Integration, AC1 (one row per control-plane entry): U41, 28 rows, each asserting the printed line, `approvals.plan === null`, the recorded `delegated.plan` entry and a following owner `approve plan` at exit 0.
- [X] Integration, AC2 (directory, glob and case forms): U42, 14 rows, same assertions.
- [X] Integration, AC3 (near misses approve): U43, 9 rows, `plan approved by delegated review` and `approvals.plan.by === 'define-review'`.
- [X] Integration, AC4 (write-surface reason kept): U22 unchanged (18 rows, `.claude/**` and `**/*.json` included) and U44 (`*/hooks/x.sh`, `**/bash-scan-allowlist.txt`, `.claude/hooks./x`).
- [X] Integration, AC5 (plan order wins): U45.
- [X] Unit, AC6: the `WRITE_SURFACE` pins (`tests/scripts/orchestrate.test.js` lines 470 and 1240) and the Guard 6 parity pin (`tests/hooks/guard6.test.js:215`) unchanged; the new `CONTROL_PLANE` pin.
- [X] AC7: `npm test` green (T-201).
- [X] No E2E/UI test: there is no UI.

## Commit Order

0. Task 0 — the plan and its `.gitignore` leaf (done by this session's commit).
1. Task 1 — the constant, the helper and the new rows, one commit; the suite is green at it.
2. Task 2 — closeout of the plan ticks. The ticks of T-203 and T-204 are made after the last commit and ride whichever commit next stages this plan.

## Identified Risks

- **The "contains `**`" generalization changes `inSurface` for an inner `**`** (plan decision 4). The change only adds escalations, and no existing row uses such a glob; if one was missed, it fails in T-106's full-file run as an unexpected `owner approval required` line naming the glob.
- **A near-miss row that escalates.** `.claude` and `project-template` are one segment shorter than every directory entry they prefix; `reachesDir` returns false when the glob runs out. If a row escalates, T-103 already shows it red (it is predicted green there), before any code is written.
- **Friction on this repository's own unattended runs** (spec, System Impact, accepted by the owner): a plan that edits the commands, agents, `CLAUDE.md` or the router now always waits for `approve plan`. Attended runs and owner approvals never consult the list.
- **Host projects with their own `scripts/ticket.mjs` or similar** escalate although the file is not ours (spec, accepted friction); the owner approves it.
- **Run time.** Each new row drives a run to the plan approval through the CLI, as U22 does; 56 rows add roughly a minute or two to `orchestrate.test.js` (measured baseline about 400 s for 626 tests). No timeout is changed.
- **Line numbers drift.** References are from HEAD 11b86a3; locate by the quoted text if they move.
