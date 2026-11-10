# Spec: snap-build refuses an over-cap ops.scope instead of truncating it (issue #119)

**Status:** Draft, awaiting owner approval

Candidate id: pending owner intake (no BUG id minted). Produced by an AI agent on a contributor's behalf.

## Problem

`scripts/snap-build.mjs` normalizes `ops.scope` with the same `normArray` it uses for the history arrays. `normArray` cuts each element to the element cap (300 code points) and head-drops the array to the count cap (20). For `ops.scope` both are silent. The router's D9 invariant (`scripts/orchestrate.mjs`, `taskScope`) is the opposite: "scopes are never truncated". A scope cut down to 300 characters, or missing its first entries, is a different Guard 5 envelope from the one the caller computed, and the builder still exits 0.

Measured on `main` @ `7499f84`: a 301-character element comes out as 300 characters, and a 21-entry scope comes out as 20 entries without its first one. Both exit 0.

The router cap-checks `taskScope` before calling the builder, so the defect is latent today. Any caller that skips that check gets a changed scope instead of a refusal.

## Solution

When band input carries `scope`, snap-build checks it before normalizing. An over-cap scope stops the build with exit 1 and a named error on stderr, in the shape the validator already uses for `SNAP_GATE_MISMATCH`:

- `SNAP_BUILD_ERROR: SNAP_SCOPE_OVER_CAP: ops.scope[<i>] is <len> characters; the cap is 300`
- `SNAP_BUILD_ERROR: SNAP_SCOPE_OVER_CAP: ops.scope has <n> entries; the cap is 20`

The router passes the builder's stderr through as `SNAP_ERROR`, so the name reaches the operator unchanged.

**Design choices named:**

1. **The count cap is enforced too.** The issue names the element cap. Head-dropping scope entries breaks the same D9 invariant, in the same function, for the same field, so this spec refuses both. The count check runs on the entries left after `normArray` drops blanks and duplicates, which narrow nothing. If the owner prefers the element cap alone, the count check is one guard and its test, and it can be split out.
2. **Length is measured as `normArray` measured it:** code points of the trimmed element. The set of inputs now refused is exactly the set that was truncated before. Trimming, blank-filtering and dedup stay, since none of them changes the envelope a path set describes.
3. **The other arrays keep truncating.** `ops.n`, `ops.f`, `mem.d` and `mem.x` are bounded history logs: dropping the oldest entry and clipping an element is their documented contract (the v1 budget loop depends on it). Their output is unchanged.

## Acceptance criteria

- [ ] **AC1.** A band input whose scope holds a 301-code-point element exits 1 with the element message above and empty stdout.
- [ ] **AC2.** A band input whose scope holds 21 distinct non-blank entries exits 1 with the count message above and empty stdout.
- [ ] **AC3.** A scope of exactly 20 entries of exactly 300 characters builds, and the envelope validates.
- [ ] **AC4.** Over-cap `n`, `f`, `d` and `x` input is still truncated and head-dropped as before (existing tests stay green).
- [ ] **AC5.** The full suite passes locally; no skip-set change.

## Out of scope

The router's own cap checks, the validator, and the caps themselves.
