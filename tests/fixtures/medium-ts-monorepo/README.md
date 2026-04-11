# medium-ts-monorepo

A benchmark fixture representing a realistic TypeScript monorepo with three packages.

## Packages

- **packages/shared** — Domain types, Zod schemas, shared utilities
- **packages/config** — Environment config, logger
- **packages/api** — Express REST API with controllers, middleware, routing

## Structure

```
packages/
├── shared/    # Types + validators (no external deps)
├── config/    # Config loader + logger
└── api/       # Express API (depends on shared + config)
```
