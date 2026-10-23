-- CreateEnum
CREATE TYPE "SosStatus" AS ENUM ('ACTIVE', 'RESPONDING', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SosOutcome" AS ENUM ('RESCUED', 'NOT_FOUND', 'FALSE_ALARM');

-- CreateEnum
CREATE TYPE "LocationCheck" AS ENUM ('VERIFIED', 'TOO_FAR', 'NO_DESTINATION', 'NO_LOCATION');

-- AlterTable
ALTER TABLE "DeliveryEvent" ADD COLUMN     "accuracyM" DOUBLE PRECISION,
ADD COLUMN     "distanceM" DOUBLE PRECISION,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "locationCheck" "LocationCheck" NOT NULL DEFAULT 'NO_LOCATION',
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ReliefRequest" ADD COLUMN     "receiptConfirmedAt" TIMESTAMPTZ(3),
ADD COLUMN     "receiptNote" TEXT;

-- CreateTable
CREATE TABLE "SosAlert" (
    "id" UUID NOT NULL,
    "referenceCode" TEXT NOT NULL,
    "requesterId" UUID NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracyM" DOUBLE PRECISION,
    "address" TEXT,
    "areaLabel" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "peopleCount" INTEGER NOT NULL DEFAULT 1,
    "status" "SosStatus" NOT NULL DEFAULT 'ACTIVE',
    "respondingUserId" UUID,
    "respondingTeamId" UUID,
    "respondedAt" TIMESTAMPTZ(3),
    "outcome" "SosOutcome",
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolutionNote" TEXT,
    "resolverLatitude" DOUBLE PRECISION,
    "resolverLongitude" DOUBLE PRECISION,
    "resolverDistanceM" DOUBLE PRECISION,
    "locationCheck" "LocationCheck",
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SosAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SosEvent" (
    "id" UUID NOT NULL,
    "sosId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "actorId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SosEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SosAlert_referenceCode_key" ON "SosAlert"("referenceCode");

-- CreateIndex
CREATE INDEX "SosAlert_status_createdAt_idx" ON "SosAlert"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SosAlert_requesterId_idx" ON "SosAlert"("requesterId");

-- CreateIndex
CREATE INDEX "SosEvent_sosId_createdAt_idx" ON "SosEvent"("sosId", "createdAt");

-- AddForeignKey
ALTER TABLE "SosAlert" ADD CONSTRAINT "SosAlert_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SosAlert" ADD CONSTRAINT "SosAlert_respondingUserId_fkey" FOREIGN KEY ("respondingUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SosAlert" ADD CONSTRAINT "SosAlert_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SosEvent" ADD CONSTRAINT "SosEvent_sosId_fkey" FOREIGN KEY ("sosId") REFERENCES "SosAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SosEvent" ADD CONSTRAINT "SosEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
