# Flask Profile

**Detector files:** `requirements.txt` or `pyproject.toml` with `flask`

---

## Naming Conventions

| Element    | Convention  | Example                        |
|------------|-------------|--------------------------------|
| Functions  | snake_case  | `get_user`, `create_order`     |
| Classes    | PascalCase  | `UserService`, `OrderSchema`   |
| Blueprints | snake_case  | `users_bp`, `orders_bp`        |
| Files      | snake_case  | `user_routes.py`               |
| URLs       | kebab-case  | `/api/user-profiles`           |

---

## Standard Project Structure

```
project/
├── app/
│   ├── __init__.py   (create_app factory)
│   ├── extensions.py (db, ma, jwt instances)
│   └── [feature]/
│       ├── __init__.py
│       ├── routes.py
│       ├── models.py
│       └── schemas.py
├── tests/
│   └── test_[feature].py
├── config.py
└── pyproject.toml
```

---

## Tooling

| Tool            | Name           | Command                |
|-----------------|----------------|------------------------|
| Formatter       | ruff           | `ruff format .`        |
| Linter          | ruff           | `ruff check .`         |
| Test runner     | pytest         | `pytest`               |
| Package manager | uv             | `uv sync`              |

---

## Common Commands

```bash
uv sync               # install dependencies
flask run             # start dev server
flask run --debug     # with hot reload
pytest                # run tests
ruff format .         # format
```

---

## Idiomatic Patterns

### Application Factory

```python
# app/__init__.py
def create_app(config_name: str = "default") -> Flask:
    app = Flask(__name__)
    app.config.from_object(config[config_name])

    db.init_app(app)
    ma.init_app(app)

    from app.users.routes import users_bp
    app.register_blueprint(users_bp, url_prefix='/api/users')

    return app
```

### Marshmallow Schemas for Validation

```python
from marshmallow import Schema, fields, validate

class CreateUserSchema(Schema):
    email = fields.Email(required=True)
    password = fields.Str(required=True, validate=validate.Length(min=8))

@users_bp.post('/')
def create_user():
    data = CreateUserSchema().load(request.json)
    user = User(**data)
    db.session.add(user)
    db.session.commit()
    return UserSchema().dump(user), 201
```

### Blueprints Group Related Routes

```python
# app/users/routes.py
users_bp = Blueprint('users', __name__)

@users_bp.get('/<int:user_id>')
def get_user(user_id: int):
    user = db.get_or_404(User, user_id)
    return UserSchema().dump(user)
```

---

## Anti-Patterns

- Using the app context globally — use the application factory pattern
- Logic in route functions — delegate to service functions
- No schema validation — always validate with Marshmallow or Pydantic
- Not using blueprints — all routes in one file doesn't scale
- Returning raw exceptions — always return JSON error responses

---

## Detector Files

- `requirements.txt` or `pyproject.toml` containing `flask`
