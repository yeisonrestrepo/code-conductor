# Java Profile

**Detector files:** `pom.xml`, `build.gradle`, `build.gradle.kts`

---

## Naming Conventions

| Element     | Convention       | Example                        |
|-------------|------------------|--------------------------------|
| Variables   | camelCase        | `userId`, `isLoading`          |
| Methods     | camelCase        | `fetchUser()`, `parseDate()`   |
| Classes     | PascalCase       | `UserService`, `OrderProcessor`|
| Interfaces  | PascalCase       | `UserRepository`, `Runnable`   |
| Constants   | UPPER_SNAKE_CASE | `MAX_RETRIES`, `BASE_URL`      |
| Packages    | lowercase.dots   | `com.example.users`            |
| Files       | PascalCase       | `UserService.java`             |

---

## Standard Project Structure

```
project/
├── src/
│   ├── main/
│   │   └── java/com/example/
│   │       └── [feature]/
│   │           ├── [Feature].java
│   │           └── [Feature]Repository.java
│   └── test/
│       └── java/com/example/
│           └── [feature]/
│               └── [Feature]Test.java
└── pom.xml
```

---

## Tooling

| Tool            | Name          | Command               |
|-----------------|---------------|-----------------------|
| Formatter       | google-java-format | via Maven plugin |
| Linter          | Checkstyle    | `mvn checkstyle:check`|
| Test runner     | JUnit 5       | `mvn test`            |
| Build tool      | Maven         | `mvn`                 |
| Package manager | Maven Central | `mvn dependency:resolve`|

---

## Common Commands

```bash
mvn install           # build + test + install to local repo
mvn test              # run tests
mvn spring-boot:run   # run Spring Boot app
mvn package           # build JAR
mvn dependency:tree   # show dependency tree
```

---

## Idiomatic Patterns

### Records for Data Carriers (Java 16+)

```java
public record UserId(String value) {
  public UserId {
    if (value == null || value.isBlank()) throw new IllegalArgumentException("UserId cannot be blank");
  }
}
```

### Optional Over Null

```java
public Optional<User> findById(String id) {
  return Optional.ofNullable(db.get(id));
}

// caller
findById(id).ifPresent(user -> process(user));
```

### Streams for Collection Operations

```java
List<String> activeNames = users.stream()
    .filter(User::isActive)
    .map(User::getName)
    .toList();
```

---

## Anti-Patterns

- Returning `null` from methods — use `Optional<T>`
- Catching `Exception` or `Throwable` — catch specific types
- Public fields — use private fields with accessors, or records
- Mutable shared state without synchronization
- `System.out.println` for logging — use SLF4J

---

## Detector Files

- `pom.xml`
- `build.gradle`
- `build.gradle.kts`
