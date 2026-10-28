# Issue #95 Guard 3 Test Temp-Dir Cleanup on Windows — Design

**Status:** DRAFT 2026-10-24, owner reviews in the PR
**Issue:** #95 (backlog id assigned owner-side)

## Problem

`tests/hooks/guard3.test.js` runs every corpus row through `runRow`, which creates a temp dir under `tests/.tmp/`, spawns `bash` on the reference hook with that dir as its cwd, and removes the dir in a `finally` with a bare `fs.rmSync(dir, { recursive: true, force: true })` (`:62`). On Windows, a process that has just exited can keep a handle on its cwd (and an antivirus scan can hold the allowlist file it was given) for a short moment after `spawnSync` returns. A bare `rmSync` that lands in that window throws `EPERM` or `EBUSY`. Because the throw comes from `finally`, it replaces the row's verdict and the row fails, though the hook answered correctly. The issue saw it under full-suite load, never in isolation (8 of 8 isolated runs green).

## Root cause

The child really has exited: `spawnSync` returns only after the process is reaped and its pipes close. The handle that blocks removal belongs to Windows, which releases a dead process's cwd handle and finishes any scan of its files asynchronously. No code in the test can wait on that event directly, so the cause cannot be removed from the test side. What the test can fix is that **its cleanup is fatal and has no tolerance for a delay the platform documents**.

## Solution

One helper, `removeTempDir(dir)`, used by `runRow` and by the `afterAll` sweep:

```js
let lastError
for (let attempt = 1; attempt <= 10; attempt++) {
  try { fs.rmSync(dir, { recursive: true, force: true }); return }
  catch (e) {
    lastError = e
    if (!RETRYABLE_RM_CODES.includes(e.code)) break
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * attempt)
  }
}
console.warn(`[guard3] temp dir not removed (${lastError.code}), left in tests/.tmp: ${dir}`)
```

It retries `EBUSY`, `EPERM` and `ENOTEMPTY` with a linear backoff (50, 100, … ms, up to about 2.75 s in total), which covers the release window, and never throws. When it gives up, after a non-retryable error or the 10th try, it prints one `console.warn` naming the code and the dir, so leftovers in `tests/.tmp` do not pile up unnoticed. The retry is hand-rolled because Node's own `maxRetries`/`retryDelay` was measured not to retry on Node 24.16.0 / win32: with the dir held open by a child process's cwd, `rmSync` with `maxRetries: 10` threw `EPERM` after 1 ms and left the dir, while this loop removed it after 532 ms, once the holder exited. A dir that still will not go does not fail the row: the verdict is what the row asserts, and the `afterAll` sweep retries every leftover `cc-guard3-*` dir at the end of the file. `tests/scripts/conductor-db.test.js:49-58` uses the `maxRetries` shape for the same Windows behavior and is likely affected by the same Node 24 gap; that is out of scope here.

Rejected alternatives:

- **Retry only, cleanup still fatal.** Smaller, but a dir held for longer than the retry window would still turn a correct verdict into a failure.
- **Swallow only, no retry.** Leaks a dir per hit until `afterAll`, and the sweep would hit the same race with no backoff.
- **Run the hook with no temp cwd.** The allowlist rows read `.claude/memory/bash-scan-allowlist.txt` from the cwd, and isolating every row from the developer's own memory is the reason the dir exists.

## Acceptance Criteria

- [ ] `runRow` and the `afterAll` sweep remove dirs through one helper that retries `EBUSY`/`EPERM`/`ENOTEMPTY` up to 10 times with a 50 ms linear backoff.
- [ ] A cleanup error never fails a row; the row's assertion is about the hook's exit status only.
- [ ] A dir the helper gives up on is reported with one `console.warn` naming the error code and the dir.
- [ ] Every corpus, dialect and termination case, and their count (176), are unchanged.
- [ ] Repeated runs of `guard3.test.js` on Windows show zero EPERM/EBUSY failures on the branch, measured against the same runs on `main`.
- [ ] Full suite on the branch shows no new failures against `main` under identical conditions.

## Out of Scope

- Other test files' temp-dir cleanup (none reported).
- `[BUG-058]`/`[BUG-059]` Windows failures.
- Release records (VERSION, CHANGELOG, backlog flip).

## System Impact

- `tests/hooks/guard3.test.js` only. No shipped file changes.

## Complexity Estimate

**XS.** One helper, two call sites, one test file.
