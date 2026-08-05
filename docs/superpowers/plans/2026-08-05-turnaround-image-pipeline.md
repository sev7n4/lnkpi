# 角色设定图（多视图）智能二段式出图 — P0 实现计划

> **For agentic workers:** 使用 superpowers:subagent-driven-development 或 superpowers:executing-plans 按 Task 执行。  
> **Spec:** [2026-08-05-turnaround-image-pipeline-design.md](../specs/2026-08-05-turnaround-image-pipeline-design.md)

**Goal:** 用户说「三视图/四视图/角色设定图」（无「提示词」）时，单 image 节点内完成 character_turnaround 扩写 + 2:1 出图。

**Architecture:** agent-runtime 识别 `pipeline=turnaround_image` 写入 atomic_spec；server `startImageGeneration` 检测 pipeline → `generatePromptFromUserInput` → `generateImage(expandedPrompt, 2:1)` → 节点写入 expandedPrompt + url。

**Tech Stack:** Python 3.11 (agent-runtime pytest), NestJS (`apps/server`), `@lnkpi/agent` prompt-modes, deploy smoke.

## Global Constraints

- Branch from `main`: `feature/turnaround-image-pipeline` — **禁止直推 main**
- 本地验证：`pnpm build` + `pytest services/agent-runtime/tests/test_atomic_create_intent*.py` + server 相关 test
- 含「提示词」utterance **不得**进入 turnaround_pipeline
- 普通 image 直出路径 **零回归**
- Squash merge + 生产 smoke

## File map

| File | Role |
|------|------|
| `services/agent-runtime/app/graph/atomic_intent.py` | `is_turnaround_image_intent()`, `build_atomic_spec()` pipeline |
| `services/agent-runtime/skills/atomic-create/intent-taxonomy.yaml` | pipeline + triggers |
| `services/agent-runtime/skills/atomic-create/eval-intent-set.yaml` | 新增 case |
| `services/agent-runtime/tests/test_atomic_create_intent.py` | 路由单测 |
| `apps/server/src/agent/agent-canvas-tools.service.ts` | 二段式出图 |
| `apps/server/src/agent/agent-canvas-tools.service.test.ts` | server 单测 |
| `packages/agent/src/prompt-modes/modes/character-turnaround.ts` | 非人物/神兽 system 补充 |
| `deploy/prod-atomic-studio-verify.py` | 生产 smoke case |

---

### Task 1: Turnaround intent + atomic_spec pipeline

**Files:**
- Modify: `services/agent-runtime/app/graph/atomic_intent.py`
- Modify: `services/agent-runtime/skills/atomic-create/intent-taxonomy.yaml`
- Modify: `services/agent-runtime/tests/test_atomic_create_intent.py`

**Acceptance:**
- [ ] `is_turnaround_image_intent("山海经吞金兽的三视图，CG风格")` → True
- [ ] `is_turnaround_image_intent("…三视图的提示词")` → False
- [ ] `build_atomic_spec(...)` 返回 `target_type=image`, `pipeline=turnaround_image`
- [ ] `parse_atomic_target_type` 仍为 `image`（非 prompt）

---

### Task 2: Eval set + taxonomy sync

**Files:**
- Modify: `services/agent-runtime/skills/atomic-create/eval-intent-set.yaml`
- Modify: `services/agent-runtime/skills/atomic-create/assets/few-shots.yaml`（可选）
- Modify: `services/agent-runtime/app/graph/atomic_parse_llm.py`（LLM parse 规则一行）

**Acceptance:**
- [ ] 新增 case：`山海经吞金兽的三视图，CG风格` → image + pipeline
- [ ] eval 全绿

---

### Task 3: Server 二段式出图

**Files:**
- Modify: `apps/server/src/agent/agent-canvas-tools.service.ts`
- Modify: `apps/server/src/agent/agent-canvas-tools.service.test.ts`

**Logic sketch:**

```typescript
// startImageGeneration
const pipeline = node.data?.pipeline ?? specFromAtomic
if (pipeline === 'turnaround_image') {
  const { mode, content } = await generatePromptFromUserInput(prompt, opts)
  expandedPrompt = content
  aspectRatio = '2:1'
  imagePrompt = content
}
// persist expandedPrompt + promptMode on node before generateImage
```

**Acceptance:**
- [ ] turnaround 路径调用 `generatePromptFromUserInput`
- [ ] `generateImage` 使用扩写 content，非原句
- [ ] aspectRatio 为 2:1
- [ ] 节点 data 含 `expandedPrompt`, `promptMode=character_turnaround`, `pipeline=turnaround_image`
- [ ] 单测 mock 验证调用顺序

---

### Task 4: character_turnaround 非人物支持

**Files:**
- Modify: `packages/agent/src/prompt-modes/modes/character-turnaround.ts`
- Sync: `services/agent-runtime/app/tools/prompt_templates.py`（若 system 片段 duplicated）

**Acceptance:**
- [ ] system 明确：角色可为人物、神兽、机甲、生物、道具
- [ ] 图类型占位符示例含非人类 case

---

### Task 5: Deploy smoke + 生产复测

**Files:**
- Modify: `deploy/prod-atomic-studio-verify.py`

**Acceptance:**
- [ ] 新增 case：`山海经吞金兽的三视图，CG风格`
- [ ] 断言 image 节点 + expandedPrompt 含「四格」
- [ ] aspectRatio ≠ 16:9
- [ ] 生产 PASS

---

### Task 6: PR + CI + merge

- [ ] `pnpm build`
- [ ] pytest + server test 全绿
- [ ] PR body 引用 spec §七 AC-T
- [ ] Squash merge → 等待 deploy → 跑 smoke
