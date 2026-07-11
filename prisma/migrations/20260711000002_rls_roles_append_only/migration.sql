-- ============================================================================
-- Security hardening: least-privilege app role, row-level security per tenant,
-- and an append-only guarantee on the ledger.
--
-- The API connects as `meridian_app` (no BYPASSRLS). Every request-path
-- transaction sets a transaction-local GUC `app.tenant_id`; the policies below
-- match rows against it.
--
-- NULLIF(..., '') matters: current_setting(name, true) returns NULL only if
-- the GUC was NEVER set on the connection. After a transaction-local
-- set_config on a pooled connection, it reverts to an EMPTY STRING - and
-- ''::uuid would blow up the query. NULLIF normalizes both cases to NULL,
-- so an out-of-context query simply matches nothing: deny by default.
-- ============================================================================

-- === Application role =======================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'meridian_app') THEN
    -- password must satisfy managed-Postgres strength checks (Neon rejects weak ones)
    CREATE ROLE meridian_app LOGIN PASSWORD 'M3ridian.App.R0le.2026'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO meridian_app', current_database());
END
$$;

GRANT USAGE ON SCHEMA "public" TO meridian_app;

-- Least privilege per table. Note: NO UPDATE/DELETE on ledger_entries - the
-- append-only rule is enforced at the grant level as well as by trigger.
GRANT SELECT                         ON "tenants"             TO meridian_app;
GRANT SELECT                         ON "users"               TO meridian_app;
GRANT SELECT, INSERT, UPDATE         ON "accounts"            TO meridian_app;
GRANT SELECT, INSERT, UPDATE         ON "plans"               TO meridian_app;
GRANT SELECT, INSERT, UPDATE         ON "subscriptions"       TO meridian_app;
GRANT SELECT, INSERT                 ON "ledger_entries"      TO meridian_app;
GRANT SELECT, INSERT, UPDATE         ON "idempotency_records" TO meridian_app;
-- reconciliation_runs: system-only table, deliberately no grants to the app role.

-- === Row-level security ======================================================
ALTER TABLE "tenants"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounts"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plans"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ledger_entries"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "idempotency_records" ENABLE ROW LEVEL SECURITY;

-- A tenant can only see its own tenant row.
CREATE POLICY tenant_self ON "tenants"
  FOR SELECT
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- All tenant-scoped tables: rows are visible/writable only when tenant_id
-- matches the transaction-local GUC. USING doubles as WITH CHECK, so INSERTs
-- with a foreign tenant_id are rejected too.
CREATE POLICY tenant_isolation ON "users"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "accounts"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "plans"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "subscriptions"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "ledger_entries"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "idempotency_records"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- === Append-only ledger ======================================================
-- Belt and suspenders: even a role WITH update/delete grants (e.g. a future
-- superuser migration mistake) cannot rewrite history.
CREATE OR REPLACE FUNCTION meridian_forbid_ledger_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only: % is not allowed', TG_OP;
END
$$;

CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION meridian_forbid_ledger_mutation();
