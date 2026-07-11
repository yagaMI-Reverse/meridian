import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { SystemPrismaService } from '../prisma/system-prisma.service';

interface BalanceRow {
  account_id: string;
  tenant_id: string;
  balance_cents: bigint;
  ledger_sum: bigint;
}

export interface Drift {
  accountId: string;
  tenantId: string;
  balanceCents: number;
  ledgerSumCents: number;
  driftCents: number;
}

/**
 * Continuously proves the core invariant: for every account,
 * `balance_cents == SUM(ledger_entries.amount_cents)`. Runs cross-tenant
 * under the system role (RLS does not apply — this is an integrity job, not
 * a tenant request), hourly by cron and on demand via the admin endpoint.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(private readonly system: SystemPrismaService) {}

  async run(trigger: 'manual' | 'cron') {
    const startedAt = new Date();

    // One set-based pass — no per-account round trips.
    const rows = await this.system.$queryRaw<BalanceRow[]>`
      SELECT
        a.id::text        AS account_id,
        a.tenant_id::text AS tenant_id,
        a.balance_cents   AS balance_cents,
        COALESCE(SUM(l.amount_cents), 0)::bigint AS ledger_sum
      FROM accounts a
      LEFT JOIN ledger_entries l ON l.account_id = a.id
      GROUP BY a.id
    `;

    const drifts: Drift[] = rows
      .filter((r) => r.balance_cents !== r.ledger_sum)
      .map((r) => ({
        accountId: r.account_id,
        tenantId: r.tenant_id,
        balanceCents: Number(r.balance_cents),
        ledgerSumCents: Number(r.ledger_sum),
        driftCents: Number(r.balance_cents - r.ledger_sum),
      }));

    const run = await this.system.reconciliationRun.create({
      data: {
        startedAt,
        finishedAt: new Date(),
        accountsChecked: rows.length,
        driftCount: drifts.length,
        drifts: drifts as unknown as Prisma.InputJsonValue,
        trigger,
      },
    });

    if (drifts.length > 0) {
      this.logger.error(`Reconciliation found ${drifts.length} drifted account(s)!`);
    } else {
      this.logger.log(`Reconciliation clean: ${rows.length} account(s), zero drift`);
    }
    return run;
  }

  @Cron(CronExpression.EVERY_HOUR)
  scheduled() {
    this.run('cron').catch((err) => this.logger.error(`Scheduled reconciliation failed: ${err}`));
  }

  latest() {
    return this.system.reconciliationRun.findFirst({ orderBy: { startedAt: 'desc' } });
  }

  list() {
    return this.system.reconciliationRun.findMany({ orderBy: { startedAt: 'desc' }, take: 20 });
  }
}
