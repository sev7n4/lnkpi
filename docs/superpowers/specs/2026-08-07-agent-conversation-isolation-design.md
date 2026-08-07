# Agent 对话隔离与历史恢复设计

> 状态：**已确认**（2026-08-07）  
> 前置：`2026-08-06-agent-context-engineering-design.md`（Context 分层）  
> 触发：新建画布/对话 UX 混乱、侧栏历史非完整对话、重进画布近期消息丢失  
> 生产复现：`sessionId=cmsg9wz5k00c4ny01jx792a3z`（2026-08-07 验证）

---

## 0. 决策摘要

| 项 | 结论 |
| --- | --- |
| 新建对话 | **隔离聊天历史**（对齐 Cursor New Agent）；**不隔离画布** |
| 新建画布 | 新 Session；Agent 空白 |
| 对话列表命名 | **首条 user 消息摘要（截断）+ 相对时间** |
| 对话列表排序 | 按 **`updatedAt` 降序**（最近活跃在上，同 Cursor） |
| 时间展示 | 刚刚 → N 分钟前 → N 小时前 → N 天前 → 日期（复用 `formatSessionTime`） |
| 消息持久化 | **`AgentMessage.threadId` + `AgentThread` 元数据表** |
| 消息丢失 P0 | 修复 `take:50` 取最早 50 条；消除 Nest/Runtime **双写重复** |
| 画布产出定位 | assistant 气泡下 **画布产出** 列表 + 常驻 `[定位]` / 批量 `[全部定位]` |

---

## 1. 问题陈述

### 1.1 产品预期（已确认）

1. 新建画布 → Agent 侧栏空白  
2. 新建对话 → 新 thread，不带旧聊天上下文（Cursor 模型）  
3. 历史记录 → 完整对话列表（可切换 thread），非「最近指令」  
4. 重进画布 / 打开侧栏 → 滚到最新消息  
5. 生成图片/音视频/文本节点后 → 消息底部可 **定位画布**（单条与批量）  

### 1.2 生产丢失复现（`cmsg9wz5k00c4ny01jx792a3z`）

2026-08-07 对生产 API 拉取：

```
GET /api/agent/chat/user/messages?sessionId=cmsg9wz5k00c4ny01jx792a3z
→ 固定返回 50 条（触顶 limit）
→ user 10 / assistant 40（比例异常）
→ 每条 user 消息成对重复（双写）
→ 时间范围 2026-08-05 16:00 ~ 17:48；之后对话不在 API 结果中
```

**根因 A — 截断 bug（P0）**

```typescript
// apps/server/src/agent/agent.service.ts — 当前
orderBy: { createdAt: 'asc' },
take: 50,
```

取的是 **最早** 50 条，不是 **最新** 50 条。超过 50 条后，**近期对话对前端完全不可见**。

**根因 B — 双写重复（P0）**

| 角色 | Nest `streamConversation` | Runtime `runs.py` |
| --- | --- | --- |
| user | `prisma.agentMessage.create`（L81） | `_save_user_message` → `save_agent_message` |
| assistant | `finalizeTurn` → create | `_save_new_assistant_messages`（finally） |

同一 turn 写入 2 条 user + 2 条 assistant → 50 条 limit **更快触顶**，且 assistant 内容可能不一致（SSE 聚合 vs checkpoint messages）。

**根因 C — 重进画布 thread 断裂（P1，隔离方案一并修）**

- 重进时 `createAgentThreadId(sessionId)` 生成 **新** threadId  
- `loadHistory` 按 sessionId 拉全量（且已被截断）  
- 用户感知：「近期对话丢了」+ 「好像混进旧话题」

**根因 D — 前端（P1）**

- Pinia 全局 store：空 history 时不 `clear()`，可能残留上一画布消息  
- `loadHistory` / `openPanel` 后无 `scrollToBottom()`

---

## 2. 概念模型（Cursor 对齐）

```text
Session（画布）          ← 工作区，持久共享
  ├── canvasData         ← 节点/连线真相源（不随新建对话清空）
  └── AgentThread[]      ← 对话线程（新建对话 = 新 thread）
        ├── threadId     ← {sessionId}:{randomSuffix}
        ├── title        ← 首条 user 消息摘要
        ├── updatedAt    ← 最后一条消息时间（列表排序用）
        └── AgentMessage[]  ← 仅属该 thread 的 user/assistant
```

| 操作 | Session | AgentThread | AgentMessage | canvasData |
| --- | --- | --- | --- | --- |
| 新建画布 | 新建 | — | 空 | 空 |
| 新建对话 | 不变 | 新建 thread | 新 thread 下从空开始 | 不变 |
| 重进画布 | 加载 | 恢复 **上次活跃 thread**（见 §4.3） | 加载该 thread 消息 | 加载 |

**隔离边界**

- **隔离**：聊天消息、LangGraph checkpoint、interrupt 状态  
- **不隔离**：画布节点、侧栏 @ 附件、canvas tools 读画布  

---

## 3. 数据模型

### 3.1 Prisma 变更

```prisma
model AgentThread {
  id        String   @id              // threadId，格式 sessionId:suffix
  sessionId String
  session   Session  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  title     String   @default("新对话")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  messages  AgentMessage[]

  @@index([sessionId, updatedAt(sort: Desc)])
}

model AgentMessage {
  id          String   @id @default(cuid())
  sessionId   String
  threadId    String
  thread      AgentThread @relation(fields: [threadId], references: [id], onDelete: Cascade)
  role        String
  content     String
  toolCalls     String?
  attachments   String?
  /** JSON: LinkedCanvasOutput[] — 本轮 assistant 产出的可定位节点 */
  linkedOutputs String?
  createdAt     DateTime @default(now())

  @@index([threadId, createdAt])
  @@index([sessionId, threadId, createdAt])
}
```

### 3.2 迁移策略

1. 为每条 `AgentMessage` 回填 `threadId = '{sessionId}:legacy'`  
2. 每个 session 创建一条 `AgentThread`：`id=legacy`，`title='早期对话'`  
3. 新消息 **必须** 带 `threadId`；Nest 在首条 user 消息时 upsert `AgentThread` 并写 `title`  

### 3.3 消息写入 — 单一写入源（修双写）

**Nest 为 AgentMessage 唯一写入方：**

| 时机 | 动作 |
| --- | --- |
| `streamConversation` 入口 | create user message（含 `threadId`、`attachments`） |
| `streamConversation` 正常结束 | `finalizeTurn` create assistant |
| SSE 异常断开 | 依赖前端 `reconcileLatestAssistant` 轮询；**可选** Nest 补写 job（二期） |

**Runtime 移除重复持久化：**

- 删除（或 no-op）`_save_user_message`、`_save_new_assistant_messages`  
- `_load_history` 改为 `get_agent_messages(threadId=…)` 仅加载当前 thread  

> W2 crash-safe 已由 Nest 在调用 Runtime **之前** 写入 user 消息满足；Runtime 再写属冗余。

### 3.4 读取 — 修截断

```typescript
// 按 thread 取最新 N 条（默认 100，可配置）
async getMessages(sessionId: string, threadId: string, limit = 100) {
  const rows = await prisma.agentMessage.findMany({
    where: { sessionId, threadId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  return rows.reverse() // 返回 asc 供 UI 渲染
}
```

新增：

```typescript
// 对话列表
async listThreads(sessionId: string) {
  return prisma.agentThread.findMany({
    where: { sessionId },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  })
}
```

---

## 4. API 变更

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/agent/chat/user/messages?sessionId&threadId` | **必填 threadId**；返回该 thread 最新消息 |
| GET | `/agent/chat/threads?sessionId` | 对话列表（`id, title, updatedAt, createdAt`） |
| POST | `/agent/chat/conversation` | body 已有 `threadId`；首条消息时 upsert thread title |

Runtime internal `get-agent-messages` / `save-agent-message`：增加 `threadId` 参数。

---

## 5. 前端 UX

### 5.1 对话列表（替换「最近指令」）

**布局（侧栏历史按钮下拉）：**

```text
┌─ 对话历史 ─────────────────┐
│ ● 帮我生成唐朝宰相三视图    │  ← 当前 thread 高亮
│   2 小时前                 │
│ ○ 蓝牙鼠标分镜提示词        │
│   2 天前                   │
│ ○ 早期对话                 │  ← legacy thread
│   8 月 5 日                │
└────────────────────────────┘
```

**命名规则**

- `title` = 首条 user 消息 `trim()` 后截断 **40 字符**，超出加 `…`  
- 若首条为空（仅附件）→ `带附件的消息`  
- 默认占位：`新对话`（尚未发消息时不出现在列表，或显示为草稿态——**一期：不发消息不创建 AgentThread**）

**时间展示**（第二行，复用 `WorkflowPage.formatSessionTime`）

| 距现在 | 展示 |
| --- | --- |
| < 1 分钟 | 刚刚 |
| < 60 分钟 | N 分钟前 |
| < 24 小时 | N 小时前 |
| < 30 天 | N 天前 |
| 否则 | `toLocaleDateString()` |

**排序**：`updatedAt` **降序**（最近发过消息的对话在最上，与 Cursor 一致）。

### 5.2 新建对话

1. `agentThreadId = createAgentThreadId(sessionId)`  
2. `agent.clear()`  
3. **不** 预创建 DB thread；首条 user 发送时 upsert  
4. Toast：`已新建对话`（去掉 confusing 的 atomic checkpoint 长文案，或缩短）

### 5.3 重进画布

1. `localStorage` 键：`lnkpi:agentThread:{sessionId}` → 上次活跃 threadId  
2. 若无缓存：取 `listThreads` 第一条（`updatedAt` 最新）  
3. 若无 thread：`createAgentThreadId` 新 thread（UI 空）  
4. `loadHistory(sessionId, threadId)` → **无论有无消息都 `agent.clear()` 再灌入**  
5. `scrollToBottom()`  

### 5.4 新建画布

- 新 session → 无 thread 缓存 → 空白 Agent  
- `onMounted`：`agent.clear()` 先于 `loadHistory`  

---

## 6. 修复清单（按优先级）

| ID | 项 | 类型 |
| --- | --- | --- |
| P0-1 | `getMessages` 改为 per-thread **最新** N 条 | Bug |
| P0-2 | 消除 Nest/Runtime 双写 | Bug |
| P0-3 | 迁移 + `threadId` / `AgentThread` | Feature |
| P1-1 | 对话列表 UI + `listThreads` API | Feature |
| P1-2 | 重进画布恢复 last thread + localStorage | Feature |
| P1-3 | `loadHistory` 空结果也 clear；`scrollToBottom` | Bug |
| P1-4 | **画布产出定位** UI（`AgentCanvasOutputs`）+ 节点高亮 | Feature |
| P1-5 | `linkedOutputs` 持久化 + 历史重进可定位 | Feature |
| P2-1 | 生产 `cmsg9wz5k…` legacy 数据去重脚本（可选） | Ops |

---

## 7. 验收标准

1. 画布 `cmsg9wz5k…` 重进后能看到 **8 月 5 日 17:48 之后** 的全部对话（若 DB 中仍存在）  
2. 同一 session 超过 100 条消息时，UI 仍显示 **该 thread 最新** 100 条  
3. 新建对话后发送消息，Runtime **不** 注入其他 thread 的 history  
4. 每条 user turn 在 DB 仅 **1** 条 user + **1** 条 assistant  
5. 对话列表按最近活跃排序；切换 thread 加载完整气泡  
6. 打开侧栏视口在最新消息  
7. 单节点生成完成后，assistant 气泡下常驻 `[定位]`；点击后画布 fitView + 节点 1.2s 高亮  
8. 批量生成（≥2 节点）显示产出列表 + `[全部定位]`；超过 4 项可折叠  
9. 重进画布 / 切换 thread 后，历史 assistant 消息仍可定位（依赖 `linkedOutputs`）  

---

## 10. 画布产出定位 UX（已确认）

### 10.1 原则

| 原则 | 说明 |
| --- | --- |
| **默认可见** | `[ 定位 ]` 始终露出，不藏 hover 里 |
| **首次出现** | 产出刚完成时，定位按钮 **2s 轻微 pulse（一次）** |
| **稳态** | ghost 按钮；hover 加强对比度（`neo-ctl`） |
| **点击反馈** | 画布 `fitView` + 选中节点 + 节点 **1.2s 高亮描边**（主反馈在画布） |
| **首次教育** | `localStorage` `lnkpi:agentLocateHintShown` 记一次 Toast：「点击定位可在画布中找到对应节点」 |
| **禁止** | 仅 hover 才出现；正文 inline 塞多个定位链；永久按钮高亮 |

### 10.2 单节点

```text
── 画布产出 · 1 ──────────────────────
🖼 山海经吞金兽四视图          [ 定位 ]
```

- 标题：节点 `title` / prompt 截断 **20 字**  
- **生成中**：无 `[定位]`，显示「生成中…」  
- **完成 / 失败**：显示 `[定位]`（失败仍可定位重试）

### 10.3 批量（营销拆图、多分镜、多图）

```text
── 画布产出 · 4 ──────────── [ 全部定位 ] ──
✓ 🖼 主图 Banner              [ 定位 ]
✓ 🖼 详情头图                 [ 定位 ]
⏳ 🖼 场景图 2                 生成中…
✗ 📝 方案文案                   [ 定位 ]
```

| 元素 | 行为 |
| --- | --- |
| 逐行 `[定位]` | `focusNode(nodeId)`，同 `AgentTaskProgressCard` |
| `[全部定位]` | `fitView` 包住本轮全部 **可定位** nodeId（padding 0.55） |
| 状态 | ✓ 完成 / ⏳ 进行中 / ✗ 失败；**仅完成 & 失败** 显示定位 |
| 折叠 | **>4 项**：默认展示 3 项 +「展开全部 N 项」 |

### 10.4 与任务进度卡分工

| 场景 | 画布产出条 | `AgentTaskProgressCard` |
| --- | --- | --- |
| 生成中 | 产出条显示状态，无定位 | 保留实时进度 |
| 生成完成 | **常驻定位** | 可收起；产出条承担历史回看 |
| 重进画布 | **靠 `linkedOutputs`** | 不渲染 |

### 10.5 数据结构

```typescript
interface LinkedCanvasOutput {
  nodeId: string
  title: string
  nodeType: 'image' | 'video' | 'audio' | 'text' | 'prompt' | 'shot' | string
  status: 'running' | 'done' | 'failed'
}
```

- 实时 turn：从 `executionTrace` + `taskProgress` + `canvas_action` 聚合  
- 持久化：`AgentMessage.linkedOutputs` JSON（assistant 消息在 `finalizeTurn` 写入）  
- 历史 reload：优先 `linkedOutputs`；fallback 解析 `toolCalls` 内 `add_node`

### 10.6 视觉

- 图标：复用 `CanvasTaskHistoryPanel` 十字准星  
- 按钮：`[ 定位 ]`，`title="在画布中定位"`  
- 批量顶栏：`[ 全部定位 ]`  
- 区块标题：`画布产出 · N`（N = 可定位 + 进行中项总数）

---

## 8. 非范围（一期不做）

- 对话重命名 / 删除 / 搜索  
- 跨 thread 的「引用上一对话」显式 UI  
- SSE 断开时 Nest 服务端自动补写 assistant（仍靠 reconcile + 去重）  
- 产出条内缩略图预览（一期仅图标 + 标题）  

---

## 9. 与 Context Engineering 的关系

隔离后，Runtime `_load_history(threadId)` 自然满足「episodic 默认不注入无关话题」。画布摘要仍通过 canvas tools / `CanvasPacket` 按需注入，不依赖刷旧聊天记录。
