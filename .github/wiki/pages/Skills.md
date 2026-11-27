# Skills

Skills extend agent behavior for cross-cutting concerns. They apply regardless of stack or project type.

## Always Active

### code-simplifier

Applied to every piece of code written or reviewed.

| Rule | Description |
|------|-------------|
| No speculative abstractions | Solve today's problem only |
| Functions max 30 lines | One thing per function |
| Flat over nested | Guard clauses and early returns |
| Descriptive names | No `Base`, `Abstract`, `Manager`, `Handler` |
| Comments explain why | Never what |

### critical-review

A 4-phase adversarial protocol during implementation:

1. **Pre-Flight** — Identify happy path, failure points, boundary conditions
2. **Adversarial Review** — RESILIENCE (silent failures), EFFICIENCY (code smells), FRICTION (happy-path friction)
3. **Self-Correction** — Each weakness refactored and re-verified in isolation
4. **`[VALIDATION]`** — Edge cases covered, justification, residual risks

### verbosity

Controls response length per turn. Set at install with `--verbosity`, stored in `~/.claude/memory/verbosity.md`. Re-injected every turn by the `verbosity-remind` hook so it never drifts.

| Level | Behavior |
|---|---|
| `MIN` (default) | One sentence. `[CHANGES]` tag with file list. |
| `INFO` | Up to 5 bullets. `[CHANGES]` + `[REASON]`. |
| `VERBOSE` | Full explanation, prose allowed. All tags. |

### memory-first

Before reading any file, walk this chain and stop at the first hit:

1. **Memory** — `project.md` + `personal.md`
2. **Grep / Glob** — pattern search
3. **Targeted read** — last resort, always `offset` + `limit`, max 150 lines

### agent-delegation

Keeps the main context clean:

- Sub-agents handle exploration and parallel work
- Return summaries of max 200 words
- Raw file contents never enter the main context

## Frontend design skills

Three third-party skills for frontend UI/UX work, offered by `code-conductor --project` when the stack detector classifies the project as `frontend` or `fullstack`:

| Skill | Source | Pin |
|-------|--------|-----|
| `impeccable` | `npx impeccable@4.11.1 install`, with its design hook | the exact npm version |
| `emil-design-eng` | `emilkowalski/skill` through `npx skills@1.9.0 add` | commit `64eb3deb9a5fbfa041faf783e0bc3fd635872e9c`, in `skills-lock.json` |
| `design-taste-frontend` | `Leonxlnx/taste-skill` through `npx skills@1.9.0 add` | commit `952435f63acece7d2fcb4b4d3c1786c1c43603e0`, in `skills-lock.json` |

An interactive run asks first, and the default is Yes. A non-interactive run installs them only with `--with-frontend-skills`. `--with-plugins` does not imply it.

They are third-party code and run with the agent's permissions. Impeccable's hook runs on the agent's edits even when you deny the model's own commands, and can download Impeccable's engine binary (checksum-verified) on first use. The Impeccable skill fetches visual directions from `impeccable.style` when a new design starts, and its content is signed by the vendor and not pinned to a commit, so the installer records the sha256 of each installed file.

The outcome, the pins and those digests are written to `.claude/frontend-skills.json`. If an install cannot run, the installer prints the manual command and still succeeds.

## Retired

### ui-ux-pro-max

Replaced by the frontend design skills above. A copy left by the retired shell installers is removed only when its content matches the `uipro-cli` 2.2.3 output exactly; any other copy stays in place and is named in the install report.

## Skill Files

Each skill lives in `skills/<name>/SKILL.md` with its full ruleset and activation conditions.

<!-- wiki-gen:skills-index -->
