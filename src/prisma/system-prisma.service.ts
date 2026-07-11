import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

/**
 * System-role client (RLS not applied). Used ONLY for:
 *  - auth: resolving tenant + user before a tenant context exists
 *  - reconciliation: cross-tenant integrity sweeps
 * Never expose this client to request handlers that act on behalf of a tenant.
 */
@Injectable()
export class SystemPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService) {
    super({
      datasources: { db: { url: config.getOrThrow<string>('DATABASE_URL') } },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
