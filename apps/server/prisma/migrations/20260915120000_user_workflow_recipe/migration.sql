-- CreateTable
CREATE TABLE "UserWorkflowRecipe" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "parentId" TEXT,
    "parentVersion" TEXT,
    "body" TEXT NOT NULL,
    "sourceSessionId" TEXT,
    "sourceHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserWorkflowRecipe_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "UserWorkflowRecipe_userId_recipeId_key" ON "UserWorkflowRecipe"("userId", "recipeId");
CREATE INDEX "UserWorkflowRecipe_userId_createdAt_idx" ON "UserWorkflowRecipe"("userId", "createdAt");
