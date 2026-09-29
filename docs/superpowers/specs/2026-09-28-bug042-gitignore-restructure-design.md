# BUG-042: Replace the two wholesale directory excludes with the root-anchored re-include form

**Status:** approved (five gates ruled 2026-09-28, before this document was written)
**Filed:** `AGENT-READABLE BACKLOG.md` `[BUG-042]`, from `[BUG-040]`'s audit
**Audit:** 2026-09-28, this session, against `86b5435`
**Version call:** argued below, flagged for plan approval

---

## Problem

`.gitignore:7` excludes `.claude/` wholesale and `.gitignore:8` excludes `docs/` wholesale. Both directories hold tracked files. Git refuses to describe an excluded ancestor honestly, so `git add` on a tracked file inside either one exits 1 while staging the file correctly.

Measured on today's tree, in a scratch repo rebuilt from the real index:

| site | tracked files | `git add <tracked path>` |
|---|---|---|
| `.claude/` | 12 | **rc 1, staged=true** |
| `docs/` | 44 | **rc 1, staged=true** |

The `docs/` specimen is this fortnight's own work: `git add docs/superpowers/specs/2026-09-28-bug044-deny-message-phantom-allowlist-design.md` exits 1.

An exit code that reports failure on success is not merely cosmetic. It destroys the channel: under the current rules a tracked file that staged and a new file that did not stage are **indistinguishable**, both exiting 1. `[BUG-040]` shipped the staging convention so the caller stops reading the lie. This item stops the tool telling it.

Three further defects were found by this audit and are repaired by the same change.

**`*.local` at `:4` does not cover `settings.local.json`.** Probed directly: `a.local` matches `:4`; `zz/s.local.json` matches nothing. `.claude/settings.local.json` is held ignored by `:7` **alone**. Any restructure that drops `:7` without naming that file exposes a host-owned settings file to the index.

**`.gitignore:10` (`!project-template/*`) exists only to patch the other two rules' over-reach.** `.claude/` and `docs/` carry no leading slash, so they match at any depth, including `project-template/.claude/` and `project-template/docs/`. Measured: with `:10` present both are trackable; with `:10` removed both are ignored. **The allowlist template shipped in 1.32.0 at `project-template/.claude/memory/bash-scan-allowlist.txt` is trackable today only because of line 10.** Root-anchoring the rules retires line 10 entirely.

**The filing's central premise was wrong, and the correction is what makes this item cheap.** The filing states that writing the re-include form "requires enumerating every tracked subtree under `.claude/` together with every path that must stay ignored", and that this enumeration "already exists: it is `PROJECT_HOST_OWNED`". Measured: the deny-by-default form names **zero** host-owned paths and still leaks zero, because `.claude/memory/*` re-excludes everything not explicitly re-included. The enumeration the form needs is the **tracked** list, which is the git index. The duplication the filing calls "the defect" does not exist in the form that actually passes.

## Solution

Replace lines `:3`, `:7`, `:8`, `:10`, `:11`, `:16` and `:17` with two root-anchored, leaf-enumerated blocks, one per site: exclude the root's contents, re-include each directory that holds tracked files, re-exclude that directory's contents, then re-include each tracked file by name. Everything not named is ignored, so the file is deny-by-default and a new file is invisible until someone writes its line.

The enumeration is hand-written and pinned by a test that computes the expected block from `git ls-files` and asserts exact equality. The git index is the single source of truth, which is the only enumeration that cannot drift from what is tracked, because it *is* what tracked means. `PROJECT_HOST_OWNED` gets a different and better relationship: a per-row **ignored XOR tracked** invariant, which holds today (2 tracked, 7 ignored) and catches the future seed row that accidentally becomes trackable, a defect class nothing currently watches.

## Behavior

### Main path

A contributor edits a tracked file under `.claude/` or `docs/` and stages it by explicit path. `git add` exits **0** and the path stages. `git add -u <path>` also exits 0. `git add .claude/` exits 0.

### Alternative paths

A contributor adds a genuinely new tracked asset, for example a sixth `cc-*.md` command or a new spec. `git add <path>` exits **1** and stages **nothing**, because the file is not yet named in the block. They add one `!` line to `.gitignore` and the add exits 0. `git add -f <path>` is the interim that works without the line. This toll is the accepted cost of Gate 2 and is documented in the block's comment header so the next person meets the rule and its remedy together.

A host writes `.claude/memory/personal.md`, `session-snapshot.json`, `turn-count.txt`, `context-threshold.txt`, `bash-scan-allowlist.txt`, `session-snapshot.md` or `settings.local.json`. All seven stay ignored and invisible to `git status`.

### Error cases

A tracked file is removed from the `.gitignore` block while remaining in the index. The block-equality test fails and names the missing leaf. Git keeps tracking the file, so nothing is lost; the failure is a drift report, not a data loss.

A `PROJECT_HOST_OWNED` row becomes both tracked and ignored, or neither. The XOR test fails and names the row.

## The two blocks

### `.claude/`, verbatim, 19 rule lines

```
/.claude/*
!/.claude/commands/
/.claude/commands/*
!/.claude/hooks/
/.claude/hooks/*
!/.claude/memory/
/.claude/memory/*
!/.claude/commands/cc-implement.md
!/.claude/commands/cc-init.md
!/.claude/commands/cc-plan.md
!/.claude/commands/cc-resume.md
!/.claude/commands/cc-spec.md
!/.claude/hooks/context-guard.ps1
!/.claude/hooks/context-guard.sh
!/.claude/hooks/post-compact.ps1
!/.claude/hooks/post-compact.sh
!/.claude/hooks/pre-tool-use.mjs
!/.claude/memory/project.md
!/.claude/settings.json
```

### `docs/`, scaffold verbatim, then 44 leaf lines

```
/docs/*
!/docs/superpowers/
/docs/superpowers/*
!/docs/superpowers/plans/
/docs/superpowers/plans/*
!/docs/superpowers/specs/
/docs/superpowers/specs/*
```

followed by one `!/docs/superpowers/plans/<file>` or `!/docs/superpowers/specs/<file>` line per tracked file, sorted. The count is whatever `git ls-files docs` reports **at generation time**, not a fixed number: it was 44 when this audit ran, 45 once this spec was committed, and 46 once the plan is. Any count written into this document would be stale before implementation starts, which is precisely why the test computes it rather than hard-coding it.

**Ordering is load-bearing and is part of the contract.** Git applies last-match-wins, so a directory's `!` re-include must precede its `/*` re-exclusion, and every leaf `!` must follow the `/*` line that would otherwise exclude it. The generator in the test emits directories parent-first, then all leaves sorted, and the file must match that order exactly.

**Retained lines.** `.claude/memory/session-snapshot.json` is kept as a redundant line below the block, carrying the comment: *kept redundant: the user-global `/cc-compact` appends this line when absent; removing it means one re-append per compact*. A line whose reason is documented is convention; a line that keeps reappearing without one is a haunting.

**Retired lines.** `:3` (`.claude/memory/personal.md`), `:7`, `:8`, `:10` (`!project-template/*`), `:11` (`session-snapshot.md`), `:16` (`turn-count.txt`) are all subsumed by the blocks and removed. `:10`'s retirement is the structural reason `docs/` was folded into this item: it patches `:8` as much as `:7`, so shipping `.claude/` alone would ship a form that still needs the blanket re-include, which is half a fix that keeps the patch it exists to retire.

## Measured evidence

Corpus run in a scratch repo built from the real index, three forms over one case set. `.claude/`: 12 tracked, 46 untracked.

| case | baseline (`.claude/`) | **leaf (chosen)** | dir form (rejected) |
|---|---|---|---|
| A tracked file, `git add <path>` | rc 1, staged=true | **rc 0, staged** | rc 0, staged |
| B unlisted new file in a tracked dir | rc 1, staged=false | **rc 1, staged=false** | **rc 0, STAGES** |
| C host-owned rows leaking | 0 | **0** | 0 |
| D untracked files made visible | 0 of 46 | **0 of 46** | **6 of 46** |
| E `git add -u <tracked path>` | rc 0 | rc 0 | rc 0 |
| F `git add .claude/` | rc 1 | rc 0 | rc 0 |

Second run over **both sites**, `docs/`: 44 tracked, 20 untracked.

| case | **both-leaf (chosen)** | claude-leaf + docs-dir (rejected) |
|---|---|---|
| A tracked spec, `git add <path>` | **rc 0, staged** | rc 0, staged |
| B unlisted new spec | **rc 1, staged=false** | **rc 0, STAGES** |
| C `project-template/` still ignored | **0 of 2** | 0 of 2 |
| D untracked made visible | **0** | **19**, including 16 historical specs and plans plus `.DS_Store` |

Case B is the item's entire point. An unlisted new file exiting 0 and staging is the dishonesty **inverted**, not removed. The dir form fails it at both sites, which is why leaf was ruled.

## Acceptance Criteria

- [ ] **AC1** `git add` on a tracked, modified file under `.claude/` exits 0 with the path staged.
- [ ] **AC2** `git add` on a tracked, modified file under `docs/` exits 0 with the path staged.
- [ ] **AC3** An unlisted new file under `.claude/` exits non-zero **and stages nothing**.
- [ ] **AC4** An unlisted new file under `docs/` exits non-zero **and stages nothing**.
- [ ] **AC5** Every `PROJECT_HOST_OWNED` row that is not tracked is still ignored, asserted per path, not spot-checked.
- [ ] **AC6** `.claude/settings.local.json` is ignored by a rule that names it or its directory contents, never by an ancestor exclude, so the `*.local` gap measured in this audit cannot silently reopen.
- [ ] **AC7** `project-template/.claude/**` and `project-template/docs/**` remain trackable with `!project-template/*` **removed**, proving root-anchoring retired it.
- [ ] **AC8** `git ls-files --others --exclude-standard` reports no newly visible file at either site: the restructure exposes nothing.
- [ ] **AC9** A test computes the expected block from `git ls-files .claude` and `git ls-files docs` and asserts the `.gitignore` block matches exactly, including order.
- [ ] **AC10** That test carries a **deliberate-defect confirmation**: a block with one leaf removed must fail it. The confirmation is an assertion in the test, not a comment.
- [ ] **AC11** A test asserts, per `PROJECT_HOST_OWNED` row, **ignored XOR tracked**.
- [ ] **AC12** That test carries a deliberate-defect confirmation: a row flipped to both-or-neither must fail it.
- [ ] **AC13** `git add -u <tracked path>` still exits 0 at both sites, so `[BUG-040]`'s clause 2 is not regressed.
- [ ] **AC14** `.claude/memory/session-snapshot.json` is retained as a literal line with the comment naming the external writer verbatim.
- [ ] **AC15** The `.gitignore` block carries a comment header stating the toll: one `!` line per newly tracked asset, with `git add -f` named as the interim.
- [ ] **AC16** `CLAUDE.md`'s staging convention is **partially retired**, not deleted: clause 1's justification rewritten to name what retired it, quoting case A's rc 1 to rc 0; clauses 2 and 3 kept with their remaining live cases named (`.conductor/` at the ignore file's `.conductor/` rule for `-f`; bare `-u` independent of any ignore rule).
- [ ] **AC17** The anchoring note lands beside it, as two sentences that do not erase each other: struck shape (d)(1) remains struck for exit-code reporting, and anchoring is load-bearing for path matching.
- [ ] **AC18** `tests/unit/staging-convention.test.js` passes unchanged, because it builds its own fixture `.gitignore` and pins git's behavior rather than this repo's file.
- [ ] **AC19** The backlog entry records that the second site was found by audit, same archetype, folded by ruling, under the supersession bookkeeping convention.

## Blast radius

**No test reads the repo's root `.gitignore`.** Verified: all 29 `gitignore` references across seven test files are either fixture files written by the test itself or `project-template/gitignore`. Nothing pins the file this item rewrites.

**Nothing shipped changes.** `project-template/gitignore` carries three lines (`.claude/memory/turn-count.txt`, `*.installer-backup.*`, `*.installer-tmp.*`) and no `.claude/` or `docs/` rule. Consumers are unaffected. `lib/installer/deploy.mjs:17` merges that template by appending absent lines and is untouched.

**`tests/unit/staging-convention.test.js` does not break.** Its fixture at line 27 writes its own ignore body, so AC6's assertion that plain `add` exits 1 while staging remains true as a statement about git under a wholesale rule. What becomes false is the **prose** in `CLAUDE.md`, which opens by naming `.gitignore:7` as its premise. That is the `README.md:189` shape from `[BUG-044]`: a documentation-truth edit, classified as such, not a test failure.

**`.gitignore:10` retires.** Measured above. Its removal is an AC, not a side effect.

**The `/cc-compact` appender is external to this repo.** It lives in the user-global command and appends `.claude/memory/session-snapshot.json` whenever no line exactly equals it. The line is kept for that reason. This coupling is routed to `[BUG-046]` as a sibling concern: an external writer to a repo file belongs to the same "infrastructure the repo depends on but does not control" family as the release-critical instruments.

**The `docs/` toll is larger than the `.claude/` toll, and is accepted with its enforcement named.** Every new spec and every new plan needs one `!` line, so the ordinary item cost is two lines per item. That toll is **self-enforcing**: a new spec committed without its `!` line fails AC9's block-equality test, so it cannot be forgotten, only paid, which makes it a checklist item rather than a tax. It joins each plan's Task 0 ritual alongside the `-f` stage already there.

The measured alternative is a pattern re-include such as `!/docs/superpowers/specs/*.md`. It is recorded here as a **named future option, not a pending decision**, with its full measured cost: 19 untracked files become visible, 16 of them historical specs and plans never committed plus three `.DS_Store`, and case B's semantics invert for that subtree, which is the exact failure this item exists to remove. **Its trigger is evidence, not prediction:** two lines per item is a predicted annoyance, and evidence-first applies to friction as much as to mechanism, so the option is revisited when specimens of real friction exist and not before.

## Version call, argued

The rule ratified at `[BUG-044]`: PATCH repairs, MINOR changes what ships, and the test is observability on a fresh install.

This change touches the repository's own `.gitignore`, `CLAUDE.md` prose, `AGENT-READABLE BACKLOG.md`, and adds two test files. It touches no file under `project-template/`, no file under `lib/`, and nothing in the published tarball's asset set. A consumer installing 1.32.1 on a fresh project observes byte-identical output to 1.32.0.

**Therefore PATCH: 1.32.1.** The counter-argument is that developer-facing behavior in this repository changes materially, which is true and is why it is a release rather than an unversioned chore, but the ratified test is observability on a fresh install and this change is invisible there.

**Ratified 2026-09-28 and designated the worked example for close calls.** The shape to reuse: name the counter honestly, apply the ratified test rather than intuition, let the verdict follow the test. Cite this section next time a version call is close.

## Out of Scope

- Changing `project-template/gitignore` or anything a consumer receives.
- Generating `.gitignore` at build or install time. Gate 1 ruled hand-written with exact-equality assertion; a generator is a different item if the toll ever justifies one.
- Adding the 16 historical untracked specs and plans to the index. They stay untracked; this item does not decide their fate.
- Retiring `[BUG-040]`'s convention wholesale. Gate 4 ruled partial retirement.
- `graphify-out/`, `node_modules/`, `.conductor/` and the other root rules, which are neither wholesale-excluding a tracked subtree nor depth-unanchored in a way that reaches a tracked path.
- `.DS_Store`, beyond leaving its existing line alone. Three of them surfaced in the `docs/` measurement, and they belong in the developer's global gitignore rather than in any repository decision. Recorded as housekeeping, ruled out of this item.

## System Impact

- `.gitignore` (rewritten: seven lines retired, two blocks added, one line retained with a comment)
- `CLAUDE.md` (staging convention partially retired, anchoring note added)
- `AGENT-READABLE BACKLOG.md` (`[BUG-042]` closed with the audit's premise corrections recorded; `[BUG-046]` gains the external-writer sibling concern)
- `tests/unit/gitignore-block-parity.test.js` (new: AC9, AC10)
- `tests/unit/host-owned-ignore-xor.test.js` (new: AC11, AC12)
- `tests/unit/staging-convention.test.js` (verified unchanged, AC18)
- `.claude/memory/project.md` (spec summary, then implementation record)

### Files Requiring Full Read (deferred to /cc-plan)

`tests/unit/staging-convention.test.js`, for the exact fixture helper shape the two new test files should follow.

## Complexity Estimate

**M.** The rule change is small and fully measured, but it lands at two sites, retires four lines whose load-bearing behavior had to be proved rather than assumed, requires two tests each with a deliberate-defect confirmation, and carries a documentation-truth edit whose wording is itself a ruling.
