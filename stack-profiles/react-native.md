# React Native Profile

**Detector files:** `package.json` with `react-native` in dependencies

> **Workflow variants** — check which applies before generating code:
> - **Bare React Native** — `react-native` present, no `expo` dependency. `android/` and `ios/` folders exist. Full native code access, Metro bundler, custom native modules.
> - **Expo Managed** — both `expo` and `react-native` present. No native folders until `npx expo prebuild`. Uses EAS Build for production. Package installs must use `npx expo install` to respect SDK version constraints.

---

## Naming Conventions

| Element      | Convention                  | Example                                  |
|--------------|-----------------------------|------------------------------------------|
| Components   | PascalCase                  | `UserCard`, `OrderSummary`               |
| Hooks        | camelCase with `use` prefix | `useUser`, `useNavigation`               |
| Functions    | camelCase                   | `fetchUser`, `formatDate`                |
| Types        | PascalCase                  | `User`, `NavigationParams`               |
| Constants    | UPPER_SNAKE_CASE             | `API_BASE_URL`, `MAX_RETRIES`            |
| Files        | PascalCase for components   | `UserCard.tsx`                           |
| Hook files   | camelCase                   | `useUser.ts`                             |
| Directories  | kebab-case                  | `user-profile/`, `shared/`              |

---

## Standard Project Structure

### Bare React Native

```
src/
├── app/
│   ├── App.tsx               ← root component + NavigationContainer
│   └── navigation/
│       ├── RootNavigator.tsx
│       └── types.ts          ← NavigationParam types
├── features/
│   └── [feature]/
│       ├── components/
│       ├── screens/
│       ├── hooks/
│       └── [feature].service.ts
├── shared/
│   ├── components/
│   ├── hooks/
│   └── utils/
├── store/                    ← Zustand / Redux Toolkit slices
└── theme/
    ├── colors.ts
    └── spacing.ts
__tests__/
android/
ios/
tsconfig.json
package.json
```

### Expo Managed

```
app/                          ← Expo Router file-based navigation
├── (tabs)/
│   ├── index.tsx
│   └── profile.tsx
├── _layout.tsx               ← root layout (replaces NavigationContainer)
└── [id].tsx                  ← dynamic route
components/
constants/
hooks/
assets/
app.json                      ← static Expo config
app.config.ts                 ← dynamic Expo config (use instead of app.json when env-specific values needed)
eas.json                      ← EAS Build / Submit profiles
tsconfig.json
package.json
```

---

## Tooling

### Bare React Native

| Tool            | Name                       | Command                          |
|-----------------|----------------------------|----------------------------------|
| Formatter       | Prettier                   | `pnpm format`                    |
| Linter          | ESLint (RN config)         | `pnpm lint`                      |
| Type checker    | tsc                        | `pnpm typecheck`                 |
| Test runner     | Jest + RNTL                | `pnpm test`                      |
| Bundler         | Metro                      | started by `pnpm start`          |
| Package manager | pnpm                       | `pnpm install`                   |

### Expo Managed (additional / replacement tools)

| Tool            | Name                       | Command                                            |
|-----------------|----------------------------|----------------------------------------------------|
| Dev server      | Expo CLI                   | `npx expo start`                                   |
| Package install | Expo CLI                   | `npx expo install <pkg>`                           |
| Local build     | Expo CLI                   | `npx expo run:android` / `npx expo run:ios`        |
| Cloud build     | EAS CLI                    | `eas build --profile preview --platform all`       |
| OTA update      | EAS CLI                    | `eas update --branch production --message "..."`   |

---

## Common Commands

### Bare React Native

```bash
pnpm install                  # install dependencies
pnpm start                    # start Metro bundler
pnpm android                  # run on Android emulator / device
pnpm ios                      # run on iOS simulator (macOS only)
pnpm test                     # run Jest
pnpm typecheck                # run tsc --noEmit
pnpm lint                     # run ESLint
pnpm format                   # run Prettier
```

### Expo Managed

```bash
npx expo install              # install dependencies (respects Expo SDK constraints)
npx expo start                # start Expo dev server (opens QR for Expo Go)
npx expo start --tunnel       # use when device is on a different network
npx expo run:android          # local Android build with native code
npx expo run:ios              # local iOS build (macOS only)
npx expo prebuild             # generate android/ and ios/ folders
eas build --profile preview --platform android   # cloud build
eas build --profile production --platform all    # production build
eas update --branch production --message "fix: auth"  # OTA update
pnpm test                     # run Jest (same as bare)
pnpm typecheck                # run tsc --noEmit
```

---

## Idiomatic Patterns

### Screen With All States Handled (Both Workflows)

```tsx
function UserScreen({ route }: UserScreenProps) {
  const { userId } = route.params;
  const { user, isLoading, error } = useUser(userId);

  if (isLoading) return <LoadingScreen />;
  if (error) return <ErrorScreen message={error.message} />;
  if (!user) return <EmptyScreen />;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <UserCard user={user} />
    </ScrollView>
  );
}
```

### Typed React Navigation Screen (Bare React Native)

```tsx
// navigation/types.ts
export type RootStackParamList = {
  Home: undefined;
  UserProfile: { userId: string };
};

// UserProfileScreen.tsx
type UserScreenProps = NativeStackScreenProps<RootStackParamList, 'UserProfile'>;

function UserProfileScreen({ route, navigation }: UserScreenProps) {
  const { userId } = route.params;
  // ...
}
```

### Expo Router File-Based Navigation (Expo Managed)

```tsx
// app/[id].tsx — dynamic route, no navigator config needed
import { useLocalSearchParams } from 'expo-router';

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, isLoading, error } = useUser(id);

  if (isLoading) return <LoadingScreen />;
  if (error) return <ErrorScreen message={error.message} />;
  return <UserContent user={user!} />;
}

// app/_layout.tsx — root layout
import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colorScheme === 'dark' ? '#000' : '#fff' },
      }}
    />
  );
}
```

### Expo Config for Environment-Specific Values

```ts
// app.config.ts — use when values differ between preview/production
import { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: process.env.APP_ENV === 'production' ? 'MyApp' : 'MyApp (Dev)',
  slug: 'my-app',
  extra: {
    apiBaseUrl: process.env.API_BASE_URL ?? 'https://staging.api.example.com',
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
};

export default config;
```

### Custom Hook Encapsulates Data Fetching (Both Workflows)

```tsx
function useUser(id: string) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    UserService.getUser(id)
      .then((data) => { if (!cancelled) setUser(data); })
      .catch((err) => { if (!cancelled) setError(err); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  return { user, isLoading, error };
}
```

### FlashList for Long Lists (Both Workflows)

```tsx
// Requires: npx expo install @shopify/flash-list (Expo) or pnpm add @shopify/flash-list (bare)
import { FlashList } from '@shopify/flash-list';

<FlashList
  data={items}
  estimatedItemSize={72}
  keyExtractor={(item) => item.id}
  renderItem={({ item }) => <ItemRow item={item} />}
/>
```

### Testing With React Native Testing Library (Both Workflows)

```tsx
it('shows user name after load', async () => {
  render(<UserScreen route={{ params: { userId: '123' } }} />);
  expect(await screen.findByText('Jane Doe')).toBeTruthy();
});
```

---

## Anti-Patterns

### Both Workflows

- Class components — use functional components + hooks only
- Inline `StyleSheet.create` objects in JSX — define styles outside the component
- Anonymous arrow functions as props (`onPress={() => fn()}`) in list items — causes re-render on every parent render; use `useCallback`
- `FlatList` for large datasets — use `FlashList` from `@shopify/flash-list` instead
- `useEffect` for data fetching without a cleanup / cancellation flag — causes setState-on-unmounted-component warnings
- Business logic in screen components — extract to hooks or service classes
- `any` type — use strict TypeScript; enable `"strict": true` in `tsconfig.json`

### Bare React Native Only

- Native module calls without a platform guard — always check `Platform.OS` before calling platform-specific APIs
- Direct `android/` or `ios/` edits without documenting them — undocumented native changes break other contributors

### Expo Managed Only

- Installing packages with `npm install` or `pnpm add` instead of `npx expo install` — breaks Expo SDK version compatibility; always use `npx expo install`
- Hardcoding environment-specific values in `app.json` — use `app.config.ts` with `process.env` instead
- Using `expo eject` — deprecated; use `npx expo prebuild` instead
- Accessing native modules not in the Expo SDK without first running `npx expo prebuild` — silently fails in Expo Go
- Putting EAS project secrets in `app.json` or committing `.env` — use EAS Secrets (`eas secret:create`)

---

## Detector Files

- `package.json` with `react-native` in `dependencies`
- Expo variant: `package.json` with both `react-native` and `expo` in `dependencies`
