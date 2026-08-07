-- CreateTable
CREATE TABLE "AgentThread" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '新对话',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentThread_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Legacy backfill: one thread per session with existing messages
INSERT INTO "AgentThread" ("id", "sessionId", "title", "createdAt", "updatedAt")
SELECT "sessionId" || ':legacy', "sessionId", '早期对话', MIN("createdAt"), MAX("createdAt")
FROM "AgentMessage"
GROUP BY "sessionId";

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AgentMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" TEXT,
    "attachments" TEXT,
    "linkedOutputs" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AgentThread" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AgentMessage" ("id", "sessionId", "threadId", "role", "content", "toolCalls", "attachments", "createdAt")
SELECT "id", "sessionId", "sessionId" || ':legacy', "role", "content", "toolCalls", "attachments", "createdAt"
FROM "AgentMessage";
DROP TABLE "AgentMessage";
ALTER TABLE "new_AgentMessage" RENAME TO "AgentMessage";
CREATE INDEX "AgentMessage_threadId_createdAt_idx" ON "AgentMessage"("threadId", "createdAt");
CREATE INDEX "AgentMessage_sessionId_threadId_createdAt_idx" ON "AgentMessage"("sessionId", "threadId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AgentThread_sessionId_updatedAt_idx" ON "AgentThread"("sessionId", "updatedAt" DESC);
