# BUG-089 Known-failure entries that cannot match everything, and no known failure in a changed file: implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** `start` refuses a `--known-failure` value shorter than 12 code points once trimmed, or made of a single word of letters, digits, `_` and `-`; `install qa`, in a run that declares known failures, writes the change's created and modified files against the recorded base to `.conductor/handback/qa-change.txt` and prints one `change files:` line; `qa` never counts a failing test in a listed file as known, and `code` never counts one in a file it created or edited in its task; both take a failing test's file only from the runner's output and compare paths by one fixed rule. No gate, router position or SNAP field changes.

**Spec:** `docs/superpowers/specs/2026-11-23-bug089-known-failure-substring-matching-lets-generic-design.md` (sha256 `b95a6543d40094be2060884525c30074214520a9bf640df0afbe517872bbcbf5`). Issue #284, follow-up of BUG-074.

**Approval:** the spec and the plan need an owner approval, not a delegated one (spec, line 7): the change edits control-plane files (`.claude/agents/code.md`, `.claude/agents/qa.md`, `.claude/commands/cc-orchestrate.md`, `scripts/orchestrate.mjs`) and changes what the Verify gate accepts as green.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>` and `-t '<pattern>'`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines (the `[BUG-089]` line at `README.md:500` included) stay untouched.
- **Eleven files change, plus this plan and its `.gitignore` leaf:** `scripts/orchestrate.mjs`, `tests/scripts/orchestrate.test.js`, `.claude/agents/code.md`, `.claude/agents/qa.md`, their two `project-template/.claude/agents/` copies, `tests/unit/role-profiles.test.js`, `.claude/commands/cc-orchestrate.md`, `project-template/.claude/commands/cc-orchestrate.md`, `tests/installer/commands-parity.test.js`, `README.md` (the `/cc-orchestrate` command row, `:262`, only). That is the spec's System Impact list.
- Not touched (AC7-AC9): `.claude/agents/plan.md` and its copy, `isValidRun`, `isKnownFailureList`, `MAY_HAND_BACK`, `nextStep`, `envelopeFields`, `scripts/snap-contract.mjs`, `scripts/security-scan.mjs`, the hooks, the installer, settings, workflows, dependencies, and every profile other than `code` and `qa` (AC10).
- Every file this plan edits after Task 0 is already tracked and none sits under an ignored directory, so each is staged with `git add -u <path>`. This plan is new in Task 0 under the ignored `docs/superpowers/plans/` (so `git add -f`) and is tracked and re-included by its leaf afterwards (so `git add -u`).
- `.claude/` is read-only for Bash in the build sandbox: every edit under `.claude/` uses the Edit tool. The `project-template/` copies may use either.

## Files read in full (spec, Files Requiring Full Read)

- `scripts/orchestrate.mjs` (1735 lines): `HANDBACK_DIR` (`:99`); `isPlainObject` (`:176`); `OBJECT_NAME` (`:166`); `writeAtomic` (`:190-195`); `isSecurity` accepts `base: null` (`:205`); `isKnownFailureList` (`:228`) and its `isValidRun` conjunct (`:241`), both unchanged; `resolveSecurity` records `base` from `headObject` at `start` (`:539-547`); `gitValue` (`:568-571`) is the spawn pattern (`spawnSync('git', args, { cwd: root, encoding: 'utf8' })`, status checked); `envelopeFields` (`:590-609`) is not touched, so the qa envelope stays byte-identical (AC9); `install` (`:641-658`) builds `out` as the envelope, then the fix note, then `model: <alias>`, returns early on `check` before any write; `baseScan` (`:905-919`) is the scan's own git use of `security.base`. `START_USAGE` (`:1484`), the comment block (`:1486-1491`), `KNOWN_FAILURE_MAX` and `isKnownFailureArg` (`:1492-1494`), `parseStartArgs` (`:1495-1513`, the `--known-failure` branch at `:1505`); `start` clears an earlier run's files through `clearRunFiles` when the old run belongs to another session (`:1537`); `clearRunFiles` (`:1559-1564`) removes `HANDBACK_DIR`, and `end` (`:1579-1590`) calls it, so the list goes with the folder and no new removal code is needed (AC5). `scripts/security-scan.mjs` lists untracked files with `git ls-files --others --exclude-standard -z` (`:99`) and changed ones with `git diff --name-only --relative -z <base>` (`:163`); the new helper uses the same two calls, with `--name-status --no-renames` on the diff.
- `tests/scripts/orchestrate.test.js` (5072 lines): `START_USAGE` (`:20`) is unchanged by this item; helpers `orch` (`:43`), `fixtureGit` / `fixtureCommit` (`:51-55`), `runFile` (`:56`), `runFileText` (`:59`), `envelopeText` (`:60`), `installedRepo` (`:112-117`, commits the tree and points `script` at `.claude/scripts/orchestrate.mjs`), `driveTo` (`:120-138`: with `role` `'qa'`, `seat` is true, so it runs `installedRepo()`, then `prep()`, then `start`, so a `prep` that commits again moves the recorded base), `RUN_OK` (`:3382`). `approveArgs` writes the spec fixture `docs/specs/demo-design.md` after `start` (`:65-72`), so every qa fixture's change list holds `A docs/specs/demo-design.md`. Every existing `install qa` call (`:217`, `:1483`, `:1500`, `:1677`, `:1837`, `:2227`, `:2418`, `:2430`, `:2525`, `:3532`, `:3837`, `:4699`) is in a run without `--known-failure`, so its output is unchanged; `:3532` asserts that `model: haiku` is the last line, which the placement in plan decision 3 keeps for every run. The BUG-074 block is `:4799-4890`; its accepted values `'a'`, `'b'` (`:4818-4822`) and `'a'.repeat(200)` (`:4855-4859`) fail the new rule, and its duplicate row (`:4848`) uses `'a'`.
- `tests/unit/role-profiles.test.js` (380 lines): `GREEN` and `KNOWN_MATCH` (`:122-124`); the BUG-074 block (`:198-226`) pins `KNOWN_MATCH` in `code` and `qa`, which stays; the `[AC5]` row forbids any other gate's name in a profile; `[AC3]` caps each profile at 999 tokens (`:168`); `PROFILE_SHA256_1_37_0` (`:229-245`), `code` at `:237`, `qa` at `:242`.
- `tests/installer/commands-parity.test.js`: `ORCH_MIRRORS` (`:197`), the byte-identical row, and the BUG-074 row (`:342-368`) whose phrases all survive the edits below; `describe('cc-orchestrate mirrors [FEAT-011 AC10]')` closes at `:369`.
- `.claude/commands/cc-orchestrate.md` (mirror byte-identical): the `--known-failure` bullet of the Start step (`:63`), the Verify step (`:90`) with its BUG-074 sentence ``When the run file's `known_failures` is non-empty, take from `.conductor/handback/qa.txt` …``.

## Owner decisions (plan review)

The owner reviewed the first version of this plan and asked for these changes, which the plan below already carries:

1. **Test count.** N1-N12 as first written were 24 tests, not 25. N12 is split into two tests: N12a `'[AC8] a run file holding a short entry still validates'` (`isValidRun` only, green today) and N12b `'[AC8] such a run installs qa with the list'` (red today). That makes 25 tests, so the Task 1 prediction of **18 failed | 7 passed** and the full-file count of **1207** hold as written (plan decisions 7 and 11).
2. **Wording.** In `FILE_RULE` and `PATH_MATCH`, "is red" becomes "is never known"; in `QA_NAMED`, "but is red because" becomes "but is not known because" (plan decision 4). The `[AC6]` qa test title in plan decision 5 follows the same wording.
3. **Position suffix.** `FILE_RULE` also says that a `:line` or `:line:column` suffix after the printed path is not part of the path (plan decision 4).
4. **Hashes.** The bytes, tokens and sha256 of decision 4's table are re-measured after these edits. The pins that quote the sentences follow: plan decision 5 takes its five constants and both `PROFILE_SHA256_1_37_0` rows from decision 4 as amended. Plan decision 10 quotes only command and README text, none of which these edits change, so its expected strings stay as written.

Everything else stands as first proposed, including `changeList`, `changeNote`, the `change files:` line placed before `model:`, and the single build commit.

## Plan decisions

1. **The `start` rule (AC1, AC2).** Above `KNOWN_FAILURE_MAX` (`scripts/orchestrate.mjs:1492`), after the BUG-074 comment lines:

   ```js
   // BUG-089: a value under 12 code points once trimmed, or one word of letters, digits, _ and -, is contained in
   // almost every failure line a runner prints, so it is a usage error too. \p{L} and \p{N} make a non-ASCII word one word.
   const KNOWN_FAILURE_MIN = 12;
   const ONE_WORD = /^[\p{L}\p{N}_-]+$/u;
   const isSpecificEntry = (value) => [...value.trim()].length >= KNOWN_FAILURE_MIN && !ONE_WORD.test(value.trim());
   ```

   and `isKnownFailureArg`'s second line ends `&& !seen.includes(value) && isSpecificEntry(value);`. The `typeof` conjunct comes first, so `isSpecificEntry` never sees a missing value. The 200 ceiling stays counted on the value as given. `parseStartArgs`, `START_USAGE` and `isKnownFailureList` do not change: a refused value reaches the existing `throw new Refusal(START_USAGE)`, exit 2, before anything is written. Measured with Node v24.22.2: `tests/a.spec` is 12 code points and not one word; `tests/ab.js` is 11; `autenticación` (13), `autenticación_de_usuarios` (25), `AssertionError` (14) and `проверка_доступа` (16) all match `ONE_WORD`.

2. **The change list (AC4, AC5).** Next to `HANDBACK_DIR` (`:99`):

   ```js
   // BUG-089: the files the change created or modified, written by install qa in a run that declares known failures.
   const CHANGE_LIST_FILE = `${HANDBACK_DIR}/qa-change.txt`;
   ```

   Directly above `install` (`:640`, after `dispatchModel`), two functions:

   ```js
   // BUG-089: the files the change created (A) or modified (M) against the base start recorded, sorted by path.
   // --no-renames makes a rename a delete plus a create; a deleted file holds no test that can fail, so it is left out.
   function changeList(root, security) {
     if (!isPlainObject(security)) return { reason: 'the run has no security record (started before FEAT-034)' };
     if (security.base === null) return { reason: 'the run recorded no base commit' };
     const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30 });
     const diff = git(['diff', '--name-status', '--no-renames', '--relative', '-z', security.base]);
     const others = git(['ls-files', '--others', '--exclude-standard', '-z']);
     if (diff.status !== 0 || others.status !== 0) return { reason: 'git cannot compare the work tree with the base commit' };
     const status = new Map();
     const fields = diff.stdout.split('\0');
     for (let i = 0; i + 1 < fields.length; i += 2) if (fields[i] !== 'D') status.set(fields[i + 1], fields[i] === 'A' ? 'A' : 'M');
     for (const path of others.stdout.split('\0').filter(Boolean)) status.set(path, 'A');
     return { lines: [...status.keys()].sort().map((path) => `${status.get(path)} ${path}`) };
   }

   // BUG-089: every install qa rewrites the list, and removes it when it cannot be computed, so qa never reads an older one.
   function changeNote(root, run, check) {
     if (!Array.isArray(run.known_failures) || run.known_failures.length === 0) return '';
     const { lines, reason } = changeList(root, run.security);
     if (!check && lines) writeAtomic(join(root, CHANGE_LIST_FILE), lines.map((line) => `${line}\n`).join(''));
     if (!check && !lines) rmSync(join(root, CHANGE_LIST_FILE), { force: true });
     if (!lines) return `\nchange files: unavailable (${reason}); no failing test is known`;
     const created = lines.filter((line) => line.startsWith('A ')).length;
     return `\nchange files: ${created} created, ${lines.length - created} modified (${CHANGE_LIST_FILE})`;
   }
   ```

   `-z` output is read as is, so a path with a space or a non-ASCII character is listed verbatim. A status other than `A` or `D` (`M`, `T`, `U`) is listed as `M`. A missing git binary gives `status: null`, so it is the unavailable path, like a base git cannot read. Measured in a scratch repository: a modified, a `git mv`-renamed, a deleted, an untracked `tests/a b.test.js` and an ignored file give exactly `A tests/a b.test.js`, `M tests/kept.test.js`, `A tests/new.test.js`, and `git diff` on an unknown 40-hex base exits 128.

3. **`install` (AC4, AC5, AC9).** One new line after `const model = dispatchModel(run, step);`: `const change = role === 'qa' ? changeNote(root, run, check) : '';`, and `out` becomes ``built.out.trim() + (step.fix === undefined ? '' : `\n${fixNote(run)}`) + change + (model ? `\nmodel: ${model}` : '')``. The line sits before `model:` so that `model: <alias>` stays the last line of every dispatch, as the command says (`cc-orchestrate.md:90`) and `:3532` asserts. `changeNote` writes nothing under `--check` (AC4) and returns `''` with empty or absent `known_failures`, so such a run's `install qa` is byte-identical to today's (AC5). `install` grows from 18 to 19 lines. The envelope bytes come from `built.out`, which `changeNote` does not touch (AC9).

4. **The profile text (AC6, AC7, AC10).** Five sentences, word for word (`\` is one backslash in the Markdown; in a JS single-quoted string it is written `\\`):

   - `FILE_RULE` (both): ``Take a failing test's file only from the runner's output, the path printed on its line or on the file header above it, never from a search with Read, Grep or Glob; a `:line` or `:line:column` suffix after the printed path is not part of the path, and a failing test whose file the output does not print is never known.``
   - `PATH_MATCH` (both): ``Two paths match when, after every `\` is turned into `/`, they are equal or one ends with `/` followed by the other; a failing test whose file this rule cannot settle is never known.``
   - `QA_LIST` (qa): ``A failing test whose file matches a path `.conductor/handback/qa-change.txt` lists (`A <path>` created, `M <path>` modified by the change) is never known, even when its line contains a declared entry; if that file is absent or unreadable, no failing test is known.``
   - `QA_NAMED` (qa): ``Also name each failing test that matched a declared entry but is not known because that list names its file.``
   - `CODE_LIST` (code): ``A failing test whose file matches a file you created or edited in this task is never known, even when its line contains a declared entry.``

   Each profile gets exactly one replacement on its Success-condition line (line 21); nothing else changes, and `KNOWN_MATCH` and `GREEN` stay byte-identical (AC7):

   - **`qa.md`:** `<KNOWN_MATCH> Report its exact exit status and summary line and, when the exit status is non-zero, each failing test with the entry it matched.` → `<KNOWN_MATCH> <QA_LIST> <FILE_RULE> <PATH_MATCH> Report its exact exit status and summary line and, when the exit status is non-zero, each failing test with the entry it matched. <QA_NAMED>`
   - **`code.md`:** `<KNOWN_MATCH> When the exit status is non-zero,` → `<KNOWN_MATCH> <CODE_LIST> <FILE_RULE> <PATH_MATCH> When the exit status is non-zero,`

   **Measured on this branch** (HEAD `6c3e2c3`; both profiles are unchanged since `ed81cfd`) by applying exactly these replacements, with the sentences as amended by the owner decisions below, to copies in tmp:

   | Profile | Bytes before → after | Tokens (`ceil(bytes / 4)`) | New sha256 |
   |---|---|---|---|
   | `code.md` | 2751 → 3391 | 848 | `497513adb7e3c6c6458b808b49114018b6724c735f0e82db3435306fb2815253` |
   | `qa.md` | 2588 → 3464 | 866 | `1bcbbaf0d42e5abd8c3b22ae0729118e8d948b3f07127bad1e5c990fca595af0` |

   Both stay under 999 tokens (AC10). Neither new sentence names a gate, so the `[AC5]` rows stay green; every `D5` phrase and the BUG-074 pins survive. A hash that differs after the edit means the edit differs from this decision: fix the edit, not the pin.

5. **`tests/unit/role-profiles.test.js` (AC6, AC7, AC10).** After `KNOWN_MATCH` (`:124`), the comment `// BUG-089: a failing test in a file the change touched is never known, and its file comes only from the runner's output.` and the five constants of decision 4. A new `describe('known failures in changed files [BUG-089]', …)` after the BUG-074 block (`:226`), 7 tests:
   - `it.each([TEMPLATE, MIRROR].flatMap((dir) => ['code', 'qa'].map((role) => [`${dir}/${role}.md`])))('[AC6] %s takes a failing test\'s file only from the runner output and matches paths by one rule', …)`: `read(rel)` contains `FILE_RULE` and `PATH_MATCH`. 4 rows.
   - `'[AC6] qa never knows a failing test in a file qa-change.txt lists, knows none without it, and names each one it does not know'`: `profile('qa')` contains `QA_LIST` and `QA_NAMED`.
   - `'[AC6] code never knows a failing test in a file it created or edited in its task'`: `profile('code')` contains `CODE_LIST`.
   - `'[AC7] plan carries neither rule'`: `profile('plan')` contains neither `FILE_RULE` nor `PATH_MATCH`.
   - `PROFILE_SHA256_1_37_0`: the `code` row takes decision 4's hash under a new comment line after the BUG-074 one, `// BUG-089 changed code on purpose: a failing test in a file code created or edited is never known, and its file comes only from the runner's output.`; the `qa` row likewise, `// BUG-089 changed qa on purpose: a failing test in a file qa-change.txt lists is never known, and its file comes only from the runner's output.` Every other row is unchanged (AC10).

6. **`tests/scripts/orchestrate.test.js`, the BUG-074 rows (AC2).** Only the accepted values that the new rule refuses change; each assertion keeps its shape:
   - `:4818-4822`: `'a'` and `'b'` become `'tests/a.test.js'` and `'tests/b.test.js'`; the echo check becomes `'; known failures: 2 ["tests/a.test.js","tests/b.test.js"]'`.
   - `:4855-4859` (`'[AC6] a value of exactly 200 characters is accepted'`): `'a'.repeat(200)` becomes `` `${'a'.repeat(99)} ${'b'.repeat(100)}` `` (200 code points with a space).
   - `:4848`, the repeat refusal: `['--known-failure', 'a', '--known-failure', 'a']` becomes `['--known-failure', 'tests/a.test.js', '--known-failure', 'tests/a.test.js']`, so the row still refuses because of the repeat and not because of the new floor. The other refusal rows, `'a'.repeat(201)` included, stay as they are and keep refusing.
   - The `isValidRun` rows (`['a', KF]`) stay: the run file's validation does not change (AC8).

7. **`tests/scripts/orchestrate.test.js`, the new block (AC1, AC2, AC4, AC5, AC8, AC9).** Appended at the end of the file, `describe('known failures in changed files [BUG-089]', …)`, with:

   ```js
   const KF = 'tests/contract/x.test.js > isolated store';
   const LIST = '.conductor/handback/qa-change.txt';
   const listText = () => readFileSync(join(root, LIST), 'utf8');
   // The base commit holds three tests and an ignore file that keeps the router's own files out of the list.
   const QA_RUN = { start: ['--known-failure', KF], prep: () => {
     writeFileSync(join(root, '.gitignore'), '.conductor/\n.claude/memory/\nignored.txt\n');
     mkdirSync(join(root, 'tests'), { recursive: true });
     for (const name of ['old', 'kept', 'gone']) writeFileSync(join(root, 'tests', `${name}.test.js`), 'x\n');
     fixtureCommit();
   } };
   const SPEC_ONLY = 'A docs/specs/demo-design.md\n';
   ```

   Rows (25 tests):
   - **N1** `it.each(['a', 'FAIL', 'tests/ab.js', '   tests/a.js   ', 'AssertionError', 'authentication_tests_for_the_store', 'autenticación', 'autenticación_de_usuarios'])('[AC1] start refuses the generic entry %j with START_USAGE, exit 2, writing nothing', …)`: `orch(['start', 'FEAT-011', '--known-failure', value])` matches `{ status: 2, err: START_USAGE }`; no run file. 8 rows.
   - **N2** `it.each(['tests/a.spec', 'tests/a.test.js', 'suite > title', `${'a'.repeat(99)} ${'b'.repeat(100)}`])('[AC2] start accepts, records and echoes %j byte for byte', …)`: status 0; `runFile().known_failures` equals `[value]`; `r.out.endsWith(`; known failures: 1 ${JSON.stringify([value])}`)`. 4 rows.
   - **N3** `'[AC4] install qa lists created, modified, renamed and untracked files, sorted, leaving out deleted and ignored ones'`: `driveTo('qa', QA_RUN)`; then `writeFileSync(join(root, 'tests/kept.test.js'), 'y\n')`, `fixtureGit('mv', 'tests/old.test.js', 'tests/new.test.js')`, `rmSync(join(root, 'tests/gone.test.js'))`, `writeFileSync(join(root, 'tests/a b.test.js'), 'z\n')`, `writeFileSync(join(root, 'ignored.txt'), 'i\n')`; `orch(['install', 'qa'])` status 0; its last line is `'change files: 3 created, 1 modified (.conductor/handback/qa-change.txt)'`; `listText()` is `'A docs/specs/demo-design.md\nA tests/a b.test.js\nM tests/kept.test.js\nA tests/new.test.js\n'`.
   - **N4** `'[AC4] install qa --check prints the change line and writes nothing'`: `driveTo('qa', QA_RUN)`; `orch(['install', 'qa', '--check'])` status 0, last line `'change files: 1 created, 0 modified (.conductor/handback/qa-change.txt)'`; `existsSync(join(root, LIST))` is false.
   - **N5** `'[AC4] a second install qa overwrites the list with the current work tree'`: `driveTo('qa', QA_RUN)`; write `tests/first.test.js`; `install qa` status 0; `listText()` contains `'A tests/first.test.js\n'`; remove it, write `tests/second.test.js`; `install qa` status 0; `listText()` is `` `${SPEC_ONLY}A tests/second.test.js\n` ``.
   - **N6** `'[AC4] a second install qa that finds the list unavailable removes the earlier file'`: `driveTo('qa', QA_RUN)`; `install qa`; the list exists; `runFileText(JSON.stringify({ ...runFile(), security: { ...runFile().security, base: null } }))`; `install qa` status 0, last line `'change files: unavailable (the run recorded no base commit); no failing test is known'`; the list does not exist.
   - **N7** `'[AC5] install qa without known failures writes no list and prints what it printed before'`: `driveTo('qa')`; `r = orch(['install', 'qa'])` status 0; `r.out` does not contain `'change files'` and equals `envelopeText().trim()`; the list does not exist.
   - **N8** `it.each([['a null base', (run) => ({ ...run, security: { ...run.security, base: null } }), 'the run recorded no base commit'], ['no security record', ({ security, ...run }) => run, 'the run has no security record (started before FEAT-034)'], ['a base git cannot read', (run) => ({ ...run, security: { ...run.security, base: '0'.repeat(40) } }), 'git cannot compare the work tree with the base commit']])('[AC5] with %s, install qa writes no list and says no failing test is known', …)`: `driveTo('qa', QA_RUN)`; `runFileText(JSON.stringify(edit(runFile())))`; `install qa` status 0, last line `` `change files: unavailable (${reason}); no failing test is known` ``; the list does not exist. 3 rows.
   - **N9** `'[AC5] end --abandon removes the list with the hand-back folder'`: `driveTo('qa', QA_RUN)`; `install qa`; the list exists; `orch(['end', '--abandon'])` status 0; the list does not exist.
   - **N10** `'[AC5] start over a previous run removes the list'`: `driveTo('qa', QA_RUN)`; `install qa`; the list exists; `orch(['start', 'FEAT-011'], { sid: 'sess-2' })` status 0; the list does not exist.
   - **N11** `'[AC9] the qa envelope is the one install printed, with no change list in it'`: `driveTo('qa', QA_RUN)`; `r = orch(['install', 'qa'])`; `r.out.startsWith(envelopeText().trim())` is true and `envelopeText()` does not contain `'qa-change'`.
   - **N12a** `'[AC8] a run file holding a short entry still validates'`: `isValidRun({ ...RUN_OK, known_failures: ['a'] })` is true (green today: `isValidRun` does not change).
   - **N12b** `'[AC8] such a run installs qa with the list'`: `driveTo('qa', QA_RUN)`; `runFileText(JSON.stringify({ ...runFile(), known_failures: ['a'] }))`; `install qa` status 0, last line `'change files: 1 created, 0 modified (.conductor/handback/qa-change.txt)'`; `listText()` is `SPEC_ONLY`.

   "Last line" is `r.out.split('\n').at(-1)`: none of these fixtures configures role models, so no `model:` line follows. Every qa fixture's list holds `A docs/specs/demo-design.md`, the spec fixture `approveArgs` writes after `start`; `.conductor/` and `.claude/memory/` are ignored by `QA_RUN`'s `.gitignore`, so the run file, the envelope and the hand-back reports are not listed. If a measured list holds another router-written path, the fixture is wrong, not the script: add that path to `QA_RUN`'s `.gitignore`.

8. **`.claude/commands/cc-orchestrate.md` and its `project-template` copy (AC3, and the qa step's mention of the list).** Both files get identical edits (the parity row keeps them byte-identical):
   - **Start step, the `--known-failure` bullet (`:63`):** after its last sentence, ``A value split on an unquoted space refuses with the usage line and writes nothing; ask the owner to quote it.``, append:
     ```text
      A value must be at least 12 characters once trimmed and more than one word: it holds a character other than a letter, a digit, `_` or `-`, such as a space, `/`, `.`, `:` or `>` (BUG-089). `start` refuses a shorter or one-word value with the usage line and writes nothing. That refusal is the owner's to fix: name the rule and ask them for a longer, more specific value; never lengthen or edit one yourself.
     ```
   - **Verify step (`:90`):** before ``When the run file's `known_failures` is non-empty, take from `.conductor/handback/qa.txt` …`` insert:
     ```text
     When the run file's `known_failures` is non-empty, `install qa` prints, before any `model:` line, `change files: <a> created, <m> modified (.conductor/handback/qa-change.txt)`, the files the change created or modified against the base commit `start` recorded, or `change files: unavailable (<reason>); no failing test is known`; `qa` counts no failing test in a listed file as known, and none at all when the list is unavailable (BUG-089). Never write or edit `.conductor/handback/qa-change.txt` yourself: only `install qa` writes it. 
     ```
     (the trailing space separates it from the BUG-074 sentence that follows).

9. **`README.md:262`, the `/cc-orchestrate` row (AC3).** After ``as in `--known-failure 'tests/x.test.js > suite > title'`.`` insert `` A value must be at least 12 characters and more than one word, or `start` refuses it.`` The usage cell and the Known-limits line `:500` are not touched.

10. **`tests/installer/commands-parity.test.js` (AC3).** A new row at the end of `describe('cc-orchestrate mirrors [FEAT-011 AC10]')`, after the BUG-074 row and before the closing `});` at `:369`: `'states the known-failure value rule and the qa change list [BUG-089]'`. On `read(ORCH_MIRRORS[0])` it expects:
    - `'A value must be at least 12 characters once trimmed and more than one word'`
    - ``"That refusal is the owner's to fix: name the rule and ask them for a longer, more specific value; never lengthen or edit one yourself."``
    - `'change files: <a> created, <m> modified (.conductor/handback/qa-change.txt)'`
    - `'change files: unavailable (<reason>); no failing test is known'`
    - ``'Never write or edit `.conductor/handback/qa-change.txt` yourself: only `install qa` writes it.'``

    On `read('README.md')` it expects `` 'A value must be at least 12 characters and more than one word, or `start` refuses it.' ``. The byte-identical mirror row covers the copy.

11. **Red predictions, reasoned against the current code.**
    - Task 1 (orchestrate tests before the script change): with `-t 'BUG-089'`, **red** the eight N1 rows (every value is accepted today), N3, N4, N5, N6, the three N8 rows (no `change files:` line, no list), N9, N10 (they assert the list exists first) and N12b (no list): 18. **Green** the four N2 rows (accepted today), N7 (no line, no list today), N11 (the envelope is unchanged) and N12a (`isValidRun` is unchanged): 7. With `-t 'BUG-074'`, the 25 BUG-074 tests stay green: their new values pass both the old and the new rule.
    - Task 3 (role-profile tests before the profile edits): **red** the four `[AC6]` rule rows, the qa row and the code row: 6. **Green** the `[AC7]` plan row and every existing row, the sha rows included (they are edited after the profiles, T-306).
    - Task 4 (parity row before the command edits): **red** the new row only.

12. **`.gitignore` leaf.** `!/docs/superpowers/plans/2026-11-23-bug089-known-failure-substring-matching-lets-generic.md` goes directly after the `2026-11-22-feat035` plan leaf (`.gitignore:201`) and before the `2026-11-23-feat030` plan leaf, the full-path sort order of the block (BUG-042).

## Baseline (measured on this branch, HEAD ed81cfd, Node v24.22.2)

- `npx vitest run tests/unit/role-profiles.test.js`: **173 passed (173)**.
- `npx vitest run tests/installer/commands-parity.test.js`: **103 passed (103)**.
- `npx vitest run tests/scripts/orchestrate.test.js`: **1182 passed (1182)**.
- No existing test title contains `BUG-089` (`grep -c BUG-089` on the three test files is 0), so `-t 'BUG-089'` selects only the new rows.

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-23-bug089-known-failure-substring-matching-lets-generic.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file from the approved spec `b95a6543…`. No dependency.
- [X] [T-002] `.gitignore`: insert the leaf of plan decision 12 after the `2026-11-22-feat035` plan leaf. Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` (tracked) and `git add -f docs/superpowers/plans/2026-11-23-bug089-known-failure-substring-matching-lets-generic.md` (new, under the ignored `docs/superpowers/plans/`). Depends on T-002.
- [X] [T-004] Commit: `docs: plan specific known-failure entries and no known failure in a changed file [BUG-089]`. Depends on T-003.

---

### Task 1: Start-rule and change-list tests first (red)

**Files:**
- Test: `tests/scripts/orchestrate.test.js`

- [X] [T-101] `tests/scripts/orchestrate.test.js`: the three BUG-074 value changes of plan decision 6. Depends on T-004.
- [X] [T-102] `tests/scripts/orchestrate.test.js`: append `describe('known failures in changed files [BUG-089]')` with its constants and rows N1-N12 (N12 as N12a and N12b; plan decision 7). Depends on T-101.
- [X] [T-103] Run: `npx vitest run tests/scripts/orchestrate.test.js -t 'BUG-074'`. Predicted: **25 passed** of the 25, every other test of the file skipped. Depends on T-102.
- [X] [T-104] Red run: `npx vitest run tests/scripts/orchestrate.test.js -t 'BUG-089'`. Its full match set is the 25 new tests. Predicted: **18 failed | 7 passed** of the 25, every other test of the file skipped (plan decision 11). Any other split means a test is wrong: fix the test, not the prediction. Depends on T-103.

---

### Task 2: The `start` rule and the change list (green)

**Files:**
- Modify: `scripts/orchestrate.mjs`

- [X] [T-201] `scripts/orchestrate.mjs`: the BUG-089 comment, `KNOWN_FAILURE_MIN`, `ONE_WORD` and `isSpecificEntry` above `KNOWN_FAILURE_MAX`, and the `isSpecificEntry(value)` conjunct in `isKnownFailureArg` (plan decision 1). Depends on T-104.
- [X] [T-202] `scripts/orchestrate.mjs`: `CHANGE_LIST_FILE` next to `HANDBACK_DIR`, and `changeList` and `changeNote` above `install` (plan decision 2). Depends on T-201.
- [X] [T-203] `scripts/orchestrate.mjs`, `install`: the `change` line and the new `out` (plan decision 3). Depends on T-202.
- [X] [T-204] Green run: the T-104 command. Predicted: **25 passed** of the 25. Depends on T-203.
- [X] [T-205] Run the whole file: `npx vitest run tests/scripts/orchestrate.test.js` (several minutes). Predicted: **1207 passed (1207)**, the 25 BUG-074 tests, every existing `install qa` caller and the last-line `model:` check (`:3532`) included, all of them in runs without known failures. Depends on T-204.

---

### Task 3: The file rule in the `code` and `qa` profiles (red, then green)

**Files:**
- Modify: `.claude/agents/code.md`
- Modify: `.claude/agents/qa.md`
- Modify: `project-template/.claude/agents/code.md`
- Modify: `project-template/.claude/agents/qa.md`
- Test: `tests/unit/role-profiles.test.js`

- [X] [T-301] `tests/unit/role-profiles.test.js`: the BUG-089 comment and five constants after `KNOWN_MATCH`, and `describe('known failures in changed files [BUG-089]')` (plan decision 5). Do not touch the sha rows yet. Depends on T-205.
- [X] [T-302] Red run: `npx vitest run tests/unit/role-profiles.test.js`. Predicted: **6 failed | 174 passed (180)** (173 + 7 new; red as in plan decision 11). Depends on T-301.
- [X] [T-303] `.claude/agents/qa.md` (Edit tool): the qa replacement of decision 4. Depends on T-302.
- [X] [T-304] `.claude/agents/code.md` (Edit tool): the code replacement of decision 4. Depends on T-303.
- [X] [T-305] `project-template/.claude/agents/{code,qa}.md`: the same edits; then `cmp` each pair prints nothing and `sha256sum` of each prints the hash of decision 4's table. A different hash means the edit differs from decision 4: fix the edit. Depends on T-304.
- [X] [T-306] `tests/unit/role-profiles.test.js`, `PROFILE_SHA256_1_37_0`: the two BUG-089 comment lines and the new `code` and `qa` hashes (plan decision 5). Depends on T-305.
- [X] [T-307] Green run: the T-302 command. Predicted: **180 passed (180)**, the token cap, mirror, `D5`, `[AC5]`, BUG-074 and both directories' hash rows included. Depends on T-306.

---

### Task 4: The orchestrator command and README (red, then green)

**Files:**
- Modify: `.claude/commands/cc-orchestrate.md`
- Modify: `project-template/.claude/commands/cc-orchestrate.md`
- Modify: `README.md`
- Test: `tests/installer/commands-parity.test.js`

- [X] [T-401] `tests/installer/commands-parity.test.js`: the new row of plan decision 10. Depends on T-307.
- [X] [T-402] Red run: `npx vitest run tests/installer/commands-parity.test.js`. Predicted: **1 failed | 103 passed (104)**, the new row red. Depends on T-401.
- [X] [T-403] `.claude/commands/cc-orchestrate.md` (Edit tool): the Start-bullet sentence and the Verify-step sentences of plan decision 8. Depends on T-402.
- [X] [T-404] `project-template/.claude/commands/cc-orchestrate.md`: the same edits; then `cmp` of the two copies prints nothing. Depends on T-403.
- [X] [T-405] `README.md:262`: the sentence of plan decision 9. Depends on T-404.
- [X] [T-406] Green run: the T-402 command. Predicted: **104 passed (104)**, the byte-identical mirror row and the BUG-074 row included. Depends on T-405.

---

### Task 5: Full suite, scope check and commit

**Files:**
- Modify: `docs/superpowers/plans/2026-11-23-bug089-known-failure-substring-matching-lets-generic.md` (ticks)

- [X] [T-501] Run `npm test` (long: `orchestrate.test.js` alone takes several minutes; run it in the background if the shell times out). Predicted: exit 0 (AC10), with `tests/scripts/orchestrate.test.js` at **1207 passed** (1182 + 25), `tests/unit/role-profiles.test.js` at 180 and `tests/installer/commands-parity.test.js` at 104. A red is called ENV only if the sandbox caused it (network, tmp permissions) and its file is not one this plan touches; report it with its name. Any other red is fixed. Depends on T-406.
- [X] [T-502] Scope check: `git status --short` lists exactly the eleven files of the Global Constraints and this plan; no temporary file is left in the tree. `git diff --stat` shows no change to the spec, `plan.md` or its copy, `scripts/snap-contract.mjs`, `scripts/security-scan.mjs`, any hook, or `README.md` outside line 262. Depends on T-501.
- [X] [T-503] Stage: `git add -u scripts/orchestrate.mjs tests/scripts/orchestrate.test.js .claude/agents/code.md .claude/agents/qa.md project-template/.claude/agents/code.md project-template/.claude/agents/qa.md tests/unit/role-profiles.test.js .claude/commands/cc-orchestrate.md project-template/.claude/commands/cc-orchestrate.md tests/installer/commands-parity.test.js README.md` (all tracked). Depends on T-502.
- [X] [T-504] Stage: `git add -u docs/superpowers/plans/2026-11-23-bug089-known-failure-substring-matching-lets-generic.md` (carries the ticks for T-101 to T-503). Depends on T-503.
- [X] [T-505] Commit: `fix: refuse generic known-failure entries and never know a failure in a changed file [BUG-089]`. Depends on T-504.

---

## Test List

- [ ] Integration, AC1: the eight N1 refusals (`a`, `FAIL`, 11 code points, padded with spaces, `AssertionError`, a long single word, `autenticación`, `autenticación_de_usuarios`).
- [ ] Integration, AC2: the four N2 acceptances (exactly 12, a test path, `suite > title`, exactly 200 with a space) and the BUG-074 rows with their new values (plan decision 6).
- [ ] Parity, AC3: the new `commands-parity` row and the existing byte-identical mirror row.
- [ ] Integration, AC4: N3 (created, modified, renamed, untracked, a path with a space; deleted and ignored left out; sorted), N4 (`--check` writes nothing), N5 (overwrite), N6 (removal when unavailable).
- [ ] Integration, AC5: N7 (no known failures, output unchanged), the three N8 rows (null base, no security record, git failing), N9 (`end`), N10 (`start` over a previous run).
- [ ] Unit, AC6: the four `[AC6]` rule rows and the qa and code rows of the new role-profiles block.
- [ ] Unit, AC7: the BUG-074 `GREEN` and `KNOWN_MATCH` pins pass unchanged; the `[AC7]` plan row; the `plan` sha row unchanged.
- [ ] AC8: N12a, N12b and the unchanged BUG-074 `isValidRun` rows.
- [ ] AC9: N11; the existing hand-back, router and SNAP suites pass unchanged in T-501.
- [ ] AC10: the token-cap, mirror and sha rows of `role-profiles.test.js`; `npm test` (T-501).
- [ ] No E2E/UI test: there is no UI. CI legs: no new test is conditionally skipped, so no leg's skipped set in `tools/skip-baseline.json` changes.

## Commit Order

1. Task 0 (T-004): this plan and its `.gitignore` leaf.
2. Task 5 (T-505): the tests, the script, the four profiles, the hash pins, the two command copies, the README row and the plan ticks for T-101 to T-503, in one commit, so no commit has a red suite. The red runs (T-104, T-302, T-402) happen in the working tree before each fix. The ticks for T-504, T-505 and the Test List ride the closeout commit.

## Identified Risks

- **A profile edit drifting from the measured bytes, or between the two copies.** T-305 checks `cmp` and the hashes of decision 4 before T-306 pins them.
- **A qa fixture's list holding a path the plan did not predict.** `QA_RUN` ignores `.conductor/` and `.claude/memory/`; the spec fixture is the one router-time file outside them. A different list in T-204 means the fixture missed a path: fix the fixture's `.gitignore`, never the script's listing rule.
- **A host project that does not ignore `.conductor/`.** Its list also names the router's own files (`A .conductor/handback/…`). That only widens the list: no test lives there, and Guard 6 keeps every role from writing there, so no failing test is wrongly known.
- **The orchestrator editing the list.** `.conductor/**` is the orchestrator's write surface (Guard 6), so the script cannot stop it; the command says only `install qa` writes the file (decision 8), and every `install qa` rewrites it.
- **`model:` no longer being the last line of `install qa`.** The change line goes before it (decision 3); T-205 runs the last-line checks.
- **A run started before this item with a short entry.** Still valid (AC8, N12a); `qa` applies the file rule at its next `install qa`.
- **A declared file-path entry covering a broken test in an untouched file.** Accepted by the owner as a known limit (spec, Owner decisions 6); the start line and the final report keep the match visible.
- **The long suite timing out the shell.** T-501 notes the duration; a timeout is not a red.
