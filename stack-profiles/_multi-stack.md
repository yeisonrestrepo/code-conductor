# Multi-Stack Coordinator

Loaded when multiple languages or runtimes are detected. Loaded BEFORE individual language profiles.

## Layer Ownership

Each technology layer owns its directory. No cross-layer file sprawl.

```
project/
├── backend/      server-side code
├── frontend/     client-side code
├── shared/       contracts only (types, schemas, OpenAPI/Protobuf)
├── infra/        infrastructure as code
└── scripts/      tooling and automation
```

## Contracts First

The shared contract (OpenAPI spec, Protobuf, GraphQL schema, shared types) is the source of truth. Both layers must match it. When they disagree, the contract wins. Update the contract before updating either layer.

## Tooling Stays in Its Layer

- Frontend tools (webpack, vite, eslint for JS) live in `frontend/`
- Backend tools (Maven, Pipenv, Go modules) live in `backend/`
- Root scripts are orchestration only (`make dev`, `docker-compose up`)

## Feature Development Order

For every full-stack feature, implement in this exact order:

1. **Contract** — update shared types/schema first
2. **Backend** — implement + unit test
3. **Frontend** — implement against the contract
4. **Integration tests** — test the seam between layers
5. **E2E** — Playwright end-to-end

Never build the frontend against a backend that doesn't exist yet. Mock data is a bridge only — replace it immediately when the backend is ready.

## Cross-Layer Communication

- REST: OpenAPI spec in `shared/openapi.yaml`
- GraphQL: schema in `shared/schema.graphql`
- Events: schemas in `shared/events/`
- Direct DB access from frontend: never

## API Versioning

Breaking changes require a new version prefix (`/v2/`). Never modify a published API contract in place.
