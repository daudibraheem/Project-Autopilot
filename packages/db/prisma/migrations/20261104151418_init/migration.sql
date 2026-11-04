-- CreateTable
CREATE TABLE "GoalCheck" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "ref" TEXT NOT NULL DEFAULT 'main',
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "branch" TEXT NOT NULL,
    "degraded" BOOLEAN NOT NULL DEFAULT false,
    "workerModel" TEXT,
    "verifierModel" TEXT,
    "provider" TEXT,
    "trustLevelAtStart" INTEGER NOT NULL DEFAULT 0,
    "diff" TEXT,
    "explanation" TEXT,
    "evidence" JSONB,
    "baseline" JSONB,
    "analysis" JSONB,
    "feedback" TEXT,
    "error" TEXT,
    "stepsUsed" INTEGER NOT NULL DEFAULT 0,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "prUrl" TEXT,
    "mergedSha" TEXT,
    "source" TEXT NOT NULL DEFAULT 'conductor',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "allowedPaths" TEXT[],
    "forbiddenPaths" TEXT[],
    "maxSteps" INTEGER NOT NULL,
    "maxTokens" INTEGER NOT NULL,
    "maxUsd" DOUBLE PRECISION NOT NULL,
    "maxMinutes" DOUBLE PRECISION NOT NULL,
    "doneCriteria" JSONB NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "allowRegistry" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobStep" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "index" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tool" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "inputSummary" TEXT,
    "outputSummary" TEXT,
    "model" TEXT,
    "provider" TEXT,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "checkpoint" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerifierReport" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "checks" JSONB NOT NULL,
    "concerns" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerifierReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GateResult" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "evidence" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GateResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalDecision" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "actor" TEXT NOT NULL DEFAULT 'human',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustRecord" (
    "jobType" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "consecutivePasses" INTEGER NOT NULL DEFAULT 0,
    "totalRuns" INTEGER NOT NULL DEFAULT 0,
    "approvals" INTEGER NOT NULL DEFAULT 0,
    "rejections" INTEGER NOT NULL DEFAULT 0,
    "gateFailures" INTEGER NOT NULL DEFAULT 0,
    "lastFailureAt" TIMESTAMP(3),
    "lastFailureReason" TEXT,
    "autoMergeAllowed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrustRecord_pkey" PRIMARY KEY ("jobType")
);

-- CreateTable
CREATE TABLE "TrustEvent" (
    "id" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "jobId" TEXT,
    "kind" TEXT NOT NULL,
    "fromLevel" INTEGER NOT NULL,
    "toLevel" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "jobType" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence" TEXT NOT NULL,
    "lesson" TEXT NOT NULL,
    "nextTime" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "jobId" TEXT,
    "details" JSONB NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "MlModel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "featureNames" JSONB NOT NULL,
    "weights" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "trainedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MlModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MlPrediction" (
    "id" TEXT NOT NULL,
    "modelId" TEXT,
    "jobId" TEXT,
    "testName" TEXT NOT NULL,
    "features" JSONB NOT NULL,
    "probability" DOUBLE PRECISION NOT NULL,
    "decision" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MlPrediction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoalCheck_goalId_createdAt_idx" ON "GoalCheck"("goalId", "createdAt");

-- CreateIndex
CREATE INDEX "GoalCheck_createdAt_idx" ON "GoalCheck"("createdAt");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE INDEX "Job_goalId_status_idx" ON "Job"("goalId", "status");

-- CreateIndex
CREATE INDEX "Job_jobType_createdAt_idx" ON "Job"("jobType", "createdAt");

-- CreateIndex
CREATE INDEX "Job_createdAt_idx" ON "Job"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_jobId_key" ON "Contract"("jobId");

-- CreateIndex
CREATE INDEX "JobStep_jobId_attempt_index_idx" ON "JobStep"("jobId", "attempt", "index");

-- CreateIndex
CREATE INDEX "JobStep_createdAt_idx" ON "JobStep"("createdAt");

-- CreateIndex
CREATE INDEX "VerifierReport_jobId_idx" ON "VerifierReport"("jobId");

-- CreateIndex
CREATE INDEX "GateResult_jobId_attempt_idx" ON "GateResult"("jobId", "attempt");

-- CreateIndex
CREATE INDEX "ApprovalDecision_jobId_idx" ON "ApprovalDecision"("jobId");

-- CreateIndex
CREATE INDEX "TrustEvent_jobType_createdAt_idx" ON "TrustEvent"("jobType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_hash_key" ON "Lesson"("hash");

-- CreateIndex
CREATE INDEX "Lesson_jobType_createdAt_idx" ON "Lesson"("jobType", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actor_createdAt_idx" ON "AuditEvent"("actor", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");

-- CreateIndex
CREATE INDEX "AuditEvent_jobId_idx" ON "AuditEvent"("jobId");

-- CreateIndex
CREATE INDEX "MlModel_name_active_idx" ON "MlModel"("name", "active");

-- CreateIndex
CREATE INDEX "MlPrediction_createdAt_idx" ON "MlPrediction"("createdAt");

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobStep" ADD CONSTRAINT "JobStep_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerifierReport" ADD CONSTRAINT "VerifierReport_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateResult" ADD CONSTRAINT "GateResult_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
