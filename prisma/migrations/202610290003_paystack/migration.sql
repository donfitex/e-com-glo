-- Preserve payment history while replacing provider-specific field names.
ALTER TABLE "Order" RENAME COLUMN "stripeSessionId" TO "paymentReference";
ALTER TABLE "Order" RENAME COLUMN "paymentIntentId" TO "providerTransactionId";
ALTER INDEX "Order_stripeSessionId_key" RENAME TO "Order_paymentReference_key";
ALTER TABLE "Order" ADD COLUMN "paymentAuthorizationUrl" TEXT, ADD COLUMN "paymentProvider" TEXT;
UPDATE "Order" SET "paymentProvider"='stripe' WHERE "paymentReference" IS NOT NULL;
