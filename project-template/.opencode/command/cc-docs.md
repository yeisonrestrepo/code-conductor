---
description: "(Conductor) Audit and update project documentation"
---

> code-conductor: this command was written for Claude Code. Where it names a Claude Code tool (Read, Grep, Glob, Edit, Write, Bash, Skill, Agent), use your closest equivalent. ` $ARGUMENTS ` and an `ARGUMENTS:` line mean the text the user gave with the command. A space was inserted after some exclamation marks and at signs, and between the arguments placeholder and an adjacent backtick, so OpenCode does not run or attach text; read the text as if the space were not there.


## Release reconciliation - docs (FEAT-036)

Without `--release <ref>` in ` $ARGUMENTS `, skip this section and audit inline docs as below. With it, do not run the inline-docs audit: the `docs` role agent reconciles the user-facing documentation with that shipped release, and this session writes no documentation file.

1. Digest the release from the project root, with the work tree checked out clean at `<ref>`:

   ```sh
   S=.claude/scripts; [ -f "$S/orchestrate.mjs" ] || S=scripts
   node "$S/docs-sync.mjs" digest --release <ref> [--since <ref>]
   ```

   A non-zero exit is a refusal: print its stderr line as it is and stop. Nothing is dispatched.
2. Install the envelope: `node "$S/orchestrate.mjs" envelope docs --item <label>`, where `<label>` is `<ref>` when it matches `[a-zA-Z0-9._-]+`, else `adhoc`. Only a first stdout line that starts with `installed:` allows the dispatch. On anything else, print `docs not dispatched: <the verb's stderr line>` and stop: never write the documentation in this session, which no envelope scopes.
3. Dispatch `Agent({ subagent_type: "docs", description: "reconcile docs", prompt })`. The brief carries the digest's stdout verbatim and says that a phase command, not a run, dispatched the agent, and that the envelope is installed at `.claude/memory/band-envelope.json`.
4. Run `node "$S/orchestrate.mjs" envelope --clear`, also when the agent was denied or ended without a hand-back. If it refuses, report the refusal.
5. Write the agent's report verbatim to `.conductor/handback/docs.txt`, then judge it with the same `--since` as step 1: `node "$S/docs-sync.mjs" check --release <ref> [--since <ref>] < .conductor/handback/docs.txt`.
6. Show the report's `DOCS:` line, the `check` output and `git diff --stat`. On `docs-sync: ok`, the diff is the proposal: the owner reviews and commits it. On a failure, list each failure line and say the diff is left in place; discard it with `git checkout -- <files>`. This command never commits, stages or reverts anything.

---

Audit existing docs first:
- Run: `grep -r "TODO\|FIXME\|@ deprecated" src/ --include="*.{ts,js,py,java,go,rs}" -l`
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
 * Returns {@ code Optional.empty()} when no matching user exists.
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
