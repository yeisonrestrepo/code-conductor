# Pre-1.44.0 hardening — implementation plan

**Spec:** `docs/superpowers/specs/2026-11-10-pre-1-44-hardening-design.md` (APPROVED 2026-11-11, rev 3)
**Branch:** `fix/pre-1.44-hardening`
**Items:** FEAT-045, FEAT-047, FEAT-048 (unreleased code), plus `.github/CODEOWNERS`

Each task is red, then green, then commit. Tasks 1 to 4 are independent of each other; Task 5 needs all four; Task 6 runs after the merge.
**Plan rev 2** (2026-11-11): owner review applied (multi-file patch tests, post-merge smoke test, exact ruleset confirmation, stale doc lines, stricter `confine`, orphan `Move to`, `patchText` checks, merge-ref race, CRLF in the green list).

## Ordered Steps

### Task 0 — commit this plan

- [X] [T-000] Commit the plan
  - [X] [T-000-A] Modify `.gitignore`: add `!/docs/superpowers/plans/2026-11-10-pre-1-44-hardening.md` to the tracked-surface block, in sorted position among the `plans/` leaves. A new file under `/docs/*` stays ignored until its leaf line lands (BUG-042).
  - [X] [T-000-B] Run `npx vitest run tests/unit/gitignore-block-parity.test.js`: expect 4 passed.
  - [X] [T-000-C] `git add -u .gitignore` and `git add docs/superpowers/plans/2026-11-10-pre-1-44-hardening.md`. The plan file is new, and the leaf line re-includes it.
  - [X] [T-000-D] `git commit -m "docs: add the pre-1.44.0 hardening implementation plan [FEAT-045 FEAT-047 FEAT-048]"`

### Task 1 — OpenCode guard fails closed (FEAT-048; spec AC1-AC9)

- [X] [T-001] Plugin classification, argument checks, patch grammar and path confinement
  - [X] [T-001-A] Modify `tests/hooks/opencode-guard.test.js`:
    - Add a `stubProject(policy)` helper. It scaffolds a project whose `.claude/hooks/pre-tool-use.mjs` is a stub that appends each stdin payload as one JSON line to `<dir>/payloads.jsonl`, then answers `deny` with reason `STUB DENY <file_path>` when `file_path` ends with `denied.txt`, and allows otherwise.
    - Add `payloads(dir)`, which reads that file.
    - Add the AC tests:
      - AC1: `apply_patch` and `patch` adding an existing file give Guard 2's reason, identical to `write` on the same absolute path.
      - AC2: `multiedit` with two allowed entries leaves 2 payloads and passes; an entry on `denied.txt` is blocked with `STUB DENY`.
      - AC3: `task` is blocked with the subagent reason; checked against the `bare` project, so the guard is never spawned.
      - AC4: `some_mcp_tool` and `batch` get the "does not cover" reason against `bare`.
      - AC5: every read-only name passes against `bare`, `codesearch` included.
      - AC6: `write` with `path`, `bash` without `command`, `multiedit` with `edits: []`, and an entry without `newString` are each blocked with a reason naming the argument, and none spawns the stub (empty `payloads.jsonl`).
      - AC7: an indented marker, `*** Add File:x` with no space, `*** Copy File: x`, no file marker, an empty marker path and a whitespace-padded marker path are each blocked; a CRLF patch gets the same verdict as its LF form.
      - AC8: `../x`, `..\x`, `/etc/x` and `C:\x` are blocked before the stub runs.
      - AC8b: `Update File: a.js` followed by `Move to:` an existing file gives Guard 2's reason. A `Move to:` that does not follow an `Update File:` section is blocked.
      - Multi-file: a patch with two `*** Update File` markers on allowed paths passes and leaves 2 payloads; the same patch with the second file `denied.txt` is blocked with `STUB DENY`; a relative marker path reaches the stub as `join(project, <path>)` in `file_path`.
      - AC6 additions: `apply_patch` with no `patchText`, and with a non-string `patchText`, is blocked with a reason naming `patchText`.
      - AC8 additions: any path containing `\` is blocked; a marker that resolves to the project directory itself (`.`) is blocked.
    - Replace "never spawns the guard for a tool it does not map" with the AC4 and AC5 tests. Leave every other existing test unchanged (AC9).
  - [X] [T-001-B] Run `npx vitest run tests/hooks/opencode-guard.test.js`. Expected:
    - red: the new AC1, AC2, AC3, AC4 (`batch`, `some_mcp_tool`), AC6 (with the `patchText` cases), AC7 (except the CRLF case), AC8, AC8b and multi-file tests;
    - green: AC5, the AC7 CRLF case, and every existing test (the module-shape tests, the Guard 3 corpus rows, read/write/edit, hook parity, and "guard could not run");
    - AC5 and the CRLF case already pass, because today's plugin lets every unmapped tool through and so both forms get the same (empty) verdict.
  - [X] [T-001-C] Modify `project-template/.opencode/plugin/conductor-guard.js`:
    - Replace `TOOL_MAP` with three things:
      - a `MAPPED` table of builders that return `{ payloads }` or `{ block }`;
      - a `READ_ONLY` set: `glob grep list lsp todoread todowrite webfetch websearch codesearch question skill invalid`;
      - the `task` reason, plus the default "does not cover" reason.
    - Argument checks: a non-empty string `command` or `filePath`; a non-empty `edits` array whose entries have string `oldString` and `newString`.
    - `parsePatch(patchText, directory)`:
      - strip a trailing `\r` from each line;
      - every line whose trimmed form starts with `***` must match `^\*\*\* (Begin Patch|End Patch|End of File|(Add File|Update File|Delete File|Move to): (\S(?:.*\S)?))$` from column 0;
      - collect `+` lines as added content and `-` lines as removed content;
      - `Move to` becomes a `Write` on the target, and a `Move to` that does not follow an `Update File` section blocks the patch;
      - block when no file marker appears.
    - `confine(p, directory)`:
      - block any path containing `\` (no normalization);
      - block absolute paths (`/…`, `X:`);
      - `resolve(directory, p)` must start with `directory + sep`, so equality with `directory` is blocked;
      - return the absolute path.
    - Run the guard once per payload, and stop at the first non-allow decision.
    - Keep the export, the hook name, `node` from `PATH`, and the fail-closed spawn handling unchanged.
  - [X] [T-001-D] Run `npx vitest run tests/hooks/opencode-guard.test.js`: expect every test passed.
  - [X] [T-001-E] Modify `README.md:399`: replace "before each `bash`, `read`, `write` or `edit` call it sends the call…" with the split: mapped calls (`bash`, `read`, `write`, `edit`, `multiedit`, the patch tool) go to the guard, read-only tools pass, and every other tool is blocked. Then modify `README.md:408`. Replace the row "`apply_patch`, `multiedit`, `task` and other tools | Not sent to the guard" with three rows:
    - "`patch`/`apply_patch`, `multiedit` | Sent to the guard; a patch is checked file by file, confined to the project, under a strict marker grammar";
    - "`task`, `batch`, MCP and any other tool | Blocked: the guard cannot inspect them";
    - "`glob`, `grep`, `list`, `webfetch`, `websearch`, `codesearch` and other read-only tools | Allowed, as on Claude Code".
  - [X] [T-001-F] Modify `docs/superpowers/specs/2026-11-10-feat048-opencode-guard-design.md`:
    - at line 48, change "Any other tool is let through…" to point to the amendment;
    - at line 76, change the row to "Mapped or blocked, see `2026-11-10-pre-1-44-hardening-design.md`";
    - add a dated amendment line under the title.
  - [X] [T-001-F2] Modify `.github/wiki/pages/Getting-Started.md:35`: the `--opencode` row says the plugin sends OpenCode's mapped calls (`bash`, `read`, `write`, `edit`, `multiedit`, the patch tool) to the guard, lets read-only tools through, and blocks every other tool.
  - [X] [T-001-G] Run `npx vitest run tests/tools/repo-invariants.test.js`: expect every test passed (the README-shape invariants).
  - [X] [T-001-H] `git add -u project-template/.opencode/plugin/conductor-guard.js tests/hooks/opencode-guard.test.js README.md .github/wiki/pages/Getting-Started.md docs/superpowers/specs/2026-11-10-feat048-opencode-guard-design.md docs/superpowers/plans/2026-11-10-pre-1-44-hardening.md`
  - [X] [T-001-I] `git commit -m "fix: fail the OpenCode guard closed on tools it cannot inspect [FEAT-048]"`

### Task 2 — reserved folders (FEAT-047; spec AC10)

- [X] [T-002] `checkDocDir` reserves `.claude/` except specs and plans, plus `.opencode`
  - [X] [T-002-A] Modify `tests/scripts/doc-locations.test.js`. In `describe('checkDocDir reserved folders …')`, add two tests:
    - rejects: `.claude/skills`, `.claude/skills/x`, `.Claude/Skills`, `.claude/settings`, `.claude/rules`, `.opencode`, `.opencode/plugin`;
    - accepts: `.claude/specs`, `.claude/plans`, `.claude/specs/pillar-1`, `.Claude/Specs`, `.CLAUDE/plans/x`, `docs/specs`.
  - [X] [T-002-B] Run `npx vitest run tests/scripts/doc-locations.test.js`. Expected:
    - red: the new "rejects" test;
    - green: the new "accepts" test and every existing test in the file.
  - [X] [T-002-C] Modify `scripts/doc-locations.mjs`:
    - add `.opencode` to `RESERVED`;
    - in `reservedReason`, after the `RESERVED` lookup, return the spec's `.claude` reason when the folded value is at or under `.claude` and is not `.claude/specs`, `.claude/plans` or below them;
    - update the comment above `RESERVED`.
  - [X] [T-002-D] Run `npx vitest run tests/scripts/doc-locations.test.js tests/scripts/orchestrate.test.js`: expect every test passed (the orchestrate halts on `.claude/hooks` still hold).
  - [X] [T-002-E] `git add -u scripts/doc-locations.mjs tests/scripts/doc-locations.test.js docs/superpowers/plans/2026-11-10-pre-1-44-hardening.md`
  - [X] [T-002-F] `git commit -m "fix: reserve .claude except specs and plans, and .opencode, for recorded doc folders [FEAT-047]"`

### Task 3 — records guard from the base branch (FEAT-045; spec AC11)

- [X] [T-003] `pull_request_target`, base checker, current merge ref, release exemption
  - [X] [T-003-A] Modify `tests/tools/records-guard.test.js`, `describe('the workflow')`:
    - "triggers on pull_request only" becomes "triggers on pull_request_target only, on main", and still forbids `push`, `pull_request:`, `workflow_dispatch`, `schedule` and `workflow_run`.
    - The owner test also asserts:
      - the `cc-lane-bot[bot]` + `startsWith(github.event.pull_request.head.ref, 'release/')` clause;
      - the checkout `ref: refs/pull/${{ github.event.pull_request.number }}/merge`;
      - `fetch-depth: 2` and `persist-credentials: false`.
    - New test: `HEAD_SHA: ${{ github.event.pull_request.head.sha }}` sits under `env:`, `git rev-parse HEAD^2` is compared with `"$HEAD_SHA"`, and no `run:` line contains `${{`.
    - "runs the guard against the merge commit first parent" now pins:
      - `git show HEAD^1:tools/records-guard.mjs > "$RUNNER_TEMP/records-guard.mjs"`;
      - `node "$RUNNER_TEMP/records-guard.mjs" --base HEAD^1 --head HEAD`;
      - and the absence of `node tools/` and of `npm`.
    - The `author_association` / `head_ref` test is unchanged. `head.ref` is not `head_ref`.
    - New test: `CONTRIBUTING.md` names `release-branches` and no longer contains "There is no `release/*` branch flow".
  - [X] [T-003-B] Run `npx vitest run tests/tools/records-guard.test.js`. Expected:
    - red: the trigger, owner/exemption, merge-ref, run-line and CONTRIBUTING tests;
    - green: the action-majors test, the `author_association`/`head_ref` test, and every checker test outside `describe('the workflow')`.
  - [X] [T-003-C] Modify `.github/workflows/records-guard.yml`:
    - `on: pull_request_target: branches: [main]`;
    - the job `if:` becomes the owner clause `&&` the negation of the lane clause, with the comment updated to cite Rulings 2 and 4 as amended;
    - the checkout gets `ref: refs/pull/${{ github.event.pull_request.number }}/merge`, `fetch-depth: 2` and `persist-credentials: false`;
    - new step "Merge ref is current", with `env: HEAD_SHA` and `run: test "$(git rev-parse HEAD^2)" = "$HEAD_SHA"`;
    - the checker step runs the `git show` line, then the `node "$RUNNER_TEMP/…"` line;
    - `permissions: contents: read` and setup-node 20 stay unchanged.
  - [X] [T-003-D] Modify `CONTRIBUTING.md`:
    - line 68-69 constraint: "Never create release branches, tags, or GitHub Releases. `release/*` branches are created only by the maintainer's release App and are protected by the `release-branches` ruleset; releases are cut by the owner";
    - line 94: the guard skips the owner's PRs and the release App's `release/*` PRs, and runs from the base branch.
  - [X] [T-003-E] Modify `docs/superpowers/specs/2026-11-08-feat045-ci-records-guard-design.md`:
    - Ruling 2: add the author-plus-branch exemption, backed by the ruleset;
    - Ruling 4: `pull_request_target`;
    - the sample YAML (lines 116-131): the new workflow;
    - the "Fork PR" row (line 204): the merge ref is checked out explicitly and its second parent is verified;
    - add a dated amendment line pointing to the hardening spec.
  - [X] [T-003-F] Run `npx vitest run tests/tools/records-guard.test.js`: expect every test passed.
  - [X] [T-003-G] `git add -u .github/workflows/records-guard.yml tests/tools/records-guard.test.js CONTRIBUTING.md docs/superpowers/specs/2026-11-08-feat045-ci-records-guard-design.md docs/superpowers/plans/2026-11-10-pre-1-44-hardening.md`
  - [X] [T-003-H] `git commit -m "fix: run the records guard from the base branch and exempt release-App PRs [FEAT-045]"`

### Task 4 — CODEOWNERS (spec AC12)

- [X] [T-004] Path pattern, bot only
  - [X] [T-004-A] Modify `tests/tools/repo-invariants.test.js`: add "gives CODEOWNERS one path-patterned owner line" to `describe('this repository, at every commit')`. Its non-comment, non-blank lines must equal exactly `['* @cc-reviewer-bot']`, compared after trimming trailing whitespace.
  - [X] [T-004-B] Run `npx vitest run tests/tools/repo-invariants.test.js`. Expected:
    - red: the new test;
    - green: every existing invariant.
  - [X] [T-004-C] Modify `.github/CODEOWNERS`: replace the line `@cc-reviewer-bot` with `* @cc-reviewer-bot`, and keep the comment line.
  - [X] [T-004-D] Run `npx vitest run tests/tools/repo-invariants.test.js`: expect every test passed.
  - [X] [T-004-E] `git add -u .github/CODEOWNERS tests/tools/repo-invariants.test.js docs/superpowers/plans/2026-11-10-pre-1-44-hardening.md`
  - [X] [T-004-F] `git commit -m "fix: give CODEOWNERS the path pattern that makes it take effect"`

### Task 5 — verify, precondition, PR

- [ ] [T-005] Full suite, rollout precondition, pull request
  - [X] [T-005-A] Run `npx vitest run`: expect every file passed, with the same skip count as `main`.
  - [X] [T-005-B] Run `node tools/version-gate.mjs` and `node tools/record-parity.mjs`: expect `VERSION_GATE_OK 1.43.0` and `RECORD_PARITY_OK`. This PR changes no version location.
  - [X] [T-005-C] Owner action, then confirm: the owner creates the `release-branches` ruleset:
    - branch target `release/*`;
    - restrict creations, updates and deletions; block force pushes;
    - bypass list: the `cc-lane-bot` App only.

    Confirm it in two calls: `gh api repos/yeisonrestrepo/code-conductor/rulesets` to take the id of `release-branches`, then `gh api repos/yeisonrestrepo/code-conductor/rulesets/<id>`. It must show:
    - `enforcement: active`;
    - `conditions.ref_name.include` containing `refs/heads/release/*`;
    - rules `creation`, `update`, `deletion` and `non_fast_forward`;
    - exactly one entry in `bypass_actors`, of `actor_type: Integration`.

    The PR is not opened until this passes (spec rollout order: the reviewer bot merges owner PRs on approval).
  - [X] [T-005-D] `git add -u docs/superpowers/plans/2026-11-10-pre-1-44-hardening.md`
  - [ ] [T-005-E] `git commit -m "docs: close out the pre-1.44.0 hardening plan [FEAT-045 FEAT-047 FEAT-048]"`
  - [ ] [T-005-F] `git push`, then open the PR to `main`. Its description lists AC1-AC13, the ruleset precondition (confirmed), and the bootstrap note: this PR runs no Records guard job.

### Task 6 — post-merge smoke test (owner PRs skip the job)

- [ ] [T-006] The workflow's first real runs, from a non-owner account
  - [ ] [T-006-A] From the `cc-reviewer-bot` account, open a PR that changes `VERSION`. Expect Records guard **red**, naming `VERSION` and its rule. Close it unmerged and delete its branch.
  - [ ] [T-006-B] From the same account, open a PR with a harmless change (a comment in a test file). Expect Records guard **green**. Close it unmerged and delete its branch.
  - [ ] [T-006-C] On the next release-App PR (`cc-lane-bot[bot]`, `release/*`), confirm the Records guard job shows as **skipped**.
  - [ ] [T-006-D] Record the three run URLs in the release's project-memory record. No commit on this branch, which is already merged.

## Test List

- [ ] Unit: plugin classification, argument checks, patch grammar and path confinement (`tests/hooks/opencode-guard.test.js`, AC1-AC9)
- [ ] Integration: plugin to real guard parity, unchanged (Guard 2 for AC1 and AC8b, through the shipped `pre-tool-use.mjs`)
- [ ] Unit: `checkDocDir` reserved rules (`tests/scripts/doc-locations.test.js`, AC10)
- [ ] Static: the workflow pinned by `tests/tools/records-guard.test.js` (AC11)
- [ ] Static: the CODEOWNERS invariant (`tests/tools/repo-invariants.test.js`, AC12)
- [ ] Full suite on both CI legs (AC13); no UI, no E2E

## Commit Order

1. T-000 plan
2. T-001 OpenCode guard, with README and the FEAT-048 spec amendment
3. T-002 doc-locations
4. T-003 records guard, with CONTRIBUTING and the FEAT-045 spec amendment
5. T-004 CODEOWNERS
6. T-005 closeout (plan ticks), then push and PR

## Identified Risks

- **The patch grammar over-blocks real OpenCode patches.** Caught by the AC7 CRLF case and a valid multi-file fixture. The over-block of `***` context lines is accepted by the spec.
- **Path confinement on Windows CI.** `resolve` and `sep` differ there. The AC8 fixtures use `join(project, …)` for expectations, and the Windows leg runs them.
- **The stub guard must be spawned the way the plugin spawns the real one** (`node <dir>/.claude/hooks/pre-tool-use.mjs`, `CLAUDE_PROJECT_DIR`). The stub is plain Node and writes only inside its temp project.
- **The workflow cannot be exercised locally.** It is pinned statically. Its first real run is the first **non-owner** PR opened after this one merges, since the owner's PRs skip the job; T-006 makes that run happen on purpose. A failure there is red, never silently green, because of the `HEAD^2` check and the explicit checkout.
- **Merge-ref race.** Right after a push, GitHub may not have rebuilt `refs/pull/<n>/merge` yet, so "Merge ref is current" fails red against the previous head. Re-running the job clears it once the ref is rebuilt, and the next push triggers a fresh run anyway. Chosen over an in-job retry loop to keep the workflow minimal; the failure mode is a red check, never a green one.
- **`orchestrate` tests that build a `.claude/…` pair.** Grep shows only `.claude/specs`/`.claude/plans` and `.claude/hooks` are used, and both keep their verdicts.
- **The bot auto-merges an approved owner PR.** That is why T-005-C gates opening the PR on the ruleset.
