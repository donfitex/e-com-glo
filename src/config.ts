import 'dotenv/config';
import { z } from 'zod';
import { checkoutRules } from './modules/checkout/policy';
export const configSchema = z.object({
  MESSAGE_RECOVERY_SECRET: z.string().min(32).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(3).max(254).optional(),
  API_RATE_LIMIT_PER_MINUTE: z.coerce
    .number()
    .int()
    .min(1)
    .max(10000)
    .default(120),
  CACHE_TTL_SECONDS: z.coerce.number().int().min(1).max(86400).default(3600),
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
  PAYSTACK_SECRET_KEY: z
    .string()
    .regex(/^sk_test_/)
    .optional(),
  PAYSTACK_CURRENCIES: z
    .string()
    .default('NGN')
    .transform((v) => v.split(',').map((c) => c.trim().toUpperCase()))
    .pipe(z.array(z.enum(['NGN', 'USD'])).min(1)),
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
