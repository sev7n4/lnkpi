# WorkbenchShell 统一外壳 + 扩图完整打样 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把精修工作台的信息架构固化为可复用外壳（`WorkbenchShell` + 工具注册表），并以扩图作为第一个完整打样，落地竞品式 8 手柄 / 3×3 网格交互、右栏差异化参数面板与悬浮 dock。

**Architecture:** 新增 `components/canvas/workbench/WorkbenchShell.vue`（纯布局槽位，含 `useWorkbenchPanel` 的宽度 / 折叠 / 窄屏逻辑）与 `workbenchToolRegistry.ts`（每个工具声明 `panel` / `dock` / `dockPlacement` 三件套，不注册就没有 UI）。扩图的矩形状态源从 `RefineOutpaintCanvas` 组件 ref 上移到 store 成为权威草稿，画布与右栏面板同源双向同步；几何仍是逐边累积模型（PR #397/#398），只新增三个纯函数支撑比例预设与绝对值输入。纯前端，后端与提交链路零改动。

**Tech Stack:** Vue 3 `<script setup>` + TypeScript · Pinia · Vue Test Utils + Vitest（jsdom）· pnpm workspaces

**Spec:** `docs/superpowers/specs/2026-09-22-workbench-shell-and-outpaint-pilot-design.md`

## Global Constraints

下面每条都来自 spec，每个 Task 都隐含遵守：

1. **纯前端**：只动 `apps/web`。后端 / API / DTO 零改动；扩图提交链路（`computeOutpaintLayers` → `renderOutpaintPngs` → `studioApi.editImage`）语义不变。
2. **几何模型不动**：`resizeOutpaintRect`、`floorOutpaintRect`、`hasOutpaintExtension`、`HANDLE_MOVING_EDGES`、`initialOutpaintRect` 原样保留（逐边累积是 PR #398 的修复成果，不得回归）。禁止复活已被删除的 `clampOutpaintCanvas` / `Anchor`。
3. **clamp 常量**：`OUTPAINT_MIN_EDGE = 256`、`OUTPAINT_MAX_AREA_RATIO = 9`；四向扩展量恒 ≥ 0（扩图不裁剪，新画布恒完整包含原图）。
4. **dock 尺寸预算（§4.3）**：panel 落点默认态总高 ≤ **148px**，prompt 聚焦展开 ≤ **224px**；主 CTA = 圆形 `↑` 按钮（panel 32×32、floating 36×36），**禁用态同形同尺寸只降透明度**，禁止退化成无图标矩形。
5. **dock 内容归属（§4.3）**：dock 内不得出现「原图 {w}×{h} · {比例}」这类静态元信息徽标行。
6. **关闭语义（§4.4）**：× 的作用域 = 所在层级。select 的 dock 头排 × **移除**（`DockToolbarShell show-close=false`）；退出链 LIFO（扩图 → select → 画布）。
7. **CTA 文案统一「动词 + 对象」**：`扩图生成` / `精修`；面板落点按钮同规范。文案进 `aria-label` / `title`。
8. **本地验证四条（提交前必跑，顺序执行，不要并行跑 web 与 server 测试）**：
   `pnpm install --frozen-lockfile` → `pnpm --filter @lnkpi/server exec prisma generate` → `pnpm build` → `pnpm --filter @lnkpi/agent test`。
   web 侧：`pnpm --filter @lnkpi/web test` 全绿，**基线 976，只增不减**；`vue-tsc -b` 零错误。
9. **分支纪律**：禁止直接 push `main`；feature 分支 + PR + CI 全绿 + **Squash Merge**。
10. **保留的 data-testid 契约**（回归测试与目视脚本依赖）：`outpaint-handle-{dir}`、`outpaint-readout`（迁移到拖拽胶囊）、`dock-run`、`dock-apply`、`dock-model-select`、`dock-model-option`、`dock-size-select`、`dock-size-option`、`dock-edit-intent`、`dock-outpaint-hint`、`refine-rail`、`rail-input-{id}`、`rail-variant-{tool}`、`refine-dock`、`refine-compare-band`。
11. **规格配图规范**：本计划文档**不含图**（实现计划以代码为准，无需配图）。若后续在本计划内新增 mermaid / SVG 图，必须按 `docs/superpowers/SPEC-CONVENTIONS.md` 补图注 + §0 配图索引，并跑 `pnpm verify-spec-figures`。

## Review Focus

spec 未逐条写明、但实现必然遇到的输入与失败模式。每条都已落到具体 Task 的测试步骤：

1. **原图尺寸未知（`mediaInfo` 缺宽高 → base = 0×0）时进入扩图**：不得算出 NaN 矩形、不得把退化 rect 写进 store、CTA 必须禁用并显示引导（而不是可点但提交空蒙版）。→ Task 3 / Task 4 / Task 6。
2. **矩形含小数（拖拽逐帧写入 store）时右栏回填**：数字输入与四向读数必须显示落像素后的整数，不得出现 `-0`、`NaN`、或每帧抖动。→ Task 4。
3. **数字输入收到非法值（空串 / `abc` / 负数 / 0 / `1e9`）**：必须 clamp 或保持原值，禁止把 NaN 或超面积矩形写进 store。→ Task 2 / Task 4。
4. **busy 中改动矩形或切换工具（rail 点击 / Esc / 悬浮 dock ×）**：动作必须 no-op（不中断任务、不写坏 rect）。→ Task 2 / Task 6。
5. **窄屏 < 640px 与极端宽高比原图（如 4000×100）**：悬浮 dock 不得溢出或遮挡（须退化为面板落点）；比例预设不得产出 NaN 或面积失控的矩形。→ Task 1 / Task 9。

---

### Task 1: 扩图几何三纯函数

**Files:**
- Modify: `apps/web/src/components/canvas/refine/outpaintGeometry.ts`（在 `formatAspectLabel` 之后追加）
- Test: `apps/web/src/components/canvas/refine/outpaintGeometry.test.ts`（追加 describe 块）

**Interfaces:**
- Consumes: 本文件已有的 `Size`、`OutpaintRect`、`OUTPAINT_MIN_EDGE`、`OUTPAINT_MAX_AREA_RATIO`、`initialOutpaintRect`、`floorOutpaintRect`。
- Produces（后续 Task 依赖的精确签名）：
  - `fitRectToAspect(base: Size, ratio: { w: number; h: number } | null): OutpaintRect`
  - `resizeOutpaintAbsolute(base: Size, width: number, height: number): OutpaintRect`
  - `outpaintExtensionAmounts(base: Size, rect: OutpaintRect): { west: number; east: number; north: number; south: number }`

- [ ] **Step 1: 写失败测试**

追加到 `apps/web/src/components/canvas/refine/outpaintGeometry.test.ts`（文件顶部 import 需补上三个新函数名）：

```ts
// 注意：文件顶部 import 补上 fitRectToAspect, resizeOutpaintAbsolute, outpaintExtensionAmounts

describe('fitRectToAspect', () => {
  const BASE = { width: 400, height: 300 }

  it('1:1 → 以宽度为准的正方形（高度从 300 抬到 400）', () => {
    expect(fitRectToAspect(BASE, { w: 1, h: 1 })).toEqual({ x: 0, y: 50, width: 400, height: 400 })
  })

  it('16:9 → 以宽度为准（高度 225 < 300，故改用高度为准）', () => {
    const r = fitRectToAspect(BASE, { w: 16, h: 9 })
    expect(r.width).toBeCloseTo(533.333, 3)
    expect(r.height).toBeCloseTo(300, 3)
    expect(r.x).toBeCloseTo(66.667, 3)
    expect(r.y).toBeCloseTo(0, 3)
  })

  it('比例精确：width / height 恒等于目标比例', () => {
    for (const ratio of [{ w: 1, h: 1 }, { w: 4, h: 3 }, { w: 3, h: 4 }, { w: 16, h: 9 }, { w: 9, h: 16 }]) {
      const r = fitRectToAspect({ width: 512, height: 768 }, ratio)
      expect(r.width / r.height).toBeCloseTo(ratio.w / ratio.h, 6)
    }
  })

  it('恒包含原图且四向扩展量 ≥ 0', () => {
    const r = fitRectToAspect(BASE, { w: 9, h: 16 })
    expect(r.width).toBeGreaterThanOrEqual(BASE.width)
    expect(r.height).toBeGreaterThanOrEqual(BASE.height)
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.y).toBeGreaterThanOrEqual(0)
    const amounts = outpaintExtensionAmounts(BASE, r)
    for (const v of Object.values(amounts)) expect(v).toBeGreaterThanOrEqual(0)
  })

  it('原图比例基准（尺寸小于下限）：画布至少抬到 256', () => {
    const r = fitRectToAspect({ width: 100, height: 100 }, { w: 1, h: 1 })
    expect(r).toEqual({ x: 0, y: 0, width: 256, height: 256 })
  })

  it('极端宽高比（4000×100）不得产出 NaN 或负偏移', () => {
    const r = fitRectToAspect({ width: 4000, height: 100 }, { w: 9, h: 16 })
    expect(Number.isFinite(r.width)).toBe(true)
    expect(Number.isFinite(r.height)).toBe(true)
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.y).toBeGreaterThanOrEqual(0)
    expect(r.width).toBeGreaterThanOrEqual(4000)
    expect(r.height).toBeGreaterThanOrEqual(100)
  })

  it('ratio 为 null / 非法 / 原图尺寸非法 → 等价 initialOutpaintRect', () => {
    expect(fitRectToAspect(BASE, null)).toEqual(initialOutpaintRect(BASE))
    expect(fitRectToAspect(BASE, { w: 0, h: 0 })).toEqual(initialOutpaintRect(BASE))
    expect(fitRectToAspect({ width: 0, height: 0 }, { w: 1, h: 1 })).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})

describe('resizeOutpaintAbsolute', () => {
  const BASE = { width: 400, height: 300 }

  it('等比放大：扩展量在两轴对称均分', () => {
    expect(resizeOutpaintAbsolute(BASE, 600, 500)).toEqual({ x: 100, y: 100, width: 600, height: 500 })
  })

  it('奇数像素差：多出的 1px 给右侧 / 下方', () => {
    expect(resizeOutpaintAbsolute(BASE, 501, 300)).toEqual({ x: 50, y: 0, width: 501, height: 300 })
    expect(resizeOutpaintAbsolute(BASE, 400, 301)).toEqual({ x: 0, y: 0, width: 400, height: 301 })
  })

  it('小于原图的输入被抬到原图尺寸（扩图不裁剪）', () => {
    expect(resizeOutpaintAbsolute(BASE, 200, 200)).toEqual({ x: 0, y: 0, width: 400, height: 300 })
  })

  it('零 / 负数 / 超大输入被 clamp，不产生负扩展量', () => {
    expect(resizeOutpaintAbsolute(BASE, 0, -5)).toEqual({ x: 0, y: 0, width: 400, height: 300 })
    expect(resizeOutpaintAbsolute(BASE, -100, -100)).toEqual({ x: 0, y: 0, width: 400, height: 300 })
    const huge = resizeOutpaintAbsolute(BASE, 1e9, 1e9)
    expect(huge.width).toBeLessThanOrEqual(1e9)
    expect(huge.width * huge.height).toBeLessThanOrEqual(9 * 400 * 300)
    expect(huge.x).toBeGreaterThanOrEqual(0)
    expect(huge.y).toBeGreaterThanOrEqual(0)
  })

  it('小于 256 下限的原图：画布该轴抬到 256', () => {
    expect(resizeOutpaintAbsolute({ width: 100, height: 100 }, 100, 100)).toEqual({
      x: 0, y: 0, width: 256, height: 256,
    })
  })

  it('面积超上限（9 倍）时等比收缩并保持包含原图', () => {
    const r = resizeOutpaintAbsolute(BASE, 4000, 4000)
    expect(r.width * r.height).toBeLessThanOrEqual(9 * 400 * 300)
    expect(r.width).toBeGreaterThanOrEqual(400)
    expect(r.height).toBeGreaterThanOrEqual(300)
  })

  it('非法输入（NaN / Infinity）→ 等价 initialOutpaintRect', () => {
    expect(resizeOutpaintAbsolute(BASE, Number.NaN, 500)).toEqual(initialOutpaintRect(BASE))
    expect(resizeOutpaintAbsolute(BASE, 500, Number.POSITIVE_INFINITY)).toEqual(initialOutpaintRect(BASE))
  })
})

describe('outpaintExtensionAmounts', () => {
  const BASE = { width: 400, height: 300 }

  it('四向各自独立读数', () => {
    expect(outpaintExtensionAmounts(BASE, { x: 30, y: 10, width: 500, height: 350 })).toEqual({
      west: 30, east: 70, north: 10, south: 40,
    })
  })

  it('未扩展时为全 0', () => {
    expect(outpaintExtensionAmounts(BASE, initialOutpaintRect(BASE))).toEqual({
      west: 0, east: 0, north: 0, south: 0,
    })
  })

  it('负数偏移与小于原图的矩形被夹到 0（不出现负扩展量）', () => {
    expect(outpaintExtensionAmounts(BASE, { x: -20, y: -5, width: 300, height: 200 })).toEqual({
      west: 0, east: 0, north: 0, south: 0,
    })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @lnkpi/web test -- src/components/canvas/refine/outpaintGeometry.test.ts`
Expected: FAIL —— `fitRectToAspect is not a function`（三个函数尚未导出）。

- [ ] **Step 3: 最小实现**

在 `apps/web/src/components/canvas/refine/outpaintGeometry.ts` 的 `formatAspectLabel` 之后追加：

```ts
/**
 * 比例预设：返回「包含原图、面积最小、比例精确等于 ratio」的新画布矩形。
 *
 * 语义与拖拽不同：**替换**当前 rect，不做累积（§6.2）。ratio 为 null = 原图，
 * 等价 initialOutpaintRect。扩展量在两轴对称均分（x = (w - bw) / 2），允许小数，
 * 对外落像素由 floorOutpaintRect 负责。
 *
 * 两轴下界 max(base, OUTPAINT_MIN_EDGE) 同时参与解算：先取宽度下界，若算出高度
 * 不足高度下界，则以高度下界反解宽度——保证「该比例 + 包含原图 + 单边 ≥256」三条同时成立。
 *
 * 面积上限（§8）只在「最小包含矩形本身已在上限内」时有收缩空间；若最小包含矩形就超上限，
 * **包含原图是硬不变量**，直接返回该矩形（极端比例原图，如 4000×100 选 9:16）。
 */
export function fitRectToAspect(base: Size, ratio: { w: number; h: number } | null): OutpaintRect {
  const bw = Math.max(0, base.width)
  const bh = Math.max(0, base.height)
  if (!ratio || !(ratio.w > 0) || !(ratio.h > 0) || !(bw > 0) || !(bh > 0)) {
    return initialOutpaintRect(base)
  }
  const target = ratio.w / ratio.h
  const minW = Math.max(bw, OUTPAINT_MIN_EDGE)
  const minH = Math.max(bh, OUTPAINT_MIN_EDGE)

  let width = Math.max(minW, minH * target)
  let height = width / target

  const maxArea = OUTPAINT_MAX_AREA_RATIO * bw * bh
  if (width * height > maxArea) {
    const scale = Math.sqrt(maxArea / (width * height))
    const candW = width * scale
    const candH = height * scale
    // 收缩后仍须包含原图，否则保持最小包含矩形（包含原图优先）
    if (candW >= bw && candH >= bh) {
      width = candW
      height = candH
    }
  }

  return { x: (width - bw) / 2, y: (height - bh) / 2, width, height }
}

/**
 * 画布尺寸数字输入：绝对值语义（不是增量），落像素为整数。
 *
 * clamp：`w ≥ max(baseW, 256)`、`h ≥ max(baseH, 256)`（扩图不裁剪 + 单边下限），
 * 面积超 9 倍时两轴等比收缩（同样不低于上述下界）。扩展量在两轴**对称均分**，
 * 奇数像素差多的 1px 给右侧 / 下方（§6.2）。
 *
 * 非法输入（NaN / ±Infinity）等价 initialOutpaintRect，绝不把 NaN 写进状态。
 */
export function resizeOutpaintAbsolute(base: Size, width: number, height: number): OutpaintRect {
  const bw = Math.max(0, base.width)
  const bh = Math.max(0, base.height)
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return initialOutpaintRect(base)
  }
  const minW = Math.max(bw, OUTPAINT_MIN_EDGE)
  const minH = Math.max(bh, OUTPAINT_MIN_EDGE)

  let w = Math.max(minW, Math.round(width))
  let h = Math.max(minH, Math.round(height))

  const maxArea = OUTPAINT_MAX_AREA_RATIO * bw * bh
  if (maxArea > 0 && w * h > maxArea) {
    const scale = Math.sqrt(maxArea / (w * h))
    w = Math.max(minW, Math.floor(w * scale))
    h = Math.max(minH, Math.floor(h * scale))
  }

  const west = Math.floor(Math.max(0, w - bw) / 2)
  const north = Math.floor(Math.max(0, h - bh) / 2)
  return { x: west, y: north, width: w, height: h }
}

/**
 * 四向扩展量（读数用，只读）。调用方传 `floorOutpaintRect` 之后的矩形，
 * 使读数与提交几何一致。四值恒 ≥ 0（扩图不裁剪，负向一律夹到 0）。
 */
export function outpaintExtensionAmounts(
  base: Size,
  rect: OutpaintRect,
): { west: number; east: number; north: number; south: number } {
  const bw = Math.max(0, base.width)
  const bh = Math.max(0, base.height)
  return {
    west: Math.max(0, Math.round(rect.x)),
    east: Math.max(0, Math.round(rect.width - rect.x - bw)),
    north: Math.max(0, Math.round(rect.y)),
    south: Math.max(0, Math.round(rect.height - rect.y - bh)),
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @lnkpi/web test -- src/components/canvas/refine/outpaintGeometry.test.ts`
Expected: PASS（含原有 `resizeOutpaintRect` 全部用例）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/canvas/refine/outpaintGeometry.ts apps/web/src/components/canvas/refine/outpaintGeometry.test.ts
git commit -m "feat(refine): 扩图几何新增 fitRectToAspect / resizeOutpaintAbsolute / outpaintExtensionAmounts"
```

---

### Task 2: store 扩图基准 + 三个动作

**Files:**
- Modify: `apps/web/src/stores/canvasEditor.ts`
- Test: `apps/web/src/stores/canvasEditor.refine.test.ts`（追加 describe 块）

**Interfaces:**
- Consumes: Task 1 的 `fitRectToAspect`、`resizeOutpaintAbsolute`、`initialOutpaintRect`（`outpaintGeometry.ts`），已有 `refineOutpaintRect`、`refineMode`、`refineBusy`、`setRefineOutpaintRect`、`setRefineMode`。
- Produces（后续 Task 依赖）：
  - state `refineOutpaintBase: Ref<Size | null>`
  - `setRefineOutpaintBase(size: Size | null): void`
  - `applyOutpaintAspectPreset(ratio: { w: number; h: number } | null): void`
  - `applyOutpaintSize(width: number, height: number): void`
  - `resetOutpaintRect(): void`

> **对 spec §7 的一处必要补充（记录在案）**：§7 给三个 action 的签名不含 `base`，但三者的实现都需要原图尺寸。因此新增 `refineOutpaintBase` 作为「扩图基准」，进入扩图模式时由 `RefineOutpaintCanvas` 写入，退出时清空——避免把 `base` 逐层穿透 props 到每个 action。

- [ ] **Step 1: 写失败测试**

追加到 `apps/web/src/stores/canvasEditor.refine.test.ts`（文件顶部按需补 `initialOutpaintRect`、`outpaintExtensionAmounts` 的 import）：

```ts
describe('扩图基准与面板动作（§7）', () => {
  const BASE = { width: 400, height: 300 }

  beforeEach(() => {
    const editor = useCanvasEditorStore()
    editor.refineMode = 'outpaint'
    editor.setRefineOutpaintBase(BASE)
    editor.setRefineOutpaintRect(initialOutpaintRect(BASE))
  })

  it('applyOutpaintAspectPreset(1:1) → 对称扩展，rect 可被 hasOutpaintExtension 识别', () => {
    const editor = useCanvasEditorStore()
    editor.applyOutpaintAspectPreset({ w: 1, h: 1 })
    const rect = editor.refineOutpaintRect!
    expect(rect.width).toBe(400)
    expect(rect.height).toBe(400)
    expect(hasOutpaintExtension(BASE, rect)).toBe(true)
    expect(outpaintExtensionAmounts(BASE, rect)).toEqual({ west: 0, east: 0, north: 50, south: 50 })
  })

  it('applyOutpaintAspectPreset(null) → 等价 resetOutpaintRect', () => {
    const editor = useCanvasEditorStore()
    editor.applyOutpaintAspectPreset({ w: 9, h: 16 })
    editor.applyOutpaintAspectPreset(null)
    expect(editor.refineOutpaintRect).toEqual(initialOutpaintRect(BASE))
  })

  it('applyOutpaintSize(600, 500) → 绝对值语义 + 对称均分', () => {
    const editor = useCanvasEditorStore()
    editor.applyOutpaintSize(600, 500)
    expect(editor.refineOutpaintRect).toEqual({ x: 100, y: 100, width: 600, height: 500 })
  })

  it('applyOutpaintSize 收到非法值 → 保持合法值（不写 NaN）', () => {
    const editor = useCanvasEditorStore()
    editor.applyOutpaintSize(600, 500)
    editor.applyOutpaintSize(Number.NaN, 500)
    expect(editor.refineOutpaintRect).toEqual(initialOutpaintRect(BASE))
  })

  it('resetOutpaintRect() → 恢复原图矩形', () => {
    const editor = useCanvasEditorStore()
    editor.applyOutpaintSize(600, 500)
    editor.resetOutpaintRect()
    expect(editor.refineOutpaintRect).toEqual(initialOutpaintRect(BASE))
  })

  it('基准缺失（未进入扩图）时三个动作均 no-op', () => {
    const editor = useCanvasEditorStore()
    editor.setRefineOutpaintBase(null)
    editor.setRefineOutpaintRect(null)
    editor.applyOutpaintAspectPreset({ w: 1, h: 1 })
    editor.applyOutpaintSize(600, 500)
    editor.resetOutpaintRect()
    expect(editor.refineOutpaintRect).toBeNull()
  })

  it('busy 时三个动作均 no-op（不打断任务、不写坏 rect）', () => {
    const editor = useCanvasEditorStore()
    const before = editor.refineOutpaintRect
    editor.setRefineBusy(true)
    editor.applyOutpaintAspectPreset({ w: 1, h: 1 })
    editor.applyOutpaintSize(600, 500)
    editor.resetOutpaintRect()
    expect(editor.refineOutpaintRect).toEqual(before)
    editor.setRefineBusy(false)
  })

  it('setRefineMode("select") 同时清空 rect 与基准', () => {
    const editor = useCanvasEditorStore()
    editor.setRefineMode('select')
    expect(editor.refineOutpaintRect).toBeNull()
    expect(editor.refineOutpaintBase).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @lnkpi/web test -- src/stores/canvasEditor.refine.test.ts`
Expected: FAIL —— `editor.setRefineOutpaintBase is not a function`。

- [ ] **Step 3: 最小实现**

在 `apps/web/src/stores/canvasEditor.ts` 中：

① 顶部 import 改为：

```ts
import {
  fitRectToAspect,
  initialOutpaintRect,
  resizeOutpaintAbsolute,
  type OutpaintRect,
  type Size,
} from '@/components/canvas/refine/outpaintGeometry'
```

② 在 `refineOutpaintRect` 声明之后新增基准字段：

```ts
  /** 扩图基准（原图尺寸）：进入扩图模式时由 RefineOutpaintCanvas 写入，供预设 / 尺寸输入 / 读数共用。 */
  const refineOutpaintBase = ref<Size | null>(null)
```

③ `resetRefineChromeState()` 内，`refineOutpaintRect.value = null` 之后补一行：

```ts
    refineOutpaintBase.value = null
```

④ 在 `setRefineMode` 内，把「退出即重置」扩展到基准：

```ts
  function setRefineMode(mode: RefineMode) {
    if (refineBusy.value) return
    if (mode === 'select') {
      refineOutpaintRect.value = null
      refineOutpaintBase.value = null
    }
    refineMode.value = mode
  }
```

⑤ 在 `setRefineOutpaintRect` 之后追加基准写入与三个动作：

```ts
  /** 写入扩图基准（原图尺寸）。null = 退出扩图，后续三个面板动作随之 no-op。 */
  function setRefineOutpaintBase(size: Size | null) {
    refineOutpaintBase.value = size
  }

  /** 扩图面板动作的公共前置：busy 或基准缺失时不改状态。 */
  function outpaintActionReady(): boolean {
    const base = refineOutpaintBase.value
    return !refineBusy.value && !!base && base.width > 0 && base.height > 0
  }

  /** 比例预设：以包含原图的最小该比例矩形重算画布（替换，非累积）。null = 恢复原图。 */
  function applyOutpaintAspectPreset(ratio: { w: number; h: number } | null) {
    if (!outpaintActionReady()) return
    refineOutpaintRect.value = fitRectToAspect(refineOutpaintBase.value!, ratio)
  }

  /** 画布尺寸数字输入：绝对值语义，内部 clamp（单边 ≥256、面积 ≤9 倍、恒包含原图）。 */
  function applyOutpaintSize(width: number, height: number) {
    if (!outpaintActionReady()) return
    refineOutpaintRect.value = resizeOutpaintAbsolute(refineOutpaintBase.value!, width, height)
  }

  /** 重置为原图矩形（等效「原图」比例预设）。 */
  function resetOutpaintRect() {
    if (!outpaintActionReady()) return
    refineOutpaintRect.value = initialOutpaintRect(refineOutpaintBase.value!)
  }
```

⑥ 返回对象里，紧跟 `refineOutpaintRect,` 之后补：

```ts
    refineOutpaintBase,
```

并在 `setRefineOutpaintRect,` 之后补：

```ts
    setRefineOutpaintBase,
    applyOutpaintAspectPreset,
    applyOutpaintSize,
    resetOutpaintRect,
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @lnkpi/web test -- src/stores/canvasEditor.refine.test.ts`
Expected: PASS（含原有 refine store 用例）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/stores/canvasEditor.ts apps/web/src/stores/canvasEditor.refine.test.ts
git commit -m "feat(refine): store 扩图基准 + 比例预设/绝对尺寸/重置三个动作（busy 与基准守卫）"
```

---

### Task 3: 扩图画布 —— 手柄形状 / 3×3 网格 / 顶部胶囊 / rect 上移 store

**Files:**
- Modify: `apps/web/src/components/canvas/refine/RefineOutpaintCanvas.vue`
- Test: `apps/web/src/components/canvas/refine/RefineOutpaintCanvas.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `fitRectToAspect`（不直接用）、`floorOutpaintRect`、`formatAspectLabel`、`resizeOutpaintRect`、`hasOutpaintExtension`；Task 2 的 `editor.refineOutpaintRect` / `setRefineOutpaintRect` / `setRefineOutpaintBase`。
- Produces（后续 Task 依赖）：
  - store 的 `refineOutpaintRect` 成为唯一权威草稿（含小数）；
  - DOM 契约：`[data-testid="outpaint-drag-badge"]`（拖拽中顶部尺寸胶囊）、`[data-testid="outpaint-grid"]`（拖拽中 3×3 网格）、`[data-testid="outpaint-handle-{dir}"]`（8 个手柄，保持不变）；**删除** `[data-testid="outpaint-readout"]`。

- [ ] **Step 1: 改写测试（先红）**

修改 `apps/web/src/components/canvas/refine/RefineOutpaintCanvas.test.ts`：

① 把手柄读数辅助函数改为读 store（因为底部读数条被移除，落像素后的权威值在 store）：

```ts
const readoutDims = (w: ReturnType<typeof mountCanvas>) => {
  void w
  const rect = useCanvasEditorStore().refineOutpaintRect
  return { w: Math.floor(rect?.width ?? 0), h: Math.floor(rect?.height ?? 0) }
}
```

② 删除/改写所有基于 `[data-testid="outpaint-readout"]` 的断言：把「渲染 8 个拖拽手柄与实时读数」改为：

```ts
  it('渲染 8 个拖拽手柄，且不再有底部读数条', () => {
    const w = mountCanvas()
    for (const dir of HANDLES) {
      expect(w.find(`[data-testid="outpaint-handle-${dir}"]`).exists()).toBe(true)
    }
    expect(w.find('[data-testid="outpaint-readout"]').exists()).toBe(false)
  })

  it('进入扩图即把初始矩形写入 store（画布与面板同源）', () => {
    mountCanvas()
    expect(useCanvasEditorStore().refineOutpaintRect).toEqual({ x: 0, y: 0, width: 400, height: 300 })
    expect(useCanvasEditorStore().refineOutpaintBase).toEqual({ width: 400, height: 300 })
  })

  it('原图尺寸未知（0×0）时不写退化矩形：store 保持 null（守卫据此禁用 CTA）', () => {
    mountCanvas({ baseWidth: 0, baseHeight: 0 })
    expect(useCanvasEditorStore().refineOutpaintRect).toBeNull()
    expect(useCanvasEditorStore().refineOutpaintBase).toEqual({ width: 0, height: 0 })
  })

  it('角手柄与边手柄带各自的形状类（角圆 / 边胶囊的样式挂点）', () => {
    const w = mountCanvas()
    for (const dir of ['nw', 'ne', 'se', 'sw']) {
      expect(w.find(`[data-testid="outpaint-handle-${dir}"]`).classes()).toContain(`refine-outpaint__handle--${dir}`)
    }
    for (const dir of ['n', 'e', 's', 'w']) {
      expect(w.find(`[data-testid="outpaint-handle-${dir}"]`).classes()).toContain(`refine-outpaint__handle--${dir}`)
    }
  })
```

③ 新增拖拽反馈用例：

```ts
  it('拖拽中显示 3×3 网格与顶部尺寸胶囊，松手后消失且范围保留', async () => {
    const w = mountCanvas()
    const handle = w.find('[data-testid="outpaint-handle-e"]')
    handle.element.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0 }))
    window.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 120, clientY: 0 }))
    await flushPromises()

    expect(w.find('[data-testid="outpaint-grid"]').exists()).toBe(true)
    const badge = w.find('[data-testid="outpaint-drag-badge"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('520 × 300')

    window.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }))
    await flushPromises()
    expect(w.find('[data-testid="outpaint-grid"]').exists()).toBe(false)
    expect(w.find('[data-testid="outpaint-drag-badge"]').exists()).toBe(false)
    // 松手 = 确定范围，不生成：rect 留在 store
    expect(readoutDims(w)).toEqual({ w: 520, h: 300 })
  })
```

④ 新增「面板改动 → 画布即时反映」用例：

```ts
  it('store 侧改动（比例预设）即时反映到画布矩形', async () => {
    const w = mountCanvas()
    useCanvasEditorStore().applyOutpaintAspectPreset({ w: 1, h: 1 })
    await flushPromises()
    expect(readoutDims(w)).toEqual({ w: 400, h: 400 })
  })
```

⑤ 保留 PR #398 的多边不互吞回归用例，但断言改读 store（`readoutDims` 已改为读 store，用例体不用改）。**执行时先跑一遍确认这些步骤 1 的改动会让测试变红。**

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @lnkpi/web test -- src/components/canvas/refine/RefineOutpaintCanvas.test.ts`
Expected: FAIL —— `[data-testid="outpaint-drag-badge"]` 不存在；`refineOutpaintBase` 仍为 null。

- [ ] **Step 3: 实现**

修改 `apps/web/src/components/canvas/refine/RefineOutpaintCanvas.vue`：

① script 顶部 import 调整为：

```ts
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import {
  HANDLE_DIRS,
  floorOutpaintRect,
  formatAspectLabel,
  initialOutpaintRect,
  resizeOutpaintRect,
  type HandleDir,
  type OutpaintRect,
  type Size,
} from './outpaintGeometry'
```

② 用 store 权威草稿替换组件内 `rect` ref —— 删掉原 `const rect = ref<OutpaintRect>(initialOutpaintRect(base.value))` 与它下面的 `watch(base, ...)` 和 `watch(viewRect, ...)`，替换为：

```ts
/** 权威草稿在 store（画布 / 右栏面板同源，§6.1 状态源、§7）。本组件只负责拖拽增量写入。 */
const rect = computed<OutpaintRect>(() => editor.refineOutpaintRect ?? initialOutpaintRect(base.value))

/** 落像素后的矩形：读数、底图贴位与提交链路消费。 */
const viewRect = computed(() => floorOutpaintRect(rect.value))

/**
 * 进入扩图模式时写入基准与原图矩形；参与父级 v-show 的组件在 select 模式下也挂载，
 * 因此只在扩图模式写入，避免污染 select 状态（setRefineMode('select') 会清空两者）。
 *
 * 原图尺寸未知（0×0）时不写退化矩形，保持 null —— 提交守卫据此禁用 CTA。
 */
function initOutpaintDraft() {
  editor.setRefineOutpaintBase(base.value)
  const initial = initialOutpaintRect(base.value)
  editor.setRefineOutpaintRect(initial.width > 0 && initial.height > 0 ? initial : null)
}

watch(
  () => editor.refineMode,
  (mode) => {
    if (mode !== 'outpaint') return
    if (!editor.refineOutpaintRect) initOutpaintDraft()
    else editor.setRefineOutpaintBase(base.value)
  },
  { immediate: true },
)

/** 基图尺寸晚到（mediaInfo 缺宽高 → 自然尺寸探测回填）时重置画布，避免退化矩形。 */
watch(base, () => {
  if (editor.refineMode === 'outpaint') initOutpaintDraft()
  else editor.setRefineOutpaintBase(base.value)
})
```

③ 拖拽状态改为响应式（模板需要用它切换网格与胶囊），并把写入改为落 store：

```ts
const dragging = ref<HandleDir | null>(null)
let lastX = 0
let lastY = 0

function onHandleDown(dir: HandleDir, event: PointerEvent) {
  if (props.busy) return
  // 原图尺寸未知（基图尚未探测到）时不接受拖拽，避免算出退化矩形
  if (!(base.value.width > 0) || !(base.value.height > 0)) return
  event.preventDefault()
  dragging.value = dir
  lastX = event.clientX
  lastY = event.clientY
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragUp)
}

function onDragMove(event: PointerEvent) {
  const dir = dragging.value
  if (!dir) return
  const scale = fitScale.value > 0 ? fitScale.value : 1
  const delta = {
    dx: (event.clientX - lastX) / scale,
    dy: (event.clientY - lastY) / scale,
  }
  lastX = event.clientX
  lastY = event.clientY
  if (delta.dx === 0 && delta.dy === 0) return
  // 逐帧增量写入 store：保留小数（对外落像素走 floorOutpaintRect），避免每帧取整漂移
  editor.setRefineOutpaintRect(resizeOutpaintRect(base.value, rect.value, delta, dir))
}

function onDragUp() {
  dragging.value = null
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragUp)
}
```

④ `onBeforeUnmount` 补基准清理：

```ts
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  onDragUp()
  // 退出扩图模式即重置（规格 §6.1）；组件卸载时清掉 store 中的 rect 与基准。
  editor.setRefineOutpaintRect(null)
  editor.setRefineOutpaintBase(null)
})
```

⑤ 模板：手柄 block 之后插入网格与顶部胶囊，并删除底部读数条：

```vue
      <!-- 拖拽进行中：3×3 三分参考网格（松手即消失） -->
      <div v-if="dragging" class="refine-outpaint__grid" data-testid="outpaint-grid" aria-hidden="true">
        <span class="refine-outpaint__grid-v" style="left: 33.333%" />
        <span class="refine-outpaint__grid-v" style="left: 66.667%" />
        <span class="refine-outpaint__grid-h" style="top: 33.333%" />
        <span class="refine-outpaint__grid-h" style="top: 66.667%" />
      </div>
    </div>

    <!-- 拖拽进行中：顶部居中尺寸胶囊（松手即消失；常驻读数在右栏 OutpaintPanel） -->
    <div v-if="dragging" class="refine-outpaint__badge" data-testid="outpaint-drag-badge">
      {{ viewRect.width }} × {{ viewRect.height }} · {{ aspectLabel }}
    </div>
  </div>
</template>
```

（即：`.refine-outpaint__grid` 放在 `.refine-outpaint__stage` 内部、手柄之后；`.refine-outpaint__badge` 放在 `.refine-outpaint` 根内、stage 之后。原来的 `.refine-outpaint__readout` 整块删除。）

⑥ 样式：手柄改角圆 / 边胶囊 + 命中区外扩，新增网格与胶囊样式：

```css
.refine-outpaint__handle {
  position: absolute;
  width: 16px;
  height: 16px;
  margin: -8px 0 0 -8px;
  border: 1.5px solid #7cc0ff;
  border-radius: 50%;              /* 角手柄 = 圆形 16px */
  background: rgba(10, 16, 24, 0.92);
  cursor: pointer;
  padding: 0;
  z-index: 2;
}
/* 命中区外扩 ≥4px（伪元素参与按钮命中测试，不改变视觉尺寸） */
.refine-outpaint__handle::after { content: ''; position: absolute; inset: -4px; }

.refine-outpaint__handle--n,
.refine-outpaint__handle--s {
  width: 32px; height: 16px; margin: -8px 0 0 -16px; border-radius: 999px;  /* 边胶囊 32×16 */
}
.refine-outpaint__handle--e,
.refine-outpaint__handle--w {
  width: 16px; height: 32px; margin: -16px 0 0 -8px; border-radius: 999px;  /* 边胶囊 16×32 */
}

.refine-outpaint__grid { position: absolute; inset: 0; pointer-events: none; z-index: 3; }
.refine-outpaint__grid-v { position: absolute; top: 0; bottom: 0; border-left: 1px dashed rgba(124, 192, 255, 0.75); }
.refine-outpaint__grid-h { position: absolute; left: 0; right: 0; border-top: 1px dashed rgba(124, 192, 255, 0.75); }

.refine-outpaint__badge {
  position: absolute; left: 50%; top: 12px; transform: translateX(-50%);
  padding: 4px 10px; border-radius: 8px;
  background: rgba(10, 16, 24, 0.86); color: #e6f0ff; font-size: 12px; white-space: nowrap;
  pointer-events: none; z-index: 4;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @lnkpi/web test -- src/components/canvas/refine/RefineOutpaintCanvas.test.ts src/components/canvas/refine/outpaintComposite.test.ts`
Expected: PASS。若「多边不互吞」用例变红，说明拖拽写入链路被破坏，**不要改断言**，回查 `onDragMove` 是否仍以 `rect.value` 为增量起点。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/canvas/refine/RefineOutpaintCanvas.vue apps/web/src/components/canvas/refine/RefineOutpaintCanvas.test.ts
git commit -m "feat(refine): 扩图手柄改角圆/边胶囊 + 拖拽 3×3 网格与顶部尺寸胶囊 + rect 状态源上移 store"
```

---

### Task 4: 右栏扩图参数面板 `OutpaintPanel.vue`

**Files:**
- Create: `apps/web/src/components/canvas/refine/OutpaintPanel.vue`
- Test: `apps/web/src/components/canvas/refine/OutpaintPanel.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `outpaintExtensionAmounts`、`formatAspectLabel`、`floorOutpaintRect`、`hasOutpaintExtension`；Task 2 的 store 动作。
- Produces：
  - 组件 `OutpaintPanel`，props：`{ busy?: boolean }`（其余数据全部读 store：`refineOutpaintBase` / `refineOutpaintRect`）；
  - DOM 契约：`[data-testid="outpaint-aspect-{id}"]`（id ∈ `base|1-1|4-3|3-4|16-9|9-16`）、`[data-testid="outpaint-width-input"]`、`[data-testid="outpaint-height-input"]`、`[data-testid="outpaint-ext-{west|east|north|south}"]`、`[data-testid="outpaint-reset"]`、`[data-testid="outpaint-panel-hint"]`。

- [ ] **Step 1: 写失败测试**

新建 `apps/web/src/components/canvas/refine/OutpaintPanel.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import OutpaintPanel from './OutpaintPanel.vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import { initialOutpaintRect } from './outpaintGeometry'

const BASE = { width: 400, height: 300 }
let pinia: Pinia

const mountPanel = (props: Record<string, unknown> = {}) =>
  mount(OutpaintPanel, { props, global: { plugins: [pinia] } })

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  const editor = useCanvasEditorStore()
  editor.refineMode = 'outpaint'
  editor.setRefineOutpaintBase(BASE)
  editor.setRefineOutpaintRect(initialOutpaintRect(BASE))
})

describe('OutpaintPanel', () => {
  it('渲染 6 个比例 chips + 宽高输入 + 四向读数 + 重置', () => {
    const w = mountPanel()
    for (const id of ['base', '1-1', '4-3', '3-4', '16-9', '9-16']) {
      expect(w.find(`[data-testid="outpaint-aspect-${id}"]`).exists()).toBe(true)
    }
    expect(w.find('[data-testid="outpaint-width-input"]').exists()).toBe(true)
    expect(w.find('[data-testid="outpaint-height-input"]').exists()).toBe(true)
    for (const dir of ['west', 'east', 'north', 'south']) {
      expect(w.find(`[data-testid="outpaint-ext-${dir}"]`).exists()).toBe(true)
    }
    expect(w.find('[data-testid="outpaint-reset"]').exists()).toBe(true)
  })

  it('未扩展时「原图」chip 激活且显示守卫提示', () => {
    const w = mountPanel()
    expect(w.find('[data-testid="outpaint-aspect-base"]').classes()).toContain('is-active')
    expect(w.find('[data-testid="outpaint-panel-hint"]').text()).toContain('先拖动')
  })

  it('点 1:1 chip → 调用 store 比例预设（对称扩展），chips 激活态与数字同步', async () => {
    const w = mountPanel()
    await w.find('[data-testid="outpaint-aspect-1-1"]').trigger('click')
    const editor = useCanvasEditorStore()
    expect(editor.refineOutpaintRect).toEqual({ x: 0, y: 50, width: 400, height: 400 })
    expect(w.find('[data-testid="outpaint-aspect-1-1"]').classes()).toContain('is-active')
    expect((w.find('[data-testid="outpaint-width-input"]').element as HTMLInputElement).value).toBe('400')
    expect((w.find('[data-testid="outpaint-height-input"]').element as HTMLInputElement).value).toBe('400')
    expect(w.find('[data-testid="outpaint-panel-hint"]').exists()).toBe(false)
  })

  it('四向读数随 rect 变化（1:1 → 上下各 50）', async () => {
    const w = mountPanel()
    await w.find('[data-testid="outpaint-aspect-1-1"]').trigger('click')
    expect(w.find('[data-testid="outpaint-ext-west"]').text()).toContain('0')
    expect(w.find('[data-testid="outpaint-ext-north"]').text()).toContain('50')
    expect(w.find('[data-testid="outpaint-ext-south"]').text()).toContain('50')
  })

  it('改宽度输入 → applyOutpaintSize 绝对值语义', async () => {
    const w = mountPanel()
    const input = w.find('[data-testid="outpaint-width-input"]')
    await input.setValue('600')
    await input.trigger('change')
    expect(useCanvasEditorStore().refineOutpaintRect).toEqual({ x: 100, y: 0, width: 600, height: 300 })
  })

  it('宽度输入非法值（空串）→ 不写坏 rect，输入框回落为落像素值', async () => {
    const w = mountPanel()
    const input = w.find('[data-testid="outpaint-width-input"]')
    await input.setValue('')
    await input.trigger('change')
    expect(useCanvasEditorStore().refineOutpaintRect).toEqual(initialOutpaintRect(BASE))
    expect((w.find('[data-testid="outpaint-width-input"]').element as HTMLInputElement).value).toBe('400')
  })

  it('busy 时 chips / 输入 / 重置全部禁用', () => {
    const w = mountPanel({ busy: true })
    expect(w.find('[data-testid="outpaint-aspect-1-1"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="outpaint-width-input"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="outpaint-reset"]').attributes('disabled')).toBeDefined()
  })

  it('store 里是小数矩形（拖拽中）时，输入与读数显示落像素后的整数且不出现 -0', async () => {
    const editor = useCanvasEditorStore()
    editor.setRefineOutpaintRect({ x: 0.4, y: 49.6, width: 400.2, height: 400.9 })
    const w = mountPanel()
    await flushPromises()
    expect((w.find('[data-testid="outpaint-width-input"]').element as HTMLInputElement).value).toBe('400')
    expect((w.find('[data-testid="outpaint-height-input"]').element as HTMLInputElement).value).toBe('400')
    expect(w.find('[data-testid="outpaint-ext-north"]').text()).not.toContain('-')
    expect(w.find('[data-testid="outpaint-ext-south"]').text()).not.toContain('-')
  })

  it('基准缺失（原图尺寸未知）时面板整体禁用且不渲染数字', () => {
    const editor = useCanvasEditorStore()
    editor.setRefineOutpaintBase(null)
    editor.setRefineOutpaintRect(null)
    const w = mountPanel()
    expect(w.find('[data-testid="outpaint-aspect-1-1"]').attributes('disabled')).toBeDefined()
    expect((w.find('[data-testid="outpaint-width-input"]').element as HTMLInputElement).value).toBe('')
  })

  it('重置 → 恢复原图矩形', async () => {
    const w = mountPanel()
    await w.find('[data-testid="outpaint-aspect-1-1"]').trigger('click')
    await w.find('[data-testid="outpaint-reset"]').trigger('click')
    expect(useCanvasEditorStore().refineOutpaintRect).toEqual(initialOutpaintRect(BASE))
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @lnkpi/web test -- src/components/canvas/refine/OutpaintPanel.test.ts`
Expected: FAIL —— 组件文件不存在。

- [ ] **Step 3: 实现**

新建 `apps/web/src/components/canvas/refine/OutpaintPanel.vue`：

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import {
  floorOutpaintRect,
  formatAspectLabel,
  hasOutpaintExtension,
  outpaintExtensionAmounts,
  type Size,
} from './outpaintGeometry'

const props = withDefaults(defineProps<{ busy?: boolean }>(), { busy: false })

const editor = useCanvasEditorStore()

/** 比例预设（§6.2）：null = 原图。点击 = 替换当前矩形，不做累积。 */
const ASPECT_PRESETS: { id: string; label: string; ratio: { w: number; h: number } | null }[] = [
  { id: 'base', label: '原图', ratio: null },
  { id: '1-1', label: '1:1', ratio: { w: 1, h: 1 } },
  { id: '4-3', label: '4:3', ratio: { w: 4, h: 3 } },
  { id: '3-4', label: '3:4', ratio: { w: 3, h: 4 } },
  { id: '16-9', label: '16:9', ratio: { w: 16, h: 9 } },
  { id: '9-16', label: '9:16', ratio: { w: 9, h: 16 } },
]

const base = computed<Size | null>(() => editor.refineOutpaintBase)
const rect = computed(() => (editor.refineOutpaintRect ? floorOutpaintRect(editor.refineOutpaintRect) : null))
const extended = computed(() => (!!base.value && !!rect.value ? hasOutpaintExtension(base.value, rect.value) : false))
const amounts = computed(() =>
  base.value && rect.value
    ? outpaintExtensionAmounts(base.value, rect.value)
    : { west: 0, east: 0, north: 0, south: 0 },
)
const aspectLabel = computed(() => (rect.value ? formatAspectLabel(rect.value.width, rect.value.height) : '—'))

/** 当前激活的 chip：原图 = 无扩展；比例 chip = 与当前画布比例一致（2% 容差由 formatAspectLabel 承担）。 */
const activePresetId = computed(() => {
  if (!extended.value) return 'base'
  const hit = ASPECT_PRESETS.find((p) => p.ratio && p.label === aspectLabel.value)
  return hit?.id ?? null
})

const disabled = computed(() => props.busy || !base.value)

function pickPreset(ratio: { w: number; h: number } | null) {
  if (disabled.value) return
  editor.applyOutpaintAspectPreset(ratio)
}

function onSizeCommit(axis: 'width' | 'height', raw: string) {
  if (disabled.value || !rect.value) return
  const parsed = Number.parseInt(raw, 10)
  const next = Number.isFinite(parsed) ? parsed : axis === 'width' ? rect.value.width : rect.value.height
  editor.applyOutpaintSize(
    axis === 'width' ? next : rect.value.width,
    axis === 'height' ? next : rect.value.height,
  )
}

function onReset() {
  if (disabled.value) return
  editor.resetOutpaintRect()
}

/** 扩展量的方向符号（只读展示）。 */
const EXT_ROWS: { key: 'west' | 'east' | 'north' | 'south'; arrow: string; label: string }[] = [
  { key: 'west', arrow: '←', label: '西' },
  { key: 'east', arrow: '→', label: '东' },
  { key: 'north', arrow: '↑', label: '北' },
  { key: 'south', arrow: '↓', label: '南' },
]
</script>

<template>
  <section class="outpaint-panel" data-testid="outpaint-panel">
    <div class="outpaint-panel__group">
      <div class="outpaint-panel__glabel">画布比例</div>
      <div class="outpaint-panel__chips">
        <button
          v-for="preset in ASPECT_PRESETS"
          :key="preset.id"
          type="button"
          class="outpaint-panel__chip"
          :class="{ 'is-active': activePresetId === preset.id }"
          :data-testid="`outpaint-aspect-${preset.id}`"
          :disabled="disabled"
          :title="preset.ratio ? `按 ${preset.label} 扩展（包含原图、对称均分）` : '恢复原图尺寸'"
          @click="pickPreset(preset.ratio)"
        >
          {{ preset.label }}
        </button>
      </div>
    </div>

    <div class="outpaint-panel__group">
      <div class="outpaint-panel__glabel">画布尺寸（px）</div>
      <div class="outpaint-panel__size">
        <input
          class="outpaint-panel__input"
          type="number"
          inputmode="numeric"
          data-testid="outpaint-width-input"
          :value="rect?.width ?? ''"
          :disabled="disabled"
          aria-label="画布宽度"
          @change="onSizeCommit('width', ($event.target as HTMLInputElement).value)"
        >
        <span class="outpaint-panel__times">×</span>
        <input
          class="outpaint-panel__input"
          type="number"
          inputmode="numeric"
          data-testid="outpaint-height-input"
          :value="rect?.height ?? ''"
          :disabled="disabled"
          aria-label="画布高度"
          @change="onSizeCommit('height', ($event.target as HTMLInputElement).value)"
        >
        <button
          type="button"
          class="outpaint-panel__reset"
          data-testid="outpaint-reset"
          :disabled="disabled"
          title="重置为原图尺寸"
          @click="onReset"
        >
          重置
        </button>
      </div>
    </div>

    <div class="outpaint-panel__group">
      <div class="outpaint-panel__glabel">扩展量</div>
      <div class="outpaint-panel__ext">
        <span
          v-for="row in EXT_ROWS"
          :key="row.key"
          class="outpaint-panel__ext-item"
          :data-testid="`outpaint-ext-${row.key}`"
        >
          <em>{{ row.arrow }} {{ row.label }}</em>{{ amounts[row.key] }}
        </span>
      </div>
    </div>

    <p v-if="!extended" class="outpaint-panel__hint" data-testid="outpaint-panel-hint">
      先拖动画布四周手柄扩展画布，扩出区域将由 AI 生成
    </p>
  </section>
</template>

<style scoped>
.outpaint-panel { display: flex; flex-direction: column; gap: 14px; padding: 12px; }
.outpaint-panel__glabel { margin-bottom: 6px; color: var(--neo-text-muted); font-size: 10.5px; letter-spacing: .04em; }
.outpaint-panel__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.outpaint-panel__chip {
  height: 28px; padding: 0 12px; border: 1px solid var(--neo-border); border-radius: 9px;
  background: transparent; color: var(--neo-text-secondary); font-size: 11.5px; cursor: pointer;
}
.outpaint-panel__chip:hover:not(:disabled) { background: var(--neo-hover-bg); }
.outpaint-panel__chip.is-active { border-color: rgba(74, 158, 255, .5); background: rgba(0, 89, 179, .16); color: #7cc0ff; }
.outpaint-panel__chip:disabled { opacity: .45; cursor: not-allowed; }
.outpaint-panel__size { display: flex; align-items: center; gap: 6px; }
.outpaint-panel__input {
  width: 78px; height: 28px; padding: 0 8px; border: 1px solid var(--neo-border); border-radius: 8px;
  background: transparent; color: var(--neo-text-primary); font-size: 12px;
}
.outpaint-panel__times { color: var(--neo-text-muted); font-size: 12px; }
.outpaint-panel__reset {
  margin-left: auto; height: 28px; padding: 0 10px; border: 1px solid var(--neo-border);
  border-radius: 8px; background: transparent; color: var(--neo-text-secondary); font-size: 11.5px; cursor: pointer;
}
.outpaint-panel__reset:hover:not(:disabled) { background: var(--neo-hover-bg); }
.outpaint-panel__reset:disabled { opacity: .45; cursor: not-allowed; }
.outpaint-panel__ext { display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 11.5px; color: var(--neo-text-primary); }
.outpaint-panel__ext-item em { margin-right: 4px; color: var(--neo-text-muted); font-style: normal; }
.outpaint-panel__hint { margin: 0; color: var(--neo-text-muted); font-size: 11px; line-height: 1.5; }
</style>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @lnkpi/web test -- src/components/canvas/refine/OutpaintPanel.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/canvas/refine/OutpaintPanel.vue apps/web/src/components/canvas/refine/OutpaintPanel.test.ts
git commit -m "feat(refine): 右栏扩图参数面板 OutpaintPanel（比例 chips / 尺寸输入 / 四向读数 / 重置）"
```

---

### Task 5: CTA 原子件 `size` 变体 + `RefineDock` 紧凑化

**Files:**
- Modify: `apps/web/src/components/canvas/dock-studio/shared/DockGenerateButton.vue`
- Modify: `apps/web/src/components/canvas/refine/RefineDock.vue`
- Test: `apps/web/src/components/canvas/refine/RefineDock.test.ts`

**Interfaces:**
- Consumes: 现有 `DockGenerateButton`（圆形 `↑`，disabled 时仍渲染箭头，仅 opacity 0.4）、`DockToolbarShell`（`show-close`）、`DockCreditBadge`。
- Produces（Task 6 依赖）：
  - `DockGenerateButton` 新增可选 prop `size?: 'sm' | 'md' | 'lg'`，默认 `'sm'`（28px，保持既有调用方零改动）；`'md'` = 32px（panel 落点）、`'lg'` = 36px（floating 落点）。
  - `RefineDock` 的 `[data-testid="dock-run"]` 由文字按钮变为 `DockGenerateButton`（CTA 文案进 `title` / `aria-label`：`精修`），头排 × 移除。

- [ ] **Step 1: 改写测试（先红）**

修改 `apps/web/src/components/canvas/refine/RefineDock.test.ts`：

① 把「与图片节点 dock 同构」用例改为断言无 ×、CTA 是圆形箭头（文案在 aria-label）：

```ts
  it('与图片节点 dock 同构：header 类型图标；§4.4 移除头排 ×（无层可退，退出职责归面板 header）', () => {
    const w = mountDock()
    expect(w.find('.bottom-toolbar-container').exists()).toBe(true)
    expect(w.find('.bottom-toolbar-type-icon').exists()).toBe(true)
    expect(w.find('.bottom-toolbar-close').exists()).toBe(false)
  })
```

② 把「精修按钮」用例改为断言 `aria-label` 与圆形箭头结构：

```ts
  it('主 CTA：圆形箭头按钮，aria-label 为「精修」；可点时 emit run，busy 时禁用', async () => {
    const w = mountDock({ prompt: 'x' })
    const btn = w.find('[data-testid="dock-run"]')
    expect(btn.classes()).toContain('dock-generate-btn')
    expect(btn.attributes('aria-label')).toBe('精修')
    expect(btn.find('svg').exists()).toBe(true)
    await btn.trigger('click')
    expect(w.emitted('run')).toHaveLength(1)

    const busy = mountDock({ prompt: 'x', busy: true }).find('[data-testid="dock-run"]')
    expect(busy.attributes('disabled')).toBeDefined()
    // 禁用态保形：仍有箭头图标（禁止退化为无图标白矩形）
    expect(busy.find('svg').exists()).toBe(true)
  })
```

③ 删除「关闭按钮 emit close」用例（× 已移除），替换为：

```ts
  it('dock 内不再有「原图 尺寸 · 比例」静态徽标行（§4.3 内容归属）', () => {
    const w = mountDock({ width: 1280, height: 720 })
    expect(w.text()).not.toContain('1280×720')
  })
```

④ 「扩图模式下主按钮文案为「扩图生成」」用例改为读 aria-label：

```ts
  it('扩图模式下主 CTA 的 aria-label 为「扩图生成」（文案不再占用按钮内文）', () => {
    const w = mountDock({ mode: 'outpaint' })
    expect(w.find('[data-testid="dock-run"]').attributes('aria-label')).toBe('扩图生成')
  })
```

⑤ 「普通精修模式不受 outpaintReady 影响」用例同样改读 aria-label：

```ts
  it('普通精修模式不受 outpaintReady 影响', () => {
    const w = mountDock({ mode: 'edit', outpaintReady: false })
    expect(w.find('[data-testid="dock-run"]').attributes('aria-label')).toBe('精修')
    expect(w.find('[data-testid="dock-outpaint-hint"]').exists()).toBe(false)
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @lnkpi/web test -- src/components/canvas/refine/RefineDock.test.ts`
Expected: FAIL —— `.bottom-toolbar-close` 仍存在；`dock-run` 仍为文字按钮（无 `dock-generate-btn` class）。

- [ ] **Step 3: 实现**

① `DockGenerateButton.vue`：加 `size` prop 与尺寸类。

```vue
<script setup lang="ts">
withDefaults(defineProps<{
  generating?: boolean
  disabled?: boolean
  title?: string
  /** 尺寸档位：sm 28（默认，横向底栏）/ md 32（panel 落点）/ lg 36（floating 落点）——§4.3 */
  size?: 'sm' | 'md' | 'lg'
  /** 主 CTA 文案（动词 + 对象，§4.2 不变量 5）；缺省沿用生成/取消生成 */
  label?: string
}>(), { size: 'sm' })

const emit = defineEmits<{
  generate: []
}>()
</script>

<template>
  <button
    type="button"
    class="dock-generate-btn"
    :class="[`dock-generate-btn--${size}`, { 'is-generating': generating }]"
    :disabled="disabled"
    :title="title ?? (generating ? '点击取消生成' : '生成')"
    :aria-label="label ?? (generating ? '取消生成' : '生成')"
    @click.stop="emit('generate')"
  >
    <!-- Stop square while generating — clearer cancel affordance than a spinner-only control -->
    <svg
      v-if="generating"
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
    <svg
      v-else
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  </button>
</template>
```

样式补充（放在 `.dock-generate-btn` 规则之后）：

```css
.dock-generate-btn--sm { width: 28px; height: 28px; }
.dock-generate-btn--md { width: 32px; height: 32px; }
.dock-generate-btn--lg { width: 36px; height: 36px; }
```

（`.dock-generate-btn` 本体保留 `width: 28px; height: 28px;` 与 `border-radius: 999px`，由档位类覆盖尺寸——默认仍为 28，既有调用方视觉零变化。）

② `RefineDock.vue`：

- 删掉底部「原图 尺寸 · 比例」chip 整块：

```vue
          <span class="refine-dock__chip refine-dock__chip--muted" title="输出尺寸跟随原图">
            <span class="refine-dock__chip-k">原图</span>{{ sizeLabel }}
          </span>
```

并删除其依赖的 `sizeLabel` computed（无其他引用），保留局部 `aspectLabel()` 函数（下面 tooltip 要用）。

- 原图尺寸信息**归位到尺寸选择器的 tooltip**（§4.3「信息归 tooltip 或对照区，dock 内不再出现在徽标行」）：

```ts
/** 原图尺寸信息（§4.3 归位）：静态元信息只进 tooltip，不占 dock 一行高度。 */
const sizeTooltip = computed(() => {
  const w = Number(props.width) || 0
  const h = Number(props.height) || 0
  return w && h ? `输出尺寸跟随原图（原图 ${w}×${h} · ${aspectLabel(w, h)}）` : '输出尺寸跟随原图'
})
```

并在尺寸选择器触发按钮上挂上它：

```vue
            <button
              type="button"
              class="refine-dock__select-trigger"
              data-testid="dock-size-select"
              :title="sizeTooltip"
              :disabled="runDisabled"
              :aria-expanded="sizeOpen"
              @click="sizeOpen = !sizeOpen"
            >
```

- `DockToolbarShell` 关闭头排 ×：

```vue
    <DockToolbarShell type="image" :show-close="false">
```

（`close` emit 保留在组件契约里，但模板不再触发；Task 9 仍以面板 header × 承担关闭。）

- 主 CTA 换原子件：

```vue
          <DockGenerateButton
            data-testid="dock-run"
            size="md"
            :disabled="runDisabled"
            :title="mode === 'outpaint' ? '扩图生成' : '精修'"
            @generate="emit('run')"
          />
```

（`mode === 'outpaint' ? '扩图生成' : '精修'` 作为 `title` 传下去，`aria-label` 由 `DockGenerateButton` 的 `title` 派生——为满足断言，改为显式传 `aria-label`：见下。）

为使 `aria-label` 断言成立，`DockGenerateButton` 增加可选 `label?: string`：

```ts
  /** 主 CTA 文案（动词 + 对象，§4.2 不变量 5）；缺省沿用生成/取消生成 */
  label?: string
```
```vue
    :aria-label="label ?? (generating ? '取消生成' : '生成')"
```
`RefineDock` 侧：

```vue
          <DockGenerateButton
            data-testid="dock-run"
            size="md"
            :label="mode === 'outpaint' ? '扩图生成' : '精修'"
            :disabled="runDisabled"
            @generate="emit('run')"
          />
```

- 删除 `.refine-dock__primary` 样式块，删除 `.refine-dock__chip--muted`；保留 `.refine-dock__ghost`（「应用到节点」次级动作）。
- 高度预算（§4.3）：`.refine-dock__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 12px 10px; }`，并给 dock 根加 `max-height` 兜底：

```css
.refine-dock { display: flex; flex-direction: column; gap: 8px; padding-bottom: 2px; }
.refine-dock__hint { margin: 0 12px; }
.refine-dock__error { margin: 0 12px; }
```

（原本 `margin: 0 12px 6px` 的段间距保持 6–8px 之间，配合 Task 9 的 flex 兄弟布局满足 ≤148px 预算。）

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @lnkpi/web test -- src/components/canvas/refine/RefineDock.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/canvas/dock-studio/shared/DockGenerateButton.vue apps/web/src/components/canvas/refine/RefineDock.vue apps/web/src/components/canvas/refine/RefineDock.test.ts
git commit -m "feat(refine): DockGenerateButton 尺寸/文案档位 + RefineDock 紧凑化（圆形箭头 CTA、去静态徽标行、移除头排 ×）"
```

---

### Task 6: 扩图悬浮 dock `RefineOutpaintDock.vue`

**Files:**
- Create: `apps/web/src/components/canvas/refine/RefineOutpaintDock.vue`
- Test: `apps/web/src/components/canvas/refine/RefineOutpaintDock.test.ts`

**Interfaces:**
- Consumes: Task 5 的 `DockGenerateButton`（`size='lg'`）、`label`；`DockCreditBadge`；`OUTPAINT_FALLBACK_PROMPT`（`./outpaintFallback`）。
- Produces（Task 9 依赖）：

```ts
// props
{
  prompt: string
  modelKey: string
  availableModelKeys: readonly string[]
  credits: number
  canRun: boolean          // false = 未扩出（守卫），CTA 禁用 + tooltip
  busy?: boolean
  canApply?: boolean
  errorMessage?: string
}
// emits
'update:prompt' [v: string]
'update:modelKey' [v: string]
run | apply | retry | exit | cancel
```
DOM 契约：`[data-testid="outpaint-dock"]`、`[data-testid="outpaint-dock-exit"]`、`[data-testid="outpaint-dock-prompt-toggle"]`、`[data-testid="outpaint-dock-prompt"]`、`[data-testid="outpaint-dock-model"]`、`[data-testid="outpaint-dock-cta"]`、`[data-testid="outpaint-dock-guard"]`。

- [ ] **Step 1: 写失败测试**

新建 `apps/web/src/components/canvas/refine/RefineOutpaintDock.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RefineOutpaintDock from './RefineOutpaintDock.vue'
import { IMAGE_EDIT_MODEL_KEYS, P1_IMAGE_EDIT_MODEL_KEY } from '@lnkpi/shared'
import { OUTPAINT_FALLBACK_PROMPT } from './outpaintFallback'

const mountDock = (props: Record<string, unknown> = {}) =>
  mount(RefineOutpaintDock, {
    props: {
      prompt: '',
      modelKey: P1_IMAGE_EDIT_MODEL_KEY,
      availableModelKeys: IMAGE_EDIT_MODEL_KEYS,
      credits: 10,
      canRun: true,
      ...props,
    },
  })

describe('RefineOutpaintDock', () => {
  it('渲染退出 / 模型 / 提示词开关 / 积分 / 圆形箭头 CTA', () => {
    const w = mountDock()
    expect(w.find('[data-testid="outpaint-dock"]').exists()).toBe(true)
    expect(w.find('[data-testid="outpaint-dock-exit"]').attributes('title')).toContain('退出扩图')
    expect(w.find('[data-testid="outpaint-dock-prompt-toggle"]').exists()).toBe(true)
    expect(w.findComponent({ name: 'DockCreditBadge' }).props('credits')).toBe(10)
    const cta = w.find('[data-testid="outpaint-dock-cta"]')
    expect(cta.classes()).toContain('dock-generate-btn')
    expect(cta.attributes('aria-label')).toBe('扩图生成')
  })

  it('未扩出（canRun=false）：CTA 禁用 + 守卫 tooltip，仍保留箭头图标', () => {
    const w = mountDock({ canRun: false })
    const cta = w.find('[data-testid="outpaint-dock-cta"]')
    expect(cta.attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="outpaint-dock-guard"]').text()).toContain('先拖动')
    expect(cta.find('svg').exists()).toBe(true)
  })

  it('busy：CTA 禁用且退出按钮变为取消（emit cancel 而非 exit）', async () => {
    const w = mountDock({ busy: true })
    expect(w.find('[data-testid="outpaint-dock-cta"]').attributes('disabled')).toBeDefined()
    const exit = w.find('[data-testid="outpaint-dock-exit"]')
    expect(exit.attributes('title')).toContain('取消')
    await exit.trigger('click')
    expect(w.emitted('cancel')).toHaveLength(1)
    expect(w.emitted('exit')).toBeUndefined()
  })

  it('点 CTA emit run；点退出 emit exit', async () => {
    const w = mountDock()
    await w.find('[data-testid="outpaint-dock-cta"]').trigger('click')
    expect(w.emitted('run')).toHaveLength(1)
    await w.find('[data-testid="outpaint-dock-exit"]').trigger('click')
    expect(w.emitted('exit')).toHaveLength(1)
  })

  it('提示词默认折叠不占位；展开后 textarea 显示空串并以兜底文案作 placeholder', async () => {
    const w = mountDock()
    expect(w.find('[data-testid="outpaint-dock-prompt"]').exists()).toBe(false)
    await w.find('[data-testid="outpaint-dock-prompt-toggle"]').trigger('click')
    const area = w.find('[data-testid="outpaint-dock-prompt"]')
    expect(area.exists()).toBe(true)
    expect(area.attributes('placeholder')).toBe(OUTPAINT_FALLBACK_PROMPT)
  })

  it('提示词展开后输入 → emit update:prompt', async () => {
    const w = mountDock()
    await w.find('[data-testid="outpaint-dock-prompt-toggle"]').trigger('click')
    await w.find('[data-testid="outpaint-dock-prompt"]').setValue('加一片森林')
    expect(w.emitted('update:prompt')).toEqual([['加一片森林']])
  })

  it('已有错误时显示错误并可重试', async () => {
    const w = mountDock({ errorMessage: '扩图失败，请重试' })
    expect(w.text()).toContain('扩图失败，请重试')
    await w.find('[data-testid="outpaint-dock-retry"]').trigger('click')
    expect(w.emitted('retry')).toHaveLength(1)
  })

  it('canApply 时才显示「应用到节点」次级动作', () => {
    expect(mountDock().find('[data-testid="outpaint-dock-apply"]').exists()).toBe(false)
    expect(mountDock({ canApply: true }).find('[data-testid="outpaint-dock-apply"]').exists()).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @lnkpi/web test -- src/components/canvas/refine/RefineOutpaintDock.test.ts`
Expected: FAIL —— 组件文件不存在。

- [ ] **Step 3: 实现**

新建 `apps/web/src/components/canvas/refine/RefineOutpaintDock.vue`：

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import { ref as vueRef } from 'vue'
import { IMAGE_EDIT_GATEWAY_MODEL_ID, P1_IMAGE_EDIT_MODEL_KEY } from '@lnkpi/shared'
import { useClickOutside } from '@/composables/useClickOutside'
import DockGenerateButton from '@/components/canvas/dock-studio/shared/DockGenerateButton.vue'
import DockCreditBadge from '@/components/canvas/dock-studio/shared/DockCreditBadge.vue'
import { OUTPAINT_FALLBACK_PROMPT } from './outpaintFallback'

const props = withDefaults(defineProps<{
  prompt: string
  modelKey: string
  availableModelKeys: readonly string[]
  credits: number
  /** 是否已产生真实扩出（四向扩展量不全为 0）。false = CTA 禁用 + 守卫文案（§6.3）。 */
  canRun: boolean
  busy?: boolean
  canApply?: boolean
  errorMessage?: string
}>(), { busy: false, canApply: false, errorMessage: '' })

const emit = defineEmits<{
  'update:prompt': [value: string]
  'update:modelKey': [value: string]
  run: []
  apply: []
  retry: []
  exit: []
  cancel: []
}>()

const promptOpen = ref(false)
const modelOpen = ref(false)
const rootRef = vueRef<HTMLElement | null>(null)
useClickOutside(rootRef, () => { modelOpen.value = false })

const interactionDisabled = computed(() => props.busy)
/** CTA 可用 = 已扩出且非 busy（§4.2 不变量 3：不可用 = disabled + 原因文案）。 */
const ctaDisabled = computed(() => props.busy || !props.canRun)
const guardText = computed(() => (props.busy ? '生成中…' : '先拖动画布四周手柄扩展'))

const modelLabel = computed(() =>
  props.modelKey === P1_IMAGE_EDIT_MODEL_KEY ? IMAGE_EDIT_GATEWAY_MODEL_ID : props.modelKey,
)

function onExit() {
  if (props.busy) emit('cancel')
  else emit('exit')
}

function selectModel(key: string) {
  emit('update:modelKey', key)
  modelOpen.value = false
}
</script>

<template>
  <div ref="rootRef" class="outpaint-dock" data-testid="outpaint-dock">
    <!-- × 是扩图层的退出控件：必须带文字标注自证作用域（§4.4） -->
    <button
      type="button"
      class="outpaint-dock__exit"
      data-testid="outpaint-dock-exit"
      :title="busy ? '取消扩图生成' : '退出扩图'"
      @click="onExit"
    >
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
      <span>{{ busy ? '取消' : '退出扩图' }}</span>
    </button>

    <div class="outpaint-dock__model">
      <button
        type="button"
        class="outpaint-dock__model-trigger"
        data-testid="outpaint-dock-model"
        :disabled="interactionDisabled"
        :aria-expanded="modelOpen"
        @click="modelOpen = !modelOpen"
      >
        {{ modelLabel }}
      </button>
      <div v-if="modelOpen" class="outpaint-dock__model-menu" @click.stop>
        <button
          v-for="k in availableModelKeys"
          :key="k"
          type="button"
          class="outpaint-dock__model-item"
          :class="{ 'is-active': k === modelKey }"
          :data-model-key="k"
          @click="selectModel(k)"
        >
          {{ k === P1_IMAGE_EDIT_MODEL_KEY ? IMAGE_EDIT_GATEWAY_MODEL_ID : k }}
        </button>
      </div>
    </div>

    <button
      type="button"
      class="outpaint-dock__icon-btn"
      data-testid="outpaint-dock-prompt-toggle"
      :class="{ 'is-active': promptOpen }"
      :disabled="interactionDisabled"
      title="补充提示词（可选）"
      aria-label="补充提示词"
      :aria-expanded="promptOpen"
      @click="promptOpen = !promptOpen"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
        <path d="M5 6.5h14M5 12h14M5 17.5h9" stroke-linecap="round" />
      </svg>
    </button>

    <p v-if="!canRun" class="outpaint-dock__guard" data-testid="outpaint-dock-guard">{{ guardText }}</p>
    <p v-if="errorMessage" class="outpaint-dock__error" role="alert">
      <span>{{ errorMessage }}</span>
      <button type="button" class="outpaint-dock__retry" data-testid="outpaint-dock-retry" :disabled="busy" @click="emit('retry')">
        重试
      </button>
    </p>

    <div class="outpaint-dock__spacer" />

    <button
      v-if="canApply"
      type="button"
      class="outpaint-dock__apply"
      data-testid="outpaint-dock-apply"
      :disabled="busy"
      @click="emit('apply')"
    >
      应用到节点
    </button>
    <DockCreditBadge :credits="credits" />
    <DockGenerateButton
      data-testid="outpaint-dock-cta"
      size="lg"
      label="扩图生成"
      :disabled="ctaDisabled"
      :generating="busy"
      :title="ctaDisabled ? guardText : '扩图生成'"
      @generate="emit('run')"
    />

    <div v-if="promptOpen" class="outpaint-dock__prompt" @click.stop>
      <textarea
        class="outpaint-dock__textarea"
        data-testid="outpaint-dock-prompt"
        :value="prompt"
        :placeholder="OUTPAINT_FALLBACK_PROMPT"
        :disabled="busy"
        rows="2"
        @input="emit('update:prompt', ($event.target as HTMLTextAreaElement).value)"
      />
    </div>
  </div>
</template>

<style scoped>
/* 单行动作条：默认态总高 ≤ 60px（含内边距），远在 §4.3 的 148px 预算内 */
.outpaint-dock {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--neo-border);
  border-radius: 14px;
  background: var(--neo-surface, #17181d);
  box-shadow: 0 12px 32px rgba(0, 0, 0, .36);
  pointer-events: auto;
}
.outpaint-dock__exit,
.outpaint-dock__icon-btn,
.outpaint-dock__model-trigger,
.outpaint-dock__apply {
  display: inline-flex; height: 28px; align-items: center; gap: 4px; padding: 0 8px;
  border: 1px solid var(--neo-border); border-radius: 8px; background: transparent;
  color: var(--neo-text-secondary); font-size: 11px; cursor: pointer;
}
.outpaint-dock__icon-btn { width: 28px; justify-content: center; padding: 0; }
.outpaint-dock__icon-btn.is-active { border-color: rgba(74, 158, 255, .5); color: #7cc0ff; }
.outpaint-dock__exit:disabled,
.outpaint-dock__icon-btn:disabled,
.outpaint-dock__model-trigger:disabled { opacity: .5; cursor: not-allowed; }
.outpaint-dock__model { position: relative; }
.outpaint-dock__model-menu {
  position: absolute; bottom: calc(100% + 6px); left: 0; z-index: 50; min-width: 160px;
  padding: 4px; border: 1px solid var(--neo-border); border-radius: 10px;
  background: var(--neo-surface, #111); box-shadow: 0 8px 24px rgba(0, 0, 0, .28);
}
.outpaint-dock__model-item {
  display: block; width: 100%; padding: 6px 8px; border: none; border-radius: 6px;
  background: transparent; color: var(--neo-text-secondary); font-size: 11px; text-align: left; cursor: pointer;
}
.outpaint-dock__model-item.is-active { background: var(--neo-hi-bg, #17181d); color: #fff; }
.outpaint-dock__guard { margin: 0; color: var(--neo-text-muted); font-size: 11px; white-space: nowrap; }
.outpaint-dock__error { display: flex; margin: 0; align-items: center; gap: 8px; color: #f56c6c; font-size: 11px; }
.outpaint-dock__retry { border: 1px solid currentColor; border-radius: 6px; background: transparent; color: inherit; font-size: 11px; padding: 1px 6px; cursor: pointer; }
.outpaint-dock__spacer { flex: 1; }
.outpaint-dock__prompt {
  position: absolute; bottom: calc(100% + 8px); left: 0; right: 0; z-index: 40;
  padding: 8px; border: 1px solid var(--neo-border); border-radius: 12px;
  background: var(--neo-surface, #17181d); box-shadow: 0 12px 32px rgba(0, 0, 0, .36);
}
.outpaint-dock__textarea {
  display: block; width: 100%; max-height: 84px; resize: none; padding: 6px 8px;
  border: 1px solid var(--neo-border); border-radius: 8px; background: transparent;
  color: var(--neo-text-primary); font-size: 12px; line-height: 1.4;
}
</style>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @lnkpi/web test -- src/components/canvas/refine/RefineOutpaintDock.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/canvas/refine/RefineOutpaintDock.vue apps/web/src/components/canvas/refine/RefineOutpaintDock.test.ts
git commit -m "feat(refine): 扩图悬浮 dock（退出扩图 / 模型 / 可选提示词 / 积分 / 圆形箭头 CTA + 守卫）"
```

---

### Task 7: 工具注册表 + `WorkbenchShell`

**Files:**
- Create: `apps/web/src/components/canvas/workbench/workbenchToolRegistry.ts`
- Create: `apps/web/src/components/canvas/workbench/WorkbenchShell.vue`
- Test: `apps/web/src/components/canvas/workbench/workbenchToolRegistry.test.ts`
- Test: `apps/web/src/components/canvas/workbench/WorkbenchShell.test.ts`

**Interfaces:**
- Consumes: `useWorkbenchPanel`（已在 `components/canvas/workbench/`）、Task 4 的 `OutpaintPanel`、Task 6 的 `RefineOutpaintDock`、现有 `RefineDock`。
- Produces（Task 9 依赖）：

```ts
export interface RailItemDescriptor { id: string; label: string; disabled?: boolean; hint?: string }
export interface WorkbenchToolRegistration {
  id: string
  railItems?: RailItemDescriptor[]
  panel: Component
  dock: Component | null
  dockPlacement: 'panel' | 'floating'
}
export const WORKBENCH_TOOL_REGISTRY: Record<string, WorkbenchToolRegistration>
export function getWorkbenchTool(id: string | null | undefined): WorkbenchToolRegistration | null
export function toolIdForRefineMode(mode: 'select' | 'outpaint'): string   // → 'refine-select' | 'refine-outpaint'
```
- `WorkbenchShell` 的 scoped slots：`viewport({ insetRight })`、`panel({ panelWidth, collapsed, isNarrow, insetRight, floatingAvailable })`；props：`{ defaultWidth?: number; busy?: boolean }`；emits：`close`。

> **记录在案的一处实现偏离（§5 的「floating-dock 槽」）**：Shell 的 floating-dock 槽实现为**放置契约**而非 Vue `<slot>`：Shell 通过 `floatingAvailable`（= `!isNarrow`）向 panel 槽下发是否允许悬浮，由 `RefineSidePanel` 渲染唯一的 dock（悬浮时用 `Teleport` + `position: fixed` 覆盖视口底部居中）。原因：dock 的 `prompt` / `busy` / 提交链路（`runOutpaint`）全在 `RefineSidePanel` 内，若把 dock 提升到 Shell 的 slot，就必须把这些状态与提交链路整段上移，改动面与风险远超收益。不变量仍成立：**是否渲染 dock、以及落点，全部由注册表 `dock` / `dockPlacement` 决定。**

- [ ] **Step 1: 写失败测试**

新建 `apps/web/src/components/canvas/workbench/workbenchToolRegistry.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  WORKBENCH_TOOL_REGISTRY,
  getWorkbenchTool,
  toolIdForRefineMode,
} from './workbenchToolRegistry'

describe('workbenchToolRegistry', () => {
  it('注册了精修 select 与扩图两个一级工具，且三件套齐全', () => {
    for (const id of ['refine-select', 'refine-outpaint']) {
      const tool = getWorkbenchTool(id)
      expect(tool, id).not.toBeNull()
      expect(tool!.id).toBe(id)
      expect(tool!.panel).toBeTruthy()
    }
  })

  it('产出型工具的 dock 判据（§4.2）：两个精修工具都有 dock', () => {
    expect(getWorkbenchTool('refine-select')!.dock).toBeTruthy()
    expect(getWorkbenchTool('refine-outpaint')!.dock).toBeTruthy()
  })

  it('落点就近原则：select = panel（焦点在提示词），outpaint = floating（焦点在画布）', () => {
    expect(getWorkbenchTool('refine-select')!.dockPlacement).toBe('panel')
    expect(getWorkbenchTool('refine-outpaint')!.dockPlacement).toBe('floating')
  })

  it('未注册 id → null（不注册就没有 UI）', () => {
    expect(getWorkbenchTool('not-registered')).toBeNull()
    expect(getWorkbenchTool(null)).toBeNull()
    expect(getWorkbenchTool(undefined)).toBeNull()
  })

  it('refineMode → 工具 id 映射', () => {
    expect(toolIdForRefineMode('select')).toBe('refine-select')
    expect(toolIdForRefineMode('outpaint')).toBe('refine-outpaint')
  })

  it('注册表自身的完整性：dock 为 null 时 dockPlacement 被忽略（不因此报错）', () => {
    for (const tool of Object.values(WORKBENCH_TOOL_REGISTRY)) {
      expect(['panel', 'floating']).toContain(tool.dockPlacement)
    }
  })
})
```

新建 `apps/web/src/components/canvas/workbench/WorkbenchShell.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import WorkbenchShell from './WorkbenchShell.vue'

const mountShell = (props: Record<string, unknown> = {}, slots: Record<string, string> = {}) =>
  mount(WorkbenchShell, {
    props: { defaultWidth: 400, busy: false, ...props },
    slots: {
      viewport: '<div data-testid="stub-viewport" />',
      panel: '<div data-testid="stub-panel" />',
      ...slots,
    },
  })

describe('WorkbenchShell', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true })
  })

  it('渲染 viewport 与 panel 两个槽位，Shell 自身不带业务内容', () => {
    const w = mountShell()
    expect(w.find('[data-testid="workbench-shell"]').exists()).toBe(true)
    expect(w.find('[data-testid="stub-viewport"]').exists()).toBe(true)
    expect(w.find('[data-testid="stub-panel"]').exists()).toBe(true)
    expect(w.find('[data-testid="refine-toolbox"]').exists()).toBe(false)
  })

  it('panel 槽收到 useWorkbenchPanel 的状态与 floatingAvailable', () => {
    const w = mountShell()
    const panel = w.find('[data-testid="stub-panel"]')
    expect(panel.attributes('data-panel-width')).toBe('400')
    expect(panel.attributes('data-floating-available')).toBe('true')
  })

  it('窄屏（<640px）时 floatingAvailable = false（悬浮 dock 退化为面板落点）', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 480, configurable: true })
    const w = mountShell()
    await w.vm.$nextTick()
    expect(w.find('[data-testid="stub-panel"]').attributes('data-floating-available')).toBe('false')
  })

  it('Shell 是 flex 兄弟布局：viewport 与 panel 不同层叠（无绝对定位遮挡）', () => {
    const w = mountShell()
    const shell = w.find('[data-testid="workbench-shell"]')
    expect(shell.classes()).toContain('workbench-shell')
    expect(w.find('[data-testid="workbench-shell-panel"]').exists()).toBe(true)
  })
})
```

> 说明：为让上述断言可读，`WorkbenchShell.test.ts` 里的 `panel` 槽用「带 `data-panel-width` / `data-floating-available` 属性」的桩模板注入（Slots 里用函数式 slot 更直接，执行时可按 vue-test-utils 版本改成函数式 slot：`panel: (props) => h('div', { 'data-testid': 'stub-panel', 'data-panel-width': String(props.panelWidth), 'data-floating-available': String(props.floatingAvailable) })`）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @lnkpi/web test -- src/components/canvas/workbench/`
Expected: FAIL —— 两个模块不存在。

- [ ] **Step 3: 实现**

新建 `apps/web/src/components/canvas/workbench/workbenchToolRegistry.ts`：

```ts
import type { Component } from 'vue'
import RefineDock from '@/components/canvas/refine/RefineDock.vue'
import OutpaintPanel from '@/components/canvas/refine/OutpaintPanel.vue'
import RefineOutpaintDock from '@/components/canvas/refine/RefineOutpaintDock.vue'
import type { RefineMode } from '@/stores/canvasEditor'

/** 左栏图标描述（一级工具的 railItems；本期 select 的图标仍由 RefineToolRail 现行实现承担）。 */
export interface RailItemDescriptor {
  id: string
  label: string
  disabled?: boolean
  hint?: string
}

/**
 * 工具注册契约（spec §4）。**不注册就没有 UI**：右栏滚动区只渲染当前激活工具的 `panel`。
 *
 * - `dock`：产出型工具必填；确定性变换工具为 null（动作按钮归面板底部）。
 * - `dockPlacement`：就近原则 —— 操作焦点在画布取 'floating'，在文本/参数取 'panel'。
 */
export interface WorkbenchToolRegistration {
  id: string
  railItems?: RailItemDescriptor[]
  panel: Component
  dock: Component | null
  dockPlacement: 'panel' | 'floating'
}

export const WORKBENCH_TOOL_REGISTRY: Record<string, WorkbenchToolRegistration> = {
  'refine-select': {
    id: 'refine-select',
    panel: RefineDock,
    dock: RefineDock,
    dockPlacement: 'panel',
  },
  'refine-outpaint': {
    id: 'refine-outpaint',
    panel: OutpaintPanel,
    dock: RefineOutpaintDock,
    dockPlacement: 'floating',
  },
}

/** 查注册项；未注册返回 null（调用方据此不渲染面板 / dock）。 */
export function getWorkbenchTool(id: string | null | undefined): WorkbenchToolRegistration | null {
  if (!id) return null
  return WORKBENCH_TOOL_REGISTRY[id] ?? null
}

/** 精修工作区模式 → 一级工具 id。 */
export function toolIdForRefineMode(mode: RefineMode): string {
  return mode === 'outpaint' ? 'refine-outpaint' : 'refine-select'
}
```

> **`refine-select` 的 panel 是什么（§10「现状减 Toolbox」的落实）**：现状右栏滚动区里除 Toolbox 外只剩两样 —— 「快速预设：清除瑕疵」与「版本历史」。本包把版本条迁到右栏固定槽（§11），把「清除瑕疵」预设与模式说明收进一个轻量面板组件 `RefineSelectPanel`；而**编辑意图 chips 与覆盖率提示继续留在 `RefineDock`**（与生成动作强耦合，拆出无收益，§10）。因此 select 的注册项是 `panel: RefineSelectPanel` + `dock: RefineDock`。

新建 `apps/web/src/components/canvas/refine/RefineSelectPanel.vue`：

```vue
<script setup lang="ts">
/**
 * 精修（select）模式的右栏参数面板（§10「现状减 Toolbox」）。
 * 编辑意图 chips 与覆盖率提示留在 RefineDock（与生成动作强耦合，拆出无收益），
 * 故本面板只承载「快速预设」与模式说明，作为注册表里 refine-select 的 panel。
 */
withDefaults(defineProps<{ busy?: boolean }>(), { busy: false })

const emit = defineEmits<{ applyStainPreset: [] }>()
</script>

<template>
  <section class="refine-select-panel" data-testid="refine-select-panel">
    <div class="refine-select-panel__group">
      <div class="refine-select-panel__glabel">快速预设</div>
      <button
        type="button"
        class="refine-select-panel__item"
        data-testid="refine-select-preset-stain"
        :disabled="busy"
        @click="emit('applyStainPreset')"
      >
        清除瑕疵
      </button>
    </div>
    <p class="refine-select-panel__note">在画布上圈选要改的区域，然后在下方描述改动。</p>
  </section>
</template>

<style scoped>
.refine-select-panel { display: flex; flex-direction: column; gap: 14px; padding: 12px; }
.refine-select-panel__glabel { margin-bottom: 6px; color: var(--neo-text-muted); font-size: 10.5px; letter-spacing: .04em; }
.refine-select-panel__item {
  display: block; width: 100%; padding: 7px 10px; border: 1px solid var(--neo-border);
  border-radius: 10px; background: transparent; color: var(--neo-text-primary);
  font-size: 12.5px; text-align: left; cursor: pointer;
}
.refine-select-panel__item:hover:not(:disabled) { background: var(--neo-hover-bg); }
.refine-select-panel__item:disabled { opacity: .5; cursor: not-allowed; }
.refine-select-panel__note { margin: 0; color: var(--neo-text-muted); font-size: 11px; line-height: 1.5; }
</style>
```

并把注册表的 `refine-select.panel` 指向 `RefineSelectPanel`（`dock` 仍是 `RefineDock`）：

```ts
  'refine-select': {
    id: 'refine-select',
    panel: RefineSelectPanel,
    dock: RefineDock,
    dockPlacement: 'panel',
  },
```

新建 `apps/web/src/components/canvas/workbench/WorkbenchShell.vue`：

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useWorkbenchPanel } from './useWorkbenchPanel'

const props = withDefaults(defineProps<{
  defaultWidth?: number
  busy?: boolean
}>(), { defaultWidth: 400, busy: false })

const emit = defineEmits<{ close: [] }>()

/** Shell 只管布局与折叠（宽度 / 折叠 / 窄屏），不含任何业务状态（spec §5）。 */
const { panelWidth, collapsed, isNarrow, insetRight, setPanelWidth, setCollapsed } = useWorkbenchPanel({
  defaultWidth: props.defaultWidth,
  busy: () => props.busy,
  onClose: () => emit('close'),
})

/** 悬浮 dock 是否可用：窄屏退化为面板落点（§6.3）。 */
const floatingAvailable = computed(() => !isNarrow.value)
</script>

<template>
  <div class="workbench-shell" data-testid="workbench-shell">
    <div class="workbench-shell__viewport">
      <slot name="viewport" :inset-right="insetRight" />
    </div>
    <div class="workbench-shell__panel" data-testid="workbench-shell-panel">
      <slot
        name="panel"
        :panel-width="panelWidth"
        :collapsed="collapsed"
        :is-narrow="isNarrow"
        :inset-right="insetRight"
        :floating-available="floatingAvailable"
        :set-collapsed="setCollapsed"
        :set-panel-width="setPanelWidth"
      />
    </div>
  </div>
</template>

<style scoped>
/* 绝对定位于画布页容器之上（与既有 RefineWorkViewport 同一层），flex 兄弟布局：
   viewport（flex:1）与 panel 互不覆盖，dock 永远不会压在滚动区上（§4.3 布局铁律）。 */
.workbench-shell {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  min-width: 0;
}
.workbench-shell__viewport { position: relative; min-width: 0; flex: 1; }
.workbench-shell__panel { display: contents; }
</style>
```

> `panel` 槽保持 `display: contents`：`RefineSidePanel` 自身是 `Teleport` + `position: fixed` 的既有实现，本包不改其定位机制（避免动到已上线的折叠 / 窄屏行为）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @lnkpi/web test -- src/components/canvas/workbench/`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/canvas/workbench/ apps/web/src/components/canvas/refine/RefineSelectPanel.vue apps/web/src/components/canvas/refine/RefineDock.vue
git commit -m "feat(workbench): WorkbenchShell 布局外壳 + 工具注册表（panel/dock/dockPlacement 三件套）"
```

---

### Task 8: 左栏 rail 能力区 + 删除 `RefineToolbox`

**Files:**
- Modify: `apps/web/src/components/canvas/refine/refineToolRailModel.ts`
- Modify: `apps/web/src/components/canvas/refine/RefineToolRail.vue`
- Delete: `apps/web/src/components/canvas/refine/RefineToolbox.vue`
- Delete: `apps/web/src/components/canvas/refine/RefineToolbox.test.ts`
- Test: `apps/web/src/components/canvas/refine/refineToolRailModel.test.ts`、`apps/web/src/components/canvas/refine/RefineToolRail.test.ts`

**Interfaces:**
- Consumes: `RefineToolbox.vue` 内的 `CAPABILITY_GROUPS`（数据迁出，源文件删除）。
- Produces：
  - `REFINE_CAPABILITY_GROUPS: { id: string; label: string; price: '免费' | '积分'; items: { id: string; label: string; icon: string[] }[] }[]`（迁自 Toolbox 的 4 组 11 项，共 10 项对 rail 可见 —— `outpaint` 与既有的 `rail-mode-outpaint` 按钮合并为一枚，不重复渲染）
  - `REFINE_CAPABILITY_ITEMS: { id: string; label: string; icon: string[]; groupId: string; groupLabel: string; price: '免费' | '积分'; disabled: boolean; hint: string }[]`
  - rail DOM：`[data-testid="rail-capability-{id}"]`（禁用占位，`title` = `即将上线：{label}（M2 能力包，待独立规格实现）`）、`[data-testid="rail-capability-hr"]`（能力区分隔线）

- [ ] **Step 1: 写失败测试**

① 追加到 `refineToolRailModel.test.ts`：

```ts
describe('REFINE_CAPABILITY_ITEMS（Toolbox 能力组迁入 rail）', () => {
  it('4 组 11 项全部迁移，且去掉 outpaint（rail 已有独立扩图按钮）', () => {
    const ids = REFINE_CAPABILITY_ITEMS.map((i) => i.id)
    expect(ids).toEqual([
      'one-click-matting', 'subject', 'erase-object',
      'crop', 'grid-slice', 'rotate-flip',
      'inpaint', 'erase-replace',
      'upscale', 'enhance',
    ])
    expect(ids).not.toContain('outpaint')
  })

  it('全部禁用并带「即将上线」提示（点亮机制后续包翻 disabled）', () => {
    for (const item of REFINE_CAPABILITY_ITEMS) {
      expect(item.disabled).toBe(true)
      expect(item.hint).toContain('待独立规格实现')
      expect(item.icon.length).toBeGreaterThan(0)
    }
  })

  it('分组信息（组名 + 定价）随 item 保留，rail tooltip 可复用', () => {
    const byId = Object.fromEntries(REFINE_CAPABILITY_ITEMS.map((i) => [i.id, i]))
    expect(byId['one-click-matting']!.groupLabel).toBe('抠素材')
    expect(byId['one-click-matting']!.price).toBe('免费')
    expect(byId['inpaint']!.price).toBe('积分')
  })
})
```

② 追加到 `RefineToolRail.test.ts`：

```ts
  it('能力区：分隔线 + 10 项禁用图标（扩图不重复出现在能力区）', () => {
    const w = mountRail()
    expect(w.find('[data-testid="rail-capability-hr"]').exists()).toBe(true)
    expect(w.findAll('button[data-testid^="rail-capability-"]').length).toBe(10)
    expect(w.find('[data-testid="rail-capability-one-click-matting"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="rail-capability-one-click-matting"]').attributes('title')).toContain('即将上线')
    expect(w.find('[data-testid="rail-capability-outpaint"]').exists()).toBe(false)
  })

  it('扩图仍是左栏唯一的激活项（能力区只为占位）', async () => {
    const store = useCanvasEditorStore()
    const w = mountRail()
    await w.find('[data-testid="rail-mode-outpaint"]').trigger('click')
    expect(store.refineMode).toBe('outpaint')
    expect(w.find('[data-testid="rail-mode-outpaint"]').classes()).toContain('is-active')
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @lnkpi/web test -- src/components/canvas/refine/refineToolRailModel.test.ts src/components/canvas/refine/RefineToolRail.test.ts`
Expected: FAIL —— `REFINE_CAPABILITY_ITEMS` 未导出；能力区 DOM 不存在。

- [ ] **Step 3: 实现**

① `refineToolRailModel.ts` 追加（数据自 `RefineToolbox.vue` 的 `CAPABILITY_GROUPS` 原样搬迁，`outpaint` 项剔除）：

```ts
export type RefineCapabilityPrice = '免费' | '积分'

export interface RefineCapabilityItem {
  id: string
  label: string
  icon: string[]
  groupId: string
  groupLabel: string
  price: RefineCapabilityPrice
  disabled: boolean
  hint: string
}

interface RefineCapabilityGroup {
  id: string
  label: string
  price: RefineCapabilityPrice
  items: { id: string; label: string; icon: string[] }[]
}

/** 能力组占位（迁自原 RefineToolbox 的 CAPABILITY_GROUPS，§9）。outpaint 已由左栏独立按钮承担，不再列入。 */
export const REFINE_CAPABILITY_GROUPS: RefineCapabilityGroup[] = [
  {
    id: 'matting', label: '抠素材', price: '免费',
    items: [
      { id: 'one-click-matting', label: '一键抠图', icon: ['M12 3.5v13', 'M7 11.5l5 5 5-5', 'M5 20.5h14'] },
      { id: 'subject', label: '抠主体', icon: ['M12 4.5a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4z', 'M5 20c.8-4 3.4-6 7-6s6.2 2 7 6'] },
      { id: 'erase-object', label: '擦除', icon: ['M5 15.2l7.4-7.4a1.6 1.6 0 0 1 2.3 0l3.9 3.9a1.6 1.6 0 0 1 0 2.3L13.5 19H8.6z', 'M5 19.5h14.5'] },
    ],
  },
  {
    id: 'compose', label: '构图', price: '免费',
    items: [
      { id: 'crop', label: '裁剪', icon: ['M7 3.5v13.5h13.5', 'M3.5 7h13.5v13.5'] },
      { id: 'grid-slice', label: '宫格切分', icon: ['M4 4h16v16H4z', 'M9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16'] },
      { id: 'rotate-flip', label: '旋转翻转', icon: ['M5.5 9a7.5 7.5 0 0 1 13-1.5', 'M18.5 3.5v4h-4', 'M18.5 15a7.5 7.5 0 0 1-13 1.5', 'M5.5 20.5v-4h4'] },
    ],
  },
  {
    id: 'content', label: '改内容', price: '积分',
    items: [
      { id: 'inpaint', label: '局部重绘', icon: ['M5 19.5l3.8-.7L19.2 8.4a1.7 1.7 0 0 0 0-2.4l-1.2-1.2a1.7 1.7 0 0 0-2.4 0L5.7 15.2z', 'M14.8 6.6l2.6 2.6'] },
      { id: 'erase-replace', label: '消除替换', icon: ['M7 8h10l4 4-4 4H7l-4-4z', 'M9.5 11.5h5'] },
    ],
  },
  {
    id: 'quality', label: '提画质', price: '积分',
    items: [
      { id: 'upscale', label: '超分', icon: ['M6 20.5v-9M2.5 15L6 11.5 9.5 15', 'M18 3.5v9M14.5 9L18 12.5 21.5 9'] },
      { id: 'enhance', label: '增强', icon: ['M12 4l1.8 4.7L18.5 10.5l-4.7 1.8L12 17l-1.8-4.7L5.5 10.5l4.7-1.8z', 'M18.5 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z'] },
    ],
  },
]

/** 扁平化的能力项，供左栏 rail 渲染（全部禁用占位，点亮机制见 §14.2）。 */
export const REFINE_CAPABILITY_ITEMS: RefineCapabilityItem[] = REFINE_CAPABILITY_GROUPS.flatMap((group) =>
  group.items.map((item) => ({
    ...item,
    groupId: group.id,
    groupLabel: group.label,
    price: group.price,
    disabled: true,
    hint: `即将上线：${item.label}（M2 能力包，待独立规格实现）`,
  })),
)
```

② `RefineToolRail.vue`：在「撤销 / 重做」之后追加能力区（保持既有分组与顺序不变），import 补 `REFINE_CAPABILITY_ITEMS`：

```vue
    <div class="refine-rail__hr" data-testid="rail-capability-hr" />

    <!-- 能力区（§9）：Toolbox 能力组迁入左栏，全部禁用占位，M2 能力包逐个点亮 -->
    <div v-for="item in REFINE_CAPABILITY_ITEMS" :key="item.id" class="refine-rail__slot">
      <button
        type="button"
        class="refine-rail__btn"
        :data-testid="`rail-capability-${item.id}`"
        disabled
        :title="item.hint"
        :aria-label="item.label"
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <path v-for="(d, i) in item.icon" :key="i" :d="d" />
        </svg>
        <span class="refine-rail__name">{{ item.label }}</span>
      </button>
    </div>
```

③ 删除 `RefineToolbox.vue` 与 `RefineToolbox.test.ts`：

```bash
git rm apps/web/src/components/canvas/refine/RefineToolbox.vue apps/web/src/components/canvas/refine/RefineToolbox.test.ts
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @lnkpi/web test -- src/components/canvas/refine/refineToolRailModel.test.ts src/components/canvas/refine/RefineToolRail.test.ts`
Expected: PASS。此时 `RefineSidePanel.vue` 仍 import 已删除的 `RefineToolbox` → 留到 Task 9 修（`RefineSidePanel.test.ts` 此刻会红，属预期）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/canvas/refine/refineToolRailModel.ts apps/web/src/components/canvas/refine/RefineToolRail.vue apps/web/src/components/canvas/refine/refineToolRailModel.test.ts apps/web/src/components/canvas/refine/RefineToolRail.test.ts
git commit -m "feat(refine): 能力组迁入左栏 rail 能力区（禁用占位）；删除 RefineToolbox"
```

---

### Task 9: `RefineSidePanel` 骨架化 + `RefineWorkbench` 接 Shell + 悬浮 dock 接线

**Files:**
- Modify: `apps/web/src/components/canvas/refine/RefineSidePanel.vue`
- Modify: `apps/web/src/components/canvas/refine/RefineWorkbench.vue`
- Test: `apps/web/src/components/canvas/refine/RefineSidePanel.test.ts`
- Test: `apps/web/src/components/canvas/refine/RefineWorkbench.test.ts`

**Interfaces:**
- Consumes: Task 7 的 `getWorkbenchTool` / `toolIdForRefineMode` / `WorkbenchShell`；Task 4 的 `OutpaintPanel`；Task 6 的 `RefineOutpaintDock`；Task 1 的 `floorOutpaintRect` / `outpaintExtensionAmounts`。
- Produces：
  - `RefineSidePanel` 新增 props：`floatingAvailable: boolean`（由 Shell 经 panel 槽下发）；
  - 段落顺序变为：`head → compare-band → workbench-panel-scroll（当前工具 panel）→ version-strip → dock 槽`；
  - 悬浮 dock（扩图 + `floatingAvailable`）由 `RefineSidePanel` 内第二个 `Teleport` 渲染，`data-testid="outpaint-dock-floating"`。

- [ ] **Step 1: 改写测试（先红）**

① `RefineSidePanel.test.ts`（该文件已有 `mountPanel(overrides)` 与 `q` / `qa` 两个查 `document.body` 的辅助 —— 组件包在 `<Teleport>` 里，teleport 内容不在 wrapper 子树，**必须用 `q` / `qa`**；`VersionStrip` 已被 stub）：

```ts
  it('段落顺序：head → 对照带 → 当前工具面板 → 版本条 → dock（§5 骨架）', () => {
    mountPanel()
    const order = qa(
      '.refine-side__head, [data-testid="refine-compare-band"], [data-testid="workbench-panel-scroll"], [data-testid="refine-version-strip"], [data-testid="refine-dock"]',
    ).map((el) => {
      const tid = el.getAttribute('data-testid')
      if (el.classList.contains('refine-side__head')) return 'head'
      if (tid === 'workbench-panel-scroll') return 'panel-scroll'
      return (tid ?? '').replace('refine-', '')
    })
    expect(order).toEqual(['head', 'compare-band', 'panel-scroll', 'version-strip', 'dock'])
  })

  it('右栏不再有 Toolbox，滚动槽按注册表渲染当前工具面板', () => {
    mountPanel()
    expect(q('[data-testid="refine-toolbox"]')).toBeNull()
    expect(qa('[data-testid="workbench-panel-scroll"]').length).toBe(1)
    expect(q('[data-testid="refine-select-panel"]')).not.toBeNull()
  })

  it('扩图模式：滚动槽渲染 OutpaintPanel，dock 走悬浮（floatingAvailable=true）', async () => {
    const editor = useCanvasEditorStore()
    editor.setRefineMode('outpaint')
    editor.setRefineOutpaintBase({ width: 400, height: 300 })
    mountPanel({ floatingAvailable: true })
    await flushPromises()
    expect(q('[data-testid="outpaint-panel"]')).not.toBeNull()
    expect(q('[data-testid="outpaint-dock-floating"]')).not.toBeNull()
  })

  it('窄屏：扩图 dock 退化为面板底部（不渲染悬浮层）', async () => {
    const editor = useCanvasEditorStore()
    editor.setRefineMode('outpaint')
    editor.setRefineOutpaintBase({ width: 400, height: 300 })
    mountPanel({ floatingAvailable: false })
    await flushPromises()
    expect(q('[data-testid="outpaint-dock-floating"]')).toBeNull()
    expect(q('[data-testid="outpaint-dock"]')).not.toBeNull()
  })

  it('§4.3 布局铁律：dock 不嵌在滚动区内部（两者是 flex 兄弟，dock 在其后）', () => {
    mountPanel()
    const scroll = q('[data-testid="workbench-panel-scroll"]')!
    expect(scroll.querySelector('[data-testid="refine-dock"]')).toBeNull()
    expect(q('.refine-side__versions')).not.toBeNull()
  })

  it('§4.3 高度预算：滚动槽无内联高度（像素预算 ≤148 / ≤224 由目视验收把关）', () => {
    mountPanel()
    expect(q('[data-testid="workbench-panel-scroll"]')!.getAttribute('style')).toBeNull()
  })
```

② 删除所有「工具箱 / toolbox-scroll / toolbox-cap-*」相关断言（`RefineToolbox` 已删）；把所有**扩图**提交用例取按钮的方式从 `dock-run` 换成悬浮 dock 的 CTA —— 在文件里加一个辅助：

```ts
const runOutpaintButton = () => q('[data-testid="outpaint-dock-cta"]') as HTMLButtonElement | null
```

`select` / 普通精修用例继续用 `q('[data-testid="dock-run"]')`（注册表里 select 的 dock 落点在面板底部，未变）。「扩图提交守卫」describe 里的 `runButton()` 辅助改写为 `runOutpaintButton`，零扩展守卫用例改为断言新 CTA 与守卫文案：

```ts
  it('零扩展（rect == 原图）时 CTA 禁用并给引导文案；真实扩出后启用', async () => {
    const editor = useCanvasEditorStore()
    editor.setRefineMode('outpaint')
    editor.setRefineOutpaintBase({ width: 400, height: 300 })
    editor.setRefineOutpaintRect({ x: 0, y: 0, width: 400, height: 300 })
    mountPanel()
    await flushPromises()
    expect(runOutpaintButton()!.disabled).toBe(true)
    expect(q('[data-testid="outpaint-dock-guard"]')!.textContent).toContain('先拖动')

    editor.setRefineOutpaintRect({ x: 0, y: 0, width: 400, height: 400 })
    await flushPromises()
    expect(runOutpaintButton()!.disabled).toBe(false)
    expect(q('[data-testid="outpaint-dock-guard"]')).toBeNull()
  })
```

③ 新增「提交链路使用落像素矩形」的断言（§7：提交侧统一 `floorOutpaintRect`）：

```ts
  it('扩图提交的 outpaintTo 使用落像素后的 rect（不含小数）', async () => {
    const editor = useCanvasEditorStore()
    editor.setRefineMode('outpaint')
    editor.setRefineOutpaintBase({ width: 400, height: 300 })
    editor.setRefineOutpaintRect({ x: 0.4, y: 50.6, width: 400.2, height: 400.9 })
    mountPanel()
    await flushPromises()
    runOutpaintButton()!.click()
    await flushPromises()
    const calls = (studioApi.editImage as unknown as { mock: { calls: [Record<string, unknown>][] } }).mock.calls
    expect(calls.at(-1)![0]!.outpaintTo).toEqual({ width: 400, height: 400 })
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @lnkpi/web test -- src/components/canvas/refine/RefineSidePanel.test.ts`
Expected: FAIL —— `workbench-panel-scroll` / `refine-version-strip` / `outpaint-dock-floating` 均不存在，且 import 已删除的 `RefineToolbox`。

- [ ] **Step 3: 实现**

① `RefineSidePanel.vue` script 改动：

```ts
import { getWorkbenchTool, toolIdForRefineMode } from '@/components/canvas/workbench/workbenchToolRegistry'
import { hasOutpaintExtension, floorOutpaintRect, type OutpaintRect } from './outpaintGeometry'
import RefineOutpaintDock from './RefineOutpaintDock.vue'
// 删除：import RefineToolbox from './RefineToolbox.vue'
```

props 增：

```ts
  /** 悬浮 dock 是否可用（由 WorkbenchShell 依窄屏判定下发，§6.3）。 */
  floatingAvailable?: boolean
```

（该组件用 `defineProps<{...}>()` 无 `withDefaults`，因此判据写成 `props.floatingAvailable !== false` —— 既有直接挂载 `RefineSidePanel` 的单测不传该 prop 时按 `true` 处理，保持悬浮渲染，避免大面积改测试。）

新增派生态：

```ts
/** 当前激活的一级工具（注册表是唯一真相：未注册 → 无面板、无 dock）。 */
const activeTool = computed(() => getWorkbenchTool(toolIdForRefineMode(editor.refineMode)))
/** 扩图 dock 的落点：注册表声明 floating 且悬浮可用 → 悬浮；否则退化为面板底部。 */
const outpaintDockFloating = computed(
  () => activeTool.value?.dockPlacement === 'floating' && props.floatingAvailable !== false,
)
/** select 的 dock 落点：注册表声明 panel（产出型工具必有 dock，§4.2）。 */
const selectDockInPanel = computed(
  () => activeTool.value?.dockPlacement === 'panel' && !!activeTool.value.dock,
)
/** 扩图是否已真实扩出（CTA 守卫，§6.3）。 */
const outpaintCanRun = computed(() => {
  const base = editor.refineOutpaintBase
  const rect = editor.refineOutpaintRect
  return !!base && !!rect && hasOutpaintExtension(base, rect)
})
```

`runOutpaint` 改为使用「store 基准 + 落像素矩形」（§7：权威草稿含小数，提交侧统一 `floorOutpaintRect`；基准从 store 取，几何不再依赖 props）：

```ts
async function runOutpaint() {
  const base = editor.refineOutpaintBase
  const raw = editor.refineOutpaintRect
  if (!base || !raw) return
  const baseW = base.width
  const baseH = base.height
  if (!baseW || !baseH) return
  const rect = floorOutpaintRect(raw)          // §7：提交侧统一落像素
  if (!hasOutpaintExtension({ width: baseW, height: baseH }, rect)) return

  errorMessage.value = ''
  abortController?.abort()
  abortController = new AbortController()
  const signal = abortController.signal
  busy.value = true

  try {
    const img = await loadBaseImage(props.beforeUrl)
    const { baseSpec, maskSpec } = computeOutpaintLayers({ width: baseW, height: baseH }, rect)
    const { baseBlob, maskBlob } = await renderOutpaintPngs(img, { baseSpec, maskSpec })

    const baseFile = new File([baseBlob], 'outpaint-base.png', { type: 'image/png' })
    const maskFile = new File([maskBlob], 'outpaint-mask.png', { type: 'image/png' })
    const baseFallback = URL.createObjectURL(baseFile)
    const maskFallback = URL.createObjectURL(maskFile)
    let baseUrl: string = baseFallback
    let maskUrl: string = maskFallback
    try {
      baseUrl = await persistMediaUrl(baseFile, baseFallback)
      maskUrl = await persistMediaUrl(maskFile, maskFallback)
    } finally {
      if (baseUrl !== baseFallback) URL.revokeObjectURL(baseFallback)
      if (maskUrl !== maskFallback) URL.revokeObjectURL(maskFallback)
    }

    const promptText = prompt.value.trim() ? prompt.value : OUTPAINT_FALLBACK_PROMPT
    const { data } = await studioApi.editImage(
      {
        prompt: promptText,
        imageUrl: baseUrl,
        maskUrl,
        model: modelKey.value,
        size: 'auto',
        mode: 'outpaint',
        outpaintFrom: { width: baseW, height: baseH },
        outpaintTo: { width: rect.width, height: rect.height },
        sessionId: props.sessionId,
        nodeId: props.nodeId,
        parentRecordId: props.generationRecordId,
        parentVersionId: props.currentVersionId,
      },
      signal,
    )
    const url = data.data.url
    if (url) {
      afterUrl.value = url
      lastRecordId.value = data.data.id
      // Task 8（既有）：快照本次扩图的对照元数据，对照带据此进入「基准画布」模式
      outpaintMeta.value = {
        editMode: 'outpaint',
        outpaintFrom: { width: baseW, height: baseH },
        outpaintTo: { width: rect.width, height: rect.height },
      }
    }
  } catch (err) {
    const message = formatError(err, '扩图失败，请重试')
    if (message) errorMessage.value = message
  } finally {
    busy.value = false
    abortController = null
  }
}
```

同时把既有的 `outpaintReady` computed 改为复用 `outpaintCanRun`（同一判据，避免 base 有两个来源），`refineDisabled` 引用关系不变：

```ts
const outpaintReady = computed(() => outpaintCanRun.value)
```

② 模板：`refine-side__body` 内不再渲染 Toolbox，改为注册表面板 + 版本条 + dock 槽：

```vue
      <div v-if="!collapsed" class="refine-side__body">
        <div class="refine-side__scroll" data-testid="workbench-panel-scroll">
          <component
            :is="activeTool.panel"
            v-if="activeTool"
            :busy="busy"
            @apply-stain-preset="applyStainPreset"
          />
        </div>
        <div class="refine-side__versions" data-testid="refine-version-strip">
          <VersionStrip
            :versions="versions"
            :current-version-id="currentVersionId"
            :disabled="busy"
            @select="onSelectVersion"
            @revert="onRevert"
          />
        </div>
      </div>

      <!-- select：panel 落点 dock（注册表声明 dockPlacement: 'panel'） -->
      <RefineDock
        v-if="!collapsed && selectDockInPanel"
        :prompt="prompt"
        :credits="credits"
        :before-url="beforeUrl"
        :model-key="modelKey"
        :available-model-keys="IMAGE_EDIT_MODEL_KEYS"
        :sizes="IMAGE2_EDIT_SIZES"
        :size-override="sizeOverride"
        :mode="dockMode"
        :outpaint-ready="outpaintReady"
        :busy="busy"
        :disabled="refineDisabled"
        :can-apply="canApply"
        :error-message="errorMessage"
        :coverage-kind="coverageKind"
        :width="width"
        :height="height"
        :active-edit-intent-id="activeGuideEditIntentId"
        :ref-role-hints="activeRefRoleHints"
        @update:prompt="prompt = $event"
        @update:model-key="modelKey = $event"
        @update:size-override="sizeOverride = $event"
        @run="runRefine"
        @apply="onApply"
        @retry="runRefine"
        @select-edit-intent="applyEditIntent"
        @clear-edit-intent="clearEditIntent"
      />
```

（`RefineToolbox` 的 `@apply-stain-preset` / `@select-version` / `@revert-version` 三处接线分别迁到 `RefineSelectPanel` 与 `VersionStrip`；`onRevert` 保持现有签名 `(versionId: string)` 与 `VersionStrip` 的 `{ versionId }` 解包约定 —— 原封装在 Toolbox 里的解包逻辑随之迁到 `RefineSidePanel`：

```ts
function onRevertVersion(payload: { versionId: string }) {
  onRevert(payload.versionId)
}
```

模板里 `@revert="onRevertVersion"`。）

script 里还需补一个 import（原先由 Toolbox 承担）：

```ts
import VersionStrip from './VersionStrip.vue'
```


③ 悬浮 dock（扩图）：在 `Teleport` 之后追加第二个 Teleport 分支：

```vue
  <!-- 扩图悬浮 dock：视口底部居中、尊重右栏内缩（§6.3）；窄屏时改走面板底部（outpaintDockInPanel） -->
  <Teleport v-if="!collapsed && outpaintDockFloating" to="body">
    <div
      class="refine-outpaint-floating"
      data-testid="outpaint-dock-floating"
      :style="{ right: `${insetRight}px` }"
    >
      <RefineOutpaintDock
        :prompt="prompt"
        :model-key="modelKey"
        :available-model-keys="IMAGE_EDIT_MODEL_KEYS"
        :credits="credits"
        :can-run="outpaintCanRun"
        :busy="busy"
        :can-apply="canApply"
        :error-message="errorMessage"
        @update:prompt="prompt = $event"
        @update:modelKey="modelKey = $event"
        @run="runRefine"
        @apply="onApply"
        @retry="runRefine"
        @exit="editor.setRefineMode('select')"
        @cancel="onBackOrCancel"
      />
    </div>
  </Teleport>
```

④ 面板底部兜底（窄屏扩图，§6.3「窄屏退化为面板底部常驻，复用 panel 落点渲染」）：

```vue
      <RefineOutpaintDock
        v-else-if="!collapsed && editor.refineMode === 'outpaint' && activeTool?.dockPlacement === 'floating'"
        :prompt="prompt"
        :model-key="modelKey"
        :available-model-keys="IMAGE_EDIT_MODEL_KEYS"
        :credits="credits"
        :can-run="outpaintCanRun"
        :busy="busy"
        :can-apply="canApply"
        :error-message="errorMessage"
        @update:prompt="prompt = $event"
        @update:modelKey="modelKey = $event"
        @run="runRefine"
        @apply="onApply"
        @retry="runRefine"
        @exit="editor.setRefineMode('select')"
        @cancel="onBackOrCancel"
      />
```

（`v-else-if` 与③的 `Teleport v-if` 配对：悬浮可用时走悬浮，否则落到面板底部 —— 两者互斥，任何时刻只有一个 dock 实例。）

⑤ 样式：

```css
.refine-side__body { display: flex; min-height: 0; flex: 1; flex-direction: column; overflow: hidden; }
/* 唯一滚动区（§4.3 布局铁律：dock 与版本条是 flex 兄弟，绝不覆盖滚动区） */
.refine-side__scroll { min-height: 0; flex: 1; overflow-y: auto; }
.refine-side__versions { flex: 0 0 auto; padding: 8px 12px; border-top: 1px solid var(--neo-border); }

.refine-outpaint-floating {
  position: fixed;
  left: 56px;              /* 让出左栏 rail */
  bottom: 16px;
  z-index: 56;
  display: flex;
  justify-content: center;
  pointer-events: none;    /* 容器不吃事件，仅 dock 本身可点 */
}
```

⑥ `RefineWorkbench.vue`：改为 Shell 的消费者。

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import WorkbenchShell from '@/components/canvas/workbench/WorkbenchShell.vue'
import type { ImageVersionEntry } from '@lnkpi/shared'
import type { RefineApplyPayload } from './compareViewModel'
import RefineWorkViewport from './RefineWorkViewport.vue'
import RefineSidePanel from './RefineSidePanel.vue'
import { useNaturalImageSize } from './useNaturalImageSize'
</script>

<template>
  <WorkbenchShell
    :default-width="400"
    :busy="editor.refineBusy"
    @close="onClose"
  >
    <template #viewport="{ insetRight }">
      <RefineWorkViewport
        v-show="!editor.compareLightboxOpen"
        :url="url"
        :width="width"
        :height="height"
        :inset-right="insetRight"
        :has-after="hasAfter"
      />
    </template>

    <template #panel="{ panelWidth, collapsed, isNarrow, insetRight, floatingAvailable, setCollapsed }">
      <RefineSidePanel
        :node-id="nodeId"
        :before-url="beforeUrl"
        :versions="versions"
        :current-version-id="currentVersionId"
        :session-id="sessionId"
        :generation-record-id="generationRecordId"
        :width="mediaSize.width.value"
        :height="mediaSize.height.value"
        :panel-width="panelWidth"
        :collapsed="collapsed"
        :is-narrow="isNarrow"
        :inset-right="insetRight"
        :floating-available="floatingAvailable"
        @close="emit('close')"
        @apply="emit('apply', $event)"
        @revert="emit('revert', $event)"
        @busy="emit('busy', $event)"
        @update:collapsed="setCollapsed($event)"
        @update:panel-width="setPanelWidth($event)"
      />
    </template>
  </WorkbenchShell>
</template>
```

注意：`panel` 槽里用到 `setPanelWidth`，需在解构中一并取出（`{ panelWidth, collapsed, isNarrow, insetRight, floatingAvailable, setCollapsed, setPanelWidth }`）。`RefineWorkbench.vue` 内原本自建的 `useWorkbenchPanel` 调用**删除**（职责已归 Shell），`onClose` 的 Esc 分级逻辑保留（改挂在 Shell 的 `@close`）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @lnkpi/web test -- src/components/canvas/refine/RefineSidePanel.test.ts src/components/canvas/refine/RefineWorkbench.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/canvas/refine/RefineSidePanel.vue apps/web/src/components/canvas/refine/RefineSidePanel.test.ts apps/web/src/components/canvas/refine/RefineWorkbench.vue apps/web/src/components/canvas/refine/RefineWorkbench.test.ts
git commit -m "feat(refine): 右栏骨架按注册表渲染面板与 dock 落点；RefineWorkbench 接入 WorkbenchShell"
```

---

### Task 10: 全链路验证与收尾

**Files:** 无新增（只跑验证、目视、记录）

**Interfaces:**
- Consumes: Task 1–9 的全部产出。
- Produces: 一份可回贴到 PR 的验证记录（测试计数 / 构建结果 / 目视结论）。

- [ ] **Step 1: 串行跑测试（web 与 server 不要并行，会互相杀进程）**

```bash
pnpm --filter @lnkpi/web test
```
Expected: 全绿，**用例数 ≥ 976**（基线只增不减）。把实际数字记下来。

```bash
pnpm --filter @lnkpi/server test
pnpm --filter @lnkpi/agent test
```
Expected: 全绿（server 需先 `prisma generate`）。

- [ ] **Step 2: 类型检查与构建**

```bash
pnpm --filter @lnkpi/server exec prisma generate
pnpm build
```
Expected: `vue-tsc -b` 零错误，构建产物正常输出。

> 已知坑：`apps/web/vite.config.js` 是 `vue-tsc -b` 的编译产物却已被 git 跟踪，`pnpm build` 后会改脏工作区。提交时剔除它（本包不提交该文件）。

- [ ] **Step 3: 真实浏览器目视验收（spec §12.2 九条）**

启动本地前端并逐条核对：

```bash
lsof -ti:5199 | xargs kill -9 2>/dev/null; pnpm --filter @lnkpi/web dev -- --port 5199
```

1. 进入扩图：工作图居中缩小、四周 8 手柄（角圆 / 边胶囊）。
2. 拖拽任一柄：3×3 网格 + 顶部尺寸胶囊出现；松手消失且范围保留；连拖不同柄扩展区不互相吞。
3. 点比例 chip：画布变该比例、包含原图、对称扩展；面板数字与四向读数同步。
4. 改宽 / 高输入：同步生效。
5. 未扩展时 CTA 禁用 + 引导；扩展后可生成；生成后对照带出前后对照。
6. `×` 退出扩图回 select；select 右栏无 Toolbox、能力图标在左栏且禁用。
7. **dock 三查**：滚动区可滚到底、最后一条不被 dock 挡住；dock 默认态 ≤148px、prompt 展开 ≤224px；主 CTA 为圆形 `↑`，禁用态形状不变仅变灰；dock 内无「原图 尺寸·比例」徽标行。
8. **退出语义查**：select 的 dock 头排无 ×；扩图悬浮 dock 的 × 只退回 select；面板 header × 与左上「返回画布」才关工作台；Esc 逐级退出。
9. 窄屏 <640px：悬浮 dock 退化为面板底部；滚动区仍可滚到底。

- [ ] **Step 4: 规格配图规范自检**

```bash
pnpm verify-spec-figures
```
Expected: 0 错误（本计划文档不含图；若实现过程中新增了图，必须补图注 + §0 索引）。

- [ ] **Step 5: 提交验证记录并开 PR**

```bash
git add -A && git status --short
git commit -m "chore(web): 扩图打样全链路验证记录" --allow-empty
git push -u origin <feature-branch>
/usr/local/bin/gh pr create --fill
/usr/local/bin/gh pr checks --watch
```

Expected: CI 全绿（含 `spec-figures` job）后 **Squash Merge**。