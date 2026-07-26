-- WI-087: add the GroupWhiteboard table for per-group shared plain-text notes.

-- CreateTable
CREATE TABLE "GroupWhiteboard" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupWhiteboard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupWhiteboard_groupId_key" ON "GroupWhiteboard"("groupId");

-- CreateIndex
CREATE INDEX "GroupWhiteboard_groupId_idx" ON "GroupWhiteboard"("groupId");

-- AddForeignKey
ALTER TABLE "GroupWhiteboard" ADD CONSTRAINT "GroupWhiteboard_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
