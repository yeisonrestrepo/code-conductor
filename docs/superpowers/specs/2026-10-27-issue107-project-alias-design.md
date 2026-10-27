# Spec: support `-Project` (issue #107)

Candidate id: pending owner intake (no FEAT id minted). Produced by an AI agent on a contributor's behalf.

## Problem

Users coming from the retired `install.ps1` type `-Project`. `parseArgs` reports it as unrecognized and installs **only the global half**. The user expected a project scaffold and silently gets none.

## Solution

`parseArgs` treats `-Project` exactly like `--project`.

**Design choice named:** the match is exact-case (`-Project` only, not `-project`). That is the spelling the retired installer and the old README documented. Case-insensitive matching would be a new convention for this parser, which matches every other flag exactly.

## Behavior

### Main path
1. The user runs `code-conductor -Project` in a project directory.
2. `opts.project` becomes true, and the global and project install run exactly as they do with `--project`.

### Alternative paths
- `-Project --project` is idempotent.
- `-Project` keeps the BUG-052 self-install refusal: it still exits 1 inside a clone of this package.
- `--verbosity -Project`: the value guard must not consume `-Project` as a level. This spec widens that guard from `--` to `-`, so any token starting with `-` is treated as a flag and never as a value. The valid levels (MIN, INFO, VERBOSE) never start with `-`, so no valid input changes meaning.

### Error cases
- `-project` (lowercase) stays unrecognized, keeps the existing warning, and installs the global half only.

## Acceptance Criteria
- [ ] `run(['-Project'])` scaffolds the project template, exactly as `run(['--project'])` does.
- [ ] `run(['-Project'])` writes no `unrecognized` line.
- [ ] `run(['--verbosity', '-Project'])` installs the project, sets MIN plus a warning, and writes no unrecognized line.
- [ ] `run(['-Project'])` inside a self-install fixture exits 1.
- [ ] `USAGE` and the README flags table show `--project` / `-Project`.

## Out of Scope
- Case-insensitive flags, and the PowerShell `-Param:value` syntax.
- The other aliases (issues #108 and #109).

## System Impact
- `bin/code-conductor.mjs`: `parseArgs` (the `--project` branch and the verbosity value guard), and `USAGE`.
- `tests/installer/cli.test.js`.
- `README.md` and `.github/wiki/pages/Getting-Started.md`: flag tables.

## Complexity Estimate
S. One alias and a one-character guard change, plus tests.
