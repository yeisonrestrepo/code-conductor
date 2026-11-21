# BUG-074 — Role definitions disagree on what done means for a task's tests

**Status:** Draft (pending independent review)

**Item:** `[BUG-074]` (intake of issue #177). Pillar 5: infrastructure, ecosystem and quality assurance.

The spec and the plan need an owner approval, not a delegated one: the change edits control-plane files
(`.claude/agents/*.md`, `.claude/commands/cc-orchestrate.md`, `scripts/orchestrate.mjs`), which a delegated plan
review escalates (BUG-080), and it lets `qa` pass a suite that exits non-zero when the owner declared the failures,
which relaxes the Verify gate. The owner's answers to the questions this spec raised are recorded in
[Owner decisions](#owner-decisions), and the text below follows them.

## Problem

Three role profiles state three different gates for the same suite result:

- `.claude/agents/code.md:20`: the success condition is that the test command ran after the last edit and the report
  states its exit status and summary line. "A red suite is reported as red; the gate claims only that the run
  happened and was reported." `code.md:12` also tells it to tick the task's checkboxes "when the task is done", with
  no test condition, so a red task is ticked and handed back `build_executed`.
- `.claude/agents/plan.md:12`: "Order the tasks so that each one ends with the suite green." Under this rule a task
  whose suite is red is not done.
- `.claude/agents/qa.md:20`: the suite passes only when the command exits 0; anything else is a fail and `qa` leaves
  out its hand-back.

The router does not read the code role's exit status at all: `handback code` advances `tasks.done`
(`scripts/orchestrate.mjs:678`) on any valid `build_executed`. So a red task moves the run forward, every later task
builds on a red base, and the run only stops at `qa`, the last position, with `ORCH_HANDBACK_MISSING`
(`scripts/orchestrate.mjs:685`) and no record of which task turned the suite red. The issue's proof of concept: one
deliberately failing test, `npm test` exits 1 (1 failed, 2308 passed); under `code.md` that is `build_executed` with
the boxes ticked, under `plan.md` the task is not done, under `qa.md` the run can never reach `verify_pass`. Live runs
match: tasks handed back on red suites, and a run that ended without `qa`.

There is also no way to say "this failure was already there". A failure present at the base (issue #118 made every
live run exit 1) makes every run unfinishable under `qa.md`, and under `code.md` it hides any new failure a task adds
behind a suite that was red anyway.

Separately, the dispatch brief template (`.claude/commands/cc-orchestrate.md:190`) tells every role "Verify your work
before you hand back." `spec`, `plan` and `audit` have no shell (Guard 7, `ROLE_SHELL_DENIED`), so for three of the
seven roles the line asks for something they cannot do, and for `code` and `qa` it competes with the fixed success
condition their profiles state ("Do not substitute a stricter or different standard of your own").

## Solution

Write one definition of a green suite and put it, word for word, in the three profiles that judge a suite: `plan`,
`code` and `qa`. The sentence is:

> The suite is green when the test command exits with status 0, or when it exits non-zero and every failing test it
> reports is a known failure the run declared; anything else is red.

`code` ticks its task's boxes and hands back `build_executed` only when the suite is green after its last edit; on a
red suite it ticks nothing, leaves out its `SNAP_HANDBACK` line and says why, as `qa` already does. `qa` hands back
`verify_pass` only when the suite is green. `plan` keeps ordering tasks so each ends green, now by that definition.
Known failures are declared by the owner when the run starts, with a repeatable `start --known-failure <text>` flag;
`start` records them in the run file as `known_failures`, where `code` and `qa` read them next to `test_command`. The
orchestrator passes `--known-failure` to `start` only as it appears in `$ARGUMENTS`, verbatim, and never adds, edits or
drops one itself. A value with spaces or shell characters reaches `start` whole only when the owner quotes it, so the
orchestrator checks `$ARGUMENTS` before it runs `start` and refuses to run it on an unquoted shell character, and the
start line echoes every recorded value so a value cut short is visible (decision 7). When `known_failures` is non-empty, the run's final report repeats each declared entry with the
failing tests it matched in `qa`'s run, so a green on a non-zero exit is never silent. The
dispatch brief's "Verify your work before you hand back." becomes "Check your work against your success condition
before you hand back.", which every role can do. No gate, position, router step or SNAP field changes: a red `code`
report halts through the existing `ORCH_HANDBACK_MISSING` path, exactly as a red `qa` report does today.

### Decisions this spec takes, and why

1. **Exit status 0 stays the base of "green".** It is what `qa`, the authoritative run, already uses, and what
   `plan` already assumes. Loosening `qa` to "ran and reported" would make `verify_pass` meaningless; tightening only
   `code` without a declaration path would make #118-style failures block every run. The one exception is the owner's
   declaration, never the role's judgment.
2. **A red `code` report carries no hand-back.** That is the only way to stop the router advancing `tasks.done` without
   changing the router: `handback code` already halts `ORCH_HANDBACK_MISSING` on a report with no `SNAP_HANDBACK` line,
   and the orchestrator already follows "On any halt" for it. The halt now names the task that turned the suite red,
   instead of surfacing at `qa`. A hand-back on red with unticked boxes was rejected: the router advances on the
   hand-back, not on the boxes, so it would reproduce the bug.
3. **Known failures are declared per run, by the owner, at `start`.** The run file is in the orchestrator's write
   surface, which Guard 6 keeps every role from writing, so no role can declare its own failure as known. A tracked
   project file was rejected for that reason: a plan task could name it and a `code` agent could write to it. The
   orchestrator is held to the same rule: it passes `$ARGUMENTS` to `start` verbatim, as it already does for
   `--unattended`, and never adds, edits or drops a `--known-failure` itself, including after a red `code` halt, where
   it stops and names the failing tests for the owner. The declaration is visible in the start line, in the run record
   and in the final report.
4. **A failing test is known when the runner's failure line for it contains a declared entry verbatim.** Runners print
   a failing test as a line naming its file and its title (vitest: `FAIL  tests/x.test.js > suite > title`). Matching by
   substring lets the owner declare a whole file or one test title, and is a judgment `code` and `qa` can make from the
   output alone. A non-zero exit that reports no failing test (a crash, a collection error, a timeout) is red, because
   no failing test is there to match.
5. **Outside a run there are no known failures.** `/cc-test` dispatches `qa` with `mem.p.test_command` only; it keeps
   exit-0-only. Declaring known failures outside a run is left to a later item if anyone asks for it.
6. **The sentence is duplicated, not referenced.** Each profile is the agent's whole instruction; an agent does not
   read the others. A test pins the identical sentence in all three, in both agent directories, so it cannot drift.
7. **The owner quotes a value; the orchestrator refuses an unquoted shell character; `start` echoes what it got.** The
   Start step runs `node "$S/orchestrate.mjs" start $ARGUMENTS` through the shell, so an unquoted `>` in
   `--known-failure tests/x.test.js > suite > title` is a redirection: `start` would receive only `tests/x.test.js`,
   declare the whole file, and write its start line to a file named `title`. Quoting the value for the owner would
   break the verbatim rule (owner decision 1), so the fix is three layers that keep it:
   - **The rule.** A `--known-failure` value that contains a space or any of these shell characters:
     `>` `<` `|` `;` `&` `$` `` ` `` `(` `)` `*` `?` `[` `]` `#` `~` `\`,
     must be quoted by the owner, in single quotes (`'tests/x.test.js > suite > title'`) or double quotes. The Start
     step, the title line's usage text and README's command row say so.
   - **The orchestrator's check.** Before it runs `start`, the orchestrator reads `$ARGUMENTS` and, if any of those
     characters stands outside a quoted span, it does not run `start`: it shows the owner `$ARGUMENTS`, names the
     character, and asks them to quote the value. It never adds the quotes itself. This is a refusal, not an edit, so
     `$ARGUMENTS` still reaches `start` verbatim or not at all. The same check holds with or without
     `--known-failure`: no flag `start` accepts takes such a character, so an unquoted one is always a mistake.
     The item must match `^[A-Z]+-\d{3,}$`, and `--ticket` takes a number or an issue URL that must match
     `ISSUE_URL_RE` (`scripts/ticket.mjs:26`, `https://github.com/<owner>/<repo>/issues/<n>`), so the check refuses no
     valid run.
   - **`start`'s echo.** The start line's segment is `; known failures: <k> <values>`, with `<values>` the recorded
     list as a JSON array, so the owner sees in the start line and the run header exactly what was declared, and a
     value the shell cut short shows as cut short. If the orchestrator's check is missed and the shell redirects the
     output, `start` prints nothing to the session; the Start step treats a `start` that exits 0 with an empty stdout
     as a halt: it runs `end` and tells the owner the shell consumed part of the arguments. After `end`, it also shows
     the owner `git status --short` and names each redirect target in `$ARGUMENTS` (the word after an unquoted `>` or
     `>>`) that the shell created or overwrote; it restores or deletes none of them, because which file to keep is the
     owner's call.
   A value the shell splits on an unquoted space (`--known-failure tests/x.test.js isolated store`, if the check is
   missed) fails safe: `start` sees `isolated` as an unknown argument and refuses with `START_USAGE`, writing nothing.
   A value that starts with `--` is refused with `START_USAGE`, so a missing value never swallows the next flag
   (`--known-failure --auto` is a usage error, not a declaration of `--auto`).

## Behavior

### Main path

1. The owner starts a run, optionally declaring known failures:
   `/cc-orchestrate BUG-074 --known-failure 'tests/contract/x.test.js > isolated store'`, the value quoted because it
   holds spaces and `>` (decision 7). The orchestrator checks `$ARGUMENTS` for an unquoted shell character, finds none,
   and runs `node "$S/orchestrate.mjs" start BUG-074 --known-failure 'tests/contract/x.test.js > isolated store'`.
   `start` validates each value, records `known_failures: ["tests/contract/x.test.js > isolated store"]` in
   `.claude/memory/orchestrator-run.json`, and appends `; known failures: 1 ["tests/contract/x.test.js > isolated store"]`
   to its start line. The segment comes after the security segment and the role-models segment (and its `; note:`), and
   before `; unattended: …`, which stays last. With no flag it records `known_failures: []` and prints no new segment, so
   the start line is byte-identical to today's.
2. `plan` writes tasks ordered so each ends with the suite green, by the shared sentence.
3. For each task, `code` implements it, runs the test command once after its last edit, and reads the exit status and
   output:
   - exit 0: green. It ticks the task's boxes, reports the exit status and summary line, and hands back
     `build_executed`.
   - exit non-zero, and every failing test the output reports matches a declared entry: green. Same as above, and the
     report also lists each failing test with the entry it matched.
4. After audit and security, `qa` runs the test command and applies the same sentence: green hands back
   `verify_pass` with the exit status, summary line and, when non-zero, each failing test with its matched entry.
5. Every role's brief ends with "Check your work against your success condition before you hand back."
6. After `end`, the orchestrator's report names, when the record's `known_failures` is non-empty, each declared entry
   with the failing tests `qa`'s report (`.conductor/handback/qa.txt`) matched to it, or that it matched none. With
   `known_failures: []` the report has no such part.

### Alternative paths

- **A task turns the suite red.** `code` ticks no box, leaves out its `SNAP_HANDBACK` line, and says why, quoting the
  summary line and naming each failing test that matched no declared entry. The orchestrator writes the report to
  `.conductor/handback/code-<N>.txt` as always; `handback code` halts `ORCH_HANDBACK_MISSING`; the orchestrator
  follows "On any halt", names that file and the failing tests the report names, and stops. It never restarts the run
  with a `--known-failure` of its own. Recovery is the existing one: `resume` (keeps the earlier tasks'
  hand-backs) or `end`, then `start`, on the owner's word.
- **A fix round leaves the suite red.** Same as above for `code-fix-<r>.txt`; a fix round ticks no boxes in any case.
- **The suite is red at the base and the owner did not declare it.** The first `code` task halts. The owner reads the
  report, which names the failing tests, and restarts with `end`, then `start … --known-failure <text>` in their own
  start arguments; the orchestrator does not compose that restart, and the run file of a live or resumed run is not
  edited to add one.
- **A declared known failure stops failing.** Nothing changes: exit 0 is green. A declared entry matching no failure is
  never an error.
- **A declared entry matches a new failure** (for example, a whole file is declared and a task breaks another test in
  it). That failure is green by the sentence. This is the cost of declaring at file granularity, and the start line
  and the report's matched-entry list make it visible; the owner can declare the test title instead.
- **A run file written before this item** has no `known_failures` field. It is read as no known failures: exit-0-only,
  which is `qa`'s behavior today. `resume` keeps the field as it is.
- **Outside a run** (`/cc-test`, `qa` with `mem.p.test_command`): no known failures, exit-0-only.
- **Unattended runs** behave the same; the declaration is part of the owner's `start` arguments, passed verbatim.
- **The owner leaves a value unquoted.** With a shell character in it, the orchestrator does not run `start`; it shows
  `$ARGUMENTS`, names the character, and asks the owner to quote the value (decision 7). With only spaces, the same
  check applies; if it is missed, the split value fails safe with `START_USAGE`. If a redirection still gets through,
  `start` exits 0 with an empty stdout, and the orchestrator runs `end`, tells the owner the arguments were cut, shows
  `git status --short`, and names each redirect target in `$ARGUMENTS` the shell created or overwrote, restoring or
  deleting none of them.

### Error cases

- `start --known-failure` with no value, an empty or whitespace-only value, a value containing a line break, a value
  longer than 200 characters, a value that starts with `--`, or a value repeated: `start` refuses with its usage line (`START_USAGE`), exit 2, and
  writes nothing, as it does for every other malformed flag today.
- A run file whose `known_failures` is present but is not an array of non-empty strings: the run file fails validation
  the way any other malformed field does, so `install` and `handback` treat it as an invalid run file. No role decides
  what a malformed list means.
- The test command exits non-zero and the output names no failing test (crash, collection error, killed by a timeout):
  red, for `code` and for `qa`.
- `code` or `qa` cannot tell whether a failing test matches an entry: red. The sentence makes the declared list the
  only exception, so doubt resolves to the rule.
- A role's report claims green with a non-zero exit but lists no matched entries: the hand-back is still recorded,
  because the router does not parse test output (README "Known limits": a gate certifies the claim its role states).
  The report shows the gap, and `qa`'s own run is the authoritative one.

## Acceptance Criteria

Each criterion answers the backlog entry: one definition of done shared by `plan`, `code` and `qa` (AC1-AC4), a way to
declare known pre-existing failures (AC5-AC7), the brief template (AC8), and no change to the band flow or the SNAP
contract (AC9).

- [ ] **AC1.** `.claude/agents/plan.md`, `code.md` and `qa.md`, and their `project-template/.claude/agents/` copies,
  each contain the shared sentence verbatim; a test in `tests/unit/role-profiles.test.js` pins it in all six files.
- [ ] **AC2.** `code.md`'s success condition requires a green suite after the last edit, and says that on a red suite
  `code` ticks no box, leaves out its `SNAP_HANDBACK` line and says why, quoting the summary line. The sentence "the
  gate claims only that the run happened and was reported" is gone, and `code.md` ticks boxes only when the suite is
  green. A test pins both, and pins the absence of the removed sentence.
- [ ] **AC3.** `qa.md`'s success condition is "you ran the test command yourself and the suite is green", with
  `verify_pass` only when green, and the report lists each failing test with its matched entry when the exit status
  is non-zero. A test pins it.
- [ ] **AC4.** `plan.md` keeps ordering tasks so each ends green, and its green is the shared sentence (AC1).
- [ ] **AC5.** `start --known-failure <text>` is accepted any number of times in any position after the item, records
  the values in order as the run file's `known_failures`, and appends `; known failures: <k> <JSON array of the values>`
  to the start line, after the role-models segment and before `; unattended: …`; with no flag the run file records
  `known_failures: []` and the start line is unchanged. Tests in `tests/scripts/orchestrate.test.js` cover zero, one
  and two values, one value holding spaces and `>` passed as one argument (recorded and echoed byte for byte), and the
  segment's position in a run with role models and `--unattended`.
- [ ] **AC6.** `start` refuses with `START_USAGE`, exit 2 and nothing written for a missing value, an empty or
  whitespace-only value, a line break, a value over 200 characters, a value that starts with `--` (for example
  `--known-failure --auto`), and a repeated value. A test covers each, and one more passes the arguments as the shell
  splits an unquoted value with spaces (`--known-failure`, `tests/x.test.js`, `isolated`, `store`) and expects
  `START_USAGE` with nothing written.
- [ ] **AC7.** A run file with no `known_failures` field still validates (read as none); one with a non-array or a
  non-string or empty entry does not. `resume` keeps the field. `code.md` and `qa.md` name the run file's
  `known_failures` field as where the declared failures are, and `qa.md` says that outside a run there are none.
  Tests cover the validation and `resume`.
- [ ] **AC8.** The dispatch brief in `.claude/commands/cc-orchestrate.md` and its `project-template` copy no longer
  contain "Verify your work"; they contain "Check your work against your success condition before you hand back."
  The dispatch table's `code`, `code` (fix round) and `qa` rows state the red-suite rule, the Start step documents
  `--known-failure`, the title line and README's command table list the flag with the quoting rule of decision 7, and "On any halt" names
  `.conductor/handback/code-<N>.txt` (or `code-fix-<r>.txt`) as what the owner reads after a red `code` report, with
  the failing tests it names. The Start step says `--known-failure` comes only from `$ARGUMENTS`, passed verbatim, and
  that the orchestrator never adds, edits or drops one, including after a red `code` halt; it states the quoting rule,
  the orchestrator's check (no `start` on an unquoted shell character in `$ARGUMENTS`, quotes never added for the
  owner), the halt on a `start` that exits 0 with an empty stdout (after `end`, `git status --short` and each redirect
  target in `$ARGUMENTS` the shell created or overwrote, named and neither restored nor deleted), and that the run header prints the known-failures
  segment. The Report step names, when
  the record's `known_failures` is non-empty, each declared entry with the failing tests it matched in `qa`'s report.
  `tests/installer/commands-parity.test.js` pins the new brief line, the removed one, the usage text, the verbatim
  rule, the quoting rule with the orchestrator's check, the empty-stdout halt with its `git status --short` and
  redirect-target lines, and the Report item.
- [ ] **AC9.** No gate, router position or SNAP field is added or changed: `MAY_HAND_BACK`, `nextStep` and
  `scripts/snap-contract.mjs` are untouched, `code.md` still names only `build_executed` and `qa.md` only
  `verify_pass`, and the existing hand-back and SNAP tests pass unchanged.
- [ ] **AC10.** Every profile stays at most 999 tokens; the `.claude/agents` mirror stays byte-identical; the
  `PROFILE_SHA256_1_37_0` rows for `code`, `plan` and `qa` are updated in the same commit with a comment naming
  BUG-074, and the `audit`, `spec`, `security` and `define-review` profiles are byte-unchanged.
- [ ] **AC11.** `npm test` exits 0.

## Out of Scope

- The `[BUG-074]` line in README's "Known limits": a release record, written by the release.
- `VERSION`, `CHANGELOG.md`, the backlog and `.claude/memory/**`.
- Making the router parse test output or exit statuses: the claim stays the role's, as the README's gate-semantics
  limit already states.
- Declaring known failures outside a run, or editing them in a live or resumed run.
- The `audit`, `spec`, `security` and `define-review` profiles, and any change to the review loop or the delegated
  review briefs.
- Fixing #118 or any specific failing test.
- Any change under `.github/`.

## System Impact

- `.claude/agents/code.md`, `qa.md`, `plan.md` and their `project-template/.claude/agents/` copies: the shared
  sentence, the success conditions (AC1-AC4, AC7).
- `scripts/orchestrate.mjs`: `parseStartArgs` and `START_USAGE` (`:1470`-`:1490`), the run-file write in `start`
  (`:1525`), the start line (`:1531`, the new segment between `modelsNote` and `UNATTENDED_NOTE`), and `isValidRun` (`:221`), which `install`, `handback` and `resume` read through `readRun`.
- `.claude/commands/cc-orchestrate.md` and its `project-template` copy: title line, Start step (the verbatim rule),
  "On any halt", the Report step (the matched-entry list), the dispatch brief and the dispatch table (AC8).
- `README.md`: the `/cc-orchestrate` row of the command table (`:260`). Not the "Known limits" lines.
- Tests: `tests/unit/role-profiles.test.js` (`CLAIM`, sha pins, new pins), `tests/scripts/orchestrate.test.js`
  (`START_USAGE` constant at `:19`, new start and validation cases), `tests/installer/commands-parity.test.js`
  (usage text at `:276` and `:318`, brief line), and `tests/hooks/guard7.test.js` if it matches the start line whole.
- Guard 7 is unaffected: the test command and its byte-for-byte rule do not change, and `known_failures` is data,
  never a command.

### Files Requiring Full Read (deferred to /cc-plan)

- `scripts/orchestrate.mjs`: `isValidRun` (`:221`) and `resume`'s copy of the run record, which this spec located
  only by the fields `start` writes.
- `tests/scripts/orchestrate.test.js`: every assertion that matches a whole start line or a whole run file, which the
  new field and segment may touch.

## Complexity Estimate

M — the profile and brief edits are small, but the change spans three profiles with mirrors and sha pins, one new
`start` flag with validation and run-file plumbing, and the orchestrator command text with its parity tests.

## Owner decisions

1. **How known failures are declared: option (a).** Known failures come only from the owner's start arguments,
   through `start --known-failure <text>`, recorded in the run file that no role can write. The orchestrator passes
   `--known-failure` only when it is in `$ARGUMENTS` verbatim, and never adds, edits or drops one itself, including
   after a red `code` halt, where it stops and names the failing tests for the owner. The rejected options were a
   tracked project file (writable by a `code` task) and no declaration at all (does not meet the backlog entry).
2. **Whether `qa` may pass a non-zero exit: yes, with one shared sentence for `plan`, `code` and `qa`.** When
   `known_failures` is non-empty, the run's final report repeats each declared entry with the failing tests it matched
   in `qa`'s run, so a green on a non-zero exit is never silent. The rejected option kept `qa` exit-0-only.
3. **The rest of the spec stands as proposed**, including substring matching on the runner's failure line, red on a
   non-zero exit with no failing test named, `known_failures: []` with a byte-identical start line when the flag is
   absent, a run file written before this item read as none, `/cc-test` staying exit-0-only, and no change to gates,
   router positions or the SNAP contract.
4. **Decision 7 is approved, including the orchestrator's check on every run.** No value any `start` flag accepts
   today can hold those characters: the item matches `^[A-Z]+-\d{3,}$`, and `--ticket` takes only an issue URL of
   the form `https://github.com/<owner>/<repo>/issues/<n>` (`ISSUE_URL_RE`) or its number. The check therefore refuses
   no valid run, with or without `--known-failure`.
5. **The empty-stdout halt also reports what the shell wrote.** After it runs `end`, the orchestrator shows the owner
   `git status --short` and names each redirect target from `$ARGUMENTS` that the shell created or overwrote, and it
   restores or deletes none of them. This is in the Start step text and in its `commands-parity` pin (AC8).
6. **Everything else stands as written**, including the shared green sentence, the red `code` report with no
   hand-back, the JSON echo in the start-line segment and its position before `; unattended: …`, and AC1-AC11.
