# FEAT-012: Core Role Agents (Spec, Architect/Plan, Code, Auditor, QA)

**Status:** APPROVED 2026-10-02 at the approval round. That round folded one fix and recorded two rulings and one deferral:
- **The bun fix:** `bun.lockb` maps to `bun run test`, never `bun test` (D6, AC8).
- **Ruling A1, the spec role's deviation, is approved, not assumed:** open questions go in the report and are ruled at the boundary rather than asked interactively (Out of Scope).
- **Ruling A2, the allowlist scope, is approved:** the test command only. There is no lint command for audit and no auxiliary read-only command for any role, and lint stays out of scope as D3 derives.
- **The deferral:** how the metacharacter set is shared between the hook and `orchestrate.mjs` goes to the plan (D10).

The question rounds ruled:
- **Q1, the Bash boundary:** enforced at the tool layer by a new guard. Restricting Bash in the prompt is ruled out by measured evidence (T-003).
- **Q1 follow-up, audit:** derived from the band table rather than ruled. Audit is Read, Grep and Glob only (D3).
- **Q2, code's shell:** code gets the exact test command, framed as process discipline, never as an enforcement boundary (D4). F3 is the deciding evidence.
- **Design corrections:**
  - the record-time safety invariant (D7);
  - gate names taken verbatim from the enum;
  - two more mandatory prompt items;
  - the 999 token ceiling.
- **Q3, the test command:** a JS stack records the runner invocation, and a missing `scripts.test` halts (D6).

**Item.** `[FEAT-012]`, already minted, so no new id is needed. It consumes `[ARCH-010]` (`1.35.0`) and `[FEAT-011]` (`1.36.0`) as given. **No SNAP contract change:** `MAX_VERSION` stays 3, and `ROLES`, `GATES`, `BANDS` and `ROLE_BAND` are untouched. The five roles are exactly the existing `ROLES` (`scripts/snap-contract.mjs:53`).

**Target.** `1.37.0`, a minor release: five shipped agent profiles, a new guard, and a new run-start halt. Branch `feat/feat-012-core-role-agents`.

## Problem

`[FEAT-011]` routes an item through Define, Build and Verify, but a real project cannot use it: no agent definitions ship. A role whose definition is not found halts with `ORCH_AGENT_MISSING` (`scripts/orchestrate.mjs:210-212`, FEAT-011 D10). The only definitions that exist are test fixtures generated at test time (`tests/scripts/orchestrate.test.js:42-44`). They have no tool mask and no prompt.

The tool boundaries that exist today are incomplete:
- **Writes are bounded:** Guard 5 confines `Write`, `Edit`, `create_file` and `write_file` to the envelope's `ops.scope`.
- **The shell is not:** Bash is ungated for every role (`.claude/hooks/pre-tool-use.mjs:127`).
- **This seam has been walked through:** in FEAT-011's T-003, an agent whose `Write` the owner declined completed the same edit through a Bash heredoc (`toolu_01WgFdKWsSCDhfc61DSr8isR`, `toolu_01MDH5idd8SN4KxRCCeFhJpd`).

The backlog's acceptance criterion is that each role is instantiable with a prompt under 1000 tokens and that cross-role tool use is blocked, for example "Code Agent cannot run general shell commands and QA Agent cannot edit code files". Nothing ships today that meets it.

## Field evidence, read before design

Each item comes from the `[FEAT-011]` harvest in `project.md` and is cited where it decides something.

- **T-003, the Bash seam.**
  - **The sighting:** a declined `Write` was completed through a Bash heredoc.
  - **What it rules out:** any design that restricts Bash in the prompt alone. That is a seam already walked through.
  - **What it supports:** the brief fix ("an owner's deny is an instruction to stop") held for the rest of FEAT-011, so it is carried into every prompt.
- **F3, asynchronous dispatch and the wake requirement.**
  - **The cost:** every dispatch ended the orchestrator's turn before the completion notice arrived, so each one needed a manual owner wake.
  - **What it decides:** each extra dispatch costs one owner wake, which is why code gets the test command (D4).
- **D8, the cold wait.** The wait slipped twice, then held. Prompt-level waiting is cooperation, not enforcement. FEAT-012 does not change the orchestrator's wait (Out of Scope).
- **The gate-semantics limit.** It was seen three times, from two roles. A gate copied from a template can claim work that never ran: gates certify protocol position, not work truth. FEAT-012 defines what each gate means (Gate semantics) and states the success conditions in fixed terms, but it cannot make a gate prove the work.
- **The qa fixture reinterpretation.** qa substituted a stricter criterion that nobody gave it and refused a healthy run's gate. Every prompt therefore states its success condition in fixed terms and forbids substituting another standard (D5).
- **The `ops.scope` hand-back template defect.** It halted `ORCH_HANDBACK_INVALID` on the first attempt. The fix was copying `ops.scope` verbatim from the envelope (`.claude/commands/cc-orchestrate.md:77`), which every prompt now states (D5).
- **R7.** Guard 6 denies a subagent's `Agent` and `SendMessage` while a run is live (`ORCH_NESTED_DISPATCH`). The prompt still states that the role must not dispatch (D5).

## Solution

FEAT-012 ships five Claude Code agent definitions, one per role in `ROLES`, under `project-template/.claude/agents/`. Each is mirrored byte-identically into `.claude/agents/`, pinned by a parity test. Each definition's `tools:` frontmatter is its tool mask, and its body is a prompt of 999 tokens or fewer.

A new **Guard 7 (role shell)** in `pre-tool-use.mjs` (both copies) closes the Bash seam for band roles. It denies the shell outright for spec, plan and audit. For code and qa it allows exactly one command: the test command `orchestrate.mjs start` recorded in the run file. It denies anything containing chaining metacharacters, and it fails by denying.

`orchestrate.mjs start` resolves that command before anything is dispatched. A JS project gets its package manager's `test` invocation, and a non-JS project gets detect-stack's value. The command is checked against Guard 7's own metacharacter set before it is recorded. Run start halts if no command resolves, or if the resolved command is unsafe.

### Decisions, each with its grounds

- **D1. Where the profiles live.**
  - They ship in `project-template/.claude/agents/<role>.md`, and the installer's whole-directory copy deploys them with no installer change (`lib/installer/deploy.mjs:174-188`).
  - They are mirrored byte-identically into this repository's `.claude/agents/`, following the commands convention (`tests/installer/commands-parity.test.js`).
  - Each file's frontmatter `name:` is exactly the role string, which is what `findAgent` matches (`scripts/orchestrate.mjs:157-168`).
  - Nothing ships to `global/`.
- **D2. Tool masks.** The mask is hard authority (ARCH-010). Guard 7 is defense in depth beneath it.

  | Role | `tools:` | Shell under Guard 7 |
  |---|---|---|
  | spec | Read, Grep, Glob, Write, Edit | denied |
  | plan | Read, Grep, Glob, Write, Edit | denied |
  | code | Read, Grep, Glob, Write, Edit, Bash | the recorded test command only |
  | audit | Read, Grep, Glob | denied |
  | qa | Read, Grep, Glob, Bash | the recorded test command only |

  No mask includes `Agent`, `SendMessage` or `NotebookEdit`.
- **D3. Audit has no shell. This is derived from the band table, not ruled.**
  - **The normative row:** the band table at `AGENT-READABLE BACKLOG.md:122` reads `| Verify | Auditor, QA, Security | Static review pass, suites green, scans clean |`.
  - **How the table words its exits:** each exit condition names its evidence. "Suites green" and "scans clean" are results of execution. "Static review pass" is the verdict of a review over artifacts that already exist, so audit's exit does not require that anything ran.
  - **The code agrees with the table, and does not replace it:** `ROLE_ARTIFACTS.audit` is `tk: 'R'` (`scripts/orchestrate.mjs:28`), and `MAY_HAND_BACK.audit` is `['build_executed']` (`:34`).
  - **The consequence:** running lint falls under no FEAT-012 gate, and that is named in Out of Scope rather than assigned to a role silently.
- **D4. code gets the exact test command, as process discipline and never as an enforcement boundary.**
  - **Why it is not a boundary:** code writes source and test files, and the allowed command executes them. A code agent that wanted arbitrary execution could write it into a test and run the suite. Nowhere in this spec, the README or the prompts is code's mask presented as a security boundary.
  - **Why qa's identical allowance is real enforcement:** Guard 5 keeps qa from writing (`tk: 'X'`, no `ops.scope`), so qa only ever executes files it did not write.
  - **Why code gets it at all (F3):** without it, every red suite would surface only at qa, and every code→qa→code cycle adds dispatches, each one a manual owner wake. Red/green inside the Build band keeps iteration off the owner.
- **D5. The mandatory prompt items.** Every prompt carries all of the following, and a test pins each by a fixed phrase:
  1. **The success condition in fixed terms.** It says what the role verifies, and forbids substituting a stricter or different standard of the role's own (the qa fixture lesson).
  2. **A denial means stop.** A hook or owner denial is an instruction to stop and report, never an obstacle to route around (T-003).
  3. **One hand-back.** The role delivers exactly one report ending in exactly one `SNAP_HANDBACK` line, claims only a gate in `MAY_HAND_BACK[role]`, and then stops.
  4. **No dispatch.** The role never dispatches or messages another agent. R7 enforces this during a run, and the prompt states it regardless.
  5. **The scope copy.** The role copies `ops.scope` verbatim from its envelope into the hand-back, and leaves the key out when the envelope has none.

  Role-specific content: the success conditions in Gate semantics, plus the allowed test command for code and qa, stated as "run exactly the command named in the run file".
- **D6. Test command resolution at run start.** `orchestrate.mjs start` resolves `test_command` before it creates the run file. The order:
  1. **A root `package.json` with a `scripts.test` key:** the command is the package manager's invocation of the owner's `test` script.
     - **The package manager** is detect-stack's `packageManager` field, resolved from lockfiles by `detectPackageManager` (`scripts/detect-stack.mjs:191-197`).
     - **The command per lockfile:**
       - `package-lock.json` → `npm test`;
       - `pnpm-lock.yaml` → `pnpm test`;
       - `yarn.lock` → `yarn test`;
       - `bun.lockb` → `bun run test`.
     - **Why bun differs:** `bun test` invokes Bun's native test runner and ignores `scripts.test`. `bun run test` runs the owner's script, as the other three managers do under `<pm> test`.
     - **If that field is undefined** (no lockfile), the command is `npm test`. npm ships with Node, which the orchestrator already requires to run at all, so the default adds no dependency. This default is the spec's stated rule, not an inference.
  2. **A root `package.json` without `scripts.test`:** the run halts with `ORCH_TEST_COMMAND_UNRESOLVED`, whatever fallback detect-stack offers (`jest`, `vitest`, `ng test`, ...). A bare runner name is as unrunnable outside `node_modules/.bin` as a script body. The owner adds a test script; the run does not guess a runner invocation.
  3. **No root `package.json`:** detect-stack's `test` value is used as-is, if it is a non-empty string.
  4. **Otherwise:** `ORCH_TEST_COMMAND_UNRESOLVED`.

  detect-stack itself is unchanged, so `/cc-stack` and the BUG-015 fill path are untouched.
- **D7. The record-time invariant: no command is ever recorded that Guard 7 would not pass.**
  - **The check:** after D6 resolves a command, `start` checks it against Guard 7's metacharacter set (a single shared constant, pinned equal in both copies by test). A match halts with `ORCH_TEST_COMMAND_UNSAFE`, and nothing is recorded.
  - **No exemption for the mapped value:** the check runs on `<pm> test` too, at record time, rather than being assumed from how the value is built.
  - **Defense in depth, not a contradiction:** with this invariant, Guard 7's chaining deny (R2) can never block the recorded command.
  - **Where the boundary sits:** Guard 7 matches the invocation string. Any chaining inside `scripts.test` is owner-written content running under the owner's own definition, which is outside FEAT-012's scope.
- **D8. The token ceiling.** The backlog says "under 1000 tokens", read strictly. The measure is `ceil(bytes / 4)` over the whole file, frontmatter included, and the test ceiling is **999**. Bytes are UTF-8 file bytes, so the measure is deterministic and needs no tokenizer dependency.
- **D9. The run file carries `test_command`.**
  - **The invariant:** Guard 7 never allows a command from a run file that does not validate as live (R3).
  - **Deferred to the plan:** whether `orchestrate.mjs` or Guard 6 validate the run file with strict keys, and therefore whether adding the field requires `v: 2`. The plan reads both before task breakdown.
- **D10. How the metacharacter constant is shared, deferred to the plan.**
  - **What AC7 fixes:** the set is a single constant that Guard 7 and `start` both use.
  - **What it leaves to the plan:** whether that is an export from a shared module or a pinned duplicate in each file. This is a wiring decision, so the plan reads `pre-tool-use.mjs` and `orchestrate.mjs` with this question in hand, alongside D9.
- **D11. The allowlist is the test command only, approved as ruling A2.** No role gets a lint command or an auxiliary read-only command.

## Gate semantics

Gate strings are the band gate enum's values, verbatim (`scripts/snap-contract.mjs:56`: `boundary_routed`, `define_approved`, `build_executed`, `verify_pass`, `ship_released`). The may-hand-back mapping is `MAY_HAND_BACK` (`scripts/orchestrate.mjs:32-35`), and it is unchanged.

| Role | May hand back | What the claim means (the role's fixed success condition) |
|---|---|---|
| spec | `boundary_routed` | A spec file was written under `docs/superpowers/specs/**` that answers the item. Open questions are listed in the report and are not decided by the role. |
| plan | `boundary_routed` | A plan file was written under `docs/superpowers/plans/**` from the approved spec. Each task names its files. |
| code | `build_executed` | The role ran the recorded test command after its last edit and reports the exact exit status and summary line. This is code's verify-first obligation before any hand-back. A red suite is reported as red, and the gate claims only that the run happened and was reported. |
| audit | `build_executed` | A static review of the produced diff against the spec and plan was completed, and findings are listed. This is positional over existing artifacts: band row `AGENT-READABLE BACKLOG.md:122`, "Static review pass". |
| qa | `verify_pass` | The role independently re-ran the recorded test command, as a non-author, and the suite passed. This run is authoritative regardless of what code reported. If the suite fails, qa leaves out the `SNAP_HANDBACK` line (`cc-orchestrate.md:91`). |

Re-running by someone who did not write the code is what verifies the work. `build_executed` means code ran the suite and reported the result. `verify_pass` means qa re-ran it and it passed. The gate-semantics limit still stands: a gate certifies protocol position and the stated claim, never work truth beyond what the claim names.

## Behavior

### Run start (additions to `orchestrate.mjs start`)

1. Existing preconditions run first and are unchanged (`ORCH_NO_SESSION_ID`, `ORCH_RUN_ACTIVE`, stale replacement).
2. The test command is resolved per D6. Failure halts with `ORCH_TEST_COMMAND_UNRESOLVED`, writes no run file, and dispatches nothing.
3. The command is checked per D7. Failure halts with `ORCH_TEST_COMMAND_UNSAFE`, writes no run file, and dispatches nothing.
4. The run file is written with `test_command`, and `start` prints the recorded command.

### Guard 7 (tool: `Bash`; applies only when `payload.agent_type` is in `ROLES`)

The rules, in order. The first match decides:
- **R1:** if the role is not `code` or `qa`, deny with `ROLE_SHELL_DENIED: <role> has no shell`.
- **R2:** if the command contains any metacharacter in the shared set, deny with `ROLE_SHELL_CHAINING`. The set is `;` `&` `|` a backtick, `$(`, `<`, `>`, `\n` and `\r`. `&&` and `||` are covered by `&` and `|`.
- **R3:** if the run file is not found by the same ancestor walk Guard 5 uses, does not parse, has no non-empty string `test_command`, or has a `session_id` different from `payload.session_id`, deny with `ROLE_SHELL_UNRESOLVED`.
  - **The stale-run case:** a changed `session_id` resolves here. This matches the router's refusal of a stale run (P12, measured in FEAT-011: `9b472b1a`→`eb0814fd`, exit 2). F2 established that `session_id` is shared across depth, so a live run's subagent matches.
- **R4:** if the command is not byte-for-byte equal to `test_command`, deny with `ROLE_SHELL_NOT_ALLOWED: allowed command is <test_command>`. No trimming or normalization is applied.
- **R5:** otherwise, allow.

Guard 7 is fail-closed: any thrown error inside it denies with `ROLE_SHELL_UNRESOLVED`. A main-session Bash call (no `agent_type`) and a non-role agent's Bash call are not handled by Guard 7. Guard 3's dump scan still runs on every Bash call, and any deny wins.

### Main path

1. `start` records the command (for example `npm test`).
2. code edits within its scope (Guard 5), runs `npm test` (Guard 7 R5), and hands back `build_executed` with the result.
3. audit reviews with Read, Grep and Glob only, and hands back `build_executed`.
4. qa runs `npm test` (R5). If it passes, qa hands back `verify_pass`.

### Alternative paths

- **A non-JS project:** for example, Go records `go test ./...` after the D7 check.
- **An agent adds a flag or trailing whitespace:** R4 denies, and the message names the allowed command so the agent can retry with it.
- **A role used outside a run** (manual `/agents`, a stale run): R3 denies code and qa the shell, and R1 denies the others. Writes are a different matter; see Residual risk.

### Error cases

| Code | Where | Effect |
|---|---|---|
| `ORCH_TEST_COMMAND_UNRESOLVED` | `start` | No run file is written; nothing is dispatched. |
| `ORCH_TEST_COMMAND_UNSAFE` | `start` | No run file is written; nothing is dispatched. |
| `ROLE_SHELL_DENIED` | Guard 7 R1 | The Bash call is denied. |
| `ROLE_SHELL_CHAINING` | Guard 7 R2 | The Bash call is denied. |
| `ROLE_SHELL_UNRESOLVED` | Guard 7 R3 and any internal error | The Bash call is denied. |
| `ROLE_SHELL_NOT_ALLOWED` | Guard 7 R4 | The Bash call is denied, naming the allowed command. |

Under the existing contract, a qa whose suite fails omits the hand-back, and the run halts with `ORCH_HANDBACK_MISSING`.

### Residual risk, stated plainly

- **These profiles are live in this repository.** The parity convention (D1) puts them in `.claude/agents/`.
- **What the standing rule covers:** it forbids starting an `orchestrate.mjs` run or invoking `/cc-orchestrate` here. It does not forbid the files being present.
- **The unguarded path:** dispatching a role manually through `/agents` or `Agent` creates no band envelope. Guard 5 then allows every write, which is ARCH-010's design (no envelope found → allow, `.claude/hooks/pre-tool-use.mjs:137-145`).
- **What still holds:** a role used outside a run is bounded only by its tool mask for writes. Guard 7 still denies it the shell, through R1 or R3.
- **Not fixed here:** FEAT-012 names this risk and leaves it in place. Closing it would change Guard 5's no-envelope behavior, which is out of scope.

## Acceptance Criteria

- [ ] **AC1.** Five files exist at `project-template/.claude/agents/{spec,plan,code,audit,qa}.md`. Each frontmatter has `name:` equal to its role and the `tools:` list from D2, exactly.
- [ ] **AC2.** `.claude/agents/<role>.md` is byte-identical to its template counterpart for all five roles, pinned by a parity test.
- [ ] **AC3.** Each profile measures `ceil(bytes/4) <= 999` over the whole file, pinned by test (D8).
- [ ] **AC4.** Each profile contains all five D5 items, pinned by fixed phrases. The code and qa profiles name the run file's test command as the only command.
- [ ] **AC5.** Each profile's success condition matches its Gate semantics row and names only gates in `MAY_HAND_BACK[role]`.
- [ ] **AC6.** Guard 7 decides R1–R5 as specified:
  - [ ] a test per rule;
  - [ ] a test that R2 precedes R4 for a command equal to `test_command` plus `&& x`;
  - [ ] a test that a thrown error denies;
  - [ ] a test that a main-session payload is not handled.
- [ ] **AC7.** The two `pre-tool-use.mjs` copies stay byte-identical (`tests/installer/templates.test.js:112-117`), and the metacharacter set is a single constant that both Guard 7 and `start` use.
- [ ] **AC8.** `start` resolves per D6:
  - [ ] `npm test`, `pnpm test` and `yarn test` for their lockfiles, and `npm test` with no lockfile;
  - [ ] `bun run test` for `bun.lockb`, never `bun test`;
  - [ ] `ORCH_TEST_COMMAND_UNRESOLVED` for a `package.json` without `scripts.test`, even where detect-stack has a fallback;
  - [ ] detect-stack's value for a non-JS stack;
  - [ ] `ORCH_TEST_COMMAND_UNRESOLVED` for no value.
- [ ] **AC9.** `start` halts with `ORCH_TEST_COMMAND_UNSAFE` for a resolved command containing a metacharacter, and writes no run file (D7).
- [ ] **AC10.** The recorded `test_command` always passes Guard 7, pinned by a test that feeds every AC8 output through Guard 7 as qa.
- [ ] **AC11.** The backlog's literal acceptance criterion holds, read as follows:
  - "Code Agent cannot run general shell commands": one exact-match command with chaining denied is not general shell access (R2 and R4).
  - "QA Agent cannot edit code files": qa's mask has no write tools, and Guard 5 denies a qa write (`tk: 'X'`).
  - Both are pinned by test.
- [ ] **AC12.** The README states:
  - Guard 7;
  - the code/qa enforcement distinction from D4, without calling code's mask a boundary;
  - the residual risk.

  This lands in Known limits, next to the warn+ask matrix.
- [ ] **AC13.** No SNAP contract change: `snap-contract.mjs` is unchanged, as `git diff` on it shows.

## Out of Scope

- **Running lint.** No FEAT-012 gate requires it (D3); `[FEAT-034]` or a later item may claim it.
- **Plan's SQLite tracking writes,** from the backlog's original text. plan has no shell, and the plan markdown is authoritative (ARCH-008).
- **Interactive questioning by the spec role.** This deviates from the backlog's original "interactive developer requirement analysis": a subagent cannot prompt the owner, so open questions go in the report and are ruled at the boundary. The deviation was **approved by the owner at the approval round on 2026-10-02 (ruling A1)**, not assumed.
- **Enforcing the orchestrator's own wait.** D8 stays cooperation.
- **The per-dispatch wake cost.** F3 is reduced by D4, not removed.
- **Closing the no-envelope write path** (Residual risk).
- **The rest of the roster and contract:** `[FEAT-031]`–`[FEAT-036]`, any SNAP contract change, and writes through `NotebookEdit`, MCP tools or symlinks.
- **Changes to detect-stack's output.**

## System Impact

- **New:**
  - `project-template/.claude/agents/{spec,plan,code,audit,qa}.md` and their `.claude/agents/` mirrors;
  - a profile test file (AC1–AC5, AC11);
  - a Guard 7 test file (AC6, AC10).
- **`.claude/hooks/pre-tool-use.mjs` and `project-template/.claude/hooks/pre-tool-use.mjs`:**
  - Guard 7, wired for `Bash` beside Guard 3;
  - the shared metacharacter constant;
  - the `ROLES` copy is pinned by `tests/hooks/guard5.test.js:182-186`.
- **`scripts/orchestrate.mjs`:** D6/D7 resolution in `start`, the `test_command` run-file field, and two new halt codes.
- **`tests/scripts/orchestrate.test.js`:** the fixture agents (`:42-44`) may give way to the shipped profiles where a test needs real masks. The fixture lookup tests stay.
- **`.claude/commands/cc-orchestrate.md` and its template copy:** document the two new start halts, and drop D10's fixture note. The parity test is `tests/installer/commands-parity.test.js:175`.
- **`README.md`:** Guard 7, Known limits (AC12), and the shipped roles.
- **`.gitignore` tracked-surface block:** the new `.claude/agents/*` leaves, in sorted position, pinned by `tests/unit/gitignore-block-parity.test.js`.
- **`CHANGELOG.md`, `VERSION` and the version fields:** `1.37.0`, with record parity.
- **No change:** `scripts/snap-contract.mjs`, `scripts/detect-stack.mjs` and `lib/installer/*`.

### Files Requiring Full Read (deferred to /cc-plan)

- `scripts/orchestrate.mjs`: `start`'s structure, run-file validation (D9 strict keys), and how detect-stack is invoked (import versus spawn of the sibling module, given BUG-051's path class).
- `.claude/hooks/pre-tool-use.mjs`: dispatch wiring for `Bash`, Guard 3 ordering, Guard 5's ancestor-walk helper (for reuse in R3), and Guard 6's run-file reader.
- `scripts/detect-stack.mjs`: the CLI entry and whether a callable export returns `packageManager` and `test`.

## Complexity Estimate

**L.** The release covers five shipped profiles with content tests, a new fail-closed guard in a byte-mirrored hook, a run-start resolution path with two halts, and README and record updates, all bound by cross-file invariants (parity, D7, AC10).
