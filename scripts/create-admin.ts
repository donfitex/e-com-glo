import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { ScryptHasher } from '../src/modules/auth/security';
const input = z
  .object({
    ADMIN_EMAIL: z
      .string()
      .email()
      .transform((v) => v.trim().toLowerCase()),
    ADMIN_NAME: z.string().min(1),
    ADMIN_PASSWORD: z.string().min(12).max(128),
  })
  .parse(process.env);
const db = new PrismaClient();
async function main() {
  const passwordHash = await new ScryptHasher().hash(input.ADMIN_PASSWORD);
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
      'Administrator creation failed. Check inputs and email uniqueness.\n',
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
