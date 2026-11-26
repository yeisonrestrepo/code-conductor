# BUG-095 — Release discard commands split paths containing spaces, commas or a leading @ in cmd.exe and PowerShell

**Status:** Approved 2026-11-25 by independent review (round 1)

**Item:** `[BUG-095]` (intake of issue #321, follow-up of `[BUG-090]`). Pillar 5: infrastructure, ecosystem and
quality assurance.

## Problem

After a rejected judgment, `node scripts/release.mjs check` prints `release: DISCARD <git command> <paths>` lines
that drop the whole diff, and a `release: DISCARD_BY_HAND "<path>"` line for each path it will not put on a command
(`[BUG-090]`). The release command shows those lines to the owner, who runs them from the project root in whatever
shell they use. `[BUG-090]` D6 (the comment above `byHand`, `scripts/release.mjs:673-675`) states the contract: a
printed command must mean the same in a POSIX shell, PowerShell and cmd.exe.

Which path goes where is decided by `byHand` (`scripts/release.mjs:676`, a control or non-ASCII character, or one of
`` ' " ` & | < > ^ % ``) and, for the paths left on a command, by `shellQuote` (`scripts/release.mjs:699-700`), which
prints a path bare when it matches `SAFE_ARGUMENT` (`^[A-Za-z0-9._/:=@%+,-]+$`) and POSIX-single-quotes it otherwise.
Three spellings break the contract:

- **A space.** `my notes.txt` is printed as `'my notes.txt'`. cmd.exe does not honour single quotes, so git receives
  the two pathspecs `'my` and `notes.txt'`.
- **A comma.** `a,b` matches `SAFE_ARGUMENT` and is printed bare. PowerShell parses a bare `a,b` as an array and
  passes `a` and `b` as two arguments.
- **A leading `@`.** `@x` is printed bare. PowerShell reads a bare `@x` as splatting the variable `$x`.

The space case is one instance of a wider gap: every path `shellQuote` quotes reaches git under cmd.exe with its
single quotes as literal characters, because cmd.exe passes them through. A quoted `'a$b'` is then the pathspec
`'a$b'`, which names a different file. `--literal-pathspecs` stops pathspec magic, and `git checkout` / `git rm`
abort when a pathspec matches nothing, so most of these runs fail without effect. But when the other spelling does
name a file, the command acts on that file. In the worst case `git rm -f` removes an unmodified tracked file that
was not part of the rejected diff. It can be restored from HEAD, but the printed line was supposed to touch only
the rejected diff.

The same spellings also make the `RELEASE_DISCARD_FIRST` warning unclear: it lists the control-plane paths it names
joined by `, ` (`pathName`, `scripts/release.mjs:681`), so a path `a, b` or `a,b` reads as two paths.

## Solution

A `DISCARD` command carries only paths that need no quoting in any of the three shells. A new predicate in
`scripts/release.mjs` takes over from `byHand` as the one test for "this path can be printed bare on a command line".
A path passes only when it is non-empty, every character is in `[A-Za-z0-9._/:=@+-]`, no segment starts with `@`, and
the path does not start with `-`. Every other path is left off every command and gets its own `DISCARD_BY_HAND` line
as the JSON string `jsonName` already builds. The `RELEASE_DISCARD_FIRST` warning uses the same predicate, so a path
it names is bare exactly when that path is bare on a command. `discardLines` no longer calls `shellQuote`.
`shellQuote`, `SAFE_ARGUMENT` and the handoff `STEP` lines do not change.

## Decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| D1 | Which of the issue's two fix shapes | Narrow the set of paths a command may carry to those printed bare, and send every other path to `DISCARD_BY_HAND`. The issue's narrower option (add space, comma and a leading-`@` segment to `byHand`, keep quoting the rest) is not taken | Quoting cannot meet D6: cmd.exe has no quote that also works the same way in POSIX shells and PowerShell. Under cmd.exe, a quoted path is a different pathspec (see Problem), so keeping any quoted path on a command keeps the defect the issue describes. With only bare paths on a command, every printed `DISCARD` line is a run of literal words that all three shells pass through unchanged. The cost is more `DISCARD_BY_HAND` lines for unusual file names (`$`, `;`, `!`, `(`, `#`, a space). A release diff rarely has those names, and the by-hand line already exists for them. |
| D2 | The bare set | `[A-Za-z0-9._/:=@+-]`: `SAFE_ARGUMENT` without `%` (already by hand: cmd.exe expands it) and without `,` (PowerShell array) | Each kept character is literal in a bare word in all three shells. `:` and `=` are not separators for an external program under cmd.exe, which passes the line to git as written. In PowerShell argument mode, `/`, `.`, `:`, `=`, `+` and `-` are literal inside a word. |
| D3 | `@` | Allowed inside a segment; a path with any segment starting with `@` is by hand | PowerShell treats `@` as special only at the start of a bare token. Each path is its own token after `--`, so only a leading `@` would splat. The rule covers every segment, as the issue asks: that is cheap, and an npm-scope name like `node_modules/@scope/x` is not something a release diff should carry anyway. |
| D4 | A leading `-` | A path starting with `-` is by hand | Windows PowerShell 5.1 is known to split a bare native argument that starts with `-` and contains `.` (`-x.txt` reaches the program as `-x` and `.txt`). git reads both as paths after `--`. Routing this rare spelling by hand removes the case without depending on the PowerShell version. |
| D5 | The `RELEASE_DISCARD_FIRST` warning | `pathName` uses the new predicate: a path that is not bare on a command is shown as its JSON string in the warning | The warning and the `DISCARD_BY_HAND` line then spell a path the same way, and the `, ` list cannot be misread when a path holds a comma or a space. |
| D6 | `shellQuote`, `SAFE_ARGUMENT`, the `STEP` lines | Unchanged; `discardLines` stops calling `shellQuote` | The issue names `SAFE_ARGUMENT` only because it decides how a discard path is printed. The handoff `STEP` lines quote argv from the release profile and are not part of this item. Narrowing `SAFE_ARGUMENT` would change their output with no reported defect behind it. |
| D7 | `[BUG-090]` AC7 (`:!x` and `--literal-pathspecs`) | `:!x` is now by hand (`!` is outside the bare set). The regression test keeps its purpose with a bare name that git would read as magic without `--literal-pathspecs`, e.g. the untracked file `x` inside a directory named `:` (path `:/x`, which as magic means "`x` at the top"), next to a tracked root `x` that must survive | The test exists to show that the printed commands act on the literal path. That guarantee still matters for bare paths, since `:` stays in the bare set. |

## Behavior

### Main path

1. `check` judges a diff and rejects it; `discardLines` lists the diff's paths by git state, as today.
2. Each path that passes the bare predicate goes on its state's `DISCARD` command, printed bare, sorted.
3. Each other path is on no command and on one `release: DISCARD_BY_HAND "<JSON-escaped path>"` line.
4. If the rejected diff touches a control-plane path, the `RELEASE_DISCARD_FIRST` warning names it bare when it
   passes the predicate and as its JSON string otherwise.

### Alternative paths

- **Every path is by hand:** no `DISCARD` command is printed, only `DISCARD_BY_HAND` lines (and the warning, when it
  applies). This already happens when a command would be empty.
- **A path with `@` inside a segment** (`a@b.txt`, `dir/a@b`): bare on its command.
- **A path with `:` or `=`** (`a:b`, `k=v.txt`, `:/x`): bare on its command; `--literal-pathspecs` keeps `:` literal.
- **A path that was single-quoted before** (a space, `$`, `;`, `!`, `(`, `#`, `*`, `~`, `\`): now by hand. Its
  `DISCARD_BY_HAND` line is its JSON string; `\` is escaped as `\\` (`JSON.stringify`, unchanged).

### Error cases

- git failing while listing the diff stays the `RELEASE_GIT_FAILED` refusal (`[BUG-090]` E1); no partial command is
  printed. Unchanged.
- No new error output.

## Acceptance Criteria

- [ ] **AC1** A rejected diff with an untracked `my notes.txt` prints no `DISCARD` command naming it and exactly one
      `release: DISCARD_BY_HAND "my notes.txt"` line.
- [ ] **AC2** The same holds for `a,b.txt` (`"a,b.txt"`), for `@x.txt` (`"@x.txt"`) and for `dir/@x.txt`
      (`"dir/@x.txt"`), each an `[AC8]` case in `tests/scripts/release.test.js`.
- [ ] **AC3** The same holds for `-x.txt` (`"-x.txt"`) and for one path a POSIX shell needed quoting for, `a$b.txt`
      (`"a$b.txt"`).
- [ ] **AC4** `a@b.txt` is printed bare on its `DISCARD` command and on no `DISCARD_BY_HAND` line.
- [ ] **AC5** No printed `DISCARD` line contains `'` or `"`; each path on it matches the bare predicate.
- [ ] **AC6** A control-plane path that is not bare is named by its JSON string in the `RELEASE_DISCARD_FIRST`
      warning, e.g. a rejected out-of-scope `a,b/package.json` reads `the rejected diff touches "a,b/package.json"`.
- [ ] **AC7** The `[BUG-090]` AC7 regression keeps its purpose with a bare magic-looking name (D7): running the
      printed commands removes the untracked `:/x`, leaves the tracked root `x` and a file created after `check`.
- [ ] **AC8** The earlier `[AC8]` test that expected `'my notes.txt'` single-quoted on a command now expects AC1.
      The single-quote, newline, U+009B, U+2019, `&` and U+202E cases pass unchanged.
- [ ] **AC9** `[BUG-090]` AC5, AC6 and AC9 pass unchanged: plain names still share one command per git state,
      sorted, and running the commands leaves `git status --porcelain` empty.
- [ ] **AC10** The `STEP` lines are unchanged: the existing handoff tests pass without edits, and `shellQuote` and
      `SAFE_ARGUMENT` are byte-identical.
- [ ] **AC11** The D6 comment above the predicate says why a command carries only bare paths (cmd.exe has no
      quoting that carries over, PowerShell's `,`, leading `@` and leading `-`).
- [ ] **AC12** `dependencies` in `package.json` stays `{}`; `npm test` is green.

## Out of Scope

- `shellQuote`, `SAFE_ARGUMENT` and the handoff `STEP` lines (D6).
- The step-6 text of `cc-release.md` and its three copies. It already says to show each `DISCARD` command as printed
  and to handle each `DISCARD_BY_HAND` path by hand, which stays true, so the `[BUG-090]` AC10 phrases stand.
- The raw path in `RELEASE_OUT_OF_SCOPE` and other judgment lines (`[BUG-090]` Out of Scope).
- The `README.md` "Known limits" bullet for `[BUG-095]` and every other record (`VERSION`, `CHANGELOG.md`, the
  backlog, memory): the release updates them.
- Making `DISCARD_BY_HAND` paths runnable (a per-shell command, `-z` input to git): no shell-neutral form exists, and
  `[BUG-090]` chose by-hand lines for that reason.

## System Impact

- `scripts/release.mjs`: `byHand` (line 676) is replaced by, or rewritten as, the bare predicate; `pathName`
  (line 681) and `discardLines` (lines 686-695) use it; `discardLines` prints the bare path instead of
  `shellQuote(p)`, and the comment at line 684 about `shellQuote` being defined below goes away. The D6 comment
  (lines 673-675) is rewritten (AC11).
- `tests/scripts/release.test.js`: the `[AC7]` test (line 941) and the space half of the first `[AC8]` test
  (line 952) change, and new `[AC8]` cases cover AC1-AC6.
- No other module calls `byHand` or `pathName` (they are not exported). The `isControlPlanePath` export and
  `CONTROL_PLANE` are not touched.

### Files Requiring Full Read (deferred to /cc-plan)

- `scripts/release.mjs` (1008 lines): only lines 640-760 were read; `/cc-plan` reads the `discardLines` callers and
  the `release.check` output path around the judgment.
- `tests/scripts/release.test.js`: the fixture helpers (`release1`, `put`, `check`, `CP`) above line 859.

## Complexity Estimate

S. It is one predicate and two call sites in one file, plus test cases in one test file, with no new output line kind.
