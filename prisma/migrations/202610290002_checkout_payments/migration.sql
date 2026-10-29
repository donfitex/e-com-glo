-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PAID', 'EXPIRED', 'REFUND_REQUIRED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "expiresAt" TIMESTAMP(3) NOT NULL DEFAULT now() + interval '60 minutes',
ADD COLUMN     "paymentIntentId" TEXT,
ADD COLUMN     "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
ADD COLUMN     "ruleVersion" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN     "shipping" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stripeSessionId" TEXT,
ADD COLUMN     "subtotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tax" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "orderId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentEvent_orderId_idx" ON "PaymentEvent"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_stripeSessionId_key" ON "Order"("stripeSessionId");

-- CreateIndex
CREATE INDEX "Order_status_paymentStatus_expiresAt_idx" ON "Order"("status", "paymentStatus", "expiresAt");


UPDATE "Order" SET "subtotal"="total";
ALTER TABLE "Order" ADD CONSTRAINT "Order_amounts_nonnegative" CHECK ("subtotal">=0 AND "shipping">=0 AND "tax">=0), ADD CONSTRAINT "Order_total_matches" CHECK ("total"="subtotal"+"shipping"+"tax");
