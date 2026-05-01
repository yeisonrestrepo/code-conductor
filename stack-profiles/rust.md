# Rust Profile

**Detector files:** `Cargo.toml`, `Cargo.lock`

---

## Naming Conventions

| Element    | Convention  | Example                       |
|------------|-------------|-------------------------------|
| Variables  | snake_case  | `user_id`, `is_loading`       |
| Functions  | snake_case  | `fetch_user`, `parse_date`    |
| Types      | PascalCase  | `UserService`, `OrderStatus`  |
| Enums      | PascalCase  | `HttpStatus`, `Role`          |
| Constants  | UPPER_SNAKE | `MAX_RETRIES`, `BASE_URL`     |
| Modules    | snake_case  | `user_service`, `http_client` |
| Files      | snake_case  | `user_service.rs`             |

---

## Standard Project Structure

```
project/
├── src/
│   ├── main.rs (or lib.rs)
│   └── [module]/
│       ├── mod.rs
│       └── [submodule].rs
├── tests/
│   └── integration_test.rs
└── Cargo.toml
```

---

## Tooling

| Tool            | Name     | Command              |
|-----------------|----------|----------------------|
| Formatter       | rustfmt  | `cargo fmt`          |
| Linter          | Clippy   | `cargo clippy`       |
| Test runner     | cargo    | `cargo test`         |
| Build tool      | cargo    | `cargo build`        |
| Package manager | cargo    | `cargo add`          |

---

## Common Commands

```bash
cargo build           # compile (debug)
cargo build --release # compile (optimized)
cargo test            # run tests
cargo run             # compile and run
cargo fmt             # format
cargo clippy          # lint
cargo add [crate]     # add dependency
```

---

## Idiomatic Patterns

### The Type System Is the Error Handler

```rust
fn get_user(id: &str) -> Result<User, AppError> {
    let user = db.find(id).ok_or(AppError::NotFound(id.to_string()))?;
    Ok(user)
}
```

Use `?` to propagate errors. Define a project-level `AppError` enum.

### Ownership Over Cloning

```rust
// ✅ Good — borrow when you don't need ownership
fn process_name(name: &str) -> usize {
    name.len()
}

// ❌ Bad — cloning just to avoid figuring out lifetimes
fn process_name(name: String) -> usize {
    name.len()
}
```

### Builder Pattern for Complex Config

```rust
let client = HttpClient::builder()
    .timeout(Duration::from_secs(30))
    .retry_attempts(3)
    .build()?;
```

---

## Anti-Patterns

- `.unwrap()` in production code — use `?` or `match` instead
- `.clone()` to silence the borrow checker — figure out the lifetime
- `unsafe` without a documented invariant explaining why it's safe
- `Arc<Mutex<T>>` everywhere — redesign data ownership first
- `Box<dyn Error>` for function return types — define a concrete error type

---

## Detector Files

- `Cargo.toml`
