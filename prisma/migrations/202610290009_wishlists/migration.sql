CREATE TABLE "WishlistItem" (
 "userId" UUID NOT NULL, "productId" UUID NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "WishlistItem_pkey" PRIMARY KEY ("userId","productId"),
 CONSTRAINT "WishlistItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "WishlistItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WishlistItem_userId_createdAt_productId_idx" ON "WishlistItem"("userId","createdAt","productId");
