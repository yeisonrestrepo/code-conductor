# Python Profile

**Detector files:** `requirements.txt`, `pyproject.toml`, `setup.py`, `Pipfile`

---

## Naming Conventions

| Element    | Convention  | Example                     |
|------------|-------------|-----------------------------|
| Variables  | snake_case  | `user_count`, `is_loading`  |
| Functions  | snake_case  | `fetch_user`, `parse_date`  |
| Classes    | PascalCase  | `UserService`, `OrderItem`  |
| Constants  | UPPER_SNAKE | `MAX_RETRIES`, `BASE_URL`   |
| Files      | snake_case  | `user_service.py`           |
| Directories| snake_case  | `user_management/`          |
| Modules    | snake_case  | `date_utils`                |

---

## Standard Project Structure

```
project/
├── src/
│   └── [package]/
│       ├── __init__.py
│       └── [module].py
├── tests/
│   └── test_[module].py
├── pyproject.toml
└── .python-version
```

---

## Tooling

| Tool            | Name    | Command              |
|-----------------|---------|----------------------|
| Formatter       | ruff    | `ruff format .`      |
| Linter          | ruff    | `ruff check .`       |
| Type checker    | mypy    | `mypy src/`          |
| Test runner     | pytest  | `pytest`             |
| Package manager | uv      | `uv sync`            |

---

## Common Commands

```bash
uv sync               # install dependencies
uv run python -m src  # run the app
uv run pytest         # run tests
uv run ruff format .  # format
uv run ruff check .   # lint
uv run mypy src/      # type check
```

---

## Idiomatic Patterns

### Type Hints Everywhere

```python
def get_user(user_id: str) -> User | None:
    return db.find(user_id)
```

Use `from __future__ import annotations` at top of file to support forward references.

### Dataclasses Over Dicts

```python
from dataclasses import dataclass

@dataclass
class Order:
    id: str
    user_id: str
    total: float
    status: str = "pending"
```

### Context Managers for Resources

```python
with open("data.json") as f:
    data = json.load(f)
# file is guaranteed closed here
```

---

## Anti-Patterns

- Mutable default arguments: `def f(items=[])` — use `None` and assign inside
- Bare `except:` — always catch specific exceptions
- `import *` — always use explicit imports
- `print()` for debugging — use `logging`
- Ignoring return values from functions that can fail

---

## Detector Files

- `requirements.txt`
- `pyproject.toml`
- `setup.py`
- `Pipfile`
