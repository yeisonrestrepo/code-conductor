# FEAT-042 — OWASP Security Guardrail Design

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
- **Finding:** emits `[SECURITY] file:line — A0X: description`. Agent
  must fix before proceeding to Step 5.
- **Unfixable:** emits `[SECURITY-REVIEW]` for human decision and
  proceeds.
- **Clean:** silent, no output (VERBOSITY:MIN compliant).

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

## Constraints

- Zero new runtime dependencies (`dependencies: {}` holds).
- Language-agnostic (prompt-based, no regex in Phase 1).
- Silent on clean code.
- `[SECURITY]` tags are never suppressed, even in MIN verbosity.

## Future (Phase 2)

A deterministic regex scanner in `tools/` as a hardening layer for
the most critical categories (A02 secrets, A03 injection).
