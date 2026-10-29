import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { BcryptHasher } from '../src/modules/auth/security';
const db = new PrismaClient();
async function main() {
  const input = z
    .object({
      ADMIN_EMAIL: z.string().trim().toLowerCase().email(),
      ADMIN_NAME: z.string().trim().min(1).max(120),
      ADMIN_PASSWORD: z.string().min(12).max(128),
    })
    .parse(process.env);
  const existing = await db.user.findUnique({
    where: { email: input.ADMIN_EMAIL },
    select: { role: true },
  });
  if (existing) {
    if (existing.role !== 'ADMIN')
      throw new Error(
        'Existing customer cannot be promoted by staging bootstrap',
      );
    return;
  }
  const passwordHash = await new BcryptHasher().hash(input.ADMIN_PASSWORD);
  await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.ADMIN_EMAIL,
        name: input.ADMIN_NAME,
        passwordHash,
        role: 'ADMIN',
      },
    });
    await tx.auditEvent.create({
      data: {
        actorId: user.id,
        action: 'admin.provisioned',
        entityId: user.id,
      },
    });
  });
}
main()
  .catch(() => {
    process.stderr.write(
      'Staging administrator provisioning failed. Check secret configuration and email uniqueness.\n',
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
