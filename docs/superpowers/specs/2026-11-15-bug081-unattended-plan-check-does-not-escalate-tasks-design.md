# BUG-081: Unattended plan check does not escalate tasks that write git hooks, MCP config, CI workflows and package lifecycle scripts

**Status:** Approved 2026-11-15 by independent review (round 1)

**Item:** `[BUG-081]` (intake of issue #231). **Date:** 2026-11-15.

## Problem

In an unattended `/cc-orchestrate` run, `delegate plan` overrides a delegated `APPROVE` with `ESCALATE` only when a plan task's `Files` entry reaches `WRITE_SURFACE` or `CONTROL_PLANE` (`surfaceTask` in `scripts/orchestrate.mjs`, FEAT-054 and BUG-080). `CONTROL_PLANE` covers the files that enforce the guards or steer later dispatches *inside* the run. It does not cover files that run code *outside* the run, after the run ends:

- `.git/hooks/**` runs on the owner's next `git commit`, `git push` or `git checkout`;
- `.mcp.json` declares project MCP servers, whose commands Claude Code starts in later sessions;
- `.github/workflows/**` runs in CI, with the repository's secrets, on the next push or PR;
- the lifecycle scripts in `package.json` (`preinstall`, `install`, `postinstall`, `prepare`, …) run on the next `npm install` / `npm ci`.

The same holds for neighbours the issue does not name: hook directories that common setups point `core.hooksPath` at (`.husky/`, `.githooks/`), the npm configuration and lockfiles (`.npmrc`, `package-lock.json`, `npm-shrinkwrap.json`), the OpenCode configuration file (`opencode.json` / `opencode.jsonc`), and the flow status line script, which the installer registers as the host's `statusLine` command (`FLOW_STATUS_COMMAND = 'node .claude/flow-status.mjs'`, `lib/installer/settings.mjs:102`), so Claude Code runs it in every later session.

A plan approved only by the delegated reviewer can therefore leave persistent execution in place, and the owner never sees that plan. The BUG-080 spec's out-of-scope list does not mention these files, so their absence was an omission, not a decision. The precondition is `--unattended`, which the owner opts into; attended runs are unaffected, because the owner approves every plan.

## Solution

Add these families (see Owner Decisions) to the existing `CONTROL_PLANE` constant in `scripts/orchestrate.mjs`, in its current notation (root-relative, lower-case, a trailing `/**` protects a whole directory). The reach test (`reachesList` / `reachesDir`), the reason text, the precedence and the run-file shape stay exactly as BUG-080 shipped them; this item only adds entries and their test rows. A task that declares one of the new paths escalates with the existing reason `task <id> declares <entry> inside the control-plane files`, and the owner's `approve plan` works as for any escalation.

### Decision per path (the entry asks for one)

| Path named by the issue | In `CONTROL_PLANE`? | Entry added | Why |
|---|---|---|---|
| `.git/hooks/**` | Yes, widened to the whole `.git/` directory | `.git/**` | Hooks are not the only way `.git/` runs code: `.git/config` sets `core.hooksPath`, `core.fsmonitor`, `core.sshCommand`, filter drivers and aliases, each of which executes a command on a later `git` call. No legitimate plan task writes inside `.git/`, so the wider entry costs no friction, and the directory form also catches a new hook file. `.gitignore`, `.gitattributes` and `.github/…` stay outside it (their first segment is not `.git`). |
| `.mcp.json` | Yes | `.mcp.json` | The project MCP configuration file Claude Code reads; each server entry is a command that runs in a later session. A fixed file, like the settings files, because Claude Code reads only that name. |
| `.github/workflows/**` | Yes, together with `.github/actions/**` | `.github/workflows/**`, `.github/actions/**` | Workflows run in CI with repository secrets. Local composite actions under `.github/actions/` are executed by those workflows with the same secrets, so leaving them out would keep the same path open one indirection away. The rest of `.github/` (`CODEOWNERS`, issue and PR templates, `wiki/`) runs nothing and stays outside. |
| `package.json` lifecycle scripts | Yes, as the whole file | `package.json` | A `Files` entry names a file, not a key inside it, so the check cannot tell a lifecycle-script edit from any other `package.json` edit; the issue already proposes the fixed file. The friction is small: in this repository the file's other contents (version, dependencies) are owner records or owner decisions anyway. Root only: nested and workspace manifests belong to `[BUG-082]`'s any-depth rule. |

Neighbours added by owner decision (not named by the issue):

| Path | Entry added | Why |
|---|---|---|
| `.husky/`, `.githooks/` | `.husky/**`, `.githooks/**` | The usual `core.hooksPath` targets; a hook script there runs on the next `git` call once the path is set, and setting it can happen outside `.git/` (for example from a `prepare` script). |
| `.npmrc` | `.npmrc` | `node-options` and `script-shell` change what runs on every npm command. |
| `package-lock.json`, `npm-shrinkwrap.json` | `package-lock.json`, `npm-shrinkwrap.json` | A `resolved` URL can point at a tarball with its own install scripts. Root only, like `package.json`. |
| OpenCode configuration | `opencode.json`, `opencode.jsonc` | Fixed files OpenCode reads at start-up; they declare plugins and MCP commands. The rest of `.opencode/` outside `.opencode/plugin/**` is left to a follow-up item. |
| Flow status line | `.claude/flow-status.mjs`, `project-template/.claude/flow-status.mjs` | The installer writes `statusLine` `node .claude/flow-status.mjs` into the host's `.claude/settings.json`, so the script runs in every later Claude Code session; the template copy is what the installer deploys. |

Mirrors: one template mirror is added, `project-template/.claude/flow-status.mjs`, because the installer deploys the status line script from there (`mergeFlowStatus` in `lib/installer/deploy.mjs`). None of the other new files exists under `project-template/` or is deployed from it, so they get no mirror. In a host project the list applies to the host's own files, which is the point: a host's `.git/`, hook directories, `.mcp.json`, workflows, npm files and OpenCode configuration run code exactly as this repository's do.

### Resulting list

`CONTROL_PLANE` keeps every BUG-080 entry in its current order and gains, at its end, one group with a one-line comment saying why (these run code outside the run):

```
'.git/**', '.husky/**', '.githooks/**', '.mcp.json', 'opencode.json', 'opencode.jsonc',
'.claude/flow-status.mjs', 'project-template/.claude/flow-status.mjs',
'.github/workflows/**', '.github/actions/**',
'package.json', 'package-lock.json', 'npm-shrinkwrap.json', '.npmrc',
```

The comment above the constant, which today describes the list as the files that enforce the guards or steer later dispatches, gains the outside-the-run family, naming BUG-081.

### Reason text (decision)

The existing reason, `… inside the control-plane files`, is kept rather than adding a third list with its own reason. The issue frames the fix as membership of `CONTROL_PLANE`; a third list would add a constant, a predicate and a branch in `surfaceTask` to change one word of a message the owner reads together with the entry it names, which already says which file triggered it.

### Owner Decisions

The list is a security-posture boundary, so its membership was put to the owner, who decided:

1. **Widening beyond the entry's wording: accepted.** `.git/**` replaces `.git/hooks/**`, and `.github/actions/**` sits beside `.github/workflows/**`.
2. **Neighbours: added in this item.** `.husky/**`, `.githooks/**`, `.npmrc`, `package-lock.json` and `npm-shrinkwrap.json` join `CONTROL_PLANE`. The earlier claim that `.husky/**` is reached only through `.git/config` is withdrawn: `core.hooksPath` can be set from outside `.git/`, and the hook files themselves live outside it.
3. **Status line: added.** `.claude/flow-status.mjs` and its template mirror `project-template/.claude/flow-status.mjs` join the list.
4. **OpenCode: fixed files added.** `opencode.json` and `opencode.jsonc` join the list; the rest of `.opencode/` outside `.opencode/plugin/**` goes to the follow-up item below.
5. **Exact list.** `CONTROL_PLANE` is every BUG-080 entry unchanged and in order, followed by exactly the entries under Resulting list, in that order. AC1 and the pin test move to that array in the same commit.
6. **Nested manifests.** `package.json` and `package-lock.json` stay root-only fixed entries; nested and workspace manifests belong to `[BUG-082]`'s any-depth rule. The near-miss rows `tools/package.json` and `src/package.json` carry a comment citing `[BUG-082]`.
7. **Follow-up item.** Config-read hook runners (`.pre-commit-config.yaml`, lefthook configuration files), editor and container auto-run (`.vscode/tasks.json`, `.devcontainer/**`), other package managers' files, other CI systems and the rest of `.opencode/` stay out of this item and go to one separate follow-up item.
8. **Separate items untouched.** A printable-ASCII rule for `Files` entries is not part of this change and gets no rows here; `[BUG-070]`, `[BUG-082]` and `[BUG-083]` are not touched.
9. **Hook unchanged.** No change to `.claude/hooks/pre-tool-use.mjs` or its template copy (AC6).
10. **Reason text.** The single `inside the control-plane files` reason stands, with no new constant or predicate; the rest of the design stands as proposed, including AC7.
11. **Approval.** The spec and the plan each need an explicit owner approval, not a delegated one; the Status line reads `Approved 2026-11-15 by the owner` only after that approval.

## Behavior

### Main path

1. The unattended run reaches the plan approval; the `define-review` agent writes `.conductor/delegate/plan.md` with `VERDICT: APPROVE`.
2. `orchestrate.mjs delegate plan <doc> <hash>` parses the report (unchanged) and, for an `APPROVE`, runs `surfaceTask` over the plan text.
3. Task 2 declares `- Modify: \`package.json\``. The entry reaches the fixed entry `package.json`.
4. The verb records `delegated.plan = { verdict: 'ESCALATE', reason: 'task Task 2 declares package.json inside the control-plane files', at, review_sha256 }`, leaves `approvals.plan` null, prints `owner approval required: delegated review plan returned ESCALATE (<reason>); see .conductor/delegate/plan.md`, and exits 0.
5. The owner's `approve plan …` then approves it as in attended mode.

### Alternative paths

- Directory, glob and case forms reach the new entries under the existing reach rule: `.git/hooks/pre-commit`, `.git/config`, `.git`, `.git/hooks`, `.github/workflows/test.yml`, `.github/workflows/new.yml`, `.github/actions/setup/action.yml`, `.github/workflows`, `.github/workflows/*.yml`, `.github/**`, `*.json` (matches `package.json`), `.GIT/hooks/pre-commit`, `.GitHub/Workflows/Test.yml`, `Package.JSON`, `.MCP.json`, `.husky`, `.hus*/x`, `.HUSKY/Pre-Commit`, `./.npmrc`, `OpenCode.JSON`, `.claude/*.mjs`, `.Claude/Flow-Status.mjs`, `./.claude/flow-status.mjs`, `./.github/workflows/ci.yml` all escalate with the control-plane reason.
- Near misses do not escalate: `.gitignore`, `.gitattributes`, `.github`, `.github/CODEOWNERS`, `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/bug.yml`, `.github/wiki/Home.md`, `.github/workflowsx/a.yml`, `docs/.git/hooks/x`, `tools/package.json`, `mcp.json`, `docs/.mcp.json`, `.huskyx/pre-commit`, `docs/.husky/pre-commit`, `docs/.npmrc`, `.npmrc.example`, `tools/package-lock.json`, `docs/opencode.json`, `.claude/flow-status.md`, `src/package.json`.
- Globs whose first segment can already be `.conductor` (`*/hooks/x`, `.*/config`, `*/workflows/x.yml`, `**/package.json`, `*/hooks/pre-commit`) keep the write-surface reason, as every U44 row does today; the write-surface check still runs first.
- A plan whose tasks touch none of the lists: approved by the delegated review as today. The existing delegated-approval fixtures declare only `src/` and `tests/` files, so none of them starts escalating.
- `RETURN`, `ESCALATE`, `UNPARSED`, `delegate spec`, `delegate build` and an owner `approve plan`: unchanged.

### Error cases

No new error codes and no new refusals. The change is data in a constant that the existing pure string-matching check reads; it cannot fail on its own.

## Acceptance Criteria

The entry's criteria are "decide whether each of these belongs in `CONTROL_PLANE` and add test rows for those that do; `package.json` would need to be listed as a fixed file". The decision is the table above; the rows are:

- [ ] AC1: `CONTROL_PLANE` equals the BUG-080 list, unchanged and in order, followed by exactly `.git/**`, `.husky/**`, `.githooks/**`, `.mcp.json`, `opencode.json`, `opencode.jsonc`, `.claude/flow-status.mjs`, `project-template/.claude/flow-status.mjs`, `.github/workflows/**`, `.github/actions/**`, `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `.npmrc`; the pin test at `tests/scripts/orchestrate.test.js:478` is updated to that exact array in the same commit, and `package.json` is a fixed entry (no glob).
- [ ] AC2: `delegate plan` over an `APPROVE` report escalates, records `verdict: 'ESCALATE'` with reason `task Task 2 declares <entry> inside the control-plane files`, leaves `approvals.plan === null`, and a following owner `approve plan` exits 0 (the U41 shape), for one row per new entry with its literal (a file inside it for each `/**` entry): `.git/hooks/pre-commit`, `.husky/pre-commit`, `.githooks/pre-commit`, `.mcp.json`, `opencode.json`, `opencode.jsonc`, `.claude/flow-status.mjs`, `project-template/.claude/flow-status.mjs`, `.github/workflows/test.yml`, `.github/actions/setup/action.yml`, `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `.npmrc`.
- [ ] AC3: the same escalation with the control-plane reason, covering for every new entry the bare directory of each `/**` entry, a glob that reaches it, an upper-case spelling and a `./`-prefixed spelling: at least `.git/config`, `.git`, `.git/hooks`, `.husky`, `.githooks`, `.hus*/x`, `.github/workflows/new.yml`, `.github/workflows`, `.github/actions`, `.github/workflows/*.yml`, `.github/**`, `*.json`, `.claude/*.mjs`, `.GIT/hooks/pre-commit`, `.HUSKY/Pre-Commit`, `.GitHub/Workflows/Test.yml`, `Package.JSON`, `.MCP.json`, `OpenCode.JSON`, `.Claude/Flow-Status.mjs`, `./.npmrc`, `./.claude/flow-status.mjs`, `./.github/workflows/ci.yml`; the plan's table gives the full set, one of each form per new entry.
- [ ] AC4: a plan whose only non-source task declares one of `.gitignore`, `.gitattributes`, `.github`, `.github/CODEOWNERS`, `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/bug.yml`, `.github/wiki/Home.md`, `.github/workflowsx/a.yml`, `docs/.git/hooks/x`, `tools/package.json`, `mcp.json`, `docs/.mcp.json`, `.huskyx/pre-commit`, `docs/.husky/pre-commit`, `docs/.npmrc`, `.npmrc.example`, `tools/package-lock.json`, `docs/opencode.json`, `.claude/flow-status.md`, `src/package.json` is approved by the delegated review (`plan approved by delegated review`, `approvals.plan.by === 'define-review'`). The `tools/package.json` and `src/package.json` rows carry a comment citing `[BUG-082]`.
- [ ] AC5: every existing U22 and U41-U45 row stays green byte for byte; `.*/config`, `*/workflows/x.yml`, `**/package.json` and `*/hooks/pre-commit` escalate with the write-surface reason.
- [ ] AC6: `WRITE_SURFACE`, the hook's `ORCH_WRITE_SURFACE` and Guard 5/6 are unchanged.
- [ ] AC7: `npm test` passes.

## Out of Scope

- **Follow-up item (owner decision):** config-read hook runners (`.pre-commit-config.yaml`, lefthook configuration files), editor and container auto-run (`.vscode/tasks.json`, `.devcontainer/**`), other package managers' files, other CI systems' files, and the rest of `.opencode/` outside `.opencode/plugin/**`. They go to one separate follow-up item, not this one.
- Nested and workspace `package.json` / `package-lock.json` files: `[BUG-082]`'s any-depth rule; here those two stay root-only fixed entries.
- A printable-ASCII rule for `Files` entries, `[BUG-070]` and `[BUG-083]`: separate items, not touched here.
- Nested `CLAUDE.md` files: `[BUG-082]`, its own item.
- The reach rule, `inSurface`, `inControlPlane`, `surfaceTask` and the reason text: unchanged.
- The hook files, Guard 5/6/7, the attended flow, `delegate spec` and `delegate build`.
- The `README.md` Known-limits entry for `[BUG-081]`, the backlog and `CHANGELOG.md`: owner records, written at release.
- Any change under `.github/workflows/` or `.github/actions/`: this item only names those paths in a constant; it writes no workflow.

## System Impact

- `scripts/orchestrate.mjs`: fourteen entries and a comment line appended to `CONTROL_PLANE`; the comment above the constant extended. No logic change. This file is itself in `CONTROL_PLANE` (a protected surface); the change follows the normal spec and plan review.
- `tests/scripts/orchestrate.test.js`: the `[BUG-080] CONTROL_PLANE declares exactly …` pin updated to the new array (renamed to cite BUG-081 too); new `it.each` blocks beside U41-U44 for AC2-AC5, reusing `atPlan`, `plan`, `task`, `delegateDoc`, `runFile`, `expectEscalation` and the U41 approve-path assertions; the `tools/package.json` and `src/package.json` rows carry a `[BUG-082]` comment.
- `.claude/commands/cc-orchestrate.md` and its `project-template/` mirror: they do not enumerate the escalating paths, so no text change.
- Unattended runs: a plan that edits `package.json`, its lockfiles, `.npmrc`, a workflow, a local action, `.mcp.json`, the OpenCode configuration file, the flow status line script, or anything under `.git/`, `.husky/` or `.githooks/` now needs the owner's approval.
- No hook (`.claude/hooks/pre-tool-use.mjs` and its template copy unchanged), installer, settings or workflow file changes; no new dependency; no new network.

### Files Requiring Full Read (deferred to /cc-plan)

- `scripts/orchestrate.mjs` around `globToRegExp`, `reachesList` and `surfaceTask` (lines 1047-1100): this phase relied on the BUG-080 spec's reach rule; the plan confirms that `*.json` matches `package.json` and `.*/config` reaches `.conductor` first, and that a glob's `*` does not match a leading `.` in a way that changes any AC3/AC4 row (`.MCP.json` is listed as a fixed spelling, not a glob, for that reason). Checked during this revision: `.hus*/x` and `.claude/*.mjs` reach only control-plane entries, and `*/workflows/x.yml`, `**/package.json`, `*/hooks/pre-commit` reach `.conductor/**` first.
- `tests/scripts/orchestrate.test.js` around the U41-U45 block (line 3580 onward) and the `CONTROL_PLANE` pin (line 478): exact helper signatures and row placement.

## Complexity Estimate

S — fourteen entries appended to one constant, one pin test updated, and table-driven rows added to an existing block; no logic changes.
