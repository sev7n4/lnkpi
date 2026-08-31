# 画布精修选区：SAM 点击选主体 Design

**Date:** 2026-08-31  
**Status:** Approved for planning (pending user review of this file)  
**代号:** **CX-IMAGE-EDIT-SAM-POINT**  
**Related:**
- `2026-08-18-cx-image-edit-design.md` — 精修作业、积分、EditProvider、版本链
- `2026-08-19-cx-image-edit-toolchain-design.md` — 三条链；选区不扣分
- `2026-08-21-cx-image-edit-selection-tools-design.md` — 魔棒减选 / 多边形；本文件为「选区 3」
- `2026-08-08-image-upstream-capability-design.md` §7.4 / P2 — 智能选区需分割服务

**路线上下文（用户锁定顺序，本文件仅 A）：**  
A SAM 点选 → B 文本指代 → C1 强度 → C3 文本/图参考 → C2 局部超分

---

## Goal

在精修 **选区链** 增加 **点选主体**：用户在工作图上单击一次，经远端 SAM 得到主体 mask，再按当前 `refineMaskOp` 并入或挖除。不接抠图、不改精修扣分、不改 EditProvider 出图契约。

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| 分割位置 | **远端 API**；CVM 只鉴权转发，不跑模型 |
| 供应商 | **fal.ai** `fal-ai/sam-3/image`（平台 `FAL_KEY`）；APIMart/Agnes **无**点选分割接口 |
| 积分 | **点选不扣分**；「精修」仍 10 分 |
| 与 op | 点「点选」**只换工具不改** `refineMaskOp`；加选并入、减选挖除（同魔棒/多边形） |
| 请求节奏 | **每次单击独立一次** segment 请求；不做累计多点会话、不多候选 |
| MVP 点类型 | 仅 **前景** `label: 1`；负点击留给后续 |
| 实现路径 | **SegmentProvider + `POST /studio/image/segment`**；密钥不出浏览器 |
| 返回 | 推荐短时可拉 **`maskUrl`**（与底图同像素尺寸的 mask 图） |

## Non-goals（本轮 A）

- 文本指代选区（B）
- P4 强度 / 局部超分 / 文本参考 / Agent 自动 apply
- 真抠图 / CutoutProvider / `remove_bg`
- 负点击、框选、多候选 mask UI、同会话多点一次请求
- 浏览器直连 fal、BYOK 选 fal 供应商
- 对照壳扩展；`run_icon_refine` 自动写回
- 改 `ImageProvider.generate()` / 给 generate 加 mask

---

## Problem baseline

| 层 | 现状 | 缺口 |
|----|------|------|
| 选区 | 画笔 / 橡皮 / 矩形 / 魔棒 / 多边形 | 复杂主体边缘仍需大量手绘 |
| 上游 | Edit 已用 Image2 `mask_url` | 无「点 → mask」分割 |
| 主机 | CVM 无 GPU、内存紧 | 不可常驻 SAM（与抠图同结论） |

---

## 1. 侧栏与点击行为

- `RefineMaskTool` 增加 `'point'`；侧栏文案 **「点选」** / **「点选主体」**。
- `setRefineTool('point')`：**不**改 `refineMaskOp`。
- `op === 'subtract'` 时按钮 title 可为「点选减选」。
- 工作图单击：
  1. 坐标映射到工作图像素 `(x, y)`（与 mask 同空间）
  2. `busy` / 无 URL / 尺寸未就绪 → 忽略
  3. 进入 segment busy（可与 refine busy 区分或共用禁用点击）
  4. `POST /studio/image/segment`，`label: 1`
  5. 将返回 mask 栅格化后：`op === 'add'` 并入，`subtract` 挖除
  6. `emitCoverage`；失败 toast，mask 不变

关精修 / `resetRefineChromeState`：工具复位 `'brush'`，op 复位 `'add'`（与现有一致）。

---

## 2. 服务端契约与数据流

### 2.1 HTTP

```
POST /studio/image/segment
Auth: required
Body: { imageUrl: string, x: number, y: number, label?: 0 | 1 }
Success: { code: 0, data: { maskUrl: string } }
```

- `x`/`y`：非负整数，且应在图像宽高内（可知时校验）
- MVP 客户端固定 `label: 1`
- **不**创建 GenerationRecord、**不**走积分扣减

### 2.2 SegmentProvider（fal）

- 平台环境变量 `FAL_KEY`（缺失时接口明确 503/配置错误）
- 调用 `fal-ai/sam-3/image`：
  - `image_url`：公网可拉 URL（内网图先走现有 inline/公网化，与 edit 同源策略）
  - `point_prompts: [{ x, y, label }]`
  - 取 **单张** 最佳 mask（`return_multiple_masks: false` 或服务端选最高分）
- 将上游 mask 落成可下载 `maskUrl`（复用现有临时/素材存储模式之一，实现时对齐 edit mask 上传习惯）
- 按用户 **频率限流**（防连点刷 fal）；超限 429 + 文案

### 2.3 前端

- `studioApi.segmentImage(...)`
- MaskEditor：`refineTool === 'point'` 时单击触发，非涂抹
- 栅格并入逻辑复用现有 mask 合成方式（与魔棒结果写入同路径）

---

## 3. 错误与测试

**错误**
- fal/网络失败：toast「点选失败，请重试」；不改 mask
- 限流：提示稍后再试
- 配置缺失：服务端明确错误，前端可展示「点选暂不可用」

**测试**
- Provider：坐标/label → fal 请求映射；单 mask 选取
- Controller/service：鉴权、非法坐标、成功 `maskUrl`
- Store/UI：`point` 工具不改 op；busy 不连发
- 回归：魔棒/多边形/精修 edit 行为不变

**手动验收**
1. 点选工具 → 点主体 → mask 贴合主体轮廓  
2. 先橡皮再点选 → 挖除该主体  
3. 多次点选（加选）并入多块  
4. 积分不变直至点「精修」  
5. 断网/错误时 toast，原 mask 保留  

---

## Success criteria

1. 选区链有「点选」；单击经服务端 fal 写入 mask。  
2. 跟随 `refineMaskOp` 加/减。  
3. 点选零扣分；精修扣分不变。  
4. 密钥仅服务端；无浏览器直连 fal。  
5. 无文本指代、无抠图、无 P4。  

---

## Follow-ups（不进本文件实现）

| 包 | 内容 |
|----|------|
| B | 文本指代；复用 SegmentProvider + text `prompt` |
| C1 | 编辑强度滑杆 |
| C3 | 精修附参考图 |
| C2 | 局部超分 |
| 后续 | 负点击、多候选、BYOK fal |
