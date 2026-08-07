# Agent 侧栏 M3 — 显式引用、@ 语义与芯片交互

> 状态：**已确认**（2026-08-07）  
> 范围：在 M1/M2 侧栏素材引用基础上，修正「选中即 silent ref」误操作风险；贯通 `@` 优先语义；芯片 hover 预览 + 点击插入 `@`  
> 前置：[2026-08-07-agent-sidebar-material-entry-design.md](./2026-08-07-agent-sidebar-material-entry-design.md)、[2026-07-18-node-data-flow-refs-design.md](./2026-07-18-node-data-flow-refs-design.md)  
> 非范围：V\*/A\* 生成侧消费（仍 P1）、芯片拖拽排序（P1）、粘贴板截图（P1）

---

## 0. 决策摘要（相对 M2 的变更）

| # | 决策 | 说明 |
|---|------|------|
| **D-A** | **画布节点默认不 silent 进芯片** | 取消 `sendMessage` 时 `mergeFocusNodeRef`；须显式「加入 Agent 引用」 |
| **D-B** | **`focusNodeId` 与 img2img ref 解耦** | `focusNodeId` 仅作指代/续作上下文；img2img 必须先进芯片条 |
| **D-C** | **芯片条 = 全量 ref 池；`@` = 优先/分工说明** | 芯片内 ref 默认全部参与生成；`@I1/@T1` 产生 `mentionedKeys`，非开关 |
| **D-D** | **多选仅支持批量显式加入** | 右键/工具栏/拖拽；不支持选中态隐式合并 |
| **D-E** | **芯片：hover 预览，click 插入 `@`** | 与 Dock 芯片（click 开 modal 预览）区分；侧栏以「写指令」为主 |
| **D-F** | **侧栏输入接 `MentionInput`** | `@` 补全来自当前 pending 芯片；高亮与 Dock 一致 |

**废止 M2 决策 D5：**「focusNodeId 可升格为 ref（发送时自动并入）」→ 由 D-A/D-B 替代。

---

## 1. 问题与目标

### 1.1 问题

| 问题 | 现状 | 风险 |
|------|------|------|
| 选中即引用 | `mergeFocusNodeRef` 在发送瞬间合并 | 误把「正在查看的节点」当 ref |
| `@` 无补全 | 侧栏 plain textarea | 用户手打 `@I1`，易错 |
| `@` 未贯通生成 | 仅 sidebar copy ack 提 @ | 多图分工语义进不了 merge prompt |
| 芯片交互不足 | 复用 DockRefChip（click→全屏预览） | 侧栏更需要快速插入 `@` + 轻量预览 |

### 1.2 目标

1. 画布节点进芯片：**可见、可删、可核对**后再发送。
2. 芯片 **hover** 展示内容预览（图/文/视/音）；**click** 在输入框光标处插入 `@I1`（带尾随空格）。
3. 侧栏 **MentionInput**：`@` 触发补全列表（选项 = 当前芯片 refKey）。
4. 发送时 `parseRefMentions(message)` → **`mentionedKeys`** 经 API 进 runtime，写入目标节点并在 `startImageGeneration` 消费。
5. **无 `@` 时**：芯片内 attachments 仍全量 localRefs / attach_edges，与 Dock 一致。

---

## 2. 交互设计

### 2.1 显式加入引用

| 入口 | 交互 | 结果 |
|------|------|------|
| **节点右键** | 「加入 Agent 引用」 | 单节点 → 芯片条 +1 |
| **多选 + 右键/工具栏** | 「批量加入 Agent 引用」 | 按 ref 上限（5）依次加入，超限 toast |
| **拖拽节点 → 侧栏输入区** | ~~M3 不做~~ | 画布节点不易拖拽；改用右键/多选 |
| **focusNodeId** | 发送时仅传 id | **不**自动进 attachments |

去重规则不变：同 `sourceNodeId` / 同 `url` 不重复。

### 2.2 芯片条行为（Agent 侧栏专用）

```text
┌ Agent 输入 dock ──────────────────────┐
│ [I1🖼][T1📝]  ← hover: 浮层预览       │
│               click: 输入框插入 @I1    │
│ ┌──────────────────────────────────┐ │
│ │ MentionInput（@ 补全 + 高亮）      │ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

| 动作 | 行为 |
|------|------|
| **Hover（≥200ms）** | 芯片旁浮层：缩略图 / 文本摘要 / 视音控件（复用预览内容组件） |
| **Click** | 向输入框插入 `@I1`（或 `@T1`…）；焦点回输入框；不打开全屏 modal |
| **Hover + Remove** | 仍显示移除按钮（与 Dock 一致） |
| **只读气泡内芯片** | 仅 hover 预览；click 可选插入到**新一条**输入（M3 不做，只读无 click） |

与 Dock `DockRefChip`：**不修改 Dock 行为**；侧栏使用新组件 `AgentSidebarRefChip.vue`。

### 2.3 `@` 语义（与画布 refs 对齐）

```text
芯片条 attachments     →  本回合 ref 池（默认全量参与 img2img / merge）
message 内 @I1/@T1     →  mentionedKeys（优先融合 / 分工说明）
无 @                   →  mentionedKeys = []；refs 仍全量使用
```

示例：

```text
芯片：[I1 风格][I2 产品][T1 文案]
输入：「@I1 作风格，@I2 作主产品，按 @T1 生成主图」
生成：referenceImages = [I1, I2]；merge prompt 强调 I1/I2/T1 角色
```

---

## 3. 画布节点 → SidebarAttachment 映射

`nodeToSidebarAttachment(node)` 规则：

| 节点 type | mediaType | 取值 |
|-----------|-----------|------|
| `text`, `prompt` | `text` | `content` / `prompt` |
| `image`, `mediaInput` | `image` | `url` |
| `video` | `video` | `url` |
| `audio` | `audio` | `url` |
| 其他 / 无 url 且无 text | — | 拒绝并 toast「该节点暂不可作为引用」 |

`sourceKind: 'canvasNode'`，`sourceNodeId: node.id`，`label: title ?? type`。

---

## 4. API 与数据流

### 4.1 Conversation 请求增量

```typescript
// AgentConversationRequest 增量
mentionedKeys?: string[]   // 前端 parseRefMentions(message)，去重保序
```

校验：每项须匹配 `/^[TIVA]\d+$/` 且对应 refKey 存在于本轮 attachments 映射（可选 warn 不阻断）。

### 4.2 Runtime state

```python
sidebar_mentioned_keys: list[str] | None
```

### 4.3 生成落点

atomic 路径：

1. `create_atomic_node` / `apply_sidebar_attachments` 写 `localRefs`（不变）。
2. 同一 turn 将 `sidebar_mentioned_keys` 写入新建 image/video/text 节点的 `data.mentionedKeys`（与 Dock 单次生成等价）。
3. `startImageGeneration` / `runVideoGeneration` 读取 `node.data.mentionedKeys` 传入 `studio.generateImage(..., mentionedKeys)`。

Campaign 路径：split 后 attach 不变；seed 节点 gen 时同样读 `mentionedKeys`。

---

## 5. 组件与文件

| 文件 | 变更 |
|------|------|
| `apps/web/src/components/agent/AgentSidebarRefChip.vue` | **新建** — hover 预览 + click mention |
| `apps/web/src/components/agent/AgentRefHoverPreview.vue` | **新建** — 无 backdrop 浮层 |
| `apps/web/src/components/agent/AgentRefStrip.vue` | 换用 AgentSidebarRefChip；emit `mention` |
| `apps/web/src/components/agent/AgentSideRail.vue` | MentionInput；去掉 send 时 mergeFocusNodeRef |
| `apps/web/src/composables/useSidebarAttachments.ts` | `nodeToSidebarAttachment`；`addFromCanvasNode(s)` |
| `apps/web/src/components/canvas/CanvasContextMenu.vue` | 「加入 Agent 引用」 |
| `apps/web/src/pages/CanvasPage.vue` | 多选批量、DnD 到侧栏、调 SideRail expose |
| `packages/shared/src/agentContract.ts` | `mentionedKeys` |
| `services/agent-runtime/...` | state + 写 node.data.mentionedKeys |
| `apps/server/.../agent-canvas-tools.service.ts` | startImageGeneration 读 mentionedKeys |

---

## 6. 分期（M3 内部）

| 子阶段 | 范围 | 可独立验收 |
|--------|------|------------|
| **M3a** | 去 silent merge + 显式加入 + 节点类型修正 | 右键加入 → 芯片可见 → atomic img2img |
| **M3b** | 芯片 hover/click + MentionInput | hover 看图；click 插入 @；@ 补全 |
| **M3c** | mentionedKeys API + 生成贯通 | @ 分工进入 merge prompt（测 log/skippedMerge） |

---

## 7. 测试要点

1. 选中 image 节点仅发「生成白底版」→ **无** localRefs（未显式加入时）。
2. 右键「加入 Agent 引用」→ 芯片 I1 → atomic → localRefs 含 url。
3. 多选 3 节点批量加入 → 芯片 3 个；第 6 个 toast 超限。
4. 芯片 hover 200ms 出现预览；click 输入框出现 `@I1 `。
5. 输入 `@I` 弹出补全 I1/I2；Enter 选中插入。
6. 「@I1 风格 @I2 产品」→ API `mentionedKeys: ['I1','I2']` → 生成 merge 含优先参考。
7. 芯片有 I1、消息无 @ → img2img 仍带 I1；mentionedKeys 为空。
8. video 节点加入 → 芯片 V1（非误标 I1）。

---

## 8. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 用户习惯「选中即 ref」 | 首版无自动升格；后续可在设置加「选中自动加入」默认关 |
| hover 与 click 冲突 | hover 延迟 200ms；click 不触发 preview modal |
| mentionedKeys 与 refKey 漂移 | refKey 由 attachments 顺序确定性分配；parse 只认合法 TIVA 模式 |

---

## 9. 已确认（2026-08-07）

1. 废止 M2 D5 silent focus merge。  
2. 侧栏芯片 click = 插入 `@`，hover = 预览（D-E）。  
3. `@` 不 gate refs；仅 `mentionedKeys` 优先语义（D-C）。
