# FEAT-024 — Automated Unit Testing Suite (Self-Testing Infrastructure)

**Date:** 2026-06-16
**Status:** Approved
**Scope:** M — introduces Node.js toolchain, two ported test files, one CI workflow, installer hook wiring

---

## Problem

Code Conductor has no automated test gate. Changes to shell hooks and installer logic are validated manually by running ad-hoc bash scripts (`tests/guard3-test.sh`, `tests/verbosity-hook-test.sh`). There is no way to enforce correctness before a commit lands or a PR merges. Future JS modules introduced by FEAT-023 will have no test harness at all.

---

## Solution

Introduce a Vitest-based test suite rooted at a new `package.json` in the repo root. Layer 1 ports the two existing bash test harnesses to `tests/hooks/*.test.js` files that spawn the original shell scripts via Node's `spawnSync` and assert on exact exit codes and stderr output. Layer 2 provides an empty `tests/unit/placeholder.test.js` stub scoped for future JS modules. A GitHub Actions workflow gates every push and PR. A pre-commit hook (appended safely by the installers) enforces the test suite locally.

---

## Behavior

### Main path

1. Developer runs `npm ci` after cloning — installs Vitest and dev dependencies.
2. Developer runs `npm test` — Vitest discovers all `tests/**/*.test.js` files and executes them sequentially (`threads: false`).
3. Layer 1 tests spawn the bash scripts in isolated temp directories with mock `.claude/` trees; they assert exact numeric exit codes and stderr strings.
4. Layer 2 placeholder test passes trivially.
5. All tests green → exit 0.

### Alternative paths

- **Commit from nested subdirectory**: pre-commit hook runs `cd "$(git rev-parse --show-toplevel)" && npm test` so working directory is always repo root.
- **npm not on PATH** (GUI git client): pre-commit hook detects missing `npm` and exits 0 with a warning message — commit is not blocked silently.
- **Existing pre-commit hook**: installer appends a `# code-conductor` guard block; if the block is already present, it skips silently (idempotent).
- **Non-git environment** (zip extract, container): installer checks `git rev-parse --git-dir` before touching hooks; no-ops gracefully.
- **Windows host**: `afterEach` uses `fs.rmSync(tmpDir, { recursive: true, force: true })`; stdout assertions normalize `\r\n → \n` before comparison. `spawnSync` is always called as `spawnSync('bash', [scriptPath], options)` — never `spawnSync(scriptPath, options)` — so that Git for Windows routes execution through the bash binary rather than attempting direct `.sh` execution.
- **Windows pre-commit hook write**: `install.ps1` writes the hook file using `[System.IO.File]::WriteAllText(path, content, [System.Text.UTF8Encoding]::new($false))` (UTF-8 without BOM) to prevent Git for Windows bash from failing on a BOM prefix.

### Error cases

- **Test failure**: Vitest exits non-zero → pre-commit blocks commit; CI marks PR check failed.
- **Bash script not found**: `spawnSync` returns `status: null` and `error.code: 'ENOENT'`; test fails with a clear message pointing to the missing file path.
- **Hook timeout**: individual `it()` blocks declare explicit timeouts (5 s for fast hooks, 15 s for traversal-heavy ones); the global config timeout is a backstop at 30 s.
- **`--no-verify` bypass**: documented in `CONTRIBUTING.md` as a permitted operator override; the CI gate remains unconditional. PRs merged without a green CI run are policy violations.

---

## Acceptance Criteria

- [ ] `package.json` exists at repo root with `"private": true`, `"type": "module"`, `"engines": { "node": ">=20" }`, `"scripts": { "test": "vitest run" }`, and `"devDependencies": { "vitest": "^3.0.0" }` — `memfs` is NOT listed; it is deferred to FEAT-023
- [ ] `package-lock.json` is tracked in git
- [ ] `vitest.config.js` sets `threads: false`, `testMatch: ['tests/**/*.test.js']`, and a global timeout backstop
- [ ] `tests/hooks/guard3.test.js` ports all pass/block cases from `guard3-test.sh`; uses `fileURLToPath(import.meta.url)` for script path resolution; asserts exact numeric exit codes and stderr strings
- [ ] `tests/hooks/verbosity-remind.test.js` ports all traversal, skip-flag, HOME-boundary, and fence-warning cases from `verbosity-hook-test.sh`; uses `fs.mkdtempSync` + `fs.rmSync(..., { recursive: true, force: true })` in `afterEach`
- [ ] All `spawnSync` calls use the form `spawnSync('bash', [scriptAbsPath], options)` — never direct `.sh` invocation
- [ ] All `spawnSync` calls pass `{ ...process.env, HOME: tmpDir, ... }` in `env` — `process.env` is never mutated
- [ ] All `spawnSync` calls set `stdio: 'pipe'`
- [ ] Each test's temp dir contains a minimal mock `.claude/` tree before the spawn
- [ ] `tests/unit/placeholder.test.js` exists and passes
- [ ] Layer 2 test files must mock the filesystem via `memfs` and must not import paths resolving outside `tests/unit/` without an explicit `vi.mock()` declaration
- [ ] `.gitignore` blocks `node_modules/` and `.vitest-cache/`
- [ ] `.github/workflows/test.yml` triggers on push and PR to `main`, uses `runs-on: ubuntu-latest`, `actions/setup-node@v4` with `node-version: '20'` and `cache: 'npm'`, runs `npm ci` then `npm test`
- [ ] `install.sh` and `install.ps1` resolve the git hooks directory via `git rev-parse --git-path hooks` and verify a valid git repo before writing
- [ ] Pre-commit hook appended safely using the exact guard block below; idempotency check is a literal string match on the opening sentinel; existing pre-commit content is preserved:
  ```
  # code-conductor:test-gate
  command -v npm >/dev/null 2>&1 || { echo "[conductor] npm not found — skipping test gate"; exit 0; }
  cd "$(git rev-parse --show-toplevel)" && npm test
  # /code-conductor:test-gate
  ```
- [ ] Pre-commit hook body: npm availability check → `cd "$(git rev-parse --show-toplevel)" && npm test`
- [ ] `CONTRIBUTING.md` documents the `--no-verify` policy
- [ ] `npm test` passes cleanly from repo root on a fresh `npm ci`

---

## Out of Scope

- Replacing the original `.sh` test files — they remain as authoritative bash implementations
- Code coverage reporting (`c8`, `istanbul`) — deferred
- Watch mode configuration (`vitest --watch`) — deferred
- Actual JS module unit tests — those belong to FEAT-023
- `memfs` as a devDependency — deferred to FEAT-023; it must not appear in `package.json` until that feature introduces real JS modules that need filesystem virtualization
- Windows-native CI runner — `ubuntu-latest` only for now

---

## System Impact

| File | Change |
|---|---|
| `package.json` | New — root manifest |
| `package-lock.json` | New — tracked in git |
| `vitest.config.js` | New — test runner config |
| `tests/hooks/guard3.test.js` | New — ports `guard3-test.sh` |
| `tests/hooks/verbosity-remind.test.js` | New — ports `verbosity-hook-test.sh` |
| `tests/unit/placeholder.test.js` | New — Layer 2 stub |
| `.github/workflows/test.yml` | New — CI workflow |
| `.gitignore` | Updated — add `node_modules/`, `.vitest-cache/` |
| `install.sh` | Updated — pre-commit hook wiring |
| `install.ps1` | Updated — pre-commit hook wiring |
| `CONTRIBUTING.md` | Updated — `--no-verify` policy section |

### Files Requiring Full Read (deferred to /cc-plan)

- `install.sh` — full read needed to locate safe insertion point for pre-commit hook wiring
- `install.ps1` — full read needed for same
- `tests/guard3-test.sh` — full read needed to port all test cases
- `tests/verbosity-hook-test.sh` — full read needed to port all test cases
- `CONTRIBUTING.md` — full read needed to find correct section for `--no-verify` policy

---

## Complexity Estimate

**M** — no existing JS infrastructure to build on; requires porting two non-trivial bash test harnesses and wiring two installers, but all pieces are well-defined and independent.
