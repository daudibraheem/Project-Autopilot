-- CreateTable
CREATE TABLE "Sprint" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT NOT NULL DEFAULT '',
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "state" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkItem" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sprintId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "statusCategory" TEXT NOT NULL,
    "storyPoints" DOUBLE PRECISION,
    "labels" TEXT[],
    "assigneeRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "statusChangedAt" TIMESTAMP(3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL,
    "linkedPrUrls" TEXT[],
    "linkedCommitShas" TEXT[],
    "pullRequests" JSONB NOT NULL DEFAULT '[]',
    "linkedGoalId" TEXT,
    "isAgentWork" BOOLEAN NOT NULL DEFAULT false,
    "autopilotJobId" TEXT,
    "addedAfterSprintStart" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkItemEvent" (
    "id" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "actorRef" TEXT,
    "fromValue" TEXT,
    "toValue" TEXT,
    "body" TEXT,
    "flagged" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "WorkItemEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonAlias" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "realName" TEXT NOT NULL,
    "pseudonym" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StandupBrief" (
    "id" TEXT NOT NULL,
    "sprintId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "jobId" TEXT,
    "status" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "facts" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StandupBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NudgeDraft" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sources" TEXT[],
    "status" TEXT NOT NULL,
    "editedText" TEXT,
    "discardReason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NudgeDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Sprint_state_idx" ON "Sprint"("state");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItem_key_key" ON "WorkItem"("key");

-- CreateIndex
CREATE INDEX "WorkItem_sprintId_statusCategory_idx" ON "WorkItem"("sprintId", "statusCategory");

-- CreateIndex
CREATE INDEX "WorkItemEvent_itemKey_at_idx" ON "WorkItemEvent"("itemKey", "at");

-- CreateIndex
CREATE INDEX "WorkItemEvent_at_idx" ON "WorkItemEvent"("at");

-- CreateIndex
CREATE UNIQUE INDEX "PersonAlias_pseudonym_key" ON "PersonAlias"("pseudonym");

-- CreateIndex
CREATE UNIQUE INDEX "PersonAlias_provider_externalId_key" ON "PersonAlias"("provider", "externalId");

-- CreateIndex
CREATE INDEX "StandupBrief_date_status_idx" ON "StandupBrief"("date", "status");

-- CreateIndex
CREATE INDEX "NudgeDraft_jobId_idx" ON "NudgeDraft"("jobId");

-- CreateIndex
CREATE INDEX "NudgeDraft_status_idx" ON "NudgeDraft"("status");

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandupBrief" ADD CONSTRAINT "StandupBrief_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

