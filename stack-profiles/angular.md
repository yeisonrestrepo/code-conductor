# Angular Profile

**Detector files:** `angular.json`, `package.json` with `@angular/core`

---

## Naming Conventions

| Element    | Convention  | Example                          |
|------------|-------------|----------------------------------|
| Components | PascalCase + suffix | `UserCardComponent`    |
| Services   | PascalCase + suffix | `UserService`          |
| Modules    | PascalCase + suffix | `UserModule`           |
| Pipes      | PascalCase + suffix | `DateFormatPipe`       |
| Files      | kebab-case + suffix | `user-card.component.ts` |
| Selectors  | kebab-case + prefix | `app-user-card`        |

---

## Standard Project Structure

```
src/app/
├── core/          singleton services, guards, interceptors
├── shared/        reusable components, pipes, directives
└── features/
    └── [feature]/
        ├── [feature].module.ts
        ├── [feature].component.ts
        ├── [feature].component.html
        ├── [feature].component.scss
        └── [feature].service.ts
```

---

## Tooling

| Tool            | Name       | Command               |
|-----------------|------------|-----------------------|
| Formatter       | Prettier   | `npx prettier --write .` |
| Linter          | ESLint     | `ng lint`             |
| Test runner     | Jest       | `ng test`             |
| Build tool      | Angular CLI| `ng build`            |
| Package manager | npm        | `npm install`         |

---

## Common Commands

```bash
npm install           # install dependencies
ng serve              # start dev server
ng test               # run tests
ng build --configuration production  # production build
ng generate component features/[feature]/[name]  # generate component
```

---

## Idiomatic Patterns

### Reactive Forms Over Template-Driven

```typescript
this.form = this.fb.group({
  email: ['', [Validators.required, Validators.email]],
  password: ['', [Validators.required, Validators.minLength(8)]],
});
```

### Async Pipe Over Manual Subscribe

```html
<!-- ✅ Good — auto-unsubscribes -->
<div *ngIf="user$ | async as user">{{ user.name }}</div>
```

```typescript
// ❌ Bad — must remember to unsubscribe
ngOnInit() {
  this.sub = this.userService.user$.subscribe(u => this.user = u);
}
ngOnDestroy() { this.sub.unsubscribe(); }
```

### Signals (Angular 17+)

```typescript
// prefer signals over BehaviorSubject for local state
count = signal(0);
doubled = computed(() => this.count() * 2);
increment() { this.count.update(c => c + 1); }
```

---

## Anti-Patterns

- Manual `subscribe` in components without `takeUntilDestroyed` or `async` pipe
- Logic in templates — move to component class or service
- Importing `CommonModule` / `FormsModule` in every module — use standalone components (Angular 14+)
- Any-typed HTTP responses — define response interfaces
- `ngOnInit` doing everything — decompose into services

---

## Detector Files

- `angular.json`
- `package.json` with `@angular/core`
