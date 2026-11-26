# BUG-098 Split check fingerprint diffs against the current HEAD instead of the HEAD recorded at install: implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** `install test-writer` and `install code`, on a run with a test surface, record in `build_tree` the commit `HEAD` names (`null` before the first commit) and the sha256 of `.git/info/exclude` and of the `core.excludesFile` file, beside the fingerprint. `handback` takes its fingerprint against the recorded commit instead of the current `HEAD`, and halts `ORCH_HANDBACK_SURFACE_CROSSED` when `HEAD` moved or either ignore file changed during the dispatch, naming the move and the files before any crossed paths. A `files` record without a valid `head` and `ignores` halts `ORCH_HANDBACK_SPLIT_UNVERIFIED`. The four `/cc-orchestrate` copies and the README's "Guard 5 in detail" paragraph say so.

**Spec:** `docs/superpowers/specs/2026-11-26-bug098-split-check-fingerprint-diffs-against-the-design.md` (sha256 `f361a5242da9553e1748a3439735fc4334fa78cff4b858329ceee64f9a087c60`), approved by independent review (round 1). Issue #341, follow-up of BUG-092.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>` and `-t '<pattern>'`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines (the `[BUG-098]` line at `README.md:536` included) stay untouched. The release rewrites them.
- **Eight files change, plus this plan and its `.gitignore` leaf:** `scripts/orchestrate.mjs`, `tests/scripts/orchestrate.test.js`, `tests/installer/commands-parity.test.js`, `.claude/commands/cc-orchestrate.md`, `project-template/.claude/commands/cc-orchestrate.md`, `project-template/.agents/skills/cc-orchestrate/SKILL.md`, `project-template/.agents/workflows/cc-orchestrate.md`, `README.md`, and nothing else (the spec's System Impact list).
- Not touched: `.claude/hooks/` and its mirror, `install`, `handback`, `resume`, `installedRunText` and BUG-099's bound, `changeList`, `isValidRun`, the halt-code set, the SNAP contract and envelope versions, the installer, settings, `.github/workflows/`, `.github/actions/`, dependencies. No network is added: the change adds two `git rev-parse` reads, one `git config --get` read and two file hashes to a check that already runs.
- Every file this plan edits after Task 0 is already tracked and none sits under an ignored directory, so each is staged with `git add -u <path>`. This plan is new in Task 0 under the ignored `docs/superpowers/plans/` (so `git add -f`) and is tracked and re-included by its leaf afterwards (so `git add -u`).
- `.claude/` is read-only for Bash in the build sandbox: the edit of `.claude/commands/cc-orchestrate.md` uses the Edit tool. The other files may use either.

## Files read in full (spec, Files Requiring Full Read)

- `scripts/orchestrate.mjs` (1967 lines on this branch, HEAD `0e0a1f9` on top of `main` @ `5601b89`): the imports (`:6-12`; `spawnSync`, `createHash`, `readFileSync`, `homedir`, `join` and `resolve` are already imported); `OBJECT_NAME` (`:171`, 40 or 64 lowercase hex); `isPlainObject` (`:181`); `ROUTER_DIR` and `nulPaths` (`:723-724`); `changeList` (`:730-750`); `isRouterFile` and `contentHash` (`:754-755`, a file that cannot be read hashes as `absent`); `treeFingerprint` (`:759-770`), whose only `HEAD` read is `:764-765`; `buildTree` (`:773-777`), called only by `install` (`:809`); `isTreeRecord` and `changedPaths` (`:1200-1203`); `splitCheck` (`:1207-1219`), called only by `handback` (`:1236`). `treeFingerprint` has no caller besides `buildTree` and `splitCheck` (Grep), so its new `base` argument reaches every call. `install`, `handback` and `resume` already drop `build_tree` where BUG-092 needs it and need no edit.
- `tests/scripts/orchestrate.test.js` (5979 lines): the helpers `orch` (`:44`, `HOME` is a fresh temp folder, the rest of `process.env` minus git's local variables), `fixtureGit` (`:53`, identity and signing pinned, `cwd: root`), `fixtureCommit` (`:57`, `add -A` then `commit`), `runFile`, `runFileText`, `sha` (`:65`). The BUG-092 block `describe('test-surface split at hand-back [BUG-092]'` (`:5656`): `write`, `patchRun`, `writerSay`, `codeSay`, `writerDone`, `atWriter` (base commit with `.gitignore`, `src/a.js`, `src/base.js`), `install`, `handBack`, `crossed`, `UNVERIFIED`, `atCode` (`:5680`); the two `[AC6]` rows (`:5682-5697`), the only rows that pin a whole `build_tree` with `toEqual`; the nested `describe('run-file bound at install [BUG-099]'` (`:5871-5951`), whose rows leave `ROOM` (8 KiB) of headroom and pin `build_tree` only with `toMatchObject` or a file count, so two short fields more change none of them. vitest's `-t` matches the full test name, describe titles included.
- `tests/installer/commands-parity.test.js`: `ORCH_MIRRORS` (`:198`) and the `[BUG-092 AC5]` block (`:391-400`), whose last `toContain` is `:398`.
- The four `cc-orchestrate` copies: the hand-back halts line is `.claude/commands/cc-orchestrate.md:37`, `project-template/.claude/commands/cc-orchestrate.md:37`, `project-template/.agents/skills/cc-orchestrate/SKILL.md:41`, `project-template/.agents/workflows/cc-orchestrate.md:40`; the four lines are byte-identical (sha256 `bcce1a49…`), each holding once ``so the owner keeps or reverts them by hand first. It halts `ORCH_HANDBACK_SPLIT_UNVERIFIED` ``.
- `README.md:314` ("Guard 5 in detail"), which holds once ``past its 8 MiB bound), and `handback` halts `ORCH_HANDBACK_SURFACE_CROSSED`, naming the files, when one on the other role's side of the split changed during the dispatch, whatever `ops.f` lists.``; no test reads that sentence (Grep of `tests`, `tools`, `scripts`).

## Plan decisions

1. **`treeFingerprint` takes its base (spec choice 1, Main path).** In `scripts/orchestrate.mjs`, below the two BUG-092 comment lines above `function treeFingerprint(root) {` (`:757-758`), add one comment line, change the signature, and replace the two `HEAD` lines (`:764-765`) with one:

   ```js
   // BUG-098: HEAD is the commit install recorded (base), not the current one, so a commit made during the dispatch hides nothing.
   function treeFingerprint(root, base) {
   ```

   ```js
     const tracked = git(base === null ? ['ls-files', '-z'] : ['diff', '--name-only', '--no-renames', '--relative', '-z', base, '--']);
   ```

   `base` is the recorded `head`: an object name (`isTreeRecord` checks it against `OBJECT_NAME` at hand-back; at install it is `rev-parse` output) or `null`, which keeps today's no-commit listing. The trailing `--` makes git read `base` as a revision even if a file of that name exists. A recorded commit git cannot resolve makes `diff` exit non-zero, so the existing `git cannot list the changed files` reason and the `ORCH_HANDBACK_SPLIT_UNVERIFIED` halt cover the spec's "recorded commit cannot be diffed" error case unchanged. 11 lines.

2. **The anchor (spec choices 1 and 3).** Between `treeFingerprint` and the BUG-092 comment of `buildTree`, exactly:

   ```js
   // BUG-098: the ignore files --exclude-standard reads outside the work tree, keyed by a fixed label, never by their path.
   const IGNORE_LABELS = ['info/exclude', 'core.excludesFile'];

   // BUG-098: core.excludesFile as git config prints it, else git's own default under XDG_CONFIG_HOME or HOME.
   function excludesFilePath(root, git) {
     const set = git(['config', '--path', '--get', 'core.excludesFile']);
     if (set.status === 0 && set.stdout.trim() !== '') return resolve(root, set.stdout.trim());
     return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'git', 'ignore');
   }

   // BUG-098: the commit HEAD names (null before the first commit) and the hash of each ignore file outside the tree;
   // the test command can move either during a dispatch without changing a path the fingerprint lists.
   function treeAnchor(root) {
     const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
     const head = git(['rev-parse', '--verify', '--quiet', 'HEAD']);
     const exclude = git(['rev-parse', '--git-path', 'info/exclude']);
     const excludeHash = exclude.status === 0 ? contentHash(resolve(root, exclude.stdout.trim())) : 'absent';
     return {
       head: head.status === 0 ? head.stdout.trim() : null,
       ignores: { 'info/exclude': excludeHash, 'core.excludesFile': contentHash(excludesFilePath(root, git)) },
     };
   }
   ```

   - **`info/exclude`.** `git rev-parse --git-path info/exclude` prints the path relative to the command's cwd (measured, git 2.43.0: `../.git/info/exclude` from a subfolder) or absolute (a linked worktree's common directory), so `resolve(root, …)` is right in both, and in a project root that is a subfolder of the repository.
   - **`core.excludesFile`.** `git config --path --get` expands a leading `~/` and exits 1 when the key is unset; an empty value falls through to the default, as in git. The default is `$XDG_CONFIG_HOME/git/ignore` when that variable is set and not empty, else `$HOME/.config/git/ignore` (`homedir()` reads `HOME`), git's own order. A repointed key hashes the new file, so it counts as a change when the content differs (choice 3).
   - **Failure.** When git is missing or the folder is no work tree, `head` is `null` and the hashes are what can be read; it does not matter, because `treeFingerprint` returns its reason first at install (`{ role, unavailable }`) and at hand-back (`ORCH_HANDBACK_SPLIT_UNVERIFIED`), before the anchor is compared.
   - Sizes: `excludesFilePath` 5 lines, `treeAnchor` 10.

3. **`buildTree` records the anchor (AC1).** Its two body lines after the guard become:

   ```js
     const anchor = treeAnchor(root);
     const { files, reason } = treeFingerprint(root, anchor.head);
     return files ? { role, ...anchor, files } : { role, unavailable: reason };
   ```

   The record is `{ role, head, ignores: { 'info/exclude', 'core.excludesFile' }, files }`; the `unavailable` record is unchanged (choice 6). 6 lines.

4. **Validation (spec choice 6, AC7).** Below the BUG-092 comment above `isTreeRecord` (`:1199`), insert one comment line and `isAnchored`, and the `files` side of `isTreeRecord` gains `&& isAnchored(tree)`:

   ```js
   // BUG-098: a files record also holds the commit it was taken against and a hash for each out-of-tree ignore file.
   const isAnchored = (tree) => (tree.head === null || (typeof tree.head === 'string' && OBJECT_NAME.test(tree.head)))
     && isPlainObject(tree.ignores) && IGNORE_LABELS.every((label) => typeof tree.ignores[label] === 'string');
   const isTreeRecord = (tree, role) => isPlainObject(tree) && tree.role === role
     && (isPlainObject(tree.files) && Object.values(tree.files).every((h) => typeof h === 'string') && isAnchored(tree))
       !== (typeof tree.unavailable === 'string' && tree.unavailable !== '');
   ```

   A `files` record installed before this fix (no `head`, no `ignores`) is then neither a valid `files` record nor an `unavailable` one, so `splitCheck` halts with BUG-092's `no valid fingerprint` message and `resume` re-dispatches (spec choice 6, Error cases). BUG-092's six malformed-record rows still halt the same way: each breaks the record regardless of the anchor.

5. **The comparison and the message (spec choices 2 and 5, Error cases).** Between `changedPaths` and the BUG-092 comment of `splitCheck`:

   ```js
   // BUG-098: no build role commits or edits an ignore file outside the tree, so a move of either is a crossing on its own.
   function anchorMoves(tree, now, role) {
     const name = (head) => head ?? 'no commit';
     const edited = IGNORE_LABELS.filter((label) => tree.ignores[label] !== now.ignores[label]);
     return [
       ...(tree.head === now.head ? [] : [`${role} moved HEAD from ${name(tree.head)} to ${name(now.head)} during its dispatch`]),
       ...(edited.length === 0 ? [] : [`${role} changed the ignore file ${edited.join(', ')} during its dispatch`]),
     ];
   }
   ```

   In `splitCheck`, the lines from `const now = treeFingerprint(root);` to the final `throw` become:

   ```js
     const anchor = treeAnchor(root);
     const now = treeFingerprint(root, tree.head);
     if (!now.files) throw new Halt('ORCH_HANDBACK_SPLIT_UNVERIFIED', `git cannot list the tree (${now.reason}), so ${role}'s changes cannot be checked against the test surface; resume to re-dispatch it`);
     const crossed = changedPaths(tree.files, now.files).filter((path) => matchesSurface(path, surface) !== (role === 'test-writer'));
     const side = role === 'test-writer' ? 'outside' : 'inside';
     const parts = anchorMoves(tree, anchor, role);
     if (crossed.length > 0) parts.push(`${role} changed ${crossed.join(', ')} during its dispatch, ${side} the test surface ${JSON.stringify(surface)}`);
     if (parts.length === 0) return {};
     throw new Halt('ORCH_HANDBACK_SURFACE_CROSSED', parts.join('; '));
   ```

   - **Order.** The `HEAD` move, then the ignore files (in `IGNORE_LABELS` order), then the crossed paths, joined by `; `, as the spec's Error cases spell it. With only paths crossed, `parts` holds BUG-092's text alone, so its message is byte for byte unchanged and every BUG-092 row still matches.
   - **Moved and moved back** (commit, then `reset --soft` to the recorded commit): `HEAD` equals `tree.head` and the diff against it shows the files, so the check runs as on an unmoved `HEAD` (spec Alternative paths).
   - **No commit at install.** `tree.head` is `null`, so the hand-back lists every tracked file with `ls-files`, a file committed during the dispatch included, and the first commit is a move from `no commit` (AC6).
   - `anchorMoves` 8 lines, `splitCheck` 16, under the 30-line cap.

   Measured on a copy of this branch (HEAD `0e0a1f9`, git 2.43.0) with exactly decisions 1-5: every row of decision 6 passes (decision 9).

6. **The tests (AC1-AC7).** In `tests/scripts/orchestrate.test.js`, inside the BUG-092 block:
   - Directly after `const atCode = …` (`:5680`), exactly:

     ```js
       // BUG-098: what install records beside the files; the system git config may name its own core.excludesFile, so only its shape is pinned here.
       const anchorOf = () => ({
         head: fixtureGit('rev-parse', 'HEAD').stdout.trim(),
         ignores: { 'info/exclude': existsSync(join(root, '.git', 'info', 'exclude')) ? sha('.git/info/exclude') : 'absent', 'core.excludesFile': expect.stringMatching(/^(?:[0-9a-f]{64}|absent)$/) },
       });
     ```

   - The two `[AC6]` rows (AC1): in the first, `toEqual({ role: 'test-writer', files: … })` becomes `toEqual({ role: 'test-writer', ...anchorOf(), files: … })`; in the second, `toEqual({ role: 'code', files: … })` becomes `toEqual({ role: 'code', ...anchorOf(), files: … })`. The `files` maps are unchanged. `core.excludesFile` is pinned by shape here because the fixture's `HOME` is clean but `/etc/gitconfig` or `XDG_CONFIG_HOME` on a developer or CI machine may name a file; the repository-level `[AC5]` row below pins its exact hash.
   - Directly before the comment `  // BUG-099: the fingerprint grows with the work tree, …` (`:5871`), a nested block, exactly:

     ```js
       // BUG-098: the hand-back diffs against the HEAD install recorded, and a moved HEAD or an edited ignore file outside the tree is a crossing.
       describe('HEAD and out-of-tree ignore files recorded at install [BUG-098]', () => {
         const headSha = () => fixtureGit('rev-parse', 'HEAD').stdout.trim();
         const commit = (...args) => expect(fixtureGit('commit', '-q', ...args).status).toBe(0);
         const moved = (role, from, to) => `ORCH_HANDBACK_SURFACE_CROSSED: ${role} moved HEAD from ${from} to ${to} during its dispatch`;
         const crossing = (role, paths) => crossed(role, paths).slice('ORCH_HANDBACK_SURFACE_CROSSED: '.length);
         const ignoreEdited = (role, labels) => `${role} changed the ignore file ${labels} during its dispatch`;
         const excludeWithRule = (rule) => write('.git/info/exclude', `${existsSync(join(root, '.git', 'info', 'exclude')) ? readFileSync(join(root, '.git', 'info', 'exclude'), 'utf8') : ''}${rule}\n`);

         it('[AC2] code committing a new test file halts naming the move and the file, and records nothing', () => {
           atCode();
           const before = headSha();
           write('src/a.js', 'a2\n');
           write('tests/b.test.js');
           fixtureGit('add', 'tests/b.test.js');
           commit('-m', 'sneak');
           const r = handBack('code', codeSay(['src/a.js:M']));
           expect(r.status).toBe(1);
           expect(r.err).toBe(`${moved('code', before, headSha())}; ${crossing('code', 'tests/b.test.js')}`);
           expect(before).toMatch(/^[0-9a-f]{40}$/);
           expect(runFile().handbacks.map((h) => h.role)).toEqual(['spec', 'plan', 'test-writer']);
           expect(runFile().halt.code).toBe('ORCH_HANDBACK_SURFACE_CROSSED');
         });

         it('[AC3] test-writer committing a source change halts naming the move and the file outside the surface', () => {
           atWriter();
           install('test-writer');
           const before = headSha();
           write('tests/a.test.js');
           write('src/a.js', 'a2\n');
           commit('-am', 'sneak');
           const r = handBack('test-writer', writerDone());
           expect(r.status).toBe(1);
           expect(r.err).toBe(`${moved('test-writer', before, headSha())}; ${crossing('test-writer', 'src/a.js')}`);
           expect(runFile().handbacks.map((h) => h.role)).toEqual(['spec', 'plan']);
         });

         it('[AC4] code committing only a file on its own side halts naming the move and no path', () => {
           atCode();
           const before = headSha();
           write('src/a.js', 'a2\n');
           commit('-am', 'own side');
           const r = handBack('code', codeSay(['src/a.js:M']));
           expect(r.status).toBe(1);
           expect(r.err).toBe(moved('code', before, headSha()));
           expect(runFile().handbacks.map((h) => h.role)).toEqual(['spec', 'plan', 'test-writer']);
         });

         it('[AC5] code adding a rule to .git/info/exclude that hides a new test file halts naming info/exclude', () => {
           atCode();
           excludeWithRule('tests/hidden.test.js');
           write('tests/hidden.test.js');
           write('src/a.js', 'a2\n');
           const r = handBack('code', codeSay(['src/a.js:M']));
           expect(r.status).toBe(1);
           expect(r.err).toBe(`ORCH_HANDBACK_SURFACE_CROSSED: ${ignoreEdited('code', 'info/exclude')}`);
         });

         it('[AC5] test-writer editing a repository-level core.excludesFile halts naming core.excludesFile', () => {
           atWriter();
           expect(fixtureGit('config', 'core.excludesFile', join(root, '.git', 'cc-ignore')).status).toBe(0);
           write('.git/cc-ignore', 'coverage/\n');
           install('test-writer');
           expect(runFile().build_tree.ignores['core.excludesFile']).toBe(sha('.git/cc-ignore'));
           write('.git/cc-ignore', 'coverage/\nsrc/hidden.js\n');
           write('src/hidden.js');
           write('tests/a.test.js');
           const r = handBack('test-writer', writerDone());
           expect(r.status).toBe(1);
           expect(r.err).toBe(`ORCH_HANDBACK_SURFACE_CROSSED: ${ignoreEdited('test-writer', 'core.excludesFile')}`);
         });

         it('[AC5] a move, an ignore edit and crossed paths are named in that order', () => {
           atWriter();
           install('test-writer');
           const before = headSha();
           excludeWithRule('src/hidden.js');
           write('src/a.js', 'a2\n');
           commit('-am', 'sneak');
           write('src/new.js');
           const r = handBack('test-writer', writerDone());
           expect(r.err).toBe(`${moved('test-writer', before, headSha())}; ${ignoreEdited('test-writer', 'info/exclude')}; ${crossing('test-writer', 'src/a.js, src/new.js')}`);
         });

         it('[AC6] with no commit at install, a first commit during the dispatch halts naming the move from no commit', () => {
           driveTo('code', { planText: SPLIT, prep: () => { agents(['test-writer']); write('src/a.js', 'a1\n'); fixtureGit('init', '-q'); } });
           install('test-writer');
           expect(runFile().build_tree.head).toBeNull();
           write('tests/a.test.js');
           fixtureGit('add', 'tests/a.test.js');
           commit('-m', 'first');
           const r = handBack('test-writer', writerDone());
           expect(r.status).toBe(1);
           expect(r.err).toBe(moved('test-writer', 'no commit', headSha()));
         });

         it.each([
           ['no head', (run) => { delete run.build_tree.head; }],
           ['no ignores', (run) => { delete run.build_tree.ignores; }],
           ['a head that is no object name', (run) => { run.build_tree.head = 'HEAD'; }],
           ['an ignores record missing a label', (run) => { delete run.build_tree.ignores['core.excludesFile']; }],
         ])('[AC7] a files fingerprint with %s halts unverified, and resume re-dispatches with a full one', (_name, edit) => {
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
           expect(handBack('test-writer', writerDone()).status).toBe(0);
         });

         it('a HEAD moved and moved back is checked as an unmoved one, with BUG-092\'s message', () => {
           atWriter();
           install('test-writer');
           const before = headSha();
           write('tests/a.test.js');
           write('src/a.js', 'a2\n');
           commit('-am', 'sneak');
           expect(fixtureGit('reset', '-q', '--soft', before).status).toBe(0);
           expect(handBack('test-writer', writerDone()).err).toBe(crossed('test-writer', 'src/a.js'));
         });

         it('a recorded commit git cannot diff against halts unverified', () => {
           atWriter();
           install('test-writer');
           patchRun((run) => { run.build_tree.head = '0'.repeat(40); });
           write('tests/a.test.js');
           const r = handBack('test-writer', writerDone());
           expect(r.status).toBe(1);
           expect(r.err).toBe('ORCH_HANDBACK_SPLIT_UNVERIFIED: git cannot list the tree (git cannot list the changed files), so test-writer\'s changes cannot be checked against the test surface; resume to re-dispatch it');
         });
       });
     ```

   13 new tests (the `[AC7]` table has 4 rows). The `[AC5]` `info/exclude` row hides `tests/hidden.test.js` from both fingerprints, so only the hash names the edit, as the spec's Alternative paths say. The `[AC5]` `core.excludesFile` row sets the key at repository level after `atWriter`'s commit and before `install`, so the recorded hash is the fixture's own file on every machine. The `[AC6]` row's fixture has a `git init` and no commit, so `start` and approvals run as on a repository without `HEAD`. The last two rows cover the spec's Alternative path "moved and moved back" and Error case "recorded commit cannot be diffed"; they carry no AC tag because the spec lists no AC for them. `existsSync`, `readFileSync` and `join` are already imported (`:3`, `:5`).

7. **The four `cc-orchestrate` copies (AC9).** In each, the hand-back halts line named above, replace the one occurrence of ``so the owner keeps or reverts them by hand first. It halts `ORCH_HANDBACK_SPLIT_UNVERIFIED` `` with:

   ``so the owner keeps or reverts them by hand first. It halts `ORCH_HANDBACK_SURFACE_CROSSED` too when `HEAD` moved, or `.git/info/exclude` or the `core.excludesFile` file changed, during the dispatch, since no build role commits or edits them; the owner reverts the commit or the edit by hand before `resume`. It halts `ORCH_HANDBACK_SPLIT_UNVERIFIED` ``

   Measured on the copy: the four lines stay byte-identical (sha256 `b369ad742e7c81b83fdf6f522fa78a1b8270b053c12b5507f9fa86812c73b332`), and the two Claude Code copies stay `cmp`-equal as files. BUG-092's four `toContain` strings stay whole.

8. **`tests/installer/commands-parity.test.js` (AC9).** In the `[BUG-092 AC5]` block, directly after ``    expect(text).toContain('; split check: unavailable (<reason>)');`` (`:398`):

   ```js
       // BUG-098: a moved HEAD or an edited out-of-tree ignore file halts the same way.
       expect(text).toContain('It halts `ORCH_HANDBACK_SURFACE_CROSSED` too when `HEAD` moved, or `.git/info/exclude` or the `core.excludesFile` file changed, during the dispatch, since no build role commits or edits them; the owner reverts the commit or the edit by hand before `resume`.');
   ```

   No new row: the four existing rows (one per copy) gain the expectation.

   **README (AC10).** In `README.md:314`, replace the one occurrence of ``past its 8 MiB bound), and `handback` halts `ORCH_HANDBACK_SURFACE_CROSSED`, naming the files, when one on the other role's side of the split changed during the dispatch, whatever `ops.f` lists.`` with:

   ``past its 8 MiB bound), with the commit `HEAD` names and a hash of `.git/info/exclude` and of the `core.excludesFile` file, and `handback`, diffing against that recorded commit, halts `ORCH_HANDBACK_SURFACE_CROSSED`, naming the files, when one on the other role's side of the split changed during the dispatch, whatever `ops.f` lists, or when `HEAD` or either ignore file moved.``

   No other README line changes; the Known-limits line at `:536` stays for the release.

9. **Predictions, measured on a copy of this branch** (`git archive` of HEAD `0e0a1f9` with this repository's `node_modules`, Node v24.22.2, git 2.43.0).
   - Task 1 red, `npx vitest run tests/scripts/orchestrate.test.js -t 'BUG-098|records a fingerprint of the dirty set|records its own fingerprint'`: the full match set is the 13 new tests and the two edited `[AC6]` rows. **Red 14:** the two `[AC6]` rows (no `head`, no `ignores` yet) and 12 new rows. **Green 1:** the "moved and moved back" row (today's `HEAD` read gives the same result after the reset). So **14 failed | 1 passed | 1306 skipped (1321)**.
   - Task 2 green, the same command: **15 passed | 1306 skipped (1321)**. Whole file: **1321 passed (1321)** (1308 today + 13).
   - Task 3 red, `npx vitest run tests/installer/commands-parity.test.js` after decision 8's test edit and before the command edits: **4 failed | 128 passed (132)**, the four `[BUG-092 AC5]` rows. Green after the edits: **132 passed (132)**.

10. **`.gitignore` leaf.** `!/docs/superpowers/plans/2026-11-26-bug098-split-check-fingerprint-diffs-against-the.md` goes directly after the `2026-11-26-bug092-test-surface-split-bypassable-through-the.md` plan leaf (`.gitignore:214`) and before the `2026-11-26-bug099-install-writes-an-unbounded-build-tree.md` plan leaf, the full-path sort order of the block (BUG-042).

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-26-bug098-split-check-fingerprint-diffs-against-the.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file from the approved spec `f361a524…`. No dependency.
- [X] [T-002] `.gitignore`: insert the leaf of plan decision 10 after the `2026-11-26-bug092` plan leaf. Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` (tracked) and `git add -f docs/superpowers/plans/2026-11-26-bug098-split-check-fingerprint-diffs-against-the.md` (new, under the ignored `docs/superpowers/plans/`). Depends on T-002.
- [X] [T-004] Commit: `docs: plan diffing the split check against the HEAD recorded at install [BUG-098]`. Depends on T-003.

---

### Task 1: Split-check tests first (red)

**Files:**
- Test: `tests/scripts/orchestrate.test.js`

- [X] [T-101] `tests/scripts/orchestrate.test.js`: the `anchorOf` helper after `atCode` and the two `[AC6]` expectation edits (plan decision 6). Depends on T-004.
- [X] [T-102] `tests/scripts/orchestrate.test.js`: the nested `describe('HEAD and out-of-tree ignore files recorded at install [BUG-098]')` of plan decision 6, before the BUG-099 comment. Depends on T-101.
- [X] [T-103] Red run: `npx vitest run tests/scripts/orchestrate.test.js -t 'BUG-098|records a fingerprint of the dirty set|records its own fingerprint'`. Its full match set is the 15 tests of plan decision 9. Predicted: **14 failed | 1 passed | 1306 skipped (1321)**, the passing one the "moved and moved back" row. Depends on T-102.

---

### Task 2: The anchor and the comparison (green)

**Files:**
- Modify: `scripts/orchestrate.mjs`

- [X] [T-201] `scripts/orchestrate.mjs`: the `treeFingerprint` edit (plan decision 1), then `IGNORE_LABELS`, `excludesFilePath` and `treeAnchor` above `buildTree` (plan decision 2), then the `buildTree` body (plan decision 3). Depends on T-103.
- [X] [T-202] `scripts/orchestrate.mjs`: `isAnchored` and the `isTreeRecord` edit (plan decision 4), `anchorMoves` above `splitCheck` and the `splitCheck` edit (plan decision 5). Depends on T-201.
- [X] [T-203] Green run: the T-103 command. Predicted: **15 passed | 1306 skipped (1321)**. Then the whole file: `npx vitest run tests/scripts/orchestrate.test.js` (several minutes). Predicted: **1321 passed (1321)**, BUG-092's other rows and BUG-099's bound rows included (AC8). Depends on T-202.

---

### Task 3: The four `cc-orchestrate` copies (red, then green)

**Files:**
- Test: `tests/installer/commands-parity.test.js`
- Modify: `.claude/commands/cc-orchestrate.md`
- Modify: `project-template/.claude/commands/cc-orchestrate.md`
- Modify: `project-template/.agents/skills/cc-orchestrate/SKILL.md`
- Modify: `project-template/.agents/workflows/cc-orchestrate.md`

- [X] [T-301] `tests/installer/commands-parity.test.js`: the comment and `toContain` of plan decision 8 in the `[BUG-092 AC5]` block. Depends on T-203.
- [X] [T-302] Red run: `npx vitest run tests/installer/commands-parity.test.js`. Predicted: **4 failed | 128 passed (132)**. Depends on T-301.
- [X] [T-303] `.claude/commands/cc-orchestrate.md` (Edit tool): the replacement of plan decision 7. Depends on T-302.
- [X] [T-304] `project-template/.claude/commands/cc-orchestrate.md`, `project-template/.agents/skills/cc-orchestrate/SKILL.md` and `project-template/.agents/workflows/cc-orchestrate.md`: the same replacement; then `cmp` of the two Claude Code copies prints nothing, and the `sha256sum` of each copy's halts line (`:37`, `:37`, `:41`, `:40`) prints `b369ad74…` four times. Depends on T-303.
- [X] [T-305] Green run: the T-302 command. Predicted: **132 passed (132)**, the byte-identical mirror row included. Depends on T-304.

---

### Task 4: README

**Files:**
- Modify: `README.md`

- [X] [T-401] `README.md`: the Guard 5 replacement of plan decision 8; `git diff README.md` shows one changed line, `:314`, and the `[BUG-098]` Known-limits line is unchanged. Depends on T-305.

---

### Task 5: Full suite, scope check and commit

**Files:**
- Modify: `docs/superpowers/plans/2026-11-26-bug098-split-check-fingerprint-diffs-against-the.md` (ticks)

- [X] [T-501] Run `npm test` (long: `orchestrate.test.js` alone takes several minutes; run it in the background if the shell times out). Predicted: exit 0, with `tests/scripts/orchestrate.test.js` at **1321 passed** and `tests/installer/commands-parity.test.js` at **132 passed** (AC11). Depends on T-401.
- [X] [T-502] Scope check: `git status --short` lists exactly the eight files of the Global Constraints and this plan; no temporary file is left in the tree. `git diff --stat` shows no change to the BUG-098 spec, the hooks, `install`, `handback`, `resume` or any record. Depends on T-501.
- [X] [T-503] Stage: `git add -u scripts/orchestrate.mjs tests/scripts/orchestrate.test.js tests/installer/commands-parity.test.js .claude/commands/cc-orchestrate.md project-template/.claude/commands/cc-orchestrate.md project-template/.agents/skills/cc-orchestrate/SKILL.md project-template/.agents/workflows/cc-orchestrate.md README.md`. Depends on T-502.
- [X] [T-504] Stage: `git add -u docs/superpowers/plans/2026-11-26-bug098-split-check-fingerprint-diffs-against-the.md` (carries the ticks for T-101 to T-503). Depends on T-503.
- [X] [T-505] Commit: `fix: diff the split check against the HEAD recorded at install and halt on a moved HEAD or ignore file [BUG-098]`. Depends on T-504.

---

## Test List

- [X] [T-601] `tests/scripts/orchestrate.test.js` (Task 1), AC1: the two BUG-092 `[AC6]` rows extended with `head` and `ignores` through `anchorOf`.
- [X] [T-602] `tests/scripts/orchestrate.test.js` (Task 1), AC2-AC4: `code` committing a new test file (move and file), `test-writer` committing a source change (move and file), `code` committing only its own side (move alone).
- [X] [T-603] `tests/scripts/orchestrate.test.js` (Task 1), AC5: `.git/info/exclude` hiding a new test file, a repository-level `core.excludesFile` edited, and the three-part message order.
- [X] [T-604] `tests/scripts/orchestrate.test.js` (Task 1), AC6: no commit at install (`head: null`), a first commit during the dispatch.
- [X] [T-605] `tests/scripts/orchestrate.test.js` (Task 1), AC7: the four-row table of `files` records without a valid anchor, each followed by `resume` and a recorded hand-back; plus the two untagged rows (moved and moved back; a recorded commit git cannot diff against).
- [X] [T-606] `tests/scripts/orchestrate.test.js` (Task 2), AC8: BUG-092's other rows and BUG-099's bound rows unchanged and green in the whole-file run.
- [X] [T-607] `tests/installer/commands-parity.test.js` (Task 3), AC9: the four `[BUG-092 AC5]` rows with the new expectation, and the byte-identical mirror row.
- [X] [T-608] AC10 has no test row: no test reads the README sentence (T-401 checks it by diff). AC11: `npm test` (T-501). No E2E/UI test: there is no UI.

## Commit Order

1. Task 0 (T-004): this plan and its `.gitignore` leaf, committed by the runner at the end of the plan session.
2. Task 5 (T-505): the tests, the script, the four command copies, the README and the plan ticks for T-101 to T-503, in one commit, so no commit has a red suite. The red runs (T-103, T-302) happen in the working tree before each fix. The ticks for T-504, T-505 and the Test List ride the closeout commit.

## Identified Risks

- **A machine whose git config names a global ignore file.** `/etc/gitconfig` or `XDG_CONFIG_HOME` may point `core.excludesFile` at a real file on a developer or CI machine. It is constant during a test, so no row halts because of it, and the `[AC6]` rows pin its hash by shape only (plan decision 6); the repository-level row pins the exact hash.
- **A relative `core.excludesFile`.** git opens it relative to the work tree's top, the router resolves it against the project root; they differ only when the project root is a subfolder of the repository and the value is relative. The same path is hashed at install and at hand-back, so an edit of that path is still caught; an edit of git's file in that one layout is not. Acceptable for an S item; not covered by a test.
- **The test command editing the global ignore file legitimately.** No task does (spec choice 3), so a halt there is a real event the owner reviews; the message names `core.excludesFile`, not the user's path.
- **An install recorded by an earlier version mid-dispatch** halts `ORCH_HANDBACK_SPLIT_UNVERIFIED` once (spec choice 6); `resume` and a re-install record a full one. The `[AC7]` rows exercise that recovery.
- **The `[AC6]` row with no commit.** `start` and the approvals run in a repository without `HEAD`; measured green on the copy, so a red there in the build means the fixture, not the script, changed.
- **Run-file size.** `head` and `ignores` add under 250 bytes to `build_tree`; BUG-099's rows keep 8 KiB of room, measured green on the copy.
- **The long suite timing out the shell.** T-203 and T-501 note the duration; a timeout is not a red.
