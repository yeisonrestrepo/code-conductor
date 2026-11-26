# BUG-092 Test-surface split bypassable through the recorded test command: implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** on a run with a test surface, `install test-writer` and `install code` record a fingerprint of the work tree's changed files (`build_tree`) in the run file, and `handback` for that role halts `ORCH_HANDBACK_SURFACE_CROSSED` when a file on the other role's side of the split changed during the dispatch, whatever `ops.f` lists; a missing, malformed or uncheckable fingerprint halts `ORCH_HANDBACK_SPLIT_UNVERIFIED`; only a git already unavailable at `install` fails open, with a `split check: unavailable (<reason>)` note. Both agent profiles (both copies), the README's Guard 5 paragraph, the wiki's band-roles page, the FEAT-033 spec and the four `/cc-orchestrate` copies state the split's limit and the two halts.

**Spec:** `docs/superpowers/specs/2026-11-26-bug092-test-surface-split-bypassable-through-the-design.md` (sha256 `5deed6bd84cfc366361221fe6541c773448f573243e17e63c3f910c4d349f7aa`), approved by the owner with the two decisions it already carries (choice 6 and "Owner decisions": the `ORCH_HANDBACK_SPLIT_UNVERIFIED` halt, fail-open only for a git unavailable at `install`). Issue #312, follow-up of FEAT-033.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>` and `-t '<pattern>'`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines (the `[BUG-092]` line at `README.md:535` included) stay untouched. The release rewrites them.
- **Sixteen files change, plus this plan and its `.gitignore` leaf:** `scripts/orchestrate.mjs`, `tests/scripts/orchestrate.test.js`, `.claude/agents/test-writer.md`, `project-template/.claude/agents/test-writer.md`, `.claude/agents/code.md`, `project-template/.claude/agents/code.md`, `tests/unit/role-profiles.test.js`, `.claude/commands/cc-orchestrate.md`, `project-template/.claude/commands/cc-orchestrate.md`, `project-template/.agents/skills/cc-orchestrate/SKILL.md`, `project-template/.agents/workflows/cc-orchestrate.md`, `tests/installer/commands-parity.test.js`, `README.md`, `.github/wiki/pages/Band-Roles-and-Agents.md`, `docs/superpowers/specs/2026-11-23-feat033-test-writer-agent-build-band-design.md` and nothing else (the spec's System Impact list; `entryFields` and `recordHandback` are not edited, see plan decision 3).
- Not touched: `.claude/hooks/pre-tool-use.mjs` and its mirror (Guards 5 and 7 behave as today), `isValidRun`, `changeList`, `changeNote`, `claimHalt`, the SNAP contract and envelope versions, the installer, settings, `.github/workflows/`, `.github/actions/`, dependencies. No network is added.
- Every file this plan edits after Task 0 is already tracked and none sits under an ignored directory, so each is staged with `git add -u <path>`. This plan is new in Task 0 under the ignored `docs/superpowers/plans/` (so `git add -f`) and is tracked and re-included by its leaf afterwards (so `git add -u`).
- `.claude/` is read-only for Bash in the build sandbox: every edit under `.claude/` uses the Edit tool. The other files may use either.

## Files read in full (spec, Files Requiring Full Read)

- `scripts/orchestrate.mjs` (1903 lines): `RUN_FILE` and `ENVELOPE_FILE` (`:21-22`); `Halt` (`:176`); `isValidRun` (`:239`), which does not read `build_tree`, so a malformed one never makes the run file invalid and is judged only at `handback`; `saveRun` (`:261`) and `saveHandedBackRun` (`:264`, the BUG-079 bound); `matchesSurface` (`:294`) and `surfaceOf` (`:297`); `ROUTER_DIR` and `nulPaths` (`:717-719`, BUG-091); `changeList` (`:725-742`); `install` (`:755-777`), whose run-file write is `:773-774`; `entryFields` (`:793`) and `recordHandback` (`:805`), whose `extra` argument is spread last into the entry; `claimHalt` (`:1147-1158`); `handback` (`:1160-1185`), `if (claim) throw claim;` at `:1174`, the note at `:1182-1183`; `recordHalt` (`:1760`), which saves the run as it is plus `halt`, so a halted hand-back keeps `build_tree` until `resume`; `resume` (`:1542-1565`), whose `next` object is `:1551-1555`. Fix rounds reach `install` and `handback` through the same two functions (`nextStep` → `fixStep`), with `role` `code` or `test-writer`, so no separate path exists.
- `tests/scripts/orchestrate.test.js` (5680 lines): helpers `orch`, `fixtureGit`, `fixtureCommit`, `runFile`, `runFileText`, `envelopeText`, `sha`, `approveArgs` (writes `docs/specs/demo-design.md` at approval, untracked), `agents`, `handbackLine` (copies the installed envelope's `ops.scope` when the line is built), `auditReport`, `driveTo` (`prep` runs after `agents()` and `plan()`, before `start`). No fixture outside `installedRepo` and the FEAT-033 `gitRoot` is a git work tree. The BUG-075 block's `C4 [AC4]` (`:1858-1862`) and the FEAT-033 block's `[R9]` (`:5413-5419`) assert the exact `handback` line on a fixture with no git; `describe('test-writer in the Build band [FEAT-033]'` ends at `:5652`, and `describe('control-plane paths for the release check [BUG-090]'` starts at `:5654`. No existing title contains `BUG-092`.
- `tests/unit/role-profiles.test.js` (439 lines): `TEST_WRITER_REPORT` and `CODE_LEAVES_TESTS` (`:109-117`); the two FEAT-033 rows (`:186-193`); the token cap row over `ROLES` (`:204`); `PROFILE_SHA256_1_37_0` (`:302`), its `code` row (`:307-312`) and `test-writer` row (`:323-324`), checked over `TEMPLATE` and `MIRROR` (`:328`).
- `tests/installer/commands-parity.test.js`: `ORCH_MIRRORS` (the two Claude Code copies), the BUG-091 block that names the two harness copies (`:384-389`), `describe('cc-orchestrate review loop [FEAT-041 AC5, AC6, FEAT-058]'` at `:391`.
- The four `cc-orchestrate` copies: the hand-back halts paragraph is `.claude/commands/cc-orchestrate.md:37`, `project-template/.claude/commands/cc-orchestrate.md:37`, `project-template/.agents/skills/cc-orchestrate/SKILL.md:41` and `project-template/.agents/workflows/cc-orchestrate.md:40`; the four lines are byte-identical, and each holds once ``Recovery is `resume` or `end`, then `start`. `handback <role>` also halts `ORCH_RUN_FILE_FULL` ``.
- `.claude/agents/test-writer.md:13` and `.claude/agents/code.md:13` (each byte-identical to its `project-template` copy); `README.md:314` (Guard 5 in detail); `.github/wiki/pages/Band-Roles-and-Agents.md:20`; the FEAT-033 spec's Out of Scope bullet at `:184`.

## Plan decisions

1. **The fingerprint helpers (spec choices 4-6, AC6).** In `scripts/orchestrate.mjs`, directly above the BUG-089 comment of `changeNote` (`:743`), after `changeList`:

   ```js
   // BUG-092: the router writes its own files during every dispatch, so no fingerprint holds them.
   const isRouterFile = (path) => path.startsWith(ROUTER_DIR) || path === RUN_FILE || path === ENVELOPE_FILE;
   const contentHash = (abs) => { try { return createHash('sha256').update(readFileSync(abs)).digest('hex'); } catch { return 'absent'; } };

   // BUG-092: the tracked files that differ from HEAD (every tracked file before the first commit) and the untracked
   // files no ignore rule hides, each mapped to the sha256 of its bytes, or to absent for a deleted one.
   function treeFingerprint(root) {
     const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30 });
     const inside = git(['rev-parse', '--is-inside-work-tree']);
     if (inside.error) return { reason: 'git is not available' };
     if (inside.status !== 0 || inside.stdout.trim() !== 'true') return { reason: 'the project is not a git work tree' };
     const hasHead = git(['rev-parse', '--verify', '--quiet', 'HEAD']).status === 0;
     const tracked = git(hasHead ? ['diff', '--name-only', '--no-renames', '--relative', '-z', 'HEAD'] : ['ls-files', '-z']);
     const others = git(['ls-files', '--others', '--exclude-standard', '-z']);
     if (tracked.status !== 0 || others.status !== 0) return { reason: 'git cannot list the changed files' };
     const paths = [...new Set([...nulPaths(tracked), ...nulPaths(others)])].filter((path) => !isRouterFile(path)).sort();
     return { files: Object.fromEntries(paths.map((path) => [path, contentHash(join(root, path))])) };
   }

   // BUG-092: what install records for a build role on a run with a test surface; null for every other dispatch.
   function buildTree(root, run, role) {
     if (surfaceOf(run) === undefined || (role !== 'code' && role !== 'test-writer')) return null;
     const { files, reason } = treeFingerprint(root);
     return files ? { role, files } : { role, unavailable: reason };
   }
   ```

   - **The dirty set (choice 5).** `git diff --name-only HEAD` lists every tracked path whose index or work-tree content differs from `HEAD`, deleted ones included; `--relative` keeps it relative to the project root when the root is a subfolder of the repository, as `changeList` does; `ls-files --others --exclude-standard` adds the untracked files no ignore rule hides, never an ignored one, so `node_modules` is never hashed. With no `HEAD`, every tracked file is listed. `ROUTER_DIR` (`.conductor/`, BUG-091) plus `RUN_FILE` and `ENVELOPE_FILE` are the three exclusions the spec names.
   - **By content (choice 4).** A path maps to the sha256 of its bytes; a path that cannot be read (deleted) maps to `absent`. `createHash` and `readFileSync` are already imported (`:6`, `:8`).
   - **Unavailable reasons.** A missing git binary (`spawnSync` sets `error`) gives `git is not available`; a folder outside any work tree gives `the project is not a git work tree`; a listing that fails (a corrupt index) gives `git cannot list the changed files`. At `install` each becomes `{ role, unavailable }` (choice 6: "when git cannot list the tree"); at `handback` after a `files` fingerprint each is a halt (decision 2).
   - Sizes, counted from the signature to the closing brace: `treeFingerprint` 12 lines, `buildTree` 5, under the 30-line cap.

2. **The split check (choices 3 and 6, AC7-AC11).** Directly above `async function handback` (`:1160`), after `claimHalt`:

   ```js
   // BUG-092: a well-formed fingerprint names the role it was taken for and holds either files or the reason git could not list them.
   const isTreeRecord = (tree, role) => isPlainObject(tree) && tree.role === role
     && (isPlainObject(tree.files) && Object.values(tree.files).every((h) => typeof h === 'string'))
       !== (typeof tree.unavailable === 'string' && tree.unavailable !== '');
   const changedPaths = (before, after) => [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((p) => before[p] !== after[p]).sort();

   // BUG-092: Guard 5 sees only the write tools, so the files that changed while the role ran, its test command included,
   // are compared with the split; only a git that was already unavailable at install lets the hand-back through unchecked.
   function splitCheck(root, run, role) {
     const surface = surfaceOf(run);
     if (surface === undefined || (role !== 'code' && role !== 'test-writer')) return {};
     const tree = run.build_tree;
     if (!isTreeRecord(tree, role)) throw new Halt('ORCH_HANDBACK_SPLIT_UNVERIFIED', `no valid fingerprint of the tree recorded at install for ${role}; resume to re-dispatch it`);
     if (tree.unavailable) return { split_check: `unavailable (${tree.unavailable})` };
     const now = treeFingerprint(root);
     if (!now.files) throw new Halt('ORCH_HANDBACK_SPLIT_UNVERIFIED', `git cannot list the tree (${now.reason}), so ${role}'s changes cannot be checked against the test surface; resume to re-dispatch it`);
     const crossed = changedPaths(tree.files, now.files).filter((path) => matchesSurface(path, surface) !== (role === 'test-writer'));
     if (crossed.length === 0) return {};
     const side = role === 'test-writer' ? 'outside' : 'inside';
     throw new Halt('ORCH_HANDBACK_SURFACE_CROSSED', `${role} changed ${crossed.join(', ')} during its dispatch, ${side} the test surface ${JSON.stringify(surface)}`);
   }
   ```

   - **Well-formed (Error cases).** Exactly one of `files` (an object whose every value is a string) and `unavailable` (a non-empty string), and `role` equal to the handing-back role. Anything else, absence included, halts `ORCH_HANDBACK_SPLIT_UNVERIFIED`, never read as an empty fingerprint.
   - **Changed (choice 4).** A path is changed when it is in only one fingerprint or its hashes differ, so a file reverted to `HEAD` (it leaves the second fingerprint) and a deleted tracked file (`absent` in the second) both count; a dirty file left alone does not.
   - **The side (choice 3).** `matchesSurface` (case-folded, as Guard 5) decides the side; `test-writer` crosses on a path outside the surface, `code` on one inside. Unlisted changes on the role's own side never halt. A path `ops.f` lists on the other side still halts first on `claimHalt`'s `ORCH_HANDBACK_OUT_OF_SCOPE` (unchanged, FEAT-033 `[R26]`), so the new rows cover the unlisted case, which is the one the test command produces. `JSON.stringify(['tests/**'])` prints `["tests/**"]`, the spec's message form.
   - `splitCheck` is 13 lines.

3. **`install`, `handback` and `resume` (AC6, AC10, AC12).**
   - `install` (`:773-774`) becomes:

     ```js
       const { dispatch_model: _previous, build_tree: _tree, ...kept } = run;
       const tree = buildTree(root, run, role);
       saveRun(root, { ...kept, band: ROLE_BAND[role], role, ...(model ? { dispatch_model: model } : {}), ...(tree ? { build_tree: tree } : {}) });
     ```

     It runs after `if (check) return out;`, so `--check` records nothing; every install drops a previous `build_tree`, so an `audit`, `qa` or other install never carries one (AC6), and a re-install for the same position overwrites it (Alternative paths). `install` grows from 22 to 23 lines (the destructuring line is edited, one line is added).
   - `handback`: after `if (claim) throw claim;` (`:1174`) insert `  const split = splitCheck(root, run, role);`, and the record line `const recorded = recordHandback(run, role, env.ops.gate, verdict?.verdict, { snap });` becomes `const { build_tree: _tree, ...recorded } = recordHandback(run, role, env.ops.gate, verdict?.verdict, { snap, ...split });`. The `test_writer` note line (`:1183`) loses its `;` and gains `    + (entry.split_check ? `; split check: ${entry.split_check}` : '');` on the next line. The entry's `split_check` rides `recordHandback`'s `extra` argument, so `entryFields` and `recordHandback` are not edited (the spec names either as the place; neither needs a change). A halt throws before the record, so nothing is recorded and `recordHalt` keeps `build_tree` in the halted run. `handback` grows from 26 to 28 lines.
   - `resume`: directly above `const next = {` (`:1551`) insert `  const { build_tree: _tree, ...unfingerprinted } = run;`, and `...run, session_id: sessionId,` becomes `...unfingerprinted, session_id: sessionId,`. `resume` grows from 23 to 24 lines.

   Measured on a copy of this branch (HEAD `0016e43`, git 2.43.0, Node v24.22.2) with exactly these edits: every row of plan decision 4 passes, and the whole file passes with decision 5's two edits.

4. **The new test block (AC6-AC12).** In `tests/scripts/orchestrate.test.js`, directly before `describe('control-plane paths for the release check [BUG-090]'` (`:5654`), after the FEAT-033 block, exactly:

   ```js
   describe('test-surface split at hand-back [BUG-092]', () => {
     const testTask = (n, lines) => `### Task ${n}: thing ${n}\n\n**Files:**\n${lines.join('\n')}\n\n- [ ] **Step 1: do it**\n`;
     const SPLIT = '# Demo Plan\n\n' + testTask(1, ['- Modify: `src/a.js`', '- Test: `tests/a.test.js`']) + '\n## Test List\n';
     const LEGACY = 'not-configured (run predates FEAT-033)';
     const write = (rel, text = 'x\n') => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
     const patchRun = (edit) => { const run = runFile(); edit(run); runFileText(JSON.stringify(run, null, 2) + '\n'); };
     const writerSay = (f) => `Done.\nObservation: fine.\n${handbackLine('test-writer', 'build_executed', { v: 7, f })}\n`;
     const codeSay = (f) => `Done.\nObservation: fine.\n${handbackLine('code', 'build_executed', { f })}\n`;
     const writerDone = () => writerSay(['tests/a.test.js:C']);
     // The base commit holds src/a.js, src/base.js and an ignore rule for coverage/; base() adds more before the commit.
     const atWriter = ({ git = true, base = () => {} } = {}) => driveTo('code', { planText: SPLIT, prep: () => {
       agents(['test-writer']);
       if (!git) return;
       write('.gitignore', 'coverage/\n');
       write('src/a.js', 'a1\n');
       write('src/base.js', 'v1\n');
       base();
       fixtureGit('init', '-q');
       fixtureCommit();
     } });
     const install = (role) => { const r = orch(['install', role]); expect(r.status).toBe(0); return r; };
     const handBack = (role, input) => orch(['handback', role], { input });
     const crossed = (role, paths) => `ORCH_HANDBACK_SURFACE_CROSSED: ${role} changed ${paths} during its dispatch, ${role === 'code' ? 'inside' : 'outside'} the test surface ["tests/**"]`;
     const UNVERIFIED = 'ORCH_HANDBACK_SPLIT_UNVERIFIED: no valid fingerprint of the tree recorded at install for test-writer; resume to re-dispatch it';
     const atCode = () => { atWriter(); install('test-writer'); write('tests/a.test.js'); expect(handBack('test-writer', writerDone()).status).toBe(0); install('code'); };

     it('[AC6] install test-writer records a fingerprint of the dirty set for its role; install --check records none', () => {
       atWriter();
       write('src/dirty.js', 'd\n');
       expect(orch(['install', 'test-writer', '--check']).status).toBe(0);
       expect(runFile()).not.toHaveProperty('build_tree');
       install('test-writer');
       expect(runFile().build_tree).toEqual({ role: 'test-writer', files: { [SPEC]: sha(SPEC), 'src/dirty.js': sha('src/dirty.js') } });
     });

     it('[AC6] install code records its own fingerprint, and install audit records none', () => {
       atCode();
       expect(runFile().build_tree).toEqual({ role: 'code', files: { [SPEC]: sha(SPEC), 'tests/a.test.js': sha('tests/a.test.js') } });
       write('src/a.js', 'a2\n');
       expect(handBack('code', codeSay(['src/a.js:M'])).status).toBe(0);
       install('audit');
       expect(runFile()).not.toHaveProperty('build_tree');
     });

     it('[AC7] test-writer changing a source file it does not list halts and records nothing', () => {
       atWriter();
       install('test-writer');
       write('tests/a.test.js');
       write('src/a.js', 'a2\n');
       const r = handBack('test-writer', writerDone());
       expect(r.status).toBe(1);
       expect(r.err).toBe(crossed('test-writer', 'src/a.js'));
       expect(runFile().handbacks.map((h) => h.role)).toEqual(['spec', 'plan']);
       expect(runFile().halt.code).toBe('ORCH_HANDBACK_SURFACE_CROSSED');
     });

     it('[AC7] test-writer with an empty ops.f still halts on a source file it created', () => {
       atWriter();
       install('test-writer');
       write('src/new.js');
       expect(handBack('test-writer', writerSay([])).err).toBe(crossed('test-writer', 'src/new.js'));
     });

     it('[AC7] code changing a test file it does not list halts and records nothing', () => {
       atCode();
       write('src/a.js', 'a2\n');
       write('tests/a.test.js', 'rewritten\n');
       const r = handBack('code', codeSay(['src/a.js:M']));
       expect(r.status).toBe(1);
       expect(r.err).toBe(crossed('code', 'tests/a.test.js'));
       expect(runFile().handbacks.map((h) => h.role)).toEqual(['spec', 'plan', 'test-writer']);
     });

     it('[AC7] several crossings are named sorted and comma-separated', () => {
       atWriter();
       install('test-writer');
       write('src/b.js');
       write('lib/z.js');
       write('src/a.js', 'a2\n');
       expect(handBack('test-writer', writerDone()).err).toBe(crossed('test-writer', 'lib/z.js, src/a.js, src/b.js'));
     });

     it('[AC7] a fix round is checked the same way', () => {
       driveTo('audit', { prep: () => { write('src/a.js', 'a1\n'); fixtureGit('init', '-q'); fixtureCommit(); } });
       install('audit');
       expect(handBack('audit', auditReport('VERDICT: RETURN', ['- [blocker] src/a.js:10 — breaks AC1'])).status).toBe(0);
       install('code');
       expect(runFile().build_tree.role).toBe('code');
       write('tests/z.test.js');
       expect(handBack('code', codeSay(['src/a.js:M'])).err).toBe(crossed('code', 'tests/z.test.js'));
     });

     it('[AC8] a dirty file modified again counts as changed, and a dirty file left alone does not', () => {
       atWriter();
       write('src/old.js', 'o1\n');
       write('src/keep.js', 'k1\n');
       install('test-writer');
       write('src/old.js', 'o2\n');
       expect(handBack('test-writer', writerDone()).err).toBe(crossed('test-writer', 'src/old.js'));
     });

     it.each([
       ['reverted to HEAD', () => write('src/base.js', 'v2\n'), () => write('src/base.js', 'v1\n')],
       ['deleted', () => {}, () => rmSync(join(root, 'src', 'base.js'))],
     ])('[AC8] a tracked file %s during the dispatch counts as changed', (_name, before, during) => {
       atWriter();
       before();
       install('test-writer');
       during();
       expect(handBack('test-writer', writerDone()).err).toBe(crossed('test-writer', 'src/base.js'));
     });

     it('[AC9] the router\'s files, ignored files and unlisted changes on the role\'s own side do not halt', () => {
       atWriter();
       install('test-writer');
       write('tests/a.test.js');
       write('tests/extra.test.js');
       write('.conductor/handback/test-writer.txt', writerDone());
       write('coverage/index.html');
       writeFileSync(join(root, ENVELOPE_FILE), `${envelopeText()}\n`);
       runFileText(`${JSON.stringify(runFile())}\n`);
       const r = handBack('test-writer', writerDone());
       expect(r.status).toBe(0);
       expect(r.out).toBe('test-writer handed back build_executed');
       install('code');
       write('src/a.js', 'a2\n');
       write('src/extra.js');
       expect(handBack('code', codeSay(['src/a.js:M'])).out).toBe('code handed back build_executed');
     });

     it('[AC10] a run without a test surface records no fingerprint and runs no check', () => {
       driveTo('code', { prep: () => { fixtureGit('init', '-q'); fixtureCommit(); } });
       patchRun((run) => { delete run.test_surface; });
       install('code');
       expect(runFile()).not.toHaveProperty('build_tree');
       write('tests/x.test.js');
       expect(handBack('code', codeSay([])).out).toBe(`code handed back build_executed; test-writer=${LEGACY}`);
     });

     it('[AC10] a fingerprint unavailable at install records the hand-back with a split-check note', () => {
       atWriter({ git: false });
       install('test-writer');
       expect(runFile().build_tree).toEqual({ role: 'test-writer', unavailable: 'the project is not a git work tree' });
       write('src/a.js', 'a2\n');
       const r = handBack('test-writer', writerDone());
       expect(r.status).toBe(0);
       expect(r.out).toBe('test-writer handed back build_executed; split check: unavailable (the project is not a git work tree)');
       expect(runFile().handbacks.at(-1).split_check).toBe('unavailable (the project is not a git work tree)');
       expect(runFile()).not.toHaveProperty('build_tree');
     });

     it.each([
       ['that is missing', (run) => { delete run.build_tree; }],
       ['that is not an object', (run) => { run.build_tree = 'x'; }],
       ['taken for another role', (run) => { run.build_tree.role = 'code'; }],
       ['holding a hash that is not a string', (run) => { run.build_tree.files[SPEC] = 1; }],
       ['holding both files and unavailable', (run) => { run.build_tree.unavailable = 'no git'; }],
       ['with an empty unavailable', (run) => { run.build_tree = { role: 'test-writer', unavailable: '' }; }],
     ])('[AC11] a fingerprint %s halts unverified, and resume re-dispatches with a fresh one', (_name, edit) => {
       atWriter();
       install('test-writer');
       patchRun(edit);
       write('tests/a.test.js');
       const r = handBack('test-writer', writerDone());
       expect(r.status).toBe(1);
       expect(r.err).toBe(UNVERIFIED);
       expect(runFile().handbacks).toHaveLength(2);
       expect(orch(['resume']).status).toBe(0);
       install('test-writer');
       expect(runFile().build_tree.files['tests/a.test.js']).toBe(sha('tests/a.test.js'));
       expect(handBack('test-writer', writerDone()).status).toBe(0);
     });

     it.each([
       ['the work tree is gone', 'the project is not a git work tree',
         () => renameSync(join(root, '.git'), join(root, '.git-off')), () => renameSync(join(root, '.git-off'), join(root, '.git'))],
       ['the index is corrupt', 'git cannot list the changed files',
         () => writeFileSync(join(root, '.git', 'index'), 'not an index\n'), () => { rmSync(join(root, '.git', 'index')); fixtureGit('reset', '-q'); }],
     ])('[AC11] a recorded fingerprint halts unverified when %s at hand-back', (_name, reason, breakGit, repair) => {
       atWriter();
       install('test-writer');
       write('tests/a.test.js');
       breakGit();
       const r = handBack('test-writer', writerDone());
       expect(r.status).toBe(1);
       expect(r.err).toBe(`ORCH_HANDBACK_SPLIT_UNVERIFIED: git cannot list the tree (${reason}), so test-writer's changes cannot be checked against the test surface; resume to re-dispatch it`);
       expect(runFile().handbacks).toHaveLength(2);
       repair();
       expect(orch(['resume']).status).toBe(0);
       install('test-writer');
       expect(handBack('test-writer', writerDone()).status).toBe(0);
     });

     it('[AC12] a recorded hand-back removes the fingerprint', () => {
       atWriter();
       install('test-writer');
       write('tests/a.test.js');
       expect(handBack('test-writer', writerDone()).status).toBe(0);
       expect(runFile()).not.toHaveProperty('build_tree');
     });

     it('[AC12] resume drops the fingerprint, and the re-install takes the crossed file as baseline', () => {
       atWriter();
       install('test-writer');
       write('tests/a.test.js');
       write('src/a.js', 'a2\n');
       expect(handBack('test-writer', writerDone()).err).toBe(crossed('test-writer', 'src/a.js'));
       expect(runFile().build_tree.role).toBe('test-writer');
       expect(orch(['resume']).status).toBe(0);
       expect(runFile()).not.toHaveProperty('build_tree');
       install('test-writer');
       expect(runFile().build_tree.files['src/a.js']).toBe(sha('src/a.js'));
       expect(handBack('test-writer', writerDone()).status).toBe(0);
     });
   });
   ```

   23 tests (the `[AC8]` table has 2 rows, the first `[AC11]` table 6, the second 2). The `[AC6]` rows pin the dirty set exactly: in this fixture the only untracked file outside the router's files is the spec `approveArgs` writes, `.claude/memory/` holds only the run file and the envelope, and nothing is ignored but `coverage/`. The `[AC9]` row rewrites the run file and the envelope during the dispatch, so their exclusion is exercised by the filter, not by an ignore rule. The "git is not available" reason has no row: `orch` passes no `PATH` override, and the spec's fail-open rows are covered by the "not a git work tree" reason, which takes the same branch.

5. **The two existing rows that assert the hand-back line on a fixture with no git (AC10).** Both fixtures are no work tree, so `install` records `build_tree: { role, unavailable: 'the project is not a git work tree' }` and the line gains the note; the spec's fail-open path is the behavior, so the expectation changes, not the fixture:
   - `C4 [AC4]` (`:1861`): above it the comment `    // BUG-092: the fixture is no git work tree, so install recorded the split check as unavailable.`, and `out: 'code handed back build_executed'` becomes `out: 'code handed back build_executed; split check: unavailable (the project is not a git work tree)'`.
   - FEAT-033 `[R9]` (`:5417`): the same comment above it, and `expect(r.out).toBe('test-writer handed back build_executed');` becomes `expect(r.out).toBe('test-writer handed back build_executed; split check: unavailable (the project is not a git work tree)');`.

   Measured on the copy with decisions 1-3 and without these two edits: the whole file was **2 failed | 1278 passed (1280)**, exactly these two rows. FEAT-033 `[R21]` (`:5547`) is a run without a test surface, so its line is unchanged.

6. **The profile sentences (AC1, AC2).** In `.claude/agents/test-writer.md` and its `project-template` copy, line 13, after ``Guard 5 denies a write outside the run's test surface, whatever your scope lists.`` insert, after one space:

   ``Guard 5 denies only direct writes: a file that changes while you run the test command is your write too, and the orchestrator halts the run at your hand-back when a file outside the test surface changed during your dispatch.``

   In `.claude/agents/code.md` and its `project-template` copy, line 13, after ``Do not edit files in the run's test surface; if a test is wrong, say so in your report.`` insert, after one space:

   ``Guard 5 denies only direct writes: a file that changes while you run the test command is your write too, and the orchestrator halts the run at your hand-back when a file inside the test surface changed during your dispatch, a snapshot the suite writes included.``

   Nothing else in the four files changes; the FEAT-033 phrases stay byte-identical. **Measured** on the copy: `test-writer.md` 2746 → 2971 bytes, 743 tokens, sha256 `978878170c6796c2261cb0b957aeca32f0bedc9bb3e6661a23e1f38316807afe`; `code.md` 3479 → 3741 bytes, 936 tokens, sha256 `404d460061c0be543370016f9751f5b9d13668d35016752ba996fd84931ec497`; both pairs `cmp`-equal. A hash that differs after the edit means the edit differs from this decision: fix the edit, not the pin.

7. **`tests/unit/role-profiles.test.js` (AC1, AC2).** After `CODE_LEAVES_TESTS` (`:117`):

   ```js
   // BUG-092: the split holds against direct writes only, and the hand-back check catches what the test command changes.
   const SPLIT_LIMIT = 'Guard 5 denies only direct writes: a file that changes while you run the test command is your write too, and the orchestrator halts the run at your hand-back when a file';
   const WRITER_SPLIT = `${SPLIT_LIMIT} outside the test surface changed during your dispatch.`;
   const CODE_SPLIT = `${SPLIT_LIMIT} inside the test surface changed during your dispatch, a snapshot the suite writes included.`;
   ```

   Directly before `it('[FEAT-033] test-writer is outside MODEL_ROLES and may hand back only build_executed'` (`:195`), two rows (4 tests):

   ```js
     it.each([TEMPLATE, MIRROR])('[BUG-092 AC1] %s/test-writer.md states the split\'s limit and keeps the FEAT-033 phrases', (dir) => {
       const text = read(`${dir}/test-writer.md`);
       expect(text).toContain(WRITER_SPLIT);
       for (const phrase of TEST_WRITER_REPORT) expect(text).toContain(phrase);
     });

     it.each([TEMPLATE, MIRROR])('[BUG-092 AC2] %s/code.md states the split\'s limit and keeps CODE_LEAVES_TESTS', (dir) => {
       const text = read(`${dir}/code.md`);
       expect(text).toContain(CODE_SPLIT);
       expect(text).toContain(CODE_LEAVES_TESTS);
     });
   ```

   `PROFILE_SHA256_1_37_0`: after the FEAT-033 comment of the `code` row, `  // BUG-092 changed code on purpose: Guard 5 denies only direct writes, and the hand-back halts on a test file changed during the dispatch.`, and the `code` hash of decision 6; after the FEAT-033 comment of the `test-writer` row, `  // BUG-092 changed test-writer on purpose: Guard 5 denies only direct writes, and the hand-back halts on a source file changed during the dispatch.`, and the `test-writer` hash of decision 6. Every other row is unchanged.

8. **The four `cc-orchestrate` copies (AC5).** In each, the hand-back halts line named above, insert after ``Recovery is `resume` or `end`, then `start`.`` and before `` `handback <role>` also halts `ORCH_RUN_FILE_FULL` `` (one space on each side):

   ``For `test-writer` and `code` on a run with a test surface, `handback <role>` also halts `ORCH_HANDBACK_SURFACE_CROSSED` when a file on the other role's side of the split changed during the dispatch, the test command's writes included, whatever `ops.f` lists; it names every such file, and `resume` does not revert them, so the owner keeps or reverts them by hand first. It halts `ORCH_HANDBACK_SPLIT_UNVERIFIED` when the fingerprint `install` recorded is missing or malformed, or git can no longer list the tree; `resume` re-dispatches the role with a fresh fingerprint. Neither records the hand-back. When git was already unavailable at `install`, the hand-back is recorded and its line ends `; split check: unavailable (<reason>)`.``

   The four lines stay byte-identical to each other, and the two Claude Code copies stay byte-identical as files (the existing mirror row).

9. **`tests/installer/commands-parity.test.js` (AC5).** Before `describe('cc-orchestrate review loop [FEAT-041 AC5, AC6, FEAT-058]'` (`:391`):

   ```js
   describe('cc-orchestrate split check [BUG-092 AC5]', () => {
     const HARNESS_MIRRORS = ['project-template/.agents/skills/cc-orchestrate/SKILL.md', 'project-template/.agents/workflows/cc-orchestrate.md'];
     it.each([...ORCH_MIRRORS, ...HARNESS_MIRRORS])('%s names both split halts beside the hand-back halts, with their recovery', (rel) => {
       const text = read(rel);
       expect(text).toContain("halts `ORCH_HANDBACK_SURFACE_CROSSED` when a file on the other role's side of the split changed during the dispatch, the test command's writes included");
       expect(text).toContain('`resume` does not revert them, so the owner keeps or reverts them by hand first');
       expect(text).toContain('It halts `ORCH_HANDBACK_SPLIT_UNVERIFIED` when the fingerprint `install` recorded is missing or malformed, or git can no longer list the tree; `resume` re-dispatches the role with a fresh fingerprint.');
       expect(text).toContain('; split check: unavailable (<reason>)');
     });
   });
   ```

   4 rows. `HARNESS_MIRRORS` is declared inside the block, as the BUG-091 block does.

10. **README, wiki and the FEAT-033 spec (AC3, AC4).**
    - `README.md:314`, after the paragraph's last sentence ``… and a `test-writer` with no recorded test surface is denied every write.`` insert, after one space:

      ``That split holds against the write tools only, and a file the test command changes is no tool write, so `orchestrate.mjs` checks it at the hand-back: `install` records a fingerprint of the work tree's changed, non-ignored files for each `test-writer` and `code` dispatch, and `handback` halts `ORCH_HANDBACK_SURFACE_CROSSED`, naming the files, when one on the other role's side of the split changed during the dispatch, whatever `ops.f` lists. A fingerprint that is missing or malformed, or that git can no longer check, halts `ORCH_HANDBACK_SPLIT_UNVERIFIED`, recovered with `resume`; the one case that fails open is a git already unavailable at `install`, whose hand-back is recorded with `split check: unavailable (<reason>)`. Two known false positives: a runner artifact outside the surface that no ignore rule hides (a coverage report, a cache) stops `test-writer` on every dispatch, so ignore its folder and delete it before `resume`; a snapshot created on `code`'s first passing run stops `code`, so review it and keep it (or delete it) before `resume`. `resume` does not revert a crossing: keep or revert the named files by hand first.``

      No other README line changes; the Known-limits line at `:535` stays for the release.
    - `.github/wiki/pages/Band-Roles-and-Agents.md:20`, after ``… whatever the envelope's scope lists.`` insert, after one space: ``That split holds against direct writes only; a file changed through the test command is caught at the hand-back, where `orchestrate.mjs` halts `ORCH_HANDBACK_SURFACE_CROSSED` when one on the other role's side changed during the dispatch.`` This is a file under `.github/wiki/`, not `.github/workflows/` or `.github/actions/`.
    - `docs/superpowers/specs/2026-11-23-feat033-test-writer-agent-build-band-design.md`, directly under the Out of Scope bullet at `:184`, a nested bullet: ``  - **Amended 2026-11-26 by BUG-092:** Guard 5 still gates only the write tools, but `orchestrate.mjs handback` now compares the files that changed during each `test-writer` and `code` dispatch with the split and halts `ORCH_HANDBACK_SURFACE_CROSSED` on a crossing; see `docs/superpowers/specs/2026-11-26-bug092-test-surface-split-bypassable-through-the-design.md`.`` Its Status line (`:3`) is unchanged. No test reads the FEAT-033 spec (`grep -rl feat033-test-writer-agent-build-band-design tests tools scripts` prints nothing).

11. **Red predictions, measured on a copy of this branch with the tests of decisions 4, 5, 7 and 9 and the unchanged script and documents.**
    - Task 1, `npx vitest run tests/scripts/orchestrate.test.js -t 'BUG-092|a conforming code hand-back is recorded as before|the writer.s hand-back is recorded for its task'`: the full match set is the 23 new tests, `C4 [AC4]` and FEAT-033 `[R9]` (`-t` is a regular expression; `.` matches the apostrophe). **Red 22:** the two edited rows (no note yet) and 20 new rows. **Green 3:** `[AC9]` (no halt today either), the no-surface `[AC10]` row and the first `[AC12]` row (no `build_tree` is ever written today). So **22 failed | 3 passed**, 1278 skipped (1303).
    - Task 3, `npx vitest run tests/unit/role-profiles.test.js` with decision 7's constants and rows but before the profile edits and the hash rows: **4 failed | 206 passed (210)**, the four new rows red.
    - Task 4, `npx vitest run tests/installer/commands-parity.test.js` before the command edits: **4 failed | 120 passed (124)**, the four new rows red.

12. **`.gitignore` leaf.** `!/docs/superpowers/plans/2026-11-26-bug092-test-surface-split-bypassable-through-the.md` goes directly after the `2026-11-25-bug096-codex-legacy-hook-fingerprint-substring-match.md` plan leaf (`.gitignore:213`) and before the first spec leaf (`2026-06-09-bug001-cc-compact-design.md`), the full-path sort order of the block (BUG-042).

## Baseline (measured on this branch, HEAD 0016e43, Node v24.22.2, git 2.43.0)

- `npx vitest run tests/unit/role-profiles.test.js`: **206 passed (206)**.
- `npx vitest run tests/installer/commands-parity.test.js`: **120 passed (120)**.
- `tests/scripts/orchestrate.test.js`: **1280** tests.
- After every change, measured on the copy: `tests/unit/role-profiles.test.js` and `tests/installer/commands-parity.test.js` together **334 passed (334)** (210 + 124); `tests/scripts/orchestrate.test.js` **1303 passed (1303)** (1280 + 23). The suite grows by 31 tests in all. `npm test` was not run on the copy: the copy has no `.git`, and the suites that read the repository's own git state (`tests/installer/smoke.test.js`, `tests/tools/repo-invariants.test.js`, `tests/unit/host-owned-ignore-xor.test.js`, `tests/unit/staging-convention.test.js`, `tests/unit/gitignore-block-parity.test.js`) fail there by construction; this plan touches none of them, and in the branch's work tree T-601 predicts exit 0.

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-26-bug092-test-surface-split-bypassable-through-the.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file from the approved spec `5deed6bd…`. No dependency.
- [X] [T-002] `.gitignore`: insert the leaf of plan decision 12 after the `2026-11-25-bug096` plan leaf. Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` (tracked) and `git add -f docs/superpowers/plans/2026-11-26-bug092-test-surface-split-bypassable-through-the.md` (new, under the ignored `docs/superpowers/plans/`). Depends on T-002.
- [X] [T-004] Commit: `docs: plan the hand-back check of the test-surface split [BUG-092]`. Depends on T-003.

---

### Task 1: Split-check tests first (red)

**Files:**
- Test: `tests/scripts/orchestrate.test.js`

- [ ] [T-101] `tests/scripts/orchestrate.test.js`: the two expectation edits of plan decision 5 (`C4 [AC4]`, FEAT-033 `[R9]`), each with its comment. Depends on T-004.
- [ ] [T-102] `tests/scripts/orchestrate.test.js`: the new `describe('test-surface split at hand-back [BUG-092]')` of plan decision 4, before the BUG-090 block. Depends on T-101.
- [ ] [T-103] Red run: `npx vitest run tests/scripts/orchestrate.test.js -t 'BUG-092|a conforming code hand-back is recorded as before|the writer.s hand-back is recorded for its task'`. Its full match set is the 25 tests of plan decision 11. Predicted: **22 failed | 3 passed**, 1278 skipped (1303). Any other split means a test is wrong: fix the test, not the prediction. Depends on T-102.

---

### Task 2: The fingerprint and the split check (green)

**Files:**
- Modify: `scripts/orchestrate.mjs`

- [ ] [T-201] `scripts/orchestrate.mjs`: `isRouterFile`, `contentHash`, `treeFingerprint` and `buildTree` above `changeNote` (plan decision 1). Depends on T-103.
- [ ] [T-202] `scripts/orchestrate.mjs`: `isTreeRecord`, `changedPaths` and `splitCheck` above `handback`, and the `install`, `handback` and `resume` edits (plan decisions 2 and 3). Depends on T-201.
- [ ] [T-203] Green run: the T-103 command. Predicted: **25 passed**, 1278 skipped (1303). Then the whole file: `npx vitest run tests/scripts/orchestrate.test.js` (several minutes). Predicted: **1303 passed (1303)**. Depends on T-202.

---

### Task 3: The split's limit in both profiles (red, then green)

**Files:**
- Modify: `.claude/agents/test-writer.md`
- Modify: `project-template/.claude/agents/test-writer.md`
- Modify: `.claude/agents/code.md`
- Modify: `project-template/.claude/agents/code.md`
- Test: `tests/unit/role-profiles.test.js`

- [ ] [T-301] `tests/unit/role-profiles.test.js`: the BUG-092 comment and three constants after `CODE_LEAVES_TESTS`, and the two `[BUG-092]` rows before the FEAT-033 `MODEL_ROLES` row (plan decision 7). Do not touch the hash rows yet. Depends on T-203.
- [ ] [T-302] Red run: `npx vitest run tests/unit/role-profiles.test.js`. Predicted: **4 failed | 206 passed (210)** (plan decision 11). Depends on T-301.
- [ ] [T-303] `.claude/agents/test-writer.md` and `.claude/agents/code.md` (Edit tool): the insertions of plan decision 6. Depends on T-302.
- [ ] [T-304] `project-template/.claude/agents/test-writer.md` and `project-template/.claude/agents/code.md`: the same insertions; then `cmp` of each pair prints nothing and `sha256sum` of each file prints the hash of decision 6. A different hash means the edit differs from decision 6: fix the edit. Depends on T-303.
- [ ] [T-305] `tests/unit/role-profiles.test.js`, `PROFILE_SHA256_1_37_0`: the two BUG-092 comment lines and the new `code` and `test-writer` hashes (plan decision 7). Depends on T-304.
- [ ] [T-306] Green run: the T-302 command. Predicted: **210 passed (210)**, the token cap, the FEAT-033 rows and both directories' hash rows included. Depends on T-305.

---

### Task 4: The four `cc-orchestrate` copies (red, then green)

**Files:**
- Modify: `.claude/commands/cc-orchestrate.md`
- Modify: `project-template/.claude/commands/cc-orchestrate.md`
- Modify: `project-template/.agents/skills/cc-orchestrate/SKILL.md`
- Modify: `project-template/.agents/workflows/cc-orchestrate.md`
- Test: `tests/installer/commands-parity.test.js`

- [ ] [T-401] `tests/installer/commands-parity.test.js`: the new block of plan decision 9. Depends on T-306.
- [ ] [T-402] Red run: `npx vitest run tests/installer/commands-parity.test.js`. Predicted: **4 failed | 120 passed (124)**. Depends on T-401.
- [ ] [T-403] `.claude/commands/cc-orchestrate.md` (Edit tool): the insertion of plan decision 8. Depends on T-402.
- [ ] [T-404] `project-template/.claude/commands/cc-orchestrate.md`, `project-template/.agents/skills/cc-orchestrate/SKILL.md` and `project-template/.agents/workflows/cc-orchestrate.md`: the same insertion; then `cmp` of the two Claude Code copies prints nothing, and the hand-back halts lines (`:37`, `:37`, `:41`, `:40`) are byte-identical. Depends on T-403.
- [ ] [T-405] Green run: the T-402 command. Predicted: **124 passed (124)**, the byte-identical mirror row included. Depends on T-404.

---

### Task 5: README, wiki and the FEAT-033 amendment

**Files:**
- Modify: `README.md`
- Modify: `.github/wiki/pages/Band-Roles-and-Agents.md`
- Modify: `docs/superpowers/specs/2026-11-23-feat033-test-writer-agent-build-band-design.md`

- [ ] [T-501] `README.md`: the Guard 5 insertion of plan decision 10; `git diff README.md` shows one changed line, `:314`. Depends on T-405.
- [ ] [T-502] `.github/wiki/pages/Band-Roles-and-Agents.md`: the insertion of plan decision 10. Depends on T-501.
- [ ] [T-503] `docs/superpowers/specs/2026-11-23-feat033-test-writer-agent-build-band-design.md`: the nested amendment bullet of plan decision 10; its Status line is unchanged. Depends on T-502.

---

### Task 6: Full suite, scope check and commit

**Files:**
- Modify: `docs/superpowers/plans/2026-11-26-bug092-test-surface-split-bypassable-through-the.md` (ticks)

- [ ] [T-601] Run `npm test` (long: `orchestrate.test.js` alone takes several minutes; run it in the background if the shell times out). Predicted: exit 0, with `tests/scripts/orchestrate.test.js` at **1303 passed**, `tests/unit/role-profiles.test.js` at 210 and `tests/installer/commands-parity.test.js` at 124. A red is called ENV only if the sandbox caused it (network, tmp permissions) and its file is not one this plan touches; report it with its name. Any other red is fixed. Depends on T-503.
- [ ] [T-602] Scope check: `git status --short` lists exactly the sixteen files of the Global Constraints and this plan; no temporary file is left in the tree. `git diff --stat` shows no change to the BUG-092 spec, the hooks, `isValidRun`, `changeList`, `claimHalt`, the installer, `.github/workflows/`, `.github/actions/` or the README Known-limits lines. Depends on T-601.
- [ ] [T-603] Stage: `git add -u scripts/orchestrate.mjs tests/scripts/orchestrate.test.js .claude/agents/test-writer.md project-template/.claude/agents/test-writer.md .claude/agents/code.md project-template/.claude/agents/code.md tests/unit/role-profiles.test.js .claude/commands/cc-orchestrate.md project-template/.claude/commands/cc-orchestrate.md project-template/.agents/skills/cc-orchestrate/SKILL.md project-template/.agents/workflows/cc-orchestrate.md tests/installer/commands-parity.test.js README.md .github/wiki/pages/Band-Roles-and-Agents.md docs/superpowers/specs/2026-11-23-feat033-test-writer-agent-build-band-design.md` (all tracked). Depends on T-602.
- [ ] [T-604] Stage: `git add -u docs/superpowers/plans/2026-11-26-bug092-test-surface-split-bypassable-through-the.md` (carries the ticks for T-101 to T-603). Depends on T-603.
- [ ] [T-605] Commit: `fix: halt a hand-back whose dispatch changed files across the test-surface split [BUG-092]`. Depends on T-604.

---

## Test List

- [ ] [T-701] `tests/scripts/orchestrate.test.js` (Task 1), AC6: the two `[AC6]` rows (the dirty set recorded for `test-writer`, none at `--check`; `code` records its own, `audit` none).
- [ ] [T-702] `tests/scripts/orchestrate.test.js` (Task 1), AC7: the five `[AC7]` rows (an unlisted source file, an empty `ops.f`, `code` and a test file, several crossings sorted, a fix round).
- [ ] [T-703] `tests/scripts/orchestrate.test.js` (Task 1), AC8: the dirty-file row and the two-row table (reverted to `HEAD`, deleted).
- [ ] [T-704] `tests/scripts/orchestrate.test.js` (Task 1), AC9: the router's files, an ignored file and unlisted own-side changes for both roles.
- [ ] [T-705] `tests/scripts/orchestrate.test.js` (Task 1), AC10: the no-surface row, the unavailable-at-install row, and the edited `C4 [AC4]` and FEAT-033 `[R9]` rows (plan decision 5).
- [ ] [T-706] `tests/scripts/orchestrate.test.js` (Task 1), AC11: the six malformed-fingerprint rows and the two git-failure rows, each followed by `resume`, a fresh fingerprint and the unchanged hand-back recorded.
- [ ] [T-707] `tests/scripts/orchestrate.test.js` (Task 1), AC12: removal on a recorded hand-back; `resume` drops it and the re-install takes the crossed file as baseline.
- [ ] [T-708] `tests/unit/role-profiles.test.js` (Task 3), AC1, AC2: the four `[BUG-092]` rows, the FEAT-033 rows, the token cap and the four changed hash rows.
- [ ] [T-709] `tests/installer/commands-parity.test.js` (Task 4), AC5: the four new rows and the byte-identical mirror row.
- [ ] [T-710] AC3, AC4 have no test row: the README, the wiki page and the FEAT-033 spec are read by no test (T-501 to T-503 check them by diff). AC13: `npm test` (T-601). No E2E/UI test: there is no UI. CI legs: no new test is conditionally skipped, so no leg's skipped set in `tools/skip-baseline.json` changes.

## Commit Order

1. Task 0 (T-004): this plan and its `.gitignore` leaf.
2. Task 6 (T-605): the tests, the script, the four profiles, the hash pins, the four command copies, the README, wiki and FEAT-033 amendment, and the plan ticks for T-101 to T-603, in one commit, so no commit has a red suite. The red runs (T-103, T-302, T-402) happen in the working tree before each fix. The ticks for T-604, T-605 and the Test List ride the closeout commit.

## Identified Risks

- **A runner artifact that no ignore rule hides.** A coverage report or cache outside the surface halts `test-writer` on every dispatch (the spec's first false positive); the README says to ignore it before `resume`. Not loosened in code: the check cannot tell an artifact from a source file.
- **A snapshot created on `code`'s first passing run** halts `code` once (the spec's second false positive); after review and `resume` it is baseline and the hand-back passes (the `[AC12]` row exercises that baseline rule).
- **Fingerprint size.** One entry is a path plus a 64-character hash, so a run file stays under `RUN_FILE_MAX_BYTES` (8 MiB) up to tens of thousands of dirty, non-ignored files. `install` writes through `saveRun`, which has no bound; the hand-back removes `build_tree` before `saveHandedBackRun` checks the bound, so the check never fails because of it.
- **A path that is not a regular file.** A dirty submodule or a symlink to a folder cannot be read, so it hashes as `absent` in both fingerprints and never counts as changed. Acceptable: the test command's file writes, the spec's subject, land on regular files.
- **A file the main session writes during a dispatch outside the three router exclusions** (for example `.claude/memory/session-snapshot.json` in a project that tracks `.claude/memory/`) halts `test-writer` as a crossing. The spec fixes the exclusion list (choice 5); the halt names the file, and the owner keeps it and resumes.
- **A run file written mid-dispatch by an older version** halts `ORCH_HANDBACK_SPLIT_UNVERIFIED` once (spec, Alternative paths); `resume` and a re-install record a fingerprint.
- **The two edited rows hide a regression of the plain line.** `C4` and `R9` now include the note; the plain `test-writer handed back build_executed` and `code handed back build_executed` lines stay pinned by the `[AC9]` row, which runs on a work tree.
- **The long suite timing out the shell.** T-601 notes the duration; a timeout is not a red.
