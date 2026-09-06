-- AlterTable
ALTER TABLE "PointTransaction" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'consume';
ALTER TABLE "PointTransaction" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'other';
ALTER TABLE "PointTransaction" ADD COLUMN "status" TEXT;
ALTER TABLE "PointTransaction" ADD COLUMN "model" TEXT;
ALTER TABLE "PointTransaction" ADD COLUMN "generationId" TEXT;
ALTER TABLE "PointTransaction" ADD COLUMN "balanceAfter" INTEGER;

-- CreateIndex
CREATE INDEX "PointTransaction_userId_createdAt_idx" ON "PointTransaction"("userId", "createdAt");
CREATE INDEX "PointTransaction_userId_kind_category_createdAt_idx" ON "PointTransaction"("userId", "kind", "category", "createdAt");
