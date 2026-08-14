# 统一图生视频管线（Unified I2V Pipeline）产品与技术规格

> 状态：**规格已定 / 待开发**  
> 日期：2026-08-14  
> 范围：将画布三种图生视频入口（节点内引图、上游连线、Agent 侧栏芯片）收敛为 **同一套语义模型 + 同一套 async 生成编排**；新增显式中间层 `RefBinding → CanonicalRefs → VideoGenerationOrchestrator`  
> 前置：`2026-07-18-node-data-flow-refs-design.md`（refs SSOT）、`2026-08-08-seedance-agnes-video-adapter-design.md`（provider adapter）、`fix/agent-video-generation-polling` 分支热修（start/wait 拆分 + 660s 轮询）  
> 后续：Campaign `attach_edges` 收敛（Phase 2）、`referenceImageUrl` 字段退役（Phase 3）

---

## 0. 决策摘要

| 项 | 结论 |
|---|---|
| 本轮代号 | **U-I2V**（Unified Image-to-Video Pipeline） |
| 产品原则 | **入口可不同，引擎必须相同** — 用户心智始终是「参考图 + 提示词 → 视频」 |
| 中间层 | 显式三层：`RefBindingAdapter` → `CanonicalRefsResolver` → `VideoGenerationOrchestrator` |
| 统一 SSOT | 生成前唯一真相源 = `CanonicalVideoGenerationRequest`（见 §4） |
| 统一生命周期 | 一律 `start → recordId → poll → terminal`；禁止 Agent 专用短超时阻塞 |
| 统一进度 UX | 节点角标耗时、侧栏任务卡、生成记录页共用同一 `generationRecordId` 轮询通道 |
| 入口差异保留 | upload / edge / agent chip 只在 **RefBinding** 层适配，不分叉 provider 调用 |
| `referenceImageUrl` | **只读兼容**；新写入路径禁止；canonical 只认 `refs[]` |
| Agent attach 策略 | atomic-create 统一 `localRefs`；campaign `attach_edges` Phase 2 再收敛 |
| 明确不做（本轮） | 新 provider；shot/material 旁路重构；videoComposition 编排；Playwright E2E |

---

## 1. 问题陈述

### 1.1 用户视角：三种行为，一种意图

| # | 用户行为 | 用户心智 |
|---|---|---|
| 1 | 画布新建视频节点 → 上传/拖入图片 + 输入提示词 → 生成 | 「用这张图做参考，生成视频」 |
| 2 | 画布新建视频节点 → 连线上游图片节点 + 输入提示词 → 生成 | 「用上游那张图做参考，生成视频」 |
| 3 | Agent 侧栏 slot 上传图片 + 提示词 → 原子能力建视频节点 → 确认 → 生成 | 「让 Agent 帮我把这张图做成视频」 |

**产品预期：** 三种路径在生成结果、耗时展示、失败回退、积分计费上 **行为一致**。

### 1.2 现状差距（2026-08-14 调研）

| 层级 | 预期 | 现状 |
|---|---|---|
| Provider 引擎 | 同一 adapter | ✅ 已收敛：`resolveNodeRefs` → `buildVideoReferenceBundle` → `studio.generateVideo` |
| 引用绑定 | 统一 canonical refs | ⚠️ 三种存储形态：`localRefs` / `edges` / agent `localRefs`；`referenceImageUrl` 冗余双写 |
| 生成编排 | 统一 async start+poll | ❌ 画布客户端 poll；Agent 曾服务端 180s 阻塞（热修中） |
| 进度 UX | 统一 recordId + startedAt | ❌ Agent 曾缺 recordId；`loadSession` 合并丢 `generationStartedAt` |
| Agent 内部 | 统一 attach 策略 | ⚠️ atomic=`localRefs`；campaign=`attach_edges` |

### 1.3 根因

缺少 **显式中间层**：入口各自直达 `studio.generateVideo` 或 `runVideoGeneration`，编排与 UX 耦合在入口实现里，而非共享 Orchestrator。

---

## 2. 产品规格（四条原则落地）

### 2.1 原则一：统一语义模型

**定义：** 不论引用如何绑定，进入生成引擎前必须归一化为 `CanonicalVideoGenerationRequest`。

| 字段 | 来源 | 说明 |
|---|---|---|
| `prompt` | 节点 `prompt` / `content` | 用户最终意图文本；Agent 可在入口层预处理 |
| `refs` | `resolveNodeRefs()` 输出 | `@I1/@T1/...` 有序列表；**唯一参考图 SSOT** |
| `mentionedKeys` | 节点 `mentionedKeys` | Agent @ 芯片展开；画布可选 |
| `videoSettings` | 节点 `videoSettings` | `{ duration, aspectRatio, resolution, crop, generateAudio? }` |
| `videoMode` | 节点 `videoMode` 或推断 | `text_to_video` / `image_to_video` / `first_last_frame` |
| `model` | 节点 `videoModel` 或账号默认 | BYOK / 平台默认 |
| `scope` | `{ sessionId, nodeId }` | 画布归属与 record 关联 |

**规则：**

1. **禁止** 在 Orchestrator 内读取 `referenceImageUrl` 作为主路径；仅 `buildVideoReferenceBundle(refs, legacyUrl)` 兜底读 legacy。
2. 单图 i2v：`refs` 中恰有 1 个 `mediaType=image` → scenario S2；无需额外写 `videoMode`。
3. 多图：按 `refOrder` 排序；scenario S4/S5 由 `inferVideoScenario` 决定。
4. 三种入口绑定完成后，节点上必须能 **仅通过 `resolveNodeRefs` 还原相同 refs**（验收用例见 §8）。

### 2.2 原则二：统一生成生命周期

**状态机（所有入口共用）：**

```text
draft → [start] → generating → { completed | error | fallback_pending | timeout }
                      ↑
              generationRecordId 立即返回
              generationStartedAt 立即写入
```

**API 契约：**

| 阶段 | 方法 | 返回 | 阻塞 |
|---|---|---|---|
| Start | `VideoGenerationOrchestrator.start()` | `{ generationRecordId, status: 'generating', actions? }` | 否（仅等上游 accept） |
| Wait | `VideoGenerationOrchestrator.wait(recordId)` | `{ status, url?, generationRecordId }` | 是（服务端 poll，video 660s） |
| Poll | `GET/POST generations/:id` | record 快照 | 否 |
| Terminal | completed / error / fallback_pending | — | — |

**约束：**

- 画布 Dock 点击生成：**必须** 调 `start`，然后客户端 `useGenerationPolling` 轮询；不再在 HTTP 请求内阻塞至完成。
- Agent atomic / orchestrate：**必须** `start` → 立即 SSE `task_update(recordId)` → `wait` 在 worker 内执行。
- `wait` 超时 = 660_000ms（Agnes 600s + buffer）；timeout 时节点 status=`timeout`，record 仍可在客户端继续 poll。

### 2.3 原则三：统一进度 UX

| 触面 | 数据源 | 规则 |
|---|---|---|
| 节点角标耗时 | `node.data.generationStartedAt` | 来自 start 动作；`loadSession` 合并时必须保留 |
| 侧栏任务卡 | SSE `task_update.recordId` + poll | recordId 在 start 后立即推送；terminal 以 poll 为准（W11） |
| 生成记录页 | `generationRecordId` | 三入口写入同一 record 表 |
| fallback 弹窗 | record.status=`fallback_pending` | 三入口同一 confirm/cancel API |

**禁止：** Agent 路径在 turn 结束才 flush canvas_action 导致 generating 状态不可见 — start 的 `actions` 必须 **即时 forward**（已有 `_forward_actions`，Orchestrator 须保证 start 即 persist+forward）。

### 2.4 原则四：入口层可不同

| 入口 | RefBindingAdapter | 输出到节点 |
|---|---|---|
| 画布 upload/拖入 | `CanvasLocalRefAdapter` | `localRefs[]` + 可选 legacy `referenceImageUrl`（Phase 3 移除写入） |
| 画布 edge | `CanvasEdgeAdapter`（无额外写） | 依赖已有 edge；用户连即绑定 |
| Agent atomic chip | `AgentSidebarLocalRefAdapter` | `applySidebarAttachments(mode:localRefs)` |
| Agent campaign（Phase 2） | `AgentSidebarEdgeAdapter` | 暂保留 `attach_edges`；收敛目标 = localRefs |

入口适配器 **只做绑定**，不调用 provider。

---

## 3. 架构：显式中间层

### 3.1 分层图

```text
┌──────────────────────────────────────────────────────────────────┐
│ L0  Entry Adapters（薄，入口专属）                                  │
│  CanvasDockEntry      AgentAtomicEntry      MaterialEntry(legacy) │
└────────────┬─────────────────┬───────────────────────────────────┘
             │                 │
             ▼                 ▼
┌──────────────────────────────────────────────────────────────────┐
│ L1  Ref Binding（写入画布语义，不生成）                              │
│  统一输出：CanvasNode.data 满足 §2.1 可解析性                       │
└────────────┬─────────────────────────────────────────────────────┘
             ▼
┌──────────────────────────────────────────────────────────────────┐
│ L2  Canonical Refs（packages/shared + packages/agent）             │
│  resolveNodeRefs → CanonicalRef[]                                │
│  buildVideoReferenceBundle → VideoReferenceBundle                │
│  inferVideoScenario → S1..S8                                     │
│  resolveCanonicalVideoRequest(node, canvas) → CanonicalVideo...  │
└────────────┬─────────────────────────────────────────────────────┘
             ▼
┌──────────────────────────────────────────────────────────────────┐
│ L3  Video Generation Orchestrator（apps/server/studio）            │
│  start(request) → { generationRecordId, actions }                 │
│  wait(recordId) → terminal                                         │
│  （内部调 studio.generateVideo + pollGeneration）                   │
└────────────┬─────────────────────────────────────────────────────┘
             ▼
┌──────────────────────────────────────────────────────────────────┐
│ L4  Provider Adapter（已有，不改动职责）                           │
│  buildVideoProviderOptions → createVideoProvider → upstream       │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 核心类型（SSOT）

```typescript
/** packages/shared/src/videoGeneration/types.ts */

export interface CanonicalVideoGenerationRequest {
  prompt: string
  refs: GenerationRefPayload[]
  mentionedKeys?: string[]
  videoSettings: {
    duration: number
    aspectRatio: string
    resolution: string
    crop: string
    generateAudio?: boolean
  }
  videoMode?: 'text_to_video' | 'image_to_video' | 'first_last_frame'
  model?: string
  scope: { sessionId: string; nodeId: string }
}

export interface VideoGenerationStartResult {
  generationRecordId: string
  status: 'generating'
  generationStartedAt: string
  actions: CanvasAction[]
}

export interface VideoGenerationWaitResult {
  generationRecordId: string
  status: string
  url?: string
  actions: CanvasAction[]
}
```

### 3.3 Canonical 解析器

```typescript
/** packages/shared/src/videoGeneration/resolveCanonicalVideoRequest.ts */

export function resolveCanonicalVideoRequest(input: {
  node: CanvasNode
  canvas: CanvasData
  accountDefaults?: VideoAccountDefaults
}): CanonicalVideoGenerationRequest
```

**职责：**

1. 调 `resolveNodeRefs` 得 refs
2. 合并 `videoSettings`（节点 > 账号默认）
3. 若 refs 含 image 且未显式 `videoMode` → 推断 `image_to_video`
4. **不**读 `referenceImageUrl` 写入 refs（legacy 兜底留在 server orchestrator 一层）

### 3.4 Video Generation Orchestrator

```typescript
/** apps/server/src/studio/video-generation.orchestrator.ts */

@Injectable()
export class VideoGenerationOrchestrator {
  constructor(
    private studio: StudioService,
    private sessionPersist: SessionCanvasPersist, // 抽象 persist 回调
  ) {}

  async start(
    userId: string,
    request: CanonicalVideoGenerationRequest,
    legacyReferenceImageUrl?: string,
  ): Promise<VideoGenerationStartResult>

  async wait(
    userId: string,
    input: { sessionId: string; nodeId: string; generationRecordId: string },
  ): Promise<VideoGenerationWaitResult>
}
```

**`start` 步骤（顺序固定）：**

1. `generationStartedAt = now()`；persist `{ status: generating, generationStartedAt, prompt }`
2. `bundle = buildVideoReferenceBundle(refs, legacyReferenceImageUrl)`
3. `record = studio.generateVideo(...)` — 异步，立即返回 generating record
4. persist `{ generationRecordId: record.id }`
5. return `{ generationRecordId, status: generating, generationStartedAt, actions }`

**`wait` 步骤：**

1. `pollGeneration(recordId, VIDEO_POLL_TIMEOUT_MS=660_000)`
2. persist terminal `{ status, url?, errorMessage? }`
3. return wait result

---

## 4. 入口适配规格

### 4.1 画布 Dock 点击生成（CanvasDockEntry）

**现状：** `useNodeGeneration.generateImageOrVideo` → `studioApi.generateVideo`（同步 HTTP 等 record 创建，客户端 poll）

**目标：**

```text
resolveCanonicalVideoRequest(node, canvas)
  → POST /studio/video/start  (新 endpoint，或 /video/generate?mode=start)
  → patchNodeData({ generationRecordId, generationStartedAt })
  → useGenerationPolling(recordId)
```

**变更：**

- 新增 `studioApi.startVideoGeneration()` / `waitVideoGeneration()` 与 Agent internal 对齐
- 画布 **不再** 依赖 `studioApi.generateVideo` 一站式阻塞语义（保留 deprecated 别名 1 个版本）

### 4.2 Agent 原子能力（AgentAtomicEntry）

**现状：** `runVideoGeneration` in `agent-canvas-tools.service.ts`（热修已 split start/wait）

**目标：**

```text
applySidebarAttachments(localRefs)   // RefBinding 已完成
  → resolveCanonicalVideoRequest
  → VideoGenerationOrchestrator.start()
  → SSE task_update(recordId)
  → VideoGenerationOrchestrator.wait()
```

**变更：**

- `AgentCanvasToolsService.startVideoGeneration` **委托** Orchestrator，删除重复逻辑
- `run_atomic_gen` / `gen_node` video 分支 **只** 调 start/wait nest 方法（热修已部分完成）

### 4.3 HTTP 面对照

| Consumer | Start | Wait | Poll |
|---|---|---|---|
| 画布 web | `POST /api/studio/video/start` | （客户端 poll `/generations/:id`） | `GET /api/studio/generations/:id` |
| Agent runtime | `POST /api/agent/internal/start-video-generation` | `POST .../wait-video-generation` | 同上 |
| 编排器内部 | Orchestrator.start | Orchestrator.wait | studio.getGeneration |

Internal 与 Studio 公开 API **共用** 同一 Orchestrator 实例。

---

## 5. 数据模型与迁移

### 5.1 节点字段（视频）

| 字段 | Phase 1 | Phase 3 |
|---|---|---|
| `localRefs` | ✅ 主写入（upload/agent） | ✅ |
| `edges` | ✅ 主写入（连线） | ✅ |
| `refOrder` | ✅ | ✅ |
| `mentionedKeys` | ✅ Agent | ✅ |
| `videoSettings` | ✅ | ✅ |
| `videoMode` | 可读可写；canonical 可推断 | ✅ |
| `referenceImageUrl` | ⚠️ 只读 legacy + 画布仍双写 | ❌ 停止写入；读取仅 fallback |
| `generationStartedAt` | ✅ start 必写 | ✅ |
| `generationRecordId` | ✅ start 必写 | ✅ |

### 5.2 mergeCanvasNodesFromServer 规则

当 `server.status === 'generating'` 时，合并：

- `status`
- `generationRecordId`
- `generationStartedAt`（**必须**，Fix 已落地）

### 5.3 Agent attach 收敛路线

| 阶段 | atomic-create | campaign |
|---|---|---|
| Phase 1 | `localRefs` | 保持 `attach_edges` |
| Phase 2 | — | 评估迁移至 `localRefs` 或统一 `attach_edges` + 文档化 |

---

## 6. 错误处理与 fallback

| 场景 | 行为 | 三入口一致 |
|---|---|---|
| 无 prompt | 400 / 节点 error | ✅ |
| 无 refs 且 t2v | scenario S1 正常 | ✅ |
| i2v 无可用 image url | 400 stale ref 过滤后若无图 → 降级 t2v 或 400（按 scenario） | ✅ |
| BYOK 失败 | fallback_pending → 用户 confirm/cancel | ✅ |
| wait 超时 | node status=timeout；record 仍 generating；客户端可续 poll | ✅ |
| 内网 upload URL | `inlineUpstreamReferenceImages` 在 studio.generateVideo 内 | ✅ |

---

## 7. 非目标（本轮）

- Campaign `attach_edges` → `localRefs` 迁移（Phase 2）
- shot / material 旁路接入 Orchestrator（仍走 MaterialService，仅标注 legacy）
- 新 video provider 或 Seedance §14 扩展
- 自动级联生成（上游完成自动跑下游）
- E2E Playwright

---

## 8. 验收标准

### 8.1 功能对等（三入口 × 同一参考图）

给定同一张公网 HTTPS 参考图 + 相同 prompt + 相同 videoSettings（15s / 16:9 / 720p）：

| 断言 | 路径1 upload | 路径2 edge | 路径3 agent |
|---|---|---|---|
| `resolveCanonicalVideoRequest` refs 等价 | ✅ | ✅ | ✅ |
| metadata.refWire 相同 | ✅ | ✅ | ✅ |
| start 后立即有 recordId | ✅ | ✅ | ✅ |
| 节点角标耗时 > 0:00 | ✅ | ✅ | ✅ |
| 侧栏任务卡 recordId 轮询 | N/A | N/A | ✅ |
| 完成后面板 url 可用 | ✅ | ✅ | ✅ |

### 8.2 单元测试

- `resolveCanonicalVideoRequest`：三种节点态 → 相同 canonical output
- `VideoGenerationOrchestrator.start`：persist 顺序、recordId 返回
- `mergeCanvasNodesFromServer`：generating + startedAt

### 8.3 集成测试

- Agent atomic video e2e mock：start → task_update 含 recordId → wait → done
- Studio video/start API：与 internal start 同一 orchestrator

---

## 9. 与现有规格关系

| 文档 | 关系 |
|---|---|
| `2026-07-18-node-data-flow-refs-design.md` | refs SSOT；本规格在其上增加 **生成编排统一** |
| `2026-08-08-seedance-agnes-video-adapter-design.md` | L4 provider；本规格不改 adapter 职责 |
| `2026-08-03-agent-phase-c-canvas-sync-gen.md` | Agent canvas sync；本规格补齐 video 编排缺口 |
| `fix/agent-video-generation-polling` | Phase 0 热修；本规格将其 **升格** 为 Orchestrator 正式架构 |

---

## 10. 分期交付

| Phase | 内容 | 产出 |
|---|---|---|
| **P0 热修** | start/wait split、660s poll、recordId、startedAt merge | ✅ 分支 `fix/agent-video-generation-polling` |
| **P1 Orchestrator** | 抽出 `VideoGenerationOrchestrator` + `resolveCanonicalVideoRequest` | ✅ 本分支 |
| **P2 画布接入** | `studio/video/start` + web 改 async | ✅ 本分支 |
| **P3 清理** | 停写 `referenceImageUrl`；deprecated 一站式 generateVideo | 文档 + lint 规则 |

---

## 11. 方案对比（Brainstorming 结论）

| 方案 | 描述 | 优点 | 缺点 | 结论 |
|---|---|---|---|---|
| **A（推荐）** | 显式 Orchestrator + Canonical 类型 | 边界清晰；易测；Agent/画布真正同码 | 需新增 studio start API | ✅ 采用 |
| B | 仅 Agent 对齐画布 poll，不抽层 | 改动小 | 逻辑仍分散；下次再分叉 | ❌ |
| C | 前端统一调 Agent internal API | 后端单路径 | 画布依赖 agent 路由；权限乱 | ❌ |

**推荐 A 的理由：** 产品四条原则中，「统一语义」和「统一生命周期」都需要一个 **共享域服务**；Orchestrator 放在 `studio` 模块符合 C1 适配层归属，Agent 仅作 HTTP 消费者。

---

## 12. 开放问题（Phase 2+）

1. Campaign `attach_edges` 是否在 SSOT 层转换为 synthetic localRefs，还是保留 edge 为主？
2. Material/shot 旁路何时迁入 Orchestrator（依赖 C2 统一状态机规划）？
3. 是否在 canonical 层强制 `videoMode` 写入节点（便于 UI 展示 t2v/i2v 徽章）？

---

**Spec 路径：** `docs/superpowers/specs/2026-08-14-unified-image-to-video-pipeline-design.md`  
**下一步：** 见 `docs/superpowers/plans/2026-08-14-unified-image-to-video-pipeline.md`
