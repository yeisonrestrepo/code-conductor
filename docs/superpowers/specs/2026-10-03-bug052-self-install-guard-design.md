# BUG-052: The Installer Cannot Tell Its Own Source Tree From the Legacy Deployment It Sweeps

**Status:** APPROVED 2026-10-03. **Target:** `1.38.1`, patch. **Branch:** `fix/bug-052-self-install-guard`.

## Problem

The installer has no self-install guard. `sweepStaleRootScripts` (`lib/installer/deploy.mjs:142-149`) removes `<cwd>/scripts` with `rmSync` whenever its file list equals the bundled `scripts/` list exactly. In the development repository that condition holds by identity, because the bundle is built from that very directory. Running `npx code-conductor --project` inside the dev repo therefore deletes tracked source files.

### Field evidence (2026-10-01)

One run deleted all 9 tracked `scripts/*.mjs`, rewrote 4 `.claude/commands/*`, `.claude/settings.json`, `.claude/hooks/context-guard.sh`, `CLAUDE.md` and `.gitignore`, and deployed an untracked `.claude/scripts/`. 17 installer-touched paths total, restored by explicit-path `git restore`.

## Solution

A package-name comparison guard at the top of `deployProject()`. If the asset root's `package.json` `name` field matches the cwd's `package.json` `name` field, throw a `SELF_INSTALL` error (exit 1) before any file system mutation.

The guard compares npm package names, not paths, so it works regardless of symlinks or path resolution.

### Acceptance Criteria

1. Running the installer with `--project` inside the development repository throws `SELF_INSTALL` and exits 1.
2. Running the installer with `--project` in a host project with a different package name succeeds normally.
3. The 1.23.2 legacy root `scripts/` sweep is unaffected in host projects.
4. Red-green tests prove both cases.

## Components Affected

- `lib/installer/deploy.mjs` — self-install guard at top of `deployProject()`
- `bin/code-conductor.mjs` — `SELF_INSTALL` error code handling (exit 1)
- `tests/installer/deploy.test.js` — 2 new tests
