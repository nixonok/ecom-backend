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

```
ecom-backend
├─ docker-compose.yml
├─ package.json
├─ pnpm-lock.yaml
├─ pnpm-workspace.yaml
├─ prisma
│  ├─ migrations
│  │  ├─ 20251112112210_pnpm_run_seed
│  │  │  └─ migration.sql
│  │  ├─ 20251120031212_add_store_and_product_media
│  │  │  └─ migration.sql
│  │  ├─ 20251120052112_remove_unique_sku
│  │  │  └─ migration.sql
│  │  ├─ 20251123051447_new11
│  │  │  └─ migration.sql
│  │  ├─ 20251123175431_delete_product
│  │  │  └─ migration.sql
│  │  ├─ 20251124005151_featured
│  │  │  └─ migration.sql
│  │  ├─ 20251124005832_add_product_featured
│  │  │  └─ migration.sql
│  │  ├─ 20251124190249_align_order_item_schema
│  │  │  └─ migration.sql
│  │  ├─ 20251125005954_add_customer_note_to_order
│  │  │  └─ migration.sql
│  │  ├─ 20251125012601_add_payment_method_to_order
│  │  │  └─ migration.sql
│  │  ├─ 20251210073043_add_category_store
│  │  │  └─ migration.sql
│  │  └─ migration_lock.toml
│  ├─ schema.prisma
│  └─ seed.ts
├─ prisma.config.ts
├─ README.md
├─ src
│  ├─ plugins
│  │  ├─ auth.ts
│  │  └─ swagger.ts
│  ├─ routes
│  │  ├─ auth.ts
│  │  ├─ categories.ts
│  │  ├─ dashboard.ts
│  │  ├─ nextauth-exchange.ts
│  │  ├─ orders.ts
│  │  ├─ products.ts
│  │  └─ uploads.ts
│  ├─ server.ts
│  └─ utils
│     ├─ pagination.ts
│     ├─ prisma.ts
│     └─ s3util.ts
└─ tsconfig.json

```