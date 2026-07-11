import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

/**
 * Prisma returns BIGINT columns as JS BigInt, which JSON.stringify rejects.
 * Cent amounts fit comfortably in the safe-integer range, so serialize them
 * as numbers; anything beyond degrades to a string rather than losing
 * precision silently.
 */
export function serializeBigInts(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value <= MAX_SAFE && value >= MIN_SAFE ? Number(value) : value.toString();
  }
  if (Array.isArray(value)) return value.map(serializeBigInts);
  if (value instanceof Date) return value;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serializeBigInts(v)]));
  }
  return value;
}

@Injectable()
export class BigIntSerializerInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map(serializeBigInts));
  }
}
