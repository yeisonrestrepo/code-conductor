# FEAT-060: Audit verdict line and severities that can withhold the Verify gate

**Status:** Approved 2026-11-12 by independent review (round 1)
**Item:** FEAT-060 (intake of issue #180)
**Date:** 2026-11-12

## Problem

`.claude/agents/audit.md` (and its `project-template/` mirror) fixes the audit role's success condition as "Findings do not withhold the gate; the claim is that the review was done and reported." The router, `scripts/orchestrate.mjs`, matches that: an audit hand-back is accepted on its `SNAP_HANDBACK` line alone, `nextStep` then dispatches `qa`, and `qa`'s `verify_pass` closes Verify. A run whose audit finds a confirmed defect therefore reaches `verify_pass` as long as the suite is green. The audit's findings have no effect on the run; they are prose the owner may or may not read.

## Solution

Give the audit report a machine-readable verdict and make the router act on it. The audit role ends its report with exactly one `VERDICT: APPROVE | RETURN | ESCALATE` line, placed immediately before its `SNAP_HANDBACK` line, and writes every finding as one line carrying a severity (`blocker`, `major` or `minor`) and a `file:line`. `orchestrate.mjs handback audit` parses that verdict. A missing or malformed verdict line halts with a named error. `APPROVE` records the verdict and the run proceeds to `qa` as today. `RETURN` and `ESCALATE` record the verdict on the audit hand-back entry and then halt the run with a named code, so `qa` is never dispatched. Independently of the halt, recording a `qa` hand-back of `verify_pass` is refused unless the run's audit entry carries `APPROVE`. The verdict format is pinned by tests on both the parser and the role profile.

## Behavior

### Main path

1. `/cc-orchestrate` dispatches `audit` as today. The agent reviews statically and writes its report:
   - each finding as one line of the form `- [<severity>] <path>:<line> — <one sentence>`, with `<severity>` one of `blocker`, `major`, `minor`;
   - then the line `VERDICT: APPROVE`, `VERDICT: RETURN` or `VERDICT: ESCALATE`;
   - then its one `SNAP_HANDBACK` line, as today, claiming `build_executed`.
2. The orchestrator writes the final message to `.conductor/handback/audit.txt` and runs `handback audit` on it, as today.
3. `handback` runs its existing checks in their existing order (one `SNAP_HANDBACK` line, valid v3 envelope, role match, gate earned). Only then, for `role === 'audit'`, it parses the verdict (rules below).
4. On `APPROVE` the hand-back entry is recorded with `verdict: 'APPROVE'`, `nextStep` returns `{ role: 'qa' }`, and the run continues exactly as today.
5. `qa` hands back `verify_pass`; `recordHandback` finds the audit entry's verdict is `APPROVE` and forwards the gate. The run ends as today.

**Verdict parsing (the pinned format).** Lines are split on `\r?\n` and trimmed.
- A *verdict candidate* is any line matching `/^verdict\s*:/i`. This is deliberately wider than the valid form, so a near-miss (`Verdict: approve`, `VERDICT:APPROVE `, `VERDICT: APPROVED`) is reported as malformed instead of silently missed.
- Zero candidates: halt `ORCH_VERDICT_MISSING`.
- More than one candidate: halt `ORCH_VERDICT_INVALID` ("expected exactly one VERDICT line, found N").
- The one candidate must match `/^VERDICT: (APPROVE|RETURN|ESCALATE)$/` exactly, else `ORCH_VERDICT_INVALID` quoting the line (capped to the existing reason length conventions).
- The candidate must be the last non-blank line before the `SNAP_HANDBACK` line, else `ORCH_VERDICT_INVALID` ("the VERDICT line must immediately precede SNAP_HANDBACK"). This is how "the report ends in exactly one line" is read when the role contract already requires the report to end in its `SNAP_HANDBACK` line: the verdict is the last line of the report proper.
- A *finding line* is a line matching `/^- \[(blocker|major|minor)\] \S+:\d+ /`. The router counts blocker and major finding lines. `APPROVE` with one or more of them, or `RETURN` with none, halts `ORCH_VERDICT_INCONSISTENT`, naming the verdict and the count. `ESCALATE` carries no count requirement: its cause can be an owner decision with no code defect at all.

### Alternative paths

- **`RETURN`.** The audit entry is recorded with `verdict: 'RETURN'` (so the record survives for the owner and for later recovery work), then the run halts `ORCH_AUDIT_RETURN`: "audit returned the change with N blocker/major finding(s); see .conductor/handback/audit.txt". The halt is recorded in the run file through the existing `recordHalt` path and is terminal per D12; recovery is `end`, then a fresh `start`, on the owner's word.
- **`ESCALATE`.** Same as `RETURN`, halt code `ORCH_AUDIT_ESCALATE`: "audit escalated a decision only the owner takes; see .conductor/handback/audit.txt".
- **Minor-only findings.** `APPROVE` with only `minor` finding lines is valid; minors never withhold the gate.
- **No findings.** `APPROVE` with no finding lines is valid.
- **Prose that mentions the word "verdict"** mid-line (for example "the verdict depends on…") is not a candidate, because candidates are anchored at the start of a trimmed line.
- **A run file from before this change** whose audit entry has no `verdict` key, followed by a `qa` hand-back of `verify_pass`: refused (below). Fail-closed is chosen because the item's purpose is that an unreviewed verdict never passes Verify; the cost is one `end` and `start` for a run that was mid-Verify across an upgrade.

### Error cases

| Situation | Result |
|---|---|
| Audit report has no verdict candidate | Halt `ORCH_VERDICT_MISSING`, nothing recorded for the audit |
| Two or more verdict candidates | Halt `ORCH_VERDICT_INVALID` |
| Malformed verdict line | Halt `ORCH_VERDICT_INVALID`, the line quoted |
| Verdict line not immediately before `SNAP_HANDBACK` | Halt `ORCH_VERDICT_INVALID` |
| `APPROVE` with a blocker/major finding, or `RETURN` with none | Halt `ORCH_VERDICT_INCONSISTENT` |
| Valid `RETURN` | Entry recorded with verdict, then halt `ORCH_AUDIT_RETURN` |
| Valid `ESCALATE` | Entry recorded with verdict, then halt `ORCH_AUDIT_ESCALATE` |
| `recordHandback(run, 'qa', 'verify_pass')` when the audit entry's verdict is not `APPROVE` (including absent) | Throws `Halt('ORCH_GATE_WITHHELD', …)` naming the recorded verdict; the gate is not forwarded |

All existing hand-back halts (`ORCH_HANDBACK_MISSING`, `ORCH_HANDBACK_INVALID`, `ORCH_HANDBACK_ROLE_MISMATCH`, `ORCH_GATE_UNEARNED`, `ORCH_HANDBACK_CONFLICT`) keep their precedence: the verdict is parsed only after they pass. A halted run already refuses every verb through `liveRun`, so `ORCH_GATE_WITHHELD` is the second, independent line that pins the acceptance criterion at the function that forwards the gate, not only at the dispatch order.

## Acceptance Criteria

Answering the backlog entry's three criteria:

- [ ] **The router refuses `verify_pass` after an audit `RETURN` or `ESCALATE`.** `handback audit` with a valid `RETURN` exits 1 with `ORCH_AUDIT_RETURN`, with `ESCALATE` exits 1 with `ORCH_AUDIT_ESCALATE`; in both the run file holds the audit entry with its verdict and a `halt`, and a following `install qa` is refused. `recordHandback` given a run whose audit entry is `RETURN`, `ESCALATE` or has no verdict throws `ORCH_GATE_WITHHELD` for `qa`/`verify_pass` and leaves the gate unforwarded.
- [ ] **An unparseable verdict line halts with a named error.** Each row of the error table above for `ORCH_VERDICT_MISSING`, `ORCH_VERDICT_INVALID` and `ORCH_VERDICT_INCONSISTENT` is a test case through the CLI, exit 1, code on stderr and recorded in the run file.
- [ ] **The verdict format is pinned by a test.** A table test on the exported parser pins the valid forms and the near-misses listed above; `tests/unit/role-profiles.test.js` pins phrases in both copies of `audit.md` naming the `VERDICT:` line, the three verdicts, the three severities and the finding-line form, and its `audit` sha256 row is updated on purpose with a comment naming FEAT-060.

Supporting criteria:

- [ ] `APPROVE` (with or without minor findings) leaves today's run path unchanged: `nextStep` dispatches `qa`, and `qa`'s `verify_pass` is forwarded.
- [ ] `.claude/agents/audit.md` and `project-template/.claude/agents/audit.md` stay byte-identical; the sentence "Findings do not withhold the gate" is gone and the success condition says a blocker or major finding withholds the gate through the verdict.
- [ ] `.claude/commands/cc-orchestrate.md` and its mirror name the new halt codes in "On any halt" and in the Verify step; `npm test` is green.

## Out of Scope

- Sending a `RETURN` back to `code` inside the run and re-auditing (FEAT-057). This item stops the run; the loop replaces the stop later.
- Resuming a halted run from its last valid gate (FEAT-055).
- The Security Agent and its introduced-versus-pre-existing split (FEAT-059), which reuses this verdict contract but is not built here.
- Per-role models (the item at issue #187), unattended delegated review (issue #186), and phase commands dispatching roles directly (FEAT-061).
- Any change to the SNAP v3 envelope or `scripts/snap-contract.mjs`: the verdict lives in the report text, not in a new envelope field, so no contract version moves.
- Changing `qa`, the Define review loop, or the hooks and guards.
- The GitHub wiki pages under `.github/wiki/pages/` that describe the audit role; they are synced as their own surface.

## System Impact

- `scripts/orchestrate.mjs` — new exported `parseVerdict(text)` (pure, returns `{ verdict, blockers }` or throws `Halt`), called from `handback` for `audit` after the existing checks; the audit entry gains a `verdict` key; `handback` saves the run before throwing `ORCH_AUDIT_RETURN`/`ORCH_AUDIT_ESCALATE`, so `recordHalt` adds the halt on top of the recorded entry; `recordHandback` (or `forwardGate`) gains the `ORCH_GATE_WITHHELD` check for `qa`. `isValidRun` must keep accepting entries with and without `verdict`.
- `.claude/agents/audit.md` and `project-template/.claude/agents/audit.md` — success condition rewritten; report format (finding lines, verdict meanings, verdict placement) added. Hand-back still claims only `build_executed`.
- `.claude/commands/cc-orchestrate.md` and its `project-template/` mirror — Verify step and "On any halt" name the four new halt codes and what to report to the owner (the audit file path).
- `README.md` line 137 (the Verify bullet, not a Known-limits line) — one sentence that the audit's verdict can stop the run.
- `tests/scripts/orchestrate.test.js` — the `say('audit', …)` hand-backs (lines 74, 608 and any `pass('audit', …)`) gain a `VERDICT: APPROVE` line; new cases for every row above.
- `tests/unit/role-profiles.test.js` — `audit` sha256 row and the phrase pin at line 43 updated on purpose.
- No new dependency, no network, no installer, hook or settings change, no workflow change.

### Files Requiring Full Read (deferred to /cc-plan)

- `scripts/orchestrate.mjs` — `handback`, `recordHandback`, `isValidRun`, `recordHalt` and the `cli` catch path are past the 30-line cap; their shapes here come from grep only.
- `tests/scripts/orchestrate.test.js` — the `say`/`pass`/`driveTo` helpers and the CLI-driven test pattern.
- `tests/unit/role-profiles.test.js` — the phrase-pin table, read only around the hash rows.

## Complexity Estimate

M — one parser and two guarded branches in the router, plus coordinated text changes in four mirrored markdown files and their pins, with no contract or hook change.
