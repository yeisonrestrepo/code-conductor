# Spec: support `-NoDeps` (issue #108)

Candidate id: pending owner intake (no FEAT id minted). Produced by an AI agent on a contributor's behalf.

**Depends on issue #106** (`--no-deps`). This PR is stacked on #106's branch and is rebased onto `main` once #106 merges.

## Problem

Users of the retired `install.ps1` pass `-NoDeps`. Today it is reported as an unrecognized argument.

## Solution

`parseArgs` treats `-NoDeps` exactly like `--no-deps`: it sets `opts.noDeps = true`, which is an accepted no-op (see the #106 spec).

**Design choice named:** the match is exact-case, the same as `-Project` (#107), for the same reason.

## Behavior

### Main path
1. The user runs `code-conductor -NoDeps`.
2. `noDeps` becomes true, the install runs unchanged, and the command exits 0 with no unrecognized warning.

### Alternative paths
- `-NoDeps --no-deps` is idempotent.
- `-NoDeps` combined with `--project` works in either order.
- `--verbosity -NoDeps`: `-NoDeps` is not consumed as the level. The guard is widened from `--` to `-`. If #107 has already merged, this PR reuses that change; otherwise it ships the same one-character change.

### Error cases
- `-nodeps` (lowercase) stays unrecognized.

## Acceptance Criteria
- [ ] `run(['-NoDeps'])` returns 0 and writes no `unrecognized` line.
- [ ] `run(['--verbosity', '-NoDeps'])` sets MIN plus a warning and writes no unrecognized line.
- [ ] `USAGE` and the README flags table show `--no-deps` / `-NoDeps`.

## Out of Scope
- `--no-deps` itself (#106), and case-insensitive matching.

## System Impact
- `bin/code-conductor.mjs`: `parseArgs` and `USAGE`.
- `tests/installer/cli.test.js`.
- `README.md` and `.github/wiki/pages/Getting-Started.md`: flag tables.
- `tests/installer/cli.test.js`: the #106 `--help` case now expects `[--no-deps|-NoDeps]`.

## Complexity Estimate
S. One alias plus tests.
