# FEAT-038: Discoverability Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the repo half of FEAT-038 as `1.34.2`: `package.json` `description` = V1 and `keywords` = V2, `README.md` without its BOM, both pinned by tests, one launch-checklist line. Then hand the owner half and the post-merge verification to closeout.

**Architecture:** There is no runtime code. There are two metadata edits, a 3-byte strip, and two tests appended to `tests/tools/repo-invariants.test.js` in its own idiom: one `it` per invariant, a comment naming the item and why, `ROOT`-relative reads. The release ritual follows `docs/RELEASE-CLOSEOUT.md` steps 1–4.

**Tech Stack:** Node ≥20, vitest 3, npm, git, gh.

**Spec:** `docs/superpowers/specs/2026-09-29-feat038-discoverability-metadata-design.md` (APPROVED 2026-09-29 with R1 and R2)

## Global Constraints

- **V1**, byte for byte, 164 characters, ASCII: `A governance layer for Claude Code sessions: hooks that check an agent's commands before they run, a spec-first workflow, and project memory the next session reads.`
- **V2**, exactly this order: `agentic-development, ai-agents, claude, claude-code, claude-code-hooks, claudecode, cli, developer-tools, guardrails, skills, spec-driven-development`.
- **Target version:** `1.34.2`, a patch. Nothing about how the tool runs changes.
- **Not touched:**
  - README text: only its first 3 bytes are removed;
  - `CLAUDE.md`;
  - workflows;
  - `tools/skip-baseline.json`, which is never hand-edited;
  - any runtime file.
- **The agent never runs `gh repo edit`.** GitHub settings are the owner's act.
- **Staging:**
  - tracked files: `git add -u <path>`;
  - a new file under `docs/`: its `.gitignore` leaf line lands first, then plain `git add <path>`;
  - never a bare `git add -u`.
- **Guard 3** denies loops, globs, heredocs and some pipelines inline. Any multi-command probe goes in a scratchpad script run with `bash`, and never becomes an allowlist entry.
- **The commit hook runs the full suite.** A red test is run, never committed: each TDD red step is a `vitest run`, and the commit comes only after green.

## Measurements taken while writing this plan (2026-09-29)

### R1: every test file that reads `package.json`, before any edit

`grep -rln "package\.json" tests/`, verbatim:

```
tests/tools/tools-not-shipped.test.js
tests/guard3-test.sh
tests/hooks/guard4.test.js
tests/scripts/init-wizard.test.js
tests/scripts/detect-stack.test.js
tests/fixtures/guard3-corpus.js
tests/installer/manifest.test.js
tests/installer/templates.test.js
```

`grep -rn "package\.json" tests/` classifies each file:

| File | Reads this repo's `package.json`? | Fields asserted | Affected by `description`/`keywords`? |
|---|---|---|---|
| `tests/installer/manifest.test.js:7` | **yes**, `JSON.parse(readFileSync(join(root, 'package.json')))` | `name`, `private`, `bin`, `files`, `repository.url` (the FEAT-023 provenance guard), `type`, `engines.node`, `publishConfig` | **no**: it asserts no `description` or `keywords`, and uses no whole-object `toEqual` |
| `tests/tools/tools-not-shipped.test.js:23` | **yes**, `JSON.parse(readFileSync(join(ROOT, 'package.json')))` | `files` only | **no** |
| `tests/guard3-test.sh:97`, `tests/fixtures/guard3-corpus.js:73,210` | no. The path is a command string in the Guard 3 corpus, and `node -e` prints `scripts`/`version` | none | no |
| `tests/hooks/guard4.test.js:50-51` | no: `node_modules/pkg/package.json`, a Guard 4 path fixture | none | no |
| `tests/scripts/init-wizard.test.js:235,260` | no: it writes a fixture `package.json` into a temp `cwd` | none | no |
| `tests/scripts/detect-stack.test.js` | no: `/proj/package.json`, mocked manifests | none | no |
| `tests/installer/templates.test.js:73` | no: a comment about npm's always-stripped names | none | no |

**Wider readers:** `grep -rnE "\.description|\.keywords|'keywords'|\"keywords\"" tests/ tools/ lib/ bin/ scripts/` finds only `scripts/detect-stack.mjs:623,632`. That code reads a **host project's** root `package.json` `description` during stack detection. It is not this repository's manifest under test, and no test fixture points it at the repo root. `tools/version-gate.mjs` reads `package.json` `version` only.

**Verdict:** the two real readers assert fields this change does not touch. The additive `keywords` and the changed `description` break nothing. This is proved by the grep, not assumed.

### BOM, before

`head -c 16 README.md | xxd`:

```
00000000: efbb bf23 2063 6f64 652d 636f 6e64 7563  ...# code-conduc
```

The expected **after** (Task 2 records the measured one beside it):

```
00000000: 2320 636f 6465 2d63 6f6e 6475 6374 6f72  # code-conductor
```

### Baseline

- The spec commit `db394be` ran the full suite through the commit hook: **1033 passed / 12 skipped (1045)**.
- `package-lock.json` carries `1.34.1` at lines 3 and 9.
- It has no `keywords` key.

## Predictions, carried at every boundary

| Boundary | local | ci-node20 | ci-node24 |
|---|---|---|---|
| Task 0 commit (plan only) | 1033 / 12 (1045) | n/a | n/a |
| Task 1 commit (+1 test) | 1034 / 12 (1046) | n/a | n/a |
| Task 2 commit (+1 test) | **1035 / 12 (1047)** | n/a | n/a |
| Task 3 commit (release) | **1035 / 12 (1047)** | n/a | n/a |
| Task 4, the PR's CI run | n/a | **951 / 96 (1047)**, `SKIP_BASELINE_OK` | **1034 / 13 (1047)**, `SKIP_BASELINE_OK` |

**Neither new test skips on any leg.** Both read only files in the checkout, and neither needs `node:sqlite` or a plugin. `tools/skip-baseline.json` is therefore unchanged. **Any other number halts the task at that boundary.**

## Review Focus

1. **A non-ASCII character arrives through an edit or a paste** (a curly `'` in "agent's", an em dash). Expected: red. Task 1's test asserts `/^[\x20-\x7e]+$/`.
2. **`npm version` reformats `package.json`, or reorders `keywords`.** Expected: Task 3's diff of `package.json` is exactly one line (`version`). Task 1 writes `keywords` multi-line in npm's own 2-space form so that npm has nothing to rewrite, and Task 3-B checks the diff.
3. **The BOM strip corrupts the file** (wrong offset, lost trailing newline, changed line endings). Expected: the file is exactly 3 bytes shorter, `git diff --numstat README.md` reads `1	1	README.md`, and the first 16 bytes match the predicted after. Task 2 checks all three.
4. **`keywords` leak into `package-lock.json`,** contrary to the spec's System Impact. Expected: `grep -c '"keywords"' package-lock.json` prints `0` after `npm version`. Checked in Task 3-B.
5. **A description that is two sentences** (a later edit adds "Zero dependencies." after V1). Expected: red. Task 1's test counts sentence terminators followed by a space or the end of the string, and requires exactly one.

---

### Task 0: Commit this plan

- [ ] [T-000-A] Insert `!/docs/superpowers/plans/2026-09-29-feat038-discoverability-metadata.md` into `.gitignore` on the line after `!/docs/superpowers/plans/2026-09-29-feat021-python-free-removal.md`, currently line 93. That is its sorted position, and `tests/unit/gitignore-block-parity.test.js` enforces it.
- [ ] [T-000-B] Stage: `git add -u .gitignore`, then `git add docs/superpowers/plans/2026-09-29-feat038-discoverability-metadata.md`. The leaf line makes the new file visible, so plain `add` stages it.
- [ ] [T-000-C] Commit: `git commit -m "docs: add the FEAT-038 discoverability metadata implementation plan [FEAT-038]"`. **Boundary:** 1033 / 12 (1045).

### Task 1: One description, one keyword list

**Files:**
- Modify: `tests/tools/repo-invariants.test.js` (append one `it` inside the `describe`, after the last `it`, before the closing `});` at line 70)
- Modify: `package.json:4` (description), plus a `keywords` block inserted after it
- Modify: `docs/launch/LAUNCH-CHECKLIST.md` (one line inserted after line 24)

**Interfaces:**
- Consumes: `ROOT` and `read(rel)`, already defined at `tests/tools/repo-invariants.test.js:15-16`.
- Produces: nothing a later task calls. Task 2 appends after this `it`.

- [ ] [T-001-A] Append this test to `tests/tools/repo-invariants.test.js`, as the last `it` inside `describe('this repository, at every commit', ...)`:

```js

  // FEAT-038: npm's description and GitHub's About line are the same sentence, and the
  // owner pastes the About from the spec, so this is the half an edit could drift alone.
  // ASCII only, because a curly apostrophe or an em dash arrives through a paste unseen.
  // The keyword list doubles as the GitHub topic list; its order is the one npm stores.
  it('describes itself with the one sentence and keyword list both listings carry', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.description).toBe(
      "A governance layer for Claude Code sessions: hooks that check an agent's commands before they run, a spec-first workflow, and project memory the next session reads."
    );
    expect(pkg.description).toMatch(/^[\x20-\x7e]+$/);
    expect(pkg.description.match(/[.!?](\s|$)/g)).toEqual(['.']);
    expect(pkg.keywords).toEqual([
      'agentic-development', 'ai-agents', 'claude', 'claude-code', 'claude-code-hooks', 'claudecode',
      'cli', 'developer-tools', 'guardrails', 'skills', 'spec-driven-development',
    ]);
  });
```

- [ ] [T-001-B] Run `npx vitest run tests/tools/repo-invariants.test.js`. Expected: **1 failed / 6 passed (7)**. The failure is the new test's `toBe` on `description`, received `"A spec-first, token-efficient Claude Code configuration and installer CLI."`. Any other failure halts the task.
- [ ] [T-001-C] In `package.json`, replace line 4, `  "description": "A spec-first, token-efficient Claude Code configuration and installer CLI.",`, with:

```json
  "description": "A governance layer for Claude Code sessions: hooks that check an agent's commands before they run, a spec-first workflow, and project memory the next session reads.",
  "keywords": [
    "agentic-development",
    "ai-agents",
    "claude",
    "claude-code",
    "claude-code-hooks",
    "claudecode",
    "cli",
    "developer-tools",
    "guardrails",
    "skills",
    "spec-driven-development"
  ],
```

- [ ] [T-001-D] In `docs/launch/LAUNCH-CHECKLIST.md`, insert this after line 24 (the GIF line), so the decision sits beside the frame it depends on. It has no trailing period, matching the file's other checklist lines:

```
- [ ] Social preview set, or GitHub's default card deliberately kept, decided when the GIF exists, with the card previewed once against the final About line
```

- [ ] [T-001-E] Run `npx vitest run tests/tools/repo-invariants.test.js tests/installer/manifest.test.js tests/tools/tools-not-shipped.test.js`. Expected: **all pass**:
  - `repo-invariants` 7 of 7;
  - `manifest` 5 of 5, unchanged, per R1;
  - `tools-not-shipped` unchanged.

  Then run `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"`. Expected: rc 0.
- [ ] [T-001-F] Stage: `git add -u tests/tools/repo-invariants.test.js package.json docs/launch/LAUNCH-CHECKLIST.md`.
- [ ] [T-001-G] Commit: `git commit -m "feat: give npm and GitHub one description and one keyword list [FEAT-038]"`. **Boundary:** 1034 / 12 (1046). Halt on any other number.

### Task 2: README without its byte-order mark

**Files:**
- Modify: `tests/tools/repo-invariants.test.js` (append one `it` after Task 1's)
- Modify: `README.md` (bytes 0–2 removed; no text change)
- Create (scratchpad, not committed): `strip-bom-038.sh`

**Interfaces:**
- Consumes: `ROOT`, `readFileSync` and `join`, all already imported at `tests/tools/repo-invariants.test.js:2-3`.
- Produces: nothing a later task calls.

- [ ] [T-002-A] **Before.** Run `head -c 16 README.md | xxd` and `wc -c < README.md`. Record both in the task report. Expected first line: `00000000: efbb bf23 2063 6f64 652d 636f 6e64 7563  ...# code-conduc`, identical to the Measurements section. A mismatch halts the task.
- [ ] [T-002-B] Append this test to `tests/tools/repo-invariants.test.js`, after Task 1's `it`:

```js

  // FEAT-038: npm renders this file on the package page, and a leading byte-order mark
  // sits ahead of the "#" its renderer needs to see first. Read as bytes, because the
  // utf8 read above keeps a BOM as U+FEFF and a text match would have to know to look.
  it('starts README.md with its heading byte, not a byte-order mark', () => {
    expect(readFileSync(join(ROOT, 'README.md'))[0]).toBe(0x23);
  });
```

- [ ] [T-002-C] Run `npx vitest run tests/tools/repo-invariants.test.js`. Expected: **1 failed / 7 passed (8)**. The failure is the new test: expected `35`, received `239` (`0xef`). The graph-rung test, which reads `README.md` by pattern, still passes.
- [ ] [T-002-D] Write the scratchpad script `strip-bom-038.sh`. It removes the BOM only when present, so a second run is a no-op:

```bash
cd /Users/yeison/Projects/code-conductor || exit 1
node -e "const fs=require('fs');const b=fs.readFileSync('README.md');if(b[0]===0xef&&b[1]===0xbb&&b[2]===0xbf){fs.writeFileSync('README.md',b.subarray(3));console.log('stripped')}else{console.log('no BOM')}"
head -c 16 README.md | xxd
wc -c < README.md
git diff --numstat README.md
```

- [ ] [T-002-E] **After.** Run `bash <scratchpad>/strip-bom-038.sh`. Record its full output in the task report. Expected:
  - `stripped`;
  - `00000000: 2320 636f 6465 2d63 6f6e 6475 6374 6f72  # code-conductor`;
  - a byte count exactly 3 less than T-002-A's;
  - `1	1	README.md`.

  Any difference halts the task.
- [ ] [T-002-F] Run `npx vitest run tests/tools/repo-invariants.test.js tests/unit/feat013-no-stack-profiles.test.js`. Expected: **all pass**, with `repo-invariants` 8 of 8. The two `README.md` pattern readers are unaffected, as the spec's pre-flight predicted.
- [ ] [T-002-G] Stage: `git add -u tests/tools/repo-invariants.test.js README.md`.
- [ ] [T-002-H] Commit: `git commit -m "fix: strip the byte-order mark ahead of the README heading npm renders [FEAT-038]"`. **Boundary:** 1035 / 12 (1047). Halt on any other number.

### Task 3: Release 1.34.2 (`docs/RELEASE-CLOSEOUT.md` step 2 through step 4)

**Files:**
- Modify: `VERSION`, `package.json` (version), `package-lock.json` (lines 3 and 9), `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md:630` plus one inserted bullet

- [ ] [T-003-A] Write `1.34.2` into `VERSION`, with a trailing newline. Then run `npm version 1.34.2 --no-git-tag-version`, which moves `package.json` and both `package-lock.json` locations.
- [ ] [T-003-B] Verify that `npm version` touched only the version:
  - `git diff --numstat package.json` reads `1	1	package.json`;
  - `git diff --numstat package-lock.json` reads `2	2	package-lock.json`;
  - `grep -c '"keywords"' package-lock.json` prints `0`.

  Any other result halts the task (Review Focus 2 and 4).
- [ ] [T-003-C] In `CHANGELOG.md`, insert this after `# Changelog` and its blank line, before `## [1.34.1] - 2026-09-29`. If the commit lands on a later date, use that date here and in T-003-E:

```markdown
## [1.34.2] - 2026-09-29

### Changed
- **[FEAT-038]** npm and GitHub describe the project in the same sentence: "A governance layer for Claude Code sessions: hooks that check an agent's commands before they run, a spec-first workflow, and project memory the next session reads." `package.json` gains `keywords`, eleven terms that double as the GitHub topics, each one backed in the spec by something the repository ships. `claude-code-plugin` is not among them, because this is an installer CLI, not a plugin. A test pins the sentence and the list, so the `package.json` half cannot drift alone.
- **[FEAT-038]** `README.md` no longer starts with a UTF-8 byte-order mark. npm renders this file on the package page, and the heading is now its first byte. The text is unchanged.

Nothing about how the tool runs changes: the package's code is identical to `1.34.1`. Only `package.json` metadata and `README.md`'s first three bytes differ.
```

- [ ] [T-003-D] Flip the heading at `AGENT-READABLE BACKLOG.md:630`. `` ### [ ] `[FEAT-038]` `` becomes `` ### [X] `[FEAT-038]` ``. This is a single-line edit.
- [ ] [T-003-E] Insert this as the first bullet under that heading, as a single-line insert:

```
* **DONE, shipped as `1.34.2` on 2026-09-29.** `package.json` `description` is the one-sentence V1 and `keywords` the 11-term V2 list, both pinned in `tests/tools/repo-invariants.test.js`; `README.md`'s BOM is stripped and pinned by the same file; `docs/launch/LAUNCH-CHECKLIST.md` holds the social-preview decision's place beside the GIF. Topics removed: `claude-code-plugin` (unbacked, installer CLI not plugin), `claude-ai`, `agent`, `tokens`; `multi-agent` held until Pillar 3 ships its first agent. The GitHub About and topics are the owner half, run after merge from the spec's checklist. Spec: `docs/superpowers/specs/2026-09-29-feat038-discoverability-metadata-design.md`. Plan: `docs/superpowers/plans/2026-09-29-feat038-discoverability-metadata.md`.
```

- [ ] [T-003-F] Run `node tools/version-gate.mjs`. Expected: five `ok` lines and `VERSION_GATE_OK 1.34.2` at rc 0. Then run `node tools/record-parity.mjs`. Expected: `RECORD_PARITY_OK` at rc 0.
- [ ] [T-003-G] Stage: `git add -u VERSION package.json package-lock.json CHANGELOG.md "AGENT-READABLE BACKLOG.md"`.
- [ ] [T-003-H] Commit: `git commit -m "chore: release 1.34.2 [FEAT-038]"`. **Boundary:** 1035 / 12 (1047), unchanged, because `repo-invariants` reads the live records and stays green.

### Task 4: Open the release PR and measure CI (`docs/RELEASE-CLOSEOUT.md` step 1)

- [ ] [T-004-A] Push: `git push -u origin feat/feat-038-discoverability-metadata`.
- [ ] [T-004-B] Write `.conductor/feat038/pr-body.md` (ignored, not committed). It carries:
  - the V1 and V2 values;
  - the R1 verdict, in one line;
  - the BOM before and after `xxd` lines;
  - the per-leg predictions;
  - the four removals;
  - the `multi-agent` hold;
  - a pointer to the spec's owner checklist, which runs after merge;
  - the attribution line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

  Then run `gh pr create --base main --title "1.34.2 - FEAT-038: discoverability metadata for npm and GitHub" --body-file .conductor/feat038/pr-body.md`.
- [ ] [T-004-C] Find the run with `gh run list --branch feat/feat-038-discoverability-metadata --workflow Test --limit 1 --json databaseId,headSha,event`. Repeat single invocations about 15 s apart, never a shell loop, until `headSha` equals `git rev-parse HEAD` and `event` is `pull_request`. Then run `gh run watch <id> --exit-status`.
- [ ] [T-004-D] Measure from a scratchpad script `ci-legs-038.sh`, which Guard 3 needs because the pipeline is inline otherwise:

```bash
cd /Users/yeison/Projects/code-conductor || exit 1
gh run view "$1" --log | grep -E "Tests +[0-9]|SKIP_BASELINE_"
git diff --stat main...HEAD -- tools/skip-baseline.json
```

  Expected:
  - `ci-node20`: `951 passed | 96 skipped (1047)` and `SKIP_BASELINE_OK`;
  - `ci-node24`: `1034 passed | 13 skipped (1047)` and `SKIP_BASELINE_OK`;
  - empty diff output for `tools/skip-baseline.json`.

  Record the run id and both legs in the task report. Any other number is reported to the owner before anything else happens.

---

## Handoff: where this plan ends

The plan ends at a green PR. Everything below is **closeout**, not plan tasks, and it runs in this order:

1. **Merge on green** (the owner). This is `RELEASE-CLOSEOUT.md` step 5.
2. **Publish the `v1.34.2` GitHub Release** (the owner). That triggers `publish.yml`.
3. **Spec step 4: verify npm** (the agent, read-only). `npm view @yeison.restrepo.r/code-conductor description keywords version` must print V1, the 11 V2 terms and `1.34.2`.
   - If a stale view appears, re-query once after a few minutes.
   - A mismatch after that is the spec's error case: compare `gitHead` with the tag's SHA, and never republish.
4. **Spec step 5: the owner checklist** (the owner). The agent hands it over verbatim from the spec:
   - the web UI **or** the `gh repo edit` command;
   - R2's per-term fallback if `gh` rejects the comma form.
5. **Spec step 6: verify GitHub** (the agent, read-only). Run `gh repo view yeisonrestrepo/code-conductor --json description,repositoryTopics,usesCustomOpenGraphImage`.
   - The description must equal V1 byte for byte.
   - The topic set must equal V2 as a set, with none of `agent`, `claude-ai`, `claude-code-plugin` or `tokens` present.
   - `usesCustomOpenGraphImage` must still be `false`.
   - Report any set difference (+/−) to the owner. The agent never edits the settings.
6. **Spec step 7: npm render check** (the owner, in a browser). The README's H1 must render as the heading "code-conductor".
7. **`RELEASE-CLOSEOUT.md` steps 6–10:**
   - sync `main`, reporting ahead/behind before acting;
   - write the closeout record in `project.md`, stating the instruments' output. It records V1, V2, the four removals with reasons, and the `multi-agent` hold until Pillar 3 ships its first agent;
   - run the ceiling before minting any id;
   - push the record commit;
   - delete the branch and prune.
