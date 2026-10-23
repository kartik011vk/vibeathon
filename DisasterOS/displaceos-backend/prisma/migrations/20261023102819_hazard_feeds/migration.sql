-- CreateTable
CREATE TABLE "HazardFeedEvent" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "hazardType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "areaDescription" TEXT,
    "state" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "severity" "Severity" NOT NULL,
    "sourceSeverity" TEXT,
    "magnitude" DOUBLE PRECISION,
    "isOfficial" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "sourceUrl" TEXT,
    "instruction" TEXT,
    "disasterZoneId" UUID,
    "firstSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HazardFeedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HazardFeedStatus" (
    "source" TEXT NOT NULL,
    "lastAttemptAt" TIMESTAMPTZ(3),
    "lastSuccessAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "lastCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "HazardFeedStatus_pkey" PRIMARY KEY ("source")
);

-- CreateIndex
CREATE INDEX "HazardFeedEvent_startsAt_idx" ON "HazardFeedEvent"("startsAt");

-- CreateIndex
CREATE INDEX "HazardFeedEvent_severity_idx" ON "HazardFeedEvent"("severity");

-- CreateIndex
CREATE INDEX "HazardFeedEvent_hazardType_idx" ON "HazardFeedEvent"("hazardType");

-- CreateIndex
CREATE UNIQUE INDEX "HazardFeedEvent_source_externalId_key" ON "HazardFeedEvent"("source", "externalId");
