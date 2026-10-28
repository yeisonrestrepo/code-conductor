# Spec: support `--no-deps` (issue #106)

Candidate id: pending owner intake (no FEAT id minted). Produced by an AI agent on a contributor's behalf.

## Problem

Install scripts and older docs pass `--no-deps`. Today `parseArgs` in `bin/code-conductor.mjs` does not recognize it, so `run()` prints `ignoring unrecognized argument(s): --no-deps` on stderr. That reads like a typo or a failure, even though the install succeeds.

## Solution

`parseArgs` recognizes `--no-deps` and sets `opts.noDeps = true`. The npm CLI installs no dependencies: FEAT-023 removed the shell installers, which were the only code that ran `npm install -g`, `claude mcp add` and `claude plugin install`. So the flag is an accepted no-op that keeps the "copy agent files only" contract. It no longer triggers the unrecognized-argument warning, and the install behaves exactly as it does without the flag.

**Design choice named:** the issue assumes there is a dependency step to skip, and there is none. The options were (a) an accepted no-op, (b) wiring a new dependency step just so the flag can skip it, or (c) closing the issue. This spec picks (a). Option (b) would add install-time side effects the zero-dependency CLI deliberately dropped. Option (c) leaves existing `--no-deps` callers with a misleading warning.

## Behavior

### Main path
1. The user runs `code-conductor --no-deps`.
2. `parseArgs` sets `noDeps: true` and does not add the flag to `unknown`.
3. The install runs exactly as it would without the flag, and exits 0 with no unrecognized-argument warning.

### Alternative paths
- `--no-deps --project`, in either order, does the global and project install with no warning.
- A repeated `--no-deps` is idempotent.
- `--no-deps` placed right after `--verbosity` is not consumed as the verbosity value, because the existing `--` guard already skips it.

### Error cases
- None new. The flag takes no value. `--no-deps=x` is not recognized and is still reported as unrecognized.

## Acceptance Criteria
- [ ] `run(['--no-deps'])` returns 0 and writes no `unrecognized` line to stderr.
- [ ] The files installed with `--no-deps` are identical to those installed without it.
- [ ] `run(['--verbosity', '--no-deps'])` leaves verbosity at MIN plus a warning, and does not report `--no-deps` as unrecognized.
- [ ] `USAGE` lists `[--no-deps]`.
- [ ] The README Install flags table has a `--no-deps` row stating that it is accepted and that the npm CLI installs no dependencies.

## Out of Scope
- The `-NoDeps` alias (issue #108).
- Adding any dependency-install step.
- Version, CHANGELOG and backlog records (these are owner-side).

## System Impact
- `bin/code-conductor.mjs`: `parseArgs`, `USAGE`, and the "four flags only" comment.
- `tests/installer/cli.test.js`: new cases.
- `README.md` and `.github/wiki/pages/Getting-Started.md`: flag tables (the wiki row already listed `--no-deps` with the stale "skip dependency installation" text).

## Complexity Estimate
S. One parser branch, one usage string, and tests.
