# BUG-080: Unattended plan check does not escalate tasks that write guard-enforcement and control-plane files

**Status:** Draft (pending independent review)

**Item:** `[BUG-080]` (intake of issue #219). **Date:** 2026-11-14.

## Problem

In an unattended `/cc-orchestrate` run, `delegate plan` turns a delegated `APPROVE` into `ESCALATE` only when a plan task's `Files` entry reaches the orchestrator write surface (`surfaceTask` → `inSurface` in `scripts/orchestrate.mjs`, the FEAT-054 owner decision). Every other task passes on the delegated reviewer's verdict alone.

That leaves the files that *enforce* the guards outside the deterministic check. A plan task that declares `.claude/hooks/pre-tool-use.mjs`, its `project-template/` mirror, `.claude/settings.json` (which registers the hooks) or `.claude/memory/bash-scan-allowlist.txt` (the Guard 3 allowlist) is approved without the owner, and the `code` role can then rewrite the hooks that enforce Guards 5-7 for the rest of the same run. The define reviewer is told to escalate a security posture change, but a model judgement (for example after an injected ticket body) is not a boundary. The security seat still runs before `qa`; that is also a model judgement.

The precondition is `--unattended`, which the owner opts into. Attended runs are unaffected: the owner approves every plan.

## Solution

Add a second fixed path list, the guard-enforcement files, next to `WRITE_SURFACE` in `scripts/orchestrate.mjs`, and make `surfaceTask` escalate a task whose `Files` entry reaches either list. The reach test is the one `inSurface` already uses (same glob semantics as Guard 5, lower-cased, NTFS aliases always escalate), generalized from "the first segment can be `.conductor`" to "the glob's leading segments can name a protected directory", so a hooks directory is covered as a whole and new hook files are covered too. The escalation is recorded exactly as today: `run.delegated.plan = { verdict: 'ESCALATE', reason, … }`, no plan approval, and the owner's `approve` still works. The reason names the new list, so the owner can tell the two causes apart.

### The guard-enforcement list (decision)

Root-relative, lower-case, in the `WRITE_SURFACE` notation (a trailing `/**` marks a directory whose whole subtree is protected):

| Entry | Why it is guard enforcement |
|---|---|
| `.claude/hooks/**` | `pre-tool-use.mjs` implements Guards 1-7; the other hooks (`context-guard.*`, `post-compact.*`, `verbosity-remind.sh`) run from the same settings registration, and a new file there can be registered by a settings change. The whole directory, not one file, so a renamed or added hook is caught. |
| `project-template/.claude/hooks/**` | The shipped mirror; the installer copies it into host projects, and the mirror parity tests make it the source of the root copy. |
| `.claude/settings.json`, `.claude/settings.local.json` | The two project settings files Claude Code reads; they register the hooks and their matchers (Guard 6's R7 depends on the `Agent`/`SendMessage` matcher). |
| `.claude/review-loop.settings.json` | Shipped settings file the README tells owners to pass with `--settings`; it carries an auto mode allow rule, a security posture surface. |
| `project-template/.claude/settings.json`, `project-template/.claude/settings.local.json`, `project-template/.claude/review-loop.settings.json` | The shipped mirrors of the three above. |
| `.claude/memory/bash-scan-allowlist.txt`, `project-template/.claude/memory/bash-scan-allowlist.txt` | The Guard 3 allowlist (`G3_ALLOWLIST_REL` in the hook, `ALLOWLIST_REL` in `scripts/security-scan.mjs`) and its seed. |

Settings are listed as fixed files rather than as a `settings*.json` glob: Claude Code reads only the named files, and a fixed list keeps the reach test the plain "does the task glob match this path" check that `WRITE_SURFACE` uses. `review-loop.settings.json` is included although the issue's `settings*.json` shorthand would not literally match it, because it is the one other settings file the project ships.

Both mirrors are listed in every project, including host projects where `project-template/` does not exist: an absent path costs nothing and the list stays one constant.

### Reach rule (decision)

For a task `Files` entry `e`, let `g` be `e` with a leading `./` removed, lower-cased (unchanged from today). Then `g` reaches a protected list when any of:

1. a segment of `g` contains `:` or `~` or ends in `.` or space (NTFS aliasing; unchanged, applies to both lists because it is checked first);
2. for a fixed entry `p`: `globToRegExp(g)` matches `p` (unchanged);
3. for a directory entry `d/**` with segments `d1 … dn`: walking `g`'s segments in order, a segment that contains `**` reaches `d`; a segment `gi` for which `globToRegExp(gi)` does not match `di` does not; if `g` has at least `n` segments and the first `n` all match, it reaches `d`; if `g` runs out before `n`, it does not.

Rule 3 with the one-segment directory `.conductor` is exactly today's first-segment rule (`first.startsWith('**') || globToRegExp(first).test('.conductor')`), so `inSurface` is rewritten on top of the shared helper with no change in behavior; every existing U22 row pins that. A glob shorter than the directory (`.claude`, `project-template`) does not reach it, because Guard 5 matches a target against the glob itself and such a glob only names the directory entry, never a file inside it. A glob that names the directory exactly (`.claude/hooks`) escalates, as `.conductor` does today.

### Reason text and precedence (decision)

- Write surface (unchanged): `task <id> declares <entry> inside the orchestrator write surface`.
- New: `task <id> declares <entry> inside the guard-enforcement files`.

Tasks are checked in plan order, the first matching task wins (as today). Within one task, the write-surface check runs first, then the guard-enforcement check, entry by entry; so `.claude/**`, which reaches both, keeps today's write-surface reason and no existing test changes.

## Behavior

### Main path

1. The unattended run reaches the plan approval; the `define-review` agent writes `.conductor/delegate/plan.md` with `VERDICT: APPROVE`.
2. `orchestrate.mjs delegate plan <doc> <hash>` parses the report (unchanged) and, for an `APPROVE`, runs `surfaceTask` over the plan text.
3. Task 2 declares `- Modify: \`.claude/hooks/pre-tool-use.mjs\``. The entry reaches `.claude/hooks/**`.
4. The verb records `delegated.plan = { verdict: 'ESCALATE', reason: 'task Task 2 declares .claude/hooks/pre-tool-use.mjs inside the guard-enforcement files', at, review_sha256 }`, leaves `approvals.plan` null, and prints `owner approval required: delegated review plan returned ESCALATE (<reason>); see .conductor/delegate/plan.md`, exit 0.
5. The orchestrator waits for the owner, as for any `owner approval required` line; `approve plan …` then approves it as in attended mode.

### Alternative paths

- A plan whose tasks touch none of either list: approved by the delegated review as today.
- Globs that reach the list without naming a file: `.claude/hooks/*.mjs`, `.claude/*/pre-tool-use.mjs`, `project-template/**`, `.claude/*.json` (matches `.claude/settings.json`) escalate with the guard-enforcement reason. `*/hooks/x.sh` and `**/bash-scan-allowlist.txt` also escalate, but keep today's write-surface reason: their first segment can already be `.conductor`.
- Case and alias spellings: `.Claude/Hooks/pre-tool-use.mjs`, `.claude/SETTINGS.json`, `.claude/hooks./x` escalate.
- Near misses do not escalate: `.claude/hooksx/a.mjs`, `docs/hooks/a.mjs`, `.claude/commands/cc-plan.md`, `.claude/settings.backup.json`, `project-template/.claude/memory/project.md`, `.claude`.
- A `RETURN`, `ESCALATE` or `UNPARSED` report: unchanged; the check runs only on `APPROVE`.
- `delegate spec` and `delegate build`: unchanged; the check is plan-only, as in FEAT-054.

### Error cases

No new error codes and no new refusals. The check is pure string matching over the plan text that `delegate plan` already read; it cannot fail on its own. A plan that cannot be read or hashed refuses exactly as today, before the check runs.

## Acceptance Criteria

- [ ] AC1: `delegate plan` over an `APPROVE` report escalates, and records `verdict: 'ESCALATE'` with reason `task Task 2 declares <entry> inside the guard-enforcement files`, for one test row per guard-enforcement path: `.claude/hooks/pre-tool-use.mjs`, `project-template/.claude/hooks/pre-tool-use.mjs`, `.claude/settings.json`, `.claude/settings.local.json`, `.claude/review-loop.settings.json`, `project-template/.claude/settings.json`, `project-template/.claude/settings.local.json`, `project-template/.claude/review-loop.settings.json`, `.claude/memory/bash-scan-allowlist.txt`, `project-template/.claude/memory/bash-scan-allowlist.txt`. Each row asserts the printed line, `approvals.plan === null`, the recorded entry, and that a following owner `approve plan` exits 0 (the U22 shape).
- [ ] AC2: the same holds for directory and glob forms: `.claude/hooks/context-guard.sh`, `.claude/hooks/new-hook.mjs`, `project-template/.claude/hooks/verbosity-remind.sh`, `.claude/hooks`, `.claude/hooks/*.mjs`, `.claude/*/pre-tool-use.mjs`, `project-template/**`, `.claude/*.json`, `.Claude/Hooks/pre-tool-use.mjs`, `.claude/SETTINGS.json`.
- [ ] AC3: a plan whose only non-source task declares one of `.claude/hooksx/a.mjs`, `docs/hooks/a.mjs`, `.claude/commands/cc-plan.md`, `.claude/settings.backup.json`, `project-template/.claude/memory/project.md`, `.claude` is approved by the delegated review (`plan approved by delegated review`, `approvals.plan.by === 'define-review'`).
- [ ] AC4: every existing U22 row keeps its write-surface reason byte for byte, including `.claude/**` and `**/*.json`, which also reach the new list; `*/hooks/x.sh` and `.claude/hooks./x` escalate with the write-surface reason.
- [ ] AC5: a plan whose Task 1 declares a guard-enforcement file and whose Task 2 declares a write-surface file escalates with Task 1's guard-enforcement reason (plan order wins).
- [ ] AC6: `WRITE_SURFACE` and the hook's `ORCH_WRITE_SURFACE` are unchanged (the existing parity and pin tests stay green); Guard 6 behavior does not change.
- [ ] AC7: `npm test` passes.

## Out of Scope

- **Other control-plane files.** Role agent definitions (`.claude/agents/**`), phase and orchestrator commands (`.claude/commands/**`), and the orchestrator scripts (`scripts/orchestrate.mjs`, `snap-contract.mjs`, `ticket.mjs`, `security-scan.mjs`, and their `.claude/scripts/` install location in host projects) also shape later dispatches in the same run. The backlog entry and the issue name only hooks, settings and the Guard 3 allowlist; widening the deterministic set is a security posture choice left to the owner (see the owner question below). The list is one constant, so adding entries later is a one-line change plus test rows.
- Settings outside the project (`~/.claude/settings.json`, managed settings): not writable through a plan task's project-relative `Files` entries in the first place.
- Guard 5/6/7 themselves, the hook files, and the attended flow: no change.
- The `README.md` Known-limits entry for `[BUG-080]`: an owner record, updated at release.
- `delegate spec` and `delegate build` checks.

## System Impact

- `scripts/orchestrate.mjs`: a new exported constant (the guard-enforcement list) beside `WRITE_SURFACE`; a shared directory-reach helper; `inSurface` rewritten on it with identical behavior; a parallel `inGuardFiles` predicate; `surfaceTask` checks both per task and returns the matching reason. `defineOutcome`, `delegatedEntry`, `ownerRequired` and the run-file shape are unchanged.
- `tests/scripts/orchestrate.test.js`: new `it.each` rows beside U22 for AC1-AC5, reusing the `atPlan`, `plan`, `task`, `delegateDoc`, `runFile`, `approveArgs` helpers; optionally a pin of the new constant beside the `WRITE_SURFACE` pin.
- `.claude/commands/cc-orchestrate.md` and its `project-template/` mirror: the unattended paragraph does not describe which tasks escalate today, so no text change is required. If the plan adds a sentence there, both mirrors change together (mirror parity tests).
- No hook, installer, settings or workflow file changes; no new dependency; no new network.

### Files Requiring Full Read (deferred to /cc-plan)

- `scripts/orchestrate.mjs` around `extractTasks` (line 221) — how `Files` entries are parsed (backticks, `Create:`/`Modify:` prefixes) was not read in this phase; the reach rule assumes the entry string `surfaceTask` already receives.
- `tests/scripts/orchestrate.test.js` — the `atPlan` / `delegateDoc` / `approveArgs` helpers and the approve-path assertions used for AC3.

## Complexity Estimate

S — one constant, one helper generalized from existing code, one extra branch in `surfaceTask`, and table-driven test rows in an existing block.

## Owner Question

- Should the deterministic set also cover the other control-plane files (`.claude/agents/**`, `.claude/commands/**`, the orchestrator scripts and their `.claude/scripts/` copies)? Options: (a) keep this item to the hooks, settings and Guard 3 allowlist the entry names, and track the rest as a follow-up item; (b) include them now. Recommendation: (a) — it answers the minted entry, and the wider set would escalate most plans that change this repository's own commands, which is a product trade-off for the owner.
