import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';

export type IdempotencyBegin =
  | { replay: false; recordId: string }
  | { replay: true; status: number; body: unknown };

/** Deterministic JSON: object keys sorted recursively, so hash({a,b}) === hash({b,a}). */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function requestHash(endpoint: string, payload: unknown): string {
  return createHash('sha256').update(stableStringify({ endpoint, payload })).digest('hex');
}

/**
 * Stripe-style idempotency, transactional with the work it protects:
 *
 *  1. INSERT … ON CONFLICT DO NOTHING claims the key. Under a concurrent
 *     duplicate, Postgres blocks the second insert on the unique index until
 *     the first transaction commits — the database serializes retries for us.
 *  2. Fresh claim → caller does the real work, then complete() stores the
 *     response inside the same transaction. Key claim + ledger write + balance
 *     update + response snapshot commit or roll back atomically.
 *  3. Replayed key + same payload → the stored response is returned verbatim.
 *     Same key + different payload → 422 (client bug, never silently accepted).
 */
@Injectable()
export class IdempotencyService {
  async begin(
    tx: Prisma.TransactionClient,
    tenantId: string,
    key: string,
    endpoint: string,
    payload: unknown,
  ): Promise<IdempotencyBegin> {
    const hash = requestHash(endpoint, payload);

    const claimed = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO idempotency_records (tenant_id, key, endpoint, request_hash)
      VALUES (${tenantId}::uuid, ${key}, ${endpoint}, ${hash})
      ON CONFLICT (tenant_id, key) DO NOTHING
      RETURNING id::text AS id
    `;
    if (claimed.length > 0) {
      return { replay: false, recordId: claimed[0].id };
    }

    const existing = await tx.idempotencyRecord.findUnique({
      where: { tenantId_key: { tenantId, key } },
    });
    if (!existing) {
      // The claiming transaction rolled back between our INSERT and SELECT.
      throw new ConflictException('Original request failed mid-flight — retry');
    }
    if (existing.requestHash !== hash) {
      throw new UnprocessableEntityException(
        'Idempotency-Key was already used with a different payload',
      );
    }
    if (existing.responseStatus === null) {
      throw new ConflictException('Original request is still in flight — retry shortly');
    }
    return { replay: true, status: existing.responseStatus, body: existing.responseBody };
  }

  async complete(
    tx: Prisma.TransactionClient,
    recordId: string,
    status: number,
    body: unknown,
  ): Promise<void> {
    await tx.idempotencyRecord.update({
      where: { id: recordId },
      data: {
        responseStatus: status,
        responseBody: body as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
  }
}
