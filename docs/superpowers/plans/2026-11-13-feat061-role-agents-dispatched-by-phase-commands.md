# FEAT-061 Role agents dispatched by phase commands outside /cc-orchestrate: implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** `/cc-review`, `/cc-test`, `/cc-spec --delegate` and `/cc-plan --delegate` dispatch the `audit`, `qa`, `spec` and `plan` role agents themselves, through a new out-of-run verb `orchestrate.mjs envelope <spec|plan|audit|qa> [--item <label>] | --clear` that installs an envelope only when no run file exists and never touches a run's files. Guard 7 gives `qa` its envelope's `mem.p.test_command` when no run file exists at all (D1). The agent profiles stop banning ad-hoc use.

**Spec:** `docs/superpowers/specs/2026-11-13-feat061-role-agents-dispatched-by-phase-commands-design.md` (approved 2026-11-13, sha256 `bc12d59299819d606a83f00c4ec09dbaffb9bf38f1768ffe49d4f54f31e76202`). Issue #179. Owner decisions D1 (Guard 7 fallback for qa) and D2 (rest of the spec) are approved.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file> [-t <pattern>]`.

## Global Constraints

- No owner records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines (`README.md:467` onward) stay untouched. The README edit is the four command-table rows only (`README.md:256`, `:257`, `:260`, `:263`).
- No new dependency, no workflow change, no installer change. `scripts/orchestrate.mjs` already ships whole to `.claude/scripts/`, and there is no other copy of it in the repository.
- Protected surface: the two `pre-tool-use.mjs` copies change together, stay byte-identical (`tests/installer/templates.test.js` "ships the front door as one byte-identical mirrored pair"), and ship with their `tests/hooks/guard7.test.js` rows in the same commit. No other guard changes; no SNAP script or settings file changes.
- Every file under `.claude/` (agents, commands, hooks) is edited with the Edit/Write tools; Bash cannot write there.
- Mirrors: `project-template/.claude/agents/<role>.md` = `.claude/agents/<role>.md` byte for byte; `cc-spec.md` and `cc-plan.md` keep differing only in the script path nesting. The inserted sections call the script through `S=.claude/scripts; [ -f "$S/orchestrate.mjs" ] || S=scripts` and `node "$S/orchestrate.mjs"`, the probe `cc-orchestrate.md` uses, so they are byte-identical in both mirrors and the `unnest` rules never apply to them.
- Functions of 30 lines or fewer, guard clauses, comments say why.
- Tests are added and none is skipped, so `tools/skip-baseline.json` is untouched on every CI leg.
- Line numbers below are from this branch at `4df968d`; locate by the quoted text if they move.

## Plan decisions the spec leaves to the implementation

- **Every failure of the verb is a `Refusal`.** The verb reuses `resolveDocs`, `resolveTestCommand`, `checkTestCommand` and `snap-build`/`validate`, which throw `Halt`. `envelopeVerb` catches a `Halt` from the install path and rethrows `new Refusal(e.message)`, so the message keeps the code (`orchestrate: ORCH_TEST_COMMAND_UNRESOLVED: …`) and the exit is 2. `cli` also skips `recordHalt` for `envelope` (`verb !== 'start' && verb !== 'envelope'`), the exclusion the spec asks for, so a `Halt` that escaped by a future edit still could not be written into another run.
- **State classification.** `runState(root, sessionId)` reads `join(root, RUN_FILE)` without throwing: absent is N; a file that parses, passes `isValidRun`, and whose `session_id` equals a non-empty `CLAUDE_CODE_SESSION_ID` is L; anything else is O. The root is `findRunRoot(cwd)`, which prefers any ancestor holding a run file over the nearest `.claude/`, so a run file anywhere up the walk is never missed.
- **Argument grammar.** `envelope <role>`, `envelope <role> --item <label>`, `envelope --clear`, nothing else. Usage line: `usage: orchestrate.mjs envelope <spec|plan|audit|qa> [--item <label>] | --clear`. Arguments are checked before the state is read, so a bad call writes nothing in every state.
- **Exact verb output.**
  - N install: first line `installed: <role> envelope at .claude/memory/band-envelope.json`, then the envelope JSON on the next line.
  - `audit` in L: `not-installed: live run <item>; audit has no write tool and no shell, so it needs no envelope`. In O: `not-installed: a run file at <path> belongs to another session or is unreadable; audit has no write tool and no shell, so it needs no envelope`.
  - `qa` in L: `not-installed: live run <item>; qa runs <test_command>`. A live run whose `test_command` is not a non-empty string (a hand edit) is refused instead: `envelope qa: run <item> records no test command, so Guard 7 grants qa no shell; end it, then start`. Printing `qa runs undefined` would send the command into a dispatch Guard 7 then denies.
  - `spec`/`plan` in L: refusal `envelope <role>: run <item> is live in this session and its Define band writes this document; continue with /cc-orchestrate, or end the run`. The commands stop on the fixed phrase `is live in this session`, which is how they tell L from O without a second exit code.
  - `spec`/`plan`/`qa` in O: refusal `envelope <role>: a run file at <path> belongs to another session or is unreadable; clear it with: node <scriptRef> end`.
  - `--clear`: N prints `cleared` or `no envelope`; L and O refuse `envelope --clear: a run file exists at <path>; the envelope belongs to that run`.
- **Envelope fields in N.** `adhocFields(root, role, label)` builds `{ ph: PHASE[role], c: headCommit(root), s: label, n: [], f: [], d: [], x: [], role, tk: ROLE_ARTIFACTS[role].tk, gate: expectedGate(role) }`, adds `scope: resolveDocs(root, label).scopes[role]` for `spec`/`plan` (the resolver and cap `start` pins, label passed as the item) and `p: { test_command: checkTestCommand(resolveTestCommand(root)) }` for `qa`. `headCommit(root)` is extracted from `envelopeFields` (its two `head` lines), so both builders share one HEAD rule and `envelopeFields`' behaviour is unchanged. Measured while writing this plan: these field sets build with `snap-build.mjs` and pass `snap-validate --to <role>` for `spec` (gate `boundary_routed`), `audit` and `qa` (gate `build_executed`), with `s` `adhoc` and `mem.p.test_command` `npm test`.
- **`--clear` runs only after `installed:`.** In L and O nothing was installed, and `--clear` would refuse anyway. Each command says so.
- **`/cc-test` calls the verb before Phase 0, not at the run step.** In L the command must write no test file, so the state has to be known before any test is written. On `installed:` the envelope stays in place while the main session writes tests (Guard 5 never applies to the main session or to a non-role sub-agent), qa is dispatched at "Run tests after writing them", and the command clears the envelope on every path it ends on, also when the developer declines the run. This keeps the spec's table: N installs, dispatches at the run step, then clears.
- **`/cc-review`'s dispatch section sits before Phase 0** and ends the command when it dispatched: the spec says the three-layer review and its Phase 0 skills run only on the classic path. The classic path keeps its own verdict and "auto-fix the critical and important issues" offer; only the dispatch path offers to fix `blocker` and `major` findings.
- **`--delegate` is a flag, not part of the topic.** The cc-spec and cc-plan sections say to leave it out of the topic and of the codebase search.
- **Profile wording.** The spec gives the new `description` tails and the three body sentences verbatim. It names only the dispatch sentence of the opening paragraph ("The orchestrator dispatched you …"), so the profile's first sentence ("You are the `<role>` role of a code-conductor orchestrated run.") is left as it is. The inserted sentences go where the spec places them: the no-envelope sentence right after "Read the envelope first." in `audit` and `qa`; qa's outside-a-run sentence right after the first sentence of "The test command" section. Appendix A gives each replacement exactly.
- **Profile hashes.** Appendix A's edits were applied to copies of the current profiles while writing this plan; the resulting sha256 values are pinned in T-303. Every profile stays far under the 999-token cap (largest: `security`, 3548 bytes). The `define-review` profile changes too but has no row in `PROFILE_SHA256_1_37_0`, so it gets none.
- **Guard 7 message.** The `ROLE_SHELL_UNRESOLVED` reason text stays as it is, so every existing guard7 row keeps its expected string.

## Baseline (measured on this branch at `4df968d`, before Task 1)

Per file, in the sandbox this plan was written in: `tests/scripts/orchestrate.test.js` 393, `tests/hooks/guard7.test.js` 49, `tests/installer/commands-parity.test.js` 73, `tests/unit/role-profiles.test.js` 59, all passing. No test name contains `FEAT-061`. Full suite (`npx vitest run`): 66 files, 2676 tests, 2662 passed, 12 skipped, 2 failed. The two failures are `tests/unit/staging-convention.test.js` AC7 and AC8 (this sandbox's git does not exit 128 on `git add -u` of an untracked path), an environment fact independent of this item.

Precondition for the role-profiles suite: `project-template/.claude/agents/` holds only the seven profiles. A tool session whose working directory is inside that folder can leave a `.claude/` directory there, which fails "ships exactly the ROLES plus define-review"; never `cd` into it.

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-13-feat061-role-agents-dispatched-by-phase-commands.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file. No dependency.
- [X] [T-002] `.gitignore`: add the leaf `!/docs/superpowers/plans/2026-11-13-feat061-role-agents-dispatched-by-phase-commands.md` in sorted position, right after `!/docs/superpowers/plans/2026-11-13-feat059-security-agent-verdict-contract-with-introduced.md`. Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` and `git add docs/superpowers/plans/2026-11-13-feat061-role-agents-dispatched-by-phase-commands.md` (new file; T-002's leaf re-includes it, so the plain form is correct). Depends on T-002.
- [X] [T-004] Commit: `docs: plan for role agents dispatched by phase commands outside a run [FEAT-061]`. Depends on T-003.

---

### Task 1: The `envelope` verb

**Files:**
- Modify: `scripts/orchestrate.mjs`
- Test: `tests/scripts/orchestrate.test.js`
- Modify: this plan (ticks)

- [ ] [T-101] `tests/scripts/orchestrate.test.js`: add `statSync` to the `node:fs` import (line 3). Rename the test at line 1029 to `it('[FEAT-061] names review and envelope in the usage line', …)` and change its expected string to `'orchestrate: usage: orchestrate.mjs start|install|handback|approve|hash|review|envelope|end'`. No dependency.
- [ ] [T-102] `tests/scripts/orchestrate.test.js`: append `describe('envelope verb outside a run [FEAT-061]', …)` with 33 tests. Depends on T-101.
  - Helpers inside it:
    - `const ENV_USAGE = 'orchestrate: usage: orchestrate.mjs envelope <spec|plan|audit|qa> [--item <label>] | --clear';`
    - `const INSTALLED = (role) => `installed: ${role} envelope at ${ENVELOPE_FILE}`;`
    - `const validates = (role) => spawnSync(process.execPath, [join(REPO_ROOT, 'scripts/snap-validate.mjs'), join(root, ENVELOPE_FILE), '--to', role], { encoding: 'utf8' }).status;`
    - `function surface()`: for `RUN_FILE`, `ENVELOPE_FILE` and every file under `.conductor/` (a recursive `readdirSync` walk, sorted), the present ones as `[rel, readFileSync(...).toString('base64'), statSync(...).mtimeMs]`.
    - `function setState(state)`: `'L'` and `'foreign'` run `agents()`, `orch(['start', 'FEAT-011'])` (status 0) and `orch(['install', 'spec'])` (status 0, so an envelope is present); `'unparseable'` runs `agents()`, writes `{not json` to `RUN_FILE` and `'{"v":3}'` to `ENVELOPE_FILE`. Every state then writes `.conductor/handback/keep.txt` with `keep\n`. Returns the `sid` to call with: `'sess-2'` for `'foreign'`, else `'sess-1'`.
  1-2. `it.each(['spec', 'plan'])('[AC1] %s in state N installs an RW envelope whose scope is the one start pins', …)`: `agents()`; `r = orch(['envelope', role, '--item', 'FEAT-011'])`; status 0; `r.out.split('\n')[0]` is `INSTALLED(role)`; `validates(role)` is 0; `envelope().sys` has `tk` `'RW'`, `s` `'FEAT-011'`; `existsSync(join(root, RUN_FILE))` is false; keep `scope = envelope().ops.scope`, then `orch(['start', 'FEAT-011'])` is status 0 and `runFile().docs.scopes[role]` equals `scope`.
  3. `[AC1] audit in state N installs an R envelope with no scope, labelled adhoc`: `agents()`; status 0, first line `INSTALLED('audit')`, `validates('audit')` 0, `envelope().sys.tk` `'R'`, `envelope().sys.s` `'adhoc'`, `envelope().ops.gate` `'build_executed'`, `envelope().ops.scope` undefined, no run file.
  4. `[AC1] qa in state N installs an X envelope carrying the resolved test command`: `agents()`; status 0, `validates('qa')` 0, `envelope().sys.tk` `'X'`, `envelope().mem.p` equals `{ test_command: 'npm test' }`, no run file.
  5. `[AC1] qa in state N is refused when no test command resolves, and writes nothing`: `agents()`; `writeFileSync(join(root, 'package.json'), '{"scripts":{}}')`; status 2; `err` starts with `'orchestrate: ORCH_TEST_COMMAND_UNRESOLVED: '`; no envelope file, no run file.
  6. `[AC1] state N is refused with ORCH_AGENT_MISSING when the role has no agent definition`: no `agents()`; `orch(['envelope', 'audit'])` status 2, `err` is `'orchestrate: ORCH_AGENT_MISSING: no agent definition named audit in .claude/agents/ or ~/.claude/agents/'`; no envelope file.
  7. `[AC1] state N overwrites a leftover envelope`: `agents()`; write `'{"left":"over"}'` to `ENVELOPE_FILE`; `orch(['envelope', 'audit'])` status 0; `envelope().sys.role` is `'audit'`.
  8. `[AC1] --clear in state N removes the envelope, then is a no-op that exits 0`: `agents()`; `orch(['envelope', 'qa'])`; `orch(['envelope', '--clear'])` is `{ status: 0, out: 'cleared' }` and the file is gone; a second `--clear` is `{ status: 0, out: 'no envelope' }`.
  9-17. `it.each([[['code']], [['security']], [['nope']], [[]], [['spec', '--item', 'a b']], [['spec', '--item', '../x']], [['spec', '--item']], [['audit', '--label', 'x']], [['qa', '--item', 'x', 'extra']]])('[AC1] envelope %j is refused with the usage line and writes nothing', …)`: `agents()`; status 2; `err` is `ENV_USAGE`; no envelope file, no run file.
  18-32. `it.each` of 15 rows `[state, args, status, text]`, named `'[AC1] %s: envelope %j leaves every run file as it was'`. For each: `const sid = setState(state); const before = surface(); const r = orch(['envelope', ...args], { sid });` then `r.status` is `status`; `text` is matched against `status === 0 ? r.out : r.err` with `toContain`; `surface()` equals `before`; for `'L'` and `'foreign'`, `runFile().halt` is `null`. Rows (states `L`, `foreign`, `unparseable` each with these five calls):
    - `['spec']` → 2, L: `'is live in this session'`; foreign and unparseable: `'belongs to another session or is unreadable; clear it with: node '`;
    - `['plan']` → the same as `spec`;
    - `['audit']` → 0, L: `'not-installed: live run FEAT-011; audit has no write tool'`; foreign and unparseable: `'not-installed: a run file at '`;
    - `['qa']` → L: 0, `'not-installed: live run FEAT-011; qa runs npm test'`; foreign and unparseable: 2, `'belongs to another session or is unreadable; clear it with: node '`;
    - `['--clear']` → 2, `'envelope --clear: a run file exists at '`.
  33. `[AC1] qa in a live run with no recorded test command is refused`: `setState('L')`; `runFileText(JSON.stringify({ ...runFile(), test_command: undefined }))`; `orch(['envelope', 'qa'])` status 2, `err` contains `'records no test command, so Guard 7 grants qa no shell'`; `runFile().halt` is `null`.
- [ ] [T-103] Red step: `npx vitest run tests/scripts/orchestrate.test.js -t FEAT-061`. Predicted match set: 34 tests, all red (the 33 of T-102 and the renamed usage test of T-101): the verb does not exist, so every call exits 2 with the old usage line, no envelope is written, and the usage string lacks `envelope`. Depends on T-102.
- [ ] [T-104] `scripts/orchestrate.mjs`: after `gitValue` (line 362), add `const headCommit = (root) => { const head = gitValue(root, ['rev-parse', 'HEAD'], '0000000').toLowerCase(); return /^[0-9a-f]{7,40}$/.test(head) ? head : '0000000'; };`; in `envelopeFields`, delete the `const head = …` line (375) and set `c: headCommit(root)`. Nothing else in `envelopeFields` changes. Depends on T-103.
- [ ] [T-105] `scripts/orchestrate.mjs`: after `recordHalt` (line 938), add the verb, per plan decisions. Depends on T-104.
  - Header comment above the block: `// FEAT-061: a phase command dispatches its role outside a run. With a run file present, even a foreign or broken one, the verb writes nothing: the envelope path is the run's.`
  - `const ENVELOPE_ROLES = ['spec', 'plan', 'audit', 'qa'];`, `const ENVELOPE_USAGE = 'usage: orchestrate.mjs envelope <spec|plan|audit|qa> [--item <label>] | --clear';`, `const LABEL = /^[a-zA-Z0-9._-]+$/;` with `// The sys.s pattern snap-validate enforces.`
  - `parseEnvelopeArgs(args)` → `{ clear: true }` for exactly `['--clear']`; `{ role, label: 'adhoc' }` for `[role]`; `{ role, label }` for `[role, '--item', label]` with `LABEL.test(label)`; any other shape throws `new Refusal(ENVELOPE_USAGE)`.
  - `runState(root, sessionId)` → `{ state: 'N' }`, `{ state: 'L', run }` or `{ state: 'O', path }`, per plan decisions. Comment: `// Read without throwing: an unreadable run file is another owner's to clear, never this verb's halt.`
  - `withRunFile(root, role, st)` returns the `not-installed:` lines or throws the refusals of plan decisions, in this order: `audit`; `qa` in L (the missing-command refusal, else the line); `spec`/`plan` in L; every remaining case the O refusal naming `node ${scriptRef(root)} end`.
  - `adhocFields(root, role, label)` per plan decisions.
  - `installAdhoc(root, role, label)`: the `findAgent` check throwing the `ORCH_AGENT_MISSING` `Halt` `install` throws; `runScript('snap-build.mjs', [], JSON.stringify(adhocFields(root, role, label)))` (non-zero → `Halt('SNAP_ERROR', built.err)`); `validate(built.out, role)` (an error → `Halt('SNAP_ERROR', error)`); `writeAtomic(join(root, ENVELOPE_FILE), built.out)`; returns `` `installed: ${role} envelope at ${ENVELOPE_FILE}\n${built.out.trim()}` ``.
  - `clearAdhoc(root, st)` per plan decisions; `rmSync(path, { force: true })` only in N.
  - `envelopeVerb(root, sessionId, args)`: `parseEnvelopeArgs`, `runState`, then `clearAdhoc`, `withRunFile` or `installAdhoc`; a `Halt` from `installAdhoc` becomes `new Refusal(e.message)`. Comment: `// Every failure is a Refusal, so no halt is ever recorded in a run this verb does not own.`
- [ ] [T-106] `scripts/orchestrate.mjs` `cli` (line 945): add `envelope: () => envelopeVerb(root, sid, argv.slice(1)),` before `end`; the usage refusal becomes `'usage: orchestrate.mjs start|install|handback|approve|hash|review|envelope|end'`; the halt line becomes `if (verb !== 'start' && verb !== 'envelope') recordHalt(root, e);`. Depends on T-105.
- [ ] [T-107] Green step: `npx vitest run tests/scripts/orchestrate.test.js`. Predicted: 426 tests, all pass (393 existing, the renamed usage test among them, plus 33). Depends on T-106.
- [ ] [T-108] Stage: `git add -u scripts/orchestrate.mjs`, `git add -u tests/scripts/orchestrate.test.js`, `git add -u docs/superpowers/plans/2026-11-13-feat061-role-agents-dispatched-by-phase-commands.md`. Depends on T-107.
- [ ] [T-109] Commit: `feat: add the out-of-run envelope verb that never touches a run's files [FEAT-061]`. Depends on T-108.

---

### Task 2: Guard 7 gives qa its envelope's command when no run file exists (D1)

**Files:**
- Modify: `.claude/hooks/pre-tool-use.mjs`
- Modify: `project-template/.claude/hooks/pre-tool-use.mjs`
- Test: `tests/hooks/guard7.test.js`
- Modify: this plan (ticks)

- [ ] [T-201] `tests/hooks/guard7.test.js`: append `describe('Guard 7: qa outside any run runs its envelope\'s command [FEAT-061]', …)` with 14 tests. Depends on T-109.
  - Helpers: `const ENV = join('.claude', 'memory', 'band-envelope.json');`, `const envelopeOf = (role, p) => writeFileSync(join(root, ENV), JSON.stringify({ v: 3, sys: { ph: 'rev', c: '0000000', s: 'adhoc', role, tk: 'X' }, ops: { n: [], f: [], gate: 'build_executed' }, mem: { d: [], x: [], ...(p === undefined ? {} : { p }) }, pr: '' }));`, `const UNRESOLVED_QA = denied('Guard 7: ROLE_SHELL_UNRESOLVED: no live run in this session records a test command, so qa has no shell.');`.
  1. `[D1] allows qa the envelope's test command when no run file exists`: `envelopeOf('qa', { test_command: 'npm test' })`; `as('qa', 'npm test')` is `null`.
  2. `[D1] denies any other command with ROLE_SHELL_NOT_ALLOWED, naming the envelope's command`: same envelope; `as('qa', 'npm test --watch')` equals `NOT_ALLOWED`.
  3. `[D1] still checks chaining first`: same envelope; `as('qa', 'npm test; x')` equals `chaining(';')`.
  4-10. `it.each` of 7 rows `('[D1] leaves qa ROLE_SHELL_UNRESOLVED with %s', (_, setup) => …)`, each expecting `UNRESOLVED_QA` for `as('qa', 'npm test')`:
    - `'a run file of another session'`: `envelopeOf('qa', { test_command: 'npm test' }); runFile({ session_id: 'sess-2' });`
    - `'a run file that exists but is unreadable'`: the same envelope; `writeFileSync(join(root, RUN_FILE), '{not json')`;
    - `'an envelope of another role'`: `envelopeOf('code', { test_command: 'npm test' })`;
    - `'no p in the envelope'`: `envelopeOf('qa')`;
    - `'an empty test_command'`: `envelopeOf('qa', { test_command: '' })`;
    - `'a test_command that is not a string'`: `envelopeOf('qa', { test_command: 42 })`;
    - `'an unreadable envelope'`: `writeFileSync(join(root, ENV), '{x')`.
  11-12. `it.each([['code', 'no live run in this session records a test command, so code has no shell.'], ['security', 'no live run in this session records the security commands, so security has no shell.']])('[D1] gives %s no fallback from an envelope naming it', (role, reason) => …)`: `envelopeOf(role, { test_command: 'npm test' })`; `as(role, 'npm test')` equals `denied(`Guard 7: ROLE_SHELL_UNRESOLVED: ${reason}`)`.
  13. `[D1] finds the envelope by the ancestor walk from a subdirectory`: `envelopeOf('qa', { test_command: 'npm test' })`; `mkdirSync(join(root, 'sub'))`; `fire(bash('npm test', { cwd: join(root, 'sub'), agentType: 'qa' }))` is `null`.
  14. `[D1] the envelope the envelope verb installs passes Guard 7 as qa`: write `package.json` = `PKG`, `.claude/agents/qa.md` = `'---\nname: qa\ndescription: fixture\n---\nfixture\n'`; `spawnSync(process.execPath, [ORCH, 'envelope', 'qa'], { cwd: root, env: { ...process.env, CLAUDE_CODE_SESSION_ID: 'sess-1' }, encoding: 'utf8', timeout: 30000 })` has status 0; `as('qa', 'npm test')` is `null`.
- [ ] [T-202] Red step: `npx vitest run tests/hooks/guard7.test.js -t FEAT-061`. Predicted match set: 14 tests; red: 1, 2, 13 and 14 (today every qa command without a live run is `ROLE_SHELL_UNRESOLVED`); green: 3 (chaining already runs first), 4-10 and 11-12 (already `ROLE_SHELL_UNRESOLVED`). Depends on T-201.
- [ ] [T-203] `.claude/hooks/pre-tool-use.mjs`: after `allowedCommands` (line 304), add:
  ```js
  // FEAT-061 D1: outside every run, qa's one command is the one a phase command put in its envelope.
  // Any run file, even a foreign or unreadable one, withholds it, so a broken run's leftover envelope grants nothing.
  function envelopeCommand(role, payload) {
    const cwd = payloadCwd(payload);
    if (role !== 'qa' || findRootHolding(cwd, ORCH_RUN_REL)) return null;
    const root = findRootHolding(cwd, BAND_ENVELOPE_REL);
    const env = root ? readEnvelope(join(root, ...BAND_ENVELOPE_REL)) : null;
    const command = env?.sys.role === 'qa' && isPlainObject(env.mem) ? env.mem.p?.test_command : undefined;
    return nonEmptyString(command) ? [command] : null;
  }
  ```
  and in `roleShellDecision` change `const allowed = run && allowedCommands(role, run);` (line 322) to `const allowed = run ? allowedCommands(role, run) : envelopeCommand(role, payload);`. Nothing else changes: the metacharacter check still precedes, and the match stays `allowed.includes(command)`. Depends on T-202.
- [ ] [T-204] `project-template/.claude/hooks/pre-tool-use.mjs`: the same two edits as T-203, so the file is byte-identical to `.claude/hooks/pre-tool-use.mjs` (`cmp` exits 0). Depends on T-203.
- [ ] [T-205] Green step: `npx vitest run tests/hooks/guard7.test.js tests/hooks/guard5.test.js tests/hooks/guard6.test.js tests/installer/templates.test.js`. Predicted: guard7 63 tests (49 + 14), all pass; guard5, guard6 and templates all pass with their counts unchanged (the mirror-identity test among them). Depends on T-204.
- [ ] [T-206] Stage: `git add -u .claude/hooks/pre-tool-use.mjs`, `git add -u project-template/.claude/hooks/pre-tool-use.mjs`, `git add -u tests/hooks/guard7.test.js`, `git add -u docs/superpowers/plans/2026-11-13-feat061-role-agents-dispatched-by-phase-commands.md`. Depends on T-205.
- [ ] [T-207] Commit: `feat: let Guard 7 give qa its envelope's test command when no run file exists [FEAT-061]`. Depends on T-206.

---

### Task 3: The profiles stop banning ad-hoc use

**Files:**
- Modify: `project-template/.claude/agents/{spec,plan,audit,qa,code,security,define-review}.md`
- Modify: `.claude/agents/{spec,plan,audit,qa,code,security,define-review}.md`
- Test: `tests/unit/role-profiles.test.js`
- Modify: this plan (ticks)

- [ ] [T-301] `tests/unit/role-profiles.test.js`: after the `SECURITY_REPORT` constant, add `DISPATCHED_BY` (the seven `description` tails of Appendix A, keyed by role) and `const DISPATCH_BODY = 'The orchestrator during a run, or a phase command outside one, dispatched you';`, `const NO_ENVELOPE = 'If your brief says no envelope was installed for you, there is none to read; leave the scope key out of the hand-back.';`, `const QA_OUTSIDE = 'Outside a run, it is the `mem.p.test_command` field of your envelope.';`. Append `describe('dispatch outside a run [FEAT-061]', …)` with 36 tests over `const BOTH = [TEMPLATE, MIRROR];` and `const ALL = [...ROLES, 'define-review'];`. Depends on T-207.
  1-14. `it.each(BOTH.flatMap((d) => ALL.map((r) => [d, r])))('[AC2] %s/%s.md no longer forbids ad-hoc use', …)`: the text contains neither `'never use it for ad-hoc work'` nor `'Dispatched only by'`.
  15-28. `it.each(<same rows>)('[AC2] %s/%s.md ends its description with who dispatches it', …)`: `field(text, 'description').endsWith(DISPATCHED_BY[role])` is true.
  29-36. `it.each(BOTH.flatMap((d) => ['spec', 'plan', 'audit', 'qa'].map((r) => [d, r])))('[AC3] %s/%s.md names both dispatchers and what an outside dispatch changes', …)`: contains `DISPATCH_BODY`; contains `NO_ENVELOPE` exactly when the role is `audit` or `qa`; contains `QA_OUTSIDE` exactly when the role is `qa`.
- [ ] [T-302] Red step: `npx vitest run tests/unit/role-profiles.test.js -t FEAT-061`. Predicted match set: 36 tests, all red (every profile still carries the ban; no profile carries the new sentences). Depends on T-301.
- [ ] [T-303] `tests/unit/role-profiles.test.js` `PROFILE_SHA256_1_37_0`: replace six values and add one comment line above the table's first row: `// FEAT-061 changed every profile on purpose: the ad-hoc ban is gone, and spec, plan, audit and qa name the phase command that dispatches them outside a run.` New values: `audit` `f840693def0d12a71892bd2420570f90343597f35cc67137b8bc46fa60c50510`, `code` `8f4242287bd1b96726c0d7bd4b284d6f1443a616e3063e101242381cb17a5e6c`, `plan` `177746869aec848ae12197e138f03a9512836fb83658cb6ad0a941f938ef8129`, `qa` `8e539fa24b4e93bc60864667d9964509601dedb071bf83a03df2237ff13a2a09`, `security` `69fd9a36cdceebce2529793f2cdc909aa8d0dbc02d3f4d373d27485808992ad8`, `spec` `507e65536b73419bebcbbed23bed4f4ba032c5bef05bc98452f3c42446b6758d`. The existing per-row comments stay. Depends on T-302.
- [ ] [T-304] `project-template/.claude/agents/`: apply Appendix A to the seven profiles, one Edit per replacement. Depends on T-303.
- [ ] [T-305] `.claude/agents/`: apply the same replacements, so each file is byte-identical to its template (`cmp` exits 0 for all seven). Depends on T-304.
- [ ] [T-306] Measure: `sha256sum project-template/.claude/agents/*.md` equals the T-303 values for the six rows (and `define-review.md` hashes `f4f8b94a2fedb1ac1bae1f91fdd2ba8147b6b8c0f42ecb2c83cd04b8d6c0219a`). A mismatch means a replacement differs from Appendix A: fix the profile, never the pin. Depends on T-305.
- [ ] [T-307] Green step: `npx vitest run tests/unit/role-profiles.test.js`. Predicted: 95 tests (59 + 36), all pass, the 12 hash rows and the 7 byte-identity rows among them. Depends on T-306.
- [ ] [T-308] Stage: `git add -u` for each of the 14 profile paths (explicit paths, one per file), `git add -u tests/unit/role-profiles.test.js`, `git add -u docs/superpowers/plans/2026-11-13-feat061-role-agents-dispatched-by-phase-commands.md`. Depends on T-307.
- [ ] [T-309] Commit: `feat: role profiles name the phase commands that dispatch them outside a run [FEAT-061]`. Depends on T-308.

---

### Task 4: The phase commands dispatch their role

**Files:**
- Modify: `project-template/.claude/commands/cc-review.md`
- Modify: `project-template/.claude/commands/cc-test.md`
- Modify: `.claude/commands/cc-spec.md`, `project-template/.claude/commands/cc-spec.md`
- Modify: `.claude/commands/cc-plan.md`, `project-template/.claude/commands/cc-plan.md`
- Modify: `README.md`
- Test: `tests/installer/commands-parity.test.js`
- Modify: this plan (ticks)

- [ ] [T-401] `tests/installer/commands-parity.test.js`: after the `cc-plan mirrors` block, add `const SPEC_MIRRORS = ['.claude/commands/cc-spec.md', 'project-template/.claude/commands/cc-spec.md'];` and `describe('cc-spec mirrors', …)` with `it('differ only in the script path nesting', () => expect(unnest(read(SPEC_MIRRORS[1]))).toBe(read(SPEC_MIRRORS[0])))`. Then append `describe('role dispatch from the phase commands [FEAT-061]', …)` with 12 tests. Depends on T-309.
  - Constants: `const PROBE = 'S=.claude/scripts; [ -f "$S/orchestrate.mjs" ] || S=scripts';`, `const CLEAR = 'node "$S/orchestrate.mjs" envelope --clear';`, `const BY_COMMAND = 'a phase command, not a run, dispatched the agent';`, and `const DISPATCH = [...SPEC_MIRRORS.map((rel) => [rel, 'spec', 'envelope spec --item <ID-or-adhoc>']), ...PLAN_MIRRORS.map((rel) => [rel, 'plan', 'envelope plan --item <ID-or-adhoc>']), ['project-template/.claude/commands/cc-review.md', 'audit', 'envelope audit --item <ID-or-adhoc>'], ['project-template/.claude/commands/cc-test.md', 'qa', 'envelope qa']];`.
  1-6. `it.each(DISPATCH)('[AC1] %s installs the %s envelope, dispatches the role, clears it and names its fallback', (rel, role, call) => …)`: the text contains `PROBE`, `` `node "$S/orchestrate.mjs" ${call}` ``, `` `Agent({ subagent_type: "${role}"` ``, `CLEAR`, `` `${role} not dispatched: <the verb's stderr line>` ``, `'`installed:`'` and `BY_COMMAND`.
  7-10. `it.each([...SPEC_MIRRORS, ...PLAN_MIRRORS])('[AC1] %s delegates only under --delegate and stops on a live run', …)`: contains ``'Without `--delegate` in `$ARGUMENTS`, skip this section'`` and `'is live in this session'`.
  11. `[AC1] cc-review dispatches audit only with --spec and --plan and offers to fix blocker and major findings`: the template contains `'audit not dispatched: name --spec and --plan to review against them'`, `'Want me to fix the blocker and major findings?'` and `'Do not run Phase 0 or the three-layer review below.'`.
  12. `[AC1] cc-test writes no test during a live run and never replaces qa's answer`: the template contains `'`not-installed:`'`, `'Write no test file'` and `'never rerun the suite in this session to replace qa\'s answer'`.
- [ ] [T-402] Red step: `npx vitest run tests/installer/commands-parity.test.js -t FEAT-061`. Predicted match set: 12 tests, all red (no command names the verb). `cc-spec mirrors` is outside the filter and green already (measured while writing this plan). Depends on T-401.
- [ ] [T-403] `project-template/.claude/commands/cc-review.md`: insert Appendix B.1 after the Destructive Read Invariant's last line (`If the file cannot be deleted after reading, report the error and halt.`, line 28) and before the `---` that precedes `## Phase 0`. Depends on T-402.
- [ ] [T-404] `project-template/.claude/commands/cc-test.md`: insert Appendix B.2 before `## Phase 0 — Skill activation` (line 5); change `**Run tests after writing them.** Confirm before running.` (line 50) to `**Run tests after writing them.** Confirm before running. After \`installed:\` in the role dispatch above, the run is qa's: dispatch it as **Dispatch** says, instead of running the suite here.` Depends on T-403.
- [ ] [T-405] `.claude/commands/cc-spec.md` and then `project-template/.claude/commands/cc-spec.md`: insert Appendix B.3 after the `---` that follows the `## Complexity Estimate` placeholder (line 123) and before `Wait for explicit approval before proceeding to \`/cc-plan\`.` (line 125). The `## Problem` … `## Complexity Estimate` headings above are the template of the generated spec, so the section goes after that template's closing rule, never inside it. Both copies receive the same bytes. Depends on T-404.
- [ ] [T-406] `.claude/commands/cc-plan.md` and then `project-template/.claude/commands/cc-plan.md`: insert Appendix B.4 after the `---` that follows the `## Identified Risks` placeholder (line 132) and before `Execute one step at a time.` (line 134). `## Test List`, `## Commit Order` and `## Identified Risks` are the template of the generated plan, so the section goes after that template's closing rule. Both copies receive the same bytes. Depends on T-405.
- [ ] [T-407] `README.md`: replace the four command-table rows with Appendix C's rows. Nothing else in the README changes. Depends on T-406.
- [ ] [T-408] Green step: `npx vitest run tests/installer/commands-parity.test.js`. Predicted: 86 tests (73 + 1 `cc-spec mirrors` + 12), all pass, the `cc-plan mirrors` nesting, branch-gate, ordering-clause and tail rows among them. Depends on T-407.
- [ ] [T-409] Stage: `git add -u` for each of the six command paths and `README.md` (explicit paths), `git add -u tests/installer/commands-parity.test.js`, `git add -u docs/superpowers/plans/2026-11-13-feat061-role-agents-dispatched-by-phase-commands.md`. Depends on T-408.
- [ ] [T-410] Commit: `feat: phase commands dispatch the audit, qa, spec and plan roles outside a run [FEAT-061]`. Depends on T-409.

---

### Task 5: Closeout

**Files:**
- Modify: this plan (ticks)

- [ ] [T-501] Full suite: `npm test`. Predicted in this sandbox: 66 files, 2772 tests, 2758 passed, 12 skipped, 2 failed, the failures being the two environment ones named in the baseline (96 new tests: 33 + 14 + 36 + 13; the renamed usage test is not new). On CI the skipped set is unchanged, since no test is skipped by this plan. Any other red is fixed before closeout. Depends on T-410.
- [ ] [T-502] Hygiene: `cmp` each hook pair and each agent pair (exit 0); `grep -rn "Dispatched only by\|never use it for ad-hoc work" .claude/agents project-template/.claude/agents` prints nothing; `git status --short` lists only files this plan names; delete any temporary file created during the build. Depends on T-501.
- [ ] [T-503] Stage: `git add -u docs/superpowers/plans/2026-11-13-feat061-role-agents-dispatched-by-phase-commands.md`. Depends on T-502.
- [ ] [T-504] Commit: `docs: close out the FEAT-061 plan [FEAT-061]`. Depends on T-503.

---

## Test List

- [ ] Unit/CLI: the `envelope` verb in state N for each role (fields, `snap-validate --to`, scope equal to `start`'s pin), its refusals, `--clear`, and the 15-row L/O matrix proving no byte or mtime of the run's files changes and no halt is recorded (`tests/scripts/orchestrate.test.js`, T-102).
- [ ] Hook: Guard 7's qa fallback only with no run file, exact match, chaining first, every withholding case including the unreadable run file, no fallback for code and security, and the verb's real envelope passing the hook (`tests/hooks/guard7.test.js`, T-201).
- [ ] Parity: the ban gone and the dispatcher named in both agents directories, the hash rows updated (`tests/unit/role-profiles.test.js`, T-301, T-303).
- [ ] Parity: the dispatch wording in both mirrors of `cc-spec` and `cc-plan` and in the template's `cc-review` and `cc-test`, plus the new `cc-spec mirrors` block (`tests/installer/commands-parity.test.js`, T-401).
- [ ] No E2E: no UI is affected.

## Commit Order

1. Task 0: the plan and its `.gitignore` leaf (done by the runner at the end of the plan session).
2. Task 1: the verb, with its tests. The hook's integration row (T-201 test 14) needs it, so it lands first.
3. Task 2: the Guard 7 fallback, both hook copies and their rows in one commit (protected surface).
4. Task 3: the 14 profiles and the role-profiles rows, hashes included, in one commit.
5. Task 4: the six command files, the README rows and the parity rows.
6. Task 5: closeout ticks.

## Identified Risks

- **A run's file is touched by the verb.** Caught by the L/O matrix (T-102 18-32), which compares bytes and mtime of the run file, the envelope and the whole `.conductor/` tree, for every call and both kinds of O.
- **A `Halt` escapes into `recordHalt`.** Two layers: `envelopeVerb` converts every install-path `Halt` to a `Refusal`, and `cli` excludes `envelope` from `recordHalt`. T-102 test 5 and 6 pin the exit 2 on a `Halt`-coded failure.
- **Guard 7 grants a shell it should not.** The fallback is limited to `qa`, to a missing run file (existence, not validity), to a `readEnvelope`-valid qa envelope and a non-empty string; T-201 rows 4-12 pin each withholding case, the unreadable run file among them.
- **Hook mirrors drift.** T-204 makes the same two edits; `templates.test.js`'s identity row is in T-205's run, and T-502 runs `cmp`.
- **Profile hash pins mismatch.** The values were measured from Appendix A applied to copies of the current files. T-306 measures before the green step; a mismatch is fixed in the profile.
- **A profile edit trips an existing pin.** None of the replacements touches a D5 phrase, `SHELL`/`NO_SHELL`, a `CLAIM` sentence, a gate name or `docs/superpowers`; the whole role-profiles file runs in T-307.
- **Command mirrors drift.** The inserted sections contain no `node .claude/scripts/`, `-flags> .claude/scripts/` or ``running `.claude/scripts/`` text, so `unnest` leaves them alone and the "differ only in the script path nesting" rows hold; T-408 runs them.
- **Stray `.claude/` under `project-template/.claude/agents/`.** A tool session whose working directory is that folder can create one and fail the directory-listing test; the build never changes directory into it, and T-502's `git status` shows any leftover.
- **Leftover envelope after an interrupted dispatch.** By design (spec Alternative paths): the next `envelope` call overwrites it, `--clear` removes it, and a later `install` overwrites it.

---

## Appendix A: profile replacements

Apply each replacement once, to both copies of the profile. `OLD_TAIL` is `Dispatched only by /cc-orchestrate during a run; never use it for ad-hoc work.`

| Profile | Replace | With |
|---|---|---|
| `spec.md` | `OLD_TAIL` | `Dispatched by /cc-orchestrate during a run, or by /cc-spec --delegate outside one.` |
| `spec.md` | `The orchestrator dispatched you` | `The orchestrator during a run, or a phase command outside one, dispatched you` |
| `plan.md` | `OLD_TAIL` | `Dispatched by /cc-orchestrate during a run, or by /cc-plan --delegate outside one.` |
| `plan.md` | `The orchestrator dispatched you` | `The orchestrator during a run, or a phase command outside one, dispatched you` |
| `audit.md` | `OLD_TAIL` | `Dispatched by /cc-orchestrate during a run, or by /cc-review outside one.` |
| `audit.md` | `The orchestrator dispatched you` | `The orchestrator during a run, or a phase command outside one, dispatched you` |
| `audit.md` | `` `.claude/memory/band-envelope.json`. Read the envelope first. `` | `` `.claude/memory/band-envelope.json`. Read the envelope first. If your brief says no envelope was installed for you, there is none to read; leave the scope key out of the hand-back. `` |
| `qa.md` | `OLD_TAIL` | `Dispatched by /cc-orchestrate during a run, or by /cc-test outside one.` |
| `qa.md` | `The orchestrator dispatched you` | `The orchestrator during a run, or a phase command outside one, dispatched you` |
| `qa.md` | `` `.claude/memory/band-envelope.json`. Read the envelope first. `` | `` `.claude/memory/band-envelope.json`. Read the envelope first. If your brief says no envelope was installed for you, there is none to read; leave the scope key out of the hand-back. `` |
| `qa.md` | ``field of `.claude/memory/orchestrator-run.json`.`` (line 15, "The test command") | ``field of `.claude/memory/orchestrator-run.json`. Outside a run, it is the `mem.p.test_command` field of your envelope.`` |
| `code.md` | `OLD_TAIL` | `Dispatched by /cc-orchestrate during a run.` |
| `security.md` | `OLD_TAIL` | `Dispatched by /cc-orchestrate during a run.` |
| `define-review.md` | `OLD_TAIL` | `Dispatched by /cc-orchestrate during a run.` |

Each "Replace" string occurs exactly once in its profile (measured). The resulting sizes in bytes: spec 1944, plan 2238, audit 2740, qa 2092, code 1974, security 3548, define-review 1568.

## Appendix B: command sections

Each block below is inserted verbatim, with one blank line before and after it. Code fences inside a block are part of the inserted text.

### B.1 `project-template/.claude/commands/cc-review.md`

````markdown
---

## Role dispatch - audit (FEAT-061)

`/cc-review --spec <path> --plan <path> [target]` hands the review to the `audit` role agent, so its read-only tool mask, its guards and its fixed success condition apply. Without both flags, print `audit not dispatched: name --spec and --plan to review against them` and run the classic review below.

1. Install the envelope, from the project root:

   ```sh
   S=.claude/scripts; [ -f "$S/orchestrate.mjs" ] || S=scripts
   node "$S/orchestrate.mjs" envelope audit --item <ID-or-adhoc>
   ```

   `<ID-or-adhoc>` is the backlog id the spec names (for example `FEAT-061`), else `adhoc`.
2. Read the first stdout line. `installed:` means the verb wrote `.claude/memory/band-envelope.json` for audit. `not-installed:` means a run file is present: nothing was written, and audit, which has no write tool and no shell, needs no envelope. On a non-zero exit, or a first line that starts with neither, do not dispatch: print `audit not dispatched: <the verb's stderr line>` and run the classic review below.
3. Dispatch `Agent({ subagent_type: "audit", description: "audit review", prompt })`. The brief names the spec, the plan and the review target (no target means `git diff HEAD`). It says that a phase command, not a run, dispatched the agent, and either that the envelope is installed at `.claude/memory/band-envelope.json` or, after `not-installed:`, that no envelope was installed for it.
4. Show the audit's findings and its `VERDICT:` line exactly as the agent wrote them. Show its `SNAP_HANDBACK` line; do not record it, because no run records an out-of-run hand-back. A guard denial or a report without a hand-back is shown as it is, never retried another way.
5. Only after `installed:`, run `node "$S/orchestrate.mjs" envelope --clear`, also when the agent was denied or ended without a hand-back. If it refuses, report the refusal and leave the file alone: a run now owns it.
6. Offer: "Want me to fix the blocker and major findings?" Do not run Phase 0 or the three-layer review below.
````

### B.2 `project-template/.claude/commands/cc-test.md`

````markdown
## Role dispatch - qa (FEAT-061)

The final suite run belongs to the `qa` role agent, which may run only the project's test command (Guard 7). Before Phase 0, from the project root:

```sh
S=.claude/scripts; [ -f "$S/orchestrate.mjs" ] || S=scripts
node "$S/orchestrate.mjs" envelope qa
```

Branch on the first stdout line:

- **`not-installed:`** — a run of this session is live, and the line names the command qa runs. Write no test file: Guard 6 denies the write, and the run's code tasks own the writes. Skip Phase 0 and everything below it: dispatch qa now, as **Dispatch** says, and report.
- **`installed:`** — no run exists, and the verb wrote `.claude/memory/band-envelope.json` for qa with the test command in it. Continue with Phase 0 and the test writing below; at "Run tests after writing them", dispatch qa instead of running the suite here.
- **A non-zero exit, or any other first line** — print `qa not dispatched: <the verb's stderr line>` and continue with the flow below, running the suite in this session.

**Dispatch:** `Agent({ subagent_type: "qa", description: "run the suite", prompt })`. The brief names the scope (`$ARGUMENTS`). It says that a phase command, not a run, dispatched the agent, and either that the envelope is installed at `.claude/memory/band-envelope.json` or, after `not-installed:`, that no envelope was installed for it. Report qa's exact exit status and summary line as the result. A red suite, a guard denial or a report without a `SNAP_HANDBACK` line is reported as it is: never rerun the suite in this session to replace qa's answer.

**Clear:** after `installed:`, run `node "$S/orchestrate.mjs" envelope --clear` before this command ends, on whatever path it ends, also when the developer declines the run. If it refuses, report the refusal and leave the file alone: a run now owns it.

---
````

### B.3 `cc-spec.md` (both mirrors)

````markdown
## Delegated writing (`--delegate`, FEAT-061)

Without `--delegate` in `$ARGUMENTS`, skip this section: this session writes the spec, as above. With it, the `spec` role agent writes the file under its tool mask and Guard 5's scope check. `--delegate` is a flag, not part of the topic: leave it out of the topic and of the codebase search. The search and the questions above still run here first.

1. Install the envelope, from the project root:

   ```sh
   S=.claude/scripts; [ -f "$S/orchestrate.mjs" ] || S=scripts
   node "$S/orchestrate.mjs" envelope spec --item <ID-or-adhoc>
   ```

   `<ID-or-adhoc>` is the item's backlog id (for example `FEAT-061`), else `adhoc`.
2. Only a first stdout line that starts with `installed:` allows the dispatch; the envelope's `ops.scope` is the folder the spec goes in. If the verb's stderr says the run `is live in this session`, stop: that run's Define band writes this document; continue with `/cc-orchestrate`, or end the run. On any other non-zero exit or first line, print `spec not dispatched: <the verb's stderr line>` and write the spec in this session, as above.
3. Dispatch `Agent({ subagent_type: "spec", description: "write spec", prompt })`. The brief names the item, the folder from the envelope's scope, the answers gathered above, and the section list above as the content to write. It says that a phase command, not a run, dispatched the agent, and that the envelope is installed at `.claude/memory/band-envelope.json`.
4. Show the agent's report and its `SNAP_HANDBACK` line; do not record the hand-back. A guard denial or a report without a hand-back is shown as it is, never retried another way.
5. Run `node "$S/orchestrate.mjs" envelope --clear`, also when the agent was denied or ended without a hand-back. If it refuses, report the refusal and leave the file alone: a run now owns it.
6. The written spec then goes through the approval wait below, as a spec written in this session would.
````

### B.4 `cc-plan.md` (both mirrors)

````markdown
## Delegated writing (`--delegate`, FEAT-061)

Without `--delegate` in `$ARGUMENTS`, skip this section: this session writes the plan, as above. With it, the `plan` role agent writes the file under its tool mask and Guard 5's scope check. `--delegate` is a flag, not part of the spec name. The approved-spec check and the codebase mapping above still run here first.

1. Install the envelope, from the project root:

   ```sh
   S=.claude/scripts; [ -f "$S/orchestrate.mjs" ] || S=scripts
   node "$S/orchestrate.mjs" envelope plan --item <ID-or-adhoc>
   ```

   `<ID-or-adhoc>` is the item's backlog id (for example `FEAT-061`), else `adhoc`.
2. Only a first stdout line that starts with `installed:` allows the dispatch; the envelope's `ops.scope` is the folder the plan goes in. If the verb's stderr says the run `is live in this session`, stop: that run's Define band writes this document; continue with `/cc-orchestrate`, or end the run. On any other non-zero exit or first line, print `plan not dispatched: <the verb's stderr line>` and write the plan in this session, as above.
3. Dispatch `Agent({ subagent_type: "plan", description: "write plan", prompt })`. The brief names the item, the approved spec's path and the folder from the envelope's scope. As the content to write, it gives the Task ID Requirements and the Ordered Steps, Test List, Commit Order and Identified Risks sections above, with a `**Files:**` block under each task. It says that a phase command, not a run, dispatched the agent, and that the envelope is installed at `.claude/memory/band-envelope.json`.
4. Show the agent's report and its `SNAP_HANDBACK` line; do not record the hand-back. A guard denial or a report without a hand-back is shown as it is, never retried another way.
5. Run `node "$S/orchestrate.mjs" envelope --clear`, also when the agent was denied or ended without a hand-back. If it refuses, report the refusal and leave the file alone: a run now owns it.
6. Check the written plan's task ids as Task ID Requirements says. The plan then goes through the approval and the Phase exit branch gate, as a plan written in this session would.
````

## Appendix C: README command-table rows

```markdown
| `/cc-spec [name] [--delegate]` | Search the codebase first, ask only for missing context, write a full feature spec, and **wait for your approval** before any plan is made. With `--delegate`, the `spec` role agent writes the file inside an envelope scoped to the spec folder. |
| `/cc-plan [--delegate]` | From an approved spec, map the codebase and write an ordered plan with exact file paths, a test list, a commit order, and risks. Every task line carries a unique `[T-NNN]` ID (at least 3 digits, unlimited suffix depth) with plain ASCII checkboxes. With `--delegate`, the `plan` role agent writes the file inside an envelope scoped to the plan folder. |
| `/cc-review [--spec <path> --plan <path>] [file\|dir]` | Review in three layers (Critical / Important / Suggestion), deliver a verdict, and offer to auto-fix. With `--spec` and `--plan`, the read-only `audit` role agent reviews against them instead and ends in one `VERDICT:` line. |
| `/cc-test [scope]` | Find coverage gaps, write AAA-pattern tests (plus Playwright E2E where applicable), run after confirmation, and report results. The suite run is the `qa` role agent's, which may run only the project's test command; during a live run it writes no test. |
```
