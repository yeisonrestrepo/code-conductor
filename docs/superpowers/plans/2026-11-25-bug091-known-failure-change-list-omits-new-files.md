# BUG-091 Known-failure change list holds ignored paths and new directories: implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** in a run that declares known failures, `install qa`'s change list (`.conductor/handback/qa-change.txt`) also holds the untracked ignored paths and the new untracked directories outside `.conductor/`, a wholly untracked directory as one `A <dir>/` entry; the `qa` profile matches a failing test's file against such an entry through a leading part of its path; every `cc-orchestrate` mirror describes the wider list. The output line, the unavailable path and every other verb stay as they are.

**Spec:** `docs/superpowers/specs/2026-11-25-bug091-known-failure-change-list-omits-new-files-design.md` (sha256 `9a38118375f2033b2571b86b02c03f7bd486baf190b4c755013303624c590e20`), with the owner's amendments it already carries (Owner decisions: the fourth git call and AC9; the parent collapse in the main path and AC2). Issue #306, follow-up of BUG-089.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>` and `-t '<pattern>'`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines stay untouched. `README.md` is not edited at all: no line of it describes the change list (`grep -n 'qa-change' README.md` prints nothing).
- **Nine files change, plus this plan and its `.gitignore` leaf:** `scripts/orchestrate.mjs`, `tests/scripts/orchestrate.test.js`, `.claude/agents/qa.md`, `project-template/.claude/agents/qa.md`, `tests/unit/role-profiles.test.js`, `.claude/commands/cc-orchestrate.md`, `project-template/.claude/commands/cc-orchestrate.md`, `project-template/.agents/skills/cc-orchestrate/SKILL.md`, `project-template/.agents/workflows/cc-orchestrate.md`, `tests/installer/commands-parity.test.js` (ten paths: the spec's System Impact list).
- Not touched: `changeNote`, `install`, `CHANGE_LIST_FILE`, `isValidRun`, `.claude/agents/code.md` and its copy (spec, Out of Scope), every other profile, the hooks, the installer, settings, workflows, dependencies.
- Every file this plan edits after Task 0 is already tracked and none sits under an ignored directory, so each is staged with `git add -u <path>`. This plan is new in Task 0 under the ignored `docs/superpowers/plans/` (so `git add -f`) and is tracked and re-included by its leaf afterwards (so `git add -u`).
- `.claude/` is read-only for Bash in the build sandbox: every edit under `.claude/` uses the Edit tool. The `project-template/` copies may use either.

## Files read in full (spec, Files Requiring Full Read)

- `scripts/orchestrate.mjs`: `HANDBACK_DIR` (`:99`) and `CHANGE_LIST_FILE` (`:101`); `changeList` (`:716-731`), whose status check is `diff.status !== 0 || others.status !== 0` (`:724`) and whose untracked loop is `:728`; `changeNote` (`:732-742`) counts `A ` lines as created, so a `<dir>/` entry counts as one created entry with no change (spec, Decision 4). `.conductor/` appears only as the prefix of the router's own paths (`:24`, `:99-112`); no constant names the folder alone.
- `tests/scripts/orchestrate.test.js` (5586 lines): helpers `orch` (`:43`), `fixtureGit` / `fixtureCommit` (`:52-56`), `runFileText`, `envelopeText`, `approveArgs` (writes `docs/specs/demo-design.md` after `start`), `installedRepo` (copies `scripts/` from the repository into the fixture, so a test always runs the working tree's script), `driveTo` (`prep` runs after `installedRepo` and before `start`). The BUG-089 block is `:5075-5205`: `SPEC_ONLY` (`:5088`), the AC4 list test (`:5105`, its expectations `:5114-5115`), the `--check` test (`:5118`, `:5122`), the second-install test (`:5126`, `:5134`), the AC8 short-entry install test (`:5197`, `:5202-5203`). Its unavailable cases make git fail by a null base, a removed security record and the base `'0'.repeat(40)`, none of which reaches a list. The next block, `describe('test-writer in the Build band [FEAT-033]'`, starts at `:5207`.
- `.claude/agents/qa.md` line 21 (byte-identical to its `project-template` copy): the BUG-089 sentences `QA_LIST`, `FILE_RULE`, `PATH_MATCH`, then `Report its exact exit status …`.
- `tests/unit/role-profiles.test.js` (439 lines): the BUG-089 constants (`:138-143`), the token cap row (`:201-202`, 999 tokens as `ceil(bytes / 4)`), the BUG-089 block (`:259-278`), `PROFILE_SHA256_1_37_0` (`:283`), its `qa` row (`:297-299`), the hash rows over `TEMPLATE` and `MIRROR` (`:307-311`).
- `tests/installer/commands-parity.test.js`: `ORCH_MIRRORS` (`:198`, the two Claude Code copies), the byte-identical row (`:202`), the BUG-089 row (`:371-382`), `describe('cc-orchestrate review loop …')` at `:384`. No test reads the two `project-template/.agents/` copies of `cc-orchestrate`.
- The four `cc-orchestrate` copies: the Verify step is `.claude/commands/cc-orchestrate.md:91`, `project-template/.claude/commands/cc-orchestrate.md:91`, `project-template/.agents/skills/cc-orchestrate/SKILL.md:95` and `project-template/.agents/workflows/cc-orchestrate.md:94`; the four lines are byte-identical, and each holds once ``the files the change created or modified against the base commit `start` recorded, or``.

## Plan decisions

1. **`changeList` (spec Solution, AC1-AC6, AC9).** Directly above the BUG-089 comment of `changeList` (`:716`):

   ```js
   // BUG-091: the router's own state, the list file included, holds no test, so no path under it is listed.
   const ROUTER_DIR = '.conductor/';
   const nulPaths = (result) => result.stdout.split('\0').filter(Boolean);

   ```

   Three comment lines join the BUG-089 comment, and the body takes the two calls, one status check over all four results, and the two adds:

   ```js
   // BUG-089: the files the change created (A) or modified (M) against the base start recorded, sorted by path.
   // --no-renames makes a rename a delete plus a create; a deleted file holds no test that can fail, so it is left out.
   // BUG-091: an ignore rule hides a new file from the first two calls, so the untracked ignored paths and the new
   // untracked directories are listed too, a wholly untracked directory as one <dir>/ entry; git keeps no record of
   // untracked files, so one that predates the base is listed as created, which only makes fewer failures known.
   function changeList(root, security) {
     if (!isPlainObject(security)) return { reason: 'the run has no security record (started before FEAT-034)' };
     if (security.base === null) return { reason: 'the run recorded no base commit' };
     const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30 });
     const diff = git(['diff', '--name-status', '--no-renames', '--relative', '-z', security.base]);
     const others = git(['ls-files', '--others', '--exclude-standard', '-z']);
     const ignored = git(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '--no-empty-directory', '-z']);
     const dirs = git(['ls-files', '--others', '--exclude-standard', '--directory', '--no-empty-directory', '-z']);
     if ([diff, others, ignored, dirs].some((r) => r.status !== 0)) return { reason: 'git cannot compare the work tree with the base commit' };
     const status = new Map();
     const fields = diff.stdout.split('\0');
     for (let i = 0; i + 1 < fields.length; i += 2) if (fields[i] !== 'D') status.set(fields[i + 1], fields[i] === 'A' ? 'A' : 'M');
     for (const path of nulPaths(others)) status.set(path, 'A');
     const newDirs = nulPaths(dirs).filter((path) => path.endsWith('/'));
     for (const path of [...nulPaths(ignored), ...newDirs]) if (!path.startsWith(ROUTER_DIR)) status.set(path, 'A');
     return { lines: [...status.keys()].sort().map((path) => `${status.get(path)} ${path}`) };
   }
   ```

   - **The status check (AC6).** One condition names the four results, as AC6 asks the build audit to read. A missing git binary gives `status: null`, so it is still the unavailable path.
   - **`.conductor/` (AC3).** The filter applies to the two new calls, as the spec's Solution says ("left out of both"): `.conductor/` printed as one entry and the separate paths git prints under it when a file inside is tracked both start with `.conductor/`. The diff and the second call are not filtered, so their output is what BUG-089 shipped; in the repository's fixtures `.conductor/` is ignored, so neither of them ever prints a path under it. AC3's two fixtures (ignored as a whole, and holding a tracked file) are the two rows of N4 below.
   - **The fourth call's file entries** repeat the second call's and are dropped by `endsWith('/')`; its `<dir>/` entries are the only ones added (AC9).
   - **Overlap.** The untracked calls only ever add `A`, and a path the diff holds is tracked, so no diff status is overwritten (spec, Alternative paths).
   - **Size.** `changeList` grows from 13 to 17 lines, under the 30-line cap. Path parsing stays `-z` and NUL-split, so a path holding a space is listed as is (AC5).

   Measured on a copy of this branch (HEAD `d7520c1`, git 2.43.0, Node v24.22.2) with exactly this body: every list of plan decision 2 and 3 below, as written.

2. **The BUG-089 block's tests (AC1).** In `tests/scripts/orchestrate.test.js`, each assertion keeps its shape:
   - `:5088`: `const SPEC_ONLY = 'A docs/specs/demo-design.md\n';` becomes, under the comment `// BUG-091: the fixture's base list, the router's ignored .claude/memory/ and the new docs/specs/ with its spec file.`, `const BASE_LIST = 'A .claude/memory/\nA docs/specs/\nA docs/specs/demo-design.md\n';`.
   - `:5105` title: `'[AC4] install qa lists created, modified, renamed, untracked and ignored files, sorted, leaving out deleted ones'`; `:5114` `changeLine(3, 1)` → `changeLine(6, 1)`; `:5115` the list becomes `` `${BASE_LIST}A ignored.txt\nA tests/a b.test.js\nM tests/kept.test.js\nA tests/new.test.js\n` ``.
   - `:5122` (`--check`): `changeLine(1, 0)` → `changeLine(3, 0)`.
   - `:5134`: `` `${SPEC_ONLY}A tests/second.test.js\n` `` → `` `${BASE_LIST}A tests/second.test.js\n` ``.
   - `:5202-5203` (AC8 short entry): `changeLine(1, 0)` → `changeLine(3, 0)`, and `SPEC_ONLY` → `BASE_LIST`.

   No other line of the block changes: the unavailable, `end`, `start`, envelope and validation rows hold no list. `A docs/specs/` comes from the fourth call: `docs/` is tracked at the base through `docs/plans/demo.md` (`plan()`), and `docs/specs/` is new.

3. **The new block (AC2-AC6, AC9).** Inserted before `describe('test-writer in the Build band [FEAT-033]'` (`:5207`), `describe('known-failure change list holds ignored paths and new directories [BUG-091]', …)`, with:

   ```js
   const KF = 'tests/contract/x.test.js > isolated store';
   const LIST = '.conductor/handback/qa-change.txt';
   const listText = () => readFileSync(join(root, LIST), 'utf8');
   const lastLine = (r) => r.out.split('\n').at(-1);
   const changeLine = (created, modified) => `change files: ${created} created, ${modified} modified (${LIST})`;
   const BASE_LIST = 'A .claude/memory/\nA docs/specs/\nA docs/specs/demo-design.md\n';
   // The base commit holds tracked tests and the ignore file of the BUG-089 block; tracked() force-adds a file under .conductor/.
   const qaRun = (tracked = false) => ({ start: ['--known-failure', KF], prep: () => {
     writeFileSync(join(root, '.gitignore'), '.conductor/\n.claude/memory/\nignored.txt\n');
     mkdirSync(join(root, 'tests'), { recursive: true });
     writeFileSync(join(root, 'tests', 'old.test.js'), 'x\n');
     if (tracked) { mkdirSync(join(root, '.conductor'), { recursive: true }); writeFileSync(join(root, '.conductor', 'keep.txt'), 'k\n'); fixtureGit('add', '-f', '.conductor/keep.txt'); }
     fixtureCommit();
   } });
   // Rules in .git/info/exclude: an ignore source that never shows in the diff.
   const exclude = (...rules) => writeFileSync(join(root, '.git', 'info', 'exclude'), rules.map((rule) => `${rule}\n`).join(''));
   const write = (rel, text = 'x\n') => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
   const installList = () => { const r = orch(['install', 'qa']); expect(r.status).toBe(0); return { r, list: listText() }; };
   ```

   Rows (9 tests), each starting with `driveTo('qa', qaRun())` unless it says otherwise:
   - **N1** `'[AC2] a file in a new ignored directory whose parent holds tracked files is listed once, as that directory'`: `exclude('.tmp/')`; `write('tests/.tmp/new.test.js')`; an empty `tests/empty/.tmp/` (`mkdirSync`, recursive); the list is `` `${BASE_LIST}A tests/.tmp/\n` `` and the last line `changeLine(4, 0)`.
   - **N2** `'[AC2] a file in a new ignored directory whose new parent holds nothing tracked collapses into the parent'`: `exclude('.tmp/')`; `write('e2e/.tmp/new.test.js')`; the list is `` `${BASE_LIST}A e2e/\n` `` and does not contain `'e2e/.tmp'`. The fixture's `tests/` is tracked, so the new parent is `e2e/`: the same shape as the spec's `tests/` with nothing tracked.
   - **N3** `'[AC2] an empty ignored directory is not listed'`: `exclude('.tmp/')`; an empty `.tmp/`; the list is `BASE_LIST`.
   - **N4** `it.each([['ignored as a whole', false], ['holding a tracked file', true]])('[AC3] nothing at or under .conductor/ is listed with .conductor/ %s', (_name, tracked) => …)`: `driveTo('qa', qaRun(tracked))`; `write('.conductor/extra/new.test.js')`; the list is `BASE_LIST` and does not contain `'.conductor'`. 2 rows.
   - **N5** `'[AC4] a .gitignore rule added with the test file it ignores lists both'`: `.gitignore` rewritten with `tests/gen.test.js\n` appended; `write('tests/gen.test.js')`; the list is `'A .claude/memory/\nM .gitignore\nA docs/specs/\nA docs/specs/demo-design.md\nA tests/gen.test.js\n'` and the last line `changeLine(4, 1)`.
   - **N6** `'[AC5] an ignored path holding a space is listed byte for byte'`: `exclude('cache dir/')`; `write('tests/cache dir/x.test.js')`; the list is `` `${BASE_LIST}A tests/cache dir/\n` ``.
   - **N7** `'[AC6] a corrupt index makes the list unavailable and removes the earlier file'`: `installList()` (the list exists); `writeFileSync(join(root, '.git', 'index'), 'not an index\n')`; `orch(['install', 'qa'])` status 0, last line `'change files: unavailable (git cannot compare the work tree with the base commit); no failing test is known'`; the list does not exist. Green today too, which is the spec's stated limit of this test (AC6); the four-result condition of decision 1 is the part the audit reads.
   - **N8** `'[AC9] an ignored file in a new directory that also holds files no rule ignores is covered by the directory'`: `exclude('*.ign.js')`; `write('newdir/a.js')`; `write('newdir/b.ign.js')`; the list is `` `${BASE_LIST}A newdir/\nA newdir/a.js\n` ``, does not contain `'b.ign.js'`, and the last line is `changeLine(5, 0)`.

   Written in this order, N1 to N8. None of these fixtures configures role models, so no `model:` line follows the change line.

4. **The `qa` profile sentence (AC7).** In `.claude/agents/qa.md` and its `project-template` copy, line 21, after ``a failing test whose file this rule cannot settle is never known. `` (the end of `PATH_MATCH`, with its trailing space) insert, followed by one space:

   ``A listed path that ends in `/` is a directory entry: a failing test's file matches it when a leading part of the file's path that ends in `/` matches the entry by that rule, so `tests/.tmp/` matches `tests/.tmp/x.test.js` and `pkg/tests/.tmp/x.test.js`, and `pkg/tests/.tmp/` matches `tests/.tmp/x.test.js` printed by a runner in `pkg/`; a match through a shared directory name is accepted, because it only makes fewer failures known.``

   "That rule" is `PATH_MATCH`, the sentence right before it (equal, or one ends with `/` followed by the other, after every `\` becomes `/`). The three examples are the spec's three cases. Nothing else in the file changes; the BUG-089 sentences stay byte-identical.

   **Measured** on a copy of this branch: `qa.md` 3464 → 3899 bytes, 975 tokens (`ceil(bytes / 4)`, under the 999 cap), sha256 `f4319a4ce0db973fdaa03143a5f57d00011c4d8904026b07c8528af0bbfdea20`, both copies `cmp`-equal. A hash that differs after the edit means the edit differs from this decision: fix the edit, not the pin.

5. **`tests/unit/role-profiles.test.js` (AC7).** After `CODE_LIST` (`:143`):

   ```js
   // BUG-091: a listed <dir>/ entry matches a failing test's file through a leading part of its path, in both directions.
   const QA_DIR = "<the sentence of decision 4, verbatim>";
   const QA_DIR_SUBFOLDER = '`pkg/tests/.tmp/` matches `tests/.tmp/x.test.js` printed by a runner in `pkg/`';
   ```

   A new `describe('directory entries in the qa change list [BUG-091]', …)` before the `// FEAT-031 AC13` comment (`:280`), 5 tests:
   - `it.each([TEMPLATE, MIRROR].map((dir) => [`${dir}/qa.md`]))('[AC7] %s matches a <dir>/ entry through a leading part of the path', …)`: `read(rel)` contains `QA_DIR`. 2 rows.
   - `it.each(<same rows>)('[AC7] %s names the subfolder case, a runner printing a shorter path', …)`: `read(rel)` contains `QA_DIR_SUBFOLDER`. 2 rows.
   - `'[AC7] the BUG-089 rules stay in qa as they were'`: `profile('qa')` contains `QA_LIST`, `FILE_RULE`, `PATH_MATCH` and `QA_NAMED`.

   `PROFILE_SHA256_1_37_0`, the `qa` row: a new comment line after the BUG-089 one, `// BUG-091 changed qa on purpose: a listed path ending in / is a directory entry, matched through a leading part of a failing test's path.`, and the hash of decision 4. Every other row is unchanged.

6. **The four `cc-orchestrate` copies (AC8).** In each, the Verify-step line named above, one replacement:

   ``the files the change created or modified against the base commit `start` recorded, or`` → ``the files the change created or modified against the base commit `start` recorded, plus the untracked ignored paths and the new untracked directories outside `.conductor/`, a wholly untracked directory being one `<dir>/` entry, or``

   The four lines stay byte-identical to each other, and the two Claude Code copies stay byte-identical as files. No other phrase changes, so the BUG-089 row's phrases hold.

7. **`tests/installer/commands-parity.test.js` (AC8).** Before `describe('cc-orchestrate review loop …')` (`:384`), a new block:

   ```js
   describe('cc-orchestrate qa change list [BUG-091 AC8]', () => {
     const HARNESS_MIRRORS = ['project-template/.agents/skills/cc-orchestrate/SKILL.md', 'project-template/.agents/workflows/cc-orchestrate.md'];
     it.each([...ORCH_MIRRORS, ...HARNESS_MIRRORS])('%s lists ignored paths and new directories, a wholly untracked directory as one entry', (rel) => {
       expect(read(rel)).toContain('plus the untracked ignored paths and the new untracked directories outside `.conductor/`, a wholly untracked directory being one `<dir>/` entry');
     });
   });
   ```

   4 rows: the two harness copies have no other parity row, so the block names all four.

8. **Red predictions, measured on a copy of this branch with the tests of decisions 2, 3, 5 and 7 and the unchanged script and profiles.**
   - Task 1, `npx vitest run tests/scripts/orchestrate.test.js -t 'BUG-089|BUG-091'`: the full match set is the 25 BUG-089 tests and the 9 new ones. **Red 12:** the four BUG-089 tests of decision 2 and N1, N2, N3, both N4 rows, N5, N6 and N8 (the list lacks the new entries). **Green 22:** the other 21 BUG-089 tests and N7. So **12 failed | 22 passed**, 1246 skipped (1280).
   - Task 3, `npx vitest run tests/unit/role-profiles.test.js` before the profile edits: **red** the four `[AC7]` sentence rows; **green** the BUG-089-rules row and every existing row (the sha row is edited after the profiles). **4 failed | 202 passed (206)**.
   - Task 4, `npx vitest run tests/installer/commands-parity.test.js` before the command edits: **4 failed | 116 passed (120)**, the four new rows red.

9. **`.gitignore` leaf.** `!/docs/superpowers/plans/2026-11-25-bug091-known-failure-change-list-omits-new-files.md` goes directly after the `2026-11-23-feat048-harness-commands.md` plan leaf (`.gitignore:208`) and before the `2026-11-25-bug093` plan leaf, the full-path sort order of the block (BUG-042).

## Baseline (measured on this branch, HEAD d7520c1, Node v24.22.2, git 2.43.0)

- `npx vitest run tests/unit/role-profiles.test.js`: **201 passed (201)**.
- `npx vitest run tests/installer/commands-parity.test.js`: **116 passed (116)**.
- `tests/scripts/orchestrate.test.js`: **1271** tests (the copy counts 1280 with the 9 new ones and nothing else added).
- No existing test title contains `BUG-091`, so `-t 'BUG-091'` selects only the new rows.
- After every change, measured on the copy: the three files at **1280**, **206** and **120 passed**. `npm test` on the copy: **9 failed | 4808 passed | 17 skipped (4834)**. All nine are in `tests/installer/smoke.test.js`, `tests/tools/repo-invariants.test.js`, `tests/unit/host-owned-ignore-xor.test.js`, `tests/unit/staging-convention.test.js` and `tests/unit/gitignore-block-parity.test.js`, which read the repository's own git state; the copy was made without `.git`, and this plan touches none of those files. In the branch's work tree they run against its git, so T-501 predicts exit 0 with 4834 tests.

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-25-bug091-known-failure-change-list-omits-new-files.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file from the approved spec `9a381183…`. No dependency.
- [X] [T-002] `.gitignore`: insert the leaf of plan decision 9 after the `2026-11-23-feat048-harness-commands.md` plan leaf. Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` (tracked) and `git add -f docs/superpowers/plans/2026-11-25-bug091-known-failure-change-list-omits-new-files.md` (new, under the ignored `docs/superpowers/plans/`). Depends on T-002.
- [X] [T-004] Commit: `docs: plan listing ignored paths and new directories in the known-failure change list [BUG-091]`. Depends on T-003.

---

### Task 1: Change-list tests first (red)

**Files:**
- Test: `tests/scripts/orchestrate.test.js`

- [ ] [T-101] `tests/scripts/orchestrate.test.js`: the BUG-089 block's edits of plan decision 2 (`BASE_LIST`, the AC4 title, the four expectations). Depends on T-004.
- [ ] [T-102] `tests/scripts/orchestrate.test.js`: the new `describe('known-failure change list holds ignored paths and new directories [BUG-091]')` with its constants and rows N1-N8 (plan decision 3), before the FEAT-033 block. Depends on T-101.
- [ ] [T-103] Red run: `npx vitest run tests/scripts/orchestrate.test.js -t 'BUG-089|BUG-091'`. Its full match set is the 34 tests of plan decision 8. Predicted: **12 failed | 22 passed**, 1246 skipped (1280). Any other split means a test is wrong: fix the test, not the prediction. Depends on T-102.

---

### Task 2: The change list (green)

**Files:**
- Modify: `scripts/orchestrate.mjs`

- [ ] [T-201] `scripts/orchestrate.mjs`: `ROUTER_DIR` and `nulPaths` above `changeList`, the BUG-091 comment lines, the two calls, the four-result status check and the two adds (plan decision 1). Depends on T-103.
- [ ] [T-202] Green run: the T-103 command. Predicted: **34 passed**, 1246 skipped (1280). Depends on T-201.
- [ ] [T-203] Run the whole file: `npx vitest run tests/scripts/orchestrate.test.js` (several minutes). Predicted: **1280 passed (1280)**. Depends on T-202.

---

### Task 3: The directory sentence in the `qa` profile (red, then green)

**Files:**
- Modify: `.claude/agents/qa.md`
- Modify: `project-template/.claude/agents/qa.md`
- Test: `tests/unit/role-profiles.test.js`

- [ ] [T-301] `tests/unit/role-profiles.test.js`: the BUG-091 comment and the two constants after `CODE_LIST`, and `describe('directory entries in the qa change list [BUG-091]')` (plan decision 5). Do not touch the sha rows yet. Depends on T-203.
- [ ] [T-302] Red run: `npx vitest run tests/unit/role-profiles.test.js`. Predicted: **4 failed | 202 passed (206)** (plan decision 8). Depends on T-301.
- [ ] [T-303] `.claude/agents/qa.md` (Edit tool): the insertion of plan decision 4. Depends on T-302.
- [ ] [T-304] `project-template/.claude/agents/qa.md`: the same insertion; then `cmp` of the two copies prints nothing and `sha256sum` of each prints the hash of decision 4. A different hash means the edit differs from decision 4: fix the edit. Depends on T-303.
- [ ] [T-305] `tests/unit/role-profiles.test.js`, `PROFILE_SHA256_1_37_0`: the BUG-091 comment line and the new `qa` hash (plan decision 5). Depends on T-304.
- [ ] [T-306] Green run: the T-302 command. Predicted: **206 passed (206)**, the token cap, the BUG-089 rows and both directories' hash rows included. Depends on T-305.

---

### Task 4: The four `cc-orchestrate` copies (red, then green)

**Files:**
- Modify: `.claude/commands/cc-orchestrate.md`
- Modify: `project-template/.claude/commands/cc-orchestrate.md`
- Modify: `project-template/.agents/skills/cc-orchestrate/SKILL.md`
- Modify: `project-template/.agents/workflows/cc-orchestrate.md`
- Test: `tests/installer/commands-parity.test.js`

- [ ] [T-401] `tests/installer/commands-parity.test.js`: the new block of plan decision 7. Depends on T-306.
- [ ] [T-402] Red run: `npx vitest run tests/installer/commands-parity.test.js`. Predicted: **4 failed | 116 passed (120)**. Depends on T-401.
- [ ] [T-403] `.claude/commands/cc-orchestrate.md` (Edit tool): the replacement of plan decision 6. Depends on T-402.
- [ ] [T-404] `project-template/.claude/commands/cc-orchestrate.md`, `project-template/.agents/skills/cc-orchestrate/SKILL.md` and `project-template/.agents/workflows/cc-orchestrate.md`: the same replacement; then `cmp` of the two Claude Code copies prints nothing, and the Verify-step lines (`:91`, `:91`, `:95`, `:94`) are byte-identical. Depends on T-403.
- [ ] [T-405] Green run: the T-402 command. Predicted: **120 passed (120)**, the byte-identical mirror row and the BUG-089 row included. Depends on T-404.

---

### Task 5: Full suite, scope check and commit

**Files:**
- Modify: `docs/superpowers/plans/2026-11-25-bug091-known-failure-change-list-omits-new-files.md` (ticks)

- [ ] [T-501] Run `npm test` (long: `orchestrate.test.js` alone takes several minutes; run it in the background if the shell times out). Predicted: exit 0 (AC10), with `tests/scripts/orchestrate.test.js` at **1280 passed**, `tests/unit/role-profiles.test.js` at 206 and `tests/installer/commands-parity.test.js` at 120. A red is called ENV only if the sandbox caused it (network, tmp permissions) and its file is not one this plan touches; report it with its name. Any other red is fixed. Depends on T-405.
- [ ] [T-502] Scope check: `git status --short` lists exactly the ten files of the Global Constraints and this plan; no temporary file is left in the tree. `git diff --stat` shows no change to the spec, `changeNote`, `install`, `code.md` or its copy, `README.md`, any hook or the installer. Depends on T-501.
- [ ] [T-503] Stage: `git add -u scripts/orchestrate.mjs tests/scripts/orchestrate.test.js .claude/agents/qa.md project-template/.claude/agents/qa.md tests/unit/role-profiles.test.js .claude/commands/cc-orchestrate.md project-template/.claude/commands/cc-orchestrate.md project-template/.agents/skills/cc-orchestrate/SKILL.md project-template/.agents/workflows/cc-orchestrate.md tests/installer/commands-parity.test.js` (all tracked). Depends on T-502.
- [ ] [T-504] Stage: `git add -u docs/superpowers/plans/2026-11-25-bug091-known-failure-change-list-omits-new-files.md` (carries the ticks for T-101 to T-503). Depends on T-503.
- [ ] [T-505] Commit: `fix: list ignored paths and new directories in the known-failure change list [BUG-091]`. Depends on T-504.

---

## Test List

- [ ] [T-601] `tests/scripts/orchestrate.test.js` (Task 1), AC1: the four BUG-089 tests of plan decision 2 with `BASE_LIST` (`A .claude/memory/`, `A docs/specs/`, `A ignored.txt` listed).
- [ ] [T-602] `tests/scripts/orchestrate.test.js` (Task 1), AC2: N1 (ignored directory under a tracked parent, an empty ignored directory beside it), N2 (collapse into a new parent), N3 (an empty ignored directory).
- [ ] [T-603] `tests/scripts/orchestrate.test.js` (Task 1), AC3: the two N4 rows.
- [ ] [T-604] `tests/scripts/orchestrate.test.js` (Task 1), AC4: N5 (`M .gitignore` and the file it ignores).
- [ ] [T-605] `tests/scripts/orchestrate.test.js` (Task 1), AC5: N6 (a space in an ignored directory's path).
- [ ] [T-606] `tests/scripts/orchestrate.test.js` (Task 1), AC6: N7 (corrupt index) and the unchanged BUG-089 unavailable rows (null base, no security record, unreadable base, second install).
- [ ] [T-607] `tests/scripts/orchestrate.test.js` (Task 1), AC9: N8 (`A newdir/`, `A newdir/a.js`, no `b.ign.js`).
- [ ] [T-608] `tests/unit/role-profiles.test.js` (Task 3), AC7: the four sentence rows, the BUG-089-rules row, the token cap and both `qa` hash rows.
- [ ] [T-609] `tests/installer/commands-parity.test.js` (Task 4), AC8: the four new rows, the byte-identical mirror row and the BUG-089 row.
- [ ] [T-610] AC10: `npm test` (T-501). No E2E/UI test: there is no UI. CI legs: no new test is conditionally skipped, so no leg's skipped set in `tools/skip-baseline.json` changes.

## Commit Order

1. Task 0 (T-004): this plan and its `.gitignore` leaf.
2. Task 5 (T-505): the tests, the script, the two profiles, the hash pin, the four command copies and the plan ticks for T-101 to T-503, in one commit, so no commit has a red suite. The red runs (T-103, T-302, T-402) happen in the working tree before each fix. The ticks for T-504, T-505 and the Test List ride the closeout commit.

## Identified Risks

- **A fixture's list holding a path the plan did not predict.** Every list of decisions 2 and 3 was measured with git 2.43.0. A different list in T-202 on another git means git collapses or descends differently: report the measured list rather than loosen the assertion, because the spec's shape rests on that behavior.
- **A host project with a large ignored tree.** `--directory` keeps `node_modules/` and similar as one entry each, so the list stays small (spec, Solution). `maxBuffer` is the existing 1 GiB.
- **An ignored path that predates the base.** Listed as created, so a failing test in it is never known (spec, Decision 2); `qa` names it as matched but not known.
- **A runner run from inside a collapsed directory.** Its printed path holds no part of the entry, so the entry does not settle it (spec, Out of Scope); the profile sentence does not claim otherwise.
- **The profile over the token cap.** 975 of 999 tokens measured; T-306 runs the cap row.
- **The harness copies drifting.** No test kept them in line before; decision 7's rows pin the new phrase in all four, and T-404 compares the four Verify lines.
- **The long suite timing out the shell.** T-501 notes the duration; a timeout is not a red.
