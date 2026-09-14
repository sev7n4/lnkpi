-- AlterTable
ALTER TABLE "User" ADD COLUMN "inviteCode" TEXT;
ALTER TABLE "User" ADD COLUMN "invitedByUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_inviteCode_key" ON "User"("inviteCode");

-- CreateTable
CREATE TABLE "InviteRedemption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inviteeId" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "inviteePoints" INTEGER NOT NULL,
    "inviterPoints" INTEGER NOT NULL,
    "inviterRewardSkippedReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InviteRedemption_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InviteRedemption_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "InviteRedemption_inviteeId_key" ON "InviteRedemption"("inviteeId");
CREATE INDEX "InviteRedemption_inviterId_createdAt_idx" ON "InviteRedemption"("inviterId", "createdAt");
