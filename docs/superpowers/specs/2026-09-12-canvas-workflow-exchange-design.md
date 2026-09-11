# 画布工作流交换（导出 / 导入）设计

> 日期：2026-09-12  
> 状态：已批准（对话确认 §1–§3）  
> 产品：超创平台（lnkpi）无限画布  
> 方案：**浏览器侧组包**（JSZip / 流式 zip）；导入合并进当前画布  
> 相关：Wave A A2 导出打包、A2.1 真 zip、A3 媒体持久化  

## 1. 背景与目标

当前「导出打包」产出的 JSON 仅为**媒体清单**（nodeId / url / fileName），不含拓扑、连线、提示词、芯片 refs，也无法再导入画布。

用户需要：

1. **W1 往返交换：** 导出可二次编辑的工作流包（图结构 + 媒体）；导入合并进当前画布。  
2. **W2 Agent 学习契约：** 同一 schema 供 WorkBuddy / Codex 等学习后生成可导入 JSON，还原拓扑。

**北极星：** 导出 →（可选外部 Agent 改写）→ 导入后，拓扑与提示词可用，媒体可预览/再生成。

## 2. 已确认决策

| 项 | 选择 |
|----|------|
| 规格范围 | **D**：W1+W2 同规格描述；实现顺序 **W1 → W2** |
| 导入落点 | **B**：合并进**当前**画布；ID 冲突则整图重映射 |
| 媒体 | **B 默认**：JSON + `media/` 同包；**轻量可选**：仅 JSON + URL |
| 导出范围 | **C**：默认整布；有多选则导出选中子图（含其间边） |
| 与现有导出 | **A**：升级现有「导出打包」为工作流包；旧「仅媒体清单」降为高级选项 |
| 组包位置 | 浏览器侧（方案 1）；不在 CVM 落大临时 zip |

## 3. 包格式

### 3.1 默认：`full_package`

```text
lnkpi-workflow-<timestamp>.zip
├── workflow.json
├── media/
│   └── <stableFileName>
└── README.md                 # W1 可占位；W2 写完整 Agent 指引
```

### 3.2 轻量：`lightweight`

仅下载 `lnkpi-workflow-<timestamp>.json`（内容即 `workflow.json`），媒体以 URL 字段保留。

## 4. `workflow.json` Schema（`lnkpi.workflow` v1）

### 4.1 顶层

| 字段 | 类型 | 说明 |
|------|------|------|
| `format` | `"lnkpi.workflow"` | 固定 |
| `version` | `"1.0.0"` | semver |
| `exportedAt` | ISO string | |
| `sourceSessionId` | string? | |
| `mode` | `"full"` \| `"subgraph"` | 整布 / 选中子图 |
| `exportMode` | `"full_package"` \| `"lightweight"` | |
| `graph` | object | `nodes`, `edges` |
| `mediaIndex` | array | 媒体索引 |

### 4.2 `graph.nodes[]`

| 字段 | 说明 |
|------|------|
| `id`, `type`, `position` | 与 `CanvasNode` 对齐 |
| `parentId?` | 分组 |
| `data` | 原样保留业务字段：`title`, `prompt`/`content`, `status`, `localRefs`, `mentionedKeys`, `url`, 版本信息等（**不新造第二套 refs 语法**） |
| `mediaRole` | `"generated"` \| `"uploaded"` \| `"none"`（由 url / `imageVersions.source` / 上传标记推断） |

### 4.3 `graph.edges[]`

`id`, `source`, `target`（与现有 `CanvasEdge` 对齐）。

### 4.4 `mediaIndex[]`

| 字段 | 说明 |
|------|------|
| `nodeId` | |
| `kind` | `image` \| `video` \| `audio` \| … |
| `fileName` | |
| `path?` | 包内相对路径，如 `media/xxx.png`（full_package） |
| `url?` | 导出时 upstream / 本站 URL（lightweight 或回退） |
| `persistedUrl?` | 若 A3 已 persist（可选增强） |
| `error?` | 拉取失败时记录 |

校验：Zod，置于 `packages/shared`；导出前与导入前各校验一次。

## 5. 数据流

### 5.1 导出

```text
UI「导出打包」或 Agent export（canvasCommands.export_pack）
  → scope = multiSelect ? subgraph : full
  → exportMode = full_package | lightweight（高级）
  → 序列化 graph + mediaRole + mediaIndex
  → full_package: stream-download 拉媒体 → JSZip → .zip
  → lightweight: 仅 workflow.json
  → 本机下载
```

部分媒体失败：仍出包；`mediaIndex[].error` + toast「成功 x / 失败 y」。

### 5.2 导入

```text
选择 .zip 或 workflow.json
  → 校验 format/version
  → 解析 graph + media/
  → remapWorkflowIds（节点、边、data 内 node 引用）
  → 媒体优先包内文件 → 上传/挂到节点 url
  → 合并进当前 Session.canvasData 并 persist
```

冲突策略：**始终重映射 ID**，不覆盖当前画布同名节点。

## 6. 入口与人机同路径

| 入口 | 行为 |
|------|------|
| 完成态「导出打包」/ 画布菜单 | 默认工作流包 |
| 高级选项 | 仅媒体清单（A2 旧行为）；轻量 workflow JSON |
| 画布「导入工作流」 | 新 UI |
| Agent | 导出：扩展现有 `export_pack`（可带 `mode`/`scope`/`exportMode`）；导入：W1 可后置 `import_workflow` tool，须走同一解析/remap 服务 |

## 7. 与 Wave A 关系

| 能力 | 关系 |
|------|------|
| A2 媒体清单 | 降为高级选项 |
| A2.1 真 zip | **并入 W1 默认包**，不再空转单独战役 |
| A3 COS | 可选：有 persist 则写入 `persistedUrl`；未配置不挡导出 |

## 8. 非目标

- 跨账号模板市场 / 公开工作流商店  
- 自动角色 LoRA / 一致性训练  
- worldModel / 3D  
- 默认生成即全量 rehost  
- 服务端 CVM 落大临时 zip  

## 9. 验收

### 9.1 W1

1. 默认导出 zip：含 `workflow.json`；有媒体时含 `media/` 文件。  
2. 轻量模式仅 JSON，含拓扑与 prompt/refs。  
3. 多选→子图；无选中→整布。  
4. 导入 zip/json → 合并当前画布；新 ID；边与 refs 不断。  
5. 导入后节点可继续编辑/再生成。  
6. Agent 导出触发本机工作流包下载。  
7. 「仅媒体清单」高级入口仍可用。

### 9.2 W2

1. 文档：schema + 示例 +「如何生成可导入 JSON」。  
2. 共享 `validateWorkflow`；非法包拒绝导入。  
3. 至少一个「示例 JSON → 导入成功」黄金用例。

## 10. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 大包浏览器 OOM | 单文件上限对齐 stream-download；超限跳过并记 error |
| refs 重映射漏改 | 集中 `remapWorkflowIds`；单测覆盖 localRefs / edges |
| 旧清单习惯 | 高级保留；默认文案改为「导出工作流」 |
| 外部 Agent 乱生成 | W2 强校验；导入失败可读 |

## 11. 实现切片（plan 拆 Task）

1. Shared Zod schema + `remapWorkflowIds` 纯函数 + 单测  
2. 前端导出：JSZip 升级现有导出入口（默认包 + 轻量 + 高级清单）  
3. 前端导入：文件选择 → 校验 → 合并 persist  
4. Agent/Nest：`export_pack` 参数扩展；可选 `import_workflow`  
5. W2：README/docs + validate + 金样  

## 12. 文档

- 本文件：设计规格  
- 实现计划：`docs/superpowers/plans/2026-09-12-canvas-workflow-exchange.md`（规格审阅通过后 writing-plans）  
- Wave A 纲领：可增补「工作流交换」为交付增强（不回退 A2 媒体导出可用性）
