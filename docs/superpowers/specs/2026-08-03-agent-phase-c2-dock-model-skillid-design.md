# Phase C 二期：Agent Dock model/skillId 端到端（MVP A）

> 状态：已确认  
> 依赖：Phase C 画布同步出图（#106）、Phase B await_topo/topo_revise（#104/#105）  
> 范围：**skillId + model 端到端**；积分徽章与真实规划扣费不在本 MVP

## 1. 目标

用户在 Agent 侧栏 dock 选择的 **技能** 与 **规划模型**，经 Web → Nest → Runtime 全链路生效：

1. `skillId` 驱动 `intake` 选 Skill 包（显式优先于关键词启发式）
2. `model` 驱动规划 LLM（平台模型 + 用户 BYOK，与 Studio Dock 一致）
3. 去掉「【技能：…】」文案前缀 hack
4. 停用/不可选模型发送前拦截，避免「发送无回复」

## 2. 非目标

- 真实规划积分扣费 / `DockCreditBadge` 对齐
- 新增 `storyboard` / `polish` / `organize` Runtime Skill 包
- `/技能名` 斜杠唤起
- Canvas Studio Dock 改动（其 model 链路已独立）

## 3. 架构

```
AgentSideRail
  POST /api/agent/chat/conversation
    { sessionId, message, threadId, userDecision?, skillId?, model? }
      ↓
Nest agent.service
  ProviderResolver.resolveText(model, userId) → { model, apiKey, baseUrl }
      ↓
Runtime POST /v1/runs
    { session_id, user_id, message, thread_id, user_decision?,
      skill_id?, llm_model?, llm_api_key?, llm_base_url? }
      ↓
stream_run_events → resolve_llm(req) → build_agent_graph(llm=...)
intake: requested_skill_id 优先 → skill_id → plan | chat
```

**Model 解析方案（锁定）**：Nest 侧 ProviderResolver 解 BYOK，Runtime 仅收内部 service-token 保护的 credentials 字段；浏览器不传 apiKey。

## 4. skillId 门控

### 4.1 优先级

1. 请求体 `skillId`（经 UI 映射表 → Runtime skill 目录名）
2. 关键词 `marketing_intent(text)` 启发式（保留兼容）
3. 无 skill → `chat` 分支

### 4.2 UI → Runtime 映射（MVP 静态）

| UI `skillId` | Runtime `skill_id` | 行为 |
| --- | --- | --- |
| `canvas` | `enterprise-marketing-campaign` | 营销 plan 流程 |
| `storyboard` | — | `chat`；菜单标注「开发中」 |
| `polish` | — | `chat` |
| `organize` | — | `chat` |

映射表位于 `AgentSideRail.vue`（或抽 `agentSkillMap.ts`）。Runtime `intake` 校验 `discover_skills()` 中存在才写入 `skill_id`。

### 4.3 移除前缀 hack

删除 `【技能：${label}】` 拼接；`message` 为用户原始输入。

## 5. model 选择

### 5.1 前端

- 恢复 `UniversalModelSelector`（`type="text"`）
- 数据源：`useProviderBootstrap().preferences.selectableTextModels`
- 默认：`defaultTextModel` → 平台默认
- 发送前：若当前 model 不在 selectable 列表或 disabled → toast 阻止发送

### 5.2 Nest

- `ConversationDto` 增加可选 `model?: string`（encoded channel model，与 Studio 同格式）
- `streamConversation` 调用 ProviderResolver；失败返回 400 + 可读错误
- 转发 Runtime：`llm_model`, `llm_api_key`, `llm_base_url`（仅内网）

### 5.3 Runtime

- `RunRequest` 增加 `skill_id?`, `llm_model?`, `llm_api_key?`, `llm_base_url?`
- `resolve_llm(req)`：有 `llm_api_key` + `llm_model` 则构建 per-request `ChatOpenAI`；否则 `default_llm()`
- 新 turn `input_state` 注入 `requested_skill_id: req.skill_id`

## 6. API / Contract

| 层 | 变更 |
| --- | --- |
| `apps/server/.../agent.controller.ts` | `ConversationDto.skillId?`, `ConversationDto.model?` |
| `apps/server/.../agent-runtime.client.ts` | `RuntimeRunInput` 扩展 |
| `services/agent-runtime/app/runs.py` | `RunRequest` 扩展 |
| `packages/shared/src/agentContract.ts` | 可选 `AgentConversationRequest` Zod |
| `scripts/verify-contract.ts` | 若新增 shared schema 则注册 |

## 7. 错误处理

| 场景 | 行为 |
| --- | --- |
| 未知 skillId（映射为 null） | intake → chat，不报错 |
| 映射 skill 目录不存在 | intake 忽略，fallback 启发式或 chat |
| model 不可 resolve | Nest 400，前端 toast |
| Runtime LLM 调用失败 | 现有 error SSE + `last_error` |

## 8. 测试

### 8.1 单元

- `test_intake_gate.py`：显式 `requested_skill_id=enterprise-marketing-campaign` + 非营销文案 → plan
- `test_intake_gate.py`：`requested_skill_id` 无效 → chat
- `test_runs_llm.py`（新）：`resolve_llm` override vs default
- Nest：`agent.service` 转发 skillId/model 字段

### 8.2 生产回归

- `deploy/prod-phase-b-user-verify.py` PASS
- `deploy/prod-phase-c-user-verify.py` PASS

### 8.3 可选 E2E

- `deploy/prod-phase-c2-dock-verify.py`：canvas skill + model → 营销 plan；storyboard → chat

## 9. 成功标准

1. 侧栏选「画布编排」+ 营销需求 → 进入 `enterprise-marketing-campaign` plan（不依赖关键词 alone）
2. 侧栏选「分镜脚本」+ 任意消息 → `chat`，无前缀污染
3. 切换规划 model 后 plan 节点 LLM 使用该 model（可通过 trace/log 或响应差异验证）
4. BYOK text model 可选且能正常 plan
5. 停用 model 无法发送
6. Phase B/C 生产脚本仍 PASS

## 10. 文档修订

| 日期 | 说明 |
| --- | --- |
| 2026-08-03 | MVP A 规格：skillId + model E2E，积分二期 |
