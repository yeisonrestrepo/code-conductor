# Go Profile

**Detector files:** `go.mod`, `go.sum`

---

## Naming Conventions

| Element    | Convention  | Example                    |
|------------|-------------|----------------------------|
| Variables  | camelCase   | `userID`, `isLoading`      |
| Functions  | camelCase   | `fetchUser`, `parseDate`   |
| Exported   | PascalCase  | `UserService`, `ParseDate` |
| Constants  | PascalCase  | `MaxRetries`, `BaseURL`    |
| Interfaces | PascalCase  | `UserRepository`           |
| Files      | snake_case  | `user_service.go`          |
| Packages   | lowercase   | `users`, `httputil`        |

---

## Standard Project Structure

```
project/
├── cmd/
│   └── [app]/
│       └── main.go
├── internal/
│   └── [feature]/
│       ├── [feature].go
│       └── [feature]_test.go
├── pkg/           (public, reusable packages only)
├── go.mod
└── go.sum
```

---

## Tooling

| Tool            | Name       | Command              |
|-----------------|------------|----------------------|
| Formatter       | gofmt      | `gofmt -w .`         |
| Linter          | golangci-lint | `golangci-lint run`|
| Test runner     | go test    | `go test ./...`      |
| Build tool      | go build   | `go build ./...`     |
| Package manager | Go modules | `go mod tidy`        |

---

## Common Commands

```bash
go mod tidy           # sync dependencies
go run ./cmd/app      # run the app
go test ./...         # run all tests
go build ./...        # compile all packages
gofmt -w .            # format
golangci-lint run     # lint
```

---

## Idiomatic Patterns

### Errors Are Values

```go
user, err := getUserByID(ctx, id)
if err != nil {
    return fmt.Errorf("getUser: %w", err)
}
```

Always wrap errors with `%w` to preserve the chain. Never discard `err`.

### Interfaces Are Implicit — Keep Them Small

```go
// ✅ Good — defined at the point of use, one method
type UserLookup interface {
    GetUser(ctx context.Context, id string) (User, error)
}
```

Don't define interfaces with 10 methods. Accept interfaces, return structs.

### Table-Driven Tests

```go
func TestParseDate(t *testing.T) {
    cases := []struct {
        input    string
        expected time.Time
        wantErr  bool
    }{
        {"2024-01-15", time.Date(2024, 1, 15, 0, 0, 0, 0, time.UTC), false},
        {"bad-date", time.Time{}, true},
    }
    for _, tc := range cases {
        got, err := ParseDate(tc.input)
        if (err != nil) != tc.wantErr {
            t.Errorf("ParseDate(%q) error = %v, wantErr %v", tc.input, err, tc.wantErr)
        }
        if !tc.wantErr && got != tc.expected {
            t.Errorf("ParseDate(%q) = %v, want %v", tc.input, got, tc.expected)
        }
    }
}
```

---

## Anti-Patterns

- `panic` for expected errors — return `error` instead
- Named return values (except for defer clarity) — makes code harder to read
- Global state — pass dependencies explicitly via function arguments or struct fields
- Goroutines without a shutdown strategy — always handle context cancellation
- `interface{}` / `any` — use generics (Go 1.18+) or concrete types

---

## Detector Files

- `go.mod`
