# Shophikes Backend (Fastify 10 + Prisma + Postgres)

Self-hosted backend API for products, orders, and admin KPIs. NextAuth-compatible.

## Stack
- Fastify **v10** (TypeScript), **@fastify/jwt v5**, Swagger docs
- PostgreSQL + Prisma ORM
- Optional Redis, MinIO (presigned uploads)
- NextAuth exchange endpoint for Google/Meta/etc.

## Quick start

```bash
pnpm i
docker compose up -d             # start postgres/redis/minio (optional)
cp .env.local .env             # set JWT_SECRET, DATABASE_URL, BACKEND_SHARED_SECRET
pnpm run prisma:generate
pnpm run prisma:migrate
pnpm run seed
pnpm run dev                      # or: npm run build && npm start
```

Open http://localhost:4000/docs for Swagger.

### Admin credentials
Seed creates `admin@shophikes.com` with password `ChangeThisPwd!` (change it!).

## Endpoints
- `POST /auth/login` → `{ token, role }`
- `GET /products`, `GET /products/:id`
- `POST /products` (ADMIN), `PUT /products/:id` (ADMIN), `DELETE /products/:id` (ADMIN)
- `GET /orders` (ADMIN), `PUT /orders/:id/status` (ADMIN)
- `GET /dashboard/kpis` (ADMIN)
- `GET /dashboard/sales-by-day` (ADMIN)
- `POST /uploads/presign` (ADMIN)
- `POST /auth/exchange` (NextAuth server → backend JWT) — header `x-backend-secret: <secret>`
- `GET /auth/me` (JWT protected)

## NextAuth wiring (frontend)
Call `/auth/exchange` from NextAuth JWT callback, store `backendToken` in session, then call backend APIs with `Authorization: Bearer <backendToken>`.
