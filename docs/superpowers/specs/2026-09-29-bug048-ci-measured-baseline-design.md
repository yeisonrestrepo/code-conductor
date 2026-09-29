# BUG-048: CI's Green Was Never a Measured Baseline, and Its Runtime Is Deprecated

**Status:** APPROVED 2026-09-29 (D1-D4 as recommended) with refinements R1 (the launch checklist's frozen test count joins the rule surface) and R2 (publish.yml's exclusion from the skip-baseline gate is stated, not implied)
**Branch:** `fix/bug-048-ci-measured-baseline`
**Backlog:** `[BUG-048]`, filed at the 1.34.0 closeout (`c3e608d`)

## Problem

For every release to date, CI has been green on a baseline nobody measured:

- **Local:** 1009 passed / 12 skipped on Node 24.
- **CI:** 925 passed / 96 skipped on Node 20, for the same 1021 tests.
- **Before this branch:** `main` already read 913 / 95 at `b915c31` (run `36636754979`).

The gap sat inside green runs because nothing asserted CI's skipped set. It surfaced only when the FEAT-021 merge gate predicted a CI number from the local one and the prediction missed by 83 skips.

The backlog entry names three mechanisms. They are different defects with different fixes, and a spec that merges them will fix the visible one and leave the other two:

1. **The deprecated action runtime.** The job's own annotation, measured on run `36641645503`, reads: "Node.js 20 is deprecated. The following actions target Node.js 20 but are being forced to run on Node.js 24: actions/cache@v4, actions/checkout@v4, actions/setup-node@v4." This is the Node that GitHub uses to run the actions. It has nothing to do with the Node the tests run on. `publish.yml` pins the same two actions and has the same warning.
2. **The test-runtime version is also the coverage choice.** `test.yml:19` and `publish.yml:18` install `node-version: '20'` (v20.20.2 in the run). Every `node:sqlite` suite self-skips below 22.5 by design, which accounts for 83 of the 95 skips:
   - `conductor-db` 74
   - `handoff-cycle` 3
   - `resume-read` 6

   So on the only runtime CI tests today, the persistence engine that ARCH-008 and FEAT-005 built has **no** executed coverage in CI.
3. **The missing assertion.** This is why it is a BUG and not a chore. A skip-count drift is invisible to a gate that only reads pass/fail, so an 83-skip divergence can persist indefinitely with matching totals. The FEAT-021 gate scenario is exactly that shape.

**An observation, not a mechanism.** The 12 `code-conductor-plugin` skips occur in **both** environments, because none of the five skills exist at `~/.claude/skills/<name>/SKILL.md`. No baseline diff between the two environments can reveal them. Only a baseline asserted per environment writes them down.

**A fact the design must respect.** `package.json` declares `engines: ">=20"`. Node 20 reached end of life on 2026-04-30. The support claim remains in force until someone decides otherwise, and that decision is not this item's to make.

## Solution

Three changes, one per mechanism, landing together because the assertion needs both legs to exist before it can be measured:

- **(1)** Bump the three actions, in both workflows, to the newest major whose `action.yml` declares `runs.using: node24`.
- **(2)** Run the test job as a matrix over Node `{20, 24}`:
  - 20 keeps the `engines` floor honest and exercises the `node:sqlite` degradation paths on purpose;
  - 24 is the current LTS and executes the persistence suites.
- **(3)** Add a repo-only instrument, `tools/skip-baseline.mjs`, with a committed `tools/skip-baseline.json`. The file records the **exact set of skipped test identities** per named CI environment. Each matrix leg runs the instrument against vitest's JSON report, and any difference fails the leg, naming every test that was added to or removed from the skipped set.

The rule the FEAT-021 closeout recorded ("future plans state test predictions per environment or not at all") gets a home. Predictions are stated against the committed baseline file, which is the measured CI baseline by construction.

## Decisions

### D1: Action bump, measured rather than guessed

The plan resolves each action's target major by reading the release's `action.yml` for `runs.using: node24` (`gh api`), not from memory:

- `actions/checkout`
- `actions/setup-node`
- `actions/cache`

It applies them to `test.yml` and `publish.yml`.

**The acceptance evidence is the job's annotations** (`gh api …/check-runs/<id>/annotations`) containing no "Node.js 20 is deprecated" warning. The absence of a warning in the log text is not sufficient evidence.

### D2: Matrix `{20, 24}`, not a single modern version

**Recommended:** matrix, `fail-fast: false`, so one leg's red never hides the other's result.

**Why not Node 24 alone:**
- It deletes the only executed evidence behind `engines: ">=20"`.
- It deletes the only leg on which the `node:sqlite`-absent degradation paths run for real rather than by simulation:
  - `conductor-db`'s one-line `CONDUCTOR_DB:` exit;
  - `resume-read`'s clean miss;
  - `cc-compact`'s DB tail skip.

  Those are shipped behaviors on any host running Node 20–22.4.

**Why not Node 20 alone (today):** that is the defect, since the persistence suites never execute in CI.

**What the matrix does not decide:** whether `engines` moves off an end-of-life version. It is named in Out of Scope so a later item can remove the Node 20 leg as a deliberate act with a baseline diff, never by drift.

**Consequence the matrix creates:** the Vitest transform-cache key (`vitest-${{ runner.os }}-…`) gains the Node version, so the two legs do not share a cache built by the other runtime.

**`publish.yml` runs its pre-publish suite on Node 24 only.** Publishing gates on the most-covered runtime. The PR matrix already asserted both legs on the same commit.

**`publish.yml` does NOT run the skip-baseline instrument (R2).** The baseline is a merge gate; every publishable commit already passed both asserted legs on its PR, and the publish suite's Vitest red remains the publish gate.

### D3: The assertion is an instrument over the report, not a reporter inside the suite

**Chosen:** `tools/skip-baseline.mjs`, run as its own workflow step after `vitest run --reporter=default --reporter=json --outputFile.json=<path>`. The plan measures the exact reporter flags against the installed Vitest 3.

**Rejected: a custom Vitest reporter or `globalTeardown` that fails `npm test`.** A developer machine is not a reproducible environment. The 12 plugin skips depend on what that person's `~/.claude/skills` holds, and `node:sqlite` depends on the local Node. Asserting inside `npm test` would make the pre-commit hook fail on environment rather than code, and every contributor would be tempted to edit the baseline to match their own laptop.

**What is compared: the skipped SET, not the count.**
- The identity is `<repo-relative file> > <test fullName>`.
- A count can stay constant while one skip replaces another, which is a silent swap of coverage.
- The set catches that. A renamed skipped test shows as one removal plus one addition, which is correct.

Passed counts and totals are not asserted. They change legitimately in almost every PR, and Vitest already fails on a failing test.

**Environments are named, and an unknown name fails.**
- The workflow passes `--env ci-node${{ matrix.node }}`.
- If `--env` names a key absent from the baseline file, the leg fails and says which key.
- So adding a matrix leg requires committing its measured baseline in the same PR.

**Local use is report-only and says so.** With no `--env`, the instrument prints the environment it observed (Node version, skipped count) and the full skipped set, then exits 0 with the line `SKIP_BASELINE_REPORT_ONLY: no --env given, nothing asserted`. **The instrument declares what it can see, not only what it found.** This carries the Verify-band lesson recorded at the 1.34.0 closeout: its assert-mode summary line names the environment, the report path, and the number of identities compared.

**Fail closed.**
- A missing or unparseable report fails the leg with its own reason.
- A report whose run itself failed is not compared; Vitest's red is already the signal.

This is a gate, not a hook, so the hooks' fail-open convention does not apply.

**Updating the baseline is a reviewed act.**
- A PR that legitimately changes a leg's skipped set (a new `skipIf`, a new sqlite suite) edits `tools/skip-baseline.json` in the same diff.
- The diff is the evidence.
- The instrument's failure message names the exact identities to add or remove, so the update is mechanical and never a guess.

### D4: Release as a patch

Nothing under `package.json` `files` changes: `tools/`, `.github/`, `tests/` and docs are repo-only. This follows the `[BUG-046]` precedent (repo-only instruments shipped as `1.32.2`), so the version becomes **`1.34.1`**, with a CHANGELOG entry stating that the package contents are unchanged.

## Behavior

### Main path (a PR)

1. The PR triggers `test.yml`, which runs two legs, Node 20 and Node 24, with `fail-fast: false`.
2. Each leg:
   - checks out;
   - sets up its Node with the bumped actions and restores a cache keyed per Node version;
   - runs `npm ci`;
   - runs Vitest with the default and JSON reporters.
3. Each leg runs `node tools/skip-baseline.mjs --env ci-node<N> --report <path>`. It prints one summary line, for example `SKIP_BASELINE_OK ci-node20: 96 skipped identities match tools/skip-baseline.json (report: vitest-report.json)`, and exits 0.
4. The job's annotations carry no Node 20 deprecation warning.

### Alternative paths

- **A PR adds a legitimately skipped test.** The leg fails:
  - the instrument prints `SKIP_BASELINE_DRIFT ci-node20: +1 −0` and then the added identity;
  - the author adds that identity to the baseline file in the same PR;
  - the reviewer sees the coverage change in the diff.
- **A PR makes a previously skipped test run** (for example, CI gains the five skills). The removal is listed, and the author deletes it from the baseline. **Coverage gained is also a baseline change**, so that it is recorded rather than silent.
- **Local run, no `--env`:** report-only, as described in D3.
- **A matrix leg is added** (for example, Node 26): its key is absent, so the leg fails naming the missing key until its measured set is committed.

### Error cases

- **The report is missing** (Vitest crashed before writing it): the instrument prints `SKIP_BASELINE_ABORT: report not found at <path>` and exits 1.
- **The report is unparseable, or lacks `testResults`:** it prints `SKIP_BASELINE_ABORT: unreadable report (<reason>)` and exits 1.
- **The baseline file is missing, unparseable, or a key's value is not a string array:** `SKIP_BASELINE_ABORT: …` naming the file and the key, exit 1.
- **The baseline file lists a duplicate identity:** abort, naming it. A set with duplicates is a baseline that cannot be reasoned about.

## Acceptance Criteria

### Mechanism 1: action runtime

- [ ] `test.yml` and `publish.yml` pin `actions/checkout`, `actions/setup-node` and `actions/cache` (where used) at majors whose `action.yml` declares `runs.using: node24`. The plan records the measured versions.
- [ ] A green run of the PR's own CI shows **no** "Node.js 20 is deprecated" annotation, measured via the check-runs annotations API for each leg.

### Mechanism 2: test runtime

- [ ] `test.yml` runs a matrix over `node: ['20', '24']` with `fail-fast: false`. A comment beside the matrix states the coverage consequence: Node 20 is the `engines` floor and the `node:sqlite`-absent paths; Node 24 executes the persistence suites.
- [ ] The Vitest cache key includes the matrix Node version.
- [ ] `publish.yml` runs its pre-publish suite on Node 24.
- [ ] Measured on the PR's own run, the Node 24 leg executes the 83 `node:sqlite` tests that Node 20 skips. The plan predicts each leg's skipped count **per environment** before the run, and the run confirms it.

### Mechanism 3: the assertion

- [ ] `tools/skip-baseline.mjs` implements D3's contract:
  - identity = `<file> > <fullName>`;
  - set comparison;
  - named environments, with an unknown key failing;
  - report-only mode without `--env`;
  - fail-closed aborts;
  - duplicate detection.
- [ ] `tools/skip-baseline.json` holds the **measured** skipped sets for `ci-node20` and `ci-node24`, taken from the PR's own CI run, not predicted.
- [ ] `test.yml` runs the instrument on every leg after the suite.
- [ ] `tests/tools/skip-baseline.test.js` pins the semantics, including:
  - **the FEAT-021 red case:** a synthesized report with the baseline's totals unchanged but 83 additional skips fails, reporting `+83` and naming the identities;
  - a same-count swap fails (one removed, one added);
  - an unknown `--env` fails;
  - a missing report aborts;
  - report-only mode exits 0 and prints the `SKIP_BASELINE_REPORT_ONLY` line.
- [ ] `tests/tools/tools-not-shipped.test.js` still passes. The new files live under `tools/`, which `files` excludes.
- [ ] `tools/README.md` gains the instrument's row (kind: invariant; run by: `test.yml` on every matrix leg).

### Recording the rule

- [ ] `CONTRIBUTING.md`'s CI section states that test predictions are made per environment: local, and each CI leg against `tools/skip-baseline.json`. It also says a skipped-set change is updated in the same PR.
- [ ] `docs/RELEASE-CLOSEOUT.md`'s CI-backed note names the skip-baseline assertion beside the version and record invariants.
- [ ] `docs/launch/LAUNCH-CHECKLIST.md`'s first "Before anything is posted" line (R1) no longer pins "996 passed / 12 skipped at `1.33.0`". It asserts commands and instruments instead: `npm test` green locally with zero failures; `VERSION_GATE_OK` and `RECORD_PARITY_OK`; and both CI legs green against `tools/skip-baseline.json`. If a number belongs anywhere, it lives in the baseline file, which is measured by construction.
- [ ] `publish.yml` carries no skip-baseline step, and a comment beside its test step states why (R2).

### Release

- [ ] `1.34.1`: `VERSION_GATE_OK 1.34.1` and `RECORD_PARITY_OK` with `[BUG-048]` at `[X]`. The CHANGELOG states the package contents are unchanged. `dependencies` stays empty.

## Out of Scope

- **Raising `engines` above `>=20`,** even though Node 20 is past end of life. This is a support-policy decision with a user-facing consequence. When it is made, the Node 20 leg and its baseline key are removed in the same PR, visibly.
- **Making the 12 plugin-suite tests run in CI** (installing the five skills in the runner). The baseline documents them. Whether they should run is a separate question.
- **Fetching history for the shipped-hash pin** (`fetch-depth: 0`). This stays declined per the id-ceiling ruling, and the pin stays in both CI baselines as a named skip.
- **The `ubuntu-latest` → Ubuntu 26 migration notice** (from 2026-10-19). It is a runner-image change, not this defect.
- **Windows or macOS legs.**
- **Asserting passed counts or totals.**
- **A local-environment baseline.** A developer machine is not a reproducible environment (D3).

## System Impact

| Surface | Change |
|---|---|
| `.github/workflows/test.yml` | action bumps, `{20, 24}` matrix, per-version cache key, JSON reporter, instrument step |
| `.github/workflows/publish.yml` | action bumps, Node 24; no skip-baseline step, stated (R2) |
| `tools/skip-baseline.mjs` (new) | the instrument |
| `tools/skip-baseline.json` (new) | measured per-environment skipped sets |
| `tests/tools/skip-baseline.test.js` (new) | semantics, including the FEAT-021 red case |
| `tools/README.md`, `CONTRIBUTING.md`, `docs/RELEASE-CLOSEOUT.md` | the instrument's row; the per-environment prediction rule |
| `docs/launch/LAUNCH-CHECKLIST.md` | R1: the frozen `996 / 12` line becomes command and instrument assertions |
| `.gitignore` | the JSON report path, so a local run never stages it |
| `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`, backlog heading | release surface |

**Pre-flight (critical-review Phase 1)**

- **Happy path:** both legs go green, each instrument line reads `SKIP_BASELINE_OK` with its own count, and the job's annotations are empty of the deprecation warning.
- **Failure points:**
  - **Bootstrapping order.** The baseline must be measured from a CI run of the branch itself, so the first push necessarily lacks it. The plan has to sequence this: push without the assertion, or with the assertion in report-only mode; read both legs' sets from the run; commit them; then arm the assertion. The arming commit's own run is the proof.
  - **Unstable test identities.** Parameterized titles that embed temp paths or timestamps would drift on every run. The plan checks that every skipped `fullName` in both measured sets is byte-stable across two runs.
  - **Vitest JSON shape.** Skipped tests appear with status `skipped` or `pending` (and `todo`). The instrument must count all three, and the plan measures which the installed Vitest emits.
  - **Timing.** A `node:sqlite` suite that is flaky on Node 24 in CI would surface here for the first time. It would be a real failure that this change exposes, not one it causes.
- **Boundary conditions:**
  - an empty skipped set (valid: `[]`);
  - a leg whose report has zero test files (abort: unreadable);
  - identities containing ` > ` inside a test title (the separator is only a display convention; the comparison is whole-string equality);
  - non-ASCII test names, which are compared as UTF-8 strings.

### Files Requiring Full Read (deferred to /cc-plan)

- `tests/tools/tools-not-shipped.test.js`, to confirm how it enumerates `tools/`, so a new `.json` beside the `.mjs` files does not trip it.
- `tools/record-parity.mjs` and `tools/version-gate.mjs`, as the house style for instruments: exit codes, `*_OK` / `*_ABORT` lines, and exported pure functions tested directly.

## Complexity Estimate

**M.** Each of the three mechanisms is small alone. The instrument is about 100 lines with a clear contract, and the workflow edits are declarative. But the baseline cannot be written before CI measures it, so the plan must order a bootstrap across at least two CI runs. Getting that order wrong either ships an unarmed gate or arms it against a guessed baseline, and the second is the exact defect this item exists to remove.
