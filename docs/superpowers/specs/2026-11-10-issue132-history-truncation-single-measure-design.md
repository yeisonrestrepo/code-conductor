# Spec: truncate the history arrays by the validator's measure (issue #132)

**Status:** Draft, awaiting owner approval

Candidate id: pending owner intake (no BUG id minted). Produced by an AI agent on a contributor's behalf. Stacked on PR #133 (issue #128), which adds `elementLength`, itself stacked on PR #129 (issue #119).

## Problem

`scripts/snap-build.mjs` (`normArray`) truncates each element of the history arrays `ops.n`, `ops.f`, `mem.d` and `mem.x` to its element cap in code points (`Array.from(t).slice(0, elemCap)`). `scripts/snap-validate.mjs` checks the same cap with `elementLength`, the JSON-escaped length the FEAT-010 spec defines for every array element cap. A `"`, a `\` or a control character costs one extra unit there, and an astral character costs two.

So the builder emits elements the validator refuses. Measured on PR #133's head (`f6ba307`):

| Input | Builder | Validator |
|---|---|---|
| `mem.d`: `say "hi" ` + 400 × `x` | exit 0, 300 code points, escaped 302 | exit 1, `element too long in mem.d[0]` |
| `mem.d`: 10 × U+1F600 + 400 × `x` | exit 0, 300 code points, escaped 310 | exit 1 |
| `mem.x`: `"` + `\` + 150 × U+1F600 (152 code points, under the cap) | exit 0, not truncated, escaped 304 | exit 1 |
| `ops.n`: 250 × `"` | exit 0, 200 code points, escaped 400 | exit 1 |

## Solution

`normArray` keeps the largest prefix of the trimmed element whose `elementLength` is at most the element cap. A new helper in `snap-build.mjs`, `truncateToCap(str, elemCap)`:

- returns the string unchanged when `elementLength(str) <= elemCap`;
- otherwise walks the string by code point, adding `elementLength` of each code point, and stops before the first one that would pass the cap.

**Design choices named:**

1. **Truncation stays truncation.** History is a bounded log, not an envelope, so these fields are cut, not refused. `ops.scope` keeps #119's refusal; its `normArray` call never truncates because `scopeArray` refuses over-cap elements first.
2. **Same measure as the validator.** The cut is measured with `elementLength` from `snap-contract.mjs`, the function the validator calls, so builder and validator cannot drift again.
3. **Per-code-point steps.** Walking by code point never splits a surrogate pair, and an escape sequence (`\"`, `\`, `\n`, `\u001f`) belongs to one code point, so it is kept whole or dropped whole. JSON escaping is context-free per code point, so the sum of the per-code-point lengths equals `elementLength` of the prefix: the output always validates.
4. **No cost when nothing is cut.** An element within the cap is returned as is, with one `elementLength` call.
5. **Unchanged:** dedup still keys on the trimmed, untruncated element; the count caps, the caps themselves and the validator are untouched.

## Acceptance criteria

- [ ] **AC1.** `mem.d` = `say "hi" ` + 400 × `x` builds, its element has `elementLength` 300 (`say "hi" ` + 289 × `x`), and the snapshot validates.
- [ ] **AC2.** For each of `ops.n`, `mem.d`, `mem.x`, an over-cap element made of quotes, backslashes and astral characters builds to an element whose `elementLength` is at most the cap, holding no lone surrogate, and the snapshot validates. An over-cap `ops.f` element of quotes is cut to its escaped cap (200 × `"` + `:C` keeps 150 × `"`); it is not validated, because any truncated `ops.f` element loses its `:C`/`:M`/`:D` suffix, a separate defect (#136).
- [ ] **AC3.** The cut never splits an escape: 299 × `x` + `"` in `mem.d` keeps exactly 299 × `x`.
- [ ] **AC4.** An element at or under the cap is emitted unchanged.
- [ ] **AC5.** Existing tests pass unchanged; the full suite passes locally with no skip-set change.

## Out of scope

The caps, `ops.scope` (issue #128), the `ops.f` suffix lost to truncation (#136), dedup of elements that become equal after truncation, and the validator.
