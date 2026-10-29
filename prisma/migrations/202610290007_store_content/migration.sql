CREATE TABLE "StoreContent" (
  "id" TEXT NOT NULL,
  "content" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StoreContent_pkey" PRIMARY KEY ("id")
);
