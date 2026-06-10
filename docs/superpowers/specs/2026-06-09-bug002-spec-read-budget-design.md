# BUG-002: Spec Phase Read Budget

**Status:** Approved
**Backlog ref:** BUG-002 - Lack of Context Pruning in Specification Phase

---

## Problem

During `/cc-spec`, the agent reads full source files to gather context even when it has no intent to modify them yet. A single analysis pass on a medium-sized codebase can inject thousands of tokens of implementation detail into the prompt before a single requirement has been written. This saturates the context window early and leaves less room for the actual spec work, plan, and implementation phases that follow.

---

## Solution

Add a **Spec Read Budget** block to `cc-spec.md` that constrains all file reads during the specification phase. Source files are capped at 30 lines (enough to see exports and function signatures). Config and manifest files are exempt and may be read in full. Any source file that genuinely requires a full read to understand is recorded in the spec's `## System Impact` section under a dedicated deferred-reads subsection instead of being read immediately. The spec template itself is updated to pre-render that subsection so the agent always has a named slot to fill in.

**Capped source extensions** (30-line limit applies):
`.ts` `.tsx` `.js` `.jsx` `.mjs` `.cjs` `.py` `.go` `.rs` `.java` `.rb` `.cs` `.cpp` `.c` `.h` `.swift` `.kt` `.php` `.sh`

**Exempt files** (may be read in full):
`package.json` `package-lock.json` `yarn.lock` `pnpm-lock.yaml` `bun.lockb` `go.mod` `go.sum` `Cargo.toml` `Cargo.lock` `pyproject.toml` `requirements.txt` `Pipfile` `Gemfile` `Gemfile.lock` `tsconfig.json` `tsconfig.*.json` `*.yaml` `*.yml` `*.toml` `*.json` (config/manifest root files only) `CLAUDE.md` `*.md` `.env.example` `.gitignore` `.eslintrc.*` `.prettierrc.*` `Makefile`

Ambiguous files (not in either list) default to capped.

---

## Behavior

### Main path

1. Agent enters `/cc-spec` and processes the Destructive Read Invariant.
2. Agent reads the Spec Read Budget rules before touching any file.
3. Agent runs Grep or Glob to discover relevant files — no Read calls yet.
4. Agent reads config/manifest files (e.g., `package.json`, `CLAUDE.md`) in full as needed.
5. For source files, agent reads at most 30 lines per file using `limit: 30`.
6. If a source file cannot be understood from 30 lines, agent records it in `### Files Requiring Full Read (deferred to /cc-plan)` and moves on.
7. Agent writes the spec; the `## System Impact` section includes the deferred-reads list.
8. `/cc-plan` reads the approved spec (standard behavior) and finds the deferred list already populated — no change to cc-plan.md required.

### Alternative paths

- **No source files needed** — spec is purely about new behavior or config; the Read Budget block is a no-op, nothing changes.
- **All relevant files are manifests/config** — all reads are exempt; agent proceeds without any cap applied.
- **Many files deferred** — deferred list grows long; this is expected and signals a complex feature. `/cc-plan` handles it.

### Error cases

- **Agent reads a source file without a prior Grep/Glob** — the Read Budget instruction explicitly blocks this. If the agent violates it mid-session (context drift), the next turn's reinforcement from the skill block corrects behavior.
- **Agent cannot determine file type** — default to applying the cap. The exempt list is explicit; ambiguous files are capped.

---

## Acceptance Criteria

- [ ] `cc-spec.md` contains a "Spec Read Budget" block that mandates Grep/Glob before any Read call
- [ ] The budget block lists the 30-line cap and names the source file extensions it applies to
- [ ] The budget block lists the exempt file types (config, manifest, docs) that may be read in full
- [ ] The budget block defines the deferred-read fallback: record in System Impact instead of reading
- [ ] The `## System Impact` section of the spec template includes a `### Files Requiring Full Read (deferred to /cc-plan)` subsection with a placeholder
- [ ] The deferred subsection placeholder makes clear that `/cc-plan` is responsible for consuming those reads

---

## Out of Scope

- Mechanical enforcement via hooks (belongs to FEAT-018)
- Edits to `cc-plan.md`, `cc-implement.md`, or `cc-review.md` — the deferred list is consumed by the agent when it reads the approved spec, which is already part of `/cc-plan`'s normal entry; no command file changes needed
- Token counting or budget tracking tooling
- Any changes to how non-spec phases read files

---

## System Impact

One file changes: `project-template/.claude/commands/cc-spec.md`

- Insert Spec Read Budget block between Phase 0 (skill activation) and the existing grep search instruction
- Update the `## System Impact` spec template section to add the deferred-reads subsection

### Files Requiring Full Read (deferred to /cc-plan)

None — this change is confined to a single markdown command file.

---

## Complexity Estimate

**S** — Two localized edits to one markdown file; no code, no infrastructure, no new dependencies.
