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
