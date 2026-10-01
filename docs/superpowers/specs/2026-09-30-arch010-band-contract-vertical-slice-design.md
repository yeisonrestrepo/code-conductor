# ARCH-010: Band Contract Vertical Slice (SNAP v3, Gate Enum, One Code→QA Handoff)

**Status:** APPROVED 2026-09-30, with six amendments:
1. the sixth host-owned `skip` row (D3, AC13);
2. the validator line-cap rewrite named in AC4;
3. Case F's band root;
4. the baseline sentence (AC15);
5. the writeback seam;
6. red-first contract tests (AC1, AC2).

D3, D7, Guard 5 cases C–E, `--to <role>`, the required-field rules, AC12's fixtures and `1.35.0` at L are approved in substance.

**Item.** `[ARCH-010]`, minted at approval, after `node tools/id-ceiling.mjs` on both legs (expected next `ARCH-010`). The same backlog edit adds `ARCH-010` to `[ARCH-009]`'s flip condition as a surgical single-line amendment with a grep pre-check.

**Target.** `1.35.0`, a minor release: a contract version and a new guard. Branch `feat/arch-010-band-contract-vertical-slice`.

**Scope by owner addendum.** Vertical slice only, and timeboxed. The deliverable is:
- the band contract;
- its gate enum;
- the SNAP band fields live.

It is sized so `[FEAT-011]` and `[FEAT-012]` can ship one Code→QA handoff:
- a declared write scope;
- Code can write only inside that scope, and QA only runs commands;
- a scope violation is denied at the tool layer.

`[FEAT-031]` through `[FEAT-036]` are post-launch.

## Problem

The band table in `AGENT-READABLE BACKLOG.md` (Pillar 3) is normative, but nothing executes it:
- **The handoff envelope cannot carry a band.** SNAP's `role`, `tk`, `scope`, `gate` and `p` were reserved by `[FEAT-010]` "under v2". v2 then went live as v1 plus `pr` (`[ARCH-008-A]`), so the version those fields were promised is taken by a shape that does not carry them.
- **The tool layer cannot enforce a declared scope.** `pre-tool-use.mjs` does not know which agent is calling it.
- **The validator names the wrong failure for a newer envelope.** Measured 2026-09-30 against the `scripts/snap-validate.mjs` shipped in `1.34.4`:
  - a v3 envelope carrying band fields fails with `SNAP_ERROR: unexpected key: sys.role`;
  - only a v3 with no new keys reaches `SNAP_UNKNOWN_VERSION`.

  The field-set checks (`:15-18`) run before the version check (`:19`).

## Field evidence, read before design

Seven pieces, one spike and one measured defect:

1. **`project.md:1658`, FEAT-021's per-task handoff observations.** In T4, a plan defect was fixed outside its task's lane.
2. **`project.md:1659`: a Verify-band gate must declare what it is able to see, not only what it found.** Three pattern-versus-concept sightings support it:
   - the no-graphify check;
   - the skip-count green;
   - the 1.34.4 fence scanner.
3. **`project.md:1708`: a plan cannot know a tool's live behaviour.** Only an execution against the installed binary reveals it (gh 2.100.0's escape-sequence refusal).
4. **`project.md:1654` and `CONTRIBUTING.md:53`:** test predictions are stated per environment or not at all.
5. **The Build-band routing criterion** in `personal.md` Workflow Preferences and `project.md:1835`: subagent-driven, native or hybrid.
6. **1.34.4 closeout:** plan tooling that cannot read a plan's format is a handoff defect between author and executor.
7. **BUG-048's hybrid split, holding in the field** (`project.md:1709`). Tasks 1–4 were subagent-driven with a reviewer between tasks. Tasks 5–8 ran native, in-session, against live CI in strict run order. That is empirical confirmation of where the Build/Verify boundary sits, distinct from piece 5's criterion.

**Spike, 2026-09-30.** Recorded in `project.md` under "## Spike: does PreToolUse identify subagent tool calls?". The setup was `claude` **2.1.286**, `-p` mode, a scratch repo, a logging PreToolUse hook (`matcher: "*"`), and one subagent definition (`probe-writer`, `tools: Write`).
- **Control.** The main-session `Write` and `Agent` payloads carried `session_id, transcript_path, cwd, prompt_id, permission_mode, effort, hook_event_name, tool_name, tool_input, tool_use_id`.
- **Specimen.** The subagent's `Write` carried the same keys **plus `agent_id` and `agent_type`**, where `agent_type` equals the definition's `name`. `session_id` was shared with the main session.
- **(a)** PreToolUse fires for subagent tool calls.
- **(b)** The identity keys are `agent_id` and `agent_type`.
- **(c)** The main session is distinguishable because it carries neither key; `session_id` cannot separate them.
- **The finding is version-pinned to 2.1.286.**

**Measured defect, folded in by owner ruling: the second sighting of `[BUG-038]`'s check-order class in `snap-validate.mjs`.**
- `[BUG-038]` wrote "the defect is check ORDER, not a drifted literal" about the size check at `:7`, and fixed that ordering.
- It left the same structural defect in the field-versus-version pair undetected.
- The class now has two instances in one validator.

## Solution

**SNAP v3 carries the band.**
- **Contract changes:**
  - `MAX_VERSION` goes from 2 to 3;
  - `TOP_FIELDS[3]` and `POST_PARSE_MAX[3]` are added;
  - block membership becomes **per-version**.
- **v3 field additions:**
  - `sys` gains `role` and `tk`;
  - `ops` gains `scope` and `gate`;
  - `mem` gains `p`.
- **The v1 and v2 block sets stay byte-identical to today.**
- **The gate enum is the band table's five exit conditions.** The role enum is `[FEAT-012]`'s five foundation roles, byte-identical to `[FEAT-010]`'s reserved set.
- **The validator judges `v` before anything whose meaning depends on `v`.** A handoff check halts a receiving role whose incoming `gate` is not the previous band's exit value.
- **Guard 5**, in the existing front door `pre-tool-use.mjs`, denies a write-family tool call from a role agent outside its envelope's declared scope. It arms only when:
  - a band envelope exists;
  - the envelope carries `role` and `scope`;
  - the call's payload carries an `agent_type` naming a role.

  An ordinary session, with no envelope, is byte-identical to today.

### Decisions, each with its grounds

- **D1. v3, not a widened v2.** Owner Q1, with ground 1 restated as measured, in both directions:
  - **Installed 1.34.x readers fail generically** on any newer envelope that carries new keys. That is a schema error indistinguishable from corruption, whether the envelope is a widened v2 or a v3.
  - **Readers from ARCH-010's release onward** give the named `SNAP_UNKNOWN_VERSION` for every later version, because D2 fixes the order.
  - **v3 still beats widening v2,** because only a new version plus the fixed ordering can deliver that guarantee going forward.
  - **"v2" keeps exactly one meaning**, and no version ever names two shapes.
  - **The change lands where `[BUG-038]` built it to land:** `MAX_VERSION`, `TOP_FIELDS[3]` and `POST_PARSE_MAX[3]`.
- **D2. The validator checks the version first, folded in by owner ruling (the `[BUG-042]` fold criterion).**
  - **The ordering.** After the root-object check, and before the block-presence check (today's `:11`), the validator decides `v`:
    - absent: `missing: v`;
    - not a positive integer: `v must be a positive integer`;
    - greater than `MAX_VERSION`: `SNAP_UNKNOWN_VERSION`.
  - **The ruling.** No separate id is minted. This spec and ARCH-010's DONE bullet both name the validator ordering defect, per the supersession bookkeeping convention.
- **D3. The band envelope lives in its own file, `.claude/memory/band-envelope.json`, and the file is load-bearing.**
  - **Why it bounds exposure.** No 1.34.x reader opens it: `resume-read` and `conductor-db` read only the compaction and checkpoint snapshots, which stay v1 and v2. That is why the installed base's generic-error window from D1 is narrow.
  - **The rejected alternative.** Putting band state into `session-snapshot.json` would also put v3 in front of every installed `resume-read`, and a `/cc-compact` would silently overwrite the envelope and disarm Guard 5.
  - **Ignoring it.** The path joins the managed `.gitignore` entry set as its fourth entry, through the `[BUG-049]` labelled-block mechanism.
  - **It is host-owned (the `[BUG-039]` contract).**
    - `lib/installer/host-owned.mjs` `PROJECT_HOST_OWNED` gains `['memory/band-envelope.json', 'skip']`.
    - Its `skip` rows are recorded as the exhaustive set of runtime-written files under `.claude/memory/`, so the envelope becomes the sixth `skip` row.
    - Without that row, the exhaustiveness claim would go false, and the file would be protected only by its absence from the template. That is the exact condition `[BUG-039]` turned into a contract.
    - `tests/unit/host-owned-ignore-xor.test.js` covers the row with no new test.
- **D4. The full gate enum, and the five foundation roles (owner Q4).**
  - **Gate values:** `boundary_routed`, `define_approved`, `build_executed`, `verify_pass`, `ship_released`. Each is band-prefixed and asserts its band's **whole** exit condition. The per-condition breakdown lives in `mem.p` as gate evidence. `verify_pass`, not "green": Verify's exit is composite, and a token naming one of its three conditions is piece 2's defect spelled into the enum.
  - **Role values:** `spec|plan|code|audit|qa`.
  - **The asymmetry is deliberate.** A gate value names a band's exit condition, which the normative table fixes today independent of any implementation. Encoding all five is contract about the topology, and it costs data only. A role value names an agent that must have a mask and behaviour behind it, which is contract about an implementation.
  - **Why the roster stops at five.** Guard 5 trusts `agent_type` against `role`, so every role value with no real agent behind it is trusted surface with no behaviour backing it. The roster widens at v4, when an agent exists to claim the new value.
- **D5. Guard 5 lives in the front door (owner Q3).**
  - **One deny path.** One deny path and one `permissionDecision` contract, mirrored byte-for-byte into `project-template/` and parity-tested. A separate hook would reinstate the two deny paths `[BUG-036]` removed.
  - **QA's command-only side does not ride Guard 5.** The subagent's `tools:` allow-list is the mask at tool-name level: QA simply has no `Write` or `Edit`. Guard 5 covers the one thing frontmatter cannot express, path scope for Code. The absence of a tool is not a deny contract, so the tool layer keeps exactly one deny contract.
- **D6. Identity source: the payload's `agent_type`, as measured by the spike.**
  - The main session carries no `agent_type`, so it is never subject to Guard 5.
  - No fallback branch exists.
- **D7. The hook carries its own band constants**, and a parity test pins them to `snap-contract.mjs`:
  - the role enum;
  - the `tk` enum;
  - the write-family tool names.

  **Why.** The hook is a zero-dependency file mirrored to two locations. In this repository the contract sits at `scripts/`; in an installed project it sits at `.claude/scripts/`. No relative import is correct in both places, and the existing hook-parity discipline already covers this shape.

## Behavior

### SNAP v3

1. **The shape:**
   - **Top-level:** `TOP_FIELDS[3] = ['v', 'sys', 'ops', 'mem', 'pr']`, with `pr` optional as in v2.
   - **Blocks:** `BLOCK_FIELDS[3]`:
     - `sys: [ph, c, s, role, tk]`;
     - `ops: [n, f, scope, gate]`;
     - `mem: [d, x, p]`.
2. **Required in v3:**
   - `role`, which is in the role enum;
   - `tk`, one of `R|RW|X`;
   - `gate`, which is in the gate enum.

   `scope` is required when `tk` is `RW`: an array of repo-relative POSIX globs, where `**` matches any depth and `*` matches within one segment. `p` is optional, and must be a plain object when present.
3. **Size and caps:**
   - `POST_PARSE_MAX[3]` equals `PRE_PARSE_MAX_BYTES`, because the envelope is not a context-budget file.
   - The caps for `ops.scope` are defined for v3 only.
   - v1 and v2 validation is unchanged for every valid and invalid v1/v2 payload, except for the error-order changes D2 names.
4. **`snap-build.mjs`** emits v3 exactly when its flat input carries any band field. It emits v1/v2 otherwise, byte-identically to today.

### Handoff check

`node scripts/snap-validate.mjs <file> --to <role>` validates the envelope, then requires its `gate` to equal the exit value of the band before the receiving role's band.

- **Band order:** Boundary → Define → Build → Verify → Ship.
- **Band of each role:**
  - `spec` and `plan` → Define;
  - `code` → Build;
  - `audit` and `qa` → Verify.
- **Example:** receiving `qa` expects `build_executed`.
- **On a mismatch** it exits 1 with `SNAP_ERROR: SNAP_GATE_MISMATCH: <role> expects <gate>, got <gate>`. That is the named halt `[ARCH-009]`'s criterion requires.

### Guard 5 (write-family tools: `Write`, `Edit`, `create_file`, `write_file`)

Guard 5 takes the cases in this order:

| # | Condition | Result |
|---|---|---|
| A | The payload has no `agent_type`, or its `agent_type` is not a role | not armed: allow, and the other guards run as today |
| B | Role agent, no envelope file | Case A: nothing to verify, allow |
| C | Role agent, envelope present but unreadable or invalid (not v3, or `role` missing) | deny, `Guard 5: BAND_ENVELOPE_INVALID`, naming the file |
| D | Role agent whose `agent_type` differs from the envelope's `role` | deny, `Guard 5: BAND_ROLE_MISMATCH` (an agent writing outside the active band) |
| E | Role matches, `tk` is not `RW` | deny, `Guard 5: BAND_READ_ONLY` |
| F | Role matches, `tk` is `RW`, and the target path (resolved against the payload `cwd`) is outside the band root or matches no `scope` glob, relative to the band root | deny, `Guard 5: BAND_SCOPE_VIOLATION: <path> is outside the declared scope [<globs>]` |
| G | Role matches, `tk` is `RW`, and the path is in scope | Guard 5 allows. Guards 1, 2 and 4 still apply. |

Every deny uses the existing `deny()` shape and exits 0, per the hook contract.

**The band root, ruled by the owner.** Guard 5 finds the envelope by walking up from the payload's `cwd` to the first `.claude/memory/band-envelope.json`, and that directory is the band root. The `scope` globs anchor at the band root. One rule serves both discovery and anchoring, so no second way of resolving the root is invented.

### Alternative paths

- **Interactive mode:**
  - The spike measured `-p` only. The plan's first verification step re-runs the logging probe once in interactive mode, against the installed binary, before any guard code is written.
  - If the identity keys differ, the plan halts for a ruling.
- **v1/v2 snapshots** pass through `resume-read`, `conductor-db` and `/cc-compact` exactly as today.

### Error cases

- **Envelope edge cases:** a malformed envelope gets Case C, fail-closed for role agents only. An envelope larger than the pre-parse ceiling is rejected the same way.
- **A scope glob that can never match** is not detected. It shows up as denials, which is the safe side.

## Acceptance Criteria

- [ ] **AC1, contract version.**
  - `MAX_VERSION === 3`;
  - `TOP_FIELDS[3]` and `POST_PARSE_MAX[3]` exist;
  - a contract test pins all three, run red against the current contract first.
- [ ] **AC2, the block-membership shape change, pinned explicitly.** `BLOCK_FIELDS` becomes a per-version map:
  - `BLOCK_FIELDS[1]` and `BLOCK_FIELDS[2]` deep-equal today's shared map `{ sys: ['ph','c','s'], ops: ['n','f'], mem: ['d','x'] }`;
  - `BLOCK_FIELDS[3]` adds exactly `role`, `tk`, `scope`, `gate` and `p` in their blocks.

  It is named as a shape change, and a contract test pins it, run red against the current contract first. The red is trivial today, because `BLOCK_FIELDS[1]` does not exist, which is why it is cheap to prove.
- [ ] **AC3, the version is checked first (D2).**
  - **Red first:** the test is run red on the current ordering.
  - **The envelope:** an envelope at `v: MAX_VERSION + 1`, with `MAX_VERSION` imported from `snap-contract.mjs` and never written as a literal, carrying unknown block keys.
  - **The assertion:** it fails with exactly `SNAP_ERROR: SNAP_UNKNOWN_VERSION`, and not with an unexpected-key error.
- [ ] **AC4, existing assertions that change, each named as a contract-correct rewrite and never adjusted quietly (the `[BUG-036]` standing rule):**
  - `tests/unit/snap-validate.test.js:97` and `:310` use a literal `v: 3`, which becomes a valid version. Both become `MAX_VERSION + 1`.
  - `:405` asserts the shared `BLOCK_FIELDS` shape. It becomes the per-version shape of AC2.
  - `tests/unit/snap-contract.test.js:61` (`MAX_VERSION === 2`) and `:62` (`POST_PARSE_MAX` keys `[1, MAX_VERSION]`) are rewritten to the v3 contract.
  - **The validator line cap,** `tests/unit/snap-validate.test.js:250` (`toBeLessThanOrEqual(32)` over non-blank, non-comment lines). The v3 rules, the reorder and `--to` will exceed it. Per the `[BUG-038]` convention ("update the assertion when the validator legitimately grows"), the new expected count is stated at plan time and the assertion is updated to it.

  No existing multi-defect fixture changes its first error. The one untested behaviour change is that a payload missing `v` reports only `missing: v`, not the full missing list. The plan restates the per-environment counts.
- [ ] **AC5, v3 validation.**
  - The valid v3 envelopes for each role pass.
  - Each named defect fails with its own message:
    - a missing or out-of-enum `role`, `tk` or `gate`;
    - a missing `scope` under `RW`;
    - a non-object `p`;
    - a v3-only key on a v1 or v2 payload.
- [ ] **AC6, `snap-build` emits v3** exactly when a band field is present, and its v1/v2 output is byte-identical to today's on the existing suite.
- [ ] **AC7, handoff check.** `--to qa` passes with `build_executed`, and fails with `SNAP_GATE_MISMATCH` for each of the other four gate values. The full role-to-expected-gate map is pinned.
- [ ] **AC8, Guard 5 cases A–G,** one test per case, through the hook's real stdin/stdout contract, with payload shapes copied from the spike's measured keys. The Case F fixtures use a subdirectory `cwd`, so the band-root walk-up and glob anchoring are exercised, not assumed.
- [ ] **AC9, an ordinary session is byte-identical.** With no envelope file, Guard 5 adds no decision, and every existing hook test passes unmodified.
- [ ] **AC10, mirror and constants parity.** `project-template/.claude/hooks/pre-tool-use.mjs` is byte-identical to `.claude/hooks/pre-tool-use.mjs`, and a test pins the hook's band constants to `snap-contract.mjs` (D7).
- [ ] **AC11, interactive probe** (plan's first verification step). The logging probe is re-run once in interactive mode against the installed `claude`, and its version and verbatim identity keys are recorded beside the spike's.
- [ ] **AC12, the demo handoff: one Code→QA handoff, run interactively in a scratch project** with two fixture agent definitions:
  - `code`, with `tools: Read, Grep, Glob, Write, Edit`;
  - `qa`, with `tools: Read, Grep, Glob, Bash`.

  It records:
  - an in-scope write allowed;
  - an out-of-scope write denied with `BAND_SCOPE_VIOLATION`;
  - QA with no write tool;
  - `--to qa` passing on `build_executed`.

  The fixtures are not deployed by the installer, because `[FEAT-012]` owns shipped profiles.
- [ ] **AC13, `.gitignore` and host ownership.**
  - `.claude/memory/band-envelope.json` joins `project-template/gitignore` as the fourth managed entry. The `[BUG-049]` merge gathers it like the other three, and `templates.test.js` pins it.
  - `PROJECT_HOST_OWNED` gains `['memory/band-envelope.json', 'skip']` (D3), covered by `host-owned-ignore-xor.test.js`.
- [ ] **AC14, records.**
  - `[ARCH-010]` is minted after the ceiling run on both legs, with `[ARCH-009]`'s flip condition amended in the same edit.
  - Its DONE bullet follows the "shipped as X.Y.Z" convention and names the folded validator-ordering defect.
  - Release `1.35.0`, with record parity proven red with the heading at `[ ]` and green on the real flip.
- [ ] **AC15, baseline.** This slice adds passing tests only. The skipped sets, and therefore `tools/skip-baseline.json`, do not change.

## Out of Scope

- **Not in this slice:**
  - `[FEAT-031]`–`[FEAT-036]`, the orchestrator loop (`[FEAT-011]`) and shipped role profiles (`[FEAT-012]`).
  - Any role beyond the five, which waits for v4.
  - `[BUG-050]`, the instruments' silence on sub-shaped ids.
- **Guard 5 is not an adversarial defense.** Its threat model for the slice is cooperative agents and misconfiguration. `agent_type` is a name taken on trust, and a hostile agent definition named `code` is a non-goal.
- **Not covered by Guard 5 in this slice:**
  - writes through `Bash` by a role agent that has `Bash`, which the Code fixture's tools mask excludes;
  - `NotebookEdit` and MCP write tools;
  - symlink resolution of target paths.
- **The `multi-agent` keyword stays held.** This slice ships no agent.
- **The writeback seam.** `ship_released` is defined by this contract. The Release-to-Ticket closure that consumes it belongs to `[FEAT-031]`, and is deferred in full.

## System Impact

- **`scripts/snap-contract.mjs`:** `MAX_VERSION`, `TOP_FIELDS[3]`, `POST_PARSE_MAX[3]`, per-version `BLOCK_FIELDS`, and the gate, role and `tk` enums. It also gains the role-to-band map and the band-exit order.
- **`scripts/snap-validate.mjs`:** the version check moves first (D2), v3 field rules, v3-only caps, and `--to <role>`.
- **`scripts/snap-build.mjs`:** v3 emission.
- **`scripts/conductor-db.mjs`:** imports only `PRE_PARSE_MAX_BYTES`, so it is unaffected. It is verified by its suite.
- **`.claude/hooks/pre-tool-use.mjs` and its `project-template/` mirror:** Guard 5.
- **`project-template/gitignore`:** the fourth entry.
- **`lib/installer/host-owned.mjs`:** the sixth `skip` row.
- **Tests:**
  - `tests/unit/snap-contract.test.js`;
  - `tests/unit/snap-validate.test.js`;
  - `tests/scripts/snap-build.test.js`;
  - the hook tests;
  - `tests/installer/templates.test.js` and the `deploy.test.js` fixture.
- **`README.md`:** the guard list gains Guard 5.
- **`AGENT-READABLE BACKLOG.md`:** the `[ARCH-010]` mint and the `[ARCH-009]` flip-condition line.

### Files Requiring Full Read (deferred to /cc-plan)

- `scripts/snap-validate.mjs` (32 lines; read to `:30` here).
- `scripts/snap-build.mjs` (87 lines).
- `.claude/hooks/pre-tool-use.mjs` (608 lines).
- `tests/unit/snap-validate.test.js` (424 lines; the assertions AC4 names were read).

## Complexity Estimate

**L.**
- **Three areas of code change:** a contract version touching the writer, the validator and their suites; a new guard in a 608-line mirrored hook; and two live verification steps (the interactive probe and the demo handoff).
- **Per-environment risk:** low. The new tests run identically on Node 20 and 24, because nothing here touches `node:sqlite`.
