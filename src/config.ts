import 'dotenv/config';
import { z } from 'zod';
import { checkoutRules } from './modules/checkout/policy';
export const configSchema = z.object({
  CHECKOUT_RULES_JSON: z
    .string()
    .default('[]')
    .transform((value, ctx) => {
      try {
        return checkoutRules.parse(JSON.parse(value));
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Invalid shipping/tax rules' });
        return z.NEVER;
      }
    }),
  STRIPE_SECRET_KEY: z
    .string()
    .regex(/^sk_test_/)
    .optional(),
  STRIPE_WEBHOOK_SECRET: z
    .string()
    .regex(/^whsec_/)
    .optional(),
  STOREFRONT_ORIGIN: z.string().url().default('http://localhost:3001'),
  SEMANTIC_SEARCH_URL: z.string().url().optional(),
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
