import { requestHash, stableStringify } from './idempotency.service';

describe('idempotency request hashing', () => {
  it('is invariant to object key order', () => {
    expect(stableStringify({ a: 1, b: { d: 4, c: 3 } })).toEqual(
      stableStringify({ b: { c: 3, d: 4 }, a: 1 }),
    );
    expect(requestHash('POST /x', { amountCents: 100, description: 'hi' })).toEqual(
      requestHash('POST /x', { description: 'hi', amountCents: 100 }),
    );
  });

  it('differs when the payload differs', () => {
    expect(requestHash('POST /x', { amountCents: 100 })).not.toEqual(
      requestHash('POST /x', { amountCents: 101 }),
    );
  });

  it('differs across endpoints for the same payload', () => {
    expect(requestHash('POST /payments', { amountCents: 100 })).not.toEqual(
      requestHash('POST /credits', { amountCents: 100 }),
    );
  });

  it('treats undefined fields as absent (JSON semantics)', () => {
    expect(stableStringify({ a: 1, b: undefined })).toEqual(stableStringify({ a: 1 }));
  });

  it('preserves array order', () => {
    expect(stableStringify([1, 2])).not.toEqual(stableStringify([2, 1]));
  });
});
