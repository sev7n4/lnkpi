# 写实四格去 AI 化退出 + 产品四格锁定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 写实人物四格不再注入去 AI 化；产品四格走独立 overlay 且角度写死；口语「产品的三视图」不再进人物模版。

**Architecture:** `isProductFourPanelPrompt` 放在 `@lnkpi/shared`。`tryRuleShortcut` 与 `generatePromptFromUserInput` 在 Call-1 前拦截产品句。`FOUR_PANEL_PRODUCT_SYSTEM` 作为 generic overlay。角色 `character_turnaround` 去掉 de-AI 注入并改写实预设几何。Image `startImageGeneration` 对产品四格句扩写。

**Tech Stack:** TypeScript、Vitest、NestJS、既有 `@lnkpi/agent` prompt-modes、Python agent-runtime 同步文件。

**Spec:** [2026-09-15-turnaround-deai-product-four-panel-design.md](../specs/2026-09-15-turnaround-deai-product-four-panel-design.md)

## Global Constraints

- 不新增 PromptModeId
- 不关闭 LLM Call-1（仅产品捷径跳过）
- 不改 Q 版/高定等非写实预设正文
- 提交前跑 `pnpm --filter @lnkpi/shared exec vitest run src/promptContent.test.ts` 与 `pnpm --filter @lnkpi/agent exec vitest run src/prompt-modes`

---

### Task 1: 产品句检测 + 去 AI 化退出测试

**Files:** promptContent.ts/.test.ts；character-turnaround-deai.test.ts；character-turnaround-presets.test.ts；classify.test.ts；generate.test.ts

- [x] **Step 1: Write failing tests**
- [x] **Step 2: Run tests, confirm FAIL for new assertions**
- [x] **Step 3: Implement shared detector, de-AI removal, product overlay, classify shortcut, generate overlay, image expand**
- [x] **Step 4: Run listed vitest commands. Expected: PASS**
- [ ] **Step 5: Commit only if the user asks**

### Task 2: Python 同步 + 生产冒烟断言

**Files:** prompt_templates.py；character_turnaround_presets.py；prod-atomic-studio-verify.py

- [x] 去掉 `format_deai_rules_for_system` 注入
- [x] 写实预设几何与 TS 对齐
- [x] 写实冒烟改为：有四格、无 Negative Prompt / 85mm
