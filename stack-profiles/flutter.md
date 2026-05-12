# Flutter Profile

**Detector files:** `pubspec.yaml` (single package) or `melos.yaml` (monorepo)

> **Workspace variants** — check which applies before generating code:
> - **Single package** — one `pubspec.yaml` at the root, one Flutter app or library.
> - **Melos monorepo** — `melos.yaml` at the root plus multiple packages each with their own `pubspec.yaml`. Use `melos bootstrap` instead of `flutter pub get`, and `melos run <script>` instead of running `flutter test`/`flutter analyze` per package.
>
> For plain Dart CLI projects without the Flutter SDK, ignore the Widget and Bloc/Riverpod sections.

---

## Naming Conventions

| Element      | Convention           | Example                              |
|--------------|----------------------|--------------------------------------|
| Variables    | lowerCamelCase       | `userId`, `isLoading`                |
| Functions    | lowerCamelCase       | `fetchUser`, `buildCard`             |
| Classes      | UpperCamelCase       | `UserCard`, `AuthBloc`               |
| Widgets      | UpperCamelCase       | `PrimaryButton`, `UserAvatar`        |
| Constants    | lowerCamelCase       | `defaultPadding`, `apiBaseUrl`       |
| Files        | snake_case           | `user_card.dart`, `auth_bloc.dart`   |
| Directories  | snake_case           | `user_profile/`, `shared_widgets/`   |

---

## Standard Project Structure

### Single Package

```
lib/
├── main.dart
├── app.dart                  ← MaterialApp / routing root
├── core/
│   ├── constants/
│   ├── theme/
│   └── utils/
├── features/
│   └── [feature]/
│       ├── data/
│       │   ├── models/
│       │   └── repositories/
│       ├── domain/
│       │   └── entities/
│       └── presentation/
│           ├── bloc/         ← or providers/ for Riverpod
│           ├── pages/
│           └── widgets/
└── shared/
    └── widgets/
test/
└── features/
    └── [feature]/
pubspec.yaml
```

### Melos Monorepo

```
packages/
├── app/                      ← Flutter app (depends on other packages)
│   ├── lib/
│   └── pubspec.yaml
├── [feature]_api/            ← feature data layer (pure Dart, no Flutter dep)
│   ├── lib/
│   └── pubspec.yaml
├── [feature]_ui/             ← feature widget library
│   ├── lib/
│   └── pubspec.yaml
└── shared_ui/                ← design system, shared widgets
    ├── lib/
    └── pubspec.yaml
melos.yaml                    ← workspace config: packages glob, scripts, dependency_overrides
pubspec.yaml                  ← workspace root (sdk constraint only, no dependencies)
```

---

## Tooling

### Single Package

| Tool            | Name                   | Command                          |
|-----------------|------------------------|----------------------------------|
| Formatter       | dart format            | `dart format .`                  |
| Linter          | flutter analyze        | `flutter analyze`                |
| Test runner     | flutter test           | `flutter test`                   |
| Build (Android) | flutter build          | `flutter build apk`              |
| Build (iOS)     | flutter build          | `flutter build ipa`              |
| Package manager | pub                    | `flutter pub add <package>`      |

### Melos Monorepo (additional / replacement tools)

| Tool            | Name                   | Command                          |
|-----------------|------------------------|----------------------------------|
| Bootstrap       | melos                  | `melos bootstrap`                |
| Run script      | melos                  | `melos run <script>`             |
| Exec across pkgs| melos                  | `melos exec -- flutter test`     |
| Filter by pkg   | melos                  | `melos run test --scope=app`     |
| Version/publish | melos                  | `melos version` / `melos publish`|

---

## Common Commands

### Single Package

```bash
flutter pub get              # install dependencies
flutter run                  # start on connected device / emulator
flutter test                 # run all tests
flutter build apk            # Android release build
flutter build ipa            # iOS release build
dart format .                # format all Dart files
flutter analyze              # static analysis
flutter pub upgrade          # upgrade dependencies
```

### Melos Monorepo

```bash
melos bootstrap              # install all packages' dependencies (replaces flutter pub get per package)
melos run test               # run tests across all packages (script defined in melos.yaml)
melos run lint               # run flutter analyze across all packages
melos run format             # run dart format across all packages
melos exec -- flutter test   # run ad-hoc command across all packages
melos run test --scope=app   # run only in the 'app' package
melos version                # bump versions and generate CHANGELOG entries
melos publish                # publish all changed packages to pub.dev
```

---

## Idiomatic Patterns

> State management: default to Riverpod for new projects; use Bloc when the codebase already uses it.

### Stateless Widget With All States Handled

```dart
class UserCard extends StatelessWidget {
  const UserCard({super.key, required this.userId});

  final String userId;

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<UserBloc, UserState>(
      builder: (context, state) {
        if (state is UserLoading) return const CircularProgressIndicator();
        if (state is UserError) return ErrorWidget(state.message);
        if (state is UserLoaded) return _UserContent(user: state.user);
        return const SizedBox.shrink();
      },
    );
  }
}
```

### Bloc Event / State Pattern

```dart
// events
sealed class UserEvent {}
final class LoadUser extends UserEvent {
  const LoadUser(this.id);
  final String id;
}

// states
sealed class UserState {}
final class UserInitial extends UserState {}
final class UserLoading extends UserState {}
final class UserLoaded extends UserState {
  const UserLoaded(this.user);
  final User user;
}
final class UserError extends UserState {
  const UserError(this.message);
  final String message;
}

// bloc
class UserBloc extends Bloc<UserEvent, UserState> {
  UserBloc(this._repository) : super(UserInitial()) {
    on<LoadUser>(_onLoadUser);
  }

  final UserRepository _repository;

  Future<void> _onLoadUser(LoadUser event, Emitter<UserState> emit) async {
    emit(UserLoading());
    final result = await _repository.getUser(event.id);
    result.fold(
      (failure) => emit(UserError(failure.message)),
      (user) => emit(UserLoaded(user)),
    );
  }
}
```

### Riverpod Provider Pattern

```dart
@riverpod
Future<User> user(UserRef ref, String id) async {
  final repo = ref.watch(userRepositoryProvider);
  return repo.getUser(id);
}

// in a ConsumerWidget
class UserScreen extends ConsumerWidget {
  const UserScreen({super.key, required this.userId});

  final String userId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final userAsync = ref.watch(userProvider(userId));
    return userAsync.when(
      data: (user) => UserContent(user: user),
      loading: () => const CircularProgressIndicator(),
      error: (e, _) => ErrorWidget(e.toString()),
    );
  }
}
```

### Testing a Bloc

```dart
blocTest<UserBloc, UserState>(
  'emits [UserLoading, UserLoaded] when LoadUser succeeds',
  build: () {
    when(() => mockRepository.getUser('123'))
        .thenAnswer((_) async => Right(fakeUser));
    return UserBloc(mockRepository);
  },
  act: (bloc) => bloc.add(const LoadUser('123')),
  expect: () => [isA<UserLoading>(), isA<UserLoaded>()],
);
```

### Melos `melos.yaml` Configuration

```yaml
# melos.yaml — workspace root
name: my_workspace

packages:
  - packages/**

scripts:
  test:
    run: flutter test
    exec:
      concurrency: 4
    description: Run tests in all packages

  lint:
    run: flutter analyze
    exec:
      concurrency: 2
    description: Analyze all packages

  format:
    run: dart format . --set-exit-if-changed
    exec:
      concurrency: 4
    description: Check formatting in all packages

dependency_overrides:
  my_shared_ui:
    path: packages/shared_ui
```

---

## Anti-Patterns

### Single Package and Monorepo

- Manual data classes without `freezed` — use the `freezed` package for immutable models and Bloc/Riverpod states; avoids handwriting `copyWith`, `==`, and `hashCode`
- `setState` in deeply nested widgets — extract state to Bloc/Riverpod
- Business logic inside `build()` — move to a Bloc, notifier, or service class
- Using `BuildContext` after an `await` without checking `mounted` — causes runtime crash
- `dynamic` types — use sealed classes, `Object?`, or generics instead
- Fat `main.dart` — keep it to DI setup and `runApp`; move everything else to `app.dart` and feature modules
- Platform-specific code inline in widgets — extract to a service behind an interface

### Melos Monorepo Only

- Running `flutter pub get` per package instead of `melos bootstrap` — leaves `dependency_overrides` unapplied and breaks cross-package version alignment
- Adding packages to individual `pubspec.yaml` files without a `dependency_overrides` entry in `melos.yaml` — causes version conflicts across packages
- Running `flutter test` / `flutter analyze` in individual package directories instead of `melos run test` / `melos run lint` — skips packages and produces inconsistent CI results
- Defining workspace-wide scripts outside `melos.yaml` (e.g., in a `Makefile`) — defeats the purpose of Melos; all workspace scripts belong in `melos.yaml`
- Publishing packages with `dart pub publish` directly instead of `melos publish` — bypasses version sync and changelog generation

---

## Detector Files

- `pubspec.yaml` — single-package Flutter project or Melos workspace root
- `melos.yaml` — Melos monorepo (takes precedence for variant selection when both are present)
