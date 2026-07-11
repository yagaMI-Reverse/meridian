import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createAccount, createApp, createTenantFixture, TenantFixture } from './helpers';

describe('Subscriptions (e2e)', () => {
  let app: INestApplication;
  let system: PrismaClient;
  let fx: TenantFixture;

  beforeAll(async () => {
    app = await createApp();
    system = new PrismaClient();
    fx = await createTenantFixture(app, system, 'subs');
    await request(app.getHttpServer())
      .post('/plans')
      .set('Authorization', `Bearer ${fx.adminToken}`)
      .send({ code: 'growth', name: 'Growth', amountCents: 19900 })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
    await system.$disconnect();
  });

  const auth = { get Authorization() { return `Bearer ${fx.adminToken}`; } };

  it('creates a subscription and posts the first charge atomically', async () => {
    const account = await createAccount(app, fx.adminToken);
    const res = await request(app.getHttpServer())
      .post('/subscriptions')
      .set(auth)
      .set('Idempotency-Key', randomUUID())
      .send({ accountId: account.id, planCode: 'growth' })
      .expect(201);

    expect(res.body.subscription.status).toBe('ACTIVE');
    expect(res.body.firstCharge.type).toBe('CHARGE');
    expect(res.body.firstCharge.amountCents).toBe(-19900);
    expect(res.body.balanceAfterCents).toBe(-19900);

    const ledger = await request(app.getHttpServer())
      .get(`/accounts/${account.id}/ledger`)
      .set(auth)
      .expect(200);
    expect(ledger.body.items).toHaveLength(1);
    expect(ledger.body.items[0].subscriptionId).toBe(res.body.subscription.id);
  });

  it('a retried create cannot double-charge: same subscription, one CHARGE', async () => {
    const account = await createAccount(app, fx.adminToken);
    const key = randomUUID();
    const send = () =>
      request(app.getHttpServer())
        .post('/subscriptions')
        .set(auth)
        .set('Idempotency-Key', key)
        .send({ accountId: account.id, planCode: 'growth' });

    const first = await send().expect(201);
    const retry = await send().expect(201);

    expect(retry.headers['idempotency-replayed']).toBe('true');
    expect(retry.body.subscription.id).toBe(first.body.subscription.id);

    const acc = await request(app.getHttpServer()).get(`/accounts/${account.id}`).set(auth).expect(200);
    expect(acc.body.balanceCents).toBe(-19900);
  });

  it('unknown plan → 404, and the failed attempt leaves no orphan subscription', async () => {
    const account = await createAccount(app, fx.adminToken);
    await request(app.getHttpServer())
      .post('/subscriptions')
      .set(auth)
      .set('Idempotency-Key', randomUUID())
      .send({ accountId: account.id, planCode: 'no-such-plan' })
      .expect(404);

    const subs = await request(app.getHttpServer()).get('/subscriptions').set(auth).expect(200);
    expect((subs.body as { accountId: string }[]).filter((s) => s.accountId === account.id)).toHaveLength(0);
  });

  it('cancel is idempotent and has no retroactive ledger effect', async () => {
    const account = await createAccount(app, fx.adminToken);
    const created = await request(app.getHttpServer())
      .post('/subscriptions')
      .set(auth)
      .set('Idempotency-Key', randomUUID())
      .send({ accountId: account.id, planCode: 'growth' })
      .expect(201);
    const subId = created.body.subscription.id as string;

    const first = await request(app.getHttpServer()).delete(`/subscriptions/${subId}`).set(auth).expect(200);
    expect(first.body.status).toBe('CANCELED');
    const second = await request(app.getHttpServer()).delete(`/subscriptions/${subId}`).set(auth).expect(200);
    expect(second.body.status).toBe('CANCELED');

    const acc = await request(app.getHttpServer()).get(`/accounts/${account.id}`).set(auth).expect(200);
    expect(acc.body.balanceCents).toBe(-19900);
  });
});
