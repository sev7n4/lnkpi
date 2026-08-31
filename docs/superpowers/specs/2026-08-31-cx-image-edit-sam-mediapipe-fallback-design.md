# 精修点选：主 SAM3 + MediaPipe 故障降级 Design

**Date:** 2026-08-31  
**Status:** Approved; plan in `docs/superpowers/plans/2026-08-31-cx-image-edit-sam-mediapipe-fallback.md`  
**代号:** **CX-IMAGE-EDIT-SAM-MEDIAPIPE-FALLBACK**  
**Related:**
- `2026-08-31-cx-image-edit-sam-point-select-design.md` — 点选主路径（fal SAM3）
- `2026-08-21-cx-image-edit-selection-tools-design.md` — 选区工具链
- `2026-08-19-cx-image-edit-toolchain-design.md` — 选区不扣分

---

## Goal

在现有精修 **点选**（`POST /studio/image/segment` → fal `fal-ai/sam-3/image`）之上，当云端不可用时 **自动降级** 到浏览器端 **MediaPipe Interactive Segmenter**，保证点选仍能出 mask；不新增侧栏开关、不改积分与精修出图契约。

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| 主路径 | 仍为 fal **SAM3**（服务端代理，`FAL_KEY`） |
| 降级 | **MediaPipe Interactive Segmenter**，仅浏览器 |
| 触发 | **仅故障自动降级**（无手动「本地点选」） |
| 用户感知 | 首次降级成功时 **toast 一次**：「云端点选暂不可用，已用本地点选」 |
| 粘滞 | **会话粘滞**：本轮精修内后续点选只走本地；关精修 / 换工作图后复位再试 SAM3 |
| 实现路径 | **前端降级（路径 A）**：API 失败 → 懒加载 MediaPipe；CVM **不**跑分割 |
| 加载时机 | **首次需要降级时** `import()`，不预热精修面板 |

## Non-goals

- 手动切换「本地点选」、双轨并行预热、竞速取快
- 服务端 MediaPipe / ONNX / 自建 SAM
- 文本指代（B）、负点击、多候选 mask
- 改积分、GenerationRecord、EditProvider、真抠图
- 静默永不提示（已定 toast 一次）

---

## 1. 触发条件与错误契约

### 1.1 可降级 → MediaPipe + 置粘滞

在尚未粘滞时，下列情况视为可降级：

- `503` /「点选暂不可用」（无 `FAL_KEY`）
- 上游 fal 失败：映射为 **`502`**（含原 401/403/`TOP_UP`、上游 429、5xx、超时、网络失败、响应无 maskUrl）
- 前端可降级判定以 **HTTP `502` / `503`** 为准；若现有 API 信封支持业务码，502 时附带 `SEGMENT_UPSTREAM_UNAVAILABLE`（有则识别，无则仍仅靠 status）

### 1.2 不可降级

- `400` 参数无效
- 本平台用户限流 `429`「点选过于频繁」
- MediaPipe 自身失败（模型加载失败 / 无有效 mask）→ toast 失败，mask 不变

### 1.3 服务端改动（配合识别）

- 保持：无 key → `503`
- **改：** fal/`SegmentProvider` 抛错不再变成未处理 500；捕获后 **`502 Bad Gateway`** + 可读文案（如「云端点选失败」）
- 用户限流 / 参数校验语义不变

---

## 2. 前端数据流与懒加载

### 2.1 模块

建议新增 `apps/web/src/components/canvas/refine/mediapipeSegment.ts`：

- 封装 MediaPipe Interactive Segmenter（stateful：`setImage` 一次 + 多次 `segment`）
- 对外：`segmentPoint({ imageSource, x, y }) →` 与工作图同尺寸的 RGBA（或可喂入现有 `mergeMaskRgba` / `normalizeRemoteMaskRgba` 的等价数据）

点选编排仍挂在现有 refine 点选 handler（`registerRefinePointSelectHandler` / SidePanel 侧），不改 `refineTool: 'point'` 与 `refineMaskOp` 语义。

### 2.2 单次点击（未粘滞）

1. `studioApi.segmentImage(...)` → SAM3  
2. 成功：`loadMaskRgbaFromUrl` → 按 `refineMaskOp` 并入（现状）  
3. 可降级失败：  
   - 动态 `import()` MediaPipe（首次才拉 WASM/模型）  
   - 对当前工作图 `setImage` + 点坐标 `segment`  
   - 归一化 / 合并与远端 mask 相同路径  
   - toast **一次**（会话内标志，避免重复吵）  
   - `preferLocalSegment = true`

### 2.3 粘滞后

直接本地 `segmentPoint`，**不再**请求 `/studio/image/segment`。

### 2.4 复位

关精修 / `resetRefineChromeState` / 换工作图 URL 或尺寸源：

- 清 `preferLocalSegment` 与「已 toast」标志  
- 释放 MediaPipe 图会话缓存（下次降级再 `setImage`）  
- 下一击重新先试 SAM3

### 2.5 Busy

SAM3 与 MediaPipe 共用现有点选 busy；WASM 首次加载期间不可连点。

---

## 3. 测试

| 层 | 用例 |
|----|------|
| 服务端 | 无 key → 503；fal 403/5xx/无 mask → 502；限流 → 429；坏参 → 400 |
| 前端编排 | 可降级 → 调本地；粘滞跳过 API；复位后恢复 SAM3；400/本平台 429 不调 MediaPipe |
| MediaPipe | mock segmenter（CI 不强制真实 WASM）；手工：假 502 / 断 fal → toast 一次 + mask 出现 |

---

## 4. 成功标准

- fal 正常：行为与现网点选一致（仍走 SAM3）  
- fal 锁号 / 无 key / 502：点选仍能出 mask，首次 toast 一次，同会话后续本地且不刷 fal  
- 关精修再开：再次优先 SAM3  
- 点选仍不扣分；精修出图链路不变  

## Open questions

无（本轮已锁定）。实现阶段若 MediaPipe Web 包名/模型 URL 与文档有出入，以官方 Interactive Segmenter 推荐模型为准，记入 plan 任务即可。
