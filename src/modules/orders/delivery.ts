import { z } from 'zod';

// Calendar-day estimates begin only after confirmed payment, never at callback time.
export function deliveryWindow(paidAt: Date, minDays: number, maxDays: number) {
  const from = new Date(paidAt);
  const to = new Date(paidAt);
  from.setUTCDate(from.getUTCDate() + minDays);
  to.setUTCDate(to.getUTCDate() + maxDays);
  return { estimatedDeliveryFrom: from, estimatedDeliveryTo: to };
}
export const shipmentInput = z
  .object({
    carrier: z.string().trim().min(1).max(120).nullable().optional(),
    trackingNumber: z.string().trim().min(1).max(100).nullable().optional(),
    trackingUrl: z
      .url()
      .max(1000)
      .refine((value) => {
        try {
          const url = new URL(value);
          return url.protocol === 'https:' && !url.username && !url.password;
        } catch {
          return false;
        }
      }, 'Use an HTTPS tracking link')
      .nullable()
      .optional(),
    expectedDeliveryDate: z.iso.date().optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, 'Provide shipment details');
export type ShipmentInput = z.infer<typeof shipmentInput>;
