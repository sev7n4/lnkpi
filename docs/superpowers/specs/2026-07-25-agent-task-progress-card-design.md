# Agent 对话任务进度卡 + 自动出视频（一期增补）设计

> 状态：**已确认**（2026-07-25）  
> 日期：2026-07-25  
> 前置：  
> - `2026-07-23-agent-runtime-langgraph-design.md`（Runtime / Skills / 出图）  
> - `2026-07-24-agent-chat-ux-phase1-design.md`（对话 UX / Skill 门控；已确认追加拆图与 Vercel SSE proxy 约束）  
> 依据：脏画布复测（busy tip / 二轮节点不可见）+ 产品要求「类 Cursor 任务清单」+ **视频纳入一期自动编排**  
> 范围：确认后侧栏**任务进度卡**、结构化进度事件、可恢复错误自动重试≤2、终局摘要与失败建议、点击定位节点、**自动出视频**（与出图同一编排）  
> 非范围：卡片内一键确认平台兜底 API、卡片内一键重试出图/出片 API（二期）、`interrupt()` HITL、dock model/skillId 计费、按 brief 裁剪 manifest  
>
> **修订（2026-07-25）：** 主文案入卡且待确认为 `needs_user`（非 `skipped`）；`orchestrate_gen` **禁止**整表替换 `task_list`。闭环与文案 HITL 见 `2026-07-25-agent-confirm-loop-hardening-design.md`。

---

## 0. 决策摘要

| 项 | 结论 |
| --- | --- |
| UI 形态 | 方案 **A**：确认后钉一张**任务进度卡**（非纯 Markdown 刷屏） |
| 覆盖阶段 | 范围 **3**：方案/确认仍用聊天气泡；清单只管确认后的执行（拆骨架 + 生成） |
| 自动重试 | **混合**：可恢复错误自动重试最多 **2** 次；`fallback_pending` / 积分不足等 → `needs_user` |
| 卡片操作一期 | 展示建议文案 + **点击行定位画布节点**；一键确认平台 / 一键重试 API → 二期 |
| 视频 | **一期纳入自动出视频**（修正主规格「视频二期」）；manifest `show_video.auto_generate=true`；与图同一 `orchestrate_gen` + 任务卡 |
| 事件 | 新增 `task_list` / `task_update` / `task_summary`（SSE）；可减量重复 `text_delta` 进度 |

---

## 1. 问题与目标

### 1.1 现状痛点

- 进度主要靠散文 `text_delta`，用户难扫读「做到哪一步」。  
- 失败/兜底混在长文里，缺结构化终局汇报与建议。  
- 无自动重试策略，瞬时失败直接记失败。  
- 视频仅建骨架、`auto_generate=false`，与「确认后自动出片」产品预期不符。

### 1.2 成功标准

1. 确认拆图后侧栏出现任务卡，逐项更新状态直至终局。  
2. 可恢复失败可见 `retrying 1/2`、`2/2`；用尽后 `failed` + 建议。  
3. `fallback_pending` / 积分不足等为 `needs_user` + 明确建议（去节点确认平台 / 去充值）。  
4. 结束必有 `task_summary`（成功/失败/需处理/跳过）+ 同源短文汇报。  
5. 点击任务行可定位对应画布节点。  
6. 视频节点进入同一清单并自动生成（账户默认视频参数已 stamp 的前提下）。

---

## 2. 任务进度卡

### 2.1 生命周期

```text
用户确认 → split 成功
  → emit task_list（全量 manifest，含 text；主文案随后 needs_user）
  → draft_copy（主文案草稿 HITL，不阻塞出图）
  → 逐项 task_update（running / retrying / done / failed / needs_user / skipped）
  → emit task_summary + 助手短文（断流后可由前端对账合成）
  → 卡标题改为「本轮执行结果」
```

未确认前不出现任务卡。同画布**追加拆图**时：新一轮确认产生**新卡**（或新 run 区块），不覆盖历史卡（历史可折叠）。

### 2.2 单项状态

| 状态 | 含义 | UI |
| --- | --- | --- |
| `pending` | 未开始 | 空心 |
| `running` | 生成中 | 进行中 |
| `retrying` | 自动重试中 | 进行中 + `重试 n/2` |
| `done` | 成功（有可用结果 URL/状态 completed） | 勾选 |
| `failed` | 可恢复重试用尽仍失败 | 叉 + 短因 |
| `needs_user` | 不可自动重试 | 警告 + 建议 |
| `skipped` | 明确不执行（如纯 text 文案项） | 灰字 |

### 2.3 卡结构

1. 标题：执行中 / 本轮执行结果  
2. 列表：title、状态、可选 attempt、短因/建议  
3. 底栏：仅终局出现，与 `task_summary` 同源  

---

## 3. 重试与失败建议

### 3.1 自动重试（`orchestrate_gen`）

- 上限：**2** 次（即最多 3 次尝试：初试 + 2 次重试）。  
- 可恢复（示例）：超时、上游 5xx、瞬时网络/渠道错误（非 `fallback_pending`、非积分不足、非审核拒绝）。  
- 状态：进入重试前 `task_update` → `retrying`（`attempt=1|2`）。  
- **不**自动重试：`fallback_pending`、积分不足、内容策略拒绝、明确配置/权限错误 → 直接 `needs_user`。

### 3.2 建议文案映射

| 原因类 | 建议 |
| --- | --- |
| `fallback_pending` | 请到画布对应节点确认平台服务后继续 |
| 积分不足 | 请充值或更换可用渠道后再试 |
| 超时 / 5xx（重试已尽） | 可稍后在节点上点重试，或换模型再试 |
| 内容策略拒绝 | 请改提示词后在节点重试 |
| 上游依赖失败跳过 | 先修复上游节点再重试本项 |
| 未知 | 打开节点「诊断信息」查看详情后重试 |

### 3.3 一期交互深度

| 能力 | 一期 |
| --- | --- |
| 卡内建议文案 | 做 |
| 点击行 → 定位/高亮节点 | 做 |
| 卡内一键确认平台 / 一键重试 API | **不做**（二期） |
| 打开设置/充值 | 文案引导；可选打开已有设置入口 |

---

## 4. SSE 事件协议

在现有 `text_delta` | `canvas_action` | `node_status` | `done` | `error` 上增补：

### 4.1 `task_list`

```json
{
  "type": "task_list",
  "data": {
    "runId": "optional-opaque",
    "items": [
      { "id": "manifest-key-or-node", "title": "主图", "nodeId": "image-…", "kind": "image" },
      { "id": "show_video", "title": "产品展示视频", "nodeId": "video-…", "kind": "video" }
    ]
  }
}
```

### 4.2 `task_update`

```json
{
  "type": "task_update",
  "data": {
    "id": "show_video",
    "status": "retrying",
    "attempt": 1,
    "maxAttempts": 2,
    "errorCode": "timeout",
    "errorHint": "可稍后在节点上点重试，或换模型再试"
  }
}
```

### 4.3 `task_summary`

```json
{
  "type": "task_summary",
  "data": {
    "success": 6,
    "failed": 1,
    "needsUser": 1,
    "skipped": 0,
    "lines": [
      { "id": "banner", "status": "needs_user", "title": "Banner", "hint": "请到画布对应节点确认平台服务后继续" }
    ]
  }
}
```

Web：`AgentSideRail` 订阅事件渲染卡片；`task_summary` 同时可合成一条助手短文（或 Runtime `done` 节点发同源文案）。  
`text_delta` 逐条「· 主图：出图成功」可降为可选，避免与卡片重复。

---

## 5. 自动出视频（一期）

### 5.1 规格修正

主规格原「自动出视频留二期」**改为本期纳入**：

| 原一期 | 现一期 |
| --- | --- |
| video 骨架 + 账户默认参数，手动 Dock 出片 | 确认后 **自动出视频**（与图同一编排） |
| `canvas-manifest` `auto_generate_video: false` / `show_video.auto_generate: false` | 均改为 **`true`**（本 Skill） |

### 5.2 实现要点

| 层 | 改动 |
| --- | --- |
| Nest | 新增 Agent internal `run_video_generation`（对称 `runImageGeneration`：读节点/账户默认 → Studio `video/generate` → 写回节点 + `canvas_action` / `node_status`） |
| Runtime | `NestEventProxy.run_video_generation`；`topo` 扩展为 image+video（或分阶段：先图后视频，尊重 `depends_on`） |
| Skill | `enterprise-marketing-campaign` manifest / SKILL.md：允许自动出视频；依赖仍如 `show_video` → `hero_main` |
| 任务卡 | `kind: video` 与图同等状态机与重试规则 |
| Proxy | `/api/proxy` 已对 Studio video 90s；Agent SSE 120s。若单次出片常 >120s，需评估 Vercel `maxDuration` 或拆「触发 + 轮询状态」二阶段（实现计划里定） |

### 5.3 风险与缓解

- 视频更慢、更贵：任务卡必须暴露 `running`/`retrying`，终局说清费用相关 `needs_user`。  
- 长耗时可能顶满 Vercel 120s：优先保证 Nest/Runtime 侧任务继续；前端靠 `turnComplete` 回拉画布 + 消息补齐；必要时 Runtime 对 video 采用「启动生成 + 轮询 `get_generation_status`」不阻塞整段 SSE（计划阶段选型）。

---

## 6. 与既有修复的关系

- **Vercel proxy**：Agent SSE 长超时、禁重试、透传流（已设计/实现中）是本卡可见的前提。  
- **turnComplete 回拉画布**：避免追加拆图被本地 `saveCanvas` 抹掉；任务卡 `nodeId` 才能对上可见节点。  
- **追加拆图**（UX 规格 §0）：每轮确认新卡 + 新骨架；不原地替换第一轮节点。

---

## 7. 主要改动面

| 层 | 模块 | 改动 |
| --- | --- | --- |
| Runtime | `orchestrate_gen` / `topo` / `gen_copy` / `done` | 重试；task_* 事件；video 入队 |
| Runtime | `runs.NestEventProxy` | `run_video_generation` + emit task_* |
| Runtime | Skill manifest / SKILL.md | `auto_generate` video=true |
| Nest | `agent-canvas-tools` | `runVideoGeneration` + controller 路由 |
| Web | `AgentSideRail` (+ 小组件) | 任务卡 UI；处理 task_*；点击 focus 节点 |
| Web | `CanvasPage` | 接收 focusNode from agent（可复用现有 focus） |
| Docs | 本文 + 交叉修订主规格 §0/§1.2/§10/§12 | 视频一期；任务卡验收 |

---

## 8. 验收标准

1. 确认后出现任务卡；split 所列 image+video 均在清单中。  
2. 运行中可见 `running` / `retrying n/2`；成功 `done`。  
3. 可恢复错误自动重试 ≤2；用尽 → `failed` + 建议。  
4. `fallback_pending` → `needs_user` + 「去节点确认平台」类建议，**不**计入自动重试。  
5. 结束必有摘要：成功/失败/需处理/跳过；与卡底栏一致。  
6. 点击失败或需处理项 → 画布定位到对应节点。  
7. 视频节点自动开始生成（非仅骨架）；成功或失败/需处理均反映在卡上。  
8. 生产经 Vercel proxy 时，长跑确认流不因 20s 重试产生幽灵 busy tip（依赖已合入的 proxy 修复）。

---

## 9. 文档修订记录

| 日期 | 说明 |
| --- | --- |
| 2026-07-25 | 初稿：任务卡 A + 混合重试≤2 + 一期交互深度；**视频纳入一期自动编排** |
