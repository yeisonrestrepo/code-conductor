# Release-critical instruments

These are **repo-only**. Nothing here ships: `tools/` is absent from `package.json` `files` and is untouched by `lib/installer/deploy.mjs`, and `tests/tools/tools-not-shipped.test.js` pins both, with a discriminator proving the manifest assertion can actually fail. A consumer installation has no `AGENT-READABLE BACKLOG.md`, so shipping these would put inert files on every user's disk. That is why they are here and not in `scripts/`, which does ship.

Each instrument carries the test that pins its semantics, because an instrument without one is how the registry below grew to four entries.

| Instrument | Kind | Run by |
|---|---|---|
| `id-ceiling.mjs` | query | a person or agent, before minting an id |
| `version-gate.mjs` | invariant | `tests/tools/repo-invariants.test.js` in CI, and by hand at closeout |
| `record-parity.mjs` | invariant | `tests/tools/repo-invariants.test.js` in CI, and by hand at closeout |
| `skip-baseline.mjs` | invariant | `.github/workflows/test.yml` on every matrix leg, after the suite; report-only by hand |

**Read `docs/RELEASE-CLOSEOUT.md` before a release.** Halt semantics come from the merge gate, not from any checklist line: `CONTRIBUTING.md` states the CI gate is unconditional, so a red invariant blocks the merge whether or not anybody remembered to run anything.

**`skip-baseline.json` is measured, never typed.** Each key is one CI leg's exact skipped set, copied from that leg's own run. A red leg names every identity to add (`+`) or remove (`−`); the fix is to copy those lines into that key in the same PR, and the diff is the reviewer's evidence of the coverage change. A new matrix leg stays red until its key is committed. Run by hand without `--env`, the instrument only reports, because a developer machine is not a reproducible environment: its skipped set depends on the local Node and on `~/.claude/skills`.

---

## The registry of retired instruments

Five instruments have been retired or found unfit across three releases. The first four were release-critical checks that a tripwire, a filing rule or a release gate depended on, and not one was tracked or had a test. The fifth was a verification step inside this item itself, which is why the list is kept open rather than closed at four. **Meet this list before writing a sixth.**

### 1. The whole-tree `git diff --numstat` superset check

Retired at the `1.31.3` closeout. It answered "is `origin/main` a strict superset of local `main`" by looking for insertions with zero deletions. That worked in `1.31.2` by an accident of geometry: the single stranded commit touched one file additively. In `1.31.3` local `main` was missing the whole release, so the same check reported 71 deletions and read as "not a superset" when the truth was exactly the opposite.

**A test that only works when the diff happens to be one-sided is not a test of containment.** Replaced by per-file line containment plus anchor counts. Cited: `.claude/memory/project.md:1178-1180`.

### 2. The max-scan id ceiling

Retired at the `1.32.0` closeout, `[BUG-044]` T-003-B. It counted every id-shaped token anywhere in the repository, so a forward reference in prose counted as a filing: a dossier mention, a spec's scope fence, and worst, **the plan file line stating the ceiling the check expected to read after minting**. The instrument read its own predicted output back as evidence and reported `BUG:46` when the true ceiling was `44`.

Replaced by counting filed backlog headings, which is what `id-ceiling.mjs` does. The decoy fixture in `tests/tools/id-ceiling.test.js` freezes this failure, self-referential line included. Cited: `.claude/memory/project.md:1271`.

### 3. The version gate with a frozen literal target

Retired at the `1.32.0` release, `[BUG-044]` T-004-C. It reported `FAIL` on all five version locations while all five agreed at `1.31.3`.

**The record's account of why is wrong, and the correction is the point.** `.claude/memory/project.md:1272` says it was "comparing against a target it had not been given." It **was** given one: `const WANT = process.argv[2] ?? '1.31.2'`, a literal frozen two releases back. The surviving file reproduces the failure on demand, measured 2026-09-28 against the tree at `1.32.1`:

```
$ node version-gate.mjs          # no argument supplied
FAIL VERSION                                = "1.32.1"
FAIL package.json version                   = "1.32.1"
FAIL package-lock.json version              = "1.32.1"
FAIL package-lock.json packages[""].version = "1.32.1"
FAIL CHANGELOG.md first heading             = "1.32.1"
VERSION_GATE_FAILED (5 of 5 disagree)
rc=1
```

Five locations agreeing on one string, reported as five disagreements. **The archetype is not a memory of a past release; it reproduces on demand.** The failure class is not "no target given", it is **a default that outlives the release it was written for**, which is the same defect as the hardcoded PR poller at `.claude/memory/project.md:983`.

`version-gate.mjs` therefore exposes **no target parameter at all**. The authority is always `VERSION`. There is nothing to default.

### 4. The commit-message files and the PR body

Lost mid-release during `[BUG-044]`. Not a measurement defect: a **custody** defect, and it belongs here because it is the shape the other three share once the measurement question is set aside. Commit messages moved to `git commit -F <file>` because Guard 3 denies a `cat` heredoc inside a compound command, and the PR body then had to be staged through gitignored `.conductor/`. Cited: `.claude/memory/project.md:927`, `:1227`, `:1295`.

### 5. `git diff --stat` as the revert check for an untracked file

Found 2026-09-29, during `[BUG-046]`'s own implementation, and recorded here the day the registry was written because it is the registry's own class turning up inside the item that documents it.

`tests/tools/repo-invariants.test.js` is predicted green, so its instrument is proved by inverting each of its three assertions and observing exactly one named case go red. The plan's verification step for confirming every inversion had been reverted was `git diff --stat -- tests/tools/repo-invariants.test.js`, expecting empty output. **The file was brand new and untracked at that point, so `git diff` has no baseline and prints nothing whether or not an inversion survived.** Adding `git add -N` to give it one then reported all 42 lines as inserted, which is equally uninformative. Empty output would have been read as "reverted" when it meant "not measured".

**A step for verifying instruments used an instrument that could not see its subject.** Replaced by reading the three assertion lines directly. The general form, and the reason this entry belongs beside the other four: **an instrument that returns the same answer whether or not its subject is present is not measuring its subject.** That is the `numstat` check's defect, the max-scan's defect and the vacuous-pass defect, stated once.

---

## The custody premise was wrong, and the corrected version is worse

The backlog entry, `.claude/memory/project.md:1272` and `:1295` all record three instruments as **lost** when the session scratchpad was withdrawn. Measured 2026-09-28: **the scratchpad was never withdrawn.** It holds 316 files, including `id-ceiling.mjs`, `version-gate.mjs` and `ceiling.mjs`.

What survived are the **retired** forms. What evaporated are the shipped semantics.

| Survivor | What it actually is |
|---|---|
| `id-ceiling.mjs` | The whole-repo max-scan of entry 2, walking every `.md`/`.mjs`/`.js`/`.json`/`.sh`/`.ps1`/`.yml` file to depth 4 |
| `ceiling.mjs` | An earlier backlog-only scan matching an **exact** `\d{3}`, which makes `[BUG-1000]` invisible forever, freezing the ceiling at 999 while minting a duplicate with zero diagnostics |
| `version-gate.mjs` | The frozen-literal gate of entry 3, reproduced above |

**The heading-scoped ceiling and the VERSION-as-authority gate were never written to any file.** They existed only as prose. Recovering "the instruments" from the scratchpad would have restored three defects rather than recovered two good ones. The artifacts did not vanish; they **persisted in their defective form** while the corrected semantics lived nowhere durable.

---

## Direction B's scope, recorded so the choice is explicable

`record-parity.mjs` checks three directions. Direction B, that a closed heading carries a bullet naming a shipped version agreeing with `VERSION`, is **scoped to the ids the current `CHANGELOG` version claims**. Measured 2026-09-28: **34 closed headings, 6 carrying a shipped-version bullet, 28 not**, because the DONE convention is recent. Unscoped, direction B is red 28 times on day one. Scoped, it is 3 ids and 0 violations.

A 28-entry grandfather list maintained forever is a toll, and `[BUG-042]` taught this project to price tolls out loud and decline them. **If the DONE convention back-fills, tightening direction B is a one-line scope change.**

Direction B applies to `[X]` alone, not to the whole terminal set. `[~]` is terminal for direction A because a superseded item is legitimately closed, but it never shipped, so demanding a shipped version would demand a fact that does not exist. **A fixture caught this and the live repository could not**, because direction B never reaches the one real `[~]` entry.

---

## Sub-shaped ids: what each instrument sees

An id with a suffix after its number, such as `[ARCH-008-S1]`, is sub-shaped. Before `[BUG-050]` both instruments skipped that shape silently. Each now declares what it does with it (owner ruling, repair (b)):

- **`id-ceiling.mjs` sees every sub-shaped heading.** The heading counts at its parent's number, even when the parent has no heading of its own, and duplicates are checked under the full id. Each leg's line names the sub-shaped ids it saw, and stderr carries one `CEILING_NOTE`. The `headings=` figure still counts top-level headings only, so it stays comparable with earlier records. The ceiling remains a query and exits 0.
- **`record-parity.mjs` reads a sub-shaped heading as its own entry**, so its body is never credited to its parent. Existing sub-shaped headings are legitimate history: the command names them on a `sub-shaped headings seen:` line and does not fail on them. **Releases claim only top-level ids.** A sub-shaped claim under a shipped section is a named `[SUB]` failure. Under `### Filed` and `### Notes` it is not a claim at all, by the same two-level rule as any other id.

There is no grandfather list. The three live sub-shaped headings, `[ARCH-008-S1]`, `[ARCH-008-A]` and `[ARCH-008-B]`, pass because the rule treats history correctly, not because they are exempt.

---

## External writers to this repository's files

Two processes outside this repository append lines to its `.gitignore` when they find them absent:

- The user-global `/cc-compact` command appends `.claude/memory/session-snapshot.json`.
- `lib/installer/deploy.mjs:17` appends `.claude/memory/turn-count.txt` through the `project-template/gitignore` merge.

Neither is under this repository's control, and both would otherwise produce a line that silently reappears after being removed.

**The convention this pair produced: a line kept for an external writer is kept with the writer's name and path in its own comment.** Both lines sit below the `[BUG-042]` tracked-surface block, each carrying its writer's name. Two hauntings prevented by documentation beat two mystery re-appends investigated later.

**The tolerance mechanism already ships**, and no instrument here needs to add one: `tests/unit/gitignore-block-parity.test.js` compares only the lines **between its markers**, which is exactly why it and the installer's `mergeGitignoreText` merge, whose negation guard moves nothing in a file with `!` lines, can share one file permanently. Cite that precedent before building anything new to tolerate a writer.
