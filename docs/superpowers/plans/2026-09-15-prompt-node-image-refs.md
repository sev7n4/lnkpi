# Prompt Node Image Refs Implementation Plan

> **For agentic workers:** Implement task-by-task with TDD. Steps use checkbox syntax.

**Goal:** Prompt node generate consumes image refs with the same vision allowlist / `image_url` / text-only fallback as text nodes, while keeping prompt-mode templates.

**Architecture:** Extend `generatePromptContent` (not replace with `generateTextForRefs`). Wire refs through studio DTO, Dock `generateForNode`, and Agent `runPromptGeneration`.

**Tech Stack:** TypeScript, Vitest, NestJS, Vue composable.

## Global Constraints

- Do not LLM-merge text refs on prompt nodes.
- Classify stays text-only.
- Do not route Dock generate through `parse_sidebar_media`.
- Decode channel-prefixed models with `upstreamChatModel` before POST.

## File map

- `packages/agent/src/prompt-modes/generate.ts` — multimodal last user turn + mentionedKeys overlay + visionUsed
- `apps/server/src/studio/studio.controller.ts` / `studio.service.ts` — refs DTO, empty+images allowed
- `apps/web/src/services/studio-api.ts` / `useNodeGeneration.ts` — pass refs; empty+image gate
- `apps/server/src/agent/agent-canvas-tools.service.ts` — `toStudioRefs` into generatePrompt

## Tasks

- [x] T1 agent generatePromptContent vision / fallback / mentions
- [x] T2 Nest generatePrompt wiring + metadata
- [x] T3 web generateForNode refs + empty+image
- [x] T4 Agent runPromptGeneration refs
- [x] T5 targeted tests green
