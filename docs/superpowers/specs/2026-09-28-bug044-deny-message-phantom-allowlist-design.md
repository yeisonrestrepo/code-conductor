# BUG-044: Guard 3's Deny Message Recommends a File That Exists in No Installation

**Status:** approved, gates ruled before drafting
**Date:** 2026-09-28
**Backlog:** `[BUG-044]`, `AGENT-READABLE BACKLOG.md`
**Mints:** `[BUG-045]` (Gate 3)
**Baseline:** `main` at `b245636`, suite 897 passed / 12 skipped

---

## Problem

Guard 3 denies a `Bash` command and tells the reader: *"To permit a path permanently, add a
commented entry to `.claude/memory/bash-scan-allowlist.txt`."* That file is not shipped, not
seeded, and not created by the installer. It exists in no installation of this project,
including the one that wrote the message.

The audit's own first command was denied by this message, which is the fourth time the
mechanism has tolled on the work auditing it. Re-measured at `b245636`: the file is absent,
`.claude/memory/` holds four files and none of them is the allowlist, and
`.conductor/last-write.log` carries **zero** `CC_GUARD3_WARN` traces across 69 lines. The
`1.29.0` escape hatch has never been used by anyone this repository can observe.

### The second defect, which needs no telemetry

The remedy is **inert on two of the three denials it is printed on**. `g3AllowlistCovers`
runs at `pre-tool-use.mjs:469`. The length denial returns at `:448` and the malformed denial
at `:452`, both before the allowlist is ever consulted. On those two the sentence promises a
remedy that cannot apply by construction. This is provable by reading the control flow and
is the one falsehood in this item that is independent of any measurement.

### What the message is, and is not

The remedy sentence is **port-only**. The frozen authority prints `⛔ BASH SCAN BLOCKED`
plus a one-line detail at `guard3-reference.sh:440`, `:456` and `:497`, and says nothing
about an allowlist. The corpus arbitrates verdicts, never message text. Changing the wording
therefore requires **no fifth sanctioned exception** to the authority, and the authority is
not touched by this item at all. The only cross-subject constraint is the byte-identical
mirror pinned by `tests/installer/templates.test.js:96-98`.

No test asserts the remedy sentence. `guard3-port.test.js:46` and
`pre-tool-use-contract.test.js:99` match `/BASH SCAN BLOCKED/` only, and
`pre-tool-use-contract.test.js:174` pins the `CC_GUARD3_WARN` ask to the byte-identical deny
string, which `g3Blocked` satisfies for free because both verdicts leave through it.

### The measure, corrected on the record

The backlog entry sets the success measure as uptake moving off zero. **That is a premise
error, and it is corrected here with its reasoning rather than quietly dropped.**

The reader at the moment of friction is the agent, and this project's `CLAUDE.md` instructs
it: *"Never skip the pre-tool-use hook; if it blocks a tool invocation, investigate, do not
bypass."* Adding an allowlist entry to clear one's own denial is that bypass. The human who
may legitimately set policy is not reading a 490-character reason string mid-tool-call. So
zero uptake is not evidence of a discoverability failure. It is the standing instruction
working exactly as written, by the only party in the loop.

**Uptake remaining at zero is the design working.** The agent adapts or reports; the operator
legislates. Any future proposal to "improve discoverability" of the allowlist must first
answer this paragraph, because moving that number means agents began self-serving exceptions,
which is the thing the project prohibits. This paragraph exists to keep the next maintainer
from re-filing the zero as a defect.

The measure is therefore **truthfulness, not uptake**: every sentence the denial prints is
actionable by someone, and no sentence promises a remedy inapplicable to the denial it
accompanies.

### A third finding, carried here and fixed elsewhere

**The allowlist cannot cover a quoted path.** `G3_BD` is `(^|[ \t\n\r\f\v|;()])` at
`pre-tool-use.mjs:397` and `G3_AD` is its mirror at `:398`. Neither set contains a quote
character, so the entry `docs/` does not cover `cat "docs/x.md" *.md`. BUG-043 did not change
this: `:469` deliberately passes the **unmasked** string, because the allowlist matches paths
as the operator wrote them.

The escape hatch nobody reached for would not have worked for a quoted path either. The
finding belongs beside the zero-uptake measurement, which is a statement about where the
**finding** is recorded, not where the **fix** lands. The fix mints `[BUG-045]` (Gate 3).

### Premise corrections to the landed entry

Noted here, not edited into the entry, per the house rule that records show their history.

- The entry cites `pre-tool-use.mjs:433` and `:427-435`. BUG-043 shifted both. `g3Blocked`
  now spans `:432-440`, the remedy sentence is `:438`, and its three call sites are `:448`,
  `:452` and `:470`.
- The entry's success measure is corrected as argued above. The backlog entry receives an
  amendment note **above** its original text; the original wording stays intact.

---

## Solution

Three changes, sequenced message-first, plus two filings.

1. **Make the denial truthful per denial kind.** `g3Blocked` gains a second parameter that
   controls one trailing sentence. The pattern denial carries an operator-scoped statement of
   where permanent exceptions live; the length and malformed denials carry none, because the
   allowlist is never consulted on those paths. The parameter defaults to omitting the
   sentence, so a future call site is safe by default.

2. **Make the named path resolve.** `memory/bash-scan-allowlist.txt` flips from `skip` to
   `seed` in `PROJECT_HOST_OWNED`, and `project-template/.claude/memory/bash-scan-allowlist.txt`
   ships as a comment-only template whose header teaches the entry format and carries the
   BUG-037 allowlist contract verbatim.

3. **Restate the two records that the seed makes false.** `templates.test.js:143` is replaced
   by an assertion of what now carries the load, and `README.md:189` restates to the true
   contract.

### The seed's honest limit, stated rather than glossed

A comment-only file parses to **zero entries**, which is behaviorally identical to no file:
`g3ReadAllowlist` trims each line and drops blanks and `#` lines, so the shipped template
disarms nothing. Seeding it changes no verdict on any command. Its entire value is that the
path the message names resolves to something, and that its header teaches the format at the
moment someone goes looking. That is the whole claim, and the ACs assert the inertness rather
than hoping for it.

### Why shipping the filename is safe now, and was not before

BUG-037 rested the allowlist's safety on the template never shipping that filename, because
`deployProject` copied the template wholesale. **BUG-039 replaced that mechanism.**
`deploy.mjs:169` now filters the copy through `hostOwnedFilter`, which excludes every path in
the table regardless of its policy, and `seedHostOwned` at `:183` then writes only when the
target is absent.

The proof is already green in the suite. `tests/installer/deploy.test.js:347` deploys, writes
a host allowlist, writes a **template** allowlist, deploys again, and asserts the host file is
byte-identical. That test was written for exactly this hypothetical and it passes today.

The collision this item resolves is between two live assertions that contradict each other the
instant the policy flips:

| Assertion | Requires |
|---|---|
| `templates.test.js:172` | every `seed` entry **has** a template source |
| `templates.test.js:143` | the allowlist template **does not exist** |

`:143`'s own comment names its premise: *"since deployProject copies the template wholesale."*
That premise died with BUG-039. The assertion is retired and replaced, never deleted.

**Classification on the record: ASSERTION-RETIREMENT**, the shape ruled on at BUG-039, where
an assertion encoding retired behavior is updated to the specified one and gets stronger. It
is distinct from FIXTURE-COMPLETENESS, where no assertion changes. Both are loud and
pre-declared; quiet or weaker is still never permitted. The classification is named in the
commit body, not only here.

---

## Behavior

### Main path

1. An agent runs a `Bash` command that matches a mass content-dump pattern.
2. Guard 3 reaches `:470` and calls `g3Blocked(detail, { allowlistApplies: true })`.
3. The denial reads:

   > BASH SCAN BLOCKED. The command triggered a mass content-dump pattern. Pattern ids: P1.
   > Authorized alternatives: 1. Grep for targeted content search with file and pattern scope.
   > 2. Glob for path listing without file content. 3. Read with an explicit offset and limit.
   > A permanent exception is operator policy, not a self-serve step: entries live in
   > `.claude/memory/bash-scan-allowlist.txt`, are reviewed in git, and an agent may propose
   > one but must not add it to clear its own denial.

4. The agent, which is instructed never to bypass the hook, takes one of the three
   alternatives. It does not edit the allowlist.
5. The operator, reading the same string later in a transcript or a report, knows where
   policy lives, that it is reviewed in git, and that the file exists to be opened.
6. Opening `.claude/memory/bash-scan-allowlist.txt` finds a commented header that states the
   entry format and the review rule.

### Alternative paths

- **Length denial** (`command.length > 8192`, `:448`). The reader gets `BASH SCAN BLOCKED`,
  the length detail and the three alternatives, and **no allowlist sentence**, because
  `g3AllowlistCovers` is never reached on this path.
- **Malformed denial** (unclosed quote, `:452`). Same shape, same omission, same reason.
- **`CC_GUARD3_WARN=1`.** The verdict becomes `ask` carrying the byte-identical reason,
  including the operator sentence on a pattern denial. `pre-tool-use-contract.test.js:174`
  continues to pass unmodified, because both verdicts leave through `g3Blocked`.
- **An allowlist entry already covers the command.** `:469` returns `null` and no message is
  produced at all. Unchanged by this item.
- **A fresh `--project` install.** The allowlist does not exist, so `seedHostOwned` copies the
  commented template in. Guard 3 behavior is identical before and after, because the template
  parses to zero entries.
- **A re-run over an operator-edited allowlist.** `hostOwnedFilter` excludes the path from the
  copy and `seedHostOwned` skips it because the target exists. The file is byte-identical.
- **A re-run after the operator deleted the allowlist.** The file is re-seeded from the
  template. This is standard `seed` semantics, identical to `memory/project.md` and
  `memory/context-threshold.txt`, and it is named here so it is not discovered as a surprise.

### Error cases

- **The template source is missing from a damaged package.** `seedHostOwned` skips a source
  that does not exist rather than throwing (`host-owned.mjs:88`). The deploy completes and the
  message names a file that is absent again, which is the pre-fix state, not a new failure.
- **The allowlist exists but is unreadable.** `g3ReadAllowlist` returns an empty list plus one
  `debug` line for any error other than `ENOENT` (`:384`). A permissions problem on a policy
  file never escalates into denying every tool call. Unchanged by this item.
- **A future call site forgets the second argument.** It defaults to omitting the operator
  sentence, so the failure mode is a denial that says less, never one that promises a remedy
  that does not apply.

---

## Acceptance Criteria

### The message (Gates 2 and 4)

- [ ] **AC1.** `g3Blocked` takes a second parameter, defaulting to omitting the operator
      sentence, and both mirror members remain byte-identical.
- [ ] **AC2.** A pattern denial (`cat *.ts`) carries the operator sentence naming
      `.claude/memory/bash-scan-allowlist.txt`.
- [ ] **AC3.** A length denial (a command over 8192 characters) carries **no** occurrence of
      `bash-scan-allowlist` anywhere in its reason. Asserted as an absence, not by wording.
- [ ] **AC4.** A malformed denial (unclosed quote) carries no occurrence of
      `bash-scan-allowlist` in its reason.
- [ ] **AC5.** All three denial kinds carry `BASH SCAN BLOCKED` and all three Authorized
      alternatives, so the omission in AC3 and AC4 removes the false promise and nothing else.
- [ ] **AC6.** The operator sentence states that entries are operator policy, that they are
      reviewed in git, and that an agent may propose one but must not add it to clear its own
      denial. Asserted on the substance, not a byte-exact string.
- [ ] **AC7.** `pre-tool-use-contract.test.js:174` passes unmodified: the `CC_GUARD3_WARN` ask
      on a pattern denial carries the string identical to the deny, operator sentence included.
- [ ] **AC8.** `guard3-port.test.js:46` and `pre-tool-use-contract.test.js:99` pass unmodified.
- [ ] **AC9.** `tests/fixtures/guard3-reference.sh` is not modified. The sanctioned exception
      count in its header stays at **four** and `EXCEPTIONS` stays at exactly one member.

### The seed (Gate 1)

- [ ] **AC10.** `project-template/.claude/memory/bash-scan-allowlist.txt` exists and every one
      of its lines is blank or begins with `#` after trimming.
- [ ] **AC11.** Parsing the shipped template by `g3ReadAllowlist`'s rule (trim, drop blanks,
      drop `#`) yields **zero** entries, so seeding it changes no verdict.
- [ ] **AC12.** The template header carries the BUG-037 allowlist contract: one entry per
      line; blank and `#` lines ignored and whitespace trimmed; a trailing `/` covers paths
      under that prefix and rejects any `..` suffix; any other entry matches a whole command
      token; entries match literally so regex metacharacters carry no special meaning; every
      entry requires a comment naming why it exists and ideally the issue, and an uncommented
      entry is a review smell.
- [ ] **AC13.** `PROJECT_HOST_OWNED.get('memory/bash-scan-allowlist.txt')` is `'seed'`.
- [ ] **AC14.** `templates.test.js:143` is **replaced**, not deleted, by an assertion encoding
      the live mechanism (the row's policy plus the template's presence), and the commit body
      names the change **ASSERTION-RETIREMENT** with BUG-039 as its precedent.
- [ ] **AC15.** A `--project` deploy into a tree with no allowlist creates it byte-identical
      to the template; a second deploy over an operator-edited allowlist leaves it
      byte-identical. The second half is `deploy.test.js:347` and must still pass; the first
      half is new.
- [ ] **AC16.** `templates.test.js:168` ("ships nothing marked skip") and `:172` ("template
      source for every seed and merge entry") both pass with the new row, which is the
      collision resolving rather than being suppressed.
- [ ] **AC17.** `README.md:189` restates to the true contract: the installer ships this file
      once as a commented template and creates it only when absent, and never overwrites an
      existing one. The current sentence "The installer never ships or overwrites this file"
      is false after AC13 and may not survive.

### The record (Gates 2 and 3)

- [ ] **AC18.** This spec states that uptake remaining at zero is the design working, with the
      `CLAUDE.md` non-bypass instruction cited, and requires any future discoverability
      proposal to answer that argument first. (Satisfied by the Problem section; asserted here
      so it cannot be dropped in a later edit.)
- [ ] **AC19.** `[BUG-045]` is filed at the ceiling for the quoted-path defect, naming the
      full ritual it must pay: the authority's `_g3_allowlist_covers`, a fifth sanctioned
      exception, corpus rows and a predicted red table. The filing records that the entry's
      "beside the measurement" wording is read as placement of the finding, not of the fix, so
      it is not re-litigated.
- [ ] **AC20.** The `[BUG-044]` backlog entry gains an amendment note **above** its original
      text correcting the success measure and the stale line references. The original wording
      is preserved intact.
- [ ] **AC21.** The id ceiling is re-run with both legs immediately before the `[BUG-045]`
      filing and reports `BUG:45` afterward.

---

## Out of Scope

- **Widening `G3_BD` and `G3_AD` to cover quoted paths.** Verified as real, filed as
  `[BUG-045]`. It is a behavioral change to the guard's allow path and must pay the
  authority's ritual; folding it here would make a documentation item carry that freight.
- **Any change to Guard 3's pattern set or to which commands deny.** No corpus row moves.
  This item produces zero verdict changes, which is itself an assertion (AC11).
- **Any change to `tests/fixtures/guard3-reference.sh`.** The message is port-only.
- **Seeding the global surface.** The allowlist is resolved against `process.cwd()`
  (`:382`), so it is a project-surface file only. `GLOBAL_HOST_OWNED` is untouched.
- **`CC_GUARD3_WARN` discoverability.** It is documented in `README.md:191` as triage. The
  zero traces are covered by the Gate 2 argument, and no mechanism is added to promote it.
- **BUG-042**, the `.gitignore` restructure, which remains next in the queue after this item.

---

## System Impact

| File | Change |
|---|---|
| `.claude/hooks/pre-tool-use.mjs` | `g3Blocked` `:432-440` gains the parameter; call sites `:448`, `:452`, `:470` |
| `project-template/.claude/hooks/pre-tool-use.mjs` | the byte-identical mirror, moved in the same step |
| `project-template/.claude/memory/bash-scan-allowlist.txt` | **new**, commented template |
| `lib/installer/host-owned.mjs` | one row: `skip` to `seed` |
| `tests/installer/templates.test.js` | `:143` replaced; mirror parity `:96-98` re-asserted |
| `tests/installer/deploy.test.js` | new case for the create-when-absent half of AC15 |
| `tests/hooks/pre-tool-use-contract.test.js` | three new cases, one per denial kind |
| `README.md:189` | contract restated |
| `AGENT-READABLE BACKLOG.md` | `[BUG-044]` amendment note; `[BUG-045]` filed |
| `CHANGELOG.md`, `VERSION` and the version locations | release |

**Staging note.** `.gitignore:7` excludes `.claude/` at any depth, so the new
`project-template/.claude/memory/bash-scan-allowlist.txt` is a new file under an ignored
ancestor and stages with `git add -f <path>`, per the staging convention. The two modified
hook mirrors are tracked and stage with `git add -u <path>`.

**Version.** Recommend **1.32.0** rather than a patch, and flagged for ruling at plan
approval. The three prior items in this chain were patches because they repaired behavior
without changing what ships. This one adds a file to the shipped inventory and changes a
documented installer contract, which is observable new behavior on every install. The
version gate checks five locations and all five move together.

### Files Requiring Full Read (deferred to /cc-plan)

_None._ Every file this item touches was read within budget during the audit: the hook's
`g3Blocked`, allowlist reader and matcher regions; `lib/installer/host-owned.mjs` in full (94
lines); the four relevant `templates.test.js` regions; `deploy.test.js:340-365`; and the
contract test harness. `/cc-plan` will still read `tests/installer/templates.test.js`
around `:143` in full before rewriting that assertion.

---

## Complexity Estimate

**S.** One parameter, one table row, one new comment-only file, one replaced assertion and two
documentation restatements. The authority is untouched, no corpus row moves and no verdict
changes, which removes the entire class of risk that dominated BUG-041 and BUG-043. The only
real care is the mirrored pair, which a pre-existing test enforces, and the two-test collision,
which resolves in the same step it is created.

## Identified Risks

1. **The mirror is edited on one side.** Caught by `templates.test.js:96-98` at the first
   suite run. This is the failure that fired at BUG-041's crossover; the plan names both
   members in one step.
2. **The `:143` replacement is weaker than what it retires.** Mitigated by asserting the row's
   policy **and** the template's presence, with the host-survival half already proven by
   `deploy.test.js:347`. The classification is declared in the commit body so the change is
   reviewable as a retirement rather than a deletion.
3. **The seeded template accidentally carries a live entry.** Caught by AC11, which parses the
   shipped file by the loader's own rule and requires zero entries.
4. **AC3 and AC4 pass for the wrong reason**, because a length or malformed denial fails to
   fire at all. Mitigated by asserting the positive half in the same case: the reason must
   match `BASH SCAN BLOCKED` and the kind-specific detail, and must not contain
   `bash-scan-allowlist`.
5. **The version ruling is deferred.** Named here rather than decided silently; a patch
   version would understate a change to the shipped inventory.
