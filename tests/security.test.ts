import {
  ScryptHasher,
  BcryptHasher,
  JwtTokens,
} from '../src/modules/auth/security';
import { configSchema } from '../src/config';
const secret = 'test-only-secret-that-is-at-least-32-characters';
describe('identity security', () => {
  test('password hashes are salted and verify securely', async () => {
    const hasher = new ScryptHasher();
    const first = await hasher.hash('strong-password-123');
    expect(first).not.toContain('strong-password');
    expect(await hasher.hash('strong-password-123')).not.toEqual(first);
    expect(await hasher.verify('strong-password-123', first)).toBe(true);
    expect(await hasher.verify('wrong-password', first)).toBe(false);
  });
  test('JWT enforces signature, issuer and identity', () => {
    const tokens = new JwtTokens(secret);
    const identity = {
      sub: 'e241484c-f388-4d9b-9cd7-f35ccab53280',
      role: 'CUSTOMER' as const,
    };
    expect(tokens.verify(tokens.sign(identity))).toEqual(identity);
    expect(() =>
      new JwtTokens('a-different-secret-value-32-characters').verify(
        tokens.sign(identity),
      ),
    ).toThrow();
    expect(() => tokens.verify('garbage')).toThrow();
  });
  test('startup rejects missing or weak secrets', () => {
    expect(() =>
      configSchema.parse({
        DATABASE_URL: 'postgresql://localhost/db',
        REDIS_URL: 'redis://localhost',
        JWT_SECRET: 'weak',
        CORS_ORIGINS: 'https://shop.example',
      }),
    ).toThrow();
  });
});

test('versioned bcrypt supports legacy hashes and does not truncate long Unicode passwords', async () => {
  const hasher = new BcryptHasher();
  const password = '🔐'.repeat(30);
  const hash = await hasher.hash(password);
  expect(hash).toMatch(/^bcrypt-sha256:v1:\$2/);
  expect(await hasher.verify(password, hash)).toBe(true);
  expect(await hasher.verify(password + 'different-suffix', hash)).toBe(false);
  const legacy = await new ScryptHasher().hash('legacy-password-123');
  expect(await hasher.verify('legacy-password-123', legacy)).toBe(true);
  expect(hasher.needsRehash(legacy)).toBe(true);
  expect(hasher.needsRehash(hash)).toBe(false);
});

test('expired access tokens are rejected', () => {
  const tokens = new JwtTokens(secret);
  const token = tokens.sign({
    sub: 'e241484c-f388-4d9b-9cd7-f35ccab53280',
    role: 'CUSTOMER',
  });
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 901000);
  try {
    expect(() => tokens.verify(token)).toThrow('expired');
  } finally {
    clock.mockRestore();
  }
});
