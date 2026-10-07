# BUG-051: /cc-stack and /cc-resume Reference the Wrong Detector Path in Installed Projects

**Status:** APPROVED 2026-10-03. **Target:** `1.38.2`, patch. **Branch:** `fix/bug-051-detector-path`.

## Problem

`/cc-stack` and `/cc-resume` both hard-code `scripts/detect-stack.mjs` at the repo root as the detector path. The installer deploys the detector to `.claude/scripts/detect-stack.mjs`, so in installed projects:
- `/cc-stack` fails with `MODULE_NOT_FOUND` and reports "no stack detected"
- `/cc-resume`'s auto-fill silently skips because the existence check for `scripts/detect-stack.mjs` fails

The two failures are asymmetric: `/cc-stack` fails loud, `/cc-resume` degrades silently.

## Solution

Both commands now resolve the detector path dynamically: check `.claude/scripts/detect-stack.mjs` first (installed location), fall back to `scripts/detect-stack.mjs` (development layout). If neither exists, skip silently.

### Acceptance Criteria

1. In an installed project, `/cc-stack` runs the detector from `.claude/scripts/detect-stack.mjs`.
2. In an installed project, `/cc-resume`'s auto-fill runs the detector from the deployed location.
3. In the development repository, both commands still use `scripts/detect-stack.mjs`.
4. Mirror parity between `.claude/commands/cc-resume.md` and `project-template/.claude/commands/cc-resume.md` is maintained.

## Components Affected

- `global/commands/cc-stack.md` — detector path resolution in steps 1 and 3
- `project-template/.claude/commands/cc-resume.md` — detector path resolution in auto-fill step
- `.claude/commands/cc-resume.md` — mirror of the above
