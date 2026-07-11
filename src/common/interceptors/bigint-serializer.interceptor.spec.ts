import { serializeBigInts } from './bigint-serializer.interceptor';

describe('serializeBigInts', () => {
  it('converts safe BigInts to numbers, recursively', () => {
    expect(
      serializeBigInts({ balance: -7400n, nested: { items: [{ amountCents: 19900n }] } }),
    ).toEqual({ balance: -7400, nested: { items: [{ amountCents: 19900 }] } });
  });

  it('degrades out-of-range BigInts to strings instead of losing precision', () => {
    const huge = BigInt(Number.MAX_SAFE_INTEGER) * 10n;
    expect(serializeBigInts({ huge })).toEqual({ huge: huge.toString() });
  });

  it('leaves Dates, nulls and primitives intact', () => {
    const date = new Date('2026-07-11T00:00:00Z');
    expect(serializeBigInts({ date, none: null, s: 'x', n: 1.5, b: true })).toEqual({
      date,
      none: null,
      s: 'x',
      n: 1.5,
      b: true,
    });
  });
});
