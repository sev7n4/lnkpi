# 画布精修工具链第一刀（魔棒 + 反向 + 抠图槽）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在精修选区链加入前端魔棒与反向选区；作业链露出禁用的「抠图」槽，不接上游、不声称 remove_bg。

**Architecture:** 纯函数 `floodFillMask` / `invertMaskRgba` / `clampWandTolerance` 先单测。`MaskEditor` 在 `tool === 'wand'` 时对工作图位图单击一次 BFS 写入 mask。Store 增加 `wand` 工具与容差并在关精修时复位。侧栏选区行与作业行分离。后端、EditProvider、capabilities 不动。

**Tech Stack:** Vue 3 + Pinia、Vitest、现有 MaskEditor canvas

**Spec:** `docs/superpowers/specs/2026-08-19-cx-image-edit-toolchain-design.md`

## Global Constraints

- **禁止**改 `ImageProvider.generate()` / `buildImageProviderOptions()` / `run_icon_refine` / Prisma / `/image-studio`
- **禁止**用 inpaint +「去背景」prompt 冒充抠图
- **禁止**改 `get_image_edit_capabilities` 或把 `supportedModes` 加成 `remove_bg` / `crop` / `outpaint`
- 魔棒 / 反向 / 清除 **不扣分**；「精修」仍 10 分、`chargeReason: '图像精修'`
- 魔棒：4 连通；容差 `max(|ΔR|,|ΔG|,|ΔB|) ≤ n`；n ∈ [0, 48]，默认 24
- 多次魔棒点击 **并入** mask，不先清空；不做魔棒减选
- 对照不扩展（无上下擦除 / 溶解 / 闪光）
- 无 SAM、无文本指代、无 CutoutProvider
- TDD：先写失败测试再实现；提交前缀 `feat:`
- 不 `git add -A`；勿提交 `.seedream-backup`、`deploy/`、`q.js`

## File map

| File | Responsibility |
|------|----------------|
| `apps/web/src/components/canvas/refine/maskWand.ts` | `clampWandTolerance`、`parseFillHex`、`floodFillMask`、`invertMaskRgba` |
| `apps/web/src/components/canvas/refine/maskWand.test.ts` | 上述纯函数单测 |
| `apps/web/src/stores/canvasEditor.ts` | `RefineMaskTool` 加 `'wand'`；`refineWandTolerance`；handle `invert` |
| `apps/web/src/stores/canvasEditor.refine.test.ts` | wand 复位断言 |
| `apps/web/src/components/canvas/refine/MaskEditor.vue` | wand 单击 fill；`invert()`；缓存底图 RGBA |
| `apps/web/src/components/canvas/refine/RefineWorkViewport.vue` | 传入 `wand-tolerance` |
| `apps/web/src/components/canvas/refine/RefineSidePanel.vue` | 魔棒 + 容差 + 反向；禁用「抠图」 |

---

### Task 0: 分支

- [ ] **Step 1:** 当前应在已含 toolchain spec 的 `docs/cx-image-edit-toolchain`（commit 含 `2026-08-19-cx-image-edit-toolchain-design.md`）。

```bash
git checkout docs/cx-image-edit-toolchain
git checkout -b feature/cx-image-edit-toolchain
```

- [ ] **Step 2:** 基线测试

```bash
pnpm --filter @lnkpi/web test -- src/stores/canvasEditor.refine.test.ts src/components/canvas/refine/maskExport.test.ts
```

Expected: PASS

---

### Task 1: 魔棒 / 反向纯函数

**Files:**
- Create: `apps/web/src/components/canvas/refine/maskWand.ts`
- Create: `apps/web/src/components/canvas/refine/maskWand.test.ts`

**Interfaces:**
- Produces:
  - `export function clampWandTolerance(n: number): number`
  - `export function parseFillHex(color: string): [number, number, number]`
  - `export function floodFillMask(input: { width: number; height: number; imageRgba: Uint8ClampedArray; maskRgba: Uint8ClampedArray; x: number; y: number; tolerance: number; fillRgb: [number, number, number] }): Uint8ClampedArray`
  - `export function invertMaskRgba(maskRgba: Uint8ClampedArray): Uint8ClampedArray`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/canvas/refine/maskWand.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { clampWandTolerance, floodFillMask, invertMaskRgba, parseFillHex } from './maskWand'

function rgba(pixels: number[]): Uint8ClampedArray {
  return new Uint8ClampedArray(pixels)
}

describe('clampWandTolerance', () => {
  it('clamps to 0–48 and defaults non-finite to 24', () => {
    expect(clampWandTolerance(-1)).toBe(0)
    expect(clampWandTolerance(49)).toBe(48)
    expect(clampWandTolerance(24.6)).toBe(25)
    expect(clampWandTolerance(Number.NaN)).toBe(24)
  })
})

describe('parseFillHex', () => {
  it('parses #rrggbb and falls back to white', () => {
    expect(parseFillHex('#22d3ee')).toEqual([34, 211, 238])
    expect(parseFillHex('bad')).toEqual([255, 255, 255])
  })
})

describe('floodFillMask', () => {
  it('fills a 4-connected same-color run and leaves other pixels', () => {
    // 3x1: red, red, blue
    const image = rgba([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255])
    const mask = rgba(new Array(12).fill(0))
    const next = floodFillMask({
      width: 3,
      height: 1,
      imageRgba: image,
      maskRgba: mask,
      x: 0,
      y: 0,
      tolerance: 0,
      fillRgb: [255, 255, 255],
    })
    expect([...next.slice(0, 8)]).toEqual([255, 255, 255, 255, 255, 255, 255, 255])
    expect([...next.slice(8, 12)]).toEqual([0, 0, 0, 0])
  })

  it('does not fill diagonally and respects tolerance', () => {
    // 2x2: R B / B R  — click (0,0) tol 0 fills only one pixel
    const image = rgba([
      255, 0, 0, 255, 0, 0, 255, 255,
      0, 0, 255, 255, 255, 0, 0, 255,
    ])
    const mask = rgba(new Array(16).fill(0))
    const next = floodFillMask({
      width: 2,
      height: 2,
      imageRgba: image,
      maskRgba: mask,
      x: 0,
      y: 0,
      tolerance: 0,
      fillRgb: [9, 9, 9],
    })
    expect([...next.slice(0, 4)]).toEqual([9, 9, 9, 255])
    expect([...next.slice(4, 8)]).toEqual([0, 0, 0, 0])
    expect([...next.slice(8, 12)]).toEqual([0, 0, 0, 0])
    expect([...next.slice(12, 16)]).toEqual([0, 0, 0, 0])
  })

  it('returns the original mask buffer unchanged on invalid input', () => {
    const mask = rgba([1, 2, 3, 4])
    const out = floodFillMask({
      width: 2,
      height: 2,
      imageRgba: rgba([0, 0, 0, 255]),
      maskRgba: mask,
      x: 0,
      y: 0,
      tolerance: 0,
      fillRgb: [255, 255, 255],
    })
    expect(out).toBe(mask)
  })

  it('covers more pixels when tolerance increases on a gradient', () => {
    const image = rgba([0, 0, 0, 255, 20, 0, 0, 255, 40, 0, 0, 255])
    const empty = () => rgba(new Array(12).fill(0))
    const tight = floodFillMask({
      width: 3,
      height: 1,
      imageRgba: image,
      maskRgba: empty(),
      x: 0,
      y: 0,
      tolerance: 10,
      fillRgb: [255, 255, 255],
    })
    const wide = floodFillMask({
      width: 3,
      height: 1,
      imageRgba: image,
      maskRgba: empty(),
      x: 0,
      y: 0,
      tolerance: 40,
      fillRgb: [255, 255, 255],
    })
    const count = (m: Uint8ClampedArray) => {
      let n = 0
      for (let i = 3; i < m.length; i += 4) if (m[i] > 127) n += 1
      return n
    }
    expect(count(tight)).toBe(1)
    expect(count(wide)).toBe(3)
  })
})

describe('invertMaskRgba', () => {
  it('swaps opaque edit pixels with empty keep pixels as white+A255', () => {
    const mask = rgba([255, 255, 255, 255, 0, 0, 0, 0])
    const next = invertMaskRgba(mask)
    expect([...next]).toEqual([0, 0, 0, 0, 255, 255, 255, 255])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @lnkpi/web test -- src/components/canvas/refine/maskWand.test.ts
```

Expected: FAIL (module not found)

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/components/canvas/refine/maskWand.ts`:

```ts
export function clampWandTolerance(n: number): number {
  if (!Number.isFinite(n)) return 24
  return Math.min(48, Math.max(0, Math.round(n)))
}

export function parseFillHex(color: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{6})$/.exec(color.trim())
  if (!m) return [255, 255, 255]
  const n = Number.parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function invertMaskRgba(maskRgba: Uint8ClampedArray): Uint8ClampedArray {
  const next = new Uint8ClampedArray(maskRgba)
  for (let i = 0; i < next.length; i += 4) {
    if (next[i + 3] > 127) {
      next[i] = 0
      next[i + 1] = 0
      next[i + 2] = 0
      next[i + 3] = 0
    } else {
      next[i] = 255
      next[i + 1] = 255
      next[i + 2] = 255
      next[i + 3] = 255
    }
  }
  return next
}

export function floodFillMask(input: {
  width: number
  height: number
  imageRgba: Uint8ClampedArray
  maskRgba: Uint8ClampedArray
  x: number
  y: number
  tolerance: number
  fillRgb: [number, number, number]
}): Uint8ClampedArray {
  const { width, height, imageRgba, maskRgba, fillRgb } = input
  const expected = width * height * 4
  if (
    width <= 0 ||
    height <= 0 ||
    imageRgba.length !== expected ||
    maskRgba.length !== expected
  ) {
    return maskRgba
  }
  const x0 = Math.floor(input.x)
  const y0 = Math.floor(input.y)
  if (x0 < 0 || y0 < 0 || x0 >= width || y0 >= height) return maskRgba

  const next = new Uint8ClampedArray(maskRgba)
  const seed = (y0 * width + x0) * 4
  const sr = imageRgba[seed]
  const sg = imageRgba[seed + 1]
  const sb = imageRgba[seed + 2]
  const tol = clampWandTolerance(input.tolerance)
  const seen = new Uint8Array(width * height)
  const qx = [x0]
  const qy = [y0]
  seen[y0 * width + x0] = 1

  const inTol = (ix: number, iy: number) => {
    const o = (iy * width + ix) * 4
    const dr = Math.abs(imageRgba[o] - sr)
    const dg = Math.abs(imageRgba[o + 1] - sg)
    const db = Math.abs(imageRgba[o + 2] - sb)
    return Math.max(dr, dg, db) <= tol
  }

  while (qx.length) {
    const x = qx.pop()!
    const y = qy.pop()!
    const o = (y * width + x) * 4
    next[o] = fillRgb[0]
    next[o + 1] = fillRgb[1]
    next[o + 2] = fillRgb[2]
    next[o + 3] = 255
    const nbs = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]
    for (const [nx, ny] of nbs) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const idx = ny * width + nx
      if (seen[idx]) continue
      if (!inTol(nx, ny)) continue
      seen[idx] = 1
      qx.push(nx)
      qy.push(ny)
    }
  }
  return next
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @lnkpi/web test -- src/components/canvas/refine/maskWand.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/canvas/refine/maskWand.ts apps/web/src/components/canvas/refine/maskWand.test.ts
git commit -m "feat(web): add mask wand flood-fill and invert helpers"
```

---

### Task 2: Store 工具与容差

**Files:**
- Modify: `apps/web/src/stores/canvasEditor.ts`
- Modify: `apps/web/src/stores/canvasEditor.refine.test.ts`

**Interfaces:**
- Consumes: `clampWandTolerance` from `maskWand.ts`
- Produces: `RefineMaskTool` includes `'wand'`; `refineWandTolerance`; `RefineMaskHandle.invert?: () => void`（实现于 Task 3，本任务类型先加上）

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/stores/canvasEditor.refine.test.ts`:

```ts
  it('resets wand tolerance when the session closes', () => {
    setActivePinia(createPinia())
    const editor = useCanvasEditorStore()
    editor.refineTool = 'wand'
    editor.setRefineWandTolerance(40)
    editor.openImageEditor({ nodeId: 'n1', url: 'https://cdn/a.png' })
    editor.closeImageEditor()
    expect(editor.refineTool).toBe('brush')
    expect(editor.refineWandTolerance).toBe(24)
  })
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @lnkpi/web test -- src/stores/canvasEditor.refine.test.ts
```

Expected: FAIL (`setRefineWandTolerance` / `refineWandTolerance` missing)

- [ ] **Step 3: Write minimal implementation**

In `apps/web/src/stores/canvasEditor.ts`:

- Change `export type RefineMaskTool = 'brush' | 'eraser' | 'rect' | 'wand'`
- Add to `RefineMaskHandle`: `invert: () => void`
- `import { clampWandTolerance } from '@/components/canvas/refine/maskWand'`
- `const refineWandTolerance = ref(24)`
- In `resetRefineChromeState`: `refineWandTolerance.value = 24`
- `function setRefineWandTolerance(n: number) { refineWandTolerance.value = clampWandTolerance(n) }`
- Export `refineWandTolerance` and `setRefineWandTolerance`

Existing tests that stub `registerRefineMask({ exportPng, clear, getCanvas })` must add `invert: () => {}`.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @lnkpi/web test -- src/stores/canvasEditor.refine.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/canvasEditor.ts apps/web/src/stores/canvasEditor.refine.test.ts
git commit -m "feat(web): track refine wand tool and tolerance"
```

---

### Task 3: MaskEditor 单击魔棒 + invert

**Files:**
- Modify: `apps/web/src/components/canvas/refine/MaskEditor.vue`
- Modify: `apps/web/src/components/canvas/refine/RefineWorkViewport.vue`

**Interfaces:**
- Consumes: `floodFillMask`, `invertMaskRgba`, `parseFillHex`; props `tool?: MaskTool` 含 `'wand'`；`wandTolerance?: number`
- Produces: `defineExpose.invert`；`RefineWorkViewport` 传入 `:wand-tolerance="editor.refineWandTolerance"`

- [ ] **Step 1:** 扩展 `MaskTool`:

```ts
export type MaskTool = 'brush' | 'eraser' | 'rect' | 'wand'
```

`withDefaults` 增加 `wandTolerance: 24`。

缓存底图：`let imageRgba: Uint8ClampedArray | null = null`。在 `resolveBitmapSize` 成功且 canvas 已定尺寸后，用 `new Image()` 画到离屏 canvas（`width/height` 与 mask 相同）`getImageData`。url 变化时清空缓存。

- [ ] **Step 2:** `onPointerDown`：若 `props.tool === 'wand'`：

```ts
  if (props.tool === 'wand') {
    if (!imageRgba) return
    const mask = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const filled = floodFillMask({
      width: canvas.width,
      height: canvas.height,
      imageRgba,
      maskRgba: mask.data,
      x: pt.x,
      y: pt.y,
      tolerance: props.wandTolerance ?? 24,
      fillRgb: parseFillHex(props.color),
    })
    ctx.putImageData(new ImageData(filled, canvas.width, canvas.height), 0, 0)
    emitCoverage()
    drawing = false
    return
  }
```

不要 `setPointerCapture` 后进入涂抹。`onPointerMove` 开头：`if (props.tool === 'wand') return`。

- [ ] **Step 3:** `function invertCanvas()`：读 mask `getImageData`，`invertMaskRgba`，`putImageData`，`emitCoverage`。`defineExpose({ ..., invert: invertCanvas })`。

- [ ] **Step 4:** `RefineWorkViewport.vue` 的 `MaskEditor` 增加 `:wand-tolerance="editor.refineWandTolerance"`。

- [ ] **Step 5:** 工作视口 `registerRefineMask` 处保证 handle 含 `invert: () => maskRef.value?.invert()`。

当前 `RefineWorkViewport` 若直接 `registerRefineMask({ exportPng, clear, getCanvas })`，改为：

```ts
editor.registerRefineMask({
  exportPng: () => maskRef.value!.exportPng(),
  clear: () => maskRef.value!.clear(),
  getCanvas: () => maskRef.value?.getCanvas() ?? null,
  invert: () => maskRef.value?.invert(),
})
```

（按文件里现有注册方式对齐，缺 invert 就补。）

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/canvas/refine/MaskEditor.vue apps/web/src/components/canvas/refine/RefineWorkViewport.vue
git commit -m "feat(web): apply wand flood-fill and invert on the work mask"
```

---

### Task 4: 侧栏选区行 + 禁用抠图

**Files:**
- Modify: `apps/web/src/components/canvas/refine/RefineSidePanel.vue`

**Interfaces:**
- Consumes: `editor.refineTool`、`setRefineWandTolerance`、`getRefineMask()?.invert`
- Produces: 选区行魔棒 / 容差 / 反向；作业行「抠图」`disabled` + `title="抠图将走专用通道，尚未接入"`

- [ ] **Step 1:** 在画笔组那一行 **之后**（同一 `refine-side__icon-row` 末尾或下一 `icon-row`，规格锁定魔棒行）增加：

魔棒按钮：`title="魔棒"`，`is-active` 当 `refineTool === 'wand'`，`@click="editor.refineTool = 'wand'"`。

`template v-if="editor.refineTool === 'wand'"`：

- 容差 `input range` min=0 max=48 step=1，`@input` 调 `editor.setRefineWandTolerance(Number(...))`（用方法 `onWandToleranceInput`，不要在模板里 `as HTMLInputElement`）
- 反向按钮 `title="反向选区"` `@click="editor.getRefineMask()?.invert()"`

点魔棒不要关掉画笔组；点画笔父按钮现有逻辑可把 `refineTool` 设回 `brush`，容差行随之隐藏。

- [ ] **Step 2:** 作业行「精修」按钮旁增加：

```html
<button type="button" class="refine-dock__apply" disabled title="抠图将走专用通道，尚未接入">抠图</button>
```

不要 `@click` 调 `runRefine` 或改 prompt。

- [ ] **Step 3:** Commit

```bash
git add apps/web/src/components/canvas/refine/RefineSidePanel.vue
git commit -m "feat(web): add wand controls and disabled cutout job slot"
```

---

### Task 5: 验收

- [ ] **Step 1:**

```bash
pnpm --filter @lnkpi/web test -- src/components/canvas/refine/maskWand.test.ts src/stores/canvasEditor.refine.test.ts src/components/canvas/refine/
```

Expected: PASS

- [ ] **Step 2:** 手测

1. 编辑图 → 魔棒单击色块出选区；容差变大覆盖变大  
2. 反向后 coverage / 全图警告符合 P1  
3. 画笔仍能改魔棒结果  
4. 「抠图」灰、title 正确；「精修」仍走原 inpaint  
5. 关精修再开，容差回到 24、工具回到画笔

- [ ] **Step 3:** 不要改 agent capabilities 测试。若误改，必须保持 `supportedModes` 仅 `inpaint`。

---

## Deferred（本计划禁止实现）

- SAM / 文本指代
- CutoutProvider、透明底、`remove_bg` capability
- 对照上下擦除 / 溶解 / 闪光
- 魔棒减选、全图同色（非连通）

## Spec coverage

| Spec | Task |
|------|------|
| floodFill 4 连通 + 容差 + 并入 | 1, 3 |
| invert 白=可编辑 | 1, 3 |
| 容差 0–48 默认 24、reset | 1, 2 |
| 侧栏魔棒下级容差 + 反向 | 4 |
| 抠图禁用、不冒充 inpaint | 4 |
| capabilities 仍 inpaint | 5（不改代码） |
| 对照不扩展 | 全局约束 |

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-19-cx-image-edit-toolchain.md`.
