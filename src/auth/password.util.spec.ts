import { hashPassword, verifyPassword } from './password.util';

describe('password.util (scrypt)', () => {
  it('hashes and verifies a password round-trip', async () => {
    const hash = await hashPassword('s3cret-Pa$$');
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    await expect(verifyPassword('s3cret-Pa$$', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct');
    await expect(verifyPassword('incorrect', hash)).resolves.toBe(false);
  });

  it('produces a unique salt per hash', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toEqual(b);
  });

  it('rejects malformed stored hashes instead of throwing', async () => {
    await expect(verifyPassword('x', 'not-a-hash')).resolves.toBe(false);
    await expect(verifyPassword('x', 'bcrypt$whatever$else$x$y$z')).resolves.toBe(false);
  });
});
