# 图片节点宫格裁剪 P1（后端 slice + Agent）设计

日期：2026-09-15  
状态：Approved  
前置：P0 已合并 — `docs/superpowers/specs/2026-09-15-image-grid-slice-design.md`（§6.1 / `data.gridSlice` 冻结）  
分支建议：自 `main` 开 `feature/image-grid-slice-p1`（勿混入无关 fix 分支）

## 1. 背景与目标

P0 人机已用前端 Canvas 切图 + 落子；Agent 无浏览器 Canvas，且跨域 CDN 图（如 Agnes）常因 CORS 无法在浏览器导出像素。P1 把**像素切图**统一到服务端，人机与 Agent 共用同一契约。

**目标**

- `POST /studio/image/slice`：服务端均分切图并持久化，返回 `urls[]`（行主序）。
- 人机**一律**调该 API；删除前端 canvas 像素切图路径；**保留**工作台几何预览。
- Agent：`grid_slice_image` 只负责切图拿 URL；落子用现有 canvas tools，字段与人机一致。
- 验收：Agent 可无头「整图 → 切 N → 落子（`data.gridSlice`）→ 可接视频」；跨域源图人机不再因 CORS 失败（服务端拉不到则明确错误）。

**非目标**

- 不等分拖线、扣生成积分、专用下载打包。
- tool 内一次切图+落子。
- 人机前端切图兜底 / feature flag。

## 2. 产品决策摘要

| 项 | 决策 |
|----|------|
| 人机路径 | 纯 B：一律 API |
| Agent tool 边界 | A：只返回 `urls[]`，落子走现有 canvas tools |
| 预览 | 保留几何预览（分割线/序号）；不导出像素 |
| 几何 | 抽到 `@lnkpi/shared`，前后端同源 |
| 积分 | 不扣生成分（后处理） |
| 输出格式 | PNG → `/api/uploads/...` |

## 3. API 契约（人机）

**`POST /studio/image/slice`**（用户 JWT，与现有 `/studio/image/*` 一致）

Request:

```ts
{
  sourceUrl: string       // 必填：节点 data.url
  cols: number            // clamp 1..7
  rows: number            // clamp 1..7
  sessionId: string       // 必填：审计/归属
}
```

Response:

```ts
{
  data: {
    urls: string[]        // length = cols*rows，行主序
    cols: number          // clamp 后
    rows: number
    width: number
    height: number
  }
}
```

规则：

- 几何：`clampGridDims` + `equalSliceRects`（末列/末行吸收余数）— 与 P0 相同。
- `max(w,h) ≤ 8192`，否则 400。
- 拉取/解码失败：400/502，不写 uploads。
- 全成功才返回；中途失败不返回部分 `urls`。
- **不**改画布、不写 `data.gridSlice`。

首版不做 `assetId` 双入口。

## 4. 服务端实现

**`ImageSliceService`**（Studio module；无上游 provider、无扣点）

```
validate + clamp(cols,rows)
→ readImageBuffer(sourceUrl)   // 现有：uploads 读盘 / 远端 fetch
→ sharp metadata → 边长校验
→ equalSliceRects(w,h,cols,rows)  // @lnkpi/shared
→ extract 各格 → png buffer（池并发 ≤4）
→ 写入用户 uploads → urls[]
→ return { urls, cols, rows, width, height }
```

- Controller：`StudioController` `@Post('image/slice')`
- 落盘中途失败：整单失败；短时孤儿文件 P1 可不强清
- 客户端 timeout 建议 ≥120s

共享包：将 P0 `clampGridDims` / `equalSliceRects` / `GRID_SLICE_MAX_EDGE` 迁入 `@lnkpi/shared`；web `utils/gridSlice.ts` re-export；server/web 共用余数单测。

## 5. 人机改造

删除：

- `useGridSlice` 内 decode / canvas crop / `persistMediaUrl` 切图路径（含 `sliceImageToFiles`、`defaultLoadSliceImage`、`defaultCropSlice` 等）

保留：

- 工作台几何预览、预设、行列、互斥、落子与 `data.gridSlice` / label / edges / `layoutSliceChildPositions`
- 边长上限**仅服务端**校验；前端不再预解码量尺寸

新编排：

```
clamp → studioApi.imageSlice({ sourceUrl, cols, rows, sessionId })
→ addNode×N + gridSlice metadata + edges + layout + select + toast
```

失败：toast，不落子。`studio-api.ts` 增加 `imageSlice`。

测试：mock API；断言失败不 place；预览组件单测保留。

## 6. Agent

### 6.1 暴露方式（审核订正）

Runtime **只**调用 Nest `/agent/internal/*`（见 `nest_client.py`），**不能**直接调人机 JWT 的 `/studio/image/slice`。

因此：

| 调用方 | 入口 |
|--------|------|
| 人机 web | `POST /studio/image/slice`（JWT） |
| Agent Runtime | `POST /agent/internal/grid-slice-image` → 内部转调 **同一** `ImageSliceService` |

禁止第二套几何或第二套落盘逻辑。模式对齐 `upscaleImage` → `UpscaleService`。

### 6.2 Tool：`grid_slice_image`

- 入参：`sessionId`（必填）、`cols`、`rows`；**`sourceUrl` 与 `nodeId` 至少其一**  
  - 仅 `nodeId`：Nest 从该 session 画布节点读 `data.url`  
  - 仅 `sourceUrl`：直接使用  
  - **两者皆有：以 `sourceUrl` 为准**（调用方显式覆盖）  
  - 皆无或解析不到 url：400
- 出参：与 §3 `data` 同形 `{ urls, cols, rows, width, height }`
- **不写画布**
- 鉴权：与其他 internal canvas tools 相同（service token + body 内 `userId`/`sessionId`）

注册：`definitions.py` + `nest_client.py` + `tool_registry.py`（placement 与同类写画布前置的媒体 tool 一致，建议 `EXPLORE` / `WRITE_LIGHT` 或对照 `upload_media_to_canvas`）；timeout ≥120s。

### 6.3 落子约定（非新 tool）

现有能力组合（`addNodesBatch` 当前不直接带 `url`/`gridSlice`）：

1. `grid_slice_image` → `urls[]`（记下 `sourceNodeId`）
2. `add_nodes_batch`：创建 N 个 `targetType=image` 节点；`title` = `{源 label|title} · 格{i+1}`；**创建时传入 position**（源右侧 cols×rows 网格，gap 对齐人机 `GRID_SLICE_LAYOUT_GAP`/36px 语义）
3. `update_nodes_batch`：对每个子节点 patch（与人机 P0 字段对齐）：  
   `{ url, label: "{源} · 格{i+1}", status: "completed", gridSlice: { sourceNodeId, index: i, cols, rows } }`  
   （`title` 可与 `label` 同文案，避免 Agent 画布只认 title）
4. `connect_nodes`：`sourceNodeId` → 各 child

在 tool description / 相关 skill / 规划提示中写死上述顺序与字段，避免只切不落或自创 metadata。

P1 **不**新增 `place_grid_slice` tool。

### 6.4 验收

- shared 几何 + ImageSliceService 单测
- internal 路由 / tool schema 测试
- 冒烟：可拉取 URL → 9 urls → 9 子节点 `data.gridSlice` 与人机一致
- 人机：预览仍在；一键/裁剪走 API；仓库无前端 canvas 切图像素路径
- 跨域 CDN：人机调 API 成功（服务端可读）或明确「无法读取源图」

## 7. 与 P0 / 模块关系

| 模块 | 关系 |
|------|------|
| P0 §6.1 / `data.gridSlice` | 契约不变，P1 对齐 |
| `readImageBuffer` / sharp / uploads | 复用 |
| `UpscaleService` / internal upscale | 分层参考；slice 无 provider、无扣点 |
| refine 互斥 / 工作台壳 | 人机不变 |
| `add_nodes_batch` / `update_nodes_batch` / `connect_nodes` | Agent 落子 |

## 8. 风险与边界

| 风险 | 缓解 |
|------|------|
| 几何双份漂移 | 强制 shared 单源 + 共用余数用例 |
| CVM CPU（N≤49） | extract 池 ≤4；超时明确 |
| 上游防盗链 | 失败文案清晰；不落半成品 |
| Agent 落子漏写 gridSlice | prompt/skill 写死；集成断言字段 |
| 误走 Studio JWT from Runtime | 文档与实现只暴露 internal |

## 9. 里程碑

| 步骤 | 内容 |
|------|------|
| T1 | `@lnkpi/shared` 几何迁移 + 双端引用 |
| T2 | `ImageSliceService` + `POST /studio/image/slice` + 单测 |
| T3 | 人机改调 API，删除前端像素切图 |
| T4 | `/agent/internal/grid-slice-image` + Runtime tool |
| T5 | 落子约定文档/skill + 冒烟 + PR |

## 10. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-09-15 | Draft：路径 1；纯 B；tool 分层 A；保留预览；§4 订正为 internal 入口 + add/update/connect 落子 |
| 2026-09-15 | Self-review：钉死 nodeId/sourceUrl 优先级；落子 patch 对齐 P0 `label`+`status:completed`；Approved |
