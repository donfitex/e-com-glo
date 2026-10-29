import 'dotenv/config';
import { z } from 'zod';
export const configSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  CORS_ORIGINS: z.string().min(1),
  LOG_LEVEL: z
    .enum(['debug', 'info', 'warn', 'error', 'silent'])
    .default('info'),
});
export type Config = z.infer<typeof configSchema>;
export function loadConfig(): Config {
  return configSchema.parse(process.env);
}
