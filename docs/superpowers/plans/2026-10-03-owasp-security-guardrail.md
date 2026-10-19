# OWASP Security Guardrail Plan (unminted candidate, issue #58)

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
   before proceeding.

4. **Gitignore** — add `!` negation entries for spec and plan files.

## Constraints

- Owner-side records stay out of this change: no backlog id, no CHANGELOG
  entry, no version bump. The owner writes them at intake and release.
- Zero new runtime dependencies.
- Prompt-based only (Phase 1). No code scanner yet.
- Language-agnostic.
