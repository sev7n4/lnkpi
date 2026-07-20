# 文本 Thinking + 文本/图片超时 — 实现计划

> **For agentic workers:** 按任务顺序执行；每任务先写失败测试再改实现。

**Goal:** DeepSeek V4 Dock 深度思考开关（关/开+high/max）+ 文本/图片 axios 超时加长；merge 用渠道模型并关 thinking。

**Architecture:** UI → node.data → studio API body → OpenAITextProvider 按模型映射 thinking；超时按 thinking 开关分支。

**Tech Stack:** Vue Dock、Nest StudioService、packages/agent text-provider、vitest

---

### Task 1: agent text-provider thinking 映射

**Files:** `packages/agent/src/tools/text-provider.ts`, `text-provider.test.ts`

- 增加 `isDeepSeekV4Model`、`buildDeepSeekThinkingBody`
- `generate(prompt, model?, opts?: { thinking?, thinkingEffort? })`

### Task 2: mergeRefsToPrompt 传 model + 关 thinking

**Files:** `packages/agent/src/refs/merge-refs.ts`, tests；`studio.service.ts` resolveMergedPrompt 传入 modelName

### Task 3: Studio API DTO + generateText/Prompt

**Files:** studio.controller / studio.service

### Task 4: 前端超时 + TextDock UI + 传参

**Files:** studio-api.ts, canvas-api.ts, TextDockPanel.vue, useNodeGeneration.ts

### Task 5: 跑相关单测
