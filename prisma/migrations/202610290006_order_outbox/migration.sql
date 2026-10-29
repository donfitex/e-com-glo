CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'PROCESSED', 'DEAD');
CREATE TABLE "OutboxEvent" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastPublishedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OutboxEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OutboxEvent_attempts_check" CHECK ("attempts" >= 0)
);
CREATE INDEX "OutboxEvent_status_availableAt_lastPublishedAt_idx" ON "OutboxEvent"("status","availableAt","lastPublishedAt");
CREATE INDEX "OutboxEvent_orderId_createdAt_idx" ON "OutboxEvent"("orderId","createdAt");
CREATE TABLE "OrderWorkItem" (
  "orderId" UUID NOT NULL,
  "state" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderWorkItem_pkey" PRIMARY KEY ("orderId"),
  CONSTRAINT "OrderWorkItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
