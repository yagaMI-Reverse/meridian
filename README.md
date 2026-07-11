# Meridian — Multi-Tenant Billing Ledger API

A financial-grade billing backend in **NestJS + Prisma + PostgreSQL**: append-only ledger,
idempotent money movements, row-level-security tenant isolation, and a reconciliation job
that continuously proves the books balance.

> The one-line pitch: **`accounts.balance_cents == SUM(ledger_entries.amount_cents)` — always.**
> Under concurrent writes, under client retries, under partial failures. And there's a test
> suite that hammers it to prove it.

## What this demonstrates

| Concern | How it's solved here |
|---|---|
| **Multi-tenancy** | PostgreSQL **row-level security**. The API connects as a least-privilege role (`meridian_app`, no `BYPASSRLS`); every request-path transaction sets a transaction-local `app.tenant_id` GUC taken from the **verified JWT** (never from client input). Policies deny by default — no GUC, no rows. Even raw SQL is scoped. |
| **Append-only ledger** | Two independent layers: the app role simply has **no UPDATE/DELETE grants** on `ledger_entries`, and a trigger blocks mutation for everyone else — including superusers. History cannot be rewritten, only appended (corrections are new `ADJUSTMENT` entries). |
| **Idempotency** | Stripe-style `Idempotency-Key` header on every money movement. The key claim (`INSERT … ON CONFLICT`), the ledger write, the balance update and the stored response snapshot commit **in one transaction**. Retries replay the original response (`Idempotency-Replayed: true`); the same key with a different payload → `422`; a failed request doesn't burn the key. Concurrent duplicates are serialized by the unique index — the database itself referees the race. |
| **No balance drift** | Writers take a `SELECT … FOR UPDATE` row lock on the account, so read-modify-write on the balance never interleaves. The e2e suite fires **25 payments × 2 concurrent retries each (50 in-flight requests)** and asserts exactly 25 entries and a to-the-cent balance. |
| **Reconciliation** | An hourly (+ on-demand) set-based sweep compares every materialized balance against `SUM(ledger)` and stores a drift report. The suite also **manufactures** a corruption via superuser and asserts the sweep catches its exact size. |
| **NestJS fundamentals** | Modules with DI, **guards** (global JWT + roles/RBAC), **interceptors** (request logging with correlation ids, BigInt-safe serialization), **pipes** (global `ValidationPipe` + class-validator DTOs, `ParseUUIDPipe`), **exception filters** (Prisma error mapping), `@nestjs/schedule` cron, Swagger/OpenAPI. |

## Architecture

```
src/
├── auth/            POST /auth/login → JWT {sub, tid, role} (scrypt hashes)
├── accounts/        accounts + payments/credits/adjustments + ledger paging
├── subscriptions/   create = subscription + first CHARGE, one transaction
├── plans/           per-tenant billing plans (ADMIN)
├── ledger/          LedgerService (the ONLY write path) + IdempotencyService
├── reconciliation/  cron + on-demand drift sweeps (system role)
├── prisma/          PrismaService (RLS app role) / SystemPrismaService
└── common/          guards, interceptors, filters, decorators
```

Two database identities, on purpose:

- **`meridian_app`** (request path): RLS enforced, least privilege, `withTenant(tenantId, fn)`
  wraps every unit of work in a transaction that sets the tenant GUC first.
- **system role** (background): auth lookups (pre-tenant-context), migrations, seeding and
  cross-tenant reconciliation. Never exposed to request handlers acting for a tenant.

### The write path (why the invariant holds)

```
BEGIN;
  set_config('app.tenant_id', <from JWT>, true);         -- RLS scope
  INSERT idempotency_records ON CONFLICT DO NOTHING;     -- claim the key (or replay)
  SELECT * FROM accounts WHERE id = $1 FOR UPDATE;       -- serialize per-account writers
  INSERT INTO ledger_entries (…);                        -- append, never mutate
  UPDATE accounts SET balance_cents = balance_cents + $; -- same tx = atomic with the entry
  UPDATE idempotency_records SET response_…;             -- snapshot the response
COMMIT;                                                  -- all or nothing
```

## Run it locally (no Docker needed)

Real PostgreSQL binaries are pulled in via `embedded-postgres` (dev dependency):

```bash
npm install
npm run db:up        # boots a real PostgreSQL 18 on :5433 (initializes on first run)
npm run db:migrate   # applies migrations incl. RLS policies & append-only trigger
npm run db:seed      # 2 demo tenants: northwind / acme (password: demo-password)
npm run start:dev    # API on :4000, Swagger UI at http://localhost:4000/docs
npm run db:down      # stop the database
```

Docker flavor (same thing, containerized): `docker compose up --build`.

## Try the invariant yourself

```bash
# 1. Login (tenant northwind)
TOKEN=$(curl -s -X POST localhost:4000/auth/login -H 'Content-Type: application/json' \
  -d '{"tenant":"northwind","email":"admin@northwind.demo","password":"demo-password"}' | jq -r .accessToken)

# 2. Pick an account
ACC=$(curl -s localhost:4000/accounts -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')

# 3. Pay — then retry with the SAME key: one ledger entry, identical response, replay header
curl -si -X POST localhost:4000/accounts/$ACC/payments \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-1' -d '{"amountCents":5000}' | grep -iE 'HTTP|Replayed'

# 4. Prove the books balance
curl -s -X POST localhost:4000/reconciliation/run -H "Authorization: Bearer $TOKEN" \
  | jq '{accountsChecked, driftCount}'
```

## Tests

```bash
npm test          # unit: hashing, idempotency hashing, RBAC guard, serialization
npm run test:e2e  # boots a FRESH real PostgreSQL, applies real migrations, then:
```

The e2e suite covers auth/RBAC, DTO validation, idempotent replay/mismatch/per-tenant
scoping, RLS isolation (including raw-SQL probes and cross-tenant `INSERT` rejection),
both append-only layers, cursor pagination — and the concurrency storm: 50 simultaneous
requests racing their own retries, with the invariant checked straight in SQL afterwards.

## Notes

- Demo credentials/passwords are intentionally simple and documented; rotate everything via env for real deployments.
- Money is integer cents (`BIGINT`), serialized to JSON numbers only within the safe range.
- A negative balance means the customer owes money: `PAYMENT`/`CREDIT` are positive, `CHARGE`/`REFUND` negative, `ADJUSTMENT` signed.
