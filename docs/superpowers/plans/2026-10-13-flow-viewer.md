# Flow viewer implementation plan

**Issue:** #57
**Spec:** `docs/superpowers/specs/2026-10-13-flow-viewer-design.md`
**Date:** 2026-10-13, revised 2026-10-18 (status line as the primary display)
**Status:** Candidate (unminted; the id is assigned by the maintainer). Not started.

---

## Gate

Nothing below T-000 starts until all three hold:

- the owner has minted an id for this item,
- the owner has approved the spec, including decisions D1, D2, D3 and D4, and
- the owner has approved the `statusLine` entry in the project `settings.json` (spec, "Installer"), and chosen D2 option (a) or (b).

The PR that carries this plan contains the spec, the plan and two `.gitignore` leaf lines. It contains no code.

## Tasks

- [ ] [T-000] Intake. Record the minted id in the spec and plan headers, and move the work to a branch named for it.
- [ ] [T-001] Measure before building. No shipped code.
    - [ ] [T-001-A] Re-run #83's parallel-append and locked-rotation probes (M7, M9) on the macOS and Linux CI legs. Assert every line parses and no lock or temporary file is left.
    - [ ] [T-001-B] Record when Claude Code refreshes the status line on the current release: per tool call, per assistant message, or both. Record its stdin fields used by the script (the working directory).
    - [ ] [T-001-C] Record both results in this plan. A torn line in T-001-A, or a refresh cadence that makes the line useless, returns the spec to the owner before T-003.
- [ ] [T-002] Write the predicted red table: every existing suite expected to move, by name, with the count, before any run. Expected so far: `tests/installer/templates.test.js` (two pinned ignore-line lists), `tests/installer/deploy.test.js` (`settings.json` cases). To check and name: `tests/unit/host-owned-ignore-xor.test.js`, `tests/hooks/pre-tool-use-contract.test.js`, and any Guard 4 suite.
- [ ] [T-003] Emitter in `project-template/.claude/hooks/pre-tool-use.mjs`.
    - [ ] [T-003-A] A table from guard function to guard number, a `passed` list filled by the loop in `main()`, and each guard returning its own `code`.
    - [ ] [T-003-B] `recordFlowEvent(payload, decision, passed)`: builds the D5 event (with `agent` and the `VAR=value` skip), called after `emit()`, whole body in its own `try`/`catch`.
    - [ ] [T-003-C] `rotateFlowEvents(path)`: the D7 `wx` lock with the 10 s stale cutoff, last 250 parseable lines to a temporary file, then rename. The 1-byte torn-tail check before each append.
    - [ ] [T-003-D] `CC_FLOW_OFF`, and the no-`.claude/`-directory return.
    - [ ] [T-003-E] Guard 4: deny `Read` of `.claude/flow-events.js` (D8).
    - [ ] [T-003-F] Copy the result over `.claude/hooks/pre-tool-use.mjs` and compare the two with `git hash-object`.
- [ ] [T-004] `tests/hooks/flow-events.test.js`. See the test list.
- [ ] [T-005] `project-template/.claude/flow-status.mjs`: tail read capped at 32 KiB, the D2 state table, `--detail` with the D3 lanes and the newest 20 events. Exit 0 on every path.
- [ ] [T-006] `project-template/.claude/commands/cc-flow.md`: runs `node .claude/flow-status.mjs --detail` and echoes the output.
- [ ] [T-007] `tests/installer/flow-status.test.js`. See the test list.
- [ ] [T-008] `project-template/gitignore`: add `.claude/flow-events.*`. Update the two pinned lists in `tests/installer/templates.test.js`.
- [ ] [T-009] `lib/installer/deploy.mjs`: the conditional `statusLine` merge from the spec's "Installer" rule, and one `report()` line for either outcome. Assertions in `tests/installer/deploy.test.js`.
- [ ] [T-010] Only under D2 option (a): `tools/flow-viewer.html`, the first draft's page, not deployed. The no-URL and no-`innerHTML` checks from the test list.
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
- [ ] A `target` holding `</script>`, a quote and a newline produces a line that parses back to the same string.
- [ ] Guard 4 denies `Read` of `.claude/flow-events.js`.

`tests/installer/flow-status.test.js`, spawning `flow-status.mjs` against seeded files:

- [ ] Each row of the D2 state table prints its line, and every run exits 0.
- [ ] A thrown error (event path is a directory) prints nothing and exits 0.
- [ ] A 1 MiB seeded file: the script reads no more than the last 32 KiB.
- [ ] Drift: the set of guard numbers in the hook's dispatch equals the set of guards in the script's lane table.
- [ ] `--detail` prints every D3 lane and at most 20 events.
- [ ] `--project` into a temporary directory deploys `flow-status.mjs` and `commands/cc-flow.md`.
- [ ] `--project` with no `statusLine` anywhere adds the entry. With one in the project or the user `settings.json`, both files stay byte-identical and the skip line is printed.

Manual protocol, not in CI:

- [ ] In a live session, trigger an allow, a deny and an ask. The status line shows each within one refresh, as recorded in T-001-B.
- [ ] Corrupt the last line by hand. The status line shows `flow: unreadable, retrying` or repairs on the next append. It never shows a stack trace.
- [ ] Run `/cc-flow`. The lanes and events match the file.

## Commit order

1. `test: add the cross-platform append and rotation probes [ID]` (T-001)
2. `feat: emit flow events from the pre-tool-use hook [ID]` (T-003, T-004)
3. `feat: add the flow status line and /cc-flow [ID]` (T-005 to T-007)
4. `feat: deploy and ignore the flow status files [ID]` (T-008, T-009)
5. `feat: add the optional flow viewer page [ID]` (T-010, only under D2 option (a))
6. `docs: describe the flow status line in the README [ID]` (T-011)

`[ID]` is the minted id. One PR, one item.

## Constraints checked

From `CONTRIBUTING.md`, "What contributors must never do" and "Records are owner-side":

- No version bump, no `CHANGELOG.md` heading, no release branch or tag. The version this ships under is assigned by the owner at release.
- No self-assigned id. The headers say "unminted" until T-000.
- `dependencies` stays `{}`. No surface loads anything from a network.
- The installer is exercised through its tests in temporary directories, never run in this repository.
- The hook, the installer and `settings.json` are protected surfaces: T-002 writes the predicted red table first, and the `statusLine` entry waits for owner approval at the gate.
- Guard 3's frozen authority is not touched.

## Identified risks

Carried from the spec: R1 torn lines (T-001-A decides), R2 refresh cadence (T-001-B), R3 host status line, R4 hook size, R5 rotation spike.

Added by the plan:

- **Test baselines move with every merge ahead of this one.** The counts in T-002 are taken from `main` on the day implementation starts, not from today.
- **PR #80 adds wiki drift tests.** If it merges first, `/cc-flow` may need a row in the commands wiki page template. Check at T-002.
- **Keepers from #83.** The probe code in #83 is evidence, not shipped code. The parts that become real tests are cherry-picked into T-001 and T-004 and rewritten under `tests/**/*.test.js`.
