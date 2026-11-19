# BUG-083: Publish job relies on omitted cache key instead of disabling the setup-node package-manager cache explicitly

**Status:** Draft, awaiting owner approval

**Item:** `[BUG-083]` (intake of issue #235, reported by the automated security review of #234). Pillar 5: infrastructure, ecosystem and QA.

## Problem

The `publish` job in `.github/workflows/publish.yml` holds `id-token: write` and the `npm-publish` environment, and `[BUG-073]` kept it free of anything the `verify` job installs or caches. Today it keeps the npm cache out only because its `actions/setup-node@v7` step (line 60) sets no `cache:` input:

```yaml
      - uses: actions/setup-node@v7
        with:
          node-version: '24'
          registry-url: 'https://registry.npmjs.org'
```

Since v5, `actions/setup-node` turns npm caching on by itself when `package.json` declares a top-level `packageManager` field, or `devEngines.packageManager`, naming npm, and no `cache:` input is given. The input that controls this is `package-manager-cache`, which defaults to `true`; the action's README recommends setting it to `false` in workflows with elevated privileges. `package.json` has neither field today, so nothing is cached and there is no current impact.

The protection is implicit, though. Adding a `packageManager` field (a common edit, and one `corepack` tooling suggests) would make the `publish` job restore the npm cache the `verify` job saved after `npm ci` with dev dependencies, and `npm install -g npm@^11.5.1` would then run against that cache in the job that can mint the npm publishing credential. Nothing in the workflow or its test would flag it: `tests/installer/workflow.test.js:101` asserts only that the word `cache` is absent from the job, which is exactly what stays true while the automatic cache comes on.

## Solution

Add `package-manager-cache: false` to the `with:` block of the `publish` job's `setup-node` step, so the job refuses the automatic cache whatever `package.json` declares. Replace the absence check at `tests/installer/workflow.test.js:101` with assertions that the `publish` job sets `package-manager-cache: false` exactly once, on its `setup-node` step, and still sets no `cache:` or `cache-dependency-path:` input. The job-level comment above `publish:` (line 46) gains a clause saying the package-manager cache is disabled explicitly, tagged `[BUG-083]`. The `verify` job is not touched: it keeps `cache: 'npm'`, which is the cache it is meant to have.

**Choice the entry leaves open: how strict the new test is.** The entry says to assert "that explicit value". This spec pins the literal line `package-manager-cache: false` (unquoted, as the issue writes it) inside the `setup-node` step, rather than accepting any truthy-false spelling (`'false'`, `"false"`, `False`). Action inputs reach the action as strings and `'false'` would work the same, but one spelling keeps the assertion simple and makes a later edit to the value a visible test failure rather than something the regex happens to tolerate. It also pins that no `cache:` key is present, because an explicit `cache: 'npm'` would turn caching on regardless of `package-manager-cache`, and the old test was the only thing guarding that.

## Behavior

### Main path

1. A release is published; `verify` runs as today, saving the npm cache keyed on `package-lock.json`.
2. `publish` checks out with `persist-credentials: false`, then `setup-node` runs with `node-version: '24'`, `registry-url` and `package-manager-cache: false`. It installs Node 24, writes the registry `.npmrc`, and restores no cache.
3. `npm install -g npm@^11.5.1 --ignore-scripts` and `npm publish --provenance --access public --ignore-scripts` run exactly as today. The published package is unchanged.

### Alternative paths

- **`package.json` later gains `packageManager: "npm@..."` or `devEngines.packageManager`:** `verify` still caches (it sets `cache: 'npm'` explicitly); `publish` still restores nothing, because `package-manager-cache: false` turns the automatic cache off.
- **`packageManager` names another manager (yarn, pnpm):** setup-node's automatic cache covers npm only, so nothing changes in either case; the explicit `false` is harmless.
- **A later edit adds `cache: 'npm'` to the `publish` step:** the new test fails, because it still forbids a `cache:` input in that job.
- **A later edit removes `package-manager-cache: false` or changes it to `true`:** the new test fails.

### Error cases

- **setup-node ignores an unknown input:** not a risk here; `package-manager-cache` is a declared input of `actions/setup-node` since v5 and the workflow pins `@v7`. If the action ever dropped the input, GitHub would print an "Unexpected input" warning and the step would still succeed; the behavior would then rest on the absent `packageManager` field again, as it does today. Out of scope to detect, since the workflow test reads only the YAML.
- **The workflow file is edited with a comment naming the input:** comments are stripped before every assertion (`tests/installer/workflow.test.js:13`), so a comment cannot satisfy or break the new checks.

## Acceptance Criteria

- [ ] `.github/workflows/publish.yml`: the `publish` job's `actions/setup-node@v7` step's `with:` block holds `package-manager-cache: false`, alongside the unchanged `node-version: '24'` and `registry-url: 'https://registry.npmjs.org'`.
- [ ] The `verify` job is byte-for-byte unchanged, including `cache: 'npm'`.
- [ ] `tests/installer/workflow.test.js`: the test at line 99 ("targets the npm registry and restores no cache") no longer asserts `not.toMatch(/cache/)`. It asserts that the `publish` job has exactly one `package-manager-cache:` line, that its value is `false`, that the line sits in the `setup-node` step's `with:` block, and that the job has no `cache:` and no `cache-dependency-path:` input.
- [ ] The new test fails against today's `publish.yml` (no `package-manager-cache` line) and passes with the fix. The plan records this red-then-green check.
- [ ] The new test also fails on a scratch edit that adds `cache: 'npm'` to the `publish` step while keeping `package-manager-cache: false`; the plan records this check and reverts the scratch edit.
- [ ] Every other test in `tests/installer/workflow.test.js` passes unchanged, including "uses only checkout and setup-node" and the exact `runs(publish)` list.
- [ ] `npm test` exits 0.

## Out of Scope

- **The `[BUG-083]` line under "Known limits" in `README.md:508`.** It is an owner-side record and is removed at release, not by this change.
- **`AGENT-READABLE BACKLOG.md`, `CHANGELOG.md`, `VERSION` and the `package.json` / `package-lock.json` versions.** Owner-side records per CONTRIBUTING.
- **Adding `package-manager-cache: false` to other workflows** (`test.yml`, `records-guard.yml`, `wiki-sync.yml`). None of them holds `id-token: write`; the entry names only the `publish` job. Reported for separate intake if the owner wants it.
- **Pinning `actions/setup-node` by commit SHA.** Tracked as `[BUG-070]`.
- **Adding a `packageManager` field to `package.json`.** This fix makes it safe for the `publish` job; whether to add one is a separate decision.

## System Impact

- `.github/workflows/publish.yml`: one input line added to the `publish` job's `setup-node` step, and one clause added to the job-level comment. Not shipped in the package (`.github/` is outside `package.json` `files`). It is a protected CI surface, which is why the change is a single explicit input and the test pins it.
- `tests/installer/workflow.test.js`: the body of one `it` block (lines 99-102) changes, possibly with one small helper next to `runs`, `uses` and `permissions` to slice the `setup-node` step out of the job. Helpers are parsed from the comment-stripped YAML, as the existing ones are.
- Callers grepped: `setup-node` appears in `publish.yml`, `test.yml`, `records-guard.yml` and `wiki-sync.yml`; `package-manager-cache` and `packageManager` appear nowhere in the workflows or `package.json`. `tests/wiki/wiki-gen.test.js:176` reads `wiki-sync.yml`, not `publish.yml`, and is unaffected.
- `.gitignore`: one leaf line for this spec and one for its plan, in sorted position, per the tracked-surface block (`tests/unit/gitignore-block-parity.test.js`).

### Files Requiring Full Read (deferred to /cc-plan)

_None._ `tests/installer/workflow.test.js` lines 1-40 (helpers) and 85-115 (the `publish` job block) were read; `.github/workflows/publish.yml` and `package.json` were read in full.

## Complexity Estimate

S: one YAML input line and one rewritten test case, with no runtime code touched.
