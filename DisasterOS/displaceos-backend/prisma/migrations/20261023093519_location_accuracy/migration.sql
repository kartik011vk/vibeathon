-- AlterTable
ALTER TABLE "Dispatch" ADD COLUMN     "currentAccuracyM" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ResponseTeam" ADD COLUMN     "lastAccuracyM" DOUBLE PRECISION;
