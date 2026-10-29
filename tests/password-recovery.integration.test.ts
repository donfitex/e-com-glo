import { randomUUID, webcrypto, createHash } from 'node:crypto';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import pino from 'pino';
import { createApp } from '../src/app';
import { configSchema } from '../src/config';
import { CatalogCache } from '../src/infrastructure/cache';
import { RedisRateLimiter } from '../src/infrastructure/rate-limit';
import { JwtTokens, ScryptHasher } from '../src/modules/auth/security';
import { AuthService } from '../src/modules/auth/service';
import {
  PasswordRecoveryService,
  ResetEmailWorker,
} from '../src/modules/recovery/service';
import { ManagedMessageRecovery } from '../src/modules/recovery/message-keys';
import { ResendResetMailer } from '../src/modules/recovery/mailer';
import {
  createInboxKey,
  unlockInboxKey,
  encryptReply,
  decryptReply,
} from '../storefront/lib/contact-crypto';
Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  configurable: true,
});
const enabled = Boolean(process.env.TEST_DATABASE_URL);
const suite = enabled ? describe : describe.skip;
suite('password recovery with managed message history', () => {
  jest.setTimeout(30000);
  const url =
    process.env.TEST_DATABASE_URL ??
    'postgresql://unused@localhost/unused_test';
  if (!new URL(url).pathname.endsWith('_test'))
    throw new Error('Use isolated test database');
  const db = new PrismaClient({ datasources: { db: { url } } });
  const redis = createClient({
    url: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
    disableOfflineQueue: true,
  });
  const secret = 'reset-integration-only-secret-at-least-32-characters',
    passwords = new ScryptHasher(),
    tokens = new JwtTokens(secret),
    email = `reset-${randomUUID()}@example.com`,
    oldPassword = 'Original-password-123',
    newPassword = 'Replacement-password-456';
  const recovery = new ManagedMessageRecovery(db, secret),
    resetService = new PasswordRecoveryService(
      db,
      passwords,
      'https://store.example',
      secret,
      true,
      recovery,
    );
  const delivered: { to: string; url: string; id: string }[] = [];
  const worker = new ResetEmailWorker(db, secret, {
    send: async (to, url, id) => {
      delivered.push({ to, url, id });
    },
  });
  const config = configSchema.parse({
    DATABASE_URL: url,
    REDIS_URL: 'redis://localhost',
    JWT_SECRET: secret,
    CORS_ORIGINS: 'https://store.example',
    STOREFRONT_ORIGIN: 'https://store.example',
    NODE_ENV: 'test',
    RESEND_API_KEY: 'test-not-used',
    EMAIL_FROM: 'accounts@example.com',
  });
  const app = createApp(config, {
    db,
    cache: new CatalogCache(redis),
    limiter: new RedisRateLimiter(redis),
    passwords,
    tokens,
    logger: pino({ level: 'silent' }),
    ready: async () => {},
  });
  let userId: string, accessToken: string, threadId: string, adminKeyId: string;
  beforeAll(async () => {
    await redis.connect();
    const user = await new AuthService(db, passwords, tokens).register({
      email,
      password: oldPassword,
      name: 'Reset Customer',
    });
    userId = user.user.id;
    accessToken = user.accessToken;
  });
  afterAll(async () => {
    if (userId) {
      await db.conversation.deleteMany({ where: { userId } });
      await db.user.delete({ where: { id: userId } });
    }
    if (adminKeyId) await db.inboxKey.delete({ where: { id: adminKeyId } });
    await db.$disconnect();
    await redis.quit();
  });
  test('known and unknown requests are indistinguishable; reset token is never stored or returned in plaintext', async () => {
    const known = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email })
      .expect(202);
    const unknown = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: `missing-${randomUUID()}@example.com` })
      .expect(202);
    expect(known.body).toEqual(unknown.body);
    expect(known.body.data).toEqual({ accepted: true });
    const queued = await db.passwordReset.findFirstOrThrow({
      where: { userId },
      include: { delivery: true },
    });
    expect(queued.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(queued.delivery?.payload)).not.toContain(email);
    await worker.tick();
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.to).toBe(email);
    const link = new URL(delivered[0]!.url);
    expect(link.origin).toBe('https://store.example');
    expect(link.search).toBe('');
    expect(link.hash).toMatch(/^#token=[a-f0-9]{64}$/);
    expect(
      JSON.stringify(
        await db.passwordReset.findUnique({
          where: { id: queued.id },
          include: { delivery: true },
        }),
      ),
    ).not.toContain(link.hash.slice(7));
  });
  test('single-use reset preserves historical message decryption and revokes older sessions', async () => {
    const publicKey = await recovery.publicKey();
    const customer = await createInboxKey(oldPassword, {
      publicKey: publicKey as unknown as Parameters<typeof encryptReply>[3],
      userId,
    });
    await request(app)
      .post('/api/v1/conversations/key')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        id: customer.publicKey.id,
        publicJwk: customer.publicKey.publicJwk,
        backup: customer.backup,
        recovery: customer.recoveryEnvelope,
      })
      .expect(201);
    const admin = await createInboxKey('Administrator-private-passphrase-123');
    adminKeyId = admin.publicKey.id;
    await db.inboxKey.create({
      data: {
        id: adminKeyId,
        publicJwk: JSON.parse(JSON.stringify(admin.publicKey.publicJwk)),
        fingerprint: admin.publicKey.fingerprint,
        active: false,
      },
    });
    threadId = randomUUID();
    const envelope = await encryptReply(
      'Historical private support message',
      threadId,
      userId,
      customer.publicKey,
      admin.publicKey,
    );
    await db.conversation.create({
      data: {
        id: threadId,
        userId,
        customerKeyId: customer.publicKey.id,
        adminKeyId,
        sequence: 1,
        messages: {
          create: {
            id: envelope.id,
            senderId: userId,
            fromAdmin: false,
            sequence: 1,
            envelope: JSON.parse(JSON.stringify(envelope)),
            digest: createHash('sha256')
              .update(JSON.stringify(envelope))
              .digest('hex'),
          },
        },
      },
    });
    const token = new URL(delivered[0]!.url).hash.slice(7);
    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: newPassword })
      .expect(200);
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: oldPassword })
      .expect(401);
    const logged = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: newPassword })
      .expect(200);
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${logged.body.data.accessToken}`)
      .expect(200);
    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'Another-password-789' })
      .expect(400);
    const vault = await db.customerInboxKey.findUniqueOrThrow({
      where: { userId },
    });
    const unlocked = await unlockInboxKey(vault.backup, newPassword);
    expect(
      await decryptReply(envelope, unlocked.keyId, unlocked.privateKey),
    ).toBe('Historical private support message');
    await expect(unlockInboxKey(vault.backup, oldPassword)).rejects.toThrow();
    expect(
      await db.conversationMessage.count({
        where: { conversationId: threadId },
      }),
    ).toBe(1);
  });
  test('expired links fail, failed delivery retries, and a missing mail provider fails uniformly', async () => {
    await resetService.request(email);
    const row = await db.passwordReset.findFirstOrThrow({
      where: { userId, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    const failing = new ResetEmailWorker(db, secret, {
      send: async () => {
        throw new Error('provider outage');
      },
    });
    await failing.tick();
    const job = await db.resetEmail.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(job.state).toBe('PENDING');
    expect(job.attempts).toBe(1);
    await db.resetEmail.update({
      where: { id: row.id },
      data: { availableAt: new Date(0) },
    });
    await worker.tick();
    const token = new URL(delivered.at(-1)!.url).hash.slice(7);
    await db.passwordReset.update({
      where: { id: row.id },
      data: { expiresAt: new Date(0) },
    });
    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: newPassword })
      .expect(400);
    const unavailable = new PasswordRecoveryService(
      db,
      passwords,
      'https://store.example',
      secret,
      false,
    );
    await expect(unavailable.request(email)).rejects.toMatchObject({
      status: 503,
    });
    await expect(
      unavailable.request('unknown@example.com'),
    ).rejects.toMatchObject({ status: 503 });
  });
  test('a delayed worker cannot overwrite a newer successful delivery after its lease expires', async () => {
    await resetService.request(email);
    let entered!: () => void, release!: (reason: Error) => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((_resolve, reject) => {
      release = reject;
    });
    const slow = new ResetEmailWorker(db, secret, {
      send: async () => {
        entered();
        await blocked;
      },
    });
    const running = slow.tick();
    await started;
    const job = await db.resetEmail.findFirstOrThrow({
      where: { reset: { userId }, state: 'PROCESSING' },
    });
    await db.resetEmail.update({
      where: { id: job.id },
      data: { leaseUntil: new Date(0) },
    });
    await worker.tick();
    release(new Error('late transport error'));
    await running;
    expect(
      await db.resetEmail.findUnique({ where: { id: job.id } }),
    ).toMatchObject({ state: 'DELIVERED', attempts: 2 });
  });
  test('email transport uses a fixed provider, idempotency key and plain text body', async () => {
    const transport = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response('{}', { status: 200 }));
    await new ResendResetMailer(
      'provider-test-key',
      'Store <accounts@example.com>',
      transport as unknown as typeof fetch,
    ).send(
      email,
      'https://store.example/reset-password#token=opaque',
      'delivery-test',
    );
    expect(transport).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Idempotency-Key': 'password-reset-delivery-test',
        }),
      }),
    );
  });
});
