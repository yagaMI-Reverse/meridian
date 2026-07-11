import { Injectable, NotFoundException } from '@nestjs/common';
import { LedgerEntryType, Prisma } from '@prisma/client';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { serializeBigInts } from '../common/interceptors/bigint-serializer.interceptor';
import { IdempotencyService } from '../ledger/idempotency.service';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { AdjustmentDto, CreditDto, PaymentDto } from './dto/money.dto';
import { LedgerQueryDto } from './dto/ledger-query.dto';

export interface MutationOutcome {
  replayed: boolean;
  status: number;
  body: unknown;
}

/** JSON-safe snapshot: BigInt → number, Date → ISO string. Stored responses and live responses stay byte-identical. */
function toPlain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(serializeBigInts(value)));
}

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
  ) {}

  create(user: AuthUser, dto: CreateAccountDto) {
    return this.prisma.withTenant(user.tenantId, (tx) =>
      tx.account.create({ data: { tenantId: user.tenantId, name: dto.name, email: dto.email } }),
    );
  }

  list(user: AuthUser) {
    return this.prisma.withTenant(user.tenantId, (tx) =>
      tx.account.findMany({ orderBy: { createdAt: 'asc' } }),
    );
  }

  async get(user: AuthUser, id: string) {
    const account = await this.prisma.withTenant(user.tenantId, (tx) =>
      tx.account.findUnique({ where: { id } }),
    );
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  ledgerPage(user: AuthUser, accountId: string, query: LedgerQueryDto) {
    return this.prisma.withTenant(user.tenantId, async (tx) => {
      const account = await tx.account.findUnique({ where: { id: accountId } });
      if (!account) throw new NotFoundException('Account not found');

      const take = query.take ?? 20;
      const entries = await tx.ledgerEntry.findMany({
        where: { accountId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: take + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const hasMore = entries.length > take;
      const items = hasMore ? entries.slice(0, take) : entries;
      return {
        accountId,
        balanceCents: account.balanceCents,
        items,
        nextCursor: hasMore ? items[items.length - 1].id : null,
      };
    });
  }

  recordPayment(user: AuthUser, accountId: string, dto: PaymentDto, key: string): Promise<MutationOutcome> {
    return this.mutate(user, key, 'POST /accounts/:id/payments', { accountId, ...dto }, (tx) =>
      this.ledger.append(tx, {
        tenantId: user.tenantId,
        accountId,
        type: LedgerEntryType.PAYMENT,
        amountCents: dto.amountCents,
        description: dto.description ?? 'Payment received',
        requestKey: key,
      }),
    );
  }

  recordCredit(user: AuthUser, accountId: string, dto: CreditDto, key: string): Promise<MutationOutcome> {
    return this.mutate(user, key, 'POST /accounts/:id/credits', { accountId, ...dto }, (tx) =>
      this.ledger.append(tx, {
        tenantId: user.tenantId,
        accountId,
        type: LedgerEntryType.CREDIT,
        amountCents: dto.amountCents,
        description: dto.description,
        requestKey: key,
      }),
    );
  }

  recordAdjustment(user: AuthUser, accountId: string, dto: AdjustmentDto, key: string): Promise<MutationOutcome> {
    return this.mutate(user, key, 'POST /accounts/:id/adjustments', { accountId, ...dto }, (tx) =>
      this.ledger.append(tx, {
        tenantId: user.tenantId,
        accountId,
        type: LedgerEntryType.ADJUSTMENT,
        amountCents: dto.amountCents,
        signedOverride: true,
        description: dto.description,
        requestKey: key,
      }),
    );
  }

  /**
   * One transaction wraps the idempotency claim, the ledger append, the
   * balance update AND the stored response snapshot — a retry can never
   * observe (or produce) a half-applied state.
   */
  private mutate(
    user: AuthUser,
    key: string,
    endpoint: string,
    payload: unknown,
    work: (tx: Prisma.TransactionClient) => Promise<{ entry: unknown; balanceAfter: bigint }>,
  ): Promise<MutationOutcome> {
    return this.prisma.withTenant(user.tenantId, async (tx) => {
      const idem = await this.idempotency.begin(tx, user.tenantId, key, endpoint, payload);
      if (idem.replay) return { replayed: true, status: idem.status, body: idem.body };

      const { entry, balanceAfter } = await work(tx);
      const body = toPlain({ entry, balanceAfterCents: balanceAfter });
      await this.idempotency.complete(tx, idem.recordId, 201, body);
      return { replayed: false, status: 201, body };
    });
  }
}
