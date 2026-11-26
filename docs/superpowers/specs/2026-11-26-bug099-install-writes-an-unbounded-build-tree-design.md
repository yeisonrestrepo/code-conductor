# BUG-099: Install writes an unbounded build_tree fingerprint to the run file

**Status:** Draft (pending independent review)

Source: the `[BUG-099]` entry in `AGENT-READABLE BACKLOG.md` (PILLAR 5), the intake of issue #340, a follow-up of `[BUG-092]`. The entry names a symptom, an impact, two fix shapes and one required test, and leaves the choice of shape open; "Choices the entry leaves open" below names the one this spec takes and why.

**Read-budget disclosure.** `/cc-spec` caps `.mjs` and `.js` reads at the first 30 lines from offset 0. That cap was not held. These ranges were read past it, through `sed -n` or Grep output, and every line number cited below comes from those reads on `main` @ `4bfb95f`:

- `scripts/orchestrate.mjs` lines 112-122, 192-206, 255-275, 740-805, 1192-1232, 1598-1612 and 1805-1818 (`sed -n`), plus Grep for `saveRun(`, `build_tree` and `ROUTER_DIR`;
- `.claude/hooks/pre-tool-use.mjs` lines 166, 189, 236-244 (Grep output and `sed -n`);
- `tests/installer/commands-parity.test.js` lines 460-475 (`sed -n`); `tests/scripts/orchestrate.test.js` by Grep only.

**Line check.** The entry's `scripts/orchestrate.mjs:801` (the `saveRun` in `install`) and `:267` (the bound check in `saveHandedBackRun`) still match on `4bfb95f`.

## Problem

BUG-079 bounded the run file (`.claude/memory/orchestrator-run.json`) at `RUN_FILE_MAX_BYTES`, 8 MiB (`scripts/orchestrate.mjs:118`), 2 MiB under the 10 MiB at which the hooks stop reading it (`.claude/hooks/pre-tool-use.mjs:166`, `:244`). It enforced that bound only on the write that could grow the file then, the hand-back (`saveHandedBackRun`, `:264-271`); every other write goes through `saveRun` (`:261`), which has no size check, on the reasoning that the other writes add a few fields.

BUG-092 added a write that is not small. On a run with a test surface, `install test-writer` and `install code` store `build_tree` (`buildTree`, `:763-767`), a map with one sha256 per tracked changed file and per untracked, non-ignored file (`treeFingerprint`, `:750-760`), through that unchecked `saveRun` (`:801`). Its size grows with the work tree, not with the plan: at about 110 bytes per entry, some 76 000 such files reach the 8 MiB bound and about 95 000 reach the hooks' 10 MiB cap. An unignored dependency folder or a set of generated fixtures is enough.

Past the cap, while `code` or `test-writer` runs, the hooks read the run as absent: Guard 5's test-surface split (`BAND_TEST_SURFACE`) stops applying, so `code` may write tests and `test-writer` may write source through the write tools, and Guard 6 only warns. The hand-back's split check (`splitCheck`, `:1194-1206`) still catches a crossing afterwards, and the hand-back write drops `build_tree` (`:1227`), but nothing keeps the file readable during the dispatch, which is the window the hooks exist for.

## Solution

`install` serializes the run it is about to save and compares its byte length with `RUN_FILE_MAX_BYTES` before writing anything. Over the bound, it halts `ORCH_RUN_FILE_FULL`: no envelope is written, the run file keeps the content it had before the verb, and the halt names the would-be size, the bound, the fingerprint's file count when one was computed, and the recovery. At or under the bound, `install` writes the envelope and the run as today. Every run file a successful `install` leaves on disk is then at or under 8 MiB, so the hooks read it for the whole dispatch.

### Choices the entry leaves open

1. **Halt at `install`, not a separate fingerprint file.** The entry offers both. A file under `.conductor/` would remove the bound from the fingerprint and let a huge tree dispatch, but it splits the run's state across two files that `install`, `handback`, `resume` and `end` must keep consistent, and BUG-092's `ORCH_HANDBACK_SPLIT_UNVERIFIED` handling would gain a second way to go missing or stale (a file left from an earlier install, a file deleted without the run noticing). `.conductor/` is also where the main session writes hand-back files during the dispatch, a folder the orchestrator's own write surface covers (`pre-tool-use.mjs:238`). Halting keeps the fingerprint and the run in one atomic write, reuses BUG-079's bound, code and message shape, and changes no file layout. The cost is that a run over a tree this large cannot dispatch `code` or `test-writer` until the tree shrinks; a tree of 76 000 unignored changed files is almost always a missing ignore rule, and the halt says so.
2. **The check covers every `install` write, not only the two build roles.** Every other role adds only `band`, `role` and `dispatch_model`, so its check passes whenever BUG-079's checked hand-back passed; checking it too costs one `Buffer.byteLength` and means no `install` can write a run file the hooks cannot read. The fingerprint clause of the message appears only when `build_tree` was computed.
3. **The check runs before the envelope is written.** Today `install` writes the envelope (`:798`) before the run (`:801`). A halt after the envelope would leave an installed envelope for a dispatch that never happens. The check therefore moves the size computation ahead of both writes; the order of the two writes does not change.
4. **Recovery depends on what made the run large.** When a fingerprint was computed, the message says to hide generated files behind an ignore rule (or remove them), then `resume`, or `end`, then `start`. `resume` is not changed: it already drops `build_tree` (`:1602`) and keeps the records, and the re-dispatched `install` fingerprints the smaller tree. Without a fingerprint, the run itself is near the bound from stored hand-backs, and the message gives BUG-079's recovery: `end`, then `start` with a smaller plan.
5. **The required test crosses the bound with a padded run, not a 76 000-file tree.** The entry asks for a test "that installs `code` over a tree large enough to cross the bound". Creating, git-listing and hashing ~76 000 files in a temp repository would add tens of seconds to the suite on every leg. The test instead pads the run file, through recorded hand-backs as RS3c does (`tests/scripts/orchestrate.test.js:3079`), to a known distance under the bound, then creates enough untracked files in a temp git repository that their fingerprint alone carries `install code` across it. The bound and the path through `treeFingerprint` are the real ones; only the starting size is set up. A second test keeps the same padded run and a tree just small enough to stay under, and asserts that `install` succeeds, so the check is pinned on both sides.

## Behavior

### Main path

1. A run with `test_surface: ["tests/**"]` reaches a Build task whose next step is `code`. `install code` builds and validates the envelope as today, computes `build_tree` for `code`, and serializes the run it would save.
2. The serialized run is at or under `RUN_FILE_MAX_BYTES`: `install` writes the envelope, then the run with `build_tree`, and prints its stdout as today.
3. During the dispatch the hooks read the run file (at most 8 MiB), so Guard 5's split and Guard 6 apply as designed; the hand-back's split check runs as today.

### Alternative paths

- **A run without `test_surface`, or any role other than `code` and `test-writer`:** no fingerprint is computed; the check still runs and passes for any run a checked hand-back left at or under the bound.
- **`install --check`:** writes nothing and computes no fingerprint, as today, so it runs no size check and cannot predict this halt.
- **A fingerprint recorded as `unavailable`** (git cannot list the tree): the entry is a few bytes; the check runs and passes as for any other small install.
- **`resume` after the halt:** `resume` is unchanged; it clears the halt, drops `build_tree` and keeps the records. The re-dispatched `install` computes a new fingerprint and runs the check again, so a tree that was not reduced halts again with the same message.
- **The run exactly at the bound:** `bytes > RUN_FILE_MAX_BYTES` halts, as in `saveHandedBackRun`; equal passes.

### Error cases

- **Fingerprint carries the run over the bound:** `install code` (or `install test-writer`) halts `ORCH_RUN_FILE_FULL: the run file would be <n> bytes with this code install, whose fingerprint lists <k> changed or untracked files, over the 8388608-byte bound that keeps it readable by the hooks; hide generated files behind an ignore rule, then resume, or end, then start`. No envelope is written (an envelope from an earlier dispatch is not touched), and the run file holds what it held before the verb plus the halt `cli` records (`recordHalt`, `:1812-1816`), which saves the earlier, smaller run.
- **Run already near the bound without a fingerprint:** `install <role>` halts `ORCH_RUN_FILE_FULL: the run file would be <n> bytes with this <role> install, over the 8388608-byte bound that keeps it readable by the hooks; end, then start with a smaller plan`, with the same effects.

## Acceptance Criteria

- [ ] `install code` on a run with a test surface, in a temp git repository whose untracked files make the serialized run exceed `RUN_FILE_MAX_BYTES`, exits with stderr starting `ORCH_RUN_FILE_FULL: ` and naming the would-be size, the fingerprint's file count, the bound and the recovery (`tests/scripts/orchestrate.test.js`, the test the entry asks for).
- [ ] After that halt the run file is at or under `RUN_FILE_MAX_BYTES`, holds no `build_tree` and the same `role` and `handbacks` as before the verb, `run.halt.code` is `ORCH_RUN_FILE_FULL`, and no envelope was written by the verb (`tests/scripts/orchestrate.test.js`).
- [ ] With the same padded run and a tree small enough to stay under the bound, `install code` succeeds and the run file it writes, `build_tree` included, is at or under `RUN_FILE_MAX_BYTES` (`tests/scripts/orchestrate.test.js`).
- [ ] An `install` of a role that records no fingerprint, on a run whose serialized form would exceed the bound, halts `ORCH_RUN_FILE_FULL` with the `end`, then `start` with a smaller plan recovery and writes no envelope (`tests/scripts/orchestrate.test.js`).
- [ ] After the fingerprint halt, `resume` followed by a re-install over a reduced tree records the dispatch (`tests/scripts/orchestrate.test.js`).
- [ ] BUG-079's RS3c and RS3d and BUG-092's split-check tests pass unchanged.
- [ ] The four `/cc-orchestrate` copies (`.claude/commands/cc-orchestrate.md`, `project-template/.claude/commands/cc-orchestrate.md`, `project-template/.agents/skills/cc-orchestrate/SKILL.md`, `project-template/.agents/workflows/cc-orchestrate.md`) say, in the `install` halts paragraph, that `install <role>` halts `ORCH_RUN_FILE_FULL` when the run it would write exceeds the bound, that no envelope is installed, and both recoveries; `tests/installer/commands-parity.test.js` pins the sentence beside its BUG-079 case.
- [ ] The README's "Guard 5 in detail" paragraph, where it describes the `install` fingerprint, says in one clause that `install` halts `ORCH_RUN_FILE_FULL` rather than write a fingerprint that would carry the run file past the bound.
- [ ] `npm test` exits 0.

## Out of Scope

- Storing the fingerprint outside the run file, compressing it, or capping the number of fingerprinted files (choice 1).
- Size checks on the other unchecked `saveRun` writes (halt, approvals, dispatch fields, `resume`): they add a few fields or shrink the run, and BUG-079's 2 MiB headroom covers them.
- How the hooks behave on a run file over their cap; this item keeps the file under it and does not change them.
- The fingerprint's other open defects, `[BUG-097]` (symbolic links) and `[BUG-098]` (moving `HEAD`, ignore rules), and the cost of hashing a large tree.
- The README "Known limits" line for `[BUG-099]`, `CHANGELOG.md`, `VERSION` and every other record: the release writes them.
- `.github/workflows/` and `.github/actions/`.

## System Impact

- `scripts/orchestrate.mjs`: `install` (`:781-803`) computes `build_tree` and the serialized run before the envelope write and halts over the bound; `saveHandedBackRun` (`:264-271`) is the model for the check, and the plan may share one bounded-save helper between the two if the messages stay as specified. No change to `buildTree`, `treeFingerprint`, `splitCheck`, `handback`, `resume`, `recordHalt`, the run-file shape or the halt-code set (`ORCH_RUN_FILE_FULL` exists).
- The four `/cc-orchestrate` copies (one sentence each in the `install` halts paragraph) and `README.md` ("Guard 5 in detail", one clause).
- Tests: `tests/scripts/orchestrate.test.js` (new cases beside RS3c/RS3d and the BUG-092 block at `:5656`), `tests/installer/commands-parity.test.js` (one `has` case).
- Not touched: `.claude/hooks/pre-tool-use.mjs` and its mirror, the SNAP contract and envelope versions, the installer, settings. No network, dependency or installed-permission change; the change only adds a halt where the run would otherwise outgrow what the hooks read.

### Files Requiring Full Read (deferred to /cc-plan)

- `scripts/orchestrate.mjs` (1955 lines): `install` and its callers (fix rounds, `cli`), `Halt` and `recordHalt`, to place the check ahead of both writes.
- `tests/scripts/orchestrate.test.js`: RS3c/RS3d's padding helper (`:3079-3110`) and the BUG-092 temp-repository fixture (`:5656` onward), to build the padded run over a git work tree.
- `tests/installer/commands-parity.test.js`: its `has` helper and the four-copy loop.

## Complexity Estimate

S: one size check moved ahead of two writes in one function, reusing an existing bound and halt code, plus one sentence in five documents and four tests.
