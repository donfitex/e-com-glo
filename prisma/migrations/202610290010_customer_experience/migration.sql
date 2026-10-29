-- CreateTable
CREATE TABLE "CustomerInboxKey" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "publicJwk" JSONB NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerInboxKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "customerKeyId" UUID NOT NULL,
    "adminKeyId" UUID NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "customerRead" INTEGER NOT NULL DEFAULT 0,
    "adminRead" INTEGER NOT NULL DEFAULT 0,
    "lastCustomerSequence" INTEGER NOT NULL DEFAULT 0,
    "lastAdminSequence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMessage" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "fromAdmin" BOOLEAN NOT NULL,
    "sequence" INTEGER NOT NULL,
    "envelope" JSONB NOT NULL,
    "digest" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Broadcast" (
    "id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(5000) NOT NULL,
    "kind" TEXT NOT NULL,
    "href" TEXT,
    "imageUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastReceipt" (
    "userId" UUID NOT NULL,
    "broadcastId" UUID NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BroadcastReceipt_pkey" PRIMARY KEY ("userId","broadcastId")
);

-- CreateTable
CREATE TABLE "CustomerPreferences" (
    "userId" UUID NOT NULL,
    "promotions" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerPreferences_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "SavedAddress" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "label" VARCHAR(60) NOT NULL,
    "address" JSONB NOT NULL,
    "digest" VARCHAR(64) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedAddress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerInboxKey_userId_key" ON "CustomerInboxKey"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerInboxKey_fingerprint_key" ON "CustomerInboxKey"("fingerprint");

-- CreateIndex
CREATE INDEX "Conversation_userId_updatedAt_id_idx" ON "Conversation"("userId", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "Conversation_updatedAt_id_idx" ON "Conversation"("updatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMessage_conversationId_sequence_key" ON "ConversationMessage"("conversationId", "sequence");

-- CreateIndex
CREATE INDEX "Broadcast_publishedAt_id_idx" ON "Broadcast"("publishedAt", "id");

-- CreateIndex
CREATE INDEX "SavedAddress_userId_createdAt_idx" ON "SavedAddress"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SavedAddress_userId_digest_key" ON "SavedAddress"("userId", "digest");

-- AddForeignKey
ALTER TABLE "CustomerInboxKey" ADD CONSTRAINT "CustomerInboxKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_customerKeyId_fkey" FOREIGN KEY ("customerKeyId") REFERENCES "CustomerInboxKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_adminKeyId_fkey" FOREIGN KEY ("adminKeyId") REFERENCES "InboxKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastReceipt" ADD CONSTRAINT "BroadcastReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastReceipt" ADD CONSTRAINT "BroadcastReceipt_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPreferences" ADD CONSTRAINT "CustomerPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedAddress" ADD CONSTRAINT "SavedAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

