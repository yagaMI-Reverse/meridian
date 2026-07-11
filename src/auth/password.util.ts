import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// scrypt via node:crypto — no native addon to compile, still a memory-hard KDF.
const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 32;

function scryptAsync(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, { N, r: R, p: P }, (err, derived) =>
      err ? reject(err) : resolve(derived),
    );
  });
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(plain, salt, KEY_LEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  const derived = await scryptAsync(plain, salt, expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
