/*
  Warnings:

  - A unique constraint covering the columns `[storeId,slug]` on the table `Category` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[storeId,slug]` on the table `Product` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `storeId` to the `Category` table without a default value. This is not possible if the table is not empty.
  - Made the column `inCart` on table `Product` required. This step will fail if there are existing NULL values in that column.
  - Made the column `pageView` on table `Product` required. This step will fail if there are existing NULL values in that column.
  - Made the column `purchasePriceCents` on table `Product` required. This step will fail if there are existing NULL values in that column.
*/

-- 1) Drop old unique indexes
DROP INDEX "Category_slug_key";
DROP INDEX "Product_slug_key";

-- 2) Add storeId to Category as NULLABLE first
ALTER TABLE "Category"
ADD COLUMN "storeId" TEXT;

-- 3) Backfill storeId for existing Category rows
--    TODO: replace <YOUR_STORE_ID_HERE> with a real Store.id
UPDATE "Category"
SET "storeId" = 'shophikes.com'
WHERE "storeId" IS NULL;

-- 4) Now make Category.storeId NOT NULL
ALTER TABLE "Category"
ALTER COLUMN "storeId" SET NOT NULL;

-- 5) Fix existing NULLs in Product stats columns before making them NOT NULL
UPDATE "Product"
SET "inCart" = 0
WHERE "inCart" IS NULL;

UPDATE "Product"
SET "pageView" = 0
WHERE "pageView" IS NULL;

UPDATE "Product"
SET "purchasePriceCents" = 0
WHERE "purchasePriceCents" IS NULL;

-- 6) Now safely make those Product columns NOT NULL
ALTER TABLE "Product"
ALTER COLUMN "inCart" SET NOT NULL,
ALTER COLUMN "pageView" SET NOT NULL,
ALTER COLUMN "purchasePriceCents" SET NOT NULL;

-- 7) Create new indexes & unique constraints

-- Category: index and unique per store
CREATE INDEX "Category_storeId_idx"
ON "Category"("storeId");

CREATE UNIQUE INDEX "Category_storeId_slug_key"
ON "Category"("storeId", "slug");

-- Product: unique per store slug 
CREATE UNIQUE INDEX "Product_storeId_slug_key"
ON "Product"("storeId", "slug");

-- 8) Foreign key from Category to Store
ALTER TABLE "Category"
ADD CONSTRAINT "Category_storeId_fkey"
FOREIGN KEY ("storeId") REFERENCES "Store"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;
