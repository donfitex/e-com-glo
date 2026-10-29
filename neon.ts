import { defineConfig } from '@neon/config/v1';

// PostgreSQL only. Keep the existing Prisma driver and application authentication.
// Project and production database selection live in the ignored .neon link.
export default defineConfig({
  auth: false,
});
