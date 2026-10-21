# BUG-060 Installer Node Floor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `run()` takes the Node version from its options bag, so npm's `NODE` path can no longer fail the floor check on Windows.

**Architecture:** One signature default (`nodeVersion = process.versions.node`) in `run()`'s third argument, beside `cwd` and `log`. The floor check and its message read that value. No environment key decides the version.

**Tech Stack:** Node ESM, vitest.

**Spec:** `docs/superpowers/specs/2026-10-20-bug060-node-env-alias-design.md`, APPROVED 2026-10-20.

## Global Constraints

- The floor stays `>=20`, and `nodeMajorAtLeast` (`lib/installer/env.mjs:32`) is not changed.
- Only `bin/code-conductor.mjs` and `tests/installer/cli.test.js` change in Task 1.
- No release records: no `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`, backlog flip, README "Known limits" removal or `project.md` closeout. Release stays human, by `docs/RELEASE-CLOSEOUT.md`.
- Staging is by explicit path: `git add -u <path>` for tracked files, `git add -f <path>` for a new file under `/docs/*`. Never bare `git add -u`.
- The pre-commit hook runs the full vitest suite. Never bypass it.

## Review Focus

1. **A supported runtime with a lowercase `node` key in `env`** (the Windows alias on every platform): the install proceeds. Pinned by T-001-A test 1.
2. **An uppercase `NODE` path in `env`**: the install proceeds, before and after the fix. Pinned by T-001-A test 2.
3. **An injected version below the floor**: exit 1, the message names the version, nothing under home. Pinned by T-001-A test 3.
4. **A version-shaped `env.node` that is below the floor**: ignored, because the environment is no longer an injection point. Pinned by T-001-A test 4.
5. **A version exactly at the floor (`20.0.0`)**: passes. Pinned by T-001-A test 5.

The unparseable-version path (`''` or non-numeric) keeps the fail-closed behavior that `nodeMajorAtLeast` already has. Its own tests cover it, and this plan does not touch it.

---

### Task 0: Commit the approved specs, this plan and their ignore leaves

**Files:**
- Modify: `.gitignore` (one leaf for this plan, in sorted position after `!/docs/superpowers/plans/2026-10-06-feat041-reviewer-in-loop.md`)
- Create (stage): `docs/superpowers/plans/2026-10-20-bug060-node-env-alias.md`
- Create (stage): `docs/superpowers/specs/2026-10-20-bug060-node-env-alias-design.md`
- Create (stage, owner-confirmed): `docs/superpowers/specs/2026-10-07-bug055-non-string-manifest-fields-design.md`
- Modify (stage, owner-confirmed): `.claude/memory/project.md`

The `.gitignore` in the worktree already holds the BUG-055 and BUG-060 spec leaves. Committing it without both spec files fails `gitignore-block-parity` in the pre-commit suite, so both specs ride this commit. `project.md` holds the owner's BUG-055 edits and the BUG-060 spec entry together. The branch gate asks the owner to confirm this bundle before Task 0 runs.

- [X] [T-000-0] Create and switch to the fix branch: `git switch -c "fix/bug-060-node-env-alias"`. Expected: `git branch --show-current` prints `fix/bug-060-node-env-alias`. Uncommitted and untracked files carry over to the new branch.
- [X] [T-000-A] Add `!/docs/superpowers/plans/2026-10-20-bug060-node-env-alias.md` to `.gitignore` directly after the `2026-10-06-feat041-reviewer-in-loop.md` plan leaf. This is the BUG-042 toll. `/docs/superpowers/plans/*` (`.gitignore:64`) denies the file until its leaf exists: `git check-ignore -v` on 2026-10-20 matched that line. Without the leaf, `gitignore-block-parity` fails once the file is tracked.
- [X] [T-000-B] Stage the tracked files: `git add -u .gitignore .claude/memory/project.md`
- [X] [T-000-C] Stage the new files: `git add docs/superpowers/specs/2026-10-07-bug055-non-string-manifest-fields-design.md docs/superpowers/specs/2026-10-20-bug060-node-env-alias-design.md docs/superpowers/plans/2026-10-20-bug060-node-env-alias.md`. After T-000-A every leaf is present, so plain `git add` stages all three at rc 0 and `-f` is not needed.
- [X] [T-000-D] Commit: `git commit -m "docs: add the BUG-060 spec and implementation plan [BUG-060]" -m "Also carries the BUG-055 spec and its project.md notes, because .gitignore already names that spec and gitignore-block-parity requires the file to be tracked alongside its leaf."`. Expected: the pre-commit suite passes, including `gitignore-block-parity`.

### Task 1: Read the Node version from options, not the environment

**Files:**
- Modify: `bin/code-conductor.mjs:55-62`
- Test: `tests/installer/cli.test.js:92-97` (the existing refusal test is replaced in place by five `[BUG-060]` tests)

**Interfaces:**
- Consumes: `nodeMajorAtLeast(min, version)` from `lib/installer/env.mjs`, unchanged.
- Produces: `run(argv, env = process.env, { cwd = process.cwd(), log, nodeVersion = process.versions.node } = {})`. The only production caller (`:140`) passes no options.

- [X] [T-001-A] Replace the test at `tests/installer/cli.test.js:92-97` (`'exits 1 on Node below the >=20 floor'`) with these five tests, in the same `describe('run')` block:

```js
  const refused = () => logs.some(l => l.startsWith('stderr:') && /Node >=20/.test(l));
  it('[BUG-060] AC1 ignores a lowercase node key holding a path', () => {
    const rc = run([], { HOME: home, node: 'C:\\Program Files\\nodejs\\node.exe' }, { cwd, log });
    expect(refused()).toBe(false);
    expect(rc).toBe(0);
  });
  it('[BUG-060] AC1 ignores an uppercase NODE key holding a path', () => {
    const rc = run([], { HOME: home, NODE: 'C:\\Program Files\\nodejs\\node.exe' }, { cwd, log });
    expect(refused()).toBe(false);
    expect(rc).toBe(0);
  });
  it('[BUG-060] AC2 exits 1 when the injected nodeVersion is below the >=20 floor', () => {
    const rc = run([], { HOME: home }, { cwd, log, nodeVersion: '18.19.1' });
    expect(rc).toBe(1);
    expect(logs.some(l => l.startsWith('stderr:') && /Node >=20 required, found 18\.19\.1/.test(l))).toBe(true);
    expect(existsSync(join(home, '.claude'))).toBe(false);
  });
  it('[BUG-060] AC3 ignores a version-shaped env.node', () => {
    const rc = run([], { HOME: home, node: '18.19.1' }, { cwd, log });
    expect(refused()).toBe(false);
    expect(rc).toBe(0);
  });
  it('[BUG-060] AC4 passes a nodeVersion exactly at the floor', () => {
    const rc = run([], { HOME: home }, { cwd, log, nodeVersion: '20.0.0' });
    expect(refused()).toBe(false);
    expect(rc).toBe(0);
  });
```

- [X] [T-001-B] Run the red step: `npx vitest run tests/installer/cli.test.js -t "BUG-060"`. The filter selects exactly these five tests and nothing else in the file. Expected:
  - AC1 lowercase `node`: FAIL (rc 1, refused with the path as the "found" value).
  - AC1 uppercase `NODE`: PASS (a plain object is case-sensitive, so the key is never read).
  - AC2 `nodeVersion: '18.19.1'`: FAIL (the option is ignored, the real runtime passes, rc 0).
  - AC3 `env.node: '18.19.1'`: FAIL (refused).
  - AC4 `nodeVersion: '20.0.0'`: PASS (the option is ignored and the real runtime passes).
  - Totals: 3 failed, 2 passed.
- [X] [T-001-C] Edit `bin/code-conductor.mjs:55-62` to:

```js
export function run(argv, env = process.env, { cwd = process.cwd(), log, nodeVersion = process.versions.node } = {}) {
  const emit = log || ((stream, msg) => process[stream].write(`${msg}\n`));
  // Hard runtime floor. The version comes from options, never env: on Windows env lookups are
  // case-insensitive and npm sets NODE to node.exe's path, so env.node read that path (BUG-060).
  if (!nodeMajorAtLeast(20, nodeVersion)) {
    emit('stderr', `code-conductor: Node >=20 required, found ${nodeVersion}`);
    return 1;
  }
```

  Keep the lines after `:62` unchanged. Match the existing comment's wording where it still holds, and replace only the clause about `env.node`.
- [X] [T-001-D] Run the green step: `npx vitest run tests/installer/cli.test.js -t "BUG-060"`. Expected: 5 passed, 0 failed.
- [X] [T-001-E] AC5 check: `grep -n "env\.node" bin/code-conductor.mjs`. Expected: no output, exit 1.
- [X] [T-001-F] Dependency check: `grep -rn "env\.node\|node: '" tests/installer bin lib`. Expected: the only hits are the `[BUG-060]` AC1 lowercase and AC3 tests, which set `env.node` on purpose to prove it is ignored. Any other hit is a caller that still injects the version through `env`: repair it inside this task. A grep on 2026-10-20 found exactly one such site, `cli.test.js:93`, which T-001-A replaces.
- [X] [T-001-G] AC6: `npm test`. Expected: the full suite passes.
- [ ] [T-001-H] Stage: `git add -u bin/code-conductor.mjs tests/installer/cli.test.js docs/superpowers/plans/2026-10-20-bug060-node-env-alias.md`
- [ ] [T-001-I] Commit: `git commit -m "fix: read the installer Node floor from options, not env [BUG-060]"`. Expected: the pre-commit suite passes.

The ticks for T-001-H and T-001-I are made after their commit. Only the human-owned closeout commit can carry them. This plan does not add a closeout commit.

## Test List

- [ ] Unit: five `[BUG-060]` cases in `tests/installer/cli.test.js` (AC1 x2, AC2, AC3, AC4).
- [ ] Integration: none. `run()` is already exercised end to end by the existing `run` suite, which the full-suite step runs.
- [ ] E2E: none. No UI is involved. A Windows `npx` run is the owner's field check at release.

## Commit Order

1. Task 0: specs, plan, `.gitignore` leaves and `project.md` (docs).
2. Task 1: the fix, its tests and the plan ticks (fix).

## Identified Risks

- **Pre-flight, happy path:** `npx` calls `run(argv)` with no options, `nodeVersion` defaults to `process.versions.node`, the floor passes, and the install proceeds.
- **Pre-flight, failure points:** a caller that still passes the version through `env` would silently stop being checked. T-001-F greps for that. The AC1, AC3 and AC4 tests run a real deploy into a temp home, so they depend on the deploy succeeding. The existing `'deploys the global set and exits 0'` test is the baseline: if it fails, these fail for the same reason.
- **Pre-flight, boundary conditions:** `20.0.0` (AC4), `18.19.1` (AC2), and an empty or non-numeric version, which `nodeMajorAtLeast` already fails closed and this plan leaves alone. An explicit `nodeVersion: undefined` takes the default by destructuring rules, which is the intended behavior.
- **Task 0 bundle:** committing `.gitignore` without both spec files fails parity. Task 0 includes both, but only after the owner confirms.
- **Real runtime below 22.5 on a contributor machine:** it does not affect these tests, since the floor is 20 and the tests inject versions on either side of it.
