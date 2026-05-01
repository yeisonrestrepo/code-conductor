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
