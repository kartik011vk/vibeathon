-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('NGO', 'GOVERNMENT', 'VOLUNTEER_GROUP', 'MEDICAL', 'PRIVATE_COMPANY', 'OTHER');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "OrgMemberRole" AS ENUM ('LEAD', 'MEMBER');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TeamOfferStatus" AS ENUM ('OPEN', 'ACCEPTED', 'WITHDRAWN', 'DECLINED');

-- CreateEnum
CREATE TYPE "SupplyOfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'RECEIVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupplyDeliveryMode" AS ENUM ('PICKUP', 'DROP_OFF');

-- AlterTable
ALTER TABLE "ResponseTeam" ADD COLUMN     "organizationId" UUID;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "membershipStatus" "MembershipStatus",
ADD COLUMN     "orgRole" "OrgMemberRole",
ADD COLUMN     "organizationId" UUID;

-- CreateTable
CREATE TABLE "Organization" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OrganizationType" NOT NULL,
    "area" TEXT NOT NULL,
    "description" TEXT,
    "contactPhone" TEXT NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'PENDING',
    "joinCodeHash" TEXT,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamOffer" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "offeredById" UUID NOT NULL,
    "note" TEXT,
    "ownSupplies" BOOLEAN NOT NULL DEFAULT false,
    "status" "TeamOfferStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TeamOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyOffer" (
    "id" UUID NOT NULL,
    "referenceCode" TEXT NOT NULL,
    "donorId" UUID NOT NULL,
    "donorName" TEXT NOT NULL,
    "deliveryMode" "SupplyDeliveryMode" NOT NULL,
    "pickupAddress" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "availableFrom" TIMESTAMPTZ(3),
    "notes" TEXT,
    "status" "SupplyOfferStatus" NOT NULL DEFAULT 'PENDING',
    "receivingLocationId" UUID,
    "handledById" UUID,
    "decisionNote" TEXT,
    "receivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SupplyOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyOfferLine" (
    "id" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "inventoryItemId" UUID,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "receivedQuantity" INTEGER,

    CONSTRAINT "SupplyOfferLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyOfferEvent" (
    "id" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "actorId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyOfferEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_name_key" ON "Organization"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_joinCodeHash_key" ON "Organization"("joinCodeHash");

-- CreateIndex
CREATE INDEX "Organization_status_idx" ON "Organization"("status");

-- CreateIndex
CREATE INDEX "TeamOffer_requestId_status_idx" ON "TeamOffer"("requestId", "status");

-- CreateIndex
CREATE INDEX "TeamOffer_teamId_idx" ON "TeamOffer"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyOffer_referenceCode_key" ON "SupplyOffer"("referenceCode");

-- CreateIndex
CREATE INDEX "SupplyOffer_status_idx" ON "SupplyOffer"("status");

-- CreateIndex
CREATE INDEX "SupplyOffer_donorId_idx" ON "SupplyOffer"("donorId");

-- CreateIndex
CREATE INDEX "SupplyOfferLine_offerId_idx" ON "SupplyOfferLine"("offerId");

-- CreateIndex
CREATE INDEX "SupplyOfferEvent_offerId_createdAt_idx" ON "SupplyOfferEvent"("offerId", "createdAt");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponseTeam" ADD CONSTRAINT "ResponseTeam_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamOffer" ADD CONSTRAINT "TeamOffer_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ReliefRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamOffer" ADD CONSTRAINT "TeamOffer_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "ResponseTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamOffer" ADD CONSTRAINT "TeamOffer_offeredById_fkey" FOREIGN KEY ("offeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOffer" ADD CONSTRAINT "SupplyOffer_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOffer" ADD CONSTRAINT "SupplyOffer_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOffer" ADD CONSTRAINT "SupplyOffer_receivingLocationId_fkey" FOREIGN KEY ("receivingLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOfferLine" ADD CONSTRAINT "SupplyOfferLine_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "SupplyOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOfferLine" ADD CONSTRAINT "SupplyOfferLine_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOfferEvent" ADD CONSTRAINT "SupplyOfferEvent_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "SupplyOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOfferEvent" ADD CONSTRAINT "SupplyOfferEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Donated quantities must be positive; received amounts may not be negative.
ALTER TABLE "SupplyOfferLine" ADD CONSTRAINT "supply_offer_line_quantity_positive" CHECK ("quantity" > 0 AND ("receivedQuantity" IS NULL OR "receivedQuantity" >= 0));

-- At most one open offer per team per request.
CREATE UNIQUE INDEX "team_offer_one_open_per_team" ON "TeamOffer" ("requestId", "teamId") WHERE "status" = 'OPEN';
