# [BUG-046] Release-Critical Instruments Are Repo Infrastructure

**Status:** spec, awaiting approval
**Date:** 2026-09-29
**Backlog entry:** `AGENT-READABLE BACKLOG.md`, `### [ ] [BUG-046]`
**Ceiling at filing:** `BUG-047`, both legs heading-scoped, 47 headings on the working tree and on `origin/main`, no duplicate ids. Next mintable id is `BUG-048`. This spec mints nothing.

---

## Problem

Four release-critical instruments have been retired or lost in three releases. Each was a check that a tripwire, a filing rule or a release gate depended on, and not one of them was tracked in the repository or had a test pinning its semantics. This is the registry, and the registry is the problem statement.

### The registry of retired instruments

**1. The whole-tree `git diff --numstat` superset check.** Retired at the `1.31.3` closeout. It answered "is `origin/main` a strict superset of local `main`" by looking for insertions with zero deletions. That worked in `1.31.2` by an accident of geometry: the single stranded commit touched one file additively. In `1.31.3` local `main` was missing the whole release, so the same check reported 71 deletions and read as "not a superset" when the truth was exactly the opposite. **A test that only works when the diff happens to be one-sided is not a test of containment.** Replaced by per-file line containment plus anchor counts. Cited: `.claude/memory/project.md:1178-1180`.

**2. The max-scan id ceiling.** Retired at the `1.32.0` closeout, `[BUG-044]` T-003-B. It counted every id-shaped token anywhere in the repository, so a forward reference in prose counted as a filing: the `[BUG-045]` mention in a dossier, the one in a spec's scope fence, and worst, **the plan file line stating the ceiling the check expected to read after minting**. The instrument read its own predicted output back as evidence and reported `BUG:46` when the true ceiling was `44`. Replaced by counting filed backlog headings. Cited: `.claude/memory/project.md:1271`, backlog entry `[BUG-046]`.

**3. The version gate with a frozen literal target.** Retired at the `1.32.0` release, `[BUG-044]` T-004-C. It reported `FAIL` on all five version locations while all five agreed at `1.31.3`.

> **Premise correction, measured 2026-09-28.** The record states this instrument was "comparing against a target it had not been given." That is wrong, and the correction matters because it changes the failure class. It **was** given a target: `const WANT = process.argv[2] ?? '1.31.2'`, a hardcoded literal frozen two releases back. The surviving file reproduces the failure on demand against today's tree:
>
> ```
> $ node version-gate.mjs          # no argument supplied, repository at 1.32.1
> FAIL VERSION                                = "1.32.1"
> FAIL package.json version                   = "1.32.1"
> FAIL package-lock.json version              = "1.32.1"
> FAIL package-lock.json packages[""].version = "1.32.1"
> FAIL CHANGELOG.md first heading             = "1.32.1"
> VERSION_GATE_FAILED (5 of 5 disagree)
> rc=1
> ```
>
> Five locations agreeing on one string, reported as five disagreements, exit 1. The failure class is not "no target given"; it is **a default that outlives the release it was written for**, which is the same defect as the hardcoded PR poller at `.claude/memory/project.md:983`. `.claude/memory/project.md:1272` is amended at the next memory touch rather than edited in place.

**4. The commit-message files and the PR body.** Lost mid-release during `[BUG-044]`. This one is not a measurement defect; it is a **custody** defect, and it belongs in the registry because it is the shape the other three share once the measurement question is set aside. Commit messages moved to `git commit -F <file>` because Guard 3 denies a `cat` heredoc inside a compound command, and the PR body then had to be staged through gitignored `.conductor/`. Cited: `.claude/memory/project.md:927`, `:1227`, `:1295`.

### The custody premise was wrong, and the corrected version is worse

This entry, `.claude/memory/project.md:1272` and `:1295` all record three instruments as **lost** when the session scratchpad was withdrawn. Measured 2026-09-28: **the scratchpad was never withdrawn.** It holds 316 files today, including `id-ceiling.mjs`, `version-gate.mjs` and `ceiling.mjs`.

What survived are the **retired** forms. What evaporated are the shipped semantics.

| Survivor | What it actually is |
|---|---|
| `id-ceiling.mjs` | The whole-repo max-scan of registry entry 2, walking every `.md`/`.mjs`/`.js`/`.json`/`.sh`/`.ps1`/`.yml` file to depth 4 and counting id-shaped tokens |
| `ceiling.mjs` | An earlier backlog-only scan matching `\[(FEAT\|BUG\|ARCH)-(\d{3})\]` with an **exact** quantifier, which makes `[BUG-1000]` invisible forever, freezing the ceiling at 999 while minting a duplicate with zero diagnostics |
| `version-gate.mjs` | The frozen-literal gate of registry entry 3, reproduced above |

**The heading-scoped ceiling and the VERSION-as-authority gate were never written to any file.** They exist only as prose in `.claude/memory/project.md`. Recovering "the instruments" from the scratchpad would restore three defects rather than recover two good instruments. The custody problem is therefore real and strictly worse than filed: the artifacts did not vanish, they **persisted in their defective form** while the corrected semantics lived nowhere durable. Same conclusion, stronger argument.

### The fourth instrument, which never existed at all

`[BUG-044]` shipped as `1.32.0` (PR #37, merged `28142af`) and was closed out in `.claude/memory/project.md` at `86b5435`. Its backlog heading read `[ ]` with no shipping record of any kind until `f50b69b`, found by a state audit rather than by anything failing. For the whole of the `[BUG-042]` release the project's two most load-bearing documents disagreed about whether a shipped release had shipped, **and no instrument compared them**.

Root cause, one line: **the heading flip had no owner.** Plan tasks touch the backlog only when a task names it, and the closeout writes memory without ever reading the backlog.

### And the checklist the remedy assumed does not exist

The amendment that folded record-parity into this item prices it as "a closeout step the ritual cannot skip, named in the ritual's own checklist at the same rank as the version gate." **There is no closeout checklist in this repository.** `CONTRIBUTING.md` holds only the hook-oriented Manual Validation Protocol at `:53-61`; no file under `docs/` is a release document. The closeout ritual exists as practice and as prose scattered through `.claude/memory/project.md`.

A sentence that binds an artifact into a document that does not exist is unenforceable, and an unenforceable sentence claiming enforcement is the same documentation-lying class `[BUG-044]` shipped to fix. **This item creates the checklist.**

---

## Evidence gathered during the audit

Every number below was measured against the tree at `75b78a6` / `d26412a` on 2026-09-28, not recalled.

### The demarcation measurement

`scripts/` is a **shipped asset directory**, so the backlog entry's proposal to put repo-maintenance instruments there is not free:

- `package.json` `files` lists `scripts/` (`manifest.test.js:17` asserts the allowlist).
- `lib/installer/deploy.mjs:189` runs `cpSync(assetRoot/scripts, target/scripts)` where `target` is `<cwd>/.claude`, so every installation receives them at `.claude/scripts/`.
- `tests/installer/templates.test.js:86` walks `scripts` by name as a shipped asset dir.

A backlog-reading ceiling placed there ships to every consumer's disk and is inert on all of them, since no consumer has an `AGENT-READABLE BACKLOG.md`.

**A correction to the audit's own first reading, kept because it is the class of verification these instruments exist to make cheap.** The audit initially reported the user-global `/cc-compact` skill's `node .claude/scripts/snap-build.mjs` as a path drift against this repository's `scripts/`. It is not a drift. `.claude/scripts/` is the **installed** layout, and `tests/installer/commands-parity.test.js:9-22` documents exactly this asymmetry and rewrites `.claude/scripts/` to `scripts/` when comparing the repository's own command mirrors. This repository is the source layout and therefore the exception. A reviewer's wrong reading, corrected in one grep against a test that already encoded the answer, is what a tracked instrument buys.

### The invocation measurement

`CONTRIBUTING.md:50` states the GitHub Actions CI gate is unconditional. `.github/workflows/test.yml:35` runs `npm test`. So **any live-repo assertion placed under `tests/` inherits halt semantics from the merge gate**, which is stronger than any checklist line: there is no one to remember and no warn-and-continue path.

Two instruments already work this way and are the precedent: `tests/unit/gitignore-block-parity.test.js` and `tests/unit/host-owned-ignore-xor.test.js` read the live repository and run in CI.

**One measured exception.** `.github/workflows/test.yml:15` uses `actions/checkout@v4` at its default depth, so `origin/main` is not a resolvable ref in CI. `git ls-files` works fine there (block-parity proves it), so the constraint is specific to the ceiling's remote leg.

### The record-parity discriminator measurements

A bullet-start rule alone (`- **[BUG-NNN]** ...`) reduces 72 id occurrences in `CHANGELOG.md` to 13 claims and leaves **one** violation: `1.32.0 claims BUG-045 -> [ ]`.

That is a false positive. `CHANGELOG.md:29-30` places it under `### Filed`, a section for minted-but-unshipped items, and the bullet's own text says the defect was "deliberately left to its own change." The record is correct; the single-level instrument was wrong. **On its first contact with real data, the single-level form reproduced registry entry 2's failure class: it could not distinguish its subject from a description of its subject.** That false positive ships as a fixture, because it is the proof the second level is needed.

`CHANGELOG.md` uses six section kinds: `Added` (20), `Fixed` (16), `Changed` (14), `Removed` (2), `Notes` (2), `Filed` (1). With `Notes` and `Filed` excluded by name:

```
two-level claims = 12 across sections ["Fixed","Added"]
violations TODAY = 0
DEFECT 1 (BUG-044 heading flipped back to [ ]): violations = 1   1.32.0/BUG-044
DEFECT 2 (BUG-042 heading removed):             violations = 3   1.32.1/BUG-042 x3
CONTROL: BUG-045 (### Filed) counted as a claim? false
```

`[~]` is accepted as terminal beside `[X]`, because `BUG-035` carries the deliberate superseded marker and is claimed by three releases (`1.28.0`, `1.29.0`, `1.30.0`).

### The retroactive-scope measurement, recorded so the scope choice is explicable

**34 closed headings; 6 carry a bullet naming a shipped version; 28 do not.** The DONE-bullet convention is recent. An unscoped "every `[X]` heading carries a DONE bullet naming a version" is red 28 times on day one. Scoped to the ids the current `CHANGELOG` version claims: 3 ids, **0 violations**.

A 28-entry grandfather list maintained forever is a toll, and `[BUG-042]` taught this project to price tolls out loud and decline them. It is declined. **If the DONE convention back-fills over time, tightening direction B is a one-line scope change**, and that is named here as the future option so a later reader does not re-derive it.

---

## The five gate rulings this spec is written around

**Gate 1, the demarcation line: shape 3, a repo-only `tools/` directory.** The measurement decides it. `scripts/` ships to every install, so a backlog-reading ceiling there is dead weight on every consumer's disk; and instrument logic living only inside a test leaves the closeout without a command to run. `tools/` holds the logic, live-repo tests under `tests/` import it, and thin CLIs expose it. **The named cost is accepted and pinned**: a manifest assertion that `tools/` is absent from `package.json` `files` and untouched by deploy, with a deliberate-defect confirmation. Boundary cases ratified as brought: `resume-read.mjs`, `snap-build.mjs`, `snap-validate.mjs`, `session-id.mjs` and `conductor-db.mjs` are **product**, not instruments, and this line does not touch them; the surviving scratchpad probes stay in the scratchpad.

`tools/` is not matched by any `.gitignore` rule (`git check-ignore tools/x.mjs` exits 1), so it needs no re-include leaf and plain `git add` stages it.

**Gate 2, invocation and ownership: CI as live tests for the version gate and record-parity, no pre-commit hook, and this item creates the closeout checklist.** Halt semantics are inherited from the merge gate, as measured, and the spec says so rather than implying a checklist enforces anything. A pre-commit hook is declined: it buys nothing CI does not already give, and the hook is never weakened or extended casually.

**Gate 3, the ceiling: carry both, with the query/invariant distinction made structural.** The ceiling is a **query**, whose output a human or agent reads when deciding what number to mint; it lives in `tools/` as the local command the filing rule names, both legs, loud `CEILING_ABORT` on a failed remote leg, `\d{3,}` carried verbatim from the survivor. **Duplicate-id freedom among headings is the invariant**, and it splits out as a live-repo test in CI: single leg, `git ls-files` territory, no fetch-depth cost. **`fetch-depth: 0` is explicitly declined.** The remote leg's protection is the filing ritual's both-legs rule, already convention, and a slower clone on every CI run buys nothing the ritual does not give.

**Gate 4, record-parity's scope:** direction A unscoped, direction B scoped to the ids the current `CHANGELOG` version claims, direction C unscoped. The grandfather list is rejected with the `[BUG-042]` lesson cited. The 28 is recorded above as a dated measurement. `[~]` is terminal beside `[X]`. The two-level discriminator ships with the single-level false positive reproduced as its proof.

**Gate 5, the sibling concern: document, do not tolerate.** A registry note beside the instruments naming both external writers with their paths, citing the between-markers precedent as the tolerance mechanism that already ships. The writers themselves stay out of scope.

---

## Solution

Three instruments become tracked repository infrastructure under a new repo-only `tools/` directory. Each exports a pure function over text plus a thin CLI. Each has a test under `tests/` that pins its semantics against fixtures, and two of the three additionally assert against the live repository so CI enforces them. A tracked closeout checklist names them in order, and a manifest test pins `tools/` as repo-only so the directory cannot silently become a shipped surface.

```
tools/
  id-ceiling.mjs        query:     max filed heading id, working tree UNION origin/main
  version-gate.mjs      invariant: VERSION as authority, four locations checked against it
  record-parity.mjs     invariant: CHANGELOG claims <-> backlog headings <-> VERSION
  README.md             the retired-instruments registry + the external-writers note

tests/tools/
  id-ceiling.test.js       fixtures incl. the forward-reference decoy
  version-gate.test.js     fixtures, both directions
  record-parity.test.js    fixtures incl. the BUG-044 state, its reverse, the Filed control
  repo-invariants.test.js  LIVE: version agreement, record parity, duplicate-id freedom
  tools-not-shipped.test.js  manifest + deploy assertions with their discriminator

docs/RELEASE-CLOSEOUT.md   the checklist, with the instruments at the version gate's rank
```

### Why `tests/tools/` and not `tests/unit/`

`tests/scripts/` already holds the tests for `scripts/` modules; `tests/tools/` mirrors that convention for `tools/`. The live-repo assertions go in `tests/tools/repo-invariants.test.js` rather than beside the pure-function tests, because they assert about **this repository** rather than about the instrument, and the existing live-repo assertions (`gitignore-block-parity`, `host-owned-ignore-xor`) established that separation is worth making visible in the filename.

---

## Behavior

### Main path: the closeout

A maintainer or agent finishing a release opens `docs/RELEASE-CLOSEOUT.md` and works the steps in order. The instruments appear at the same rank as the version bump:

1. Merge the release PR on green.
2. Sync `main`, measuring `N ahead / M behind` before fast-forwarding rather than assuming zero.
3. Flip the shipped item's backlog heading to `[X]` and write its DONE bullet naming the version.
4. Run `node tools/version-gate.mjs`. It prints five `ok` lines and `VERSION_GATE_OK <version>`, exit 0.
5. Run `node tools/record-parity.mjs`. It prints the claim count and `RECORD_PARITY_OK`, exit 0.
6. Append the closeout record to `.claude/memory/project.md`.
7. Run `node tools/id-ceiling.mjs` before minting any id the closeout produces. Both legs report, and the union ceiling plus next mintable id are printed.
8. Push the record commit in the same action that creates it.

The checklist states plainly, in its own header, that **steps 4 and 5 are also asserted by CI against the live repository**, so a skipped step is caught at the merge gate rather than trusted to the reader. Step 7 is not CI-backed and the checklist says so, naming the reason: the remote leg needs a ref CI's shallow checkout does not fetch.

### Main path: CI

`npm test` runs `tests/tools/repo-invariants.test.js` on every push and pull request. Three live assertions:

- The five version locations agree with `VERSION`.
- Every `CHANGELOG` claim maps to a backlog heading reading `[X]` or `[~]`; every id claimed by the current version carries a DONE bullet naming a version; every version a DONE bullet names appears in `CHANGELOG`.
- No two backlog headings carry the same id.

All three are green on the tree as it stands, measured, and that is stated as a prediction rather than assumed.

### Alternative paths

**A release in progress.** Between bumping `VERSION` and updating `CHANGELOG.md`, the version invariant is legitimately red. This is accepted and is the point: it forces the five locations to move in one commit, which is precisely what `1.31.0` failed to do when it shipped with `VERSION` still reading `1.30.0` while six boundary checks, a full suite run and nine pre-commit hooks all passed.

**An item deliberately superseded.** A `[~]` heading satisfies record parity as a terminal state. `BUG-034` and `BUG-035` are the live cases.

**An item filed but not shipped.** A `### Filed` or `### Notes` bullet is not a claim, so minting an id and naming it in the current release's CHANGELOG does not make the instrument demand a closed heading. `BUG-045` is the live case and the fixture.

**A four-digit id.** `\d{3,}` sees `BUG-1000`. The exact-quantifier survivor does not, and that difference ships as a fixture case.

### Error cases

**The ceiling's remote leg fails.** Print `CEILING_ABORT` on stderr naming the leg and the reason (spawn failure, non-zero `git` exit, or rc 0 with empty output, which cannot be true for this repository), print **no ceiling**, exit 2. A number derived from half the evidence is worse than no number and would itself be an instance of the archetype this registry documents.

**`VERSION` is unreadable or malformed.** Exit non-zero naming `VERSION` as the failed authority rather than reporting four disagreements against an empty string, which would misattribute the fault to the four checked locations.

**`CHANGELOG.md` has no version heading.** Record parity exits non-zero naming the absence, rather than passing vacuously with zero claims. A vacuous pass is the failure mode that lets an instrument report success on a file it could not read.

**A claimed id has no backlog heading at all.** Reported distinctly from a heading in the wrong state, because the two have different repairs.

---

## The instruments in detail

### `tools/id-ceiling.mjs`

**Heading regex:** `/^### \[.\] `\[(BUG|FEAT|ARCH)-(\d{3,})\]`/`. Only filed backlog headings count. Prose, plans, specs and memory never do.

**Both legs:** the working tree copy of `AGENT-READABLE BACKLOG.md`, and `git show origin/main:AGENT-READABLE BACKLOG.md`. The reported ceiling is the union max per prefix.

**Output:** per-leg heading count, max per prefix, duplicate ids if any, then the union ceiling and the next mintable id.

**Test fixtures** (`tests/tools/id-ceiling.test.js`, pure function over text):
- **The forward-reference decoy**, frozen so registry entry 2 cannot recur: a fixture with a filed heading at `BUG-010` plus three prose lines naming `BUG-042`, one of them the self-referential shape that caused the original failure ("the ceiling this check expects to read after minting is BUG-042"). Passes only if the ceiling reads `BUG-010`.
- **The four-digit case:** a heading at `BUG-1000` is counted, pinning `\d{3,}` against the survivor's `\d{3}`.
- **Duplicate detection:** two headings sharing an id are reported.
- **A heading whose state character is `X`, `~`, `>` or `!`** is still counted, because the ceiling is about filing, not about state.

### `tools/version-gate.mjs`

**Authority:** `VERSION`, trimmed. **Checked against it:** `package.json` `version`, `package-lock.json` `version`, `package-lock.json` `packages[""].version`, and the first `## [x.y.z]` heading in `CHANGELOG.md`. The fourth location exists because npm updates it separately from the third.

**Agreement reports as agreement:** five `ok` lines, `VERSION_GATE_OK <version>`, exit 0.

**Test fixtures** (`tests/tools/version-gate.test.js`):
- **Five-way agreement reports pass.** This case is annotated in the test with the sentence naming what it forbids: *failure on agreement is the defect this gate replaced, and a gate that only ever says FAIL is indistinguishable from a gate that works.*
- **A single disagreement reports fail and names the location**, once per location, five cases, so a gate that reads only the first two cannot pass.
- **No default target exists.** The authority is always read from `VERSION`; there is no argv fallback, and the test asserts the module exposes no such parameter. This is the direct fix for the corrected registry entry 3.

### `tools/record-parity.mjs`

**Claim extraction, two levels.** Level one: the section heading must be one of `Added`, `Fixed`, `Changed`, `Removed`, `Deprecated`, `Security`. `Filed` and `Notes` are excluded by name. Level two: the bullet's first token must be the bolded id marker, `- **[BUG-NNN]**`.

**Three directions.**
- **A, unscoped:** every claim maps to a backlog heading reading `[X]` or `[~]`.
- **B, scoped to the current `CHANGELOG` version:** every id that version claims carries a bullet naming a shipped version.
- **C, unscoped:** every version a DONE bullet names appears as a `CHANGELOG` heading.

**Test fixtures** (`tests/tools/record-parity.test.js`):
- **The `[BUG-044]` state, frozen:** a `[ ]` heading with a `### Fixed` bullet claiming it. Must report fail and name the heading.
- **The reverse:** a closed heading whose DONE bullet names a version `VERSION` disagrees with. Must report fail naming the disagreement, so the instrument reports in both directions rather than only on a missing flip.
- **The `### Filed` control, which is the single-level form's false positive:** a `[ ]` heading whose id appears as a bullet under `### Filed`. Must report pass. The test comment records that the single-level form failed exactly here, on real data, before this level existed.
- **The `[~]` case:** a superseded heading claimed by three versions reports pass.
- **The vacuous-pass guard:** a `CHANGELOG` with no version heading reports fail, not pass.
- **A claim with no heading at all** is reported distinctly from a claim whose heading is in the wrong state.

### `tests/tools/tools-not-shipped.test.js`

Gate 1's cost, pinned rather than trusted:

- `package.json` `files` does not contain `tools` or `tools/`.
- `deployProject` run against a temp asset root that **does** contain `tools/` produces a target with no `tools` entry, neither at the project root nor under `.claude/`.
- **Deliberate-defect confirmation:** a fixture manifest with `tools/` added to `files` drives the same assertion function and turns it red. Without this, the first assertion passes for as long as nobody adds the string, and a test that cannot fail is not a test.

### `tools/README.md`

Carries two things a maintainer must meet before writing a fifth instrument:

1. **The registry of four retired instruments**, with each failure mode and its citation, as written in this spec's Problem section, including the corrected entry 3.
2. **The external-writers registry note (Gate 5).** The user-global `/cc-compact` appends `.claude/memory/session-snapshot.json` to `.gitignore` when absent; `lib/installer/deploy.mjs:17` appends `.claude/memory/turn-count.txt` through the `project-template/gitignore` merge. Neither is under this repository's control. The mitigation already shipped: both lines are kept below the `[BUG-042]` block, each with its writer named in its own comment, and **the convention is that a line kept for an external writer is kept with the writer's name and path in its comment**. The tolerance mechanism also already ships: `tests/unit/gitignore-block-parity.test.js` compares only the lines between its markers, which is why it and `appendMissingLinesText` coexist permanently in one file. No instrument in this item needs to tolerate a writer.

---

## The closeout checklist: location argued, not assumed

Three candidates.

**`CONTRIBUTING.md` section.** In favor: no new file, and the document already states the CI gate is unconditional at `:50`, so the halt-semantics sentence would sit beside its premise. Against: `CONTRIBUTING.md` is 82 lines and addresses contributors, and a release closeout is not a contributor activity. Burying a maintainer ritual in a contributor guide is how it stays unread.

**`.claude/memory/`.** Against, decisively: that directory is host-owned and seeded by the installer, and a checklist placed there would be a tracked file inside a surface whose whole contract is that the installer must not overwrite host state. Wrong neighborhood.

**`docs/RELEASE-CLOSEOUT.md`, recommended.** A maintainer-facing document in the only `docs/` tree this repository keeps, discoverable by name, with room for the ordered steps and the CI-backed annotations. **Its cost is named and is the `[BUG-042]` toll working as designed:** `docs/` is a deny-by-default surface, so the file needs one `!/docs/RELEASE-CLOSEOUT.md` leaf in the tracked-surface block, and `tests/unit/gitignore-block-parity.test.js` will be red until that leaf is added. One line in `CONTRIBUTING.md` points to it from where contributors already read about the CI gate.

---

## Acceptance Criteria

- [ ] **AC1.** `tools/` exists as a tracked, repo-only directory holding the three instruments and `README.md`.
- [ ] **AC2.** `tools/id-ceiling.mjs` counts only headings matching `^### \[.\] `\[(BUG|FEAT|ARCH)-\d{3,}\]``, over the working tree union `origin/main`.
- [ ] **AC3.** The quantifier is `\d{3,}`, and a fixture containing `[BUG-1000]` proves a four-digit id is visible.
- [ ] **AC4.** A failed `origin/main` leg prints `CEILING_ABORT` naming the leg and the reason, prints no ceiling, and exits 2. Spawn failure, non-zero exit and rc 0 with empty output are each distinguished.
- [ ] **AC5.** `tools/version-gate.mjs` takes `VERSION` as its authority, exposes no target parameter and has no literal default.
- [ ] **AC6.** It checks `package.json` `version`, `package-lock.json` `version`, `package-lock.json` `packages[""].version` and the `CHANGELOG.md` first heading, and reports five-way agreement as `VERSION_GATE_OK` with exit 0.
- [ ] **AC7.** `tools/record-parity.mjs` extracts claims with the two-level discriminator: section in `{Added, Fixed, Changed, Removed, Deprecated, Security}` and the bullet's first token the bolded id marker.
- [ ] **AC8.** `Filed` and `Notes` are excluded by name, and `BUG-045` under `### Filed` ships as the control fixture proving the second level was needed.
- [ ] **AC9.** `[X]` and `[~]` are both accepted as terminal, with `BUG-035`'s three-release claim as the cited reason.
- [ ] **AC10.** Direction A is asserted unscoped across all `CHANGELOG` versions.
- [ ] **AC11.** Direction B is scoped to the ids the current `CHANGELOG` version claims, and the 28-legacy-entry measurement is recorded in the spec and in `tools/README.md` so the scope choice is explicable.
- [ ] **AC12.** Direction C is asserted unscoped.
- [ ] **AC13.** A `CHANGELOG` with no version heading reports fail, not a vacuous pass with zero claims.
- [ ] **AC14.** A claim with no backlog heading is reported distinctly from a claim whose heading is in the wrong state.
- [ ] **AC15.** `tests/tools/id-ceiling.test.js` carries the forward-reference decoy fixture, including the self-referential predicted-output line, and passes only if the prose id is not counted.
- [ ] **AC16.** `tests/tools/version-gate.test.js` asserts both directions, with failure-on-agreement named in the test as the forbidden outcome, and one fail case per location.
- [ ] **AC17.** `tests/tools/record-parity.test.js` carries the `[BUG-044]` state fixture and its reverse, both reporting fail and naming the offending record.
- [ ] **AC18.** `tests/tools/repo-invariants.test.js` asserts the version invariant against the live repository.
- [ ] **AC19.** It asserts record parity against the live repository, all three directions.
- [ ] **AC20.** It asserts duplicate-id freedom among live backlog headings, single leg, with no `origin/main` read.
- [ ] **AC21.** No change is made to `.github/workflows/test.yml`; `fetch-depth: 0` is not added, and the spec records why.
- [ ] **AC22.** `tests/tools/tools-not-shipped.test.js` asserts `tools` is absent from `package.json` `files`.
- [ ] **AC23.** It asserts `deployProject` against an asset root containing `tools/` produces a target with no `tools` entry at the project root or under `.claude/`.
- [ ] **AC24.** It carries the deliberate-defect confirmation: a fixture manifest with `tools/` added drives the same assertion function and turns it red.
- [ ] **AC25.** `docs/RELEASE-CLOSEOUT.md` exists as a tracked document listing the closeout steps in order with the three instruments named at the same rank as the version bump.
- [ ] **AC26.** It states which steps are CI-backed and which are not, naming the shallow-checkout reason for the ceiling, and states that halt semantics come from the merge gate rather than from the checklist.
- [ ] **AC27.** `CONTRIBUTING.md` gains one pointer line to it.
- [ ] **AC28.** `tools/README.md` carries the four-entry registry with entry 3's corrected failure mode and the reproduction output.
- [ ] **AC29.** `tools/README.md` carries the external-writers note naming `/cc-compact` and `lib/installer/deploy.mjs:17` with their paths, citing the between-markers precedent.
- [ ] **AC30.** `.gitignore`'s tracked-surface block gains a leaf for every new tracked file under `docs/`, and `tests/unit/gitignore-block-parity.test.js` is green at the end of every task that adds one.
- [ ] **AC31.** **`tools/record-parity.mjs` runs against this item's own closeout, and the closeout record states its result.** The instrument's first production run is the release that ships it: `[BUG-046]`'s backlog heading flipped to `[X]`, its DONE bullet naming `1.32.2`, and `VERSION` and `CHANGELOG.md` agreeing, **asserted by the tool rather than by eye**. The closeout step consumes the instrument's output, which is what this AC pins beyond the live assertion `repo-invariants` already makes. It closes the loop the item exists for: **the first release whose record cannot silently diverge is the release that made divergence detectable.**

---

## Predicted boundaries

Every intermediate state below is predicted with its **suites named**. Any deviation in count or in suite is a tripwire halt.

| Point | Predicted state | Suites |
|---|---|---|
| Baseline, before any task | 910 passed / 12 skipped, 35 files passed / 1 skipped | all |
| After committing this spec **without** its `.gitignore` leaf | **RED, 2 of 4 cases** in `gitignore-block-parity`: exact-equality-in-order and leaf-set-completeness. The directory-ordering and removed-leaf-discriminator cases stay green. | `tests/unit/gitignore-block-parity.test.js` |
| After adding the spec's leaf to the block | back to 910 / 12, 35 / 1 | `gitignore-block-parity` |
| After the plan file lands, before its leaf | **RED, same 2 of 4**, same cause | `gitignore-block-parity` |
| After `tools/id-ceiling.mjs` + its test | +4 tests, +1 file | `tests/tools/id-ceiling.test.js` |
| After `tools/version-gate.mjs` + its test | +7 tests, +1 file | `tests/tools/version-gate.test.js` |
| After `tools/record-parity.mjs` + its test | +6 tests, +1 file | `tests/tools/record-parity.test.js` |
| After `repo-invariants.test.js` | +3 tests, +1 file, **all green on first run** | `tests/tools/repo-invariants.test.js` |
| After `tools-not-shipped.test.js` | +3 tests, +1 file | `tests/tools/tools-not-shipped.test.js` |
| After `docs/RELEASE-CLOSEOUT.md`, before its leaf | **RED, same 2 of 4** | `gitignore-block-parity` |

**The one predicted honest green, named in advance.** `repo-invariants.test.js` will pass on its first run, because all three invariants were measured green during the audit. Per the convention ratified in `[BUG-042]` Task 2, **predicting green when green is true is correct, and the instrument is proved anyway**: each of the three live assertions is confirmed by temporarily inverting its comparison and observing exactly the named cases go red, reported with the case names before the inversion is reverted.

**The self-reference, handled by ordering rather than discovered by failure.** This spec and its plan both live under `docs/`, a surface the tracked-surface block enumerates leaf by leaf. The block is generated from `git ls-files`, so a file must be committed before it can appear in the block. The only ordering that never passes through a state where this item's artifacts violate this repository's own rule is: commit the document, then regenerate the block in the same task, then verify `gitignore-block-parity` green before the task closes. That is `[BUG-042]`'s Task 0 pattern applied to a second item, and it is the reason the first two rows of the table above are predicted red rather than avoided.

---

## Out of Scope

- **Fixing the external writers.** `/cc-compact` and `lib/installer/deploy.mjs:17` are documented here and unchanged. Gate 5.
- **`fetch-depth: 0` or any change to `.github/workflows/test.yml`.** Gate 3.
- **A pre-commit hook.** Gate 2. The hook is never weakened or casually extended.
- **The heredoc family.** `[BUG-047]`, next in queue, now carrying a fourth specimen and the platform-conflict finding.
- **The quoted-path allowlist defect.** `[BUG-045]`, untouched, ritual priced at filing.
- **Redesigning the instruments' semantics.** This item **tracks** the settled semantics. Any semantic change found necessary during porting is its own ruling before it lands.
- **Amending `.claude/memory/project.md:1272` in place.** The corrected registry entry 3 is recorded here and lands at the next memory touch.
- **Back-filling DONE bullets onto the 28 legacy closed entries.** Declined with the `[BUG-042]` toll lesson cited; direction B is scoped instead.
- **Retiring `scripts/ceiling.mjs` or the scratchpad survivors.** They are scratchpad artifacts and stay there; this item makes them unnecessary rather than deleting them.

---

### Files Requiring Full Read (deferred to `/cc-plan`)

- `lib/installer/deploy.mjs` (233 lines). Read at `:112-130` and `:182-196` during the audit, enough to establish that `scripts/` is copied to `.claude/scripts/` and that `tools/` is referenced nowhere. AC23's assertion needs the full `deployProject` signature and its temp-root contract.
- `tests/installer/deploy.test.js` (read at `:37-102`). Its fixture-building helper is the model for AC23's temp asset root and should be reused rather than reinvented.

---

## System Impact

**New:** `tools/` (4 files), `tests/tools/` (5 files), `docs/RELEASE-CLOSEOUT.md`.

**Modified:** `.gitignore` (leaf lines for the new tracked `docs/` files), `CONTRIBUTING.md` (one pointer line), `AGENT-READABLE BACKLOG.md` (this item's closeout), `CHANGELOG.md`, `VERSION`, `package.json`, `package-lock.json` (version, if a release ships this), `.claude/memory/project.md` (spec summary, implementation record, closeout).

**Unaffected and verified so:** `package.json` `files` needs no change, since it is an explicit allowlist and `tools` is simply absent. `lib/installer/deploy.mjs` needs no change, since it copies only named directories. `.github/workflows/test.yml` needs no change. `sweepStaleRootScripts` compares the bundled set against the present set, both derived at runtime, so it is unaffected by anything added to `scripts/` or `tools/`.

**Version: RULED PATCH, `1.32.2`, 2026-09-29**, by the test `[BUG-042]` ratified at `1.32.1` and designated as the worked example for close calls. The argument: this adds a repo-only directory, repo-only tests and a maintainer document. It changes no shipped artifact, `package.json` `files` is untouched, and `lib/installer/deploy.mjs` copies only named directories, so **a fresh install produces byte-identical output**. Nothing a consumer receives changes, which is the line MINOR requires crossing. The five version locations move together in one commit, which is what the version gate this item ships exists to enforce.

---

## Complexity Estimate

**M.** Three small pure modules with narrow, already-settled semantics, plus five test files whose fixtures are already written as audit probes and already measured. The genuine work is not the instruments; it is the ordering discipline around the `docs/` leaf toll and the honest proving of a suite predicted green.
