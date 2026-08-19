# 画布图像精修壳层（CX-IMAGE-EDIT-CHROME）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把画布精修从底部 Dock 换成右侧停靠/浮动侧栏：选区画在图片节点上，对照支持左右与重叠滑竿，应用前节点始终显示 Before。

**Architecture:** 后端 `POST /studio/image/edit` 与版本链不动。纯函数先锁互斥、wipe 夹取、应用前 URL 断言。`CompareView` 增加 `split | wipe`；`MaskEditor` 以 `surface: 'node'` 叠在节点预览上，经 store 注册 `exportPng`/`clear`。`RefineSidePanel` 替换 `RefineDockPanel` 作为主壳。Agent `closePanel` + `canOpen` 门闩实现停靠互斥。

**Tech Stack:** Vue 3 + Pinia、VueFlow、Element Plus Drawer、Vitest

**Spec:** `docs/superpowers/specs/2026-08-19-cx-image-edit-sidepanel-design.md`

## Global Constraints

- **禁止**改 `ImageProvider.generate()` / `buildImageProviderOptions()` / `run_icon_refine` / Prisma schema / `/image-studio`
- **禁止**抽公共 RightDock；**禁止**把精修做成 Inspector Tab
- 选中节点**不得**打开精修；入口仍仅显式
- 应用前节点 `url` 必须等于 session Before；After 只进对照
- 停靠默认宽 **400px**，可拖 **360–560px**；窄屏 **< 640px** 禁止浮动
- 文案：标题「精修」；浮动 title「切换为浮动窗口」/「停靠回侧栏」（同 Agent）
- mask PNG：选区 RGB 白 + A=255；保留 RGB 黑 + A=0；覆盖 &lt; 0.3% 不可提交
- 本轮对照模式只有 `split` | `wipe`。上下擦除 / 溶解 / 闪光见文末 Deferred（不要实现）
- TDD：先写失败测试再实现；提交前缀 `feat:`
- 不 `git add -A`；勿提交 `.seedream-backup`、`deploy/`、`q.js`

## File map

| File | Responsibility |
|------|----------------|
| `apps/web/src/utils/refineChrome.ts` | Agent/Inspector 互斥、wipe 夹取、应用前 URL 断言 |
| `apps/web/src/stores/canvasEditor.ts` | `refineChrome` + mask handle 注册 |
| `apps/web/src/components/canvas/refine/CompareView.vue` | `split` / `wipe` |
| `apps/web/src/components/canvas/refine/CompareLightbox.vue` | 最大化对照，同步缩放/平移 |
| `apps/web/src/components/canvas/refine/MaskEditor.vue` | `surface: 'node'` overlay |
| `apps/web/src/components/canvas/refine/RefineSidePanel.vue` | 停靠抽屉 + 浮动壳 + 工具/指令/迷你对照 |
| `apps/web/src/components/canvas/CanvasNodeImage.vue` | 目标节点上挂 MaskEditor |
| `apps/web/src/components/canvas/CanvasNodeMediaInput.vue` | 图片类 mediaInput 同样挂 overlay |
| `apps/web/src/pages/CanvasPage.vue` | 换壳、藏生成 Dock、fitView、接线 |
| `apps/web/src/components/agent/AgentSideRail.vue` | `canOpen` + expose `closePanel` |
| `apps/web/src/composables/useMediaInspector.ts` | 打开 Inspector 时走互斥 |
| `apps/web/src/components/canvas/refine/RefineDockPanel.vue` | 删除（逻辑迁到 SidePanel） |

---

### Task 0: 分支

- [ ] **Step 1:** 当前应在含规格的 `docs/cx-image-edit-sidepanel`（或已合入该 commit 的 main）。

```bash
git checkout -b feature/cx-image-edit-chrome
```

- [ ] **Step 2:** 确认基线

```bash
pnpm --filter @lnkpi/web test -- src/utils/refineSession.test.ts src/components/canvas/refine/syncRefineUrls.test.ts src/stores/canvasEditor.refine.test.ts
```

Expected: PASS

---

### Task 1: 壳层纯函数

**Files:**
- Create: `apps/web/src/utils/refineChrome.ts`
- Create: `apps/web/src/utils/refineChrome.test.ts`

**Interfaces:**
- Produces:
  - `export type RefineChromeMode = 'docked' | 'floating'`
  - `export type CompareMode = 'split' | 'wipe'`
  - `export type AgentOpenWhileRefine = 'allow' | 'dismiss-refine' | 'block'`
  - `export type InspectorOpenWhileRefine = 'allow' | 'dismiss-refine' | 'block'`
  - `export function clampWipeRatio(n: number): number`
  - `export function decideAgentOpenWhileRefine(input: { refineOpen: boolean; refineBusy: boolean; refineChrome: RefineChromeMode }): AgentOpenWhileRefine`
  - `export function decideInspectorOpenWhileRefine(input: { refineOpen: boolean; refineBusy: boolean }): InspectorOpenWhileRefine`
  - `export function shouldApplyRefineToNode(input: { nodeUrl: string; sessionBeforeUrl: string }): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import {
  clampWipeRatio,
  decideAgentOpenWhileRefine,
  decideInspectorOpenWhileRefine,
  shouldApplyRefineToNode,
} from './refineChrome'

describe('clampWipeRatio', () => {
  it('clamps to [0, 1] and defaults non-finite to 0.5', () => {
    expect(clampWipeRatio(-1)).toBe(0)
    expect(clampWipeRatio(2)).toBe(1)
    expect(clampWipeRatio(0.25)).toBe(0.25)
    expect(clampWipeRatio(Number.NaN)).toBe(0.5)
  })
})

describe('decideAgentOpenWhileRefine', () => {
  it('allows when refine is closed', () => {
    expect(
      decideAgentOpenWhileRefine({
        refineOpen: false,
        refineBusy: false,
        refineChrome: 'docked',
      }),
    ).toBe('allow')
  })

  it('allows when refine is floating', () => {
    expect(
      decideAgentOpenWhileRefine({
        refineOpen: true,
        refineBusy: true,
        refineChrome: 'floating',
      }),
    ).toBe('allow')
  })

  it('dismisses idle docked refine', () => {
    expect(
      decideAgentOpenWhileRefine({
        refineOpen: true,
        refineBusy: false,
        refineChrome: 'docked',
      }),
    ).toBe('dismiss-refine')
  })

  it('blocks busy docked refine', () => {
    expect(
      decideAgentOpenWhileRefine({
        refineOpen: true,
        refineBusy: true,
        refineChrome: 'docked',
      }),
    ).toBe('block')
  })
})

describe('decideInspectorOpenWhileRefine', () => {
  it('allows when refine is closed', () => {
    expect(
      decideInspectorOpenWhileRefine({ refineOpen: false, refineBusy: false }),
    ).toBe('allow')
  })

  it('dismisses idle refine', () => {
    expect(
      decideInspectorOpenWhileRefine({ refineOpen: true, refineBusy: false }),
    ).toBe('dismiss-refine')
  })

  it('blocks while refine is busy', () => {
    expect(
      decideInspectorOpenWhileRefine({ refineOpen: true, refineBusy: true }),
    ).toBe('block')
  })
})

describe('shouldApplyRefineToNode', () => {
  it('allows apply only when the node url is still the session before url', () => {
    expect(
      shouldApplyRefineToNode({
        nodeUrl: 'https://cdn/before.png',
        sessionBeforeUrl: 'https://cdn/before.png',
      }),
    ).toBe(true)
    expect(
      shouldApplyRefineToNode({
        nodeUrl: 'https://cdn/after.png',
        sessionBeforeUrl: 'https://cdn/before.png',
      }),
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @lnkpi/web test -- src/utils/refineChrome.test.ts
```

Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

```ts
export type RefineChromeMode = 'docked' | 'floating'
export type CompareMode = 'split' | 'wipe'
export type AgentOpenWhileRefine = 'allow' | 'dismiss-refine' | 'block'
export type InspectorOpenWhileRefine = 'allow' | 'dismiss-refine' | 'block'

export function clampWipeRatio(n: number): number {
  if (!Number.isFinite(n)) return 0.5
  return Math.min(1, Math.max(0, n))
}

export function decideAgentOpenWhileRefine(input: {
  refineOpen: boolean
  refineBusy: boolean
  refineChrome: RefineChromeMode
}): AgentOpenWhileRefine {
  if (!input.refineOpen) return 'allow'
  if (input.refineChrome === 'floating') return 'allow'
  if (input.refineBusy) return 'block'
  return 'dismiss-refine'
}

export function decideInspectorOpenWhileRefine(input: {
  refineOpen: boolean
  refineBusy: boolean
}): InspectorOpenWhileRefine {
  if (!input.refineOpen) return 'allow'
  if (input.refineBusy) return 'block'
  return 'dismiss-refine'
}

export function shouldApplyRefineToNode(input: {
  nodeUrl: string
  sessionBeforeUrl: string
}): boolean {
  return input.nodeUrl === input.sessionBeforeUrl
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @lnkpi/web test -- src/utils/refineChrome.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/utils/refineChrome.ts apps/web/src/utils/refineChrome.test.ts
git commit -m "feat(web): add refine chrome mutex and wipe clamp helpers"
```

---

### Task 2: CompareView 左右 + 重叠

**Files:**
- Modify: `apps/web/src/components/canvas/refine/CompareView.vue`
- Create: `apps/web/src/components/canvas/refine/compareViewModel.ts`
- Create: `apps/web/src/components/canvas/refine/compareViewModel.test.ts`

**Interfaces:**
- Consumes: `clampWipeRatio`, `CompareMode`
- Produces:
  - `export function wipeHoldRatio(showingOriginal: boolean, wipeRatio: number): number` — 按住原图时返回 `0`，否则返回夹取后的 `wipeRatio`
  - `CompareView` props: `beforeUrl`, `afterUrl?`, `mode?: CompareMode`（默认 `'split'`）, `wipeRatio?: number`（默认 `0.5`）, `showingOriginal?`, `compact?: boolean`
  - emits: `update:showingOriginal`, `update:wipeRatio`

无 After 时调用方禁用切换到 wipe；组件在 `!afterUrl` 时强制按 split 渲染。

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { wipeHoldRatio } from './compareViewModel'

describe('wipeHoldRatio', () => {
  it('snaps to full Before while holding original', () => {
    expect(wipeHoldRatio(true, 0.7)).toBe(0)
  })

  it('keeps the current wipe ratio when not holding', () => {
    expect(wipeHoldRatio(false, 0.7)).toBe(0.7)
  })
})
```

- [ ] **Step 2: Run to fail**

```bash
pnpm --filter @lnkpi/web test -- src/components/canvas/refine/compareViewModel.test.ts
```

Expected: FAIL module not found

- [ ] **Step 3: Implement model + CompareView**

`compareViewModel.ts`:

```ts
import { clampWipeRatio } from '@/utils/refineChrome'

export function wipeHoldRatio(showingOriginal: boolean, wipeRatio: number): number {
  if (showingOriginal) return 0
  return clampWipeRatio(wipeRatio)
}
```

`CompareView.vue` 在现有 split 网格之外，当 `mode === 'wipe' && afterUrl` 时渲染单画框：

- 底层 `<img :src="afterUrl">`（右 = After）
- 上层 Before 用 `clip-path: inset(0 ${ (1 - effectiveRatio) * 100 }% 0 0)`，使分界**左 = Before、右 = After**（`effectiveRatio === 0` 全 Before）
- 竖线 + 圆钮 `left: ${effectiveRatio * 100}%`；`pointerdown` 后在 `window` 上跟 `mousemove`，用画框 `getBoundingClientRect()` 把 `clientX` 映射到 0–1，`emit('update:wipeRatio', clampWipeRatio(...))`
- 单击分界**不要**改 `mode`
- 「原图」按钮逻辑保持；wipe 下按住走 `wipeHoldRatio`
- Space 按住原图保持现有 `shouldSkipSpaceHold`

`compact === true`（最大化）时去掉 `max-height: 220px`，图 `object-fit: contain; width: 100%; height: 100%`。

- [ ] **Step 4: Run model tests**

```bash
pnpm --filter @lnkpi/web test -- src/components/canvas/refine/compareViewModel.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/canvas/refine/CompareView.vue apps/web/src/components/canvas/refine/compareViewModel.ts apps/web/src/components/canvas/refine/compareViewModel.test.ts
git commit -m "feat(web): add split and wipe compare modes"
```

---

### Task 3: 最大化对照

**Files:**
- Create: `apps/web/src/components/canvas/refine/CompareLightbox.vue`
- Create: `apps/web/src/components/canvas/refine/compareLightboxTransform.ts`
- Create: `apps/web/src/components/canvas/refine/compareLightboxTransform.test.ts`

**Interfaces:**
- Consumes: `CompareView`, `CompareMode`, `clampWipeRatio`
- Produces:
  - `export function panZoomFromWheel(input: { scale: number; panX: number; panY: number; deltaY: number }): { scale: number; panX: number; panY: number }`
    - `nextScale = clamp(scale * (deltaY > 0 ? 0.9 : 1.1), 1, 8)`
    - 缩到 1 时 `panX/panY = 0`
  - `export function panFromDrag(input: { panX: number; panY: number; dx: number; dy: number }): { panX: number; panY: number }`
  - Lightbox props: `open`, `beforeUrl`, `afterUrl?`, `mode`, `wipeRatio`
  - emits: `close`, `update:mode`, `update:wipeRatio`
  - **不**发精修 / apply / mask

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { panFromDrag, panZoomFromWheel } from './compareLightboxTransform'

describe('panZoomFromWheel', () => {
  it('zooms out toward 1 and clears pan at minimum scale', () => {
    const next = panZoomFromWheel({
      scale: 1.1,
      panX: 40,
      panY: -20,
      deltaY: 100,
    })
    expect(next.scale).toBeCloseTo(1)
    expect(next.panX).toBe(0)
    expect(next.panY).toBe(0)
  })

  it('zooms in and clamps at 8', () => {
    const next = panZoomFromWheel({
      scale: 8,
      panX: 10,
      panY: 10,
      deltaY: -100,
    })
    expect(next.scale).toBe(8)
    expect(next.panX).toBe(10)
    expect(next.panY).toBe(10)
  })
})

describe('panFromDrag', () => {
  it('adds pointer deltas to pan', () => {
    expect(panFromDrag({ panX: 4, panY: 5, dx: 2, dy: -3 })).toEqual({
      panX: 6,
      panY: 2,
    })
  })
})
```

- [ ] **Step 2: Run to fail**

```bash
pnpm --filter @lnkpi/web test -- src/components/canvas/refine/compareLightboxTransform.test.ts
```

Expected: FAIL module not found

- [ ] **Step 3: Implement transform helpers + lightbox**

```ts
export function panZoomFromWheel(input: {
  scale: number
  panX: number
  panY: number
  deltaY: number
}): { scale: number; panX: number; panY: number } {
  const factor = input.deltaY > 0 ? 0.9 : 1.1
  const scale = Math.min(8, Math.max(1, input.scale * factor))
  if (scale === 1) return { scale, panX: 0, panY: 0 }
  return { scale, panX: input.panX, panY: input.panY }
}

export function panFromDrag(input: {
  panX: number
  panY: number
  dx: number
  dy: number
}): { panX: number; panY: number } {
  return { panX: input.panX + input.dx, panY: input.panY + input.dy }
}
```


Lightbox：`v-if="open"` 全屏 `fixed inset-0 z-[80]` 遮罩。顶栏：`左右` | `重叠`（无 after 时重叠 disabled）、关闭。主体 `overflow: hidden`，内部 `transform: translate(panX, panY) scale(scale)` 包一层 `CompareView` `:compact="true"`。滚轮调 scale；在空白处 pointer 拖 pan（wipe 手柄 `stopPropagation` 以免抢平移）。Esc 调 `close`。不改 mask、不请求 API。

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit** `feat(web): add refine compare lightbox with shared pan-zoom`

---

### Task 4: 节点 MaskEditor overlay

**Files:**
- Modify: `apps/web/src/components/canvas/refine/MaskEditor.vue`
- Modify: `apps/web/src/components/canvas/refine/maskCanvasReady.ts` 仅当需要把 `surface` 纳入 ready 判定时；默认不改判定公式

**Interfaces:**
- Produces: prop `surface?: 'panel' | 'node'` 默认 `'panel'`
  - `'node'`：不渲染底图 `<img>`（节点已有预览）；根节点 `position:absolute; inset:0`；canvas 加 `nodrag nowheel`；`width/height: 100%`
  - `'panel'`：保持现有缩略图行为（SidePanel 不再挂 MaskEditor，但默认勿破坏现有测试路径）
- `defineExpose` 仍为 `{ getCanvas, exportPng, clear }`

- [ ] **Step 1:** 若没有现成 MaskEditor 组件测，为 `maskCanvasReady` 补一条：`disabled: true` 时 `isMaskDrawReady` 为 false（已有则跳过）。本任务以样式/DOM 变体为主，逻辑沿用 P1。

- [ ] **Step 2:** 改 `MaskEditor.vue` template：

```vue
<div class="mask-editor" :class="{ 'mask-editor--node': surface === 'node' }">
  <img v-if="surface !== 'node'" class="mask-editor__image" :src="url" alt="" draggable="false">
  <canvas
    ref="canvasRef"
    class="mask-editor__canvas nodrag nowheel"
    :class="{ 'is-disabled': !drawReady }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  />
</div>
```

`.mask-editor--node { position: absolute; inset: 0; display: block; max-width: none; }`
`.mask-editor--node .mask-editor__canvas { opacity: 0.55; mix-blend-mode: screen; }`

- [ ] **Step 3:** `pnpm --filter @lnkpi/web test -- src/components/canvas/refine/maskExport.test.ts src/components/canvas/refine/maskCanvasReady.test.ts`

Expected: PASS

- [ ] **Step 4: Commit** `feat(web): overlay mask editor on canvas image nodes`

---

### Task 5: Store — chrome + mask handle

**Files:**
- Modify: `apps/web/src/stores/canvasEditor.ts`
- Modify: `apps/web/src/stores/canvasEditor.refine.test.ts`

**Interfaces:**
- Produces:
  - `refineChrome: Ref<RefineChromeMode>` 默认 `'docked'`
  - `compareLightboxOpen: Ref<boolean>` 默认 `false`
  - `export type RefineMaskHandle = { exportPng: () => Promise<Blob>; clear: () => void; getCanvas: () => HTMLCanvasElement | null }`
  - `function setRefineChrome(mode: RefineChromeMode): void` — 窄屏逻辑由面板做，store 只存偏好
  - `function setCompareLightboxOpen(open: boolean): void`
  - `function registerRefineMask(handle: RefineMaskHandle | null): void`
  - `function getRefineMask(): RefineMaskHandle | null`
  - `refineTool: Ref<'brush' | 'eraser' | 'rect'>` 默认 `'brush'`
  - `refineBrushSize: Ref<number>` 默认 `24`
  - `refineCoverage: Ref<number>` 默认 `0`
- `closeImageEditor` 成功关闭时：`refineChrome = 'docked'`（同一轮打开期间记住浮动；关掉后下次默认停靠）、`compareLightboxOpen = false`、`registerRefineMask(null)`，工具/笔刷/覆盖率复位
- busy 时 `closeImageEditor` 仍 no-op（现有行为）

- [ ] **Step 1: Extend failing tests** in `canvasEditor.refine.test.ts`：

```ts
it('defaults chrome to docked and resets on close', () => {
  setActivePinia(createPinia())
  const editor = useCanvasEditorStore()
  editor.openImageEditor({ nodeId: 'n1', url: 'https://cdn/a.png' })
  editor.setRefineChrome('floating')
  expect(editor.refineChrome).toBe('floating')
  editor.closeImageEditor()
  expect(editor.imageTarget).toBeNull()
  expect(editor.refineChrome).toBe('docked')
})

it('resets overlay tool state when the session closes', () => {
  setActivePinia(createPinia())
  const editor = useCanvasEditorStore()
  editor.refineTool = 'eraser'
  editor.refineBrushSize = 48
  editor.refineCoverage = 0.4
  editor.openImageEditor({ nodeId: 'n1', url: 'https://cdn/a.png' })
  editor.closeImageEditor()
  expect(editor.refineTool).toBe('brush')
  expect(editor.refineBrushSize).toBe(24)
  expect(editor.refineCoverage).toBe(0)
})

it('registers and clears the mask handle with the session', () => {
  setActivePinia(createPinia())
  const editor = useCanvasEditorStore()
  const handle = {
    exportPng: async () => new Blob(),
    clear: () => {},
    getCanvas: () => null,
  }
  editor.registerRefineMask(handle)
  expect(editor.getRefineMask()).toBe(handle)
  editor.openImageEditor({ nodeId: 'n1', url: 'https://cdn/a.png' })
  editor.closeImageEditor()
  expect(editor.getRefineMask()).toBeNull()
})
```

- [ ] **Step 2: Run to fail**（缺方法）

- [ ] **Step 3: Implement store fields**；`getRefineMask` 读内部 `ref`

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit** `feat(web): store refine chrome mode and mask handle`

---

### Task 6: RefineSidePanel 壳 + 迁逻辑

**Files:**
- Create: `apps/web/src/components/canvas/refine/RefineSidePanel.vue`
- Delete after CanvasPage 切换完成（可本任务末或 Task 8）：`RefineDockPanel.vue`

**Interfaces:**
- Consumes: 与 `RefineDockPanel` 相同的 props/emits（`close` / `apply` / `revert` / `busy`）+ store `refineChrome` / `getRefineMask` / `setCompareLightboxOpen`
- `runRefine` 用 `getRefineMask()?.exportPng()` 替代 `maskRef.value`；清除选区调 `getRefineMask()?.clear()`
- 迷你 `CompareView` 不再放 MaskEditor；工具条在侧栏
- 模式切换：`左右` | `重叠`；`!canApply`（尚无 After）时重叠 disabled，保持 `split`
- 「最大化对照」：`setCompareLightboxOpen(true)`；lightbox 与侧栏共用 `compareMode` / `wipeRatio` refs
- 按住原图：现有 CompareView；wipe 用 `wipeHoldRatio`

壳：

1. **停靠**（`refineChrome === 'docked'`）：`ElDrawer` `direction="rtl"` `append-to-body` `with-header=false`，`:size="panelWidth + 'px'"`，默认 `panelWidth = 400`，左缘拖条夹取 360–560。`model-value` 由 `imageTarget` 控制；关抽屉走 `emit('close')`（busy 时父级 `closeImageEditor` 会挡住，抽屉不要自己清 target）。
2. **浮动**：不用 Drawer，`position:fixed; z-index: 70`；`left/top` 来自 `floatPos`；切浮动时 `x = max(16, innerWidth - width - 40)`, `y = 56`。标题栏拖移；左缘改宽。
3. 标题栏按钮同 Agent：未浮动 title「切换为浮动窗口」，已浮动「停靠回侧栏」。`< 640` 只停靠，点浮动 no-op。
4. 关按钮文案：busy →「取消精修」（abort）；否则「关闭」。
5. Esc：若 lightbox 开则只关 lightbox；否则未 busy 才 `close`。

把 `RefineDockPanel` 的 `runRefine` / `syncRefineUrls` watch / stain chips / VersionStrip **原样搬过来**（URL、10 分、`studioApi.editImage` 不变）。

- [ ] **Step 1:** 侧栏内 `runRefine` 在 `getRefineMask()` 为 null 时直接 return（overlay 未挂上）。
- [ ] **Step 2:** 实现 `RefineSidePanel.vue`（从 DockPanel 复制 script，换壳与 mask 来源）。
- [ ] **Step 3:** `pnpm --filter @lnkpi/web test -- src/utils/refineChrome.test.ts src/stores/canvasEditor.refine.test.ts`
- [ ] **Step 4: Commit** `feat(web): add refine side panel shell`

---

### Task 7: 画布接线（节点 overlay、Agent、Inspector、fitView）

**Files:**
- Modify: `apps/web/src/components/canvas/CanvasNodeImage.vue`
- Modify: `apps/web/src/components/canvas/CanvasNodeMediaInput.vue`（补 `id` prop）
- Modify: `apps/web/src/pages/CanvasPage.vue`
- Modify: `apps/web/src/components/agent/AgentSideRail.vue`
- Modify: `apps/web/src/composables/useMediaInspector.ts`

**Agent**

- Props 增加 `canOpen?: () => boolean`
- `openPanel` 开头：`if (props.canOpen && !props.canOpen()) return`
- `defineExpose` 增加 `closePanel`

**CanvasPage**

```ts
function canOpenAgentPanel(): boolean {
  const d = decideAgentOpenWhileRefine({
    refineOpen: Boolean(canvasEditor.imageTarget),
    refineBusy: canvasEditor.refineBusy,
    refineChrome: canvasEditor.refineChrome,
  })
  if (d === 'block') {
    ElMessage.warning('精修进行中，请先取消')
    return false
  }
  if (d === 'dismiss-refine') canvasEditor.closeImageEditor()
  return true
}
```

`AgentSideRail` 传 `:can-open="canOpenAgentPanel"`。

打开精修（`openRefineForNode` 成功 `openImageEditor` 之后）：

```ts
closeInspector()
agentRailRef.value?.closePanel()
await nextTick()
await vueFlowRef.value?.fitView({
  nodes: [node.id],
  padding: 0.38,
  duration: 320,
  maxZoom: 1.2,
})
```

底部：`v-if="refinePanelNode"` 渲染 `RefineSidePanel`（不要包在 `bottom-3` 居中容器里）+ `CompareLightbox`；`v-else` 才是 `DockStudioToolbar`。

`handleRefineApply` 开头：

```ts
const nodeUrl = String((findNodeById(nodeId)?.data as Record<string, unknown> | undefined)?.url ?? '')
if (!shouldApplyRefineToNode({ nodeUrl, sessionBeforeUrl: refineBeforeUrl.value })) return
```

**Inspector**

`openInspector` 开头：

```ts
const editor = useCanvasEditorStore()
const d = decideInspectorOpenWhileRefine({
  refineOpen: Boolean(editor.imageTarget),
  refineBusy: editor.refineBusy,
})
if (d === 'block') {
  ElMessage.warning('精修进行中，请先取消')
  return
}
if (d === 'dismiss-refine') editor.closeImageEditor()
```

**CanvasNodeImage**（`neo-gen-preview` 内、img 之后）：

```vue
<MaskEditor
  v-if="editor.imageTarget?.nodeId === id"
  :url="displayUrl"
  :width="data.mediaInfo?.width"
  :height="data.mediaInfo?.height"
  :tool="editor.refineTool"
  :brush-size="editor.refineBrushSize"
  surface="node"
  :disabled="editor.refineBusy"
  @coverage="(p) => { editor.refineCoverage = p.ratio }"
/>
```

SidePanel 读写 `refineTool` / `refineBrushSize`；overlay 只读。`onMounted` 里 `registerRefineMask({ exportPng, clear, getCanvas })`；`onBeforeUnmount` 若仍是当前 handle 则 `registerRefineMask(null)`。

**CanvasNodeMediaInput：** 增加 `id: string`；当 `mediaKind === 'image'` 且 `editor.imageTarget?.nodeId === id` 时同样挂 overlay（无 mediaInfo 尺寸则靠 MaskEditor probe）。

lightbox 开着时 CanvasPage 或 SidePanel 监听 Esc 先关 lightbox。

- [ ] **Step 1:** Agent expose + canOpen
- [ ] **Step 2:** Inspector gate
- [ ] **Step 3:** Node overlays + CanvasPage swap
- [ ] **Step 4:** `pnpm --filter @lnkpi/web test -- src/utils/refineChrome.test.ts src/stores/canvasEditor.refine.test.ts src/utils/refineSession.test.ts`
- [ ] **Step 5: Commit** `feat(web): dock refine on the right and paint masks on nodes`

---

### Task 8: 拆除底部 RefineDockPanel

**Files:**
- Delete: `apps/web/src/components/canvas/refine/RefineDockPanel.vue`
- Grep: `RefineDockPanel` 必须为零引用

- [ ] **Step 1:** `rg RefineDockPanel apps/web` Expected: 无匹配
- [ ] **Step 2:** `pnpm --filter @lnkpi/web test`
- [ ] **Step 3:** `pnpm --filter @lnkpi/web exec vue-tsc --noEmit`（若仓库 web 用此命令；否则 `pnpm --filter @lnkpi/web build`）
- [ ] **Step 4: Commit** `feat(web): remove bottom refine dock panel`

---

### Task 9: 对照验收清单（实现者手测，不改后端）

在本地画布：

1. 点节点「编辑」→ 右侧推出精修；底部生成 Dock 消失；`fitView` 到该节点；可在节点上画选区
2. 标题栏切浮动 → 可拖；再停靠
3. 停靠未 busy 时点 Agent → 精修关闭、Agent 展开
4. 点「精修」busy 时点 Agent → Agent 不展开；toast「精修进行中，请先取消」
5. 精修成功后节点仍是旧图；对照可左右 / 重叠；最大化能放大
6. 「应用到节点」后同一 `nodeId`，url 变合成图
7. 空选区不能提交

不跑生产部署，除非用户另行要求。

---

## Deferred（本轮禁止实现；后续计划单独开）

对照扩展槽，**不改写回契约**：

| 模式 | 建议 | 默认 |
|------|------|------|
| 上下擦除 | `CompareMode` 加 `'wipe-y'`；横向分界 | 上 Before、下 After |
| 透明度溶解 | `'dissolve'`；滑竿 0–100% = After 不透明度 | 50% |
| 自动闪光 | `'flash'`；约 600ms 切换 Before/After，可暂停 | 不改 mask |

落地时复用 `CompareView` / Lightbox 的 `mode` 联合类型，并扩展 `wipeHoldRatio` 同类 helper。不要在本 PR 预留空按钮。

---

## Spec coverage

| Spec | Task |
|------|------|
| 右侧停靠同 ⓘ + 浮动同 Agent | 6, 7 |
| Agent / Inspector 互斥 | 1, 7 |
| 藏底部生成 Dock | 7 |
| mask 在节点上；应用前 = Before | 4, 5, 7 |
| 左右 + 重叠 + 最大化 | 2, 3, 6 |
| 写回 P1 | 6（搬 DockPanel） |
| 拆 RefineDockPanel | 8 |
| 上下擦除 / 溶解 / 闪光 | Deferred only |
