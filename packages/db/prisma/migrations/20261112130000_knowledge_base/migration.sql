-- CreateTable
CREATE TABLE "KnowledgeDoc" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "lineStart" INTEGER NOT NULL,
    "lineEnd" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tsv" tsvector,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeDoc_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "KnowledgeDoc_path_idx" ON "KnowledgeDoc"("path");
-- CreateIndex
CREATE INDEX "KnowledgeDoc_tsv_idx" ON "KnowledgeDoc" USING GIN ("tsv");
