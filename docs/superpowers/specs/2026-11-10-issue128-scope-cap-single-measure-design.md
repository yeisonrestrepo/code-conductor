# Spec: one length measure for the ops.scope element cap (issue #128)

**Status:** Draft, awaiting owner approval

Candidate id: pending owner intake (no BUG id minted). Produced by an AI agent on a contributor's behalf. Stacked on PR #129 (issue #119), which this spec builds on.

## Problem

Three scripts check an `ops.scope` element against the same cap, `V3_CAPS['ops.scope'][1]` (300), and each measures length its own way:

| Script | Where | Measure |
|---|---|---|
| `scripts/orchestrate.mjs` | `taskScope` (D9) | UTF-16 code units, `p.length` |
| `scripts/snap-build.mjs` | `scopeArray` (PR #129) | code points of the trimmed element, `Array.from(t).length` |
| `scripts/snap-validate.mjs` | array-cap loop | JSON-escaped length, `JSON.stringify(el).slice(1, -1).length` |

So a path the router accepts can fail validation. Measured on PR #129's head (`ff256f5`):

- `src\` + 296 × `x` (300 characters, one backslash): router accepts, builder exits 0, validator refuses with the generic `SNAP_ERROR: element too long in ops.scope[0]`.
- `src/` + U+1F600 + 295 × `x` (300 code points, 301 UTF-16 units): router halts, builder exits 0, validator refuses.

The router halts in both cases, but on the backslash path it halts with the validator's generic error instead of its own `ORCH_SCOPE_OVER_CAP`, which names the task and the path.

## Solution

One measure, defined once in `scripts/snap-contract.mjs` and called by all three:

```js
export const elementLength = (el) => JSON.stringify(el).slice(1, -1).length;
```

- The validator calls it in its array-cap loop (same arithmetic as today, so validation does not change for any field).
- snap-build's `scopeArray` measures the trimmed element with it.
- `taskScope` measures each path with it, and reports that length in `ORCH_SCOPE_OVER_CAP`.

**Design choices named:**

1. **The rule is the JSON-escaped length, the validator's measure.** It is the measure the FEAT-010 spec defines for every array element cap ("Character length is measured on the JSON-serialized form ... `JSON.stringify(value).slice(1, -1).length`"), and the validator is the check that refuses last. Adopting it upstream changes nothing that validates today. The alternatives were weighed:
   - *Code points everywhere* would relax the validator for every array (v1 and v2 handoffs included) and contradict the FEAT-010 contract; the validator is a protected surface with that contract pinned in its spec.
   - *UTF-16 everywhere* still differs from the validator on `"`, `\` and control characters, which is the reported case.
2. **What this means for paths.** A backslash or a quote costs 2, a control character 2 or 6, an astral character 2 (its UTF-16 pair; JSON never escapes it). Any other non-ASCII character, accented letters and CJK included, costs 1. So a Windows path written with backslashes has slightly less room under the 300 cap than the same path written with `/`. The cap is a payload bound, not a filesystem limit, so this is the honest cost.
3. **Equivalence, not just agreement.** The builder measures the trimmed element and emits exactly that string, which the validator then measures: same function, same input. The router measures the untrimmed path; trimming only removes characters, and the measure is additive per character, so the router's number is never smaller than the builder's. Router-accepts implies builder-accepts implies validator-accepts.
4. **Wording kept.** The messages keep "characters", the FEAT-010 spec's word for this measure, and keep their exact shape, so PR #129's error strings are unchanged.
5. **Scope only.** The history arrays (`ops.n`, `ops.f`, `mem.d`, `mem.x`) are truncated by snap-build in code points and validated in escaped length; that mismatch is a separate defect, reported in its own issue and not fixed here.

## Acceptance criteria

- [ ] **AC1.** `elementLength` lives in `snap-contract.mjs`; `orchestrate.mjs`, `snap-build.mjs` and `snap-validate.mjs` call it and none spells the measure itself.
- [ ] **AC2.** `taskScope` halts with `ORCH_SCOPE_OVER_CAP: Task 1 has a 301-character path; the cap is 300` on `src\` + 296 × `x`.
- [ ] **AC3.** snap-build refuses the backslash path and the astral path above with `SNAP_SCOPE_OVER_CAP: ops.scope[0] is 301 characters; the cap is 300`.
- [ ] **AC4.** A backslash path of escaped length exactly 300 builds, and the envelope validates.
- [ ] **AC5.** PR #129's tests and the validator's tests pass unchanged; the full suite passes locally with no skip-set change.

## Out of scope

The caps themselves, the history arrays' truncation, and the validator's generic message.
