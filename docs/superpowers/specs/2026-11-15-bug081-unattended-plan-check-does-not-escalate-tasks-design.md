# BUG-081: Unattended plan check does not escalate tasks that write git hooks, MCP config, CI workflows and package lifecycle scripts

**Status:** Draft (pending independent review)

**Item:** `[BUG-081]` (intake of issue #231). **Date:** 2026-11-15.

## Problem

In an unattended `/cc-orchestrate` run, `delegate plan` overrides a delegated `APPROVE` with `ESCALATE` only when a plan task's `Files` entry reaches `WRITE_SURFACE` or `CONTROL_PLANE` (`surfaceTask` in `scripts/orchestrate.mjs`, FEAT-054 and BUG-080). `CONTROL_PLANE` covers the files that enforce the guards or steer later dispatches *inside* the run. It does not cover files that run code *outside* the run, after the run ends:

- `.git/hooks/**` runs on the owner's next `git commit`, `git push` or `git checkout`;
- `.mcp.json` declares project MCP servers, whose commands Claude Code starts in later sessions;
- `.github/workflows/**` runs in CI, with the repository's secrets, on the next push or PR;
- the lifecycle scripts in `package.json` (`preinstall`, `install`, `postinstall`, `prepare`, …) run on the next `npm install` / `npm ci`.

A plan approved only by the delegated reviewer can therefore leave persistent execution in place, and the owner never sees that plan. The BUG-080 spec's out-of-scope list does not mention these files, so their absence was an omission, not a decision. The precondition is `--unattended`, which the owner opts into; attended runs are unaffected, because the owner approves every plan.

## Solution

Add the four families to the existing `CONTROL_PLANE` constant in `scripts/orchestrate.mjs`, in its current notation (root-relative, lower-case, a trailing `/**` protects a whole directory). The reach test (`reachesList` / `reachesDir`), the reason text, the precedence and the run-file shape stay exactly as BUG-080 shipped them; this item only adds entries and their test rows. A task that declares one of the new paths escalates with the existing reason `task <id> declares <entry> inside the control-plane files`, and the owner's `approve plan` works as for any escalation.

### Decision per path (the entry asks for one)

| Path named by the issue | In `CONTROL_PLANE`? | Entry added | Why |
|---|---|---|---|
| `.git/hooks/**` | Yes, widened to the whole `.git/` directory | `.git/**` | Hooks are not the only way `.git/` runs code: `.git/config` sets `core.hooksPath`, `core.fsmonitor`, `core.sshCommand`, filter drivers and aliases, each of which executes a command on a later `git` call. No legitimate plan task writes inside `.git/`, so the wider entry costs no friction, and the directory form also catches a new hook file. `.gitignore`, `.gitattributes` and `.github/…` stay outside it (their first segment is not `.git`). |
| `.mcp.json` | Yes | `.mcp.json` | The project MCP configuration file Claude Code reads; each server entry is a command that runs in a later session. A fixed file, like the settings files, because Claude Code reads only that name. |
| `.github/workflows/**` | Yes, together with `.github/actions/**` | `.github/workflows/**`, `.github/actions/**` | Workflows run in CI with repository secrets. Local composite actions under `.github/actions/` are executed by those workflows with the same secrets, so leaving them out would keep the same path open one indirection away. The rest of `.github/` (`CODEOWNERS`, issue and PR templates, `wiki/`) runs nothing and stays outside. |
| `package.json` lifecycle scripts | Yes, as the whole file | `package.json` | A `Files` entry names a file, not a key inside it, so the check cannot tell a lifecycle-script edit from any other `package.json` edit; the issue already proposes the fixed file. The friction is small: in this repository the file's other contents (version, dependencies) are owner records or owner decisions anyway. |

Mirrors: none of these files exists under `project-template/`, and the installer does not deploy any of them from there, so no `project-template/` mirror is added (unlike the BUG-080 families, whose template copies are what the installer ships). In a host project the list applies to the host's own files, which is the point: a host's `.git/`, `.mcp.json`, workflows and `package.json` run code exactly as this repository's do.

### Resulting list

`CONTROL_PLANE` keeps every BUG-080 entry in its current order and gains, at its end, one group with a one-line comment saying why (these run code outside the run):

```
'.git/**', '.mcp.json', '.github/workflows/**', '.github/actions/**', 'package.json',
```

The comment above the constant, which today describes the list as the files that enforce the guards or steer later dispatches, gains the outside-the-run family, naming BUG-081.

### Reason text (decision)

The existing reason, `… inside the control-plane files`, is kept rather than adding a third list with its own reason. The issue frames the fix as membership of `CONTROL_PLANE`; a third list would add a constant, a predicate and a branch in `surfaceTask` to change one word of a message the owner reads together with the entry it names, which already says which file triggered it.

### Open Owner Questions

The list is a security-posture boundary, which the owner set for BUG-080. This spec resolves the four paths the entry names as above, and asks the owner to confirm two points before the plan:

1. **Widening beyond the entry's wording.** `.git/**` instead of `.git/hooks/**`, and `.github/actions/**` added to `.github/workflows/**`. Recommendation: accept both, for the reasons in the table. The alternative is the literal `.git/hooks/**` and `.github/workflows/**` only.
2. **Neighbours not named by the issue** (`.husky/**`, `.npmrc`, `package-lock.json`). Recommendation: leave them out of this item, as listed under Out of Scope, and open a follow-up if wanted; adding them here would grow the item past what its entry asks.

## Behavior

### Main path

1. The unattended run reaches the plan approval; the `define-review` agent writes `.conductor/delegate/plan.md` with `VERDICT: APPROVE`.
2. `orchestrate.mjs delegate plan <doc> <hash>` parses the report (unchanged) and, for an `APPROVE`, runs `surfaceTask` over the plan text.
3. Task 2 declares `- Modify: \`package.json\``. The entry reaches the fixed entry `package.json`.
4. The verb records `delegated.plan = { verdict: 'ESCALATE', reason: 'task Task 2 declares package.json inside the control-plane files', at, review_sha256 }`, leaves `approvals.plan` null, prints `owner approval required: delegated review plan returned ESCALATE (<reason>); see .conductor/delegate/plan.md`, and exits 0.
5. The owner's `approve plan …` then approves it as in attended mode.

### Alternative paths

- Directory, glob and case forms reach the new entries under the existing reach rule: `.git/hooks/pre-commit`, `.git/config`, `.git`, `.git/hooks`, `.github/workflows/test.yml`, `.github/workflows/new.yml`, `.github/actions/setup/action.yml`, `.github/workflows`, `.github/workflows/*.yml`, `.github/**`, `*.json` (matches `package.json`), `.GIT/hooks/pre-commit`, `.GitHub/Workflows/Test.yml`, `Package.JSON`, `.MCP.json` all escalate with the control-plane reason.
- Near misses do not escalate: `.gitignore`, `.gitattributes`, `.github`, `.github/CODEOWNERS`, `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/bug.yml`, `.github/wiki/Home.md`, `.github/workflowsx/a.yml`, `docs/.git/hooks/x`, `tools/package.json`, `package-lock.json`, `mcp.json`, `docs/.mcp.json`.
- Globs whose first segment can already be `.conductor` (`*/hooks/x`, `.*/config`) keep the write-surface reason, as every U44 row does today; the write-surface check still runs first.
- A plan whose tasks touch none of the lists: approved by the delegated review as today. The existing delegated-approval fixtures declare only `src/` and `tests/` files, so none of them starts escalating.
- `RETURN`, `ESCALATE`, `UNPARSED`, `delegate spec`, `delegate build` and an owner `approve plan`: unchanged.

### Error cases

No new error codes and no new refusals. The change is data in a constant that the existing pure string-matching check reads; it cannot fail on its own.

## Acceptance Criteria

The entry's criteria are "decide whether each of these belongs in `CONTROL_PLANE` and add test rows for those that do; `package.json` would need to be listed as a fixed file". The decision is the table above; the rows are:

- [ ] AC1: `CONTROL_PLANE` equals the BUG-080 list followed by `.git/**`, `.mcp.json`, `.github/workflows/**`, `.github/actions/**`, `package.json`, in that order; the existing pin test is updated to that exact array, and `package.json` is a fixed entry (no glob).
- [ ] AC2: `delegate plan` over an `APPROVE` report escalates, records `verdict: 'ESCALATE'` with reason `task Task 2 declares <entry> inside the control-plane files`, leaves `approvals.plan === null`, and a following owner `approve plan` exits 0 (the U41 shape), for one row per new entry (a file inside it for each directory): `.git/hooks/pre-commit`, `.mcp.json`, `.github/workflows/test.yml`, `.github/actions/setup/action.yml`, `package.json`.
- [ ] AC3: the same escalation with the control-plane reason for the directory, glob and case forms: `.git/config`, `.git`, `.git/hooks`, `.github/workflows/new.yml`, `.github/workflows`, `.github/workflows/*.yml`, `.github/**`, `*.json`, `.GIT/hooks/pre-commit`, `.GitHub/Workflows/Test.yml`, `Package.JSON`, `.MCP.json`.
- [ ] AC4: a plan whose only non-source task declares one of `.gitignore`, `.gitattributes`, `.github`, `.github/CODEOWNERS`, `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/bug.yml`, `.github/wiki/Home.md`, `.github/workflowsx/a.yml`, `docs/.git/hooks/x`, `tools/package.json`, `package-lock.json`, `mcp.json`, `docs/.mcp.json` is approved by the delegated review (`plan approved by delegated review`, `approvals.plan.by === 'define-review'`).
- [ ] AC5: every existing U22 and U41-U45 row stays green byte for byte; `.*/config` escalates with the write-surface reason.
- [ ] AC6: `WRITE_SURFACE`, the hook's `ORCH_WRITE_SURFACE` and Guard 5/6 are unchanged.
- [ ] AC7: `npm test` passes.

## Out of Scope

- **Other places that run code after the run**, not named by the issue and recorded here so their absence is a decision, not an omission: `.husky/**` and any other directory a host points `core.hooksPath` at (a host-specific location, reached only through `.git/config`, which the new `.git/**` entry already protects), `.npmrc` (`node-options`, `script-shell`), `package-lock.json` (a `resolved` URL can point at a tarball with install scripts; in this repository it is an owner record), nested `package.json` files, and other CI systems' files. Each is a one-line addition with its rows if the owner wants it (Open Owner Question 2).
- Nested `CLAUDE.md` files: `[BUG-082]`, its own item.
- The reach rule, `inSurface`, `inControlPlane`, `surfaceTask` and the reason text: unchanged.
- The hook files, Guard 5/6/7, the attended flow, `delegate spec` and `delegate build`.
- The `README.md` Known-limits entry for `[BUG-081]`, the backlog and `CHANGELOG.md`: owner records, written at release.
- Any change under `.github/workflows/` or `.github/actions/`: this item only names those paths in a constant; it writes no workflow.

## System Impact

- `scripts/orchestrate.mjs`: five entries and a comment line appended to `CONTROL_PLANE`; the comment above the constant extended. No logic change. This file is itself in `CONTROL_PLANE` (a protected surface); the change follows the normal spec and plan review.
- `tests/scripts/orchestrate.test.js`: the `[BUG-080] CONTROL_PLANE declares exactly …` pin updated to the new array (renamed to cite BUG-081 too); new `it.each` blocks beside U41-U44 for AC2-AC5, reusing `atPlan`, `plan`, `task`, `delegateDoc`, `runFile`, `expectEscalation` and the U41 approve-path assertions.
- `.claude/commands/cc-orchestrate.md` and its `project-template/` mirror: they do not enumerate the escalating paths, so no text change.
- Unattended runs: a plan that edits `package.json`, a workflow, a local action, `.mcp.json` or anything under `.git/` now needs the owner's approval.
- No hook, installer, settings or workflow file changes; no new dependency; no new network.

### Files Requiring Full Read (deferred to /cc-plan)

- `scripts/orchestrate.mjs` around `globToRegExp`, `reachesList` and `surfaceTask` (lines 1047-1100): this phase relied on the BUG-080 spec's reach rule; the plan confirms that `*.json` matches `package.json` and `.*/config` reaches `.conductor` first, and that a glob's `*` does not match a leading `.` in a way that changes any AC3/AC4 row (`.MCP.json` is listed as a fixed spelling, not a glob, for that reason).
- `tests/scripts/orchestrate.test.js` around the U41-U45 block (line 3580 onward) and the `CONTROL_PLANE` pin (line 478): exact helper signatures and row placement.

## Complexity Estimate

S — five entries appended to one constant, one pin test updated, and table-driven rows added to an existing block; no logic changes.
