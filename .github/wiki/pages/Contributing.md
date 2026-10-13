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

Tests use Node's built-in test runner. The test suite covers guards, installer, orchestrator, instruments, and unit tests.

## Release Instruments

Release integrity is checked by instruments in `tools/`:

| Instrument | What it checks |
|------------|---------------|
| `id-ceiling.mjs` | No ID exceeds the backlog ceiling; no duplicates |
| `record-parity.mjs` | Every shipped claim matches its spec and plan |

These run as part of the release process and CI.
