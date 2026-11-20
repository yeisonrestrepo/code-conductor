# BUG-072 — Spec and plan folder deny list misses root dot-directories and bin, lib and tools

**Status:** Approved 2026-11-19 by independent review (round 1)

Item: `[BUG-072]`, PILLAR 5. Intake of issue #161, reported by the automated security review of the 1.44.0 release candidate (#157).

## Problem

`scripts/doc-locations.mjs` validates a recorded `- Specs:` or `- Plans:` folder with `checkDocDir`, and the folder it accepts becomes the spec or plan agent's Guard 5 write scope (`<dir>/<group>/**`). The check that keeps that scope off sensitive folders, `reservedReason`, is a deny list (`RESERVED`, line 31):

```
.claude/memory .claude/hooks .claude/agents .claude/commands .claude/scripts .conductor .git .github .opencode scripts
```

Since the pre-1.44.0 hardening, `.claude` itself is an allowlist: only `.claude/specs` and `.claude/plans` may hold documents. Outside `.claude` the list is still a deny list, and it misses two classes of folder that hold configuration or code a tool runs on its own:

- **Root dot-directories other than the listed ones.** `.husky` holds git hooks (run on every commit once `core.hooksPath` points there), `.vscode` holds tasks and settings the editor applies when the folder opens, `.devcontainer` holds the container definition and its lifecycle commands. The class is open-ended (`.circleci`, `.gitlab`, `.cargo`, `.idea`, `.mvn`, `.yarn`, …), so naming members one by one cannot close it.
- **`bin`, `lib` and `tools`**, which by convention hold executables and code the project runs.

Today `checkDocDir('.husky')`, `checkDocDir('.vscode/specs')`, `checkDocDir('bin')` and the other examples all return `''` (accepted). A project `CLAUDE.md` with `- Specs: .husky` therefore gives the spec agent write access to the project's git hooks. Exploiting it needs that line in the project `CLAUDE.md`, which the project's maintainer writes or accepts, so the impact is limited; the defect is that the validator exists to refuse exactly this and does not.

## Solution

Take the first fix shape the entry suggests: reserve every root dot-directory other than `.claude/specs` and `.claude/plans`, plus `bin`, `lib` and `tools`. Concretely, in `scripts/doc-locations.mjs`:

1. `RESERVED` gains `bin`, `lib` and `tools`. They go through the existing case-folded, segment-wise `overlaps` check, so `bin`, `bin/specs` and `BIN` are refused and `binx` or `docs/bin` are not.
2. `reservedReason` gains one structural rule after the `.claude` allowlist: when the first segment of the case-folded value starts with `.` and is not `.claude`, the value is refused with the reason ``sits in the root dot-directory `<segment>`; among root dot-directories only `.claude/specs` and `.claude/plans` may hold documents``.

**Choice the entry leaves open: deny list widened by a structural rule, not an explicit allowlist of document folders.** An explicit allowlist (say, only the three `CANDIDATE_PAIRS` locations) would refuse every custom folder a project records today, such as `design/specs` or `documentation/plans`, which is the feature FEAT-047 shipped: a project records where its documents live. The root dot-directory rule closes the open-ended class the issue names without touching ordinary folders, and the three named code folders are the conventional ones the issue lists.

**Choice: the existing dot entries stay in `RESERVED`.** `.conductor`, `.git`, `.github` and `.opencode` are now also covered by the new rule, but `RESERVED` is checked first, so their current, more specific reasons (``sits in the reserved `.git` ``) and the tests and orchestrate messages that match them stay unchanged. Removing them would only change error text.

**Choice: root only.** The rule looks at the first segment. A nested dot-directory such as `docs/.vscode` is not refused: the tools that auto-run such folders read them at the workspace or repository root, and the issue names root folders.

## Behavior

### Main path

1. `orchestrate.mjs start` (or any caller of `resolveDocLocations`) reads a recorded pair from the project `CLAUDE.md`.
2. `readRecordedPair` runs `checkDocDir` on each value. The existing syntax checks run first (empty, absolute, `..`, backslash, glob, `.`, empty or `.` segment), unchanged.
3. `reservedReason` case-folds the value, then in order:
   1. refuses an overlap with a `RESERVED` entry (now including `bin`, `lib`, `tools`), naming the entry;
   2. refuses a value under `.claude` outside `.claude/specs` and `.claude/plans` (unchanged);
   3. **new:** refuses a value whose first segment starts with `.` and is not `.claude`, naming that segment.
4. A refusal throws `DocLocationError` (`ORCH_DOC_LOCATION_INVALID: \`- Specs: <value>\` <reason>; fix that line`), and `start` halts without recording a run, as today.
5. An accepted value (for example `docs/specs`, `design/plans`, `.claude/specs/pillar-1`) resolves exactly as before.

### Alternative paths

- **Case variants:** `.Husky`, `.VSCode/specs`, `Bin`, `TOOLS/x` are refused, because the check runs on the case-folded value (the reason quotes the folded segment, as the existing rule quotes the folded `RESERVED` entry).
- **Segment-wise names:** `binx`, `libraries`, `toolsx`, `docs/bin`, `docs/lib`, `docs/tools` and `docs/.vscode` stay accepted.
- **Discovered and default pairs:** `discoverPair` and `DEFAULT_PAIR` only yield the three `CANDIDATE_PAIRS`; `.claude/specs`, `.claude/plans` and the `docs` pairs stay accepted, so a project without recorded lines resolves exactly as before.
- **Names that were accepted only because they were look-alikes of reserved roots:** `.conductorx`, `.githubx` and `.opencodex` are root dot-directories, so they are now refused. That is intended; the tests that pinned them as accepted change (see System Impact).

### Error cases

- A project that recorded a root dot-directory (for example `- Specs: .docs/specs`) or a folder under `bin`, `lib` or `tools` now halts at `start` with `ORCH_DOC_LOCATION_INVALID` naming the line and the folder. The fix for that project is to move the line to a non-reserved folder; nothing is written or deleted on the way.
- No new error code, exit code or output channel: the CLI entry still prints the one-line reason on stderr and exits 1.

## Acceptance Criteria

- [ ] **AC1 (root dot-directories).** `checkDocDir` refuses `.husky`, `.vscode`, `.devcontainer`, `.husky/specs`, `.vscode/plans/x`, `.circleci`, `.idea` and the case variants `.Husky` and `.VSCode/specs`, each with a reason that names the folded root segment.
- [ ] **AC2 (`bin`, `lib`, `tools`).** `checkDocDir` refuses `bin`, `lib`, `tools`, `bin/specs`, `lib/plans`, `tools/x`, `BIN` and `Tools`, each with ``sits in the reserved `<entry>` ``.
- [ ] **AC3 (only `.claude/specs` and `.claude/plans` among root dot-directories).** `.claude/specs`, `.claude/plans`, `.claude/specs/pillar-1`, `.Claude/Specs` and `.CLAUDE/plans/x` stay accepted, and every `CANDIDATE_PAIRS` entry and `DEFAULT_PAIR` still pass `checkDocDir`.
- [ ] **AC4 (no regression on ordinary folders).** `docs/specs`, `design/plans`, `binx`, `libraries`, `toolsx`, `scriptsx`, `docs/bin`, `docs/lib`, `docs/tools`, `docs/scripts` and `docs/.vscode` stay accepted.
- [ ] **AC5 (existing reasons unchanged).** `.git/x`, `.github`, `.conductor`, `.opencode`, `.claude/hooks` and `.claude` keep the reason they have today (the `RESERVED` or `.claude` allowlist reason, not the new one); every existing assertion on those reasons in `tests/scripts/doc-locations.test.js` and `tests/scripts/orchestrate.test.js` passes unchanged.
- [ ] **AC6 (look-alikes flip).** `.conductorx`, `.githubx` and `.opencodex` are refused by the root dot-directory rule; the tests that pinned them as accepted are changed to assert the refusal, and the segment-wise acceptance they pinned is pinned instead on `scriptsx`, `binx` and `docs/.vscode`.
- [ ] **AC7 (end to end).** With `- Specs: .husky` and `- Plans: rec/plans` recorded in the fixture `CLAUDE.md`, `orchestrate.mjs start` halts with `ORCH_DOC_LOCATION_INVALID`, its stderr contains `` `- Specs: .husky` `` and `` `.husky` ``, and no run file is written; the same holds for `- Plans: tools`.
- [ ] **AC8.** `npm test` passes.

## Out of Scope

- An explicit allowlist of document folders (the entry's second fix shape), for the reason given under Solution.
- Other non-dot folders that may hold code (`src`, `app`, `packages`, `node_modules`, …): the entry names `bin`, `lib` and `tools`; a wider list is a separate item.
- Nested dot-directories (`docs/.vscode`).
- Guard 5 itself and the envelope format: the scope it enforces comes from this resolver, and only the resolver changes.
- The README "Known limits" line for BUG-072 and every other record (`VERSION`, `CHANGELOG.md`, backlog, memory): written by the release.

## System Impact

- `scripts/doc-locations.mjs`: `RESERVED` (add `bin`, `lib`, `tools`), `reservedReason` (one new rule), and the comment above `RESERVED`, which today says the deny list covers enforcement folders and must now also say why root dot-directories and the three code folders are reserved. Its only importer is `scripts/orchestrate.mjs` (`resolveDocLocations`, line 15, used at line 348); its public exports and their shapes do not change.
- `tests/scripts/doc-locations.test.js`: new cases for AC1 to AC4 and AC6. Changed on purpose: `'compares reserved roots segment-wise'` (`.conductorx` accepted becomes refused) and the trailing `'still accepts %s'` table (`.githubx`, `.opencodex` move to a refused table).
- `tests/scripts/orchestrate.test.js`: one AC7 case next to the existing review #120 case (`'halts start on a recorded enforcement folder'`).
- The installer copies `scripts/doc-locations.mjs` as one file in its script list (`scripts/orchestrate.mjs` line 39 and the matching test lists); the list does not change.
- Not a protected surface (hooks, installer, SNAP scripts, settings) and no new dependency, network access or workflow change. The change only narrows what a recorded line may name, so it widens no installed permission.

### Files Requiring Full Read (deferred to /cc-plan)

_None. `scripts/doc-locations.mjs` (193 lines) is the file the plan edits; it and the reserved-folder blocks of `tests/scripts/doc-locations.test.js` (lines 133 to 238) and `tests/scripts/orchestrate.test.js` (lines 1334 to 1350) were read for this spec._

## Complexity Estimate

S: one list extended and one rule added in a single function, plus table-driven test cases.
