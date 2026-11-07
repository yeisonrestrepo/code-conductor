# Issue #94 Template Memory Stub Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant).

**Goal:** A fresh host's `.claude/memory/project.md` is a neutral stub, and the 1.28/1.29 overwrite warning still fires on the bytes those releases wrote.

**Architecture:** Rewrite `project-template/.claude/memory/project.md` to headings and placeholders. `warnIfProjectMemoryIsStub` keeps its current-stub comparison and adds a sha256 comparison against the legacy stub's digest. The legacy bytes live only in a test fixture.

**Tech Stack:** Node 20 ESM, vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-issue94-template-memory-stub-design.md`, APPROVED 2026-10-24.

## Global Constraints

- Legacy digest: `01e65fdecfd0a842dc1269cb0a5ff59718978830c94d5815b09c3a0454f261f9` (the value `bounded-project-memory.test.js` AC7 pins today).
- The check stays detection-only: it writes nothing.
- Existing `deploy.test.js` stub-detection tests pass unchanged.
- No release records: no `VERSION`, `package.json`, `CHANGELOG.md`.
- Staging by explicit path: `git add -u <path>` for tracked files, `git add -f <path>` for a new file under `docs/` before its leaf lands, plain `git add <path>` otherwise. Never bare `git add -u`.
- The pre-commit hook runs the full vitest suite. Never bypass it.

## Review Focus

1. **Legacy host still warned:** pinned by the new `deploy.test.js` case using the fixture.
2. **Digest and fixture agree:** pinned by retargeted AC7.
3. **Fresh install silent and neutral:** pinned by the real-tree case.

---

### Task 0: Spec, plan, ignore leaves

**Files:** Create spec and plan; modify `.gitignore`

- [X] [T-000-A] Write the spec and this plan.
- [X] [T-000-B] Add both `.gitignore` leaves in sorted position after the BUG-056 leaves.
- [X] [T-000-C] Withdrawn in review: the backlog entry is owner-side (CONTRIBUTING "Records are owner-side"); the id is assigned by the owner.
- [X] [T-000-D] Commit `docs: spec and plan for the neutral template memory stub`.

### Task 1: Failing tests

**Files:** Create `tests/fixtures/legacy-project-memory-stub.md`; modify `tests/unit/bounded-project-memory.test.js`, `tests/installer/deploy.test.js`

- [X] [T-001-A] Copy the current template stub to the fixture byte for byte.
- [X] [T-001-B] Retarget AC7 to the fixture's digest; add a case that the template stub has no BUG/FEAT/ARCH id, no `### Checkpoint`, no code-conductor path, and keeps the five headings.
- [X] [T-001-C] In `deploy.test.js`: a host holding the fixture bytes gets one recovery warning and is unchanged; a fresh `deployProject` from the real repo tree is silent and its `project.md` carries no BUG/FEAT id.
- [X] [T-001-D] Run both files. Expected: neutral-stub case, legacy-warning case and real-tree case fail on the current code.

### Task 2: Fix

**Files:** Modify `project-template/.claude/memory/project.md`, `lib/installer/deploy.mjs`

- [X] [T-002-A] Rewrite the stub to intro plus five headings with placeholders.
- [X] [T-002-B] Add `LEGACY_PROJECT_MEMORY_STUB_SHA256` and the digest comparison in `warnIfProjectMemoryIsStub`; message says "a bundled stub".
- [X] [T-002-C] Run both files. Expected: all pass.
- [X] [T-002-E] Withdrawn in review: the README Known limits line is owner-side and was removed with the backlog entry.
- [X] [T-002-D] Commit `fix: ship a neutral project.md stub and keep the legacy overwrite warning`.

### Task 3: Verify and evidence (PR only, never committed)

- [ ] [T-003-A] `npx vitest run` on the branch and on `origin/main` under identical conditions; record counts.
- [ ] [T-003-B] Fresh `--project` install from `main` and from the branch into temp hosts with a temp HOME; render the seeded `project.md` and the vitest summaries to PNG with headless Edge.

### Task 4: Review round 1 (PR #101)

**Files:** Rename spec and plan; modify `.gitignore`, `lib/installer/deploy.mjs`, `tests/installer/deploy.test.js`, `tests/unit/bounded-project-memory.test.js`; revert `AGENT-READABLE BACKLOG.md`, `README.md`

- [X] [T-004-A] Drop the self-minted id: rename spec and plan to `issue94`, follow with both `.gitignore` leaves, retitle headings and test labels.
- [X] [T-004-B] Revert the owner-side records: the backlog entry and the README Known limits line.
- [X] [T-004-C] Hash the LF-normalized host text in `warnIfProjectMemoryIsStub`; add a CRLF legacy-stub case to `deploy.test.js`.
