# ARCH-010 Band Contract Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native tasks) and superpowers:subagent-driven-development (T-005 only, see Routing). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the band contract executable. SNAP v3 carries the band fields, the validator decides `v` first and checks a handoff's gate with `--to <role>`, and Guard 5 denies a role agent's write outside its envelope's declared scope. Ship it as `1.35.0`.

**Architecture:**
- `scripts/snap-contract.mjs` gains v3: `MAX_VERSION = 3`, per-version `BLOCK_FIELDS`, `TOP_FIELDS[3]`, `POST_PARSE_MAX[3]`, `V3_CAPS`, the role, `tk` and gate enums, the band order, the role-to-band map, `expectedGate(role)` and `WRITE_TOOLS`.
- `scripts/snap-validate.mjs` decides `v` before anything that depends on it (D2), then applies the v3 rules and the optional `--to <role>` handoff check.
- `scripts/snap-build.mjs` emits v3 exactly when its input carries a band field. Its v1/v2 output is unchanged byte for byte.
- `.claude/hooks/pre-tool-use.mjs` and its `project-template/` mirror gain Guard 5, first in the dispatch list of every write-family tool. It carries its own copies of the band constants, pinned to the contract by a test (D7).
- `.claude/memory/band-envelope.json` becomes the fourth managed `.gitignore` entry and the sixth `skip` row of `PROJECT_HOST_OWNED`.

**Tech Stack:** Node ≥ 20 ESM, zero-dependency scripts, vitest, the `tools/` instruments.

**Spec:** `docs/superpowers/specs/2026-09-30-arch010-band-contract-vertical-slice-design.md`, APPROVED 2026-09-30 with six amendments (`85df4cb`).

## Global Constraints

- **Release:** `1.35.0`, a minor release. Branch `feat/arch-010-band-contract-vertical-slice`.
- **Enums, verbatim:**
  - roles `spec|plan|code|audit|qa`;
  - `tk` `R|RW|X`;
  - gates `boundary_routed`, `define_approved`, `build_executed`, `verify_pass`, `ship_released`.
- **Band order:** Boundary → Define → Build → Verify → Ship. `spec` and `plan` sit in Define, `code` in Build, `audit` and `qa` in Verify.
- **Write-family tools:** `Write`, `Edit`, `create_file`, `write_file`.
- **Envelope path:** `.claude/memory/band-envelope.json`. The band root is the nearest ancestor of the payload `cwd` that holds it, and the `scope` globs anchor there.
- **v1 and v2 are unchanged:** same block sets, same `snap-build` bytes, same validation of every valid and invalid v1/v2 payload. The only exception is the error order D2 names.
- **The validator line cap moves from 32 to 38** (AC4, as amended). This is stated here, before anything runs. 38 is the measured count of the final validator in T-003 under the test's own rule (non-blank lines that are not `//` comments). It was measured on a scratch draft during planning.
- **Baseline (AC15):** the slice adds passing tests only. `tools/skip-baseline.json` does not change.
- **Staging:**
  - `git add -u <path>` for tracked files;
  - plain `git add <path>` for new files under `tests/`;
  - the plan file goes in after its leaf lands;
  - never a bare `git add -u`.
- **Interim constraints from 2026-10-01's incidents, binding on every task:**
  - never run the installer in this repository (`[BUG-052]`);
  - never run the pre-commit test gate from a linked worktree, so no `isolation: "worktree"` for any agent (`[BUG-053]`);
  - run conductor scripts from source `scripts/`, never `.claude/scripts/` (`[BUG-051]`).
- **Owner-only actions:** the agent opens the PR and stops at green. The merge and the GitHub Release `v1.35.0` are the owner's.

## Predictions, per environment

Every new test runs in all three environments. None of the touched test files is skipped on either CI leg: the skipped sets are `heal`, `code-conductor-plugin`, `conductor-db`, `handoff-cycle` and `resume-read`. Only the passed counts move.

| after | local | ci-node20 | ci-node24 |
|---|---|---|---|
| now (measured 2026-10-01 at `85df4cb`) | 1081 / 0 | 985 / 96 | 1068 / 13 |
| T-000 plan commit and main merge | 1081 / 0 | n/a | n/a |
| T-001 interactive probe | 1081 / 0 | n/a | n/a |
| T-002 contract v3, version first | **1086 / 0** (+5) | n/a | n/a |
| T-003 v3 rules and `--to` | **1120 / 0** (+34) | n/a | n/a |
| T-004 `snap-build` v3 | **1128 / 0** (+8) | n/a | n/a |
| T-005 Guard 5 | **1152 / 0** (+24) | n/a | n/a |
| T-006 `.gitignore` and host ownership | **1153 / 0** (+1) | n/a | n/a |
| T-007 demo handoff | 1153 / 0 | n/a | n/a |
| T-008 README and release | **1153 / 0** | **1057 / 96**, `SKIP_BASELINE_OK` | **1140 / 13**, `SKIP_BASELINE_OK` |

- **Totals:** 1153 on every leg. (amended 2026-10-01 at T-005-F by owner ruling: one added [A] test, slice delta 71 → 72)
- **Test files:** local goes from 43 to **44 passed**. The new file is `tests/hooks/guard5.test.js`.
- **Halt rule:** any count that differs from its row halts the task before its commit. A prediction is amended before it is measured, never absorbed after.

## Routing (carry-forward point 3, the Build-band criterion applied to this plan)

| Task | Route | Ground |
|---|---|---|
| T-000, T-006, T-008 | native | small, shared records, sequential |
| T-001, T-007 | in-session, live | they run against the installed `claude`. The owner drives the interactive terminal, and the agent prepares the fixtures and reads the logs. |
| T-002, T-003, T-004 | native | They share `snap-contract.mjs` and the SNAP test files. T-003 depends on T-002's intermediate validator, and T-004 on T-002's `V3_CAPS`. |
| T-005 | **subagent, then a reviewer** | It is isolated: one mirrored hook and one new test file. It consumes the contract by value only, and a fresh reviewer is worth a gate on a guard that can deny tools. |

**Two constraints on the T-005 subagent:**
- it runs in the main checkout, never in a worktree (`[BUG-053]`);
- it does not commit. The orchestrating session reviews, measures and commits.

## Review Focus

1. **The Write tool sends an absolute `file_path`, while `cwd` is often a subdirectory of the band root.** Expected: an absolute target inside a `scope` glob is allowed. The path is made relative to the band root, never to `cwd`. Pinned by T-005's `[G] absolute` and `[F] anchors at the band root` tests.
2. **A target that escapes the band root, versus a file whose name merely starts with `..`.** Expected: `../x` and any sibling absolute path are denied, and `..notes.md` inside the root is inside. Pinned by T-005's `[F] above the band root` and `..`-name tests.
3. **Nested projects, each with its own envelope.** Expected: the nearest envelope above `cwd` governs, and an outer one is never consulted. Pinned by T-005's nearest-envelope test.
4. **`--to` aimed at a v1/v2 envelope, or naming an unknown role.** Expected: a named error, never a silent pass or a crash. Pinned by T-003's two `--to` error tests.
5. **An `RW` envelope with an empty `scope`.** Expected: every write is denied, which is the safe side of the spec's "a glob that can never match" rule. Pinned by T-005's empty-scope test.

## Rulings in this plan (each one is the owner's to overturn)

- **R1, merge, not rebase.** T-000 merges `origin/main` (`3bcfdcf`, carrying the BUG-051/052/053 filings) into the branch.
  - **Why not rebase:** a rebase would rewrite `85df4cb`, which `project.md` and the spec status cite by sha.
  - **Evidence:** `git merge-tree --write-tree HEAD origin/main` exited 0 on 2026-10-01, so there are no conflicts. Main touched only `AGENT-READABLE BACKLOG.md` and `README.md`.
- **R2, `V3_CAPS = { 'ops.scope': [20, 300] }`, a table of its own.**
  - `CAPS`'s four keys are pinned by `snap-contract.test.js:34`, and the v1/v2 caps must not change.
  - The caps mirror `ops.f`.
- **R3, `snap-build` refuses an incomplete band input.**
  - It dies on a missing `role`, `tk` or `gate`, on a non-array `scope`, and on a non-object `p`, the same way it dies today on a missing `ph`.
  - v3 always carries `pr`, possibly `""`, through the v2 truncation path.
  - **Cost if wrong:** three `die` lines.
- **R4, `--to` errors.**
  - A v1/v2 envelope gets `--to requires a v3 envelope`.
  - Any third argument other than `--to <role>` gets `usage: snap-validate.mjs <file> [--to spec|plan|code|audit|qa]`.
- **R5, Guard 5 checks only what it reads.**
  - An envelope is valid for Guard 5 when:
    - `v === 3`;
    - `sys` and `ops` are plain objects;
    - `role` and `tk` are in their enums;
    - under `RW`, `scope` is an array of strings.
  - Anything else is Case C. `gate` is the validator's business, not the hook's.
- **R6, the hook carries a fourth constant, `BAND_ENVELOPE_MAX_BYTES = 10485760`.** The spec's error case ("larger than the pre-parse ceiling … rejected the same way") needs it, and the same parity test pins it to `PRE_PARSE_MAX_BYTES`. This extends D7's list by one entry.
- **R7, a missing or empty payload `cwd` falls back to `process.cwd()`.** The spike measured `cwd` on every payload, and the hook runs at the project root.
- **R8, a role agent's write call with no path, under `RW`, gets `BAND_SCOPE_VIOLATION` naming `<no path>`.**
- **R9, `BAND_WRITE_TOOLS` drives the registration.** Guard 5 is put first on each write-family tool's list from that constant, so the pinned copy is load-bearing rather than decorative. It runs first because a scope deny outranks Guard 2's `ask`. After Guard 5 allows, Guards 2 and 4 run as today (Case G).
- **R10, glob semantics:**
  - `**/` matches zero or more directories;
  - `**` matches anything;
  - `*` matches within one segment;
  - every other character is literal, including `?` and `[`.
- **R11, the owner drives both live runs** in a separate terminal, because an interactive TUI cannot be driven from this session. The agent writes every fixture, gives the prompt verbatim, and reads the logs back.

---

- [X] [T-000] **Plan commit and main merge.** The branch gate is silent here because the current branch equals the derived `feat/arch-010-band-contract-vertical-slice`.
  - [X] [T-000-A] Modify `.gitignore`: add `!/docs/superpowers/plans/2026-10-01-arch010-band-contract-vertical-slice.md` immediately after `!/docs/superpowers/plans/2026-09-30-bug049-claude-md-clobber.md` (:96), in sorted position.
  - [X] [T-000-B] Modify `.claude/memory/project.md`: append at the end of the file
    ```markdown

    ## Plan: ARCH-010 implementation [2026-10-01]

    Plan `docs/superpowers/plans/2026-10-01-arch010-band-contract-vertical-slice.md`. Routing: T-002–T-004 native (shared contract files), T-005 subagent then reviewer (main checkout, no worktree, no commit: BUG-053), T-001 and T-007 live in-session, the rest native. Validator line cap 32 → 38, stated before running. Handoff observations, one line per task:
    ```
  - [X] [T-000-C] `git add -u .gitignore .claude/memory/project.md`, then `git add docs/superpowers/plans/2026-10-01-arch010-band-contract-vertical-slice.md`. `project.md` carries the five carry-forward points, the reporting note and both 2026-10-01 incident records, all uncommitted since the spec.
  - [X] [T-000-D] Commit `docs: add the ARCH-010 implementation plan [ARCH-010]`. Expected: the hook suite passes at **1081 / 0**.
  - [X] [T-000-E] Run `git fetch origin`, then `git rev-parse origin/main`. Expected: `3bcfdcf…`. **Halt if `origin/main` moved**, and re-measure the merge before going on.
  - [X] [T-000-F] Run `git merge --no-ff -m "chore: merge main's BUG-051, BUG-052 and BUG-053 filings into the ARCH-010 branch [ARCH-010]" origin/main`. Expected: no conflicts (R1).
  - [X] [T-000-G] Run `npm test`, expecting **1081 / 0**. Then `node tools/id-ceiling.mjs`: the working tree now reads `{"BUG":53,"FEAT":40,"ARCH":10}`, origin/main `{"BUG":53,"FEAT":40,"ARCH":9}`, union next `BUG-054`. Then `node tools/record-parity.mjs`, expecting `RECORD_PARITY_OK`.
  - [X] [T-000-H] Append to `project.md` under the plan section: `- T-000: <one line of handoff observation>`. This line rides T-001's commit.

- [X] [T-001] **AC11: the interactive identity probe, the plan's first verification step, before any guard code.** Depends on T-000. **Halt rule:** if a subagent's `Write` does not carry `agent_id` and `agent_type`, or if the main session's payload carries either key, stop for a ruling. Guard 5 code is not written until it is given. Other key-set differences are recorded, not halted on.
  - [X] [T-001-A] Create the scratch probe repository at `<scratchpad>/probe-ac11`, outside this repository, and run `git init` there. Write these files:
    - `.claude/settings.json`:
      ```json
      { "hooks": { "PreToolUse": [ { "matcher": "*", "hooks": [ { "type": "command", "command": "node .claude/hooks/log.mjs" } ] } ] } }
      ```
    - `.claude/hooks/log.mjs`. It logs every raw payload and allows by printing nothing:
      ```js
      import { appendFileSync, readFileSync } from 'node:fs';
      appendFileSync('payloads.jsonl', readFileSync(0, 'utf8').trim() + '\n');
      ```
    - `.claude/agents/probe-writer.md`:
      ```markdown
      ---
      name: probe-writer
      description: Writes one file when asked. Used only by the ARCH-010 identity probe.
      tools: Write
      ---
      Write exactly the file you are asked to write, then stop.
      ```
    - `read-payloads.mjs`, the reader:
      ```js
      import { readFileSync } from 'node:fs';
      for (const line of readFileSync('payloads.jsonl', 'utf8').trim().split('\n')) {
        const p = JSON.parse(line);
        console.log(p.tool_name, JSON.stringify(Object.keys(p)), `agent_id=${p.agent_id ?? '-'}`, `agent_type=${p.agent_type ?? '-'}`);
      }
      ```
  - [X] [T-001-B] Run `claude --version` and record it verbatim.
  - [X] [T-001-C] **Owner, in a separate terminal:** `cd <scratchpad>/probe-ac11 && claude`, then trust the folder. Send this prompt verbatim:

    `Write a file main.txt containing the word main. Then use the probe-writer agent to write sub.txt containing the word sub. Do not write any other file.`

    Approve both writes, then `/exit`.
  - [X] [T-001-D] Run `node read-payloads.mjs` in the probe directory. Compare it with the spike (`project.md`, "## Spike: does PreToolUse identify subagent tool calls?"):
    - the control key set;
    - the specimen set, which should be the control set plus `agent_id` and `agent_type`, with `agent_type === "probe-writer"`;
    - whether `session_id` is shared.

    Apply the halt rule.
  - [X] [T-001-E] Modify `.claude/memory/project.md`: insert directly after the spike section's handoff-observation bullet (:2040) a sub-block:
    ```markdown
    - **AC11 interactive re-run (2026-10-01, `claude` <version>, interactive mode):** <the verbatim reader output>. (a) <answer>. (b) <answer>. (c) <answer>. <Key-set differences from the -p spike, or "none">.
    ```
    Then append `- T-001: <one line of handoff observation>` under the plan section.
  - [X] [T-001-F] `git add -u .claude/memory/project.md` and `git add -u docs/superpowers/plans/2026-10-01-arch010-band-contract-vertical-slice.md` (amended at execution 2026-10-01 by owner ruling: the plan's ticked boxes ride this commit, per T-000's precedent). Commit `docs: record the ARCH-010 interactive identity probe (AC11) [ARCH-010]`. Expected: **1081 / 0**.

- [X] [T-002] **Contract v3, with the version decided first** (AC1, AC2, AC3, AC4 and D2). Native. Depends on T-001's verdict.

  **Interfaces:**
  - *Produces*, for T-003 to T-005: these exports of `scripts/snap-contract.mjs`:
    - `MAX_VERSION = 3`;
    - `POST_PARSE_MAX[3]`;
    - `TOP_FIELDS[3]`;
    - `BLOCK_FIELDS[1|2|3]`;
    - `V3_CAPS`;
    - `ROLES`, `TOOL_KINDS`, `BANDS`, `GATES` and `ROLE_BAND`;
    - `WRITE_TOOLS`;
    - `expectedGate(role) → string`.
  - [X] [T-002-A] Modify `tests/unit/snap-contract.test.js`.
    - **Add an import below line 6.** The new names are reached through the namespace, so each new test goes red on its own instead of failing the file's module link:
      ```js
      import * as contract from '../../scripts/snap-contract.mjs'
      ```
    - **Rewrite the test at :56–63, named as a contract-correct rewrite** (`[BUG-036]` standing rule: v3 moves the ceiling):
      ```js
        it('pins both tiers and the version ceiling to single values', () => {
          expect(PRE_PARSE_MAX_BYTES).toBe(10485760)
          expect(V1_MAX_CHARS).toBe(4096)
          expect(POST_PARSE_MAX[1]).toBe(V1_MAX_CHARS)
          expect(POST_PARSE_MAX[2]).toBe(PRE_PARSE_MAX_BYTES)
          expect(POST_PARSE_MAX[3]).toBe(PRE_PARSE_MAX_BYTES)
          expect(MAX_VERSION).toBe(3)
          expect(Object.keys(POST_PARSE_MAX).map(Number)).toEqual([1, 2, MAX_VERSION])
        })
      ```
    - **Append inside the `describe`:**
      ```js
        it('[AC1] defines v3: the version ceiling, its top-level fields and its post-parse cap', () => {
          expect(contract.MAX_VERSION).toBe(3)
          expect(contract.TOP_FIELDS[3]).toEqual(['v', 'sys', 'ops', 'mem', 'pr'])
          expect(contract.POST_PARSE_MAX[3]).toBe(contract.PRE_PARSE_MAX_BYTES)
        })

        it('[AC2] keys block membership by version, with v1 and v2 exactly as before', () => {
          const V1 = { sys: ['ph', 'c', 's'], ops: ['n', 'f'], mem: ['d', 'x'] }
          expect(contract.BLOCK_FIELDS[1]).toEqual(V1)
          expect(contract.BLOCK_FIELDS[2]).toEqual(V1)
          expect(contract.BLOCK_FIELDS[3]).toEqual({
            sys: ['ph', 'c', 's', 'role', 'tk'], ops: ['n', 'f', 'scope', 'gate'], mem: ['d', 'x', 'p'],
          })
          expect(Object.keys(contract.BLOCK_FIELDS).map(Number)).toEqual([1, 2, 3])
        })

        it('holds the band enums, the band order and the handoff map [ARCH-010]', () => {
          expect(contract.ROLES).toEqual(['spec', 'plan', 'code', 'audit', 'qa'])
          expect(contract.TOOL_KINDS).toEqual(['R', 'RW', 'X'])
          expect(contract.BANDS).toEqual(['boundary', 'define', 'build', 'verify', 'ship'])
          expect(contract.GATES).toEqual(['boundary_routed', 'define_approved', 'build_executed', 'verify_pass', 'ship_released'])
          expect(contract.WRITE_TOOLS).toEqual(['Write', 'Edit', 'create_file', 'write_file'])
          expect(contract.V3_CAPS).toEqual({ 'ops.scope': [20, 300] })
          expect(Object.fromEntries(contract.ROLES.map(r => [r, contract.expectedGate(r)]))).toEqual({
            spec: 'boundary_routed', plan: 'boundary_routed', code: 'define_approved', audit: 'build_executed', qa: 'build_executed',
          })
        })
      ```
  - [X] [T-002-B] Modify `tests/unit/snap-validate.test.js`. All four rewrites are named as contract-correct (AC4). Each is located by its title, and the line numbers are from 2026-10-01:
    - **`'rejects unknown version (v > 2)'` (:97)**, where `v: 3` becomes a valid version:
      ```js
        it('rejects unknown version (v > MAX_VERSION)', async () => {
          const { MAX_VERSION } = await import('../../scripts/snap-contract.mjs')
          const payload = { ...VALID, v: MAX_VERSION + 1 }
          const r = run(fixture(j(payload)))
          expect(r.status).toBe(1)
          expect(r.stderr).toBe('SNAP_ERROR: SNAP_UNKNOWN_VERSION\n')
        })
      ```
    - **`'rejects v > 2 with SNAP_UNKNOWN_VERSION'` (:310)**, with the same change: the title becomes `'rejects v > MAX_VERSION with SNAP_UNKNOWN_VERSION'`, the test becomes `async`, it imports `MAX_VERSION` as above, and the payload is `{ ...VALID, v: MAX_VERSION + 1 }`.
    - **`'scripts/snap-validate.mjs stays within the 32-line hard cap'` (:250), the line cap:** the title becomes `'scripts/snap-validate.mjs stays within the 38-line hard cap'`, and `toBeLessThanOrEqual(32)` becomes `toBeLessThanOrEqual(38)`.
    - **`'resolves its per-block field sets from the contract module'` (:409), the per-version shape (AC2).** The `toEqual` line becomes:
      ```js
          const V1 = { sys: ['ph', 'c', 's'], ops: ['n', 'f'], mem: ['d', 'x'] }
          expect(BLOCK_FIELDS).toEqual({ 1: V1, 2: V1, 3: { sys: ['ph', 'c', 's', 'role', 'tk'], ops: ['n', 'f', 'scope', 'gate'], mem: ['d', 'x', 'p'] } })
      ```
    - **Append inside the last `describe`:**
      ```js
        it('[AC3] decides the version first: an unknown version carrying unknown keys is SNAP_UNKNOWN_VERSION', async () => {
          const { MAX_VERSION } = await import('../../scripts/snap-contract.mjs')
          const bad = { ...VALID, v: MAX_VERSION + 1, sys: { ...VALID.sys, role: 'code', zz: 1 }, ops: { ...VALID.ops, gate: 'x' } }
          const r = run(fixture(j(bad)))
          expect(r.status).toBe(1)
          expect(r.stderr).toBe('SNAP_ERROR: SNAP_UNKNOWN_VERSION\n')
        })

        it('reports only missing: v when v is absent, not the whole missing list [ARCH-010 D2]', () => {
          const { v, ...noV } = VALID
          const r = run(fixture(j({ ...noV, sys: { c: 'abc1234', s: 'feat010' } })))
          expect(r.status).toBe(1)
          expect(r.stderr).toBe('SNAP_ERROR: missing: v\n')
        })
      ```
  - [X] [T-002-C] **Red first (AC1, AC2, AC3):** run `npx vitest run tests/unit/snap-contract.test.js tests/unit/snap-validate.test.js`. Expected: **7 failed**:
    - 4 in the contract file: the rewritten pins, `[AC1]`, `[AC2]` and the enums test;
    - 3 in the validator file: `[AC3]` (current output `unexpected key: sys.role`), the missing-`v` test (current output also names `sys.ph`), and the per-version shape.

    A new test that passes here is a finding about the test, and halts.
  - [X] [T-002-D] Modify `scripts/snap-contract.mjs`. Replace everything from the `// Post-parse, version-specific caps` comment (:17) to the end of the file with:
    ```js
    // Post-parse, version-specific caps, applied once snap.v is known. v2 and v3 share the
    // pre-parse ceiling: neither is a context-budget file.
    export const POST_PARSE_MAX = { 1: V1_MAX_CHARS, 2: PRE_PARSE_MAX_BYTES, 3: PRE_PARSE_MAX_BYTES };

    // Highest v this contract understands. Raising it here moves the
    // SNAP_UNKNOWN_VERSION boundary with no edit anywhere else.
    export const MAX_VERSION = 3;

    // One array-cap table in ONE key scheme: dotted path to [count cap, element cap].
    // Two schemes for one table is how a drift hides from every diff and grep.
    export const CAPS = {
      'ops.n': [3, 200],
      'ops.f': [20, 300],
      'mem.d': [10, 300],
      'mem.x': [5, 200],
    };
    // Same scheme, v3 only: ops.scope exists in no earlier version, so it cannot join CAPS.
    export const V3_CAPS = { 'ops.scope': [20, 300] };

    // Field sets, both per version. v1 and v2 share one block map, unchanged since v1;
    // v3 adds the band fields reserved by FEAT-010 (ARCH-010).
    export const TOP_FIELDS = {
      1: ['v', 'sys', 'ops', 'mem'],
      2: ['v', 'sys', 'ops', 'mem', 'pr'],
      3: ['v', 'sys', 'ops', 'mem', 'pr'],
    };
    const V1_BLOCKS = { sys: ['ph', 'c', 's'], ops: ['n', 'f'], mem: ['d', 'x'] };
    export const BLOCK_FIELDS = {
      1: V1_BLOCKS,
      2: V1_BLOCKS,
      3: { sys: ['ph', 'c', 's', 'role', 'tk'], ops: ['n', 'f', 'scope', 'gate'], mem: ['d', 'x', 'p'] },
    };

    // The band contract (ARCH-010). A role names an agent with a mask behind it, so the roster
    // stops at FEAT-012's five and widens only at a new version. A gate names a band's whole
    // exit condition, which the ARCH-009 band table fixes independently of any agent.
    export const ROLES = ['spec', 'plan', 'code', 'audit', 'qa'];
    export const TOOL_KINDS = ['R', 'RW', 'X'];
    export const BANDS = ['boundary', 'define', 'build', 'verify', 'ship'];
    export const GATES = ['boundary_routed', 'define_approved', 'build_executed', 'verify_pass', 'ship_released'];
    export const ROLE_BAND = { spec: 'define', plan: 'define', code: 'build', audit: 'verify', qa: 'verify' };
    // The tools Guard 5 gates. The hook cannot import this module from both of its install
    // locations, so it carries a copy that tests/hooks/guard5.test.js pins to this one (D7).
    export const WRITE_TOOLS = ['Write', 'Edit', 'create_file', 'write_file'];

    // A receiving role expects the exit gate of the band before its own: GATES[i] is the
    // exit of BANDS[i].
    export const expectedGate = (role) => GATES[BANDS.indexOf(ROLE_BAND[role]) - 1];
    ```
    The old :34 comment, "block members are version-invariant", is false from v3 on. It goes with the replaced block.
  - [X] [T-002-E] Modify `scripts/snap-validate.mjs`. This is the D2 reorder plus per-version lookups; the v3 rules come in T-003:
    - Insert after :10 (the root-object check):
      ```js
      // D2: v is decided before every check whose meaning depends on it (BUG-038's check-order class, second sighting).
      if (snap.v === undefined) err('missing: v'); if (typeof snap.v !== 'number' || !Number.isInteger(snap.v) || snap.v < 1) err('v must be a positive integer');
      if (snap.v > MAX_VERSION) err('SNAP_UNKNOWN_VERSION');
      ```
    - At :12, delete `v: snap.v, ` from `req`.
    - Replace :15–16 with:
      ```js
      const topExtra = Object.keys(snap).find(k => !TOP_FIELDS[snap.v].includes(k)); if (topExtra) err(`unexpected key: ${topExtra}`);
      ```
    - At :18, change `BLOCK_FIELDS[b]` to `BLOCK_FIELDS[snap.v][b]`.
    - Delete the old :19, the version line that now sits above.

    Counted lines: 32.
  - [X] [T-002-F] Run `npx vitest run tests/unit/snap-contract.test.js tests/unit/snap-validate.test.js`, expecting all to pass. Then run `npm test`: **1086 / 0**. Also run `npx vitest run tests/scripts/snap-build.test.js tests/scripts/conductor-db.test.js tests/scripts/resume-read.test.js`, all passing. Those are the contract's other consumers, and they are unmodified.
  - [X] [T-002-G] Append `- T-002: <one line>` to the plan section of `project.md`. Then `git add -u scripts/snap-contract.mjs scripts/snap-validate.mjs tests/unit/snap-contract.test.js tests/unit/snap-validate.test.js .claude/memory/project.md` and `git add -u docs/superpowers/plans/2026-10-01-arch010-band-contract-vertical-slice.md` (amended at execution 2026-10-01 under the T-001-F ruling: tracking state travels with the task that produced it). Commit `feat: SNAP v3 contract with the version decided first [ARCH-010]`, with a body naming the four AC4 rewrites as contract-correct. Expected: **1086 / 0**.

- [X] [T-003] **v3 field rules and the `--to` handoff check** (AC5, AC7, Review Focus 4). Native. Depends on T-002.

  **Interfaces:**
  - *Consumes:* `ROLES`, `TOOL_KINDS`, `GATES`, `V3_CAPS`, `expectedGate`.
  - *Produces:* the CLI `node scripts/snap-validate.mjs <file> [--to <role>]`. It exits 0 on success. Otherwise it exits 1 with one stderr line, `SNAP_ERROR: <message>`. The handoff message is `SNAP_ERROR: SNAP_GATE_MISMATCH: <role> expects <gate>, got <gate>`.
  - [X] [T-003-A] Modify `tests/unit/snap-validate.test.js`.
    - **Add an import below line 6:**
      ```js
      import { GATES, ROLES, V3_CAPS, expectedGate } from '../../scripts/snap-contract.mjs'
      ```
    - **Append at the end of the file:**
      ```js
      // ---- ARCH-010: v3 band fields and the handoff check ----
      const VALID3 = { v: 3, sys: { ph: 'impl', c: 'abc1234', s: 'arch010', role: 'code', tk: 'RW' }, ops: { n: [], f: [], scope: ['src/**'], gate: 'define_approved' }, mem: { d: [], x: [] } }
      const with3 = (blk, patch) => ({ ...VALID3, [blk]: { ...VALID3[blk], ...patch } })
      function runTo(path, ...args) {
        const r = spawnSync('node', [VALIDATOR, path, ...args], { stdio: 'pipe', timeout: 10000 })
        return { status: r.status ?? -1, stderr: (r.stderr ?? '').toString() }
      }

      describe('snap-validate.mjs v3 [ARCH-010]', () => {
        it.each(ROLES)('[AC5] accepts a valid v3 envelope for role %s', (role) => {
          const env = { ...VALID3, sys: { ...VALID3.sys, role, tk: 'X' }, ops: { n: [], f: [], gate: expectedGate(role) } }
          expect(run(fixture(j(env)))).toEqual({ status: 0, stderr: '', stdout: '' })
        })

        it.each(['sys.role', 'sys.tk', 'ops.gate'])('[AC5] names a missing %s', (key) => {
          const [blk, field] = key.split('.')
          const { [field]: _, ...rest } = VALID3[blk]
          const r = run(fixture(j({ ...VALID3, [blk]: rest })))
          expect(r.status).toBe(1)
          expect(r.stderr).toBe(`SNAP_ERROR: missing: ${key}\n`)
        })

        it.each([
          ['sys', 'role', 'boss', 'role must be spec|plan|code|audit|qa'],
          ['sys', 'tk', 'W', 'tk must be R|RW|X'],
          ['ops', 'gate', 'green', 'gate must be boundary_routed|define_approved|build_executed|verify_pass|ship_released'],
        ])('[AC5] rejects %s.%s outside its enum', (blk, field, value, message) => {
          const r = run(fixture(j(with3(blk, { [field]: value }))))
          expect(r.status).toBe(1)
          expect(r.stderr).toBe(`SNAP_ERROR: ${message}\n`)
        })

        it('[AC5] requires scope when tk is RW', () => {
          const { scope, ...ops } = VALID3.ops
          const r = run(fixture(j({ ...VALID3, ops })))
          expect(r.status).toBe(1)
          expect(r.stderr).toBe('SNAP_ERROR: missing: ops.scope (required when tk is RW)\n')
        })

        it.each([[[]], ['text'], [null]])('[AC5] rejects a non-object p (%j)', (p) => {
          const r = run(fixture(j(with3('mem', { p }))))
          expect(r.status).toBe(1)
          expect(r.stderr).toBe('SNAP_ERROR: p must be a plain object\n')
        })

        it.each([[1, 'sys', 'role'], [2, 'sys', 'tk'], [1, 'ops', 'scope'], [2, 'ops', 'gate'], [1, 'mem', 'p']])(
          '[AC5] rejects a v3-only key on v%i: %s.%s', (v, blk, field) => {
            const base = v === 2 ? { ...VALID, v: 2, pr: '' } : VALID
            const r = run(fixture(j({ ...base, [blk]: { ...base[blk], [field]: 'code' } })))
            expect(r.status).toBe(1)
            expect(r.stderr).toBe(`SNAP_ERROR: unexpected key: ${blk}.${field}\n`)
          })

        it('caps ops.scope by count, from the contract', () => {
          const scope = Array.from({ length: V3_CAPS['ops.scope'][0] + 1 }, (_, i) => `d${i}/**`)
          const r = run(fixture(j(with3('ops', { scope }))))
          expect(r.status).toBe(1)
          expect(r.stderr).toBe('SNAP_ERROR: ops.scope exceeds cap\n')
        })

        it('requires ops.scope to be an array', () => {
          const r = run(fixture(j(with3('ops', { scope: 'src/**' }))))
          expect(r.status).toBe(1)
          expect(r.stderr).toBe('SNAP_ERROR: ops.scope must be an array\n')
        })

        it('[AC7] --to qa passes on build_executed', () => {
          expect(runTo(fixture(j(with3('ops', { gate: 'build_executed' }))), '--to', 'qa')).toEqual({ status: 0, stderr: '' })
        })

        it.each(GATES.filter(g => g !== 'build_executed'))('[AC7] --to qa halts on %s', (gate) => {
          const r = runTo(fixture(j(with3('ops', { gate }))), '--to', 'qa')
          expect(r.status).toBe(1)
          expect(r.stderr).toBe(`SNAP_ERROR: SNAP_GATE_MISMATCH: qa expects build_executed, got ${gate}\n`)
        })

        it.each([
          ['spec', 'boundary_routed'], ['plan', 'boundary_routed'], ['code', 'define_approved'],
          ['audit', 'build_executed'], ['qa', 'build_executed'],
        ])('[AC7] --to %s expects %s', (role, gate) => {
          expect(runTo(fixture(j(with3('ops', { gate }))), '--to', role)).toEqual({ status: 0, stderr: '' })
        })

        it('--to on a v1 envelope is a named error, not a silent pass', () => {
          const r = runTo(fixture(j(VALID)), '--to', 'qa')
          expect(r.status).toBe(1)
          expect(r.stderr).toBe('SNAP_ERROR: --to requires a v3 envelope\n')
        })

        it('rejects an unknown --to role with the usage line', () => {
          const r = runTo(fixture(j(VALID3)), '--to', 'boss')
          expect(r.status).toBe(1)
          expect(r.stderr).toBe('SNAP_ERROR: usage: snap-validate.mjs <file> [--to spec|plan|code|audit|qa]\n')
        })
      })
      ```
  - [X] [T-003-B] Run `npx vitest run tests/unit/snap-validate.test.js -t "ARCH-010"` against T-002's validator. Expected: **18 failed, 16 passed** of the 34 new tests.
    - **Failed (18):**
      - missing ×3;
      - enum ×3;
      - RW scope;
      - `p` ×3;
      - scope cap;
      - scope array;
      - qa halts ×4;
      - `--to` on v1;
      - unknown `--to`.
    - **Passed (16):**
      - valid per role ×5;
      - v3-only key ×5, which T-002's per-version lookup already rejects;
      - `--to qa` pass;
      - per-role `--to` ×5, which pass vacuously while the flag is ignored.
  - [X] [T-003-C] Replace the whole of `scripts/snap-validate.mjs` with the code below. It is code, not a plan or tracking file, so BUG-003 does not apply. Line 6's literal is U+FFFD, kept from the current file byte for byte: copy that line, do not retype it.
    ```js
    import { readFileSync } from 'node:fs'; import { BLOCK_FIELDS, CAPS, GATES, MAX_VERSION, POST_PARSE_MAX, PRE_PARSE_MAX_BYTES, ROLES, TOOL_KINDS, TOP_FIELDS, V3_CAPS, expectedGate } from './snap-contract.mjs';
    const err = (m) => { process.stderr.write(`SNAP_ERROR: ${m}\n`); process.exit(1); };
    const [path, flag, to] = process.argv.slice(2); if (path === undefined) err('no path provided');
    if (flag !== undefined && (flag !== '--to' || !ROLES.includes(to))) err(`usage: snap-validate.mjs <file> [--to ${ROLES.join('|')}]`);
    let raw; try { raw = readFileSync(path, 'utf8'); } catch (e) { err(e.code === 'ENOENT' ? 'file not found' : e.code); }
    if (raw.includes('�')) err('encoding error');
    const trimmed = raw.trim(); if (trimmed.includes('\n')) err('internal newline in payload');
    if (trimmed === '') err('empty file');
    if (raw.length > PRE_PARSE_MAX_BYTES) err(`payload too large: ${raw.length} > ${PRE_PARSE_MAX_BYTES} (pre-parse ceiling)`);
    let snap; try { snap = JSON.parse(trimmed); } catch { err('malformed JSON'); }
    if (typeof snap !== 'object' || snap === null || Array.isArray(snap)) err('root must be a plain object');
    // D2: v is decided before every check whose meaning depends on it (BUG-038's check-order class, second sighting).
    if (snap.v === undefined) err('missing: v'); if (typeof snap.v !== 'number' || !Number.isInteger(snap.v) || snap.v < 1) err('v must be a positive integer');
    if (snap.v > MAX_VERSION) err('SNAP_UNKNOWN_VERSION');
    for (const b of ['sys', 'ops', 'mem']) if (typeof snap[b] !== 'object' || snap[b] === null || Array.isArray(snap[b])) err(`missing block: ${b}`);
    const band = snap.v >= 3; const at = (k) => snap[k.split('.')[0]][k.split('.')[1]];
    const missing = ['sys.ph', 'sys.c', 'sys.s', 'ops.n', 'ops.f', 'mem.d', 'mem.x', ...(band ? ['sys.role', 'sys.tk', 'ops.gate'] : [])].filter(k => at(k) === undefined);
    if (missing.length) { for (const k of missing) process.stderr.write(`SNAP_ERROR: missing: ${k}\n`); process.exit(1); }
    const topExtra = Object.keys(snap).find(k => !TOP_FIELDS[snap.v].includes(k)); if (topExtra) err(`unexpected key: ${topExtra}`);
    if (snap.pr !== undefined && typeof snap.pr !== 'string') err('pr must be a string');
    for (const b of ['sys', 'ops', 'mem']) { const extra = Object.keys(snap[b]).find(k => !BLOCK_FIELDS[snap.v][b].includes(k)); if (extra) err(`unexpected key: ${b}.${extra}`); }
    if (raw.length > POST_PARSE_MAX[snap.v]) err(`payload too large: ${raw.length} > ${POST_PARSE_MAX[snap.v]} (v${snap.v} cap)`);
    if (!['spec', 'plan', 'impl', 'rev'].includes(snap.sys.ph)) err('ph must be spec|plan|impl|rev');
    if (band && !ROLES.includes(snap.sys.role)) err(`role must be ${ROLES.join('|')}`); if (band && !TOOL_KINDS.includes(snap.sys.tk)) err(`tk must be ${TOOL_KINDS.join('|')}`);
    if (band && !GATES.includes(snap.ops.gate)) err(`gate must be ${GATES.join('|')}`); if (band && snap.sys.tk === 'RW' && snap.ops.scope === undefined) err('missing: ops.scope (required when tk is RW)');
    const p = snap.mem.p; if (p !== undefined && (typeof p !== 'object' || p === null || Array.isArray(p))) err('p must be a plain object');
    const arrayCaps = { ...CAPS, ...(snap.ops.scope === undefined ? {} : V3_CAPS) };
    for (const [key, [cap, elemCap]] of Object.entries(arrayCaps)) {
      const [blk, sub] = key.split('.'); const arr = snap[blk][sub]; if (!Array.isArray(arr)) err(`${key} must be an array`); if (arr.length > cap) err(`${key} exceeds cap`);
      arr.forEach((el, i) => { if (typeof el !== 'string' || el.trim() === '') err(`empty element in ${key}[${i}]`); if (JSON.stringify(el).slice(1, -1).length > elemCap) err(`element too long in ${key}[${i}]`); });
    }
    snap.ops.f.forEach((el, i) => {
      if (el.includes('\\')) err(`backslash in ops.f[${i}]`);
      const idx = el.lastIndexOf(':'); if (idx <= 0) err(`empty path in ops.f[${i}]`);
      if (!['C', 'M', 'D'].includes(el.slice(idx + 1))) err(`invalid action code in ops.f[${i}]`);
    });
    if (!/^[0-9a-f]{7,64}$/.test(snap.sys.c)) err('invalid sys.c format'); if (!/^[a-zA-Z0-9._-]+$/.test(snap.sys.s)) err('invalid chars in sys.s');
    if (to !== undefined && !band) err('--to requires a v3 envelope'); if (to !== undefined && snap.ops.gate !== expectedGate(to)) err(`SNAP_GATE_MISMATCH: ${to} expects ${expectedGate(to)}, got ${snap.ops.gate}`);
    process.exit(0);
    ```
    The name `arrayCaps` is deliberate. `snap-contract.test.js:37` forbids `caps = {` in the validator, and that is a case-sensitive match, so `arrayCaps = {` does not trip it.
  - [X] [T-003-D] Run `npx vitest run tests/unit/snap-validate.test.js tests/unit/snap-contract.test.js`, all passing, including the 38-line cap at exactly 38. Then run `npm test`: **1120 / 0**.
  - [X] [T-003-E] Append `- T-003: <one line>` to the plan section. Then `git add -u scripts/snap-validate.mjs tests/unit/snap-validate.test.js .claude/memory/project.md docs/superpowers/plans/2026-10-01-arch010-band-contract-vertical-slice.md` (plan file amended 2026-10-01 by owner ruling after T-002: the plan's ticks ride this commit). Commit `feat: v3 band-field validation and the --to handoff check [ARCH-010]`. Expected: **1120 / 0**.

- [X] [T-004] **`snap-build` emits v3** (AC6). Native. Depends on T-002.

  **Interfaces:**
  - *Consumes:* `V3_CAPS`.
  - *Produces:* `snap-build` input keys `role`, `tk`, `scope`, `gate` and `p`, any one of which selects v3. T-007 uses this to build the demo envelopes.
  - [X] [T-004-A] Modify `tests/scripts/snap-build.test.js`. Append inside the top-level `describe`:
    ```js
      // ---- ARCH-010: any band field selects v3, the band envelope ----
      const band = { role: 'code', tk: 'RW', scope: ['src/**'], gate: 'define_approved' };

      it('[AC6] emits v3 when band fields are present, in BLOCK_FIELDS[3] order, and it validates', () => {
        const r = build(JSON.stringify({ ...base, ...band, p: { tests: 'green' } }));
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('{"v":3,"sys":{"ph":"impl","c":"abc1234","s":"feat010","role":"code","tk":"RW"},"ops":{"n":[],"f":[],"scope":["src/**"],"gate":"define_approved"},"mem":{"d":[],"x":[],"p":{"tests":"green"}},"pr":""}');
        expect(validate(r.stdout.trim()).status).toBe(0);
      });

      it.each(['role', 'tk', 'gate'])('[AC6] dies when a band input lacks %s', (key) => {
        const { [key]: _, ...rest } = band;
        const r = build(JSON.stringify({ ...base, ...rest }));
        expect(r.status).toBe(1);
        expect(r.stderr).toBe(`SNAP_BUILD_ERROR: missing or empty scalar: ${key}\n`);
      });

      it.each([['scope', ['src/**']], ['p', {}]])('[AC6] %s alone selects v3, so the band scalars become required', (key, value) => {
        const r = build(JSON.stringify({ ...base, [key]: value }));
        expect(r.status).toBe(1);
        expect(r.stderr).toBe('SNAP_BUILD_ERROR: missing or empty scalar: role\n');
      });

      it('[AC6] dies on a non-array scope', () => {
        const r = build(JSON.stringify({ ...base, ...band, scope: 'src/**' }));
        expect(r.status).toBe(1);
        expect(r.stderr).toBe('SNAP_BUILD_ERROR: scope must be an array\n');
      });

      it('[AC6] dies on a non-object p', () => {
        const r = build(JSON.stringify({ ...base, ...band, p: ['x'] }));
        expect(r.status).toBe(1);
        expect(r.stderr).toBe('SNAP_BUILD_ERROR: p must be a plain object\n');
      });
    ```
  - [X] [T-004-B] Run `npx vitest run tests/scripts/snap-build.test.js -t "AC6"`. Expected: **8 failed**, because the current builder ignores every band key and emits v1.
  - [X] [T-004-C] Modify `scripts/snap-build.mjs`:
    - **:2** becomes:
      ```js
      import { CAPS, PRE_PARSE_MAX_BYTES as MAX_SNAP_BYTES, V1_MAX_CHARS, V3_CAPS } from './snap-contract.mjs';
      ```
    - **Insert after :50** (`const pr = …`):
      ```js

      // ---- v3: any band field selects the band envelope (ARCH-010); without one, v1/v2 are untouched ----
      const band = ['role', 'tk', 'scope', 'gate', 'p'].some((k) => obj[k] !== undefined);
      if (band) {
        for (const k of ['role', 'tk', 'gate']) {
          if (typeof obj[k] !== 'string' || obj[k] === '') die(`missing or empty scalar: ${k}`);
        }
        if (obj.scope !== undefined && !Array.isArray(obj.scope)) die('scope must be an array');
        if (obj.p !== undefined && (typeof obj.p !== 'object' || obj.p === null || Array.isArray(obj.p))) die('p must be a plain object');
        // Assignment order is serialization order: BLOCK_FIELDS[3] lists scope before gate.
        Object.assign(sys, { role: obj.role, tk: obj.tk });
        if (obj.scope !== undefined) ops.scope = normArray(obj.scope, V3_CAPS['ops.scope']);
        ops.gate = obj.gate;
        if (obj.p !== undefined) mem.p = obj.p;
      }
      ```
    - **`if (pr === '') {`** becomes `if (pr === '' && !band) {`.
    - **The v2 branch's opening lines** become:
      ```js
        // ---- v2 and v3: 10 MiB cap, truncate raw pr before serialize ----
        const v = band ? 3 : 2;
        const skeletonBytes = byteLen(JSON.stringify({ v, sys, ops, mem, pr: '' }));
      ```
    - **`const snap = { v: 2, sys, ops, mem, pr: pr.slice(0, keep) };`** becomes `const snap = { v, sys, ops, mem, pr: pr.slice(0, keep) };`.

    A scratch build of these exact edits during planning produced output byte-identical to the current builder for three v1/v2 inputs: a plain v1, a v2 with prose, and a v1 at the size cap.
  - [X] [T-004-D] Run `npx vitest run tests/scripts/snap-build.test.js tests/unit/snap-contract.test.js`, all passing. The pre-existing snap-build tests are unmodified, and they are AC6's byte-identity proof. Then run `npm test`: **1128 / 0**.
  - [X] [T-004-E] Append `- T-004: <one line>` to the plan section. Then `git add -u scripts/snap-build.mjs tests/scripts/snap-build.test.js .claude/memory/project.md docs/superpowers/plans/2026-10-01-arch010-band-contract-vertical-slice.md` (plan file amended 2026-10-01 by owner ruling after T-002: the plan's ticks ride this commit). Commit `feat: snap-build emits SNAP v3 when given band fields [ARCH-010]`. Expected: **1128 / 0**.

- [X] [T-005] **Guard 5** (AC8, AC9, AC10, Review Focus 1–3 and 5). **Subagent, then a reviewer.** It runs in the main checkout with no worktree, and the subagent does not commit. Depends on T-002 and on T-001's verdict.

  **Interfaces:**
  - *Consumes:* `ROLES`, `TOOL_KINDS`, `WRITE_TOOLS` and `PRE_PARSE_MAX_BYTES` from `scripts/snap-contract.mjs`. The tests import them; the hook carries copies.
  - *Produces:* deny reasons, verbatim:
    - `Guard 5: BAND_ENVELOPE_INVALID: <abs envelope path> is unreadable or not a valid v3 band envelope.`
    - `Guard 5: BAND_ROLE_MISMATCH: agent <agent_type> is not the envelope's role <role>.`
    - `Guard 5: BAND_READ_ONLY: role <role> holds tk <tk>, not RW.`
    - `Guard 5: BAND_SCOPE_VIOLATION: <path as given, or <no path>> is outside the declared scope [<globs joined by ", ">]`

  **The live-hook hazard.** `.claude/hooks/pre-tool-use.mjs` gates this very session.
  - A runtime throw inside `main` turns into a fail-closed deny of **every** tool call.
  - **Mitigation, in order:**
    - **Edit in the order C1, C2, C4, C3.** That order is what keeps every intermediate state valid. The reason is specific:
      - C4 first is harmless: passing `payload` to guards that ignore it is plain JS extra-argument tolerance.
      - C3 before C4 would open a window where `guard5BandScope` is registered while `main` still calls `guard(input)`. In that window `payload` is `undefined` and `payload.agent_type` throws. The hook's fail-closed design would then deny every write-family call, including the C4 edit that would close the window. Only the owner's recovery path would remain.

      (Amended at approval, 2026-10-01, by owner review. The plan as first written claimed C1→C4 kept every state valid, and it did not.)
    - Run the hook suites right after.
    - **Recovery** if tools start failing: the owner runs `! git checkout -- .claude/hooks/pre-tool-use.mjs`, or sets `CC_HOOK_ALLOW=1`.

  **The subagent's prompt carries this line verbatim:** "Apply T-005-C's edits in the order C1, C2, C4, C3. The order is load-bearing: registering Guard 5 (C3) before `main` passes `payload` (C4) makes the live hook deny every write, including the edit that would fix it."

  **A trap measured during planning.** Patching this file with `String.prototype.replace` and a string replacement silently expands the `'\\$&'` in `globToRegExp`, and the draft grew to 789 lines instead of 680. Use the Edit tool, or a replacer function.
  - [X] [T-005-A] Create `tests/hooks/guard5.test.js`:
    ```js
    import { describe, it, expect, beforeEach, afterEach } from 'vitest';
    import { spawnSync } from 'node:child_process';
    import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join, resolve, dirname } from 'node:path';
    import { fileURLToPath } from 'node:url';
    import { PRE_PARSE_MAX_BYTES, ROLES, TOOL_KINDS, WRITE_TOOLS } from '../../scripts/snap-contract.mjs';

    const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const HOOK = join(REPO_ROOT, '.claude/hooks/pre-tool-use.mjs');

    // The keys the 2026-09-30 spike measured on a subagent's Write (claude 2.1.286). The main
    // session sends the same set without agent_id and agent_type.
    function payload(tool, filePath, { cwd, agent } = {}) {
      return {
        session_id: 'sess-1', transcript_path: '/tmp/t.jsonl', cwd, prompt_id: 'prompt-1',
        permission_mode: 'default', effort: 'high', hook_event_name: 'PreToolUse',
        tool_name: tool, tool_input: { file_path: filePath, content: 'x' }, tool_use_id: 'toolu_1',
        ...(agent ? { agent_id: 'afb1811e0bd10da56', agent_type: agent } : {}),
      };
    }

    // Through the hook's real contract: JSON on stdin, a decision on stdout, exit 0 always.
    function fire(p) {
      const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(p), cwd: p.cwd, encoding: 'utf8', timeout: 15000 });
      if (r.error) throw new Error(`hook spawn failed: ${r.error.message}`);
      expect(r.status).toBe(0);
      return r.stdout.trim() === '' ? null : JSON.parse(r.stdout).hookSpecificOutput;
    }

    let root, sub;
    beforeEach(() => {
      // realpath: the macOS tmpdir is a symlink, and Guard 5 compares paths without resolving links.
      root = realpathSync(mkdtempSync(join(tmpdir(), 'cc-guard5-')));
      sub = join(root, 'sub');
      mkdirSync(join(root, '.claude', 'memory'), { recursive: true });
      mkdirSync(join(sub, 'src'), { recursive: true });
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    const envelopePath = (at = root) => join(at, '.claude', 'memory', 'band-envelope.json');
    function envelope({ sys = {}, ops = {} } = {}, at = root) {
      writeFileSync(envelopePath(at), JSON.stringify({
        v: 3,
        sys: { ph: 'impl', c: 'abc1234', s: 'arch010', role: 'code', tk: 'RW', ...sys },
        ops: { n: [], f: [], scope: ['sub/src/**'], gate: 'define_approved', ...ops },
        mem: { d: [], x: [] },
      }));
    }
    const asCode = (tool, file) => fire(payload(tool, file, { cwd: sub, agent: 'code' }));
    const violation = (path, globs) => `Guard 5: BAND_SCOPE_VIOLATION: ${path} is outside the declared scope [${globs}]`;

    describe('Guard 5: band scope for role agents [ARCH-010]', () => {
      it('[A] leaves the main session alone even under a restrictive envelope', () => {
        envelope({ ops: { scope: [] } });
        expect(fire(payload('Write', join(root, 'anywhere.txt'), { cwd: sub }))).toBeNull();
      });

      it('[A] leaves an agent whose agent_type is not a role alone', () => {
        envelope({ ops: { scope: [] } });
        expect(fire(payload('Write', join(root, 'x.txt'), { cwd: sub, agent: 'probe-writer' }))).toBeNull();
      });

      it('[B] allows a role agent when no envelope exists above cwd (AC9)', () => {
        const lone = realpathSync(mkdtempSync(join(tmpdir(), 'cc-guard5-lone-')));
        try {
          expect(fire(payload('Write', join(lone, 'x.txt'), { cwd: lone, agent: 'code' }))).toBeNull();
        } finally { rmSync(lone, { recursive: true, force: true }); }
      });

      it.each([
        ['malformed JSON', '{not json'],
        ['a v2 envelope', JSON.stringify({ v: 2, sys: { ph: 'impl', c: 'abc1234', s: 'x' }, ops: { n: [], f: [] }, mem: { d: [], x: [] }, pr: '' })],
        ['a v3 envelope with no role', JSON.stringify({ v: 3, sys: { ph: 'impl', c: 'abc1234', s: 'x', tk: 'RW' }, ops: { n: [], f: [], scope: ['**'], gate: 'define_approved' }, mem: { d: [], x: [] } })],
      ])('[C] denies a role agent on %s, naming the file', (_, text) => {
        writeFileSync(envelopePath(), text);
        const d = asCode('Write', join(sub, 'src', 'a.js'));
        expect(d.permissionDecision).toBe('deny');
        expect(d.permissionDecisionReason).toBe(`Guard 5: BAND_ENVELOPE_INVALID: ${envelopePath()} is unreadable or not a valid v3 band envelope.`);
      });

      it('[C] denies on an envelope larger than the pre-parse ceiling', () => {
        writeFileSync(envelopePath(), ' '.repeat(PRE_PARSE_MAX_BYTES + 1));
        expect(asCode('Write', join(sub, 'src', 'a.js')).permissionDecisionReason).toContain('BAND_ENVELOPE_INVALID');
      });

      it('[D] denies a role agent that is not the envelope role', () => {
        envelope();
        const d = fire(payload('Write', join(sub, 'src', 'a.js'), { cwd: sub, agent: 'qa' }));
        expect(d.permissionDecision).toBe('deny');
        expect(d.permissionDecisionReason).toBe("Guard 5: BAND_ROLE_MISMATCH: agent qa is not the envelope's role code.");
      });

      it.each(['R', 'X'])('[E] denies a write under tk %s', (tk) => {
        envelope({ sys: { tk }, ops: { scope: undefined } });
        const d = asCode('Write', join(sub, 'src', 'a.js'));
        expect(d.permissionDecision).toBe('deny');
        expect(d.permissionDecisionReason).toBe(`Guard 5: BAND_READ_ONLY: role code holds tk ${tk}, not RW.`);
      });

      it('[F] anchors scope globs at the band root, not at cwd', () => {
        envelope({ ops: { scope: ['src/**'] } });
        const file = join(sub, 'src', 'a.js');
        expect(asCode('Write', file).permissionDecisionReason).toBe(violation(file, 'src/**'));
      });

      it('[F] denies a target above the band root', () => {
        envelope({ ops: { scope: ['**'] } });
        const file = join(dirname(root), 'escaped.txt');
        expect(asCode('Write', file).permissionDecisionReason).toBe(violation(file, '**'));
      });

      it('[F] gates Edit, which no other guard covers', () => {
        envelope();
        const file = join(root, 'README.md');
        expect(asCode('Edit', file).permissionDecisionReason).toBe(violation(file, 'sub/src/**'));
      });

      it('[F] an empty scope denies every write', () => {
        envelope({ ops: { scope: [] } });
        const file = join(sub, 'src', 'a.js');
        expect(asCode('Write', file).permissionDecisionReason).toBe(violation(file, ''));
      });

      it('[G] allows an absolute in-scope target from a subdirectory cwd', () => {
        envelope();
        expect(asCode('Write', join(sub, 'src', 'deep', 'a.js'))).toBeNull();
      });

      it('[G] resolves a relative target against the payload cwd', () => {
        envelope();
        expect(asCode('Write', 'src/a.js')).toBeNull();
      });

      it('[G] still lets Guard 2 ask about an existing in-scope file', () => {
        envelope();
        const file = join(sub, 'src', 'exists.js');
        writeFileSync(file, 'y\n');
        expect(asCode('Write', file).permissionDecision).toBe('ask');
      });

      it('[G] allows an in-scope Edit', () => {
        envelope();
        expect(asCode('Edit', join(sub, 'src', 'a.js'))).toBeNull();
      });

      it('keeps a single * inside one path segment', () => {
        envelope({ ops: { scope: ['sub/*.js'] } });
        expect(asCode('Write', join(sub, 'a.js'))).toBeNull();
        expect(asCode('Write', join(sub, 'src', 'a.js')).permissionDecision).toBe('deny');
      });

      it('lets **/ match zero or more directories', () => {
        envelope({ ops: { scope: ['**/*.md'] } });
        expect(asCode('Write', join(root, 'top.md'))).toBeNull();
        expect(asCode('Write', join(sub, 'a', 'b', 'x.md'))).toBeNull();
        expect(asCode('Write', join(root, 'top.txt')).permissionDecision).toBe('deny');
      });

      it('treats a file name that starts with .. as inside the band root', () => {
        envelope({ ops: { scope: ['**'] } });
        expect(asCode('Write', join(root, '..notes.md'))).toBeNull();
      });

      it('uses the nearest envelope above cwd as the band root', () => {
        envelope();
        mkdirSync(join(sub, '.claude', 'memory'), { recursive: true });
        envelope({ sys: { role: 'qa', tk: 'X' }, ops: { scope: undefined, gate: 'build_executed' } }, sub);
        expect(asCode('Write', join(sub, 'src', 'a.js')).permissionDecisionReason)
          .toBe("Guard 5: BAND_ROLE_MISMATCH: agent code is not the envelope's role qa.");
      });

      it('[AC10] carries band constants equal to scripts/snap-contract.mjs (D7)', () => {
        const text = readFileSync(HOOK, 'utf8');
        const list = (name) => JSON.parse(text.match(new RegExp(`const ${name} = (\\[[^\\]]*\\]);`))[1].replace(/'/g, '"'));
        expect(list('BAND_ROLES')).toEqual(ROLES);
        expect(list('BAND_TOOL_KINDS')).toEqual(TOOL_KINDS);
        expect(list('BAND_WRITE_TOOLS')).toEqual(WRITE_TOOLS);
        expect(Number(text.match(/const BAND_ENVELOPE_MAX_BYTES = (\d+);/)[1])).toBe(PRE_PARSE_MAX_BYTES);
      });
    });
    ```
  - [X] [T-005-B] Run `npx vitest run tests/hooks/guard5.test.js`. Expected: **15 failed, 8 passed**.
    - **Failed:**
      - C ×4;
      - D;
      - E ×2;
      - F ×4;
      - `*`;
      - `**/`;
      - nearest;
      - AC10.
    - **Passed:**
      - A ×2 and B;
      - G ×4, since today nothing gates them;
      - `..`-name.
  - [X] [T-005-C] Modify `.claude/hooks/pre-tool-use.mjs` in the order C1, C2, C4, C3, as listed below. The order is load-bearing:
    - **C1, :7–8:**
      ```js
      import { existsSync, readFileSync, statSync } from 'node:fs';
      import { posix, join, resolve, dirname, relative, isAbsolute, sep } from 'node:path';
      ```
    - **C2, insert after `guard2DuplicateWrite`'s closing `}` (:109):**
      ```js

      // ── Guard 5 constants ─────────────────────────────────────────────────────────
      // Copies of scripts/snap-contract.mjs values (ARCH-010 D7). This file is mirrored to two
      // locations and the contract sits at a different relative path from each, so no import is
      // correct in both; tests/hooks/guard5.test.js pins every copy to the contract instead.
      const BAND_ROLES = ['spec', 'plan', 'code', 'audit', 'qa'];
      const BAND_TOOL_KINDS = ['R', 'RW', 'X'];
      const BAND_WRITE_TOOLS = ['Write', 'Edit', 'create_file', 'write_file'];
      const BAND_ENVELOPE_MAX_BYTES = 10485760;
      const BAND_ENVELOPE_REL = ['.claude', 'memory', 'band-envelope.json'];

      const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

      // The band root is the nearest ancestor of cwd holding the envelope; the scope globs
      // anchor there too, so discovery and anchoring are one rule (owner ruling, Case F).
      function findBandRoot(start) {
        let dir = resolve(start);
        while (!existsSync(join(dir, ...BAND_ENVELOPE_REL))) {
          const parent = dirname(dir);
          if (parent === dir) return null;
          dir = parent;
        }
        return dir;
      }

      // Only what Guard 5 itself reads is checked. Anything less is Case C, not a guess.
      function readEnvelope(path) {
        let env;
        try {
          if (statSync(path).size > BAND_ENVELOPE_MAX_BYTES) return null;
          env = JSON.parse(readFileSync(path, 'utf8'));
        } catch { return null; }
        if (!isPlainObject(env) || env.v !== 3 || !isPlainObject(env.sys) || !isPlainObject(env.ops)) return null;
        if (!BAND_ROLES.includes(env.sys.role) || !BAND_TOOL_KINDS.includes(env.sys.tk)) return null;
        const scope = env.ops.scope;
        if (env.sys.tk === 'RW' && !(Array.isArray(scope) && scope.every((g) => typeof g === 'string'))) return null;
        return env;
      }

      // `**/` spans zero or more directories, a trailing `**` any depth, `*` one segment.
      function globToRegExp(glob) {
        const body = glob.split(/(\*\*\/|\*\*|\*)/).map((part) => {
          if (part === '**/') return '(?:.*/)?';
          if (part === '**') return '.*';
          if (part === '*') return '[^/]*';
          return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }).join('');
        return new RegExp(`^${body}$`);
      }

      // Guard 5: a role agent writing outside its band envelope's declared scope (ARCH-010).
      // The main session carries no agent_type and is never subject to it (Case A); with no
      // envelope there is nothing to verify (Case B). Cases C-G are the spec's table.
      function guard5BandScope(input, payload) {
        const role = payload.agent_type;
        if (!BAND_ROLES.includes(role)) return null;
        const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
        const root = findBandRoot(cwd);
        if (!root) return null;
        const file = join(root, ...BAND_ENVELOPE_REL);
        const env = readEnvelope(file);
        if (!env) return deny(`Guard 5: BAND_ENVELOPE_INVALID: ${file} is unreadable or not a valid v3 band envelope.`);
        if (env.sys.role !== role) return deny(`Guard 5: BAND_ROLE_MISMATCH: agent ${role} is not the envelope's role ${env.sys.role}.`);
        if (env.sys.tk !== 'RW') return deny(`Guard 5: BAND_READ_ONLY: role ${role} holds tk ${env.sys.tk}, not RW.`);
        const target = targetPath(input);
        const rel = relative(root, resolve(cwd, target)).split(sep).join('/');
        const inside = target !== '' && rel !== '' && rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel);
        if (inside && env.ops.scope.some((g) => globToRegExp(g).test(rel))) return null;
        return deny(`Guard 5: BAND_SCOPE_VIOLATION: ${target || '<no path>'} is outside the declared scope [${env.ops.scope.join(', ')}]`);
      }
      ```
    - **C4, before C3 (see the mitigation above), in `main`:** `const decision = guard(input);` becomes `const decision = guard(input, payload);`.
    - **C3, last: insert directly after the `DISPATCH` object's closing `};`:**
      ```js
      // Guard 5 runs first on every write-family tool: a scope deny outranks Guard 2's ask.
      for (const tool of BAND_WRITE_TOOLS) DISPATCH[tool].unshift(guard5BandScope);
      ```
  - [X] [T-005-D] Run `cp .claude/hooks/pre-tool-use.mjs project-template/.claude/hooks/pre-tool-use.mjs`, the mirror (AC10). Expected `wc -l`: **680** for both.
  - [X] [T-005-E] Run `npx vitest run tests/hooks tests/installer/templates.test.js`. Expected: all pass.
    - `guard5.test.js` at 24 of 24;
    - every pre-existing hook test unmodified (AC9);
    - the mirror test byte-identical;
    - the Guard 3 explicit-character-class test, which scans only the Guard 3 block, unaffected.

    Then run `npm test`: **1152 / 0**, with test files **44**. (amended 2026-10-01 at T-005-F by owner ruling: one added [A] test, slice delta 71 → 72)
  - [X] [T-005-F] **Subagent stops here and reports.** A fresh reviewer then reads only:
    - the diff of the two hook files and the new test;
    - the spec's Guard 5 table;
    - Review Focus 1–3 and 5.

    **The reviewer also confirms that the `DISPATCH` write-tool entries are distinct array instances before the `unshift` loop.** A shared instance would register Guard 5 more than once: invisible in behaviour, wrong in structure. The check: no two of `DISPATCH.Write`, `DISPATCH.Edit`, `DISPATCH.create_file` and `DISPATCH.write_file` are the same array literal or reference. Added at approval, 2026-10-01, by owner review.

    It returns findings. The orchestrator fixes or rules on each, and re-runs T-005-E.
  - [X] [T-005-G] Append `- T-005: <one line>` to the plan section. Then `git add -u .claude/hooks/pre-tool-use.mjs project-template/.claude/hooks/pre-tool-use.mjs .claude/memory/project.md docs/superpowers/plans/2026-10-01-arch010-band-contract-vertical-slice.md` (plan file amended 2026-10-01 by owner ruling after T-002: the plan's ticks ride this commit), then `git add tests/hooks/guard5.test.js`. Commit `feat: Guard 5 denies a role agent's write outside its band scope [ARCH-010]`. Expected: **1152 / 0**. (amended 2026-10-01 at T-005-F by owner ruling: one added [A] test, slice delta 71 → 72)

- [ ] [T-006] **`.gitignore` and host ownership** (AC13). Native. Depends on T-000.
  - [X] [T-006-A] Modify `tests/installer/templates.test.js`. Append inside `describe('project-template/gitignore', …)` (:65):
    ```js
      it('[AC13] ignores the band envelope as the fourth managed entry', () => {
        const lines = readFileSync(join(root, 'project-template/gitignore'), 'utf8').split('\n').map(l => l.trim());
        expect(lines.filter(l => l && !l.startsWith('#'))).toEqual([
          '.claude/memory/turn-count.txt', '*.installer-backup.*', '*.installer-tmp.*', '.claude/memory/band-envelope.json',
        ]);
      });
    ```
  - [X] [T-006-B] Run `npx vitest run tests/installer/templates.test.js -t "AC13"`. Expected: **1 failed**, three entries instead of four.
  - [X] [T-006-C] Modify `project-template/gitignore`: append `.claude/memory/band-envelope.json` as line 5, keeping the trailing newline.
  - [X] [T-006-D] Modify `lib/installer/host-owned.mjs`: insert `  ['memory/band-envelope.json', 'skip'],` after `  ['memory/turn-count.txt', 'skip'],` (:42), so the `memory/` skips stay together.
  - [X] [T-006-E] Modify `tests/installer/deploy.test.js:15`, where the fixture mirrors the template. Append `.claude/memory/band-envelope.json\n` to `TPL_GITIGNORE`, after `*.installer-tmp.*\n`. **Halt rule:** if any `deploy.test.js` assertion fails other than through this fixture, stop. A fixture change is not allowed to rewrite an expectation silently.
  - [X] [T-006-F] Run `git check-ignore -q .claude/memory/band-envelope.json` and `git ls-files --error-unmatch .claude/memory/band-envelope.json`. Expected: 0 and 1, so the path is ignored and untracked. This was measured as ignored by `/.claude/memory/*` (`.gitignore:36`) on 2026-10-01. Then run `npx vitest run tests/installer tests/unit/host-owned-ignore-xor.test.js`, all passing. The xor test covers the new row with no new test (D3). Then run `npm test`: **1153 / 0**. (amended 2026-10-01 at T-005-F by owner ruling: one added [A] test, slice delta 71 → 72)
  - [ ] [T-006-G] Append `- T-006: <one line>` to the plan section. Then `git add -u project-template/gitignore lib/installer/host-owned.mjs tests/installer/templates.test.js tests/installer/deploy.test.js .claude/memory/project.md docs/superpowers/plans/2026-10-01-arch010-band-contract-vertical-slice.md` (plan file amended 2026-10-01 by owner ruling after T-002: the plan's ticks ride this commit). Commit `feat: ignore and host-own the band envelope [ARCH-010]`. Expected: **1153 / 0**. (amended 2026-10-01 at T-005-F by owner ruling: one added [A] test, slice delta 71 → 72)

- [ ] [T-007] **AC12: the demo Code→QA handoff, interactive, in a scratch project.** In-session, live. Depends on T-003, T-004, T-005 and T-006. **Halt rule:** an in-scope write that is denied, or an out-of-scope write that lands, stops the task for a ruling before release.
  - [ ] [T-007-A] Create `<scratchpad>/demo-ac12` and run `git init` there. Then:
    - copy this repository's `.claude/hooks/pre-tool-use.mjs` to `.claude/hooks/pre-tool-use.mjs`;
    - copy T-001's `log.mjs` and `read-payloads.mjs`;
    - write the files below.

    The fixtures are not deployed by the installer (`[FEAT-012]` owns shipped profiles).
    - `.claude/settings.json`:
      ```json
      { "hooks": { "PreToolUse": [
        { "matcher": "*", "hooks": [ { "type": "command", "command": "node .claude/hooks/log.mjs" } ] },
        { "matcher": "Read|Write|Edit|create_file|write_file|Bash", "hooks": [ { "type": "command", "command": "node .claude/hooks/pre-tool-use.mjs" } ] }
      ] } }
      ```
    - `.claude/agents/code.md`:
      ```markdown
      ---
      name: code
      description: Build-band role for the ARCH-010 demo. Writes only what it is asked to write.
      tools: Read, Grep, Glob, Write, Edit
      ---
      Do exactly the writes you are asked for. Report each tool result verbatim, including any denial.
      ```
    - `.claude/agents/qa.md`:
      ```markdown
      ---
      name: qa
      description: Verify-band role for the ARCH-010 demo. Runs commands and reports; it has no write tool.
      tools: Read, Grep, Glob, Bash
      ---
      Run what you are asked to run and report the output verbatim. If asked to write a file, say whether you have a tool for it.
      ```
  - [ ] [T-007-B] Build the Code envelope from source, then validate it.
    - Write `code-fields.json`:
      `{"ph":"impl","c":"0000000","s":"arch010-demo","n":[],"f":[],"d":[],"x":[],"role":"code","tk":"RW","scope":["src/**"],"gate":"define_approved"}`
    - Build: `node <repo>/scripts/snap-build.mjs < code-fields.json > .claude/memory/band-envelope.json`.
    - Validate:
      - `node <repo>/scripts/snap-validate.mjs .claude/memory/band-envelope.json --to code`, expecting exit 0;
      - the same with `--to qa`, expecting exit 1 and `SNAP_ERROR: SNAP_GATE_MISMATCH: qa expects build_executed, got define_approved`.

    Record both verbatim.
  - [ ] [T-007-C] **Owner, in a separate terminal:** `cd <scratchpad>/demo-ac12 && claude`, then trust the folder. Send this prompt verbatim:

    `Use the code agent to write src/app.txt containing "in scope", then use the code agent to write notes/out.txt containing "out of scope". Do not write any file yourself. Tell me exactly what each write returned.`

    Approve the permission prompt for the in-scope write. Leave the session open.
  - [ ] [T-007-D] Build the QA envelope.
    - Write `qa-fields.json` with `role: "qa"`, `tk: "X"`, `gate: "build_executed"` and no `scope`.
    - Build it the same way, overwriting the envelope.
    - Run `--to qa`, expecting exit 0, and record it.
  - [ ] [T-007-E] **Owner, same session**, sends verbatim:

    `Use the qa agent to run git status --short, then ask the qa agent to create qa.txt containing "qa". Do not write any file yourself. Report what it says.`

    Then `/exit`.
  - [ ] [T-007-F] Read the evidence: `node read-payloads.mjs`, `ls src notes qa.txt`, and the owner's paste of the session's reports. Record the four AC12 facts:
    1. the in-scope write was allowed: `src/app.txt` exists, and the payload has `agent_type=code`;
    2. the out-of-scope write was denied with `BAND_SCOPE_VIOLATION`, verbatim, and `notes/out.txt` is absent;
    3. QA has no write tool: no write-family payload with `agent_type=qa`, and `qa.txt` is absent;
    4. `--to qa` passed on `build_executed`.
  - [ ] [T-007-G] Modify `.claude/memory/project.md`: append a `## Demo: ARCH-010 Code→QA handoff (AC12) [<date>]` section holding:
    - the `claude` version;
    - the four facts with their verbatim evidence;
    - both `--to` outputs from T-007-B and T-007-D.

    Then append `- T-007: <one line>` under the plan section. Then `git add -u .claude/memory/project.md docs/superpowers/plans/2026-10-01-arch010-band-contract-vertical-slice.md` (plan file amended 2026-10-01 by owner ruling after T-002: the plan's ticks ride this commit). Commit `docs: record the ARCH-010 Code->QA demo handoff (AC12) [ARCH-010]`. Expected: **1153 / 0**. (amended 2026-10-01 at T-005-F by owner ruling: one added [A] test, slice delta 71 → 72)

- [ ] [T-008] **README and release 1.35.0** (AC14, AC15; `docs/RELEASE-CLOSEOUT.md` steps 1–5). Native. Depends on T-007.
  - [ ] [T-008-A] Modify `README.md`: insert after the Guard 4 paragraph (:288), separated by a blank line:
    ```markdown
    **Band scope guard (Guard 5)** - a `Write`, `Edit`, `create_file` or `write_file` from a subagent whose `agent_type` names a band role (`spec`, `plan`, `code`, `audit`, `qa`) is checked against the nearest `.claude/memory/band-envelope.json` above its working directory, a SNAP v3 envelope. A malformed envelope, an agent that is not the envelope's role, a role not holding `RW`, or a path outside the envelope's `scope` globs (anchored at the band root, the directory whose `.claude/` holds the envelope) is denied with a named reason. The main session, any other agent, and any project without an envelope are untouched. It assumes cooperative agents: `agent_type` is a name taken on trust, and `Bash`, `NotebookEdit`, MCP write tools and symlinked paths are not covered.
    ```
  - [ ] [T-008-B] Run `npm version 1.35.0 --no-git-tag-version`, then write `1.35.0` into `VERSION`.
  - [ ] [T-008-C] Modify the records.
    - **`AGENT-READABLE BACKLOG.md`.** At the line `grep -n '^### \[ \] `\[ARCH-010\]`'` reports, change `### [ ]` to `### [X]`. Insert as its first bullet:
      ```markdown
      * **DONE, shipped as `1.35.0` on <date>.** SNAP v3 carries the band: `role`, `tk`, `scope`, `gate` and `p`, with per-version block sets, so v1 and v2 are byte-identical. The gate enum is the band table's five exit conditions, and the role enum is the five foundation roles. `snap-validate --to <role>` halts a handoff whose gate is not the previous band's exit with `SNAP_GATE_MISMATCH`. Guard 5 denies a role agent's write outside its envelope's declared scope, with `.claude/memory/band-envelope.json` ignored and host-owned. Folded, with no separate id: the validator's field-versus-version check order, the second sighting of `[BUG-038]`'s check-order class, fixed by deciding `v` first. The interactive identity probe (AC11) and the Code→QA demo (AC12) are recorded in `project.md`. Out of scope, as specified: `[FEAT-011]`, `[FEAT-012]`, `[FEAT-031]`–`[FEAT-036]`, `[BUG-050]`, hostile agent definitions, and writes through `Bash`, `NotebookEdit`, MCP tools or symlinks.
      ```
    - **`CHANGELOG.md`.** Insert above `## [1.34.4]`:
      ```markdown
      ## [1.35.0] - <date>

      ### Added
      - **[ARCH-010]** SNAP v3, the band envelope. `sys` gains `role` and `tk`, `ops` gains `scope` and `gate`, `mem` gains `p`. `snap-build` emits v3 whenever it is given a band field, and v1/v2 output is unchanged.
      - **[ARCH-010]** `snap-validate <file> --to <role>` checks a handoff: the envelope's `gate` must be the exit of the band before the receiving role's, or it exits 1 with `SNAP_GATE_MISMATCH`.
      - **[ARCH-010]** Guard 5 in the PreToolUse front door denies a band-role subagent's `Write`, `Edit`, `create_file` or `write_file` outside the `scope` declared in `.claude/memory/band-envelope.json`. Sessions without an envelope, and the main session always, are unaffected.

      ### Changed
      - **[ARCH-010]** `.claude/memory/band-envelope.json` joins the installer's managed `.gitignore` block and is host-owned: never shipped, never overwritten.

      ### Fixed
      - **[ARCH-010]** `snap-validate` decides the version before the field sets. An envelope from a newer version now reports `SNAP_UNKNOWN_VERSION` instead of an unexpected-key error, and a payload missing `v` reports only `missing: v`.
      ```
    If the release commit lands on another date, use that date in both places.
  - [ ] [T-008-D] Run the release checks:
    - `node tools/version-gate.mjs`, expecting `VERSION_GATE_OK 1.35.0`;
    - `node tools/record-parity.mjs`, expecting `RECORD_PARITY_OK`.

    **Discriminator (AC14):** flip the heading back to `### [ ]` and expect a red run naming `1.35.0` and `ARCH-010`. Restore `[X]` and re-run green.
  - [ ] [T-008-E] Run `npm test`: **1153 / 0**. (amended 2026-10-01 at T-005-F by owner ruling: one added [A] test, slice delta 71 → 72) Then run `node tools/id-ceiling.mjs`: union `{"BUG":53,"FEAT":40,"ARCH":10}`, next `BUG-054`.
  - [ ] [T-008-F] Append `- T-008: <one line>` to the plan section. Then `git add -u VERSION package.json package-lock.json CHANGELOG.md "AGENT-READABLE BACKLOG.md" README.md .claude/memory/project.md docs/superpowers/plans/2026-10-01-arch010-band-contract-vertical-slice.md` (plan file amended 2026-10-01 by owner ruling after T-002: the plan's ticks ride this commit). Commit `chore: release 1.35.0 [ARCH-010]`. Expected: **1153 / 0**. (amended 2026-10-01 at T-005-F by owner ruling: one added [A] test, slice delta 71 → 72)
  - [ ] [T-008-G] **Confirm with the owner, then** push the branch with `git push -u origin feat/arch-010-band-contract-vertical-slice` and open the PR against `main`. Expected CI:
    - ci-node20 **1057 / 96**; (amended 2026-10-01 at T-005-F by owner ruling: one added [A] test, slice delta 71 → 72)
    - ci-node24 **1140 / 13**; (amended 2026-10-01 at T-005-F by owner ruling: one added [A] test, slice delta 71 → 72)
    - both legs printing `SKIP_BASELINE_OK`;
    - `git diff origin/main -- tools/skip-baseline.json` empty (AC15).
  - [ ] [T-008-H] **Stop at the green PR.** Report both `SKIP_BASELINE_OK` lines, both run ids and the PR URL. The owner merges and publishes the GitHub Release `v1.35.0`.

## Test List

- [ ] Unit, `snap-contract.test.js`:
  - AC1 and AC2, red first;
  - the enums, the band order and the handoff map;
  - the rewritten version pins.
- [ ] Unit, `snap-validate.test.js`:
  - AC3, red first;
  - D2's lone `missing: v`;
  - AC4's four named rewrites, including the cap of 38;
  - AC5: valid ×5, missing ×3, enum ×3, RW scope, `p` ×3, v3-only key ×5, the scope cap and array check;
  - AC7: the `qa` pass, `qa` halts ×4, the role map ×5, and the two `--to` errors.
- [ ] Unit, `snap-build.test.js`: AC6, with v3 shape and order, the three required scalars, single-field selection ×2, and the `scope` and `p` type checks. The existing suite is the v1/v2 byte-identity proof.
- [ ] Integration through the hook's stdin/stdout contract, `guard5.test.js`:
  - AC8 cases A–G;
  - AC9 (Case B, plus every existing hook test unmodified);
  - AC10 constants parity;
  - Review Focus 1–3 and 5.

  The mirror's byte identity stays pinned by `templates.test.js`.
- [ ] Installer:
  - `templates.test.js` AC13 (four managed entries);
  - `host-owned-ignore-xor.test.js` over the new row;
  - the `deploy.test.js` fixture.
- [ ] Live:
  - AC11 interactive probe (T-001);
  - AC12 demo handoff (T-007).
- No E2E: no UI is affected.

## Commit Order

1. T-000:
   - `docs: add the ARCH-010 implementation plan [ARCH-010]`, at 1081 / 0;
   - then the merge commit `chore: merge main's BUG-051, BUG-052 and BUG-053 filings into the ARCH-010 branch [ARCH-010]`.
2. T-001: `docs: record the ARCH-010 interactive identity probe (AC11) [ARCH-010]`, at 1081 / 0.
3. T-002: `feat: SNAP v3 contract with the version decided first [ARCH-010]`, at 1086 / 0.
4. T-003: `feat: v3 band-field validation and the --to handoff check [ARCH-010]`, at 1120 / 0.
5. T-004: `feat: snap-build emits SNAP v3 when given band fields [ARCH-010]`, at 1128 / 0.
6. T-005: `feat: Guard 5 denies a role agent's write outside its band scope [ARCH-010]`, at 1152 / 0. (amended 2026-10-01 at T-005-F by owner ruling: one added [A] test, slice delta 71 → 72)
7. T-006: `feat: ignore and host-own the band envelope [ARCH-010]`, at 1153 / 0. (amended 2026-10-01 at T-005-F by owner ruling: one added [A] test, slice delta 71 → 72)
8. T-007: `docs: record the ARCH-010 Code->QA demo handoff (AC12) [ARCH-010]`, at 1153 / 0. (amended 2026-10-01 at T-005-F by owner ruling: one added [A] test, slice delta 71 → 72)
9. T-008: `chore: release 1.35.0 [ARCH-010]`, at 1153 / 0. CI: 1057 / 96 and 1140 / 13. (amended 2026-10-01 at T-005-F by owner ruling: one added [A] test, slice delta 71 → 72)

## Identified Risks

- **Interactive mode carries different identity keys (T-001).**
  - **Caught by:** T-001's halt rule, before any guard code exists.
  - **Cost if it happens:** a ruling on D6. T-002 to T-004 do not depend on it, but they wait anyway, so that the order the spec fixed holds.
- **Guard 5 breaks this session's own tool calls (T-005).**
  - **Why:** the edited hook is live, and a throw fails closed.
  - **Prevented by:** the C1, C2, C4, C3 edit order. C4 before C3 means no state ever registers Guard 5 while `main` withholds `payload`.
  - **Caught by:** the hook suites, run immediately after.
  - **Recovery:** `! git checkout -- .claude/hooks/pre-tool-use.mjs`, or `CC_HOOK_ALLOW=1`.
- **The T-005 subagent drifts into a worktree or commits.** The `[BUG-053]` damage path.
  - **Prevention:** its prompt states both prohibitions, and the orchestrator owns every commit.
  - **Caught by:** `git worktree list` showing one entry, and `git log` showing no subagent commit, both checked before T-005-G.
- **The commit hook runs the full suite**, so an unpredicted count surfaces at commit time. Every task measures the full suite before staging, and halts on any difference.
- **A symlinked `cwd` in the demo.** The Write tool's absolute path may be the realpath while the payload `cwd` is not. Guard 5 would then deny an in-scope write, which is the safe side, since symlinks are out of scope.
  - **Caught by:** T-007's halt rule.
  - **Prevention:** the scratchpad path is already a realpath (`/private/tmp/…`).
- **A permission prompt in the demo.** PreToolUse runs before the permission prompt, so a Guard 5 deny never reaches it. The owner approves only the in-scope write.
- **The 10 MiB oversize test.** It writes one ~10 MB file per run into a temp dir, at measurable but small cost. It runs identically on Node 20 and 24.
- **`origin/main` moves before T-000-F.** The halt in T-000-E catches it, and the merge is re-measured.

## Handoff (not plan tasks)

After the owner merges and releases, run `RELEASE-CLOSEOUT` steps 6–10:
- `npm view` shows `1.35.0`;
- sync `main`, reporting the measurement first;
- the closeout record in `project.md`, stating instruments' output;
- the ceiling before any mint;
- push the record commit in the same action;
- delete the branch, local and remote.

Then `[ARCH-009]`'s flip condition still waits on `FEAT-009`, `FEAT-011`, `FEAT-012` and `FEAT-031`–`036`.
