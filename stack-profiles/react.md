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
