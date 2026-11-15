-- CreateTable
CREATE TABLE "RegressionCheck" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastStatus" TEXT NOT NULL DEFAULT 'pass',
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RegressionCheck_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "RegressionCheck_goalId_key" ON "RegressionCheck"("goalId");
-- CreateIndex
CREATE INDEX "RegressionCheck_active_idx" ON "RegressionCheck"("active");
