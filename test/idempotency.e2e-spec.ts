import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createAccount, createApp, createTenantFixture, TenantFixture } from './helpers';

describe('Idempotency semantics (e2e)', () => {
  let app: INestApplication;
  let system: PrismaClient;
  let fx: TenantFixture;

  beforeAll(async () => {
    app = await createApp();
    system = new PrismaClient();
    fx = await createTenantFixture(app, system, 'idem');
  });

  afterAll(async () => {
    await app.close();
    await system.$disconnect();
  });

  const auth = { get Authorization() { return `Bearer ${fx.adminToken}`; } };

  it('replays the original response on retry: same body, same entry id, one ledger entry', async () => {
    const account = await createAccount(app, fx.adminToken);
    const key = randomUUID();
    const payload = { amountCents: 12345, description: 'retried payment' };

    const first = await request(app.getHttpServer())
      .post(`/accounts/${account.id}/payments`)
      .set(auth)
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(201);
    expect(first.headers['idempotency-replayed']).toBeUndefined();

    const retry = await request(app.getHttpServer())
      .post(`/accounts/${account.id}/payments`)
      .set(auth)
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(201);

    expect(retry.headers['idempotency-replayed']).toBe('true');
    expect(retry.body).toEqual(first.body);

    const ledger = await request(app.getHttpServer())
      .get(`/accounts/${account.id}/ledger`)
      .set(auth)
      .expect(200);
    expect(ledger.body.items).toHaveLength(1);
    expect(ledger.body.balanceCents).toBe(12345);
  });

  it('rejects the same key with a different payload (422) without touching the ledger', async () => {
    const account = await createAccount(app, fx.adminToken);
    const key = randomUUID();

    await request(app.getHttpServer())
      .post(`/accounts/${account.id}/payments`)
      .set(auth)
      .set('Idempotency-Key', key)
      .send({ amountCents: 1000 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/accounts/${account.id}/payments`)
      .set(auth)
      .set('Idempotency-Key', key)
      .send({ amountCents: 2000 })
      .expect(422);

    const acc = await request(app.getHttpServer()).get(`/accounts/${account.id}`).set(auth).expect(200);
    expect(acc.body.balanceCents).toBe(1000);
  });

  it('scopes keys per tenant: another tenant can reuse the same key', async () => {
    const other = await createTenantFixture(app, system, 'idem2');
    const key = `shared-${randomUUID().slice(0, 8)}`;

    const a = await createAccount(app, fx.adminToken);
    const b = await createAccount(app, other.adminToken);

    await request(app.getHttpServer())
      .post(`/accounts/${a.id}/payments`)
      .set('Authorization', `Bearer ${fx.adminToken}`)
      .set('Idempotency-Key', key)
      .send({ amountCents: 500 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/accounts/${b.id}/payments`)
      .set('Authorization', `Bearer ${other.adminToken}`)
      .set('Idempotency-Key', key)
      .send({ amountCents: 700 })
      .expect(201);
  });

  it('a failed request does not burn the key', async () => {
    const account = await createAccount(app, fx.adminToken);
    const key = randomUUID();

    // 404 — account from another world; transaction rolls back, key stays free.
    await request(app.getHttpServer())
      .post(`/accounts/${randomUUID()}/payments`)
      .set(auth)
      .set('Idempotency-Key', key)
      .send({ amountCents: 1000 })
      .expect(404);

    await request(app.getHttpServer())
      .post(`/accounts/${account.id}/payments`)
      .set(auth)
      .set('Idempotency-Key', key)
      .send({ amountCents: 1000 })
      .expect(201);
  });
});
