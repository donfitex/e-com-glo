-- AlterTable
ALTER TABLE "User" ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "digest" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResetEmail" (
    "id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "ResetEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordReset_digest_key" ON "PasswordReset"("digest");

-- CreateIndex
CREATE INDEX "PasswordReset_userId_expiresAt_idx" ON "PasswordReset"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "ResetEmail_state_availableAt_leaseUntil_idx" ON "ResetEmail"("state", "availableAt", "leaseUntil");

-- AddForeignKey
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResetEmail" ADD CONSTRAINT "ResetEmail_id_fkey" FOREIGN KEY ("id") REFERENCES "PasswordReset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

