# BUG-052 Self-Install Guard Implementation Plan

**Goal:** Prevent the installer from deploying into its own source tree by comparing package names before any file system mutation.

**Architecture:** A single guard clause at the top of `deployProject()` that reads both `package.json` files, compares their `name` fields, and throws `SELF_INSTALL` when they match. The CLI catches the error code and exits 1 with a descriptive message.

**Tech Stack:** Node >= 20 ESM, vitest.

**Spec:** `docs/superpowers/specs/2026-10-03-bug052-self-install-guard-design.md`, APPROVED 2026-10-03.

## Steps

- [x] T-001: Add self-install guard to `lib/installer/deploy.mjs`
  - Read `package.json` from both `assetRoot` and `cwd`
  - Compare `name` fields; throw `SELF_INSTALL` on match
  - Wrap in try/catch so JSON parse failures do not block non-self installs

- [x] T-002: Handle `SELF_INSTALL` error code in `bin/code-conductor.mjs`
  - Add `err.code === 'SELF_INSTALL'` to the precondition-conflict branch (exit 1)

- [x] T-003: Add tests to `tests/installer/deploy.test.js`
  - `[BUG-052] refuses to deploy into the package own source tree` — same name, expects throw
  - `[BUG-052] allows deploy when package names differ` — different names, no throw

- [x] T-004: Version bump and changelog
  - Bump VERSION, package.json, package-lock.json to `1.38.1`
  - Add `[1.38.1]` entry to CHANGELOG.md
