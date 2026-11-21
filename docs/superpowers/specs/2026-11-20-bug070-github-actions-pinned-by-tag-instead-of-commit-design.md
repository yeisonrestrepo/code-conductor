# BUG-070: GitHub Actions pinned by tag instead of commit SHA in the CI and publish workflows

**Status:** Approved 2026-11-20 by the owner

**Item:** `[BUG-070]` (intake of issue #163, reported by the automated security review of the 1.44.0 release candidate, #157). Pillar 5: infrastructure, ecosystem and QA.

## Problem

Every workflow under `.github/workflows/` references its actions by a major tag:

| File | Lines | References |
|---|---|---|
| `records-guard.yml` | 23, 30 | `actions/checkout@v7`, `actions/setup-node@v7` |
| `test.yml` | 32, 34, 41 | `actions/checkout@v7`, `actions/setup-node@v7`, `actions/cache@v6` |
| `publish.yml` | 18, 19, 60, 63 | `actions/checkout@v7`, `actions/setup-node@v7` (both jobs) |
| `wiki-sync.yml` | 38, 40 | `actions/checkout@v7`, `actions/setup-node@v7` |

A tag can be moved to another commit; a commit SHA cannot. A moved tag would change the code that runs in these jobs, including `publish`, which holds `id-token: write` in the `npm-publish` environment, and `wiki-sync`, which holds `contents: write`. The issue rates the risk low, since all three actions are first-party and the records guard runs with a read-only token and no secrets. The backlog entry cites lines 22 and 29 of `records-guard.yml`; the file has since moved them to 23 and 30.

## Solution

Replace each of the eleven `uses: <action>@vN` values with `uses: <action>@<full 40-hex commit SHA> # vX.Y.Z`, taking the newest release inside the major already in use. The SHAs were resolved on 2026-11-20 with `git ls-remote https://github.com/actions/<action> 'refs/tags/vN*'`:

| Action | Tag | Commit |
|---|---|---|
| `actions/checkout` | `v7.0.1` (= `v7`) | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | `v7.1.0` (= `v7`) | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| `actions/cache` | `v6.1.0` (= `v6`) | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` |

None of the listings carries a `^{}` peeled entry, so all three are lightweight tags and the listed object is the commit itself. Each moving major tag points at the same commit as the release chosen, so the change pins what runs today and alters no behavior.

One action keeps one SHA across every workflow. Nothing else in the four files changes: no input, no comment line, no indentation.

### What the change breaks, and how the tests follow it

- **`tests/tools/records-guard.test.js`, "uses the same action majors as test.yml".** `usesValues` matches `^\s*(?:-\s+)?uses:\s*(\S+)\s*$`, so a trailing `# vX.Y.Z` makes every line miss and the set comes back empty; the row also pins the literal `actions/checkout@v7` and `actions/setup-node@v7`. Measured 2026-11-20 on `6228474` with the eleven pins applied: 1 failed, 156 passed across the three workflow test files. `usesValues` now accepts an optional trailing `# vX.Y.Z` and keeps it in the value, and the row asserts that `records-guard.yml` uses exactly `actions/checkout` and `actions/setup-node`, each as `@<40-hex> # v7.x.y`, and that both values appear unchanged in `test.yml`.
- **`tests/installer/workflow.test.js` and `tests/wiki/wiki-gen.test.js`.** Their helpers read the action name up to `@` (`uses:\s*([^@\s]+)@`, `uses:\s*(\S+)@`, and `startsWith('      - uses: <action>@')` in `step()`), so they pass unchanged.

### New pin

`tests/installer/workflow.test.js` gains a `[BUG-070]` describe that reads every `.yml` file in `.github/workflows/` and asserts:

1. at least one `uses:` line is found, so the check cannot pass vacuously;
2. every non-comment `uses:` line has the exact shape `<owner>/<repo>@<40 lowercase hex> # vX.Y.Z`;
3. each action has exactly one `<sha> # <version>` pair across all the files.

Reading the directory, not a fixed list, makes a new workflow inherit the rule.

## Approaches

- **A. Pin every reference by SHA with the version as a trailing comment, and pin the shape in a test (picked by the owner, 2026-11-20).** The form the issue suggests and the one Dependabot and Renovate understand and update.
- **B. Pin `records-guard.yml` only.** The entry names it first, but `publish.yml` holds the most privileged token, so the narrower fix leaves the larger exposure. Rejected.
- **C. Pin by SHA without a test.** Leaves a later edit free to go back to a tag. Rejected.

## Behavior

### Main path

Each job resolves the same action commit it resolves today through the major tag. A moved tag no longer changes it.

### Alternative paths

- **A later edit restores a tag (`@v7`) or a short SHA:** the new describe fails at the shape assertion.
- **A later edit bumps one workflow's SHA and not the others:** the new describe fails at the one-pair-per-action assertion.
- **A new workflow file is added with a tag reference:** the new describe reads it and fails.
- **Dependabot or Renovate later bumps the pins:** both rewrite SHA and comment together, which keeps all three assertions true as long as every file is bumped in one change.

### Error cases

- **A pinned commit is deleted upstream or made unreachable:** the job fails at action download. That is the visible failure SHA pinning trades a silent tag move for.
- **The comment drifts from the SHA (someone edits one and not the other):** not detected; the test checks shape and consistency, not that the comment names the SHA's tag, which would need network access.

## Acceptance Criteria

- [ ] AC1: The eleven `uses:` lines listed under Problem read `@<sha> # <version>` with the values in the Solution table, and `git diff -U0` of the four workflows shows exactly eleven removed and eleven added lines, every pair differing only after the `@`.
- [ ] AC2: `tests/tools/records-guard.test.js` "uses the same action majors as test.yml" passes against the pinned files and fails if `records-guard.yml` goes back to `@v7`.
- [ ] AC3: The new `[BUG-070]` describe in `tests/installer/workflow.test.js` fails against today's tag-pinned files and passes with the fix. The plan records this red-then-green check.
- [ ] AC4: The new describe also fails on a scratch edit that gives one workflow's `actions/checkout` a different SHA; the plan records this check and reverts it.
- [ ] AC5: Every other test in the three workflow test files passes unchanged.
- [ ] AC6: `npm test` shows no failure outside the sandbox baseline.

## Out of Scope

- **The `[BUG-070]` bullet under "Known limits" in `README.md:500`.** An owner-side record, removed at release.
- **`AGENT-READABLE BACKLOG.md`, `CHANGELOG.md`, `VERSION`, the `package.json` / `package-lock.json` versions and `.claude/memory/**`.** Owner-side records per CONTRIBUTING.
- **Adding Dependabot or Renovate configuration** to keep the pins current. A separate decision.
- **Prose that names `actions/checkout@v7`** in comments of `tests/installer/heal.test.js:188` and `tests/tools/repo-invariants.test.js:61`. They describe the action's depth behavior, which the pin does not change.

## System Impact

- `.github/workflows/{records-guard,test,publish,wiki-sync}.yml`: eleven lines, value only. Not shipped in the package. Protected CI surface: the lane App has no Workflows permission, so this item is applied by the owner (the lane run was aborted).
- `tests/tools/records-guard.test.js`: `usesValues` and one `it` body.
- `tests/installer/workflow.test.js`: one new describe, with `readdirSync` added to its `node:fs` import.
- Callers grepped: `uses:` is read by `tests/tools/records-guard.test.js:502`, `tests/installer/workflow.test.js:30,41` and `tests/wiki/wiki-gen.test.js:177`; nothing under `scripts/`, `lib/`, `bin/` or `tools/` parses the workflows' `uses:` lines.
- `.gitignore`: one leaf line for this spec and one for its plan, in sorted position.

## Complexity Estimate

S: eleven value edits and two test changes, with no runtime code touched.
