# Wiki Auto-Sync Design Spec

**Issue:** #70
**Date:** 2026-10-07
**Status:** Candidate (unminted — ID to be assigned by maintainer)

---

## Problem Statement

The project Wiki was populated with 11 pages derived from the codebase (README, CONTRIBUTING, hooks, commands, agents, skills, SNAP contract). Without automation, this content drifts from the source within one or two releases. The same drift class that `[FEAT-039]` targets for the README applies here, but the Wiki has no instruments checking it.

826 unique cloners in 14 days versus 15 stars suggests a discoverability and comprehension gap. The Wiki is the newcomer-facing surface that closes it, but only while it stays current.

## Decision: Template-Based Generation

### Why templates over diff-based

| Criterion | Template-based | Diff-based |
|-----------|---------------|------------|
| Determinism | Full — same input, same output | Partial — depends on diff shape |
| Testability | Unit-testable with fixtures | Requires git history simulation |
| Maintainability | Templates to update | Mapping logic to debug |
| Alignment | Matches project's zero-dependency, custom-workflow preference | Same |

### Why not a third-party action

Per the maintainer's stated preference (issue #65 comment): "each third party GitHub Action is a supply chain dependency in the release path of a repository that ships with zero runtime dependencies. Where a piece survives triage, a small custom workflow is preferred over an external action unless the action buys something a few lines of workflow cannot."

A Wiki sync is a few lines of workflow plus a Node script. No external action needed.

## Design

### 1. Generator Script: `tools/wiki-gen.mjs`

A zero-dependency ES module that reads source files and produces Wiki markdown.

**Inputs** (source of truth):

| Wiki Page | Source Files |
|-----------|-------------|
| Home | Generated index (static + dynamic page list) |
| Getting-Started | `README.md` (Quickstart, Install, Dependencies sections) |
| Architecture-Overview | `README.md` (How it works section) + file tree scan |
| Guards-Reference | `.claude/hooks/pre-tool-use.mjs` JSDoc + `README.md` (Guardrails section) |
| Commands-Reference | `.claude/commands/cc-*.md` frontmatter + `README.md` (Command reference) |
| Orchestrator-Guide | `README.md` (Orchestrator walkthrough) + `.claude/commands/cc-orchestrate.md` |
| SNAP-Protocol | `scripts/snap-contract.mjs` (schema, versions, caps) |
| Band-Roles-and-Agents | `.claude/agents/*.md` (frontmatter: role, band, tool_kind) |
| Skills | `skills/*/SKILL.md` (name, description, rules) |
| Memory-Architecture | `README.md` (Memory architecture section) |
| Contributing | `CONTRIBUTING.md` (pass-through with Wiki formatting) |
| FAQ | Static + generated from common guard denial patterns |
| _Sidebar | Generated from page list |

**Output:** Markdown files in a specified output directory, one per Wiki page.

**API:**

```javascript
import { generateWiki } from './tools/wiki-gen.mjs';

// Generate all pages to a directory
await generateWiki({ outDir: './wiki-out', projectRoot: '.' });

// Generate a single page
await generateWiki({ outDir: './wiki-out', projectRoot: '.', pages: ['Guards-Reference'] });
```

### 2. Workflow: `.github/workflows/wiki-sync.yml`

```yaml
name: Wiki Sync
on:
  push:
    branches: [main]
    paths:
      - '.claude/commands/cc-*.md'
      - '.claude/hooks/pre-tool-use.mjs'
      - '.claude/agents/*.md'
      - 'skills/*/SKILL.md'
      - 'scripts/snap-contract.mjs'
      - 'README.md'
      - 'CONTRIBUTING.md'
      - 'tools/wiki-gen.mjs'

jobs:
  sync-wiki:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: node tools/wiki-gen.mjs --out wiki-out
      - run: |
          git clone https://x-access-token:${{ secrets.GITHUB_TOKEN }}@github.com/${{ github.repository }}.wiki.git wiki-repo
          cp wiki-out/*.md wiki-repo/
          cd wiki-repo
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add -A
          git diff --cached --quiet && exit 0
          git commit -m "docs: sync wiki from ${GITHUB_SHA::7}"
          git push
```

### 3. Fail-Open Behavior

The workflow must never fail the CI run:

- `continue-on-error: true` on the sync job
- The generator catches all errors internally and exits 0 with a warning
- A missing or unreachable wiki repo logs a warning, not an error

### 4. Page-Source Mapping

The generator maintains a static map of `pageName → [sourceFiles]`. When a source file changes, only the pages that depend on it are regenerated. The workflow's `paths` filter is the coarse gate; the generator's map is the fine gate.

## What this spec does NOT cover

- Model-based generation (no LLM calls — deterministic templates only)
- Wiki pages not in the initial 11-page set
- Editing the Wiki directly (the codebase is the source of truth; direct Wiki edits are overwritten on next sync)
- `[FEAT-039]` README reconciliation (separate item, separate scope)

## Acceptance Criteria

| # | Criterion | Verification |
|---|-----------|-------------|
| AC-1 | `tools/wiki-gen.mjs` generates all 11 pages + sidebar from source files | Unit test with fixture sources |
| AC-2 | Generated output matches the structure of the manually created Wiki | Diff test against current Wiki content |
| AC-3 | Workflow triggers on push to main when source files change | Manual test with a README edit |
| AC-4 | Workflow does not trigger when unrelated files change | Path filter verification |
| AC-5 | Sync failure does not fail the CI pipeline | `continue-on-error: true` verified |
| AC-6 | No third-party GitHub Actions beyond `actions/checkout` and `actions/setup-node` | Workflow file inspection |
| AC-7 | Zero new runtime dependencies | `package.json` unchanged |

## Risks

| Risk | Mitigation |
|------|-----------|
| Wiki edits made directly on GitHub are overwritten | Document that the codebase is the source of truth |
| Template drift (templates don't match source structure after refactors) | Unit tests compare generated output against expected structure |
| `GITHUB_TOKEN` lacks wiki push permission | Test in CI; fall back to a PAT if needed |

## Test Plan

1. Unit test: `tools/wiki-gen.mjs` produces expected output for fixture inputs
2. Integration test: generated pages match current Wiki page names and section headers
3. Workflow dry-run: trigger on a test branch, verify wiki-repo receives the push
