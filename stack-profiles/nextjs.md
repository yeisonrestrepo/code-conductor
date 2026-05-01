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
