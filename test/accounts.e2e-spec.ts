import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createAccount, createApp, createTenantFixture, TenantFixture } from './helpers';

describe('Accounts & ledger (e2e)', () => {
  let app: INestApplication;
  let system: PrismaClient;
  let fx: TenantFixture;

  beforeAll(async () => {
    app = await createApp();
    system = new PrismaClient();
    fx = await createTenantFixture(app, system, 'acct');
  });

  afterAll(async () => {
    await app.close();
    await system.$disconnect();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('creates an account with a zero balance', async () => {
    const account = await createAccount(app, fx.adminToken);
    expect(account.balanceCents).toBe(0);
  });

  it('rejects a duplicate email within the tenant (409)', async () => {
    const email = `dup-${randomUUID().slice(0, 8)}@customer.test`;
    const payload = { name: 'Dup', email };
    await request(app.getHttpServer()).post('/accounts').set(auth(fx.adminToken)).send(payload).expect(201);
    await request(app.getHttpServer()).post('/accounts').set(auth(fx.adminToken)).send(payload).expect(409);
  });

  it('validates DTOs: bad email, unknown fields, bad amounts → 400', async () => {
    const server = app.getHttpServer();
    await request(server).post('/accounts').set(auth(fx.adminToken)).send({ name: 'X', email: 'nope' }).expect(400);
    await request(server)
      .post('/accounts')
      .set(auth(fx.adminToken))
      .send({ name: 'X', email: 'ok@x.test', hacker: true })
      .expect(400);
    const account = await createAccount(app, fx.adminToken);
    await request(server)
      .post(`/accounts/${account.id}/payments`)
      .set(auth(fx.adminToken))
      .set('Idempotency-Key', randomUUID())
      .send({ amountCents: -100 })
      .expect(400);
    await request(server)
      .post(`/accounts/${account.id}/payments`)
      .set(auth(fx.adminToken))
      .set('Idempotency-Key', randomUUID())
      .send({ amountCents: 10.5 })
      .expect(400);
  });

  it('requires the Idempotency-Key header on money movements (400)', async () => {
    const account = await createAccount(app, fx.adminToken);
    await request(app.getHttpServer())
      .post(`/accounts/${account.id}/payments`)
      .set(auth(fx.adminToken))
      .send({ amountCents: 100 })
      .expect(400);
  });

  it('returns 404 for a non-existent account id', async () => {
    await request(app.getHttpServer()).get(`/accounts/${randomUUID()}`).set(auth(fx.adminToken)).expect(404);
  });

  it('applies payment → balance and ledger reflect it', async () => {
    const account = await createAccount(app, fx.adminToken);
    const res = await request(app.getHttpServer())
      .post(`/accounts/${account.id}/payments`)
      .set(auth(fx.adminToken))
      .set('Idempotency-Key', randomUUID())
      .send({ amountCents: 4900, description: 'first payment' })
      .expect(201);
    expect(res.body.entry.type).toBe('PAYMENT');
    expect(res.body.entry.amountCents).toBe(4900);
    expect(res.body.balanceAfterCents).toBe(4900);

    const acc = await request(app.getHttpServer()).get(`/accounts/${account.id}`).set(auth(fx.adminToken)).expect(200);
    expect(acc.body.balanceCents).toBe(4900);
  });

  it('ANALYST can record payments but not credits/adjustments', async () => {
    const account = await createAccount(app, fx.adminToken);
    await request(app.getHttpServer())
      .post(`/accounts/${account.id}/payments`)
      .set(auth(fx.analystToken))
      .set('Idempotency-Key', randomUUID())
      .send({ amountCents: 100 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/accounts/${account.id}/credits`)
      .set(auth(fx.analystToken))
      .set('Idempotency-Key', randomUUID())
      .send({ amountCents: 100, description: 'no' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/accounts/${account.id}/adjustments`)
      .set(auth(fx.analystToken))
      .set('Idempotency-Key', randomUUID())
      .send({ amountCents: -100, description: 'no' })
      .expect(403);
  });

  it('pages the ledger with a stable cursor and no duplicates', async () => {
    const account = await createAccount(app, fx.adminToken);
    for (let i = 1; i <= 5; i++) {
      await request(app.getHttpServer())
        .post(`/accounts/${account.id}/payments`)
        .set(auth(fx.adminToken))
        .set('Idempotency-Key', `page-${account.id}-${i}`)
        .send({ amountCents: i * 100 })
        .expect(201);
    }

    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `/accounts/${account.id}/ledger?take=2${cursor ? `&cursor=${cursor}` : ''}`;
      const res = await request(app.getHttpServer()).get(url).set(auth(fx.adminToken)).expect(200);
      for (const item of res.body.items as { id: string }[]) {
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
      }
      cursor = res.body.nextCursor as string | null;
      pages += 1;
    } while (cursor && pages < 10);

    expect(seen.size).toBe(5);
    expect(pages).toBe(3); // 2 + 2 + 1
  });
});
