# BUG-074 One definition of done for a task's tests: implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** `plan`, `code` and `qa` share one sentence that says when a suite is green; `code` hands back `build_executed` and ticks boxes only on a green suite; `qa` hands back `verify_pass` only on a green suite; the owner can declare known pre-existing failures with a repeatable `start --known-failure <text>` flag, recorded in the run file as `known_failures`; and the dispatch brief asks every role to check its work against its success condition. No gate, router position or SNAP field changes.

**Spec:** `docs/superpowers/specs/2026-11-20-bug074-role-definitions-disagree-on-what-done-means-design.md` (sha256 `feda1063eaa4459174a2589f4928a6fd25e89e46aeaeb45e2c79e61abab4832e`). Issue #177.

**Approval:** the spec and the plan need an owner approval, not a delegated one (spec, line 7): the change edits control-plane files (`.claude/agents/*.md`, `.claude/commands/cc-orchestrate.md`, `scripts/orchestrate.mjs`) and lets `qa` pass a non-zero exit the owner declared.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>` and `-t '<pattern>'`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines (the `[BUG-074]` line at `README.md:501` included) stay untouched.
- **Fourteen files change, plus this plan and its `.gitignore` leaf:** `scripts/orchestrate.mjs`, `tests/scripts/orchestrate.test.js`, `.claude/agents/plan.md`, `.claude/agents/code.md`, `.claude/agents/qa.md`, their three `project-template/.claude/agents/` copies, `tests/unit/role-profiles.test.js`, `.claude/commands/cc-orchestrate.md`, `project-template/.claude/commands/cc-orchestrate.md`, `tests/installer/commands-parity.test.js`, `README.md` (the `/cc-orchestrate` command row only). That is the spec's System Impact list; `tests/hooks/guard7.test.js` is not touched, because it matches no start line (`grep -n started tests/hooks/guard7.test.js` is empty).
- Not touched (AC9): `MAY_HAND_BACK`, `nextStep`, `scripts/snap-contract.mjs`, the hooks (`.claude/hooks/pre-tool-use.mjs` reads only `run.test_command` from the run file, `:305`), the installer, settings, workflows, dependencies, and the `audit`, `spec`, `security` and `define-review` profiles (AC10).
- Every file this plan edits after Task 0 is already tracked and none sits under an ignored directory, so each is staged with `git add -u <path>`. This plan is new in Task 0 under the ignored `docs/superpowers/plans/` (so `git add -f`) and is tracked and re-included by its leaf afterwards (so `git add -u`).
- `.claude/` is read-only for Bash in the build sandbox: every edit under `.claude/` uses the Edit tool. The `project-template/` copies may use either.

## Files read in full (spec, Files Requiring Full Read)

- `scripts/orchestrate.mjs`: `isValidRun` (`:221-228`) is the conjunction every run-file read goes through (`readRun`, `:230-239`, used by `install`, `handback`, `resume`, `end` and `start`); the feature checks above it (`isSecurity` `:190`, `isModelRecord` `:201`, `isUnattendedRecord` `:211`) show the pattern for a new field: absent is valid, present and malformed is not. `resume` (`:1366-1388`) builds the next record as `{ ...run, … }`, so every field it does not name, `known_failures` included, is kept as it is; no code change is needed for AC7's "`resume` keeps the field". `START_USAGE` (`:1470`), the comment (`:1472-1474`) and `parseStartArgs` (`:1475-1490`); `start` (`:1503-1532`) writes the record at `:1522-1529` and returns the start line at `:1531`, `modelsNote` (`:471`) then `UNATTENDED_NOTE` (`:1534`). `end` (`:1556-1567`) calls `clearRunFiles` (`:1536-1541`), which removes `.conductor/handback/` (plan decision 6). `unverifiedRun` (`:1546-1552`) returns a live run with no `verify_pass`, so a plain `end` right after `start` refuses `ORCH_END_UNVERIFIED` (plan decision 5). `handback` halts `ORCH_HANDBACK_MISSING` at `:685` when a report has no `SNAP_HANDBACK` line.
- `tests/scripts/orchestrate.test.js` (4787 lines): no assertion matches a whole run file (`toEqual` on `runFile()` is used only on sub-objects: `:1294`, `:1310`, `:3867`; every whole-record check is `toMatchObject`), so the new `known_failures: []` field breaks none. The whole start lines asserted with `toBe` (`:589`, `:594`, `:701`, `:320`) are runs with no flag and stay byte-identical; the `endsWith` checks (`:3384`, `:3395`, `:3709`) end with the role-models or unattended segment, and with no flag nothing is inserted. `START_USAGE` is the constant at `:19`, used at `:780`, `:2006`, `:2284`, `:3720`. Helpers used below: `orch` (`:42`), `runFile` (`:56`), `runFileText` (`:59`), `agents` (`:79`), `fixtureGit`/`fixtureCommit` (`:51-55`), `say` (`:97`), `driveTo` (`:122`, takes `start` args and `prep`), `SEC_NONE` (`:18`), and the module-level `DEFAULT_SEGMENT` (`:3367`), `configured` (`:3372`) and `RUN_OK` (`:3375`). The resume pattern to copy is U39 (`:4754-4763`).
- `tests/unit/role-profiles.test.js`: `CLAIM` (`:40-47`) pins each role's success-condition claim (the `[AC5]` row `:131-136` also checks that no other gate's name appears in a profile); `D5` (`:27-35`) pins phrases that must survive; `[AC3]` (`:119`) caps every profile at 999 tokens; `PROFILE_SHA256_1_37_0` (`:152-165`) pins every profile's sha256, with a comment per item that changed one on purpose.
- `tests/installer/commands-parity.test.js`: `ORCH_MIRRORS` (`:197`), the byte-identical row (`:200`), the title-line prefix pins (`:216`, `:276`) and the `[--no-dependency-audit] [--unattended]` pin (`:318`), all of which the new title line keeps.
- `.claude/commands/cc-orchestrate.md` (209 lines, mirror byte-identical): title `:5`, "On any halt" `:28-47` (the scope paragraph `:37`), Start step `:51-63` (the `--unattended` bullet `:60`, the run header `:62`), Verify step `:86` (ends "When `qa`'s hand-back records `verify_pass`, run `node "$S/orchestrate.mjs" end`."), Report `:87-97`, brief `:190`, dispatch table `:205-209`.

## Plan decisions

1. **The shared sentence and the profile edits (AC1-AC4, AC7).** The sentence, word for word in all six profiles:

   ```text
   The suite is green when the test command exits with status 0, or when it exits non-zero and every failing test it reports is a known failure the run declared; anything else is red.
   ```

   `code` and `qa` also carry the matching rule of spec decision 4, word for word:

   ```text
   A failing test is known when the line the runner prints for it contains a declared entry verbatim.
   ```

   Each edit below replaces exactly one occurrence (old → new). Nothing else in a profile changes; each `project-template/.claude/agents/` copy gets the same bytes as its `.claude/agents/` mirror.

   **`plan.md`, line 12:** `Order the tasks so that each one ends with the suite green.` → `Order the tasks so that each one ends with the suite green. <shared sentence>`

   **`code.md`:**
   - line 3 (description): `runs the run's recorded test command, and hands back build_executed.` → `runs the run's recorded test command, and hands back build_executed only when the suite is green.`
   - line 12: `When the task is done, tick its checkboxes in the plan.` → `When the task is done and the suite is green after your last edit, tick its checkboxes in the plan.`
   - line 16: after `Guard 7 denies anything else, and its denial names the allowed command.` append `` The run's declared known failures are the `known_failures` field of the same file; with no such field there are none.``
   - line 20: `after your last edit you ran the test command, and your report states its exact exit status and summary line. A red suite is reported as red; the gate claims only that the run happened and was reported.` → `after your last edit you ran the test command, the suite is green, and your report states its exact exit status and summary line. <shared sentence> <matching rule> When the exit status is non-zero, list each failing test with the entry it matched.` (the line keeps its `Your success condition is fixed: ` opening and its `Do not substitute a stricter or different standard of your own.` close).
   - line 26: ``- Deliver exactly one report, ending in exactly one `SNAP_HANDBACK` line, then stop. Claim only the gate `build_executed`.`` → ``- Deliver exactly one report, then stop. If the suite is green, end it in exactly one `SNAP_HANDBACK` line and claim only the gate `build_executed`. If it is red, tick no box, leave the `SNAP_HANDBACK` line out and say why, quoting the summary line and naming each failing test that matched no declared entry.``

   **`qa.md`:**
   - line 3 (description): `hands back verify_pass only when the suite passes.` → `hands back verify_pass only when the suite is green.`
   - line 16: after ``Outside a run, it is the `mem.p.test_command` field of your envelope.`` append `` The run's declared known failures are the `known_failures` field of the run file; with no such field, and outside a run, there are none.``
   - line 20: `you ran the test command yourself and the suite passed, meaning the command exited with status 0. Report its exact exit status and summary line. Do not substitute a stricter or different standard of your own: exit status 0 is a pass, and anything else is a fail.` → `you ran the test command yourself and the suite is green. <shared sentence> <matching rule> Report its exact exit status and summary line and, when the exit status is non-zero, each failing test with the entry it matched. Do not substitute a stricter or different standard of your own: green is a pass, and anything else is a fail.`
   - line 26: ``If the suite passed, end it in exactly one `SNAP_HANDBACK` line and claim only the gate `verify_pass`. If it failed, leave`` → ``If the suite is green, end it in exactly one `SNAP_HANDBACK` line and claim only the gate `verify_pass`. If it is red, leave`` (the rest of the line, `` the `SNAP_HANDBACK` line out and say why, quoting the summary line.``, stays).

   **Measured on this branch** (HEAD `7c5100e`) by applying exactly these replacements to copies in tmp:

   | Profile | Bytes before → after | Tokens (`ceil(bytes / 4)`) | New sha256 |
   |---|---|---|---|
   | `plan.md` | 2258 → 2439 | 610 | `e61fbf058289f1a70b540c65a6ecb745926e955508613bbca54d1f56f21d2515` |
   | `code.md` | 2063 → 2732 | 683 | `60404be832003d7edf7701f558e9d40f7b5f4a00dc8c01f0fb9b798ce8ba4b82` |
   | `qa.md` | 2113 → 2569 | 643 | `c91df4fddf2bafe6a8cd602478bdcb9df8d04f6845a9888a1598e4f1b05f67cb` |

   All stay under 999 tokens (AC10). The copies keep every `D5` phrase, the `SHELL` / `NO_SHELL` rule of their mask, and each names only its own gate (`code`: `build_executed`; `qa`: `verify_pass`; `plan`: `boundary_routed`), checked with `grep` on the tmp copies, so the `[AC4]` and `[AC5]` rows stay green. A hash that differs after the edit means the edit differs from this decision: fix the edit, not the pin.

2. **`tests/unit/role-profiles.test.js` (AC1-AC3, AC7, AC10).**
   - `CLAIM.code` (`:43`) becomes `'after your last edit you ran the test command, the suite is green, and your report states its exact exit status and summary line'`; `CLAIM.qa` (`:45`) becomes `'you ran the test command yourself and the suite is green'` (AC3's wording).
   - New constants after `QA_OUTSIDE` (`:89`), with the comment `// BUG-074: one definition of a green suite for the three roles that judge one, and how code and qa match a declared failure.`: `GREEN` (the shared sentence) and `KNOWN_MATCH` (the matching rule).
   - New `describe('one definition of done [BUG-074]', …)`, inserted after the `role agent profiles [FEAT-012]` block (`:147`) and before the `PROFILE_SHA256_1_37_0` comment:
     - `it.each([TEMPLATE, MIRROR].flatMap((dir) => ['plan', 'code', 'qa'].map((role) => [`${dir}/${role}.md`])))('[AC1] %s carries the shared green sentence verbatim', (rel) => expect(read(rel)).toContain(GREEN))`: 6 rows.
     - `'[AC2] code ticks and hands back only on a green suite, and no longer claims only that the run happened'`: `profile('code')` contains `'When the task is done and the suite is green after your last edit, tick its checkboxes in the plan.'` and ``'If it is red, tick no box, leave the `SNAP_HANDBACK` line out and say why, quoting the summary line'``, and does not contain `'the gate claims only that the run happened and was reported'`.
     - `'[AC3] qa passes only a green suite and lists each failing test with its matched entry'`: `profile('qa')` contains ``'If the suite is green, end it in exactly one `SNAP_HANDBACK` line and claim only the gate `verify_pass`. If it is red, leave the `SNAP_HANDBACK` line out and say why, quoting the summary line.'`` and `'each failing test with the entry it matched'`, and does not contain `'exit status 0 is a pass'`.
     - `'[AC7] code and qa read the declared failures from known_failures, and qa has none outside a run'`: `profile('code')` and `profile('qa')` each contain ``'`known_failures` field'`` and `KNOWN_MATCH`; `profile('qa')` contains `'with no such field, and outside a run, there are none.'`.
   - `PROFILE_SHA256_1_37_0`: the `code`, `plan` and `qa` rows take the hashes of decision 1, each under a new comment line `// BUG-074 changed <role> on purpose: one definition of a green suite, shared by plan, code and qa, with the run's declared known failures.` (`code`'s goes after the BUG-078 comment, `plan`'s after the FEAT-047 comment, `qa`'s directly above its row). The `audit`, `security` and `spec` rows are unchanged, and so is the `define-review` mirror row (AC10).

3. **`scripts/orchestrate.mjs` (AC5-AC7).**
   - `START_USAGE` (`:1470`) becomes, written in double quotes because it holds single quotes:
     `"usage: orchestrate.mjs start <ITEM> [--auto] [--ticket <N|issue URL>] [--audit-rounds <0-5>] [--security-threshold <low|moderate|high|critical>] [--no-dependency-audit] [--unattended] [--known-failure '<text>']..."`.
     The quotes in `'<text>'` are the usage text's half of the quoting rule (spec decision 7).
   - The comment at `:1472-1474` gains, before `A --ticket with no value…`: `--known-failure <text> any number of times, each value once (BUG-074).`
   - Above `parseStartArgs`:
     ```js
     // BUG-074: a declared known failure is a fragment of one runner failure line. A blank value, a line break,
     // more than 200 characters, a repeat, or a leading -- (a missing value swallowing the next flag) is a usage error.
     const KNOWN_FAILURE_MAX = 200;
     const isKnownFailureArg = (value, seen) => typeof value === 'string' && value.trim() !== '' && !/[\r\n]/.test(value)
       && [...value].length <= KNOWN_FAILURE_MAX && !value.startsWith('--') && !seen.includes(value);
     ```
     Characters are counted as code points (`[...value].length`), so a non-ASCII title is not cut at a UTF-16 surrogate.
   - `parseStartArgs`: `opts` gains `knownFailures: []`, and one branch before the final `else throw new Refusal(START_USAGE);`:
     `else if (rest[i] === '--known-failure' && isKnownFailureArg(rest[i + 1], opts.knownFailures)) opts.knownFailures.push(rest[++i]);`
     A missing value (`rest[i + 1]` undefined) fails `isKnownFailureArg` and reaches the refusal, so does a value split on a space: its second word is an unknown argument (spec decision 7). `parseStartArgs` stays at 16 lines.
   - `start` (`:1503`): `knownFailures` joins the destructuring; the record line `plan: null, tasks: …, security, docs,` ends `security, docs, known_failures: knownFailures,` (always written, `[]` with no flag, AC5); the return line inserts `${knownFailuresNote(knownFailures)}` between `${modelsNote(models)}` and `${unattended ? UNATTENDED_NOTE : ''}`. `start` keeps its 29 lines.
   - Directly above `UNATTENDED_NOTE` (`:1534`):
     ```js
     // BUG-074: the echo shows the values exactly as start received them, so a value the shell cut short is visible.
     const knownFailuresNote = (list) => (list.length > 0 ? `; known failures: ${list.length} ${JSON.stringify(list)}` : '');
     ```
     With no flag the segment is `''`, so the start line is byte-identical to today's.
   - After `isUnattendedRecord` (`:216`):
     ```js
     // BUG-074: start always writes an array of non-empty strings; a run file from before it has none, read as no known failures.
     const isKnownFailureList = (list) => Array.isArray(list) && list.every((v) => typeof v === 'string' && v !== '');
     ```
     and `isValidRun` gains the comment line `// BUG-074: and known_failures, when present, holds only what start writes.` above it and the conjunct `&& (run.known_failures === undefined || isKnownFailureList(run.known_failures))` after `isUnattendedRecord(run)`. The run-file check is exactly the spec's ("not an array of non-empty strings"); the stricter argument checks stay at `start`, the only writer.
   - `resume`, `end`, `install`, `handback`, `nextStep`, `MAY_HAND_BACK` and the SNAP scripts are not edited (AC9).

4. **`tests/scripts/orchestrate.test.js` (AC5-AC7, AC9).** `START_USAGE` (`:19`) becomes the backtick string `` `orchestrate: usage: orchestrate.mjs start <ITEM> [--auto] [--ticket <N|issue URL>] [--audit-rounds <0-5>] [--security-threshold <low|moderate|high|critical>] [--no-dependency-audit] [--unattended] [--known-failure '<text>']...` ``; it changes in the same task as the script's constant, so the four rows that use it are never compared against a usage line from the other side of the change. A new `describe('known failures [BUG-074]', …)` is appended at the end of the file, with `const KF = 'tests/contract/x.test.js > isolated store';` and these rows (25 tests):
   - **K1** `'[AC5] start without the flag records known_failures [] and prints no known-failures segment'`: `orch(['start', 'FEAT-011'])` status 0; `runFile().known_failures` equals `[]`; `r.out` does not contain `'; known failures'` and ends with `SEC_NONE`.
   - **K2** `'[AC5] one --known-failure is recorded and echoed after the security segment'`: `['start', 'FEAT-011', '--known-failure', 'tests/a.test.js']`; status 0; `known_failures` equals `['tests/a.test.js']`; `r.out.endsWith(`${SEC_NONE}; known failures: 1 ["tests/a.test.js"]`)`.
   - **K3** `'[AC5] two values are recorded in order, in any position after the item'`: `['start', 'FEAT-011', '--known-failure', 'a', '--auto', '--known-failure', 'b']`; status 0; `known_failures` equals `['a', 'b']`; `mode` is `'auto'`; `r.out` ends with `'; known failures: 2 ["a","b"]'`.
   - **K4** `'[AC5] a value holding spaces and > passed as one argument is recorded and echoed byte for byte'`: `['start', 'FEAT-011', '--known-failure', KF]`; `known_failures` equals `[KF]`; `r.out.endsWith(`; known failures: 1 ${JSON.stringify([KF])}`)`.
   - **K5** `'[AC5] the segment follows the role models and precedes the unattended segment'`: `agents(); configured()();` then `['start', 'FEAT-011', '--unattended', '--known-failure', 'tests/a.test.js']`; status 0; `r.out.endsWith(`; role models: ${DEFAULT_SEGMENT}; known failures: 1 ["tests/a.test.js"]; unattended: delegated review at spec, plan and build`)`.
   - **K6** `it.each` `'[AC6] start FEAT-011 %j refuses START_USAGE, exit 2, writing nothing'`, 9 rows: `['--known-failure']`, `['--known-failure', '']`, `['--known-failure', '   ']`, `['--known-failure', 'a\nb']`, `['--known-failure', 'a\rb']`, `['--known-failure', 'a'.repeat(201)]`, `['--known-failure', '--auto']`, `['--known-failure', 'a', '--known-failure', 'a']`, and the shell's split of an unquoted value `['--known-failure', 'tests/x.test.js', 'isolated', 'store']`. Each: `toMatchObject({ status: 2, err: START_USAGE })` and no run file.
   - **K7** `'[AC6] a value of exactly 200 characters is accepted'`: `'a'.repeat(200)`; status 0; recorded.
   - **K8** `'[AC7] isValidRun reads a run file without known_failures as valid, and accepts [] and strings'`: `isValidRun(RUN_OK)`, `{ ...RUN_OK, known_failures: [] }`, `{ ...RUN_OK, known_failures: ['a', KF] }` are all `true`.
   - **K9** `it.each(['x', {}, null, [1], [''], ['a', 2]])('[AC7] isValidRun rejects known_failures %j', …)`: `false`. 6 rows.
   - **K10** `'[AC7] a run file edited to a malformed known_failures halts install ORCH_RUN_INVALID'`: `driveTo('spec')`; `runFileText(JSON.stringify({ ...runFile(), known_failures: 'x' }))`; `orch(['install', 'spec'])` has status 1 and `err` matching `/^ORCH_RUN_INVALID: /`.
   - **K11** `'[AC7] resume keeps the declared known failures'`: U39's pattern, `driveTo('code', { start: ['--known-failure', 'tests/a.test.js'], prep: () => { fixtureGit('init', '-q'); fixtureCommit(); } })`; remove `.claude/agents/code.md`; `install code` errs `ORCH_AGENT_MISSING`; `agents()`; `resume` status 0; `runFile().known_failures` equals `['tests/a.test.js']`.
   - **K12** `'[AC9] a red code report with no SNAP_HANDBACK line halts ORCH_HANDBACK_MISSING and leaves tasks.done'`: `driveTo('code')`; `orch(['install', 'code'])` status 0; `orch(['handback', 'code'], { input: 'Tests  1 failed | 2308 passed (2309)\nThe suite is red: tests/a.test.js > title failed.\n' })` has status 1 and `err` starting `ORCH_HANDBACK_MISSING: `; `runFile().tasks.done` is 0; `runFile().handbacks` has no `code` entry; `runFile().halt.code` is `ORCH_HANDBACK_MISSING`. This pins the path a red `code` report takes with no router change.

5. **`.claude/commands/cc-orchestrate.md` and its `project-template` copy (AC8).** Both files get identical edits (the parity row `:200` keeps them byte-identical):
   - **Title (`:5`):** append ` [--known-failure '<text>']...` after `[--unattended]`.
   - **On any halt:** a new paragraph after the scope paragraph (`:37`), with a blank line on each side:
     ```text
     `handback code` halts `ORCH_HANDBACK_MISSING` when the `code` report carries no `SNAP_HANDBACK` line, which is how `code` reports a red suite after its last edit (BUG-074). Name `.conductor/handback/code-<N>.txt`, or `.conductor/handback/code-fix-<r>.txt` for a fix round, and the failing tests the report names: that file is what the owner reads next. Never restart the run with a `--known-failure` of your own; a known failure is declared only by the owner, in their own `start` arguments. Recovery is `resume` or `end`, then `start`, on the owner's word.
     ```
   - **Start step (`:51`):** `1. **Start.** Run `node "$S/orchestrate.mjs" start $ARGUMENTS`.` becomes:
     ```text
     1. **Start.** First read `$ARGUMENTS`. If any of `>` `<` `|` `;` `&` `$` `` ` `` `(` `)` `*` `?` `[` `]` `#` `~` `\` stands outside a single- or double-quoted span, do not run `start`: show the owner `$ARGUMENTS`, name the character, and ask them to quote the value. Never add the quotes yourself. No value any `start` flag accepts holds such a character unquoted, so this refuses no valid run (BUG-074). Otherwise run `node "$S/orchestrate.mjs" start $ARGUMENTS`.
     ```
     The rest of the line (`It resolves the run's test command…`) is unchanged.
   - **Start step, after the `--unattended` bullet (`:60`), two new bullets:**
     ```text
        - With `--known-failure` (BUG-074), stdout ends with `; known failures: <k> <values>`, `<values>` the recorded list as a JSON array, after the role-models segment and its note and before `; unattended: …`. Each value comes only from `$ARGUMENTS`, passed to `start` verbatim: never add, edit or drop a `--known-failure` yourself, including after a red `code` halt, where you stop and name the failing tests for the owner. The owner quotes a value that holds a space or any of the characters above, in single or double quotes: `--known-failure 'tests/x.test.js > suite > title'`. A value split on an unquoted space refuses with the usage line and writes nothing; ask the owner to quote it.
        - If `start` exits 0 with an empty stdout, the shell consumed part of `$ARGUMENTS` (an unquoted `>` sent the start line to a file). Treat it as a halt and dispatch nothing: run `node "$S/orchestrate.mjs" end` and tell the owner the shell cut the arguments. On the run that just started, `end` refuses `ORCH_END_UNVERIFIED`; report it and offer `end --abandon` on the owner's word, as at `ORCH_RUN_ACTIVE`. Then show the owner `git status --short` and name each redirect target in `$ARGUMENTS` (the word after an unquoted `>` or `>>`) that the shell created or overwrote. Restore or delete none of them: which file to keep is the owner's call.
     ```
   - **Run header (`:62`):** after `the role models and their note from `role models:` when the start line has them,` insert ` the known failures from `known failures:` when the start line has them,`.
   - **Verify step (`:86`):** before `When `qa`'s hand-back records `verify_pass`, run `node "$S/orchestrate.mjs" end`.` insert `When the run file's `known_failures` is non-empty, take from `.conductor/handback/qa.txt` each failing test `qa` matched to a declared entry before you run `end`, which removes that file (BUG-074). `.
   - **Report (`:87-97`):** a new item after the `resumes` item: `   - when the record's `known_failures` is non-empty, each declared entry with the failing tests `qa`'s report (`.conductor/handback/qa.txt`) matched to it, or that it matched none (BUG-074); with `known_failures: []`, or no such field, leave this item out;`
   - **Brief (`:190`):** `Verify your work before you hand back. Your hand-back is the run's only record.` → `Check your work against your success condition before you hand back. Your hand-back is the run's only record.`
   - **Dispatch table:** `code` row (`:205`) task becomes ``Implement `<Task N>` of `<plan>`, touching only its files. After your last edit, run the run's test command exactly and report its exit status and summary line. If the suite is green, tick its boxes in the plan and hand back. If the suite is red, tick no box, leave out the `SNAP_HANDBACK` line and say why.``; `code` (fix round) row (`:206`) appends `` If the suite is red, leave out the `SNAP_HANDBACK` line and say why.`` after `report its exit status and summary line.`; `qa` row (`:209`) `If the suite fails, leave out` → `If the suite is red, leave out`.

6. **Why the matched-entry list is taken before `end`.** The spec's Report item reads `qa`'s report at `.conductor/handback/qa.txt`, but `end` removes `.conductor/handback/` (`clearRunFiles`, `scripts/orchestrate.mjs:1538`) and the Report step runs after `end`. So the Verify step tells the orchestrator to take the list from that file before it runs `end` (decision 5), and the Report item names the file as the source. No script change: the list is the orchestrator's reading of a report it wrote itself, as every other Report item is.

7. **Why the empty-stdout halt offers `end --abandon`.** The spec says the Start step "runs `end`" on a `start` that exits 0 with an empty stdout. That run was just written, is live and has no `verify_pass`, so BUG-075's `end` refuses `ORCH_END_UNVERIFIED` and removes nothing (`unverifiedRun`, `:1546-1552`), and the command forbids passing `--abandon` on the orchestrator's own initiative (`:47`). The Start step therefore runs `end` as the spec says, reports its refusal, and offers `end --abandon` on the owner's word, which is the existing `ORCH_RUN_ACTIVE` recovery (`:53`); the `git status --short` and redirect-target report follow either way. This keeps the spec's behavior (the run is not continued, nothing is restored or deleted) without the orchestrator abandoning a run by itself. The owner's plan approval covers this reading.

8. **`README.md:260`, the `/cc-orchestrate` row (AC8).** The usage cell gains ` [--known-failure '<text>']...` after `[--no-dependency-audit]`; the description cell gains, after its first sentence: `` Each `--known-failure` declares a known pre-existing test failure for the run; quote a value that holds a space or a shell character, as in `--known-failure 'tests/x.test.js > suite > title'`.`` The row keeps no `[--unattended]` (it lists none today; adding it is outside this item). The Known-limits line `:501` is not touched.

9. **`tests/installer/commands-parity.test.js` (AC8).** A new row at the end of `describe('cc-orchestrate mirrors [FEAT-011 AC10]')` (before its closing `});` at `:341`): `'states one definition of done and the owner-only known-failure declaration [BUG-074]'`. On `read(ORCH_MIRRORS[0])` it expects every phrase below and `not.toContain('Verify your work')`:
   - `'Check your work against your success condition before you hand back.'`
   - `"[--unattended] [--known-failure '<text>']..."`
   - ``'never add, edit or drop a `--known-failure` yourself, including after a red `code` halt'``
   - `'The owner quotes a value that holds a space or any of the characters above, in single or double quotes'`
   - `'stands outside a single- or double-quoted span, do not run `start`'` and `'Never add the quotes yourself.'`
   - ``'If `start` exits 0 with an empty stdout'``, `'git status --short'`, ``'the word after an unquoted `>` or `>>`'``, `'Restore or delete none of them'`
   - `'the known failures from `known failures:` when the start line has them'`
   - ``'`handback code` halts `ORCH_HANDBACK_MISSING` when the `code` report carries no `SNAP_HANDBACK` line'``, ``'.conductor/handback/code-<N>.txt`, or `.conductor/handback/code-fix-<r>.txt` for a fix round'``, ``'Never restart the run with a `--known-failure` of your own'``
   - ``"when the record's `known_failures` is non-empty, each declared entry with the failing tests"`` and `'before you run `end`, which removes that file'`
   - ``'If the suite is red, tick no box, leave out the `SNAP_HANDBACK` line and say why.'`` and ``'If the suite is red, leave out the `SNAP_HANDBACK` line and say why.'``

   On `read('README.md')` it expects `"[--no-dependency-audit] [--known-failure '<text>']..."` and `'quote a value that holds a space or a shell character'`.

10. **Red predictions, reasoned against the current code.**
    - Task 1 (orchestrate tests before the script change; `START_USAGE` still the old string on both sides): **red** K1 (`known_failures` is undefined), K2-K5 (the flag is an unknown argument, `START_USAGE`), K7 (same), the six K9 rows (the field is not checked), K10 (`install spec` succeeds), K11 (`driveTo`'s `start` expects status 0): 14. **Green** the nine K6 rows (refused today, as an unknown argument, with today's usage line, which the constant still holds), K8 and K12: 11.
    - Task 3 (role-profile tests before the profile edits): **red** the six `[AC1]` rows, `[AC2]`, `[AC3]`, `[AC7]`, and the `[AC5]` rows for `code` and `qa` (their `CLAIM` changed): 11. The sha rows are edited after the profiles (T-307), so they stay green here.
    - Task 4 (parity row before the command edits): **red** the new row only.

11. **`.gitignore` leaf.** `!/docs/superpowers/plans/2026-11-20-bug074-role-definitions-disagree-on-what-done-means.md` goes directly after the `2026-11-20-bug071` plan leaf (`.gitignore:188`) and before the `2026-11-20-bug078` plan leaf, the full-path sort order of the block (BUG-042).

## Baseline (measured on this branch, HEAD 7c5100e, Node v24.22.2)

- `npx vitest run tests/unit/role-profiles.test.js`: **111 passed (111)**.
- `npx vitest run tests/installer/commands-parity.test.js`: **94 passed (94)**.
- `npx vitest run tests/scripts/orchestrate.test.js`: **1131 passed (1131)**.
- No existing test title contains `BUG-074` (`grep -n BUG-074` on the three test files is empty), so `-t 'BUG-074'` selects only the new rows.

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-20-bug074-role-definitions-disagree-on-what-done-means.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file from the approved spec `feda1063…`. No dependency.
- [X] [T-002] `.gitignore`: insert the leaf of plan decision 11 after the `2026-11-20-bug071` plan leaf. Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` (tracked) and `git add -f docs/superpowers/plans/2026-11-20-bug074-role-definitions-disagree-on-what-done-means.md` (new, under the ignored `docs/superpowers/plans/`). Depends on T-002.
- [X] [T-004] Commit: `docs: plan one definition of done for a task's tests [BUG-074]`. Depends on T-003.

---

### Task 1: Start-flag and run-file tests first (red)

**Files:**
- Test: `tests/scripts/orchestrate.test.js`

- [X] [T-101] `tests/scripts/orchestrate.test.js`: append `describe('known failures [BUG-074]')` with `KF` and rows K1-K12 (plan decision 4). Leave `START_USAGE` (`:19`) as it is. Depends on T-004.
- [X] [T-102] Red run: `npx vitest run tests/scripts/orchestrate.test.js -t 'BUG-074'`. Its full match set is the 25 new tests. Predicted: **14 failed | 11 passed** of the 25, every other test of the file skipped (plan decision 10). Any other split means a test is wrong: fix the test, not the prediction. Depends on T-101.

---

### Task 2: `start --known-failure` and the run-file field (green)

**Files:**
- Modify: `scripts/orchestrate.mjs`
- Test: `tests/scripts/orchestrate.test.js`

- [X] [T-201] `scripts/orchestrate.mjs`: `isKnownFailureList` after `isUnattendedRecord`, and the comment line and conjunct in `isValidRun` (plan decision 3). Depends on T-102.
- [X] [T-202] `scripts/orchestrate.mjs`: new `START_USAGE`, the comment addition, `KNOWN_FAILURE_MAX` and `isKnownFailureArg`, and the `parseStartArgs` option and branch (plan decision 3). Depends on T-201.
- [X] [T-203] `scripts/orchestrate.mjs`, `start`: destructure `knownFailures`, write `known_failures`, insert the segment; add `knownFailuresNote` above `UNATTENDED_NOTE` (plan decision 3). Depends on T-202.
- [X] [T-204] `tests/scripts/orchestrate.test.js:19`: the new `START_USAGE` backtick string (plan decision 4). Depends on T-203.
- [X] [T-205] Green run: the T-102 command. Predicted: **25 passed** of the 25. Depends on T-204.
- [X] [T-206] Run: `npx vitest run tests/scripts/orchestrate.test.js -t 'usage line|refuses start FEAT-031|U2 \[AC2a\]|start without the flag|run file \[FEAT-011 AC9\]'`. Predicted: every selected test passes (the four `START_USAGE` users and the whole-start-line rows, against the new constant and an unchanged no-flag start line). Depends on T-205.

---

### Task 3: One green sentence in the profiles (red, then green)

**Files:**
- Modify: `.claude/agents/plan.md`
- Modify: `.claude/agents/code.md`
- Modify: `.claude/agents/qa.md`
- Modify: `project-template/.claude/agents/plan.md`
- Modify: `project-template/.claude/agents/code.md`
- Modify: `project-template/.claude/agents/qa.md`
- Test: `tests/unit/role-profiles.test.js`

- [X] [T-301] `tests/unit/role-profiles.test.js`: the new `CLAIM.code` and `CLAIM.qa`, the `GREEN` and `KNOWN_MATCH` constants, and `describe('one definition of done [BUG-074]')` (plan decision 2). Do not touch the sha rows yet. Depends on T-206.
- [X] [T-302] Red run: `npx vitest run tests/unit/role-profiles.test.js`. Predicted: **11 failed | 109 passed (120)** (111 + 9 new; red as in plan decision 10). Depends on T-301.
- [X] [T-303] `.claude/agents/plan.md` (Edit tool): the plan edit of decision 1. Depends on T-302.
- [X] [T-304] `.claude/agents/code.md` (Edit tool): the five code edits of decision 1, one Edit per line. Depends on T-303.
- [X] [T-305] `.claude/agents/qa.md` (Edit tool): the four qa edits of decision 1, one Edit per line. Depends on T-304.
- [X] [T-306] `project-template/.claude/agents/{plan,code,qa}.md`: the same edits; then `cmp` each pair prints nothing and `sha256sum` of each prints the hash of decision 1's table. A different hash means the edit differs from decision 1: fix the edit. Depends on T-305.
- [X] [T-307] `tests/unit/role-profiles.test.js`, `PROFILE_SHA256_1_37_0`: the three BUG-074 comment lines and the new `code`, `plan` and `qa` hashes (plan decision 2). Depends on T-306.
- [X] [T-308] Green run: the T-302 command. Predicted: **120 passed (120)**, the token cap, mirror, `D5`, `[AC5]` and both directories' hash rows included. Depends on T-307.

---

### Task 4: The orchestrator command and README (red, then green)

**Files:**
- Modify: `.claude/commands/cc-orchestrate.md`
- Modify: `project-template/.claude/commands/cc-orchestrate.md`
- Modify: `README.md`
- Test: `tests/installer/commands-parity.test.js`

- [X] [T-401] `tests/installer/commands-parity.test.js`: the new row of plan decision 9 at the end of `describe('cc-orchestrate mirrors [FEAT-011 AC10]')`. Depends on T-308.
- [X] [T-402] Red run: `npx vitest run tests/installer/commands-parity.test.js`. Predicted: **1 failed | 94 passed (95)**, the new row red. Depends on T-401.
- [X] [T-403] `.claude/commands/cc-orchestrate.md` (Edit tool): title, the "On any halt" paragraph, the Start step opening, its two new bullets and the run header (plan decision 5). Depends on T-402.
- [X] [T-404] `.claude/commands/cc-orchestrate.md` (Edit tool): the Verify-step sentence, the Report item, the brief line and the three dispatch-table rows (plan decision 5). Depends on T-403.
- [X] [T-405] `project-template/.claude/commands/cc-orchestrate.md`: the same edits; then `cmp` of the two copies prints nothing. Depends on T-404.
- [X] [T-406] `README.md:260`: the usage cell and the description sentence of plan decision 8. Depends on T-405.
- [X] [T-407] Green run: the T-402 command. Predicted: **95 passed (95)**, the byte-identical mirror row included. Depends on T-406.

---

### Task 5: Full suite, scope check and commit

**Files:**
- Modify: `docs/superpowers/plans/2026-11-20-bug074-role-definitions-disagree-on-what-done-means.md` (ticks)

- [X] [T-501] Run `npm test` (long: `orchestrate.test.js` alone takes about 9 minutes; run it in the background if the shell times out). Predicted: exit 0 (AC11), with `tests/scripts/orchestrate.test.js` at **1156 passed** (1131 + 25), `tests/unit/role-profiles.test.js` at 120 and `tests/installer/commands-parity.test.js` at 95. A red is called ENV only if the sandbox caused it (network, tmp permissions) and its file is not one this plan touches; report it with its name. Any other red is fixed. Depends on T-407.
- [X] [T-502] Scope check: `git status --short` lists exactly the fourteen files of the Global Constraints and this plan; no temporary file is left in the tree. `git diff --stat` shows no change to the spec, `scripts/snap-contract.mjs`, any hook, the `audit`, `spec`, `security` or `define-review` profiles, or `README.md` outside line 260. Depends on T-501.
- [X] [T-503] Stage: `git add -u scripts/orchestrate.mjs tests/scripts/orchestrate.test.js .claude/agents/plan.md .claude/agents/code.md .claude/agents/qa.md project-template/.claude/agents/plan.md project-template/.claude/agents/code.md project-template/.claude/agents/qa.md tests/unit/role-profiles.test.js .claude/commands/cc-orchestrate.md project-template/.claude/commands/cc-orchestrate.md tests/installer/commands-parity.test.js README.md` (all tracked). Depends on T-502.
- [X] [T-504] Stage: `git add -u docs/superpowers/plans/2026-11-20-bug074-role-definitions-disagree-on-what-done-means.md` (carries the ticks for T-101 to T-503). Depends on T-503.
- [X] [T-505] Commit: `fix: share one definition of a green suite across plan, code and qa [BUG-074]`. Depends on T-504.

---

## Test List

- [X] Unit, AC1: the six `[AC1]` rows pin the shared sentence in `plan`, `code` and `qa`, in both agent directories.
- [X] Unit, AC2: `[AC2]` (tick and hand back only on green; the removed sentence is gone) and the updated `CLAIM.code` `[AC5]` row.
- [X] Unit, AC3: `[AC3]` and the updated `CLAIM.qa` `[AC5]` row.
- [X] Unit, AC4: the `plan` `[AC1]` rows; `plan.md` keeps "Order the tasks so that each one ends with the suite green."
- [X] Integration, AC5: K1-K5 (zero, one, two values, spaces and `>` as one argument, the segment's position with role models and `--unattended`), plus the unchanged whole-start-line rows (`:320`, `:589`, `:594`, `:701`).
- [X] Integration, AC6: the nine K6 refusals (the shell-split row included) and K7.
- [X] Unit and integration, AC7: K8, K9, K10 (validation), K11 (`resume`), and the unit `[AC7]` profile row.
- [X] Parity, AC8: the new `commands-parity` row and the existing byte-identical mirror row.
- [X] AC9: K12 (a red `code` report halts `ORCH_HANDBACK_MISSING` with `tasks.done` unchanged); the existing hand-back and SNAP suites pass unchanged in T-501.
- [X] AC10: the token-cap, mirror and sha rows of `role-profiles.test.js`.
- [X] AC11: `npm test` (T-501).
- [X] No E2E/UI test: there is no UI. CI legs: no new test is conditionally skipped, so no leg's skipped set in `tools/skip-baseline.json` changes.

## Commit Order

1. Task 0 (T-004): this plan and its `.gitignore` leaf.
2. Task 5 (T-505): the tests, the script, the six profiles, the hash pins, the two command copies, the README row and the plan ticks for T-101 to T-503, in one commit, so no commit has a red suite. The red runs (T-102, T-302, T-402) happen in the working tree before each fix. The ticks for T-504, T-505 and the Test List ride the closeout commit.

## Identified Risks

- **A profile edit drifting from the measured bytes, or between the two copies.** T-306 checks `cmp` and the hashes of decision 1 before T-307 pins them.
- **A profile naming another role's gate.** The `[AC5]` row fails if `code` names `verify_pass` or `qa` names `build_executed`; the new text was checked on tmp copies and names neither.
- **A no-flag start line changing.** `knownFailuresNote([])` is `''`; caught by the whole-start-line rows (`:320`, `:589`, `:594`, `:701`) and K1.
- **The new run-file field breaking a whole-record assertion.** None exists (every whole-record check is `toMatchObject`); T-501 runs the file whole.
- **`START_USAGE` mismatched between script and test.** Both change in Task 2 (T-202, T-204); T-206 runs the four rows that compare it.
- **The matched-entry list lost to `end`.** `end` removes `.conductor/handback/`; the Verify step takes the list first (plan decision 6).
- **The empty-stdout halt and BUG-075.** A plain `end` refuses on the fresh run; the Start step reports that and offers `end --abandon` on the owner's word (plan decision 7).
- **The orchestrator's quoting check is prose, not code.** It is an instruction the parity row pins; if it is missed, the shell-split case fails safe with `START_USAGE` (K6) and the redirect case is caught by the empty-stdout halt. A value cut short at a `>` is visible in the start line's JSON echo.
- **A declared file-level entry hiding a new failure in that file.** Accepted by the spec (Alternative paths); the start line and the Report item make the declaration visible.
- **The long suite timing out the shell.** T-501 notes the duration; a timeout is not a red.
