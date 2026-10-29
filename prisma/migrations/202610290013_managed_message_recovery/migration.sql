ALTER TABLE "CustomerInboxKey" ADD COLUMN "managedRecovery" JSONB;
CREATE TABLE "MessageRecoveryKey" (
 "id" UUID NOT NULL PRIMARY KEY,
 "publicJwk" JSONB NOT NULL,
 "fingerprint" VARCHAR(64) NOT NULL,
 "privateBox" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
