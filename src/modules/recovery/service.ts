import { ManagedMessageRecovery } from './message-keys';
import {
  createHash,
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import { Database, serializable } from '../../infrastructure/database';
import { assert } from '../../shared/errors';
import { PasswordHasher } from '../auth/security';
import { ResetMailer } from './mailer';
type Box = {
  iv: string;
  ciphertext: string;
  tag: string;
};
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
function wrapping(secret: string) {
  return createHash('sha256').update(`ecom-reset-mail:v1:${secret}`).digest();
}
function seal(value: unknown, secret: string, id: string): Box {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', wrapping(secret), iv);
  cipher.setAAD(Buffer.from(id));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return {
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}
function open(value: Box, secret: string, id: string) {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    wrapping(secret),
    Buffer.from(value.iv, 'base64'),
  );
  decipher.setAAD(Buffer.from(id));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8'),
  ) as { email: string; url: string };
}
export class PasswordRecoveryService {
  constructor(
    private readonly db: Database,
    private readonly passwords: PasswordHasher,
    private readonly origin: string,
    private readonly secret: string,
    private readonly enabled: boolean,
    private readonly messagingRecovery?: ManagedMessageRecovery,
  ) {}
  async request(email: string) {
    assert(
      this.enabled,
      503,
      'EMAIL_NOT_CONFIGURED',
      'Password recovery email is not configured yet. Please contact the store.',
    );
    const user = await this.db.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user) return { accepted: true };
    const token = randomBytes(32).toString('hex'),
      id = randomUUID();
    const url = new URL('/reset-password', this.origin);
    url.hash = `token=${token}`;
    await this.db.$transaction(async (tx) => {
      await tx.passwordReset.create({
        data: {
          id,
          userId: user.id,
          digest: digest(token),
          expiresAt: new Date(Date.now() + 30 * 60000),
        },
      });
      await tx.resetEmail.create({
        data: {
          id,
          payload: seal({ email, url: url.toString() }, this.secret, id),
        },
      });
    });
    return { accepted: true };
  }
  async reset(token: string, password: string) {
    const hash = await this.passwords.hash(password);
    return serializable(this.db, async (tx) => {
      const reset = await tx.passwordReset.findUnique({
        where: { digest: digest(token) },
      });
      assert(
        reset && !reset.usedAt && reset.expiresAt > new Date(),
        400,
        'INVALID_RESET_LINK',
        'This reset link is invalid, expired or already used. Request a new link.',
      );
      const used = await tx.passwordReset.updateMany({
        where: { id: reset.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      assert(
        used.count === 1,
        400,
        'INVALID_RESET_LINK',
        'This reset link was already used.',
      );
      if (this.messagingRecovery)
        await this.messagingRecovery.rewrap(tx, reset.userId, password);
      await tx.user.update({
        where: { id: reset.userId },
        data: { passwordHash: hash, sessionVersion: { increment: 1 } },
      });
      await tx.passwordReset.updateMany({
        where: { userId: reset.userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.auditEvent.create({
        data: { actorId: reset.userId, action: 'auth.password_reset' },
      });
      return { reset: true };
    });
  }
}
export class ResetEmailWorker {
  constructor(
    private readonly db: Database,
    private readonly secret: string,
    private readonly mailer: ResetMailer,
  ) {}
  async tick() {
    const job = await this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "ResetEmail" WHERE (state='PENDING' AND "availableAt"<=now()) OR (state='PROCESSING' AND "leaseUntil"<now()) ORDER BY "availableAt" ASC LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!rows[0]) return null;
      return tx.resetEmail.update({
        where: { id: rows[0].id },
        data: {
          state: 'PROCESSING',
          attempts: { increment: 1 },
          leaseUntil: new Date(Date.now() + 60000),
        },
        include: { reset: true },
      });
    });
    if (!job) return;
    if (job.reset.usedAt || job.reset.expiresAt <= new Date()) {
      await this.db.resetEmail.updateMany({
        where: {
          id: job.id,
          state: 'PROCESSING',
          attempts: job.attempts,
          leaseUntil: job.leaseUntil,
        },
        data: { state: 'EXPIRED', payload: {}, leaseUntil: null },
      });
      return;
    }
    try {
      const message = open(job.payload as unknown as Box, this.secret, job.id);
      await this.mailer.send(message.email, message.url, job.id);
      await this.db.resetEmail.updateMany({
        where: {
          id: job.id,
          state: 'PROCESSING',
          attempts: job.attempts,
          leaseUntil: job.leaseUntil,
        },
        data: {
          state: 'DELIVERED',
          deliveredAt: new Date(),
          payload: {},
          leaseUntil: null,
        },
      });
    } catch {
      await this.db.resetEmail.updateMany({
        where: {
          id: job.id,
          state: 'PROCESSING',
          attempts: job.attempts,
          leaseUntil: job.leaseUntil,
        },
        data: {
          state: job.attempts >= 5 ? 'FAILED' : 'PENDING',
          availableAt: new Date(
            Date.now() + Math.min(300000, 1000 * 2 ** job.attempts),
          ),
          leaseUntil: null,
          ...(job.attempts >= 5 ? { payload: {} } : {}),
        },
      });
    }
  }
}
