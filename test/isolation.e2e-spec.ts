import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createAccount, createApp, createTenantFixture, TenantFixture } from './helpers';

describe('Tenant isolation (RLS) & append-only ledger (e2e)', () => {
  let app: INestApplication;
  let system: PrismaClient;
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;
  let accountA: { id: string };

  beforeAll(async () => {
    app = await createApp();
    system = new PrismaClient();
    tenantA = await createTenantFixture(app, system, 'iso-a');
    tenantB = await createTenantFixture(app, system, 'iso-b');
    accountA = await createAccount(app, tenantA.adminToken);
    await request(app.getHttpServer())
      .post(`/accounts/${accountA.id}/payments`)
      .set('Authorization', `Bearer ${tenantA.adminToken}`)
      .set('Idempotency-Key', `iso-seed-${accountA.id}`)
      .send({ amountCents: 5000 })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
    await system.$disconnect();
  });

  it("tenant B cannot read tenant A's account — RLS makes it a 404, not a 403", async () => {
    await request(app.getHttpServer())
      .get(`/accounts/${accountA.id}`)
      .set('Authorization', `Bearer ${tenantB.adminToken}`)
      .expect(404);
  });

  it("tenant B's account list never contains tenant A's rows", async () => {
    const res = await request(app.getHttpServer())
      .get('/accounts')
      .set('Authorization', `Bearer ${tenantB.adminToken}`)
      .expect(200);
    expect((res.body as { id: string }[]).map((a) => a.id)).not.toContain(accountA.id);
  });

  it('RLS filters RAW SQL too: same query, different tenant context, different rows', async () => {
    const prisma = app.get(PrismaService);

    const inA = await prisma.withTenant(tenantA.tenantId, (tx) =>
      tx.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM accounts`,
    );
    const inB = await prisma.withTenant(tenantB.tenantId, (tx) =>
      tx.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM accounts`,
    );

    expect(inA[0].n).toBeGreaterThanOrEqual(1);
    expect(inB[0].n).toBe(0);
  });

  it('deny by default: with no tenant context set, the app role sees zero rows', async () => {
    const prisma = app.get(PrismaService);
    const rows = await prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM accounts`;
    expect(rows[0].n).toBe(0);
  });

  it('RLS blocks cross-tenant INSERT: WITH CHECK rejects a foreign tenant_id', async () => {
    const prisma = app.get(PrismaService);
    await expect(
      prisma.withTenant(tenantB.tenantId, (tx) =>
        tx.$executeRaw`
          INSERT INTO accounts (tenant_id, name, email)
          VALUES (${tenantA.tenantId}::uuid, 'evil', 'evil@x.test')
        `,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('append-only, layer 1: the app role has no UPDATE/DELETE grants on ledger_entries', async () => {
    const prisma = app.get(PrismaService);
    await expect(
      prisma.withTenant(tenantA.tenantId, (tx) =>
        tx.$executeRaw`UPDATE ledger_entries SET amount_cents = 0`,
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      prisma.withTenant(tenantA.tenantId, (tx) => tx.$executeRaw`DELETE FROM ledger_entries`),
    ).rejects.toThrow(/permission denied/i);
  });

  it('append-only, layer 2: even the superuser is stopped by the trigger', async () => {
    await expect(
      system.$executeRaw`UPDATE ledger_entries SET amount_cents = 0 WHERE tenant_id = ${tenantA.tenantId}::uuid`,
    ).rejects.toThrow(/append-only/i);
    await expect(
      system.$executeRaw`DELETE FROM ledger_entries WHERE tenant_id = ${tenantA.tenantId}::uuid`,
    ).rejects.toThrow(/append-only/i);
  });
});
