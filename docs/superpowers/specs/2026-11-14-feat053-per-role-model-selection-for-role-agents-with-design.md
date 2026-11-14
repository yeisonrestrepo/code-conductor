# FEAT-053: Per-role model selection for role agents, with escalation on repeated returns

**Status:** Draft (pending independent review)
**Item:** FEAT-053 (intake of issue #187)
**Date:** 2026-11-14

## Problem

No role agent under `.claude/agents/` or `project-template/.claude/agents/` sets a model. There are seven profiles today: the six run roles `spec`, `plan`, `code`, `audit`, `security`, `qa`, plus the `define-review` reviewer from FEAT-041. Each one inherits the session's model. A `/cc-orchestrate` run therefore pays the same price to write the plan as to carry out a fully specified task, and the auditor runs on the same model as the `code` author whose change it reviews, so the two share blind spots.

The backlog entry asks for four things:

1. the configuration is read from the project and written into the dispatched agent's model;
2. the defaults ship in both mirrors;
3. the escalation is enforced by `orchestrate.mjs` and recorded in the run file;
4. with no configuration, behavior matches today's inheritance.

Criteria 2 and 4 conflict if "defaults" means a `model:` key in each profile's frontmatter. Claude Code reads that key, so shipping it would change every project's dispatches on upgrade, configured or not, and criterion 4 would fail. This spec resolves the conflict with **opt-in defaults**, described under Solution, and confirmed under Owner decisions.

What the code does today, from the files read:

- `/cc-orchestrate` dispatches each role with `Agent({ subagent_type: <role>, ... })` and no `model` (`.claude/commands/cc-orchestrate.md:60`). The review loop dispatches `define-review` and the revising author the same way (`:92`, `:94`).
- `orchestrate.mjs install <role> [--check]` prints the envelope. For a fix round it appends one line, `fix round <r> of <N>: review <review> sha256 <sha256>`, and the orchestrator must take the brief's values from that line, "never from your own reading of the report" (`cc-orchestrate.md:75`; `scripts/orchestrate.mjs:441`). That line is the precedent this spec follows: the script decides, and the orchestrator copies.
- An audit `RETURN` with fix rounds left records a `fix` object on the audit entry: `{ round, files, review, sha256 }` (`scripts/orchestrate.mjs:507`). The next step is then `code` for that fix (`:158-159`). Each finding path has already been checked against the approved plan's task files, and any path outside them halts with `ORCH_FIX_SCOPE_UNAPPROVED` (`cc-orchestrate.md:37`). So every returned path belongs to at least one plan task.
- Project configuration already lives in `CLAUDE.md` lines. `doc-locations.mjs` reads `- Specs:` and `- Plans:` with `^- Specs: (\S+)$` (`scripts/doc-locations.mjs:83-85`). `start` refuses with `ORCH_DOC_LOCATION_INVALID` before it writes any run file (`cc-orchestrate.md:50`).
- Run settings that must not change mid-run are fixed at `start` and stored in the run file, such as `audit_rounds`. `isValidRun` rejects a hand-edited value (`scripts/orchestrate.mjs:113-119`).

## Solution

A project opts in with one `CLAUDE.md` line, `- Role models: <value>`. `orchestrate.mjs start` parses it, resolves a model for each of the seven roles, and freezes that map in the run file as `models`. Every dispatch the run makes then carries the model the script prints: the role dispatches through `install`, and the `define-review` and revision dispatches through `review`. The orchestrator copies the model into the `Agent` call's `model` parameter and never chooses one itself.

The shipped defaults sit in each profile's frontmatter under a key Claude Code does not read, `default-model:`, in both mirrors:

| Role | `default-model:` | Tier |
|---|---|---|
| `spec`, `plan`, `audit`, `define-review`, `security` | `opus` | most capable |
| `code` | `sonnet` | balanced |
| `qa` | `haiku` | smallest |

`- Role models: default` turns on exactly these defaults, so the auditor (`opus`) differs from the `code` author (`sonnet`) by default. A project can override single roles (`default, qa=sonnet`) or set only some roles and leave the others inheriting (`code=sonnet`). With no line, nothing is printed, nothing is recorded, and every dispatch inherits as it does today.

Escalation: when an audit returns a change in which a plan task's files are named by blocker or major findings, and an earlier audit in the same run already returned that task, the fix-round `code` dispatch that follows runs on `opus`, the most capable model. This happens only in a run with a `models` map. The script decides it and records it on the audit entry's `fix` object.

## Behavior

### Main path

1. **Configuration.** The owner adds `- Role models: default` to the project `CLAUDE.md`.
2. **Start.** `orchestrate.mjs start <ITEM>` reads `CLAUDE.md` once. It finds the single line that matches `^- Role models: (.+)$` and parses the value as comma-separated tokens, trimming whitespace around each token:
   - `default` sets every role to its profile's `default-model:`. The profile is resolved with `findAgent(role, root)`, the same lookup `install` uses: the project's `.claude/agents/` first, then `~/.claude/agents/`.
   - `<role>=<model>` sets one role, where `<role>` is one of the seven names and `<model>` is one of `opus`, `sonnet`, `haiku`, `inherit`. These are the aliases the `Agent` tool's `model` parameter accepts, plus `inherit`. The allow-list is one exported constant in `scripts/orchestrate.mjs` that both `start` and `isValidRun` read. Explicit tokens win over `default`, whatever their order.
   - A role that no token covers is `inherit`.

   The run file gains `models: { spec, plan, code, audit, security, qa, "define-review" }`, each value an alias or `inherit`. Its stdout gains one segment after the audit rounds: `; role models: spec=opus, plan=opus, code=sonnet, audit=opus, security=opus, qa=haiku, define-review=opus`. The orchestrator prints that segment in the run header.
3. **Each role dispatch.** `install <role> --check` and `install <role>` print one more line after the envelope (and after the fix-round line, when there is one): `model: <alias>`. The orchestrator passes `model: <alias>` in that role's `Agent` call. When the role's value is `inherit`, the line reads `model: inherit` and the call carries no `model` parameter.
4. **Review loop.** `review <role> --round <doc>` appends `; model <alias|inherit>` for `define-review` to its `round <n> of 3` line. The `OPEN <k>; revise …` line from `review <role> --record` appends `; model <alias|inherit>` for the revising author (`spec` or `plan`). The orchestrator applies each one to the dispatch that line triggers, by the same rule as step 3.
5. **Record.** `handback <role>` copies the model the role was installed with into the new entry as `model`. Before the dispatch, `install <role>` (without `--check`) stores that model in the run file as `dispatch_model`, and `handback` reads it from there, so the value comes from the script and not from the agent's report. `install <role> --check` prints the `model:` line and writes nothing, as it writes nothing today.
6. **Escalation.** In `handback audit`, when the verdict is `RETURN` and a fix round is granted (the branch at `scripts/orchestrate.mjs:505-510`), the script:
   1. maps each blocker or major finding path to the plan tasks whose `**Files:**` block lists it, using `extractTasks` on the approved plan, and calls that set the round's *returned tasks*;
   2. collects the returned tasks recorded on the run's earlier audit entries' `fix` objects;
   3. if the two sets share a task, writes `fix.model: "opus"` and `fix.escalated: [<shared task ids>]`; otherwise it writes `fix.model: <models.code>`;
   4. always writes `fix.tasks: [<returned task ids>]`, which is what step 2 of a later round reads.

   When no fix round is left, the existing `ORCH_AUDIT_RETURN` halt (`scripts/orchestrate.mjs:495`) applies unchanged: no `fix` object is recorded, so no `fix.model`, `fix.tasks` or `fix.escalated` is written, whether or not the round would have escalated.

   The `handback audit` line gains `; model <m>`, or `; model opus (escalated: <ids> returned twice)`. `install code` for that fix round prints `model: opus` and the orchestrator dispatches on it. Escalation applies only to the fix round it is recorded on. The next fix round is decided again from its own audit.
7. **End.** `end` prints the record. The report step names each entry's `model` and each escalated fix round with its task ids.

### Alternative paths

- **No `- Role models:` line.** `start` writes no `models` key and prints no `role models` segment. `install` and `review` print no model line or segment. No entry carries `model`, and no `fix` object carries `model`, `tasks` or `escalated`. stdout and the run file are byte-identical to today's, and every dispatch inherits.
- **Partial configuration** (`- Role models: code=sonnet`): `code` is dispatched on `sonnet` and every other role inherits. Escalation is still active, because the run has a `models` map, so a repeated return dispatches the fix on `opus`.
- **`default` with a home-directory profile** that carries no `default-model:` (for example a user-written `~/.claude/agents/qa.md` that shadows nothing in the project): that role resolves to `inherit`, and the start segment shows it as `qa=inherit`.
- **Audit and code on the same model**, by configuration or because every role inherits: allowed. The backlog asks only that the auditor *defaults* to a different model. When both values are the same non-`inherit` alias, `start` appends `; note: audit and code share <alias>` to the segment.
- **Escalated fix audited by `opus`.** During an escalated round, the author and the auditor run on the same model. This is accepted: escalation puts the most capable model on a task the balanced model failed twice, and the auditor's default is unchanged.
- **A finding path listed by two tasks** counts as a return of both tasks.
- **`code` already configured as `opus`.** Escalation still records `fix.escalated`, and the model line reads `opus (escalated: …)`. The record shows the trigger even when the model is the same.
- **Resume (FEAT-055).** `resume` keeps `models` as recorded, since it is run configuration like `audit_rounds`. It drops every Verify record, so escalation history restarts with the redone audits.
- **Run started before FEAT-053.** Such a run has no `models` key and behaves as the no-configuration path, so the run file stays valid.

### Error cases

- **Malformed line.** Each of these makes `start` halt with `ORCH_ROLE_MODELS_INVALID: <reason>` and write no run file, as `ORCH_DOC_LOCATION_INVALID` does:
  - an unknown role;
  - a model outside the allow-list;
  - the same role set twice;
  - an empty token;
  - `default` given twice;
  - more than one `- Role models:` line.

  The reason names the offending token or line. `cc-orchestrate.md` step 1 lists the code with the remedy: fix or remove the line, then run a fresh `start`.
- **`default` with a profile whose `default-model:` is outside the allow-list.** Same halt, naming the profile path and the value.
- **Hand-edited `models`, `dispatch_model` or `fix.model` holding anything but the allow-list.** `isValidRun` rejects the run file, so the verbs see no valid run, as they do for a bad `audit_rounds` today. An edit cannot buy a model.
- **The orchestrator passes another model, or none.** The script cannot observe the `Agent` call's parameters. It records the model it printed, and `cc-orchestrate.md` makes copying it a rule, like the fix-round values. A hook-level check is out of scope (see Out of Scope and Owner decisions).
- **The `Agent` tool rejects the alias** (an account without access to that model). The dispatch fails. The orchestrator follows the existing path for a failed dispatch and does not retry on another model.

## Acceptance Criteria

- [ ] **AC1, configuration read and written into the dispatch.** With `- Role models: default` in the fixture `CLAUDE.md`:
  - `start` records `models` with the shipped defaults and prints the `role models` segment;
  - `install <role> --check` prints `model: <alias>` for every role and leaves the run file byte-identical (no `dispatch_model`);
  - `install <role>` without `--check` records `dispatch_model`;
  - `review spec --round` and the `OPEN` revise line carry `; model <alias>`;
  - `cc-orchestrate.md` (both copies) tells the orchestrator to pass that alias as the `Agent` call's `model`, to pass none for `inherit`, and never to choose one;
  - a `role=model` token overrides `default`, and an uncovered role prints `model: inherit`.
- [ ] **AC2, defaults ship in both mirrors.** Each of the seven profiles in `.claude/agents/` and `project-template/.claude/agents/` carries `default-model:` with the value in the table above, and carries no `model:` key. The existing byte-identity and token-ceiling tests in `tests/unit/role-profiles.test.js` stay green, including the `define-review` 999-token ceiling. The six pinned rows of `PROFILE_SHA256_1_37_0` (`audit`, `code`, `plan`, `qa`, `security`, `spec`) are updated to the new hashes in the same commit that adds the `default-model:` lines, with a FEAT-053 comment line like the other rows'. A new assertion pins the seven values.
- [ ] **AC3, escalation enforced by the script and recorded.**
  - In a configured run, a second `RETURN` whose findings name a task the first `RETURN` named records `fix.model: "opus"`, `fix.escalated` and `fix.tasks` on the audit entry, and `install code --check` prints `model: opus`.
  - A second `RETURN` naming only new tasks records `fix.model` equal to `models.code`.
  - The code fix entry's `model` equals the printed model.
  - A hand-edited `fix.model` outside the allow-list fails `isValidRun`.
  - In a configured run started with `--audit-rounds 1`, a second `RETURN` of the same task halts with `ORCH_AUDIT_RETURN`, and the audit entry carries no `fix.model`, `fix.tasks` or `fix.escalated`.
- [ ] **AC4, no configuration matches today.** Without the line:
  - `start`, `install`, `review` and `handback` stdout carry no model text;
  - the run file has no `models` or `dispatch_model` key;
  - entries have no `model`, and `fix` objects have no `model`, `tasks` or `escalated`, including after two returns of the same task.

  Every existing `tests/scripts/orchestrate.test.js` expectation passes unchanged.
- [ ] **Error cases.** Each malformed-line case halts with `ORCH_ROLE_MODELS_INVALID`, and no run file is written.

## Out of Scope

- **Making escalation a hook-enforced boundary.** Guard 6 sees `Agent` calls during a run and could deny one whose `model` differs from the installed `dispatch_model`. That is a hooks change (a protected surface). This change does not touch `.claude/hooks/pre-tool-use.mjs` or its template copy; the check goes to a separate follow-up item (see Owner decisions).
- **Phase-command dispatches (FEAT-061 `envelope` verb, `/cc-spec --delegate` and the like).** These keep inheriting. The backlog's components name only the profiles and `orchestrate.mjs`.
- **Full model IDs, or aliases beyond `opus`, `sonnet` and `haiku`**, in the configuration. Widening the allow-list is a one-constant change once the `Agent` tool's accepted values are confirmed to include them.
- **Choosing the auditor's model automatically** to differ from an escalated author.
- **Cost reporting or metrics per model.**
- **Records** (`VERSION`, `CHANGELOG.md`, the backlog, `README.md` Known limits): owner-side.

## System Impact

- `scripts/orchestrate.mjs`:
  - `start`: parse `- Role models:`, resolve the defaults through `findAgent`, record `models`, add the stdout segment, add the new halt code;
  - `install`: print the model line and store `dispatch_model`;
  - `recordHandback` / `handback`: write the entry's `model`;
  - `auditFix`: compute returned tasks and escalation, and extend the `fix` object;
  - `review` `openRound` / `recordRound`: append the model segment;
  - `isValidRun`: validate `models`, `dispatch_model` and `fix.model` against the allow-list, the same exported constant `start` reads;
  - `resume`: keep `models`.

  The parser can live in a small exported function next to the existing ones, or in `doc-locations.mjs`'s style of CLAUDE.md reader. The plan decides after a full read.
- `.claude/agents/*.md` and `project-template/.claude/agents/*.md` (14 files): one `default-model:` frontmatter line each.
- `.claude/commands/cc-orchestrate.md` and its `project-template/` copy:
  - step 1: the new halt and the header segment;
  - step 2.4: pass the printed model;
  - the review loop's steps 2 and 4: same;
  - step 6: report models and escalations.

  The plan checks whether any test pins this file's size; the `define-review` profile's 999-token ceiling (`tests/unit/role-profiles.test.js:196`) must still hold after its new frontmatter line.
- `README.md` walkthrough (`/cc-orchestrate` section, not Known limits): one paragraph on `- Role models:` and escalation.
- Tests:
  - `tests/scripts/orchestrate.test.js`: the fixture `agents()` helper gains `default-model:`; new cases for AC1, AC3, AC4 and the error cases;
  - `tests/unit/role-profiles.test.js`: AC2, including the six updated `PROFILE_SHA256_1_37_0` rows.
- `snap-contract.mjs` and the SNAP envelope are **unchanged**. The model travels as a separate stdout line, as the fix-round line does, so no envelope cap or schema moves.
- No new dependency, no network, no workflow change. The installer copies the profiles and the command as it does today, so it needs no change. The plan confirms this against `tests/installer/templates.test.js`.

### Files Requiring Full Read (deferred to /cc-plan)

- `scripts/orchestrate.mjs`: `start`, `parseStartArgs`, `install`, `recordHandback`, `handback`, `auditFix`, `openRound`, `recordRound`, `isValidRun`, `resume`, `extractTasks`. It is 1176 lines and was understood here only through grep and its first 30 lines.
- `tests/scripts/orchestrate.test.js`: the fixture helpers (`agents()`, run setup) and the existing audit-RETURN and start-stdout cases.
- `tests/unit/role-profiles.test.js`: the frontmatter and mirror assertions beyond line 30.
- `scripts/doc-locations.mjs`: the CLAUDE.md reader (`readText`, the `- Specs:` parse), as the pattern the new parser follows.

## Owner decisions

The questions this spec left open were decided as follows. The rest of the spec stands as written, including the `ORCH_ROLE_MODELS_INVALID` halts, the byte-identical no-configuration path (AC4) and `resume` keeping `models`.

1. **Defaults (opt-in).** `default-model:` ships in all 14 profiles, and none of them carries a `model:` key. The defaults take effect only through `- Role models: default` or single-role tokens.
2. **Hook enforcement.** Copying the printed model stays a documented rule in `cc-orchestrate.md`. This change does not touch `.claude/hooks/pre-tool-use.mjs` or its `project-template/` copy. A Guard 6 model check is a separate follow-up item.
3. **Allow-list.** `opus`, `sonnet`, `haiku` and `inherit`, held in one exported constant that both `start` and `isValidRun` read.
4. **Profile hashes.** The six pinned rows of `PROFILE_SHA256_1_37_0` in `tests/unit/role-profiles.test.js` (`audit`, `code`, `plan`, `qa`, `security`, `spec`) are updated in the same commit that adds the `default-model:` lines, with a FEAT-053 comment line as the other rows have. `define-review` is not in that table, but its 999-token ceiling test must stay green.
5. **Dispatch model.** Only `install <role>` without `--check` writes `dispatch_model`. `install <role> --check` prints the `model:` line and writes nothing. A test row pins this.
6. **Escalation at the round cap.** A test row pins a run started with `--audit-rounds 1`: the second `RETURN` halts with `ORCH_AUDIT_RETURN` and writes no `fix.model`, `fix.tasks` or `fix.escalated`.

## Complexity Estimate

M. The change is one configuration parser, a model map threaded through four verbs and one escalation rule in the existing fix-round branch, plus a frontmatter line in 14 profiles. It is contained in `orchestrate.mjs`, its command text and tests, but it touches many existing stdout expectations, which AC4 must keep byte-identical.
