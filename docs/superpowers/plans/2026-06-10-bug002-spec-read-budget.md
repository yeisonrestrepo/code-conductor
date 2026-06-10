# BUG-002 Spec Read Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Spec Read Budget block to `cc-spec.md` that caps source file reads at 30 lines during the spec phase and pre-renders a deferred-reads slot in the System Impact template section.

**Architecture:** Two localized text insertions to a single markdown command file. No code, no infrastructure, no new dependencies. The budget block is instruction-only enforcement — it constrains agent behavior via the prompt, not via hooks (FEAT-018 is out of scope).

**Tech Stack:** Markdown (plain text edit)

**Spec:** `docs/superpowers/specs/2026-06-09-bug002-spec-read-budget-design.md`

---

### Task 1: Insert the Spec Read Budget block into cc-spec.md

**Files:**
- Modify: `project-template/.claude/commands/cc-spec.md` (after the `---` separator that closes Phase 0, before the "Search the codebase..." line)

The file currently reads (lines 27–33):

```
`brainstorming` explores the problem space and surfaces unknowns. `critical-review` Phase 1 then runs the Pre-Flight Analysis (Happy Path / Failure Points / Boundary Conditions) on the proposed solution before the spec is written. Do not write the spec until both have completed.

---

Search the codebase for existing code related to `$ARGUMENTS` before asking any questions.

Run: `grep -r "$ARGUMENTS" src/ --include="*.{ts,js,py,java,go,rs}" -l 2>/dev/null | head -20`
```

- [ ] **Step 1: Insert the Read Budget block**

Open `project-template/.claude/commands/cc-spec.md`. Replace the `---` separator and blank line before "Search the codebase..." with the separator, then the full budget block, then a new separator. The exact old string to replace:

```
---

Search the codebase for existing code related to `$ARGUMENTS` before asking any questions.
```

Replace with:

```
---

## Spec Read Budget

Before reading any file:
1. Run Grep or Glob to locate relevant files. Skip this step only if the user's prompt names the exact file path.
2. Apply the correct read rule based on file type:

**Capped source files** - read the first 30 lines only (`offset` omitted, `limit: 30`). Starting at any offset other than the beginning is forbidden; if the first 30 lines are insufficient, defer the file. Multiple reads of the same file at any offset are forbidden.
Extensions: `.ts` `.tsx` `.js` `.jsx` `.mjs` `.cjs` `.py` `.go` `.rs` `.java` `.rb` `.cs` `.cpp` `.c` `.h` `.swift` `.kt` `.php` `.sh` `.html` `.css` `.scss` `.sass` `.less` `.svelte` `.vue`

**Exempt files** - may be read in full:
Named manifests/config: `package.json` `package-lock.json` `yarn.lock` `pnpm-lock.yaml` `bun.lockb` `go.mod` `go.sum` `Cargo.toml` `Cargo.lock` `pyproject.toml` `requirements.txt` `Pipfile` `Gemfile` `Gemfile.lock` `tsconfig.json` `tsconfig.*.json` `.gitignore` `.eslintrc.*` `.prettierrc.*` `.env.example` `.nvmrc` `.node-version` `.python-version` `.tool-versions`
Patterns: `*.yaml` `*.yml` `*.toml` `*.json` (config/manifest root files only - do not apply to data or generated JSON) `*.md` `CLAUDE.md` `Makefile` `Dockerfile` `Dockerfile.*` `*.dockerfile` `Jenkinsfile` `Procfile` `Brewfile`
Note: `.env`, `.env.local`, `.env.*` (real values) are **not exempt** - the agent should not read them during spec phase.

**Extensionless files** - exempt only when the exact name appears in the Named manifests/config list or Patterns above. All other extensionless files (including unknown dotfiles) default to capped.

**Default** - any file not matched by the above rules defaults to capped.

**Deferred reads** - if a capped source file cannot be understood from 30 lines, record it in `### Files Requiring Full Read (deferred to /cc-plan)` and move on. Do not slice-read it.

---

Search the codebase for existing code related to `$ARGUMENTS` before asking any questions.
```

- [ ] **Step 2: Verify the insertion — budget block present**

Run:
```bash
grep -n "Spec Read Budget" project-template/.claude/commands/cc-spec.md
```
Expected: one match on a line number that is less than the line containing `head -20`.

- [ ] **Step 3: Verify the insertion — budget block precedes the grep search line**

Run:
```bash
awk '/Spec Read Budget/{b=NR} /head -20/{g=NR} END{if(b && g && b<g) print "OK: budget before grep (lines " b " and " g ")"; else print "FAIL: order wrong or missing"}' project-template/.claude/commands/cc-spec.md
```
Expected output: `OK: budget before grep (lines X and Y)` where X < Y.

- [ ] **Step 4: Commit**

```bash
git add project-template/.claude/commands/cc-spec.md
git commit -m "feat(cc-spec): add Spec Read Budget block - 30-line cap on source files"
```

---

### Task 2: Add the deferred-reads subsection to the System Impact template in cc-spec.md

**Files:**
- Modify: `project-template/.claude/commands/cc-spec.md` (within the `## System Impact` template section near the bottom of the file)

The file currently contains this template section:

```
## System Impact
[What existing code will be affected or needs to be reviewed]
```

- [ ] **Step 1: Add the deferred-reads subsection**

Replace:

```
## System Impact
[What existing code will be affected or needs to be reviewed]
```

With:

```
## System Impact
[What existing code will be affected or needs to be reviewed]

### Files Requiring Full Read (deferred to /cc-plan)

_None. List any source files that could not be understood within the 30-line cap. /cc-plan will perform full reads of these files before task breakdown._
```

- [ ] **Step 2: Verify the deferred-reads subsection is present**

Run:
```bash
grep -n "Files Requiring Full Read" project-template/.claude/commands/cc-spec.md
```
Expected: one match inside the `## System Impact` template block.

- [ ] **Step 3: Verify the placeholder text is verbatim**

Run:
```bash
grep -c "cc-plan will perform full reads of these files before task breakdown" project-template/.claude/commands/cc-spec.md
```
Expected: `1`

- [ ] **Step 4: Run all four verification commands from the spec**

```bash
# 1
grep -n "Spec Read Budget" project-template/.claude/commands/cc-spec.md
# Expected: one match

# 2
awk '/Spec Read Budget/{b=NR} /head -20/{g=NR} END{if(b && g && b<g) print "OK: budget before grep (lines " b " and " g ")"; else print "FAIL: order wrong or missing"}' project-template/.claude/commands/cc-spec.md
# Expected: OK line, no FAIL

# 3
grep -n "Files Requiring Full Read" project-template/.claude/commands/cc-spec.md
# Expected: one match

# 4
grep -c "cc-plan will perform full reads of these files before task breakdown" project-template/.claude/commands/cc-spec.md
# Expected: 1
```

All four must pass with no `FAIL` output before closing the task.

- [ ] **Step 5: Commit**

```bash
git add project-template/.claude/commands/cc-spec.md
git commit -m "feat(cc-spec): add deferred-reads subsection to System Impact template"
```

---

### Task 3: Mark BUG-002 complete in the backlog

**Files:**
- Modify: `AGENT-READABLE BACKLOG.md`

- [ ] **Step 1: Verify the target string exists**

Run:
```bash
grep -c "### \[ \] \`\[BUG-002\]\`" "AGENT-READABLE BACKLOG.md"
```
Expected: `1`. If the result is `0`, the string is absent or already changed — do not proceed; investigate the file before continuing.

- [ ] **Step 2: Check the BUG-002 checkbox**

In `AGENT-READABLE BACKLOG.md`, change:

```
### [ ] `[BUG-002]` Lack of Context Pruning in Specification Phase
```

to:

```
### [X] `[BUG-002]` Lack of Context Pruning in Specification Phase
```

- [ ] **Step 3: Commit**

```bash
git add "AGENT-READABLE BACKLOG.md"
git commit -m "chore: mark BUG-002 complete in backlog"
```

---

## Identified Risks

- **Existing grep instruction line shift:** After Task 1 inserts ~25 lines, the absolute line numbers of everything below will shift. The awk anchor `head -20` (a literal string) is immune to line-number shifts — it matches by content, not position. No risk.
- **Markdown fence collision:** The Read Budget block contains backtick-quoted extension names but no fenced code blocks, so there is no risk of the inserted markdown breaking the surrounding fences in the plan or the command file.
- **Edit tool old_string uniqueness:** Both replacement targets (`---\n\nSearch the codebase...` and `## System Impact\n[What existing code...]`) must be unique in the file. Confirm with grep before editing if in doubt.
