import { Injectable, NotFoundException } from '@nestjs/common';
import { LedgerEntryType, PlanInterval, SubscriptionStatus } from '@prisma/client';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { serializeBigInts } from '../common/interceptors/bigint-serializer.interceptor';
import { IdempotencyService } from '../ledger/idempotency.service';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { MutationOutcome } from '../accounts/accounts.service';

function addInterval(from: Date, interval: PlanInterval): Date {
  const next = new Date(from);
  if (interval === PlanInterval.YEARLY) next.setFullYear(next.getFullYear() + 1);
  else next.setMonth(next.getMonth() + 1);
  return next;
}

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * Subscription row + first CHARGE entry + balance update + idempotency
   * snapshot: one transaction. A retried create can never double-charge, and
   * a failed create leaves no orphan subscription.
   */
  create(user: AuthUser, dto: CreateSubscriptionDto, key: string): Promise<MutationOutcome> {
    return this.prisma.withTenant(user.tenantId, async (tx) => {
      const idem = await this.idempotency.begin(
        tx,
        user.tenantId,
        key,
        'POST /subscriptions',
        dto,
      );
      if (idem.replay) return { replayed: true, status: idem.status, body: idem.body };

      const plan = await tx.plan.findUnique({
        where: { tenantId_code: { tenantId: user.tenantId, code: dto.planCode } },
      });
      if (!plan) throw new NotFoundException('Plan not found');

      const account = await tx.account.findUnique({
        where: { id: dto.accountId },
        select: { id: true },
      });
      if (!account) throw new NotFoundException('Account not found');

      const subscription = await tx.subscription.create({
        data: {
          tenantId: user.tenantId,
          accountId: dto.accountId,
          planId: plan.id,
          currentPeriodEnd: addInterval(new Date(), plan.interval),
        },
        include: { plan: true },
      });

      const { entry, balanceAfter } = await this.ledger.append(tx, {
        tenantId: user.tenantId,
        accountId: dto.accountId,
        type: LedgerEntryType.CHARGE,
        amountCents: plan.amountCents,
        description: `Subscription charge — ${plan.name}`,
        requestKey: key,
        subscriptionId: subscription.id,
      });

      const body = JSON.parse(
        JSON.stringify(serializeBigInts({ subscription, firstCharge: entry, balanceAfterCents: balanceAfter })),
      ) as unknown;
      await this.idempotency.complete(tx, idem.recordId, 201, body);
      return { replayed: false, status: 201, body };
    });
  }

  list(user: AuthUser) {
    return this.prisma.withTenant(user.tenantId, (tx) =>
      tx.subscription.findMany({ include: { plan: true }, orderBy: { createdAt: 'desc' } }),
    );
  }

  cancel(user: AuthUser, id: string) {
    return this.prisma.withTenant(user.tenantId, async (tx) => {
      const sub = await tx.subscription.findUnique({ where: { id }, include: { plan: true } });
      if (!sub) throw new NotFoundException('Subscription not found');
      if (sub.status === SubscriptionStatus.CANCELED) return sub;
      return tx.subscription.update({
        where: { id },
        data: { status: SubscriptionStatus.CANCELED, canceledAt: new Date() },
        include: { plan: true },
      });
    });
  }
}
