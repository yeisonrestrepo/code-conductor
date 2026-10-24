# BUG-064 Template Memory Stub — Design

**Status:** APPROVED 2026-10-24 (owner reviews in the PR)
**Backlog:** `[BUG-064]` · **Issue:** #94

## Problem

`project-template/.claude/memory/project.md` is the file `seedHostOwned` copies into every new host's `.claude/memory/project.md`. Since `b018793` (2026-06-09) it has carried this repository's own checkpoint: the BUG-001 `/cc-compact` decisions (v1.7.0), the files that change touched, code-conductor's own conventions (no em-dashes, spec and plan paths, `VERSION`), and BUG-001 / FEAT-007 / FEAT-005 debt notes. The memory-first chain and `/cc-resume` then read that history as the host's own decisions.

Constraint: `warnIfProjectMemoryIsStub` (`lib/installer/deploy.mjs`) warns when the host file equals the bundled stub byte for byte. Its purpose is to catch hosts whose `project.md` a 1.28.0 or 1.29.0 re-run force-copied over. Those releases shipped the history-laden bytes, which are unchanged since `b018793`. Changing the stub alone would make the check compare against bytes those releases never wrote, so it would silently stop catching the case it exists for. `tests/unit/bounded-project-memory.test.js` AC7 pins the old stub's sha256 for exactly this reason.

## Solution

1. Replace the stub with a neutral one: the same intro and the same five section headings, each with its placeholder comment and no entries. Command names in the placeholders use the shipped names (`/cc-checkpoint`, `/cc-stack`).
2. Migrate the check. `warnIfProjectMemoryIsStub` also warns when the host file's sha256 equals the digest of the stub 1.28.0 and 1.29.0 shipped (`01e65fde…f261f9`, the value AC7 already pins). The current-stub comparison stays, so the documented "seeded and untouched" residual (`README.md` Known limits) is unchanged. The message says "a bundled stub" instead of "the bundled stub", since it can now match either.
3. Keep the legacy bytes out of the package. The installer holds only the digest. A test fixture `tests/fixtures/legacy-project-memory-stub.md` (not in `package.json` `files`) holds the old bytes so tests can prove the digest matches them.

Rejected: rewriting a host file that still equals the legacy stub to the new stub. The installer cannot tell "seeded and never edited" from "clobbered by a re-run", and in the clobbered case the recovery hint (restore from git) is the right action. Writing over it would also break the "detection only, writes nothing" contract of the check.

Rejected: shipping the legacy stub as a file in `lib/` to compare against. That re-ships code-conductor's history inside the package to detect a 49-line file a digest identifies just as well.

## Behavior

- Fresh `--project` install: `.claude/memory/project.md` is the neutral stub. No BUG-/FEAT- ids, no `### Checkpoint`. The installer prints nothing, as today.
- Re-run on a host whose file equals the legacy (1.28/1.29) stub: one recovery warning, nothing written.
- Re-run on a host whose file equals the new stub: one recovery warning (documented residual, unchanged).
- Re-run on a host with its own prose: silent, as today.
- `post-compact` hooks grep `## Checkpoint` and already print "No checkpoints recorded yet" when there is none.
- `/cc-checkpoint`'s one-time `## Current State` bootstrap insert works on the neutral stub as it did on the old one.

## Acceptance Criteria

- [ ] The template stub contains no `BUG-`, `FEAT-`, `ARCH-` id, no `### Checkpoint`, and no code-conductor file path (`project-template/`, `global/commands/`).
- [ ] The stub keeps the five section headings: Stack, Architecture Decisions, Active Conventions, Technical Debt, Workarounds.
- [ ] A host file byte-identical to the legacy stub fixture gets exactly one recovery warning on `deployProject`, and is not modified.
- [ ] The legacy fixture's sha256 equals the digest the installer holds.
- [ ] Every existing `deploy.test.js` stub-detection test passes unchanged.
- [ ] A fresh `deployProject` from the real asset tree is silent and seeds the neutral stub.

## Out of Scope

- This repository's own `.claude/memory/project.md` (it is code-conductor's real memory).
- The "seeded and untouched" false positive (accepted residual, BUG-039 spec `:129`).
- Release records (VERSION, CHANGELOG, backlog flip).

## System Impact

- `project-template/.claude/memory/project.md` (rewritten)
- `lib/installer/deploy.mjs` (`warnIfProjectMemoryIsStub`: one extra digest comparison)
- `tests/unit/bounded-project-memory.test.js` (AC7 retargeted from the template to the fixture)
- `tests/installer/deploy.test.js` (legacy-stub case, real-tree fresh-install case)
- `tests/fixtures/legacy-project-memory-stub.md` (new)

## Complexity Estimate

**S.** One template rewrite, one comparison added, tests.
