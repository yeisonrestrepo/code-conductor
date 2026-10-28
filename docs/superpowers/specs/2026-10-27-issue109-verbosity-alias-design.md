# Spec: support `-Verbosity` (issue #109)

Candidate id: pending owner intake (no FEAT id minted). Produced by an AI agent on a contributor's behalf.

## Problem

`code-conductor -Verbosity INFO` reports `-Verbosity` as unrecognized and then also reports `INFO` as a stray positional. The level falls back to MIN. The user asked for INFO and silently gets MIN.

## Solution

`parseArgs` treats `-Verbosity` exactly like `--verbosity`. That covers the space-separated form (`-Verbosity INFO`), the inline form (`-Verbosity=INFO`), the missing-value fallback, and last-wins across both spellings.

**Design choices named:**
- The match is exact-case, consistent with #107 and #108.
- The value guard is widened from `--` to `-`. Without this, `-Verbosity -Project` would consume `-Project` as the level. This is the same one-character change #107 and #108 need, shipped by whichever PR lands first.
- The PowerShell colon form (`-Verbosity:INFO`) is not supported. It was never documented for this CLI.

## Behavior

### Main path
1. The user runs `code-conductor -Verbosity INFO`.
2. `verbosity.md` contains `VERBOSITY: INFO`, and the command exits 0 with no warnings.

### Alternative paths
- `-Verbosity=VERBOSE` (inline form) sets VERBOSE.
- `--verbosity MIN -Verbosity VERBOSE` resolves to VERBOSE (last-wins across spellings).
- `-Verbosity` as the last token falls back to MIN with the existing warning.

### Error cases
- `-Verbosity loud` warns as invalid and falls back to MIN, the same as `--verbosity loud`.

## Acceptance Criteria
- [ ] `run(['-Verbosity', 'INFO'])` writes `VERBOSITY: INFO` and no unrecognized line.
- [ ] `run(['-Verbosity=VERBOSE'])` writes VERBOSE.
- [ ] `run(['--verbosity', 'MIN', '-Verbosity', 'VERBOSE'])` resolves to VERBOSE.
- [ ] `run(['-Verbosity'])` resolves to MIN plus the existing warning, with no crash.
- [ ] `run(['-Verbosity', '-x'])` does not take `-x` as the level.
- [ ] `USAGE` shows `[--verbosity|-Verbosity MIN|INFO|VERBOSE]`. The README flags table shows `-Verbosity LEVEL`, and says `-Verbosity:INFO` is unsupported.

## Out of Scope
- `-Verbosity:INFO`, and case-insensitive matching.

## System Impact
- `bin/code-conductor.mjs`: the `parseArgs` verbosity branch and `USAGE`.
- `tests/installer/cli.test.js`.
- `README.md` and `.github/wiki/pages/Getting-Started.md`: flag tables.

## Complexity Estimate
S. The verbosity branch is generalized over two prefixes, plus tests.
