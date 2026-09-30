# BUG-049: The Installer Replaced an Existing Project CLAUDE.md

**Status:** APPROVED 2026-09-30, with its six rulings each confirmed: (1) backups ignored plus a mandatory report; (2) block interior replaced on refresh; (3) duplicate headings accepted; (4) no scaffold append; (5) the `.gitignore` negation guard; (6) the measured three-entry set. **Target:** `1.34.4`, patch. **Branch:** `fix/bug-049-claude-md-clobber`. **Queue:** head until released, because it gates the company-internal sharing channel.

## Problem

On `1.34.3`, a `--project` install in a company repository (WSL, `~/projects/nymbl`) left the host's committed `CLAUDE.md` replaced by the shipped template in the working tree. From the owner's side it looked like "no merge, no skip, no backup". No data was lost, but only because the host happened to version the file, and the installer must never assume that.

### Measured, on the local tree (code identical to `1.34.3`), before any design

A behavioural probe ran `bin/code-conductor.mjs` in scratch repos with a fresh `HOME`:

| Host file | Host content lost | Backup | Installer output | Backup in `git status` |
|---|---|---|---|---|
| Arbitrary company `CLAUDE.md`, as LF, CRLF or BOM | none; template sections and the block are appended | 1, the exact pre-image | nothing | ignored (`!!`) |
| Company file using a managed heading (`## Hard Constraints`, `## Agent Identity`) | **those sections, silently** | 1 | nothing | ignored |
| Conductor-derived file without sentinels, with one host line under every heading (15 headings) | **8 of 15 host lines**: every line under the eight managed-block headings | 1, the exact pre-image | nothing | ignored |
| The same file with sentinels, host lines inside and outside the block | **the same 8 of 15** | 1, the exact pre-image | nothing | ignored |
| `--global`: a host-edited `~/.claude/CLAUDE.md` (12 headings) | **12 of 12** (`global/CLAUDE.md:3-94` puts every heading inside the block) | 1 | nothing | n/a |
| `.gitignore` with host lines | none | 1 | nothing | n/a |
| Two runs back to back, and with a 1.1 s pause, over the 15-heading file | run 2 writes nothing; the run-1 backup holds the exact original | 1 | nothing | ignored |

**The mechanism.** `lib/installer/merge-md.mjs` `mergeClaudeMdText` (`:81`) decides ownership **by heading name**. A sentinel-less host is "migrated": every host section whose normalized heading matches a managed-block heading is removed, and the block is appended. A sentinel host has its block interior replaced. Both paths are silent. The pre-image backup is written by `lib/installer/file-merge.mjs` `backupFile` (`:25`), but nothing reports it, and the shipped `project-template/gitignore:2` rule `*.installer-backup.*` hides it from `git status` and `git diff`. A host whose file grew from an earlier conductor install, as nymbl's did (the retired graphify hook and the stub hint both prove an earlier install), loses the content it wrote under those eight headings without a word.

**Defect class:** `[BUG-039]`'s class, host-owned data overwritten by deploy, reached here through heading-name ownership. `tests/installer/merge-md.test.js:84`, "migrates a sentinel-less host without producing duplicate headings", asserts the destructive behaviour as intended.

### Field fingerprint of the surviving backup (owner, 2026-09-30), and what history says about it

**The owner's reading of the nymbl backup's head:**
- 0 sentinels;
- header `# Project Claude Configuration` / `Extends global CLAUDE.md. Project-specific rules take precedence over global ones.`;
- label lines damaged with one systematic pattern: every Project Identity and Development Commands label is missing exactly two characters (`- me:`, `- scription:`, `- ack:`, `- nguage: en`, `Bld`, `Tt`, `Lt`, `Fmat`);
- lines carrying a spurious `* ` prefix, including `* ## Development Commands`.

**Generation census, by the M2 method plus the script-era history:**
- Every published tarball, 1.23.0 through 1.34.3, was packed and its `project-template/CLAUDE.md` described.
- So was every commit touching that file in git history (11 commits, 2026-05-01 to 2026-09-29).
- **The fingerprint matches one family and no single member.** Sentinel-less, with plain `- Name:` and `- Build: <command>` labels and 14 `## ` headings, it is the pre-sentinel template from `f75f5e0` (2026-06-11) through `2a3a811` (2026-07-04). That family holds four distinct texts: `f75f5e0`, `050dee1`, `46b26a5`, and `2a3a811`. The last is byte-identical to the template in all four npm tarballs 1.23.0–1.23.3 (sha1 `3d0ee6dfc962`).
- **Excluded:** earlier commits use `- **Name:**` or have no identity block, and every tarball from 1.24.1 on carries sentinels.
- Naming the exact member needs the full backup, compared on its undamaged lines.

**The mangling matches no historical fill logic, so its mechanism is unknown:**
- The only code that ever wrote these label lines is the script era's `_fill_claude_md` (`install.sh`, added in `cca270e`) and `Set-ClaudeMdFields` (`install.ps1`, `2dc2fef`), both removed in `4d987fa`.
- Both run the same node regex, `^(\s*-?\s*<Label>:)\s*(<[^>]*>)?\s*(\r?)$`, replaced by `$1 <value>$3`. Group 1 is re-emitted whole, so neither can remove label characters or add a `* ` prefix.
- No template in the census has a line starting `* `.
- **Recorded as a field observation with unknown mechanism, per the dossier discipline.** No cause is claimed.
- The consequence stands regardless: at least one circulating old version, or something that ran alongside one, left a host with corrupted output.

**The two-run shape, sealed by the fingerprint (candidate 2):**
1. An old pre-sentinel generation wrote its template over the company file. That was the pre-`[BUG-027]` force-copy era, and it kept no backup.
2. `1.34.3` then backed up that already-damaged file and removed the eight managed-name sections from it.

So the only backup holds conductor-era, damaged content, not the company's original. **No change to `1.34.4` can recover the first step.** What `1.34.4` can do is:
- never repeat either step;
- tell every host which minimum version is safe (AC13).

Locally, two consecutive runs of the current code were measured to keep the original's backup (AC9 keeps that as an invariant).

## Solution

The installer performs a **non-destructive structural merge and nothing semantic**:
- Conductor's content lives **only** between `<!-- cc:managed:start -->` and `<!-- cc:managed:end -->`, and **ownership is defined by those sentinels alone, never by heading names**.
- A sentinel-less file gets the block appended and nothing else.
- Every host byte outside the block is preserved.
- Every write is preceded by a backup whose path is printed.

The same rule applies to `~/.claude/CLAUDE.md` under `--global`.

`.gitignore` gets one labelled managed block holding the entries the installer manages today. Scattered earlier entries are gathered into it by exact-line match.

Semantic adoption of a pre-existing host file (reading it, proposing a mapping into conductor's structure, writing only on approval) is **not** the installer's job. It is filed as `[FEAT-040]` for `/cc-stack`, following `[FEAT-013]`'s rationale that `CLAUDE.md` generation belongs to the command, not to static templates.

**Multi-reader constraint.** The host file may be read by teammates who never installed conductor. Their content must stay readable and unmoved, and conductor's addition must be one clearly delimited block they can skip.

## Behavior

### Main path: `CLAUDE.md` (project and global, one function)

1. **No file, or an empty or whitespace-only file:** write the whole shipped template, scaffold sections plus the block. Take no backup. Print nothing, as today, so the Quickstart's silence claim holds.
2. **A file with exactly one balanced block:** replace the block's interior with the shipped interior. Every byte outside the sentinels is unchanged. If the file changes, back it up first and print the backup path.
3. **A file with no sentinels:** append the block at EOF, in the host's EOL. The separator is one blank line, plus a terminating newline first if the host lacks one. **Nothing else changes.** No heading is removed, no scaffold section is appended, nothing is reordered. The file changes, so back it up first and print the path.
4. **Any other sentinel count or order:** print the existing warning and write nothing, as today (`merge-md.test.js:95`).
5. **Re-run over any end state of 1–3:** byte-identical, no backup, no output.

### Main path: `.gitignore`

1. The managed block is a header line, `# Code Conductor (added by the installer; safe to keep)`, followed by the managed entries. The block **ends at the first blank line or EOF**.
2. **The managed entries are the set shipped today, measured from `project-template/gitignore`:**
   - `.claude/memory/turn-count.txt`
   - `*.installer-backup.*`
   - `*.installer-tmp.*`

   The owner's illustrative list (`/.claude/commands/cc-*`, `/.conductor`, …) is **not** what ships, and nothing is added here. It also wrote a bare `.installer-backup.`, whereas the shipped rule is the glob.
3. **No header present:** append a blank line, the header, and the entries, then back up and print the path, as for `CLAUDE.md`.
4. **Migration, gathering.** A line outside the block that **exactly** equals a managed entry (after trimming and stripping CR) is removed from its place and represented once inside the block. A host-modified variant is not an exact match (for example `.conductor/*.db`, or `.installer-backup.` without the globs), so it stays where it is and is never touched.
5. **Negation guard.** Moving a line in a `.gitignore` can change its meaning when a later `!` line re-includes a path. **If the host file contains any line starting with `!`, nothing is moved.** The block then carries only the managed entries not already present elsewhere, and the installer prints one line saying the existing entries were left in place.
6. **Re-run:** byte-identical, no backup, no output. Neither the block nor its entries are ever duplicated.

### The backup and visibility decision (made once, here)

**Recommended ruling: backups stay git-ignored, and a stdout report of every backup path becomes mandatory.** `*.installer-backup.*` stays in the managed set.

- **Why not visible.** A git-visible backup of a team's shared `CLAUDE.md` invites someone to commit it, and it appears as untracked noise in every teammate's `git status`.
- **Why the report is enough.** The person who ran the installer is the one who needs to know, and the report reaches exactly that person at the moment of the write.
- **The report line, one per backed-up file:**
  `code-conductor: backed up CLAUDE.md to CLAUDE.md.installer-backup.<UTC stamp> before merging (git-ignored by design)`

**If the owner rules the other way instead:** `*.installer-backup.*` leaves the managed set, the gathering step removes it from hosts' blocks, and the report stays anyway. Either way the report is mandatory, because after this fix a write can still refresh a block interior.

### Alternative paths

- **Host headings equal to managed headings, on a sentinel-less file:** they are kept verbatim, and the appended block contains headings with the same names. **Duplicate headings are the accepted consequence of sentinel-only ownership.** The host's copy is theirs, the block's copy is conductor's, and `[FEAT-040]` is where a human decides to reconcile them.
- **Host edits inside a balanced block:** replaced by the refresh, which is the documented contract ("Edits inside the block are lost"). They are recoverable from the reported backup. Content-match-then-replace, the `1.24.0` sweep precedent, was weighed and **rejected** here: it would freeze every host who ever touched the block at an old conductor version. Recommended as stated; the owner may overrule.
- **CRLF host:** everything the installer appends uses the host's EOL (`detectEol`, `merge-md.mjs:13`). **BOM host:** the BOM stays the first bytes.
- **Symlinked target:** merged through the link, link intact (existing `file-merge.test.js:79`).
- **Missing scaffold sections** (`## Project Identity`, `## Development Commands`, …) in an existing file are no longer appended by the installer. `/cc-stack` already appends `## Project Identity` and `## Active Stack Profiles` when they are absent (`global/commands/cc-stack.md:33,45`). Anything beyond that is `[FEAT-040]`.

### Error cases

- **The backup fails** (EACCES, ENOSPC, EEXIST race): the target is not written. The installer warns naming the file and the error, continues the rest of the install, and still exits 0, as the existing skip-with-warning paths do.
- **The write fails after a successful backup:** the backup exists, the target is unchanged (atomic temp+rename, `file-merge.mjs:37`), and a warning names both paths.
- **Dangling symlink, directory target, missing bundled template:** unchanged skip-with-warning behaviour.

## Acceptance Criteria

- [ ] **AC1, red case: heading collision.** The 15-heading fixture (the template without sentinels, one host line under every heading, plus `## Migration Skills`) is merged. The result equals `host + separator + block` exactly: every original host byte, the sentinel block, and nothing else changed. It fails today with 8 host lines lost.
- [ ] **AC2, red case: `--global`.** The 12-heading host-edited `~/.claude/CLAUDE.md` gets the same exact-equality assertion through `deployGlobal`. It fails today with 12 of 12 lost.
- [ ] **AC3.** A sentinel-less file with arbitrary content becomes `host + separator + block`, in LF, CRLF and BOM variants.
- [ ] **AC4.** For a balanced-block host, every byte outside the sentinels is identical before and after, and the interior equals the shipped interior.
- [ ] **AC5.** A fresh install (no file) produces the full template and no backup, and prints nothing (`deploy.test.js`'s fresh-scaffold silence assertion stays green). A host file byte-equal to a shipped template is a no-op: no backup, no output.
- [ ] **AC6.** Idempotence: a second run over every end state of AC1–AC5, and over every `.gitignore` case, is byte-identical, with no new backup and no output.
- [ ] **AC7, backup ordering, provable.** With the write step made to throw by fault injection, the backup exists and the target is byte-unchanged. With the backup step made to throw, the target is byte-unchanged and not written.
- [ ] **AC8.** Every run that backs a file up prints the exact report line naming that backup's path on stdout. A run that writes nothing prints no backup line.
- [ ] **AC9, the two-run invariant.** After any number of consecutive runs, some backup is byte-equal to the file as it stood before the first run.
- [ ] **AC9b, red case: the damaged-input row.** The fixture is a sentinel-less, template-shaped file with the field damage.
  - **Its head is field-verbatim**, supplied by the owner on 2026-09-30 from the nymbl backup with no redaction needed, since it contains no company text:

    ```
    # Project Claude Configuration
    Extends global CLAUDE.md. Project-specific rules take precedence over global ones.
    ## Project Identity

    * - me:
    * - scription:
    * - ack:
    * - nguage: en
    * ## Development Commands
    * - Bld: <command>
    * - Tt: <command>
    * - Lt: <command>
    * - Fmat: <command>
    ```

  - **Beyond that head it is a reconstruction:** the rest of the `2a3a811` / 1.23.x template.
  - The test labels the two parts: field-verbatim head, reconstruction beyond it.
  - It goes through the append-only path, and the result is `fixture + separator + block` exactly.
  - Every damaged byte is preserved: nothing is repaired, re-labelled or normalized.
  - **No semantic reclassification includes no repair.**
  - Today it loses the eight managed-name sections.
- [ ] **AC10, `.gitignore`.** The cases below all hold, and every host line survives in place:
  - (a) with no file: header plus the three entries;
  - (b) with host lines: host untouched, with the block appended after a blank line;
  - (c) with a scattered exact entry: gathered into the block, not duplicated;
  - (d) with a host-modified variant: untouched, and the block carries all three;
  - (e) with any `!` line: nothing moved, the block carries only the absent entries, and the notice line is printed;
  - (f) on the second run of each case: no change.
- [ ] **AC11.** `merge-md.test.js:84` is inverted rather than deleted: a sentinel-less host keeps its managed-name sections, and the block adds its own.
- [ ] **AC12.** The README section "How the installer treats your CLAUDE.md" is rewritten to the new contract:
  - sentinel-only ownership;
  - append-only on sentinel-less files;
  - backup reported;
  - the `.gitignore` block;
  - the migration note removed.

  The `[BUG-049]` Known-limits bullet leaves in the release commit, with the heading flip, and `repo-invariants` enforces the pairing.
- [ ] **AC13, minimum safe version.** The README Quickstart and install instructions state `1.34.4` as the minimum safe version. The pin is given as protection against both failure modes of older versions:
  - **no backup:** every release before `1.24`, which force-copied the template;
  - **destructive merge or corrupted output:** `1.24` through `1.34.3` remove host content under managed headings silently, and a pre-sentinel generation left a field host with damaged output.

  The npx form given is `npx @yeison.restrepo.r/code-conductor@latest --project`, with the `1.34.4` floor named beside it. A `repo-invariants` test pins that the stated floor is at most the current `VERSION`.
- [ ] **AC14, release.** Ships as `1.34.4`, with count predictions stated per environment in the plan. The plan's new installer tests add passing tests only; the skipped sets, and therefore `tools/skip-baseline.json`, do not change.

## Out of Scope

- **`[FEAT-040]`, semantic adoption of a pre-existing host `CLAUDE.md` by `/cc-stack`.** The model reads the file, proposes a mapping into conductor's structure, preserves what does not map, and writes only on explicit approval of the shown result. It is filed at spec approval after an `id-ceiling` run on both legs (expected id `FEAT-040`), and it queues behind `[ARCH-009]` unless the owner reorders.
- **Reconciling duplicate headings** created on sentinel-less hosts, which belongs to `[FEAT-040]`.
- **Changing the managed `.gitignore` entry set** beyond grouping it.
- **Restoring any field host, or repairing damage an older version left.** The nymbl file was restored by the owner with `git restore`. Damaged input is preserved as-is (AC9b), never repaired.
- **Finding the mechanism of the field mangling.** It is recorded as unknown. A probe is owed only if it recurs against a current version.
- **The `[BUG-039]` stub-match hint.** It is a known, accepted residual.
- **`settings.json`,** which has its own merge (`settings-merge.mjs`) that the probe did not implicate.

## System Impact

- **`lib/installer/merge-md.mjs`.** `mergeClaudeMdText` (`:81`) drops heading-name ownership and the missing-section append for existing files, and keeps sentinel parsing, EOL and fence handling. `appendMissingLinesText` (`:148`) is replaced for `.gitignore` by the labelled-block merge.
- **`lib/installer/file-merge.mjs`.** `mergeFileInto` (`:47`) gains the backup report and the provable ordering. `backupFile` (`:25`) and `writeAtomic` (`:37`) are reused.
- **`lib/installer/deploy.mjs`.** The `MERGED_ROOT_FILES` table (`:15`) feeds `deployProject` (`:152`) and `deployGlobal` (`:95`). The report must reach stdout through the existing `warn`/`emit` path.
- **Tests:**
  - `tests/installer/merge-md.test.js`: `:84` inverted, `:49` and `:162` revisited, because "appends only missing sections" no longer applies to existing files;
  - `tests/installer/file-merge.test.js`;
  - `tests/installer/deploy.test.js`.
- **`README.md`:** the contract section and Known limits.
- **`project-template/gitignore`:** gains the header line.

### Files Requiring Full Read (deferred to /cc-plan)

- `lib/installer/merge-md.mjs` (168 lines)
- `lib/installer/deploy.mjs` (205 lines)
- `lib/installer/file-merge.mjs` (87 lines)

## Complexity Estimate

**M.** Three installer modules and three test files change. The behaviour is already fully characterized by the probe matrix above, and the risk sits in re-deriving tests that asserted the old destructive semantics.
