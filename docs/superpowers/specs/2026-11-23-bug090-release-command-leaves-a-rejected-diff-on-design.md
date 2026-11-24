# BUG-090 — Release command leaves a rejected diff on package manifests without a discard-before-tooling warning

**Status:** Draft (pending independent review)

**Item:** `[BUG-090]` (intake of issue #299, follow-up of `[FEAT-035]`). Pillar 5: infrastructure, ecosystem and
quality assurance.

The spec and the plan need an owner approval, not a delegated one: the change edits control-plane files
(`scripts/release.mjs`, `.claude/commands/cc-release.md` and its `project-template/` copy), which a delegated plan
review escalates (BUG-080), and it changes what the release command tells the owner to do with a diff written by an
agent that reads attacker-influenceable text.

## Problem

`/cc-release <version>` dispatches the `release` role, which edits the release surface (the profile's version
locations, the changelog and the bound backlog) in the work tree. `release.mjs check` then judges that diff. When it
rejects it, step 6 of `.claude/commands/cc-release.md` (line 30, and the identical `project-template/` copy) lists the
failure lines, says the diff is left in place, and only suggests `discard it with git checkout -- <files>`.

The release surface usually includes package manifests: this repository's own surface is
`VERSION, package.json, package-lock.json` plus the changelog and backlog. The release role reads commit subjects and
backlog text, which may be attacker-influenced, so a rejected diff can carry an injected npm lifecycle or test script,
or a new file outside the surface that tooling loads. `check` already rejects such a diff before it runs any profile
check (`judgeJsonFile` and the out-of-scope test in `scripts/release.mjs`), so nothing runs it inside the command. The
remaining risk is the owner's next step: running `npm install`, `npm test` or any other project tooling while the
rejected diff is still in the tree. Today nothing says that the order matters, and `<files>` is left for the owner
to work out, which is easy to get wrong for a new (untracked) file, on which `git checkout --` does nothing.

## Solution

`release.mjs check` itself tells the owner how to discard a rejected diff, and step 6 of `/cc-release` relays it. When
the judgment fails, `check` appends, after the failure lines it prints today:

1. one `RELEASE_DISCARD_FIRST` warning line when any rejected path (named by a `RELEASE_LOCATION_SHAPE`,
   `RELEASE_OUT_OF_SCOPE` or `RELEASE_PROFILE_CHANGED` line) is a control-plane path, saying that the diff must be
   discarded before running any project tooling; and
2. the exact commands that discard the whole diff (`DISCARD` lines), split by how git has to drop each path.

Step 6 of both copies of `cc-release.md` says plainly that a diff with a `RELEASE_DISCARD_FIRST` line must be discarded
before any project tooling runs, and shows the `DISCARD` commands verbatim for the owner to run. The command still
never runs, stages or reverts anything itself.

### Decisions this spec takes, and why

| # | Open point in the entry | Decision | Why |
|---|---|---|---|
| D1 | Where the warning and the command come from | `release.mjs check` prints them; the command file relays them | The paths and their git state are facts the driver already computes (`changedPaths`); a printed line is deterministic and pinned by `tests/scripts/release.test.js`, while prose asking the session to assemble a command is neither. It matches how every other `/cc-release` outcome is a driver line the command shows. |
| D2 | What "another control-plane path" means | A path matched by `CONTROL_PLANE` or whose last segment is in `CONTROL_PLANE_NAMES` (`scripts/orchestrate.mjs`), with the same case folding as the existing matcher | It is the repository's one definition of "files that run code or steer the run", set by owner decisions BUG-080/081/082/085. It already lists `package.json`, `package-lock.json`, every other package manager's manifests and lockfiles, CI files, git hook runners and `.claude/release-profile.json`. A second list in `release.mjs` would drift from it. The list's membership is not changed here. |
| D3 | Which paths the discard commands name | Every path in the judged diff (`changedPaths`: tracked changes against `HEAD` plus untracked, non-ignored files), not only the ones a failure line names | A rejected release is redone from a clean tree (`digest` refuses a dirty one with `RELEASE_TREE_DIRTY`), so the owner has to drop the whole diff anyway; naming every path yields one set of commands that leaves the tree clean. It is a superset of "the rejected files" the entry asks for. |
| D4 | Commands per git state | Paths present in `HEAD`: `git checkout HEAD -- <paths>`. Paths in the index but not in `HEAD`: `git rm -f -- <paths>`. Untracked paths: `git clean -f -- <paths>` | `git checkout --` restores from the index and is a no-op on an untracked file, so the single form the command suggests today misses a new file, which is exactly the shape an injected out-of-scope config takes. `HEAD` as the source also undoes a staged change. Each form errors on paths of another state, hence the split. |
| D5 | When the warning line appears | Only when a rejected path is control-plane (D2); the `DISCARD` lines appear on every judgment failure with a non-empty diff | The entry scopes the warning to manifests and control-plane paths; a failure that names only the changelog or backlog shape leaves version files that passed `judgeJsonFile`, so the stronger wording there would be noise. The discard commands are useful on every failure. |
| D6 | Paths a shell line cannot carry safely | A path is quoted with the existing `shellQuote`. A path containing a control character (including a newline) or a single quote is left off every command and printed on its own `DISCARD_BY_HAND` line as a JSON string | A newline in a file name would split a printed command or forge a line of `check` output, and a single quote is the one character whose POSIX escape (`'\''`) does not carry over to PowerShell. The agent can create a file name; the printed commands must not be a way to inject one. |
| D7 | A `RELEASE_HALT` (a profile check went red after the judgment passed) | No `RELEASE_DISCARD_FIRST` and no `DISCARD` lines | The diff passed the judgment, so the tooling already ran on an accepted diff; the halt is a red check, not a rejected edit. Step 6 keeps saying the diff is left in place. |

## Behavior

### Main path

1. The owner runs `/cc-release 1.57.0`; the `release` agent edits the tree and, through some injected text, also adds a
   `postinstall` script to `package.json` and creates `.npmrc`.
2. Step 5 runs `release.mjs check`. The judgment fails; `check` prints, in order and exiting 1:
   - the failure lines it prints today, e.g.
     `release: RELEASE_OUT_OF_SCOPE: .npmrc is outside the release surface [VERSION, package.json, package-lock.json, CHANGELOG.md, AGENT-READABLE BACKLOG.md]`
     and `release: RELEASE_LOCATION_SHAPE: package.json <why>`;
   - `release: RELEASE_DISCARD_FIRST: the rejected diff touches .npmrc, package.json, which project tooling reads; discard the whole diff before running any package manager, test, build or hook command`
     (paths sorted, de-duplicated);
   - `release: DISCARD git checkout HEAD -- CHANGELOG.md VERSION package-lock.json package.json`
     (the tracked paths of the diff, sorted, each `shellQuote`d);
   - `release: DISCARD git clean -f -- .npmrc` (the untracked paths).
3. Step 6 shows the `RELEASE:` line, the `check` output and `git diff --stat`, says that the diff must be discarded
   before running any project tooling, and shows the two `DISCARD` commands to run as printed. It runs none of them.

### Alternative paths

- **Failure naming only non-control-plane paths** (e.g. `RELEASE_CHANGELOG_SHAPE`, or `RELEASE_OUT_OF_SCOPE: notes.txt`):
  no `RELEASE_DISCARD_FIRST` line; the `DISCARD` lines for the whole diff still print, and step 6 shows them as the way
  to discard the diff.
- **Only `RELEASE_PROFILE_CHANGED`**: `.claude/release-profile.json` is control-plane (it holds the commands `check`
  and `handoff` run), so the warning prints and the profile is on the `git checkout HEAD --` line.
- **A staged new file** (in the index, not in `HEAD`): it is named on a `git rm -f --` line.
- **A deleted tracked file**: it is in `HEAD`, so `git checkout HEAD --` restores it.
- **A path needing quotes** (a space, `$`, `;`): it appears `shellQuote`d on its command, so the printed line is safe to
  paste.
- **A path with a control character or a single quote**: it is on no command; a
  `release: DISCARD_BY_HAND "<JSON-escaped path>"` line names it, and the warning, when printed, names it in the same
  JSON form.
- **A judgment failure with an empty diff** (e.g. `RELEASE_RESULT_MISSING` after the agent edited nothing): no
  `RELEASE_DISCARD_FIRST` and no `DISCARD` lines.
- **`release: ok`, or a `RELEASE_HALT`**: unchanged output (D7).

### Error cases

- **`git` fails while classifying paths** (the `HEAD` or index lookup): `check` reports through the existing error
  path (`ReleaseError`, printed as `release: <message>`, non-zero exit) rather than printing a partial or wrong command.
- **The owner runs tooling anyway**: out of the command's control; the warning and the README line are the mitigation,
  and `check` still refuses the diff on a later run.

## Acceptance Criteria

- [ ] `check` on a rejected diff whose `RELEASE_LOCATION_SHAPE` line names `package.json` prints a
      `RELEASE_DISCARD_FIRST` line naming `package.json`, after every failure line, and exits 1.
- [ ] `check` on a rejected diff with a `RELEASE_OUT_OF_SCOPE` line naming a control-plane path (one row with a
      `CONTROL_PLANE` entry such as `.npmrc`, one with a nested `CONTROL_PLANE_NAMES` match such as
      `sub/package.json`) prints the `RELEASE_DISCARD_FIRST` line naming it.
- [ ] `check` failing on `RELEASE_PROFILE_CHANGED` alone prints the `RELEASE_DISCARD_FIRST` line.
- [ ] `check` failing only on non-control-plane paths (`RELEASE_OUT_OF_SCOPE: notes.txt`, or a changelog shape)
      prints no `RELEASE_DISCARD_FIRST` line but prints the `DISCARD` lines.
- [ ] The `DISCARD` lines name every path of the diff exactly once, sorted, with `git checkout HEAD --` for paths in
      `HEAD`, `git rm -f --` for staged paths not in `HEAD`, `git clean -f --` for untracked paths, and no line for an
      empty class.
- [ ] Running the printed `DISCARD` commands, verbatim, in the fixture repository leaves `git status --porcelain`
      empty.
- [ ] A path with a space is printed single-quoted on its command; a path with a newline or a single quote appears on
      no command and on one `DISCARD_BY_HAND` line as a JSON string.
- [ ] `release: ok`, `RELEASE_HALT` and a judgment failure with an empty diff print no `RELEASE_DISCARD_FIRST` and no
      `DISCARD` line; existing `check` rows keep passing.
- [ ] Step 6 of `.claude/commands/cc-release.md` and `project-template/.claude/commands/cc-release.md` (byte-identical,
      as `tests/installer/commands-parity.test.js` already requires) says that a diff with a `RELEASE_DISCARD_FIRST`
      line must be discarded before running any project tooling, says to show each `DISCARD` command exactly as
      printed, and still says the command never commits, stages, reverts or runs anything; a parity row pins the
      wording.
- [ ] `CONTROL_PLANE` and `CONTROL_PLANE_NAMES` are read from `scripts/orchestrate.mjs`, not copied: the
      `orchestrate.test.js` rows that pin both lists stay unchanged and green.
- [ ] `dependencies` in `package.json` stays `{}`; `npm test` is green.

## Out of Scope

- Running, staging or reverting anything from `/cc-release`: the command still only prints.
- Changing the membership of `CONTROL_PLANE` or `CONTROL_PLANE_NAMES`.
- The same step in `/cc-docs` (`docs.mjs check`), whose surface is documentation; a follow-up if wanted.
- Newline-safe printing of the existing failure lines (`RELEASE_OUT_OF_SCOPE` prints the raw path today); only the new
  lines get D6's treatment.
- Ignored files the agent might create: `changedPaths` uses `--exclude-standard`, so `check` does not see them today.
- The `README.md` "Known limits" line for `[BUG-090]` and every other record (`VERSION`, `CHANGELOG.md`, the
  backlog, memory): the release updates them.

## System Impact

- `scripts/release.mjs` — `checkVerb`/`judge` gain the discard lines; new small helpers to classify the diff's paths by
  git state and to format the commands; imports the control-plane matcher from `scripts/orchestrate.mjs` (needs an
  exported path-level predicate; `orchestrate.mjs` does not import `release.mjs`, so there is no cycle).
- `scripts/orchestrate.mjs` — export a path predicate built from the existing `CONTROL_PLANE`/`CONTROL_PLANE_NAMES`
  matcher, without changing either list or any current caller.
- `.claude/commands/cc-release.md` and `project-template/.claude/commands/cc-release.md` — step 6 wording.
- `tests/scripts/release.test.js` — new `[BUG-090]` rows in the `check` describe block, using the existing fixture
  helpers.
- `tests/installer/commands-parity.test.js` — one `[BUG-090]` row on step 6's wording in both mirrors.
- The installer already deploys both scripts to `.claude/scripts/`; the plan confirms the deployed `release.mjs` can
  import the deployed `orchestrate.mjs` (the ship test at `commands-parity.test.js:649`).

### Files Requiring Full Read (deferred to /cc-plan)

- `scripts/release.mjs` (970 lines): `changedPaths`, `scopeFailures`, `judgeVersionFiles`, `judge`, `checkVerb`,
  `shellQuote`, `ReleaseError`.
- `scripts/orchestrate.mjs` (only lines 20-100 and 1300-1360): `CONTROL_PLANE`, `CONTROL_PLANE_NAMES`,
  `globToRegExp`, `reachesList`, `namesControlFile`, `inControlPlane`, and its `invokedDirectly` guard (importing it
  must have no side effect).
- `tests/scripts/release.test.js` (the fixture helpers and the `check` block from line 718).
- `tests/installer/commands-parity.test.js` (the `cc-release` block from line 606).

## Complexity Estimate

S — one new output block in one verb of one script, an exported predicate over an existing matcher, one sentence in
two mirrored command files, and test rows in two existing suites.
