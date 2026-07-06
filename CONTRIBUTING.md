# Contributing to code-conductor

Thank you for your interest in contributing! Here is everything you need to get started.

---

## Reporting Issues

Found a bug or have a feature request? Open an issue on the [Issues tab](https://github.com/yeisonrestrepo/code-conductor/issues).

When reporting a bug, include:
- What you did
- What you expected to happen
- What actually happened
- Your OS and Claude Code version

---

## Submitting a Pull Request

1. **Fork** the repository and create a branch from `main`.
2. Keep each PR focused — one feature or fix per PR.
3. Give your branch a descriptive name: `feat/my-feature` or `fix/issue-description`.
4. Make sure your changes work locally before submitting.
5. Link the related issue in your PR description (e.g. `Closes #42`).
6. Open the PR against the `main` branch.

The PR template will pre-fill when you open a pull request — please fill it in completely.

---

## Code Style

- Follow the conventions already present in the file you are editing.
- Shell scripts use `bash` with `set -euo pipefail`.
- Markdown files use sentence case for headings.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `chore:`.

---

## Bypassing the Pre-Commit Hook

The pre-commit test gate installed by `code-conductor --project` can be skipped with:

```
git commit --no-verify
```

This is a permitted developer override for WIP commits, broken test environments, or emergency fixes.

**The GitHub Actions CI gate is unconditional.** A PR merged without a green CI run is a policy violation regardless of `--no-verify` usage. Never disable or skip the CI workflow to merge failing tests.

### Manual Validation Protocol

Use this checklist when your environment restricts hook execution (restricted PowerShell policy, GUI git client that bypasses hooks, or bash not in PATH):

1. **Run the test suite directly**: `npm test` from repo root must exit 0.
2. **Invoke the hook manually**: `bash .git/hooks/pre-commit` from repo root after installation; must exit 0 on a clean codebase.
3. **Trigger via an empty commit**: `git commit --allow-empty -m "hook smoke test"` — the hook fires normally.
4. **Restricted PowerShell hosts**: `code-conductor --project` installs the hook natively via Node (no shell execution policy involved).
5. **bash not in PATH (Windows)**: install [Git for Windows](https://gitforwindows.org/), add its `bin/` to PATH, then re-run `npm test` to confirm the guard3 suite no longer skips.
6. **Verify LF line endings in the written hook**: `node --input-type=commonjs -e "const f=require('fs').readFileSync('.git/hooks/pre-commit','utf8');if(f.includes('\r'))throw new Error('CRLF');console.log('LF only - OK')"` — a CRLF result means Git for Windows bash will fail to parse the shebang; re-run `code-conductor --project` to normalize.

### Resetting the Pre-Commit Hook to Upstream

If your local `.claude/hooks/pre-tool-use.sh` has diverged (e.g., manual edits, failed
partial upgrade), delete it and re-run the installer to pull the current version from the
project template:

**macOS / Linux / Windows:**
```bash
rm .claude/hooks/pre-tool-use.sh   # (PowerShell: Remove-Item .claude\hooks\pre-tool-use.sh)
code-conductor --project
```

The CLI is idempotent and will not overwrite other hook files or project settings.

---

## License

By contributing, you agree that your contributions will be licensed under the [Apache 2.0 License](LICENSE).
