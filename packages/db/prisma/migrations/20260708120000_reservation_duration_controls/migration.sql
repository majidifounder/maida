-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN "maxExtraHours" INTEGER NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN "untilClose" BOOLEAN NOT NULL DEFAULT false;
