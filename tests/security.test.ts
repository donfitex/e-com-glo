import { ScryptHasher, JwtTokens } from '../src/modules/auth/security';
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
