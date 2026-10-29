import { createHash, createPublicKey } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Database } from '../../infrastructure/database';
import { assert, AppError } from '../../shared/errors';
import { encryptedMessage, keyInput } from './schema';
export class InboxService {
  constructor(private readonly db: Database) {}
  async activeKey() {
    return this.db.inboxKey.findFirst({
      where: { active: true },
      select: { id: true, publicJwk: true, fingerprint: true },
    });
  }
  async keys() {
    return this.db.inboxKey.findMany({
      select: { id: true, fingerprint: true, active: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }
  async activate(actorId: string, input: z.infer<typeof keyInput>) {
    let key;
    try {
      key = createPublicKey({ key: input.publicJwk, format: 'jwk' });
    } catch {
      throw new AppError(400, 'INVALID_KEY', 'Invalid inbox public key');
    }
    assert(
      key.asymmetricKeyDetails?.modulusLength === 3072,
      400,
      'INVALID_KEY',
      'Use the browser-generated 3072-bit inbox key',
    );
    const fingerprint = createHash('sha256')
      .update(key.export({ type: 'spki', format: 'der' }))
      .digest('hex');
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ecom-inbox-key'))`;
      const active = await tx.inboxKey.findFirst({ where: { active: true } });
      assert(
        (active?.id ?? null) === input.expectedCurrentId,
        409,
        'INBOX_KEY_CHANGED',
        'Another administrator changed the inbox key. Reload first.',
      );
      await tx.inboxKey.updateMany({
        where: { active: true },
        data: { active: false },
      });
      const saved = await tx.inboxKey.create({
        data: {
          id: input.id,
          publicJwk: input.publicJwk,
          fingerprint,
          active: true,
        },
        select: { id: true, fingerprint: true, active: true, createdAt: true },
      });
      await tx.auditEvent.create({
        data: { actorId, action: 'inbox.key_activated', entityId: saved.id },
      });
      return saved;
    });
  }
  async receive(input: z.infer<typeof encryptedMessage>) {
    const { website: _, ...envelope } = input;
    void _;
    const digest = createHash('sha256')
      .update(JSON.stringify(envelope))
      .digest('hex');
    const existing = await this.db.supportMessage.findUnique({
      where: { id: input.id },
      select: { digest: true, id: true, createdAt: true },
    });
    if (existing) {
      assert(
        existing.digest === digest,
        409,
        'MESSAGE_CONFLICT',
        'Message reference is already in use',
      );
      return { id: existing.id, createdAt: existing.createdAt };
    }
    try {
      return await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "InboxKey" WHERE id=${input.keyId}::uuid FOR SHARE`;
        const key = await tx.inboxKey.findUnique({
          where: { id: input.keyId },
        });
        assert(
          key?.active,
          409,
          'INBOX_KEY_CHANGED',
          'The secure inbox key changed. Please send your message again.',
        );
        return tx.supportMessage.create({
          data: { id: input.id, keyId: input.keyId, envelope, digest },
          select: { id: true, createdAt: true },
        });
      });
    } catch (error) {
      if (!(
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ))
        throw error;
      const saved = await this.db.supportMessage.findUniqueOrThrow({
        where: { id: input.id },
      });
      assert(
        saved.digest === digest,
        409,
        'MESSAGE_CONFLICT',
        'Message reference is already in use',
      );
      return { id: saved.id, createdAt: saved.createdAt };
    }
  }
  async summary() {
    const [unread, total] = await Promise.all([
      this.db.supportMessage.count({ where: { status: 'NEW' } }),
      this.db.supportMessage.count(),
    ]);
    return { unread, total };
  }
  async list(
    page: number,
    limit: number,
    status?: 'NEW' | 'READ' | 'RESOLVED',
  ) {
    const where = status ? { status } : {};
    const [items, total] = await Promise.all([
      this.db.supportMessage.findMany({
        where,
        select: {
          id: true,
          keyId: true,
          status: true,
          createdAt: true,
          readAt: true,
          resolvedAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.supportMessage.count({ where }),
    ]);
    return { items, total, page, limit };
  }
  async detail(id: string) {
    const message = await this.db.supportMessage.findUnique({
      where: { id },
      select: {
        id: true,
        keyId: true,
        envelope: true,
        status: true,
        createdAt: true,
      },
    });
    assert(message, 404, 'NOT_FOUND', 'Message not found');
    return message;
  }
  async update(
    actorId: string,
    id: string,
    status: 'NEW' | 'READ' | 'RESOLVED',
  ) {
    return this.db.$transaction(async (tx) => {
      const result = await tx.supportMessage.update({
        where: { id },
        data: {
          status,
          readAt: status === 'NEW' ? null : new Date(),
          resolvedAt: status === 'RESOLVED' ? new Date() : null,
        },
        select: { id: true, status: true },
      });
      await tx.auditEvent.create({
        data: {
          actorId,
          action: 'inbox.status_updated',
          entityId: id,
          metadata: { status },
        },
      });
      return result;
    });
  }
  async remove(actorId: string, id: string) {
    await this.db.$transaction(async (tx) => {
      await tx.supportMessage.delete({ where: { id } });
      await tx.auditEvent.create({
        data: { actorId, action: 'inbox.message_deleted', entityId: id },
      });
    });
  }
}
