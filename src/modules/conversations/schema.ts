import { z } from 'zod';
import { recoveryEnvelope } from '../recovery/message-keys';
import { id } from '../../shared/validation';
import { publicJwk } from '../inbox/schema';
const base64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/);
export const customerBackup = z
  .object({
    version: z.literal(1),
    kdf: z.literal('PBKDF2-SHA256'),
    iterations: z.literal(600000),
    keyId: id,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    publicJwk,
    salt: z.string().max(24),
    iv: z.string().max(16),
    ciphertext: z.string().min(100).max(16000),
  })
  .strict();
export const customerKeyInput = z
  .object({
    id,
    publicJwk,
    backup: customerBackup.optional(),
    recovery: recoveryEnvelope.optional(),
  })
  .strict();
export const conversationEnvelope = z
  .object({
    version: z.literal(2),
    id,
    conversationId: id,
    senderId: id,
    customerKeyId: id,
    adminKeyId: id,
    iv: base64.length(16).refine((v) => Buffer.from(v, 'base64').length === 12),
    ciphertext: base64.min(24).max(40000),
    customerWrappedKey: base64.length(512),
    adminWrappedKey: base64.length(512),
  })
  .strict();
export const startConversation = z
  .object({ id, customerKeyId: id, adminKeyId: id })
  .strict();
export type Envelope = z.infer<typeof conversationEnvelope>;
export type Actor = { sub: string; role: 'ADMIN' | 'CUSTOMER' };
