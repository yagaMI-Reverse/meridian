import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extracts and validates the `Idempotency-Key` header. Endpoints that move
 * money require it — a retry storm without keys is how balances drift.
 */
export const IdempotencyKey = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
  const raw = req.headers['idempotency-key'];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key || key.trim().length === 0) {
    throw new BadRequestException('Idempotency-Key header is required for this endpoint');
  }
  if (key.length > 200) {
    throw new BadRequestException('Idempotency-Key must be at most 200 characters');
  }
  return key.trim();
});
