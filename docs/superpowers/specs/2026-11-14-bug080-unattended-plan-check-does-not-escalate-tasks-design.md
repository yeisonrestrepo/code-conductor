# BUG-080: Unattended plan check does not escalate tasks that write guard-enforcement and control-plane files

**Status:** Draft (pending independent review)

**Item:** `[BUG-080]` (intake of issue #219). **Date:** 2026-11-14.

## Problem

In an unattended `/cc-orchestrate` run, `delegate plan` turns a delegated `APPROVE` into `ESCALATE` only when a plan task's `Files` entry reaches the orchestrator write surface (`surfaceTask` → `inSurface` in `scripts/orchestrate.mjs`, the FEAT-054 owner decision). Every other task passes on the delegated reviewer's verdict alone.

That leaves the files that *enforce* the guards and *steer* later dispatches outside the deterministic check. A plan task that declares `.claude/hooks/pre-tool-use.mjs`, its `project-template/` mirror, `.claude/settings.json` (which registers the hooks) or `.claude/memory/bash-scan-allowlist.txt` (the Guard 3 allowlist) is approved without the owner, and the `code` role can then rewrite the hooks that enforce Guards 5-7 for the rest of the same run. The same holds for the role prompts, the commands, `CLAUDE.md` and the orchestrator scripts: a delegated plan could rewrite the router that evaluates `delegate build`, or the prompts that later run with the user's permissions. The define reviewer is told to escalate a security posture change, but a model judgement (for example after an injected ticket body) is not a boundary. The security seat still runs before `qa`; that is also a model judgement.

The precondition is `--unattended`, which the owner opts into. Attended runs are unaffected: the owner approves every plan.

## Owner Decisions

- **Scope of the deterministic list.** The list covers the full control plane, in both mirrors where they exist: the hooks, the settings files, the Guard 3 allowlist, the role agents, the commands, the skills, `CLAUDE.md`, and the orchestrator scripts (`scripts/orchestrate.mjs`, `scripts/security-scan.mjs` and their `.claude/scripts/` copies). Leaving the orchestrator scripts or the agents out would keep the reported attack open. The added friction is accepted: the check only fires on delegated approvals in unattended runs, an owner `approve plan` is unchanged, and a plan that rewrites its own control plane is exactly the plan the owner should see.
- **Tests.** One test row per listed path, plus glob, case and near-miss rows.

## Solution

Add a second fixed path list, `CONTROL_PLANE`, next to `WRITE_SURFACE` in `scripts/orchestrate.mjs`, and make `surfaceTask` escalate a task whose `Files` entry reaches either list. The reach test is the one `inSurface` already uses (same glob semantics as Guard 5, lower-cased, NTFS aliases always escalate), generalized from "the first segment can be `.conductor`" to "the glob's leading segments can name a protected directory", so a protected directory is covered as a whole and files added to it are covered too. The escalation is recorded exactly as today: `run.delegated.plan = { verdict: 'ESCALATE', reason, … }`, no plan approval, and the owner's `approve` still works. The reason names the new list, so the owner can tell the two causes apart.

### The control-plane list (decision)

Root-relative, lower-case, in the `WRITE_SURFACE` notation (a trailing `/**` marks a directory whose whole subtree is protected). The owner decision fixes the families; the exact entries below are the technical resolution of each family.

| Entry | Why it is control plane |
|---|---|
| `.claude/hooks/**`, `project-template/.claude/hooks/**` | `pre-tool-use.mjs` implements Guards 1-7; the other hooks (`context-guard.*`, `post-compact.*`, `verbosity-remind.sh`) run from the same settings registration, and a new file there can be registered by a settings change. The whole directory, not one file, so a renamed or added hook is caught. The `project-template/` copy is the shipped mirror the installer deploys. |
| `.opencode/plugin/**`, `project-template/.opencode/plugin/**` | The OpenCode guard plugin (`conductor-guard.js`, FEAT-048) is the hook equivalent on OpenCode hosts; the installer deploys the template copy to `.opencode/plugin/`. Same family as the hooks. |
| `.claude/settings.json`, `.claude/settings.local.json`, `.claude/review-loop.settings.json` and their three `project-template/.claude/` mirrors | The two project settings files Claude Code reads register the hooks and their matchers (Guard 6's R7 depends on the `Agent`/`SendMessage` matcher); `review-loop.settings.json` is the shipped file the README tells owners to pass with `--settings` and carries an auto mode allow rule. |
| `.claude/memory/bash-scan-allowlist.txt`, `project-template/.claude/memory/bash-scan-allowlist.txt` | The Guard 3 allowlist (`G3_ALLOWLIST_REL` in the hook, `ALLOWLIST_REL` in `scripts/security-scan.mjs`) and its seed. |
| `.claude/agents/**`, `project-template/.claude/agents/**` | The role prompts every later dispatch in the run runs under. |
| `.claude/commands/**`, `project-template/.claude/commands/**` | The phase and orchestrator commands, `cc-orchestrate.md` included. |
| `.claude/skills/**`, `project-template/.claude/skills/**` | Project skills Claude Code loads into later sessions. Neither directory exists in this repository today; listing them costs nothing and closes the path before one is added. |
| `claude.md`, `claude.local.md`, `.claude/claude.md`, `project-template/claude.md` | The project instruction files Claude Code reads (root, local, and the `.claude/` location), and the shipped template. |
| `scripts/orchestrate.mjs`, `scripts/snap-contract.mjs`, `scripts/ticket.mjs`, `scripts/doc-locations.mjs`, `scripts/security-scan.mjs` | The router and the security scan the owner named, plus the three local modules `orchestrate.mjs` imports at load time: rewriting `ticket.mjs` or `snap-contract.mjs` changes what the router decides as surely as rewriting the router. The other scripts are not loaded by the router or the scan. |
| `.claude/scripts/**` | Where the installer deploys `scripts/` in a host project (`lib/installer/deploy.mjs`); the whole directory, because it holds the router, its imports and the scan together. |

Settings and instruction files are listed as fixed files rather than as a `settings*.json` or `*.md` glob: Claude Code reads only the named files, and a fixed list keeps the reach test the plain "does the task glob match this path" check that `WRITE_SURFACE` uses.

Both mirrors are listed in every project, including host projects where `project-template/` does not exist: an absent path costs nothing and the list stays one constant. The cost is the other way around in a host project that keeps its own `scripts/ticket.mjs` or similar: such a task escalates although it is not ours. That is the friction the owner accepted, and the owner can approve it.

### Reach rule (decision)

For a task `Files` entry `e`, let `g` be `e` with a leading `./` removed, lower-cased (unchanged from today). Then `g` reaches a protected list when any of:

1. a segment of `g` contains `:` or `~` or ends in `.` or space (NTFS aliasing; unchanged, applies to both lists because it is checked first);
2. for a fixed entry `p`: `globToRegExp(g)` matches `p` (unchanged);
3. for a directory entry `d/**` with segments `d1 … dn`: walking `g`'s segments in order, a segment that contains `**` reaches `d`; a segment `gi` for which `globToRegExp(gi)` does not match `di` does not; if `g` has at least `n` segments and the first `n` all match, it reaches `d`; if `g` runs out before `n`, it does not.

Rule 3 with the one-segment directory `.conductor` is exactly today's first-segment rule (`first.startsWith('**') || globToRegExp(first).test('.conductor')`), so `inSurface` is rewritten on top of the shared helper with no change in behavior; every existing U22 row pins that. A glob shorter than the directory (`.claude`, `project-template`) does not reach it, because Guard 5 matches a target against the glob itself and such a glob only names the directory entry, never a file inside it. A glob that names the directory exactly (`.claude/hooks`) escalates, as `.conductor` does today.

### Reason text and precedence (decision)

- Write surface (unchanged): `task <id> declares <entry> inside the orchestrator write surface`.
- New: `task <id> declares <entry> inside the control-plane files`.

Tasks are checked in plan order, the first matching task wins (as today). Within one task, the write-surface check runs first, then the control-plane check, entry by entry; so `.claude/**`, which reaches both, keeps today's write-surface reason and no existing test changes.

## Behavior

### Main path

1. The unattended run reaches the plan approval; the `define-review` agent writes `.conductor/delegate/plan.md` with `VERDICT: APPROVE`.
2. `orchestrate.mjs delegate plan <doc> <hash>` parses the report (unchanged) and, for an `APPROVE`, runs `surfaceTask` over the plan text.
3. Task 2 declares `- Modify: \`.claude/hooks/pre-tool-use.mjs\``. The entry reaches `.claude/hooks/**`.
4. The verb records `delegated.plan = { verdict: 'ESCALATE', reason: 'task Task 2 declares .claude/hooks/pre-tool-use.mjs inside the control-plane files', at, review_sha256 }`, leaves `approvals.plan` null, and prints `owner approval required: delegated review plan returned ESCALATE (<reason>); see .conductor/delegate/plan.md`, exit 0.
5. The orchestrator waits for the owner, as for any `owner approval required` line; `approve plan …` then approves it as in attended mode.

### Alternative paths

- A plan whose tasks touch none of either list: approved by the delegated review as today.
- Globs that reach the list without naming a listed file: `.claude/hooks/*.mjs`, `.claude/*/pre-tool-use.mjs`, `project-template/**`, `.claude/*.json` (matches `.claude/settings.json`), `scripts/*.mjs` (matches `scripts/orchestrate.mjs`), `*.md` (matches `claude.md`) escalate with the control-plane reason. `*/hooks/x.sh` and `**/bash-scan-allowlist.txt` also escalate, but keep today's write-surface reason: their first segment can already be `.conductor`.
- Case and alias spellings: `.Claude/Hooks/pre-tool-use.mjs`, `.claude/SETTINGS.json`, `Scripts/Orchestrate.mjs` escalate with the control-plane reason; `.claude/hooks./x` escalates with the write-surface reason (rule 1 runs first).
- Near misses do not escalate: `.claude/hooksx/a.mjs`, `docs/hooks/a.mjs`, `.claude/settings.backup.json`, `project-template/.claude/memory/project.md`, `.claude`, `project-template`, `scripts/snap-build.mjs`, `docs/CLAUDE.md`, `tests/scripts/orchestrate.test.js`.
- A `RETURN`, `ESCALATE` or `UNPARSED` report: unchanged; the check runs only on `APPROVE`.
- `delegate spec` and `delegate build`: unchanged; the check is plan-only, as in FEAT-054.
- An owner `approve plan`: unchanged; the list is never consulted.

### Error cases

No new error codes and no new refusals. The check is pure string matching over the plan text that `delegate plan` already read; it cannot fail on its own. A plan that cannot be read or hashed refuses exactly as today, before the check runs.

## Acceptance Criteria

- [ ] AC1: `delegate plan` over an `APPROVE` report escalates, and records `verdict: 'ESCALATE'` with reason `task Task 2 declares <entry> inside the control-plane files`, for one test row per control-plane entry (a file inside it for each directory entry): `.claude/hooks/pre-tool-use.mjs`, `project-template/.claude/hooks/pre-tool-use.mjs`, `.opencode/plugin/conductor-guard.js`, `project-template/.opencode/plugin/conductor-guard.js`, `.claude/settings.json`, `.claude/settings.local.json`, `.claude/review-loop.settings.json`, `project-template/.claude/settings.json`, `project-template/.claude/settings.local.json`, `project-template/.claude/review-loop.settings.json`, `.claude/memory/bash-scan-allowlist.txt`, `project-template/.claude/memory/bash-scan-allowlist.txt`, `.claude/agents/code.md`, `project-template/.claude/agents/code.md`, `.claude/commands/cc-orchestrate.md`, `project-template/.claude/commands/cc-orchestrate.md`, `.claude/skills/demo/SKILL.md`, `project-template/.claude/skills/demo/SKILL.md`, `CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md`, `project-template/CLAUDE.md`, `scripts/orchestrate.mjs`, `scripts/snap-contract.mjs`, `scripts/ticket.mjs`, `scripts/doc-locations.mjs`, `scripts/security-scan.mjs`, `.claude/scripts/orchestrate.mjs`. Each row asserts the printed line, `approvals.plan === null`, the recorded entry, and that a following owner `approve plan` exits 0 (the U22 shape).
- [ ] AC2: the same holds for directory, glob and case forms: `.claude/hooks/context-guard.sh`, `.claude/hooks/new-hook.mjs`, `.claude/scripts/security-scan.mjs`, `.claude/hooks`, `.claude/scripts`, `.claude/hooks/*.mjs`, `.claude/*/pre-tool-use.mjs`, `project-template/**`, `.claude/*.json`, `scripts/*.mjs`, `*.md`, `.Claude/Hooks/pre-tool-use.mjs`, `.claude/SETTINGS.json`, `Scripts/Orchestrate.mjs`.
- [ ] AC3: a plan whose only non-source task declares one of `.claude/hooksx/a.mjs`, `docs/hooks/a.mjs`, `.claude/settings.backup.json`, `project-template/.claude/memory/project.md`, `.claude`, `project-template`, `scripts/snap-build.mjs`, `docs/CLAUDE.md`, `tests/scripts/orchestrate.test.js` is approved by the delegated review (`plan approved by delegated review`, `approvals.plan.by === 'define-review'`).
- [ ] AC4: every existing U22 row keeps its write-surface reason byte for byte, including `.claude/**` and `**/*.json`, which also reach the new list; `*/hooks/x.sh`, `**/bash-scan-allowlist.txt` and `.claude/hooks./x` escalate with the write-surface reason.
- [ ] AC5: a plan whose Task 1 declares a control-plane file and whose Task 2 declares a write-surface file escalates with Task 1's control-plane reason (plan order wins).
- [ ] AC6: `WRITE_SURFACE` and the hook's `ORCH_WRITE_SURFACE` are unchanged (the existing parity and pin tests stay green); Guard 6 behavior does not change.
- [ ] AC7: `npm test` passes.

## Out of Scope

- Scripts the router and the scan do not load (`snap-build.mjs`, `snap-validate.mjs`, `resume-read.mjs`, `session-*.mjs`, the installer under `lib/` and `code-conductor.mjs`), and the status-line script `project-template/.claude/flow-status.mjs`: they neither enforce a guard nor shape a later dispatch in the same run. The list is one constant, so adding entries later is a one-line change plus test rows.
- Settings outside the project (`~/.claude/settings.json`, managed settings): not writable through a plan task's project-relative `Files` entries in the first place.
- Guard 5/6/7 themselves, the hook files, and the attended flow: no change.
- The `README.md` Known-limits entry for `[BUG-080]`: an owner record, updated at release.
- `delegate spec` and `delegate build` checks.

## System Impact

- `scripts/orchestrate.mjs`: a new exported constant `CONTROL_PLANE` beside `WRITE_SURFACE`; a shared directory-reach helper; `inSurface` rewritten on it with identical behavior; a parallel `inControlPlane` predicate; `surfaceTask` checks both per task and returns the matching reason. `defineOutcome`, `delegatedEntry`, `ownerRequired` and the run-file shape are unchanged.
- `tests/scripts/orchestrate.test.js`: new `it.each` rows beside U22 for AC1-AC5, reusing the `atPlan`, `plan`, `task`, `delegateDoc`, `runFile`, `approveArgs` helpers; a pin of the new constant beside the `WRITE_SURFACE` pin. The existing delegated-approval fixtures declare only `src/` and `tests/a.test.js` files, so none of them starts escalating.
- Unattended runs over this repository: a plan that changes the commands, the agents, `CLAUDE.md` or the router now always needs the owner's approval (the accepted friction).
- `.claude/commands/cc-orchestrate.md` and its `project-template/` mirror: the unattended paragraph does not describe which tasks escalate today, so no text change is required. If the plan adds a sentence there, both mirrors change together (mirror parity tests).
- No hook, installer, settings or workflow file changes; no new dependency; no new network.

### Files Requiring Full Read (deferred to /cc-plan)

- `scripts/orchestrate.mjs` around `extractTasks` (line 221) — how `Files` entries are parsed (backticks, `Create:`/`Modify:` prefixes) was not read in this phase; the reach rule assumes the entry string `surfaceTask` already receives.
- `tests/scripts/orchestrate.test.js` — the `atPlan` / `delegateDoc` / `approveArgs` helpers and the approve-path assertions used for AC3.

## Complexity Estimate

S — one constant, one helper generalized from existing code, one extra branch in `surfaceTask`, and table-driven test rows in an existing block.
