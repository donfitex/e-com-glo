import { z } from 'zod';
import { currency, id, money, pagination } from '../../shared/validation';
export const categoryInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    slug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  })
  .strict();
export const productInput = z
  .object({
    sku: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(200),
    description: z.string().max(10000),
    price: money,
    currency,
    stock: z.number().int().min(0).max(1000000),
    active: z.boolean().default(true),
    categoryId: id,
    attributes: z.record(z.string().max(100), z.string().max(500)).default({}),
  })
  .strict();
export const productQuery = pagination
  .extend({
    categoryId: id.optional(),
    currency: currency.optional(),
    minPrice: z.coerce.number().int().min(0).optional(),
    maxPrice: z.coerce.number().int().min(0).optional(),
    available: z.enum(['true', 'false']).optional(),
    q: z.string().trim().min(1).max(200).optional(),
    sort: z
      .enum(['newest', 'price_asc', 'price_desc', 'name'])
      .default('newest'),
  })
  .refine(
    (v) =>
      v.minPrice === undefined ||
      v.maxPrice === undefined ||
      v.minPrice <= v.maxPrice,
    { message: 'minPrice must not exceed maxPrice' },
  );
export type ProductQuery = z.infer<typeof productQuery>;
