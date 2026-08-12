-- PR-4: Agent turn metadata (presentation + execution trace events)
ALTER TABLE "AgentMessage" ADD COLUMN "metadata" TEXT;
