# 画布精修选区链第二刀（多边形 + 魔棒减选）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在精修选区链加入多边形套索（双击/近起点闭合）与魔棒减选（橡皮意图 + `refineMaskOp`）；不接上游、不改抠图槽、不改对照。

**Architecture:** 先扩展 `floodFillMask` 的 `mode`，再新增可单测的 `fillPolygonMask` / `isNearPolygonStart`。Store 增加 `polygon` 与 `refineMaskOp`。`MaskEditor` 处理多边形草稿与 wand 减选。侧栏只加多边形按钮与减选 title。后端不动。

**Tech Stack:** Vue 3 + Pinia、Vitest、现有 MaskEditor canvas

**Spec:** `docs/superpowers/specs/2026-08-21-cx-image-edit-selection-tools-design.md`

## Global Constraints

- **禁止**改 `ImageProvider.generate()` / `buildImageProviderOptions()` / `run_icon_refine` / Prisma / `/image-studio`
- **禁止**接 CutoutProvider / SAM / 文本指代；抠图按钮保持 disabled
- **禁止**改 `get_image_edit_capabilities` 或把 `supportedModes` 加成 `remove_bg` / `crop` / `outpaint`
- 多边形 / 魔棒加减选 / 清除 / 反向 **不扣分**；「精修」仍 10 分、`chargeReason: '图像精修'`
- 多边形闭合：双击或距起点 ≤ 12px；至少 3 点；even-odd 填充
- `refineMaskOp`：点橡皮 → `subtract`；点画笔/矩形 → `add`；点魔棒/多边形 **不改** op
- 对照不扩展；无自由套索 / 磁性套索
- TDD：先写失败测试再实现；提交前缀 `feat:` / `fix:`
- 不 `git add -A`；勿提交 `.seedream-backup`、`deploy/`、`q.js`、`.superpowers/sdd/*`

## File map

| File | Responsibility |
|------|----------------|
| `apps/web/src/components/canvas/refine/maskWand.ts` | `floodFillMask` 增加 `mode?: 'add' \| 'subtract'` |
| `apps/web/src/components/canvas/refine/maskWand.test.ts` | subtract 单测 |
| `apps/web/src/components/canvas/refine/maskPolygon.ts` | `isNearPolygonStart`、`fillPolygonMask` |
| `apps/web/src/components/canvas/refine/maskPolygon.test.ts` | 上述纯函数单测 |
| `apps/web/src/stores/canvasEditor.ts` | `polygon`；`RefineMaskOp`；`setRefineMaskOp` / 工具切换 setter |
| `apps/web/src/stores/canvasEditor.refine.test.ts` | op / polygon 复位 |
| `apps/web/src/components/canvas/refine/MaskEditor.vue` | polygon 草稿；wand 传 mode；Esc 取消 |
| `apps/web/src/components/canvas/refine/RefineWorkViewport.vue` | 传入 `mask-op` |
| `apps/web/src/components/canvas/refine/RefineSidePanel.vue` | 多边形按钮；减选 title；工具切换走 setter |

---

### Task 0: 分支

- [ ] **Step 1:** 从已含 selection-tools spec 的 docs 分支切 feature 分支。

```bash
git checkout docs/cx-image-edit-selection-tools
git pull origin docs/cx-image-edit-selection-tools 2>/dev/null || true
git checkout -b feature/cx-image-edit-selection-tools
```

- [ ] **Step 2:** 基线测试

```bash
pnpm --filter @lnkpi/web exec vitest run src/stores/canvasEditor.refine.test.ts src/components/canvas/refine/maskWand.test.ts
```

Expected: PASS

---

### Task 1: `floodFillMask` 支持 subtract

**Files:**
- Modify: `apps/web/src/components/canvas/refine/maskWand.ts`
- Modify: `apps/web/src/components/canvas/refine/maskWand.test.ts`

**Interfaces:**
- Produces: `floodFillMask` 增加可选 `mode?: 'add' | 'subtract'`（默认 `'add'`）。`subtract` 时纳入像素 RGB=0、A=0。

- [ ] **Step 1: Write the failing test**

在 `maskWand.test.ts` 的 `floodFillMask` describe 末尾追加：

```ts
  it('subtract clears 4-connected pixels to transparent', () => {
    const image = rgba([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255])
    const mask = rgba([
      255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    ])
    const next = floodFillMask({
      width: 3,
      height: 1,
      imageRgba: image,
      maskRgba: mask,
      x: 0,
      y: 0,
      tolerance: 0,
      fillRgb: [9, 9, 9],
      mode: 'subtract',
    })
    expect([...next.slice(0, 8)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect([...next.slice(8, 12)]).toEqual([255, 255, 255, 255])
  })
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/maskWand.test.ts
```

Expected: FAIL（`mode` 未实现，减选像素仍被写成 fill）

- [ ] **Step 3: Write minimal implementation**

在 `floodFillMask` 的 input 类型增加 `mode?: 'add' | 'subtract'`。在写入像素处：

```ts
  const mode = input.mode === 'subtract' ? 'subtract' : 'add'
  // inside BFS when painting pixel at offset o:
  if (mode === 'subtract') {
    next[o] = 0
    next[o + 1] = 0
    next[o + 2] = 0
    next[o + 3] = 0
  } else {
    next[o] = fillRgb[0]
    next[o + 1] = fillRgb[1]
    next[o + 2] = fillRgb[2]
    next[o + 3] = 255
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/maskWand.test.ts
```

Expected: PASS（含既有 add 用例）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/canvas/refine/maskWand.ts apps/web/src/components/canvas/refine/maskWand.test.ts
git commit -m "feat(web): support subtract mode on refine wand flood-fill"
```

---

### Task 2: `maskPolygon` 纯函数

**Files:**
- Create: `apps/web/src/components/canvas/refine/maskPolygon.ts`
- Create: `apps/web/src/components/canvas/refine/maskPolygon.test.ts`

**Interfaces:**
- Produces:
  - `export function isNearPolygonStart(points: Array<{ x: number; y: number }>, x: number, y: number, thresholdPx?: number): boolean`
  - `export function fillPolygonMask(input: { width: number; height: number; maskRgba: Uint8ClampedArray; points: Array<{ x: number; y: number }>; fillRgb: [number, number, number]; mode: 'add' | 'subtract' }): Uint8ClampedArray`

- [ ] **Step 1: Write the failing test**

Create `maskPolygon.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { fillPolygonMask, isNearPolygonStart } from './maskPolygon'

function rgba(pixels: number[]): Uint8ClampedArray {
  return new Uint8ClampedArray(pixels)
}

describe('isNearPolygonStart', () => {
  it('is true within 12px of the first vertex', () => {
    expect(isNearPolygonStart([{ x: 10, y: 10 }], 15, 10)).toBe(true)
    expect(isNearPolygonStart([{ x: 10, y: 10 }], 30, 10)).toBe(false)
    expect(isNearPolygonStart([], 0, 0)).toBe(false)
  })
})

describe('fillPolygonMask', () => {
  it('fills a right triangle with even-odd and leaves outside empty', () => {
    // 4x4; triangle (0,0)-(3,0)-(0,3)
    const mask = rgba(new Array(4 * 4 * 4).fill(0))
    const next = fillPolygonMask({
      width: 4,
      height: 4,
      maskRgba: mask,
      points: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 0, y: 3 },
      ],
      fillRgb: [255, 255, 255],
      mode: 'add',
    })
    const count = () => {
      let n = 0
      for (let i = 3; i < next.length; i += 4) if (next[i] > 127) n += 1
      return n
    }
    expect(count()).toBeGreaterThanOrEqual(3)
    expect(count()).toBeLessThan(16)
    // far corner (3,3) should stay empty
    expect([...next.slice(15 * 4, 16 * 4)]).toEqual([0, 0, 0, 0])
  })

  it('subtract clears interior pixels', () => {
    const mask = rgba(new Array(4 * 4 * 4).fill(255))
    const next = fillPolygonMask({
      width: 4,
      height: 4,
      maskRgba: mask,
      points: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 0, y: 3 },
      ],
      fillRgb: [1, 2, 3],
      mode: 'subtract',
    })
    expect(next[3]).toBe(0)
    // outside triangle near (3,3) stays opaque
    expect(next[15 * 4 + 3]).toBe(255)
  })

  it('returns original buffer on invalid input', () => {
    const mask = rgba([1, 2, 3, 4])
    const out = fillPolygonMask({
      width: 2,
      height: 2,
      maskRgba: mask,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      fillRgb: [255, 255, 255],
      mode: 'add',
    })
    expect(out).toBe(mask)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/maskPolygon.test.ts
```

Expected: FAIL — cannot resolve `./maskPolygon`

- [ ] **Step 3: Write minimal implementation**

Create `maskPolygon.ts`:

```ts
export function isNearPolygonStart(
  points: Array<{ x: number; y: number }>,
  x: number,
  y: number,
  thresholdPx = 12,
): boolean {
  const start = points[0]
  if (!start) return false
  const dx = x - start.x
  const dy = y - start.y
  return dx * dx + dy * dy <= thresholdPx * thresholdPx
}

function pointInPolygonEvenOdd(
  x: number,
  y: number,
  points: Array<{ x: number; y: number }>,
): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x
    const yi = points[i].y
    const xj = points[j].x
    const yj = points[j].y
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0) + xi
    // avoid div-by-zero when edge is horizontal: skip (yj===yi means first clause false)
    if (yj === yi) continue
    const xIntersect = ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (yi > y !== yj > y && x < xIntersect) inside = !inside
  }
  return inside
}

export function fillPolygonMask(input: {
  width: number
  height: number
  maskRgba: Uint8ClampedArray
  points: Array<{ x: number; y: number }>
  fillRgb: [number, number, number]
  mode: 'add' | 'subtract'
}): Uint8ClampedArray {
  const { width, height, maskRgba, points, fillRgb, mode } = input
  const expected = width * height * 4
  if (width <= 0 || height <= 0 || maskRgba.length !== expected || points.length < 3) {
    return maskRgba
  }
  const next = new Uint8ClampedArray(maskRgba)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!pointInPolygonEvenOdd(x + 0.5, y + 0.5, points)) continue
      const o = (y * width + x) * 4
      if (mode === 'subtract') {
        next[o] = 0
        next[o + 1] = 0
        next[o + 2] = 0
        next[o + 3] = 0
      } else {
        next[o] = fillRgb[0]
        next[o + 1] = fillRgb[1]
        next[o + 2] = fillRgb[2]
        next[o + 3] = 255
      }
    }
  }
  return next
}
```

注意：实现时去掉草稿里重复的 `intersect` 死代码，只保留 `xIntersect` 版本。

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/maskPolygon.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/canvas/refine/maskPolygon.ts apps/web/src/components/canvas/refine/maskPolygon.test.ts
git commit -m "feat(web): add polygon mask fill and near-start helpers"
```

---

### Task 3: Store — `polygon` + `refineMaskOp`

**Files:**
- Modify: `apps/web/src/stores/canvasEditor.ts`
- Modify: `apps/web/src/stores/canvasEditor.refine.test.ts`

**Interfaces:**
- Produces:
  - `export type RefineMaskTool = 'brush' | 'eraser' | 'rect' | 'wand' | 'polygon'`
  - `export type RefineMaskOp = 'add' | 'subtract'`
  - `refineMaskOp` ref，默认 `'add'`
  - `setRefineTool(tool: RefineMaskTool)` — 按规格更新 op
  - `resetRefineChromeState` 将 `refineMaskOp` 置 `'add'`

- [ ] **Step 1: Write the failing test**

在 `canvasEditor.refine.test.ts` 追加：

```ts
  it('tracks refineMaskOp from eraser/brush and keeps it when switching to wand/polygon', () => {
    setActivePinia(createPinia())
    const editor = useCanvasEditorStore()
    expect(editor.refineMaskOp).toBe('add')
    editor.setRefineTool('eraser')
    expect(editor.refineTool).toBe('eraser')
    expect(editor.refineMaskOp).toBe('subtract')
    editor.setRefineTool('wand')
    expect(editor.refineTool).toBe('wand')
    expect(editor.refineMaskOp).toBe('subtract')
    editor.setRefineTool('polygon')
    expect(editor.refineTool).toBe('polygon')
    expect(editor.refineMaskOp).toBe('subtract')
    editor.setRefineTool('brush')
    expect(editor.refineMaskOp).toBe('add')
    editor.setRefineTool('rect')
    expect(editor.refineMaskOp).toBe('add')
  })

  it('resets refineMaskOp and polygon tool on close', () => {
    setActivePinia(createPinia())
    const editor = useCanvasEditorStore()
    editor.openImageEditor({ nodeId: 'n1', url: 'https://cdn/a.png' })
    editor.setRefineTool('eraser')
    editor.setRefineTool('polygon')
    editor.closeImageEditor()
    expect(editor.refineTool).toBe('brush')
    expect(editor.refineMaskOp).toBe('add')
  })
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @lnkpi/web exec vitest run src/stores/canvasEditor.refine.test.ts
```

Expected: FAIL — `setRefineTool` / `refineMaskOp` 不存在

- [ ] **Step 3: Write minimal implementation**

在 `canvasEditor.ts`：

```ts
export type RefineMaskTool = 'brush' | 'eraser' | 'rect' | 'wand' | 'polygon'
export type RefineMaskOp = 'add' | 'subtract'

const refineMaskOp = ref<RefineMaskOp>('add')

function setRefineTool(tool: RefineMaskTool) {
  refineTool.value = tool
  if (tool === 'eraser') refineMaskOp.value = 'subtract'
  else if (tool === 'brush' || tool === 'rect') refineMaskOp.value = 'add'
  // wand / polygon: keep op
}

// in resetRefineChromeState:
refineTool.value = 'brush'
refineMaskOp.value = 'add'
```

导出 `refineMaskOp`、`setRefineTool`。侧栏后续任务改用 `setRefineTool`；本任务只改 store。

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @lnkpi/web exec vitest run src/stores/canvasEditor.refine.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/canvasEditor.ts apps/web/src/stores/canvasEditor.refine.test.ts
git commit -m "feat(web): track refine mask op and polygon tool"
```

---

### Task 4: `MaskEditor` — wand mode + polygon 草稿

**Files:**
- Modify: `apps/web/src/components/canvas/refine/MaskEditor.vue`

**Interfaces:**
- Consumes: `floodFillMask`（带 mode）、`fillPolygonMask`、`isNearPolygonStart`、`parseFillHex`
- Produces: props `maskOp?: 'add' | 'subtract'`（默认 `'add'`）；`tool` 含 `'polygon'`；暴露可选 `cancelPolygonDraft()`

- [ ] **Step 1: Extend props and wand call**

`MaskTool` 增加 `'polygon'`。props 增加 `maskOp?: 'add' | 'subtract'` 默认 `'add'`。

魔棒分支：

```ts
    const filled = floodFillMask({
      width: canvas.width,
      height: canvas.height,
      imageRgba,
      maskRgba: mask.data,
      x: pt.x,
      y: pt.y,
      tolerance: props.wandTolerance,
      fillRgb: parseFillHex(props.color),
      mode: props.maskOp === 'subtract' ? 'subtract' : 'add',
    })
```

- [ ] **Step 2: Polygon draft state + close**

在 script 中：

```ts
import { fillPolygonMask, isNearPolygonStart } from './maskPolygon'

let polygonPoints: Array<{ x: number; y: number }> = []
const polygonPreview = ref<Array<{ x: number; y: number }> | null>(null)

function cancelPolygonDraft() {
  polygonPoints = []
  polygonPreview.value = null
}

function commitPolygon(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
  if (polygonPoints.length < 3) {
    cancelPolygonDraft()
    return
  }
  const mask = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const next = fillPolygonMask({
    width: canvas.width,
    height: canvas.height,
    maskRgba: mask.data,
    points: polygonPoints,
    fillRgb: parseFillHex(props.color),
    mode: props.maskOp === 'subtract' ? 'subtract' : 'add',
  })
  putRgba(ctx, next, canvas.width, canvas.height)
  cancelPolygonDraft()
  emitCoverage()
}
```

`onPointerDown`：若 `tool === 'polygon'`：

- 若 `polygonPoints.length >= 3 && isNearPolygonStart(polygonPoints, pt.x, pt.y)` → `commitPolygon`
- 否则 `polygonPoints.push(pt)`，更新 preview

`onDblClick`（在 canvas 上 `@dblclick.prevent`）：若 polygon 且点数 ≥ 3 → commit（不要把双击的第二次 click 当成额外点：在 pointerdown 里若即将双击可依赖浏览器顺序——实现时用「双击 handler 只 commit 已有点，并在 pointerdown 跳过 300ms 内的第二次 down」或更简单：**dblclick 时 pop 掉最后重复点再 commit**）。

推荐简单规则（写入实现注释）：

```ts
function onDblClick(event: MouseEvent) {
  if (props.tool !== 'polygon' || !drawReady.value) return
  event.preventDefault()
  if (polygonPoints.length >= 4) polygonPoints.pop() // remove dblclick extra vertex
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  commitPolygon(ctx, canvas)
}
```

`onPointerMove`：polygon 时更新 `polygonPreview` 为 `[...polygonPoints, hoverPt]`，不 capture、不 drawing。

`watch(() => props.tool, cancelPolygonDraft)`。

`onKeydown` Escape（`window` listen while mounted）：`cancelPolygonDraft`。

template：可选 SVG/polyline overlay 画 `polygonPreview`（同尺寸绝对定位）；无 overlay 也可先只靠逻辑闭合，但验收需要可见预览——**必须画**半透明折线。

`defineExpose` 增加 `cancelPolygonDraft`。

- [ ] **Step 3: Smoke test**

```bash
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/maskWand.test.ts src/components/canvas/refine/maskPolygon.test.ts
pnpm --filter @lnkpi/web exec vue-tsc -b --pretty false
```

Expected: PASS / exit 0

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/canvas/refine/MaskEditor.vue
git commit -m "feat(web): apply wand subtract and polygon lasso on work mask"
```

---

### Task 5: 侧栏 + 工作视口接线

**Files:**
- Modify: `apps/web/src/components/canvas/refine/RefineWorkViewport.vue`
- Modify: `apps/web/src/components/canvas/refine/RefineSidePanel.vue`

**Interfaces:**
- Consumes: `editor.setRefineTool`、`editor.refineMaskOp`、`editor.refineTool`

- [ ] **Step 1: Viewport**

`MaskEditor` 增加：

```vue
:mask-op="editor.refineMaskOp"
```

`MaskTool` / tool prop 已含 polygon，无需其它改动（`tool="editor.refineTool"` 已有）。

- [ ] **Step 2: Side panel tool clicks**

凡 `editor.refineTool = '…'` 改为 `editor.setRefineTool('…')`（画笔组、橡皮、矩形、魔棒）。

在魔棒行旁加多边形按钮：

```vue
<button
  type="button"
  class="refine-side__icon-btn"
  :class="{ 'is-active': editor.refineTool === 'polygon' }"
  :title="editor.refineMaskOp === 'subtract' ? '多边形减选' : '多边形选区'"
  :disabled="busy"
  @click="editor.setRefineTool('polygon')"
>
  <!-- simple polygon icon -->
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75">
    <path stroke-linejoin="round" d="M12 4 20 9.5 17 19H7L4 9.5Z" />
  </svg>
</button>
```

魔棒 title：

```vue
:title="editor.refineMaskOp === 'subtract' ? '魔棒减选' : '魔棒'"
```

反向按钮保持在魔棒展开区（或与规格一致放在魔棒行）；多边形展开时不必显示容差。

`toggleBrushMenu` 里设 brush 时改用 `setRefineTool('brush')`。

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @lnkpi/web exec vue-tsc -b --pretty false
```

Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/canvas/refine/RefineWorkViewport.vue apps/web/src/components/canvas/refine/RefineSidePanel.vue
git commit -m "feat(web): wire polygon tool and subtract titles in refine panel"
```

---

### Task 6: 验证

- [ ] **Step 1: 单测**

```bash
pnpm --filter @lnkpi/web exec vitest run \
  src/stores/canvasEditor.refine.test.ts \
  src/components/canvas/refine/maskWand.test.ts \
  src/components/canvas/refine/maskPolygon.test.ts \
  src/components/canvas/refine/maskExport.test.ts
```

Expected: PASS

- [ ] **Step 2: Web build**

```bash
pnpm --filter @lnkpi/web build
```

Expected: exit 0

- [ ] **Step 3: 手工清单（本地 / 生产部署后）**

1. 精修 → 多边形加点 → 双击 / 近起点闭合 → mask 有块  
2. 橡皮 → 魔棒 → 减选；橡皮 → 多边形 → 减选；title 正确  
3. Esc 取消未闭合多边形  
4. 抠图仍 disabled；精修仍 10 分  

不在本任务改后端。若需开 PR，另说「开PR盯CI合并部署」。

---

## Spec coverage checklist

| Spec 项 | Task |
|---------|------|
| floodFill subtract | T1 |
| fillPolygonMask / near-start | T2 |
| refineMaskOp 状态机 | T3 |
| MaskEditor polygon + wand mode | T4 |
| 侧栏多边形 + title | T5 |
| 验收 / 不改后端 | T6 + Global Constraints |
| 抠图搁置 / 无 SAM | Global Constraints |
