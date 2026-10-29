import { z } from 'zod';
export const id = z.string().uuid();
export const currency = z.enum([
  'USD',
  'EUR',
  'GBP',
  'NGN',
  'CAD',
  'AUD',
  'JPY',
  'INR',
]);
export const money = z.number().int().min(0).max(1_000_000_000);
export const quantity = z.number().int().min(1).max(100);
export const pagination = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const address = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().email().max(254),
    phone: z
      .string()
      .trim()
      .max(40)
      .regex(/^\+[0-9 ()-]+$/)
      .transform((value) => value.replace(/[ ()-]/g, ''))
      .pipe(
        z
          .string()
          .regex(
            /^\+[1-9]\d{6,14}$/,
            'Use an international phone number, for example +2348012345678',
          ),
      ),
    line1: z.string().trim().min(1).max(200),
    line2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1).max(100),
    region: z.string().trim().max(100).optional(),
    postalCode: z.string().trim().min(1).max(30),
    country: z.string().regex(/^[A-Z]{2}$/),
  })
  .strict();
export type Address = z.infer<typeof address>;
