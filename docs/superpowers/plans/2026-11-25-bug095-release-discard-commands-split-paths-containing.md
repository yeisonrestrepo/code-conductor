# BUG-095: release discard commands carry only shell-neutral bare paths, implementation plan

**Goal:** after a rejected judgment, every printed `release: DISCARD` command carries only paths that need no quoting
in a POSIX shell, PowerShell or cmd.exe. Every other path (a space, a comma, a segment starting with `@`, a leading
`-`, any character a POSIX shell would have needed quoted) is on no command and on one `release: DISCARD_BY_HAND`
line, and the `RELEASE_DISCARD_FIRST` warning names it by the same JSON string.

**Architecture:** one new module-private predicate in `scripts/release.mjs`, `bareOnCommand`, replaces `byHand` as
the single test for "this path can be printed bare on a command line". `pathName` and `discardLines` use it;
`discardLines` prints bare paths joined by a space and no longer calls `shellQuote`. `shellQuote`, `SAFE_ARGUMENT`,
`shellLine` and the handoff `STEP` lines are byte-identical. No new output line kind.

**Tech stack:** Node ESM, `node:` builtins only, vitest. Test command: `npm test`.

**Spec:** `docs/superpowers/specs/2026-11-25-bug095-release-discard-commands-split-paths-containing-design.md`
(approved by independent review, round 1; sha256 `14b5feab2232f4ee8df9dfb692404fb44cd57b9b0d8e8c33485aedd52fbdd3a8`).

## Global constraints

- Records are not touched: `VERSION`, `package.json`/`package-lock.json` versions, `CHANGELOG.md`, the backlog,
  `.claude/memory/**`, the README "Known limits" lines.
- No new dependency; `dependencies` stays `{}`. No workflow file is touched.
- No protected surface is touched: no hook, installer, SNAP script, template or settings file. `scripts/release.mjs`
  is the release command's script, exercised only through `tests/scripts/release.test.js`.
- `cc-release.md` and its copies are not edited (spec, Out of Scope).
- Never bare `git add -u`; every staging step names its paths.

## Decisions this plan takes (technical, inside the spec)

1. **The predicate is a regex plus two guards, not one regex.**
   `const BARE_PATH = /^[A-Za-z0-9._/:=@+-]+$/;` and
   `const bareOnCommand = (path) => BARE_PATH.test(path) && !path.startsWith('-') && !path.split('/').some((s) => s.startsWith('@'));`
   The `+` makes the empty path fail (spec: "non-empty"). A single lookahead regex would do the same but reads worse;
   the two guards name the spec's D3 and D4 rules one to one. `BARE_PATH` is new and separate from `SAFE_ARGUMENT`,
   which stays byte-identical (spec D6, AC10).
2. **`byHand` is removed, not kept as a negation.** Its three call sites become `bareOnCommand` / `!bareOnCommand`;
   keeping both names would leave two predicates for one rule. Neither is exported, so no other module changes
   (spec, System Impact).
3. **The `:/x` regression (spec D7, AC7) commits a tracked root `x` before the release edits.** The test runs
   `project()`, then `put('x', 'x\n')` and `commit('chore: tracked x')`, then `applyRelease(...)`, so `x` is in HEAD
   and outside the diff. A commit after the `v1.0.0` tag is what `project()` already does (`feat: alpha work`), so the
   judgment is the same: only the untracked `:/x` is out of scope. The test is skipped on win32, as the `:!x` one was
   (`:` is not a valid file-name character there).
4. **The `:/x` test is green before the fix.** `:/x` already matches `SAFE_ARGUMENT` and is printed bare today, so the
   rewritten AC7 test pins the `--literal-pathspecs` guarantee for a bare magic-looking name; it does not show the
   BUG-095 defect. The red for the defect comes from the AC1-AC3, AC5 and AC6 cases.
5. **New spellings get their own `it.each`** (`[AC8] a path with %s is on no command and on one DISCARD_BY_HAND line
   (BUG-095)`) instead of new rows in the existing U+2019 / `&` / U+202E table, so the existing test identities and
   bodies stay as they are (spec AC8).
6. **AC5's "each path on it matches the bare predicate" is checked in the test with its own copy of the rule**
   (the regex plus the two guards), applied to each space-separated word after ` -- ` on every `DISCARD` line. The
   predicate is not exported only for the test (no speculative export).

---

- [X] [T-000] Task 0: commit the plan (done by the runner at the end of the plan session)
  - [X] [T-000-A] Add the leaf `!/docs/superpowers/plans/2026-11-25-bug095-release-discard-commands-split-paths-containing.md` to the `.gitignore` tracked-surface block in sorted position (after `2026-11-25-bug094-codex-guard-hook-fails-open-when-codex-starts.md`, before `2026-11-25-bug096-codex-legacy-hook-fingerprint-substring-match.md`).
  - [X] [T-000-B] `git add -f docs/superpowers/plans/2026-11-25-bug095-release-discard-commands-split-paths-containing.md` then `git add -u .gitignore`.
  - [X] [T-000-C] `git commit -m "docs: add the BUG-095 shell-neutral discard paths implementation plan [BUG-095]"`

### Task 1: discard commands carry only bare paths

**Files:**
- Modify: `scripts/release.mjs` (D6 comment at 673-675, `byHand` at 676, `pathName` at 681, the comment at 683-684,
  `discardLines` at 685-695)
- Test: `tests/scripts/release.test.js` (describe `release.mjs check discards a rejected diff [BUG-090]`, 852-1033)

**Interfaces:**
- `BARE_PATH = /^[A-Za-z0-9._/:=@+-]+$/` (module-private).
- `bareOnCommand(path)`: `true` only when `BARE_PATH.test(path)`, `path` does not start with `-`, and no `/`-separated
  segment starts with `@` (decision 1).
- `pathName(path)`: `bareOnCommand(path) ? path : jsonName(path)`.
- `discardLines(root, rejected)`: per state, `named = paths.filter((p) => states.get(p) === state && bareOnCommand(p))`
  and the line is `` `release: DISCARD ${command} ${named.join(' ')}` ``; the by-hand lines are
  `paths.filter((p) => !bareOnCommand(p))`, each `` `release: DISCARD_BY_HAND ${jsonName(p)}` ``. Order of lines and
  of paths unchanged (warning, then commands by `DISCARD_COMMANDS` order, then by-hand lines, all sorted).
- Comment above `BARE_PATH` / `bareOnCommand` (spec AC11) says why, e.g.: "BUG-090 D6, BUG-095: a printed command must
  mean the same in a POSIX shell, PowerShell and cmd.exe, and no quoting does that: cmd.exe keeps single quotes as
  part of the argument. So a command carries only paths that need no quoting: characters every shell keeps literal in
  a bare word, no `,` (a PowerShell array), no segment starting with `@` (PowerShell splatting) and no leading `-`
  (Windows PowerShell splits `-x.txt`). Every other path, a control or non-ASCII character included, goes to a
  DISCARD_BY_HAND line." The comment above `discardLines` drops its sentence about `shellQuote` being defined below.
- Unchanged: `jsonName`, `unicodeEscape`, `diffStates`, `DISCARD_COMMANDS`, `SAFE_ARGUMENT`, `shellQuote`, `shellLine`.

- [ ] [T-001] Tests, then the predicate
  - [ ] [T-001-A] Modify `tests/scripts/release.test.js`, test `[AC7] the printed commands remove an untracked :!x and keep a file created after check`: rename it `[AC7] the printed commands remove an untracked :/x and keep the tracked root x and a file created after check` (keep `it.skipIf(process.platform === 'win32')`); setup per decision 3 (`project()`, `put('x', 'x\n')`, `commit('chore: tracked x')`, `applyRelease({ v: V, items: ['FEAT-001'] })`, `put(':/x', 'x\n')`); expect `lines(r.out)` to contain `release: DISCARD git --literal-pathspecs clean -f -- :/x`; then `put('later.txt', 'x\n')`, `runDiscards(r.out)`; expect `:/x` gone, `x` present with `read('x') === 'x\n'`, `later.txt` present.
  - [ ] [T-001-B] Modify the test `[AC8] a path with a space is quoted and a path with a single quote is left to a DISCARD_BY_HAND line`: rename it `[AC8] a path with a space and a path with a single quote are each left to one DISCARD_BY_HAND line`; replace the `'my notes.txt'` command expectation with: `lines(r.out).filter((l) => l === 'release: DISCARD_BY_HAND "my notes.txt"')` has length 1 and no `discards(r.out)` line includes `notes.txt`. The two single-quote assertions stay as they are (spec AC1, AC8).
  - [ ] [T-001-C] Add, after the U+2019 / `&` / U+202E `it.each`, `it.each([['a comma', 'a,b.txt', '"a,b.txt"'], ['a leading @', '@x.txt', '"@x.txt"'], ['a segment starting with @', 'dir/@x.txt', '"dir/@x.txt"'], ['a leading -', '-x.txt', '"-x.txt"'], ['a $', 'a$b.txt', '"a$b.txt"']])('[AC8] a path with %s is on no command and on one DISCARD_BY_HAND line (BUG-095)', …)`: `release1()`, `put(path, 'x\n')`, `check()`; exactly one `release: DISCARD_BY_HAND ${json}` line; no `discards(r.out)` line includes `path` (spec AC2, AC3).
  - [ ] [T-001-D] Add `[AC8] a path with @ inside a segment stays bare on its command (BUG-095)`: `release1()`, `put('a@b.txt', 'x\n')`; `r.out` contains `release: DISCARD git --literal-pathspecs clean -f -- a@b.txt`; no line starting `release: DISCARD_BY_HAND` includes `a@b.txt` (spec AC4).
  - [ ] [T-001-E] Add `[AC8] no DISCARD command holds a quote, and every path on one is bare (BUG-095)`: `release1()`, then put each of `my notes.txt`, `a,b.txt`, `@x.txt`, `-x.txt`, `a$b.txt`, `a@b.txt`, `k=v.txt`; `check()`; `discards(r.out)` is non-empty; for each line, it contains neither `'` nor `"`, and each word of `line.split(' -- ')[1].split(' ')` satisfies the test's copy of the rule (decision 6) (spec AC5).
  - [ ] [T-001-F] Add `[AC8] a control-plane path that is not bare is named by its JSON string in the warning (BUG-095)`: `release1()`, `put('a,b/package.json', 'x\n')`, `check()`; `r.out` contains `release: RELEASE_DISCARD_FIRST: the rejected diff touches "a,b/package.json", ${CP}` and `release: DISCARD_BY_HAND "a,b/package.json"`; no `discards(r.out)` line includes `a,b/package.json` (spec AC6).
  - [ ] [T-001-G] Run `npx vitest run tests/scripts/release.test.js -t "discards a rejected diff"`. Expected (red, full match set of the filter): 28 tests, 8 FAIL, 20 PASS, the other 124 tests of the file skipped by the filter. FAIL: the rewritten space/single-quote `[AC8]` (the space path is single-quoted on a command), the five T-001-C rows (each path is bare or quoted on a command, and has no by-hand line), T-001-E (`'my notes.txt'` holds a quote) and T-001-F (the warning names `a,b/package.json` bare). PASS: `[AC1]`, both `[AC2]`, `[AC3]`, both `[AC4]`, `[AC5]`, `[AC6]`, the rewritten `[AC7]` (decision 4), the newline, U+009B, U+2019, `&` and U+202E `[AC8]` cases, the three `[AC9]` cases, `[E1]`, `[AC13]` and T-001-D (`a@b.txt` is already bare). Any other result halts the task.
  - [ ] [T-001-H] Modify `scripts/release.mjs` per Interfaces: rewrite the D6 comment (AC11); replace `byHand` with `BARE_PATH` and `bareOnCommand`; change `pathName`; drop the `shellQuote` sentence from the comment above `discardLines`; change `discardLines` to filter on `bareOnCommand`, join bare paths with a space and filter by-hand paths on `!bareOnCommand`.
  - [ ] [T-001-I] Run `grep -n "byHand\|shellQuote" scripts/release.mjs`. Expected: no `byHand`; `shellQuote` only on its definition line and in `shellLine` (it no longer appears in `discardLines`).
  - [ ] [T-001-J] Run `git diff origin/main -- scripts/release.mjs | grep -n "SAFE_ARGUMENT\|shellQuote = \|shellLine"`. Expected: no output (spec AC10: those lines are byte-identical).
  - [ ] [T-001-K] Run `npx vitest run tests/scripts/release.test.js`. Expected: all PASS, 152 tests (144 before plus 8 new: five T-001-C rows, T-001-D, T-001-E, T-001-F), the handoff describe unchanged (spec AC9, AC10).
  - [ ] [T-001-L] `git add -u scripts/release.mjs tests/scripts/release.test.js docs/superpowers/plans/2026-11-25-bug095-release-discard-commands-split-paths-containing.md`
  - [ ] [T-001-M] `git commit -m "fix: print only shell-neutral bare paths on release discard commands [BUG-095]"`

### Task 2: closeout

- [ ] [T-002] Full suite and scope check
  - [ ] [T-002-A] Run `npm test`. Expected: exit 0 (spec AC12); no new skip on Linux (no test added here uses a skip gate; the rewritten `[AC7]` keeps its win32 gate).
  - [ ] [T-002-B] `git diff origin/main --stat` lists only: `.gitignore`, the spec, this plan, `scripts/release.mjs`, `tests/scripts/release.test.js`. No record, no `package.json`, no `cc-release.md` copy. `node -e "console.log(JSON.stringify(require('./package.json').dependencies))"` prints `{}`.
  - [ ] [T-002-C] `git add -u docs/superpowers/plans/2026-11-25-bug095-release-discard-commands-split-paths-containing.md`
  - [ ] [T-002-D] `git commit -m "docs: close out the BUG-095 plan [BUG-095]"`

## Test list

- [ ] [T-003] `tests/scripts/release.test.js` (Task 1): an untracked `my notes.txt` is on no command and on one
  `DISCARD_BY_HAND "my notes.txt"` line, beside the unchanged `it's.txt` case; `a,b.txt`, `@x.txt`, `dir/@x.txt`,
  `-x.txt` and `a$b.txt` are each on no command and on one by-hand line with their JSON string; `a@b.txt` stays bare on
  its `clean` command; with all of those plus `k=v.txt` in one diff, no `DISCARD` line holds `'` or `"` and every word
  after ` -- ` is bare; a rejected `a,b/package.json` is named `"a,b/package.json"` in `RELEASE_DISCARD_FIRST`; the
  printed commands, run in bash, remove an untracked `:/x` and keep the tracked root `x` and a file created after
  `check` (not on win32). Existing `[AC1]`-`[AC6]`, `[AC9]`, `[E1]`, `[AC13]`, the remaining `[AC8]` cases and the
  handoff describe pass without edits.

## Commit order

1. Task 0, plan (runner, end of the plan session).
2. Task 1, tests then `scripts/release.mjs`.
3. Task 2, closeout.

In the build session the runner makes one commit of the whole tree; the commit steps above are its grouping guide and
are ticked when the runner's commit carries them.

## Identified risks

- **More by-hand lines.** Every path that was single-quoted before (`$`, `;`, `!`, `(`, `#`, a space, …) now gets a
  `DISCARD_BY_HAND` line. Accepted by the spec (D1); the release command's step 6 already handles those lines.
- **`k=v.txt` and `a:b` on cmd.exe.** cmd.exe passes `=` and `:` to an external program as written (spec D2). The
  T-001-E case pins `k=v.txt` as bare so a later narrowing of the set is deliberate.
- **The fixture commit in `[AC7]` could change the judgment.** If T-001-G shows the rewritten `[AC7]` failing on
  anything other than the discard line, read `r.out` before adjusting: the expected failure is only
  `RELEASE_OUT_OF_SCOPE` for `:/x`, and `x` is in HEAD, so it is not in the diff.
- **`-x.txt` as a fixture name.** `put` writes it through `writeFileSync(join(root, path))`, which never parses it as
  an option; `git ls-files --others` lists it as a path. No shell runs the by-hand cases.
- **Line numbers drift.** The cited lines are from `2f4e73da`; the build edits by the named functions and tests, not
  by line number.
