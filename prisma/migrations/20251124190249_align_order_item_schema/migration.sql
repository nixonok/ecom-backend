/*
  Warnings:

  - You are about to drop the column `number` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `shippingCents` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `priceCents` on the `OrderItem` table. All the data in the column will be lost.
  - You are about to drop the column `qty` on the `OrderItem` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[orderSerial]` on the table `Order` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `lineTotalCents` to the `OrderItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `productSku` to the `OrderItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `productTitle` to the `OrderItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `quantity` to the `OrderItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `unitPriceCents` to the `OrderItem` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('COD', 'BKASH', 'NAGAD', 'CARD', 'OTHER');

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_userId_fkey";

-- DropIndex
DROP INDEX "Order_number_key";

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "number",
DROP COLUMN "shippingCents",
ADD COLUMN     "city" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'BDT',
ADD COLUMN     "customerName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "deliveryCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "district" TEXT,
ADD COLUMN     "division" TEXT,
ADD COLUMN     "email" TEXT DEFAULT '',
ADD COLUMN     "orderNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "orderSerial" SERIAL NOT NULL,
ADD COLUMN     "phone" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "streetAddress" TEXT,
ADD COLUMN     "upazila" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "userId" DROP NOT NULL,
ALTER COLUMN "userId" SET DEFAULT '';

-- AlterTable
ALTER TABLE "OrderItem" DROP COLUMN "priceCents",
DROP COLUMN "qty",
ADD COLUMN     "lineTotalCents" INTEGER NOT NULL,
ADD COLUMN     "productImageUrl" TEXT,
ADD COLUMN     "productSku" TEXT NOT NULL,
ADD COLUMN     "productTitle" TEXT NOT NULL,
ADD COLUMN     "quantity" INTEGER NOT NULL,
ADD COLUMN     "unitPriceCents" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "inCart" INTEGER DEFAULT 0,
ADD COLUMN     "pageView" INTEGER DEFAULT 0,
ADD COLUMN     "purchasePriceCents" INTEGER DEFAULT 0,
ADD COLUMN     "totalRevenueCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalUnitsSold" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderSerial_key" ON "Order"("orderSerial");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
