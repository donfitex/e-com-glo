ALTER TABLE "Order"
  ADD COLUMN "deliveryMinDays" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "deliveryMaxDays" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "paidAt" TIMESTAMP(3),
  ADD COLUMN "shippedAt" TIMESTAMP(3),
  ADD COLUMN "deliveredAt" TIMESTAMP(3),
  ADD COLUMN "estimatedDeliveryFrom" TIMESTAMP(3),
  ADD COLUMN "estimatedDeliveryTo" TIMESTAMP(3),
  ADD COLUMN "carrier" TEXT,
  ADD COLUMN "trackingNumber" TEXT,
  ADD COLUMN "trackingUrl" TEXT,
  ADD CONSTRAINT "Order_delivery_days_check" CHECK ("deliveryMinDays" >= 0 AND "deliveryMaxDays" >= "deliveryMinDays" AND "deliveryMaxDays" <= 180);
