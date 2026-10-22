# FEAT-042 Post-Implement OWASP Guardrail Plan

Spec: `docs/superpowers/specs/2026-10-03-feat042-owasp-security-guardrail-design.md`.

## Scope

Add an automatic OWASP Top 10 scan step (Step 4.5) in
`.claude/commands/cc-implement.md` and its project-template mirror.

## Steps

1. **Add Step 4.5 to cc-implement.md** — insert an OWASP security scan
   section between Step 4 (Execute) and Step 5 (Post-flip). Include a
   table of all ten OWASP categories with concrete detection patterns.

2. **Mirror to project-template** — replicate the same change in
   `project-template/.claude/commands/cc-implement.md` so new projects
   receive the guardrail.

3. **Define behavior** — findings emit `[SECURITY]` tags that are never
   suppressed. Clean scans produce no output. Agent must fix findings
   and re-scan before proceeding.

4. **Named halt** — an unfixable finding takes the Step 5 failure path
   (`[>]` → `[!]`), runs Step 6, then halts with
   `SECURITY_FINDING_UNRESOLVED`. Add the row to the Error Reference table
   in both mirrors.

5. **Tag tables** — add the `[SECURITY]` row, including the halt, to both
   CLAUDE.md templates. No separate escalation tag.

6. **Gitignore** — add `!` negation entries for spec and plan files.

## Verification

- `npx vitest run` passes with no new failures against `main`.
- Both `cc-implement.md` mirrors carry identical Step 4.5 and Error
  Reference patches.

## Constraints

- Owner-side records stay out of this change: no CHANGELOG entry, no
  backlog flip, no version bump. The owner writes them at release.
- Zero new runtime dependencies.
- Prompt-based only (Phase 1). No code scanner yet.
- Language-agnostic.
