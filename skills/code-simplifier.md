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
