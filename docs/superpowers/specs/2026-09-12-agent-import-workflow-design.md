# Agent `import_workflow` Tool 设计

> 日期：2026-09-12  
> 状态：已批准（对话确认方案 **A** + 入参 **C** + 媒体 **3** + 落点 shared）  
> 产品：超创平台（lnkpi）无限画布  
> 上级规格：[2026-09-12-canvas-workflow-exchange-design.md](./2026-09-12-canvas-workflow-exchange-design.md) §6 后置项  
> 相关：[2026-09-12-workflow-import-placement-design.md](./2026-09-12-workflow-import-placement-design.md)

## 1. 背景与目标

W1/W2 已交付浏览器导出/导入与 Agent `export_pack`（Nest 回 `canvasCommands`，浏览器打 zip）。规格明确后置：

> Agent 导入：`import_workflow` tool，须走同一解析/remap 服务。

**目标：** Agent 可将 `lnkpi.workflow` JSON（或 JSON URL）合并进当前会话画布：校验 → remap → 落点 → 媒体尽力 persist → Nest 权威写库 → SSE 同步前端。

**非目标（v1）：**

- zip / base64 大包（仍由画布 UI 处理）
- CVM 落盘临时包
- 浏览器视口级 `fitView`（Agent 用 `focus_nodes` + 回合 `loadSession`）
- 模板市场 / 跨账号商店

## 2. 产品规则

1. **入参二选一：** `workflow`（JSON 对象）或 `workflowUrl`（HTTPS JSON）；同时提供时以 `workflow` 为准。  
2. **解析：** `@lnkpi/shared` 的 `validateWorkflow` + `remapWorkflowIds`（与 UI 导入同一套）。  
3. **落点：** `@lnkpi/shared` 的 `computeImportTranslation`（Nest 无 viewport → canvas-bbox / 外推路径）；根节点统一 `(dx,dy)`，子节点相对坐标不变。  
4. **媒体：** `mediaIndex` / `data.url` 能 `persistRemote` 则 rehost，失败保留原 URL 并计入 warning。  
5. **写库：** Nest `persistCanvasData`（对齐 `addNodesBatch` / `duplicateNode`），返回 `actions`；可选 `canvasCommands: [{ type: 'focus_nodes', nodeIds }]`。  
6. **非法包：** 拒绝合并，返回可读错误（Zod / HTTP 4xx）。

## 3. 数据流

```text
Agent tool import_workflow
  → Nest POST /agent/internal/import-workflow
  → resolve JSON (body.workflow | fetch workflowUrl)
  → validateWorkflow
  → remapWorkflowIds(nextNodeId)
  → computeImportTranslation({ importNodes, canvasNodes })  // no viewport
  → for media urls: try persistRemote, else keep + warn
  → merge into Session.canvasData + persistCanvasData
  → return { addedNodeIds, idMap, mediaOk, mediaFail, actions, canvasCommands? }
  → runtime SSE canvas_action (+ focus_nodes)
  → browser apply actions; turn-complete loadSession
```

## 4. 接口

### 4.1 Nest

`POST /agent/internal/import-workflow`

```ts
{
  sessionId: string
  userId: string
  workflow?: unknown        // lnkpi.workflow document
  workflowUrl?: string      // fetch JSON
}
```

Response `data`:

```ts
{
  addedNodeIds: string[]
  idMap: Record<string, string>
  mediaOk: number
  mediaFail: number
  warnings?: string[]
  actions: CanvasAction[]   // or equivalent already used by tool proxy
  canvasCommands?: Array<{ type: 'focus_nodes'; nodeIds: string[] }>
}
```

### 4.2 Agent runtime

- Tool name: `import_workflow`
- Args schema: `workflow: dict | None`, `workflow_url: str | None`（至少一个）
- Nest client method → internal route
- Register as **write** tool（非 export 式纯 canvasCommand）；确保 explore/通用路径能转发 `actions`（与 `add_nodes_batch` 同档）

### 4.3 Shared 迁移

| 现位置 | 目标 |
|--------|------|
| `apps/web/.../workflowImportPlacement.ts` | `packages/shared/src/canvas/workflowImportPlacement.ts` |
| web tests | shared tests + web 改为 import from `@lnkpi/shared`（或 thin re-export） |

`fitImportedViewport` **留在 web**（依赖 DOM / Vue Flow）。

## 5. 验收

1. Nest：合法 minimal JSON → 节点合并进 session；ID 已 remap；边/refs 不断。  
2. 非法 format/version → 不写库，4xx/可读错误。  
3. `workflowUrl` 拉取成功路径与内联等价（可用 mock）。  
4. 已有画布节点时，导入根 bbox 与 canvas 根 bbox 不相交（margin≥64，无 viewport）。  
5. persist 失败时节点仍有可用 `url`，`mediaFail ≥ 1`。  
6. Runtime tool 可调用；前端收到 actions 后画布可见新节点（`focus_nodes` 可选）。  
7. 回归：浏览器 zip/json UI 导入与 placement 单测仍绿。

## 6. 风险

| 风险 | 缓解 |
|------|------|
| `workflowUrl` SSRF | 仅允许 http(s)；超时；可选域名允许列表（YAGNI 可先超时+大小上限） |
| 大 JSON | 请求体/拉取大小上限（对齐现有 Nest 限制） |
| shared 迁移破坏 web | 先迁测试再改 import；web re-export 保路径稳定可选 |
| explore-only 命令漏转发 | 本 tool 主路径靠 Nest `actions`，不依赖 canvasCommands 唯一通道 |

## 7. 修订记录

| 日期 | 变更 |
|------|------|
| 2026-09-12 | 初稿：对话确认 A/C/媒体3/落点 shared 后入库 |
