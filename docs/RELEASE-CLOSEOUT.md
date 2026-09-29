# Release closeout checklist

**Halt semantics come from the merge gate, not from this document.** `CONTRIBUTING.md` states the GitHub Actions CI gate is unconditional, and `tests/tools/repo-invariants.test.js` asserts the version and record invariants against the live repository on every push and pull request. So steps 3 and 4 below are **CI-backed**: skipping them does not let a divergence through, it only delays finding it.

Step 8 is **not** CI-backed, and the reason is named rather than left implicit: the ceiling's `origin/main` leg needs a ref `actions/checkout@v4` does not fetch at its default depth. `fetch-depth: 0` was declined, because the filing ritual's both-legs rule already protects it and a slower clone on every CI run buys nothing that rule does not give.

This document exists because the sentence "run it as a closeout step the ritual cannot skip" was written against a checklist that did not exist. A sentence binding an artifact into a document that is not there is unenforceable, and an unenforceable sentence claiming enforcement is the same class of defect `[BUG-044]` shipped to fix.

---

## The steps, in order

1. **Open the release pull request** from the item's branch.

2. **Move all five version locations in one commit**, together with the `CHANGELOG` entry, the backlog heading flip and its DONE bullet. See *Why the heading flip lives in the release commit*, below. The five locations are `VERSION`, `package.json` `version`, `package-lock.json` `version`, `package-lock.json` `packages[""].version`, and the `CHANGELOG.md` first heading. npm updates the third and fourth separately, which is why the gate reads both.

3. **Run the version gate.**

   ```bash
   node tools/version-gate.mjs
   ```

   Expect five `ok` lines and `VERSION_GATE_OK <version>` at rc 0. A `FAIL` names the location that did not move, and the fix is that location, never the gate. **CI-backed.**

4. **Run record parity.**

   ```bash
   node tools/record-parity.mjs
   ```

   Expect `RECORD_PARITY_OK` at rc 0. **CI-backed.**

5. **Merge on green.**

6. **Sync `main`, reporting the measurement before acting on it.**

   ```bash
   git switch main
   git fetch origin main
   echo "ahead: $(git rev-list --count origin/main..main)"
   echo "behind: $(git rev-list --count main..origin/main)"
   git merge --ff-only origin/main
   ```

   `0 ahead / 1 behind` is a clean squash sync. **A clean sync is a measurement, not an absence:** reporting the counts before fast-forwarding is what distinguishes "nothing stranded" from "nothing checked". Anything else is the stranding case and gets the rebase-and-skip ritual with upstream-superset evidence gathered first.

7. **Append the closeout record** to `.claude/memory/project.md`, **stating the instruments' output rather than asserting that the records agree.** The difference is the whole point: an assertion is a claim, an output is evidence.

8. **Run the ceiling before minting any id this closeout produces.**

   ```bash
   git fetch origin main --quiet
   node tools/id-ceiling.mjs
   ```

   Both legs must report. On a failed remote leg it prints `CEILING_ABORT` and **no ceiling**, and exits 2, because a number derived from half the evidence is worse than no number. **Not CI-backed**, for the reason given at the top.

9. **Push the record commit in the same action that creates it.** An owner-scoped record commit on `main` is never left local.

10. **Delete the item's branch, local and remote.**

    ```bash
    git branch -d "<branch>"
    git fetch --prune origin
    git ls-remote --heads origin
    ```

    `-d` refuses unless the branch is merged, which is the check, not the ceremony. Under a squash merge it reports "merged to its upstream but not to HEAD", and that is correct rather than alarming: the branch commits are not ancestors of the squashed commit, and step 6's `0 ahead` is the independent confirmation that nothing is stranded.

    **This repository deletes the remote branch automatically on merge**, so `git push origin --delete` fails with "remote ref does not exist" and is not the step. What is needed is `--prune`, because a stale remote-tracking ref survives locally and **reads exactly like a branch that was never cleaned up**. That misreading was made at the `1.32.2` closeout and reported to the owner as a leftover branch. `git ls-remote --heads origin` is the authority here; `git branch -a` is not, because it shows local tracking refs.

    **This step was missing until `1.33.0`**, and its absence was found the way `[BUG-046]` predicts such things are found: by an instruction citing "the checklist line" for a line that did not exist. The document `[BUG-046]` created reproduced `[BUG-046]`'s own defect one release later, which is the argument for instruments over documents restated against this file.

---

## Why the heading flip lives in the release commit

It used to happen here, at closeout, after the merge. That is how `[BUG-044]` shipped as `1.32.0` with its backlog heading still reading `[ ]` and no shipping record of any kind, for the whole of the following release, found by a state audit rather than by anything failing.

**The root cause was one line: the flip had no owner.** Plan tasks touch the backlog only when a task names it, and the closeout writes memory without ever reading the backlog.

With record parity asserted live, a release commit whose `CHANGELOG` claims an item while that item's heading still reads `[ ]` is **red on its own pull request**. So the release commit is now the owner, and the fix is structural rather than a reminder.

Scoping direction A to exempt the version being shipped was considered and rejected: `[BUG-044]`'s defect lived in a shipped version, so the exemption would excuse exactly the case this exists to catch.

---

## What a `CHANGELOG` entry must look like for step 4 to see it

Record parity uses a two-level discriminator, and an entry that misses either level is invisible to it:

- **Level one, the section.** The bullet must sit under `### Added`, `### Fixed`, `### Changed`, `### Removed`, `### Deprecated` or `### Security`. `### Filed` and `### Notes` are excluded by name, because a bullet under `### Filed` records a minted item rather than a shipped one.
- **Level two, the bullet.** The id marker must be the bullet's **first token**: `- **[BUG-046]** text`, not prose that mentions the id later.

A version whose entries miss level two has zero claims, and direction B then passes on nothing. **If a release's parity run is green and you are not sure it read anything, flip the heading to `[ ]` and confirm the run goes red naming that version and id, then flip it back.** That is the discriminator rule applied to the release's own record.
