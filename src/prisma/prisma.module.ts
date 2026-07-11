import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { SystemPrismaService } from './system-prisma.service';

/**
 * Two database identities:
 *  - PrismaService      → `meridian_app` role, RLS enforced. All request-path code.
 *  - SystemPrismaService → superuser/system role. Auth lookups (pre-tenant-context),
 *    seeding and cross-tenant jobs (reconciliation) only.
 */
@Global()
@Module({
  providers: [PrismaService, SystemPrismaService],
  exports: [PrismaService, SystemPrismaService],
})
export class PrismaModule {}
