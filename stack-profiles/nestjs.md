# NestJS Profile

**Detector files:** `package.json` with `@nestjs/core`

---

## Naming Conventions

| Element     | Convention  | Example                          |
|-------------|-------------|----------------------------------|
| Modules     | PascalCase  | `UsersModule`, `OrdersModule`    |
| Controllers | PascalCase + suffix | `UsersController`      |
| Services    | PascalCase + suffix | `UsersService`         |
| DTOs        | PascalCase + suffix | `CreateUserDto`        |
| Files       | kebab-case + suffix | `users.controller.ts` |
| Routes      | kebab-case  | `/api/user-profiles`             |

---

## Standard Project Structure

```
src/
├── main.ts
├── app.module.ts
└── [feature]/
    ├── [feature].module.ts
    ├── [feature].controller.ts
    ├── [feature].service.ts
    ├── dto/
    │   ├── create-[feature].dto.ts
    │   └── update-[feature].dto.ts
    └── entities/
        └── [feature].entity.ts
```

---

## Tooling

| Tool            | Name       | Command              |
|-----------------|------------|----------------------|
| Formatter       | Prettier   | `pnpm format`        |
| Linter          | ESLint     | `pnpm lint`          |
| Test runner     | Jest       | `pnpm test`          |
| Build tool      | tsc        | `pnpm build`         |
| Package manager | pnpm       | `pnpm install`       |

---

## Common Commands

```bash
pnpm install         # install dependencies
pnpm start:dev       # start with hot reload
pnpm test            # run jest
pnpm test:e2e        # run e2e tests
pnpm build           # compile TypeScript
```

---

## Idiomatic Patterns

### Validation With Class Validator

```typescript
import { IsEmail, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}
```

Enable globally: `app.useGlobalPipes(new ValidationPipe({ whitelist: true }))`.

### Guards for Authorization

```typescript
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }
}
```

### Service Layer Owns Business Logic

Controllers route requests; services own all logic and talk to repositories.

```typescript
@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async createUser(dto: CreateUserDto): Promise<User> {
    const existing = await this.usersRepository.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already in use');
    return this.usersRepository.create(dto);
  }
}
```

---

## Anti-Patterns

- Business logic in controllers — move to services
- Skipping DTOs — always validate with class-validator
- Returning ORM entities directly — map to response DTOs to avoid leaking internals
- Global state in services — NestJS services are singletons, treat them as stateless
- Circular module imports — restructure dependencies

---

## Detector Files

- `package.json` with `@nestjs/core`
- `nest-cli.json`
