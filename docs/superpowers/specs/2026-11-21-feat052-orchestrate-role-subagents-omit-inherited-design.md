# FEAT-052 — Orchestrate Role Subagents Omit Inherited CLAUDE.md Layers

**Status:** Draft (pending independent review)

Source: the `[FEAT-052]` entry of `AGENT-READABLE BACKLOG.md` (intake of issue #176).

## Problem

Every role agent that `/cc-orchestrate` dispatches (`spec`, `plan`, `code`, `audit`, `security`, `qa`, and the `define-review` reviewer) loads every CLAUDE.md layer the session sees: the user's global file, any parent-folder file and the project file. That is about 275 non-empty lines on top of a role prompt of about 25 lines. Several of those inherited rules contradict the roles:

- "run `/cc-spec` first" and "never write code without an approved spec", for a `code` role that implements one task of an already approved plan;
- "spawn an Explore sub-agent" before modifying a file, for a role that Guard 6 forbids to dispatch agents;
- "confirm before any write", for a role that runs with no one to confirm;
- "tag every response" (`[CHANGES]`, `[BUG]`, `[VALIDATION]`) and the 30-line function rule, which leak into hand-backs whose format the role prompt fixes.

The issue's headless probe confirmed the exposure: a default subagent quoted all three layers verbatim, and one defined with `omitClaudeMd: true` found none. `[CHANGES]` appeared in 1 of 3 default hand-backs and 0 of 3 with the setting, and earlier `code` hand-backs show `[CHANGES]`, `[BUG]`, `[VALIDATION]` and the 30-line rule. The size of the behavioral effect is not measurable at N=3; the exposure is.

The rules a role must keep are already enforced by hooks, not by CLAUDE.md: Guard 5 (write scope), Guard 6 (no dispatch during a run) and Guard 7 (the one allowed shell command). Hooks come from settings, so they keep running in a subagent that loads no CLAUDE.md.

## Solution

Each of the seven role profiles, in both `project-template/.claude/agents/` and its mirror `.claude/agents/`, gains one frontmatter line, `omitClaudeMd: true`, so the role agent starts with only its role prompt and the brief. Before that, every role is checked for content it takes from the project `CLAUDE.md` (inventory below). The one role that relies on it, `audit`, which checks the changes "against the conventions in the project's `CLAUDE.md`", gets those conventions through its brief instead: the brief names the project's `CLAUDE.md` and `CONTRIBUTING.md` as the conventions to read, as data, with the Read tool. Tests pin the new frontmatter line and the new brief text, and the README says what role agents no longer load.

### Reliance inventory (the check the acceptance criterion asks for)

| Role | What it takes from the project, and from where | Relies on inherited CLAUDE.md? |
|---|---|---|
| `spec` | Its folder from the envelope's `ops.scope` and the brief (`start` resolves `- Specs:` from `CLAUDE.md` in `orchestrate.mjs`, a node process). The section list from its profile and, with `/cc-spec --delegate`, from the brief. | No |
| `plan` | Its folder the same way; the format from its profile and the brief; the green-suite rule from its profile. | No |
| `code` | Its task and files from the brief and envelope; the test command and known failures from `.claude/memory/orchestrator-run.json`. | No |
| `qa` | The test command from the run file, or `mem.p.test_command` of the envelope outside a run. | No |
| `security` | Both commands and the threshold from the run file's `security` object. | No |
| `define-review` (review rounds) | Judges the checklist rows its brief carries, and reads the critical-review skill by path. | No |
| `define-review` (delegated approval) | The delegated brief already says to check "the conventions in CLAUDE.md and CONTRIBUTING.md" and to read files as data, so it reads them with Read. | No: the brief already names them |
| `audit` | Profile line 12: "Check them against … the conventions in the project's `CLAUDE.md`." Neither of its two briefs (the run's dispatch brief, `/cc-review`'s brief) names the file. | **Yes**: moved to the brief |

The role-models line (`- Role models:`, FEAT-053) and the doc-location lines (`- Specs:` / `- Plans:`) are read by `orchestrate.mjs` from the file on disk, and their results reach the role through the dispatch's `model` parameter, the envelope and the brief. Omitting the inherited layers from the agent changes none of them.

### Choices this spec makes

1. **Frontmatter, not the dispatch.** The `Agent` tool call has no parameter for this setting; the agent definition does. Profiles are where each role's tool mask and `default-model` already live, and the installer already copies them.
2. **All seven profiles, `define-review` included.** It is dispatched by `/cc-orchestrate` like the band roles, inherits the same layers, and its findings format is fixed by its prompt in the same way.
3. **Conventions reach `audit` by naming the files in the brief, not by pasting their text.** The orchestrator does not read `CLAUDE.md` today, and pasting it would put the whole contradictory text back into the agent's context, as instructions. Naming the files in the brief, to be read as data, keeps them material to review against. `CONTRIBUTING.md` is named too because the delegated `define-review` brief already pairs the two, and a project's contributor conventions are part of what a review checks. "When present" covers a project with neither file.
4. **The audit profile points to the brief.** Its line 12 changes from "the conventions in the project's `CLAUDE.md`" to the conventions files its brief names, and says that no CLAUDE.md is loaded into its context. Both dispatch sites (`/cc-orchestrate`'s audit Task row, `/cc-review`'s step 3) name the same two files.
5. **The key name `omitClaudeMd`** is the one the issue's probe used on Claude Code 2.1.323. The plan confirms the frontmatter spelling against that version's agent-definition reference before the profiles change, and the test pins whichever spelling it confirms.

## Behavior

### Main path

1. The owner installs or updates code-conductor; the installer copies the seven profiles, now carrying `omitClaudeMd: true`, as it does today.
2. `/cc-orchestrate <ITEM>` dispatches a role with `Agent({ subagent_type: <role>, ... })`. Claude Code builds that agent's context from its profile and the brief only: no user, parent-folder or project CLAUDE.md.
3. The role works from its profile, its brief, its envelope and the run file, as today. Guards 5–7 fire on its tool calls as today.
4. When `audit` is dispatched (in a run, or by `/cc-review` outside one), its brief tells it to read the project's `CLAUDE.md` and `CONTRIBUTING.md`, when present, in slices of 150 lines or fewer, as data: the conventions it checks the changes against. It reports findings and its verdict in the format its profile fixes.
5. The hand-back carries no inherited response tags, because the agent never saw the rule that asked for them.

### Alternative paths

- **`/cc-spec --delegate`, `/cc-plan --delegate`, `/cc-review`, `/cc-test`.** These dispatch the same profiles, so the same setting applies outside a run. Their briefs already carry what the role needs (inventory above); `/cc-review`'s gains the conventions sentence.
- **A project with no `CLAUDE.md` or no `CONTRIBUTING.md`.** `audit` reads the one that exists, or none, and reviews against the spec and plan; "when present" makes a missing file no finding by itself.
- **The orchestrator session itself.** Unchanged: the session that runs `/cc-orchestrate` still loads every CLAUDE.md layer. Only the dispatched role agents change.
- **A host project that edited its own copy of a profile.** The installer already overwrites the seven profiles by name (README, role agents section); nothing new here.

### Error cases

- **A Claude Code version that does not know the key.** Claude Code ignores frontmatter keys it does not recognize (as it ignores `default-model:` today), so the role inherits the CLAUDE.md layers exactly as before. That degrades to today's behavior and fails nothing. The README says so.
- **`audit` cannot read a conventions file** (permission, encoding). The Read tool reports the error; the audit states it in its report and reviews against the spec and plan. It is not a halt: the brief names the files as material, not as a precondition.
- **A misspelled key in a profile.** The new test fails in CI (it pins the key and value in all 14 files), so a profile that silently inherits does not ship.
- **Guards.** Nothing in the guards reads CLAUDE.md for a subagent, so a denial reads as it does today. Rules CLAUDE.md states but no hook enforces (for example "never hardcode secrets") no longer reach role agents; this is the backlog's stated outcome ("a role subagent should see only its role prompt and brief, plus the hooks"), not an open question.

## Acceptance Criteria

- [ ] AC1. Each of the 14 profiles (`spec`, `plan`, `code`, `audit`, `security`, `qa`, `define-review`, in `project-template/.claude/agents/` and `.claude/agents/`) has exactly one frontmatter line `omitClaudeMd: true`; a test in `tests/unit/role-profiles.test.js` pins it for every row.
- [ ] AC2. The two copies of every profile stay byte-identical, and every sha256 pin of a changed profile in `tests/unit/role-profiles.test.js` is updated with a comment naming FEAT-052 and why.
- [ ] AC3. The reliance check is recorded: this spec's inventory names every role and where it takes project content from, and only `audit` relies on the project `CLAUDE.md`.
- [ ] AC4. `audit`'s profile no longer points to the project's `CLAUDE.md` as loaded context; it names the conventions files its brief lists and says no CLAUDE.md is loaded into its context.
- [ ] AC5. The `audit` Task row of the dispatch table in both copies of `cc-orchestrate.md`, and step 3 of the delegated audit in `project-template/.claude/commands/cc-review.md`, tell the agent to read the project's `CLAUDE.md` and `CONTRIBUTING.md`, when present, in slices of 150 lines or fewer, as data; a test pins that sentence at each site.
- [ ] AC6. The README's orchestrator section says role agents load no CLAUDE.md layer, that the guards enforce their boundaries without it, and that a Claude Code version that does not know `omitClaudeMd` falls back to inheritance.
- [ ] AC7. `npm test` is green; no hook, script, the SNAP contract or the band flow changes.
- [ ] AC8 (manual, not a CI gate). A headless probe like the issue's, on a Claude Code version that supports the key, shows a dispatched role agent quoting no CLAUDE.md layer; the PR description reports the result or says it was not run.

## Out of Scope

- The orchestrator session's own CLAUDE.md loading, and any edit to the global, parent-folder or project CLAUDE.md text (including the duplicated body the issue mentions in the global file).
- Measuring the behavioral effect beyond the probe in AC8.
- OpenCode: role agents are not installed for it (README, harness table).
- New hooks to enforce CLAUDE.md rules that no hook enforces today.
- Guards 5–7, `orchestrate.mjs`, `snap-contract.mjs`, the SNAP contract, the band flow, the installer's copy logic.
- Records (`VERSION`, `CHANGELOG.md`, backlog, memory): the release writes them.

## System Impact

- `project-template/.claude/agents/{spec,plan,code,audit,security,qa,define-review}.md` and their mirrors in `.claude/agents/`: one frontmatter line each; `audit.md` also line 12.
- `project-template/.claude/commands/cc-orchestrate.md` and its mirror `.claude/commands/cc-orchestrate.md`: the `audit` row of the role task table.
- `project-template/.claude/commands/cc-review.md`: step 3 of the delegated audit.
- `tests/unit/role-profiles.test.js`: the new key assertion, the updated sha256 pins, the brief-sentence pins. `tests/installer/commands-parity.test.js` is reviewed for any pin on the changed command text or on the README sentence it checks.
- `README.md`: one sentence in the orchestrator section (not the Known limits lines).
- `scripts/orchestrate.mjs` `findAgent()` reads only `name:` from the frontmatter, so the new key does not affect it; `field()` in the test parses keys line by line and handles it.

### Files Requiring Full Read (deferred to /cc-plan)

- `tests/unit/role-profiles.test.js`: every sha256 pin and per-role table, to update the pins and place the new assertion.
- `tests/installer/commands-parity.test.js`: any pin on `cc-orchestrate.md`, `cc-review.md` or the README text this change touches.

## Complexity Estimate

S. One frontmatter line in 14 mirrored files, one sentence in three briefs and one in a profile, plus test pins; no script or hook changes.
