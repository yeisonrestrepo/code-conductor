# FEAT-046 /cc-metrics implementation plan

**Issue:** #82
**Spec:** `docs/superpowers/specs/2026-10-22-feat046-cc-metrics-design.md`
**Date:** 2026-10-22
**Status:** Approved by the operator on 2026-10-22. In progress.

---

## Gate

Implementation starts only when both hold:

- the spec is approved, D1 to D8, against `[FEAT-046]`;
- the `main` test baseline is measured on the day implementation starts (T-001).

The PR that carries this plan contains the spec, the plan and two `.gitignore` leaf lines. It contains no code.

## Tasks

- [ ] [T-000] Intake. Confirm the branch `feat/feat046-cc-metrics` is rebased on `main`, and record the approval reference in the spec and plan headers.
- [ ] [T-001] Measure the baseline. Run the full suite on `main` with `GH_TOKEN=invalid-test-token`, `GH_ENTERPRISE_TOKEN=` and `GH_CONFIG_DIR=<empty temp dir>`. Record passed and skipped counts here.
- [ ] [T-002] Write the predicted red table from the spec's "Predicted test impact", by suite and count, before any run.
- [ ] [T-003] Fixtures under `tests/scripts/fixtures/session-metrics/`, synthetic only (spec, "Fixture strategy").
    - [ ] [T-003-A] `clean/`: one main transcript (two `requestId`s, one spread over three `assistant` records; a `Skill` call to `cc-implement`; a typed `<command-name>/cc-spec`; Read, Bash and Grep tool calls with matching results; one `compact_boundary`; one `turn_duration`) and `clean/sess-aaaa/subagents/agent-x1.jsonl` with `isSidechain` and `agentId`.
    - [ ] [T-003-B] `partial/`: a transcript whose last line is cut mid-JSON.
    - [ ] [T-003-C] `noisy/`: unknown record types, an `assistant` record without `usage`, a `tool_use` with no result.
    - [ ] [T-003-D] `trip/`: one file Read 5 times, one unbounded Read above 2k estimated tokens, one request above 150k context, a cache-read share below 80%.
    - [ ] [T-003-E] `BACKLOG.md` with two `## PILLAR N` headings and one `### [ ] \`[BUG-999]\`` line under each pillar's first.
- [ ] [T-004] `tests/scripts/session-metrics.test.js`, red first. See the test list.
- [ ] [T-005] `scripts/session-metrics.mjs`, functions of at most 30 lines, guard clauses, `node:` imports only.
    - [ ] [T-005-A] `resolveLogDir({ dir, env, root })` and `listLogFiles(dir)` (D3).
    - [ ] [T-005-B] `parseLine(line)` returning a record or `null`, and `readLog(file, onRecord)` over `readline` (D6).
    - [ ] [T-005-C] `createTotals()` and `addRecord(totals, record)`: `requestId` dedupe, tool pairing, command window, phase map, compaction and turn time (D4).
    - [ ] [T-005-D] `itemOf(branch)` and `pillarMap(backlogText)` (D4).
    - [ ] [T-005-E] `recommend(totals)` with the four D5 thresholds as named constants.
    - [ ] [T-005-F] `formatReport(totals, notes)` with the D7 bounds, and `main()` wrapped in one `try`/`catch` that prints `cc-metrics: failed: <message>` and exits 0.
- [ ] [T-006] `project-template/.claude/commands/cc-metrics.md`: frontmatter description, the D8 probe line, "relay stdout verbatim, do not re-read the logs". Copy it to `.claude/commands/cc-metrics.md` and compare with `git hash-object`.
- [ ] [T-007] `.gitignore`: add `!/.claude/commands/cc-metrics.md` in sorted position in the `/.claude/*` block. Stage with `git add -f`. Run `tests/unit/gitignore-block-parity.test.js`.
- [ ] [T-008] `tests/installer/commands-parity.test.js`: a `cc-metrics mirrors [FEAT-046]` block asserting byte identity and the probe line in each copy.
- [ ] [T-009] Docs: one row in `.github/wiki/pages/Commands-Reference.md` and one in README's "Project" command table. Not "Known limits", not `CHANGELOG.md`.
- [ ] [T-010] Full suite under the T-001 environment. Compare against T-002. Run the manual protocol. State the counts in the PR description.

## Test list

`tests/scripts/session-metrics.test.js`, importing the exported functions and spawning the script with `--dir` for end-to-end cases:

- [ ] `resolveLogDir` honors `--dir`, then `CLAUDE_CONFIG_DIR`, then `~/.claude`; the slug of `C:\a\b-c` is `C--a-b-c`.
- [ ] `listLogFiles` returns main and `*/subagents/*.jsonl` files, and nothing else.
- [ ] `parseLine` returns `null` for a cut line and for a blank line.
- [ ] Usage spread over three records with one `requestId` is counted once (AC6).
- [ ] Renaming `cache_read_input_tokens` in a fixture changes the total, so the field is pinned (AC4).
- [ ] Tool grouping: calls, text-only result estimate, wall seconds; a non-text block is not estimated.
- [ ] Command grouping: the `Skill` call and the typed `<command-name>` each open a window; a typed prompt closes it.
- [ ] Phase grouping: `cc-implement` → Build, `cc-spec` → Define, an unmapped command → `(none)`.
- [ ] Branch and item: `fix/bug-999-fixture` → `BUG-999`; `main` → `(none)`.
- [ ] Pillar: `BUG-999` → its pillar from the fixture backlog; no backlog → the omission note.
- [ ] Session grouping: the subagent transcript is its own row; every table sums to the total (AC6).
- [ ] Fail-open: a missing directory and an empty directory print the named note and exit 0 (AC2).
- [ ] Fail-open: `partial/` and `noisy/` exit 0, report the unparsable and `not measured` counts, and never throw (AC2).
- [ ] Recommendations: each of R1 to R4 fires on `trip/` and its line contains the fixture's number (AC5).
- [ ] Recommendations: none fires on `clean/` (AC5).
- [ ] Read-only: a source scan finds no write API; the fixture tree's names and mtimes are unchanged after a run (AC1).

`tests/installer/commands-parity.test.js`:

- [ ] The two `cc-metrics.md` copies are byte-identical.
- [ ] Each copy (`it.each`) contains the D8 probe line.

Manual protocol, not in CI:

- [ ] `/cc-metrics` in a live session of this repository: totals within 1% of the spec's M1 for the same files, runtime under 2 s, output under 45 lines.
- [ ] Run while a session is being written: the header reports at most one unparsable line and the command exits 0.
- [ ] Run from a worktree: the no-logs note appears; `--dir` with the parent slug works.
- [ ] Run on Node 20: same output as on Node 24 for the fixtures.

## Commit order

1. `test: add synthetic session-log fixtures and the metrics suite [FEAT-046]` (T-003, T-004)
2. `feat: add the session-metrics reader [FEAT-046]` (T-005)
3. `feat: add /cc-metrics with mirrored copies [FEAT-046]` (T-006 to T-008)
4. `docs: list /cc-metrics in the README and the wiki [FEAT-046]` (T-009)

One PR, one item.

## Constraints checked

From `CONTRIBUTING.md`, "What contributors must never do" and "Records are owner-side":

- No version bump, no `CHANGELOG.md` heading, no release branch or tag.
- No self-assigned id. `[FEAT-046]` is the owner's.
- `dependencies` stays `{}`; the script imports only `node:` modules.
- No installer run in this repository; no installer, hook, settings or SNAP change.
- No real transcript content in the repository: fixtures are synthetic.
- Tests run with `GH_TOKEN=invalid-test-token`, `GH_ENTERPRISE_TOKEN=` and an empty `GH_CONFIG_DIR` (BUG-059).

## Identified risks

Carried from the spec: R-1 undocumented format, R-2 permission waits in tool time, R-3 output privacy, R-4 cross-project logs.

Added by the plan:

- **Test baselines move with every merge ahead of this one.** T-001 is measured on the day implementation starts.
- **Command count pins.** If another PR adds a command first, the wiki and README rows may conflict textually; resolve by keeping both rows.
