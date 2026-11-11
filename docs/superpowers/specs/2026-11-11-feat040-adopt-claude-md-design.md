# Spec: semantic adoption of a host CLAUDE.md by /cc-stack (FEAT-040, issue #145)

**Status:** Implemented on PR #152, awaiting owner approval

## Problem

`[BUG-049]` made the installer append the managed block to a sentinel-less host `CLAUDE.md` and touch nothing else. A team with its own file therefore gets its sections beside the block, with duplicate headings the installer deliberately does not reconcile. FEAT-040 is the judgment half: `/cc-stack` offers to fold the host's sections into conductor's structure, with the owner approving the exact result.

## Decision: approach C

Three approaches were prototyped (POC branch `poc/feat-040`):

- **A, the model writes the file.** Rejected: it can rewrite or drop bytes, and nothing proves the shown text is the written text.
- **B, a helper the model drives edit by edit.** Rejected: the owner approves a plan, not a result.
- **C, chosen: the script renders, the model only classifies.** `scripts/adopt-claude-md.mjs` splits the file into sections (fence-aware, via `scanLines`), the model assigns each a slot (`identity`, `commands`, `architecture`, `conventions`, `out-of-scope`, `keep`), and the script renders the whole file deterministically. `apply` writes only when handed the sha256 of the exact render that was shown, so approval of what was seen is enforced by the token, not by trust.

## Rules

- **Trigger.** The flow runs only when the file has content that is not conductor's scaffold. Scaffold-only never triggers. Scaffold is: the template's headings and lines (parity-tested against `project-template/CLAUDE.md`), filled `- Field:` lines, and, under `## Active Stack Profiles`, `### ` subsections and `- ` bullets (what `/cc-stack` step 5b generates; prose is disallowed there). Any other line under `## Active Stack Profiles` is host prose and triggers. A host bullet written there cannot be told from a generated one; accepted.
- **Refusals.** Unbalanced sentinels or an unclosed fence refuse with no write.
- **Block.** Copied verbatim; the adoption only moves host sections.
- **Slot ordering.** A section mapped to a slot moves above the managed block, in slot order (scaffold order), ties in file order. `keep` and unmapped sections stay where they are, byte for byte. A heading-less preamble never moves, and a slot for it is an error.
- **Safety.** Backup first, never overwriting an earlier one (exclusive create, numeric suffix), path printed; a failed backup aborts. An independent check confirms the block is unchanged and the host sections survive as the same multiset before writing.
- **Declining** is a no-op.
- **Re-offer.** Adopting is not recorded anywhere, so the offer repeats on every `/cc-stack` run for any file that still has non-scaffold content, including one already adopted. Only a scaffold-only file is excluded. This is intended: the owner can decline, or map everything to `keep`, and nothing changes.

## Deployment

The script imports `../lib/installer/merge-md.mjs`. The installer copies that one file to `.claude/lib/installer/` so the deployed script runs; a deploy test pins it.

## Acceptance criteria

1. No write without explicit approval of the exact shown result.
2. Unmapped content is preserved byte for byte.
3. The managed block is never rewritten.
4. A backup precedes the write and its path is reported.
5. Declining is a no-op.
6. Scaffold-only never triggers.
