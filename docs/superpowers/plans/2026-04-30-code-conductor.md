# code-conductor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate all 39 files of the code-conductor repository in the working directory, then initialize git and make the initial commit.

**Architecture:** Pure content generation — configuration files, Markdown documents, shell scripts, and PowerShell scripts. No runtime code. Files are created in the exact order specified, grouped into logical commits.

**Tech Stack:** Markdown (Claude Code command format), JSON (Claude Code settings), Bash, PowerShell

---

## File Map

```
.gitignore
global/
  CLAUDE.md
  settings.json
  commands/
    checkpoint.md
    stack.md
    lang.md
  memory/
    personal.md
skills/
  code-simplifier.md
  ui-ux.md
stack-profiles/
  _base.md
  _multi-stack.md
  _template.md
  javascript.md
  typescript.md
  python.md
  java.md
  go.md
  rust.md
  react.md
  angular.md
  nextjs.md
  nestjs.md
  django.md
  flask.md
project-template/
  CLAUDE.md
  .claude/
    settings.json
    commands/
      spec.md
      plan.md
      review.md
      debug.md
      refactor.md
      test.md
      docs.md
    hooks/
      pre-tool-use.sh
      post-compact.sh
    memory/
      project.md
install.sh
install.ps1
README.md
```

---

## Task 1: Repository Root

**Files:**
- Create: `.gitignore`

- [ ] **Step 1: Create .gitignore**

```
.claude/memory/personal.md
*.local
.DS_Store
Thumbs.db
```

- [ ] **Step 2: Verify file exists**

```bash
ls .gitignore
```
Expected: `.gitignore`

- [ ] **Step 3: Commit**

```bash
git init
git add .gitignore
git commit -m "chore: add .gitignore"
```

---

## Task 2: Global CLAUDE.md

**Files:**
- Create: `global/CLAUDE.md`

- [ ] **Step 1: Create global/CLAUDE.md**

```markdown
# Global Claude Configuration

Applies to every project on this machine. Project CLAUDE.md adds project-specific overrides on top.

## Workflow

Always follow this sequence. No exceptions.

1. `/spec` — define the problem and wait for approval
2. `/plan` — map the implementation and wait for approval
3. Implement — one step at a time, confirm between steps unless told otherwise

Never write code without an approved spec. Never start implementing without an approved plan.

## Token Efficiency

- grep/find before read — never open a file without searching first
- Never read a full file over 150 lines — use line offsets and limits
- One tool call, one purpose — no exploratory reads during implementation

## Safety

- Check file exists before creating — use the pre-tool-use hook
- Confirm before any write or destructive shell command
- Never hardcode secrets, tokens, passwords, or API keys
- Never run `rm -rf` without explicit user confirmation

## Simplicity

The code-simplifier skill is always active. Apply its rules to every change:

- No speculative abstractions — solve today's problem only
- Functions do one thing, max 30 lines
- Flat over nested — guard clauses and early returns
- Descriptive names — no Base/Abstract/Generic/Manager/Handler
- Comments explain why, never what

## Language

- Default: English (responses + code comments + identifiers)
- Switch: `/lang [code]` changes response language for the session
- Code identifiers, file names, and commit messages are always English
- Supported codes: en es pt fr de it zh ja ko

## Stack Detection

Auto-run `/stack` at the start of every session. Confirm before loading any stack profile. If the stack is already in project.md memory, load from there and ask if anything changed.

## Memory

- `project.md` — in git, shared with the team. Decisions, conventions, debt, workarounds.
- `personal.md` — local only, never committed. Developer preferences, personal shortcuts.
- Run `/checkpoint` before `/compact`, after feature completion, after key architectural decisions.

## Delegation

- Use Superpowers for isolated, parallelizable sub-tasks
- Use Playwright MCP for visual debugging and E2E tests
- Always confirm scope before spawning sub-agents

## Response Format

Always tag responses:

- `[CHANGES]` — list of files changed and what changed
- `[BUG]` — bug report with file:line reference
- `[PLAN]` — ordered implementation steps
- `[REASON]` — explanation of a decision or approach

## Active Skills

- `code-simplifier` — always active, loaded automatically
- `ui-ux` — activate via `/stack` when frontend frameworks are detected
```

- [ ] **Step 2: Verify**

```bash
ls global/CLAUDE.md
```

- [ ] **Step 3: Commit**

```bash
git add global/CLAUDE.md
git commit -m "feat: add global CLAUDE.md with mandatory agent behaviors"
```

---

## Task 3: Global Settings + Commands + Memory

**Files:**
- Create: `global/settings.json`
- Create: `global/commands/checkpoint.md`
- Create: `global/commands/stack.md`
- Create: `global/commands/lang.md`
- Create: `global/memory/personal.md`

- [ ] **Step 1: Create global/settings.json**

```json
{
  "permissions": {
    "allow": [
      "Bash(grep:*)",
      "Bash(find:*)",
      "Bash(ls:*)",
      "Bash(cat:*)"
    ],
    "deny": []
  }
}
```

- [ ] **Step 2: Create global/commands/checkpoint.md**

```markdown
Read the conversation history from the current session.

Identify and extract:
1. **Decisions made** — architectural choices, approach selections, rejected alternatives
2. **Conventions established** — naming patterns, file organization, code style choices
3. **Technical debt** — shortcuts taken, known limitations, deferred work
4. **Workarounds** — non-obvious solutions and why they were needed

**Update `.claude/memory/project.md`** (append only, never delete):
- Add a timestamped section: `## Checkpoint [YYYY-MM-DD HH:MM]`
- List decisions, conventions, and debt from this session

**Update `.claude/memory/personal.md`** (local only):
- Add any developer preferences observed this session

**Report:**
- Timestamp of this checkpoint
- What was saved to project.md (2–3 bullets)
- What was saved to personal.md (1–2 bullets)

Suggest running `/checkpoint` automatically: before `/compact`, after completing a feature, after any key architectural decision.
```

- [ ] **Step 3: Create global/commands/stack.md**

```markdown
Detect the project stack by scanning for manifest files in the current directory:

- `package.json` → Node.js/JavaScript/TypeScript
- `pom.xml` or `build.gradle` → Java
- `go.mod` → Go
- `requirements.txt` or `pyproject.toml` → Python
- `Cargo.toml` → Rust
- `*.csproj` → C#/.NET
- `composer.json` → PHP
- `Gemfile` → Ruby
- `pubspec.yaml` → Dart/Flutter

**Infer framework from dependency contents**, not just file existence:
- `package.json`: check for react, next, angular, vue, nest, express, etc.
- `requirements.txt` / `pyproject.toml`: check for django, flask, fastapi
- `pom.xml`: check for spring-boot, quarkus

**If stack is already in `.claude/memory/project.md`:**
Load from there. Ask: "I see you're using [stack]. Has anything changed?"

**If multiple languages detected:**
Load `_multi-stack.md` as coordinator first, then each language/framework profile.

**Before loading any profile:**
List detected stack(s) and confirm: "I'll load the [profile] profile. Proceed?"

**Available profiles:** javascript, typescript, python, java, go, rust, react, angular, nextjs, nestjs, django, flask
```

- [ ] **Step 4: Create global/commands/lang.md**

```markdown
Switch the response language for this session.

**With argument** (`/lang es`, `/lang pt`, etc.):
- Switch immediately to the requested language
- Confirm in the new language (e.g., "Idioma cambiado a Español. ¿En qué puedo ayudarte?")
- Scope: responses and code comments only
- Never change: identifiers, file names, commit messages, branch names

**Without argument** (`/lang`):
Show current setting and list available codes:

| Code | Language    |
|------|-------------|
| en   | English     |
| es   | Spanish     |
| pt   | Portuguese  |
| fr   | French      |
| de   | German      |
| it   | Italian     |
| zh   | Chinese     |
| ja   | Japanese    |
| ko   | Korean      |

**Priority hierarchy:**
1. Session setting (this command) — highest
2. Project CLAUDE.md `language:` setting
3. `personal.md` `response_language:` value
4. Default: English
```

- [ ] **Step 5: Create global/memory/personal.md**

```markdown
# Personal Preferences

> Local only. Never commit this file. Updated automatically by /checkpoint.

## Language
response_language: en

## Communication Style
<!-- e.g.: prefer concise responses, always show diffs, explain trade-offs -->

## Editor & Tools
<!-- e.g.: VSCode, prefer TypeScript, always use pnpm -->

## Workflow Preferences
<!-- e.g.: confirm between every step, batch commits, prefer rebasing -->

## Notes
<!-- anything else Claude should remember about you -->
```

- [ ] **Step 6: Verify all 5 files**

```bash
ls global/settings.json global/commands/checkpoint.md global/commands/stack.md global/commands/lang.md global/memory/personal.md
```
Expected: all 5 paths listed with no errors

- [ ] **Step 7: Commit**

```bash
git add global/
git commit -m "feat: add global settings, commands, and memory template"
```

---

## Task 4: Skills

**Files:**
- Create: `skills/code-simplifier.md`
- Create: `skills/ui-ux.md`

- [ ] **Step 1: Create skills/code-simplifier.md**

```markdown
# Code Simplifier

**Always active.** Apply these rules to every piece of code written or reviewed.

## Rules

### 1. No Speculative Abstractions
Solve today's problem. Do not build for hypothetical future requirements.

❌ Bad:
```typescript
interface DataProcessor<T, R> {
  process(data: T): R;
  validate(data: T): boolean;
}
```

✅ Good:
```typescript
function parseUserInput(raw: string): User { ... }
```

### 2. No Premature Layers
Add a layer only when it carries real logic — not to "separate concerns" theoretically.

❌ Bad:
```typescript
class UserRepository {
  constructor(private db: UserDataAccessLayer) {}
  findById(id: string) { return this.db.findById(id); }
}
```

✅ Good:
```typescript
async function getUserById(db: Database, id: string): Promise<User> {
  return db.query('SELECT * FROM users WHERE id = ?', [id]);
}
```

### 3. No Single-Implementation Interfaces
Don't create an interface for a type that will only ever have one implementation.

❌ Bad: `interface Logger { log(msg: string): void }`
✅ Good: Use the class directly, or a plain function.

### 4. Functions Do One Thing (Max 30 Lines)
If a function needs a comment to describe what a section does, that section should be its own function.

### 5. No Defensive Code for Impossible Cases
Don't validate inputs that can't be wrong (internal calls, typed parameters, framework guarantees).

❌ Bad:
```typescript
function add(a: number, b: number): number {
  if (typeof a !== 'number') throw new Error('a must be a number');
  return a + b;
}
```

✅ Good:
```typescript
function add(a: number, b: number): number {
  return a + b;
}
```

### 6. No Design Patterns by Default
Use a pattern only when it solves a specific pain you have today.

### 7. Flat Over Nested
Use guard clauses and early returns instead of nesting.

❌ Bad:
```typescript
function process(user: User | null) {
  if (user) {
    if (user.isActive) {
      if (user.hasPermission) {
        doWork(user);
      }
    }
  }
}
```

✅ Good:
```typescript
function process(user: User | null) {
  if (!user) return;
  if (!user.isActive) return;
  if (!user.hasPermission) return;
  doWork(user);
}
```

### 8. Descriptive Names
No `Base`, `Abstract`, `Generic`, `Manager`, `Handler`, `Service`, `Helper`, `Util`.

### 9. Constants Only When Used 2+ Places or Have Domain Meaning
❌ Bad: `const ONE = 1`
✅ Good: `const MAX_RETRY_ATTEMPTS = 3`

### 10. Comments Explain Why, Never What
❌ Bad: `// increment counter`
✅ Good: `// retry limit matches SLA from the payments contract`

## Complexity Signals — Stop and Simplify

When you see any of these, stop and refactor before adding more code:

- Class with 5+ constructor dependencies
- Function over 30 lines
- 3+ levels of nesting
- A layer that only delegates to the layer below
- A name containing Base, Abstract, Generic, Manager, or Handler

## When Complexity IS Justified

Only add abstraction when:
- Multiple real implementations exist today (not "might exist someday")
- Domain rules are genuinely complex and need encapsulation
- A documented performance constraint requires it
- The pattern prevents a bug class that has already occurred in this codebase
```

- [ ] **Step 2: Create skills/ui-ux.md**

```markdown
# UI/UX Design Skill

**Activate for frontend projects.** Loaded by `/stack` when React, Angular, Next.js, or similar is detected.

## Core Design Principles

### Visual Hierarchy
Every screen has one primary action. Size, weight, and color guide the eye. Never give everything the same visual weight.

### Whitespace as Signal
Empty space communicates grouping and separation. Use it intentionally, not as padding.

### Consistency System
Same action → same appearance, always. Design tokens are the source of truth.

### Motion with Purpose
Animation communicates state change, not decoration. Entrance: 150–200ms ease-out. Exit: 100ms ease-in. Never more than one animation at a time.

---

## Component Approach

Before writing any component:
1. Identify its position in the visual hierarchy
2. List all states it must handle
3. Define all variants

**Required states for interactive elements:**
- default
- hover / focus
- active / pressed
- disabled
- loading
- error
- empty (for lists and containers)

---

## Design Tokens

### Spacing (4px base grid)
```
4px  — xs   tight grouping
8px  — sm   within components
12px — md   between related elements
16px — lg   section padding
24px — xl   between sections
32px — 2xl  page margins
48px — 3xl  major sections
```

### Typography Scale
```
12px / 0.75rem  — caption
14px / 0.875rem — body-sm
16px / 1rem     — body (base)
18px / 1.125rem — body-lg
20px / 1.25rem  — heading-sm
24px / 1.5rem   — heading-md
30px / 1.875rem — heading-lg
36px / 2.25rem  — display
```

### Semantic Color Tokens
```
--color-primary           main brand action
--color-primary-hover
--color-secondary         secondary actions
--color-surface           card/panel backgrounds
--color-surface-raised    elevated surfaces
--color-border            dividers, inputs
--color-text              primary text
--color-text-muted        secondary text
--color-error             destructive, validation
--color-success           confirmation, completed
--color-warning           caution
```

---

## Common Patterns

### Cards
- Consistent border-radius (8px or 12px — pick one per project, use it everywhere)
- Surface background, not white
- Subtle border or shadow — not both
- Clear hierarchy within: title > meta > content > actions

### Forms
- Labels above inputs, always
- Placeholder ≠ label — never rely on placeholder as the only label
- Error messages below the field, in `--color-error`, with an icon
- One primary submit button, visually distinct from secondary actions
- Disable + show spinner when submitting

### Tables
- Fixed column widths for numeric data
- Alternating row backgrounds only for dense data
- Sortable columns: show sort icon always, filled when active
- Empty state: message + CTA (not just a blank table)

### Navigation
- Active state is visually unambiguous
- Hover state gives feedback on every interactive element
- Breadcrumbs for > 2 levels deep
- Mobile: bottom nav or hamburger — not both

### Feedback (Toast / Alert)
- Success: auto-dismiss after 4s
- Error: persist until user dismisses
- Position: top-right or bottom-center — pick one per project
- Never block primary content

---

## Anti-Patterns

- **Flat gray cards** — no contrast, no hierarchy; looks broken
- **All buttons the same weight** — primary/secondary/ghost distinction is mandatory
- **No hover states** — every interactive element needs visual feedback
- **Color as sole differentiator** — always pair with shape, icon, or text
- **Modal for everything** — use inline, toast, or side panel first; modal only for destructive confirms
- **Submit with no loading state** — always disable + show spinner during async operations

---

## Accessibility Baseline

- **Contrast:** 4.5:1 for normal text, 3:1 for large text (WCAG AA)
- **Keyboard nav:** all interactive elements reachable and operable by keyboard
- **Focus indicators:** visible ring on every interactive element — never `outline: none` without a custom replacement
- **Images:** `alt` text on all `<img>`; decorative images use `alt=""`
- **Forms:** every input has an associated `<label>` via `for`/`id` or `aria-label`

---

## Tailwind Conventions

- **Design tokens:** defined in `tailwind.config.js` — never use raw hex in class attributes
- **Group/peer modifiers:** `group-hover:`, `peer-checked:` for dependent state styling
- **Gap over margin:** use `gap-*` on flex/grid containers, not margin between children
- **Dark mode:** `dark:` variant driven by `class="dark"` on `<html>`
- **Variants:** use `cva()` (class-variance-authority) for component variants — not ternaries in JSX
```

- [ ] **Step 3: Verify**

```bash
ls skills/code-simplifier.md skills/ui-ux.md
```

- [ ] **Step 4: Commit**

```bash
git add skills/
git commit -m "feat: add code-simplifier and ui-ux skills"
```

---

## Task 5: Stack Profiles — Base Files

**Files:**
- Create: `stack-profiles/_base.md`
- Create: `stack-profiles/_multi-stack.md`
- Create: `stack-profiles/_template.md`

- [ ] **Step 1: Create stack-profiles/_base.md**

```markdown
# Base Profile

Applies to all projects regardless of language. Loaded first by `/stack`; language profiles add on top.

## Identifiers

Always English. No exceptions, regardless of the team's spoken language.

## Commits

Conventional Commits format, in English:

```
feat: add user authentication
fix: prevent null pointer in order totals
docs: update API reference
refactor: extract payment validation
test: add unit tests for cart service
chore: bump dependencies
```

Breaking changes: append `!` after type (`feat!:`) and add `BREAKING CHANGE:` footer.

## Files

- One file, one responsibility
- File names: lowercase with hyphens (kebab-case) in most languages
- If a file exceeds ~200 lines, it is doing too much — split it

## Error Handling

- Never swallow errors silently — `catch (e) {}` is always wrong
- Either handle the error meaningfully or re-throw with added context
- Log errors with enough information to reproduce the issue

## Secrets

- Never hardcode secrets, tokens, API keys, or passwords
- Use environment variables locally; use a secrets manager in production
- `.env` files are always in `.gitignore`

## Comments

- Comments explain WHY, not WHAT
- If you need a comment to explain what a line does, rename the variable or function instead
- Delete commented-out code — git history preserves it

## Dependencies

- Ask before adding: can this be 10 lines instead of a dependency?
- Pin major versions; allow minor/patch updates
- Remove unused dependencies immediately
- Audit transitive dependencies for known vulnerabilities before shipping

## Testing

- Test behavior, not implementation details
- Test name format: "should [behavior] when [condition]"
- No `if (process.env.NODE_ENV === 'test')` in production code
- A test that passes when the feature is broken is worse than no test
```

- [ ] **Step 2: Create stack-profiles/_multi-stack.md**

```markdown
# Multi-Stack Coordinator

Loaded when multiple languages or runtimes are detected. Loaded BEFORE individual language profiles.

## Layer Ownership

Each technology layer owns its directory. No cross-layer file sprawl.

```
project/
├── backend/      server-side code
├── frontend/     client-side code
├── shared/       contracts only (types, schemas, OpenAPI/Protobuf)
├── infra/        infrastructure as code
└── scripts/      tooling and automation
```

## Contracts First

The shared contract (OpenAPI spec, Protobuf, GraphQL schema, shared types) is the source of truth. Both layers must match it. When they disagree, the contract wins. Update the contract before updating either layer.

## Tooling Stays in Its Layer

- Frontend tools (webpack, vite, eslint for JS) live in `frontend/`
- Backend tools (Maven, Pipenv, Go modules) live in `backend/`
- Root scripts are orchestration only (`make dev`, `docker-compose up`)

## Feature Development Order

For every full-stack feature, implement in this exact order:

1. **Contract** — update shared types/schema first
2. **Backend** — implement + unit test
3. **Frontend** — implement against the contract
4. **Integration tests** — test the seam between layers
5. **E2E** — Playwright end-to-end

Never build the frontend against a backend that doesn't exist yet. Mock data is a bridge only — replace it immediately when the backend is ready.

## Cross-Layer Communication

- REST: OpenAPI spec in `shared/openapi.yaml`
- GraphQL: schema in `shared/schema.graphql`
- Events: schemas in `shared/events/`
- Direct DB access from frontend: never

## API Versioning

Breaking changes require a new version prefix (`/v2/`). Never modify a published API contract in place.
```

- [ ] **Step 3: Create stack-profiles/_template.md**

```markdown
# [Language/Framework] Profile

**Detector files:** <!-- list files whose presence indicates this stack -->

---

## Naming Conventions

| Element    | Convention | Example |
|------------|------------|---------|
| Variables  |            |         |
| Functions  |            |         |
| Classes    |            |         |
| Constants  |            |         |
| Files      |            |         |
| Directories|            |         |

---

## Standard Project Structure

```
project/
├── src/
└── tests/
```

---

## Tooling

| Tool            | Name | Command |
|-----------------|------|---------|
| Formatter       |      |         |
| Linter          |      |         |
| Test runner     |      |         |
| Build tool      |      |         |
| Package manager |      |         |

---

## Common Commands

```bash
# Install dependencies

# Run dev server

# Run tests

# Build

# Format

# Lint
```

---

## Idiomatic Patterns

### Pattern 1: [Name]

```
# example
```

### Pattern 2: [Name]

```
# example
```

---

## Anti-Patterns

-

---

## Detector Files

-
```

- [ ] **Step 4: Verify**

```bash
ls stack-profiles/_base.md stack-profiles/_multi-stack.md stack-profiles/_template.md
```

- [ ] **Step 5: Commit**

```bash
git add stack-profiles/_base.md stack-profiles/_multi-stack.md stack-profiles/_template.md
git commit -m "feat: add base, multi-stack, and template stack profiles"
```

---

## Task 6: Stack Profiles — Languages

**Files:**
- Create: `stack-profiles/javascript.md`
- Create: `stack-profiles/typescript.md`
- Create: `stack-profiles/python.md`
- Create: `stack-profiles/java.md`
- Create: `stack-profiles/go.md`
- Create: `stack-profiles/rust.md`

- [ ] **Step 1: Create stack-profiles/javascript.md**

```markdown
# JavaScript Profile

**Detector files:** `package.json` (without `typescript` in devDependencies and without `.ts` source files)

---

## Naming Conventions

| Element    | Convention      | Example                       |
|------------|-----------------|-------------------------------|
| Variables  | camelCase       | `userCount`, `isLoading`      |
| Functions  | camelCase       | `fetchUser`, `formatDate`     |
| Classes    | PascalCase      | `EventEmitter`, `UserSession` |
| Constants  | UPPER_SNAKE_CASE| `MAX_RETRIES`, `API_BASE_URL` |
| Files      | kebab-case      | `user-service.js`             |
| Directories| kebab-case      | `user-management/`            |

---

## Standard Project Structure

```
project/
├── src/
│   ├── index.js
│   └── [feature]/
│       ├── [feature].js
│       └── [feature].test.js
├── package.json
├── .eslintrc.json
└── .prettierrc
```

---

## Tooling

| Tool            | Name     | Command                    |
|-----------------|----------|----------------------------|
| Formatter       | Prettier | `npx prettier --write .`   |
| Linter          | ESLint   | `npx eslint src/`          |
| Test runner     | Vitest   | `npm test`                 |
| Build tool      | esbuild  | `npm run build`            |
| Package manager | pnpm     | `pnpm install`             |

---

## Common Commands

```bash
pnpm install          # install dependencies
pnpm dev              # start dev server
pnpm test             # run tests
pnpm build            # production build
pnpm format           # run prettier
pnpm lint             # run eslint
```

---

## Idiomatic Patterns

### Async/Await Over Callbacks

```javascript
// ✅ Good
async function getUser(id) {
  const response = await fetch(`/api/users/${id}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
```

### Named Exports Over Default Exports

```javascript
// ✅ Good — explicit API surface
export function parseDate(str) { ... }
export function formatDate(date) { ... }

// ❌ Bad — hides what the module exports
export default { parseDate, formatDate };
```

### Error Propagation With Context

```javascript
async function createOrder(data) {
  try {
    return await db.insert('orders', data);
  } catch (err) {
    throw new Error(`Failed to create order for user ${data.userId}: ${err.message}`);
  }
}
```

---

## Anti-Patterns

- `var` — use `const`; use `let` only when reassignment is needed
- `==` — always use `===`
- Callback hell — use async/await
- Mutating function parameters — return new values
- Catching errors silently — always handle or rethrow

---

## Detector Files

- `package.json` without `typescript` in devDependencies
```

- [ ] **Step 2: Create stack-profiles/typescript.md**

```markdown
# TypeScript Profile

**Detector files:** `package.json` with `typescript` in devDependencies, `tsconfig.json`

---

## Naming Conventions

| Element    | Convention      | Example                         |
|------------|-----------------|---------------------------------|
| Variables  | camelCase       | `userId`, `isLoading`           |
| Functions  | camelCase       | `fetchUser`, `parseDate`        |
| Classes    | PascalCase      | `UserService`, `OrderProcessor` |
| Interfaces | PascalCase      | `UserRepository`, `Config`      |
| Types      | PascalCase      | `UserId`, `OrderStatus`         |
| Enums      | PascalCase      | `HttpStatus`, `Role`            |
| Constants  | UPPER_SNAKE_CASE| `MAX_RETRIES`                   |
| Files      | kebab-case      | `user-service.ts`               |
| Directories| kebab-case      | `user-management/`              |

---

## Standard Project Structure

```
project/
├── src/
│   ├── index.ts
│   └── [feature]/
│       ├── [feature].ts
│       ├── [feature].types.ts
│       └── [feature].test.ts
├── tsconfig.json
├── package.json
└── .eslintrc.json
```

---

## Tooling

| Tool            | Name               | Command                       |
|-----------------|--------------------|-------------------------------|
| Formatter       | Prettier           | `npx prettier --write .`      |
| Linter          | ESLint + TS plugin | `npx eslint src/`             |
| Test runner     | Vitest             | `pnpm test`                   |
| Build tool      | tsc / tsup         | `pnpm build`                  |
| Package manager | pnpm               | `pnpm install`                |

---

## Common Commands

```bash
pnpm install          # install dependencies
pnpm dev              # start dev server (ts-node or tsx)
pnpm test             # run tests
pnpm build            # compile TypeScript
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint
```

---

## Idiomatic Patterns

### Strict Null Checks — Always On

Enable in `tsconfig.json`:
```json
{ "compilerOptions": { "strict": true } }
```

Never use `!` non-null assertion — fix the type instead.

### Discriminated Unions Over Optionals

```typescript
// ✅ Good — exhaustive, safe
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function handleResult(r: Result<User>) {
  if (r.ok) return r.value.name;  // TypeScript knows r.value exists
  return r.error;
}
```

### Type-Only Imports

```typescript
import type { User } from './user.types';
```

Use `import type` for types that are erased at compile time — keeps the runtime bundle clean.

---

## Anti-Patterns

- `any` — use `unknown` and narrow, or define the proper type
- `!` non-null assertion — fix the type or add a guard
- `as SomeType` casting without a guard — narrows incorrectly, hides bugs
- Interfaces for everything — use `type` for unions, intersections, and mapped types
- Enums — prefer `as const` objects (enums generate unexpected runtime code)

---

## Detector Files

- `tsconfig.json`
- `package.json` with `typescript` in devDependencies
```

- [ ] **Step 3: Create stack-profiles/python.md**

```markdown
# Python Profile

**Detector files:** `requirements.txt`, `pyproject.toml`, `setup.py`, `Pipfile`

---

## Naming Conventions

| Element    | Convention  | Example                     |
|------------|-------------|-----------------------------|
| Variables  | snake_case  | `user_count`, `is_loading`  |
| Functions  | snake_case  | `fetch_user`, `parse_date`  |
| Classes    | PascalCase  | `UserService`, `OrderItem`  |
| Constants  | UPPER_SNAKE | `MAX_RETRIES`, `BASE_URL`   |
| Files      | snake_case  | `user_service.py`           |
| Directories| snake_case  | `user_management/`          |
| Modules    | snake_case  | `date_utils`                |

---

## Standard Project Structure

```
project/
├── src/
│   └── [package]/
│       ├── __init__.py
│       └── [module].py
├── tests/
│   └── test_[module].py
├── pyproject.toml
└── .python-version
```

---

## Tooling

| Tool            | Name    | Command              |
|-----------------|---------|----------------------|
| Formatter       | ruff    | `ruff format .`      |
| Linter          | ruff    | `ruff check .`       |
| Type checker    | mypy    | `mypy src/`          |
| Test runner     | pytest  | `pytest`             |
| Package manager | uv      | `uv sync`            |

---

## Common Commands

```bash
uv sync               # install dependencies
uv run python -m src  # run the app
uv run pytest         # run tests
uv run ruff format .  # format
uv run ruff check .   # lint
uv run mypy src/      # type check
```

---

## Idiomatic Patterns

### Type Hints Everywhere

```python
def get_user(user_id: str) -> User | None:
    return db.find(user_id)
```

Use `from __future__ import annotations` at top of file to support forward references.

### Dataclasses Over Dicts

```python
from dataclasses import dataclass

@dataclass
class Order:
    id: str
    user_id: str
    total: float
    status: str = "pending"
```

### Context Managers for Resources

```python
with open("data.json") as f:
    data = json.load(f)
# file is guaranteed closed here
```

---

## Anti-Patterns

- Mutable default arguments: `def f(items=[])` — use `None` and assign inside
- Bare `except:` — always catch specific exceptions
- `import *` — always use explicit imports
- `print()` for debugging — use `logging`
- Ignoring return values from functions that can fail

---

## Detector Files

- `requirements.txt`
- `pyproject.toml`
- `Pipfile`
```

- [ ] **Step 4: Create stack-profiles/java.md**

```markdown
# Java Profile

**Detector files:** `pom.xml`, `build.gradle`, `build.gradle.kts`

---

## Naming Conventions

| Element     | Convention       | Example                        |
|-------------|------------------|--------------------------------|
| Variables   | camelCase        | `userId`, `isLoading`          |
| Methods     | camelCase        | `fetchUser()`, `parseDate()`   |
| Classes     | PascalCase       | `UserService`, `OrderProcessor`|
| Interfaces  | PascalCase       | `UserRepository`, `Runnable`   |
| Constants   | UPPER_SNAKE_CASE | `MAX_RETRIES`, `BASE_URL`      |
| Packages    | lowercase.dots   | `com.example.users`            |
| Files       | PascalCase       | `UserService.java`             |

---

## Standard Project Structure

```
project/
├── src/
│   ├── main/
│   │   └── java/com/example/
│   │       └── [feature]/
│   │           ├── [Feature].java
│   │           └── [Feature]Repository.java
│   └── test/
│       └── java/com/example/
│           └── [feature]/
│               └── [Feature]Test.java
└── pom.xml
```

---

## Tooling

| Tool            | Name          | Command               |
|-----------------|---------------|-----------------------|
| Formatter       | google-java-format | via Maven plugin |
| Linter          | Checkstyle    | `mvn checkstyle:check`|
| Test runner     | JUnit 5       | `mvn test`            |
| Build tool      | Maven         | `mvn`                 |
| Package manager | Maven Central | `mvn dependency:resolve`|

---

## Common Commands

```bash
mvn install           # build + test + install to local repo
mvn test              # run tests
mvn spring-boot:run   # run Spring Boot app
mvn package           # build JAR
mvn dependency:tree   # show dependency tree
```

---

## Idiomatic Patterns

### Records for Data Carriers (Java 16+)

```java
public record UserId(String value) {
  public UserId {
    if (value == null || value.isBlank()) throw new IllegalArgumentException("UserId cannot be blank");
  }
}
```

### Optional Over Null

```java
public Optional<User> findById(String id) {
  return Optional.ofNullable(db.get(id));
}

// caller
findById(id).ifPresent(user -> process(user));
```

### Streams for Collection Operations

```java
List<String> activeNames = users.stream()
    .filter(User::isActive)
    .map(User::getName)
    .toList();
```

---

## Anti-Patterns

- Returning `null` from methods — use `Optional<T>`
- Catching `Exception` or `Throwable` — catch specific types
- Public fields — use private fields with accessors, or records
- Mutable shared state without synchronization
- `System.out.println` for logging — use SLF4J

---

## Detector Files

- `pom.xml`
- `build.gradle`
- `build.gradle.kts`
```

- [ ] **Step 5: Create stack-profiles/go.md**

```markdown
# Go Profile

**Detector files:** `go.mod`, `go.sum`

---

## Naming Conventions

| Element    | Convention  | Example                    |
|------------|-------------|----------------------------|
| Variables  | camelCase   | `userID`, `isLoading`      |
| Functions  | camelCase   | `fetchUser`, `parseDate`   |
| Exported   | PascalCase  | `UserService`, `ParseDate` |
| Constants  | PascalCase  | `MaxRetries`, `BaseURL`    |
| Interfaces | PascalCase  | `UserRepository`           |
| Files      | snake_case  | `user_service.go`          |
| Packages   | lowercase   | `users`, `httputil`        |

---

## Standard Project Structure

```
project/
├── cmd/
│   └── [app]/
│       └── main.go
├── internal/
│   └── [feature]/
│       ├── [feature].go
│       └── [feature]_test.go
├── pkg/           (public, reusable packages only)
├── go.mod
└── go.sum
```

---

## Tooling

| Tool            | Name       | Command              |
|-----------------|------------|----------------------|
| Formatter       | gofmt      | `gofmt -w .`         |
| Linter          | golangci-lint | `golangci-lint run`|
| Test runner     | go test    | `go test ./...`      |
| Build tool      | go build   | `go build ./...`     |
| Package manager | Go modules | `go mod tidy`        |

---

## Common Commands

```bash
go mod tidy           # sync dependencies
go run ./cmd/app      # run the app
go test ./...         # run all tests
go build ./...        # compile all packages
gofmt -w .            # format
golangci-lint run     # lint
```

---

## Idiomatic Patterns

### Errors Are Values

```go
user, err := getUserByID(ctx, id)
if err != nil {
    return fmt.Errorf("getUser: %w", err)
}
```

Always wrap errors with `%w` to preserve the chain. Never discard `err`.

### Interfaces Are Implicit — Keep Them Small

```go
// ✅ Good — defined at the point of use, one method
type UserLookup interface {
    GetUser(ctx context.Context, id string) (User, error)
}
```

Don't define interfaces with 10 methods. Accept interfaces, return structs.

### Table-Driven Tests

```go
func TestParseDate(t *testing.T) {
    cases := []struct {
        input    string
        expected time.Time
        wantErr  bool
    }{
        {"2024-01-15", time.Date(2024, 1, 15, 0, 0, 0, 0, time.UTC), false},
        {"bad-date", time.Time{}, true},
    }
    for _, tc := range cases {
        got, err := ParseDate(tc.input)
        if (err != nil) != tc.wantErr {
            t.Errorf("ParseDate(%q) error = %v, wantErr %v", tc.input, err, tc.wantErr)
        }
        if !tc.wantErr && got != tc.expected {
            t.Errorf("ParseDate(%q) = %v, want %v", tc.input, got, tc.expected)
        }
    }
}
```

---

## Anti-Patterns

- `panic` for expected errors — return `error` instead
- Named return values (except for defer clarity) — makes code harder to read
- Global state — pass dependencies explicitly via function arguments or struct fields
- Goroutines without a shutdown strategy — always handle context cancellation
- `interface{}` / `any` — use generics (Go 1.18+) or concrete types

---

## Detector Files

- `go.mod`
```

- [ ] **Step 6: Create stack-profiles/rust.md**

```markdown
# Rust Profile

**Detector files:** `Cargo.toml`, `Cargo.lock`

---

## Naming Conventions

| Element    | Convention  | Example                       |
|------------|-------------|-------------------------------|
| Variables  | snake_case  | `user_id`, `is_loading`       |
| Functions  | snake_case  | `fetch_user`, `parse_date`    |
| Types      | PascalCase  | `UserService`, `OrderStatus`  |
| Enums      | PascalCase  | `HttpStatus`, `Role`          |
| Constants  | UPPER_SNAKE | `MAX_RETRIES`, `BASE_URL`     |
| Modules    | snake_case  | `user_service`, `http_client` |
| Files      | snake_case  | `user_service.rs`             |

---

## Standard Project Structure

```
project/
├── src/
│   ├── main.rs (or lib.rs)
│   └── [module]/
│       ├── mod.rs
│       └── [submodule].rs
├── tests/
│   └── integration_test.rs
└── Cargo.toml
```

---

## Tooling

| Tool            | Name     | Command              |
|-----------------|----------|----------------------|
| Formatter       | rustfmt  | `cargo fmt`          |
| Linter          | Clippy   | `cargo clippy`       |
| Test runner     | cargo    | `cargo test`         |
| Build tool      | cargo    | `cargo build`        |
| Package manager | cargo    | `cargo add`          |

---

## Common Commands

```bash
cargo build           # compile (debug)
cargo build --release # compile (optimized)
cargo test            # run tests
cargo run             # compile and run
cargo fmt             # format
cargo clippy          # lint
cargo add [crate]     # add dependency
```

---

## Idiomatic Patterns

### The Type System Is the Error Handler

```rust
fn get_user(id: &str) -> Result<User, AppError> {
    let user = db.find(id).ok_or(AppError::NotFound(id.to_string()))?;
    Ok(user)
}
```

Use `?` to propagate errors. Define a project-level `AppError` enum.

### Ownership Over Cloning

```rust
// ✅ Good — borrow when you don't need ownership
fn process_name(name: &str) -> usize {
    name.len()
}

// ❌ Bad — cloning just to avoid figuring out lifetimes
fn process_name(name: String) -> usize {
    name.len()
}
```

### Builder Pattern for Complex Config

```rust
let client = HttpClient::builder()
    .timeout(Duration::from_secs(30))
    .retry_attempts(3)
    .build()?;
```

---

## Anti-Patterns

- `.unwrap()` in production code — use `?` or `match` instead
- `.clone()` to silence the borrow checker — figure out the lifetime
- `unsafe` without a documented invariant explaining why it's safe
- `Arc<Mutex<T>>` everywhere — redesign data ownership first
- `Box<dyn Error>` for function return types — define a concrete error type

---

## Detector Files

- `Cargo.toml`
```

- [ ] **Step 7: Verify all 6 language profiles**

```bash
ls stack-profiles/javascript.md stack-profiles/typescript.md stack-profiles/python.md stack-profiles/java.md stack-profiles/go.md stack-profiles/rust.md
```

- [ ] **Step 8: Commit**

```bash
git add stack-profiles/javascript.md stack-profiles/typescript.md stack-profiles/python.md stack-profiles/java.md stack-profiles/go.md stack-profiles/rust.md
git commit -m "feat: add language stack profiles (JS, TS, Python, Java, Go, Rust)"
```

---

## Task 7: Stack Profiles — Frameworks

**Files:**
- Create: `stack-profiles/react.md`
- Create: `stack-profiles/angular.md`
- Create: `stack-profiles/nextjs.md`
- Create: `stack-profiles/nestjs.md`
- Create: `stack-profiles/django.md`
- Create: `stack-profiles/flask.md`

- [ ] **Step 1: Create stack-profiles/react.md**

```markdown
# React Profile

**Detector files:** `package.json` with `react` in dependencies (without `next`)

---

## Naming Conventions

| Element     | Convention  | Example                        |
|-------------|-------------|--------------------------------|
| Components  | PascalCase  | `UserCard`, `OrderSummary`     |
| Hooks       | camelCase with `use` prefix | `useUser`, `useOrderStatus` |
| Files       | PascalCase for components | `UserCard.tsx` |
| Hook files  | camelCase   | `useUser.ts`                   |
| CSS modules | kebab-case  | `user-card.module.css`         |

---

## Standard Project Structure

```
src/
├── components/
│   └── [ComponentName]/
│       ├── index.tsx
│       └── [ComponentName].test.tsx
├── hooks/
│   └── use[HookName].ts
├── pages/      (or routes/ for React Router)
├── lib/        (non-component utilities)
└── types/
```

---

## Tooling

| Tool            | Name    | Command              |
|-----------------|---------|----------------------|
| Formatter       | Prettier| `pnpm format`        |
| Linter          | ESLint  | `pnpm lint`          |
| Test runner     | Vitest + Testing Library | `pnpm test` |
| Build tool      | Vite    | `pnpm build`         |
| Package manager | pnpm    | `pnpm install`       |

---

## Common Commands

```bash
pnpm install       # install dependencies
pnpm dev           # start Vite dev server
pnpm test          # run Vitest
pnpm build         # production build
pnpm preview       # preview production build locally
```

---

## Idiomatic Patterns

### Component With All States Handled

```tsx
function UserCard({ userId }: { userId: string }) {
  const { user, isLoading, error } = useUser(userId);

  if (isLoading) return <Skeleton />;
  if (error) return <ErrorMessage message={error.message} />;
  if (!user) return <EmptyState />;

  return <div>{user.name}</div>;
}
```

### Custom Hook Extracts Logic From Component

```tsx
function useUser(id: string) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    fetchUser(id)
      .then(setUser)
      .catch(setError)
      .finally(() => setIsLoading(false));
  }, [id]);

  return { user, isLoading, error };
}
```

### Testing Behavior, Not Implementation

```tsx
it('should show user name when loaded', async () => {
  render(<UserCard userId="123" />);
  expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
});
```

---

## Anti-Patterns

- `useEffect` for data fetching — use React Query or SWR instead
- Business logic in components — extract to custom hooks or plain functions
- Prop drilling more than 2 levels — use context or co-locate state
- `React.FC` type — just annotate props directly
- Mutating state directly — always use the setter, return new objects

---

## Detector Files

- `package.json` with `"react"` in dependencies (and no `"next"`)
```

- [ ] **Step 2: Create stack-profiles/angular.md**

```markdown
# Angular Profile

**Detector files:** `angular.json`, `package.json` with `@angular/core`

---

## Naming Conventions

| Element    | Convention  | Example                          |
|------------|-------------|----------------------------------|
| Components | PascalCase + suffix | `UserCardComponent`    |
| Services   | PascalCase + suffix | `UserService`          |
| Modules    | PascalCase + suffix | `UserModule`           |
| Pipes      | PascalCase + suffix | `DateFormatPipe`       |
| Files      | kebab-case + suffix | `user-card.component.ts` |
| Selectors  | kebab-case + prefix | `app-user-card`        |

---

## Standard Project Structure

```
src/app/
├── core/          singleton services, guards, interceptors
├── shared/        reusable components, pipes, directives
└── features/
    └── [feature]/
        ├── [feature].module.ts
        ├── [feature].component.ts
        ├── [feature].component.html
        ├── [feature].component.scss
        └── [feature].service.ts
```

---

## Tooling

| Tool            | Name       | Command               |
|-----------------|------------|-----------------------|
| Formatter       | Prettier   | `npx prettier --write .` |
| Linter          | ESLint     | `ng lint`             |
| Test runner     | Jest       | `ng test`             |
| Build tool      | Angular CLI| `ng build`            |
| Package manager | npm        | `npm install`         |

---

## Common Commands

```bash
npm install           # install dependencies
ng serve              # start dev server
ng test               # run tests
ng build --configuration production  # production build
ng generate component features/[feature]/[name]  # generate component
```

---

## Idiomatic Patterns

### Reactive Forms Over Template-Driven

```typescript
this.form = this.fb.group({
  email: ['', [Validators.required, Validators.email]],
  password: ['', [Validators.required, Validators.minLength(8)]],
});
```

### Async Pipe Over Manual Subscribe

```html
<!-- ✅ Good — auto-unsubscribes -->
<div *ngIf="user$ | async as user">{{ user.name }}</div>
```

```typescript
// ❌ Bad — must remember to unsubscribe
ngOnInit() {
  this.sub = this.userService.user$.subscribe(u => this.user = u);
}
ngOnDestroy() { this.sub.unsubscribe(); }
```

### Signals (Angular 17+)

```typescript
// prefer signals over BehaviorSubject for local state
count = signal(0);
doubled = computed(() => this.count() * 2);
increment() { this.count.update(c => c + 1); }
```

---

## Anti-Patterns

- Manual `subscribe` in components without `takeUntilDestroyed` or `async` pipe
- Logic in templates — move to component class or service
- Importing `CommonModule` / `FormsModule` in every module — use standalone components (Angular 14+)
- Any-typed HTTP responses — define response interfaces
- `ngOnInit` doing everything — decompose into services

---

## Detector Files

- `angular.json`
- `package.json` with `@angular/core`
```

- [ ] **Step 3: Create stack-profiles/nextjs.md**

```markdown
# Next.js Profile

**Detector files:** `package.json` with `next`, `next.config.js` or `next.config.ts`

---

## Naming Conventions

| Element        | Convention  | Example                       |
|----------------|-------------|-------------------------------|
| Components     | PascalCase  | `UserCard`, `OrderSummary`    |
| Hooks          | camelCase with `use` | `useUser`, `useCart` |
| Route files    | lowercase   | `page.tsx`, `layout.tsx`      |
| Route dirs     | kebab-case  | `user-profile/`, `order-[id]/`|
| Server actions | camelCase   | `createOrder`, `deleteUser`   |
| Files (non-route) | PascalCase | `UserCard.tsx`             |

---

## Standard Project Structure

```
app/
├── (auth)/
│   ├── login/page.tsx
│   └── layout.tsx
├── dashboard/
│   ├── page.tsx
│   └── layout.tsx
├── api/
│   └── [route]/route.ts
├── globals.css
└── layout.tsx
components/
├── ui/          shadcn/ui components
└── [domain]/    domain-specific components
lib/
├── actions/     server actions
└── [util].ts
```

---

## Tooling

| Tool            | Name     | Command              |
|-----------------|----------|----------------------|
| Formatter       | Prettier | `pnpm format`        |
| Linter          | ESLint   | `pnpm lint`          |
| Test runner     | Vitest   | `pnpm test`          |
| Build tool      | Next.js  | `pnpm build`         |
| Package manager | pnpm     | `pnpm install`       |

---

## Common Commands

```bash
pnpm install      # install dependencies
pnpm dev          # start dev server (turbopack)
pnpm test         # run vitest
pnpm build        # production build
pnpm start        # start production server
pnpm lint         # eslint
```

---

## Idiomatic Patterns

### Server Components by Default

```tsx
// app/users/page.tsx — runs on the server, no 'use client'
export default async function UsersPage() {
  const users = await db.query('SELECT * FROM users');
  return <UserList users={users} />;
}
```

Add `'use client'` only when you need `useState`, `useEffect`, or event handlers.

### Server Actions for Mutations

```typescript
// lib/actions/users.ts
'use server';

export async function createUser(formData: FormData) {
  const name = formData.get('name') as string;
  await db.insert('users', { name });
  revalidatePath('/users');
}
```

### Route Handlers for API Endpoints

```typescript
// app/api/users/route.ts
export async function GET() {
  const users = await db.getAll();
  return Response.json(users);
}

export async function POST(request: Request) {
  const body = await request.json();
  const user = await db.create(body);
  return Response.json(user, { status: 201 });
}
```

---

## Anti-Patterns

- `'use client'` on every component — default to server components
- `useEffect` for data fetching — use server components or React Query
- API routes for internal data fetching — call db/service directly in server components
- Client-side secrets — all secrets stay in server components and server actions
- Large client bundles — audit with `@next/bundle-analyzer`

---

## Detector Files

- `next.config.js` or `next.config.ts`
- `package.json` with `"next"` in dependencies
```

- [ ] **Step 4: Create stack-profiles/nestjs.md**

```markdown
# NestJS Profile

**Detector files:** `package.json` with `@nestjs/core`

---

## Naming Conventions

| Element     | Convention  | Example                          |
|-------------|-------------|----------------------------------|
| Modules     | PascalCase  | `UsersModule`, `OrdersModule`    |
| Controllers | PascalCase + suffix | `UsersController`      |
| Services    | PascalCase + suffix | `UsersService`         |
| DTOs        | PascalCase + suffix | `CreateUserDto`        |
| Files       | kebab-case + suffix | `users.controller.ts` |
| Routes      | kebab-case  | `/api/user-profiles`             |

---

## Standard Project Structure

```
src/
├── main.ts
├── app.module.ts
└── [feature]/
    ├── [feature].module.ts
    ├── [feature].controller.ts
    ├── [feature].service.ts
    ├── dto/
    │   ├── create-[feature].dto.ts
    │   └── update-[feature].dto.ts
    └── entities/
        └── [feature].entity.ts
```

---

## Tooling

| Tool            | Name       | Command              |
|-----------------|------------|----------------------|
| Formatter       | Prettier   | `pnpm format`        |
| Linter          | ESLint     | `pnpm lint`          |
| Test runner     | Jest       | `pnpm test`          |
| Build tool      | tsc        | `pnpm build`         |
| Package manager | pnpm       | `pnpm install`       |

---

## Common Commands

```bash
pnpm install         # install dependencies
pnpm start:dev       # start with hot reload
pnpm test            # run jest
pnpm test:e2e        # run e2e tests
pnpm build           # compile TypeScript
```

---

## Idiomatic Patterns

### Validation With Class Validator

```typescript
import { IsEmail, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}
```

Enable globally: `app.useGlobalPipes(new ValidationPipe({ whitelist: true }))`.

### Guards for Authorization

```typescript
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }
}
```

### Service Layer Owns Business Logic

Controllers route requests; services own all logic and talk to repositories.

```typescript
@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async createUser(dto: CreateUserDto): Promise<User> {
    const existing = await this.usersRepository.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already in use');
    return this.usersRepository.create(dto);
  }
}
```

---

## Anti-Patterns

- Business logic in controllers — move to services
- Skipping DTOs — always validate with class-validator
- Returning ORM entities directly — map to response DTOs to avoid leaking internals
- Global state in services — NestJS services are singletons, treat them as stateless
- Circular module imports — restructure dependencies

---

## Detector Files

- `package.json` with `@nestjs/core`
- `nest-cli.json`
```

- [ ] **Step 5: Create stack-profiles/django.md**

```markdown
# Django Profile

**Detector files:** `manage.py`, `requirements.txt` or `pyproject.toml` with `django`

---

## Naming Conventions

| Element    | Convention  | Example                          |
|------------|-------------|----------------------------------|
| Models     | PascalCase  | `UserProfile`, `Order`           |
| Views      | PascalCase (CBV) / snake_case (FBV) | `UserDetailView` / `list_users` |
| URLs       | kebab-case  | `/api/user-profiles/`            |
| Apps       | snake_case  | `user_profiles`, `orders`        |
| Files      | snake_case  | `user_service.py`                |
| Templates  | snake_case  | `user_detail.html`               |

---

## Standard Project Structure

```
project/
├── manage.py
├── config/
│   ├── settings/
│   │   ├── base.py
│   │   ├── local.py
│   │   └── production.py
│   ├── urls.py
│   └── wsgi.py
└── apps/
    └── [feature]/
        ├── models.py
        ├── views.py
        ├── urls.py
        ├── serializers.py   (if using DRF)
        ├── admin.py
        └── tests/
            └── test_views.py
```

---

## Tooling

| Tool            | Name    | Command                  |
|-----------------|---------|--------------------------|
| Formatter       | ruff    | `ruff format .`          |
| Linter          | ruff    | `ruff check .`           |
| Test runner     | pytest-django | `pytest`           |
| Package manager | uv      | `uv sync`                |
| Migrations      | Django  | `python manage.py migrate` |

---

## Common Commands

```bash
uv sync                          # install dependencies
python manage.py runserver       # dev server
python manage.py migrate         # apply migrations
python manage.py makemigrations  # generate migrations
python manage.py createsuperuser
pytest                           # run tests
```

---

## Idiomatic Patterns

### Fat Models, Thin Views

Business logic belongs in models or service modules, not in views.

```python
class Order(models.Model):
    user = models.ForeignKey(User, on_delete=models.PROTECT)
    status = models.CharField(max_length=20, default='pending')

    def mark_paid(self):
        if self.status != 'pending':
            raise ValueError(f"Cannot pay an order with status '{self.status}'")
        self.status = 'paid'
        self.save(update_fields=['status'])
```

### Django REST Framework Serializers for Validation

```python
class CreateOrderSerializer(serializers.Serializer):
    product_id = serializers.IntegerField()
    quantity = serializers.IntegerField(min_value=1)

    def validate_product_id(self, value):
        if not Product.objects.filter(id=value, is_active=True).exists():
            raise serializers.ValidationError("Product not found or inactive")
        return value
```

### `select_related` and `prefetch_related` — Always

```python
# ✅ Good — 1 query
orders = Order.objects.select_related('user').prefetch_related('items').filter(status='pending')

# ❌ Bad — N+1 queries
orders = Order.objects.filter(status='pending')
for order in orders:
    print(order.user.name)  # new query per order
```

---

## Anti-Patterns

- Logic in views or templates — move to models or service layer
- Forgetting `select_related` / `prefetch_related` — causes N+1 query problems
- Hardcoding settings — always use `django.conf.settings`
- Using `DEBUG=True` in production
- Checking `request.method == 'GET'` — use class-based views or DRF

---

## Detector Files

- `manage.py`
- `requirements.txt` or `pyproject.toml` containing `django`
```

- [ ] **Step 6: Create stack-profiles/flask.md**

```markdown
# Flask Profile

**Detector files:** `requirements.txt` or `pyproject.toml` with `flask`

---

## Naming Conventions

| Element    | Convention  | Example                        |
|------------|-------------|--------------------------------|
| Functions  | snake_case  | `get_user`, `create_order`     |
| Classes    | PascalCase  | `UserService`, `OrderSchema`   |
| Blueprints | snake_case  | `users_bp`, `orders_bp`        |
| Files      | snake_case  | `user_routes.py`               |
| URLs       | kebab-case  | `/api/user-profiles`           |

---

## Standard Project Structure

```
project/
├── app/
│   ├── __init__.py   (create_app factory)
│   ├── extensions.py (db, ma, jwt instances)
│   └── [feature]/
│       ├── __init__.py
│       ├── routes.py
│       ├── models.py
│       └── schemas.py
├── tests/
│   └── test_[feature].py
├── config.py
└── pyproject.toml
```

---

## Tooling

| Tool            | Name           | Command                |
|-----------------|----------------|------------------------|
| Formatter       | ruff           | `ruff format .`        |
| Linter          | ruff           | `ruff check .`         |
| Test runner     | pytest         | `pytest`               |
| Package manager | uv             | `uv sync`              |

---

## Common Commands

```bash
uv sync               # install dependencies
flask run             # start dev server
flask run --debug     # with hot reload
pytest                # run tests
ruff format .         # format
```

---

## Idiomatic Patterns

### Application Factory

```python
# app/__init__.py
def create_app(config_name: str = "default") -> Flask:
    app = Flask(__name__)
    app.config.from_object(config[config_name])

    db.init_app(app)
    ma.init_app(app)

    from app.users.routes import users_bp
    app.register_blueprint(users_bp, url_prefix='/api/users')

    return app
```

### Marshmallow Schemas for Validation

```python
from marshmallow import Schema, fields, validate

class CreateUserSchema(Schema):
    email = fields.Email(required=True)
    password = fields.Str(required=True, validate=validate.Length(min=8))

@users_bp.post('/')
def create_user():
    data = CreateUserSchema().load(request.json)
    user = User(**data)
    db.session.add(user)
    db.session.commit()
    return UserSchema().dump(user), 201
```

### Blueprints Group Related Routes

```python
# app/users/routes.py
users_bp = Blueprint('users', __name__)

@users_bp.get('/<int:user_id>')
def get_user(user_id: int):
    user = db.get_or_404(User, user_id)
    return UserSchema().dump(user)
```

---

## Anti-Patterns

- Using the app context globally — use the application factory pattern
- Logic in route functions — delegate to service functions
- No schema validation — always validate with Marshmallow or Pydantic
- Not using blueprints — all routes in one file doesn't scale
- Returning raw exceptions — always return JSON error responses

---

## Detector Files

- `requirements.txt` or `pyproject.toml` containing `flask`
```

- [ ] **Step 7: Verify all 6 framework profiles**

```bash
ls stack-profiles/react.md stack-profiles/angular.md stack-profiles/nextjs.md stack-profiles/nestjs.md stack-profiles/django.md stack-profiles/flask.md
```

- [ ] **Step 8: Commit**

```bash
git add stack-profiles/react.md stack-profiles/angular.md stack-profiles/nextjs.md stack-profiles/nestjs.md stack-profiles/django.md stack-profiles/flask.md
git commit -m "feat: add framework stack profiles (React, Angular, Next.js, NestJS, Django, Flask)"
```

---

## Task 8: Project Template

**Files:**
- Create: `project-template/CLAUDE.md`
- Create: `project-template/.claude/settings.json`
- Create: `project-template/.claude/commands/spec.md`
- Create: `project-template/.claude/commands/plan.md`
- Create: `project-template/.claude/commands/review.md`
- Create: `project-template/.claude/commands/debug.md`
- Create: `project-template/.claude/commands/refactor.md`
- Create: `project-template/.claude/commands/test.md`
- Create: `project-template/.claude/commands/docs.md`
- Create: `project-template/.claude/memory/project.md`

- [ ] **Step 1: Create project-template/CLAUDE.md**

```markdown
# Project Claude Configuration

Extends global CLAUDE.md. Project-specific rules take precedence over global ones.

## Project Identity

<!-- Fill in when installing:
name: [project name]
stack: [detected by /stack]
language: [optional override, e.g., "es" for Spanish responses]
-->

## Architecture Notes

<!-- Key architectural decisions for this project -->

## Conventions

<!-- Project-specific conventions that override _base.md defaults -->

## Out of Scope

<!-- Things Claude should not touch in this project -->

## Active Stack Profiles

<!-- Set by /stack. Example:
- typescript
- nextjs
- _multi-stack (if applicable)
-->
```

- [ ] **Step 2: Create project-template/.claude/settings.json**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|create_file|write_file",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/pre-tool-use.sh"
          }
        ]
      }
    ],
    "PostCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/post-compact.sh"
          }
        ]
      }
    ]
  },
  "permissions": {
    "allow": [],
    "deny": []
  }
}
```

- [ ] **Step 3: Create project-template/.claude/commands/spec.md**

```markdown
Search the codebase for existing code related to `$ARGUMENTS` before asking any questions.

Run: `grep -r "$ARGUMENTS" src/ --include="*.{ts,js,py,java,go,rs}" -l 2>/dev/null | head -20`

Then ask only for missing context. You need to understand:
1. **Problem** — what is broken or missing?
2. **User** — who is affected and what do they expect?
3. **Constraints** — performance, security, backward compatibility?
4. **Similar features** — anything in the codebase to stay consistent with?

Generate a spec with these sections:

## Problem
[What is broken or missing, from the user's perspective]

## Solution
[What will be built, one paragraph]

## Behavior

### Main path
[Step-by-step: what happens in the happy path]

### Alternative paths
[Edge cases the user might hit]

### Error cases
[What happens when things go wrong]

## Acceptance Criteria
- [ ] [Testable criterion]
- [ ] [Testable criterion]

## Out of Scope
[Explicitly list what this spec does NOT cover]

## System Impact
[What existing code will be affected or needs to be reviewed]

## Complexity Estimate
[S / M / L — with one sentence justification]

---

Wait for explicit approval before proceeding to `/plan`.

Once approved, append a summary to `.claude/memory/project.md` under:
`## Spec: [name] [YYYY-MM-DD]`
```

- [ ] **Step 4: Create project-template/.claude/commands/plan.md**

```markdown
Require an approved spec before starting. If no spec is in `.claude/memory/project.md` or in the recent conversation, stop and say:
"No approved spec found. Run `/spec [name]` first."

Read `.claude/memory/project.md` and this project's `CLAUDE.md` before doing anything else.

**Map the codebase structure** before reading any file content:
- List directories
- Identify files related to the spec using grep, not reads
- Note existing patterns to follow

**Generate a plan with:**

## Ordered Steps

Each step must include:
- Exact file path(s)
- Action (create / modify / delete)
- What changes and why
- Whether it has a dependency on a previous step

## Test List
- [ ] Unit tests for [unit]
- [ ] Integration test for [seam]
- [ ] E2E test if UI is affected

## Commit Order
[Which steps to group into commits]

## Identified Risks
[What could go wrong and how to catch it early]

---

Execute one step at a time. Confirm between steps unless the developer explicitly says to proceed without confirmation.
```

- [ ] **Step 5: Create project-template/.claude/commands/review.md**

```markdown
Determine what to review:
- No argument → `git diff HEAD`
- File path → review that file
- Directory → review all changed files in that directory

Review in three layers:

### 🔴 Critical — Blocks merge
Issues that will cause bugs, security vulnerabilities, data loss, or breaking changes:
- Logic errors or incorrect algorithm
- SQL injection, XSS, hardcoded secrets, missing auth checks
- Mutations that bypass validation
- Breaking changes to public API without versioning

### 🟡 Important — Must fix before shipping
Issues that degrade quality or create risk:
- Missing error handling for real failure cases
- Missing tests for new behavior
- Convention violations that will confuse future readers
- N+1 queries or obvious performance problems
- Missing input validation at system boundaries

### 🟢 Suggestions — Optional improvements
Style, clarity, or minor improvements that would be nice but don't block the merge.

---

**Verdict:**
- `APPROVED` — no critical or important issues
- `APPROVED WITH CHANGES` — important issues found, fix before shipping
- `BLOCKED` — critical issues found, do not merge

After showing the report, offer:
"Want me to auto-fix the critical and important issues?"
```

- [ ] **Step 6: Create project-template/.claude/commands/debug.md**

```markdown
Characterize the problem before investigating:

**Symptom:** [what is observed]
**Expected:** [what should happen]
**Reproduction:** [exact steps to reproduce]
**Frequency:** [always / intermittent / only under condition X]
**Context:** [environment, recent changes, logs]

List 2–4 hypotheses ordered by probability. Present them and confirm which to investigate first before touching any code.

For visual bugs or UI flow problems, activate Playwright MCP:
"This looks like a visual/UI issue. I'll use Playwright MCP to inspect it — confirm?"

**Investigation:**
- Use grep to locate relevant code — never read whole files
- Read only the sections that match the hypothesis
- Check git log for recent changes to the area

**Report:**
- Root cause: [file:line]
- Why it happens: [explanation]
- Impact: [what else could be affected]
- Proposed fix: [exact change]

Apply the fix only after the developer confirms. After fixing, suggest a test that would have caught this bug.
```

- [ ] **Step 7: Create project-template/.claude/commands/refactor.md**

```markdown
Diagnose the target file or module:

**Complexity issues found:**
- Functions over 30 lines: [list with line numbers]
- Nesting over 3 levels: [list with line numbers]
- Classes with 5+ dependencies: [list]
- Layers that only delegate: [list]
- Misleading names: [list]

Generate a refactor plan: ordered list of changes, one per step.

For each step:
- What changes (exact file:line range)
- Why (complexity signal it resolves)
- Risk (what could break)

**Execute one change at a time.** After each:
1. Run the test suite
2. Report: tests passed / failed
3. Confirm before the next step

**Final report:**
- Before: [line count, complexity metrics]
- After: [line count, complexity metrics]
- Test status: [passed / N failed]
```

- [ ] **Step 8: Create project-template/.claude/commands/test.md**

```markdown
Analyze coverage gaps first. Run:
```bash
# language-specific coverage command
# e.g.: pnpm test --coverage | tail -20
# e.g.: pytest --cov=src --cov-report=term-missing
```

Identify what is untested. Prioritize:
1. Public functions and API endpoints with no tests
2. Error paths and edge cases in critical paths
3. Integration points between modules

**Strategy:**
- Unit: logic with no I/O dependencies
- Integration: modules that talk to a database, API, or file system
- E2E: user-facing flows (use Playwright)

**All tests use AAA structure:**
```
// Arrange
// Act
// Assert
```

**Test names:** "should [expected behavior] when [condition]"

**For E2E with Playwright:**
1. Confirm the app is running: `curl -f http://localhost:3000 || echo "App not running"`
2. Navigate to the relevant page
3. Interact with the UI to trigger the flow
4. Capture a screenshot
5. Generate the Playwright test

**Run tests after writing them.** Confirm before running.

**Report:**
- Passed: N
- Failed: N (with failure messages)
- Skipped: N
- Coverage delta: before → after (if available)
```

- [ ] **Step 9: Create project-template/.claude/commands/docs.md**

```markdown
Audit existing docs first:
- Run: `grep -r "TODO\|FIXME\|@deprecated" src/ --include="*.{ts,js,py,java,go,rs}" -l`
- Check if public functions and classes already have doc comments
- Identify the highest-impact gaps (public API, core modules)

**Inline doc format by language:**

TypeScript/JavaScript — JSDoc:
```typescript
/**
 * Finds a user by their unique identifier.
 * Returns null when no matching user exists — callers must handle this case.
 */
function getUserById(id: string): User | null { ... }
```

Python — docstrings:
```python
def get_user_by_id(user_id: str) -> User | None:
    """
    Find a user by their unique identifier.

    Returns None when no matching user exists — callers must handle this case.
    """
```

Java — JavaDoc:
```java
/**
 * Finds a user by their unique identifier.
 * Returns {@code Optional.empty()} when no matching user exists.
 */
Optional<User> getUserById(String id);
```

Go — GoDoc:
```go
// GetUserByID returns the user with the given ID.
// Returns ErrNotFound if no matching user exists.
func GetUserByID(ctx context.Context, id string) (User, error) { ... }
```

**Rule:** Document WHY (non-obvious behavior, side effects, callers' responsibilities), not WHAT (the function name already says that).

Preview all doc changes before writing to files. Show a diff of what will be added.
```

- [ ] **Step 10: Create project-template/.claude/memory/project.md**

```markdown
# Project Memory

Shared team memory. Committed to git. Updated automatically by /checkpoint.

## Stack
<!-- Set by /stack -->

## Architecture Decisions
<!-- Append by /checkpoint. Never delete entries. -->

## Active Conventions
<!-- Project-specific conventions established in this codebase -->

## Technical Debt
<!-- Known shortcuts, limitations, and deferred work -->

## Workarounds
<!-- Non-obvious solutions and why they exist -->
```

- [ ] **Step 11: Verify all 10 files**

```bash
ls \
  project-template/CLAUDE.md \
  project-template/.claude/settings.json \
  project-template/.claude/commands/spec.md \
  project-template/.claude/commands/plan.md \
  project-template/.claude/commands/review.md \
  project-template/.claude/commands/debug.md \
  project-template/.claude/commands/refactor.md \
  project-template/.claude/commands/test.md \
  project-template/.claude/commands/docs.md \
  project-template/.claude/memory/project.md
```

- [ ] **Step 12: Commit**

```bash
git add project-template/
git commit -m "feat: add project template with CLAUDE.md, settings, commands, and memory"
```

---

## Task 9: Hooks

**Files:**
- Create: `project-template/.claude/hooks/pre-tool-use.sh`
- Create: `project-template/.claude/hooks/post-compact.sh`

- [ ] **Step 1: Create project-template/.claude/hooks/pre-tool-use.sh**

```bash
#!/usr/bin/env bash
# Blocks duplicate file creation. Triggered before Write/Edit tool calls.

set -euo pipefail

# Extract file path from CLAUDE_TOOL_INPUT env var (JSON)
FILE_PATH=""
if [ -n "${CLAUDE_TOOL_INPUT:-}" ]; then
  FILE_PATH=$(echo "$CLAUDE_TOOL_INPUT" | grep -o '"path":"[^"]*"' | head -1 | sed 's/"path":"//;s/"//')
fi

# If we couldn't extract the path, don't block (fail open)
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# If file doesn't exist, allow the write
if [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

# File exists — print warning and block
LINE_COUNT=$(wc -l < "$FILE_PATH" 2>/dev/null || echo "?")
LAST_MODIFIED=$(date -r "$FILE_PATH" "+%Y-%m-%d %H:%M" 2>/dev/null || stat -c "%y" "$FILE_PATH" 2>/dev/null | cut -d. -f1 || echo "unknown")

echo ""
echo "⚠️  FILE ALREADY EXISTS"
echo "   Path:          $FILE_PATH"
echo "   Lines:         $LINE_COUNT"
echo "   Last modified: $LAST_MODIFIED"
echo ""
echo "   Choose an action:"
echo "   1. Edit the existing file instead of overwriting"
echo "   2. Confirm you want to overwrite (re-issue the command)"
echo "   3. Cancel"
echo ""

exit 1
```

- [ ] **Step 2: Create project-template/.claude/hooks/post-compact.sh**

```bash
#!/usr/bin/env bash
# Reminds the developer to checkpoint after /compact compresses the conversation.

set -euo pipefail

MEMORY_FILE=".claude/memory/project.md"

echo ""
echo "📦 Conversation compacted."

if [ -f "$MEMORY_FILE" ]; then
  LAST_CHECKPOINT=$(grep "## Checkpoint" "$MEMORY_FILE" | tail -1 || echo "")
  if [ -n "$LAST_CHECKPOINT" ]; then
    echo "   Last checkpoint: $LAST_CHECKPOINT"
  else
    echo "   No checkpoints recorded yet in project.md."
  fi
else
  echo "   No project.md found at $MEMORY_FILE."
fi

echo ""
echo "   💡 If this session had important decisions or conventions,"
echo "      run /checkpoint before continuing."
echo ""

exit 0
```

- [ ] **Step 3: Make both scripts executable**

```bash
chmod +x project-template/.claude/hooks/pre-tool-use.sh
chmod +x project-template/.claude/hooks/post-compact.sh
```

- [ ] **Step 4: Verify**

```bash
ls -l project-template/.claude/hooks/
```
Expected: both files with execute bit set (`-rwxr-xr-x`)

- [ ] **Step 5: Commit**

```bash
git add project-template/.claude/hooks/
git commit -m "feat: add pre-tool-use and post-compact hooks"
```

---

## Task 10: Installers

**Files:**
- Create: `install.sh`
- Create: `install.ps1`

- [ ] **Step 1: Create install.sh**

```bash
#!/usr/bin/env bash
# code-conductor installer — macOS and Linux
# Usage: curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/code-conductor/main/install.sh | bash
#        bash install.sh --project     (also install project template)
#        bash install.sh --no-deps     (skip dependency installation)

set -euo pipefail

REPO="YOUR_ORG/code-conductor"
BRANCH="main"
BASE_URL="https://raw.githubusercontent.com/${REPO}/${BRANCH}"
GLOBAL_DIR="${HOME}/.claude"
INSTALL_PROJECT=false
SKIP_DEPS=false
FAILED_DEPS=()

# ── Parse flags ──────────────────────────────────────────────────────────────
for arg in "$@"; do
  case $arg in
    --project|-project) INSTALL_PROJECT=true ;;
    --no-deps)           SKIP_DEPS=true ;;
  esac
done

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC}  $1"; }
err()  { echo -e "${RED}✗${NC} $1"; }
info() { echo -e "${BLUE}→${NC} $1"; }

echo ""
echo "  code-conductor installer"
echo "  ─────────────────────────"
echo ""

# ── Runtime detection ─────────────────────────────────────────────────────────
HAS_NODE=false
HAS_PYTHON=false
NODE_VERSION=""

if command -v node &>/dev/null; then
  NODE_VERSION=$(node --version | sed 's/v//')
  MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
  if [ "$MAJOR" -ge 18 ]; then
    HAS_NODE=true
    ok "Node.js ${NODE_VERSION} detected"
  else
    warn "Node.js ${NODE_VERSION} found but version 18+ is required"
  fi
fi

if command -v python3 &>/dev/null; then
  HAS_PYTHON=true
  ok "Python 3 detected"
fi

# ── Auto-install Node if missing ───────────────────────────────────────────────
if [ "$HAS_NODE" = false ]; then
  info "Node.js 18+ not found. Attempting to install..."

  if [[ "$OSTYPE" == "darwin"* ]]; then
    if command -v brew &>/dev/null; then
      info "Installing via Homebrew..."
      brew install node && HAS_NODE=true
    elif command -v nvm &>/dev/null || [ -f "${HOME}/.nvm/nvm.sh" ]; then
      # shellcheck source=/dev/null
      source "${HOME}/.nvm/nvm.sh"
      nvm install --lts && nvm use --lts && HAS_NODE=true
    else
      warn "Neither Homebrew nor nvm found. Install Node.js 18+ manually: https://nodejs.org"
    fi
  else
    if command -v nvm &>/dev/null || [ -f "${HOME}/.nvm/nvm.sh" ]; then
      # shellcheck source=/dev/null
      source "${HOME}/.nvm/nvm.sh"
      nvm install --lts && nvm use --lts && HAS_NODE=true
    elif command -v apt-get &>/dev/null; then
      curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
      sudo apt-get install -y nodejs && HAS_NODE=true
    elif command -v dnf &>/dev/null; then
      sudo dnf install -y nodejs && HAS_NODE=true
    elif command -v pacman &>/dev/null; then
      sudo pacman -Sy --noconfirm nodejs npm && HAS_NODE=true
    else
      warn "Could not detect package manager. Install Node.js 18+ manually: https://nodejs.org"
    fi
  fi
fi

if [ "$HAS_NODE" = false ] && [ "$HAS_PYTHON" = false ]; then
  err "Neither Node.js 18+ nor Python 3 could be installed."
  echo ""
  echo "  Please install at least one:"
  echo "  • Node.js 18+: https://nodejs.org"
  echo "  • Python 3:    https://python.org"
  exit 1
fi

# ── Dependency installation ────────────────────────────────────────────────────
install_dep() {
  local name="$1"
  local cmd="$2"
  info "Installing ${name}..."
  if eval "$cmd" &>/dev/null; then
    ok "${name} installed"
  else
    warn "${name} failed — manual install: ${cmd}"
    FAILED_DEPS+=("$name: $cmd")
  fi
}

if [ "$SKIP_DEPS" = false ]; then
  echo ""
  info "Installing dependencies..."
  echo ""

  [ "$HAS_NODE" = true ] && install_dep "claude-mem" "npx claude-mem install"

  if [ "$HAS_NODE" = true ] && [ "$HAS_PYTHON" = true ]; then
    install_dep "ui-ux-pro-max-skill" "npm install -g uipro-cli && uipro init --ai claude --global"
  else
    warn "ui-ux-pro-max-skill requires both Node and Python — skipped"
    FAILED_DEPS+=("ui-ux-pro-max-skill: npm install -g uipro-cli && uipro init --ai claude --global")
  fi

  if command -v claude &>/dev/null; then
    install_dep "Playwright MCP" "claude mcp add playwright npx @playwright/mcp@latest"
    install_dep "Superpowers" "claude plugin install superpowers@claude-plugins-official"
    install_dep "code-simplifier" "claude plugin install code-simplifier@claude-plugins-official"
  else
    warn "claude CLI not found — Playwright MCP, Superpowers, and code-simplifier need the Claude Code CLI"
    FAILED_DEPS+=(
      "Playwright MCP: claude mcp add playwright npx @playwright/mcp@latest"
      "Superpowers: claude plugin install superpowers@claude-plugins-official"
      "code-simplifier: claude plugin install code-simplifier@claude-plugins-official"
    )
  fi
fi

# ── Download helper ────────────────────────────────────────────────────────────
download() {
  local src="$1"
  local dest="$2"
  local overwrite="${3:-true}"

  if [ "$overwrite" = false ] && [ -f "$dest" ]; then
    info "Skipped (already exists): $dest"
    return
  fi

  mkdir -p "$(dirname "$dest")"
  if curl -fsSL "${BASE_URL}/${src}" -o "$dest"; then
    ok "Downloaded: $dest"
  else
    warn "Failed to download: $src"
  fi
}

# ── Install global files ───────────────────────────────────────────────────────
echo ""
info "Installing global Claude files to ${GLOBAL_DIR}..."
echo ""

mkdir -p "${GLOBAL_DIR}/commands" "${GLOBAL_DIR}/memory"

# User-configured files — skip if exist
download "global/CLAUDE.md"           "${GLOBAL_DIR}/CLAUDE.md"           false
download "global/settings.json"        "${GLOBAL_DIR}/settings.json"        false
download "global/memory/personal.md"   "${GLOBAL_DIR}/memory/personal.md"   false

# Agent-managed files — always overwrite
download "global/commands/checkpoint.md" "${GLOBAL_DIR}/commands/checkpoint.md"
download "global/commands/stack.md"      "${GLOBAL_DIR}/commands/stack.md"
download "global/commands/lang.md"       "${GLOBAL_DIR}/commands/lang.md"
download "skills/code-simplifier.md"    "${GLOBAL_DIR}/skills/code-simplifier.md"
download "skills/ui-ux.md"              "${GLOBAL_DIR}/skills/ui-ux.md"

for profile in _base _multi-stack _template javascript typescript python java go rust react angular nextjs nestjs django flask; do
  download "stack-profiles/${profile}.md" "${GLOBAL_DIR}/stack-profiles/${profile}.md"
done

# ── Install project template ───────────────────────────────────────────────────
if [ "$INSTALL_PROJECT" = true ]; then
  echo ""
  info "Installing project template into current directory..."
  echo ""

  PROJ_DIR=".claude"
  mkdir -p "${PROJ_DIR}/commands" "${PROJ_DIR}/hooks" "${PROJ_DIR}/memory"

  download "project-template/CLAUDE.md"                  "CLAUDE.md"                            false
  download "project-template/.claude/settings.json"      "${PROJ_DIR}/settings.json"            false
  download "project-template/.claude/memory/project.md"  "${PROJ_DIR}/memory/project.md"        false

  for cmd in spec plan review debug refactor test docs; do
    download "project-template/.claude/commands/${cmd}.md" "${PROJ_DIR}/commands/${cmd}.md"
  done

  download "project-template/.claude/hooks/pre-tool-use.sh"  "${PROJ_DIR}/hooks/pre-tool-use.sh"
  download "project-template/.claude/hooks/post-compact.sh"  "${PROJ_DIR}/hooks/post-compact.sh"

  chmod +x "${PROJ_DIR}/hooks/pre-tool-use.sh" "${PROJ_DIR}/hooks/post-compact.sh"

  # Update .gitignore
  GITIGNORE=".gitignore"
  ENTRY=".claude/memory/personal.md"
  if [ ! -f "$GITIGNORE" ] || ! grep -qF "$ENTRY" "$GITIGNORE"; then
    echo "$ENTRY" >> "$GITIGNORE"
    ok "Added $ENTRY to .gitignore"
  fi
fi

# ── Final report ───────────────────────────────────────────────────────────────
echo ""
echo "  ─────────────────────────────────────────"
echo "  code-conductor installed"
echo "  ─────────────────────────────────────────"
echo ""
echo "  Global commands (all projects):"
echo "    /checkpoint  /stack  /lang"
echo ""
if [ "$INSTALL_PROJECT" = true ]; then
  echo "  Project commands (this project):"
  echo "    /spec  /plan  /review  /debug  /refactor  /test  /docs"
  echo ""
fi

if [ ${#FAILED_DEPS[@]} -gt 0 ]; then
  echo ""
  warn "Some items need manual installation:"
  for item in "${FAILED_DEPS[@]}"; do
    echo "    $item"
  done
fi

echo ""
```

- [ ] **Step 2: Create install.ps1**

```powershell
# code-conductor installer — Windows (PowerShell)
# Usage: irm https://raw.githubusercontent.com/YOUR_ORG/code-conductor/main/install.ps1 | iex
#        .\install.ps1 -Project        (also install project template)
#        .\install.ps1 -NoDeps         (skip dependency installation)

param(
  [switch]$Project,
  [switch]$NoDeps
)

$REPO       = "YOUR_ORG/code-conductor"
$BRANCH     = "main"
$BASE_URL   = "https://raw.githubusercontent.com/$REPO/$BRANCH"
$GLOBAL_DIR = "$env:USERPROFILE\.claude"
$FailedDeps = @()

function Write-Ok   { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "  [!!] $msg" -ForegroundColor Yellow }
function Write-Err  { param($msg) Write-Host "  [XX] $msg" -ForegroundColor Red }
function Write-Info { param($msg) Write-Host "   ->  $msg" -ForegroundColor Cyan }

Write-Host ""
Write-Host "  code-conductor installer" -ForegroundColor Cyan
Write-Host "  ─────────────────────────"
Write-Host ""

# ── Runtime detection ──────────────────────────────────────────────────────────
$HasNode   = $false
$HasPython = $false

$nodePath = Get-Command node -ErrorAction SilentlyContinue
if ($nodePath) {
  $nodeVersion = (node --version).TrimStart('v')
  $major = [int]($nodeVersion.Split('.')[0])
  if ($major -ge 18) {
    $HasNode = $true
    Write-Ok "Node.js $nodeVersion detected"
  } else {
    Write-Warn "Node.js $nodeVersion found but version 18+ is required"
  }
}

if (Get-Command python3 -ErrorAction SilentlyContinue) {
  $HasPython = $true
  Write-Ok "Python 3 detected"
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  $v = (python --version 2>&1)
  if ($v -match '^Python 3') {
    $HasPython = $true
    Write-Ok "Python 3 detected"
  }
}

# ── Auto-install Node if missing ────────────────────────────────────────────────
if (-not $HasNode) {
  Write-Info "Node.js 18+ not found. Attempting to install via winget..."
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    if (Get-Command node -ErrorAction SilentlyContinue) { $HasNode = $true }
  } else {
    Write-Warn "winget not found. Install Node.js 18+ manually: https://nodejs.org"
  }
}

if (-not $HasNode -and -not $HasPython) {
  Write-Err "Neither Node.js 18+ nor Python 3 could be installed."
  Write-Host ""
  Write-Host "  Please install at least one:"
  Write-Host "  - Node.js 18+: https://nodejs.org"
  Write-Host "  - Python 3:    https://python.org"
  exit 1
}

# ── Dependency installation ────────────────────────────────────────────────────
function Install-Dep {
  param([string]$Name, [string]$Cmd)
  Write-Info "Installing $Name..."
  try {
    Invoke-Expression $Cmd 2>&1 | Out-Null
    Write-Ok "$Name installed"
  } catch {
    Write-Warn "$Name failed — manual install: $Cmd"
    $script:FailedDeps += "${Name}: ${Cmd}"
  }
}

if (-not $NoDeps) {
  Write-Host ""
  Write-Info "Installing dependencies..."
  Write-Host ""

  if ($HasNode) { Install-Dep "claude-mem" "npx claude-mem install" }

  if ($HasNode -and $HasPython) {
    Install-Dep "ui-ux-pro-max-skill" "npm install -g uipro-cli; uipro init --ai claude --global"
  } else {
    Write-Warn "ui-ux-pro-max-skill requires both Node and Python — skipped"
    $FailedDeps += "ui-ux-pro-max-skill: npm install -g uipro-cli; uipro init --ai claude --global"
  }

  if (Get-Command claude -ErrorAction SilentlyContinue) {
    Install-Dep "Playwright MCP" "claude mcp add playwright npx @playwright/mcp@latest"
    Install-Dep "Superpowers"    "claude plugin install superpowers@claude-plugins-official"
    Install-Dep "code-simplifier" "claude plugin install code-simplifier@claude-plugins-official"
  } else {
    Write-Warn "claude CLI not found — Playwright MCP, Superpowers, and code-simplifier need the Claude Code CLI"
    $FailedDeps += "Playwright MCP: claude mcp add playwright npx @playwright/mcp@latest"
    $FailedDeps += "Superpowers: claude plugin install superpowers@claude-plugins-official"
    $FailedDeps += "code-simplifier: claude plugin install code-simplifier@claude-plugins-official"
  }
}

# ── Download helper ────────────────────────────────────────────────────────────
function Download-File {
  param([string]$Src, [string]$Dest, [bool]$Overwrite = $true)

  if (-not $Overwrite -and (Test-Path $Dest)) {
    Write-Info "Skipped (already exists): $Dest"
    return
  }

  $dir = Split-Path $Dest -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

  try {
    Invoke-WebRequest -Uri "$BASE_URL/$Src" -OutFile $Dest -UseBasicParsing
    Write-Ok "Downloaded: $Dest"
  } catch {
    Write-Warn "Failed to download: $Src"
  }
}

# ── Install global files ───────────────────────────────────────────────────────
Write-Host ""
Write-Info "Installing global Claude files to $GLOBAL_DIR..."
Write-Host ""

foreach ($sub in "commands", "memory", "skills", "stack-profiles") {
  New-Item -ItemType Directory -Path "$GLOBAL_DIR\$sub" -Force | Out-Null
}

# User-configured — skip if exist
Download-File "global/CLAUDE.md"         "$GLOBAL_DIR\CLAUDE.md"         $false
Download-File "global/settings.json"      "$GLOBAL_DIR\settings.json"      $false
Download-File "global/memory/personal.md" "$GLOBAL_DIR\memory\personal.md" $false

# Agent-managed — always overwrite
Download-File "global/commands/checkpoint.md" "$GLOBAL_DIR\commands\checkpoint.md"
Download-File "global/commands/stack.md"      "$GLOBAL_DIR\commands\stack.md"
Download-File "global/commands/lang.md"       "$GLOBAL_DIR\commands\lang.md"
Download-File "skills/code-simplifier.md"    "$GLOBAL_DIR\skills\code-simplifier.md"
Download-File "skills/ui-ux.md"              "$GLOBAL_DIR\skills\ui-ux.md"

foreach ($profile in @("_base","_multi-stack","_template","javascript","typescript","python","java","go","rust","react","angular","nextjs","nestjs","django","flask")) {
  Download-File "stack-profiles/$profile.md" "$GLOBAL_DIR\stack-profiles\$profile.md"
}

# ── Install project template ───────────────────────────────────────────────────
if ($Project) {
  Write-Host ""
  Write-Info "Installing project template into current directory..."
  Write-Host ""

  $projDir = ".claude"
  foreach ($sub in "commands", "hooks", "memory") {
    New-Item -ItemType Directory -Path "$projDir\$sub" -Force | Out-Null
  }

  Download-File "project-template/CLAUDE.md"                 "CLAUDE.md"                      $false
  Download-File "project-template/.claude/settings.json"     "$projDir\settings.json"          $false
  Download-File "project-template/.claude/memory/project.md" "$projDir\memory\project.md"      $false

  foreach ($cmd in @("spec","plan","review","debug","refactor","test","docs")) {
    Download-File "project-template/.claude/commands/$cmd.md" "$projDir\commands\$cmd.md"
  }

  Download-File "project-template/.claude/hooks/pre-tool-use.sh"  "$projDir\hooks\pre-tool-use.sh"
  Download-File "project-template/.claude/hooks/post-compact.sh"  "$projDir\hooks\post-compact.sh"

  # Update .gitignore
  $gitignore = ".gitignore"
  $entry = ".claude/memory/personal.md"
  if (-not (Test-Path $gitignore) -or -not (Select-String -Path $gitignore -Pattern ([regex]::Escape($entry)) -Quiet)) {
    Add-Content -Path $gitignore -Value $entry
    Write-Ok "Added $entry to .gitignore"
  }
}

# ── Final report ───────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ─────────────────────────────────────────"
Write-Host "  code-conductor installed" -ForegroundColor Green
Write-Host "  ─────────────────────────────────────────"
Write-Host ""
Write-Host "  Global commands (all projects):"
Write-Host "    /checkpoint  /stack  /lang"
Write-Host ""
if ($Project) {
  Write-Host "  Project commands (this project):"
  Write-Host "    /spec  /plan  /review  /debug  /refactor  /test  /docs"
  Write-Host ""
}

if ($FailedDeps.Count -gt 0) {
  Write-Host ""
  Write-Warn "Some items need manual installation:"
  foreach ($item in $FailedDeps) {
    Write-Host "    $item"
  }
}

Write-Host ""
```

- [ ] **Step 3: Make install.sh executable**

```bash
chmod +x install.sh
```

- [ ] **Step 4: Verify**

```bash
ls -l install.sh install.ps1
```
Expected: `install.sh` with execute bit, `install.ps1` present

- [ ] **Step 5: Commit**

```bash
git add install.sh install.ps1
git commit -m "feat: add install.sh and install.ps1 with identical behavior"
```

---

## Task 11: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create README.md**

````markdown
# code-conductor

A structured, token-efficient Claude Code configuration for every project.

---

## Install

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/code-conductor/main/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/YOUR_ORG/code-conductor/main/install.ps1 | iex
```

### Add to a project

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/code-conductor/main/install.sh | bash -s -- --project

# Windows
irm https://raw.githubusercontent.com/YOUR_ORG/code-conductor/main/install.ps1 | iex; .\install.ps1 -Project
```

### Flags

| Flag | Description |
|------|-------------|
| `--project` / `-Project` | Also install project template into current directory |
| `--no-deps` | Skip dependency installation, agent files only |

### Update

Re-run the same install command. User-configured files are never overwritten; agent-managed files are always updated.

---

## What This Solves

| Problem | Solution |
|---------|----------|
| Claude rewrites existing files without checking | `pre-tool-use` hook blocks overwrites, shows 3 options |
| No consistent workflow across projects | Global CLAUDE.md enforces `/spec → /plan → confirm → implement` |
| Token waste from reading whole files | Mandatory grep-before-read rule in global CLAUDE.md |
| Context lost after `/compact` | `post-compact` hook reminds to `/checkpoint` |
| Different conventions per developer | Team `project.md` in git; personal `personal.md` local only |
| Starting from scratch with each stack | `/stack` detects and loads language/framework profiles |
| Responses in wrong language | `/lang` switches response language per session |

---

## Available Commands

### Global (all projects)

| Command | Description |
|---------|-------------|
| `/checkpoint` | Save decisions, conventions, and debt from this session to memory |
| `/stack` | Detect project stack and load matching profiles |
| `/lang [code]` | Switch response language for this session |

### Project (requires `--project` install)

| Command | Description |
|---------|-------------|
| `/spec [name]` | Define a feature spec and get approval before planning |
| `/plan` | Generate an ordered implementation plan with file paths |
| `/review [file\|dir]` | Review code in three layers: Critical / Important / Suggestion |
| `/debug [problem]` | Characterize, hypothesize, investigate, fix |
| `/refactor [file\|module]` | Diagnose complexity and refactor one step at a time |
| `/test [scope]` | Analyze coverage gaps and write + run tests |
| `/docs [scope]` | Audit and write inline documentation |

---

## Language Support

| Priority | Source | How to set |
|----------|--------|------------|
| 1 (highest) | Session | `/lang [code]` |
| 2 | Project | `language:` in project `CLAUDE.md` |
| 3 | Personal | `response_language:` in `personal.md` |
| 4 (default) | Global | English |

**Supported codes:** `en` `es` `pt` `fr` `de` `it` `zh` `ja` `ko`

Code identifiers, file names, and commit messages are always English.

---

## Stack Profiles

| Profile | Detected by |
|---------|-------------|
| `javascript` | `package.json` (no TypeScript) |
| `typescript` | `tsconfig.json` |
| `python` | `requirements.txt`, `pyproject.toml` |
| `java` | `pom.xml`, `build.gradle` |
| `go` | `go.mod` |
| `rust` | `Cargo.toml` |
| `react` | `package.json` → `react` dep (no `next`) |
| `angular` | `angular.json` |
| `nextjs` | `next.config.js` / `next.config.ts` |
| `nestjs` | `package.json` → `@nestjs/core` |
| `django` | `manage.py` + `django` in deps |
| `flask` | `flask` in deps |

---

## Memory Architecture

```
~/.claude/
  memory/
    personal.md     ← local only, never committed
                       dev preferences, shortcuts

project-root/
  .claude/
    memory/
      project.md    ← in git, shared with team
                       decisions, conventions, debt
```

`/checkpoint` writes to both. `/stack` reads `project.md` to skip re-detection.

---

## File Structure

```
code-conductor/
├── README.md
├── .gitignore
├── install.sh                    macOS/Linux
├── install.ps1                   Windows
├── global/
│   ├── CLAUDE.md                 Global agent behavior (all projects)
│   ├── settings.json
│   ├── commands/
│   │   ├── checkpoint.md         /checkpoint
│   │   ├── stack.md              /stack
│   │   └── lang.md               /lang
│   └── memory/
│       └── personal.md           Template (never committed)
├── project-template/
│   ├── CLAUDE.md
│   └── .claude/
│       ├── settings.json
│       ├── commands/
│       │   ├── spec.md           /spec
│       │   ├── plan.md           /plan
│       │   ├── review.md         /review
│       │   ├── debug.md          /debug
│       │   ├── refactor.md       /refactor
│       │   ├── test.md           /test
│       │   └── docs.md           /docs
│       ├── hooks/
│       │   ├── pre-tool-use.sh   Blocks duplicate file creation
│       │   └── post-compact.sh   Checkpoint reminder after /compact
│       └── memory/
│           └── project.md        Shared team memory (in git)
├── stack-profiles/
│   ├── _base.md
│   ├── _multi-stack.md
│   ├── _template.md
│   ├── javascript.md
│   ├── typescript.md
│   ├── python.md
│   ├── java.md
│   ├── go.md
│   ├── rust.md
│   ├── react.md
│   ├── angular.md
│   ├── nextjs.md
│   ├── nestjs.md
│   ├── django.md
│   └── flask.md
└── skills/
    ├── code-simplifier.md        Always active
    └── ui-ux.md                  Activatable for frontend projects
```

---

## .gitignore Note

When installed with `--project`, the installer appends `.claude/memory/personal.md` to your project's `.gitignore`. This keeps personal preferences local and out of the shared repo.
````

- [ ] **Step 2: Verify**

```bash
ls README.md
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README with install, commands, and file structure"
```

---

## Task 12: Final Verification and Initial Commit

- [ ] **Step 1: Count all files**

```bash
find . -type f | grep -v "^./.git/" | sort
```
Expected: 39 files. Count them. If the number is off, compare against the File Map at the top of this plan.

- [ ] **Step 2: Verify execute bits on shell scripts**

```bash
ls -l project-template/.claude/hooks/pre-tool-use.sh project-template/.claude/hooks/post-compact.sh install.sh
```
Expected: all three have `-rwxr-xr-x` (or similar with execute bit set)

- [ ] **Step 3: Verify .gitignore entries**

```bash
cat .gitignore
```
Expected output:
```
.claude/memory/personal.md
*.local
.DS_Store
Thumbs.db
```

- [ ] **Step 4: Create the initial release commit**

```bash
git add --all
git commit -m "feat: initial release — code-conductor v1.0.0"
```

- [ ] **Step 5: Verify the commit**

```bash
git log --oneline
```
Expected: several commits ending with `feat: initial release — code-conductor v1.0.0`

- [ ] **Step 6: Confirm no remote was added**

```bash
git remote -v
```
Expected: no output (user adds remote manually)
