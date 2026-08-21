# 画布精修选区链第二刀（多边形套索 + 魔棒减选）Design

**Date:** 2026-08-21  
**Status:** Draft pending user review  
**代号:** **CX-IMAGE-EDIT-SELECTION-TOOLS**  
**Related:**
- `2026-08-19-cx-image-edit-toolchain-design.md` — 第一刀魔棒 + 反向 + 禁用抠图槽；本文件为其选区链续篇
- `2026-08-19-cx-image-edit-sidepanel-design.md` — 右侧壳、工作图；对照扩展仍不做
- `2026-08-18-cx-image-edit-design.md` — 精修作业、积分、EditProvider 仍有效

---

## Goal

在精修 **选区链** 补齐纯前端能力：**多边形套索**（点选闭合）与 **魔棒减选**（橡皮意图 + 魔棒）。不接 SAM、不接抠图上游、不改对照壳、不改作业扣分。

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| 范围 | 仅选区链；作业链抠图继续禁用搁置；壳链对照不扩展 |
| 实现路径 | 纯函数扩展现有 mask 工具（方案 A） |
| 多边形闭合 | **双击闭合**，或 **单击靠近起点自动闭合** |
| 近起点阈值 | 工作图像素距离 **≤ 12** |
| 多边形最少点数 | **3**；不足则不可闭合 |
| 加选 / 减选 | **不另开全局 +/− 开关**；用 `refineMaskOp: 'add' \| 'subtract'` |
| 减选触发 | 点 **橡皮** → `op = subtract`；点画笔 / 矩形 → `op = add`；点魔棒 / 多边形 **只换工具，不改 op** |
| 魔棒减选 | `floodFillMask` 支持 `mode: 'add' \| 'subtract'`；subtract 清连通域为透明 |
| 多边形写 mask | 默认并入；`op === 'subtract'` 时减选；even-odd 填充 |
| 后端 | **无新 API**；不改 EditProvider / capabilities / Prisma |
| 积分 | 多边形 / 魔棒加减选 / 清除 / 反向 **不扣分**；「精修」仍 10 分、`chargeReason: '图像精修'` |

## Non-goals（本轮）

- SAM / Grounding / 点击主体 / 文本指代
- CutoutProvider、真透明底、`remove_bg` capability
- 自由套索（拖动画线）、磁性套索、喷枪、全图同色选择（非连通）
- 对照：上下擦除、透明度溶解、自动闪光
- 改 `ImageProvider.generate()` / `supportedModes`（仍仅 `['inpaint']`）
- `/image-studio`、`run_icon_refine` 自动写回

---

## 1. 工具态与侧栏

```text
[选区]  画笔组 | 魔棒(+容差) | 多边形 | 反向 | …
```

- `RefineMaskTool` 增加 `'polygon'`。关精修时 `resetRefineChromeState`：工具 → `'brush'`，`refineMaskOp` → `'add'`，容差复位（现有）。
- 侧栏在魔棒旁增加 **多边形** 按钮；`op === 'subtract'` 时魔棒 / 多边形的 `title` 标明减选（例如「魔棒减选」「多边形减选」）。
- 容差滑杆仍仅 `refineTool === 'wand'` 时出现。
- 作业行「抠图」保持 disabled；对照 / 放大镜不动。

### 1.1 `refineMaskOp` 状态机

| 用户动作 | `refineTool` | `refineMaskOp` |
|----------|--------------|----------------|
| 点画笔 | `brush` | `add` |
| 点橡皮 | `eraser` | `subtract` |
| 点矩形 | `rect` | `add` |
| 点魔棒 | `wand` | **保持不变** |
| 点多边形 | `polygon` | **保持不变** |

因此「先点橡皮再点魔棒」→ 工具是 wand、op 是 subtract → 魔棒减选。同理多边形。

---

## 2. 多边形行为

1. `refineTool === 'polygon'` 时，工作图指针为点击加点，不是涂抹。
2. 单击：若距起点 ≤ 12px 且已有 ≥ 3 点 → **闭合**；否则追加顶点。
3. 双击：若已有 ≥ 3 点 → 闭合（双击产生的多余点不计入）；否则忽略。
4. 移动指针：预览折线 + 到当前指针的橡皮筋；不写 mask。
5. 闭合：调用 `fillPolygonMask`，按当前 `refineMaskOp` 并入或减选，然后清空草稿点列并 `emitCoverage`。
6. Esc（或侧栏等价「取消草稿」）：丢弃未闭合点列，不改 mask。
7. busy / 尺寸未就绪：与画笔一样不可点。
8. 切换离开 `polygon` 工具：丢弃未闭合草稿（不写 mask）。

---

## 3. 算法（可单测）

### 3.1 `floodFillMask` 扩展

在既有签名上增加 `mode: 'add' | 'subtract'`（默认 `'add'`）。

- `add`：与第一刀相同 — 纳入像素写 `fillRgb` + A=255。
- `subtract`：纳入像素写 RGB=0、A=0。
- 连通规则、容差、越界 no-op **不变**；仍只看底图 RGB，不看旧 mask 做连通条件。

### 3.2 `fillPolygonMask`

新文件 `maskPolygon.ts`：

```ts
fillPolygonMask(input: {
  width: number
  height: number
  maskRgba: Uint8ClampedArray
  points: Array<{ x: number; y: number }>
  fillRgb: [number, number, number]
  mode: 'add' | 'subtract'
}): Uint8ClampedArray
```

- 点数 &lt; 3，或 mask 长度不是 `width*height*4` → 原样返回 `maskRgba`。
- 填充规则：**even-odd**；边界像素算入选区。
- `add`：选区内 RGB=fill、A=255。
- `subtract`：选区内 RGB=0、A=0。
- 未选中像素不改。

辅助：`isNearPolygonStart(points, x, y, thresholdPx = 12): boolean` — `points.length >= 1` 且与 `points[0]` 的欧氏距离 ≤ threshold。

---

## 4. 组件与数据

| 单元 | 职责 |
|------|------|
| `maskWand.ts` | `floodFillMask` 增加 `mode` |
| `maskWand.test.ts` | 增补 subtract 用例 |
| `maskPolygon.ts`（新） | `fillPolygonMask`、`isNearPolygonStart` |
| `maskPolygon.test.ts`（新） | 三角填充、减选、非法输入、近起点 |
| `canvasEditor.ts` | `polygon`；`refineMaskOp`；复位 |
| `canvasEditor.refine.test.ts` | op / polygon 复位断言 |
| `MaskEditor.vue` | polygon 草稿与闭合；wand 读 mode；Esc 取消草稿 |
| `RefineSidePanel.vue` | 多边形按钮；减选 title |
| `RefineWorkViewport.vue` | 传入 `mask-op` / polygon |

点击坐标：沿用 MaskEditor 现有 pointer → canvas 像素映射。

---

## 5. 错误与边界

| 情况 | 结果 |
|------|------|
| 图未就绪 | 多边形 / 魔棒 disabled |
| 多边形 &lt; 3 点双击 | no-op（不闭合） |
| Esc / 切换工具 | 丢弃草稿，mask 不变 |
| 减选空 mask | flood/polygon 仍可跑；结果仍为空或局部清掉已有选区 |
| 精修空选区 | 仍拦截覆盖率 &lt; 0.3%（P1） |

---

## 6. 验收

1. 选区行有多边形；加点 → 双击或近起点闭合 → mask 出现多边形块。  
2. 默认（op=add）魔棒 / 多边形并入；先点橡皮再点魔棒 / 多边形为减选，title 可见。  
3. Esc（或取消草稿）丢弃未闭合多边形，coverage / mask 不变。  
4. 「抠图」仍 disabled；点「精修」行为与积分与 P1/第一刀相同。  
5. capabilities 仍只有 `inpaint`。  
6. 不改后端 edit DTO、Prisma、`ImageProvider.generate`。

---

## 7. 后续（不进本轮）

| 刀 | 内容 |
|----|------|
| 选区 3 | SAM / 点击主体；再后文本指代 |
| 作业 2 | CutoutProvider（搁置；现网无 rembg、CVM 资源不足） |
| 壳 | 上下擦除 / 溶解 / 闪光 |

---

## 风险

| 风险 | 缓解 |
|------|------|
| 「橡皮 + 魔棒」组合态不直观 | title 写明减选；不另加 +/− 避免与橡皮抢语义 |
| 近起点 12px 在高缩放下过松/过紧 | 阈值相对工作图像素，与画笔同坐标空间；验收时可调 |
| 大多边形逐像素扫描卡顿 | 与魔棒同级：单帧同步；工作图已是位图像素 |
