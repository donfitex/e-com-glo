import { createHash, createPublicKey } from 'node:crypto';
import { z } from 'zod';
import { Database, serializable } from '../../infrastructure/database';
import { assert, AppError } from '../../shared/errors';
import { Actor, Envelope, customerKeyInput, startConversation } from './schema';
const publicSelect = { id: true, publicJwk: true, fingerprint: true } as const;
export class ConversationService {
  constructor(private readonly db: Database) {}
  async vault(actor: Actor) {
    const key = await this.db.customerInboxKey.findUnique({
      where: { userId: actor.sub },
      select: { backup: true },
    });
    return key?.backup ?? null;
  }
  async ownKey(actor: Actor) {
    return actor.role === 'ADMIN'
      ? this.db.inboxKey.findFirst({
          where: { active: true },
          select: publicSelect,
        })
      : this.db.customerInboxKey.findUnique({
          where: { userId: actor.sub },
          select: publicSelect,
        });
  }
  async register(actor: Actor, input: z.infer<typeof customerKeyInput>) {
    assert(
      actor.role !== 'ADMIN',
      403,
      'ADMIN_KEY_SETUP',
      'Set up the store recovery key in Admin Inbox first.',
    );
    let key;
    try {
      key = createPublicKey({ key: input.publicJwk, format: 'jwk' });
    } catch {
      throw new AppError(400, 'INVALID_KEY', 'Invalid public key');
    }
    assert(
      key.asymmetricKeyDetails?.modulusLength === 3072,
      400,
      'INVALID_KEY',
      'Use a 3072-bit browser key',
    );
    const fingerprint = createHash('sha256')
      .update(key.export({ type: 'spki', format: 'der' }))
      .digest('hex');
    if (input.backup)
      assert(
        input.backup.keyId === input.id &&
          input.backup.fingerprint === fingerprint &&
          JSON.stringify(input.backup.publicJwk) ===
            JSON.stringify(input.publicJwk),
        400,
        'INVALID_BACKUP',
        'Backup does not match public key',
      );
    return serializable(this.db, async (tx) => {
      const existing = await tx.customerInboxKey.findUnique({
        where: { userId: actor.sub },
      });
      if (existing) {
        assert(
          existing.id === input.id && existing.fingerprint === fingerprint,
          409,
          'KEY_EXISTS',
          'Import your existing recovery file. A new key cannot read existing conversations.',
        );
        return {
          id: existing.id,
          publicJwk: existing.publicJwk,
          fingerprint: existing.fingerprint,
        };
      }
      return tx.customerInboxKey.create({
        data: { ...input, userId: actor.sub, fingerprint },
        select: publicSelect,
      });
    });
  }
  async start(actor: Actor, input: z.infer<typeof startConversation>) {
    assert(
      actor.role === 'CUSTOMER',
      403,
      'CUSTOMER_ONLY',
      'Customers start support conversations.',
    );
    return serializable(this.db, async (tx) => {
      const existing = await tx.conversation.findUnique({
        where: { id: input.id },
      });
      if (existing) {
        assert(
          existing.userId === actor.sub &&
            existing.customerKeyId === input.customerKeyId &&
            existing.adminKeyId === input.adminKeyId,
          409,
          'CONFLICT',
          'Conversation reference already in use',
        );
        return existing;
      }
      const [customer, admin] = await Promise.all([
        tx.customerInboxKey.findFirst({
          where: { id: input.customerKeyId, userId: actor.sub },
        }),
        tx.inboxKey.findFirst({
          where: { id: input.adminKeyId, active: true },
        }),
      ]);
      assert(
        customer && admin,
        409,
        'KEY_CHANGED',
        'Reload the inbox encryption keys before starting.',
      );
      assert(
        (await tx.conversation.count({
          where: { userId: actor.sub, resolved: false },
        })) < 20,
        409,
        'TOO_MANY_THREADS',
        'Resolve an existing conversation before opening another.',
      );
      return tx.conversation.create({ data: { ...input, userId: actor.sub } });
    });
  }
  async authorize(actor: Actor, threadId: string) {
    const thread = await this.db.conversation.findFirst({
      where: {
        id: threadId,
        ...(actor.role === 'ADMIN' ? {} : { userId: actor.sub }),
      },
      include: {
        customerKey: { select: publicSelect },
        adminKey: { select: publicSelect },
      },
    });
    assert(thread, 404, 'NOT_FOUND', 'Conversation not found');
    return thread;
  }
  async list(actor: Actor, page: number, limit: number) {
    const where =
      actor.role === 'ADMIN' ? { sequence: { gt: 0 } } : { userId: actor.sub };
    const [items, total] = await Promise.all([
      this.db.conversation.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.conversation.count({ where }),
    ]);
    return {
      items: items.map((t) => ({
        ...t,
        unread:
          actor.role === 'ADMIN'
            ? t.lastCustomerSequence > t.adminRead
            : t.lastAdminSequence > t.customerRead,
      })),
      total,
      page,
      limit,
    };
  }
  async unread(actor: Actor) {
    const rows =
      actor.role === 'ADMIN'
        ? await this.db.$queryRaw<
            { count: bigint }[]
          >`SELECT count(*) FROM "Conversation" WHERE "lastCustomerSequence">"adminRead"`
        : await this.db.$queryRaw<
            { count: bigint }[]
          >`SELECT count(*) FROM "Conversation" WHERE "userId"=${actor.sub}::uuid AND "lastAdminSequence">"customerRead"`;
    return Number(rows[0]?.count ?? 0);
  }
  async detail(actor: Actor, id: string, before?: number) {
    const thread = await this.authorize(actor, id);
    const rows = await this.db.conversationMessage.findMany({
      where: {
        conversationId: id,
        ...(before ? { sequence: { lt: before } } : {}),
      },
      orderBy: { sequence: 'desc' },
      take: 50,
    });
    return {
      thread,
      messages: rows.reverse(),
      hasOlder: rows.length === 50 && rows[0]!.sequence > 1,
    };
  }
  async send(actor: Actor, threadId: string, input: Envelope) {
    const digest = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id=${threadId}::uuid FOR UPDATE`;
      const thread = await tx.conversation.findFirst({
        where: {
          id: threadId,
          ...(actor.role === 'ADMIN' ? {} : { userId: actor.sub }),
        },
      });
      assert(thread, 404, 'NOT_FOUND', 'Conversation not found');
      assert(
        input.conversationId === threadId &&
          input.senderId === actor.sub &&
          input.adminKeyId === thread.adminKeyId &&
          input.customerKeyId === thread.customerKeyId,
        400,
        'INVALID_ENVELOPE',
        'Encrypted message participants do not match',
      );
      const existing = await tx.conversationMessage.findUnique({
        where: { id: input.id },
      });
      if (existing) {
        assert(
          existing.digest === digest && existing.conversationId === threadId,
          409,
          'MESSAGE_CONFLICT',
          'Message reference already used',
        );
        return existing;
      }
      assert(
        thread.sequence < 10000,
        409,
        'THREAD_FULL',
        'Start a new support conversation',
      );
      const sequence = thread.sequence + 1;
      const fromAdmin = actor.role === 'ADMIN';
      const result = await tx.conversationMessage.create({
        data: {
          id: input.id,
          conversationId: threadId,
          senderId: actor.sub,
          fromAdmin,
          sequence,
          envelope: input,
          digest,
        },
      });
      await tx.conversation.update({
        where: { id: threadId },
        data: {
          sequence,
          resolved: false,
          updatedAt: new Date(),
          ...(fromAdmin
            ? { lastAdminSequence: sequence }
            : { lastCustomerSequence: sequence }),
        },
      });
      return result;
    });
  }
  async read(actor: Actor, id: string, sequence: number) {
    const thread = await this.authorize(actor, id);
    assert(
      sequence <= thread.sequence,
      400,
      'INVALID_SEQUENCE',
      'Read marker exceeds conversation',
    );
    const field = actor.role === 'ADMIN' ? 'adminRead' : 'customerRead';
    await this.db.conversation.updateMany({
      where: { id, [field]: { lt: sequence } },
      data: { [field]: sequence },
    });
    return { read: sequence };
  }
  async resolve(actor: Actor, id: string, resolved: boolean) {
    await this.authorize(actor, id);
    return this.db.conversation.update({ where: { id }, data: { resolved } });
  }
}
