CREATE TYPE "SupportStatus" AS ENUM ('NEW', 'READ', 'RESOLVED');
CREATE TABLE "InboxKey" (
 "id" UUID NOT NULL, "publicJwk" JSONB NOT NULL, "fingerprint" VARCHAR(64) NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "InboxKey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InboxKey_fingerprint_key" ON "InboxKey"("fingerprint");
CREATE UNIQUE INDEX "InboxKey_one_active" ON "InboxKey"("active") WHERE "active" = true;
CREATE TABLE "SupportMessage" (
 "id" UUID NOT NULL, "keyId" UUID NOT NULL, "envelope" JSONB NOT NULL, "digest" VARCHAR(64) NOT NULL, "status" "SupportStatus" NOT NULL DEFAULT 'NEW', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "readAt" TIMESTAMP(3), "resolvedAt" TIMESTAMP(3),
 CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "SupportMessage_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "InboxKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "SupportMessage_status_createdAt_id_idx" ON "SupportMessage"("status","createdAt","id");
CREATE INDEX "SupportMessage_keyId_idx" ON "SupportMessage"("keyId");
