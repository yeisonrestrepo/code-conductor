# Spec: the flow emitter's append survives a rotation's rename on Windows (issue #130)

**Status:** Draft, awaiting owner approval

Candidate id: pending owner intake (no BUG id minted). Produced by an AI agent on a contributor's behalf.

## Problem

`tests/hooks/flow-append-race.test.js` M9 failed once on the `windows-latest` / Node 24 leg with `appendErrors` 1 under 16 writers, and passed on a plain rerun (run 42885697594).

The question was whether the test is timing-sensitive or the algorithm can fail an append. It can fail one. The failure is not in the lock or the test logic. It comes from the file-system primitive:

| Probe (Windows 11, Node 24.16.0, 2026-11-10) | Result |
|---|---|
| 1 process renames a temp file over `F` in a loop, 8 processes append to `F`, 20 s, no lock | 3,481 renames succeed; 1 of about 75,000 appends fails, at `open`, with `EPERM` |
| M9's own worker, error codes recorded, 16 writers, rotation at 4 KiB, 10 runs | 1 append fails, `EPERM`; rotations also fail `EPERM` (already accepted by the test) |
| M9 as shipped, 30 runs | 0 append failures (the CI rate is too low to see in 30 runs) |

When a rotation's rename succeeds, a writer opening the file in the same instant can get `EPERM`. The most likely cause is that the open catches the replaced file while it is being deleted. The window is one instant. The next open sees the new file.

The emitter (`recordFlowEvent`) hits the same primitive. Its `appendFileSync` throws, its catch swallows the error, and the event is lost. That breaks FEAT-044 AC11 ("0 errors") on Windows. The M9 assertion `appendErrors === 0` is correct and stays as it is.

## Solution

The emitter opens the event file itself and tries the open again when it fails with `EPERM`, at most 3 tries in total. Then it makes one `writeSync` of the line and closes the file.

- **Only the open is retried.** A failed open wrote nothing, so a retry cannot duplicate an event. A failed write is never repeated.
- **Only `EPERM`.** `ENOENT` (no `.claude/`) and every other error fail on the first try, exactly as before, into the same swallowing catch. Fail-open (AC2) is unchanged.
- **Bounded.** A file that stays unopenable costs at most 3 failed opens, then the event is dropped as before. The decision is already emitted at that point.
- **One write per event**, as before. The leading newline and the M7 no-tear property are unchanged.
- The M9 worker mirrors the emitter's append, since its header says it runs the emitter's algorithm.

**Design choices named:**

1. **Retry the open instead of removing the rename.** Rotating in place (truncate, then append the kept lines) has no rename and no window. It does change D7: a crash between truncate and rewrite empties the log, readers can briefly see an empty file, and events appended in that gap end up ahead of older lines. The retry changes nothing a reader sees. If the owner prefers removing the window, that is a D7 change for its own spec.
2. **3 tries.** In every measured case one retry was enough (the POC needed 1 retry in 20 stress runs). 3 tries leave margin and still cost nothing when the file is fine.
3. **No platform check.** `EPERM` from `open` on POSIX means a permission problem that a retry will not fix. It costs 2 more failed opens on a path that was already failing. One code path is simpler than two.

## Acceptance criteria

- [ ] **AC1.** With the first open of the event file failing with `EPERM`, a hook call records its event exactly once.
- [ ] **AC2.** With every open failing with `EPERM`, the hook exits 0, its decision is unchanged, and no event is written.
- [ ] **AC3.** M9 (and M7) pass with the worker's append matching the emitter's. A 30-run loop of the file is green locally, and the Windows CI leg is green.
- [ ] **AC4.** Both hook copies stay identical, and the full suite passes locally with no skip-set change.

## Out of scope

Rotation's own `EPERM` (accepted by D7 and retried on the next call), the D7 rename design itself, and the readers.
