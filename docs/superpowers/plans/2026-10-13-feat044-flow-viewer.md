# FEAT-044 Flow viewer implementation plan

**Issue:** #57
**Spec:** `docs/superpowers/specs/2026-10-13-feat044-flow-viewer-design.md`
**Date:** 2026-10-13, revised 2026-10-18 (status line as the primary display) and 2026-10-21 (owner decisions)
**Status:** Spec approved by the owner on 2026-10-19 (https://github.com/yeisonrestrepo/code-conductor/pull/81#issuecomment-6257678335), against `[FEAT-044]`. Implemented on branch `feat/feat044-flow-viewer-impl` on 2026-10-22 (T-001 to T-009, T-011); T-012's manual protocol and the macOS run are open for the operator.

---

## Gate

All three conditions held on 2026-10-19:

- the id is minted: `[FEAT-044]`, `6f4607d`;
- the spec is approved, D1 to D7, with D2 option (b) (no HTML page) and D1 as plain JSONL;
- the `statusLine` entry in the project `settings.json` is approved under the `verbosity-remind` merge-and-fingerprint discipline (spec, "Installer").

The PR that carries this plan contains the spec, the plan and two `.gitignore` leaf lines. It contains no code.

## Tasks

- [ ] [T-000] Intake. Record the minted id in the spec and plan headers, and move the work to a branch named for it.
- [ ] [T-001] Measure before building. No shipped code.
    - [ ] [T-001-A] Re-run #83's parallel-append and locked-rotation probes (M7, M9) on Linux (CI) and on macOS and Windows (recorded runs; CI has no macOS or Windows leg). Assert every line parses and no lock or temporary file is left. This proves spec AC11.
    - [ ] [T-001-B] Record when Claude Code refreshes the status line on the current release: per tool call, per assistant message, or both. Record its stdin fields used by the script (the working directory).
    - [ ] [T-001-C] Record both results in this plan. A torn line in T-001-A, or a refresh cadence that makes the line useless, returns the spec to the owner before T-003.
- [ ] [T-002] Write the predicted red table: every existing suite expected to move, by name, with the count, before any run. Expected so far: `tests/installer/templates.test.js` (two pinned ignore-line lists), `tests/installer/deploy.test.js` (`settings.json` cases). To check and name: `tests/unit/host-owned-ignore-xor.test.js`, `tests/hooks/pre-tool-use-contract.test.js`, and any Guard 4 suite.
- [ ] [T-003] Emitter in `project-template/.claude/hooks/pre-tool-use.mjs`.
    - [ ] [T-003-A] A table from guard function to guard number, a `passed` list filled by the loop in `main()`, and each guard returning its own `code`.
    - [ ] [T-003-B] `recordFlowEvent(payload, decision, passed)`: builds the D5 event (with `agent` and the `VAR=value` skip), called after `emit()`, whole body in its own `try`/`catch`.
    - [ ] [T-003-C] `rotateFlowEvents(path)`: the D7 `wx` lock with the 10 s stale cutoff, last 250 parseable lines to a temporary file, then rename. The 1-byte torn-tail check before each append.
    - [ ] [T-003-D] `CC_FLOW_OFF`, and the no-`.claude/`-directory return.
    - [ ] [T-003-E] Guard 4: deny `Read` of `.claude/.flow-events.jsonl` (D8).
    - [ ] [T-003-F] Copy the result over `.claude/hooks/pre-tool-use.mjs` and compare the two with `git hash-object`.
- [ ] [T-004] `tests/hooks/flow-events.test.js`. See the test list.
- [ ] [T-005] `project-template/.claude/flow-status.mjs`: tail read capped at 32 KiB, the D2 state table, `--detail` with the D3 lanes and the newest 20 events. Exit 0 on every path.
- [ ] [T-006] `project-template/.claude/commands/cc-flow.md`: runs `node .claude/flow-status.mjs --detail` and echoes the output.
- [ ] [T-007] `tests/installer/flow-status.test.js`. See the test list.
- [ ] [T-008] `project-template/gitignore`: add `.claude/.flow-events.*`. Update the two pinned lists in `tests/installer/templates.test.js`.
- [ ] [T-009] `lib/installer/deploy.mjs` and `lib/installer/settings.mjs`: the conditional `statusLine` merge from the spec's "Installer" rule, with the `flow-status.mjs` fingerprint, and one `report()` line for each outcome. Assertions in `tests/installer/deploy.test.js`.
- [ ] [T-010] Dropped: the HTML page is out of scope (owner decision, D2 option b). The id is kept so later ids do not shift.
- [ ] [T-011] A short "Flow status" section in `README.md`: what the status line shows, `/cc-flow`, `CC_FLOW_OFF`, and what happens when a status line already exists. Not the "Known limits" lines, which are owner-side.
- [ ] [T-012] Full suite. Compare against the T-002 table. Run the manual protocol. State the counts in the PR description.

## Test list

`tests/hooks/flow-events.test.js`, each case spawning the hook in a temporary directory:

- [ ] One event per call, with the D5 fields, for an allow on each lane.
- [ ] A deny from each of guards 1 to 7 records that guard's number, its own `code`, and the guards that passed before it.
- [ ] Guard 2's ask records `verdict: "ask"`.
- [ ] A band-role call records `agent`; a top-level call records `null`.
- [ ] Fail-open: with the event path occupied by a directory, stdout, stderr and exit code are byte-identical to a `CC_FLOW_OFF` run, on an allow, a deny and an ask.
- [ ] `CC_FLOW_OFF` creates no file. No `.claude/` directory creates no file and no directory.
- [ ] An unparseable payload still fails closed and writes no event.
- [ ] Rotation: a file seeded past 160 KiB holds 251 lines after one call, and every line parses. No lock file remains.
- [ ] A lock older than 10 s is broken and rotation proceeds. A fresh lock skips rotation and the append still lands.
- [ ] A file whose last byte is not a newline is repaired: the torn line is gone and the new line parses.
- [ ] `TOKEN=sk-x curl …` and `A=1 B=2 git …` record `curl` and `git` as the target, and no secret-shaped string appears in the file.
- [ ] A `target` holding a quote and a newline produces exactly one line that parses back to the same string.
- [ ] Guard 4 denies `Read` of `.claude/.flow-events.jsonl`.

`tests/installer/flow-status.test.js`, spawning `flow-status.mjs` against seeded files:

- [ ] Each row of the D2 state table prints its line, and every run exits 0.
- [ ] A thrown error (event path is a directory) prints nothing and exits 0.
- [ ] A 1 MiB seeded file: the script reads no more than the last 32 KiB.
- [ ] Drift: the set of guard numbers in the hook's dispatch equals the set of guards in the script's lane table.
- [ ] `--detail` prints every D3 lane and at most 20 events.
- [ ] `--project` into a temporary directory deploys `flow-status.mjs` and `commands/cc-flow.md`.
- [ ] `--project` with no `statusLine` anywhere adds the entry, and a second run leaves the file byte-identical.
- [ ] A project `statusLine` carrying the `flow-status.mjs` fingerprint with a stale command is replaced by the canonical one.
- [ ] A host `statusLine` in the project or the user `settings.json`: both files stay byte-identical and the skip line is printed.
- [ ] A malformed project `settings.json` is backed up and left untouched.
- [ ] The shipped files contain no `.html` file and no `http://` or `https://` URL (AC7).

Manual protocol, not in CI:

- [ ] In a live session, trigger an allow, a deny and an ask. The status line shows each within one refresh, as recorded in T-001-B.
- [ ] Corrupt the last line by hand. The status line shows `flow: unreadable, retrying` or repairs on the next append. It never shows a stack trace.
- [ ] Run `/cc-flow`. The lanes and events match the file.

## Commit order

1. `test: add the cross-platform append and rotation probes [ID]` (T-001)
2. `feat: emit flow events from the pre-tool-use hook [ID]` (T-003, T-004)
3. `feat: add the flow status line and /cc-flow [ID]` (T-005 to T-007)
4. `feat: deploy and ignore the flow status files [ID]` (T-008, T-009)
5. `docs: describe the flow status line in the README [ID]` (T-011)

`[ID]` is the minted id. One PR, one item.

## Constraints checked

From `CONTRIBUTING.md`, "What contributors must never do" and "Records are owner-side":

- No version bump, no `CHANGELOG.md` heading, no release branch or tag. The version this ships under is assigned by the owner at release.
- No self-assigned id. `[FEAT-044]` was minted by the owner in `6f4607d`.
- `dependencies` stays `{}`. No surface loads anything from a network.
- The installer is exercised through its tests in temporary directories, never run in this repository.
- The hook, the installer and `settings.json` are protected surfaces: T-002 writes the predicted red table first, and the `statusLine` entry follows the approved fingerprint rule.
- Guard 3's frozen authority is not touched.

## Identified risks

Carried from the spec: R1 torn lines (T-001-A decides), R2 refresh cadence (T-001-B), R3 host status line, R4 hook size, R5 rotation spike.

Added by the plan:

- **Test baselines move with every merge ahead of this one.** The counts in T-002 are taken from `main` on the day implementation starts, not from today.
- **PR #80 adds wiki drift tests.** If it merges first, `/cc-flow` may need a row in the commands wiki page template. Check at T-002.
- **Keepers from #83.** The probe code in #83 is evidence, not shipped code. The parts that become real tests are cherry-picked into T-001 and T-004 and rewritten under `tests/**/*.test.js`.

## Implementation record

Taken 2026-10-22 on Windows 11 Pro 10.0.26300, Node v24, from `main` at `17f70fe`.

**T-001-A.** `tests/hooks/flow-append-race.test.js` re-runs M7 and M9 as assertions. M7 (16 × 500 capped lines, and 4 × 50 lines of 64 KiB): 0 torn, 0 failed appends, every line present. M9 (16 continuous writers, rotation at 16 KiB under the `wx` lock): 0 torn, 0 failed appends, no lock or temporary file left. One finding the #83 run did not show: under continuous writers the rotation's `rename` can still fail with `EPERM` on Windows, because another process holds the file open for append. The emitter swallows it and the next call retries, so the test asserts the invariants a reader depends on rather than zero rename errors. Linux is proven by CI; macOS has no recorded run yet and is open for the operator.

**T-001-B.** From the Claude Code status line documentation (https://code.claude.com/docs/en/statusline, read 2026-10-22): the command runs at session start and again when a new assistant message arrives, after `/compact`, on a permission or vim mode change, and on an optional `refreshInterval` timer, debounced at 300 ms. It does not run per tool call. The working directory arrives as `workspace.current_dir` (same value as `cwd`). Output shows only after exit 0; a non-zero exit or no output blanks the line. Not measured live: the manual protocol records it.

**T-001-C.** No torn line, and a per-message cadence is the R2 case the spec already accepts for a summary line. The spec does not return to the owner.

**Operator decision, 2026-10-22 (latency).** The per-call read of the last byte (D7's torn-tail check) is replaced by a newline that leads each line instead of ending it: a single `O_APPEND` write cannot tear (M7), so a tail torn by a crash or hand edit is fenced off by the next event and dropped at the next rotation. Departs from D1's "followed by `\n`"; readers skip blank lines. Emitter cost on Windows 11, 600 interleaved calls: p50 2.1 to 2.3 ms → 0.9 ms, p95 3.1 to 3.6 ms → 1.5 to 1.6 ms.

**T-002, predicted red** (existing suites only, before any run):

| Suite | Predicted | Why |
|---|---|---|
| `tests/installer/templates.test.js` | 1 | The FEAT-011 AC10 full list gains `.claude/.flow-events.*`; the AC13 first-four slice is unaffected because the line is appended last |
| `tests/installer/deploy.test.js` | 0 | Its fixture template ships no `flow-status.mjs`, and the `statusLine` merge runs only when the template ships the script it points at |
| `tests/unit/host-owned-ignore-xor.test.js` | 0 | `PROJECT_HOST_OWNED` is not changed |
| `tests/hooks/pre-tool-use-contract.test.js` | 0 | Its payloads carry no `cwd`, so the emitter writes nothing |
| `tests/hooks/guard4.test.js` | 0 | Guard 4 gains one path; no existing case reads it |
| `tests/wiki/wiki-gen.test.js` | 1 if missed | `/cc-flow` must be named in the Commands-Reference page template |
