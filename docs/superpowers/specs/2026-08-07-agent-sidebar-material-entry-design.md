# Agent 侧栏素材引用入口 — 设计规格

> 状态：**已确认**（2026-08-07）  
> 范围：Agent 侧栏上传/选取素材，作为各类节点芯片参考内容；贯通 atomic 生图与 Campaign 编排两条路径  
> 前置：[2026-07-18-node-data-flow-refs-design.md](./2026-07-18-node-data-flow-refs-design.md)、[2026-08-03-atomic-studio-intent-design.md](./2026-08-03-atomic-studio-intent-design.md)、[2026-08-06-agent-sidebar-copy-design.md](./2026-08-06-agent-sidebar-copy-design.md)  
> 非范围：V\*/A\* 生成侧消费（展示可预留）、侧栏内嵌完整资产库管理、自动级联生成

---

## 0. 决策摘要

| # | 决策 | 说明 |
|---|------|------|
| **D1** | **复用画布 Ref 模型，不新建侧栏专用结构** | `LocalRefBinding` + `refOrder` + `resolveNodeRefs`；侧栏仅维护会话级 `pendingAttachments` |
| **D2** | **A（atomic）+ B（Campaign）并重** | 同一套侧栏 UI 与 API；落点按 `flow_mode` 分流 |
| **D3** | **atomic 写 localRefs；Campaign 写 edge + refOrder** | atomic 单节点闭环优先 localRefs；split/topo 后 `attach_refs` 连边 |
| **D4** | **交互：引用条 + [+] + 拖拽 + 资产库** | 与 Dock `DockRefStrip` 视觉/语义对齐 |
| **D5** | **focusNodeId 可升格为 ref** | 选中节点若有 url/text，自动并入 attachments（可关闭） |
| **D6** | **M1 仅消费 T\*/I\*** | 与 C2.1 对齐；V/A 芯片可展示，生成侧 P1 再消费 |

---

## 1. 背景与问题

### 1.1 用户期望

用户在 Agent 侧栏描述创作意图时，希望能**附带参考素材**（图片、文案、音视频），让模型或 Agent 在生成/编排时消费这些引用——例如：

| 场景 | 路径 | 用户操作 |
|------|------|----------|
| 产品三视图 | **A — atomic** | 上传产品图 + 「按 @I1 生成正视/侧视/俯视」 |
| 图生图主图 | **A — atomic** | 上传风格参考 + 「按这张图风格出蓝牙耳机主图」 |
| 营销方案 + 参考图 | **B — Campaign** | 上传品牌调性图 + 「做一套耳机营销分镜，主图参考 @I1」 |
| 选中节点续作 | **A/B** | 选中画布 image 节点 + 「按这张图生成白底版」 |

### 1.2 现状缺口

| 能力 | 画布 Dock / 资产库 | Agent 侧栏 |
|------|-------------------|------------|
| 文件上传 | ✅ | ❌ |
| 参考芯片 UI | ✅ `DockRefStrip` | ❌ |
| img2img | ✅（需事先 localRefs/连边） | ❌ atomic 默认纯 t2i |
| 资产库选取 | ✅ 左侧 Dock | ❌ |
| Campaign attach_refs | ✅ split 后连边 | ❌ 侧栏无素材可连 |

**根因：** `AgentSideRail.sendMessage` 仅传 `message` + `focusNodeId`；`atomic_create` 建节点不写 refs；侧栏 `focusNodeId` 只 seed 文案，不传 url。

---

## 2. 目标与非目标

### 2.1 目标

1. 侧栏输入区上方展示**引用芯片条**（T1/I1/V1/A1），与 Dock 一致。
2. 支持 **本地上传、资产库选取、画布选中节点引用** 三种添加入口（P0）。
3. **atomic_create**：建节点后写 `localRefs`，`startImageGeneration` 自动 img2img。
4. **Campaign**：split/topo 后，侧栏 attachments 转为 **mediaInput 节点或 attach_refs**，与现有编排贯通。
5. 用户消息气泡展示所附素材缩略图/标签（可读性）。
6. 拒绝 blob URL；复用 `persistMediaUrl` / `assertNoBlobRefs`。

### 2.2 非目标（M1 不做）

| 能力 | 说明 |
|------|------|
| 侧栏拖拽画布节点 | P1 |
| 粘贴板截图 | P1 |
| V\*/A\* 生成消费 | P1（芯片可展示） |
| 侧栏 @ 提及高亮 | P1（复用 `useRefMentions`） |
| 自动级联下游生成 | 与画布 refs 设计一致，不做 |
| 替代左侧资产库 Dock | 侧栏仅「选取」，不做 CRUD |

---

## 3. 使用场景与落点策略

### 3.1 场景 A — atomic 原子生图

```text
用户：[上传 I1] + 「按 @I1 生成产品三视图」
  → intake: atomic_create
  → parse_atomic_intent (pipeline=turnaround_image 或 多 batch item)
  → create_atomic_node
  → apply_sidebar_attachments → node.data.localRefs + refOrder
  → run_atomic_gen → startImageGeneration(refs=toStudioRefs)
  → img2img / turnaround
```

**规则：**

- 每个新建 image/video 节点继承**同一组** sidebar attachments（除非 parse 指定 per-item refs）。
- 多 batch（三视图拆 3 节点）时，三节点共享 I1 localRef。
- `turnaround_image` pipeline 与 attachments 可并存：I1 作角色参考，pipeline 控制四格模版。

### 3.2 场景 B — Campaign 编排

```text
用户：[上传 I1 品牌图] + [粘贴 T1 卖点文案] + 「做耳机营销方案，主图参考 @I1」
  → intake: campaign
  → plan → split → topo
  → apply_sidebar_attachments:
      方案 1（推荐）：建 mediaInput/image 节点承载 I1，split 后 attach_refs 连到主图 shot
      方案 2：目标 image 节点写 localRefs（与 atomic 同）
  → gen 阶段 toStudioRefs 正常消费
```

**规则：**

- 侧栏 attachments 在 **split 完成后** 应用，避免 plan 阶段节点尚不存在。
- 优先 **attach_refs（edge）** 连到 split 产出的 image/shot 节点，保持画布拓扑可见；若无明确目标，fallback 写 **localRefs**。
- 复用 `chain_refs.py` 排序逻辑：`plan → seed/turnaround → depends_on`。

### 3.3 场景 C — single_node / focusNodeId

```text
用户：选中 image 节点 A → 「按这张图生成白底版」
  → focusNodeId=A → 解析 A 的 url → 作为 edge-equivalent ref
  → atomic_regenerate 或 atomic_create 新节点
  → 新节点 attach_refs 连 A，或 localRefs 镜像 A.url
```

**规则：**

- `focusNodeId` 与 sidebar attachments **合并去重**（同 url 不重复）。
- focus 节点为 text/prompt 时，提取 `content/prompt` 作 T* ref。

### 3.4 场景 D — 纯对话（无附件）

与现有一致，零 attachments → 纯 t2i / 纯 plan。

---

## 4. 交互设计

### 4.1 布局

```text
┌ Agent 侧栏 ─────────────────────────┐
│  … 对话气泡 …                        │
├──────────────────────────────────────┤
│  [I1🖼][T1📝]          ← AgentRefStrip │
│  ┌────────────────────────────────┐  │
│  │ 拖入文件或输入指令…  @I1 三视图   │  │  ← drop zone
│  └────────────────────────────────┘  │
│  [+] [📁] [技能▼] [模型▼] [🎤] [发送] │
└──────────────────────────────────────┘
```

### 4.2 添加入口

| 入口 | 交互 | 结果 |
|------|------|------|
| **[+]** | 点击 → 系统文件选择 | `persistMediaUrl` → 追加芯片 |
| **拖拽** | 文件拖入输入区，边框高亮 | 同上 |
| **[📁] 资产库** | 弹层/抽屉，复用 `CanvasAssetPanel` 选取逻辑 | `sourceKind:'asset'` |
| **focusNodeId** | 发送时若选中可解析节点，自动并入 | `sourceKind:'edge'`（虚拟，落画布时转 edge 或 localRef） |

### 4.3 芯片行为（对齐 DockRefChip）

- 编号：按 `mediaType` 递增 `T1/I1/V1/A1`
- 点击：预览（`DockRefPreview` 或轻量 modal）
- 移除：从 `pendingAttachments` 删除，不影响已发送历史
- 排序：拖拽调整 `refOrder`（P1；M1 可按添加顺序）
- stale：无 url/text 不展示、不参与发送

### 4.4 用户消息展示

发送后在 user 气泡下方展示附件条（只读缩略图 + refKey），便于对话上下文追溯。

---

## 5. 数据模型与 API

### 5.1 侧栏会话态

```typescript
/** 侧栏 pending，发送前暂存 */
interface SidebarAttachment {
  id: string                    // uuid，落画布后作 localRef.id
  mediaType: RefMediaType
  sourceKind: 'upload' | 'asset' | 'canvasNode'
  label: string
  url?: string
  text?: string
  /** canvasNode 专用：来源节点 id，落画布时转 edge */
  sourceNodeId?: string
}

/** AgentSideRail 组件 state */
pendingAttachments: SidebarAttachment[]
refOrder: string[]              // attachment id 顺序
```

### 5.2 对话 API 扩展

```typescript
// POST /api/agent/chat/conversation — 增量字段
{
  message: string
  attachments?: SidebarAttachment[]
  refOrder?: string[]
  focusNodeId?: string
  // …existing: sessionId, threadId, userDecision, skillId, model
}
```

**Nest → Runtime：** `agent.service` 转发 `attachments` / `refOrder` 至 LangGraph state（`sidebar_attachments`）。

**校验（Nest 或 Runtime 入口）：**

- 单轮 attachments ≤ 5（可配置）
- 每项必有 `url` 或 `text`
- 拒绝 `blob:` URL
- `mediaType` 与 payload 一致

### 5.3 LangGraph State 增量

```python
# services/agent-runtime/app/graph/state.py（示意）
sidebar_attachments: list[dict]   # 来自本轮 user turn
sidebar_ref_order: list[str]
```

### 5.4 画布落点 — apply_sidebar_attachments

统一 IO 节点（或 nest_client 方法 `apply_sidebar_attachments`）：

```python
async def apply_sidebar_attachments(
    *,
    node_ids: list[str],           # 目标节点
    attachments: list[dict],
    ref_order: list[str],
    mode: Literal["localRefs", "attach_edges"],
) -> None:
    ...
```

| flow_mode | 调用时机 | mode | 说明 |
|-----------|----------|------|------|
| `atomic_create` | `create_atomic_node` 之后 | `localRefs` | 写各节点 `data.localRefs` + `refOrder` |
| `atomic_regenerate` | regen 目标节点 | `localRefs` | 合并或替换（默认合并） |
| `campaign` | `split` + `topo` 之后 | `attach_edges` 优先 | 建 mediaInput 或 attach_refs |
| `single_node` | 生成前 | `localRefs` | 写 focus 或目标节点 |

**localRefs 写入格式：** 与 `CanvasPage.appendLocalRef` 一致：

```typescript
{
  id: attachment.id,
  mediaType: attachment.mediaType,
  sourceKind: 'upload' | 'asset',  // canvasNode 转 upload 或保留 sourceNodeId 建边
  label: attachment.label,
  url?: string,
  text?: string,
}
```

---

## 6. 数据流总览

```text
┌─ 侧栏 ─────────────────────────────────────────────┐
│  upload / asset / focusNode → pendingAttachments    │
│  用户输入 + refOrder                                 │
└───────────────────────┬────────────────────────────┘
                        │ POST conversation
                        ▼
┌─ Agent Runtime ────────────────────────────────────┐
│  intake → flow_mode                                │
│    ├─ atomic_create → create_node → apply_localRefs│
│    ├─ campaign → plan → split → apply_attach_refs  │
│    └─ single_node → apply_localRefs → gen          │
└───────────────────────┬────────────────────────────┘
                        │ canvas actions
                        ▼
┌─ 画布 SoT ─────────────────────────────────────────┐
│  node.data.localRefs / edges / refOrder            │
│  resolveNodeRefs → mergeRefsToPrompt → img2img     │
└────────────────────────────────────────────────────┘
```

**关键：Provider 层零改动。** 缺口仅在前端侧栏 UI + conversation 协议 + runtime apply 步骤。

---

## 7. 组件与文件（实现指引）

### 7.1 前端

| 文件 | 变更 |
|------|------|
| `apps/web/src/components/agent/AgentSideRail.vue` | 引用条、上传、drop、send body |
| `apps/web/src/components/agent/AgentRefStrip.vue` | **新建**；抽离或包装 `DockRefStrip` |
| `apps/web/src/components/agent/AgentAssetPicker.vue` | **新建**；轻量资产库弹层 |
| `apps/web/src/composables/useSidebarAttachments.ts` | **新建**；pending 状态、上传、去重 |
| `apps/web/src/pages/CanvasPage.vue` | 可选：暴露 `appendLocalRef` 给侧栏（focus 同步） |

### 7.2 后端

| 文件 | 变更 |
|------|------|
| `apps/server/src/agent/agent.controller.ts` | 接收 attachments |
| `apps/server/src/agent/agent.service.ts` | 转发 runtime |
| `apps/server/src/agent/agent-canvas-tools.service.ts` | `applySidebarAttachments` nest 方法 |
| `packages/shared/src/agentContract.ts` | `SidebarAttachmentSchema` |

### 7.3 Runtime

| 文件 | 变更 |
|------|------|
| `services/agent-runtime/app/runs.py` | state 注入 attachments |
| `services/agent-runtime/app/graph/nodes/atomic_create_node.py` | 建节点后 apply |
| `services/agent-runtime/app/graph/nodes/split.py` 或新 IO 节点 | Campaign apply |
| `services/agent-runtime/app/tools/nest_client.py` | `apply_sidebar_attachments` |

---

## 8. 约束与边界

| 项 | 规则 |
|----|------|
| 数量上限 | 单轮 ≤ 5 attachments |
| 类型 | M1：image + text 为主；video/audio 可上传展示，生成不消费 |
| blob | 前后端拒绝 |
| 去重 | 同 url 或同 sourceNodeId 合并为一个 ref |
| 发送后 | 清空 `pendingAttachments`（历史在 user 气泡只读展示） |
| readOnly 画布 | 禁止上传，提示切换账号 |
| 并发 | attachments 绑定 idempotency-key 对应 turn，防重复 apply |

---

## 9. 侧栏文案（增量）

遵循 [agent-sidebar-copy-design](./2026-08-06-agent-sidebar-copy-design.md)：

| 阶段 | 文案示例 |
|------|----------|
| 带附件 parse 成功 | `好的，我会参考你提供的 @I1，生成产品三视图。` |
| 附件缺失 url | `参考图上传未完成，请重新添加后再试。` |
| Campaign 已连 ref | （可选 info）`已将参考素材连入主图节点。` |

禁止暴露 `localRefs`、`attach_refs`、`sidebar_attachments` 等内部术语。

---

## 10. 分期交付

| 阶段 | 范围 | 验收 |
|------|------|------|
| **M1** | 侧栏 UI + upload + API + atomic localRefs + img2img | 上传产品图 → atomic 三视图出图 |
| **M2** | 资产库选取 + focusNodeId 升格 + Campaign attach_refs | 上传品牌图 → Campaign 主图连 ref |
| **M3** | @ 提及、拖拽画布节点、粘贴板、V/A 消费 | 与 Dock 体验完全对齐 |

---

## 11. 测试要点

1. **atomic img2img**：upload I1 → 「按 @I1 生成」→ 节点 localRefs 含 I1 → generation 请求带 referenceImages。
2. **Campaign**：upload I1 → plan/split → 主图节点有入边或 localRef。
3. **focusNodeId**：选中 image A → 新节点 ref 含 A.url。
4. **blob 拒绝**：拖入未持久化 blob → 前端拦截或后端 400。
5. **去重**：focus + 同图 upload → 仅一个 I1。
6. **readOnly**：无 token 画布禁止上传。
7. **纯 t2i 回归**：无 attachments 时行为与现网一致。

---

## 12. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Campaign 目标节点不确定 | split 后按 title/role 匹配「主图」；fallback localRefs |
| 附件与 parse 冲突 | parse 不解析附件内容，仅消费 refKey；attachments 由确定性 IO 写入 |
| 大文件上传慢 | 上传完成前禁用发送；芯片显示 uploading 态 |
| 与 Dock 双写 | 侧栏只写 pending；落画布仅在 runtime apply 一次 |

---

## 13. 已确认决策（2026-08-07）

1. Campaign 侧栏附件默认 **attach_edges**（拓扑可见；无明确目标时 fallback localRefs）
2. 多 batch atomic **全员共享**同一组 attachments（M1 不做 per-item 差异）
3. user 气泡附件条 **永久保留**（只读展示，便于对话追溯）

---

## 附录 A：与现有类型对照

| 概念 | 现有 | 侧栏 |
|------|------|------|
| 本地绑定 | `LocalRefBinding` | `SidebarAttachment` → 落画布后同型 |
| 芯片 key | `resolveNodeRefs` 产出 | 发送前前端预分配展示用；落画布后服务端 resolve |
| 上传 | `useMediaUpload.persistMediaUrl` | 复用 |
| 生成 | `toStudioRefs` | 不变 |
