import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Database, serializable } from '../../infrastructure/database';
import { assert } from '../../shared/errors';
import { id } from '../../shared/validation';
const safeHref = z
  .string()
  .max(250)
  .regex(
    /^\/(shop|products|help|contact|account|wishlist)(?:[/?#][A-Za-z0-9_/?#=&.%+-]*)?$/,
  );
export const broadcastInput = z
  .object({
    id,
    title: z.string().trim().min(1).max(160),
    body: z.string().trim().min(1).max(5000),
    kind: z.enum(['BUSINESS', 'PROMOTION']),
    href: safeHref.nullable().default(null),
    imageUrl: z
      .string()
      .regex(/^\/api\/media\/[0-9a-f-]{36}$/)
      .nullable()
      .default(null),
  })
  .strict();
export class CommunicationsService {
  constructor(private readonly db: Database) {}
  private async audience(userId: string): Promise<Prisma.BroadcastWhereInput> {
    const [user, pref] = await Promise.all([
      this.db.user.findUniqueOrThrow({
        where: { id: userId },
        select: { createdAt: true },
      }),
      this.db.customerPreferences.findUnique({ where: { userId } }),
    ]);
    return {
      publishedAt: { gte: user.createdAt, lte: new Date() },
      archivedAt: null,
      ...(pref?.promotions === false ? { kind: 'BUSINESS' } : {}),
    };
  }
  async list(userId: string, page: number, limit: number) {
    const where = await this.audience(userId);
    const [items, total] = await Promise.all([
      this.db.broadcast.findMany({
        where,
        include: { receipts: { where: { userId }, select: { readAt: true } } },
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.broadcast.count({ where }),
    ]);
    return {
      items: items.map(({ receipts, ...item }) => ({
        ...item,
        read: receipts.length > 0,
      })),
      total,
      page,
      limit,
    };
  }
  async unread(userId: string) {
    return this.db.broadcast.count({
      where: {
        ...(await this.audience(userId)),
        receipts: { none: { userId } },
      },
    });
  }
  async read(userId: string, id: string) {
    assert(
      await this.db.broadcast.findFirst({
        where: { ...(await this.audience(userId)), id },
      }),
      404,
      'NOT_FOUND',
      'Announcement not found',
    );
    await this.db.broadcastReceipt.upsert({
      where: { userId_broadcastId: { userId, broadcastId: id } },
      create: { userId, broadcastId: id },
      update: {},
    });
    return { read: true };
  }
  async preferences(userId: string) {
    const row = await this.db.customerPreferences.findUnique({
      where: { userId },
    });
    return { promotions: row?.promotions ?? true };
  }
  setPreferences(userId: string, promotions: boolean) {
    return this.db.customerPreferences.upsert({
      where: { userId },
      create: { userId, promotions },
      update: { promotions },
    });
  }
  async adminList(page: number, limit: number) {
    const [items, total] = await Promise.all([
      this.db.broadcast.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.broadcast.count(),
    ]);
    return { items, total, page, limit };
  }
  async draft(actorId: string, input: z.infer<typeof broadcastInput>) {
    return serializable(this.db, async (tx) => {
      const existing = await tx.broadcast.findUnique({
        where: { id: input.id },
      });
      assert(
        !existing?.publishedAt,
        409,
        'ALREADY_PUBLISHED',
        'Published announcements cannot be edited. Archive and create a new one.',
      );
      const result = await tx.broadcast.upsert({
        where: { id: input.id },
        create: input,
        update: input,
      });
      await tx.auditEvent.create({
        data: { actorId, action: 'broadcast.draft_saved', entityId: input.id },
      });
      return result;
    });
  }
  async publish(actorId: string, id: string) {
    return serializable(this.db, async (tx) => {
      const found = await tx.broadcast.findUnique({ where: { id } });
      assert(found && !found.archivedAt, 404, 'NOT_FOUND', 'Draft not found');
      if (found.publishedAt) return found;
      const result = await tx.broadcast.update({
        where: { id },
        data: { publishedAt: new Date() },
      });
      await tx.auditEvent.create({
        data: {
          actorId,
          action: 'broadcast.published',
          entityId: id,
          metadata: { kind: found.kind },
        },
      });
      return result;
    });
  }
  async archive(actorId: string, id: string) {
    return this.db.$transaction(async (tx) => {
      const result = await tx.broadcast.update({
        where: { id },
        data: { archivedAt: new Date() },
      });
      await tx.auditEvent.create({
        data: { actorId, action: 'broadcast.archived', entityId: id },
      });
      return result;
    });
  }
}
