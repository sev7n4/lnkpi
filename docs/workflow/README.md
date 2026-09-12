# lnkpi.workflow — Agent 工作流交换契约

外部 Agent（WorkBuddy、Codex 等）可用本 schema 生成可导入 lnkpi 画布的 JSON。规格与画布 UI / Agent `export_pack` 导出路径一致。

## 快速开始

- **黄金示例：** [`examples/minimal-workflow.json`](./examples/minimal-workflow.json)（2 节点 + 1 边，轻量模式）
- **校验函数：** `@lnkpi/shared` 的 `validateWorkflow`
- **导入：** 画布「导入工作流」，选择 `.json` 或含 `workflow.json` 的 `.zip`

## 顶层字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `format` | `"lnkpi.workflow"` | 是 | 固定标识 |
| `version` | `"1.0.0"` | 是 | 当前 schema 版本 |
| `exportedAt` | ISO 8601 string | 是 | 导出时间 |
| `sourceSessionId` | string | 否 | 来源会话 ID |
| `mode` | `"full"` \| `"subgraph"` | 是 | 整布或选中子图 |
| `exportMode` | `"full_package"` \| `"lightweight"` | 是 | 完整 zip 包或仅 JSON |
| `graph` | object | 是 | 见下文 |
| `mediaIndex` | array | 是 | 媒体索引（可为空数组） |

## `graph.nodes[]`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 节点 ID（导入时会重映射） |
| `type` | string | 节点类型：`prompt`、`image`、`video`、`text`、`group`、`shot`、`sceneComposer` |
| `position` | `{ x, y }` | 画布坐标 |
| `parentId` | string? | 分组父节点 |
| `parentNode` | string? | 与 `parentId` 对齐时使用 |
| `data` | object | 业务字段原样保留：`title`、`prompt`/`content`、`status`、`localRefs`、`mentionedKeys`、`url` 等 |
| `mediaRole` | `"generated"` \| `"uploaded"` \| `"none"` | 媒体来源标记 |

`mediaRole` 推断规则（导出时自动写入，Agent 生成时应显式设置）：

- `"uploaded"` — `data.imageVersions` 中存在 `source: "upload"`
- `"generated"` — 存在非空 `generationRecordId`
- `"none"` — 其他

## `graph.edges[]`

| 字段 | 说明 |
|------|------|
| `id` | 边 ID |
| `source` | 源节点 `id` |
| `target` | 目标节点 `id` |

## `mediaIndex[]`

| 字段 | 说明 |
|------|------|
| `nodeId` | 关联节点 |
| `kind` | `image`、`video`、`audio` 等 |
| `fileName` | 稳定文件名 |
| `path` | 包内相对路径，如 `media/hero.png`（`full_package`） |
| `url` | 远程 URL（`lightweight` 或回退） |
| `persistedUrl` | 持久化 URL（可选） |
| `error` | 拉取失败时的错误信息（可选） |

## 如何生成可导入 JSON

1. 设置 `format: "lnkpi.workflow"` 与 `version: "1.0.0"`。
2. 构建 `graph.nodes` 与 `graph.edges`；边 `source`/`target` 必须引用已有节点 `id`。
3. 在 `data` 中保留 prompt、refs 等字段；节点间引用使用 `localRefs[].nodeId` 与 `mentionedKeys`（与画布原生语法一致，勿发明新语法）。
4. 为每个节点设置正确的 `mediaRole`。
5. 填充 `mediaIndex`：`lightweight` 用 `url`；`full_package` 用 `path` 并在 zip 内附带 `media/` 文件。
6. 生成后调用 `validateWorkflow` 校验，再交付用户或写入 zip。

Agent 最小拓扑示例见 [`examples/minimal-workflow.json`](./examples/minimal-workflow.json)：`prompt` → `image`，含 `mediaIndex` URL。

## 导入步骤（画布）

1. 打开目标画布会话。
2. 使用「导入工作流」，选择 `.json` 或 `.zip`（zip 内需含根目录 `workflow.json`）。
3. 应用校验 `format`/`version`，解析 graph 与媒体。
4. 自动 `remapWorkflowIds` 后合并进当前画布（不覆盖已有节点 ID）。

## Agent `import_workflow`

画布会话内的 Agent 可将同一份 `lnkpi.workflow` schema 合并进**当前**画布（`validateWorkflow` → `remapWorkflowIds` → 落点）。入参二选一：

| 参数 | 说明 |
|------|------|
| `workflow` | 内联 JSON 对象 |
| `workflow_url` | 指向 JSON 的 HTTPS URL（同时提供时以 `workflow` 为准） |

调用 `POST /agent/internal/import-workflow`；zip / base64 大包仍只走画布 UI，本 tool 不接受。非法 `format`/`version` 拒绝写库。

## 校验代码片段

```typescript
import { readFileSync } from 'node:fs'
import { validateWorkflow, WORKFLOW_FORMAT, WORKFLOW_VERSION } from '@lnkpi/shared'

const raw = JSON.parse(readFileSync('minimal-workflow.json', 'utf-8'))
const doc = validateWorkflow(raw)

console.log(doc.format === WORKFLOW_FORMAT) // true
console.log(doc.version === WORKFLOW_VERSION) // true
console.log(doc.graph.nodes.length) // 2
```

校验失败时 Zod 抛出可读错误；导入路径同样拒绝非法包。

## 包格式

| `exportMode` | 交付物 |
|--------------|--------|
| `full_package` | `lnkpi-workflow-<timestamp>.zip`，含 `workflow.json` + `media/` |
| `lightweight` | 单个 `lnkpi-workflow-<timestamp>.json` |

## 参考

- 设计规格：`docs/superpowers/specs/2026-09-12-canvas-workflow-exchange-design.md`
- Schema 源码：`packages/shared/src/canvas/workflowExchange.ts`
