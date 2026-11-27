# BUG-097 Tree fingerprint follows symlinks and opens non-regular files during hand-back: implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** `treeFingerprint` and `treeAnchor` stop reading their paths with `readFileSync`. A bounded reader records a symlink in the tree by the sha256 of its target string (`symlink:<hex>`), a directory, FIFO, socket or device by a fixed marker naming its type (`special:<type>`), a regular file over 64 MiB by its size and modification time (`large:<size>:<mtimeNs>`), and every other regular file by the bare sha256 of its bytes as today, read in 64 KiB chunks through a descriptor opened with `O_NOFOLLOW | O_NONBLOCK` and checked again with `fstat`. A path under a directory that is a link is `absent`. The two out-of-tree ignore files of BUG-098 use the same reader with their links followed.

**Spec:** `docs/superpowers/specs/2026-11-26-bug097-tree-fingerprint-follows-symlinks-and-opens-non-design.md` (sha256 `49f238398c7190b29d5318329fc7550c547fc3a26974fa218e2d3956134daf9c`), approved by independent review (round 2). Issue #337, follow-up of BUG-092.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>` and `-t '<pattern>'`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines stay untouched. The release rewrites them.
- **Three files change, plus this plan and its `.gitignore` leaf:** `scripts/orchestrate.mjs`, `tests/scripts/orchestrate.test.js`, `tools/skip-baseline.json`, and nothing else (the spec's System Impact list).
- Not touched: `splitCheck`, `isTreeRecord`, `changedPaths`, `buildTree`, `changeList`, every halt code and message, `.claude/hooks/` and its mirror, the installer, the SNAP contract, settings, the agent profiles, the four `/cc-orchestrate` copies, README, wiki, `.github/workflows/`, `.github/actions/`, dependencies. No network is added: the change replaces one read with `lstat`, `readlink`, `open`, `fstat` and `read` calls on the same paths.
- Every file this plan edits after Task 0 is already tracked (`git ls-files --error-unmatch` on the three paths) and none sits under an ignored directory, so each is staged with `git add -u <path>`. This plan is new in Task 0 under the ignored `docs/superpowers/plans/` (so `git add -f`) and is tracked and re-included by its leaf afterwards (so `git add -u`).
- `scripts/orchestrate.mjs` keeps `readFileSync` in its import: the run file, the reports, the plan and `CLAUDE.md` still use it (spec Out of Scope).

## Files read in full (spec, Files Requiring Full Read)

Read on this branch, HEAD `18a0d33` on top of `main` @ `010f8f2`:

- `scripts/orchestrate.mjs` (2007 lines): the `node:fs` import (`:6`, one line: `existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync`; `createHash` `:8`, `homedir` `:9`, `join` and `resolve` `:10` are already imported); `ROUTER_DIR` and `nulPaths` (`:726-727`); `changeList` (`:733-750`, lists paths and reads none); `isRouterFile` and `contentHash` (`:754-755`); `treeFingerprint` (`:757-770`), whose only `contentHash` call is `:769`; `IGNORE_LABELS`, `excludesFilePath` and `treeAnchor` (`:772-793`), whose two `contentHash` calls are `:788` and `:791`; `buildTree` (`:795-801`); `splitCheck` (`:1244-1260`, calls `treeAnchor` `:1250` and `treeFingerprint` `:1251`). Grep finds no other caller of `contentHash` and no existing `constants`, `HASH_CAP`, `statSync`, `lstatSync` or `boundedHash` name in the file.
- `tests/scripts/orchestrate.test.js` (6121 lines): the `node:fs` import (`:3`, holds `readFileSync`, `rmSync`, `statSync`, `writeFileSync` and `mkdirSync`, not `readlinkSync`, `symlinkSync`, `truncateSync` or `utimesSync`), `spawnSync` (`:2`) and `createHash` (`:7`); the `cleanGitEnv` import (`:10`); `root` and `home`, two fresh `realpathSync`'d temp folders per test (`:30-35`); `orch` (`:44`, `spawnSync` with `timeout: 30000`); `fixtureGit` (`:53`), `fixtureCommit`, `runFile`, `sha` (`:65`). The BUG-092 block `describe('test-surface split at hand-back [BUG-092]'` (`:5656`): `write`, `patchRun`, `writerSay`, `codeSay`, `writerDone`, `atWriter` (base commit with `.gitignore` = `coverage/`, `src/a.js`, `src/base.js`, plus what its `base` callback writes), `install`, `handBack`, `crossed`, `atCode`, `anchorOf` (`:5657-5685`); the nested BUG-098 block (`:5876-6011`), whose `[AC5]` row sets a repository-level `core.excludesFile` with `fixtureGit('config', …)`; the BUG-099 comment line (`:6013`) and its nested block (`:6014-6092`). The `[AC10]` source check (`:1326-1333`) is the pattern AC9's row follows. `vitest.config.js` sets `testTimeout: 30000`.
- `tests/helpers/can-symlink.js`: `CAN_SYMLINK`, a probe that makes one file symlink in a temp folder. `tests/installer/deploy.test.js:664` builds `POSIX_SYMLINK = process.platform !== 'win32' && CAN_SYMLINK` from it.
- `tools/skip-baseline.json` and `tools/skip-baseline.mjs`: three legs (`ci-node20`, `ci-node24`, `ci-windows-node24`), each a sorted list of `<file> > <describe titles and test name joined by spaces>`; the gate compares sets, so a new skip missing from a leg's list fails it. No `orchestrate.test.js` identity is listed today. `deploy.test.js:258` (`skipIf(!CAN_SYMLINK)` alone) is in no leg, so `CAN_SYMLINK` is true on all three CI legs, Windows included; only the `process.platform !== 'win32'` rows skip on `ci-windows-node24`.

## Plan decisions

1. **The reader (spec choices 1-4).** In `scripts/orchestrate.mjs`, replace the `contentHash` line (`:755`) with a blank line followed by exactly:

   ```js
   // BUG-097: a regular file over this many bytes is recorded by its size and mtime, unread.
   const HASH_CAP = 64 * 1024 * 1024;
   // BUG-097: O_NONBLOCK makes a FIFO swapped in after the lstat open at once; O_NOFOLLOW makes a swapped-in link fail. 0 where undefined (Windows).
   const OPEN_FOLLOW = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0);
   const OPEN_NOFOLLOW = OPEN_FOLLOW | (constants.O_NOFOLLOW ?? 0);
   const specialType = (st) => (st.isDirectory() ? 'directory' : st.isFIFO() ? 'fifo' : st.isSocket() ? 'socket'
     : st.isCharacterDevice() ? 'char-device' : st.isBlockDevice() ? 'block-device' : 'other');
   const largeValue = (st) => `large:${st.size}:${st.mtimeNs}`;

   // BUG-097: the sha256 of an open regular file, read in 64 KiB chunks and never past the cap, even if it grows meanwhile.
   function descriptorHash(fd) {
     const st = fstatSync(fd, { bigint: true });
     if (!st.isFile()) return `special:${specialType(st)}`;
     if (st.size > HASH_CAP) return largeValue(st);
     const hash = createHash('sha256');
     const chunk = Buffer.allocUnsafe(64 * 1024);
     let total = 0;
     for (let n = readSync(fd, chunk, 0, chunk.length, null); n > 0; n = readSync(fd, chunk, 0, chunk.length, null)) {
       total += n;
       if (total > HASH_CAP) return largeValue(fstatSync(fd, { bigint: true }));
       hash.update(chunk.subarray(0, n));
     }
     return hash.digest('hex');
   }

   // BUG-097: one fingerprint value; follow is true only for the ignore files, whose links git itself follows.
   function boundedHash(abs, follow) {
     let fd;
     try {
       const st = follow ? statSync(abs, { bigint: true }) : lstatSync(abs, { bigint: true });
       if (st.isSymbolicLink()) return `symlink:${createHash('sha256').update(readlinkSync(abs, { encoding: 'buffer' })).digest('hex')}`;
       if (!st.isFile()) return `special:${specialType(st)}`;
       if (st.size > HASH_CAP) return largeValue(st);
       fd = openSync(abs, follow ? OPEN_FOLLOW : OPEN_NOFOLLOW);
       return descriptorHash(fd);
     } catch {
       return 'absent';
     } finally {
       if (fd !== undefined) try { closeSync(fd); } catch { /* the value is already decided */ }
     }
   }

   // BUG-097: each directory between root and path must be a real directory, or lstat would follow a linked parent out of the tree.
   function parentsReal(root, path, cache) {
     const parts = path.split('/').slice(0, -1);
     for (let i = 1; i <= parts.length; i++) {
       const dir = parts.slice(0, i).join('/');
       if (!cache.has(dir)) cache.set(dir, isRealDirectory(join(root, dir)));
       if (!cache.get(dir)) return false;
     }
     return true;
   }
   const isRealDirectory = (abs) => { try { return lstatSync(abs).isDirectory(); } catch { return false; } };
   ```

   - **Values.** A regular file under the cap keeps the bare 64-hex sha256 it has today, so every BUG-092, BUG-098 and BUG-099 row that pins one is unchanged (spec choice 1, AC6). `symlink:` hashes the link's raw target bytes (`encoding: 'buffer'`), so a target that is not valid UTF-8 still hashes exactly and no target path is stored. With `bigint: true`, `size` and `mtimeNs` are `BigInt`s; `st.size > HASH_CAP` compares a `BigInt` with a number correctly, and the template prints both in decimal.
   - **The window (spec choice 3).** `lstat` decides first; the open then repeats the guard (`O_NOFOLLOW` fails on a link swapped in: `ELOOP`, so `absent`; `O_NONBLOCK` returns at once on a FIFO swapped in, and `fstat` then says `special:fifo` with nothing read). Both flags are `0` on Windows, where `fs.constants` does not define them; `O_RDONLY` is `0` everywhere.
   - **The cap (spec choice 2).** Over the cap by `lstat` or by `fstat`: unread. A file that grows past the cap while it is read stops after the first chunk past it and is judged by `fstat` at that moment. Memory is one 64 KiB buffer.
   - **Descriptor.** Closed in `finally` on every path once opened; a failing `closeSync` cannot replace the decided value.
   - **Ignore files (spec choice 4).** `follow: true` uses `stat` and opens without `O_NOFOLLOW`, so a linked `~/.config/git/ignore` is hashed by its target's content; a device or FIFO there is `special:<type>`, unread; a dangling link makes `stat` fail: `absent`, as today.
   - **Parents (spec choice 6).** git paths use `/` on every platform. For `a/b/c`, `a` and `a/b` are each `lstat`ed once per fingerprint (the `Map` lives in one `treeFingerprint` call); the root itself is never checked, so a project under a linked folder (macOS `/tmp`) works as today. A nested repository git lists as `sub/` splits into `['sub', '']`, so only `sub` is checked, and the path itself is `special:directory`.
   - Sizes: `descriptorHash` 13 lines, `boundedHash` 16, `parentsReal` 9, each under the 30-line cap.

2. **The import (System Impact).** Line `:6` becomes, on one line as today:

   ```js
   import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
   ```

3. **The two call sites (spec Solution, choice 4).**
   - In `treeFingerprint`, the last line (`:769`, `return { files: Object.fromEntries(paths.map((path) => [path, contentHash(join(root, path))])) };`) becomes:

     ```js
       // BUG-097: no value is read through a link: a path under a linked directory is absent, and a link is its target string.
       const parents = new Map();
       const value = (path) => (parentsReal(root, path, parents) ? boundedHash(join(root, path), false) : 'absent');
       return { files: Object.fromEntries(paths.map((path) => [path, value(path)])) };
     ```

     `treeFingerprint` grows to 14 body lines.
   - In `treeAnchor`, `contentHash(resolve(root, exclude.stdout.trim()))` (`:788`) becomes `boundedHash(resolve(root, exclude.stdout.trim()), true)` and `contentHash(excludesFilePath(root, git))` (`:791`) becomes `boundedHash(excludesFilePath(root, git), true)`. The ignore files skip the parent check: they are not tree paths (spec choice 6).
   - After the edit, `grep -n contentHash scripts/orchestrate.mjs` prints nothing.

4. **The tests (AC1-AC9).** In `tests/scripts/orchestrate.test.js`:
   - The `node:fs` import (`:3`) gains `readlinkSync`, `symlinkSync`, `truncateSync` and `utimesSync`, kept in its order:

     ```js
     import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, truncateSync, utimesSync, writeFileSync } from 'node:fs';
     ```

   - Directly above `import { cleanGitEnv } from '../helpers/git-env.js';` (`:10`), insert `import { CAN_SYMLINK } from '../helpers/can-symlink.js';`.
   - Inside the BUG-092 block, directly above the BUG-099 comment line (`  // BUG-099: the fingerprint grows with the work tree, …`, `:6013`), insert exactly this block followed by one blank line:

     ```js
       // BUG-097: a link is recorded by its target string and a non-regular file by its type, neither opened; a file over the cap by size and mtime.
       describe('links and non-regular files in the fingerprint [BUG-097]', () => {
         const POSIX_SYMLINK = process.platform !== 'win32' && CAN_SYMLINK;
         // The target string as the platform reads it back, since Windows may spell an absolute target its own way.
         const linkValue = (rel) => `symlink:${createHash('sha256').update(readlinkSync(join(root, rel))).digest('hex')}`;
         const mkfifo = (abs) => expect(spawnSync('mkfifo', [abs]).status).toBe(0);
         const toFifo = (rel) => { rmSync(join(root, rel)); mkfifo(join(root, rel)); };
         const outside = (name, text) => { const abs = join(home, name); writeFileSync(abs, text); return abs; };

         it.skipIf(!CAN_SYMLINK)('[AC1] an untracked link to a file outside the project is recorded by its target string, and an edit of that file is no change', () => {
           atWriter();
           const target = outside('outside.txt', 'secret\n');
           symlinkSync(target, join(root, 'src', 'out-link'));
           install('test-writer');
           const { files } = runFile().build_tree;
           expect(files['src/out-link']).toBe(linkValue('src/out-link'));
           expect(Object.values(files)).not.toContain(createHash('sha256').update('secret\n').digest('hex'));
           writeFileSync(target, 'changed\n');
           write('tests/a.test.js');
           expect(handBack('test-writer', writerDone()).status).toBe(0);
         });

         it.skipIf(!CAN_SYMLINK)('[AC1] repointing an untracked link outside the test surface halts naming it', () => {
           atWriter();
           symlinkSync(outside('one.txt', '1\n'), join(root, 'src', 'out-link'));
           install('test-writer');
           rmSync(join(root, 'src', 'out-link'));
           symlinkSync(outside('two.txt', '1\n'), join(root, 'src', 'out-link'));
           write('tests/a.test.js');
           expect(handBack('test-writer', writerDone()).err).toBe(crossed('test-writer', 'src/out-link'));
         });

         it.skipIf(!POSIX_SYMLINK)('[AC2] an untracked link to /dev/zero is recorded by its target string, and install and handback return', () => {
           atWriter();
           mkdirSync(join(root, 'tests'), { recursive: true });
           symlinkSync('/dev/zero', join(root, 'tests', 'zero'));
           install('test-writer');
           expect(runFile().build_tree.files['tests/zero']).toBe(linkValue('tests/zero'));
           write('tests/a.test.js');
           expect(handBack('test-writer', writerDone()).status).toBe(0);
         });

         it.skipIf(!POSIX_SYMLINK)('[AC3] a link to a FIFO and a tracked file replaced by a FIFO are recorded unopened, and install code and handback code return', () => {
           atWriter({ base: () => write('src/stream', 's\n') });
           install('test-writer');
           write('tests/a.test.js');
           expect(handBack('test-writer', writerDone()).status).toBe(0);
           const pipe = join(home, 'pipe');
           mkfifo(pipe);
           symlinkSync(pipe, join(root, 'src', 'pipe-link'));
           toFifo('src/stream');
           install('code');
           expect(runFile().build_tree.files).toMatchObject({ 'src/pipe-link': linkValue('src/pipe-link'), 'src/stream': 'special:fifo' });
           write('src/a.js', 'a2\n');
           expect(handBack('code', codeSay(['src/a.js:M'])).status).toBe(0);
         });

         it.skipIf(!POSIX_SYMLINK)('[AC4] a FIFO and a link outside the test surface left unchanged during test-writer do not halt', () => {
           atWriter({ base: () => write('src/stream', 's\n') });
           toFifo('src/stream');
           symlinkSync('a.js', join(root, 'src', 'link'));
           install('test-writer');
           write('tests/a.test.js');
           expect(handBack('test-writer', writerDone()).status).toBe(0);
         });

         it.skipIf(!POSIX_SYMLINK)('[AC4] a FIFO and a link outside the test surface created during test-writer halt naming both', () => {
           atWriter({ base: () => write('src/stream', 's\n') });
           install('test-writer');
           toFifo('src/stream');
           symlinkSync('a.js', join(root, 'src', 'link'));
           write('tests/a.test.js');
           const r = handBack('test-writer', writerDone());
           expect(r.status).toBe(1);
           expect(r.err).toBe(crossed('test-writer', 'src/link, src/stream'));
         });

         it('[AC5] a regular file over 64 MiB is recorded by its size and mtime, and a new mtime counts as a change', () => {
           atWriter();
           const big = join(root, 'src', 'big.bin');
           writeFileSync(big, '');
           truncateSync(big, 64 * 1024 * 1024 + 1);
           utimesSync(big, 1700000000, 1700000000);
           install('test-writer');
           const st = statSync(big, { bigint: true });
           expect(runFile().build_tree.files['src/big.bin']).toBe(`large:${st.size}:${st.mtimeNs}`);
           utimesSync(big, 1700000100, 1700000100);
           write('tests/a.test.js');
           expect(handBack('test-writer', writerDone()).err).toBe(crossed('test-writer', 'src/big.bin'));
         });

         it.skipIf(!POSIX_SYMLINK)('[AC7] a tracked directory replaced by a link elsewhere records its file as absent and the link by its target string', () => {
           atWriter({ base: () => write('lib/b.js', 'b1\n') });
           const elsewhere = join(home, 'elsewhere');
           mkdirSync(elsewhere);
           writeFileSync(join(elsewhere, 'b.js'), 'outside\n');
           rmSync(join(root, 'lib'), { recursive: true });
           symlinkSync(elsewhere, join(root, 'lib'));
           install('test-writer');
           const { files } = runFile().build_tree;
           expect(files).toMatchObject({ lib: linkValue('lib'), 'lib/b.js': 'absent' });
           expect(Object.values(files)).not.toContain(createHash('sha256').update('outside\n').digest('hex'));
         });

         it.skipIf(!CAN_SYMLINK)('[AC8] a symlinked core.excludesFile is hashed by its target, so an edit of the target halts naming core.excludesFile', () => {
           atWriter();
           const target = outside('ignore-target', 'coverage/\n');
           symlinkSync(target, join(root, '.git', 'cc-ignore'));
           expect(fixtureGit('config', 'core.excludesFile', join(root, '.git', 'cc-ignore')).status).toBe(0);
           install('test-writer');
           expect(runFile().build_tree.ignores['core.excludesFile']).toBe(createHash('sha256').update('coverage/\n').digest('hex'));
           writeFileSync(target, 'coverage/\nsrc/hidden.js\n');
           write('src/hidden.js');
           write('tests/a.test.js');
           expect(handBack('test-writer', writerDone()).err).toBe('ORCH_HANDBACK_SURFACE_CROSSED: test-writer changed the ignore file core.excludesFile during its dispatch');
         });

         it('[AC9] reads no fingerprinted path and no ignore file with readFileSync', () => {
           const src = readFileSync(SCRIPT, 'utf8');
           expect(src).not.toMatch(/\bcontentHash\b/);
           for (const name of ['treeFingerprint', 'treeAnchor', 'boundedHash', 'descriptorHash']) {
             const start = src.indexOf(`function ${name}(`);
             expect(start).toBeGreaterThan(-1);
             expect(src.slice(start, src.indexOf('\n}\n', start))).not.toContain('readFileSync');
           }
         });
       });
     ```

   - **What each row pins.** AC1: the link value, no hash of the outside file anywhere in `files`, an edit of the target is no change, a repoint is (spec Alternative paths). AC2 and AC3: `install` and `handback` return inside the 30 s spawn and test timeouts, with the values the spec's Main path names (`tests/zero` is inside the surface for the test-writer side, `src/pipe-link` and `src/stream` on the code side). AC4: the FIFO and the link outside the surface, unchanged (no halt) and created during the dispatch (BUG-092's message, paths sorted). AC5: `large:` with the `lstat` size and `mtimeNs`, and a new `mtime` halts. AC7: the parent check (`lib/b.js` absent) and the untracked link `lib` (git lists it without a trailing `/`). AC8: the follow mode of the ignore files. AC9: the source check. AC6 is the existing rows, which pin bare sha256 values and must pass unchanged (decision 6).
   - **Platforms.** `CAN_SYMLINK` is true on every CI leg (Files read in full), so the AC1 and AC8 rows run on Windows too; `linkValue` reads the target back with `readlinkSync` because Windows may return an absolute target in its own spelling. AC2, AC3, AC4 and AC7 need `/dev/zero`, `mkfifo` or a directory link and are `POSIX_SYMLINK` rows. AC5 and AC9 run everywhere.
   - The four hanging rows (AC2, AC3, both AC4) pass no `timeout` of their own: today's code makes them fail at vitest's 30 s `testTimeout` (or the 30 s spawn timeout), which is the red the spec asks for.

5. **The skip baseline (AC10).** In `tools/skip-baseline.json`, in the `ci-windows-node24` list, between the `tests/scripts/handoff-cycle.test.js > …` line and the first `tests/scripts/release.test.js > …` line (keeping the list sorted), insert these five lines, each with its trailing comma:

   ```json
       "tests/scripts/orchestrate.test.js > test-surface split at hand-back [BUG-092] links and non-regular files in the fingerprint [BUG-097] [AC2] an untracked link to /dev/zero is recorded by its target string, and install and handback return",
       "tests/scripts/orchestrate.test.js > test-surface split at hand-back [BUG-092] links and non-regular files in the fingerprint [BUG-097] [AC3] a link to a FIFO and a tracked file replaced by a FIFO are recorded unopened, and install code and handback code return",
       "tests/scripts/orchestrate.test.js > test-surface split at hand-back [BUG-092] links and non-regular files in the fingerprint [BUG-097] [AC4] a FIFO and a link outside the test surface created during test-writer halt naming both",
       "tests/scripts/orchestrate.test.js > test-surface split at hand-back [BUG-092] links and non-regular files in the fingerprint [BUG-097] [AC4] a FIFO and a link outside the test surface left unchanged during test-writer do not halt",
       "tests/scripts/orchestrate.test.js > test-surface split at hand-back [BUG-092] links and non-regular files in the fingerprint [BUG-097] [AC7] a tracked directory replaced by a link elsewhere records its file as absent and the link by its target string",
   ```

   The Linux legs `ci-node20` and `ci-node24` skip none of the new rows (POSIX, `CAN_SYMLINK` true, `mkfifo` present), so their lists are unchanged. The identity is `<file> > <describe titles and test name joined by spaces>`, as the existing `release.test.js … [BUG-090] [AC7] …` line shows. The skip gate itself runs only in CI (`--env`), which this sandbox cannot reach; the plan checks the JSON parses and the five names match the test titles byte for byte (T-302).

6. **Measured.** On a scratch copy of this branch (HEAD `18a0d33`, git 2.43.0, Node 24.22.2, Linux) with exactly decisions 1-4:
   - before decisions 1-3 (tests only): `npx vitest run tests/scripts/orchestrate.test.js -t 'BUG-097'` read **9 failed | 1 passed | 1321 skipped (1331)**. The passing row is AC8 (today's `readFileSync` already follows the ignore-file link; the row guards the follow mode). AC2, AC3 and both AC4 rows failed by the 30 s spawn timeout (`ETIMEDOUT`), AC1, AC5, AC7 and AC9 by their assertions;
   - after decisions 1-3: the same command read **10 passed | 1321 skipped (1331)**, and the whole file read **1331 passed (1331)**.

7. **This plan's `.gitignore` leaf (BUG-042).** In the tracked-surface block, directly after `!/docs/superpowers/plans/2026-11-26-bug092-test-surface-split-bypassable-through-the.md` and before the `2026-11-26-bug098` plan leaf:

   ```
   !/docs/superpowers/plans/2026-11-26-bug097-tree-fingerprint-follows-symlinks-and-opens-non.md
   ```

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-26-bug097-tree-fingerprint-follows-symlinks-and-opens-non.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file from the approved spec `49f23839…`. No dependency.
- [X] [T-002] `.gitignore`: insert the leaf of plan decision 7 after the `2026-11-26-bug092` plan leaf. Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` (tracked) and `git add -f docs/superpowers/plans/2026-11-26-bug097-tree-fingerprint-follows-symlinks-and-opens-non.md` (new, under the ignored `docs/superpowers/plans/`). Depends on T-002.
- [X] [T-004] Commit: `docs: plan the bounded tree-fingerprint reader for links and non-regular files [BUG-097]`. Depends on T-003.

### Task 1: Fingerprint tests first (red)

**Files:**
- Test: `tests/scripts/orchestrate.test.js`

- [X] [T-101] `tests/scripts/orchestrate.test.js`: the `node:fs` import edit and the `CAN_SYMLINK` import of plan decision 4. Depends on T-004.
- [X] [T-102] `tests/scripts/orchestrate.test.js`: the nested `describe('links and non-regular files in the fingerprint [BUG-097]')` of plan decision 4, above the BUG-099 comment. Depends on T-101.
- [X] [T-103] Red run: `npx vitest run tests/scripts/orchestrate.test.js -t 'BUG-097'`. Its full match set is the 10 rows of plan decision 4 and nothing else. Predicted: **9 failed | 1 passed | 1321 skipped (1331)**, the passing one AC8; four rows fail by timeout, so the run takes about two minutes. Depends on T-102.

### Task 2: The bounded reader (green)

**Files:**
- Modify: `scripts/orchestrate.mjs`

- [X] [T-201] `scripts/orchestrate.mjs`: the import of plan decision 2, then the `contentHash` replacement of plan decision 1. Depends on T-103.
- [X] [T-202] `scripts/orchestrate.mjs`: the `treeFingerprint` and `treeAnchor` call sites of plan decision 3; `grep -n contentHash scripts/orchestrate.mjs` prints nothing and `node --check scripts/orchestrate.mjs` exits 0. Depends on T-201.
- [X] [T-203] Green run: the T-103 command. Predicted: **10 passed | 1321 skipped (1331)**. Then the whole file: `npx vitest run tests/scripts/orchestrate.test.js` (several minutes). Predicted: **1331 passed (1331)**, every BUG-092, BUG-098 and BUG-099 row included (AC6). Depends on T-202.

### Task 3: The skip baseline

**Files:**
- Modify: `tools/skip-baseline.json`

- [X] [T-301] `tools/skip-baseline.json`: the five `ci-windows-node24` lines of plan decision 5. Depends on T-203.
- [X] [T-302] Check: `node -e` that parses the file, that `ci-windows-node24` has 32 entries (27 + 5) with no duplicate and still sorted, and that each of the five names, after its `tests/scripts/orchestrate.test.js > test-surface split at hand-back [BUG-092] links and non-regular files in the fingerprint [BUG-097] ` prefix, is a title string in `tests/scripts/orchestrate.test.js`. Then `npx vitest run tests/tools/skip-baseline.test.js`: all pass. Depends on T-301.

### Task 4: Full suite, scope check and commit

**Files:**
- Modify: `docs/superpowers/plans/2026-11-26-bug097-tree-fingerprint-follows-symlinks-and-opens-non.md` (checkboxes only)

- [X] [T-401] Run `npm test` (long: `orchestrate.test.js` alone takes several minutes; run it in the background if the shell times out). Predicted: exit 0, with `tests/scripts/orchestrate.test.js` at **1331 passed** (AC11). Depends on T-302.
- [X] [T-402] Scope check: `git status --short` lists exactly the three files of the Global Constraints and this plan; no temporary file is left in the tree. `git diff --stat` shows no change to the BUG-097 spec, the hooks, `splitCheck`, `buildTree` or any record. Depends on T-401.
- [X] [T-403] Stage: `git add -u scripts/orchestrate.mjs tests/scripts/orchestrate.test.js tools/skip-baseline.json`. Depends on T-402.
- [X] [T-404] Stage: `git add -u docs/superpowers/plans/2026-11-26-bug097-tree-fingerprint-follows-symlinks-and-opens-non.md` (carries the ticks for T-101 to T-403). Depends on T-403.
- [X] [T-405] Commit: `fix: fingerprint links by target and non-regular files by type, and cap the bytes read [BUG-097]`. Depends on T-404.

## Test List

- [X] [T-501] `tests/scripts/orchestrate.test.js` (Task 1), AC1: an untracked link to an outside file recorded as `symlink:`, an edit of the target no change, a repoint a crossing.
- [X] [T-502] `tests/scripts/orchestrate.test.js` (Task 1), AC2 and AC3: a link to `/dev/zero`, a link to a FIFO and a tracked file replaced by a FIFO, with `install` and `handback` returning (POSIX).
- [X] [T-503] `tests/scripts/orchestrate.test.js` (Task 1), AC4: a FIFO and a link outside the surface, left unchanged and created during `test-writer` (POSIX).
- [X] [T-504] `tests/scripts/orchestrate.test.js` (Task 1), AC5: a sparse file over 64 MiB recorded as `large:`, a new `mtime` a crossing.
- [X] [T-505] `tests/scripts/orchestrate.test.js` (Task 1), AC7: a tracked directory replaced by a link (POSIX); AC8: a symlinked `core.excludesFile`; AC9: the source check.
- [X] [T-506] `tests/scripts/orchestrate.test.js` (Task 2), AC6: every existing BUG-092, BUG-098 and BUG-099 row unchanged and green in the whole-file run.
- [X] [T-507] `tools/skip-baseline.json` (Task 3), AC10: checked by T-302 here and by the CI skip gate on `ci-windows-node24`. AC11: `npm test` (T-401). No E2E/UI test: there is no UI.

## Commit Order

1. Task 0: this plan and its `.gitignore` leaf (`docs:`), made by the runner at the end of the plan session.
2. Tasks 1-4: one `fix:` commit, T-405, holding the three files and the ticked plan. The red state of Task 1 is never committed on its own: the tests and the reader land together, so no commit on the branch has a failing suite.

## Identified Risks

- **A hang in git, not in the reader.** The spec measured that `git diff --name-only` lists a tracked file replaced by a FIFO without opening it, and that `ls-files --others` never lists an untracked FIFO. The AC3 and AC4 rows exercise both on the real `install` and `handback` paths; a hang there would show as a 30 s timeout in T-203, pointing at a git call, not at the reader. Measured green on the scratch copy (decision 6). A FIFO as an ignore file is out of scope (spec choice 7).
- **Windows.** `CAN_SYMLINK` is true on `ci-windows-node24`, so AC1 and AC8 run there; `readlinkSync` may spell an absolute target differently from the string passed to `symlinkSync`, which is why `linkValue` reads it back instead of hashing the literal. If a CAN_SYMLINK row still fails only on Windows, the fix is in the row's expectation, not a new skip (a new skip would also need a baseline line). The O_* flags are `0` there and `lstat` alone guards (spec Alternative paths).
- **The skip gate cannot run here.** It needs CI's `--env` report. T-302 checks the five identities against the test titles and the sorted order; a typo in a title would show as one `added` and one `removed` identity on the Windows leg only.
- **Red-run cost.** Four red rows wait for the 30 s timeout. The Task 1 red run is about two minutes; under a shell timeout, run it in the background.
- **A run upgraded mid-dispatch.** A `build_tree` installed by the previous version records a link by its target's hash and a directory as `absent`; the new hand-back value differs and, on the other side of the split, halts `ORCH_HANDBACK_SURFACE_CROSSED` once, as the spec accepts (Alternative paths). No test pins it; no code handles it.
- **`BigInt` values.** `size` and `mtimeNs` come from `{ bigint: true }` stats; mixing them in arithmetic with a number would throw, so the code only compares (`>`) and prints them. AC5 pins the printed form against the test's own `statSync(…, { bigint: true })`.
