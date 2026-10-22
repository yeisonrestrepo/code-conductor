# FEAT-043: Wiki Auto-Sync from In-Repo Page Templates

**Issue:** #70
**Date:** 2026-10-07, revised 2026-10-21
**Status:** DRAFT for owner approval. Answers the `[FEAT-043]` entry minted in `80dd54f` (intake of issue #70). Single source for the wiki-sync design since #71 closed in PR #80's favor.

---

## Problem Statement

The project wiki holds 13 hand-written pages (12 pages and a sidebar) derived from the codebase: README, CONTRIBUTING, hooks, commands, agents, skills, the SNAP contract. Without automation it drifts from the source within one or two releases. The same drift class that `[FEAT-039]` targets for the README applies here, and the wiki has no instruments checking it.

826 unique cloners in 14 days against 15 stars suggests a discoverability and comprehension gap. The wiki is the newcomer-facing surface that closes it, but only while it stays current.

## Decision: the pages are templates in the repository

The first draft of this spec generated each page from source files. Measured against the live wiki on 2026-10-12, that cannot reproduce what is there: the wiki is 981 lines of hand-written prose and most of it has no source to regenerate from.

- `Commands-Reference` describes 15 commands; `.claude/commands/` holds 6, and the rest live in `global/commands/` and `project-template/.claude/commands/`.
- The agent files carry `name`, `description` and `tools`, not the `role`, `band` and `tool_kind` the first draft assumed.
- The FAQ and most of the architecture page are original text.

So the 13 live pages are committed as templates under `.github/wiki/pages/`. The generator copies them and fills `<!-- wiki-gen:NAME -->` marker lines from the file that owns the fact. The prose survives, a wiki change becomes a reviewed PR, and "generated pages match the structure of the manually curated wiki" holds by construction. This is the issue's option A, as the entry records.

### Why templates over diff-based

| Criterion | Template-based | Diff-based |
|-----------|---------------|------------|
| Determinism | Full — same input, same output | Partial — depends on diff shape |
| Testability | Unit-testable with fixtures | Requires git history simulation |
| Maintainability | Templates to update | Mapping logic to debug |
| Alignment | Matches project's zero-dependency, custom-workflow preference | Same |

### Why not a third-party action

Per the maintainer's stated preference (issue #65 comment): "each third party GitHub Action is a supply chain dependency in the release path of a repository that ships with zero runtime dependencies. Where a piece survives triage, a small custom workflow is preferred over an external action unless the action buys something a few lines of workflow cannot."

A wiki sync is a few lines of workflow plus a Node script. No external action needed.

## Departure from the entry: the generator is not in `tools/`

The `[FEAT-043]` entry's Description and Components lines name "a generator in `tools/`". This spec places it at `.github/wiki/wiki-gen.mjs`, beside the templates it fills. The departure is deliberate:

- `tools/README.md` reserves `tools/` for release-critical instruments, the checks a release verifies its own record with. A wiki generator is not one.
- `tests/tools/repo-invariants.test.js` ("names every `tools/` instrument in the Instruments section, with their count") requires every tracked `tools/*.mjs` to be named in the README's Instruments section and counted in its lead sentence.

Measured on 2026-10-21 by moving the file to `tools/wiki-gen.mjs` on a scratch copy of the branch: `git ls-files 'tools/*.mjs'` lists five files while the README says "Four checks live in `tools/`" and names no `wiki-gen.mjs`, so both assertions of that test fail. Keeping it in `tools/` would mean editing the README to call a docs generator a release instrument. Neither location ships (`tools/` and `.github/` are both absent from `package.json` `files`), so the move buys nothing for users.

Everything else in the entry's Components line holds: `.github/workflows/wiki-sync.yml`, the `.github/wiki/pages/` templates, and drift tests. The entry's README component is not needed by this design and is left untouched.

## Design

### 1. Templates: `.github/wiki/pages/`

One file per wiki page, named as the wiki names it (`Home.md`, `_Sidebar.md`, …). A template is plain markdown plus zero or more marker lines.

### 2. Generator: `.github/wiki/wiki-gen.mjs`

A zero-dependency ES module (`node:` builtins only, no shebang).

**Generated blocks.** Three facts have a single machine-readable owner, so they are generated rather than hand-kept:

| Marker | Source | Renders |
|--------|--------|---------|
| `snap-caps` | `CAPS` and `V3_CAPS` in `scripts/snap-contract.mjs` | The SNAP field caps table |
| `skills-index` | Each `skills/*/SKILL.md` frontmatter | The skills table |
| `agent-tools` | Each `.claude/agents/*.md` frontmatter | The agent tools table |

Everything else is prose, and is kept honest by drift tests (section 5) instead of generation.

**API:**

```javascript
import { generateWiki } from './.github/wiki/wiki-gen.mjs';

// Render every page into a directory
await generateWiki({ outDir: './wiki-out', projectRoot: '.' });

// Render selected pages
await generateWiki({ outDir: './wiki-out', projectRoot: '.', pages: ['Skills'] });
```

**CLI:** `node .github/wiki/wiki-gen.mjs --out <dir>`. Exit 0 on success, 1 on a generation error, 2 on bad arguments.

**Failure is all-or-nothing.** An unknown marker, a source without frontmatter or a missing field exits 1 and leaves no output directory, so the push step can never see partial output.

### 3. Workflow: `.github/workflows/wiki-sync.yml`

Runs on push to `main` when a template, the workflow itself, or a source the generator reads changes (`.github/wiki/**`, `.github/workflows/wiki-sync.yml`, `scripts/snap-contract.mjs`, `skills/*/SKILL.md`, `.claude/agents/*.md`). It renders every page, clones the wiki repository with `GITHUB_TOKEN`, copies the pages in, and commits and pushes only when `git diff --cached --quiet` reports a change. A `concurrency` group serializes back-to-back merges. Actions used: `actions/checkout` and `actions/setup-node` only.

Every page is rendered on each run. The first draft's per-page regeneration map is dropped: the diff check already decides what is pushed, so a map would be a table to maintain that changes nothing reaching the wiki.

### 3a. Fail-open

`continue-on-error: true` on the job. The wiki is a derived mirror rebuilt in full on the next merge, so a failed sync loses nothing durable, and reddening CI over it would block or alarm on a change whose source of truth already landed in `main`. The workflow states this in a comment beside `continue-on-error`. A generator exit 1 under `continue-on-error` gives the same fail-open pipeline as the first draft's "exit 0 with a warning", shows as a warning on the run, and keeps partial output from being pushed.

### 3b. Token scope and fork guard

- Workflow-level `permissions: {}` denies every scope; the job grants back `contents: write` only, the minimum `GITHUB_TOKEN` needs to push the wiki repository.
- The job carries `if: github.repository == 'yeisonrestrepo/code-conductor'`, so forks never attempt the push.

### 4. Source of truth

The templates in the repository are the source of truth. A direct edit on the wiki is overwritten by the next sync; the workflow's header comment says so.

### 5. Drift tests

They fail the PR that adds a command, a skill or a page without naming it in the wiki:

- every shipped command is named in `Commands-Reference`;
- every skill has a heading in `Skills`;
- every page is linked from `_Sidebar` and `Home`;
- the workflow's path filter covers every source the generator reads.

## What this spec does NOT cover

- Model-based generation (no LLM calls; deterministic templates only).
- Generating prose that has no machine-readable source.
- Editing the wiki directly.
- `[FEAT-039]` README reconciliation (separate item, separate scope).
- Wiki text about unmerged items. A template describes `main`; a feature's own PR updates the template when it lands.

## Acceptance Criteria

The first five rows answer the `[FEAT-043]` entry; the last two are this spec's own checks.

| # | Criterion | Verification |
|---|-----------|-------------|
| AC-1 | Wiki pages regenerate automatically when their source files change on `main`, with no manual step | Path-filter test; a real trigger needs a merge to `main` |
| AC-2 | Generated pages match the structure of the manually curated wiki | The templates are the live pages; generation fills only marker lines |
| AC-3 | Fail-open: a sync failure never reddens CI | `continue-on-error: true` asserted |
| AC-4 | `permissions:` pinned to `contents: write` only, and a repository guard stops forks | Workflow inspection test |
| AC-5 | No third-party actions beyond `actions/checkout` and `actions/setup-node`; zero runtime dependencies | `uses:` lines asserted; `package.json` unchanged |
| AC-6 | The generator renders all 12 pages and the sidebar from fixture sources, and a failure writes nothing | Unit tests with fixture sources |
| AC-7 | The workflow does not trigger when unrelated files change | Path-filter test |

## Risks

| Risk | Mitigation |
|------|-----------|
| Wiki edits made directly on GitHub are overwritten | The workflow header comment; the templates are the source of truth |
| A template's prose goes stale while the names in it stay correct | Review of the PR that changes the behavior; nothing automatic |
| A new marker is added without a generator | `unknown block` error, and the fixture test for it |
| `GITHUB_TOKEN` lacks wiki push permission | Not verifiable before a run on GitHub; fail-open keeps CI green, and a PAT is the fallback |

## Test Plan

1. Unit: block rendering from fixtures, pipe and `$` in a description, CRLF templates, the `pages` filter.
2. Failure paths: an unknown block, a source without frontmatter, a missing field; each asserts no output directory exists afterwards.
3. Drift: the four checks in section 5.
4. CLI: exit 0, 1 and 2.
5. Workflow, by inspection: the two allowed actions, `continue-on-error`, push-to-`main` only, the path filter.
