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
