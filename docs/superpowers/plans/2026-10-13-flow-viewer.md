# Flow viewer implementation plan

**Issue:** #57
**Spec:** `docs/superpowers/specs/2026-10-13-flow-viewer-design.md`
**Date:** 2026-10-13
**Status:** Candidate (unminted; the id is assigned by the maintainer). Not started.

---

## Gate

Nothing below T-000 starts until both hold:

- the owner has minted an id for this item, and
- the owner has approved the spec, including decisions D1, D3 and D4.

The PR that carries this plan contains the spec, the plan and two `.gitignore` leaf lines. It contains no code.

## Tasks

- [ ] [T-000] Intake. Record the minted id in the spec and plan headers, and move the work to a branch named for it.
- [ ] [T-001] Measure before building. No shipped code.
    - [ ] [T-001-A] Parallel-append probe: 8 processes, 200 appends each, of a 258-byte `flowEvent(...)` line. Assert every line of the result parses. Run on the Windows, macOS and Linux CI legs.
    - [ ] [T-001-B] Load `script.html` from the spec's M2 from `file://` in Firefox and Safari.
    - [ ] [T-001-C] Record both results in this plan. A torn line in T-001-A switches D1 to its fallback and returns the spec to the owner before T-003.
- [ ] [T-002] Write the predicted red table: every existing suite expected to move, by name, with the count, before any run. Expected so far: `tests/installer/templates.test.js` (two pinned ignore-line lists). To check and name: `tests/unit/host-owned-ignore-xor.test.js`, `tests/installer/deploy.test.js`, `tests/hooks/pre-tool-use-contract.test.js`.
- [ ] [T-003] Emitter in `project-template/.claude/hooks/pre-tool-use.mjs`.
    - [ ] [T-003-A] A table from guard function to guard number, and a `passed` list filled by the loop in `main()`.
    - [ ] [T-003-B] `recordFlowEvent(payload, decision, passed)`: builds the D5 event, called after `emit()`, whole body in its own `try`/`catch`.
    - [ ] [T-003-C] `rotateFlowEvents(path, size)`: past 160 KiB, last 250 lines to a temporary file, then rename.
    - [ ] [T-003-D] `CC_FLOW_OFF`, and the no-`.claude/`-directory return.
    - [ ] [T-003-E] Copy the result over `.claude/hooks/pre-tool-use.mjs` and compare the two with `git hash-object`.
- [ ] [T-004] `tests/hooks/flow-events.test.js`. See the test list.
- [ ] [T-005] `project-template/.claude/flow-viewer.html`: the D3 lanes as inline SVG, the script-element poll, per-guard counts, last verdict per lane, the event log, the two status messages. `textContent` only.
- [ ] [T-006] `tests/installer/flow-viewer.test.js`. See the test list.
- [ ] [T-007] `project-template/gitignore`: add `.claude/flow-events.*`. Update the two pinned lists in `tests/installer/templates.test.js`.
- [ ] [T-008] `lib/installer/deploy.mjs`: one `report()` line in `deployProject` naming `.claude/flow-viewer.html`. One assertion in `tests/installer/deploy.test.js`.
- [ ] [T-009] A short "Flow viewer" section in `README.md`: what it shows, how to open it, `CC_FLOW_OFF`. Not the "Known limits" lines, which are owner-side.
- [ ] [T-010] Full suite. Compare against the T-002 table. Run the manual protocol. State the counts in the PR description.

## Test list

`tests/hooks/flow-events.test.js`, each case spawning the hook in a temporary directory:

- [ ] One event per call, with the D5 fields, for an allow on each lane.
- [ ] A deny from each of guards 1 to 7 records that guard's number and the guards that passed before it.
- [ ] Guard 2's ask records `verdict: "ask"`.
- [ ] Fail-open: with the event path occupied by a directory, stdout, stderr and exit code are byte-identical to a `CC_FLOW_OFF` run, on an allow, a deny and an ask.
- [ ] `CC_FLOW_OFF` creates no file. No `.claude/` directory creates no file and no directory.
- [ ] An unparseable payload still fails closed and writes no event.
- [ ] Rotation: a file seeded past 160 KiB holds 251 lines after one call, and every line parses.
- [ ] A Bash command holding a secret-shaped argument leaves only its first word in the file.
- [ ] A `target` holding `</script>`, a quote and a newline produces a line that parses back to the same string.

`tests/installer/flow-viewer.test.js`, reading the file as text:

- [ ] Drift: the set of guard numbers in the hook's dispatch equals the set of guard nodes in the viewer.
- [ ] No `http://` or `https://` substring. No `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write`.
- [ ] `--project` into a temporary directory leaves `flow-viewer.html` under `.claude/` and prints its path.

Manual protocol, not in CI:

- [ ] Open the deployed viewer from `file://` in Chrome, Edge, Firefox and Safari. Trigger an allow, a deny and an ask in a session. Each appears within two polls.
- [ ] Corrupt the last line by hand. The viewer shows the unreadable message and keeps its last state. Remove the line. It recovers.

## Commit order

1. `test: add the parallel-append and transport probes [ID]` (T-001)
2. `feat: emit flow events from the pre-tool-use hook [ID]` (T-003, T-004)
3. `feat: add the flow viewer page [ID]` (T-005, T-006)
4. `feat: deploy and ignore the flow viewer files [ID]` (T-007, T-008)
5. `docs: describe the flow viewer in the README [ID]` (T-009)

`[ID]` is the minted id. One PR, one item.

## Constraints checked

From `CONTRIBUTING.md`, "What contributors must never do" and "Records are owner-side":

- No version bump, no `CHANGELOG.md` heading, no release branch or tag. The version this ships under is assigned by the owner at release.
- No self-assigned id. The headers say "unminted" until T-000.
- `dependencies` stays `{}`. The viewer loads nothing from a network.
- The installer is exercised through its tests in temporary directories, never run in this repository.
- The hook and the installer are protected surfaces: T-002 writes the predicted red table first.
- Guard 3's frozen authority is not touched.

## Identified risks

Carried from the spec: R1 torn lines (T-001-A decides), R2 non-Chromium browsers (T-001-B), R3 hook size, R4 rotation spike.

Added by the plan:

- **Test baselines move with every merge ahead of this one.** The counts in T-002 are taken from `main` on the day implementation starts, not from today.
- **PR #80 adds wiki drift tests.** If it merges first, a new hook behavior may need a line in a wiki page template. Check at T-002.
- **The manual protocol is the only evidence for AC3.** Without a browser in `devDependencies`, rendering is not asserted in CI. Adding one is the owner's decision and is not proposed here.
