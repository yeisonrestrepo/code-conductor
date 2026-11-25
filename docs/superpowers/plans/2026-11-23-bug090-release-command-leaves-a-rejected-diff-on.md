# BUG-090 A rejected release diff prints its discard commands and a discard-before-tooling warning: implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** when `release.mjs check` rejects the release role's diff, it appends, after the failure lines it prints today, one `RELEASE_DISCARD_FIRST` warning line when a rejected path in the diff is control-plane, then the exact `git --literal-pathspecs …` commands that discard the whole diff (`DISCARD` lines) and one `DISCARD_BY_HAND` line per path no shell line can carry safely. Step 6 of `/cc-release` (both mirrors and both rendered copies) relays them and says that such a diff must be discarded before any project tooling runs. `orchestrate.mjs` exports the control-plane predicate `release.mjs` reads; neither list changes.

**Spec:** `docs/superpowers/specs/2026-11-23-bug090-release-command-leaves-a-rejected-diff-on-design.md` (sha256 `5c68e1b2812aa12929c25e8296cb89a6bc4ea76a5ec50425d4ef3258090bfe53`), approved by the owner with the D4 literal-pathspec change and the rendered-copies addition. Issue #299, follow-up of FEAT-035.

**Approval:** the spec and the plan need an owner approval, not a delegated one (spec, line 8): the change edits control-plane files (`scripts/release.mjs`, `scripts/orchestrate.mjs`, `.claude/commands/cc-release.md` and its `project-template/` copy) and changes what the release command tells the owner to do with a diff written by an agent that reads attacker-influenceable text.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>` and `-t '<pattern>'`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines (the `[BUG-090]` line at `README.md:534` included) stay untouched. `dependencies` stays `{}`; no devDependency changes.
- **Ten files change after Task 0:** `scripts/orchestrate.mjs`, `scripts/release.mjs`, `tests/scripts/orchestrate.test.js`, `tests/scripts/release.test.js`, `tests/installer/commands-parity.test.js`, `.claude/commands/cc-release.md`, `project-template/.claude/commands/cc-release.md`, `project-template/.agents/workflows/cc-release.md`, `project-template/.agents/skills/cc-release/SKILL.md` (the last two regenerated, never hand-edited) and `tools/skip-baseline.json`. The first nine are the spec's System Impact list; `tools/skip-baseline.json` is the one addition, required by `CONTRIBUTING.md` ("a change in what CI skips … is red until the same PR updates the file") because two new rows cannot run on Windows (plan decision 9).
- Not touched: `CONTROL_PLANE`, `CONTROL_PLANE_NAMES` and the `orchestrate.test.js` rows that pin them (`:503-597`), every current caller of `inSurface` / `inControlPlane`, `changedPaths`, `shellQuote`, `digest`, `handoff`, `init`, `scripts/docs-sync.mjs` and `/cc-docs` (spec, Out of Scope), the installer, hooks, settings, workflows.
- Every file this plan edits after Task 0 is tracked and none sits under an ignored directory (measured with `git ls-files --error-unmatch` and `git check-ignore --no-index`), so each is staged with `git add -u <path>`. This plan is new in Task 0 under the ignored `docs/superpowers/plans/` (so `git add -f`) and is tracked and re-included by its leaf afterwards (so `git add -u`).
- `.claude/` is read-only for Bash in the build sandbox: the edit of `.claude/commands/cc-release.md` uses the Edit tool. The `project-template/` copy may use either; the rendered copies are written only by `node lib/installer/harness-commands.mjs --write`.
- The runner makes the commits: every `Commit:` step below is ticked when the runner has committed the tree, never run from the sandbox.

## Files read in full (spec, Files Requiring Full Read)

- `scripts/release.mjs` (970 lines): `ReleaseError` (`:20-26`) and `fail` (`:27`); `git` (`:34-37`) always passes `-c core.quotepath=off` and returns `{ status, out, err }`; `changedPaths` (`:522-526`) ignores git's exit status and is left as it is; `shape` (`:528`); `judgeJsonFile` (`:540-554`) and `judgeVersionFiles` (`:561-569`, the only `RELEASE_LOCATION_SHAPE` producer); `scopeFailures` (`:637-642`, the only `RELEASE_PROFILE_CHANGED` and `RELEASE_OUT_OF_SCOPE` producer); `judge` (`:645-657`), whose only caller is `checkVerb` (`:930-937`; `grep -rn "judge("` finds no other, and no test imports it); `SAFE_ARGUMENT` / `shellQuote` (`:661-662`); `cli` (`:954-965`) prints the verb's lines to stdout and a `ReleaseError` as `release: <message>` on stderr with exit 2; the entry guard `invokedDirectly` (`:967-970`) is a function, called once after every import has evaluated. The existing `RELEASE_*` codes include no git-failure code, so `RELEASE_GIT_FAILED` is new.
- `scripts/orchestrate.mjs` (lines 1-100, 1300-1370, 1800-1815, 1875-1889): its only `release.mjs` import (`:17`) is used only inside `releaseScope` (`:1809-1814`); `CONTROL_PLANE` (`:30-79`), `CONTROL_PLANE_NAMES` (`:81-96`); `globToRegExp` (`:1312`), `reachesDir`, `reachesList` (`:1331`), `taskGlob` (`:1336`), `ntfsAlias` (`:1338`), `nonAscii` (`:1341`), `inSurface` (`:1342-1345`), `namesControlFile` (`:1348-1352`), `inControlPlane` (`:1354`), `surfaceTask` (`:1358-1366`); the entry guard (`:1888-1889`) awaits `cli` only when the file itself is `argv[1]`, so importing it has no side effect.
- `tests/scripts/release.test.js` (984 lines): imports (`:1-8`); helpers `fresh`, `git`, `gitOut`, `put`, `read`, `commit`, `rel`, `lines` (`:52-80`), `jsonText`, `lockText`, `project` (`:87-104`: `.gitignore` holds `.conductor/` and `red-*`, the base tree is `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`, `BACKLOG.md`, `checks/a.mjs`, `checks/b.mjs`, the profile and `src/a.js`), `applyRelease`, `report`, `checkArgs` (`:136`). The `check` block is `:718-848`; its row 41 (`:770-782`) asserts `toHaveLength(3)` at `:779` (plan decision 6).
- `tests/installer/commands-parity.test.js` (700 lines): imports (`:1-6`, no `node:child_process`), `read` (`:9`); `RELEASE_MIRRORS` (`:606`); `describe('cc-release [FEAT-035]')` (`:608-644`), whose `[P2]` row lists `'git checkout -- <files>'` (`:626`); `describe('the release role ships [FEAT-035 O5]')` (`:646-660`) deploys with `deployProject` into a temp dir. The `[FEAT-036]` cc-docs row (`:593`) also names `git checkout -- <files>` and stays: `/cc-docs` is out of scope.
- Also read: `.claude/commands/cc-release.md` (step 6 at `:30`, byte-identical in `project-template/`), its two renders (step 6 at `project-template/.agents/workflows/cc-release.md:33` and `project-template/.agents/skills/cc-release/SKILL.md:34`), `lib/installer/harness-commands.mjs` (`renderCommand` copies the body verbatim after a preamble; `--write` rewrites every render), `lib/installer/deploy.mjs:381` (`cpSync` of the whole `scripts/` to `.claude/scripts/`), `tools/skip-baseline.json` (`ci-windows-node24`, 24 sorted entries named `<file> > <describe> <title>`).

## Plan decisions

1. **The predicate (spec D2, AC12, AC13).** In `scripts/orchestrate.mjs`, directly after `inControlPlane` (`:1354`):

   ```js
   // BUG-090: a path release.mjs check names in a rejected diff. Unlike inControlPlane alone, an alias or a non-ASCII
   // spelling counts too, as inSurface counts it, because a filesystem may resolve it to a manifest (spec D2).
   export const isControlPlanePath = (path) => nonAscii(path) || ntfsAlias(taskGlob(path)) || inControlPlane(path);
   ```

   `nonAscii` runs on the path as given, before `taskGlob` folds case, as in `inSurface`. Neither list, `inSurface`, `inControlPlane` nor `surfaceTask` changes. Measured on a scratch copy of `scripts/` with this line and the import of decision 2 (Node v24.22.2): true for `package.json`, `sub/Package.JSON`, `package.json.`, `package.json::$DATA`, `pаckage.json`, `.npmrc`, `.claude/release-profile.json`; false for `notes.txt`, `CHANGELOG.md`, `VERSION`, `src/a.js`.

2. **The import (spec D8).** In `scripts/release.mjs`, after the `ticket.mjs` import (`:12`):

   ```js
   // BUG-090 D8: orchestrate.mjs imports this module too, so the two form a cycle; use isControlPlanePath only inside a function.
   import { isControlPlanePath } from './orchestrate.mjs';
   ```

   The scratch copy of decision 1 ran `node release.mjs` (usage line, exit 2) and `node orchestrate.mjs` (usage line, exit 2), and imported the modules in both orders in fresh processes with no TDZ error. `orchestrate.mjs`'s top level still reads no `release.mjs` binding.

3. **The judgment names its paths (spec D2, D5).** `scopeFailures(ctx, changed)` takes the diff instead of computing it, and it and `judgeVersionFiles` return `{ path, line }` entries instead of strings:

   ```js
   function scopeFailures(ctx, changed) {
     const out = changed.includes(PROFILE_PATH) ? [{ path: PROFILE_PATH, line: shape('RELEASE_PROFILE_CHANGED', `${PROFILE_PATH} differs from HEAD`) }] : [];
     const stray = changed.filter((p) => p !== PROFILE_PATH && !ctx.surface.includes(p)).sort();
     return [...out, ...stray.map((p) => ({ path: p, line: shape('RELEASE_OUT_OF_SCOPE', `${p} is outside the release surface [${ctx.surface.join(', ')}]`) }))];
   }
   ```

   and in `judgeVersionFiles`, `if (why) problems.push({ path, line: shape('RELEASE_LOCATION_SHAPE', `${path} ${why}`) });`. `judge(ctx, reportText, changed)` then returns `{ failures, rejected }`:

   ```js
   // Every failure, in decision 13's order, and the paths the scope and location failures name (BUG-090); none means the diff is the release.
   export function judge(ctx, reportText, changed) {
     const named = [...scopeFailures(ctx, changed), ...judgeVersionFiles(ctx)];
     const failures = named.map((f) => f.line);
     // … the changelog, backlog and claims lines exactly as today …
     return { failures: [...failures, ...[claims, judgeReport(ctx, reportText)].filter(Boolean)], rejected: named.map((f) => f.path) };
   }
   ```

   The failure lines, their text and their order are unchanged. Taking the paths from the producers, not by parsing the printed lines, avoids prefix ambiguity between two paths such as `a` and `a b`. `judge` has no other caller, so its signature changes in place.

4. **The discard lines (spec D3-D6).** In the judgment section, after `judge`:

   ```js
   // BUG-090 D4: how git drops each path of the diff: in HEAD, restore it; only in the index, remove it; untracked, delete it.
   function diffStates(root) {
     const tracked = git(root, ['diff', '--name-status', '-z', '--no-renames', 'HEAD']);
     const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
     if (tracked.status !== 0 || untracked.status !== 0) fail('RELEASE_GIT_FAILED', 'git cannot list the diff against HEAD, so no discard command is printed');
     const states = new Map(untracked.out.split('\0').filter(Boolean).map((p) => [p, 'clean']));
     const fields = tracked.out.split('\0');
     for (let i = 0; i + 1 < fields.length; i += 2) states.set(fields[i + 1], fields[i] === 'A' ? 'rm' : 'checkout');
     return states;
   }

   const DISCARD_COMMANDS = [['checkout', 'git --literal-pathspecs checkout HEAD --'], ['rm', 'git --literal-pathspecs rm -f --'], ['clean', 'git --literal-pathspecs clean -f --']];
   // BUG-090 D6: a control character would split or forge a printed line, and a single quote's POSIX escape is not PowerShell's.
   const byHand = (path) => /[\p{Cc}']/u.test(path);
   // JSON.stringify leaves DEL and C1 (U+007F-U+009F) raw, and a raw C1 such as U+009B (CSI) can drive a terminal.
   const controlEscape = (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
   const jsonName = (path) => `"${[...path].map((c) => (/\p{Cc}/u.test(c) ? controlEscape(c) : JSON.stringify(c).slice(1, -1))).join('')}"`;
   const pathName = (path) => (byHand(path) ? jsonName(path) : path);

   // BUG-090: after a rejected judgment, the warning when a rejected path of the diff is control-plane, then the commands
   // that drop the whole diff. shellQuote is defined below; it is read only when this runs.
   function discardLines(root, rejected) {
     const states = diffStates(root);
     const paths = [...states.keys()].sort();
     const plane = [...new Set(rejected)].filter((p) => states.has(p) && isControlPlanePath(p)).sort();
     const out = plane.length === 0 ? [] : [shape('RELEASE_DISCARD_FIRST', `the rejected diff touches ${plane.map(pathName).join(', ')}, which project tooling reads; discard the whole diff before running any package manager, test, build or hook command`)];
     for (const [state, command] of DISCARD_COMMANDS) {
       const named = paths.filter((p) => states.get(p) === state && !byHand(p));
       if (named.length > 0) out.push(`release: DISCARD ${command} ${named.map(shellQuote).join(' ')}`);
     }
     return [...out, ...paths.filter(byHand).map((p) => `release: DISCARD_BY_HAND ${jsonName(p)}`)];
   }
   ```

   - **Classes.** `git diff --name-status HEAD` reports a path in `HEAD` as `M`, `D` or `T` (restore with `checkout HEAD`) and a path only in the index as `A` (`rm -f`); a path neither lists is untracked (`clean -f`). A tracked status wins over the untracked listing, so a path removed from the index but present in `HEAD` and the work tree is restored once, not also deleted. Measured with git 2.43.0 in a scratch repository: `A staged`, `M t`, untracked `:!x` and `newdir/f`; `git --literal-pathspecs clean -f -- ':!x' newdir/f`, `rm -f -- staged` and `checkout HEAD -- t` left `git status --porcelain` empty, a file created afterwards survived, and `clean -f` on a file inside an untracked directory needs no `-d`.
   - **Which paths warn.** A rejected path warns only when it is in the diff (`states.has(p)`). A `RELEASE_LOCATION_SHAPE` line can name an unchanged version file (`VERSION` left at the old version), which carries nothing injected; this is also what makes a judgment failure with an empty diff print nothing (spec, Alternative paths).
   - **Order and form.** The warning, then `checkout`, `rm`, `clean` (each omitted when its class is empty), then the `DISCARD_BY_HAND` lines; every list sorted with the default string sort (`CHANGELOG.md VERSION package-lock.json package.json`, as in the spec's Main path). `\p{Cc}` covers C0, DEL and C1. A path with a character outside `SAFE_ARGUMENT` (`/^[A-Za-z0-9._/:=@%+,-]+$/`, `release.mjs:661`), such as a space, `$`, `;`, `!` or a non-ASCII letter, is single-quoted by `shellQuote`; `:` is in `SAFE_ARGUMENT`, so `':!x'` is quoted because of its `!` (N7 is unchanged).
   - **The JSON form (owner decision on the plan).** `jsonName` escapes every `\p{Cc}` character (C0, DEL and C1) as `\uXXXX` with four lowercase hex digits, a newline included (`\u000a`, not `\n`); every other character takes `JSON.stringify`'s form (`"` as `\"`, `\` as `\\`, a lone surrogate as `\udXXX`). The result is still a JSON string, so `JSON.parse(jsonName(p)) === p` (spec D6), and none of the new lines (`RELEASE_DISCARD_FIRST`, `DISCARD`, `DISCARD_BY_HAND`) carries a raw control character. The existing failure lines are not changed: `RELEASE_OUT_OF_SCOPE` keeps printing the raw path, as the spec's Out of Scope says. The `RELEASE_DISCARD_FIRST` line names a by-hand path in the same form.
   - **Git failure (spec, Error cases).** `diffStates` checks both exit codes and throws `RELEASE_GIT_FAILED`, which `cli` prints on stderr with exit 2 and no stdout, so no partial command is printed. It runs even on an empty diff, so a failing git is never read as "nothing to discard".

5. **`checkVerb`.**

   ```js
   function checkVerb(root, opts, readReport) {
     const ctx = prepare(root, opts, 'check');
     const { failures, rejected } = judge(ctx, readReport(), changedPaths(root));
     if (failures.length > 0) return { code: 1, lines: [...failures, ...discardLines(root, rejected)] };
     // … the runChecks and release: ok lines exactly as today …
   }
   ```

   `release: ok` and `RELEASE_HALT` take the unchanged path below the `if`, so they print no new line (spec D7).

6. **Two existing rows follow the new output.** Row 41 of the `check` block (`release.test.js:770-782`) counts every stdout line (`toHaveLength(3)`); its fixture's diff is non-empty, so the spec's Main path appends two `DISCARD` lines there. Its `toHaveLength(3)` becomes `toHaveLength(5)`, followed by `expect(out[3]).toBe('release: DISCARD git --literal-pathspecs checkout HEAD -- BACKLOG.md CHANGELOG.md package-lock.json package.json')` and `expect(out[4]).toBe('release: DISCARD git --literal-pathspecs clean -f -- notes.txt')`; its three failure-line assertions and its title stay (`VERSION` is back at `1.0.0`, so it is not in the diff, and no rejected path is control-plane). The `[P2]` row of `commands-parity.test.js` drops the phrase `'git checkout -- <files>'` (`:626`), which step 6 no longer suggests because it is a no-op on an untracked file (spec, Problem); its other 13 phrases stay. Every other existing row is unchanged.

7. **Step 6 (spec AC10).** In both mirrors, the sentence `On a failure or a halt, list each line and say the diff is left in place; discard it with \`git checkout -- <files>\`.` becomes:

   > On a failure or a halt, list each line and say the diff is left in place. A failure also prints the commands that discard the whole diff: show each `DISCARD` command exactly as printed, for the owner to run from the project root, and each `DISCARD_BY_HAND` path as a file to restore or delete by hand; never run them yourself. When `check` prints a `RELEASE_DISCARD_FIRST` line, say plainly that the rejected diff must be discarded before running any project tooling: no package manager, test, build or hook command until the `DISCARD` commands have run.

   The rest of step 6, including `This command never commits, stages or reverts anything.`, is unchanged. "From the project root" matters because the printed paths are relative to it. The renders are then regenerated (`node lib/installer/harness-commands.mjs --write`), which copies the body verbatim, so both carry the same sentence.

8. **Test rows.** Titles are exact, because two of them are named in `tools/skip-baseline.json`.

   `tests/scripts/orchestrate.test.js`: line 6 becomes `import { fileURLToPath, pathToFileURL } from 'node:url';`, and a new `describe('control-plane paths for the release check [BUG-090]')` is appended at the end of the file. It calls the predicate through the existing namespace import `orchestrateModule`, never a named import, so the file still loads before the export exists and the red run fails row by row.
   - O1 (10) `it.each(['package.json', 'package-lock.json', '.npmrc', 'sub/package.json', 'Package.JSON', '.claude/release-profile.json', 'package.json.', 'package.json::$DATA', 'PACKAG~1.JSO', 'pаckage.json'])('[AC13] isControlPlanePath counts %s', …)`: `true`.
   - O2 (5) `it.each(['VERSION', 'CHANGELOG.md', 'AGENT-READABLE BACKLOG.md', 'notes.txt', 'src/a.js'])('[AC13] isControlPlanePath does not count %s', …)`: `false`.
   - O3 (1) `'[AC14] release.mjs and orchestrate.mjs, run with no arguments, print their usage and exit 2'`: `spawnSync(process.execPath, [join(REPO_ROOT, 'scripts/release.mjs')], { encoding: 'utf8' })` exits 2 with stderr matching `/^release: RELEASE_USAGE: usage: release\.mjs /`; `spawnSync(process.execPath, [SCRIPT], …)` exits 2 with stderr `'orchestrate: usage: orchestrate.mjs start|install|handback|approve|hash|review|delegate|resume|envelope|end\n'`.
   - O4 (2) `it.each([['orchestrate.mjs', 'release.mjs'], ['release.mjs', 'orchestrate.mjs']])('[AC14] importing %s first, then %s, loads both and the predicate answers', …)`: a fresh `node --input-type=module -e` process awaits `import()` of the two `pathToFileURL(join(REPO_ROOT, 'scripts', f)).href` URLs in that order, then writes `String(o.isControlPlanePath('package.json'))` from the orchestrate module; stderr `''`, exit 0, stdout `'true'`.

   `tests/scripts/release.test.js`: a new `describe('release.mjs check discards a rejected diff [BUG-090]')` after the `check` block (`:848`), with its own `const V = '1.1.0'`, `SURFACE` (as in the `check` block), `release1`, `ok = report(V, ['FEAT-001'])`, `const check = (text = ok) => rel(checkArgs(V, 'FEAT-001'), text)`, `const discards = (out) => lines(out).filter((l) => l.startsWith('release: DISCARD '))`, and `runDiscards(out)`, which runs each `discards(out)` line without its `release: DISCARD ` prefix through `spawnSync('bash', ['-c', command], { cwd: root, env: cleanGitEnv(), encoding: 'utf8' })` and expects exit 0 for each (the `session-metrics` test already runs `bash -c` on every CI leg). `CP = 'which project tooling reads; discard the whole diff before running any package manager, test, build or hook command'`.
   - N1 `'[AC1] a postinstall script in package.json and a new .npmrc print the warning and both discard commands after the failure lines'`: `release1()`, `package.json` rewritten with `scripts: { postinstall: 'node x.js' }` added, `.npmrc` created; exit 1 and `lines(r.out)` equals exactly `release: RELEASE_OUT_OF_SCOPE: .npmrc is outside the release surface ${SURFACE}`, `release: RELEASE_LOCATION_SHAPE: package.json differs from HEAD in more than its version keys`, `release: RELEASE_DISCARD_FIRST: the rejected diff touches .npmrc, package.json, ${CP}`, `release: DISCARD git --literal-pathspecs checkout HEAD -- BACKLOG.md CHANGELOG.md VERSION package-lock.json package.json`, `release: DISCARD git --literal-pathspecs clean -f -- .npmrc` (no `rm` line: its class is empty).
   - N2 (2) `it.each(['.npmrc', 'sub/package.json'])('[AC2] an out-of-scope control-plane path %s prints the warning', …)`: `release1()`, the file created; stdout contains `release: RELEASE_DISCARD_FIRST: the rejected diff touches ${p}, ${CP}` and `release: DISCARD git --literal-pathspecs clean -f -- ${p}`.
   - N3 `'[AC3] an edited profile alone prints the warning and restores the profile from HEAD'`: `release1()`, a newline appended to `.claude/release-profile.json`; stdout contains the `RELEASE_DISCARD_FIRST` line naming `.claude/release-profile.json` and `release: DISCARD git --literal-pathspecs checkout HEAD -- .claude/release-profile.json BACKLOG.md CHANGELOG.md VERSION package-lock.json package.json`.
   - N4 (2) `it.each([['an untracked notes.txt', () => put('notes.txt', 'x\n')], ['a changelog shape', () => sub('CHANGELOG.md', '- First.\n', '')]])('[AC4] a failure on %s alone prints no warning but the discard commands', …)` (`sub` as in the `check` block): exit 1, no `RELEASE_DISCARD_FIRST`, `discards(r.out)` non-empty.
   - N5 `'[AC5] each path of the diff is on exactly one command, by its git state, sorted'`: `release1()`, `docs/new.md` created and `git add`ed, `notes.txt` created, `src/a.js` deleted; `discards(r.out)` equals exactly `…checkout HEAD -- BACKLOG.md CHANGELOG.md VERSION package-lock.json package.json src/a.js`, `release: DISCARD git --literal-pathspecs rm -f -- docs/new.md`, `release: DISCARD git --literal-pathspecs clean -f -- notes.txt`; no `RELEASE_DISCARD_FIRST`.
   - N6 `'[AC6] the printed commands, run verbatim, leave the work tree clean'`: N5's fixture, `runDiscards(r.out)`, then `gitOut('status', '--porcelain')` is `''`.
   - N7 `it.skipIf(process.platform === 'win32')('[AC7] the printed commands remove an untracked :!x and keep a file created after check', …)`: `release1()`, `:!x` created; the clean line is exactly `release: DISCARD git --literal-pathspecs clean -f -- ':!x'`; `later.txt` created after `check`; `runDiscards(r.out)`; `:!x` is gone and `later.txt` is still there.
   - N8a `'[AC8] a path with a space is quoted and a path with a single quote is left to a DISCARD_BY_HAND line'`: `release1()`, `my notes.txt` and `it's.txt` created; stdout contains `release: DISCARD git --literal-pathspecs clean -f -- 'my notes.txt'` and `release: DISCARD_BY_HAND "it's.txt"`; no `discards` line contains `it's.txt`.
   - N8b `it.skipIf(process.platform === 'win32')('[AC8] a path with a newline is on no command and on one DISCARD_BY_HAND line', …)`: `release1()`, `a\nb.txt` created; stdout contains `release: DISCARD_BY_HAND "a\\u000ab.txt"` exactly once and `release: RELEASE_DISCARD_FIRST: the rejected diff touches "a\\u000ab.txt", ${CP}` (a newline is outside printable ASCII, so the path is control-plane); no `discards` line contains `b.txt`.
   - N8c `'[AC8] a path with U+009B is on no command and its DISCARD_BY_HAND line escapes it as six ASCII characters'` (runs on every leg: NTFS accepts U+009B in a name): `release1()`, `'a\u009bb.txt'` created; stdout contains `release: DISCARD_BY_HAND "a\\u009bb.txt"` exactly once (the escape is the six ASCII characters `\u009b`) and `release: RELEASE_DISCARD_FIRST: the rejected diff touches "a\\u009bb.txt", ${CP}` (U+009B is outside printable ASCII, so the path is control-plane); no `discards` line contains `b.txt`; no stdout line starting with `release: RELEASE_DISCARD_FIRST`, `release: DISCARD ` or `release: DISCARD_BY_HAND` matches `/\p{Cc}/u`, so the new lines hold no raw control character. The check is limited to the new lines because the `RELEASE_OUT_OF_SCOPE` line for the same path keeps printing it raw (spec, Out of Scope); that line is not asserted on.
   - N9 (3) `it.each(['release: ok', 'a RELEASE_HALT', 'a judgment failure with an empty diff'])('[AC9] %s prints no warning and no discard command', …)`: `release1()` and exit 0; `release1()` plus `red-a` (ignored) and exit 1 with `RELEASE_HALT`; `project()` alone with an empty report and exit 1. stdout never contains `DISCARD`.
   - N10 `'[E1] git failing while classifying the diff is a refusal, not a partial command'`: `release1()`, then `.git/index` overwritten with `garbage`; exit 2, stdout `''`, stderr matching `/^release: RELEASE_GIT_FAILED: /`. Measured: with a corrupt index `git show HEAD:./…` exits 0 and `git diff … HEAD` and `git ls-files --others` exit 128, so `prepare` succeeds, `judgeJsonFile`'s `--numstat` reads empty and fails the manifests, and `diffStates` throws.
   - N11 `'[AC13] an out-of-scope path with a non-ASCII character prints the warning'`: `release1()`, `pаckage.json` created; stdout contains `release: RELEASE_DISCARD_FIRST: the rejected diff touches pаckage.json, ${CP}` and `release: DISCARD git --literal-pathspecs clean -f -- 'pаckage.json'`.

   `tests/installer/commands-parity.test.js`: `import { spawnSync } from 'node:child_process';` is added to the imports.
   - P5 (4), inside `describe('cc-release [FEAT-035]')` after the `[O6]` row: `it.each([...RELEASE_MIRRORS, 'project-template/.agents/workflows/cc-release.md', 'project-template/.agents/skills/cc-release/SKILL.md'])('[BUG-090 AC10] %s says to discard a rejected diff before any project tooling, with the printed commands', …)`: contains `show each \`DISCARD\` command exactly as printed, for the owner to run from the project root`, `` `DISCARD_BY_HAND` ``, `never run them yourself`, `When \`check\` prints a \`RELEASE_DISCARD_FIRST\` line, say plainly that the rejected diff must be discarded before running any project tooling` and `This command never commits, stages or reverts anything.`; does not contain `git checkout -- <files>`.
   - P6 (1), inside `describe('the release role ships [FEAT-035 O5]')` after `[P4]`: `'[BUG-090 AC15] an install also gets the router and its load-time modules, and the deployed driver loads'`: `.claude/scripts/{orchestrate,snap-contract,ticket,doc-locations,docs-sync}.mjs` exist in the install, and `spawnSync(process.execPath, [join(cwd, '.claude/scripts/release.mjs')], { encoding: 'utf8' })` exits 2 with stderr matching `/^release: RELEASE_USAGE: usage: release\.mjs /`.

9. **The Windows leg's skipped set.** NTFS refuses `:` and a newline in a file name, so N7 and N8b are `skipIf(win32)`. `tools/skip-baseline.json` gains, at the end of `ci-windows-node24` (after `tests/scripts/handoff-cycle.test.js …`, the sorted position), `"tests/scripts/release.test.js > release.mjs check discards a rejected diff [BUG-090] [AC7] the printed commands remove an untracked :!x and keep a file created after check"` and `"tests/scripts/release.test.js > release.mjs check discards a rejected diff [BUG-090] [AC8] a path with a newline is on no command and on one DISCARD_BY_HAND line"`, in that order. `ci-node20` and `ci-node24` are unchanged: no new row skips on Linux.

10. **Red predictions, reasoned against the current code.**
    - Task 1, `-t 'BUG-090'` on `orchestrate.test.js` (match set: the 18 new rows; no existing title contains `BUG-090`): **red** O1 (10) and O2 (5), `isControlPlanePath` is not a function; O4 (2), the child process throws. **Green** O3: both scripts already print their usage. **17 failed | 1 passed**, every other test skipped.
    - Task 2, the whole `release.test.js`: **red** N1, N2 (2), N3, N4 (2), N5, N6 (no `DISCARD` line, so the tree stays dirty), N7, N8a, N8b, N8c, N10 (exit 1 today) and N11: 14; and row 41 (5 lines expected, 3 printed): 15. **Green** N9 (3): no `DISCARD` line today. **15 failed | 125 passed | 1 skipped (141)**; the skip is the existing win32 `[O8]` row.
    - Task 3, the whole `commands-parity.test.js`: **red** P5 (4). **Green** P6 (the whole `scripts/` is already deployed and `release.mjs` already loads) and the amended `[P2]`. **4 failed | 112 passed (116)**.

11. **`.gitignore` leaf.** `!/docs/superpowers/plans/2026-11-23-bug090-release-command-leaves-a-rejected-diff-on.md` goes directly after the `2026-11-23-bug089` plan leaf (`.gitignore:203`) and before the `2026-11-23-feat030` plan leaf, the full-path sort order of the block (BUG-042).

## Owner decisions

- **Spec.** Every `DISCARD` command uses git's literal-pathspec option (`git --literal-pathspecs checkout HEAD --`, `rm -f --`, `clean -f --`), with an acceptance row for an untracked `:!x` and a file created after `check` (N7). The import cycle between `release.mjs` and `orchestrate.mjs` is accepted as specified. The two rendered copies of `/cc-release` are in scope, regenerated with `node lib/installer/harness-commands.mjs --write` and never hand-edited, and must carry step 6's new wording with `tests/installer/harness-commands.test.js` green (P5, T-305, T-306).
- **Plan, decision 4.** The JSON form used by `pathName` and the `DISCARD_BY_HAND` line escapes every `\p{Cc}` character as `\uXXXX`, because `JSON.stringify` alone leaves U+007F to U+009F raw (`jsonName`, plan decision 4). A new row, N8c, covers an untracked path holding U+009B; N8b now expects the newline as `\u000a`, which follows from the same rule. The predicted counts of T-203, T-207 and T-401 include N8c.
- **Plan, the N8c assertion and plan decision 4.** N8c checks for raw control characters only on the new lines (`RELEASE_DISCARD_FIRST`, `DISCARD`, `DISCARD_BY_HAND`); `RELEASE_OUT_OF_SCOPE` keeps printing the path unchanged, as the spec's Out of Scope says, and plan decision 4 says so. Plan decision 4 also states that `:` is in `SAFE_ARGUMENT` and `':!x'` is quoted because of `!`, so N7 does not change. N8c is still red before Task 2 (no `DISCARD_BY_HAND` line) and green after it, so the predictions of T-203, T-207 and T-401 do not change.
- **Plan, unchanged.** The rest of the plan stands as written, including the `tools/skip-baseline.json` entries and plan decisions 3, 6 and 9: N8c is not skipped on any leg, so the Windows baseline still gains exactly two entries.

## Baseline (measured on this branch, HEAD 41d2718, Node v24.22.2, git 2.43.0)

- `npx vitest run tests/scripts/release.test.js`: **123 passed | 1 skipped (124)**.
- `npx vitest run tests/installer/commands-parity.test.js`: **111 passed (111)**.
- `npx vitest run tests/installer/harness-commands.test.js`: **45 passed (45)**.
- `npx vitest run tests/scripts/orchestrate.test.js`: **1253 passed (1253)**.
- `grep -c BUG-090` on the three edited test files is 0, so `-t 'BUG-090'` selects only the new rows.

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-23-bug090-release-command-leaves-a-rejected-diff-on.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file from the approved spec `5c68e1b2…`. No dependency.
- [X] [T-002] `.gitignore`: insert the leaf of plan decision 11 after the `2026-11-23-bug089` plan leaf. Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` (tracked) and `git add -f docs/superpowers/plans/2026-11-23-bug090-release-command-leaves-a-rejected-diff-on.md` (new, under the ignored `docs/superpowers/plans/`). Depends on T-002.
- [X] [T-004] Commit: `docs: plan the discard commands and discard-before-tooling warning for a rejected release diff [BUG-090]`. Depends on T-003.

---

### Task 1: The control-plane predicate (red, then green)

**Files:**
- Test: `tests/scripts/orchestrate.test.js`
- Modify: `scripts/orchestrate.mjs`

- [X] [T-101] `tests/scripts/orchestrate.test.js`: the `pathToFileURL` import and the appended BUG-090 describe with O1-O4 (plan decision 8). Depends on T-004.
- [X] [T-102] Red run: `npx vitest run tests/scripts/orchestrate.test.js -t 'BUG-090'`. Its full match set is the 18 new tests. Predicted: **17 failed | 1 passed** of the 18, every other test of the file skipped (plan decision 10). Any other split means a row or the prediction is wrong: stop and find which. Depends on T-101.
- [X] [T-103] `scripts/orchestrate.mjs`: the comment and `isControlPlanePath` after `inControlPlane` (plan decision 1). Depends on T-102.
- [X] [T-104] Green run: the T-102 command. Predicted: **18 passed** of the 18. `release.mjs` does not import `orchestrate.mjs` yet, so O3 and O4 do not exercise the cycle here; Task 2 reruns them with the cycle in place (T-208). Depends on T-103.

---

### Task 2: The discard lines in `release.mjs check` (red, then green)

**Files:**
- Test: `tests/scripts/release.test.js`
- Modify: `scripts/release.mjs`
- Modify: `tools/skip-baseline.json`

- [X] [T-201] `tests/scripts/release.test.js`, row 41: the `toHaveLength(5)` change and the two `DISCARD` assertions (plan decision 6). Depends on T-104.
- [X] [T-202] `tests/scripts/release.test.js`: the BUG-090 describe after the `check` block, with its helpers and N1-N11, N8c included (plan decision 8). Depends on T-201.
- [X] [T-203] Red run: `npx vitest run tests/scripts/release.test.js`. Predicted: **15 failed | 125 passed | 1 skipped (141)** (plan decision 10). Depends on T-202.
- [X] [T-204] `scripts/release.mjs`: the commented `orchestrate.mjs` import (plan decision 2). Depends on T-203.
- [X] [T-205] `scripts/release.mjs`: `scopeFailures`, `judgeVersionFiles` and `judge` as in plan decision 3. Depends on T-204.
- [X] [T-206] `scripts/release.mjs`: `diffStates`, `DISCARD_COMMANDS`, `byHand`, `pathName` and `discardLines` after `judge`, and `checkVerb` (plan decisions 4 and 5). Depends on T-205.
- [X] [T-207] Green run: the T-203 command. Predicted: **140 passed | 1 skipped (141)**. Depends on T-206.
- [X] [T-208] Cycle rerun: `npx vitest run tests/scripts/orchestrate.test.js -t 'BUG-090'`. Predicted: **18 passed** of the 18, now with `release.mjs` importing `orchestrate.mjs`. Depends on T-207.
- [X] [T-209] `tools/skip-baseline.json`: the two `ci-windows-node24` entries of plan decision 9; then `node -e "const w=require('./tools/skip-baseline.json')['ci-windows-node24']; if (JSON.stringify(w)!==JSON.stringify([...w].sort())||w.length!==26) process.exit(1)"` exits 0. Depends on T-208.

---

### Task 3: Step 6 of `/cc-release`, its renders and the parity rows (red, then green)

**Files:**
- Test: `tests/installer/commands-parity.test.js`
- Modify: `.claude/commands/cc-release.md`
- Modify: `project-template/.claude/commands/cc-release.md`
- Modify: `project-template/.agents/workflows/cc-release.md` (regenerated)
- Modify: `project-template/.agents/skills/cc-release/SKILL.md` (regenerated)

- [X] [T-301] `tests/installer/commands-parity.test.js`: the `spawnSync` import, the `[P2]` phrase removal (plan decision 6), P5 and P6 (plan decision 8). Depends on T-209.
- [X] [T-302] Red run: `npx vitest run tests/installer/commands-parity.test.js`. Predicted: **4 failed | 112 passed (116)** (plan decision 10). Depends on T-301.
- [X] [T-303] `.claude/commands/cc-release.md` (Edit tool): the step 6 sentence of plan decision 7. Depends on T-302.
- [X] [T-304] `project-template/.claude/commands/cc-release.md`: the same edit; then `cmp` of the two copies prints nothing. Depends on T-303.
- [X] [T-305] Run `node lib/installer/harness-commands.mjs --write`; then `git status --short project-template/.agents` lists exactly `project-template/.agents/skills/cc-release/SKILL.md` and `project-template/.agents/workflows/cc-release.md` as modified. Any other path means a source changed: stop and find it. Depends on T-304.
- [X] [T-306] Green run: `npx vitest run tests/installer/commands-parity.test.js tests/installer/harness-commands.test.js`. Predicted: **161 passed (161)** (116 + 45), the byte-identical `[P1]` row, the amended `[P2]` and the render drift rows included. Depends on T-305.

---

### Task 4: Full suite, scope check and commit

**Files:**
- Modify: `docs/superpowers/plans/2026-11-23-bug090-release-command-leaves-a-rejected-diff-on.md` (ticks)

- [X] [T-401] Run `npm test` (long: `orchestrate.test.js` alone takes several minutes; run it in the background if the shell times out). Predicted: exit 0, with `tests/scripts/orchestrate.test.js` at **1271 passed (1271)** (1253 + 18), `tests/scripts/release.test.js` at **140 passed | 1 skipped (141)**, `tests/installer/commands-parity.test.js` at **116 passed (116)** and `tests/installer/harness-commands.test.js` at **45 passed (45)**; the `CONTROL_PLANE` and `CONTROL_PLANE_NAMES` pins (`orchestrate.test.js:503-597`) and the U41 rows pass unchanged (AC12). A test red only for the sandbox (network, tmp permissions) is reported as ENV with its name; any other red is fixed. Depends on T-306.
- [X] [T-402] Scope check: `git status --short` lists exactly the ten files of the Global Constraints and this plan; no temporary file is left in the tree. `git diff --stat` shows no change to the spec, `package.json`, `package-lock.json`, `VERSION`, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `README.md` or `.claude/memory/`, and `git diff scripts/orchestrate.mjs` touches no line of `CONTROL_PLANE` or `CONTROL_PLANE_NAMES`. Depends on T-401.
- [X] [T-403] Stage: `git add -u scripts/orchestrate.mjs scripts/release.mjs tests/scripts/orchestrate.test.js tests/scripts/release.test.js tests/installer/commands-parity.test.js .claude/commands/cc-release.md project-template/.claude/commands/cc-release.md project-template/.agents/workflows/cc-release.md project-template/.agents/skills/cc-release/SKILL.md tools/skip-baseline.json`. Depends on T-402.
- [X] [T-404] Stage: `git add -u docs/superpowers/plans/2026-11-23-bug090-release-command-leaves-a-rejected-diff-on.md` (carries the ticks for T-101 to T-403). Depends on T-403.
- [X] [T-405] Commit: `fix: print the discard commands and a discard-before-tooling warning for a rejected release diff [BUG-090]`. Depends on T-404.

---

## Test List

- [X] [T-501] tests/scripts/release.test.js (Task 2): N1 (AC1), N2 (AC2), N3 (AC3), N4 (AC4), N5 (AC5), N6 (AC6), N7 (AC7, skipped on win32), N8a, N8b and N8c (AC8, N8b skipped on win32), N9 (AC9), N10 (spec Error cases), N11 (AC13), and row 41 as amended; every other existing `check` row unchanged (AC9).
- [X] [T-502] tests/scripts/orchestrate.test.js (Task 1): O1 and O2 (AC13, the predicate over manifests, a nested name, case, the profile, NTFS aliases, a short name and a non-ASCII spelling, and five paths it must not count), O3 and O4 (AC14, the cycle in every order); the `CONTROL_PLANE` / `CONTROL_PLANE_NAMES` pins unchanged (AC12).
- [X] [T-503] tests/installer/commands-parity.test.js (Task 3): P5 (AC10 for both mirrors, AC11 for both renders), P6 (AC15), `[P1]` byte-identical mirrors, the amended `[P2]`.
- [X] [T-504] tests/installer/harness-commands.test.js (Task 3, unchanged file): its render drift rows stay green after the regeneration (AC11).
- [X] [T-505] AC16: `dependencies` stays `{}` (T-402) and `npm test` is green (T-401). No E2E/UI test: there is no UI. CI legs: `ci-windows-node24` skips N7 and N8b, recorded in `tools/skip-baseline.json` (plan decision 9); `ci-node20` and `ci-node24` skip nothing new.

## Commit Order

1. Task 0 (T-004): this plan and its `.gitignore` leaf, committed by the runner at the end of the plan session.
2. Task 4 (T-405): the two scripts, the three test files, the two command mirrors, the two renders, the skip baseline and the plan ticks for T-101 to T-403, in one commit, so no commit has a red suite. The red runs (T-102, T-203, T-302) happen in the work tree before each fix. The ticks for T-404, T-405 and the Test List ride the closeout commit.

## Identified Risks

- **A later top-level use across the cycle.** If either module reads the other's binding while it evaluates, a load order throws a TDZ error. O3 and O4 run both entry points and both import orders in fresh processes (rerun in T-208 once the cycle exists), and P6 loads the deployed driver.
- **The test-writer importing the predicate by name.** A named import of a missing export fails the whole `orchestrate.test.js` at link time, so the red run would show one file error instead of 17 rows. Plan decision 8 uses the existing namespace import.
- **The Windows leg.** `:` and a newline are invalid NTFS names, hence the two skips and their baseline entries; a third Windows-only failure would show as an unexpected red in CI, not locally. `bash -c` resolves to Git Bash there, as the `session-metrics` row already relies on. `pаckage.json`, `it's.txt` and N8c's U+009B name are valid NTFS names, so they run there and need no baseline entry.
- **The corrupt-index fixture behaving differently on another git.** N10 rests on `git show` working and `git diff` / `git ls-files` failing with a corrupt index (measured on git 2.43.0). If a CI git differs, N10 shows it by name; fix the fixture so that only the diff listing fails, never `diffStates`'s exit-code check.
- **Row 41 and `[P2]` changing.** They are the only existing rows edited, both because the spec changes the output and the wording they pin (plan decision 6); no other existing row's assertion changes. T-203 and T-302 predict them red and T-207 and T-306 green.
- **Renders drifting from the source.** They are only regenerated; T-305 checks that the regeneration touched only the two `cc-release` renders, and `harness-commands.test.js` compares them with a fresh render.
- **The shell that runs a printed command.** The commands are quoted for a POSIX shell and PowerShell, whose single-quoted strings are both literal (spec D6). The `--` separator and `--literal-pathspecs` are git's own, so a path is never read as an option or a pathspec pattern.
- **The long suite timing out the shell.** T-401 notes the duration; a timeout is not a red.
