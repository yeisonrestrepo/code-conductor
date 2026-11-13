# FEAT-056 — Script-Enforced Document Hash Verification on orchestrate.mjs Approve

**Status:** Draft (pending independent review)

**Item:** FEAT-056 (intake of issue #184). **Date:** 2026-11-12.

## Problem

Step 3 of `.claude/commands/cc-orchestrate.md` ("The two define approvals") tells the orchestrator to show the owner the document and its sha256, then to "Re-hash before approve" and show the document again if the hash changed. That check lives only in the prompt. `scripts/orchestrate.mjs approve spec` takes no argument at all, and `approve plan <plan path>` reads the plan without knowing what the owner saw. The run file records only `{at, by}` for each approval (`scripts/orchestrate.mjs:400`). Nothing ties an approval to a document version.

So the owner cannot prove the approved document is the one they read. Three gaps follow:

1. A spec or plan edited between the owner's review and the `approve` call (by a late revision, a stray agent write, or a model skipping the re-hash) is approved anyway.
2. Nothing records which spec file was approved, or which bytes.
3. After approval, the Build band starts whatever the plan and spec say on disk at that moment. A text edit made after approval is invisible to the router. A `code` agent has the plan in its scope (`taskScope`, `scripts/orchestrate.mjs:157`) so it can tick boxes, which also means it can change the plan's text.

## Solution

`approve spec` and `approve plan` take the document path and the sha256 the owner was shown. The script hashes the document on disk itself and refuses the approval, writing nothing, when the two differ. For the plan, the hash is taken over the text with every task checkbox normalized to `[ ]`, so progress ticks never change it. A new read-only verb, `hash <spec|plan> <path>`, prints the exact hash `approve` will check, so the value the orchestrator shows is the script's own. Each approval in the run file records who approved, when, the path and the hash. Before every dispatch that follows `define_approved` (each `code` task, then `audit` and `qa`), `install` re-hashes both approved documents and halts the run when either one changed after approval. `cc-orchestrate.md` and its `project-template/` mirror are updated to show the script's hash and pass it to `approve`.

## Behavior

### The document hash

- **Spec:** sha256 of the file's raw bytes, lowercase hex. This is byte-for-byte what `sha256sum <doc>` / `shasum -a 256 <doc>` print, so an owner can check it with their own tool.
- **Plan:** sha256 of the file's UTF-8 text after one substitution: every task-list checkbox, meaning a line that matches `^(\s*(?:[-*+]|\d+[.)])\s+)\[[ xX>!]\](?=\s|$)`, has its bracket pair replaced with `[ ]`. Nothing else is normalized: line endings, whitespace and every other character still count.
  - The state set `[ ] [>] [X] [!]` is the one `.claude/commands/cc-implement.md` defines (line 53 onward); lowercase `[x]` is included because markdown renders it as checked too.
  - Only a checkbox at the start of a list item is normalized. A `[x]` in prose, a table cell or a code span is text, so changing it changes the hash.
- One exported pure function, `documentHash(kind, text)`, computes both, so `hash`, `approve` and the Build check share one definition.

### Main path

1. The spec role hands back. The review loop runs as today.
2. The orchestrator runs `node "$S/orchestrate.mjs" hash spec <spec path>`. It prints `<64 lowercase hex>  <spec path>`, exit 0. The orchestrator shows the owner that path and hash.
3. The owner approves. The orchestrator runs `node "$S/orchestrate.mjs" approve spec <spec path> <sha256>`.
4. The script checks that the next step awaits `spec` (as today), reads the spec, hashes it and compares the result with the argument, case-insensitively. On a match it writes `approvals.spec = { at, by, path, sha256 }` and prints `spec approved: sha256 <hash>`.
5. The same for the plan: `hash plan <plan path>`, then `approve plan <plan path> <sha256>`. On a match the script runs today's plan checks (`ORCH_EMPTY_SCOPE`, the scope caps), then writes `define_approved` with `approvals.plan = { at, by, path, sha256 }`, prints `plan approved: define_approved, <n> task(s); sha256 <hash>`.
6. `code` for Task 1 runs `install code --check` and `install code`. Before it builds the envelope, `install` re-hashes `approvals.spec.path` (raw) and `approvals.plan.path` (normalized) and compares each with the recorded `sha256`. Both match, so the envelope installs as today.
7. Each `code` agent ticks its plan boxes, `[ ]` → `[>]` → `[X]`. The normalized hash does not move, so every later `install code`, `install audit` and `install qa` passes the check.

`by` keeps today's source, `git config user.name` with fallback `unknown` (`scripts/orchestrate.mjs:400`). `at` is an ISO-8601 timestamp, as today.

### Alternative paths

- **The hash argument is upper-case.** PowerShell `Get-FileHash` prints upper-case hex. The comparison is case-insensitive; the recorded `sha256` is always lower-case.
- **A plan edited only in its checkboxes between `hash` and `approve`** (for instance a box pre-ticked by mistake) still approves: the normalized hash is unchanged by design.
- **`hash` outside a run.** `hash` reads no run file and writes nothing, so it works with or without a live run. It takes the same path rules as `approve`.
- **A run whose approvals predate FEAT-056** (a live run file whose `approvals.spec` or `approvals.plan` has no `sha256`/`path`, written by an older script). The Build check cannot verify it and halts `ORCH_APPROVAL_UNHASHED`; the recovery is `end`, then `start`, the same as `ORCH_DOC_LOCATION_UNRESOLVED` for runs started before FEAT-047.
- **The review loop revises the document after `hash` was shown.** The loop always runs before the approval step, and a revision changes the bytes, so the stale hash is refused at `approve` and the orchestrator shows the document again. This is the case the prompt check was meant to catch.

### Error cases

All refusals exit 2 and write nothing (the existing `Refusal` contract); all halts exit 1 and are recorded in the run file (the existing `Halt` contract). A refusal message that names a code starts with it, as `ORCH_REVIEW_CAP:` already does (`scripts/orchestrate.mjs:432`).

| Case | Result |
|---|---|
| `approve spec` or `approve plan` with the path or the hash missing, or the hash not 64 hex characters | Refusal: `usage: orchestrate.mjs approve <spec|plan> <path relative to the run root> <sha256>` |
| Path absolute or containing `..` (today's `readPlan` rule, now applied to both documents and to `hash`) | Refusal with the same usage line |
| Document unreadable | Refusal: `cannot read <path>` (as today) |
| Hash on disk differs from the argument | Refusal: `ORCH_DOC_HASH_STALE: <spec|plan> <path> hashes <disk hash>, not the <given hash> that was shown; show the document again`. Nothing is written; the run stays at `approve <spec|plan>` |
| An approved document changed after approval, found by `install` after `define_approved` | Halt `ORCH_APPROVED_DOC_CHANGED`: `<spec|plan> <path> was approved at sha256 <recorded> and now hashes <current>` |
| An approved document is unreadable at that check (deleted or moved) | Halt `ORCH_APPROVED_DOC_CHANGED`: `<spec|plan> <path> was approved at sha256 <recorded> and can no longer be read` |
| An approval without `sha256` or `path` at that check | Halt `ORCH_APPROVAL_UNHASHED`: `run <item> records an approval without a document hash (started before FEAT-056); run end, then start` |

**Why a refusal at `approve` but a halt at Build.** A stale hash at `approve` means the owner has not yet seen the current document, which the orchestrator can fix by showing it again: the run is still sound, so nothing is recorded and the run stays where it was. A changed document after approval means the run is about to execute text nobody approved. That is the definition of a halt here (D12: terminal in v1), and the owner decides the recovery.

**Why every install after `define_approved`, not only the first `code`.** The entry asks the Build band to refuse to start on changed text. A check only at Task 1 would miss an edit made by Task 1's own agent, which has the plan in its scope; the last task's edit would reach `audit` unchecked. Checking at every later install costs two file reads and closes both gaps with the same code.

**Why the spec path is now an argument.** The run file never recorded the spec's path (hand-backs record role, gate and time only, `scripts/orchestrate.mjs:326`), so the script has no other source for it. The orchestrator already knows it from the hand-back's `ops.f`. It is not checked against `docs.specs`; see Out of Scope.

## Acceptance Criteria

Each maps to one of the four acceptance criteria in the FEAT-056 backlog entry, or to a part of its description that those criteria depend on.

- [ ] **AC1 (entry: stale hash refused with a named error).** `approve spec <path> <hash>` and `approve plan <path> <hash>` with a hash that does not match the document exit 2 with a message starting `ORCH_DOC_HASH_STALE:`, and the run file is byte-identical afterwards. Tested for both kinds.
- [ ] **AC2 (entry: ticking keeps the plan approval valid).** A plan approved with its `hash plan` value, then edited only by turning checkboxes `[ ]` into `[>]`, `[X]`, `[x]` and `[!]`, passes the Build check: `install code` succeeds after the ticks. `documentHash('plan', …)` returns the same value for the ticked and unticked texts.
- [ ] **AC3 (entry: editing a plan line invalidates it).** A plan approved with its hash, then edited in one non-checkbox character of one line, makes the next `install` after `define_approved` exit 1 with `ORCH_APPROVED_DOC_CHANGED`, recorded in the run file's `halt`. Tested both at `approve` (the stale-hash refusal of AC1) and after approval.
- [ ] **AC4 (description: Build refuses a changed spec).** A spec edited after `approve spec` halts the next `install` after `define_approved` with `ORCH_APPROVED_DOC_CHANGED`.
- [ ] **AC5 (description: the run file records who, the hash and the time).** After both approvals, `approvals.spec` and `approvals.plan` each hold exactly the keys `at`, `by`, `path`, `sha256`, with `sha256` lower-case 64-hex even when the argument was upper-case.
- [ ] **AC6.** `hash spec <path>` prints the same hex as `sha256sum` of the file (checked in the test with `node:crypto` over the raw bytes); `hash plan <path>` prints the normalized hash; both exit 0 and write nothing, with or without a run file.
- [ ] **AC7.** A checkbox-like `[x]` that is not at the start of a list item (prose, table cell) changes the plan hash.
- [ ] **AC8.** A run file whose approvals lack `sha256` halts the first `install` after `define_approved` with `ORCH_APPROVAL_UNHASHED`.
- [ ] **AC9 (all cases tested).** The cases above are covered in `tests/scripts/orchestrate.test.js`, and the existing tests that call `approve spec` / `approve plan` pass the path and hash. `npm test` exits 0.
- [ ] **AC10 (command doc).** `.claude/commands/cc-orchestrate.md` step 3 shows the hash from `orchestrate.mjs hash`, passes it to `approve`, handles `ORCH_DOC_HASH_STALE` by showing the document again, and names `ORCH_APPROVED_DOC_CHANGED` and `ORCH_APPROVAL_UNHASHED` under "On any halt" with the recovery `end`, then `start`. `project-template/.claude/commands/cc-orchestrate.md` stays byte-identical, and `tests/installer/commands-parity.test.js` pins the new wording in place of the `shasum`/`Get-FileHash` strings it pins today.

## Out of Scope

- Checking that the approved spec or plan lies under the run's `docs.specs` / `docs.plans` folder. `approve plan` does not check this today either; tightening it is a separate change.
- Verifying the ticket snapshot hash for a bound run. `start` already records it; this item is about the two define documents.
- Any change to how `by` is resolved (still `git config user.name`), or any signature or identity proof beyond it.
- Normalizing anything in the plan other than list-item checkboxes (line endings, trailing whitespace, a BOM).
- Recovering a halted run in place. A halt stays terminal (D12).
- Guard 5, Guard 6 and the band envelopes: no change. The code role keeps the plan in its scope, because ticking boxes needs it; the Build check is what catches text edits.
- The review loop (FEAT-041): no change to its verbs or records.

## System Impact

- **`scripts/orchestrate.mjs`**
  - new exported `documentHash(kind, text)` and the checkbox pattern, using `node:crypto` (a builtin, so zero dependencies holds);
  - `readPlan` generalized to read either document under the same path rule;
  - `approve` (line 396): new argument shape, hash comparison, `path` and `sha256` in the approval record;
  - `install` (line 301): the post-approval document check before the envelope is built;
  - a new `hash` verb in `cli` (line 512) and in the usage line at line 525;
  - the `cli` dispatch for `approve` passes one more argument.
- **`.claude/commands/cc-orchestrate.md`** and **`project-template/.claude/commands/cc-orchestrate.md`** (byte-identical mirrors): step 3's "What you show" and "Re-hash before approve" bullets, the two `approve` command lines, the "On any halt" section, and the FMT row's mention of `approve plan`.
- **`tests/scripts/orchestrate.test.js`**: callers of `approve` at lines 72-73, 132-143 and any others updated; new cases for AC1-AC8.
- **`tests/installer/commands-parity.test.js`** (line 261-263): the pinned strings follow the new wording.
- **`.github/wiki/pages/Orchestrator-Guide.md`** (line 35) and **`.github/wiki/pages/C4-Components.md`** (line 139) describe approvals as `{at, by}` and list the verbs; they become false and are updated in the same change. These are not `.github/workflows/` or `.github/actions/`.
- **Run file compatibility:** `isValidRun` (line 83) only requires `approvals` to be a plain object, so run files written by either version still parse. A pre-FEAT-056 run reaching Build halts with `ORCH_APPROVAL_UNHASHED` (Alternative paths).
- **Guard 6 / `pre-tool-use.mjs`:** no change. The new `hash` verb only reads files, and the orchestrator's write surface is unchanged.
- **Records:** no change to `VERSION`, `package.json`, `CHANGELOG.md`, the backlog or `README.md` Known limits.

### Files Requiring Full Read (deferred to /cc-plan)

- `scripts/orchestrate.mjs`: 538 lines, read here only through its first 30 lines and targeted Grep. The plan needs `approve` (396-413), `install` (301-317), `readPlan` (192-197), `nextStep` (116-127) and `cli` (512-538) in full.
- `tests/scripts/orchestrate.test.js`: the plan needs every `approve` call site and the fixture helpers (`orch`, `say`, `task`, `runFile`) to write the new cases.

## Complexity Estimate

**M.** One script gains a pure hash function, a read-only verb and two checks, with tests and a mirrored command-doc edit; no hook, installer or settings surface changes, but the approve call shape changes for every existing test and for the command doc.
