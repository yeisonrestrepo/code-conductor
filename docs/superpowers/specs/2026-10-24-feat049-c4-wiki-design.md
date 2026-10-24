# FEAT-049: Wiki Architecture in the C4 Model, and a Stale-Fact Sweep

**Date:** 2026-10-24
**Status:** The owner approved that this spec and its plan ship inside the PR and are reviewed there. Answers the `[FEAT-049]` entry.

---

## Problem Statement

The wiki (published from `.github/wiki/pages/` by `.github/wiki/wiki-gen.mjs` and `wiki-sync.yml`, `[FEAT-043]`) describes the architecture as "three layers": global core, project template, skills. That framing names directories, not the running parts. It never shows what talks to what: the Claude Code harness invoking hook processes on stdin, the installer writing two payloads, the scripts writing state stores, CI publishing to npm and to the wiki. A newcomer cannot answer "what runs when I type a prompt?" from it.

A review of the pages against the code also found claims that are no longer true (listed under **Stale facts**). They are fixed in the same change because the C4 pages cross-link to the reference pages that hold them, and a diagram linking to a wrong table would spread the error.

## Decision: Architecture-Overview is the C4 hub, plus one C4-Components page

| Option | Verdict |
|---|---|
| Four new pages (`C4-Context`, `C4-Containers`, `C4-Components`, `C4-Code`) | Rejected. Levels 1 and 2 are each one diagram and a short table; four pages would split a newcomer's first read across four clicks, and Level 4 is deliberately small. |
| Everything on `Architecture-Overview` | Rejected. Level 3 has four component diagrams (guards, orchestrator, installer, context guard) plus a Level 4 sequence; one page would run past what a reader scrolls. |
| **`Architecture-Overview` holds Levels 1 and 2; new `C4-Components` holds Levels 3 and 4** | **Chosen.** The existing page name keeps every inbound link working (Home, sidebar, external links), the first read is one page, and the detail is one click away. |

Each C4 element names the reference page that documents it (Guards-Reference, Orchestrator-Guide, SNAP-Protocol, Band-Roles-and-Agents, Memory-Architecture, Getting-Started, Contributing), so the reference pages stay the single home of their detail.

### Diagram format

Mermaid fenced blocks. `wiki-sync.yml` copies only `*.md` and deletes every wiki page not in the templates, so image files cannot ship; GitHub wikis render Mermaid, and `wiki-gen.mjs` passes a fenced block through untouched (it rewrites only `<!-- wiki-gen:NAME -->` marker lines). Mermaid's `C4Context` syntax is marked experimental and lays out poorly at this element count, so the diagrams are `flowchart` (Levels 1 to 3) and `sequenceDiagram` (Level 4), with C4 roles shown by shape and label: people, the system, containers, and externals (dashed for retired). Each diagram is rendered locally with mermaid 10.9.1 before commit.

## Scope

**In scope:**
- `Architecture-Overview.md` rewritten as the C4 hub: Level 1 System Context, Level 2 Containers, element tables linking the reference pages, the request flow.
- New `C4-Components.md`: Level 3 for the pre-tool-use guard chain, the `/cc-orchestrate` bands, the installer phases and the context-guard counter; Level 4 as one guard-dispatch sequence.
- `Home.md` and `_Sidebar.md` link the new page; `tests/wiki/wiki-gen.test.js` adds it to `EXPECTED_PAGES` and its page-count test name.
- The stale facts below, each verified against the code before changing.
- A `[FEAT-049]` backlog entry.

**Out of scope (reported in the PR, not changed):**
- `global/CLAUDE.md:88`, `project-template/CLAUDE.md:49,75` and this repo's `CLAUDE.md` still name `ui-ux-pro-max`; left to `[FEAT-037]` as `.claude/memory/project.md` already records.
- README drift found in the review: it lists a `--no-deps` / `-NoDeps` flag (`README.md:374`) the CLI does not accept; calls context-guard "global + project" (`README.md:318`) though `global/hooks/` holds only `verbosity-remind.sh`; its hook lead sentence omits `Agent` and `SendMessage` (`README.md:290`); and its Known limits still list `[BUG-056]` to `[BUG-059]` as open. README records are owner-side per CONTRIBUTING.
- `CONTRIBUTING.md:150` describes a pre-commit test gate "installed by `code-conductor --project`"; no shipped code installs a git hook.
- `project-template/.claude/hooks/post-compact.sh:27` tells the user to run `/checkpoint`; the command is `/cc-checkpoint`.

No generated block is added, so `wiki-sync.yml`'s path filter is unchanged.

## Stale facts

| Page | Claim | Code says |
|---|---|---|
| Getting-Started | `--no-deps` flag | Not accepted; flags are `--project`, `--verbosity`, `--version`/`-v`, `--help`/`-h`; unknown arguments warn and are ignored (`bin/code-conductor.mjs`) |
| Getting-Started | 10 project commands | 11 (`project-template/.claude/commands/`) |
| Getting-Started | `~/.claude/hooks/context-guard.sh` | `global/hooks/` holds only `verbosity-remind.sh` |
| Getting-Started | `verbosity-remind.*`, `context-guard.*` | `verbosity-remind.sh` only; context-guard and post-compact ship `.sh` and `.ps1` |
| Getting-Started | `scripts/detect-stack.mjs` only | All 11 `scripts/*.mjs` copied to `.claude/scripts/`; global also gets `skills/`, `settings.json`, `memory/conductor-version.md` |
| Contributing | Node's built-in test runner | vitest (`package.json` `"test": "vitest run"`) |
| Contributing | Two instruments in `tools/`, "run in CI" | Four: `id-ceiling` (by hand), `version-gate` and `record-parity` (through `repo-invariants.test.js`), `skip-baseline` (directly in `test.yml`) (`tools/README.md`) |
| Architecture-Overview | Hook fires on Read/Write/Edit/Bash | Matcher is `Read\|Write\|Edit\|create_file\|write_file\|Bash\|Agent\|SendMessage` (`project-template/.claude/settings.json`) |
| Architecture-Overview | `agents/` holds spec, plan, code, audit, qa | Also `define-review` |
| Architecture-Overview | "three layers" | Replaced by the C4 levels |
| Guards-Reference | Fires before Read/Write/Edit/create_file/write_file/Bash | Also `Agent` and `SendMessage` (Guard 6, R7) |
| Guards-Reference | 12 patterns, numbered in prose order | `G3_CHECKS` ids P1 to P12 plus `OBF`, in a different order (P4 cat+glob, P7 pager+glob, P8 `ls -R`, P11 eval/source/dot) |
| Guards-Reference | Guard 2 on Edit implied by dispatch | `Edit` runs Guards 5 and 6 only; Guard 2 is not on Edit |
| FAQ | The installer prints nothing | A fresh install and an unchanged re-run print nothing; it prints a line per backup, the graphify-hook removal, and warnings |
| Skills | (no note) | The CLAUDE.md templates still name `ui-ux-pro-max`; said on the page |
| Orchestrator-Guide, Band-Roles | qa cannot write "because of Guard 5" | qa's tool mask has no Write/Edit, and its envelope holds `tk: X`, which Guard 5 denies as `BAND_READ_ONLY` should a write reach it |
| Orchestrator-Guide | Approval "shown with SHA-256 hash" recorded | The command shows and re-hashes the document; the run file records `{at, by}` only (`scripts/orchestrate.mjs`) |
| SNAP-Protocol | Expands SNAP as "Session Notification and Pointer" | No source defines an expansion; removed |
| SNAP-Protocol | Field names `phase`, `context`, `tool_kind`, `notes`, `decisions` | Wire names are `ph`, `c`, `s`, `role`, `tk`, `n`, `f`, `scope`, `gate`, `d`, `x`, `p`, top-level `v` and `pr` (`scripts/snap-contract.mjs`) |
| Home | "How the three layers fit together" | Points at the C4 model |

## Acceptance Criteria

- AC-1: `Architecture-Overview` carries a Level 1 System Context diagram (developer/owner, contributor, maintainer; Claude Code harness, npm registry, GitHub with Actions and Wiki, `gh` CLI, Superpowers plugin, Node runtime; graphify dashed as retired and healed) and a Level 2 Containers diagram (installer CLI, global payload, project payload, hook processes, scripts, state stores, repo-only `tools/`, CI workflows).
- AC-2: `C4-Components` carries Level 3 diagrams for the guard chain in dispatch order, the orchestrator's Define/Build/Verify bands with roles, gates, SNAP v3 handoffs and approvals, the installer phases, and the per-session context-guard counter; and one Level 4 sequence diagram of a guard dispatch.
- AC-3: Every diagram renders with mermaid 10.9.1, verified by a local render.
- AC-4: Each stale fact in the table is corrected, and every new claim traces to a file.
- AC-5: `node .github/wiki/wiki-gen.mjs --out <dir>` writes 14 files (13 pages and the sidebar); `tests/wiki/wiki-gen.test.js` expects them; `npx vitest run` shows no new failure against `origin/main`.
