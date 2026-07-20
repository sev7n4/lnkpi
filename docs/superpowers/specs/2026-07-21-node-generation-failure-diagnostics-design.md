# 节点生成失败诊断（C2 + 按需完整诊断）Design

**Date:** 2026-07-21  
**Status:** Approved for planning (pending user review of this file)  
**Related:** 画布节点生成失败 UX；不影响 Dock/节点默认操作体验

## Goal

让创作者快速理解失败并重试，同时让支持/开发能通过**一键复制**拿到完整排障信息（含脱敏后的 provider 片段），且默认 UI 保持简约。

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Audience | 两者：短结论给人 + 可复制诊断给支持 |
| Visual / interaction | **C2**：卡片短错 + 18px ⓘ + 重试；选中失败节点时 Dock **28px 胶囊** + 复制 |
| Data loading | **方案 2**：短失败响应 + 按需 `GET …/diagnostic` |
| Diagnostic depth | **完整档**：标准字段 + 脱敏 `providerSnippet` |
| Node identity | **A**：`nodeId` + 可选 `nodeLabel`；**不**引入稳定 `nodeCode`（T1 类引用键不作主键） |
| Task identity | `taskKind` + `taskId`（`GenerationRecord.id` 或 `Material.id`） |

## Non-goals (this iteration)

- 稳定人读 `nodeCode`（创建即 T/I/V/A 序号）
- 生成记录页大改版
- 视频异步链路重构
- 管理员全局日志后台
- 在 UI 常驻展示未脱敏或完整 provider 原文

## Current baseline

- 失败时节点写入 `errorMessage`；角标约 40 字截断 + 重试
- `formatGenerationFailureMessage` / `apiErrorMessage` 多为扁平字符串
- Studio：`GenerationRecord`（cuid）→ 节点 `generationRecordId`
- Canvas material：`Material`（cuid）→ 节点 `materialId`
- `@T1` / `@I1` 仅为上游 refs 临时编号，**不能**作排障主键

## UX (C2)

### Default (quiet)

失败节点卡片仅：

1. 一行短结论（`userMessage`，可截断）
2. **18px ⓘ**（无「详情」文案按钮）
3. 重试

### On demand

- 点击 ⓘ → 轻量浮层：可读结论、一句建议（`hint`）、「复制诊断」
- **仅当该失败节点被选中**时，Dock 顶部出现 **28px 胶囊**（短结论 + 复制）；未选中不出现
- 浮层与胶囊共用同一诊断数据源；provider 原文**不**在浮层默认展开，只进入复制文本
- 不引入第二套大红失败条，避免挤占提示词编辑区

### Copy

复制内容为纯文本块，字段稳定、便于粘贴给支持（见 Diagnostic payload）。

## Data model

### Short failure payload (immediate, stored on node)

写入节点（与现有字段对齐处复用）：

```ts
{
  userMessage: string       // → errorMessage
  code: ErrorCode           // → errorCode
  taskKind: 'generation' | 'material'
  taskId: string            // → generationRecordId | materialId（已有则复用）
  model?: string
  occurredAt?: string       // ISO
}
```

**禁止**在短响应中下发 `providerSnippet`。

### ErrorCode (v1)

```ts
type ErrorCode =
  | 'insufficient_points'
  | 'upstream_timeout'
  | 'upstream_error'
  | 'cancelled'
  | 'invalid_input'
  | 'model_unavailable'
  | 'upload_required'
  | 'fallback_pending'
  | 'unknown'
```

未映射错误一律 `unknown`，`userMessage` 仍给可读兜底。

### Diagnostic payload (on-demand)

```ts
{
  userMessage: string
  code: ErrorCode
  taskKind: 'generation' | 'material'
  taskId: string
  nodeId?: string           // 通常由前端拼进复制文本
  nodeLabel?: string
  sessionId?: string
  model?: string | null
  channelId?: string | null
  apiFormat?: string | null
  httpStatus?: number | null
  occurredAt: string
  providerSnippet: string | null  // 已脱敏，截断
  hint?: string
}
```

### Persistence

失败时在 `GenerationRecord.metadata` / `Material.metadata`（JSON）写入至少：

- `errorCode`
- 可供 diagnostic 组装的错误摘要（服务端侧，返回前脱敏）
- `model` 等已有上下文

不新增独立表（本期）。

## API

### Endpoints

- `GET /studio/generations/:id/diagnostic`
- `GET /canvas/materials/:id/diagnostic`

### Auth / errors

- 仅记录所属用户可读
- 记录不存在或不属于当前用户 → 404/403
- 非失败状态：**404**（仅 `failed` / `error` 返回完整 diagnostic）

### Frontend fetch policy

1. 用户点 ⓘ 或「复制」
2. 若该 `taskId` 无内存缓存 → GET diagnostic
3. 缓存于节点/任务级 Map（会话内有效）
4. 拉取失败：浮层仍显示短结论；复制降级为短字段（`userMessage` + `code` + `taskId` + `nodeId`）

## Redaction rules (`providerSnippet`)

1. 剥离 API Key / Bearer / cookie / 私钥形态串  
2. 邮箱、手机号打码  
3. URL query 中 `key` / `token` / `signature` 等敏感参数打码  
4. 长度上限（建议 1–2KB）+ `…(truncated)`  
5. 复制文本中的 snippet 必须已是脱敏结果；客户端不再二次依赖明文

## Component / code touchpoints

**Web**

- `NodeTaskCornerActions`：ⓘ + 浮层
- Dock：选中失败节点时的 28px 胶囊（`DockToolbarShell` 或共享子组件）
- `useNodeGeneration`：短失败写入；`getDiagnostic` / 复制格式化
- `studio-api.ts` / `canvas-api.ts`：diagnostic GET
- 既有 `errorMessage` 展示路径保持兼容

**Server**

- `studio.service` / `material.service`：失败映射 `ErrorCode` + metadata
- 新 diagnostic handlers + 脱敏工具（可放 `packages/shared` 或 server util，便于单测）

## Data flow

```
生成失败
  → 短响应 → 节点 errorMessage / errorCode / taskId
用户点 ⓘ 或复制
  → GET diagnostic(taskId) → 缓存
  → 浮层展示 / 剪贴板
选中失败节点
  → Dock 胶囊（短文案；复制走同一 getDiagnostic）
```

## Copy text format (normative)

纯文本，行式 key: value，例如：

```
lnkpi diagnostic
code: upstream_timeout
userMessage: …
taskKind: generation
taskId: …
nodeId: …
nodeLabel: …
sessionId: …
model: …
channelId: …
apiFormat: …
httpStatus: …
occurredAt: …
hint: …
providerSnippet: |
  …
```

缺省字段可省略行。

## Testing

- 短失败响应不含 `providerSnippet`
- diagnostic 含脱敏片段；样例含 key/token 时输出已打码
- ⓘ 与 Dock 胶囊复制字段一致（同源）
- 未选中失败节点时不出现 Dock 胶囊
- 无权 / 非失败 task 不可读完整 diagnostic
- 积分不足等已有友好文案仍映射到对应 `ErrorCode`

## Open implementation notes (non-blocking)

- `nodeId` / `sessionId` 可由前端在复制时附加；服务端 diagnostic 可不强制存 node 关联
- 异步轮询最终失败与同步抛错两条路径都需写入短字段 + metadata
- `fallback_pending` 是否显示 ⓘ：显示，文案引导确认/取消回退（与现有回退 UX 一致）
