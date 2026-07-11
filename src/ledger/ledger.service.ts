import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { LedgerEntryType, Prisma } from '@prisma/client';

export interface AppendParams {
  tenantId: string;
  accountId: string;
  type: LedgerEntryType;
  /** Absolute amount in cents; the sign is derived from the entry type. */
  amountCents: number;
  /** For ADJUSTMENT the caller passes a signed amount instead. */
  signedOverride?: boolean;
  description: string;
  requestKey?: string;
  subscriptionId?: string;
}

const NEGATIVE_TYPES: LedgerEntryType[] = [LedgerEntryType.CHARGE, LedgerEntryType.REFUND];

/**
 * The single write path into the ledger. Must be called inside a tenant
 * transaction (PrismaService.withTenant):
 *
 *  1. `SELECT … FOR UPDATE` locks the account row — concurrent writers to the
 *     same account queue here, so read-modify-write on the balance can never
 *     interleave.
 *  2. The entry INSERT and the balance UPDATE commit atomically, keeping the
 *     invariant `balance_cents == SUM(ledger_entries.amount_cents)`.
 *
 * The table itself is append-only: the app role has no UPDATE/DELETE grants
 * and a trigger blocks mutation for everyone else.
 */
@Injectable()
export class LedgerService {
  async append(tx: Prisma.TransactionClient, params: AppendParams) {
    const account = await tx.$queryRaw<
      { id: string; currency: string; balance_cents: bigint }[]
    >`
      SELECT id::text AS id, currency, balance_cents
      FROM accounts
      WHERE id = ${params.accountId}::uuid
      FOR UPDATE
    `;
    // RLS: a foreign tenant's account simply isn't visible — report 404, not 403.
    if (account.length === 0) {
      throw new NotFoundException('Account not found');
    }

    const signed = params.signedOverride
      ? BigInt(params.amountCents)
      : NEGATIVE_TYPES.includes(params.type)
        ? -BigInt(Math.abs(params.amountCents))
        : BigInt(Math.abs(params.amountCents));
    if (signed === 0n) {
      throw new UnprocessableEntityException('Amount must not be zero');
    }

    const entry = await tx.ledgerEntry.create({
      data: {
        tenantId: params.tenantId,
        accountId: params.accountId,
        type: params.type,
        amountCents: signed,
        currency: account[0].currency,
        description: params.description,
        requestKey: params.requestKey,
        subscriptionId: params.subscriptionId,
      },
    });

    const updated = await tx.account.update({
      where: { id: params.accountId },
      data: { balanceCents: { increment: signed } },
      select: { balanceCents: true },
    });

    return { entry, balanceAfter: updated.balanceCents };
  }
}
