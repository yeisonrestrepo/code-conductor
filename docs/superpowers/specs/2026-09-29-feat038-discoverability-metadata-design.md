# FEAT-038: Discoverability Metadata for npm and GitHub

**Status:** APPROVED 2026-09-29, with R1 (every `package.json` reader is grepped before any edit) and R2 (the per-term `gh` fallback in the owner checklist); `1.34.2` as a patch and the two pinning tests ratified
**Branch:** `feat/feat-038-discoverability-metadata`
**Backlog:** `[FEAT-038]`, a prerequisite line in `docs/launch/LAUNCH-CHECKLIST.md` ("Before anything is posted")

## Problem

A reader who finds the project through search instead of a launch post gets nothing from either index:

- **npm.** `package.json` has no `keywords`, so npm search has only the name and description to match.
- **npm and GitHub disagree.** The npm description reads "A spec-first, token-efficient Claude Code configuration and installer CLI." The GitHub About reads "Spec-first workflow engine for Claude Code: /cc-spec → /cc-plan → /cc-implement, with automatic stack profiles, token-efficiency rules, write-guarding hooks, and shared team memory." The README's lead, at `README.md:7`, says neither: "A governance layer for Claude Code sessions." A reader sees three descriptions of one project.
- **Topics.** GitHub carries 9 topics, measured with `gh repo view --json repositoryTopics` on 2026-09-29: `agent`, `tokens`, `agentic-development`, `claude`, `claude-ai`, `claude-code-plugin`, `claudecode`, `skills`, `spec-driven-development`. **`claude-code-plugin` is an unbacked claim.** `project.md:395` records the distribution decision: code-conductor is an installer CLI, not a Claude Code plugin. The repo has no plugin manifest, and a real plugin would need its own `/cc-spec`. That is exactly the kind of claim the launch checklist's one rule forbids.

The item has two halves, and they must stay separate because different people execute them:

- **The repo half** lands through the normal plan and ships in a release.
- **The owner half** consists of GitHub repository settings that no agent session changes.

## Solution

One sentence becomes the project's description everywhere a listing shows one. One list becomes both the npm `keywords` and the GitHub topics. Every term in the list is checked against the repo in a backing table.

- **Repo half:** writes `description` and `keywords` into `package.json` and pins them with a test. It also strips the byte-order mark that `README.md` starts with, because npm renders that README. It ships as a patch release, and `npm view` verifies it afterwards.
- **Owner half:** is a checklist of exact values to copy. The owner pastes; nothing is composed at execution time. Afterwards, the agent verifies it read-only with `gh repo view`.

## The exact values

### V1: description (npm `description` and the GitHub About line, identical)

```
A governance layer for Claude Code sessions: hooks that check an agent's commands before they run, a spec-first workflow, and project memory the next session reads.
```

164 characters (measured), one sentence, well under GitHub's 350-character About limit. Each clause is backed:

| Clause | Backed by |
|---|---|
| "A governance layer for Claude Code sessions" | `README.md:7`, verbatim lead |
| "hooks that check an agent's commands before they run" | Guard 3 (`pre-tool-use` Bash scan) denies before execution; README Quickstart scene 1 shows it. **"check", not "block" or "secure"**: README *What this is not* says it is advisory, not a security boundary |
| "a spec-first workflow" | `/cc-spec` → `/cc-plan` → `/cc-implement`; `README.md:7` "It is a spec-first workflow" |
| "project memory the next session reads" | `.claude/memory/project.md` plus the snapshot and `resume-read.mjs` at phase entry; `README.md:7` "written where the next session will read it" |

**Dropped from the current About, with reasons:**

- "workflow engine" overstates it. The project is configuration and hooks, per *Not a model*.
- "automatic stack profiles" is stale. `[FEAT-013]` retired static stack profiles in favour of on-the-fly detection, and `tests/unit/feat013-no-stack-profiles.test.js` pins the retirement. The About has been describing a mechanism the repo removed.
- "token-efficiency rules" and "shared team memory" are subsumed by the clauses above.

**README alignment:** no README text changes. The About line *is* README:7's lead sentence, extended by its own three facts.

### V2: keywords and topics (one list, used for both)

In the order npm stores them:

```
agentic-development, ai-agents, claude, claude-code, claude-code-hooks, claudecode, cli, developer-tools, guardrails, skills, spec-driven-development
```

That is 11 terms. All are lowercase with hyphens, which satisfies GitHub's topic format (lowercase letters, numbers and hyphens, 50 characters maximum, 20 topics maximum).

| Term | Backed by |
|---|---|
| `agentic-development` | The whole workflow drives an agent (already a topic) |
| `ai-agents` | Hooks and skills govern Claude Code's agent |
| `claude` | Target model family (already a topic) |
| `claude-code` | The host the whole package installs into |
| `claude-code-hooks` | `project-template/.claude/hooks/` and the global hooks the installer merges |
| `claudecode` | A spelling variant people search. It names the host and makes no claim (already a topic) |
| `cli` | `bin/code-conductor.mjs`, the package's `bin` entry |
| `developer-tools` | Its audience and purpose |
| `guardrails` | Guards 1–4. The word is used in its advisory sense, consistent with *What this is not* |
| `skills` | The `skills/` directory ships in the package's `files` (already a topic) |
| `spec-driven-development` | `/cc-spec` → `/cc-plan` (already a topic) |

**Topics removed from GitHub (4):**

| Removed | Why |
|---|---|
| `claude-code-plugin` | An unbacked claim (`project.md:395`). **Load-bearing, not cosmetic.** |
| `claude-ai` | Names the claude.ai product, which the project does not target |
| `agent` | Redundant with `ai-agents` |
| `tokens` | A bare noun that claims nothing searchable. Token efficiency lives in the description's lineage, not as a topic |

**Held back on purpose: `multi-agent`.** It appears on the backlog entry's list, but today it describes a backlog pillar (Pillar 3, `[ARCH-009]`), not shipped behavior. Under the launch rule it fails today. **It is added, to both lists, when Pillar 3 ships its first agent.** That release's spec carries the addition.

## Behavior

### Main path

1. **Repo half.** It lands on the feature branch through the plan:
   - set `package.json` `description` to V1 and add `keywords` equal to V2;
   - strip the 3-byte UTF-8 BOM (`ef bb bf`) from `README.md`;
   - add one test that pins V1 and V2, and one that pins the BOM's absence;
   - add the social-preview line to `LAUNCH-CHECKLIST.md`;
   - bump to `1.34.2`, with a CHANGELOG entry and backlog `[X]`.
2. **PR and merge.** The PR merges through the usual gate: both CI legs print `SKIP_BASELINE_OK`, `VERSION_GATE_OK`, and `RECORD_PARITY_OK`.
3. **Release.** The owner publishes the `v1.34.2` GitHub Release, which triggers `publish.yml`.
4. **Verify npm, agent, read-only.** `npm view @yeison.restrepo.r/code-conductor description keywords version` prints V1, the 11 V2 terms, and `1.34.2`.
5. **Owner checklist (below).** It runs after the merge, so the About's source of truth is already on `main`.
6. **Verify GitHub, agent, read-only.**
   - `gh repo view --json description,repositoryTopics`: the description equals V1 byte for byte, and the topic set equals V2 as a set.
   - The same `gh repo view` also reports `usesCustomOpenGraphImage: false`, unchanged, because the social preview is out of scope here.
7. **Verify rendering, owner.** The owner opens the npm package page in a browser. The README's H1 must render as a heading "code-conductor", not as literal `# code-conductor` text. An agent cannot perform this check: npmjs.com answers `curl` with 403, measured 2026-09-29.

### Owner checklist (copy, do not compose)

Run once, after the PR merges. Choose **either** the web UI **or** the single command below.

**Web UI.** Go to github.com/yeisonrestrepo/code-conductor and click the gear icon beside **About**.

- **Description:** paste V1 exactly.
- **Website:** leave empty (unchanged).
- **Topics:** remove `agent`, `claude-ai`, `claude-code-plugin`, `tokens`. Add `ai-agents`, `claude-code`, `claude-code-hooks`, `cli`, `developer-tools`, `guardrails`. Keep the other five.
- Save.

**Or, one command:**

```bash
gh repo edit yeisonrestrepo/code-conductor \
  --description "A governance layer for Claude Code sessions: hooks that check an agent's commands before they run, a spec-first workflow, and project memory the next session reads." \
  --remove-topic agent,claude-ai,claude-code-plugin,tokens \
  --add-topic ai-agents,claude-code,claude-code-hooks,cli,developer-tools,guardrails
```

If the installed `gh` rejects the comma-separated topic form, repeat `--remove-topic` and `--add-topic` once per term instead (four `--remove-topic` flags, six `--add-topic` flags, same values).

**Then:** open the npm page and check the H1 (main path step 7). Tell the session "owner half done" so the agent can run step 6.

### Alternative paths

- **Owner half before the release.** This is harmless: the two halves are independent. The About is V1 either way, and npm stays stale until the publish. Step 6 still runs after the owner reports done.
- **npm shows the old metadata right after publish.** The registry's view is eventually consistent. Re-query once after a few minutes. A mismatch after that is a failure (below), not a wait.
- **A future term addition** (for example `multi-agent`) changes `package.json`, the test, and the GitHub topics together. The test makes the `package.json` half fail loudly if it is edited alone.

### Error cases

- **`npm view` disagrees with V1/V2 after publish.** The published tarball is not the merged tree. Compare `npm view … gitHead` with the tag's SHA. Nothing is edited on npm directly, and no version is ever republished.
- **`gh repo view` topic set ≠ V2.** Report the set difference (+/−) to the owner. The agent does not run `gh repo edit` itself; it is an outward-facing owner act.
- **The npm README still renders the H1 literally with the BOM gone.** File a BUG with the page screenshot. The renderer is out of this repo's control, and nothing is guessed at.
- **`gh repo edit` rejects a topic** (format or count). This cannot happen with V2 as written: 11 ≤ 20, and every term matches `^[a-z0-9][a-z0-9-]{0,49}$`. If it does happen, report GitHub's message verbatim. A rejection of the **flag form** (the comma-separated list), rather than of a term, is handled by the owner checklist's one-flag-per-term fallback.

## Pre-flight (critical-review Phase 1)

- **Happy path:** one sentence and one list are written once, pinned by test, published, pasted, and verified read-only on both sides.
- **Failure points:**
  - The owner paraphrases instead of pasting. This is caught by the byte-for-byte check in step 6.
  - The About and `package.json` drift apart later. The drift is caught only at the next manual check, because no instrument can read GitHub settings offline. That is accepted: a CI call to the GitHub API would add a network dependency to the merge gate.
  - The BOM strip changes line 1's bytes. This was checked at spec time: the two test readers of `README.md`, `tests/unit/feat013-no-stack-profiles.test.js` and `tests/tools/repo-invariants.test.js:54`, both scan by pattern, not by offset, so the strip cannot move them.
  - A publish that silently omits the fields. This is caught by `npm view` in step 4.
- **Boundary conditions:**
  - GitHub's 20-topic cap: 11 are used.
  - The 350-character About cap: V1 is 164.
  - The em-dash risk in pasted text: V1 is pure ASCII, and the plan asserts that in the test so a curly quote cannot slip in.
  - An empty `keywords` array is impossible by test.
  - Case: all lowercase, and npm and GitHub both lowercase topics anyway.

## Acceptance Criteria

- [ ] `package.json` `description` equals V1 exactly, and `keywords` equals V2 exactly, in V2's order.
- [ ] A test in `tests/tools/repo-invariants.test.js` pins V1 and V2 and asserts V1 is ASCII-only and one sentence. It goes red against the pre-change `package.json`.
- [ ] `README.md` starts with `#` (byte `0x23`), with no BOM, pinned by a test that goes red on the pre-change file.
- [ ] `docs/launch/LAUNCH-CHECKLIST.md` "Before anything is posted" gains the line: "Social preview set, or GitHub's default card deliberately kept, decided when the GIF exists, with the card previewed once against the final About line."
- [ ] `1.34.2` released: `VERSION`, `package.json`, `package-lock.json` and a CHANGELOG entry; backlog `[FEAT-038]` `[X]` with a DONE bullet; `VERSION_GATE_OK`; `RECORD_PARITY_OK`.
- [ ] Test counts are predicted per environment before the run (two new tests, neither skips):
  - local 1035 / 12 (1047);
  - ci-node20 951 / 96 (1047);
  - ci-node24 1034 / 13 (1047).

  Both legs print `SKIP_BASELINE_OK`, and `tools/skip-baseline.json` is unchanged.
- [ ] After publish, `npm view` shows V1, the 11 V2 keywords, and `1.34.2`.
- [ ] After the owner half, `gh repo view` shows the description equal to V1 and the topic set equal to V2, with none of `agent`, `claude-ai`, `claude-code-plugin`, `tokens` present.
- [ ] The owner confirms the npm page renders the README H1 as a heading.
- [ ] The closeout memory entry records V1, V2, the four removals with reasons, and `multi-agent` held back until Pillar 3 ships its first agent.

## Out of Scope

- **The social preview image.** It moved to launch acts beside the GIF, by owner ruling on 2026-09-29. Its real question is which image represents the project when the link circulates, and that is decided against the whole launch kit. The deny-adapt-allow GIF is the obvious frame source. FEAT-038 only adds the checklist line that holds the decision's place.
- **Any post content, the GIF, and publishing `[BUG-045]` as an issue.** These are launch acts.
- `multi-agent`: deferred to Pillar 3's first shipped agent, as above.
- The GitHub **Website** field, and `homepage` and `bugs` in `package.json`. npm already derives both links from `repository`.
- `CLAUDE.md`'s Project Identity description line. It is session configuration, not a listing.
- Any agent-run `gh repo edit`. GitHub settings are owner acts.

## System Impact

- **`package.json`:** `description` changed and `keywords` added. `package-lock.json` changes only for the version bump, because keywords are not mirrored into the lock's root entry.
- **`README.md`:** 3 bytes removed at offset 0, with no textual change; neither test reader depends on offset 0 (see Pre-flight).
- **`tests/tools/repo-invariants.test.js`:** two tests added.
- **`docs/launch/LAUNCH-CHECKLIST.md`:** one line added.
- **Release surfaces:** `VERSION`, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/project.md` (spec summary now, closeout later), and `.gitignore` (the spec and plan leaf lines).
- **Not touched:** workflows, `tools/skip-baseline.json` (the skipped set is unchanged), and any runtime code.

### Files Requiring Full Read (deferred to /cc-plan)

- `tests/tools/repo-invariants.test.js`: the plan needs its structure to add the two tests in the file's own idiom.
- **R1: every test file that reads `package.json`**, found by one grep across `tests/` before any edit, not only `repo-invariants`. At least one manifest test from the FEAT-023 era guards `repository.url`. Each reader's assertions are checked against the new `description` and `keywords`. Expected result: additive fields break nothing. The grep proves that instead of assuming it, and its output is recorded in the plan text.

## Complexity Estimate

**S.** The repo half is two fields, a 3-byte strip, one checklist line and two tests. The owner half is a paste. Most of the work is in the backing table, and this spec has already done it.
