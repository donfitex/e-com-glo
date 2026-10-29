import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  generateKeyPair,
  createPrivateKey,
  privateDecrypt,
  constants,
  pbkdf2,
  type KeyObject,
} from 'node:crypto';
import { promisify } from 'node:util';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Database } from '../../infrastructure/database';
import { assert } from '../../shared/errors';
import { id } from '../../shared/validation';
const derive = promisify(pbkdf2);
const masterId = 'a3c390f5-9930-461d-826d-4435426c45ad';
const b64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/);
export const recoveryEnvelope = z
  .object({
    version: z.literal(3),
    keyId: id,
    recoveryKeyId: id,
    userId: id,
    iv: b64.length(16),
    wrappedKey: b64.length(512),
    ciphertext: b64.min(100).max(16000),
  })
  .strict();
type Box = { iv: string; ciphertext: string; tag: string };
export class ManagedMessageRecovery {
  constructor(
    private readonly db: Database,
    private readonly secret: string,
  ) {}
  private wrapping() {
    return createHash('sha256')
      .update(`ecom-managed-recovery:v1:${this.secret}`)
      .digest();
  }
  private seal(privateJwk: unknown): Box {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.wrapping(), iv);
    cipher.setAAD(Buffer.from(masterId));
    const bytes = Buffer.concat([
      cipher.update(JSON.stringify(privateJwk), 'utf8'),
      cipher.final(),
    ]);
    return {
      iv: iv.toString('base64'),
      ciphertext: bytes.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    };
  }
  async publicKey() {
    let key = await this.db.messageRecoveryKey.findUnique({
      where: { id: masterId },
    });
    if (!key) {
      const pair = await new Promise<{
        publicKey: KeyObject;
        privateKey: KeyObject;
      }>((resolve, reject) =>
        generateKeyPair(
          'rsa',
          { modulusLength: 3072 },
          (error, publicKey, privateKey) =>
            error ? reject(error) : resolve({ publicKey, privateKey }),
        ),
      );
      const publicJwk = {
        ...pair.publicKey.export({ format: 'jwk' }),
        alg: 'RSA-OAEP-256',
        ext: true,
        key_ops: ['encrypt'],
      };
      const fingerprint = createHash('sha256')
        .update(pair.publicKey.export({ type: 'spki', format: 'der' }))
        .digest('hex');
      key = await this.db.messageRecoveryKey.upsert({
        where: { id: masterId },
        create: {
          id: masterId,
          publicJwk,
          fingerprint,
          privateBox: this.seal(pair.privateKey.export({ format: 'jwk' })),
        },
        update: {},
      });
    }
    return {
      id: key.id,
      publicJwk: key.publicJwk,
      fingerprint: key.fingerprint,
    };
  }
  async validate(
    input: z.infer<typeof recoveryEnvelope>,
    userId: string,
    keyId: string,
  ) {
    assert(
      input.userId === userId &&
        input.keyId === keyId &&
        input.recoveryKeyId === masterId,
      400,
      'INVALID_RECOVERY',
      'Recovery key identity mismatch',
    );
    assert(
      await this.db.messageRecoveryKey.findUnique({ where: { id: masterId } }),
      409,
      'RECOVERY_NOT_READY',
      'Initialize the recovery service first',
    );
  }
  async rewrap(tx: Prisma.TransactionClient, userId: string, password: string) {
    const customer = await tx.customerInboxKey.findUnique({
      where: { userId },
    });
    if (!customer) return;
    assert(
      customer.managedRecovery,
      409,
      'RECOVERY_SYNC_REQUIRED',
      'This account’s older private inbox has not been synced for password recovery. Contact the store for help.',
    );
    const envelope = recoveryEnvelope.parse(customer.managedRecovery);
    assert(
      envelope.userId === userId &&
        envelope.keyId === customer.id &&
        envelope.recoveryKeyId === masterId,
      409,
      'RECOVERY_UNAVAILABLE',
      'Private message recovery is unavailable. Contact the store.',
    );
    const master = await tx.messageRecoveryKey.findUniqueOrThrow({
      where: { id: masterId },
    });
    const box = master.privateBox as unknown as Box;
    const open = createDecipheriv(
      'aes-256-gcm',
      this.wrapping(),
      Buffer.from(box.iv, 'base64'),
    );
    open.setAAD(Buffer.from(masterId));
    open.setAuthTag(Buffer.from(box.tag, 'base64'));
    const masterJwk = JSON.parse(
      Buffer.concat([
        open.update(Buffer.from(box.ciphertext, 'base64')),
        open.final(),
      ]).toString('utf8'),
    );
    const privateKey = createPrivateKey({ key: masterJwk, format: 'jwk' });
    const secret = privateDecrypt(
      {
        key: privateKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(envelope.wrappedKey, 'base64'),
    );
    const encrypted = Buffer.from(envelope.ciphertext, 'base64');
    const decrypt = createDecipheriv(
      'aes-256-gcm',
      secret,
      Buffer.from(envelope.iv, 'base64'),
    );
    decrypt.setAAD(
      Buffer.from(`ecom-key-recovery:v1:${userId}:${customer.id}:${masterId}`),
    );
    decrypt.setAuthTag(encrypted.subarray(-16));
    const jwk = JSON.parse(
      Buffer.concat([
        decrypt.update(encrypted.subarray(0, -16)),
        decrypt.final(),
      ]).toString('utf8'),
    );
    const publicJwk = customer.publicJwk as { n: string; e: string };
    assert(
      jwk.n === publicJwk.n && jwk.e === publicJwk.e,
      409,
      'RECOVERY_UNAVAILABLE',
      'Recovered key does not match the account',
    );
    const salt = randomBytes(16),
      iv = randomBytes(12);
    const wrapping = await derive(password, salt, 600000, 32, 'sha256');
    const cipher = createCipheriv('aes-256-gcm', wrapping, iv);
    cipher.setAAD(
      Buffer.from(`ecom-backup:v1:${customer.id}:${customer.fingerprint}`),
    );
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(jwk), 'utf8'),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    await tx.customerInboxKey.update({
      where: { id: customer.id },
      data: {
        backup: {
          version: 1,
          kdf: 'PBKDF2-SHA256',
          iterations: 600000,
          keyId: customer.id,
          fingerprint: customer.fingerprint,
          publicJwk: customer.publicJwk,
          salt: salt.toString('base64'),
          iv: iv.toString('base64'),
          ciphertext: ciphertext.toString('base64'),
        },
      },
    });
  }
}
