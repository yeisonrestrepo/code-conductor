# BUG-073 publish job installs and runs dev dependencies in the job holding the npm OIDC credential implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** No dev dependency is installed or run in the job that can mint the npm OIDC credential, and the dev toolchain moves to a vitest line without the current advisories.

**Spec:** `docs/superpowers/specs/2026-11-14-bug073-publish-job-installs-and-runs-dev-dependencies-design.md` (approved 2026-11-14 by the owner). Issue #160. PR #234, branch `fix/bug-073-publish-job-installs-and-runs-dev-dependencies` from `main` `54cfb4f`.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>`.

## Global Constraints

- `.github/workflows/publish.yml` is the owner's commit `371647f` (spec D7). No later commit edits it: `git diff --quiet 371647f HEAD -- .github/workflows/publish.yml`.
- No other workflow, hook (`.claude/hooks/pre-tool-use.mjs` and its `project-template/` copy), `scripts/`, `vitest.config.js` or `tools/skip-baseline.json` change.
- No release records: `VERSION`, the package version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `README.md` and `.claude/memory/**` stay untouched (spec, "Records").
- No new dependency. The only `package.json` change is the two `devDependencies` ranges.
- Staging by tracked-ness with explicit paths. The spec and this plan are new files under `/docs/*`, so each one's leaf line joins the `.gitignore` tracked-surface block in sorted position first, and `tests/unit/gitignore-block-parity.test.js` stays green.

## Tasks

### Task 0: Workflow split (owner-applied)

**Files:** `.github/workflows/publish.yml` (owner commit, not written by the lane)

- [x] Owner commit `371647f` "ci: split publish into verify and publish jobs [BUG-073]" is on the branch, with spec D1 to D4.

### Task 1: Records for the spec and plan

**Files:** `.gitignore`, `docs/superpowers/specs/2026-11-14-bug073-publish-job-installs-and-runs-dev-dependencies-design.md`, `docs/superpowers/plans/2026-11-14-bug073-publish-job-installs-and-runs-dev-dependencies.md`

- [ ] Add `!/docs/superpowers/plans/2026-11-14-bug073-publish-job-installs-and-runs-dev-dependencies.md` before the bug076 plan leaf, and `!/docs/superpowers/specs/2026-11-14-bug073-publish-job-installs-and-runs-dev-dependencies-design.md` before the bug076 spec leaf.
- [ ] `npx vitest run tests/unit/gitignore-block-parity.test.js` passes with both files staged.

### Task 2: Dev toolchain

**Files:** `package.json`, `package-lock.json`

- [ ] `npx npm@11 install --save-dev --package-lock-only --ignore-scripts vitest@^4.1.12 @vitest/coverage-v8@^4.1.12`; `git diff package.json` shows only the two ranges.
- [ ] `npx npm@11 audit --package-lock-only` prints "found 0 vulnerabilities".

### Task 3: Tests

**Files:** `tests/installer/workflow.test.js`

- [ ] Rewrite the file to assert spec AC-1 to AC-5 per job, reading the workflow without comment lines and slicing it at the `jobs:` keys, with the `inSupportedLine` edge rows.
- [ ] The file passes on the branch and fails against `git show 54cfb4f:.github/workflows/publish.yml` (the one-job file).

### Task 4: Verify

- [ ] `npm test` locally: the same pass, fail and skip sets as the base on the same machine (vitest 3.2.6 against 4.1.12).
- [ ] `npm run coverage` meets the `vitest.config.js` thresholds.
- [ ] CI on the PR head: the three test.yml legs and their skip-baseline steps are green.
