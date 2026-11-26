# BUG-092: Test-surface split bypassable through the recorded test command

**Status:** Draft (pending independent review)

Source: the `[BUG-092]` entry in `AGENT-READABLE BACKLOG.md` (PILLAR 5), the intake of issue #312, a follow-up of `[FEAT-033]`. The entry names a symptom, an impact and two fix shapes, (a) and (b), and leaves the choice open; "Choices the entry leaves open" below names the one this spec takes. Acceptance criteria are tagged `[A]` (fix shape a, the stated limit) and `[B]` (fix shape b, the comparison by role).

**Read-budget disclosure.** `/cc-spec` caps `.mjs` and `.js` reads at the first 30 lines from offset 0. That cap was not held for every file. These ranges were read past it, through `sed -n` or Grep output, and every line number cited below comes from those reads:

- `scripts/orchestrate.mjs` lines 90-105, 290-305, 620-650, 717-800, 1140-1215 and 1270-1300 (`sed -n`);
- `.claude/hooks/pre-tool-use.mjs` lines 228 and 305-319 (Grep output only);
- `tests/unit/role-profiles.test.js` lines 100-125 and 185-200; `tests/scripts/orchestrate.test.js` and `tests/installer/commands-parity.test.js` by Grep only.

**Line drift.** The entry cites `.claude/agents/test-writer.md:32` and `.claude/agents/code.md:10`. On `main` @ `ab0649e` the files are 30 and 29 lines long; the sentences the entry means are `test-writer.md:13` ("Guard 5 denies a write outside the run's test surface, whatever your scope lists.") and `code.md:13` ("Do not edit files in the run's test surface; …"). `pre-tool-use.mjs:310` (`testSurfaceDenial`) still matches.

## Problem

FEAT-033 splits Build writes by path: Guard 5's `testSurfaceDenial` (`.claude/hooks/pre-tool-use.mjs:310-319`) denies `code` a write inside the run's `test_surface` and `test-writer` a write outside it. The check runs only for the write-tool family (`Write`, `Edit`, `create_file`, `write_file`). Both roles hold `Bash`, which Guard 7 limits to the run's recorded test command, and that command executes the files the role just wrote. So:

- a `test-writer` can write a test that, when the suite runs, writes or rewrites a source file;
- a `code` agent can write source that, when the suite loads it, writes or rewrites a test file, for example a snapshot.

Either change lands on the other role's side of the split, and nothing in the run notices: `claimHalt` (`scripts/orchestrate.mjs:1147-1158`) checks only the paths the hand-back lists in `ops.f`, which the agent writes itself.

This is not a regression (before FEAT-033, `code` wrote and ran its own tests with no split). The defect is that both agent profiles, the README's Guard 5 paragraph and the FEAT-033 spec present the split as a guard-enforced boundary, when it holds only against direct tool writes, and that the run has no way to see a crossing made through the test command. FEAT-033's spec already lists "Files the test command itself writes through `Bash`" as out of scope (its "Out of Scope", 5th bullet), but neither profile says so.

## Solution

Take both fix shapes. (a) State the limit where the split is described: both agent profiles (both copies), the README's Guard 5 paragraph, the wiki's band-roles page and an amendment note in the FEAT-033 spec. (b) Make the comparison by role deterministic in `scripts/orchestrate.mjs`, instead of in the `audit` role: when `install` writes the envelope for `test-writer` or `code` on a run with a test surface, it records a fingerprint of the work tree's changed files in the run file; when `handback` for that role arrives, it fingerprints the tree again, takes the files whose content changed during the dispatch, and halts `ORCH_HANDBACK_SURFACE_CROSSED` when any of them is on the other role's side of the split, whatever `ops.f` lists. A crossing made through the test command then halts the run at the hand-back of the role that made it, naming the files.

### Choices the entry leaves open

1. **Both (a) and (b), not one.** (a) alone leaves the split a documented hole the owner has to check by hand (the README's open-defect line already asks for exactly that comparison). (b) alone leaves the profiles claiming more than Guard 5 does. The profiles keep telling each role what Guard 5 denies, and add what the hand-back check catches.
2. **The comparison runs in the orchestrator script, not in `audit`.** The entry's (b) names the audit role and "the files actually changed in the commit". Neither is available: `audit` holds only `Read`, `Grep` and `Glob` (`.claude/agents/audit.md:4`, `:30`), so it cannot ask git what changed, and a run commits nothing per role, so there is no per-role commit to compare with. What tells two roles' writes apart is when they happened, and only the script sees both ends of each dispatch (`install` right before it, `handback` right after). The script already compares the work tree with git for `qa` (`changeList`, `:725-742`), so this adds no new kind of dependency.
3. **The check is the split, not `ops.f` completeness.** A file the role changed on its own side of the split but left out of `ops.f` does not halt. The entry's harm is a crossing of the split; halting on every unlisted artifact of a test run would stop runs the split does not concern. `ops.f` keeps today's `claimHalt` check. Which artifacts are "on the role's own side" depends on the role: a coverage report or a cache the test runner writes into a non-ignored folder outside the surface is on `code`'s side, so it never stops `code`, but it is a crossing for `test-writer` and halts its hand-back (Error cases, "false positives"). The check does not try to tell a runner artifact from a source file: both ship in the change, and the remedy is to ignore the artifact, not to widen what `test-writer` may change.
4. **Changes are measured by content, not by name.** A file `code` modified in task 1 is already dirty when `test-writer` runs for task 2; a list of dirty names would not show `test-writer` changing it again. The fingerprint maps each dirty path to a hash of its bytes (or to "absent" for a deleted one), and a path counts as changed during the dispatch when it is in only one of the two fingerprints or its hash differs. A file reverted to `HEAD` during the dispatch leaves the second fingerprint and so counts as changed.
5. **The dirty set excludes ignored files and the run's own files.** It is the tracked files that differ from `HEAD` (every tracked file when there is no `HEAD`) plus the untracked files the ignore rules do not hide, relative to the project root, as `changeList` lists them before BUG-091's ignored-path additions. Ignored files are left out: they do not ship in the change, and listing them would hash `node_modules`. Paths under `.conductor/` (the hand-back files the main session writes before `handback`), `.claude/memory/orchestrator-run.json` and `.claude/memory/band-envelope.json` are left out, since the orchestrator writes them during the dispatch window.
6. **Git unavailable fails open, visibly.** When git cannot list the tree at `install` or at `handback` (no git, not a work tree), the hand-back is not halted: the run continues as it does today, the `handback` stdout line gains `; split check: unavailable (<reason>)`, and the recorded entry carries `split_check: "unavailable (<reason>)"`. This matches how `changeNote` degrades (`:744-753`) and keeps the check from blocking runs it cannot judge; the README states it.

No owner decision is at stake: the change adds no network, dependency or installed permission, and it narrows what a run accepts rather than widening any role's permissions.

## Behavior

### Main path

1. A run with `test_surface: ["tests/**"]` reaches Build task 2, which declares `src/a.js` and `tests/a.test.js`. `install test-writer` writes the envelope as today and also writes `build_tree: { role: "test-writer", files: { <path>: <sha256 | "absent">, … } }` into the run file, from the current dirty set.
2. `test-writer` writes `tests/a.test.js` and runs the test command. Its hand-back lists `tests/a.test.js:C`.
3. `handback test-writer` runs today's checks (role, gate, `claimHalt`), then fingerprints the tree again. The only path changed during the dispatch is `tests/a.test.js`, inside the surface: the hand-back is recorded as today, and `build_tree` is removed from the run file.
4. `install code` records a fresh `build_tree` for `code`; `code` changes `src/a.js` and the plan; `handback code` finds both outside the surface and records the hand-back as today.

### Alternative paths

- **A run without `test_surface`** (from before FEAT-033): `install` records no `build_tree` and `handback` runs no split check, as Guard 5 runs no `BAND_TEST_SURFACE` check for such a run.
- **Fix rounds:** a `test-writer` or `code` fix-round dispatch is fingerprinted and checked the same way.
- **`install --check`:** writes nothing, so it records no `build_tree`.
- **A re-install for the same position** (after a refusal or a `resume`): it overwrites `build_tree`, so changes made before it count as the baseline. That includes a file that crossed the split in the halted dispatch: it is part of the new baseline and is not checked again unless the next dispatch changes it once more.
- **`resume`:** drops `build_tree` from the run file, as it already removes the halted agent's envelope; the next `install` records a fresh one. A resumed run therefore never checks a hand-back against a fingerprint taken before the halt.
- **A `handback` with no `build_tree` for that role** (the run file was written by a version before this fix, mid-dispatch): no split check, and the stdout line and entry carry `split check: unavailable (no fingerprint recorded at install)`.
- **A file on the role's own side that `ops.f` does not list:** not halted (choice 3).
- **Case:** a path matches the surface case-folded, through the existing `matchesSurface` (`:294`), as Guard 5 matches it.

### Error cases

- **`test-writer` changes `src/a.js` through the test command:** `handback test-writer` halts `ORCH_HANDBACK_SURFACE_CROSSED: test-writer changed src/a.js during its dispatch, outside the test surface ["tests/**"]`. The hand-back is not recorded, as for `ORCH_HANDBACK_OUT_OF_SCOPE`; recovery is `resume` or `end`, then `start`. `resume` does not revert the crossing: the halt leaves the changed file in the tree, and the re-install takes it as baseline (Alternative paths). The owner reviews the named files and keeps or reverts them by hand before `resume`; the `/cc-orchestrate` copies and the README say so.
- **`code` changes `tests/a.test.js` through the test command:** `handback code` halts `ORCH_HANDBACK_SURFACE_CROSSED: code changed tests/a.test.js during its dispatch, inside the test surface ["tests/**"]`. A snapshot the suite writes on `code`'s run halts the same way (the false positive below).
- **Several crossings:** the message names every crossing path, sorted, comma-separated.
- **False positive, `test-writer`: a non-ignored runner artifact outside the surface.** The test command writes a coverage report or a cache (for example `coverage/index.html` or `.vitest-cache/…`) into a folder the ignore rules do not hide. `handback test-writer` halts `ORCH_HANDBACK_SURFACE_CROSSED: test-writer changed coverage/index.html during its dispatch, outside the test surface ["tests/**"]`, and it does so on every dispatch, since the report changes on every run. Expected exit: the owner adds the artifact's folder to the ignore rules (or drops the flag that writes it from the recorded test command), deletes the artifact, and runs `resume`. A `resume` alone does not help: the next run of the suite rewrites the artifact and halts again.
- **False positive, `code`: a snapshot created on the first passing run.** `test-writer` writes a `toMatchSnapshot` test; it fails before writing the snapshot because the implementation does not exist yet. When `code` runs the suite, the test passes and the runner creates `tests/__snapshots__/a.test.js.snap`, inside the surface: `handback code` halts `ORCH_HANDBACK_SURFACE_CROSSED: code changed tests/__snapshots__/a.test.js.snap during its dispatch, inside the test surface ["tests/**"]`. This is the legitimate write FEAT-033's spec names as out of scope for Guard 5, and the check cannot tell it from a test `code` rewrote. Expected exit: the owner reviews the new snapshot and keeps it (or deletes it), then runs `resume`; the re-installed `code` dispatch takes the snapshot as baseline, and the suite no longer rewrites it, so the hand-back passes.
- **A malformed `build_tree`** (not an object, wrong role, `files` not an object of strings): treated as no fingerprint (the alternative path above), never as an empty one, so it cannot make every file look new or every change look absent.

## Acceptance Criteria

- [ ] `[A]` `.claude/agents/test-writer.md` and `project-template/.claude/agents/test-writer.md` say that Guard 5 denies only direct writes, that files changed while the test command runs count as the role's writes, and that the orchestrator halts the run on one outside the test surface; the FEAT-033 phrases `tests/unit/role-profiles.test.js` pins stay (`tests/unit/role-profiles.test.js`).
- [ ] `[A]` `.claude/agents/code.md` and its `project-template` copy say the same for a file inside the test surface, keeping `CODE_LEAVES_TESTS` (`tests/unit/role-profiles.test.js`).
- [ ] `[A]` The README's "Guard 5 in detail" paragraph says the split holds against write tools only and that the hand-back check catches a crossing made through the test command, including its fail-open case and its two known false positives (a non-ignored runner artifact outside the surface stops `test-writer`, to be ignored before `resume`; a snapshot created on `code`'s first passing run stops `code`, to be reviewed and kept before `resume`) and that `resume` does not revert a crossing; `.github/wiki/pages/Band-Roles-and-Agents.md` says it in one sentence.
- [ ] `[A]` The FEAT-033 spec carries an amendment note under its "Out of Scope" bullet on files the test command writes, pointing to BUG-092's check; its Status line is unchanged.
- [ ] `[A]` The four `/cc-orchestrate` copies (`.claude/commands/`, `project-template/.claude/commands/`, `project-template/.agents/skills/cc-orchestrate/SKILL.md`, `project-template/.agents/workflows/cc-orchestrate.md`) name `ORCH_HANDBACK_SURFACE_CROSSED` beside the existing hand-back halts, with its recovery (`tests/installer/commands-parity.test.js`).
- [ ] `[B]` On a run with a test surface, `install test-writer` and `install code` record `build_tree` for their role; `install --check` and every other role record none (`tests/scripts/orchestrate.test.js`).
- [ ] `[B]` `handback test-writer` halts `ORCH_HANDBACK_SURFACE_CROSSED`, recording nothing, when a file outside the surface changed during the dispatch, whether or not `ops.f` lists it; `handback code` halts the same when a file inside the surface changed (`tests/scripts/orchestrate.test.js`, temp git repositories).
- [ ] `[B]` A file already dirty before the dispatch and modified again during it counts as changed; a dirty file left untouched does not; a file reverted to `HEAD` during it counts as changed (`tests/scripts/orchestrate.test.js`).
- [ ] `[B]` Changes under `.conductor/`, to the run file and to the envelope, ignored files, and unlisted changes on the role's own side do not halt (`tests/scripts/orchestrate.test.js`).
- [ ] `[B]` A run without `test_surface` records no `build_tree` and runs no check; a missing or malformed `build_tree`, or git unable to list the tree, records the hand-back with `split check: unavailable (<reason>)` on stdout and `split_check` in the entry (`tests/scripts/orchestrate.test.js`).
- [ ] `[B]` A recorded hand-back removes `build_tree` from the run file, and `resume` drops it; after a halted crossing, `resume` and a re-install for the same role record a fingerprint that includes the crossed file, and an unchanged re-run hands back without a halt (`tests/scripts/orchestrate.test.js`).
- [ ] `npm test` exits 0.

## Out of Scope

- Blocking the crossing as it happens: Guard 7 allows the test command byte for byte and cannot see what the files it runs do. This fix detects at hand-back; it does not prevent.
- Writes into ignored paths or outside the project root, and a test that undoes its own change before the hand-back: they leave the change unaltered, which is what ships.
- A non-cooperative agent that rewrites the run file's `build_tree` through the test command: Guard 5 and the run file assume cooperative agents (README, "Guard 5 in detail"); hardening against that is a separate posture question.
- `ops.f` completeness on the role's own side (choice 3), and any change to `audit`, `security`, `qa`, `docs` or `release`.
- The README "Known limits" line for `[BUG-092]` and every other record: the release removes or rewrites it.
- `.github/workflows/` and `.github/actions/`.

## System Impact

- `scripts/orchestrate.mjs`: a tree-fingerprint helper beside `changeList`; `install` (record `build_tree` for `test-writer` and `code` when `surfaceOf(run)` is defined and not `check`); `handback` (the split check after `claimHalt`, the note, removal of `build_tree`); `entryFields` or `recordHandback` for `split_check`; the halt code. `resume` drops `build_tree` from the run it writes (beside its envelope removal), and the next `install` records it again.
- `.claude/agents/test-writer.md`, `.claude/agents/code.md` and their `project-template` copies (one sentence each).
- The four `/cc-orchestrate` copies (one clause in the hand-back halts paragraph).
- `README.md` ("Guard 5 in detail" only), `.github/wiki/pages/Band-Roles-and-Agents.md`, `docs/superpowers/specs/2026-11-23-feat033-test-writer-agent-build-band-design.md` (amendment note).
- Tests: `tests/scripts/orchestrate.test.js`, `tests/unit/role-profiles.test.js`, `tests/installer/commands-parity.test.js`.
- Not touched: `.claude/hooks/pre-tool-use.mjs` and its mirror (Guards 5 and 7 behave as today), the SNAP contract and envelope versions, the installer, settings. No network, dependency or installed-permission change.

### Files Requiring Full Read (deferred to /cc-plan)

- `scripts/orchestrate.mjs` (1903 lines): `saveRun`/`saveHandedBackRun`, `recordHandback`, `resume`, the run-file shape checks, and where `install` and `handback` are reached for fix rounds.
- `tests/scripts/orchestrate.test.js`: its temp-repository and live-run fixtures, around the BUG-089/BUG-091 change-list tests (`:5077`, `:5210`) and the FEAT-033 hand-back tests (`:5601-5629`).
- `tests/unit/role-profiles.test.js` and `tests/installer/commands-parity.test.js`: their pinning helpers.

## Complexity Estimate

M: one new check in one script with its run-file field and halt, plus one sentence in each of nine documents; no hook, contract or installer change.
