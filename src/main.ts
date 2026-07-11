import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Meridian — Multi-Tenant Billing Ledger API')
    .setDescription(
      [
        'A financial-grade billing ledger: **append-only entries**, **idempotent money movements**, ',
        'and **PostgreSQL row-level security** scoping every query to the tenant in the JWT.',
        '',
        '**Core invariant:** `accounts.balance_cents == SUM(ledger_entries.amount_cents)` — ',
        'guaranteed by single-transaction writes with row locks, and continuously verified by the reconciliation job.',
        '',
        '**Idempotency:** send an `Idempotency-Key` header on POSTs that move money. ',
        'Retries with the same key replay the original response (`Idempotency-Replayed: true`); ',
        'the same key with a different payload is rejected with `422`.',
        '',
        'Sign convention: `PAYMENT`/`CREDIT` are positive, `CHARGE`/`REFUND` are negative, ',
        '`ADJUSTMENT` is signed. A negative balance means the customer owes money.',
        '',
        'Demo logins (seeded): `admin@northwind.demo` / `analyst@northwind.demo` on tenant `northwind`, ',
        'same pattern on tenant `acme`. Password: `demo-password`.',
      ].join('\n'),
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'JWT from POST /auth/login' },
      'bearer',
    )
    .addTag('auth', 'Issue tenant-scoped JWTs')
    .addTag('accounts', 'Customer accounts, payments, credits and their ledgers')
    .addTag('plans', 'Billing plans per tenant')
    .addTag('subscriptions', 'Subscriptions — creating one posts the first charge atomically')
    .addTag('reconciliation', 'Drift detection: materialized balance vs SUM(ledger)')
    .addTag('health', 'Liveness')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'Meridian API',
    swaggerOptions: { persistAuthorization: true, defaultModelsExpandDepth: -1 },
  });

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  new Logger('bootstrap').log(`Meridian listening on :${port} — Swagger UI at /docs`);
}

void bootstrap();
