## Chunk 1 — Shared types & config package

### Tasks

- [ ] Define core domain types in packages/shared
- [ ] Add Zod validation schemas for all domain types
- [ ] Add environment config loader in packages/config
- [ ] Set up logger with log levels and structured output
- [ ] Add unit tests for shared validators
- [ ] Add unit tests for config loader

## Chunk 2 — API package: routes & controllers

### Tasks

- [ ] Set up Express router with versioned prefix (/api/v1)
- [ ] Implement /users controller (CRUD)
- [ ] Implement /orders controller (create, list, get)
- [ ] Implement /products controller (list, get, search)
- [ ] Add request validation middleware using shared schemas
- [ ] Add pagination utility for list endpoints
- [ ] Write integration tests for user endpoints
- [ ] Write integration tests for order endpoints

## Chunk 3 — Auth & deployment

### Tasks

- [ ] Implement JWT token generation and validation
- [ ] Add refresh token rotation
- [ ] Add rate limiting middleware
- [ ] Add Prometheus metrics endpoint
- [ ] Write Dockerfile for API package
- [ ] Add GitHub Actions CI workflow
- [ ] Add deployment script with health check polling
