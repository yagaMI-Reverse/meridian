import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Request-path database client. Connects as the least-privilege `meridian_app`
 * role: no BYPASSRLS, no UPDATE/DELETE grants on ledger_entries.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService) {
    super({
      datasources: { db: { url: config.getOrThrow<string>('APP_DATABASE_URL') } },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Every tenant-scoped unit of work runs inside a single transaction that
   * first sets the transaction-local GUC `app.tenant_id`. The RLS policies
   * key off that setting; with it unset, policies match nothing (deny by
   * default). The tenant id always comes from the verified JWT — never from
   * client-supplied input.
   */
  withTenant<T>(tenantId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        return fn(tx);
      },
      // Generous limits: money-movement transactions queue on per-account row
      // locks under concurrency; better to wait than to fail spuriously.
      { maxWait: 15_000, timeout: 30_000 },
    );
  }
}
