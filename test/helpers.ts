import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/auth/password.util';

export const TEST_PASSWORD = 'test-password';

export async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  return app;
}

export interface TenantFixture {
  tenantId: string;
  slug: string;
  adminEmail: string;
  analystEmail: string;
  adminToken: string;
  analystToken: string;
}

/** Tenants/users are system-level rows (no tenant can create a tenant), so fixtures go through the system client. */
export async function createTenantFixture(
  app: INestApplication,
  system: PrismaClient,
  prefix: string,
): Promise<TenantFixture> {
  const slug = `${prefix}-${randomUUID().slice(0, 8)}`;
  const passwordHash = await hashPassword(TEST_PASSWORD);
  const tenant = await system.tenant.create({ data: { slug, name: `Test ${slug}` } });
  const adminEmail = `admin@${slug}.test`;
  const analystEmail = `analyst@${slug}.test`;
  await system.user.createMany({
    data: [
      { tenantId: tenant.id, email: adminEmail, role: UserRole.ADMIN, passwordHash },
      { tenantId: tenant.id, email: analystEmail, role: UserRole.ANALYST, passwordHash },
    ],
  });

  const login = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ tenant: slug, email, password: TEST_PASSWORD })
      .expect(200);
    return (res.body as { accessToken: string }).accessToken;
  };

  return {
    tenantId: tenant.id,
    slug,
    adminEmail,
    analystEmail,
    adminToken: await login(adminEmail),
    analystToken: await login(analystEmail),
  };
}

export async function createAccount(
  app: INestApplication,
  token: string,
  name = 'Test Customer',
): Promise<{ id: string; balanceCents: number }> {
  const res = await request(app.getHttpServer())
    .post('/accounts')
    .set('Authorization', `Bearer ${token}`)
    .send({ name, email: `${randomUUID().slice(0, 12)}@customer.test` })
    .expect(201);
  return res.body as { id: string; balanceCents: number };
}
