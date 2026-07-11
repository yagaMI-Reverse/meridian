import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp, createTenantFixture, TenantFixture, TEST_PASSWORD } from './helpers';

describe('Auth & access control (e2e)', () => {
  let app: INestApplication;
  let system: PrismaClient;
  let fx: TenantFixture;

  beforeAll(async () => {
    app = await createApp();
    system = new PrismaClient();
    fx = await createTenantFixture(app, system, 'auth');
  });

  afterAll(async () => {
    await app.close();
    await system.$disconnect();
  });

  it('GET /health is public', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('logs in with valid tenant credentials', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ tenant: fx.slug, email: fx.adminEmail, password: TEST_PASSWORD })
      .expect(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.role).toBe('ADMIN');
    expect(res.body.tenant.slug).toBe(fx.slug);
  });

  it('rejects a wrong password with 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ tenant: fx.slug, email: fx.adminEmail, password: 'wrong' })
      .expect(401);
  });

  it('rejects an unknown tenant with 401 (no user enumeration)', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ tenant: 'no-such-tenant', email: fx.adminEmail, password: TEST_PASSWORD })
      .expect(401);
  });

  it('validates the login payload (400)', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ tenant: fx.slug, email: 'not-an-email', password: 'x' })
      .expect(400);
  });

  it('blocks protected routes without a token (401)', async () => {
    await request(app.getHttpServer()).get('/accounts').expect(401);
  });

  it('blocks protected routes with a garbage token (401)', async () => {
    await request(app.getHttpServer())
      .get('/accounts')
      .set('Authorization', 'Bearer not.a.jwt')
      .expect(401);
  });

  it('enforces RBAC: ANALYST cannot POST /plans (403)', async () => {
    await request(app.getHttpServer())
      .post('/plans')
      .set('Authorization', `Bearer ${fx.analystToken}`)
      .send({ code: 'blocked', name: 'Blocked', amountCents: 100 })
      .expect(403);
  });
});
