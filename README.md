# code-conductor

[![npm version](https://img.shields.io/npm/v/%40yeison.restrepo.r%2Fcode-conductor.svg)](https://www.npmjs.com/package/@yeison.restrepo.r/code-conductor)
[![License](https://img.shields.io/github/license/yeisonrestrepo/code-conductor.svg)](https://github.com/yeisonrestrepo/code-conductor/blob/main/LICENSE)
[![GitHub issues](https://img.shields.io/github/issues/yeisonrestrepo/code-conductor.svg)](https://github.com/yeisonrestrepo/code-conductor/issues)

**A governance layer for Claude Code sessions.** Hooks, guards, memory and release discipline that make an agent's work verifiable: what it may run is checked before it runs, what it decided is written where the next session will read it, and what shipped is asserted against the record by instruments that run in CI. It is a spec-first workflow, but the part worth your sixty seconds is that every claim below is checkable against a commit in this repository.

---

## Quickstart

Three commands, from nothing to a guarded session. The output below is **real**, captured by running exactly these commands in a scratch directory.

**Minimum safe version: `1.34.4`.** Older versions can strip or damage an existing `CLAUDE.md`: every release before `1.24` overwrote it with no backup, `1.24` through `1.34.3` silently removed your sections whose headings matched the managed block's, and an older pre-sentinel version left at least one field file with damaged lines. Install with `@latest`, as below.

```bash
mkdir demo && cd demo && git init -q && npm init -y >/dev/null
npx @yeison.restrepo.r/code-conductor@latest --project
```

The installer prints **nothing** and exits 0. That silence is deliberate and is asserted by a test: the stub-detection check runs *before* the seed, so a fresh scaffold cannot warn about the file it was just given (`tests/installer/deploy.test.js`, "says nothing on a fresh scaffold, whose stub it just wrote").

You now have `.claude/` with `commands/`, `hooks/`, `memory/`, `scripts/` and `settings.json`. The third command is any command at all, because the guard is already live:

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
# scene 2: the decomposed form runs
grep -n 'export' src/index.ts
```

Nothing is printed by the hook. The command runs.

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

## Instruments: releases that verify their own record

Four checks live in `tools/` as tracked repository infrastructure. Three of them run on every pull request, so a divergence blocks the merge rather than waiting for someone to remember, and the fourth is a query run by hand:

- **`version-gate.mjs`** takes `VERSION` as the authority and checks four other locations against it. Agreement reports as agreement, which sounds trivial until you learn that its predecessor reported `FAIL` on five locations that agreed, because it compared against a literal frozen two releases earlier. It runs at the merge gate through `tests/tools/repo-invariants.test.js`, and by hand at closeout.
- **`record-parity.mjs`** asserts that every item the `CHANGELOG` claims has a closed backlog entry naming the version it shipped in. It exists because `[BUG-044]` shipped, was closed out in memory, and left its backlog entry reading `[ ]` for an entire release with no instrument comparing the two documents. It runs at the merge gate through `tests/tools/repo-invariants.test.js`, and by hand at closeout.
- **`skip-baseline.mjs`** asserts each CI leg's exact skipped-test set against `tools/skip-baseline.json`, where every set is copied from that leg's own run rather than typed. It runs directly in `.github/workflows/test.yml` on the Node 20 and Node 24 legs, after the suite. It exists because CI was green with 96 tests skipped on Node 20 against 12 locally, and nothing asserted either number.
- **`id-ceiling.mjs`** reports the highest filed id over the working tree **union** `origin/main`, counting only filed headings. Its predecessor counted id-shaped tokens anywhere, so it once read a plan file's prediction of its own output back as evidence. It is local-only by ruling: a person or agent runs it, over both legs, before minting an id. Its remote leg needs history the CI checkout does not fetch, so CI asserts only its duplicate-free half.

**The example worth checking.** `[BUG-046]`'s own release ran those instruments against itself, then proved the green rather than trusting it: with the item's backlog heading deliberately flipped to `[ ]`, `record-parity` reported `FAIL [A] 1.32.2 claims BUG-046 but its heading reads [ ]` once per claim bullet and exited 1; flipped back, `RECORD_PARITY_OK`. The first release whose record cannot silently diverge is the release that made divergence detectable.

`tools/README.md` carries a **registry of five retired instruments**, each with the failure mode that retired it, so the sixth one gets written by someone who has met the list.

---

## What this is not

- **Not a sandbox and not a security boundary.** Guard 3 is advisory tooling against context exhaustion and sloppy habits. It does not contain a hostile process and was never built to.
- **Not a model.** It is configuration, hooks and scripts around Claude Code.
- **Not finished.** See the limits below.

## Known limits

- **`[BUG-045]`, open:** the Guard 3 allowlist cannot cover a quoted path, because the boundary sets it interpolates contain no quote character, so an entry `docs/` does not cover `cat "docs/x.md" *.md`. Filed with its ritual priced, untouched pending its own change.
- **`[BUG-032]`, open:** global memory preferences sit outside the documented lookup chain. Nothing in the chain points at `~/.claude/memory/personal.md`, and the installer never deploys `global/memory/`, so a preference filed there is never read by the agent it was written for.
- **`[BUG-050]`, open:** the release instruments are silent on sub-shaped ids. `tools/record-parity.mjs` and `tools/id-ceiling.mjs` neither read nor reject an id like `[ARCH-008-S1]`, so a release claiming one would pass record parity having read nothing. No shipped release does; releases claim top-level ids until the item's spec chooses its repair.
- **`[BUG-051]`, open:** two shipped commands run `scripts/detect-stack.mjs`, but the installer deploys the detector to `.claude/scripts/`. In an installed project, `/cc-stack` fails loud (`MODULE_NOT_FOUND`, "no stack"), and `/cc-resume`'s blank-command auto-fill silently skips. Until it is fixed, `/cc-init`, which already uses the deployed path, records the stack and commands.
- **`[BUG-052]`, open:** the installer has no self-install guard. Its sweep of the 1.23.2 legacy root `scripts/` matches by exact file list, which the development repository satisfies by identity, so running `--project` inside this repository deletes tracked source. Do not run the installer against a clone of code-conductor itself.
- **`[BUG-053]`, open:** the pre-commit test gate that the retired `install.sh` appended runs `npm test` with git's hook environment. From a linked worktree, git hands hooks an absolute `GIT_DIR` and `GIT_INDEX_FILE`, so the suite's fixture `git` commands write into the real repository's refs, config and index. Do not run the gate from a linked worktree.
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
  - Installing or updating copies `.claude/agents/{spec,plan,code,audit,qa}.md` over the host project's files of the same names, as it does every shipped `.claude/` asset.
  - A gate certifies protocol position and the claim its role states, never the truth of the work beyond that claim.
- **The `P7` false positive above**, still live.
- **A re-run against an untouched `project.md` prints a recovery hint it cannot prove is needed.** If you install, never write anything into `.claude/memory/project.md`, and install again, you get a line suggesting the file may have been overwritten by a pre-`1.30.0` re-run. It was not; it equals the stub because it was seeded and never edited. The check compares content and **cannot distinguish "seeded and untouched" from "clobbered"**, which is why the wording is hedged to "may have been" rather than "was". This residual is named and accepted in [`BUG-039`'s spec at `:129`](docs/superpowers/specs/2026-09-27-bug039-installer-host-owned-state-design.md), where the alternative (restoring from the host's own git history) was rejected as writing host files out of the host's history with new failure modes. A **fresh** install is silent, which the Quickstart shows.
- **Four open dossiers**, which are the evidence-collection pipeline working rather than a backlog: a session denial tally, one for interleaved-artifact reports, an intermittent commit-hook hang in the `snap-build` suite, and detect-stack failing whole on a non-string `package.json` script. A dossier holds specimens until a mechanism is characterized by probe; an id is minted only when the written condition is met. `[BUG-047]` is what that pipeline produces when it completes: an out-of-scope note, then a dossier, then four specimens across four sessions, then a mint, then a release.

**The living artifact is `AGENT-READABLE BACKLOG.md`.** It is not a tidy issue list. It carries amendments above the text they amend, premises that measurement later corrected, and wrong guesses recorded beside the probe that overturned them.

---

## Dependencies

code-conductor assumes these are already in place — the installer does not set them up for you:

| Dependency | Required for | How to get it |
|---|---|---|
| Node.js `>= 20` | Running the `code-conductor` CLI itself | Any current Node LTS |
| Claude Code | The environment every command/skill/hook in this repo runs inside | — |
| **superpowers plugin** | `/cc-spec` (`brainstorming`), `/cc-plan` (`writing-plans`), and `/cc-debug`, `/cc-refactor`, `/cc-review`, `/cc-test` (all four via `subagent-driven-development`) | Install from Claude Code's `/plugin` marketplace, then run `/reload-plugins`, **before** using these commands — without it, their `Skill(...)` calls fail |
| GitHub CLI (`gh`), authenticated | Only `/cc-orchestrate --ticket` and `ticket.mjs writeback`. conductor holds no credential; `gh` owns authentication | Install GitHub CLI, then run `gh auth login` |
| ui-ux-pro-max skill | Nothing: retired guidance | No shipped code downloads, installs or activates it. Its replacement is filed as `[FEAT-037]` |

---

## The Problem

AI coding assistants are only as good as the structure you put around them. Without it, sessions drift: the agent overwrites files it shouldn't, skips the spec, reads entire codebases line by line, and produces code that solves the wrong problem efficiently. The result is fast output with slow outcomes — more rewrites, more context lost, more tokens burned. code-conductor is the structure.

| Without code-conductor | With code-conductor |
|---|---|
| Free-form prompt → agent guesses, overwrites, drifts | `/cc-spec` → approved spec → `/cc-plan` → confirmed steps → implement |
| Full files read on every turn | grep/find before read — targeted tool calls only |
| Conventions reset every session | Stack profile + memory loaded at session start |
| Manual CLAUDE.md with `<command>` placeholders | **Stack auto-detection** — `code-conductor --project` reads your `package.json`, `go.mod`, `Cargo.toml`, etc. and auto-fills CLAUDE.md Development Commands so the agent never guesses your build/test/lint commands |
| Verbose markdown handoffs eat context | **SNAP v1**: minified single-line JSON handoff format, schema-validated by `scripts/snap-validate.mjs`, ≥15% smaller than the markdown snapshot it replaces |

---

## Install

**Minimum safe version: `1.34.4`.** Older versions can strip or damage an existing `CLAUDE.md`: every release before `1.24` overwrote it with no backup, `1.24` through `1.34.3` silently removed your sections whose headings matched the managed block's, and an older pre-sentinel version left at least one field file with damaged lines. Install with `@latest`, as below.

```bash
npx @yeison.restrepo.r/code-conductor@latest            # one-shot global setup
# or
npm install -g @yeison.restrepo.r/code-conductor && code-conductor
```

### Add to a project

`--project` performs the global setup **and** scaffolds the project template in one call — there is no separate step to run first:

```bash
code-conductor --project      # global setup + scaffold ./.claude in the current repo
```

### Flags

By default, the installer installs only the global core files. Use flags to extend this behavior.

| Flag | Description |
|------|-------------|
| `--project` / `-Project` | Also install the project template into the current directory |
| `--no-deps` / `-NoDeps` | Skip dependency installation (Node tooling, Playwright MCP, plugins); copy agent files only |
| `--verbosity MIN\|INFO\|VERBOSE` / `-Verbosity` | Set the default response verbosity (default: `MIN`). `MIN` = one sentence per response. `INFO` = bullet list. `VERBOSE` = full explanation. Re-run the installer to change it. |

### Update

Re-run the same install command. User-configured files are never overwritten; agent-managed files are always updated.

> **Note:** Do not clone this repository into a parent directory named `node_modules`. Guard 4 checks path components and will block agent `Read` calls on source files if the repository root is nested inside such a directory.

---

## How It Works

code-conductor operates at three layers:

**Global core** (`~/.claude/`) — applies to every project on your machine. Enforces the spec-first workflow, token efficiency rules, safety checks, code simplicity rules, and memory conventions. Installed once; always active.

**Project template** (`.claude/`) — lives in your repo and is shared with your team via git. Adds project-specific slash commands, hooks that guard file writes, and a shared memory file for decisions, conventions, and technical debt.

**Dynamic stack discovery + skills** — `/cc-stack` runs the bundled `detect-stack.mjs` scanner and writes your detected build/test/lint/format commands plus a concise, generated ruleset straight into your project `CLAUDE.md`. Skills extend the agent's behavior for cross-cutting concerns like code simplicity and UI/UX.

---

## Available Commands

All commands are tagged `(Conductor)` in the Claude Code command palette so they're easy to spot alongside commands from other sources.

### Global (all projects)

| Command | Description |
|---------|-------------|
| `/cc-checkpoint` | Read the current session, extract decisions, conventions, and debt, then write them to `project.md` and `personal.md` with a timestamp. Run before `/compact`, after completing a feature, and after key architectural decisions. |
| `/cc-stack` | Run the dynamic detector to identify your framework and write the detected commands and a generated ruleset into your project `CLAUDE.md`. |
| `/cc-lang [code]` | Switch response language for this session. Code identifiers, filenames, and commit messages remain English regardless. |

### Project (requires `--project` install)

| Command | Description |
|---------|-------------|
| `/cc-resume` | Restore full session context in one command: reads project identity, memory, latest spec and plan, git state, and loads the stack profile. Scans the active plan for `[>]` (interrupted) and `[!]` (failed) task markers and surfaces them in the session report. Run at the start of every session after initialization. |
| `/cc-init` | Initialize or re-sync the project environment: detect stack, checkpoint memory, and verify hook integrity. Run at the start of every session. |
| `/cc-spec [name]` | Search the codebase first, ask only for missing context, generate a full feature spec, and wait for your approval before any plan is made. |
| `/cc-plan` | Require an approved spec, map the codebase, and generate an ordered implementation plan with exact file paths, a test list, a commit order, and identified risks. Every generated task line carries a unique `[T-NNN]` ID (min 3 digits, unlimited suffix depth) using plain ASCII checkboxes — enforced at generation time. |
| `/cc-compact` | Phase-boundary command. Serializes the current phase's essential state (decisions, pending steps, files touched, constraints) into a single-line SNAP JSON snapshot at `.claude/memory/session-snapshot.json` — and, when Node `>= 22.5` is available, a git-hash-keyed row in the local `.conductor/cache.db` — then prompts you to run `/compact` to clear conversation history. Run at the end of every phase to prevent context overflow. |
| `/cc-implement` | Execute implementation tasks from an approved plan using a surgical 5-step ritual: Grep-locate pending tasks → single-line Read verify → pre-flip `[ ]` to `[>]` → execute → post-flip to `[X]` or `[!]`. Never reads or rewrites the full plan file. Includes dependency evaluation, drift detection, and a Step 6 hook that records each task's final state to a local SQLite cache (see below). |
| `/cc-orchestrate <ITEM> [--auto] [--ticket <N\|issue URL>]` | Route one backlog item through Define, Build and Verify. For each role it builds, validates (`snap-validate --to`) and installs a SNAP v3 band envelope, dispatches the agent named after the role, waits for its completion notice, and checks the one `SNAP_HANDBACK` line of its delivered hand-back before the next. It pauses before every dispatch unless `--auto`; the spec and plan approvals always pause. A failed validation halts the run, terminally in this version (recover with `end`, then `start`). It needs agent definitions named `spec`, `plan`, `code`, `audit` and `qa` in `.claude/agents/` or `~/.claude/agents/`, which ship from `1.37.0`; a root `package.json` with a `test` script, or a stack whose test command detect-stack names, since `start` records the one command `code` and `qa` may run and halts when none resolves; and plans in the writing-plans format (`### Task N` with a `**Files:**` block). Release stays human. `--ticket` binds the run to a GitHub issue: `start` fetches it once through `gh`, halts on a pull request, a closed issue, or an empty or over-65536-byte body, and writes the body into a fenced, hashed snapshot at `.conductor/ticket/<ITEM>.md`, which only the spec role reads, as untrusted requirement input. After release, the owner runs `node .claude/scripts/ticket.mjs writeback <ITEM> --version <v> --pr <N\|url> [--changelog <file>] [--close]`, which posts one outcome comment to the bound issue, never twice for the same version, and closes it only with `--close`. |

Each of `/cc-spec`, `/cc-plan`, and `/cc-implement` opens its phase with a **resume read** (`scripts/resume-read.mjs`): it restores any context stored for the current git commit, so work survives branch switches and rollbacks (see [Local State Cache & Session Persistence](#local-state-cache--session-persistence--v1220)).
| `/cc-review [file\|dir]` | Review code in three layers - Critical / Important / Suggestion - then deliver a verdict and offer to auto-fix. |
| `/cc-debug [problem]` | Generate hypotheses ordered by probability, confirm before investigating, use Playwright MCP for visual bugs, and report the root cause with a targeted fix. |
| `/cc-refactor [file\|module]` | Diagnose complexity, plan ordered changes, apply one step at a time, and verify tests pass after each step. |
| `/cc-test [scope]` | Analyze coverage gaps, write tests in AAA pattern, add Playwright E2E where applicable, run after confirmation, and report results. |
| `/cc-docs [scope]` | Audit existing documentation, write inline docs in the correct format for your stack (JSDoc / docstrings / JavaDoc / GoDoc), and preview before writing. |

---

## Skills

Skills extend agent behavior for cross-cutting concerns that apply regardless of stack.

### code-simplifier — always active

Applied to every piece of code written or reviewed in every session. Enforces:

- No speculative abstractions — solve today's problem only
- Functions ≤30 lines, doing one thing
- Flat over nested — guard clauses and early returns
- Descriptive names — no `Base`, `Abstract`, `Manager`, `Handler`
- Comments explain why, never what

### ui-ux-pro-max — retired guidance, pending [FEAT-037]

Earlier releases described this skill as installed from GitHub and activated when `/cc-stack` detects a frontend stack. No shipped code does either. The `CLAUDE.md` templates still name it; `[FEAT-037]` replaces it with a frontend design skill stack, and this section changes when that ships.

### critical-review — always active during implementation

Applied to every implementation task via a 4-phase adversarial protocol:

1. **Pre-Flight** — Happy Path, Failure Points, and Boundary Conditions identified before any code is written
2. **Adversarial Review** — RESILIENCE (silent failures), EFFICIENCY (code smells), FRICTION (happy-path friction)
3. **Self-Correction** — each weakness refactored and re-verified in isolation
4. **`[VALIDATION]`** — required closing section on every implementation: edge cases covered, best-outcome justification, residual risks

### verbosity — always active

Controls how much Claude writes per turn. The level is set at install time via `--verbosity` and stored in `~/.claude/memory/verbosity.md`. Default: `MIN`.

| Level | Behavior |
|-------|----------|
| `MIN` | One declarative sentence. `[CHANGES]` tag with file list only. |
| `INFO` | Bullet list of what changed and why. Max 5 bullets. `[CHANGES]` + `[REASON]`. |
| `VERBOSE` | Full explanation, prose allowed. All response tags. |

### memory-first — always active

Before reading any file, Claude walks a priority lookup chain and stops at the first step that answers the question:

1. **Project memory**: `.claude/memory/project.md`
2. **Grep / Glob** — pattern searches
3. **Targeted read** — last resort, always with `offset` + `limit`, max 150 lines

### agent-delegation — always active

Keeps the main context clean. Sub-agents handle exploration and parallel work; they return a ≤200-word summary to the main context. Raw file contents and intermediate data never enter the main context.

---

## Hooks

Hooks run automatically at specific points in a Claude Code session. They require no manual setup.

### pre-tool-use

Fires before `Read`, `Write`, `Edit`, `create_file`, `write_file` and `Bash`. A single zero-dependency Node front door (`pre-tool-use.mjs`) reads the `PreToolUse` payload from stdin, dispatches on `tool_name`, and returns its verdict as `hookSpecificOutput.permissionDecision`. Every path exits 0: a denial is data, never an exit code.

**Large-file Read guard (Guard 1)** - a `Read` of a file over 150 lines that names no `limit` is denied, and the reason redirects Claude to the orchestrator lookup chain (memory, grep, targeted read). Prevents reading entire codebases when a targeted search would do.

**Duplicate file guard (Guard 2)** - a `Write`, `create_file` or `write_file` naming a path that already exists returns `ask`, showing the path, line count and last-modified timestamp with three options: edit in place, confirm the overwrite, or cancel. `Edit` is deliberately not gated, because editing in place is the action this guard recommends.

**Bash scan guard (Guard 3)** - every `Bash` command is matched against twelve mass content-dump patterns before it runs: deep `find` without `-maxdepth 1`, `find -exec` with readers or shells, `xargs` with readers, `cat` or a pager followed by an unquoted glob, command substitution as a reader's argument, `grep -r` with a match-all pattern, `ls -R`, shell loops, `mapfile` and `readarray`, `eval`, `source` and the dot operator, alias remapping to a reader, and obfuscation sequences. Commands over 8192 characters and unclosed quotes are denied fail-closed.

Permanent exceptions live in `.claude/memory/bash-scan-allowlist.txt`, one entry per line, blank lines and `#` comments ignored and whitespace trimmed. An entry ending in `/` covers paths under that prefix, rejecting any suffix that walks up the tree with `..`; any other entry matches a whole command token. **Entries match literally: regex metacharacters carry no special meaning, so `file.ts` matches `file.ts` and nothing else.** The installer ships this file once as a commented template and creates it only when it is absent; it never overwrites an existing one. Every line in it disarms patterns for matching commands, so give each entry a comment saying why it exists; an uncommented entry is a review smell.

Hit a block you believe is wrong? Re-run the command with `CC_GUARD3_WARN=1` and the guard asks instead of denying, carrying the same pattern ids. That is a triage aid for reporting a false positive while you keep working, not a configuration mode: the allowlist is the sanctioned permanent exception. The variable affects Guard 3 alone.

**node_modules guard (Guard 4)** - a `Read` whose path carries `node_modules` as an exact path component is denied, with backslashes and `..` resolved first. Use Glob for existence checks.

**Band scope guard (Guard 5)** - a `Write`, `Edit`, `create_file` or `write_file` from a subagent whose `agent_type` names a band role (`spec`, `plan`, `code`, `audit`, `qa`) is checked against the nearest `.claude/memory/band-envelope.json` above its working directory, a SNAP v3 envelope. A malformed envelope, an agent that is not the envelope's role, a role not holding `RW`, or a path outside the envelope's `scope` globs (anchored at the band root, the directory whose `.claude/` holds the envelope) is denied with a named reason. The main session, any other agent, and any project without an envelope are untouched. It assumes cooperative agents: `agent_type` is a name taken on trust, and `Bash`, `NotebookEdit`, MCP write tools and symlinked paths are not covered.

**Orchestrator write guard (Guard 6)** - while a `/cc-orchestrate` run is live, its run file `.claude/memory/orchestrator-run.json` binds it to one session by `session_id`. In that session, a `Write`, `Edit`, `create_file` or `write_file` from anything but a band role (the main session, a payload carrying only `agent_id`, any other agent) is denied with `ORCH_WRITE_DENIED` unless its target lies inside the orchestrator's write surface, anchored at the run root: `.claude/memory/orchestrator-run.json`, `.claude/memory/band-envelope.json`, `.claude/memory/session-snapshot.json` and `.conductor/**`. Band roles stay under Guard 5. A run file from another session is stale and an unreadable one is invalid: both warn (`ORCH_RUN_STALE`, `ORCH_RUN_INVALID`) with the cleanup command and never block. While the run is live, a subagent's `Agent` or `SendMessage` call is denied with `ORCH_NESTED_DISPATCH`, so only the orchestrator dispatches or messages agents (R7; the hook's matcher names both tools). Outside a live run there is no Guard 6: any agent can dispatch agents, as before. Limits are stated, not closed:
- `Bash` writes are not covered, as under Guard 5. That includes a role spawning `claude -p`, whose child session carries another `session_id` and is warned, not blocked.
- Under auto permission mode no human stands behind a Bash write or a hook `ask`.
- Inside the live session, only a main-session-dispatched non-role agent can write the surface itself, the band envelope included. So Guard 6 bounds where the orchestrator writes, not who writes inside that surface.
- An agent that keeps writing after its hand-back is bounded only by the envelope in force.

**Role shell guard (Guard 7)** - a `Bash` call from a subagent whose `agent_type` names a band role is decided before Guard 3, so Guard 3's `CC_GUARD3_WARN` ask can never outrank it. `spec`, `plan` and `audit` have no shell (`ROLE_SHELL_DENIED`). `code` and `qa` may run exactly one command, byte for byte: the `test_command` that `orchestrate.mjs start` recorded in the run file of a run live in their session. A command carrying `;`, `&`, `|`, a backtick, `$(`, `<`, `>` or a line break is denied first (`ROLE_SHELL_CHAINING`). No run file, a run of another session, or no recorded command is denied (`ROLE_SHELL_UNRESOLVED`), and any other command is denied naming the allowed one (`ROLE_SHELL_NOT_ALLOWED`). An error inside the guard denies too, and `CC_HOOK_ALLOW` does not reach it. The main session and every other agent are untouched. The two allowances differ in kind: for `qa`, which Guard 5 keeps from writing, the guard is enforcement; for `code`, which writes the tests the command runs, it is process discipline, not a security boundary. `start` resolves the command before it writes anything: the package manager's `test` invocation when a root `package.json` has a `test` script (`npm test`, `pnpm test`, `yarn test`, or `bun run test` by lockfile, and `npm test` with none), detect-stack's test command when there is no `package.json`, and otherwise a halt (`ORCH_TEST_COMMAND_UNRESOLVED`). A resolved command carrying a chaining character halts too (`ORCH_TEST_COMMAND_UNSAFE`), so nothing is recorded that Guard 7 would deny.

Input the hook cannot parse fails closed: it is denied with one stderr line naming `CC_HOOK_ALLOW=1`, which overrides that denial alone and leaves every guard fully active on every payload the hook can read. Set `CC_HOOK_DEBUG=1` to see the diagnostic lines it otherwise swallows.

### context-guard *(global + project)* — v1.15.0

Fires on every `UserPromptSubmit`. Atomically increments a turn counter in `.claude/memory/turn-count.txt`. At 80% of the configured threshold it emits ⚠ CONTEXT WARNING; at or above the threshold it emits 🚨 CONTEXT CRITICAL. The threshold is read from `.claude/memory/context-threshold.txt` (default: 25). After `/compact`, the `post-compact` hook resets the counter to 0.

Available on both Unix (`context-guard.sh`) and Windows (`context-guard.ps1`). Set `CC_GUARD_DEBUG=1` to print debug info to stderr. Set `CC_PROJECT_ROOT` to override the project root used for the memory directory.

### post-compact

Fires after `/compact`. Resets the turn counter to 0, reads `project.md`, shows the timestamp of the last `/cc-checkpoint`, and reminds you to run `/cc-checkpoint` if context from this session hasn't been saved yet. Prevents losing decisions and conventions when the context window is compressed.

### verbosity-remind *(global + project)* — v1.11.0

Fires on every `UserPromptSubmit`. Re-injects the active MIN/INFO/VERBOSE verbosity constraint before every Claude response, preventing level drift as the context window fills (BUG-014).

The global hook defers to a project-level hook if one exists (upward traversal from `$PWD`). The active level is read from the nearest `.claude/memory/verbosity.md` ancestor file. Set `CC_VERBOSITY_SKIP=1` to disable in CI/CD environments.

> **Note — `$HOME` unset environments:** When `$HOME` is unset (e.g., some CI containers, `sudo -H` shells, minimal Docker images), `verbosity-remind.sh` exits immediately with code 0 and emits no output. Claude falls back to MIN verbosity by default. Set `HOME=/root` (or the appropriate home directory) in the container environment to restore full hook behavior. The hook never raises an error when `$HOME` is absent — it degrades gracefully to ensure the user's session is never blocked.

---

## Local State Cache & Session Persistence — v1.22.0

`/cc-implement`'s Step 6 hook records each task's final state to a local SQLite cache at `.conductor/cache.db`, written by the bundled `scripts/conductor-db.mjs` engine — a zero-dependency ES module wrapping Node's built-in `node:sqlite`.

- **Schema (v2, ARCH-008):** `task_state(plan_file, task_id, state, updated_at)` keyed by `(plan_file, task_id)` — `plan_file` normalized to a repo-relative POSIX path so the same plan de-duplicates across working directories — plus `sessions`, `snapshots` (one verbatim SNAP blob per git commit, newest wins), and `raw_history`. Upserts on every write.
- **Runtime-gated:** `node:sqlite` needs Node `>= 22.5`, so every caller probes the Node version and self-disables below it. `engines.node` stays `>=20`; the cache is an optimization, never a requirement.
- **Non-authoritative + fail-safe:** the plan markdown and the `.claude/memory/session-snapshot.json` handoff remain the sources of truth. Every failure path — absent `node:sqlite`, a corrupt or non-regular file at the db path, `SQLITE_BUSY`, a newer schema, CLI misuse — degrades to a single `CONDUCTOR_DB:` stderr line and exit 0. A corrupt db is renamed aside (never `rm -r`) and recreated.
- **Gitignored:** `.conductor/` is local-only and never committed.

### Phase-entry resume — v1.22.0

`/cc-spec`, `/cc-plan`, and `/cc-implement` open each phase by running `scripts/resume-read.mjs`, which resolves the current git commit hash and restores any context stored for it — surviving branch switches and rollbacks. A valid DB snapshot for the commit wins; otherwise it falls back to the `.claude/memory/session-snapshot.json` handoff written by `/cc-compact`. A hit prints a `RESUME_HIT` block the command adopts as its starting context; a clean miss proceeds fresh; a readable-but-corrupt handoff halts the phase (exit `4`) with a `SNAP_INVALID` notice so you can inspect it. This completes the **ARCH-008** milestone: relational schema (v1.20.0) → checkpoint/compact writers (v1.21.0) → phase-entry readers (v1.22.0).

---

## Memory Architecture

```
~/.claude/
  memory/
    personal.md     ← local only, never committed
                       dev preferences, shortcuts
    verbosity.md    ← agent-managed, set by installer
                       active verbosity level (MIN/INFO/VERBOSE)

project-root/
  .claude/
    memory/
      project.md    ← in git, shared with team
                       decisions, conventions, debt, workarounds
```

`/cc-checkpoint` writes to both. Run it before `/compact`, after completing a feature, and after any key architectural decision.

`/cc-stack` records the detected stack in your project `CLAUDE.md` (the `- Stack:` line and the `## Active Stack Profiles` block); on later sessions it asks whether anything changed before re-detecting.

---

## Language Support

| Priority | Source | How to set |
|----------|--------|------------|
| 1 (highest) | Session | `/lang [code]` |
| 2 | Project | `language:` in project `CLAUDE.md` |
| 3 | Personal | `response_language:` in `personal.md` |
| 4 (default) | Global | English |

**Supported codes:** `en` `es` `pt` `fr` `de` `it` `zh` `ja` `ko`

Code identifiers, file names, and commit messages are always English.

---

## File Structure

```
code-conductor/
├── README.md
├── VERSION
├── .gitignore
├── bin/code-conductor.mjs        npm CLI entry (npx code-conductor)
├── lib/installer/                CLI modules (env, deploy, settings, config)
├── global/
│   ├── CLAUDE.md                 Global agent behavior (all projects)
│   ├── settings.json
│   ├── commands/
│   │   ├── cc-checkpoint.md      /cc-checkpoint
│   │   ├── cc-stack.md           /cc-stack
│   │   └── cc-lang.md            /cc-lang
│   ├── hooks/
│   │   └── verbosity-remind.sh       Verbosity reminder on UserPromptSubmit
│   └── memory/
│       └── personal.md           Template (never committed)
├── project-template/
│   ├── CLAUDE.md
│   ├── gitignore                 Merged into the host project's .gitignore
│   └── .claude/
│       ├── settings.json         Hooks wiring (pre-tool-use, post-compact)
│       ├── agents/               Band roles: spec, plan, code, audit, qa (FEAT-012)
│       ├── commands/
│       │   ├── cc-init.md        /cc-init — session initialization
│       │   ├── cc-resume.md      /cc-resume — session context restore
│       │   ├── cc-spec.md        /cc-spec
│       │   ├── cc-plan.md        /cc-plan
│       │   ├── cc-implement.md   /cc-implement
│       │   ├── cc-orchestrate.md /cc-orchestrate
│       │   ├── cc-review.md      /cc-review
│       │   ├── cc-compact.md     /cc-compact — phase boundary compaction
│       │   ├── cc-debug.md       /cc-debug
│       │   ├── cc-refactor.md    /cc-refactor
│       │   ├── cc-test.md        /cc-test
│       │   └── cc-docs.md        /cc-docs
│       ├── hooks/
│       │   ├── pre-tool-use.mjs  Node front door: large-file, duplicate-write and node_modules guards
│       │   ├── context-guard.sh  Turn-counter warning (.sh + .ps1)
│       │   └── post-compact.sh   Checkpoint reminder + cache sweep after `/compact` (.sh + .ps1)
│       └── memory/
│           └── project.md        Shared team memory (in git)
├── scripts/
│   ├── conductor-db.mjs          Zero-dep node:sqlite engine (.conductor/cache.db)
│   ├── resume-read.mjs           Phase-entry resume reader (DB snapshot → handoff fallback)
│   ├── snap-contract.mjs         SNAP limits, caps, field sets, version ceiling
│   ├── snap-build.mjs            SNAP v1/v2 handoff serializer
│   ├── snap-validate.mjs         SNAP schema validator
│   ├── session-id.mjs            Stable session-id resolver
│   ├── orchestrate.mjs           Band router: run file, envelopes, hand-backs (FEAT-011)
│   ├── ticket.mjs                Ticket intake and writeback through gh (FEAT-031)
│   └── detect-stack.mjs          Stack auto-detection scanner
└── skills/
    ├── code-simplifier/SKILL.md   Always active — complexity and simplicity rules
    ├── critical-review/SKILL.md   Always active — 4-phase adversarial review protocol
    ├── verbosity/SKILL.md         Always active — MIN/INFO/VERBOSE response rules
    ├── memory-first/SKILL.md      Always active — memory → grep → read chain
    └── agent-delegation/SKILL.md  Always active — sub-agent spawn rules
    # Claude Code registers personal skills only at ~/.claude/skills/<name>/SKILL.md
```

---

## .gitignore Note

When installed with `--project`, the installer keeps its rules in one labelled block in
your project's `.gitignore`:

```
# Code Conductor (added by the installer; safe to keep)
.claude/memory/turn-count.txt
*.installer-backup.*
*.installer-tmp.*
```

The block ends at the first blank line. Your own lines are never edited. A line that is
exactly one of these three rules (earlier versions appended them one at a time) is moved
into the block, so each rule appears once; a line you changed, such as
`/.claude/memory/turn-count.txt`, is not an exact match and stays where it is. If your
`.gitignore` has any `!` line, nothing is moved, because moving a rule past a `!` can
change what is ignored: the block then holds only the rules you lack, and the installer
says so. A change to `.gitignore` is backed up and reported exactly as for `CLAUDE.md`.

The last two keep the installer's own backups and crash-stranded temp files out of
`git status`. The rules ship inside the package as `project-template/gitignore`
(no leading dot) because npm strips any file literally named `.gitignore` from every
published tarball; the installer restores the dot when it writes to your project.

---

## How the installer treats your CLAUDE.md

`CLAUDE.md` and `.gitignore` are **merged**, never overwritten. Everything else the
installer ships (`settings.json`, hooks, commands, `scripts/`) is replaced on every run.

- **Code Conductor owns one block and nothing else.** Its content lives between
  `<!-- cc:managed:start -->` and `<!-- cc:managed:end -->`, and those two markers alone
  decide ownership; a heading's name never does. Every upgrade replaces the block's
  contents wholesale, so released improvements reach existing installs. Edits inside the
  block are lost, and recoverable from the backup.
- **Everything outside the block is yours, byte for byte.** Nothing outside it is
  removed, rewritten, reordered or added.
- **A file without the markers gets the block appended at the end**, after one blank
  line and in your file's line endings, and nothing else changes. If your file already
  has sections named like the block's (`## Agent Identity`, `## Hard Constraints`, …),
  you will see both: yours above, Code Conductor's inside the block. That is deliberate.
  The installer never decides which of your sections are really its own; reconciling
  them is planned for `/cc-stack` as `[FEAT-040]`.
- **Before any change, the installer copies your file to
  `CLAUDE.md.installer-backup.<UTC timestamp>`**, keeps the five most recent, and prints
  where it put it:

  ```
  code-conductor: backed up CLAUDE.md to CLAUDE.md.installer-backup.20260930T120000Z before merging (git-ignored by design)
  ```

  Backups are git-ignored so nobody commits one by accident and they stay out of every
  teammate's `git status`; the printed line is how you find yours. A fresh install, and a
  re-run that changes nothing, print nothing.

The same rules apply to `~/.claude/CLAUDE.md`, whose backup line names the `~/.claude/`
path. If your file ends inside a code fence that is never closed, the installer leaves it
untouched with a warning, because a block appended there would be hidden inside the fence.

If the markers in your file are damaged — a `start` with no `end`, two blocks, an `end`
before its `start` — the installer prints a warning, leaves the file completely untouched,
and finishes the rest of the install. Fix the markers and re-run.

---

## Uninstall Notes

> **`git revert` in non-repository environments (CI/CD, Docker, bare installs):**
> Uninstall steps that use `git checkout <tag>` or `git revert <sha>` require a git working tree. In CI/CD pipelines, Docker containers, or directories that are not git repositories, these commands will fail with `fatal: not a git repository`. This is expected and non-fatal.
>
> **In non-repo environments:** manually delete or restore `skills/verbosity/SKILL.md` and remove the `verbosity-remind` entry from `~/.claude/settings.json`. Hook removal (`rm ~/.claude/hooks/verbosity-remind.sh`) and `settings.json` cleanup work identically in all environments — no git is required.

---

## Contributing

GitHub Issues are the inbox: an issue or PR is a candidate until the owner mints it an id. Nothing merges without a minted id and owner review, one item per PR. Versions, release branches, tags and GitHub Releases are owner-only. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR; its hard constraints bind AI agents working on a contributor's behalf as well.
