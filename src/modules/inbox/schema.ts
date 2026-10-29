import { z } from 'zod';
import { id } from '../../shared/validation';
const b64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/);
export const publicJwk = z
  .object({
    kty: z.literal('RSA'),
    n: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .length(512),
    e: z.literal('AQAB'),
    alg: z.literal('RSA-OAEP-256'),
    ext: z.literal(true),
    key_ops: z.array(z.literal('encrypt')).length(1),
  })
  .strict();
export const keyInput = z
  .object({ id, expectedCurrentId: id.nullable(), publicJwk })
  .strict();
export const encryptedMessage = z
  .object({
    id,
    keyId: id,
    version: z.literal(1),
    iv: b64
      .length(16)
      .refine((value) => Buffer.from(value, 'base64').length === 12),
    wrappedKey: b64
      .length(512)
      .refine((value) => Buffer.from(value, 'base64').length === 384),
    ciphertext: b64.min(24).max(40000),
    website: z.literal('').default(''),
  })
  .strict();
