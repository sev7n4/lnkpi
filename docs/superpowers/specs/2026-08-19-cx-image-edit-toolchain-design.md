# 画布精修工具链（选区槽 + 作业槽）Design

**Date:** 2026-08-19  
**Status:** Approved, plan in `2026-08-19-cx-image-edit-toolchain.md`  
**代号:** **CX-IMAGE-EDIT-TOOLCHAIN**  
**Related:**
- `2026-08-18-cx-image-edit-design.md` — 作业 A+B（去污渍 / 替换局部）、EditProvider、合成、版本链、积分仍有效
- `2026-08-19-cx-image-edit-sidepanel-design.md` — 右侧壳、工作图、对照；**对照扩展本轮不做**
- `2026-08-08-image-upstream-capability-design.md` §13.2 P2/P3 — 智能选区与抠图的上游边界

---

## Goal

把精修侧栏拆成 **三条互不混用的工具链**，并落地第一刀：**选区链补魔棒 + 反向**；**作业链只占抠图槽、不接假 remove_bg**。去污渍 / 替换局部仍走现有 inpaint。对照、放大镜不改。

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| 三条链 | **壳**（对照/放大镜）· **选区**（产出 mask）· **作业**（消费 mask 或整图，才扣分） |
| 本轮对照 | **不扩展**（不上上下擦除 / 溶解 / 闪光） |
| 选区第一刀 | **魔棒**（工作图点击，4 连通、容差）+ **反向选区**。不接 SAM、不做文本指代 |
| 魔棒后端 | **纯前端**，对工作图 RGB 做连通域填充，写入现有 mask canvas。无新 API |
| 连通规则 | **4 连通**；仅连续区域，不做全图像素颜色选择 |
| 容差 | 整数 **0–48**，默认 **24**；比较 `max(\|ΔR\|,\|ΔG\|,\|ΔB\|) ≤ 容差` |
| 作业第一刀 | 侧栏出现 **抠图** 槽位，**禁用**；不调用 `POST /studio/image/edit` 冒充去背景 |
| capabilities | 本轮仍仅 `['inpaint']`。**禁止**重新声称 `remove_bg` / `crop` / `outpaint` |
| 写回 / 积分 | 魔棒、反向、清除 **不扣分**。点「精修」仍 10 分、`chargeReason: '图像精修'` |
| 壳复用 | 抠图未来出 After 时复用现有对照；本轮抠图无 After |
| 入口 | 不变：显式打开精修。选中节点不打开 |

## Non-goals（本轮）

- SAM / Grounding / 点击主体分割服务
- 文本指代选区（「天空」「Logo」）
- 真正抠图 API、透明底导出、白底主图模板、批量电商
- CutoutProvider、新 `chargeReason`、新 Prisma 表
- 扩图、裁切、局部超分、编辑强度滑杆、用户自选编辑模型
- 对照：上下擦除、透明度溶解、自动闪光
- 喷枪、多边形、磁性套索、全图同色选择（非连通）
- 工作室 `/image-studio` 精修入口、Agent `run_icon_refine` 自动写回
- 改 `ImageProvider.generate()` / 给 generate 加 `maskUrl`

---

## 1. 三条链（心智与侧栏）

侧栏从上到下固定四块，**不要把作业图标塞进选区行，也不要把对照塞进作业行**。

```text
[壳]     左右 | 重叠 | 最大化 | 放大镜…
[对照]   CompareView（迷你）
[选区]   画笔组 | 魔棒 | （魔棒下级：容差）| 反向 | 清除已在画笔组内
[作业]   污渍/替换芯片 · 指令框 · 「精修」|「抠图(禁用)」|「应用到节点」
[版本]   版本条（不变）
```

| 链 | 改什么 | 扣分 |
|----|--------|------|
| 壳 | 只看 Before/After、放大 | 否 |
| 选区 | 只改 mask | 否 |
| 作业 | 出 After 或未来透明底 | 是（本轮仅「精修」） |

画笔组交互保持现状：点画笔展开橡皮 / 矩形 / 颜色 / 粗细 / 清除。魔棒与画笔组 **并列**，点开后才出现容差滑杆（同放大镜下一级）。反向是选区链按钮，写在魔棒旁边（或画笔组展开区内，实现时二选一：**锁定为魔棒行：魔棒 + 容差 + 反向**，避免画笔组再膨胀）。

---

## 2. 选区链 — 魔棒

### 2.1 行为

1. 用户点「魔棒」，`refineTool = 'wand'`。工作图指针为点击，不是涂抹。
2. 在工作图（Before 位图，与 mask 同像素尺寸）上 **单击**：以该像素 RGB 为种子，4 连通扩张所有「容差内」像素，把对应 mask 像素涂成当前选区色（与画笔相同，`refineBrushColor`），alpha=255。
3. 多次点击 = **并入** 现有 mask，不先清空。
4. 按住橡皮再点魔棒区域：本轮 **不做** 魔棒减选。减选用橡皮或反向后再手绘。
5. busy 或尺寸未就绪：与画笔一样不可点。

### 2.2 算法（可单测）

纯函数，输入：`width, height, imageRgba: Uint8ClampedArray, maskRgba: Uint8ClampedArray, x, y, tolerance, fillRgba`。

- 越界或 image/mask 长度不是 `width*height*4` → 原样返回 mask（no-op）。
- 种子像素取 image 的 RGB。
- 队列 BFS，4 邻接。访问标记长度为 `width*height`。
- 像素纳入当且仅当 `max(|r-sr|,|g-sg|,|b-sb|) <= tolerance`。
- 写入 mask：该像素 RGB = fill 的 RGB，A=255。不改未纳入像素。
- **不**读取旧 mask 作为连通条件（魔棒看图，不看已有选区）。已有选区与新填充重叠则覆盖为 fill。

默认 `tolerance = 24`。滑杆 0–48，步进 1。关精修时复位（与笔刷粗细同一 `resetRefineChromeState`）。

### 2.3 反向选区

纯函数 `invertMaskRgba(maskRgba)`：每个像素若 A>127 则清成 0；否则写成 RGB 白 + A=255（与导出约定：白=可编辑）。

按钮「反向选区」对当前 mask canvas 执行一次并 `emitCoverage`。空 mask 反向 = 全图可编辑（覆盖率近 100%，沿用 P1 全图警告，仍允许点精修）。

---

## 3. 作业链 — 精修 vs 抠图槽

### 3.1 精修（已有，不变）

mask + 指令 → `POST /studio/image/edit` → After → 合成保真 → 应用到节点。芯片「去除污渍瑕疵」「替换选区内容」仍只改 prompt。

### 3.2 抠图槽（本轮契约，不接上游）

- 主按钮区增加「抠图」，`disabled`，`title="抠图将走专用通道，尚未接入"`。
- **禁止**：用整图 mask +「去掉背景」prompt 走 inpaint 冒充抠图。
- **禁止**：`get_image_edit_capabilities.supportedModes` 加入 `remove_bg`。
- 下一独立规格再定：CutoutProvider、计费文案、透明 PNG 写回、是否要求先有选区。本文件只保证槽位存在且不撒谎。

---

## 4. 组件与数据

| 单元 | 职责 |
|------|------|
| `maskWand.ts`（新） | `floodFillMask`、`invertMaskRgba`、夹取容差 `clampWandTolerance` |
| `MaskEditor.vue` | `tool: 'wand'`：click 一次 flood；暴露 `invert()`；现有 `clear` 不变 |
| `canvasEditor` | `refineTool` 增加 `'wand'`；`refineWandTolerance` 默认 24；reset 时恢复 |
| `RefineSidePanel` | 选区行魔棒 + 容差 + 反向；作业行禁用抠图 |
| `RefineWorkViewport` | 把 wand/tolerance 传给 MaskEditor；点击落在工作图像素坐标（与现有 brush 同一套 canvas 坐标） |
| Agent capabilities | **不改**（仍仅 inpaint） |

点击坐标：沿用 MaskEditor 现有 pointer → canvas 像素映射。魔棒 `pointerdown` 一次 fill，不拖动连续 fill。

---

## 5. 错误与边界

| 情况 | 结果 |
|------|------|
| 图未就绪 | 魔棒 disabled（同画笔） |
| 点击落在图外 | no-op |
| 容差 0 | 仅种子像素（及 RGB 完全相同的 4 连通） |
| 容差 48 + 平坦背景 | 可能近全图；覆盖率警告走 P1 |
| 反向空选区 | 全选，P1 全图提示 |
| 精修空选区 | 仍拦截 &lt; 0.3% |

---

## 6. 验收

1. 打开精修 → 选区行能开魔棒；未点开时不出现容差滑杆。  
2. 工作图单击平坦区域 → mask 出现连通块；再画笔/橡皮可改这块。  
3. 容差变大，同样点击覆盖面积单调不减（单测用夹具图即可）。  
4. 反向：有选区时选区与未选互换；coverage 更新。  
5. 「抠图」可见且 disabled；点「精修」行为与 P1 相同。  
6. capabilities 探测仍只有 `inpaint`。  
7. 不改后端 edit DTO、不改 Prisma、不改 `ImageProvider.generate`。

---

## 7. 后续（不进本轮计划）

| 刀 | 内容 |
|----|------|
| 选区 2 | SAM / 点击主体；再后文本指代 |
| 作业 2 | CutoutProvider + 真透明底；capabilities 才加 `remove_bg` |
| 壳 | 上下擦除 / 溶解 / 闪光 |

---

## 风险

| 风险 | 缓解 |
|------|------|
| 魔棒在 JPEG 噪点上碎 | 容差默认 24；用户可调大 |
| 大图 BFS 卡 UI | 单帧 fill；若 &gt;4K 仍同步（P1 工作图已按位图像素，与画笔同级） |
| 产品把禁用抠图当 bug | title 写明尚未接入，不假装能点 |
