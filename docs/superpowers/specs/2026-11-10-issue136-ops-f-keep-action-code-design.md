# Spec: keep the action code when an over-cap ops.f entry is truncated (issue #136)

**Status:** Draft, awaiting owner approval

Candidate id: pending owner intake (no BUG id minted). Produced by an AI agent on a contributor's behalf. Stacked on PR #137 (issue #132), which adds `truncateToCap`, itself stacked on PR #133 (issue #128) and PR #129 (issue #119).

## Problem

`scripts/snap-build.mjs` (`normArray`) truncates an over-cap `ops.f` element from the end, like the free-text history arrays. An `ops.f` element is structured, `<path>:<C|M|D>`, and `scripts/snap-validate.mjs` requires that suffix. Cutting the tail removes it, so every `ops.f` entry over its 300-character element cap produces a snapshot the validator refuses. Plain ASCII is enough.

Measured on PR #137's head (`a0a2550`):

| `ops.f` input | Builder | Validator |
|---|---|---|
| `src/` + 400 × `x` + `.js:M` (409) | exit 0, 300 characters, ends in `xxxxxxxx` | exit 1, `empty path in ops.f[0]` |
| `src/` + 292 × `x` + `.js:C` (301) | exit 0, 300 characters, ends in `.js:` | exit 1, `invalid action code in ops.f[0]` |
| `docs/` + 200 × `é中` + `.md:M` | exit 0, 300 characters | exit 1, `empty path in ops.f[0]` |
| `assets/` + 200 × U+1F600 + `.png:C` | exit 0, escaped length 299 | exit 1, `empty path in ops.f[0]` |

## Decision

The issue left the choice open between three candidates. This spec takes the first; the other two are listed for the owner.

**Chosen: truncate the path, keep the action code.** An over-cap entry becomes `<truncated path>:<C|M|D>`, at most 300 in the validator's measure, so it always validates.

- The snapshot keeps the two facts that survive a cut: that a file was touched, and how (created, modified, deleted). It also keeps the leading directories, the part of a long path that locates the work.
- It matches how every other history array behaves (cut, never refused), so a long path cannot make a checkpoint or a compact fail.
- Cost: the entry names a path that does not exist. A reader cannot tell a cut path from a whole one, except by its length being at the cap.

**Alternatives not taken:**

1. **Drop the over-cap entry.** The snapshot stays valid and never names a false path, but the file silently disappears from the handoff, and the next phase does not know it was touched.
2. **Refuse it, as #119 did for `ops.scope`.** Nothing false is written, but a single long path fails the whole snapshot. A scope is a Guard 5 envelope, where a cut changes an authorization; `ops.f` is a log, where a cut loses detail only.

## Solution

A new helper in `snap-build.mjs`, `truncateFileEntry(entry, elemCap, index)`, used for `ops.f` only:

- an entry whose `elementLength` is at most the cap is returned unchanged, whatever its shape;
- an over-cap entry that ends in `:C`, `:M` or `:D` has its path part cut by `truncateToCap` to the cap minus the two characters of the suffix, and the suffix is appended again;
- an over-cap entry with no such suffix is refused: the builder exits 1 with no stdout and `SNAP_BUILD_ERROR: SNAP_FILE_NO_ACTION: ops.f[<i>] is <n> characters, over the cap of 300, and has no :C, :M or :D suffix to keep`. There is no valid entry to produce from it, and it is a caller defect. `<i>` is the index in the input array, as `SNAP_SCOPE_OVER_CAP` reports it.

`normArray` takes the truncation function as an optional third argument (default `truncateToCap`) and passes it the input index. The `ops.f` call passes `truncateFileEntry`; the calls for `ops.n`, `mem.d`, `mem.x` and `ops.scope` are unchanged.

**Design choices named:**

1. **The path cut reuses `truncateToCap`.** The cut is measured with the validator's `elementLength`, by code point, so it never splits a surrogate pair or an escape (#132's guarantees carry over).
2. **The refusal is limited to over-cap entries.** An entry within the cap is passed through as before, valid or not; the validator stays the gate for it.
3. **Unchanged:** dedup still keys on the trimmed, untruncated entry; the count cap, the element caps and the validator are untouched.

## Acceptance criteria

- [ ] **AC1.** `src/` + 400 × `x` + `.js:<code>` builds to `src/` + 294 × `x` + `:<code>` for each of `C`, `M`, `D`, and the snapshot validates. An entry one character over the cap keeps its code too.
- [ ] **AC2.** An over-cap path of accented, CJK or astral characters builds to an entry that ends in its code, has an `elementLength` of at most 300 and more than 298, holds no lone surrogate, and the snapshot validates.
- [ ] **AC3.** An `ops.f` entry at or under the cap is emitted unchanged.
- [ ] **AC4.** An over-cap `ops.f` entry without `:C`, `:M` or `:D` is refused with `SNAP_FILE_NO_ACTION`, exit 1, empty stdout.
- [ ] **AC5.** The other history arrays are still cut from the end. PR #137's `ops.f` test now validates its output. The full suite passes locally with no skip-set change.

## Out of scope

- An `ops.f` entry within the cap that the validator refuses (no suffix, an invalid code, a backslash): the builder passes it through today and still does.
- Two entries that become equal after truncation.
- The caps, the validator, and the prose in `global/commands/cc-compact.md` that describes the truncation.
