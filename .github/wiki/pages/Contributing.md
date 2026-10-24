# Contributing

## How work enters this repository

Issues are **candidates**. Work starts when the maintainer mints an ID (e.g., `FEAT-042`, `BUG-050`) against the backlog ceiling. An unminted candidate is recorded but not queued.

## Intake Process

1. **File an issue** — describe the problem or feature with acceptance criteria
2. **Triage** — the maintainer evaluates against recorded decisions and the current backlog
3. **Mint** — if accepted, an ID is assigned and the item enters the backlog
4. **Spec** — a spec is written using `/cc-spec` and approved by the maintainer
5. **Plan** — a plan is mapped using `/cc-plan` and approved
6. **Implement** — work proceeds through `/cc-implement` or `/cc-orchestrate`
7. **Review** — PR reviewed, merged, and closed

## PR Conventions

- PRs map to one minted backlog item
- The branch name follows `feat/<item>` or `fix/<item>` pattern
- Commit messages reference the item ID (e.g., `[FEAT-042]`)
- Every claim in the PR description traces to a commit or file

## The Checkbox Protocol

Plan tasks use a 4-state checkbox:

| State | Meaning |
|-------|---------|
| `[ ]` | Pending |
| `[>]` | In progress (currently executing) |
| `[X]` | Completed |
| `[!]` | Failed (needs attention) |

## Constraints

- **Zero runtime dependencies** — `dependencies` stays `{}`
- **No third-party GitHub Actions** unless they provide something a few lines of YAML cannot
- **Every published statement traces to the repository** — no invented claims
- Releases, tags, and version bumps stay manual

## Testing

```bash
npm test          # run the full test suite
```

Tests use [vitest](https://vitest.dev/) (`"test": "vitest run"` in `package.json`). The suite covers guards, hooks, installer, orchestrator, scripts, instruments, the wiki generator and unit tests. CI (`.github/workflows/test.yml`) runs it on Node 20 and Node 24 on Ubuntu and on Node 24 on Windows, for every pull request and push to `main`.

## Release Instruments

Release integrity is checked by four repository-only instruments in `tools/`; none ships in the npm package:

| Instrument | What it checks | Run by |
|------------|---------------|--------|
| `id-ceiling.mjs` | The highest filed id over the working tree and `origin/main`, so a new id never collides | A person or agent, by hand, before minting an id |
| `version-gate.mjs` | `VERSION` agrees with every other location that carries the version | `tests/tools/repo-invariants.test.js` in CI, and by hand at closeout |
| `record-parity.mjs` | Every item the `CHANGELOG` claims has a closed backlog entry naming its version | `tests/tools/repo-invariants.test.js` in CI, and by hand at closeout |
| `skip-baseline.mjs` | Each CI leg's exact skipped-test set matches `tools/skip-baseline.json` | `test.yml` directly, after the suite, on every leg |

`tools/README.md` also keeps the registry of retired instruments. Where these sit in the system is on [Architecture Overview](Architecture-Overview#level-2-containers).
