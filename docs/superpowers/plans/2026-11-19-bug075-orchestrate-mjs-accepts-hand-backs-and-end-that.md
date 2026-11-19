# BUG-075 hand-back scope claims, a verified `end` and the approver identity implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** `scripts/orchestrate.mjs` stops recording claims that contradict the run. (1) `handback <role>` halts `ORCH_HANDBACK_SCOPE_MISMATCH` when the hand-back's `ops.scope` is not the scope the script recomputes for that position, and `ORCH_HANDBACK_OUT_OF_SCOPE` when an `ops.f` path is unsafe or outside that scope. (2) `end` refuses `ORCH_END_UNVERIFIED` on a live run without `qa`'s `verify_pass`, unless the owner passes `--abandon`. (3) `approve` records `by: "owner"`. (4) `resume` applies the claim check to the code hand-backs it keeps. Both `cc-orchestrate.md` copies name the new codes and `end --abandon`.

**Spec:** `docs/superpowers/specs/2026-11-19-bug075-orchestrate-mjs-accepts-hand-backs-and-end-that-design.md` (sha256 `4c140c98e70656e6a55b49d6a291d5b4dba612b9fb90744eec64c70b57d9808a`). Issue #175.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>` and, inside `tests/scripts/orchestrate.test.js`, `-t '<pattern>'`.

## Owner decisions

Recorded in the approved spec ("Owner decisions"). They are constraints on this plan, not open questions.

1. **A red suite in a `code` hand-back stays accepted.** No `TESTS:` report line, no change to `.claude/agents/code.md` or to the Build band. The pass claim rides the non-author `verify_pass` that `end` now requires.
2. **The rest of the spec stands as proposed:** the expected scope is recomputed from `codeScope` / `docScopes`, never read from `band-envelope.json`; the codes `ORCH_HANDBACK_SCOPE_MISMATCH`, `ORCH_HANDBACK_OUT_OF_SCOPE`, `ORCH_END_UNVERIFIED`; `end --abandon`; `approve` records `by: "owner"`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines stay untouched.
- **Five files change, plus this plan and its `.gitignore` leaf:** `scripts/orchestrate.mjs`, `tests/scripts/orchestrate.test.js`, `tests/installer/commands-parity.test.js`, `.claude/commands/cc-orchestrate.md`, `project-template/.claude/commands/cc-orchestrate.md`. No hook, installer, SNAP script (`snap-validate.mjs`, `snap-build.mjs`, `snap-contract.mjs`), role file under `.claude/agents/`, settings file, workflow or dependency changes (spec, Out of Scope).
- `project-template/` carries no copy of `orchestrate.mjs` (measured: `project-template/.claude/` holds `agents`, `commands`, `flow-status.mjs`, `hooks`, `memory` and two settings files), so the only mirror is `cc-orchestrate.md`. The installer copies `scripts/` at install time; no parity test pins a second script copy.
- The two `cc-orchestrate.md` copies stay byte-identical (`tests/installer/commands-parity.test.js:197` and the `diff` in T-302).
- Every file this plan edits after Task 0 is already tracked, so every staging step after Task 0 is `git add -u <path>` with an explicit path.
- `.claude/` is read-only for shell commands in some sandboxes. Edit `.claude/commands/cc-orchestrate.md` with a file-edit tool, not with `sed`.
- No new import, no new export, no new run-file field. `gitValue` keeps its other callers (`headCommit`, `headObject`, `checkApproval`), so it stays.

## Review Focus

- **Where the claim check sits.** After the `ORCH_GATE_UNEARNED` check and before the `security` branch (`scripts/orchestrate.mjs:983-985`), so it covers every role, `security` included, and runs before any `saveRun`. A failing claim is a `Halt`: `cli` records it on the run (`recordHalt`) and nothing else is written.
- **The expected scope is recomputed** (spec, choice 1): `codeScope(root, run, nextStep(run))` for `code` (task or fix round, the same call `envelopeFields` makes) and `docScopes(run.docs)[role]` for `spec` / `plan`. Never `band-envelope.json` (C10 edits it to `["**"]` and still halts).
- **"Covered" uses one matcher, `globToRegExp`, for both kinds of scope** (plan decision 2). For a code scope of plain paths that is exact equality, as the spec's choice 2 says; it differs only if a plan's `**Files:**` entry is itself a glob, which Guard 5 already reads as a glob.
- **Unsafe paths are rejected before matching** and never normalized: a drive letter, a leading `/` (empty first segment), an empty, `.` or `..` segment, a trailing `/`.
- **`end`'s three untouched cases** (halted, invalid run file, no run file) print byte for byte what they print today (E3, and the unchanged FEAT-011 / RS2 tests).
- **`--abandon` never relabels a verified run** (E4's second half).
- **The shared fixture now copies the installed scope** (plan decision 4). That is what keeps the ~1000 existing hand-back cases meaningful without per-test edits.

## Plan decisions

1. **The script (`scripts/orchestrate.mjs`).** Measured in a scratch copy at `958e03b` (plan decision 7). Each block is the exact text to apply.
   - **a. One halt factory, reused (`:555-569`).** Directly above `function envelopeFields(run, root, step) {` (line 555) add:
     ```js
     const docLocationHalt = (run) => new Halt('ORCH_DOC_LOCATION_UNRESOLVED', `run ${run.item} records no docs location (started before FEAT-047); run end, then start`);

     ```
     and replace the three-line `if (...) { throw new Halt('ORCH_DOC_LOCATION_UNRESOLVED', …); }` at lines 565-567 with
     `    if (!isPlainObject(run.docs?.scopes) || !Array.isArray(run.docs.scopes[step.role])) throw docLocationHalt(run);`
     The halt text is byte-identical.
   - **b. The claim helpers (above `async function handback`, line 972).**
     ```js
     // BUG-075: recomputed as install computed it, never read back from the envelope file, which the orchestrator can write.
     function expectedScope(root, run, role) {
       if (role === 'code') return codeScope(root, run, nextStep(run));
       if (role !== 'spec' && role !== 'plan') return null;
       if (!isPlainObject(run.docs)) throw docLocationHalt(run);
       return docScopes(run.docs)[role];
     }

     const sameList = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);
     const scopeText = (scope) => (scope === null || scope === undefined ? 'none' : JSON.stringify(scope));
     // A path that needs normalizing is not the one the scope names, so it is never normalized.
     const unsafePath = (p) => /^[A-Za-z]:/.test(p) || p.split('/').some((seg) => seg === '' || seg === '.' || seg === '..');

     // BUG-075: returned, not thrown, so resume drops the record where handback halts on it.
     function claimHalt(env, role, expected) {
       const claimed = env.ops.scope;
       if (expected === null ? claimed !== undefined : !sameList(claimed, expected)) {
         return new Halt('ORCH_HANDBACK_SCOPE_MISMATCH', `${role} was installed with scope ${scopeText(expected)}, the hand-back names ${scopeText(claimed)}`);
       }
       if (expected === null) return null;
       const covers = expected.map(globToRegExp);
       const paths = (Array.isArray(env.ops.f) ? env.ops.f : []).map((f) => String(f).replace(/:[CMD]$/, ''));
       const outside = paths.find((p) => unsafePath(p) || !covers.some((re) => re.test(p)));
       if (outside === undefined) return null;
       return new Halt('ORCH_HANDBACK_OUT_OF_SCOPE', `${role} lists ${outside} in ops.f, outside its scope ${scopeText(expected)}`);
     }
     ```
     `globToRegExp` (line 1116) and `codeScope` (line 549) are `function` declarations, so the forward reference is hoisted. `nextStep` at hand-back time returns the dispatched position, because `install` does not change `handbacks`, `tasks` or `approvals`.
   - **c. The call (`handback`, after line 984).** Directly after the closing `}` of the `ORCH_GATE_UNEARNED` check and before `if (role === 'security') …`:
     ```js
       const claim = claimHalt(env, role, expectedScope(root, run, role));
       if (claim) throw claim;
     ```
   - **d. The approver (`approve`, line 1019).** `by: gitValue(root, ['config', 'user.name'], 'unknown'),` becomes `by: 'owner',`. The other keys and their order are unchanged (the FEAT-055 A3 test pins `at, by, path, commit, sha256` as a set). The delegated path (`by: 'define-review'`) is untouched.
   - **e. Resume (`taskEntryHolds`, lines 1277-1283, and its call at line 1292).** The function gains `run` as its second parameter and the claim check after the ancestry check:
     ```js
     // A task entry still describes the repository: its position, its SNAP and its commit all hold.
     // BUG-075: and it still names the scope its task installs, over paths inside it.
     function taskEntryHolds(root, run, entry, taskId) {
       if (entry.task !== taskId || typeof entry.snap !== 'string' || validate(`${entry.snap}\n`) !== '') return false;
       let env = null;
       try { env = JSON.parse(entry.snap); } catch { return false; }
       if (env?.sys?.role !== 'code' || ancestry(root, env.sys.c) !== 0) return false;
       try { return claimHalt(env, 'code', codeScope(root, run, { task: taskId })) === null; } catch (e) {
         if (e instanceof Halt) return false;
         throw e;
       }
     }
     ```
     The call becomes `taskEntryHolds(root, run, tasks[n], run.tasks.ids[n])`. A `Halt` from `codeScope` (for example `ORCH_EMPTY_SCOPE`) fails the entry instead of escaping `resume`, because `resume` records no halt and must refuse or succeed (FEAT-055). By the time `keptEntries` runs, `checkApproval` has already proved the plan readable at its approved hash.
   - **f. `end` (lines 1490-1497).** Replaced by:
     ```js
     const END_USAGE = 'usage: orchestrate.mjs end [--abandon]';

     // BUG-075: the run end would drop before Verify passed, or null; a missing, broken or halted run is never held.
     function unverifiedRun(root) {
       let run = null;
       try { run = readRun(root); } catch { return null; }
       if (!run || run.halt) return null;
       const last = run.handbacks.at(-1);
       return last?.role === 'qa' && last.gate === 'verify_pass' ? null : run;
     }

     // Prints the run it removes, so the closing report reads the record rather than memory.
     // BUG-075: a live run ends only after qa's verify_pass, unless the owner abandons it by name.
     function end(root, args) {
       if (args.length > 1 || (args.length === 1 && args[0] !== '--abandon')) throw new Refusal(END_USAGE);
       const run = unverifiedRun(root);
       if (run && args.length === 0) {
         throw new Refusal(`ORCH_END_UNVERIFIED: run ${run.item} is at ${describeStep(nextStep(run))} with no verify_pass; end it only after qa, after a halt, or with end --abandon on the owner's word`);
       }
       const path = join(root, RUN_FILE);
       const text = existsSync(path) ? readFileSync(path, 'utf8').trim() : 'no run file';
       rmSync(path, { force: true });
       clearRunFiles(root);
       return run ? `run ${run.item} abandoned at ${run.gate} before verify_pass\n${text}` : text;
     }
     ```
     `readRun` throws `ORCH_RUN_INVALID` on a broken file; catching it keeps today's "remove it" behavior (spec, Alternative paths). The refusal is a `Refusal` (exit 2, nothing recorded), so the live run is left exactly as it was. `<next step>` is `describeStep(nextStep(run))`, the text every other refusal uses (`install code`, `approve plan`, `delegate build`).
   - **g. Dispatch (line 1603).** `end: () => end(root),` becomes `end: () => end(root, argv.slice(1)),`.
2. **One matcher for "covered".** The spec's choice 2 says a code scope is a list of exact paths and a path is covered when it equals one. `globToRegExp` of a path with no `*` is anchored exact equality (every other regex character is escaped), so using it for code scopes gives the spec's rule for every scope `taskScope` builds from plain `**Files:**` entries. Using one matcher keeps `claimHalt` to one branch and agrees with Guard 5, which reads a task's `**Files:**` entries as globs (comment at line 1115). The spec's error texts and halt codes are unchanged by this choice.
3. **Error text format.** `<expected>` and `<claimed>` print as JSON arrays (`["src/a.js","tests/a.test.js","docs/plans/demo.md"]`) or `none`. JSON shows order and element boundaries unambiguously, which the order-sensitive check needs.
4. **The shared fixture (`tests/scripts/orchestrate.test.js:86-89`).** Every role file tells the agent to copy its envelope's `ops.scope` verbatim, so the fixture does too. `handbackLine` becomes:
   ```js
   // BUG-075: a role copies its installed envelope's ops.scope verbatim, so the fixture does too; extra.scope overrides it.
   const installedScope = (role) => { try { const env = envelope(); return env.sys.role === role ? env.ops.scope : undefined; } catch { return undefined; } };
   const handbackLine = (role, gate, extra = {}) => {
     const scope = 'scope' in extra ? extra.scope : installedScope(role);
     return 'SNAP_HANDBACK ' + JSON.stringify({
       v: extra.v ?? 3, sys: { ph: 'impl', c: '0000000', s: 'FEAT-011', role, tk: 'X', ...extra.sys },
       ops: { n: [], f: extra.f ?? (role === 'spec' ? [`${SPEC}:C`] : []), gate, ...(scope === undefined ? {} : { scope }) }, mem: { d: [], x: [] }, pr: '',
     });
   };
   ```
   `envelope()` is defined at line 59, above this point. The role filter keeps a stale envelope of another role out of the line. `say`, `auditReport` and `securityReport` all build on `handbackLine`, so `driveTo` and every suite inherit it with no other edit.
5. **Existing tests that change (measured, plan decision 7).** Exactly 12 existing tests fail under decision 1 plus decision 4, and each is fixed as below, never by weakening the script:
   - **Live-run cleanups that pass `--abandon`** (spec, AC13): `start records boundary_routed in step mode …` (`:270`), `keeps the binding across end …` (`:750`), `[C7] start removes a stale owner file …` (`:2461`, after `driveTo('qa')` with no qa hand-back), `U2` (`:3430`), `U7` (`:3485`), `U29` (`:4352`). Each `orch(['end']);` becomes `orch(['end', '--abandon']);`.
   - **Live-run ends that parse the record** (`:315` "end removes the run file …", `[E2]` `:1064`, `U30` `:4364`): `orch(['end'])` becomes `orch(['end', '--abandon'])`, and `JSON.parse(….out)` becomes `abandonedRecord(….out)`. The helper goes directly below `runFile` (line 56):
     ```js
     // BUG-075: end --abandon on a live run prints its abandon line, then the record.
     const abandonedRecord = (out) => JSON.parse(out.slice(out.indexOf('\n') + 1));
     ```
   - **RS3** (`:2814-2815`): the spec and plan lines are built when the envelope on disk is the plan's (or, for the spec line, another role's), so they pass their scope explicitly: `handbackLine('spec', 'boundary_routed', { scope: ['docs/specs/**'] })` and `handbackLine('plan', 'boundary_routed', { scope: ['docs/plans/**'] })`. The code line is unchanged.
   - **BUG-077 B3 and B7** (`:1734`, `:1761`). The hand-back that names `README.md:M`, or `.claude/specs/b-design.md:C` outside the pinned `pillar-3/` group, now halts `ORCH_HANDBACK_OUT_OF_SCOPE` before `approve` can see it (covered by the new C7). `approve`'s `ORCH_SPEC_NOT_HANDED_BACK` stays as the second line for a run file edited after the hand-back, so B3 and B7 now reach it that way. Add inside the BUG-077 describe, directly above `it('B3 [AC3] …`:
     ```js
     // BUG-075: the hand-back itself halts on a path outside the folder, so only an edited run file still reaches approve with one.
     const storedSpecFiles = (f) => {
       const run = runFile();
       const entry = run.handbacks.findLast((h) => h.role === 'spec');
       const env = JSON.parse(entry.snap);
       entry.snap = JSON.stringify({ ...env, ops: { ...env.ops, f } });
       runFileText(JSON.stringify(run, null, 2) + '\n');
     };
     ```
     B3's `handedBack([`${SPEC}:C`, 'README.md:M']);` becomes `handedBack([`${SPEC}:C`]);` followed by `storedSpecFiles([`${SPEC}:C`, 'README.md:M']);`. B7's `handBack(['.claude/specs/b-design.md:C']);` becomes `handBack([]);` followed by `storedSpecFiles(['.claude/specs/b-design.md:C']);`. Their assertions are unchanged.
   - Every other `orch(['end'])` call site is after a halt, after `qa`'s `verify_pass`, on an invalid run file or with no run file, and stays as it is (`:329`, `:354`, `:1383`, `:1827`, `:2013`, `:2216`, `:2509`, `:2913`, `:3474`).
   - The spec's System Impact expected L199 and the A3 test (`:1616`) to change. They assert `by: expect.any(String)`, which `'owner'` satisfies, so they stay. The exact value is pinned by the new A1.
6. **New tests.**
   - **a. The `[BUG-075]` describe block** goes directly above `describe('Build and Verify review loop [FEAT-057]'` (line 1772), after the BUG-077 block:
     ```js
     describe('hand-back claims, end and approver [BUG-075]', () => {
       const TASK1 = ['src/a.js', 'tests/a.test.js', PLAN];
       const codeSay = (extra) => `Done.\nObservation: fine.\n${handbackLine('code', 'build_executed', extra)}\n`;
       const atCode = () => { driveTo('code'); expect(orch(['install', 'code']).status).toBe(0); };
       // A refused claim halts with its code and leaves the record as it was, apart from the halt.
       const haltsUnrecorded = (role, input, err) => {
         const before = runFile();
         const r = orch(['handback', role], { input });
         expect({ status: r.status, err: r.err }).toEqual({ status: 1, err });
         const after = runFile();
         expect(after.halt.code).toBe(err.split(':')[0]);
         expect(after.handbacks).toEqual(before.handbacks);
         expect(after.tasks).toEqual(before.tasks);
       };
       const mismatch = (role, expected, claimed) => `ORCH_HANDBACK_SCOPE_MISMATCH: ${role} was installed with scope ${expected}, the hand-back names ${claimed}`;
       const outside = (role, path, scope) => `ORCH_HANDBACK_OUT_OF_SCOPE: ${role} lists ${path} in ops.f, outside its scope ${scope}`;
       const unverified = (next) => `orchestrate: ORCH_END_UNVERIFIED: run FEAT-011 is at ${next} with no verify_pass; end it only after qa, after a halt, or with end --abandon on the owner's word`;
       const verified = () => {
         driveTo('qa');
         expect(orch(['install', 'qa']).status).toBe(0);
         expect(orch(['handback', 'qa'], { input: say('qa', 'verify_pass') }).status).toBe(0);
       };

       it('C1 [AC1] a code hand-back naming scope ["**"] halts ORCH_HANDBACK_SCOPE_MISMATCH and records nothing', () => {
         atCode();
         haltsUnrecorded('code', codeSay({ scope: ['**'], f: ['../x:M'] }), mismatch('code', JSON.stringify(TASK1), '["**"]'));
       });

       it.each(['src/b.js:M', 'README.md:M', '../x:M', '/abs:M', 'a/./b:M', 'a//b:M', 'C:/x:M', 'src/a.js/:M'])('C2 [AC2] ops.f entry %s halts ORCH_HANDBACK_OUT_OF_SCOPE', (entry) => {
         atCode();
         haltsUnrecorded('code', codeSay({ f: ['src/a.js:M', entry] }), outside('code', entry.slice(0, -2), JSON.stringify(TASK1)));
       });

       it('C3 [AC3] the installed scope in another order halts ORCH_HANDBACK_SCOPE_MISMATCH', () => {
         atCode();
         const reversed = [...TASK1].reverse();
         haltsUnrecorded('code', codeSay({ scope: reversed }), mismatch('code', JSON.stringify(TASK1), JSON.stringify(reversed)));
       });

       it('C4 [AC4] a conforming code hand-back is recorded as before', () => {
         atCode();
         const r = orch(['handback', 'code'], { input: codeSay({ f: ['src/a.js:M', 'tests/a.test.js:C', `${PLAN}:M`] }) });
         expect(r).toMatchObject({ status: 0, out: 'code handed back build_executed' });
         expect(runFile().tasks.done).toBe(1);
         expect(runFile().halt).toBeNull();
       });

       it('C5 [AC4] a fix round is checked against its fix scope', () => {
         driveTo('audit');
         expect(orch(['install', 'audit']).status).toBe(0);
         expect(orch(['handback', 'audit'], { input: auditReport('VERDICT: RETURN', ['- [blocker] src/a.js:10 — breaks AC1']) }).status).toBe(0);
         expect(orch(['install', 'code']).status).toBe(0);
         expect(envelope().ops.scope).toEqual(['src/a.js', PLAN]);
         expect(orch(['handback', 'code'], { input: codeSay({ f: ['src/a.js:M', `${PLAN}:M`] }) }).status).toBe(0);
         expect(runFile().handbacks.at(-1)).toMatchObject({ role: 'code', fix: 1 });
       });

       it('C6 [AC4] a fix-round hand-back naming a plan file outside the fix scope halts', () => {
         driveTo('audit');
         expect(orch(['install', 'audit']).status).toBe(0);
         expect(orch(['handback', 'audit'], { input: auditReport('VERDICT: RETURN', ['- [blocker] src/a.js:10 — breaks AC1']) }).status).toBe(0);
         expect(orch(['install', 'code']).status).toBe(0);
         haltsUnrecorded('code', codeSay({ f: ['src/b.js:M'] }), outside('code', 'src/b.js', JSON.stringify(['src/a.js', PLAN])));
       });

       it.each([
         ['spec', 'README.md:M', '["docs/specs/**"]'],
         ['spec', 'docs/specs/../x.md:C', '["docs/specs/**"]'],
         ['plan', `${SPEC}:C`, '["docs/plans/**"]'],
       ])('C7 [AC5] a %s hand-back naming %s halts ORCH_HANDBACK_OUT_OF_SCOPE', (role, entry, scope) => {
         driveTo(role);
         expect(orch(['install', role]).status).toBe(0);
         const f = role === 'spec' ? [`${SPEC}:C`, entry] : [`${PLAN}:C`, entry];
         haltsUnrecorded(role, `Done.\n${handbackLine(role, 'boundary_routed', { f })}\n`, outside(role, entry.slice(0, -2), scope));
       });

       it('C8 [AC5] a plan hand-back naming its document under the plan folder is recorded', () => {
         driveTo('plan');
         expect(orch(['install', 'plan']).status).toBe(0);
         expect(orch(['handback', 'plan'], { input: `Done.\n${handbackLine('plan', 'boundary_routed', { f: [`${PLAN}:C`] })}\n` }).status).toBe(0);
         expect(runFile().handbacks.at(-1).role).toBe('plan');
       });

       it.each(['audit', 'qa', 'security'])('C9 [AC6] a %s hand-back carrying ops.scope halts ORCH_HANDBACK_SCOPE_MISMATCH', (role) => {
         driveTo(role);
         expect(orch(['install', role]).status).toBe(0);
         const extra = { scope: ['src/a.js'], ...(role === 'security' ? { v: 4, sys: { ph: 'rev' } } : {}) };
         const line = handbackLine(role, role === 'qa' ? 'verify_pass' : 'build_executed', extra);
         const input = role === 'security' ? securityReport().replace(/^SNAP_HANDBACK .*$/m, line) : role === 'audit' ? `Done.\nVERDICT: APPROVE\n${line}\n` : `Done.\n${line}\n`;
         haltsUnrecorded(role, input, mismatch(role, 'none', '["src/a.js"]'));
       });

       it('C10 [AC7] the scope is recomputed, never read back from the envelope file', () => {
         atCode();
         const env = envelope();
         writeFileSync(join(root, ENVELOPE_FILE), JSON.stringify({ ...env, ops: { ...env.ops, scope: ['**'] } }) + '\n');
         haltsUnrecorded('code', codeSay({ scope: ['**'] }), mismatch('code', JSON.stringify(TASK1), '["**"]'));
       });

       it('E1 [AC8] end on a live run with no verify_pass refuses and removes nothing', () => {
         atCode();
         const before = readFileSync(join(root, RUN_FILE), 'utf8');
         const r = orch(['end']);
         expect({ status: r.status, err: r.err, out: r.out }).toEqual({ status: 2, err: unverified('install code'), out: '' });
         expect(readFileSync(join(root, RUN_FILE), 'utf8')).toBe(before);
         expect(existsSync(join(root, ENVELOPE_FILE))).toBe(true);
       });

       it('E2 [AC9] end after qa\'s verify_pass prints the record byte for byte', () => {
         verified();
         const record = readFileSync(join(root, RUN_FILE), 'utf8').trim();
         expect(orch(['end'])).toMatchObject({ status: 0, out: record });
         expect(existsSync(join(root, RUN_FILE))).toBe(false);
       });

       it('E3 [AC9] end on a halted run, an invalid run file and no run file behaves as before', () => {
         atCode();
         expect(orch(['handback', 'code'], { input: 'Done.\n' }).status).toBe(1);
         const halted = readFileSync(join(root, RUN_FILE), 'utf8').trim();
         expect(orch(['end'])).toMatchObject({ status: 0, out: halted });
         runFileText('{not json');
         expect(orch(['end'])).toMatchObject({ status: 0, out: '{not json' });
         expect(orch(['end'])).toMatchObject({ status: 0, out: 'no run file' });
       });

       it('E4 [AC10] end --abandon drops a live unverified run under its abandon line, and prints a verified one alone', () => {
         atCode();
         const record = readFileSync(join(root, RUN_FILE), 'utf8').trim();
         const r = orch(['end', '--abandon']);
         expect(r).toMatchObject({ status: 0, out: `run FEAT-011 abandoned at define_approved before verify_pass\n${record}` });
         for (const f of [RUN_FILE, ENVELOPE_FILE]) expect(existsSync(join(root, f))).toBe(false);
         rmSync(join(root, PLAN));
         verified();
         const done = readFileSync(join(root, RUN_FILE), 'utf8').trim();
         expect(orch(['end', '--abandon'])).toMatchObject({ status: 0, out: done });
       });

       it.each([[['--force']], [['--abandon', 'x']]])('E5 end with arguments %j refuses with its usage', (args) => {
         atCode();
         const before = readFileSync(join(root, RUN_FILE), 'utf8');
         expect(orch(['end', ...args])).toMatchObject({ status: 2, err: 'orchestrate: usage: orchestrate.mjs end [--abandon]' });
         expect(readFileSync(join(root, RUN_FILE), 'utf8')).toBe(before);
       });

       it.each([['set', true], ['unset', false]])('A1 [AC11] approve records by "owner" with git user.name %s', (_, named) => {
         driveTo('code', { prep: () => { fixtureGit('init', '-q'); if (named) fixtureGit('config', 'user.name', 'Someone Else'); } });
         expect(runFile().approvals.spec.by).toBe('owner');
         expect(runFile().approvals.plan.by).toBe('owner');
       });
     });
     ```
     `fixtureGit` passes `-c user.name=t` on its own command line only; `git config user.name 'Someone Else'` writes the fixture repository's local config, which is what `approve` used to read. The test `HOME` is an empty temp directory, so "unset" really is unset. The delegated `by: 'define-review'` stays pinned by the FEAT-054 tests at `:3580`, `:3772`, `:3888`, `:3929`, `:3990`, `:4258`.
   - **b. RS21 in the resume describe** (it needs `built`, `haltAgentMissing`, `editRun` and `resumed`, which are local to that block), directly above `it('RS12 [AC5] …` (line 2936):
     ```js
       it.each([
         ['a stored scope of ["**"]', (env) => ({ ...env, ops: { ...env.ops, scope: ['**'] } })],
         ['a stored ops.f path outside the task', (env) => ({ ...env, ops: { ...env.ops, f: ['../x:M'] } })],
       ])('RS21 [BUG-075 AC12] %s on task 2 cuts the sequence there', (_, edit) => {
         built(2);
         haltAgentMissing();
         editRun((run) => { run.handbacks[3].snap = JSON.stringify(edit(JSON.parse(run.handbacks[3].snap))); });
         expect(orch(['resume']).out).toBe(resumed('ORCH_AGENT_MISSING', 'define_approved', 5, 1, 'install code (task 2 of 3)'));
         expect(runFile().tasks.done).toBe(1);
       });

     ```
     The expected counts match RS11's "corrupted snap on task 2" case: the edited SNAP still validates, so only the new check cuts it.
   - **c. Parity** (`tests/installer/commands-parity.test.js`), directly after the BUG-077 `it` that ends at line 407, inside `describe('cc-orchestrate review loop …')`:
     ```js

       it('names the hand-back claim halts, the end refusal and end --abandon [BUG-075]', () => {
         has('`ORCH_HANDBACK_SCOPE_MISMATCH`', '`ORCH_HANDBACK_OUT_OF_SCOPE`', '`ORCH_END_UNVERIFIED`', '**Abandon (BUG-075).**',
           'node "$S/orchestrate.mjs" end --abandon', 'Never pass `--abandon` on your own.');
       });
     ```
7. **Measured before writing this plan** (base `958e03b`, on a scratch copy outside the repository; the working tree here was not touched until this plan and its leaf).
   - Baseline: `npx vitest run tests/scripts/orchestrate.test.js` gave **1092 passed (1092)** in about 510 s.
   - Decisions 1 and 4 alone gave **12 failed, 1080 passed (1092)**: exactly the 12 tests decision 5 lists (six cleanups, three record parses, RS3, B3, B7).
   - With decisions 5 and 6 added, `-t 'BUG-075|BUG-077|RS3 |RS11|RS21'` gave **44 passed** (1079 skipped, 1123 total).
   - With the test changes and the original `scripts/orchestrate.mjs`, `-t 'BUG-075'` gave **26 failed, 5 passed** (1092 skipped). Green on the original: C4, C5, C8, E2, E3, because they pin behavior that does not change.
   - The command text of decision 8 with the parity `it` of 6c: `npx vitest run tests/installer/commands-parity.test.js` gave **93 passed (93)**.
   - The full `npm test` on the scratch copy: see Baseline.
8. **The command text (both `cc-orchestrate.md` copies, identical).**
   - **a.** After the paragraph that ends ``… `install security` halts the same two codes.`` (line 35), insert one blank line and:
     `` `handback <role>` halts `ORCH_HANDBACK_SCOPE_MISMATCH` when the hand-back's `ops.scope` is not the scope `install` wrote for that position, entry for entry and in the same order, or when `audit`, `security` or `qa`, which are installed with no scope, hand back one; and `ORCH_HANDBACK_OUT_OF_SCOPE` when a path in `ops.f` is absolute, has an empty, `.` or `..` segment, or lies outside that scope. The script recomputes the scope from the plan and the run's pinned folders; it never reads it back from `.claude/memory/band-envelope.json`. Neither halt records the hand-back. For both, name the hand-back file you passed: it is what the owner reads next. Recovery is `resume` or `end`, then `start`. ``
   - **b.** After the Resume paragraph, which ends ``After any of them but `ORCH_RESUME_NOT_HALTED`, recovery is `end`, then `start`.`` (line 43), insert one blank line and:
     `` **Abandon (BUG-075).** `end` ends a live run only after `qa` records `verify_pass`; a halted run, an invalid run file and a missing one need no flag. On a live run with no `verify_pass`, `end` refuses with `ORCH_END_UNVERIFIED`, exit 2, and removes nothing. To drop such a run on the owner's word only (after `ORCH_RUN_ACTIVE`, after a declined pause, or to restart), run `node "$S/orchestrate.mjs" end --abandon`. Its first line reads `run <ITEM> abandoned at <gate> before verify_pass` and the record follows: report that line, and never present the run as finished. Never pass `--abandon` on your own. ``
   - **c.** Line 49: ``   - On `ORCH_RUN_ACTIVE`, report it, offer `end`, and stop.`` becomes ``   - On `ORCH_RUN_ACTIVE`, report it, offer `end --abandon` (see "Abandon" under "On any halt"), and stop.``
   - **d.** Step 5 (line 82) ends ``When `qa`'s hand-back records `verify_pass`, run `node "$S/orchestrate.mjs" end`. It prints the run it removed.``; append `` Before that hand-back `end` refuses with `ORCH_END_UNVERIFIED`.`` to the same line.
   No role file and no SNAP schema changes (spec, AC14). Every "recovery is `end`, then `start`" in the halt list stays true, because each follows a halt.
9. **`.gitignore` leaf.** `!/docs/superpowers/plans/2026-11-19-bug075-orchestrate-mjs-accepts-hand-backs-and-end-that.md` goes directly after the `2026-11-19-bug069` plan leaf and before the `2026-11-19-bug077` one, its full-path sorted position. `tests/unit/gitignore-block-parity.test.js` checks it.

## Baseline (measured on base 958e03b)

- `npx vitest run tests/scripts/orchestrate.test.js`: **1092 passed (1092)**, about 510 s in this sandbox.
- After the whole change: the same file reads **1123 passed (1123)** (1092 + 31 new: 29 in the BUG-075 block, 2 RS21 cases); `tests/installer/commands-parity.test.js` reads **93 passed (93)**.
- Full `npm test` on the scratch copy with the whole change: **2 failed, 3505 passed, 13 skipped (3520)** across 66 files. The two reds are ENV: `tests/unit/staging-convention.test.js` AC7 and AC8, which the BUG-077 plan already measured as sandbox failures (uid 0, git 2.43.0). That file is not one this plan touches. No other file is red. On CI, where that cause does not apply, the exit status is 0.

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-19-bug075-orchestrate-mjs-accepts-hand-backs-and-end-that.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file from the approved spec `4c140c98…`. No dependency.
- [X] [T-002] `.gitignore`: insert the leaf of plan decision 9 after the `2026-11-19-bug069` plan leaf. Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` (tracked) and `git add docs/superpowers/plans/2026-11-19-bug075-orchestrate-mjs-accepts-hand-backs-and-end-that.md` (new, re-included by its leaf). Depends on T-002.
- [X] [T-004] Commit: `docs: plan hand-back scope checks, a verified end and the owner approver [BUG-075]`. Depends on T-003.

---

### Task 1: Tests first (red)

**Files:**
- Modify: `tests/scripts/orchestrate.test.js:56`, `:86-89`, `:270`, `:315-317`, `:750`, `:1064`, `:1734-1735`, `:1766`, `:1772`, `:2461`, `:2814-2815`, `:2936`, `:3430`, `:3485`, `:4352`, `:4364`
- Modify: `tests/installer/commands-parity.test.js:407`

- [ ] [T-101] `tests/scripts/orchestrate.test.js:86-89`: replace `handbackLine` with the fixture of plan decision 4. Depends on T-004.
- [ ] [T-102] `tests/scripts/orchestrate.test.js:56`: add `abandonedRecord` below `runFile` (plan decision 5). Depends on T-101.
- [ ] [T-103] `tests/scripts/orchestrate.test.js`: pass `--abandon` at the six live-run cleanups of plan decision 5 (`:270`, `:750`, `:2461`, `:3430`, `:3485`, `:4352`). Depends on T-102.
- [ ] [T-104] `tests/scripts/orchestrate.test.js`: pass `--abandon` and read `abandonedRecord` at the three record parses of plan decision 5 (`:315-317`, `:1064`, `:4364`). Depends on T-103.
- [ ] [T-105] `tests/scripts/orchestrate.test.js:2814-2815`: give RS3's spec and plan lines their explicit scopes (plan decision 5). Depends on T-104.
- [ ] [T-106] `tests/scripts/orchestrate.test.js:1734-1766`: add `storedSpecFiles` and rewrite the B3 and B7 setups (plan decision 5). Depends on T-105.
- [ ] [T-107] `tests/scripts/orchestrate.test.js:1772`: insert the `[BUG-075]` describe block of plan decision 6a above `describe('Build and Verify review loop [FEAT-057]'`. Depends on T-106.
- [ ] [T-108] `tests/scripts/orchestrate.test.js`: insert RS21 (plan decision 6b) above `it('RS12 [AC5] …`. Depends on T-107.
- [ ] [T-109] `tests/installer/commands-parity.test.js:407`: add the `[BUG-075]` `it` of plan decision 6c. Depends on T-108.
- [ ] [T-110] Red run: `npx vitest run tests/scripts/orchestrate.test.js -t 'BUG-075'`. Its full match set is the 29 tests of the BUG-075 block and the 2 RS21 cases; no existing title contains `BUG-075`. Predicted: **26 failed, 5 passed** (1092 skipped). Green: C4, C5, C8, E2, E3. Any other split means a test is wrong: fix the test, not the prediction. Depends on T-109.
- [ ] [T-111] Red run: `npx vitest run tests/installer/commands-parity.test.js -t 'BUG-075'`. Predicted: **1 failed** (the new test, at its first `toContain`), every other test in the file skipped. Depends on T-110.

---

### Task 2: The checks, `end` and the command text (green)

**Files:**
- Modify: `scripts/orchestrate.mjs:555-569`, `:972-985`, `:1019`, `:1277-1292`, `:1490-1497`, `:1603`
- Modify: `.claude/commands/cc-orchestrate.md:35`, `:43`, `:49`, `:82`
- Modify: `project-template/.claude/commands/cc-orchestrate.md:35`, `:43`, `:49`, `:82`

- [ ] [T-201] `scripts/orchestrate.mjs:555-567`: add `docLocationHalt` and use it in `envelopeFields` (plan decision 1a). Depends on T-111.
- [ ] [T-202] `scripts/orchestrate.mjs:972`: add `expectedScope`, `sameList`, `scopeText`, `unsafePath` and `claimHalt` above `handback` (plan decision 1b). Depends on T-201.
- [ ] [T-203] `scripts/orchestrate.mjs` (`handback`): add the claim call after the `ORCH_GATE_UNEARNED` check (plan decision 1c). Depends on T-202.
- [ ] [T-204] `scripts/orchestrate.mjs` (`approve`): record `by: 'owner'` (plan decision 1d). Depends on T-203.
- [ ] [T-205] `scripts/orchestrate.mjs` (`taskEntryHolds`, `keptEntries`): add the resume claim check and pass `run` (plan decision 1e). Depends on T-204.
- [ ] [T-206] `scripts/orchestrate.mjs` (`end`): add `END_USAGE` and `unverifiedRun`, and replace `end` (plan decision 1f). Depends on T-205.
- [ ] [T-207] `scripts/orchestrate.mjs` (`cli`): pass `argv.slice(1)` to `end` (plan decision 1g). Depends on T-206.
- [ ] [T-208] Green run: the T-110 command. Predicted: **31 passed** (1092 skipped). Depends on T-207.
- [ ] [T-209] `.claude/commands/cc-orchestrate.md`: apply plan decision 8 a-d with a file-edit tool. Depends on T-208.
- [ ] [T-210] `project-template/.claude/commands/cc-orchestrate.md`: apply the same four edits. Depends on T-209.
- [ ] [T-211] Green run: `npx vitest run tests/installer/commands-parity.test.js`. Predicted: **93 passed (93)**. Depends on T-210.
- [ ] [T-212] `npx vitest run tests/scripts/orchestrate.test.js`. Predicted: **1123 passed (1123)**. This shows every existing hand-back, approval, resume and `end` case unchanged apart from plan decision 5 (spec, AC4, AC9, AC13). Depends on T-211.

---

### Task 3: Full suite, scope check and commit

**Files:**
- Modify: `scripts/orchestrate.mjs`, `tests/scripts/orchestrate.test.js`, `tests/installer/commands-parity.test.js`, `.claude/commands/cc-orchestrate.md`, `project-template/.claude/commands/cc-orchestrate.md` (staged), this plan (checkboxes)

- [ ] [T-301] Run `npm test`. Predicted: as under Baseline, the two staging-convention ENV reds at most. A red outside the ENV set listed there is called ENV only if the sandbox causes it (network, tmp permissions, missing `node:sqlite`, uid 0) and its file is not one this plan touches; report it with its name. Any other red is fixed. Depends on T-212.
- [ ] [T-302] Scope check:
  - `git status --porcelain` lists exactly the five files of this task and this plan as modified.
  - `diff .claude/commands/cc-orchestrate.md project-template/.claude/commands/cc-orchestrate.md` prints nothing.
  - `git diff --quiet HEAD -- VERSION CHANGELOG.md package.json package-lock.json README.md "AGENT-READABLE BACKLOG.md" .claude/memory .claude/hooks .claude/agents .claude/settings.json .github scripts/snap-validate.mjs scripts/snap-build.mjs scripts/snap-contract.mjs tools lib bin` exits 0.
  - `grep -n "gitValue(root, \['config'" scripts/orchestrate.mjs` prints nothing.
  - Depends on T-301.
- [ ] [T-303] Stage: `git add -u scripts/orchestrate.mjs tests/scripts/orchestrate.test.js tests/installer/commands-parity.test.js .claude/commands/cc-orchestrate.md project-template/.claude/commands/cc-orchestrate.md` (all tracked). Depends on T-302.
- [ ] [T-304] Stage: `git add -u docs/superpowers/plans/2026-11-19-bug075-orchestrate-mjs-accepts-hand-backs-and-end-that.md` (carries the ticks for T-101 to T-303). Depends on T-303.
- [ ] [T-305] Commit: `fix: check hand-back scope claims, require verify_pass before end and record the owner as approver [BUG-075]`. Depends on T-304.

---

## Test List

- [ ] Unit, AC1: C1, `["**"]` halts `ORCH_HANDBACK_SCOPE_MISMATCH`; the halt is recorded, `handbacks` and `tasks` are unchanged.
- [ ] Unit, AC2: C2, eight `ops.f` entries (another task's file, another repo file, `../x`, `/abs`, `a/./b`, `a//b`, `C:/x`, a trailing `/`) halt `ORCH_HANDBACK_OUT_OF_SCOPE` naming that path.
- [ ] Unit, AC3: C3, the installed scope reversed halts `ORCH_HANDBACK_SCOPE_MISMATCH`.
- [ ] Unit, AC4: C4 (task), C5 and C6 (fix round against its `fixScope`), plus every existing code hand-back through the shared fixture (T-212).
- [ ] Unit, AC5: C7 (spec outside its folder, a `..` segment under it, a plan naming the spec) and C8 (a plan under its folder records).
- [ ] Unit, AC6: C9, `audit`, `qa` and `security` with an `ops.scope` halt; without one they record as before (the existing suites, T-212).
- [ ] Unit, AC7: C10, an envelope edited to `["**"]` still halts.
- [ ] Unit, AC8: E1, `end` on a live unverified run exits 2 with `ORCH_END_UNVERIFIED`; run file and envelope stay.
- [ ] Unit, AC9: E2 (after `verify_pass`, byte for byte) and E3 (halted, invalid, no run file), plus the unchanged FEAT-011 and RS2 `end` tests.
- [ ] Unit, AC10: E4, the abandon line then the record on a live run; the record alone on a verified run. E5 pins the usage refusal.
- [ ] Unit, AC11: A1, `by: "owner"` for both approvals with `user.name` set and unset; `define-review` stays (FEAT-054 tests).
- [ ] Unit, AC12: RS21, a stored scope of `["**"]` or an `ops.f` of `../x:M` on task 2 is dropped with everything after it.
- [ ] AC13: the nine live-run `end` call sites pass `--abandon` (plan decision 5); `npm test` (T-301).
- [ ] Parity, AC14: the `[BUG-075]` `it` in `commands-parity.test.js`, plus the `diff` and the `.claude/agents` / SNAP-script check in T-302.
- [ ] No integration or E2E/UI test: every verb is exercised end to end through the CLI fixture already, and there is no UI.

## Commit Order

1. Task 0 (T-004): this plan and its `.gitignore` leaf.
2. Task 3 (T-305): the tests, the fix, both command copies and the plan ticks for T-101 to T-303, in one commit, so no commit has a red suite. The red runs in T-110 and T-111 happen in the working tree before the fix. The ticks for T-304, T-305 and the Test List ride a closeout commit.

## Identified Risks

- **A hand-back fixture without a scope.** Any test that builds a `spec`, `plan` or `code` hand-back while the envelope on disk belongs to another role now halts `ORCH_HANDBACK_SCOPE_MISMATCH`. Measured: only RS3 (plan decision 7). Catch: T-212; a new failure there points at a fixture, not at the fix.
- **Live agents that leave `ops.scope` out or reorder it.** Every role file already says to copy the envelope's scope verbatim and to leave the key out when the envelope has none, so a conforming agent is unaffected. A non-conforming one now halts instead of being recorded, which is the item. Recovery is `resume` or `end`, then `start` (decision 8a).
- **Guard 6's warning text.** `pre-tool-use.mjs:276-278` tells the owner `Clear it with: node … end` for an invalid run file and for a stale run of another session. The invalid case still ends without a flag. The stale case is a live run, so `end` now refuses with `ORCH_END_UNVERIFIED`, whose text names `end --abandon`; a fresh `start` also replaces a stale run, as today. The hook is out of scope (spec, Out of Scope: the guards), so its text is not changed here.
- **The cc-orchestrate step 6 report** parses the record `end` prints. After `verify_pass` that output is unchanged. After `--abandon` the record starts on the second line, and decision 8b tells the orchestrator to report the abandon line.
- **`resume` and a plan that no longer yields a scope.** `codeScope` can throw `ORCH_EMPTY_SCOPE` / `ORCH_SCOPE_OVER_CAP`; `taskEntryHolds` turns that into a dropped entry rather than an escaping halt (decision 1e), so `resume` still refuses or succeeds and never records a halt.
- **Full-file run time.** `tests/scripts/orchestrate.test.js` takes about 510 s here. Use `-t` filters for the red and green runs and the full file once (T-212).
