# FEAT-043 Wiki auto-sync implementation plan

**Issue:** #70
**Spec:** `docs/superpowers/specs/2026-10-07-feat043-wiki-auto-sync-design.md`
**Date:** 2026-10-12, revised 2026-10-21
**Status:** DRAFT for owner approval, against the `[FEAT-043]` entry minted in `80dd54f`

---

## Where this plan departed from the first spec draft, and why

The revised spec (2026-10-21) now describes the design below; this section records why it changed. The first draft generated each page from source files. Measured against the live wiki on 2026-10-12, that cannot reproduce what is there: the wiki is 981 lines of hand-written prose, and most of it has no source to regenerate from.

- `Commands-Reference` describes 15 commands. `.claude/commands/` holds 6; the rest are in `global/commands/` and `project-template/.claude/commands/`.
- The agent files carry `name`, `description` and `tools`. The spec expected `role`, `band` and `tool_kind`.
- The FAQ and most of the architecture page are original text.

Four departures follow from that.

1. **The pages are templates in the repository.** The 13 current wiki pages live in `.github/wiki/pages/`. The generator copies them and fills `<!-- wiki-gen:NAME -->` marker lines from the source that owns the fact. The prose survives, a wiki change becomes a reviewed PR, and AC-2 holds by construction.
2. **Three blocks are generated, not thirteen pages.** `snap-caps` reads `CAPS` and `V3_CAPS` from `scripts/snap-contract.mjs`, `skills-index` reads each `skills/*/SKILL.md`, and `agent-tools` reads each `.claude/agents/*.md`. Everything else is covered by drift tests that fail the PR which adds a command, a skill or a page without naming it in the wiki.
3. **The generator lives in `.github/wiki/`, not `tools/`.** `tests/tools/repo-invariants.test.js` requires every `tools/*.mjs` to be named and counted in the README's Instruments section, and `tools/README.md` reserves that directory for release-critical instruments. A wiki generator is neither.
4. **A failed generation exits 1 and writes nothing.** The spec has the generator exit 0 with a warning. With `continue-on-error: true` on the job, exit 1 gives the same fail-open pipeline, shows as a warning on the run, and keeps the push step from ever seeing partial output.

The spec's per-page regeneration map (section 4) is dropped. Every page is rendered on each run and `git diff --cached --quiet` decides what is pushed, so the map would add a table to maintain and change nothing that reaches the wiki.

## Tasks

- [X] [T-001] Add `.github/wiki/pages/`: the 13 live wiki pages, with three marker lines.
- [X] [T-002] Add `.github/wiki/wiki-gen.mjs`: `generateWiki({ outDir, projectRoot, pages })` and a `--out` CLI. No dependencies, no shebang.
- [X] [T-003] Add `tests/wiki/wiki-gen.test.js`.
- [X] [T-004] Add `.github/workflows/wiki-sync.yml`.
- [X] [T-005] Add this plan and its `.gitignore` leaf line.
- [X] [T-006] Round-2 review: carry `[FEAT-043]` in the spec and plan names, revise the spec to the template design, drop the FEAT-042 line from `Architecture-Overview`, add the `[AC-4]` token-scope test.

## Tests

- Unit: block rendering from fixtures, pipe and `$` in a description, CRLF templates, the `pages` filter.
- Failure paths: an unknown block, a source without frontmatter, a missing field. Each asserts that no output directory exists afterwards.
- Drift: every shipped command is named in `Commands-Reference`, every skill has a heading in `Skills`, every page is linked from `_Sidebar` and `Home`.
- CLI: exit 0, 1 and 2.
- Workflow, by inspection: the two allowed actions only, `continue-on-error`, push-to-main only, a path filter that covers every source the generator reads, and `permissions: {}` with a single `contents: write` grant and the fork guard.

## Acceptance criteria

| # | State | Evidence |
|---|---|---|
Numbered as in the revised spec.

| # | State | Evidence |
|---|---|---|
| AC-1 | Partly | `[AC-1] [AC-7]` asserts the path filter; a real trigger needs a merge to `main` |
| AC-2 | Met | The templates are the live pages; a local sync changes 3 files, the ones carrying a marker |
| AC-3 | Met | `[AC-3]` asserts `continue-on-error: true` and push-to-`main` only |
| AC-4 | Met | `[AC-4]` asserts `permissions: {}`, a single `contents: write` grant and the fork guard; red when either is broken |
| AC-5 | Met | `[AC-5]` asserts the `uses:` lines; `package.json` untouched |
| AC-6 | Met | `[AC-6] writes the 12 pages and the sidebar`, plus the failure-path tests |
| AC-7 | Partly | Same as AC-1: asserted by inspection, not by a run |

## Local end-to-end run, 2026-10-12

The workflow's push step was extracted verbatim from the YAML and run with `bash -eo pipefail` against a local bare clone of the wiki, with `WIKI_REMOTE` pointing at it.

- First run: one commit, `docs: sync wiki from 0494b65`, by `github-actions[bot]`, touching `Band-Roles-and-Agents.md`, `SNAP-Protocol.md` and `Skills.md`.
- Second run: `wiki already current`, no commit.

The `SNAP-Protocol` change corrects drift the hand-written page already had: it listed `ops.n` as 10 entries of 500 characters and `mem.d` as 10 of 500, where the contract says 3 of 200 and 10 of 300.

## Not verified

- Whether `GITHUB_TOKEN` with `contents: write` may push to the wiki repository. That needs a run on GitHub.

The `Architecture-Overview` template no longer carries the live wiki's "Step 4.5: OWASP security scan" line: that step is `[FEAT-042]`, not on `main`, and a docs mirror must not depend on an unmerged feature. FEAT-042's own PR adds the line back when it lands.

## Risks

| Risk | Caught by |
|---|---|
| A template's prose goes stale while the names in it stay correct | Review of the PR that changes the behaviour; nothing automatic |
| A direct wiki edit is overwritten | The header comment in `wiki-sync.yml` |
| A new block is added to a template without a generator | `unknown block` error, and the fixture test for it |
