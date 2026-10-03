# FEAT-042 — OWASP Security Guardrail Plan

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

4. **Version bump** — bump all 5 version locations to 1.39.0 (minor,
   feature).

5. **Changelog** — add `## [1.39.0]` entry in `CHANGELOG.md`.

6. **Backlog** — add `[FEAT-042]` heading and flip to `[X]` with DONE
   bullet.

7. **Gitignore** — add `!` negation entries for spec and plan files.

## Constraints

- Zero new runtime dependencies.
- Prompt-based only (Phase 1). No code scanner yet.
- Language-agnostic.
