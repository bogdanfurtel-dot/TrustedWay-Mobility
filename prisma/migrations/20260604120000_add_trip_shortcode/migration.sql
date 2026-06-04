-- AlterTable
ALTER TABLE "Trip" ADD COLUMN "shortCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Trip_shortCode_key" ON "Trip"("shortCode");
