---
description: "(Conductor) Audit and update project documentation"
---

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
