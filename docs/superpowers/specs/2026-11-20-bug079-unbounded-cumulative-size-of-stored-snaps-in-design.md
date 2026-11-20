# BUG-079 — Unbounded cumulative size of stored SNAPs in the orchestrator run file

**Status:** Approved 2026-11-20 by independent review (round 1)

**Item:** `[BUG-079]` (intake of issue #213). Pillar 5: infrastructure, ecosystem and quality assurance.

## Problem

Since FEAT-055, every hand-back except `security` stores its full validated SNAP line as `snap` in its
`handbacks` entry of `.claude/memory/orchestrator-run.json` (`scripts/orchestrate.mjs:1016`, `recordHandback(..., { snap })`,
then `saveRun` at `:1017`). `parseHandback` caps each SNAP at `SNAP_STORE_MAX_BYTES` = 64 KiB
(`scripts/orchestrate.mjs:112`, checked at `:669`), but nothing caps their sum. `saveRun` (`:239`) writes the run as
`JSON.stringify(run, null, 2)`, so the SNAP text is stored as an escaped JSON string: every `"` and `\` in it
doubles, and one 64 KiB SNAP can take about 128 KiB of the file. The number of entries follows the number of plan
tasks, which is unbounded.

The hooks stop reading the run file past `BAND_ENVELOPE_MAX_BYTES` = 10 MiB (`.claude/hooks/pre-tool-use.mjs:166`;
`readRunFile` at `:240` returns `null` at `:242`). With an owner-approved plan of roughly 80 or more tasks and
maximally sized hand-backs, the file passes that cap, and Guard 6 goes from deny to warn for the rest of the run,
silently. The practical risk is low (it needs an unusually large plan and pathological hand-backs), but the failure
is a guard downgrade with no signal to the owner.

## Solution

Take the entry's first fix shape, a cumulative bound enforced before the write that would grow the file, and halt with a named code when the
write would cross it. Store nothing less than today.

**Choice: bound, not digest-only storage.** The entry's second shape (store only `sys.role`, `sys.c` and a sha256)
cannot work, because the stored SNAP is read for more than `resume`'s role and commit check:

- `resume` re-validates every kept Build hand-back's stored SNAP with `snap-validate` before keeping it
  (`scripts/orchestrate.mjs:1309`), as `.claude/commands/cc-orchestrate.md` documents ("while each stored SNAP still
  validates"). A hash cannot be validated.
- `snapFiles` (`:1100`) parses the stored SNAP's `ops.f`. `delegate spec|plan` uses it to find the document the
  Define role named (`:1108`), the owner's spec approval checks it under BUG-077 (`:1024`-`:1028`), and the build
  summary lists the files the code hand-backs changed (`:1124`).

Dropping the text would break all three, and storing `ops.f` beside a hash would be a second, unvalidated copy of
the SNAP. So the bound stays in front of the storage, which keeps its contents.

**Choice: bound the serialized run file, not the sum of SNAP lengths.** The thing that must hold is "the run file
stays under the hooks' read cap". The check measures exactly the bytes `saveRun` would write
(`JSON.stringify(run, null, 2) + '\n'`, measured with `Buffer.byteLength`), so it counts escaping, the indentation,
the non-SNAP fields of each entry and every other field of the run, with no arithmetic about escape ratios that a
future field could make wrong. It is one length check on a string the write produces anyway.

**Choice: the bound is 8 MiB (8 388 608 bytes), exported from `scripts/orchestrate.mjs` as `RUN_FILE_MAX_BYTES`.**
It sits 2 MiB below the hooks' 10 MiB cap. That headroom is for the writes that come after a checked hand-back and
are not themselves checked: the halt record `recordHalt` adds (`:1550`-`:1555`), approvals, dispatch fields
(`role`, `band`, `dispatch_model`), audit `fix` records, and `resumes` entries. Each of those is a few hundred bytes,
so 2 MiB covers thousands of them. 8 MiB holds about 64 maximal escaped SNAPs, or thousands of typical ones (a few KiB
each), so no realistic plan meets the bound.

**Where the check runs.** In `handback`, on the non-security path, on the run `recordHandback` returns, before the
`saveRun` at `:1017`. That is the only write that stores a SNAP. The `security` hand-back stores a parsed summary,
not a SNAP (`:965`), and is out of scope (see Out of Scope).

## Behavior

### Main path

1. An agent hands back through `orchestrate.mjs handback <role>` with a valid SNAP no larger than 64 KiB.
2. The script records the entry as today (`recordHandback`) and serializes the resulting run.
3. The serialized run is at most `RUN_FILE_MAX_BYTES`: `saveRun` writes it, and the verb prints its usual line.
   Nothing changes for any run below the bound; the stored `snap` is still the validated line, verbatim.

### Alternative paths

- **The hand-back would push the run file past the bound.** The verb halts with
  `ORCH_RUN_FILE_FULL: the run file would be <n> bytes with this <role> hand-back, over the <8388608>-byte bound
  that keeps it readable by the hooks; end, then start with a smaller plan`. The hand-back is not recorded. The run
  file on disk stays as it was before the verb, plus the halt that the CLI's halt path records, as every other
  hand-back halt does. The agent's report stays in `.conductor/handback/` for the owner.
- **`resume` after `ORCH_RUN_FILE_FULL`.** `resume` is not changed. It keeps the same records (a subset of the stored
  ones, so the file only shrinks), and the redone hand-back halts again. `cc-orchestrate.md` names `end`, then
  `start` as the recovery for this halt, and says why `resume` does not help.
- **Exactly at the bound.** A run of exactly `RUN_FILE_MAX_BYTES` bytes is written; the halt is for strictly more.
- **A single SNAP over 64 KiB.** Unchanged: `ORCH_HANDBACK_INVALID` from `parseHandback`, before the new check.

### Error cases

- **The halt record itself.** `recordHalt` re-reads the file (at most 8 MiB, under the hooks' cap) and adds a
  bounded halt; the result stays under 10 MiB, so the hooks keep reading the run and Guard 6 keeps denying.
- **A run file already larger than the bound** (written by an earlier version). The next hand-back halts
  `ORCH_RUN_FILE_FULL` instead of growing it; the hooks' behavior on such a file is unchanged by this item.

## Acceptance Criteria

Answering the entry's fix shape (a cumulative bound before `saveRun`, halting with a named code) and its test ask
(many max-size hand-backs keep the run file under the hooks' cap):

- [ ] **AC1 — many max-size hand-backs stay under the hooks' cap.** A test drives a run with more plan tasks than the
      bound allows at maximal size, and hands back code SNAPs at the 64 KiB limit whose content doubles under JSON
      escaping (`"` or `\` characters). After every hand-back the run file is at most `RUN_FILE_MAX_BYTES` and below
      the hooks' 10 485 760-byte cap, and a hand-back eventually halts `ORCH_RUN_FILE_FULL`. Earlier entries may be
      seeded into the run file to keep the test fast, but at least the last accepted hand-back and the halting one go
      through the real `handback code` verb.
- [ ] **AC2 — the halting hand-back is not recorded.** After `ORCH_RUN_FILE_FULL`, the run file holds the same
      `handbacks` as before the verb, `run.halt.code` is `ORCH_RUN_FILE_FULL`, the file stays at or below 10 485 760
      bytes, and stderr starts with `ORCH_RUN_FILE_FULL: ` and names the would-be size, the bound and the recovery.
- [ ] **AC3 — runs below the bound are unchanged.** Every existing `tests/scripts/orchestrate.test.js` case passes
      unmodified, including RS3 (the SNAP is stored verbatim) and RS3b (the 64 KiB per-SNAP halt).
- [ ] **AC4 — the bound sits below the hooks' cap.** A test reads `BAND_ENVELOPE_MAX_BYTES` from
      `.claude/hooks/pre-tool-use.mjs` and `project-template/.claude/hooks/pre-tool-use.mjs` and asserts that
      `RUN_FILE_MAX_BYTES` (imported from `scripts/orchestrate.mjs`) is at least 1 MiB below it, so a later change to
      either constant cannot silently undo the guarantee. The hooks themselves are not changed.
- [ ] **AC5 — the halt is documented.** Both byte-identical copies of `cc-orchestrate.md`
      (`.claude/commands/` and `project-template/.claude/commands/`) name `ORCH_RUN_FILE_FULL` among the `handback
      <role>` halts, say the hand-back is not recorded, and give `end`, then `start` as the recovery. A phrase test
      in `tests/installer/commands-parity.test.js` pins it, and the existing mirror test keeps the copies identical.
- [ ] **AC6 — full suite green.** `npm test` exits 0.

## Out of Scope

- Changing the hooks, their 10 MiB cap, or Guard 6's warn-on-unreadable behavior (a protected surface; this item
  keeps the file readable instead).
- Storing less than the full SNAP (rejected above: `resume` and `delegate` read it).
- Bounding the `security` entry, audit `fix` records, `resumes`, or other run fields individually. They do not store
  SNAPs and are covered by the 2 MiB headroom; a separate growth source would be a separate item.
- Making `resume` refuse after `ORCH_RUN_FILE_FULL`; the documentation names the recovery instead.
- Any change to `snap-contract.mjs`, `snap-validate.mjs` or the 64 KiB per-SNAP cap.
- Records (`VERSION`, `CHANGELOG.md`, the backlog, memory, README "Known limits").

## System Impact

- `scripts/orchestrate.mjs`: new exported `RUN_FILE_MAX_BYTES`; the non-security `handback` path measures the
  serialized run before `saveRun` and throws `Halt('ORCH_RUN_FILE_FULL', …)`. The serialization `saveRun` uses is
  shared with the check so both measure the same bytes. `handback` (`:999`-`:1022`), `recordHandback` (`:654`),
  `saveRun` (`:239`) and `recordHalt` (`:1550`) are the touch points; `resume` (`:1347`) is reviewed, not changed.
- `tests/scripts/orchestrate.test.js`: AC1, AC2, AC4 cases, next to RS3/RS3b.
- `.claude/commands/cc-orchestrate.md` and `project-template/.claude/commands/cc-orchestrate.md`: one sentence in
  the `handback <role>` halts paragraph (`:37`).
- `tests/installer/commands-parity.test.js`: one phrase assertion (AC5).
- `.gitignore`: this spec's leaf line in the tracked-surface block.
- `scripts/orchestrate.mjs` is listed as a control-plane file in BUG-080's escalation set
  (`tests/scripts/orchestrate.test.js:3921`); that governs unattended plan checks, not this change.

### Files Requiring Full Read (deferred to /cc-plan)

- `scripts/orchestrate.mjs` — `handback`, `recordHandback`, `saveRun`, `recordHalt` and the CLI halt path, to place
  the check and share the serialization.
- `tests/scripts/orchestrate.test.js` — the `driveTo` / `built` / `handbackLine` helpers and how a run file can be
  seeded, for AC1's fixture and its run time.

## Complexity Estimate

S — one length check and one exported constant in a single function, one documentation sentence in two mirrored
files, and three to four tests.
