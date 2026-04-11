# simple-node-app

A minimal Express REST API with TypeScript. Provides user management endpoints
with JWT authentication and request validation.

## Endpoints

- `GET /users` — list all users
- `POST /users` — create a user
- `PUT /users/:id` — update a user
- `DELETE /users/:id` — delete a user
- `GET /health` — health check

## Setup

```bash
npm install
npm run build
npm start
```
