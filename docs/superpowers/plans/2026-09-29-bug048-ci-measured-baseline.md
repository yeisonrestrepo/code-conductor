# BUG-048: CI Measured Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CI's skipped-test set a measured, asserted baseline per Node leg, move the workflows' actions off the deprecated Node 20 action runtime, and run the suite on Node 20 and Node 24.

**Architecture:** A repo-only instrument, `tools/skip-baseline.mjs`, reads Vitest's JSON report and compares the exact set of skipped test identities against `tools/skip-baseline.json`, keyed by named CI environment. `test.yml` becomes a `{20, 24}` matrix that writes the report and runs the instrument on every leg. The baseline cannot be written before CI measures it, so the plan bootstraps across two CI runs: the first measures the sets with the gate unarmed, and the arming commit's run proves them.

**Tech Stack:** Node ESM (no dependencies), Vitest 3.2.6, GitHub Actions, `gh` 2.100.0.

**Spec:** `docs/superpowers/specs/2026-09-29-bug048-ci-measured-baseline-design.md` (APPROVED with R1 and R2).

**Approved 2026-09-29, with both bootstrap differences accepted.** Execution is hybrid: Tasks 1–4 are subagent-driven with a reviewer between tasks, and Tasks 5–8 run natively in-session because they depend on live CI state and a strict run order. The draft PR at T-006-C is authorized; `gh pr ready` fires only at T-008-I. Halts bind across the seam:
- `IDENTITY_UNSTABLE`;
- a red `node:sqlite` suite on `ci-node24`;
- any Run 1 divergence from Predictions, reported with the divergence named before Task 8.

**Execution rules carried from the owner:**
- Every task report ends with one line of **handoff observations**: what the task needed that this plan did not supply (ARCH-009 evidence). "Nothing missing" is a valid line.
- **Halt and report at any test-count boundary that differs from its prediction.** Never commit a baseline, and never edit a prediction, to make a boundary agree.

## Global Constraints

- The skipped identity is `<repo-relative file> > <test fullName>`, compared as whole strings.
- The **set** is compared, never the count. Passed counts and totals are not asserted.
- An unknown `--env` fails. No `--env` means report-only, printing `SKIP_BASELINE_REPORT_ONLY: no --env given, nothing asserted` and exiting 0.
- The instrument fails closed: every `SKIP_BASELINE_ABORT: …` exits 1.
- `npm test` stays environment-neutral: no skip assertion inside the suite.
- `publish.yml` does **not** run the instrument, and says why in a comment (R2).
- `tools/skip-baseline.json` holds sets measured from this branch's own CI run, **never predicted ones**.
- Release `1.34.1` under `docs/RELEASE-CLOSEOUT.md`: `VERSION_GATE_OK 1.34.1`, `RECORD_PARITY_OK`, `[BUG-048]` at `[X]`, and the CHANGELOG states that the package contents are unchanged.
- Out of scope: raising `engines`, the plugin suite in CI, `fetch-depth: 0`, the Ubuntu 26 notice, and Windows or macOS legs.
- Staging follows the tracked-ness rule: `git add -u <path>` for tracked files, and plain `git add <path>` for new files outside ignored directories. Never run a bare `git add -u`.

## Measurements taken while writing this plan (2026-09-29)

**M1: action majors (D1),** read through `gh api` from each action's `action.yml` at its latest release:

| Action | Latest | `runs.using` at the release | At the major tag |
|---|---|---|---|
| `actions/checkout` | `v7.0.1` | `node24` | `v7` is `node24` |
| `actions/setup-node` | `v7.0.0` | `node24` | `v7` is `node24` |
| `actions/cache` | `v6.1.0` | `node24` | `v6` is `node24` |

Release notes scanned for majors 5 and later:
- `setup-node@v5` turns on package-manager caching automatically **only when `package.json` has a `packageManager` field**. This repository's does not, and both workflows set `cache: 'npm'` explicitly anyway.
- `checkout@v5+` and `cache@v5+` need runner 2.327.1 or later. GitHub-hosted runners satisfy this.
- `checkout@v7`'s `fetch-depth` still defaults to `1`, so the comments that name the shallow clone stay true once `@v4` becomes `@v7`.

**M2: Vitest 3.2.6's JSON report,** measured on a local run of `vitest run --reporter=default --reporter=json --outputFile.json=<path>`, which exited 0:
- Top-level keys include `success`, `numTotalTests`, `numPendingTests`, `numTodoTests` and `testResults`.
- `testResults[].name` is an **absolute** path, `/Users/yeison/Projects/code-conductor/tests/…`. So the identity must be made repo-relative, or CI (`/home/runner/work/…`) and a laptop would never agree.
- `assertionResults[].fullName` equals `ancestorTitles` and `title` joined by a single space. The ` > ` in our identity is our own separator, not Vitest's.
- `skipIf` emits status `skipped`. The run read 1009 passed / 12 skipped / 1021 total, with every skip in `tests/plugin/code-conductor-plugin.test.js`.

**M3: skip sites.** Grepping every `.skip`, `.skipIf`, `.runIf` and `.todo` under `tests/` shows that only the `node:sqlite` probes depend on the Node version:
- `conductor-db` gates on `HAS_SQLITE`.
- `handoff-cycle` and `resume-read` gate on `sqliteAvailable()`.

Every other condition is identical on both CI legs: bash present, not win32, not root, shallow history, skills absent.

**M4: branch protection on `main`.** There are no required status checks, and one approving review is required. The matrix renames the check from `test` to `test (20)` and `test (24)`, and that rename blocks nothing.

## Predictions (PREDICTIONS, to be replaced by measurement, never committed as the baseline)

This branch adds **23** tests (Task 1) and changes no other test's skip condition.

| Environment | Passed | Skipped | Total | Skipped composition | Evidence |
|---|---|---|---|---|---|
| local (Node 24.18.0, darwin) | 1032 | 12 | 1044 | plugin 12 | measured 1009/12 today (M2), plus 23 |
| `ci-node20` | 948 | 96 | 1044 | `conductor-db` 74, `handoff-cycle` 3, `resume-read` 6, plugin 12, heal pin 1 | FEAT-021 gate run measured 925/96, plus 23 |
| `ci-node24` | 1031 | 13 | 1044 | plugin 12, heal pin 1 | derived: the 96 minus the 83 `node:sqlite` skips (M3) |

**REVISED before Run 1 (Task 5; the owner accepted the empty-`--env` fix, which adds 1 passing test).** The table above is kept as the original prediction. The binding predictions are now: local **1033 / 12 (1045)**, `ci-node20` **949 / 96 (1045)**, `ci-node24` **1032 / 13 (1045)**. The skipped sets and their composition are unchanged.

The heal pin (`tests/installer/heal.test.js`, "pins each shipped hash…") skips in CI because the clone is shallow, and runs locally, where history is present. That is why `ci-node24` is 13 and local is 12 on the same Node major.

## Bootstrap: exactly two CI runs, three executions

This is the owner's expected shape, and the plan follows it, with two stated differences.

| # | Commit | Gate state | What it proves |
|---|---|---|---|
| **Run 1, attempt 1** | branch head after Task 4 (the release commit) | **unarmed**: the instrument runs report-only on each leg | Both legs' measured skipped sets. Mechanism 1 (annotations). Mechanism 2 (Node 24 executes the 83). The per-leg predictions are checked here. |
| **Run 1, attempt 2** | same commit, via `gh run rerun` | unarmed | **Identity stability.** Each leg's set is compared byte-for-byte with attempt 1 **before anything is committed**. |
| **Run 2** | the arming commit (Task 8): `tools/skip-baseline.json` from attempt 1, plus `--env` in `test.yml` | **armed** | The proof: `SKIP_BASELINE_OK` on both legs, and annotations clean again. |

**Difference 1: the release commit precedes Run 1.** This makes the arming commit the branch head, so Run 2 is both the proof and the merge-gate run. Arming earlier would force a third run for the release commit.

**Difference 2: Run 2's result is recorded in a PR comment and in the closeout on `main`, not on the branch.** Recording it on the branch needs a commit, and a commit triggers a Run 3. Any commit that does land after Run 2, such as a review fix, gets its own run, which must also print `SKIP_BASELINE_OK` on both legs. If such a fix legitimately changes a skipped set, it updates the baseline in the same commit, per D3.

## Bootstrap record (filled during execution, one single-line edit per field)

- Run 1 id and head SHA: `36648751722` on `d3b8b8bf8c99e095b65df536f0f713aeb32f637c` (`pull_request`, PR #45)
- Run 1 attempt 1, `ci-node20` (conclusion, totals, skipped by file): `success`, Node v20.20.2, `Tests  949 passed | 96 skipped (1045)`; `conductor-db` 74, `handoff-cycle` 3, `resume-read` 6, plugin 12, heal 1. Matches the revised prediction exactly.
- Run 1 attempt 1, `ci-node24` (conclusion, totals, skipped by file): `success`, Node v24.21.0, `Tests  1032 passed | 13 skipped (1045)`; plugin 12, heal 1. Matches the revised prediction exactly, so the 83 `node:sqlite` tests ran and passed on Node 24.
- Run 1 annotations (deprecation warnings per leg): 0 on each leg. Each leg carries exactly one annotation, the notice "The ubuntu-latest label will migrate to Ubuntu 26 beginning October 19, 2026…" (out of scope).
- Identity stability, attempt 1 vs attempt 2: `IDENTITY_STABLE ci-node24: 13 identities byte-identical across both attempts` / `IDENTITY_STABLE ci-node20: 96 identities byte-identical across both attempts` (rc 0; attempt 2 totals and composition identical to attempt 1)
- Arming commit SHA: (this commit; see git log)

## Review Focus

1. **Bootstrap sequencing.** The failure is an arming commit whose baseline did not come byte-for-byte from this branch's own Run 1, or a gate armed before measurement. A reasonable person expects the committed file to be exactly what CI printed and the arming run to go green on it. Pinned in **Task 8**:
   - `write-baseline.mjs` round-trips the file and asserts byte equality with the attempt-1 extraction;
   - Run 2 must print `SKIP_BASELINE_OK` on both legs;
   - the unit test "aborts when the baseline file is missing" proves that assert mode cannot pass without the file.
2. **Identity instability.** A skipped title that embeds a temp path, a timestamp or a random value would drift on every run, and the gate would be red forever. Pinned in **Task 7**: attempts 1 and 2 are compared byte-for-byte per leg, and any difference halts the plan before the baseline is written.
3. **Absolute report paths.** Vitest writes absolute file names (M2). An identity built from them would differ between the CI runner and any other checkout. Pinned in **Task 1** by the test "yields the same identity from a CI checkout and a laptop checkout".
4. **Duplicate identities.** Two tests with one title in one file would collapse into one set member and hide a count change. Pinned in **Task 1**: "refuses a duplicate identity, which a set would silently collapse" (report side) and "names a duplicate identity" (baseline side).
5. **A failed run's report being compared.** Pinned in **Task 1**: "refuses a report whose run failed". In the workflow, the instrument step keeps the default `if: success()`, so a red suite never reaches it.

---

### Task 0: Commit this plan

**Files:**
- Modify: `.gitignore`, adding the leaf line after `!/docs/superpowers/plans/2026-09-29-bug047-heredoc-body-scanning.md`.
- Create: `docs/superpowers/plans/2026-09-29-bug048-ci-measured-baseline.md` (this file).

- [X] [T-000-A] Insert `!/docs/superpowers/plans/2026-09-29-bug048-ci-measured-baseline.md` into `.gitignore` on the line after `!/docs/superpowers/plans/2026-09-29-bug047-heredoc-body-scanning.md`. This is its sorted position, and `tests/unit/gitignore-block-parity.test.js` enforces it.
- [X] [T-000-B] Stage: `git add -u .gitignore`, then `git add docs/superpowers/plans/2026-09-29-bug048-ci-measured-baseline.md`. The leaf line makes the new file visible, so plain `add` stages it.
- [X] [T-000-C] Commit: `git commit -m "docs: add the BUG-048 CI measured-baseline implementation plan [BUG-048]"`. The pre-commit suite is expected at **1009 passed / 12 skipped** (1021 total).

### Task 1: The instrument and its tests

**Files:**
- Create: `tools/skip-baseline.mjs`
- Create: `tests/tools/skip-baseline.test.js`

**Interfaces:**
- Produces:
  - `BASELINE_FILE`: the string `'tools/skip-baseline.json'`.
  - `NOT_RUN`: a `Set` of `'skipped'`, `'pending'` and `'todo'`.
  - `skippedIdentities(report, root)`: returns `{ identities: string[] }` (sorted) or `{ error: string }`.
  - `parseBaseline(text)`: returns `{ envs: Record<string, string[]> }` or `{ error: string }`.
  - `parseArgs(argv)`: returns `{ env: string|null, report: string }` or `{ error: string }`.
  - `evaluate({ env, reportPath, reportText, baselineText, root })`: returns `{ code: 0|1, lines: string[] }`.
  - CLI: `node tools/skip-baseline.mjs [--env <name>] --report <path>`.

- [X] [T-001-A] Write the failing test file `tests/tools/skip-baseline.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  BASELINE_FILE, skippedIdentities, parseBaseline, parseArgs, evaluate,
} from '../../tools/skip-baseline.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TOOL = join(REPO, 'tools', 'skip-baseline.mjs');
const ROOT = '/home/runner/work/code-conductor/code-conductor';

// A synthesized Vitest JSON report: each file maps to [status, fullName] pairs.
function report(files, { root = ROOT, success = true } = {}) {
  return {
    success,
    testResults: Object.entries(files).map(([file, tests]) => ({
      name: `${root}/${file}`,
      assertionResults: tests.map(([status, fullName]) => ({ status, fullName })),
    })),
  };
}
const ids = (rep, root = ROOT) => skippedIdentities(rep, root).identities;
const run = (env, rep, baseline) => evaluate({
  env,
  reportPath: 'vitest-report.json',
  reportText: rep === null ? null : JSON.stringify(rep),
  baselineText: baseline === null ? null : JSON.stringify(baseline),
  root: ROOT,
});

// The FEAT-021 gate shape: the same tests and the same total, with 83 more skipped
// on Node 20 because node:sqlite is absent there.
const PLUGIN = Array.from({ length: 12 }, (_, i) => ['skipped', `personal skills check ${i}`]);
const PIN = [['skipped', 'SHIPPED_GRAPHIFY_HASHES pins each shipped hash to its blob']];
const SQLITE = Array.from({ length: 83 }, (_, i) => `conductor-db case ${i}`);
const legReport = (sqliteStatus) => report({
  'tests/plugin/code-conductor-plugin.test.js': PLUGIN,
  'tests/installer/heal.test.js': [...PIN, ['passed', 'heal removes the entry']],
  'tests/scripts/conductor-db.test.js': SQLITE.map((t) => [sqliteStatus, t]),
});
const count = (rep) => rep.testResults.reduce((n, f) => n + f.assertionResults.length, 0);

describe('skippedIdentities', () => {
  it('collects skipped, pending and todo as repo-relative identities and ignores what ran', () => {
    const rep = report({ 'tests/a.test.js': [
      ['skipped', 'suite one'], ['pending', 'suite two'], ['todo', 'suite three'],
      ['passed', 'suite four'], ['failed', 'suite five'],
    ] });
    expect(ids(rep)).toEqual([
      'tests/a.test.js > suite one', 'tests/a.test.js > suite three', 'tests/a.test.js > suite two',
    ]);
  });

  // Review Focus 3: Vitest writes absolute file names, so without relativizing, a CI
  // runner and any other checkout could never agree on a single identity.
  it('yields the same identity from a CI checkout and a laptop checkout', () => {
    const files = { 'tests/a.test.js': [['skipped', 'x']] };
    const laptop = '/Users/dev/code-conductor';
    expect(ids(report(files, { root: laptop }), laptop)).toEqual(ids(report(files)));
    expect(ids(report(files))).toEqual(['tests/a.test.js > x']);
  });

  it('refuses a report with zero test files rather than reporting an empty set', () => {
    expect(skippedIdentities({ success: true, testResults: [] }, ROOT).error).toMatch(/^unreadable report/);
    expect(skippedIdentities({ success: true }, ROOT).error).toMatch(/^unreadable report/);
  });

  // Review Focus 5.
  it('refuses a report whose run failed, because Vitest red is already the signal', () => {
    const rep = report({ 'tests/a.test.js': [['skipped', 'x']] }, { success: false });
    expect(skippedIdentities(rep, ROOT).error).toMatch(/run did not succeed/);
  });

  // Review Focus 4.
  it('refuses a duplicate identity, which a set would silently collapse', () => {
    const rep = report({ 'tests/a.test.js': [['skipped', 'same'], ['skipped', 'same']] });
    expect(skippedIdentities(rep, ROOT).error).toBe('duplicate identity in report: "tests/a.test.js > same"');
  });

  it('compares whole strings: " > " inside a title and non-ASCII names survive intact', () => {
    const rep = report({ 'tests/a.test.js': [['skipped', 'a > b'], ['skipped', 'reads ñandú — ✓']] });
    expect(ids(rep)).toEqual(['tests/a.test.js > a > b', 'tests/a.test.js > reads ñandú — ✓']);
    const baseline = { 'ci-node20': ['tests/a.test.js > reads ñandú — ✓', 'tests/a.test.js > a > b'] };
    expect(run('ci-node20', rep, baseline).code).toBe(0);
  });
});

describe('parseBaseline', () => {
  it('accepts an empty set as a valid baseline', () => {
    expect(parseBaseline('{"ci-node24": []}')).toEqual({ envs: { 'ci-node24': [] } });
  });

  it('rejects unparseable JSON', () => {
    expect(parseBaseline('{"ci-node20": [').error).toMatch(/^is not valid JSON/);
  });

  it('names the key whose value is not an array of strings', () => {
    expect(parseBaseline('{"ci-node20": "tests/a.test.js > x"}').error).toBe('key "ci-node20" is not an array of strings');
    expect(parseBaseline('{"ci-node24": [1]}').error).toBe('key "ci-node24" is not an array of strings');
  });

  // Review Focus 4, baseline side.
  it('names a duplicate identity', () => {
    expect(parseBaseline('{"ci-node20": ["t > x", "t > x"]}').error).toBe('key "ci-node20" lists "t > x" more than once');
  });
});

describe('parseArgs', () => {
  it('requires --report', () => {
    expect(parseArgs(['--env', 'ci-node20']).error).toBe('--report <path> is required');
  });

  it('rejects an unknown argument and a flag with no value', () => {
    expect(parseArgs(['--report', 'r.json', '--baseline', 'b.json']).error).toBe('unknown argument "--baseline"');
    expect(parseArgs(['--report', 'r.json', '--env']).error).toBe('--env needs a value');
    expect(parseArgs(['--env', 'ci-node20', '--report', 'r.json'])).toEqual({ env: 'ci-node20', report: 'r.json' });
  });
});

describe('evaluate, assert mode', () => {
  it('reports a matching set as SKIP_BASELINE_OK naming env, count, baseline and report', () => {
    const rep = legReport('skipped');
    const r = run('ci-node20', rep, { 'ci-node20': ids(rep), 'ci-node24': [] });
    expect(r.code).toBe(0);
    expect(r.lines).toEqual([`SKIP_BASELINE_OK ci-node20: 96 skipped identities match ${BASELINE_FILE} (report: vitest-report.json)`]);
  });

  // The FEAT-021 merge gate, frozen: its CI prediction was derived from a Node 24
  // baseline and missed by exactly this, with the totals matching.
  it('FEAT-021 red case: 83 more skips at unchanged totals fails and names every identity', () => {
    const node24 = legReport('passed');
    const node20 = legReport('skipped');
    expect(count(node20)).toBe(count(node24));
    const r = run('ci-node20', node20, { 'ci-node20': ids(node24) });
    expect(r.code).toBe(1);
    expect(r.lines[0]).toBe(`SKIP_BASELINE_DRIFT ci-node20: +83 −0 (report: vitest-report.json, baseline: ${BASELINE_FILE})`);
    const added = r.lines.filter((l) => l.startsWith('  + '));
    expect(added).toHaveLength(83);
    expect(added).toContain('  + "tests/scripts/conductor-db.test.js > conductor-db case 0"');
  });

  it('fails a same-count swap, naming the removal and the addition', () => {
    const rep = report({ 'tests/a.test.js': [['skipped', 'new'], ['passed', 'old']] });
    const r = run('ci-node24', rep, { 'ci-node24': ['tests/a.test.js > old'] });
    expect(r.code).toBe(1);
    expect(r.lines.slice(0, 3)).toEqual([
      `SKIP_BASELINE_DRIFT ci-node24: +1 −1 (report: vitest-report.json, baseline: ${BASELINE_FILE})`,
      '  + "tests/a.test.js > new"',
      '  − "tests/a.test.js > old"',
    ]);
  });

  it('fails on coverage gained: a baseline skip that now runs is a removal', () => {
    const rep = report({ 'tests/a.test.js': [['passed', 'x']] });
    const r = run('ci-node24', rep, { 'ci-node24': ['tests/a.test.js > x'] });
    expect(r.code).toBe(1);
    expect(r.lines[0]).toMatch(/^SKIP_BASELINE_DRIFT ci-node24: \+0 −1 /);
  });

  it('aborts on an environment with no key, naming the keys that exist', () => {
    const r = run('ci-node26', legReport('passed'), { 'ci-node20': [], 'ci-node24': [] });
    expect(r).toEqual({ code: 1, lines: [
      `SKIP_BASELINE_ABORT: environment "ci-node26" has no key in ${BASELINE_FILE} (keys: ci-node20, ci-node24); commit its measured set in this PR`,
    ] });
  });

  // Review Focus 1: assert mode cannot pass on a baseline that was never committed.
  it('aborts when the baseline file is missing', () => {
    expect(run('ci-node20', legReport('passed'), null))
      .toEqual({ code: 1, lines: [`SKIP_BASELINE_ABORT: baseline not found at ${BASELINE_FILE}`] });
  });

  it('aborts when the report is missing', () => {
    expect(run('ci-node20', null, { 'ci-node20': [] }))
      .toEqual({ code: 1, lines: ['SKIP_BASELINE_ABORT: report not found at vitest-report.json'] });
  });
});

describe('evaluate, report-only mode', () => {
  it('prints every identity and the REPORT_ONLY line, exits 0, never reads the baseline', () => {
    const r = run(null, legReport('passed'), null);
    expect(r.code).toBe(0);
    expect(r.lines[0]).toBe(`SKIP_BASELINE_OBSERVED node ${process.version}: 13 skipped identities (report: vitest-report.json)`);
    expect(r.lines.filter((l) => l.startsWith('SKIPPED "'))).toHaveLength(13);
    expect(r.lines.at(-1)).toBe('SKIP_BASELINE_REPORT_ONLY: no --env given, nothing asserted');
  });

  it('still fails closed on an unreadable report', () => {
    const r = evaluate({ env: null, reportPath: 'r.json', reportText: '{not json', baselineText: null, root: ROOT });
    expect(r.code).toBe(1);
    expect(r.lines[0]).toMatch(/^SKIP_BASELINE_ABORT: unreadable report \(/);
  });
});

describe('the CLI', () => {
  let dir;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'cc-skip-')); });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('report-only run exits 0 and ends with the REPORT_ONLY line', () => {
    const path = join(dir, 'report.json');
    writeFileSync(path, JSON.stringify(report({ 'tests/a.test.js': [['skipped', 'x']] }, { root: REPO })));
    const r = spawnSync(process.execPath, [TOOL, '--report', path], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('SKIPPED "tests/a.test.js > x"\n');
    expect(r.stdout.trimEnd().split('\n').at(-1)).toBe('SKIP_BASELINE_REPORT_ONLY: no --env given, nothing asserted');
  });

  it('a missing --report exits 1 with a usage abort', () => {
    const r = spawnSync(process.execPath, [TOOL, '--env', 'ci-node20'], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^SKIP_BASELINE_ABORT: --report <path> is required; usage: /);
  });
});
```

- [X] [T-001-B] Run `npx vitest run tests/tools/skip-baseline.test.js`. Expected: the file fails to load with "Failed to resolve import ../../tools/skip-baseline.mjs" (or "Cannot find module"), and **0 of 23** tests run.
- [X] [T-001-C] Write `tools/skip-baseline.mjs`:

```js
#!/usr/bin/env node
// The skipped-test set of each named CI environment, asserted against a measured baseline.
//
// REPO-ONLY. See the note in tools/id-ceiling.mjs; tools-not-shipped.test.js pins it.
//
// Why this exists: [BUG-048]. CI read 925 passed / 96 skipped on Node 20 while the
// local suite read 1009 / 12 for the same 1021 tests, and every run was green because
// nothing asserted what CI skipped. A count would not have been enough, since one skip
// can replace another at a constant count. So the SET is compared, and a difference
// names every identity that moved.
//
// This is a gate, not a hook: every doubt aborts. With no --env it only reports, and
// says so, because a developer machine is not a reproducible environment.
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASELINE_FILE = 'tools/skip-baseline.json';
// Vitest 3.2 reports skip and skipIf as `skipped`; `pending` and `todo` are the other
// statuses its JSON reporter uses for a test that did not run.
export const NOT_RUN = new Set(['skipped', 'pending', 'todo']);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'usage: node tools/skip-baseline.mjs [--env <name>] --report <path>';

// Vitest writes absolute file names; the identity must not depend on the checkout path.
function repoPath(name, root) {
  return (isAbsolute(name) ? relative(root, name) : name).split('\\').join('/');
}

export function skippedIdentities(report, root) {
  const files = report?.testResults;
  if (!Array.isArray(files) || files.length === 0) {
    return { error: 'unreadable report (testResults is missing or empty)' };
  }
  if (report.success !== true) {
    return { error: 'the run did not succeed (success is not true); Vitest\'s red is the signal, nothing compared' };
  }
  const seen = new Set();
  for (const file of files) {
    if (typeof file?.name !== 'string') return { error: 'unreadable report (a test file has no name)' };
    for (const test of file.assertionResults ?? []) {
      if (!NOT_RUN.has(test.status)) continue;
      const id = `${repoPath(file.name, root)} > ${test.fullName}`;
      if (seen.has(id)) return { error: `duplicate identity in report: ${JSON.stringify(id)}` };
      seen.add(id);
    }
  }
  return { identities: [...seen].sort() };
}

export function parseBaseline(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return { error: `is not valid JSON (${e.message})` }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { error: 'is not a JSON object keyed by environment' };
  }
  for (const [key, list] of Object.entries(data)) {
    if (!Array.isArray(list) || !list.every((s) => typeof s === 'string')) {
      return { error: `key "${key}" is not an array of strings` };
    }
    const dup = list.find((s, i) => list.indexOf(s) !== i);
    if (dup !== undefined) return { error: `key "${key}" lists ${JSON.stringify(dup)} more than once` };
  }
  return { envs: data };
}

export function parseArgs(argv) {
  const out = { env: null, report: null };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (flag !== '--env' && flag !== '--report') return { error: `unknown argument ${JSON.stringify(flag)}` };
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) return { error: `${flag} needs a value` };
    out[flag.slice(2)] = value;
  }
  if (!out.report) return { error: '--report <path> is required' };
  return out;
}

const abort = (reason) => ({ code: 1, lines: [`SKIP_BASELINE_ABORT: ${reason}`] });

function diffSets(expected, observed) {
  const want = new Set(expected);
  const have = new Set(observed);
  return {
    added: observed.filter((id) => !want.has(id)).sort(),
    removed: expected.filter((id) => !have.has(id)).sort(),
  };
}

function reportOnly(ids, reportPath) {
  return { code: 0, lines: [
    `SKIP_BASELINE_OBSERVED node ${process.version}: ${ids.length} skipped identities (report: ${reportPath})`,
    ...ids.map((id) => `SKIPPED ${JSON.stringify(id)}`),
    'SKIP_BASELINE_REPORT_ONLY: no --env given, nothing asserted',
  ] };
}

function assertEnv(env, ids, reportPath, baselineText) {
  if (baselineText === null) return abort(`baseline not found at ${BASELINE_FILE}`);
  const base = parseBaseline(baselineText);
  if (base.error) return abort(`baseline ${BASELINE_FILE} ${base.error}`);
  if (!Object.hasOwn(base.envs, env)) {
    const keys = Object.keys(base.envs).join(', ') || 'none';
    return abort(`environment "${env}" has no key in ${BASELINE_FILE} (keys: ${keys}); commit its measured set in this PR`);
  }
  const { added, removed } = diffSets(base.envs[env], ids);
  if (added.length === 0 && removed.length === 0) {
    return { code: 0, lines: [`SKIP_BASELINE_OK ${env}: ${ids.length} skipped identities match ${BASELINE_FILE} (report: ${reportPath})`] };
  }
  return { code: 1, lines: [
    `SKIP_BASELINE_DRIFT ${env}: +${added.length} −${removed.length} (report: ${reportPath}, baseline: ${BASELINE_FILE})`,
    ...added.map((id) => `  + ${JSON.stringify(id)}`),
    ...removed.map((id) => `  − ${JSON.stringify(id)}`),
    `If the change is intended, update key "${env}" in ${BASELINE_FILE} in this PR: add each + identity, remove each −.`,
  ] };
}

export function evaluate({ env, reportPath, reportText, baselineText, root = ROOT }) {
  if (reportText === null) return abort(`report not found at ${reportPath}`);
  let report;
  try { report = JSON.parse(reportText); } catch (e) { return abort(`unreadable report (${e.message})`); }
  const seen = skippedIdentities(report, root);
  if (seen.error) return abort(seen.error);
  if (!env) return reportOnly(seen.identities, reportPath);
  return assertEnv(env, seen.identities, reportPath, baselineText);
}

const readOrNull = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

function main() {
  const args = parseArgs(process.argv.slice(2));
  const r = args.error
    ? abort(`${args.error}; ${USAGE}`)
    : evaluate({
      env: args.env,
      reportPath: args.report,
      reportText: readOrNull(resolve(args.report)),
      baselineText: args.env ? readOrNull(resolve(ROOT, BASELINE_FILE)) : null,
      root: ROOT,
    });
  for (const line of r.lines) console.log(line);
  // exitCode, not exit(): a report-only run prints ~100 lines, and process.exit can
  // truncate a piped stdout on macOS before it drains.
  process.exitCode = r.code;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [X] [T-001-D] Run `npx vitest run tests/tools/skip-baseline.test.js`. Expected: **23 passed**. Then run `npx vitest run tests/tools/tools-not-shipped.test.js` and expect it to pass unchanged. It checks only `package.json` `files` and `deployProject`, and neither changes (full read, deferred from the spec).
- [X] [T-001-E] Stage `git add tools/skip-baseline.mjs tests/tools/skip-baseline.test.js`. Both files are new and `tools/` and `tests/` are not ignored, so plain `add` is correct.
- [X] [T-001-F] Commit: `git commit -m "fix: add the skip-baseline instrument and pin its semantics [BUG-048]"`. **Boundary:** the pre-commit suite must read **1032 passed / 12 skipped (1044)**. Halt on any other number.

### Task 2: Record the rule (docs, R1)

**Files:**
- Modify: `tools/README.md` (the registry table, plus one paragraph)
- Modify: `CONTRIBUTING.md` (after the "CI gate is unconditional" paragraph)
- Modify: `docs/RELEASE-CLOSEOUT.md:3` and step 5
- Modify: `docs/launch/LAUNCH-CHECKLIST.md:17` (R1)
- Modify: `.gitignore` (the report path)

- [X] [T-002-A] In `tools/README.md`, insert a row after the `record-parity.mjs` row:
  `| \`skip-baseline.mjs\` | invariant | \`.github/workflows/test.yml\` on every matrix leg, after the suite; report-only by hand |`
- [X] [T-002-B] In `tools/README.md`, insert this paragraph after the paragraph beginning `**Read \`docs/RELEASE-CLOSEOUT.md\` before a release.**`:
  `**\`skip-baseline.json\` is measured, never typed.** Each key is one CI leg's exact skipped set, copied from that leg's own run. A red leg names every identity to add (\`+\`) or remove (\`−\`); the fix is to copy those lines into that key in the same PR, and the diff is the reviewer's evidence of the coverage change. A new matrix leg stays red until its key is committed. Run by hand without \`--env\`, the instrument only reports, because a developer machine is not a reproducible environment: its skipped set depends on the local Node and on \`~/.claude/skills\`.`
- [X] [T-002-C] In `CONTRIBUTING.md`, insert this paragraph between the paragraph beginning `**The GitHub Actions CI gate is unconditional.**` and the one beginning `Releases follow`:
  `**Test predictions are made per environment, or not at all.** A plan predicts the local result (\`npm test\` on your Node) and each CI leg separately. A CI leg's prediction is stated against its key in \`tools/skip-baseline.json\`, which holds the skipped-test set measured on that leg. Each leg of \`.github/workflows/test.yml\` asserts its skipped set against that file, so a change in what CI skips, whether coverage lost or coverage gained, is red until the same PR updates the file. The failure names every test to add or remove. \`npm test\` asserts no skip count, because a developer machine is not a reproducible environment.`
- [X] [T-002-D] In `docs/RELEASE-CLOSEOUT.md:3`, replace `asserts the version and record invariants against the live repository on every push and pull request.` with `asserts the version and record invariants against the live repository on every push and pull request. Each CI leg also asserts its exact skipped-test set against \`tools/skip-baseline.json\` (\`tools/skip-baseline.mjs\`, \`[BUG-048]\`), so a change in what CI skips is red at the same gate.`
- [X] [T-002-E] In `docs/RELEASE-CLOSEOUT.md` step 5, replace `5. **Merge on green.**` with `5. **Merge on green**: both legs of the Test workflow green, each printing \`SKIP_BASELINE_OK\`.`
- [X] [T-002-F] Apply R1 in `docs/launch/LAUNCH-CHECKLIST.md:17`. Replace `` - [ ] `npm test` green on `main` (996 passed / 12 skipped at `1.33.0`) `` with `` - [ ] `npm test` green on `main` locally with zero failures, and both legs of `main`'s last Test run green, each printing `SKIP_BASELINE_OK` against `tools/skip-baseline.json`, the one place a test count is recorded, because there it is measured ``. The next two lines already assert `VERSION_GATE_OK` and `RECORD_PARITY_OK`, which completes R1's command-and-instrument set without duplicating them.
- [X] [T-002-G] In `.gitignore`, insert `/vitest-report.json` on the line after `.vitest-cache/`. This is outside the BUG-042 block, so the parity test is unaffected.
- [X] [T-002-H] Stage `git add -u tools/README.md CONTRIBUTING.md docs/RELEASE-CLOSEOUT.md docs/launch/LAUNCH-CHECKLIST.md .gitignore`.
- [X] [T-002-I] Commit: `git commit -m "docs: state per-environment test predictions and the skip-baseline gate [BUG-048]"`. **Boundary:** 1032 / 12 (1044), unchanged.

### Task 3: Workflows (D1, D2, R2); gate unarmed

**Files:**
- Modify: `.github/workflows/test.yml` (full replacement below)
- Modify: `.github/workflows/publish.yml:15-28`
- Modify: the three comments that name `actions/checkout@v4`: `docs/RELEASE-CLOSEOUT.md:5`, `tests/installer/heal.test.js:188` and `tests/tools/repo-invariants.test.js:36`.

- [X] [T-003-A] Replace `.github/workflows/test.yml` with:

```yaml
name: Test

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    # Each leg is a coverage decision, not a version preference [BUG-048]. Node 20 is
    # engines.node's floor and the only leg on which the node:sqlite-absent degradation
    # paths run for real; Node 24 executes the persistence suites that Node 20 skips.
    # fail-fast is off so one leg's red never hides the other's result.
    strategy:
      fail-fast: false
      matrix:
        node: ['20', '24']

    steps:
      - uses: actions/checkout@v7

      - uses: actions/setup-node@v7
        with:
          node-version: ${{ matrix.node }}
          cache: 'npm'
          cache-dependency-path: 'package-lock.json'

      - name: Cache Vitest transform cache
        uses: actions/cache@v6
        with:
          path: .vitest-cache
          key: vitest-${{ runner.os }}-node${{ matrix.node }}-${{ hashFiles('vitest.config.js', 'package-lock.json') }}
          restore-keys: |
            vitest-${{ runner.os }}-node${{ matrix.node }}-

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test -- --reporter=default --reporter=json --outputFile.json=vitest-report.json

      - name: Report the skipped set (unarmed until this branch's CI measures the baseline)
        run: node tools/skip-baseline.mjs --report vitest-report.json
```

- [X] [T-003-B] In `.github/workflows/publish.yml`, replace lines 15–28, from `      - uses: actions/checkout@v4` through `      - run: npx vitest run`, with:

```yaml
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: '24'
          registry-url: 'https://registry.npmjs.org'
          cache: 'npm'
      # OIDC trusted publishing needs npm >= 11.5.1. npm stays pinned to 11 rather than
      # floating to @latest so this job's npm moves only by a deliberate edit: npm 12's
      # engines (^22.22.2 || ^24.15.0 || >=26) would tie the job to whichever 24.x
      # setup-node resolves, and npm 11 accepts ^20.17.0 || >=22.9.0.
      - run: npm install -g npm@^11.5.1
      - run: npm ci
      # Node 24 is the most-covered runtime: it executes the node:sqlite suites that
      # Node 20 skips. The Node 20 floor is asserted on every PR by test.yml's matrix, on
      # this same commit. No skip-baseline step here [BUG-048]: the baseline is a merge
      # gate, every publishable commit already passed both asserted legs on its PR, and
      # this suite's own red remains the publish gate.
      - run: npx vitest run
```

- [X] [T-003-C] Replace `actions/checkout@v4` with `actions/checkout@v7` in the three comments. Measured in M1, v7's `fetch-depth` still defaults to 1, so each sentence stays true:
  - `docs/RELEASE-CLOSEOUT.md:5`;
  - `tests/installer/heal.test.js:188`;
  - `tests/tools/repo-invariants.test.js:36`.

  Then run `git grep -n "actions/[a-z-]*@v4" -- . ':!docs/superpowers' ':!CHANGELOG.md' ':!AGENT-READABLE BACKLOG.md' ':!.claude/memory'`. Expected: no output. The excluded files are records of history and keep `@v4` on purpose.
- [X] [T-003-D] Verify the reporter wiring locally, exactly as CI invokes it: `npm test -- --reporter=default --reporter=json --outputFile.json=vitest-report.json`, then `node tools/skip-baseline.mjs --report vitest-report.json`.
  - Expected: the first line is `SKIP_BASELINE_OBSERVED node v24.18.0: 12 skipped identities (report: vitest-report.json)`.
  - Then 12 `SKIPPED "tests/plugin/code-conductor-plugin.test.js > …"` lines.
  - Then `SKIP_BASELINE_REPORT_ONLY: no --env given, nothing asserted`, at rc 0.
- [X] [T-003-E] Run `git status --porcelain --ignored vitest-report.json`. Expected: `!! vitest-report.json`, meaning the report is ignored. Then delete it with `rm vitest-report.json`.
- [X] [T-003-F] Stage `git add -u .github/workflows/test.yml .github/workflows/publish.yml docs/RELEASE-CLOSEOUT.md tests/installer/heal.test.js tests/tools/repo-invariants.test.js`.
- [X] [T-003-G] Commit: `git commit -m "ci: bump actions to their node24 majors and test on a Node 20 and 24 matrix [BUG-048]"`. **Boundary:** 1032 / 12 (1044), unchanged.

### Task 4: Release 1.34.1 (D4)

**Files:**
- `VERSION`
- `package.json`
- `package-lock.json`
- `CHANGELOG.md`
- `AGENT-READABLE BACKLOG.md:642`

- [X] [T-004-A] Write `1.34.1` into `VERSION` (with a trailing newline), then run `npm version 1.34.1 --no-git-tag-version`, which moves `package.json` and both `package-lock.json` locations.
- [X] [T-004-B] In `CHANGELOG.md`, insert this after `# Changelog` and its blank line, before `## [1.34.0] - 2026-09-29`:

```markdown
## [1.34.1] - 2026-09-29

### Fixed
- **[BUG-048]** CI was green on a skipped-test set nobody had measured: 96 skipped on Node 20 against 12 locally, for the same tests, and nothing asserted it. Each CI leg now asserts its exact skipped set against `tools/skip-baseline.json`, measured from this change's own CI run, and a difference fails the leg naming every test that moved, so coverage lost and coverage gained are both recorded in the PR that causes them.
- **[BUG-048]** The workflows' actions ran on GitHub's deprecated Node 20 action runtime. `actions/checkout`, `actions/setup-node` and `actions/cache` move to `v7`, `v7` and `v6`, whose `action.yml` declares `node24`.

### Changed
- **[BUG-048]** CI tests on Node 20 and Node 24. Node 20 keeps `engines`' floor and the `node:sqlite`-absent paths exercised; Node 24 executes the 83 persistence tests Node 20 skips, which CI had never run. The publish job's pre-publish suite runs on Node 24.

The package contents are unchanged: every file this release touches is outside `package.json` `files`.

```

- [X] [T-004-C] Flip the heading in `AGENT-READABLE BACKLOG.md:642`: `### [ ] \`[BUG-048]\`` becomes `### [X] \`[BUG-048]\``. This is a single-line edit.
- [X] [T-004-D] Insert this as the first bullet under that heading, as a single-line insert:
  `* **DONE, shipped as \`1.34.1\` on 2026-09-29.** Actions moved to their node24 majors in both workflows (checkout \`v7\`, setup-node \`v7\`, cache \`v6\`); \`test.yml\` runs a \`{20, 24}\` matrix with a per-version cache key; each leg asserts its exact skipped set with \`tools/skip-baseline.mjs\` against \`tools/skip-baseline.json\`, measured from the PR's own CI run and armed by the branch's last commit; \`publish.yml\` tests on Node 24 and states why it runs no skip-baseline step. Spec: \`docs/superpowers/specs/2026-09-29-bug048-ci-measured-baseline-design.md\`. Plan: \`docs/superpowers/plans/2026-09-29-bug048-ci-measured-baseline.md\`.`
- [X] [T-004-E] Run `node tools/version-gate.mjs`. Expected: five `ok` lines and `VERSION_GATE_OK 1.34.1` at rc 0. Then run `node tools/record-parity.mjs`. Expected: `RECORD_PARITY_OK` at rc 0.
- [X] [T-004-F] Stage `git add -u VERSION package.json package-lock.json CHANGELOG.md "AGENT-READABLE BACKLOG.md"`.
- [X] [T-004-G] Commit: `git commit -m "chore: release 1.34.1 [BUG-048]"`. **Boundary:** 1032 / 12 (1044), unchanged, because `repo-invariants` reads the live records and stays green.

### Task 5: Pre-push review of Tasks 1–4

Run 1 is spent only on a reviewed branch, so that review fixes do not cost extra CI runs.

- [X] [T-005-A] Dispatch one fresh reviewer, on the most capable model, over `git diff main...HEAD`, with the spec and this plan. Its scope is the instrument's contract against D3, the workflow YAML, R1 and R2, and the release records.
- [X] [T-005-B] Apply any fix the owner accepts before Task 6, one commit per finding, re-measuring the boundary after each. A fix that changes the test count gets a new prediction in its report **before** it is committed.

### Task 6: Run 1, attempt 1 (measure, gate unarmed)

**Files:**
- Create (gitignored custody, per `tools/README.md` registry entry 4):
  - `.conductor/bug048/ci-measure.mjs`
  - `.conductor/bug048/pr-body.md`

- [X] [T-006-A] Write `.conductor/bug048/ci-measure.mjs`:

```js
// Reads one attempt of a Test workflow run. For each matrix leg it records the Vitest
// totals line, the instrument's lines, the skipped identities it printed, and the job's
// annotations. It uses the REST API rather than `gh run view --log`, so each attempt's
// job ids are exact.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const REPO = 'yeisonrestrepo/code-conductor';
const [run, attempt, out] = process.argv.slice(2);
const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 1 << 28 });
const clean = (raw) => raw.replace(/\r$/, '').replace(/^\S+Z /, '').replace(/\x1b\[[0-9;]*m/g, '');

function readLeg(job) {
  // gh 2.100 refuses a response carrying terminal escapes, and Vitest colors its CI
  // output; clean() strips them after the fetch (measured at Task 5's review).
  const lines = gh('api', '--allow-escape-sequences', `repos/${REPO}/actions/jobs/${job.id}/logs`).split('\n').map(clean);
  const identities = lines.map((l) => l.match(/^SKIPPED (".*")$/)).filter(Boolean).map((m) => JSON.parse(m[1])).sort();
  const gate = lines.filter((l) => l.startsWith('SKIP_BASELINE_'));
  const observed = gate.find((l) => l.startsWith('SKIP_BASELINE_OBSERVED'));
  // An extractor that lost a line would report a smaller set with no error; the
  // instrument's own count is the cross-check.
  if (observed && Number(observed.match(/: (\d+) skipped/)[1]) !== identities.length) {
    throw new Error(`${job.name}: instrument observed ${observed}, extractor found ${identities.length}`);
  }
  const totals = lines.find((l) => /^\s*Tests\s+\d/.test(l))?.trim() ?? null;
  const notes = JSON.parse(gh('api', `repos/${REPO}/check-runs/${job.id}/annotations`));
  // Every annotation is kept verbatim: the regex alone would pass a reworded warning.
  const annotations = notes.map((n) => `${n.annotation_level}: ${n.message ?? ''}`);
  const deprecated = annotations.filter((m) => /Node\.js 20 is deprecated/.test(m));
  return { conclusion: job.conclusion, totals, gate, identities, annotations, deprecated };
}

const { jobs } = JSON.parse(gh('api', `repos/${REPO}/actions/runs/${run}/attempts/${attempt}/jobs`));
const result = {};
for (const job of jobs) {
  const leg = job.name.match(/\((\d+)\)/)?.[1];
  if (!leg) throw new Error(`job "${job.name}" names no matrix leg`);
  result[`ci-node${leg}`] = readLeg(job);
}
writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
for (const [env, r] of Object.entries(result)) {
  const byFile = {};
  for (const id of r.identities) { const f = id.slice(0, id.indexOf(' > ')); byFile[f] = (byFile[f] ?? 0) + 1; }
  console.log(`${env} conclusion=${r.conclusion} totals="${r.totals}" skipped=${r.identities.length} annotations=${r.annotations.length} deprecated=${r.deprecated.length}`);
  for (const a of r.annotations) console.log(`  annotation ${a}`);
  for (const l of r.gate) console.log(`  ${l}`);
  console.log(`  by file: ${JSON.stringify(byFile)}`);
}
```

- [X] [T-006-B] Push: `git push -u origin fix/bug-048-ci-measured-baseline`.
- [X] [T-006-C] Write `.conductor/bug048/pr-body.md`. It should give:
  - a summary of the three mechanisms;
  - the per-leg predictions table from this plan;
  - the line "**Bootstrap in progress: the skip-baseline gate is unarmed until the arming commit (Run 2).**";
  - the attribution footer.

  Then open the PR as a draft: `gh pr create --draft --base main --title "1.34.1 - BUG-048: measure and assert CI's skipped set per Node leg" --body-file .conductor/bug048/pr-body.md`. `test.yml` triggers on `pull_request`, so **the PR is what starts Run 1**. A branch push alone runs nothing.
- [X] [T-006-D] Find Run 1 with `gh run list --branch fix/bug-048-ci-measured-baseline --workflow Test --limit 1 --json databaseId,headSha,event`. The run may not be registered yet right after `gh pr create`, so repeat that one command (single invocations about 15 s apart, never a shell loop) until the listed `headSha` equals `git rev-parse HEAD` and `event` is `pull_request`. Then wait with `gh run watch <id> --exit-status`.
- [X] [T-006-E] Measure with `node .conductor/bug048/ci-measure.mjs <id> 1 .conductor/bug048/run1-a1.json`, then compare against the Predictions table, leg by leg:
  - **`ci-node20`:** conclusion `success`. Totals `Tests  949 passed | 96 skipped (1045)` (revised at Task 5, originally 948 / 1044). Skipped by file: `conductor-db` 74, `handoff-cycle` 3, `resume-read` 6, plugin 12, `heal` 1.
  - **`ci-node24`:** conclusion `success`. Totals `Tests  1032 passed | 13 skipped (1045)` (revised at Task 5, originally 1031 / 1044). Skipped by file: plugin 12, `heal` 1.
  - **Both legs:** `deprecated=0` (Mechanism 1), and each leg's last instrument line is `SKIP_BASELINE_REPORT_ONLY: no --env given, nothing asserted`.
  - **Any difference halts the plan here.** Report the measured and predicted values side by side, and write no baseline.
- [X] [T-006-F] Fill in these Bootstrap record fields, one single-line edit each: Run 1 id and head SHA; attempt 1 `ci-node20`; attempt 1 `ci-node24`; and annotations.

### Task 7: Run 1, attempt 2 (identity stability)

**Files:**
- Create: `.conductor/bug048/stability.mjs`

- [X] [T-007-A] Write `.conductor/bug048/stability.mjs`:

```js
// Compares two attempts' measured sets byte-for-byte per leg. An identity that embeds a
// temp path, a timestamp or a random value differs between attempts of the same commit,
// and a baseline built from it would be red forever.
import { readFileSync } from 'node:fs';

const [a, b] = process.argv.slice(2).map((p) => JSON.parse(readFileSync(p, 'utf8')));
let stable = Object.keys(a).sort().join() === Object.keys(b).sort().join();
if (!stable) console.log('IDENTITY_UNSTABLE: the two attempts ran different legs');
for (const env of Object.keys(a)) {
  const x = a[env].identities;
  const y = b[env]?.identities ?? [];
  if (JSON.stringify(x) === JSON.stringify(y)) {
    console.log(`IDENTITY_STABLE ${env}: ${x.length} identities byte-identical across both attempts`);
    continue;
  }
  stable = false;
  console.log(`IDENTITY_UNSTABLE ${env}: attempt 1 has ${x.length}, attempt 2 has ${y.length}`);
  for (const id of x.filter((i) => !y.includes(i))) console.log(`  only in attempt 1: ${JSON.stringify(id)}`);
  for (const id of y.filter((i) => !x.includes(i))) console.log(`  only in attempt 2: ${JSON.stringify(id)}`);
}
process.exitCode = stable ? 0 : 1;
```

- [X] [T-007-B] Re-run Run 1 with `gh run rerun <id>`, then `gh run watch <id> --exit-status`. The rerun uses the same commit, and nothing is committed between attempts.
- [X] [T-007-C] Measure attempt 2 with `node .conductor/bug048/ci-measure.mjs <id> 2 .conductor/bug048/run1-a2.json`, then compare with `node .conductor/bug048/stability.mjs .conductor/bug048/run1-a1.json .conductor/bug048/run1-a2.json`. Expected: `IDENTITY_STABLE ci-node20: 96 …` and `IDENTITY_STABLE ci-node24: 13 …`, at rc 0. **`IDENTITY_UNSTABLE` halts the plan.** Report each differing identity. The fix is to the identity or the test title, decided with the owner, never an edit to the baseline.
- [X] [T-007-D] Fill in the Bootstrap record field "Identity stability", as a single-line edit, with both `IDENTITY_STABLE` lines verbatim.

### Task 8: The arming commit, and Run 2 (the proof)

**Files:**
- Create: `.conductor/bug048/write-baseline.mjs`
- Create: `tools/skip-baseline.json`
- Modify: `.github/workflows/test.yml` (the last step's name and command)
- Modify: this plan's Bootstrap record

- [X] [T-008-A] Write `.conductor/bug048/write-baseline.mjs`:

```js
// Writes tools/skip-baseline.json from one measured attempt, then reads the file back
// through the instrument's own parser and asserts byte equality with the measurement.
// The baseline is copied, never typed (Review Focus 1).
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBaseline } from '../../tools/skip-baseline.mjs';

const [measuredPath, outPath] = process.argv.slice(2);
const measured = JSON.parse(readFileSync(measuredPath, 'utf8'));
const baseline = Object.fromEntries(Object.keys(measured).sort().map((env) => [env, measured[env].identities]));
writeFileSync(outPath, JSON.stringify(baseline, null, 2) + '\n');
const back = parseBaseline(readFileSync(outPath, 'utf8'));
if (back.error) throw new Error(`${outPath} ${back.error}`);
for (const env of Object.keys(measured)) {
  if (JSON.stringify(back.envs[env]) !== JSON.stringify(measured[env].identities)) {
    throw new Error(`${env} did not round-trip byte-identical`);
  }
  console.log(`BASELINE_WRITTEN ${env}: ${back.envs[env].length} identities, byte-identical to the measured attempt`);
}
```

- [X] [T-008-B] Run `node .conductor/bug048/write-baseline.mjs .conductor/bug048/run1-a1.json tools/skip-baseline.json`. Expected: `BASELINE_WRITTEN ci-node20: 96 …` and `BASELINE_WRITTEN ci-node24: 13 …`, at rc 0.
- [X] [T-008-C] Show that assert mode reads the committed file, and that a laptop is not a CI environment:
  - Run `npm test -- --reporter=default --reporter=json --outputFile.json=vitest-report.json`, then `node tools/skip-baseline.mjs --env ci-node24 --report vitest-report.json`.
  - Expected: `SKIP_BASELINE_DRIFT ci-node24: +0 −1 (report: vitest-report.json, baseline: tools/skip-baseline.json)`, followed by one `−` line naming the heal-pin identity from `tests/installer/heal.test.js`, at rc 1. Locally the history is present, so the pin runs.
  - Then delete the report with `rm vitest-report.json`.
- [X] [T-008-D] Arm the gate in `.github/workflows/test.yml`. Replace the last step:
  - its name `Report the skipped set (unarmed until this branch's CI measures the baseline)` becomes `Assert the skipped set against the measured baseline`;
  - its command `node tools/skip-baseline.mjs --report vitest-report.json` becomes `node tools/skip-baseline.mjs --env ci-node${{ matrix.node }} --report vitest-report.json`.
- [X] [T-008-E] Fill in the Bootstrap record field "Arming commit SHA" with `(this commit; see git log)` as a single-line edit. A commit cannot contain its own SHA, so the real SHA is written at closeout.
- [X] [T-008-F] Stage:
  - `git add tools/skip-baseline.json` (a new file in a directory that is not ignored);
  - `git add -u .github/workflows/test.yml docs/superpowers/plans/2026-09-29-bug048-ci-measured-baseline.md`.
- [X] [T-008-G] Commit: `git commit -m "ci: arm the skip-baseline gate with the sets CI measured [BUG-048]"`. **Boundary:** 1033 / 12 (1045), unchanged since Task 5 (revised prediction). The arming commit adds no test, so Run 2's totals must equal Run 1's.
- [ ] [T-008-H] Push with `git push`. Find Run 2 as in T-006-D and confirm `headSha` equals the arming commit. Wait with `gh run watch <id> --exit-status`, then run `node .conductor/bug048/ci-measure.mjs <id> 1 .conductor/bug048/run2.json`. Expected on each leg:
  - conclusion `success`, with the same totals as Run 1;
  - `deprecated=0`;
  - exactly one instrument line: `SKIP_BASELINE_OK ci-node20: 96 skipped identities match tools/skip-baseline.json (report: vitest-report.json)` on `ci-node20`, and the `ci-node24` counterpart with 13.

  Any other outcome halts the plan.
- [ ] [T-008-I] Post Run 2's result as a PR comment: the run id, both `SKIP_BASELINE_OK` lines verbatim, both totals, and the annotation counts. Then run `gh pr ready`. The plan's Bootstrap record gets Run 2 and the arming SHA at closeout on `main`, as Difference 2 explains.

## Test List

- [ ] 23 unit tests in `tests/tools/skip-baseline.test.js`, covering D3's full contract, including the FEAT-021 red case and the same-count swap (Task 1).
- [ ] `tests/tools/tools-not-shipped.test.js` stays unchanged and green (Task 1).
- [ ] Integration: `npm test --` with the JSON reporter, then the instrument in report-only mode, locally (Task 3), and in assert mode against the committed baseline showing the local `−1` drift (Task 8).
- [ ] CI Run 1 attempts 1 and 2, then Run 2: the per-leg measurements, identity stability, and the armed proof (Tasks 6–8).
- [ ] No E2E test: no UI is affected.

## Commit Order

1. `docs: add the BUG-048 CI measured-baseline implementation plan [BUG-048]` (Task 0)
2. `fix: add the skip-baseline instrument and pin its semantics [BUG-048]` (Task 1)
3. `docs: state per-environment test predictions and the skip-baseline gate [BUG-048]` (Task 2)
4. `ci: bump actions to their node24 majors and test on a Node 20 and 24 matrix [BUG-048]` (Task 3). `ci:` is outside CONTRIBUTING's four listed types; it is allowed with this note.
5. `chore: release 1.34.1 [BUG-048]` (Task 4)
6. Any review fixes from Task 5, before Run 1.
7. `ci: arm the skip-baseline gate with the sets CI measured [BUG-048]` (Task 8). This is the branch head and Run 2's commit.

## Identified Risks

- **A `node:sqlite` suite fails on Node 24 in CI.** That would be the first time CI ever ran those suites. Run 1's `ci-node24` goes red, and it is a real failure this change exposes, not one it causes. Halt, report and triage with the owner. It is never skipped to get green.
- **`publish.yml` is not exercised by any PR run.** It runs only on a published release, so its first execution is the next publish. Mitigation: its diff is small and declarative, and Task 5's reviewer checks it. If it fails, it fails before `npm publish`: checkout, setup-node, npm install and the suite all come first.
- **A memory record contradicts the new publish runtime.** `.claude/memory/project.md:521` records "the runner stays on `node-version: '20'`" for `publish.yml`. The spec's D2 deliberately reverses that. The closeout entry names the reversal, and the line is left as history.
- **Log extraction.** GitHub job logs prefix each line with a timestamp, and Vitest may emit ANSI codes. `ci-measure.mjs` strips both, and it cross-checks its identity count against the instrument's own `SKIP_BASELINE_OBSERVED` count, so a lost line throws instead of shrinking the set.
- **A floating `24`.** `setup-node` resolves the latest 24.x on each run. `node:sqlite` has been unflagged throughout 24.x, so the skipped set does not depend on the patch release. If a future 24.x changed that, the gate would go red, naming the tests. That is the gate working.
- **The draft PR is outward-facing.** Opening it is part of this approved plan, because Run 1 cannot start without it (T-006-C).
