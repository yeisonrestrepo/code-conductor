# Django Profile

**Detector files:** `manage.py`, `requirements.txt` or `pyproject.toml` with `django`

---

## Naming Conventions

| Element    | Convention  | Example                          |
|------------|-------------|----------------------------------|
| Models     | PascalCase  | `UserProfile`, `Order`           |
| Views      | PascalCase (CBV) / snake_case (FBV) | `UserDetailView` / `list_users` |
| URLs       | kebab-case  | `/api/user-profiles/`            |
| Apps       | snake_case  | `user_profiles`, `orders`        |
| Files      | snake_case  | `user_service.py`                |
| Templates  | snake_case  | `user_detail.html`               |

---

## Standard Project Structure

```
project/
├── manage.py
├── config/
│   ├── settings/
│   │   ├── base.py
│   │   ├── local.py
│   │   └── production.py
│   ├── urls.py
│   └── wsgi.py
└── apps/
    └── [feature]/
        ├── models.py
        ├── views.py
        ├── urls.py
        ├── serializers.py   (if using DRF)
        ├── admin.py
        └── tests/
            └── test_views.py
```

---

## Tooling

| Tool            | Name    | Command                  |
|-----------------|---------|--------------------------|
| Formatter       | ruff    | `ruff format .`          |
| Linter          | ruff    | `ruff check .`           |
| Test runner     | pytest-django | `pytest`           |
| Package manager | uv      | `uv sync`                |
| Migrations      | Django  | `python manage.py migrate` |

---

## Common Commands

```bash
uv sync                          # install dependencies
python manage.py runserver       # dev server
python manage.py migrate         # apply migrations
python manage.py makemigrations  # generate migrations
python manage.py createsuperuser
pytest                           # run tests
```

---

## Idiomatic Patterns

### Fat Models, Thin Views

Business logic belongs in models or service modules, not in views.

```python
class Order(models.Model):
    user = models.ForeignKey(User, on_delete=models.PROTECT)
    status = models.CharField(max_length=20, default='pending')

    def mark_paid(self):
        if self.status != 'pending':
            raise ValueError(f"Cannot pay an order with status '{self.status}'")
        self.status = 'paid'
        self.save(update_fields=['status'])
```

### Django REST Framework Serializers for Validation

```python
class CreateOrderSerializer(serializers.Serializer):
    product_id = serializers.IntegerField()
    quantity = serializers.IntegerField(min_value=1)

    def validate_product_id(self, value):
        if not Product.objects.filter(id=value, is_active=True).exists():
            raise serializers.ValidationError("Product not found or inactive")
        return value
```

### `select_related` and `prefetch_related` — Always

```python
# ✅ Good — 1 query
orders = Order.objects.select_related('user').prefetch_related('items').filter(status='pending')

# ❌ Bad — N+1 queries
orders = Order.objects.filter(status='pending')
for order in orders:
    print(order.user.name)  # new query per order
```

---

## Anti-Patterns

- Logic in views or templates — move to models or service layer
- Forgetting `select_related` / `prefetch_related` — causes N+1 query problems
- Hardcoding settings — always use `django.conf.settings`
- Using `DEBUG=True` in production
- Checking `request.method == 'GET'` — use class-based views or DRF

---

## Detector Files

- `manage.py`
- `requirements.txt` or `pyproject.toml` containing `django`
