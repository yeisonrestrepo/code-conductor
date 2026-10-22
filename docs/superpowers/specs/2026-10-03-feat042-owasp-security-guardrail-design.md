# FEAT-042: Post-Implement OWASP Guardrail (cc-implement Step 4.5)

Status: DRAFT for owner approval. Answers the `[FEAT-042]` entry minted in
`e0c80df` (intake of issue #58). Round-2 review on PR #59 applied: the
unfixable-finding path is a named halt, and the escalation is folded into
`[SECURITY]`.

## Problem

code-conductor governs what an agent CAN do (Guard 3 blocks dangerous
commands) but not what it WRITES. Generated code can introduce SQL
injection, XSS, command injection, hardcoded secrets, and other OWASP
Top 10 vulnerabilities without any automated check.

## Solution

Add an automatic OWASP Top 10 scan as Step 4.5 in `cc-implement`,
between Step 4 (Execute) and Step 5 (Post-flip). The agent reviews its
own diff for ten vulnerability categories before marking a task complete.

Phase 1 is prompt-based: zero code, zero dependencies. A table in
`cc-implement.md` lists each OWASP category with concrete patterns to
flag. The agent scans only the diff (added/modified lines), not full
files.

## Behavior

- **Trigger:** activates only when Step 4 wrote code files (`.js`,
  `.ts`, `.mjs`, `.py`, `.java`, `.go`, etc.). Skipped for markdown,
  config, and documentation changes.
- **Finding:** emits `[SECURITY] file:line — A0X: description`. The agent
  fixes it, re-scans the fixed lines, and proceeds to Step 5 only on a
  clean re-scan.
- **Unfixable:** the task takes the existing Step 5 failure path
  (`[>]` → `[!]`), Step 6 records the state, and the loop halts with
  `SECURITY_FINDING_UNRESOLVED`, re-emitting each open `[SECURITY]` line.
  The halt is the escalation: the loop stays stopped until the developer
  resolves the finding and resets the task to `[ ]`.
- **Clean:** silent, no output (VERBOSITY:MIN compliant).

## Design choices the entry leaves open

- **Halt state is `[!]`, not a dangling `[>]`.** Reusing the failure path
  means the plan file and the local cache both record the stop, and any
  task that depends on this one halts with `DEPENDENCY_FAILED` instead of
  running on top of unreviewed code. A dangling `[>]` would be skipped by
  the Step 1 scan and never resurface.
- **One tag, not two.** The named halt carries the escalation, so a second
  `[SECURITY-REVIEW]` tag would add a tag-table row with no behavior of
  its own. Unresolved findings reuse `[SECURITY]`.
- **Halt token follows the file's convention.** `SCREAMING_SNAKE`, listed
  in the Error Reference table beside `DEPENDENCY_FAILED` and
  `SCAN_LIMIT_EXCEEDED`.

## OWASP Categories Covered

| ID  | Category                    |
|-----|-----------------------------|
| A01 | Broken Access Control       |
| A02 | Cryptographic Failures      |
| A03 | Injection                   |
| A04 | Insecure Design             |
| A05 | Security Misconfiguration   |
| A06 | Vulnerable Components (deferred) |
| A07 | Auth Failures               |
| A08 | Data Integrity              |
| A09 | Logging Failures            |
| A10 | SSRF                        |

## Acceptance criteria (from the `[FEAT-042]` entry)

- The scan covers changed lines only and code files only (never markdown,
  config or docs).
- Silent on clean code; `[SECURITY]` is never suppressed, format
  `file:line` + OWASP category.
- An unresolved finding blocks the task loop with the named halt
  `SECURITY_FINDING_UNRESOLVED` and escalates to human review.
- Zero new dependencies; the records stay owner-side.

## Constraints

- Zero new runtime dependencies (`dependencies: {}` holds).
- Language-agnostic (prompt-based, no regex in Phase 1).
- Silent on clean code.
- `[SECURITY]` tags are never suppressed, even in MIN verbosity.

## Future (Phase 2)

A deterministic regex scanner in `tools/` as a hardening layer for
the most critical categories (A02 secrets, A03 injection). Separate
follow-up, not this item.
