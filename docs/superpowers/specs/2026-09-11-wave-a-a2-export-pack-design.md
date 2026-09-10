# Wave A · A2 导出打包设计

> 日期：2026-09-11  
> 状态：已批准（对话确认 §1–§3）  
> 上级纲领：[2026-09-10-wave-a-delivery-program-design.md](./2026-09-10-wave-a-delivery-program-design.md)  
> 前置依赖：[2026-09-10-wave-a-a3-media-persist-design.md](./2026-09-10-wave-a-a3-media-persist-design.md)（已合入；导出**不**要求 COS 已配置）  
> 方案：**C** — MVP 启用芯片 + manifest / 多文件 stream-download；真 zip 标为 **A2.1**

## 1. 背景与目标

Wave A 北极星是**成片导出成功率**。A3 已提供流式下载与可选 COS 持久化；A2 要让用户在交付完成态能真正「导出打包」，而不是灰掉的「（二期）」按钮。

仓内现状：

| 能力 | 状态 |
|------|------|
| Nest `exportMediaPackage` | **已有**：按 nodeIds 返回 manifest + 各条目 `downloadPath`（指向 `/api/media/stream-download`），**不是**真 zip |
| 前端 `downloadMediaPackage`（`useCanvasMedia.ts`） | **已有**：写 `lnkpi-export-*.json` + 逐个 `downloadMediaFile`（stream-download） |
| 画布菜单「打包下载」 | **已有**：`CanvasPage.handlePackageDownload` → `downloadMediaPackage` |
| 交付完成态二次操作 | **禁用**：`delivery.py` `secondary_actions` 含 `disabled: True`；copy `export_label: "导出打包（二期）"` |
| Web 对 `__export_pack__` | **未接**：仅 `__focus_all_canvas__` 在 `AgentPresentationHost` 拦截；导出 message 若发出会进对话 |

**A2 目标（MVP）：** 完成态「导出打包」可点；人与 Agent 走同一套「清单 + 多文件鉴权下载」路径；COS 未配置不得阻塞导出。

**A2.1（本规格预留，本 PR 不做）：** 服务端或浏览器流式真 zip；部分失败写入 `errors[]`；不落 CVM 大临时文件。

## 2. 范围

### 2.1 做（MVP）

1. **Copy：** `services/agent-runtime/skills/ecommerce-product-visual/assets/copy/1.0.0.yaml`  
   - `done.export_label`：去掉「（二期）」，定为「导出打包」。
2. **Runtime：** `delivery.py` `build_done_presentation`  
   - 去掉 export secondary action 的 `disabled: True`（可省略 `disabled` 字段，或显式 `false`）。
3. **Web 拦截：** `AgentPresentationHost`  
   - 识别 `__export_pack__`（与 `__focus_all_canvas__` 同模式）；  
   - 从当前 presentation body 收集交付相关 `node_id`（finalized + 可选 basics 中有 id 的项）；  
   - `emit('exportPack', nodeIds)`，**不** `emit('primaryAction', message)`，避免写入用户对话。
4. **接线：** `AgentSideRail` → `CanvasPage`  
   - 监听 `exportPack`；调用已有 `downloadMediaPackage(nodes, nodeIds, { sessionId })`。  
   - 空 `nodeIds` / 无可下载媒体：toast 提示，不抛未处理异常。
5. **后端 / Agent tool：** 保持现有 `exportMediaPackage` 契约（manifest + stream-download paths）。若文案或空选择行为有缺口则补齐；**不**改成真 zip。
6. **单测：** copy 文案、delivery presentation 无 disabled、Host 拦截 `__export_pack__` 不发 chat。

### 2.2 不做

- 真 zip / 单文件归档（→ **A2.1**）  
- 导出前强制 COS persist（A3 收藏路径独立；未配 COS 时导出仍须可用）  
- 完整 NLE 时间线导出、跨 session 批量归档  
- worldModel / OpenClaw 双入口 / 默认生成即 rehost（纲领非目标）  
- 改写 Media 模块或重做 stream-download

### 2.3 人机同路径原则

```text
用户点「导出打包」
  → Host 拦截 __export_pack__
  → downloadMediaPackage(交付 nodeIds)
  → 本机：manifest JSON + 各文件经 GET /api/media/stream-download

Agent tool export_media_package
  → Nest exportMediaPackage
  → 返回同一类 downloadPath（客户端/运行时自行拉取）
```

人侧不强制先调 Nest export API；前端已有收集节点 URL 的逻辑即可。Agent 侧继续用 Nest 返回的路径。两者最终都经 **stream-download**，与 A3 解耦。

## 3. 交互与数据流

### 3.1 UI

- 完成态 secondary：「导出打包」，可点。  
- 点击后按钮进入短暂 busy / 防抖，避免连点重复下。  
- 成功：本机出现 `lnkpi-export-*.json` 与至少一个媒体文件（有定稿媒体时）。  
- 部分失败：**MVP 沿用**现有逐项 try/continue（单文件失败不中断）；不强制「成功 x / 失败 y」汇总（可作为同 PR 小增强，非门禁）。  
- 无媒体：友好 toast，不崩溃。

### 3.2 nodeId 来源

从当前 `delivery_summary_table` presentation：

- `body.finalized[].node_id`（定稿镜头，优先）  
- `body.basics[].node_id`（可选基础图；有 id 则一并导出，与「导出本交付相关媒体」一致）

去重、过滤空字符串。若 Host 拿不到 id，仍 emit 空数组并由 Canvas 层 toast。

### 3.3 COS / A3 关系

| 场景 | 行为 |
|------|------|
| COS 未配置 | 导出照常；stream-download 代理 upstream 或本站 uploads |
| 用户已 persist 收藏 | 节点若已换成 persisted URL，导出更稳；**不**作为导出前置条件 |
| persist-remote 503 | **不得**阻塞导出按钮或下载路径 |

## 4. 验收

### 4.1 MVP

1. 交付完成态按钮文案为「导出打包」，可点击（非 disabled）。  
2. 点击后**不**往对话里发 `__export_pack__` 用户消息；开始下载清单 + 媒体。  
3. 有定稿媒体时：本机出现 `lnkpi-export-*.json` 与至少一个媒体文件（经 stream-download）。  
4. 无媒体 nodeId：toast 提示，不报错崩溃。  
5. Agent `export_media_package` 返回 `downloadPath` 指向 stream-download；空选择 `count: 0`。  
6. 生产未配 COS 时导出仍可用。  
7. 单测覆盖 copy / delivery presentation / Web 拦截。

### 4.2 A2.1（预留）

流式 zip 可下；部分失败写入 `errors[]`；不落 CVM 大临时文件。

## 5. 风险与缓解

| 风险 | 缓解 |
|------|------|
| upstream 部分 403/过期 | 逐个下载 try/continue；汇总或条数提示；A3 收藏可降低失败率但不强制 |
| 二次点击重复下 | 按钮 busy 或短防抖 |
| `__export_pack__` 误入 chat | Host 层拦截，与 focus-all 同模式 |
| 真 zip 范围膨胀 | 严格标 A2.1；MVP PR 描述写 Non-goals |
| 浏览器多文件下载被拦 | 已有 manifest + 逐文件模式；真 zip 留 A2.1 改善 UX |

## 6. 实现切片（写入 plan 时拆 Task）

1. Runtime copy + `disabled` 解除  
2. Web：`AgentPresentationHost` 拦截 export → emit `exportPack(nodeIds)`  
3. `AgentSideRail` / `CanvasPage` 接到 `downloadMediaPackage`  
4. Nest/Agent：空选择与失败文案（若缺口）  
5. 单测 + 生产 smoke（登录 → 完成态或手造节点 → 点导出）

## 7. 文档与里程碑

- 本文件：A2 设计规格。  
- 实现计划：`docs/superpowers/plans/2026-09-11-wave-a-a2-export-pack.md`（规格审阅通过后由 writing-plans 产出）。  
- 纲领 [Wave A delivery program](./2026-09-10-wave-a-delivery-program-design.md)：A2 合入并生产手测通过后勾选 **M-A1** 相关项（流式下载 + 导出打包）。

## 8. 关键决策摘要

| 决策 | 选择 |
|------|------|
| MVP 形态 | 启用芯片 + manifest + 多 stream-download（方案 C） |
| 真 zip | A2.1，不进本 PR |
| 人机路径 | 人：前端 `downloadMediaPackage`；Agent：Nest manifest/`downloadPath`；共用 stream-download |
| COS | 未配置不挡导出 |
| 对话污染 | Host 拦截 `__export_pack__`，不发 chat |
