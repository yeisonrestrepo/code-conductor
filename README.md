# code-conductor

[![npm version](https://img.shields.io/npm/v/%40yeison.restrepo.r%2Fcode-conductor.svg)](https://www.npmjs.com/package/@yeison.restrepo.r/code-conductor)
[![npm downloads](https://img.shields.io/npm/dw/%40yeison.restrepo.r%2Fcode-conductor.svg)](https://www.npmjs.com/package/@yeison.restrepo.r/code-conductor)
[![License](https://img.shields.io/github/license/yeisonrestrepo/code-conductor.svg)](https://github.com/yeisonrestrepo/code-conductor/blob/main/LICENSE)
[![GitHub issues](https://img.shields.io/github/issues/yeisonrestrepo/code-conductor.svg)](https://github.com/yeisonrestrepo/code-conductor/issues)

**Make Claude Code work like a senior engineer, not an enthusiastic intern.**

code-conductor is a drop-in governance layer for [Claude Code](https://www.anthropic.com/claude-code): slash commands, hooks, guardrails and a persistent memory system that turn free-form AI coding sessions into a disciplined, repeatable engineering workflow. What an agent may run is checked before it runs, what it decided is written where the next session will read it, and what shipped is asserted against the record by instruments that run in CI. It cuts token usage along the way.

One command to install. No code changes to your project. Works with any stack. And every claim below is checkable against a commit in this repository.

---

## Why this exists

If you have used Claude Code for more than a week, you have probably seen all of this:

- **It reads entire files, or entire codebases, to answer a one-line question.** Every one of those reads burns tokens and fills the context window with noise.
- **It forgets everything between sessions.** The conventions you explained yesterday, the architectural decision from last sprint, the workaround for that flaky test: gone. You explain them again, and pay for the tokens again.
- **It starts coding before anyone agreed on *what* to build.** Fast output, wrong problem, full rewrite.
- **The context window fills up silently**, the session auto-compacts at the worst possible moment, and the agent loses the thread mid-task.
- **It overwrites files it should not**, and nobody finds out until the diff.

None of these are model problems. They are *process* problems, and process is exactly what code-conductor installs.

| Without code-conductor | With code-conductor |
|---|---|
| Free-form prompt, then the agent guesses, overwrites, drifts | `/cc-spec`, approved spec, `/cc-plan`, confirmed steps, implement |
| Full files read on every turn | **Guards deny mass reads before they run**: memory first, then grep, then a bounded read |
| Conventions re-explained every session | Project memory and the detected stack loaded at session start |
| Context fills up until it breaks | A turn counter warns at 80%, and `/cc-compact` snapshots state before you compact |
| Verbose markdown handoffs eat context | **SNAP**: minified single-line JSON handoffs, schema-validated by `scripts/snap-validate.mjs`, at least 15% smaller than the markdown snapshot they replaced |
| Hand-tuned CLAUDE.md per project | **Stack auto-detection** fills in your build/test/lint/format commands from `package.json`, `go.mod`, `Cargo.toml` and friends |

---

## Quickstart

Three commands, from nothing to a guarded session. The output below is **real**, captured by running exactly these commands in a scratch directory.

**Minimum safe version: `1.34.4`.** Older versions can strip or damage an existing `CLAUDE.md`: every release before `1.24` overwrote it with no backup, `1.24` through `1.34.3` silently removed your sections whose headings matched the managed block's, and an older pre-sentinel version left at least one field file with damaged lines. Always install `code-conductor@latest`, as below.

```bash
mkdir demo && cd demo && git init -q && npm init -y >/dev/null
npx @yeison.restrepo.r/code-conductor@latest --project
```

The installer prints **nothing** and exits 0. That silence is deliberate and is asserted by a test: the stub-detection check runs *before* the seed, so a fresh scaffold cannot warn about the file it was just given (`tests/installer/deploy.test.js`, "says nothing on a fresh scaffold, whose stub it just wrote").

You now have `.claude/` with `commands/`, `hooks/`, `memory/`, `scripts/` and `settings.json`, and the guardrails are already live. The third command is any command at all:

```bash
# scene 1: a mass content dump is denied, with a message that says what to do instead
cat *.ts
```

```
BASH SCAN BLOCKED. The command triggered a mass content-dump pattern. Pattern ids: P4.
Authorized alternatives: 1. Grep for targeted content search with file and pattern scope.
2. Glob for path listing without file content. 3. Read with an explicit offset and limit.
A permanent exception is operator policy, not a self-serve step: entries live in
.claude/memory/bash-scan-allowlist.txt, are reviewed in git, and an agent may propose one
but must not add it to clear its own denial.
```

```bash
# scene 2: the targeted form runs with no friction
grep -n 'export' src/index.ts
```

Nothing is printed by the hook. The command runs.

Commit `.claude/` to your repository and your whole team gets the same workflow, the same guardrails and the same shared memory.

### Dependencies

code-conductor assumes these are already in place; the installer does not set them up for you:

| Dependency | Required for | How to get it |
|---|---|---|
| Node.js `>= 20` | Running the `code-conductor` CLI itself | Any current Node LTS |
| Claude Code | The environment every command, skill and hook here runs inside | See Anthropic's Claude Code docs |
| **superpowers plugin** | `/cc-spec` (`brainstorming`), `/cc-plan` (`writing-plans`), and `/cc-debug`, `/cc-refactor`, `/cc-review`, `/cc-test` (all four via `subagent-driven-development`) | Install from Claude Code's `/plugin` marketplace, then run `/reload-plugins`, **before** using these commands; without it, their `Skill(...)` calls fail |
| GitHub CLI (`gh`), authenticated | Only `/cc-orchestrate --ticket` and `ticket.mjs writeback`. code-conductor holds no credential; `gh` owns authentication | Install GitHub CLI, then run `gh auth login` |
| ui-ux-pro-max skill | Nothing: retired guidance | No shipped code downloads, installs or activates it. Its replacement is filed as `[FEAT-037]` |

---

## The ideal workflow, day to day

A typical session looks like this:

```
/cc-resume            # restore context: memory, latest spec/plan, git state, detected stack
/cc-spec user-auth    # agent searches the codebase, asks only for what is missing,
                      # writes a full spec, and WAITS for your approval
/cc-plan              # from the approved spec: ordered tasks with exact file paths,
                      # tests, commit order and risks. You approve again.
/cc-implement         # executes tasks one at a time, flipping [ ] to [>] to [X],
                      # without ever re-reading the whole plan
/cc-checkpoint        # writes decisions, conventions and debt to memory
/cc-compact           # snapshots phase state to a one-line JSON, then you /compact safely
```

The key idea: **nothing gets built until a human approved what will be built.** The spec gate and the plan gate are cheap, a page of markdown to review, and they eliminate the single most expensive failure mode of AI coding: perfectly executed solutions to the wrong problem.

Two things make this cheaper than it sounds:

- **Every phase opens with a resume read.** `/cc-spec`, `/cc-plan` and `/cc-implement` restore any context stored for the current git commit, so work survives branch switches, rollbacks and multi-day gaps (see [Local state cache and session persistence](#local-state-cache-and-session-persistence)).
- **Memory does the remembering.** Decisions land in `.claude/memory/project.md` (committed, shared with the team) and preferences in `~/.claude/memory/personal.md` (local). The next session reads them instead of asking you.

---

## Walkthrough: hands-off delivery with `/cc-orchestrate`

For a well-defined backlog item, you do not have to drive every phase yourself. The orchestrator routes the item through **Define, Build and Verify** using five role agents (`spec`, `plan`, `code`, `audit`, `qa`), each boxed in by its own scope envelope.

Launch Claude Code with the shipped review-loop exception, so the define review loop runs with zero owner wakes:

```bash
claude --permission-mode auto --settings .claude/review-loop.settings.json
```

Then, inside the session:

```
/cc-orchestrate FEAT-123
```

What happens:

1. **Start.** The orchestrator resolves your project's test command and records it in the run file. That exact command, and nothing else, is the only shell access the build roles will have. It is the package manager's `test` invocation when a root `package.json` has a `test` script (`npm test`, `pnpm test`, `yarn test`, or `bun run test` by lockfile, and `npm test` with none), detect-stack's test command when there is no `package.json`, and otherwise a halt (`ORCH_TEST_COMMAND_UNRESOLVED`). A resolved command carrying a chaining character halts too (`ORCH_TEST_COMMAND_UNSAFE`), so nothing is recorded that Guard 7 would deny.
2. **Define.** A `spec` agent writes the spec. Before you approve it, a review loop runs: a fresh read-only `define-review` agent checks it against a declared checklist and sends open rows back to the author (see [Review loop configurations](#review-loop-configurations)). Then the same happens for the `plan` agent. **Both documents pause for your explicit approval**, shown with their SHA-256 hash and re-hashed immediately before approval, so what you approved is what ships.
3. **Build.** A `code` agent is dispatched once per plan task, serially. For each role the orchestrator builds, validates (`snap-validate --to`) and installs a SNAP v3 band envelope, dispatches the agent named after the role, waits for its completion notice, and checks the one `SNAP_HANDBACK` line of its hand-back before the next. A wall of prose never reaches your context.
4. **Verify.** An `audit` agent reviews the work statically, then a `qa` agent runs the recorded test command. `qa` cannot write files (enforced by Guard 5), so it only ever tests code it did not write.
5. **Report.** You get every hand-back, both approvals and each review-loop outcome. **Release stays human.**

Useful variations:

- `--auto` skips the pause between role dispatches. The spec and plan approvals always pause.
- `--ticket 42` (or an issue URL) binds the run to a GitHub issue. `start` fetches it once through `gh`, halts on a pull request, a closed issue, or an empty or over-65536-byte body, and writes the body into a fenced, hashed snapshot at `.conductor/ticket/<ITEM>.md`, which **only the spec role reads, as untrusted requirement input**. After release, the owner runs `node .claude/scripts/ticket.mjs writeback <ITEM> --version <v> --pr <N|url> [--changelog <file>] [--close]`, which posts one outcome comment to the bound issue, never twice for the same version, and closes it only with `--close`.

What it needs: agent definitions named `spec`, `plan`, `code`, `audit` and `qa` in `.claude/agents/` or `~/.claude/agents/` (they ship from `1.37.0`); a resolvable test command, as above; and plans in the writing-plans format (`### Task N` with a `**Files:**` block). A failed validation halts the run, terminally in this version: recover with `end`, then `start`.

While a run is live, hooks enforce the boundaries: the orchestrator itself cannot write tracked files, role agents can only write inside their envelope, and only the orchestrator can dispatch agents. These are process guardrails for cooperative agents, not a security sandbox; see [What this is not](#what-this-is-not) and [Known limits](#known-limits).

### Review loop configurations

Before each define approval, `/cc-orchestrate` runs a review loop (`[FEAT-041]`): a fresh read-only `define-review` agent checks the spec or plan against a declared checklist, and while rows stay open the orchestrator sends them back to the role that wrote the document, up to three reviewer passes and two revisions. It is advisory: it never gates, never halts the run, and never replaces your approval, which only a message you send gives. What a round costs depends on how you launched Claude Code, measured on `claude` 2.1.292:

| Configuration | Per round |
|---|---|
| Auto mode with the shipped exception: `claude --permission-mode auto --settings .claude/review-loop.settings.json` | 0 owner wakes, 0 prompts |
| Default (ask) permission mode | 0 wakes; one approval per revision write, plus the orchestrator's `review` calls and report writes |
| Plain auto mode | the auto mode classifier denies the first revision request; the loop closes `skipped:denied`, and you get round 1's findings, unrevised |

`.claude/review-loop.settings.json` holds one auto mode allow rule that names this protocol. The installer never writes `autoMode` into `~/.claude/settings.json`, and Claude Code ignores `autoMode` in project settings, so the rule applies only when you pass the file yourself. Read it before you pass it: a cloned repository could ship a different file under the same name.

---

## Walkthrough: diagnosis before surgery with `/cc-debug`

Most AI debugging goes: paste the error, watch the agent grep around, accept whatever fix it lands on. `/cc-debug` replaces that with a method:

```
/cc-debug "checkout total is wrong when a coupon is applied twice"
```

1. **Characterize first.** The agent states the symptom, expected behavior, reproduction steps, frequency and context, before touching anything.
2. **Hypothesize.** It lists 2 to 4 root-cause hypotheses **ordered by probability** and asks which to investigate first. You stay in control of where the tokens go.
3. **Investigate surgically.** Sub-agents do the digging with grep and `git log`; whole files are never read inline, and raw file contents never flood the main context. For visual or UI bugs, it offers to inspect through Playwright MCP.
4. **Report with evidence.** Root cause at `file:line`, why it happens, what else could be affected, and the exact proposed change.
5. **Fix only after you confirm.** The fix passes an adversarial resilience check (does it introduce a silent failure? a new boundary condition?) before it is applied. Afterward, it suggests the test that would have caught the bug.

The result is a debugging session that reads like an incident write-up, not a casino.

---

## Where the token savings come from

Claude Code is priced in tokens, and unstructured sessions waste them in predictable ways. code-conductor attacks each one:

| Mechanism | What it does |
|---|---|
| **memory-first lookup chain** | Before reading any file, the agent checks project and personal memory, then grep/glob, and only then does a targeted read, always bounded, max 150 lines. |
| **Guard 1: large-file reads** | A `Read` of a file over 150 lines with no `limit` is **denied before it runs**, with a redirect to the lookup chain. |
| **Guard 3: mass content dumps** | Every Bash command is scanned against twelve dump patterns (`cat *.ts`, unbounded `find`, recursive match-all greps, shell read-loops and more) and denied with a targeted alternative. In one measured real-world session it caught **47 denial events across 43 unique commands**. |
| **Guard 4: node_modules** | Reads into `node_modules` are denied outright. Your context window is not for vendored code. |
| **Agent delegation** | Exploration runs in sub-agents that return a summary of at most 200 words. Intermediate data never enters the main context. |
| **SNAP handoffs** | Phase state is serialized as minified single-line JSON, schema-validated, at least 15% smaller than the markdown format it replaced. |
| **Context turn counter** | A hook counts turns and warns at 80% of a configurable threshold, then flags critical, so you compact on *your* schedule, at a phase boundary, with state snapshotted, instead of letting auto-compact shred the session. |
| **Verbosity control** | Responses default to `MIN` (one sentence plus a change list). A hook re-injects the level every turn so it never drifts as the window fills. `INFO` and `VERBOSE` are available per install. |

---

## Guard 3, and what it learned

Guard 3 scans every Bash command for **mass content dumps**: `cat *.ts`, `find` without a depth bound, a pager over a glob, a shell loop reading files. It denies before the command runs and names an alternative. It is not a sandbox and not a security boundary (see [What this is not](#what-this-is-not)).

The interesting part is what it got wrong, because that is what the record documents.

**It read quoted content as code.** A grep pattern, a commit message, an English sentence with a period: all scanned as though they were shell. Fixed in `1.31.x` by masking quoted spans before the checks, with two checks kept unmasked on purpose because a grep pattern and an alias value are the data those checks exist to read.

**It read heredoc bodies as code.** Writing a file whose content contained `[`, `?`, a `$(...)`, or an odd number of apostrophes was denied by patterns written to catch *reads*. Four specimens accumulated across four consecutive working sessions before it was fixed in `1.33.0` by giving both scanners a sixth state. The argument is one sentence: **a heredoc body is content being written and is already inside the command string the scanner is holding, so it cannot flood anything.**

### The honest numbers

Every figure here is cited, and none of them is rounded in the project's favour.

| measurement | value | source |
|---|---|---|
| Guard 3 denials recovered from one real working session | **47 events, 43 unique commands** | `.claude/memory/project.md:991` |
| ...of which flipped `deny` to `allow` after the `1.31.x` fixes | **36 of 43** | same table |
| unplanned regressions from those fixes | **0** | same table |
| this session's own denials, replayed verbatim against today's hook | **3: one now allowed, two still denied** | reproducible, below |
| ...of the two still denied, the guard being **right** | **1** (a genuine shell loop) | corpus control row |
| ...the guard being **wrong** | **1** (a surviving `P7` parity inversion) | recorded in `[BUG-041]`'s entry |

The population in row 1 grew from 41 to 43 *mid-measurement, because two of the scripts written to perform the measurement were themselves denied by the bug they were measuring.* That sentence is in the record, not in the marketing.

**One known false positive remains**, and it is named rather than buried: a mixed `grep` with pager pipelines still denies under `P7`. It is the residual the `[BUG-041]` entry describes, where the fragment starts inside an enclosing quoted region and every subsequent quote is parity-inverted.

---

## How it works

code-conductor operates at three layers:

- **Global core** (`~/.claude/`) applies to every project on your machine: the spec-first workflow, token-efficiency rules, safety checks, simplicity rules and memory conventions. Installed once; always active.
- **Project template** (`.claude/`) lives in your repository and is shared with your team through git: project slash commands, write-guarding hooks, role agent definitions and the shared memory file for decisions, conventions and technical debt.
- **Dynamic stack discovery and skills.** `/cc-stack` runs the bundled `detect-stack.mjs` scanner and writes your detected build/test/lint/format commands, plus a concise generated ruleset, straight into your project `CLAUDE.md`, so the agent never guesses them. Skills enforce cross-cutting behavior (code simplicity, adversarial self-review, verbosity, memory-first, delegation) in every session.

---

## Command reference

All commands are tagged `(Conductor)` in the Claude Code command palette, so they are easy to spot alongside commands from other sources.

### Global (all projects)

| Command | What it does |
|---|---|
| `/cc-checkpoint` | Read the current session, extract decisions, conventions and debt, and write them to `project.md` and `personal.md` with a timestamp. Run before `/compact`, after completing a feature, and after key architectural decisions. |
| `/cc-stack` | Run the dynamic detector and write the detected commands and a generated ruleset into your project `CLAUDE.md` (the `- Stack:` line and the `## Active Stack Profiles` block). On later sessions it asks whether anything changed before re-detecting. |
| `/cc-lang [code]` | Switch response language for this session (`en` `es` `pt` `fr` `de` `it` `zh` `ja` `ko`). Code identifiers, filenames and commit messages stay English. |
| `/cc-compact` | Phase-boundary command. Serializes the current phase's essential state (decisions, pending steps, files touched, constraints) into a single-line SNAP JSON snapshot at `.claude/memory/session-snapshot.json` and, on Node `>= 22.5`, a git-hash-keyed row in the local `.conductor/cache.db`, then prompts you to run `/compact`. Run it at the end of every phase. |

### Project (requires `--project` install)

| Command | What it does |
|---|---|
| `/cc-init` | Initialize or re-sync the project environment: detect stack, checkpoint memory, verify hook integrity. Run at the start of every session. |
| `/cc-resume` | Restore full session context in one command: project identity, memory, latest spec and plan, git state and the detected stack. Scans the active plan for `[>]` (interrupted) and `[!]` (failed) task markers and surfaces them. |
| `/cc-spec [name]` | Search the codebase first, ask only for missing context, write a full feature spec, and **wait for your approval** before any plan is made. |
| `/cc-plan` | From an approved spec, map the codebase and write an ordered plan with exact file paths, a test list, a commit order and risks. Every task line carries a unique `[T-NNN]` ID (at least 3 digits, unlimited suffix depth) with plain ASCII checkboxes. |
| `/cc-implement` | Execute plan tasks with a surgical 5-step ritual: grep-locate pending tasks, single-line Read verify, pre-flip `[ ]` to `[>]`, execute, post-flip to `[X]` or `[!]`. Never reads or rewrites the full plan file. Includes dependency evaluation, drift detection, and a Step 6 hook that records each task's final state to the local SQLite cache. |
| `/cc-orchestrate <ITEM> [--auto] [--ticket <N\|issue URL>]` | Route one backlog item through Define, Build and Verify with role agents, validated SNAP envelopes, a review loop and human approval gates. See the [walkthrough](#walkthrough-hands-off-delivery-with-cc-orchestrate). |
| `/cc-review [file\|dir]` | Review in three layers (Critical / Important / Suggestion), deliver a verdict, and offer to auto-fix. |
| `/cc-debug [problem]` | Hypothesis-driven debugging. See the [walkthrough](#walkthrough-diagnosis-before-surgery-with-cc-debug). |
| `/cc-refactor [file\|module]` | Diagnose complexity, plan ordered changes, apply one step at a time, and verify tests pass after each step. |
| `/cc-test [scope]` | Find coverage gaps, write AAA-pattern tests (plus Playwright E2E where applicable), run after confirmation, and report results. |
| `/cc-docs [scope]` | Audit documentation, write inline docs in your stack's format (JSDoc / docstrings / JavaDoc / GoDoc), and preview before writing. |

---

## Skills

Skills extend agent behavior for cross-cutting concerns that apply regardless of stack.

- **code-simplifier (always active).** Applied to every piece of code written or reviewed: no speculative abstractions; functions of at most 30 lines doing one thing; flat over nested, with guard clauses and early returns; descriptive names (no `Base`, `Abstract`, `Manager`, `Handler`); comments explain why, never what.
- **critical-review (always active during implementation).** A 4-phase adversarial protocol: (1) **Pre-Flight**, identifying the happy path, failure points and boundary conditions before any code is written; (2) **Adversarial Review** for RESILIENCE (silent failures), EFFICIENCY (code smells) and FRICTION (happy-path friction); (3) **Self-Correction**, each weakness refactored and re-verified in isolation; (4) a required **`[VALIDATION]`** closing section: edge cases covered, justification, residual risks.
- **verbosity (always active).** Controls how much Claude writes per turn. The level is set at install time with `--verbosity` and stored in `~/.claude/memory/verbosity.md`; the default is `MIN`.

  | Level | Behavior |
  |---|---|
  | `MIN` | One declarative sentence. `[CHANGES]` tag with file list only. |
  | `INFO` | Bullet list of what changed and why, at most 5 bullets. `[CHANGES]` + `[REASON]`. |
  | `VERBOSE` | Full explanation, prose allowed. All response tags. |

- **memory-first (always active).** Before reading any file, Claude walks a lookup chain and stops at the first step that answers: (1) memory, both `.claude/memory/project.md` and `~/.claude/memory/personal.md`; (2) Grep / Glob; (3) a targeted read, last resort, always with `offset` + `limit`, at most 150 lines.
- **agent-delegation (always active).** Keeps the main context clean. Sub-agents handle exploration and parallel work and return a summary of at most 200 words; raw file contents and intermediate data never enter the main context.
- **ui-ux-pro-max (retired guidance, pending `[FEAT-037]`).** Earlier releases described this skill as installed from GitHub and switched on when `/cc-stack` detects a frontend stack. No shipped code does either. The `CLAUDE.md` templates still name it; `[FEAT-037]` replaces it with a frontend design skill stack, and this entry changes when that ships.

---

## Guardrails (hooks)

Hooks run automatically at specific points in a Claude Code session and need no manual setup. The pre-tool-use front door is a single zero-dependency Node script (`pre-tool-use.mjs`): it fires before `Read`, `Write`, `Edit`, `create_file`, `write_file` and `Bash`, reads the `PreToolUse` payload from stdin, dispatches on `tool_name`, and returns its verdict as `hookSpecificOutput.permissionDecision`. Every path exits 0: a denial is data, never a crash.

| Guard | Fires on | What it enforces |
|---|---|---|
| **1: Large-file read** | `Read` | A file over 150 lines needs an explicit `limit`; otherwise denied with a redirect to memory, grep, then a bounded read. |
| **2: Duplicate write** | `Write`, `create_file`, `write_file` | Writing to an existing path asks first, showing the path, line count and last-modified time: edit in place, confirm the overwrite, or cancel. `Edit` is deliberately not gated, because editing in place is what this guard recommends. |
| **3: Bash scan** | `Bash` | Twelve mass content-dump patterns denied before execution. Commands over 8192 characters and unclosed quotes are denied fail-closed. |
| **4: node_modules** | `Read` | A path carrying `node_modules` as an exact path component is denied, with backslashes and `..` resolved first. Use Glob for existence checks. |
| **5: Band scope** | role-agent writes | During orchestration, a band role can only write inside its installed envelope's scope. |
| **6: Orchestrator writes** | live orchestrate runs | The orchestrator session can only write its own run-state surface; nested agent dispatch is denied. |
| **7: Role shell** | role-agent `Bash` | `spec`, `plan` and `audit` get no shell; `code` and `qa` may run exactly one command, the recorded test command, byte for byte, no chaining. |

**Guard 3 in detail.** The twelve patterns are: deep `find` without `-maxdepth 1`, `find -exec` with readers or shells, `xargs` with readers, `cat` or a pager followed by an unquoted glob, command substitution as a reader's argument, `grep -r` with a match-all pattern, `ls -R`, shell loops, `mapfile` and `readarray`, `eval`, `source` and the dot operator, alias remapping to a reader, and obfuscation sequences.

Permanent exceptions live in `.claude/memory/bash-scan-allowlist.txt`, one entry per line, blank lines and `#` comments ignored and whitespace trimmed. An entry ending in `/` covers paths under that prefix, rejecting any suffix that walks up the tree with `..`; any other entry matches a whole command token. **Entries match literally: regex metacharacters carry no special meaning, so `file.ts` matches `file.ts` and nothing else.** The installer ships this file once as a commented template and creates it only when it is absent; it never overwrites an existing one. Every line in it disarms patterns for matching commands, so give each entry a comment saying why it exists; an uncommented entry is a review smell. An agent may *propose* an entry but must never add one to clear its own denial.

Hit a block you believe is wrong? Re-run the command with `CC_GUARD3_WARN=1` and the guard asks instead of denying, carrying the same pattern ids. That is a triage aid for reporting a false positive while you keep working, not a configuration mode: the allowlist is the sanctioned permanent exception. The variable affects Guard 3 alone.

**Guard 5 in detail.** A `Write`, `Edit`, `create_file` or `write_file` from a subagent whose `agent_type` names a band role (`spec`, `plan`, `code`, `audit`, `qa`) is checked against the nearest `.claude/memory/band-envelope.json` above its working directory, a SNAP v3 envelope. A malformed envelope, an agent that is not the envelope's role, a role not holding `RW`, or a path outside the envelope's `scope` globs (anchored at the band root, the directory whose `.claude/` holds the envelope) is denied with a named reason. The main session, any other agent, and any project without an envelope are untouched. It assumes cooperative agents: `agent_type` is a name taken on trust, and `Bash`, `NotebookEdit`, MCP write tools and symlinked paths are not covered.

**Guard 6 in detail.** While a `/cc-orchestrate` run is live, its run file `.claude/memory/orchestrator-run.json` binds it to one session by `session_id`. In that session, a `Write`, `Edit`, `create_file` or `write_file` from anything but a band role (the main session, a payload carrying only `agent_id`, any other agent) is denied with `ORCH_WRITE_DENIED` unless its target lies inside the orchestrator's write surface, anchored at the run root: `.claude/memory/orchestrator-run.json`, `.claude/memory/band-envelope.json`, `.claude/memory/session-snapshot.json` and `.conductor/**`. Band roles stay under Guard 5. A run file from another session is stale and an unreadable one is invalid: both warn (`ORCH_RUN_STALE`, `ORCH_RUN_INVALID`) with the cleanup command and never block. While the run is live, a subagent's `Agent` or `SendMessage` call is denied with `ORCH_NESTED_DISPATCH`, so only the orchestrator dispatches or messages agents (R7; the hook's matcher names both tools). Outside a live run there is no Guard 6. Its limits are listed under [Known limits](#known-limits).

**Guard 7 in detail.** A `Bash` call from a subagent whose `agent_type` names a band role is decided before Guard 3, so Guard 3's `CC_GUARD3_WARN` ask can never outrank it. `spec`, `plan` and `audit` have no shell (`ROLE_SHELL_DENIED`). `code` and `qa` may run exactly one command, byte for byte: the `test_command` that `orchestrate.mjs start` recorded in the run file of a run live in their session. A command carrying `;`, `&`, `|`, a backtick, `$(`, `<`, `>` or a line break is denied first (`ROLE_SHELL_CHAINING`). No run file, a run of another session, or no recorded command is denied (`ROLE_SHELL_UNRESOLVED`), and any other command is denied naming the allowed one (`ROLE_SHELL_NOT_ALLOWED`). An error inside the guard denies too, and `CC_HOOK_ALLOW` does not reach it. The main session and every other agent are untouched.

**Unparseable input fails closed.** It is denied with one stderr line naming `CC_HOOK_ALLOW=1`, which overrides that denial alone and leaves every guard fully active on every payload the hook can read. Set `CC_HOOK_DEBUG=1` to see the diagnostic lines it otherwise swallows.

### The other hooks

- **context-guard** (global + project). Fires on every `UserPromptSubmit` and atomically increments a turn counter in `.claude/memory/turn-count.txt`. At 80% of the threshold it emits a CONTEXT WARNING; at or above the threshold, CONTEXT CRITICAL. The threshold is read from `.claude/memory/context-threshold.txt` (default 25). Ships for Unix (`context-guard.sh`) and Windows (`context-guard.ps1`). `CC_GUARD_DEBUG=1` prints debug info to stderr; `CC_PROJECT_ROOT` overrides the project root used for the memory directory.
- **post-compact.** Fires after `/compact`. Resets the turn counter to 0, reads `project.md`, shows the timestamp of the last `/cc-checkpoint`, and reminds you to checkpoint if this session's context has not been saved. Ships for Unix and Windows.
- **verbosity-remind** (global + project). Fires on every `UserPromptSubmit` and re-injects the active MIN/INFO/VERBOSE constraint, so the level does not drift as the window fills (BUG-014). The global hook defers to a project-level hook if one exists (upward traversal from `$PWD`), and the level is read from the nearest `.claude/memory/verbosity.md` ancestor file. Set `CC_VERBOSITY_SKIP=1` to disable it in CI/CD.

  When `$HOME` is unset (some CI containers, `sudo -H` shells, minimal Docker images), `verbosity-remind.sh` exits 0 with no output and Claude falls back to MIN. Set `HOME` to the appropriate home directory in the container to restore full hook behavior. The hook never raises an error when `$HOME` is absent, so your session is never blocked.

---

## Memory architecture

```
~/.claude/memory/
  personal.md      local only, never committed: your preferences and shortcuts
  verbosity.md     agent-managed, set by the installer: active MIN/INFO/VERBOSE level

<project>/.claude/memory/
  project.md       in git, shared with the team: decisions, conventions,
                   debt, workarounds
```

`/cc-checkpoint` writes to both. Run it before `/compact`, after completing a feature, and after any key architectural decision. The payoff compounds: every decision captured once is a conversation, and a few thousand tokens, the team never has again.

### Local state cache and session persistence

On top of the markdown memory, `/cc-implement`'s Step 6 hook records each task's final state to a local SQLite cache at `.conductor/cache.db`, written by the bundled `scripts/conductor-db.mjs` engine, a zero-dependency ES module wrapping Node's built-in `node:sqlite`.

- **Schema (v2, ARCH-008):** `task_state(plan_file, task_id, state, updated_at)` keyed by `(plan_file, task_id)`, with `plan_file` normalized to a repo-relative POSIX path so the same plan de-duplicates across working directories; plus `sessions`, `snapshots` (one verbatim SNAP blob per git commit, newest wins) and `raw_history`. Upserts on every write.
- **Runtime-gated:** `node:sqlite` needs Node `>= 22.5`, so every caller probes the Node version and self-disables below it. `engines.node` stays `>=20`; the cache is an optimization, never a requirement.
- **Non-authoritative and fail-safe:** the plan markdown and the `.claude/memory/session-snapshot.json` handoff remain the sources of truth. Every failure path (absent `node:sqlite`, a corrupt or non-regular file at the db path, `SQLITE_BUSY`, a newer schema, CLI misuse) degrades to a single `CONDUCTOR_DB:` stderr line and exit 0. A corrupt db is renamed aside, never deleted, and recreated.
- **Gitignored:** `.conductor/` is local-only and never committed.

**Phase-entry resume.** `/cc-spec`, `/cc-plan` and `/cc-implement` open each phase by running `scripts/resume-read.mjs`, which resolves the current git commit hash and restores any context stored for it, surviving branch switches and rollbacks. A valid DB snapshot for the commit wins; otherwise it falls back to the `.claude/memory/session-snapshot.json` handoff written by `/cc-compact`. A hit prints a `RESUME_HIT` block the command adopts as its starting context; a clean miss proceeds fresh; a readable-but-corrupt handoff halts the phase (exit `4`) with a `SNAP_INVALID` notice so you can inspect it. This completed the **ARCH-008** milestone: relational schema (v1.20.0), checkpoint/compact writers (v1.21.0), phase-entry readers (v1.22.0).

---

## Install

**Minimum safe version: `1.34.4`.** Older versions can strip or damage an existing `CLAUDE.md`: every release before `1.24` overwrote it with no backup, `1.24` through `1.34.3` silently removed your sections whose headings matched the managed block's, and an older pre-sentinel version left at least one field file with damaged lines. Install `code-conductor@latest`, as below.

```bash
npx @yeison.restrepo.r/code-conductor@latest             # one-shot global setup
# or
npm install -g @yeison.restrepo.r/code-conductor && code-conductor
```

**Add to a project.** `--project` performs the global setup **and** scaffolds the project template in one call; there is no separate step to run first:

```bash
npx @yeison.restrepo.r/code-conductor@latest --project   # global setup + scaffold ./.claude
```

By default, the installer installs only the global core files. Flags extend that:

| Flag | Description |
|---|---|
| `--project` / `-Project` | Also install the project template into the current directory |
| `--no-deps` / `-NoDeps` | Skip dependency installation (Node tooling, Playwright MCP, plugins); copy agent files only |
| `--verbosity MIN\|INFO\|VERBOSE` / `-Verbosity` | Default response verbosity (default `MIN`). `MIN` = one sentence per response, `INFO` = bullet list, `VERBOSE` = full explanation. Re-run the installer to change it. |

**Updating:** re-run the same install command. User-configured files are never overwritten; agent-managed files are always updated.

Two cautions:

- Do **not** clone this repository under a directory named `node_modules`. Guard 4 checks path components and will block agent `Read` calls on its source files.
- `--project` refuses to run in a directory whose `package.json` names this package, such as a clone of this repository (`[BUG-052]`, fixed in `1.39.1`): the installer exits 1 before writing anything, global half included, because its project half would land on its own source tree.

### How the installer treats your CLAUDE.md

`CLAUDE.md` and `.gitignore` are **merged**, never overwritten. Everything else the installer ships (`settings.json`, hooks, commands, `scripts/`) is replaced on every run.

- **code-conductor owns one block and nothing else.** Its content lives between `<!-- cc:managed:start -->` and `<!-- cc:managed:end -->`, and those two markers alone decide ownership; a heading's name never does. Every upgrade replaces the block's contents wholesale, so released improvements reach existing installs. Edits inside the block are lost, and recoverable from the backup.
- **Everything outside the block is yours, byte for byte.** Nothing outside it is removed, rewritten, reordered or added.
- **A file without the markers gets the block appended at the end**, after one blank line and in your file's line endings, and nothing else changes. If your file already has sections named like the block's (`## Agent Identity`, `## Hard Constraints` and so on), you will see both: yours above, code-conductor's inside the block. That is deliberate. The installer never decides which of your sections are really its own; reconciling them is planned for `/cc-stack` as `[FEAT-040]`.
- **Before any change, the installer copies your file to `CLAUDE.md.installer-backup.<UTC timestamp>`**, keeps the five most recent, and prints where it put it:

  ```
  code-conductor: backed up CLAUDE.md to CLAUDE.md.installer-backup.20260930T120000Z before merging (git-ignored by design)
  ```

  Backups are git-ignored so nobody commits one by accident and they stay out of every teammate's `git status`; the printed line is how you find yours. A fresh install, and a re-run that changes nothing, print nothing.

The same rules apply to `~/.claude/CLAUDE.md`, whose backup line names the `~/.claude/` path. If your file ends inside a code fence that is never closed, the installer leaves it untouched with a warning, because a block appended there would be hidden inside the fence.

If the markers in your file are damaged (a `start` with no `end`, two blocks, an `end` before its `start`), the installer prints a warning, leaves the file completely untouched, and finishes the rest of the install. Fix the markers and re-run.

### The .gitignore block

When installed with `--project`, the installer keeps its rules in one labelled block in your project's `.gitignore`:

```
# Code Conductor (added by the installer; safe to keep)
.claude/memory/turn-count.txt
*.installer-backup.*
*.installer-tmp.*
.claude/memory/band-envelope.json
.claude/memory/orchestrator-run.json
.conductor/
```

The block ends at the first blank line. Your own lines are never edited. A line that is exactly one of these rules (earlier versions appended them one at a time) is moved into the block, so each rule appears once; a line you changed, such as `/.claude/memory/turn-count.txt`, is not an exact match and stays where it is. If your `.gitignore` has any `!` line, nothing is moved, because moving a rule past a `!` can change what is ignored: the block then holds only the rules you lack, and the installer says so. A change to `.gitignore` is backed up and reported exactly as for `CLAUDE.md`.

The backup and temp rules keep the installer's own backups and crash-stranded temp files out of `git status`; the rest keep orchestrator run state and the local cache out of commits. The rules ship inside the package as `project-template/gitignore` (no leading dot) because npm strips any file literally named `.gitignore` from every published tarball; the installer restores the dot when it writes to your project.

---

## What this is not

- **Not a sandbox and not a security boundary.** The guards are advisory tooling against context exhaustion and sloppy habits, built for cooperative agents. They do not contain a hostile process and were never built to.
- **Not a model.** It is configuration, hooks and scripts around Claude Code.
- **Not finished.** See the limits below.

## Known limits

- **The orchestrator (`1.36.0`) assumes cooperative agents.**
  - Guard 6 does not cover `Bash` writes, `claude -p` children included.
  - Inside a live run, a non-role agent the main session dispatched may write the orchestrator's write surface, the band envelope included.
  - R7 protects live runs only.
  - An agent writing after its hand-back is bounded only by the envelope in force, so a same-role next task inherits it.
  - Under auto permission mode no human stands behind a Bash write or a hook `ask`.
  - A Guard 6 warning reaches you, never the model's tool result, and not in every case. Measured on `claude` 2.1.287:

    | Channel | Permission mode | A prompting decision rides along | You see the warning |
    |---|---|---|---|
    | stderr | `auto` | no | no |
    | `systemMessage` (Guard 6's channel) | `auto` | no; a hook `ask` does not prompt under `auto` | yes, behind `PreToolUse:Write says: ` |
    | `systemMessage` | `default` | no | yes, in full |
    | `systemMessage` | `default` | yes, for example Guard 2's overwrite prompt | no: the warning is lost |
  - Agent definitions provided by plugins are not searched.
  - A halted run cannot be resumed, only ended and restarted.

  The five role agent definitions it dispatches ship from `1.37.0`; their limits are the next item.
- **The role agents (`1.37.0`) are bounded by their tool masks, and Guard 7 bounds one thing beneath them: the shell.**
  - `qa`'s test command is enforcement: Guard 5 keeps qa from writing, so qa only ever runs files it did not write. `code`'s identical allowance is process discipline, not a security boundary, because code writes the tests that command runs.
  - The profiles are live in this repository, because the mirror convention puts them in `.claude/agents/`. The standing rule forbids starting an orchestrator run here; it does not forbid the files being present. A role dispatched by hand through `/agents` or `Agent` creates no band envelope, so Guard 5 allows every write its mask holds, which is `[ARCH-010]`'s no-envelope rule. Guard 7 still denies it the shell. This is named, not fixed.
  - Installing or updating copies `.claude/agents/{spec,plan,code,audit,qa,define-review}.md` over the host project's files of the same names, as it does every shipped `.claude/` asset.
  - A gate certifies protocol position and the claim its role states, never the truth of the work beyond that claim.
- **The review loop (`1.39.0`) is process discipline.** The spec or plan envelope stays installed after its hand-back, so the role can revise. Outside a round, its writes are bounded by its tool mask, Guard 5's scope, the re-hash before `approve`, and your review. Gating Guard 5 on an open round is a follow-up candidate.
- **`[BUG-055]`, open:** detect-stack exits 0 with `{}` when a truthy non-string `package.json` `description`, or a truthy non-string script with no detector matched, crashes it; when a detector matches, a non-string script or `name` passes through raw. Until it is fixed, keep `name`, `description` and the `build`/`test`/`lint`/`format` scripts as strings, or `/cc-stack` reports no stack.
- **The `P7` false positive** described under [Guard 3, and what it learned](#guard-3-and-what-it-learned), still live.
- **A re-run against an untouched `project.md` prints a recovery hint it cannot prove is needed.** If you install, never write anything into `.claude/memory/project.md`, and install again, you get a line suggesting the file may have been overwritten by a pre-`1.30.0` re-run. It was not; it equals the stub because it was seeded and never edited. The check compares content and **cannot distinguish "seeded and untouched" from "clobbered"**, which is why the wording is hedged to "may have been" rather than "was". This residual is named and accepted in [`BUG-039`'s spec at `:129`](docs/superpowers/specs/2026-09-27-bug039-installer-host-owned-state-design.md), where the alternative (restoring from the host's own git history) was rejected as writing host files out of the host's history with new failure modes. A **fresh** install is silent, which the Quickstart shows.
- **Three open dossiers**, which are the evidence-collection pipeline working rather than a backlog: a session denial tally, one for interleaved-artifact reports, and an intermittent commit-hook hang in the `snap-build` suite. A dossier holds specimens until a mechanism is characterized by probe; an id is minted only when the written condition is met. `[BUG-047]` is what that pipeline produces when it completes: an out-of-scope note, then a dossier, then four specimens across four sessions, then a mint, then a release.

**The living artifact is [`AGENT-READABLE BACKLOG.md`](AGENT-READABLE%20BACKLOG.md).** It is not a tidy issue list. It carries amendments above the text they amend, premises that measurement later corrected, and wrong guesses recorded beside the probe that overturned them. If you are evaluating this for a team, that file is the best due-diligence read in the repository.

---

## Instruments: releases that verify their own record

Four checks live in `tools/` as tracked repository infrastructure. Three of them run on every pull request, so a divergence blocks the merge rather than waiting for someone to remember, and the fourth is a query run by hand:

- **`version-gate.mjs`** takes `VERSION` as the authority and checks four other locations against it, five in all. Agreement reports as agreement, which sounds trivial until you learn that its predecessor reported `FAIL` on five locations that agreed, because it compared against a literal frozen two releases earlier. It runs at the merge gate through `tests/tools/repo-invariants.test.js`, and by hand at closeout.
- **`record-parity.mjs`** asserts that every item the `CHANGELOG` claims has a closed backlog entry naming the version it shipped in. It exists because `[BUG-044]` shipped, was closed out in memory, and left its backlog entry reading `[ ]` for an entire release with no instrument comparing the two documents. It runs at the merge gate through `tests/tools/repo-invariants.test.js`, and by hand at closeout.
- **`skip-baseline.mjs`** asserts each CI leg's exact skipped-test set against `tools/skip-baseline.json`, where every set is copied from that leg's own run rather than typed. It runs directly in `.github/workflows/test.yml` on the Node 20 and Node 24 legs, after the suite. It exists because CI was green with 96 tests skipped on Node 20 against 12 locally, and nothing asserted either number.
- **`id-ceiling.mjs`** reports the highest filed id over the working tree **union** `origin/main`, counting only filed headings. Its predecessor counted id-shaped tokens anywhere, so it once read a plan file's prediction of its own output back as evidence. It is local-only by ruling: a person or agent runs it, over both legs, before minting an id. Its remote leg needs history the CI checkout does not fetch, so CI asserts only its duplicate-free half.

**The example worth checking.** `[BUG-046]`'s own release ran those instruments against itself, then proved the green rather than trusting it: with the item's backlog heading deliberately flipped to `[ ]`, `record-parity` reported `FAIL [A] 1.32.2 claims BUG-046 but its heading reads [ ]` once per claim bullet and exited 1; flipped back, `RECORD_PARITY_OK`. The first release whose record cannot silently diverge is the release that made divergence detectable.

`tools/README.md` carries a **registry of five retired instruments**, each with the failure mode that retired it, so the sixth one gets written by someone who has met the list.

---

## Language support

| Priority | Source | How to set |
|---|---|---|
| 1 (highest) | Session | `/cc-lang [code]` |
| 2 | Project | `language:` in project `CLAUDE.md` |
| 3 | Personal | `response_language:` in `personal.md` |
| 4 (default) | Global | English |

**Supported codes:** `en` `es` `pt` `fr` `de` `it` `zh` `ja` `ko`

Code identifiers, file names and commit messages are always English.

---

## File structure

```
code-conductor/
+-- README.md
+-- VERSION
+-- bin/code-conductor.mjs         npm CLI entry (npx code-conductor)
+-- lib/installer/                 CLI modules (env, deploy, settings, merges, heal)
+-- global/
|   +-- CLAUDE.md                  Global agent behavior (all projects)
|   +-- settings.json
|   +-- commands/                  /cc-checkpoint, /cc-stack, /cc-lang, /cc-compact
|   +-- hooks/
|   |   +-- verbosity-remind.sh    Verbosity reminder on UserPromptSubmit
|   +-- memory/
|       +-- personal.md            Template (never committed)
|       +-- verbosity.md           Active verbosity level
+-- project-template/
|   +-- CLAUDE.md
|   +-- gitignore                  Merged into the host project's .gitignore
|   +-- .claude/
|       +-- settings.json          Hooks wiring
|       +-- review-loop.settings.json  Auto mode exception for the review loop (FEAT-041)
|       +-- agents/                Band roles: spec, plan, code, audit, qa (FEAT-012);
|       |                          define-review (FEAT-041)
|       +-- commands/              /cc-init, /cc-resume, /cc-spec, /cc-plan, /cc-implement,
|       |                          /cc-orchestrate, /cc-review, /cc-debug, /cc-refactor,
|       |                          /cc-test, /cc-docs
|       +-- hooks/
|       |   +-- pre-tool-use.mjs   Node front door: Guards 1 to 7
|       |   +-- context-guard.sh   Turn-counter warning (.sh + .ps1)
|       |   +-- post-compact.sh    Checkpoint reminder + cache sweep after /compact (.sh + .ps1)
|       |   +-- verbosity-remind.sh  Project-level verbosity reminder
|       +-- memory/
|           +-- project.md         Shared team memory (in git)
|           +-- bash-scan-allowlist.txt  Guard 3 operator exceptions (commented template)
|           +-- context-threshold.txt    Turn-counter threshold
+-- scripts/
|   +-- conductor-db.mjs           Zero-dep node:sqlite engine (.conductor/cache.db)
|   +-- resume-read.mjs            Phase-entry resume reader (DB snapshot, then handoff)
|   +-- snap-contract.mjs          SNAP limits, caps, field sets, version ceiling
|   +-- snap-build.mjs             SNAP handoff serializer
|   +-- snap-validate.mjs          SNAP schema validator
|   +-- session-id.mjs             Stable session-id resolver
|   +-- orchestrate.mjs            Band router: run file, envelopes, hand-backs (FEAT-011)
|   +-- ticket.mjs                 Ticket intake and writeback through gh (FEAT-031)
|   +-- detect-stack.mjs           Stack auto-detection scanner
|   +-- claude-md-fields.mjs       CLAUDE.md field reader/writer
|   +-- init-wizard.mjs            /cc-init helper
+-- skills/
|   +-- code-simplifier/SKILL.md   Always active: complexity and simplicity rules
|   +-- critical-review/SKILL.md   Always active: 4-phase adversarial review protocol
|   +-- verbosity/SKILL.md         Always active: MIN/INFO/VERBOSE response rules
|   +-- memory-first/SKILL.md      Always active: memory, grep, read chain
|   +-- agent-delegation/SKILL.md  Always active: sub-agent spawn rules
+-- tools/                         Release instruments (repository only, not shipped)
    +-- README.md                  Instrument notes and the retired-instrument registry
```

Claude Code registers personal skills only at `~/.claude/skills/<name>/SKILL.md`, which is where the installer puts them.

---

## Uninstall notes

Hook removal (`rm ~/.claude/hooks/verbosity-remind.sh`) and `settings.json` cleanup work identically in every environment; no git is required.

Uninstall steps that use `git checkout <tag>` or `git revert <sha>` need a git working tree. In CI/CD pipelines, Docker containers, or directories that are not git repositories, they fail with `fatal: not a git repository`. That is expected and non-fatal: in those environments, manually delete or restore `skills/verbosity/SKILL.md` and remove the `verbosity-remind` entry from `~/.claude/settings.json`.

---

## Contributing

GitHub Issues are the inbox: an issue or PR is a candidate until the owner mints it an id. Nothing merges without a minted id and owner review, one item per PR. Versions, release branches, tags and GitHub Releases are owner-only. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR; its hard constraints bind AI agents working on a contributor's behalf as well.

## License

See [LICENSE](https://github.com/yeisonrestrepo/code-conductor/blob/main/LICENSE).
