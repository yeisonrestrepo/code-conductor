# Pre-1.44.0 hardening — design

**Status:** APPROVED 2026-11-11 at rev 3 (revs 1 and 2 amended per the owner's reviews of 2026-11-11)
**Items:** amends FEAT-045 (records guard), FEAT-047 (spec and plan locations) and FEAT-048 (OpenCode guard), all merged after `v1.43.0` and not yet released, plus `.github/CODEOWNERS`. No new id: each change lands under the item whose unreleased code it corrects.
**Origin:** the security review of the 1.44.0 release candidate (everything executable merged since `v1.43.0`) returned ESCALATE with one major and three lower findings. The release was declined until they are fixed.

## Problem

Four defects would ship in 1.44.0 if it were published as it stands.

1. **The OpenCode guard lets unmapped tools through (FEAT-048, major).** `project-template/.opencode/plugin/conductor-guard.js` routes only `bash`, `read`, `write` and `edit` to `pre-tool-use.mjs` and lets every other tool through unchecked. OpenCode also writes files through its patch tool (`patch` / `apply_patch`) and `multiedit`, and starts subagents through `task`. On models where OpenCode enables the patch tool, it replaces `edit` and `write`, so **no file write reaches the guard at all** on those models. A user who installed `--opencode` believes they are guarded when they are not. The FEAT-048 spec lists these tools as "not routed to the guard", but nothing tells the user so at run time. A second gap comes from the same rule. A mapped tool whose arguments use other names (current OpenCode documentation uses `path`, not `filePath`) reaches the guard with no `file_path`, and nothing checks the call.
2. **A recorded spec or plan folder can cover agent instructions (FEAT-047, minor).** `scripts/doc-locations.mjs` rejects a folder that overlaps a reserved list, but that list is a deny list. It names neither `.claude/skills` (instructions the agent executes) nor `.opencode` (where FEAT-048's guard lives). A recorded `- Specs: .claude/skills` makes the spec agent's Guard 5 write scope cover every skill. In a `--ticket` run, that agent reads untrusted issue text.
3. **The records guard is controlled by the PR it judges (FEAT-045, minor).** On `pull_request`, GitHub takes both `.github/workflows/records-guard.yml` and `tools/records-guard.mjs` from the PR's merge commit. A PR can rewrite the checker, remove the step, or edit the job's `if:`.
4. **CODEOWNERS assigns no owner.** `.github/CODEOWNERS` holds the single line `@cc-reviewer-bot`, with no path pattern. GitHub reads it as a pattern with no owners, so "Require review from Code Owners" never applies, and any approval from an account with write access satisfies branch protection.

There is also a gap in the release flow. The maintainer's release PRs are opened by the repository's release App (`cc-lane-bot[bot]`) on a `release/*` branch, and they exist to change owner records. `records-guard` exempts only the repository owner's login, so every release PR shows a red Records guard check.

## Solution

1. **OpenCode guard.** The guard fails closed. A tool is blocked unless it is mapped or on an explicit read-only list. A mapped call is also blocked when an argument is missing or malformed, or when a patch fails a strict grammar. The patch tool and `multiedit` are mapped. `task` is blocked, because no one has verified that the plugin sees tool calls made by OpenCode subagents.
2. **Reserved folders.** `checkDocDir` reserves everything under `.claude/` except `.claude/specs` and `.claude/plans` (Ruling 8 of FEAT-047), and adds `.opencode`.
3. **Records guard.** The workflow moves to `pull_request_target`, so the workflow file and the checker both come from the base branch. It reads the PR's merge commit as data and never executes PR code. It exempts a PR authored by `cc-lane-bot[bot]` on a `release/*` branch, and a repository ruleset reserves pushes to `release/*` for that App.
4. **CODEOWNERS.** It becomes `* @cc-reviewer-bot`.

## Behavior

### Main path

**OpenCode guard** (`project-template/.opencode/plugin/conductor-guard.js`)

1. `tool.execute.before(input, output)` classifies `input.tool` in this order.
   - **Mapped tools** go to the guard. Each produces one or more Claude payloads:

     | OpenCode tool | Required args | Claude payload(s) |
     |---|---|---|
     | `bash` | `command` (string) | `Bash { command }` |
     | `read` | `filePath` (string) | `Read { file_path, offset, limit }` |
     | `write` | `filePath` (string) | `Write { file_path, content }` |
     | `edit` | `filePath` (string) | `Edit { file_path, old_string, new_string }` |
     | `multiedit` | `filePath` (string), `edits` (non-empty array; each entry has string `oldString` and `newString`) | one `Edit { file_path, old_string, new_string }` per entry |
     | `patch`, `apply_patch` | `patchText` (string, valid under the patch grammar below) | per file: `*** Add File: p` gives `Write { file_path: p, content: <added lines> }`; `*** Update File: p` gives `Edit { file_path: p, old_string: <removed lines>, new_string: <added lines> }`; `*** Delete File: p` gives `Edit { file_path: p, old_string: '', new_string: '' }`; `*** Move to: q` adds `Write { file_path: q, content: <resulting lines> }` for the target, so Guard 2 applies when `q` exists |

   - **Read-only tools** pass without spawning the guard. They match Claude Code tools that the hook matcher does not name: `glob`, `grep`, `list`, `lsp`, `todoread`, `todowrite`, `webfetch`, `websearch`, `codesearch`, `question`, `skill`, `invalid`.
   - **`task`** is blocked with the reason `code-conductor guard cannot inspect OpenCode subagents; "task" is blocked`.
   - **Anything else** is blocked with the reason `code-conductor guard does not cover the OpenCode tool "<name>"; it is blocked until the guard maps it`. That covers `batch`, MCP tools, plugin-defined tools, and any tool a later OpenCode adds or renames.
2. A mapped call runs the guard once per payload, in order. It stops at the first `deny` or `ask`, and that reason blocks the whole call. OpenCode applies a patch as one call, so one denied file blocks the whole patch.
3. A mapped call is blocked before any guard runs if:
   - a required argument is missing or has the wrong type. This includes an empty `edits` array, and an entry without string `oldString` and `newString`. The reason names the tool and the argument.
   - a patch path is absolute or resolves outside the plugin's `directory`. The reason names the path.
   - the patch text fails the grammar below.
4. **Patch grammar.** Strip a trailing `\r` from every line. Every line whose whitespace-trimmed form starts with `***` must exactly match, from column 0, one of:
   - `*** Begin Patch`
   - `*** End Patch`
   - `*** End of File`
   - `*** Add File: <p>`
   - `*** Update File: <p>`
   - `*** Delete File: <p>`
   - `*** Move to: <p>`

   Any other `***` line, including an indented one, blocks the whole patch with the reason `the patch has a \`***\` line that is not an exact marker: <line>`. A marker whose path is empty, or starts or ends with whitespace, blocks the patch the same way. A patch with no file marker is blocked as "names no file". Paths come only from these markers.
5. **Paths.** Patch paths are resolved against the plugin's `directory` and handed to the guard as that absolute path. `write` and `edit` already receive absolute `filePath` values from OpenCode. So a relative path in a patch and the same absolute path through `write` reach the guard identically and produce the same reason.

**doc-locations** (`scripts/doc-locations.mjs`)

- The reserved list adds `.opencode`.
- A new rule rejects any folder at or under `.claude/` other than `.claude/specs`, `.claude/plans` and their subfolders. The rule is case-folded and segment-wise, like the existing entries. Its reason reads `sits in \`.claude\`, where only \`.claude/specs\` and \`.claude/plans\` may hold documents`.

**records-guard** (`.github/workflows/records-guard.yml`)

1. The trigger is `pull_request_target` on `main`. GitHub runs the workflow file from the base branch, so a PR cannot change the trigger, the `if:` or the steps. `permissions: contents: read` stays, and no secret is used.
2. The job skips when:
   - the PR author is the repository owner (unchanged); or
   - the author is exactly `cc-lane-bot[bot]` and the head branch starts with `release/`.
3. `actions/checkout@v7` checks out `refs/pull/<n>/merge` with `fetch-depth: 2` and `persist-credentials: false`. The PR tree is data from here on.
4. A step fails the job unless the merge commit is current. `HEAD_SHA` is set under the step's `env:` from `github.event.pull_request.head.sha`, never interpolated inside `run:`. The step runs `[ "$(git rev-parse HEAD^2)" = "$HEAD_SHA" ]`. A stale merge ref, built before the PR's last push, makes the check red instead of judging old content.
5. The next step writes the checker from the merge commit's first parent, which is the base tip, to the runner temp directory. It runs only that copy: `git show HEAD^1:tools/records-guard.mjs > "$RUNNER_TEMP/records-guard.mjs"`, then `node "$RUNNER_TEMP/records-guard.mjs" --base HEAD^1 --head HEAD`.
   - The checker is self-contained, using `node:` builtins only. It reads both trees through git and executes nothing from them.
   - No PR file is run, sourced or installed. There is no `npm ci` and no cache.

**Repository setting (precondition, documented, not code).** A branch ruleset named **`release-branches`** targets `release/*`. It restricts creations, updates and deletions, and blocks force pushes. Its bypass list holds only the `cc-lane-bot` App. With it, every commit on a `release/*` branch comes from the App, so the author-based exemption cannot carry a collaborator's commits. `CONTRIBUTING.md` names the ruleset in its records-guard line and in the release-branch constraint (lines 68-69, reworded below).

**Rollout order.** The owner creates the `release-branches` ruleset and confirms it is active before the PR that adds the exemption merges. The plan's last task is that check, and the PR description carries it as a merge precondition.

**CODEOWNERS:** `* @cc-reviewer-bot` as the only non-comment line, with the existing comment kept.

### Alternative paths

- **`task`:** blocked (Choice 2). Mapping it would inspect nothing today. `guard6NestedDispatch` returns `null` when the payload has no `agent_type`, and the plugin cannot supply one. And the subagent's own tool calls may never reach the plugin (Pre-flight).
- **A read-only tool used to write:** not possible. None of the listed tools writes the working tree. `todowrite` writes OpenCode's todo list.
- **`batch`:** blocked as an uncovered tool. A maintainer comment on OpenCode issue #5894 reports that tools called through `batch` skip plugin hooks.
- **A collaborator who pushes a `release/x` branch:** the `release-branches` ruleset rejects the push. A PR from a branch the App did not open is checked as any other PR, since its author is not the App.
- **A merge ref that is missing or stale:** a missing ref (conflicts) fails the checkout, and a stale ref (built before the PR's last push) fails the second-parent check. Either way the check is red. A conflicting PR cannot merge anyway, and a stale one goes green once GitHub rebuilds the ref and the job reruns.
- **The owner's own PRs:** the owner is a repository admin, and branch protection has `enforce_admins` off (verified 2026-11-11). The owner can merge his own PRs without a code-owner approval. Consequence: if the bot account is unavailable, only an admin merge lands a PR.

### Error cases

- The guard cannot run (spawn error, timeout, non-zero exit, output that is not JSON): blocked with the guard path, as today.
- `git show` cannot find the base checker: the step fails red with git's message.

## Choices this spec makes (owner decision)

1. **Fail closed for unknown OpenCode tools, including MCP tools.** A user who wires MCP servers into OpenCode with `--opencode` installed sees those tools blocked, with a reason that names them. The alternative, letting unknown tools through as the Claude Code matcher does, is what made the patch tool a bypass. Claude Code's tool set is known and versioned with the hook; OpenCode's is not.
2. **`task` is blocked.** Whether `tool.execute.before` fires for tool calls inside an OpenCode subagent could not be verified (Pre-flight). A guard that cannot see a subagent's writes must not let the subagent start. OpenCode users lose subagents until a live run proves the hook sees them.
3. **Only the documented 1.x argument names are mapped.** Current OpenCode documentation shows renamed tools and arguments (`shell`, `path`, `subagent`). They are not mapped, because nothing has verified them against a running OpenCode, and the FEAT-048 spec leaves the V2 plugin API out of scope. Under the fail-closed rule, a renamed tool is blocked, and a mapped tool with renamed arguments is blocked for the missing argument. Neither passes silently.
4. **The release exemption keys on author identity, narrowed by branch and backed by the `release-branches` ruleset**, whose bypass list holds only the App (verified possible on this user-owned repository; see Pre-flight). This amends FEAT-045 Ruling 2 ("never exempts a branch name"). A branch name alone exempts nothing.
5. **`pull_request_target` for the records guard.** This amends FEAT-045 Ruling 4 ("runs on `pull_request`"); see Pre-flight.
6. **CODEOWNERS names only `@cc-reviewer-bot`.** The owner is deliberately not listed.

## Acceptance Criteria

- [ ] **AC1** — A patch (`input.tool` = `apply_patch`, and again = `patch`) adding a file that already exists in the fixture project is blocked with **Guard 2's** reason. `write` on the same absolute path gives the identical reason.
- [ ] **AC2** — `multiedit` with two entries on an allowed path runs the guard exactly twice, observed with a counting stub guard that records each payload it receives, and passes. With one entry on a path the stub denies, the call is blocked with the stub's reason.
- [ ] **AC3** — `task` is blocked with the subagent reason and never spawns the guard.
- [ ] **AC4** — `some_mcp_tool` and `batch` are blocked with the "does not cover" reason and never spawn the guard. "Never spawns" is asserted by pointing the plugin at a guard path that does not exist and checking that the "could not run" reason does not appear.
- [ ] **AC5** — Each read-only tool name, `codesearch` included, passes without spawning the guard (same technique).
- [ ] **AC6** — Each of these is blocked before the guard runs, with a reason naming the argument:
  - `write` with `path` instead of `filePath`;
  - `bash` without `command`;
  - `multiedit` with `edits: []`;
  - `multiedit` with an entry missing `newString`.
- [ ] **AC7** — The patch grammar blocks each of these:
  - a patch with one valid marker plus an indented `  *** Add File: <denied path>`;
  - a patch whose marker is `*** Add File:<p>`, with no space;
  - a patch with an unknown `*** Copy File: p`;
  - a patch with no file marker;
  - a marker with an empty path, `*** Add File: `;
  - a marker whose path has leading or trailing whitespace.

  A CRLF patch whose markers are otherwise valid is parsed like its LF form and gets the same verdict.
- [ ] **AC8** — `*** Add File: ../x`, `*** Add File: ..\x`, `*** Add File: /etc/x` and `*** Add File: C:\x` are blocked for leaving `directory` or being absolute, before any guard runs.
- [ ] **AC8b** — A patch with `*** Update File: a.js` and `*** Move to: <existing file>` is blocked with Guard 2's reason for the target.
- [ ] **AC9** — The existing plugin tests pass: the Guard 3 corpus, Guards 1, 2 and 4, and reason parity. The test "never spawns the guard for a tool it does not map" is replaced by AC4.
- [ ] **AC10** — `checkDocDir` behavior:
  - rejects with a non-empty reason: `.claude/skills`, `.claude/skills/x`, `.Claude/Skills`, `.claude/settings`, `.claude/rules`, `.opencode`, `.opencode/plugin`;
  - accepts: `.claude/specs`, `.claude/plans`, `.claude/specs/pillar-1`, `.Claude/Specs`, `.CLAUDE/plans/x`, `docs/specs`;
  - keeps every existing rejection.
- [ ] **AC11** — `records-guard.yml`, pinned by `tests/tools/records-guard.test.js`:
  - the trigger is `pull_request_target` only, on `main`;
  - permissions are `contents: read` only;
  - the checkout is `refs/pull/${{ github.event.pull_request.number }}/merge` with `fetch-depth: 2` and `persist-credentials: false`;
  - the `if:` has the owner clause unchanged and the `cc-lane-bot[bot]` + `release/` clause;
  - `HEAD_SHA` is set under `env:` from `github.event.pull_request.head.sha`, and the job fails when the merge commit's second parent is not that SHA;
  - the step runs the copy written from `HEAD^1`, and nothing runs from the PR tree: no `node tools/`, no `npm`;
  - `author_association` and `head_ref` stay absent;
  - `CONTRIBUTING.md` names the `release-branches` ruleset, and its release-branch constraint no longer says there is no `release/*` flow.
- [ ] **AC12** — `.github/CODEOWNERS` matches `^\* @cc-reviewer-bot\s*$` as its only non-comment line, asserted by a repo-invariants test.
- [ ] **AC13** — The full suite is green on both CI legs. `.gitignore` carries this spec's and its plan's leaf lines in sorted position (`gitignore-block-parity`).

## Out of Scope

- OpenCode V2 tool and argument names (`shell`, `path`, `subagent`) and the V2 plugin API. They are blocked by AC4 and AC6, and get mapped in a follow-up after a live run.
- Re-enabling `task` once a live run shows hooks firing inside subagents.
- Guards 5, 6 and 7 attribution for OpenCode subagents (FEAT-048 known limit).
- Splitting `publish.yml` so dev dependencies never share a job with the OIDC credential, and the `vitest` major upgrade. That is a separate BUG, because the code is already released.
- The fallback in `cc-resume`, `cc-orchestrate` and `cc-metrics` that runs `node scripts/<x>.mjs` from the working project. It was reported privately and is fixed separately.
- Any change to `pre-tool-use.mjs`.

## System Impact

- `project-template/.opencode/plugin/conductor-guard.js`: the classification, argument checks, patch grammar, path resolution and reasons. Same export, same hook.
- `tests/hooks/opencode-guard.test.js`: AC1 to AC9, including a counting stub guard fixture.
- `scripts/doc-locations.mjs` (`RESERVED`, `reservedReason`): AC10. Also `tests/scripts/doc-locations.test.js`, and the FEAT-047 orchestrate tests that assert rejections.
- `.github/workflows/records-guard.yml` and `tests/tools/records-guard.test.js` (`describe('the workflow')`): AC11.
- `CONTRIBUTING.md`: the records-guard line names the ruleset. Lines 68-69 ("There is no `release/*` branch flow in this repository") are reworded: contributors never create `release/*` branches; they are created only by the maintainer's release App and protected by the `release-branches` ruleset.
- `.github/CODEOWNERS` and `tests/tools/repo-invariants.test.js`: AC12.
- `README.md:408`: the OpenCode row "`apply_patch`, `multiedit`, `task` and other tools | Not sent to the guard" becomes the mapped / read-only / blocked split.
- `docs/superpowers/specs/2026-11-10-feat048-opencode-guard-design.md:76` ("Not routed to the guard"): amended in place, with a line pointing to this spec.
- `docs/superpowers/specs/2026-11-08-feat045-ci-records-guard-design.md`: Rulings 2 and 4, the sample YAML (lines 116-131) and the "Fork PR" row (line 204) are amended in place to the `pull_request_target` workflow, with a line pointing to this spec.
- `.gitignore` tracked-surface block: two leaf lines.
- Nothing the installer deploys changes except the OpenCode plugin, which only `--opencode` installs.

### Files Requiring Full Read (deferred to /cc-plan)

- `tests/hooks/opencode-guard.test.js`: the fixture helpers beyond line 30.
- `scripts/doc-locations.mjs`: the rest of `checkDocDir`'s rules.

## Pre-flight (failure points and boundaries)

- **Subagent hooks (VERIFY, result: not verifiable here).** OpenCode issue #5894 (on 1.0.182) reports that `tool.execute.before` did not block tool calls made by `task` subagents. A maintainer could not reproduce it, and a commenter attributed the bypass to `bash`. The issue page does not show a fix or a version. The FEAT-048 POC measured 1.18.33 for the primary agent only, and there is no OpenCode binary on the machine that wrote this spec. So `task` is blocked (Choice 2).
- **Records guard option chosen: A, `pull_request_target`.** Option B, a ruleset that requires the workflow, is an organization-level ruleset feature that this personal repository does not have. Option C, keeping `pull_request` and documenting the residual risk, leaves the gate editable by the PR. Under A, the gate's definition and code both come from the base branch. The known risk of `pull_request_target` is running untrusted code with a privileged token. Here the token is read-only, no secret is used, and the PR tree is only read by git. Git takes no configuration, hooks or filter drivers from a checked-out tree.
- **Ruleset bypass by an App (VERIFY, result: supported).** On this user-owned repository, the existing `release-tags` ruleset already lists the `cc-lane-bot` App (`actor_type: Integration`) in `bypass_actors`, read from the rulesets API on 2026-11-11. So `release-branches` can do the same.
- **Bootstrap.** The PR that lands this change runs no Records guard job. The base workflow has no `pull_request_target` trigger, and the PR's workflow has no `pull_request` trigger. Records guard is not a required check today, so nothing blocks the merge. If it ever becomes required, that bootstrap PR needs an admin merge.
- **Known over-block.** A context line in a patch whose trimmed form starts with `***`, such as a Markdown rule or bold-italic text, blocks the patch. This is accepted, and the reason says a `***` line that is not an exact marker was found, so the model can switch to `edit`.
- **Content visibility (VERIFY, result: no guard reads it).** No guard in `pre-tool-use.mjs` reads `content`, `old_string` or `new_string`. The only checks that read quoted content are Guard 3's, and those read the Bash command. The plugin still passes added and removed lines, so a future content guard sees patch writes the way it sees `write` and `edit`.
- **CODEOWNERS (VERIFY, result: valid).** `cc-reviewer-bot` is a GitHub **user** (machine) account, `COLLABORATOR` on the repository, whose approvals already count (PR #122). It is not an App, so it can be a code owner. `enforce_admins` is off.
- **`codesearch` (VERIFY, result: built-in, experimental).** It is listed among OpenCode's built-in tools as experimental web code search, so it goes on the read-only list.
- **The patch parser is new attack surface.** Paths come only from exact, column-0 markers. Anything that looks like a marker but is not exact blocks the whole patch. Paths are resolved and confined to `directory`.
- **Over-blocking is accepted.** Fail-closed blocks MCP tools, `task`, `batch` and any new OpenCode tool, and every reason says which tool and why.
- **Workflow injection.** The `if:` reads `user.login` and `head.ref` only inside an expression, never in a `run:` script. No `${{ }}` expression appears in `run:`. The checkout `ref` interpolates only the PR number, an integer, and the one new `${{ }}` use, the head SHA, is set under `env:`.

## Complexity Estimate

M: four independent changes, each small, but the plugin needs strict argument and patch validation with adversarial tests, and the workflow moves to a privileged trigger that needs exact pinning.
