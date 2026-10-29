import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { AppError } from '../../shared/errors';
const scrypt = promisify(scryptCallback);
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}
export class ScryptHasher implements PasswordHasher {
  async hash(password: string) {
    const salt = randomBytes(16).toString('hex');
    const key = (await scrypt(password, salt, 64)) as Buffer;
    return `${salt}:${key.toString('hex')}`;
  }
  async verify(password: string, hash: string) {
    const [salt, key] = hash.split(':');
    if (!salt || !key) return false;
    const actual = (await scrypt(password, salt, 64)) as Buffer;
    const expected = Buffer.from(key, 'hex');
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }
}
const identity = z.object({
  sub: z.string().uuid(),
  role: z.enum(['CUSTOMER', 'ADMIN']),
});
export type Identity = z.infer<typeof identity>;
export interface Tokens {
  sign(user: Identity): string;
  verify(token: string): Identity;
}
export class JwtTokens implements Tokens {
  constructor(private readonly secret: string) {}
  sign(user: Identity) {
    return jwt.sign({ role: user.role }, this.secret, {
      subject: user.sub,
      expiresIn: '15m',
      algorithm: 'HS256',
      issuer: 'e-com-global',
      audience: 'e-com-global-api',
    });
  }
  verify(token: string) {
    try {
      return identity.parse(
        jwt.verify(token, this.secret, {
          algorithms: ['HS256'],
          issuer: 'e-com-global',
          audience: 'e-com-global-api',
        }),
      );
    } catch {
      throw new AppError(
        401,
        'UNAUTHORIZED',
        'Invalid or expired access token',
      );
    }
  }
}
