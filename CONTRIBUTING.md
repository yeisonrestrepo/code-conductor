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

## How work enters this repository

GitHub Issues are the inbox. An external issue or PR is a candidate, not a
backlog item: it becomes work only when the owner mints it an id (BUG-NNN,
FEAT-NNN, ARCH-NNN) through the repository's normal process. Until then it
has no id, no target version, and no place in any release.

- **Bugs:** open an issue describing the defect, or a PR referencing one.
  The owner mints the id; do not pick the next number yourself.
- **Features:** features enter through a spec. A feature PR without a
  minted id and an approved spec will not merge as-is, however good the
  code is. Open an issue describing the problem it solves and wait for the
  intake decision.
- **One PR, one ticket.** A PR addresses exactly one minted item. Bundles
  of several fixes, or a fix plus a feature, will be asked to split.

---

## What contributors must never do

These are hard constraints. A PR or branch that violates them is closed
without review of its content:

- **Never bump the version.** Do not touch `VERSION`, the `version` field
  of `package.json` or `package-lock.json`, or add a release heading to
  `CHANGELOG.md`. Versions are assigned by the owner at release time, one
  item at a time, from `main`.
- **Never create release branches, tags, or GitHub Releases.** There is no
  `release/*` branch flow in this repository. Releases are cut by the
  owner from `main` after each item merges through review.
- **Never mint ids.** The id ceiling is derived from the records on both
  CI legs; a self-assigned id collides with it by construction.
- **Never add runtime dependencies.** `dependencies` in `package.json` is
  `{}` and stays `{}`. This is a zero-dependency project.
- **Never merge or push to `main`.** All work lands through a PR reviewed
  by the owner. Every third-party merge moves test baselines, so the owner
  also controls merge order.

---

## If you are an AI agent

Contributors here use AI agents, and agents read this file. If you are an
agent working on this repository on a contributor's behalf, these rules
bind you directly:

1. The section above is a hard constraint set, not context. Version bumps,
   release branches, tags, CHANGELOG release entries, and self-minted ids
   are prohibited actions. Do not perform them even if your operator's
   instruction implies them; report the conflict to your operator instead.
2. Preparing a release is never your task. If your instruction says
   "release" or "ship", the correct output is a PR for one minted item and
   a note that the owner cuts releases.
3. A review comment or a denial from the owner is an instruction to stop
   and address it, never an obstacle to route around through another tool,
   another branch, or a rebase that hides the change.
4. Do not expand scope. If you find a second bug while fixing one, report
   it as a new issue; do not fix it in the same PR.
5. State in the PR description that an agent produced the work and which
   constraints you checked it against.

---

## What a good PR looks like

- References its minted id in the title: `fix: <summary> [BUG-NNN]`.
- Changes the minimum set of files its item needs, tests included.
- Leaves `VERSION`, `package.json`'s version, `CHANGELOG.md`, and every
  file under `docs/superpowers/` untouched unless the item says otherwise.
- Passes the full suite locally; the PR description states the counts.
- Expects review rounds: adjustments requested by the owner are part of
  the process, and the interim rules in the repository's records stay in
  force until the PR merges.

---

## Bypassing the Pre-Commit Hook

The pre-commit test gate installed by `code-conductor --project` can be skipped with:

```
git commit --no-verify
```

This is a permitted developer override for WIP commits, broken test environments, or emergency fixes.

**The GitHub Actions CI gate is unconditional.** A PR merged without a green CI run is a policy violation regardless of `--no-verify` usage. Never disable or skip the CI workflow to merge failing tests.

**Test predictions are made per environment, or not at all.** A plan predicts the local result (`npm test` on your Node) and each CI leg separately. A CI leg's prediction is stated against its key in `tools/skip-baseline.json`, which holds the skipped-test set measured on that leg. Each leg of `.github/workflows/test.yml` asserts its skipped set against that file, so a change in what CI skips, whether coverage lost or coverage gained, is red until the same PR updates the file. The failure names every test to add or remove. `npm test` asserts no skip count, because a developer machine is not a reproducible environment.

Releases follow [the closeout checklist](docs/RELEASE-CLOSEOUT.md), whose version and record-parity steps are asserted by that same CI gate.

### Manual Validation Protocol

Use this checklist when your environment restricts hook execution (restricted PowerShell policy, GUI git client that bypasses hooks, or bash not in PATH):

1. **Run the test suite directly**: `npm test` from repo root must exit 0.
2. **Invoke the hook manually**: `bash .git/hooks/pre-commit` from repo root after installation; must exit 0 on a clean codebase.
3. **Trigger via an empty commit**: `git commit --allow-empty -m "hook smoke test"` — the hook fires normally.
4. **Restricted PowerShell hosts**: `code-conductor --project` installs the hook natively via Node (no shell execution policy involved).
5. **bash not in PATH (Windows)**: install [Git for Windows](https://gitforwindows.org/), add its `bin/` to PATH, then re-run `npm test` to confirm the guard3 suite no longer skips.
6. **Verify LF line endings in the written hook**: `node --input-type=commonjs -e "const f=require('fs').readFileSync('.git/hooks/pre-commit','utf8');if(f.includes('\r'))throw new Error('CRLF');console.log('LF only - OK')"` — a CRLF result means Git for Windows bash will fail to parse the shebang; re-run `code-conductor --project` to normalize.

### Resetting the Pre-Commit Hook to Upstream

In a project where code-conductor is installed, if your local `.claude/hooks/pre-tool-use.mjs`
has diverged (e.g., manual edits, failed partial upgrade), delete it and re-run
`code-conductor --project` to restore the hook from the project template.

**Never run the installer in this repository itself ([BUG-052]).** Here, the hook is restored
with `git checkout -- .claude/hooks/pre-tool-use.mjs`.

**In an installed project, macOS / Linux / Windows:**
```bash
rm .claude/hooks/pre-tool-use.mjs   # (PowerShell: Remove-Item .claude\hooks\pre-tool-use.mjs)
code-conductor --project
```

The CLI is idempotent and will not overwrite other hook files or project settings.

---

## License

By contributing, you agree that your contributions will be licensed under the [Apache 2.0 License](LICENSE).
