# Pre-1.44.0 hardening — design

**Status:** Draft, awaiting owner approval
**Items:** amends FEAT-045 (records guard), FEAT-047 (spec and plan locations) and FEAT-048 (OpenCode guard), all merged after `v1.43.0` and not yet released, plus `.github/CODEOWNERS`. No new id: each change lands under the item whose unreleased code it corrects.
**Origin:** the security review of the 1.44.0 release candidate (everything executable merged since `v1.43.0`) returned ESCALATE with one major and three lower findings. The release was declined until they are fixed.

## Problem

Four defects would ship in 1.44.0 if it were published as it stands.

1. **The OpenCode guard lets unmapped tools through (FEAT-048, major).** `project-template/.opencode/plugin/conductor-guard.js` routes only `bash`, `read`, `write` and `edit` to `pre-tool-use.mjs`, and lets every other tool through without a check. OpenCode also writes files through its patch tool (`patch` / `apply_patch`) and `multiedit`, and starts subagents through `task`. An agent that uses any of these skips Guards 1, 2 and 5, so a user who installed `--opencode` believes they are guarded when they are not. The FEAT-048 spec lists these tools as "not routed to the guard", but the plugin gives no sign of that at run time. A second gap follows from the same rule: a mapped tool whose arguments do not have the expected names (for example `path` instead of `filePath`, which current OpenCode documentation uses) reaches the guard with no `file_path`, and nothing checks the call.
2. **A recorded spec or plan folder can cover agent instructions (FEAT-047, minor).** `scripts/doc-locations.mjs` rejects a folder that overlaps a list of reserved folders, but the list is a deny list. It does not name `.claude/skills` (instructions the agent executes) or `.opencode` (where FEAT-048's guard lives). A recorded `- Specs: .claude/skills` makes the spec agent's Guard 5 write scope cover every skill. In a `--ticket` run, that agent reads untrusted issue text.
3. **The records guard runs the PR's own copy of itself (FEAT-045, minor).** `.github/workflows/records-guard.yml` runs `node tools/records-guard.mjs` from the PR's merge commit, so a PR can rewrite the check it is gated by.
4. **CODEOWNERS assigns no owner.** `.github/CODEOWNERS` holds the single line `@cc-reviewer-bot`, with no path pattern. GitHub reads it as a pattern with no owners, so "Require review from Code Owners" never applies. Any approval from an account with write access satisfies the branch protection.

There is also one release-flow gap. The maintainer's release PRs are opened by the repository's release App (`cc-lane-bot[bot]`) on a `release/*` branch. They exist to change owner records. `records-guard` exempts only the repository owner's login, so every release PR shows a red Records guard check.

## Solution

The OpenCode guard fails closed. Any tool that is neither mapped nor on an explicit read-only list is blocked, and so is any mapped call whose required argument is missing. The patch tool, `multiedit` and `task` are mapped. `checkDocDir` reserves everything under `.claude/` except `.claude/specs` and `.claude/plans` (Ruling 8 of FEAT-047), and adds `.opencode`. The records-guard workflow runs the base revision's copy of the checker. It also exempts a PR that is both authored by `cc-lane-bot[bot]` and on a `release/*` branch. CODEOWNERS becomes `* @cc-reviewer-bot`.

## Behavior

### Main path

**OpenCode guard** (`project-template/.opencode/plugin/conductor-guard.js`):

1. `tool.execute.before(input, output)` looks `input.tool` up in three tables, in this order:
   - **Mapped tools**, which go to the guard. Each produces one or more Claude payloads:

     | OpenCode tool | Required args | Claude payload(s) |
     |---|---|---|
     | `bash` | `command` | `Bash { command }` |
     | `read` | `filePath` | `Read { file_path, offset, limit }` |
     | `write` | `filePath` | `Write { file_path, content }` |
     | `edit` | `filePath` | `Edit { file_path, old_string, new_string }` |
     | `multiedit` | `filePath`, `edits[]` | one `Edit { file_path, old_string, new_string }` per edit |
     | `patch`, `apply_patch` | `patchText` | per file in the patch: `*** Add File: p` gives `Write { file_path: p, content }`; `*** Update File: p` and `*** Delete File: p` give `Edit { file_path: p }`; `*** Move to: q` adds `Edit { file_path: q }` |
     | `task` | `prompt` | `Agent { subagent_type, description, prompt }` |

   - **Read-only tools**, which pass without spawning the guard, the same as their Claude Code equivalents that the hook matcher does not name: `glob`, `grep`, `list`, `lsp`, `todoread`, `todowrite`, `webfetch`, `websearch`, `question`, `skill`, `invalid`.
   - **Anything else**, which is blocked. This includes MCP tools, plugin-defined tools and any tool a later OpenCode adds. The reason reads `code-conductor guard does not cover the OpenCode tool "<name>"; it is blocked until the guard maps it`.
2. A mapped call runs the guard once per payload, in order, and stops at the first `deny` or `ask`. That decision's reason blocks the whole call.
3. A mapped call is blocked if a required argument is missing or is not a string (an array for `edits`), or if a patch names no file. The reason names the tool and the missing argument.

**doc-locations** (`scripts/doc-locations.mjs`): the reserved list adds `.opencode`. A new rule rejects any folder at or under `.claude/` other than `.claude/specs`, `.claude/plans` and folders below those two. The rule is case-folded and segment-wise, like the existing reserved entries. The reason reads `sits in \`.claude\`, where only \`.claude/specs\` and \`.claude/plans\` may hold documents`.

**records-guard** (`.github/workflows/records-guard.yml`):

1. The job-level `if:` skips the job when the PR author is the repository owner (unchanged), **or** when the author is exactly `cc-lane-bot[bot]` and the head branch starts with `release/`. Author identity is what grants the exemption: only the release App can author as `cc-lane-bot[bot]`. The branch prefix only narrows it to release PRs, so the App's other PRs (none today) stay checked.
2. The check step writes the base revision's checker to the runner's temp directory and runs that copy: `git show HEAD^1:tools/records-guard.mjs > "$RUNNER_TEMP/records-guard.mjs"`, then `node "$RUNNER_TEMP/records-guard.mjs" --base HEAD^1 --head HEAD`. The checker is self-contained (`node:` builtins only) and works on the working tree through git, so a copy outside the checkout behaves the same.

**CODEOWNERS:** `* @cc-reviewer-bot`, with the existing comment line kept.

### Alternative paths

- **A patch with several files:** every file is checked. One denied file blocks the whole patch, because OpenCode applies a patch as one call.
- **`task` with an unknown `subagent_type`:** passed through as given. Guard 6 judges dispatch the same way it does for Claude's `Agent`.
- **A read-only tool used to write:** not possible. None of the listed tools writes files. `todowrite` writes OpenCode's in-memory todo list, not the working tree.
- **A PR that adds `tools/records-guard.mjs` for the first time:** `git show HEAD^1:…` fails, the step fails, and the check is red. That is the correct outcome for a PR that introduces the checker it would be judged by. No such PR remains: the file exists on `main`.
- **CODEOWNERS and the owner's own PRs:** the owner is a repository admin, and admins are not enforced by branch protection, so the owner keeps merging his own PRs as today.

### Error cases

- The guard cannot run (spawn error, timeout, non-zero exit, output that is not JSON): blocked with the guard path, as today.
- The patch text cannot be parsed (no `*** Begin Patch` / file markers): blocked as "names no file".
- `git show` cannot find the base copy: the Records guard step fails red with git's message.

## Choices this spec makes (owner decision)

1. **Fail closed for unknown OpenCode tools, including MCP tools.** A user who wires MCP servers into OpenCode with `--opencode` installed sees those tools blocked with a reason that names them. The alternative, letting unknown tools through as the Claude Code matcher does, is what made the patch tool a bypass. Claude Code's matcher can afford to be an allow-by-name list because Claude Code's own tool set is known and versioned with the hook. OpenCode's is not.
2. **Only the documented 1.x argument names are mapped.** Current OpenCode documentation shows renamed tools and arguments (`shell`, `path`, `subagent`). This slice does not map them, because no one has verified them against a running OpenCode, and the FEAT-048 spec leaves the V2 plugin API out of scope. Under the fail-closed rule, a renamed tool is blocked, and a mapped tool with renamed arguments is blocked for the missing argument, so they cannot pass silently. Mapping them is a follow-up that needs a live run.
3. **The release exemption keys on author identity, narrowed by branch.** This amends FEAT-045 Ruling 2 ("never exempts a branch name"). The branch alone exempts nothing. A collaborator who pushes a `release/x` branch is still checked.
4. **CODEOWNERS names only `@cc-reviewer-bot`**, as the owner chose in #125, now with the pattern that makes it take effect. The owner can add himself to the line. It changes nothing for his own merges (choice above, admin not enforced).

## Acceptance Criteria

- [ ] AC1 — Driving the plugin with `input.tool` set to `apply_patch` and to `patch`, with a `patchText` that adds `.claude/hooks/x.mjs`, is blocked with Guard 1's or Guard 5's reason (whichever applies to the fixture), and the same path through `write` gives the same reason.
- [ ] AC2 — `multiedit` on a path the guard denies is blocked. On an allowed path with two edits, the guard runs twice and the call passes.
- [ ] AC3 — `task` reaches the guard as `Agent`, and the hook test's Guard 6 nested-dispatch fixture gives the same verdict through the plugin as through the hook.
- [ ] AC4 — `input.tool` = `some_mcp_tool` throws the "does not cover" reason and never spawns the guard (asserted by a guard path that does not exist: no "could not run" reason appears).
- [ ] AC5 — Each read-only tool name passes without spawning the guard (same assertion technique).
- [ ] AC6 — `write` with `path` instead of `filePath` is blocked for the missing `filePath`, and so is `bash` without `command`.
- [ ] AC7 — The existing plugin tests (Guard 3 corpus, Guards 1, 2 and 4, reason parity) pass unchanged.
- [ ] AC8 — `checkDocDir` rejects `.claude/skills`, `.claude/skills/x`, `.Claude/Skills`, `.claude/settings`, `.claude/rules`, `.opencode` and `.opencode/plugin` with a non-empty reason, still accepts `.claude/specs`, `.claude/plans`, `.claude/specs/pillar-1`, `docs/specs`, and keeps every existing rejection.
- [ ] AC9 — `records-guard.yml`: the `if:` contains the owner clause unchanged and the `cc-lane-bot[bot]` + `release/` clause; the run step executes the copy written from `HEAD^1`; the workflow test that pinned the old run line pins the new one; the `head_ref` and `author_association` prohibitions still hold.
- [ ] AC10 — `.github/CODEOWNERS` has a line matching `^\* @cc-reviewer-bot\b`, and a repo-invariants test asserts that every non-comment line starts with a path pattern.
- [ ] AC11 — Full suite green on both CI legs. `.gitignore` carries this spec's leaf line, and its plan's, in sorted position (`gitignore-block-parity`).

## Out of Scope

- OpenCode V2 tool and argument names (`shell`, `path`, `subagent`) and the V2 plugin API: blocked by AC4/AC6, mapped in a follow-up after a live run.
- Guards 5, 6 and 7 attribution for OpenCode subagents (FEAT-048 known limit, unchanged).
- Splitting `publish.yml` so dev dependencies never share a job with the OIDC credential, and the `vitest` major upgrade: a separate BUG, because that code is already released.
- The fallback in `cc-resume`, `cc-orchestrate` and `cc-metrics` that runs `node scripts/<x>.mjs` from the working project when the deployed copy is missing: reported privately, fixed separately.
- Any change to `pre-tool-use.mjs`.

## System Impact

- `project-template/.opencode/plugin/conductor-guard.js`: rewritten mapping, reasons and order; same export, same hook.
- `tests/hooks/opencode-guard.test.js`: AC1–AC7.
- `scripts/doc-locations.mjs` (`RESERVED`, `reservedReason`): AC8. `tests/scripts/doc-locations.test.js` and the FEAT-047 orchestrate tests that assert rejections.
- `.github/workflows/records-guard.yml` and `tests/tools/records-guard.test.js` (`describe('the workflow')`): AC9. `CONTRIBUTING.md`'s records-guard line, if it describes the exemption.
- `.github/CODEOWNERS` and `tests/tools/repo-invariants.test.js`: AC10.
- `.gitignore` tracked-surface block: two leaf lines.
- No change to anything the installer deploys except the OpenCode plugin file, which only `--opencode` installs.

### Files Requiring Full Read (deferred to /cc-plan)

- `project-template/.opencode/plugin/conductor-guard.js` (read in full already: 66 lines).
- `tests/hooks/opencode-guard.test.js`: fixture helpers beyond the first 30 lines.
- `scripts/doc-locations.mjs`: `checkDocDir`'s remaining rules.
- `.claude/hooks/pre-tool-use.mjs`: `guard6NestedDispatch`'s use of `tool_input` for AC3.

## Pre-flight (failure points and boundaries)

- **The patch parser is the new attack surface.** It extracts paths only from line-anchored `*** Add File: `, `*** Update File: `, `*** Delete File: ` and `*** Move to: ` markers. A patch whose text names a path in any other way is "names no file" and is blocked, never passed.
- **Over-blocking.** Fail-closed blocks MCP tools and any new OpenCode tool. That cost is accepted (choice 1), and the reason text says exactly what to do.
- **Parity drift.** Claude Code's own matcher is unchanged. This spec makes OpenCode stricter than Claude Code for unknown tools, deliberately.
- **Workflow injection.** The new `if:` reads only `github.event.pull_request.user.login` and `.head.ref` inside an expression, never in a `run:` script, so a branch name cannot inject shell.

## Complexity Estimate

M — four independent changes, each small, but the plugin mapping needs new fixtures and the patch parser needs adversarial tests.
