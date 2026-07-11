import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createAccount, createApp, createTenantFixture, TenantFixture } from './helpers';

/**
 * The fintech screening questions, answered by a running test:
 *  - Does the balance drift under concurrent writes + client retries? (no)
 *  - Are retries idempotent even when they race the original? (yes)
 *  - Does reconciliation actually catch corruption when it happens? (yes)
 */
describe('Concurrency: balance never drifts (e2e)', () => {
  let app: INestApplication;
  let system: PrismaClient;
  let fx: TenantFixture;

  beforeAll(async () => {
    app = await createApp();
    system = new PrismaClient();
    fx = await createTenantFixture(app, system, 'conc');
  });

  afterAll(async () => {
    await app.close();
    await system.$disconnect();
  });

  const auth = { get Authorization() { return `Bearer ${fx.adminToken}`; } };

  async function ledgerSumVsBalance(accountId: string) {
    const rows = await system.$queryRaw<{ balance: bigint; ledger_sum: bigint }[]>`
      SELECT
        a.balance_cents AS balance,
        (SELECT COALESCE(SUM(amount_cents), 0)::bigint FROM ledger_entries WHERE account_id = a.id) AS ledger_sum
      FROM accounts a WHERE a.id = ${accountId}::uuid
    `;
    return rows[0];
  }

  it('25 unique payments, each fired TWICE concurrently → exactly 25 entries, balance == SUM(ledger)', async () => {
    const account = await createAccount(app, fx.adminToken);
    const payments = Array.from({ length: 25 }, (_, i) => ({
      key: `conc-pay-${account.id}-${i}`,
      amountCents: (i + 1) * 111,
    }));

    const fire = (p: { key: string; amountCents: number }) =>
      request(app.getHttpServer())
        .post(`/accounts/${account.id}/payments`)
        .set(auth)
        .set('Idempotency-Key', p.key)
        .send({ amountCents: p.amountCents, description: `storm ${p.key}` });

    // 50 requests in flight at once: every payment races its own retry.
    const responses = await Promise.all(payments.flatMap((p) => [fire(p), fire(p)]));

    for (const res of responses) expect(res.status).toBe(201);

    // Each original/retry pair must resolve to the SAME ledger entry.
    for (let i = 0; i < payments.length; i++) {
      const [a, b] = [responses[i * 2], responses[i * 2 + 1]];
      expect(a.body.entry.id).toBe(b.body.entry.id);
    }

    const expectedSum = payments.reduce((sum, p) => sum + p.amountCents, 0);
    const acc = await request(app.getHttpServer()).get(`/accounts/${account.id}`).set(auth).expect(200);
    expect(acc.body.balanceCents).toBe(expectedSum);

    const ledger = await request(app.getHttpServer())
      .get(`/accounts/${account.id}/ledger?take=100`)
      .set(auth)
      .expect(200);
    expect(ledger.body.items).toHaveLength(25);

    const { balance, ledger_sum } = await ledgerSumVsBalance(account.id);
    expect(balance).toBe(ledger_sum);
    expect(balance).toBe(BigInt(expectedSum));
  });

  it('mixed credits and negative adjustments interleaved concurrently keep the invariant', async () => {
    const account = await createAccount(app, fx.adminToken);

    const ops = [
      ...Array.from({ length: 15 }, (_, i) => ({
        path: 'credits',
        body: { amountCents: (i + 1) * 97, description: `credit ${i}` },
        key: `conc-cred-${account.id}-${i}`,
      })),
      ...Array.from({ length: 15 }, (_, i) => ({
        path: 'adjustments',
        body: { amountCents: -((i + 1) * 53), description: `correction ${i}` },
        key: `conc-adj-${account.id}-${i}`,
      })),
    ];

    const responses = await Promise.all(
      ops.map((op) =>
        request(app.getHttpServer())
          .post(`/accounts/${account.id}/${op.path}`)
          .set(auth)
          .set('Idempotency-Key', op.key)
          .send(op.body),
      ),
    );
    for (const res of responses) expect(res.status).toBe(201);

    const expected =
      ops.reduce((sum, op) => sum + op.body.amountCents, 0);
    const { balance, ledger_sum } = await ledgerSumVsBalance(account.id);
    expect(balance).toBe(ledger_sum);
    expect(balance).toBe(BigInt(expected));

    // And reconciliation agrees: this account is not drifted.
    const run = await request(app.getHttpServer()).post('/reconciliation/run').set(auth).expect(200);
    const drifted = (run.body.drifts as { accountId: string }[]).map((d) => d.accountId);
    expect(drifted).not.toContain(account.id);
  });

  it('reconciliation DOES catch a manufactured drift (and reports its exact size)', async () => {
    const account = await createAccount(app, fx.adminToken);
    await request(app.getHttpServer())
      .post(`/accounts/${account.id}/payments`)
      .set(auth)
      .set('Idempotency-Key', `drift-seed-${account.id}`)
      .send({ amountCents: 5000 })
      .expect(201);

    // Sabotage: superuser edits the materialized balance behind the ledger's back.
    await system.$executeRaw`UPDATE accounts SET balance_cents = balance_cents + 777 WHERE id = ${account.id}::uuid`;

    const run = await request(app.getHttpServer()).post('/reconciliation/run').set(auth).expect(200);
    const drift = (run.body.drifts as { accountId: string; driftCents: number }[]).find(
      (d) => d.accountId === account.id,
    );
    expect(drift).toBeDefined();
    expect(drift!.driftCents).toBe(777);

    // Repair so later sweeps in this suite stay clean.
    await system.$executeRaw`UPDATE accounts SET balance_cents = balance_cents - 777 WHERE id = ${account.id}::uuid`;
    const clean = await request(app.getHttpServer()).post('/reconciliation/run').set(auth).expect(200);
    expect((clean.body.drifts as { accountId: string }[]).map((d) => d.accountId)).not.toContain(account.id);
  });
});
