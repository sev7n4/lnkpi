# 精修工作室布局重组 · 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「进入精修后的页面」重组成三块职责清晰的结构 —— 画布（左栏工具条 + 顶部模式条 + 工作图）、右栏（固定对照预览 / 唯一滚动的工具箱 / 常驻 dock），并让画布级 chrome 在精修模式下全部让位。

**Architecture:** 左栏工具条与模式条**放进 `RefineWorkViewport.vue` 内部**（`.refine-work` 由单 stage 改为横向 flex：rail 56px + [modebar / stage]），不新增浮层、不争 z-index；右栏 `RefineSidePanel.vue` 改为四段容器（head / 对照带 / 工具箱 / dock），对照带与 dock 在滚动区之外。`compareMode`、`wipeRatio` 从侧栏局部 ref 提升到 `canvasEditor` store，因为左栏与右栏都要读它。画布 chrome 的显隐判据抽成纯函数供 `CanvasPage.vue` 三处共用。

**Tech Stack:** Vue 3 `<script setup>` + TypeScript、Pinia、vue-tsc、vitest + jsdom + `@vue/test-utils`、Tailwind（既有）、Element Plus（仅 `ElMessage`）

**Spec:** `docs/superpowers/specs/2026-09-21-refine-studio-layout-rework-design.md`

## Global Constraints

- **工作目录**：仓库根 `/Users/4seven/workspace/lnkpi`，本包所有路径以此为根。测试只认 `apps/web/src/**/*.test.ts`（vitest `include` 为 `src/**/*.test.ts`，**不认 `.spec.ts`**）。
- **禁止直接 push main**；一律 feature 分支 + PR + CI 全绿 + Squash Merge。
- **禁止 `git add -A` / `git add .`**：工作区里有**另一会话遗留的未提交品牌改动**（`apps/web/src/components/account/AccountUserMenu.vue`、`agent/NeoAgentLogo.vue`、`auth/LoginFormPanel.vue`、`brand/BrandLogo.vue`、`layout/AppHeader.vue`、`constants/brand.ts`、`pages/PrivacyPage.vue`、`pages/ProfilePage.vue`、`pages/TermsPage.vue`，以及未跟踪的 `apps/web/public/brand/ink-logo.png`、`docs/superpowers/specs/2026-09-21-sidebar-agent-workbuddy-benchmark-upgrade-design.md`、`services/agent-runtime/uv.lock`、`lnkpi-brand-backup-2026-09-20/`）。**每次 commit 只 `git add <明确路径>`**。
- **`apps/web/vite.config.js` 是 `vue-tsc -b` 的编译产物却被 git 跟踪**，每次 `pnpm build` 都会改脏它。**永远不要把它加进 commit**。
- **本包范围内不得改动**：`apps/server/**`、`packages/**`、`services/**`、部署脚本；不得新增后端字段或积分逻辑。
- **文案必须用这些原词**：`智能选择` `框选` `涂抹` `对照` `适配` `左右对照` `滑竿对照` `适应窗口` `原始比例 1:1` `反选` `清除选区` `对照预览` `快速预设` `版本历史` `精修` `应用到节点` `编辑意图` `返回画布`。不新造同义词。
- **不得删除底层能力**：`ImageLoupe.vue`、`editor.refineLoupeOn`、`refineLoupeShape`、`refineLoupeZoom`、`setRefineLoupe*`、`CompareLightbox.vue` 全部保留（只撤 UI 入口）。
- **本地验证四条**（提交 PR 前必跑，来自 AGENTS.md）：`pnpm install --frozen-lockfile`、`pnpm --filter @lnkpi/server exec prisma generate`、`pnpm build`、`pnpm --filter @lnkpi/agent test`。
- **基线**：`pnpm --filter @lnkpi/web test` 当前 754 通过（`ProviderConfigDialog` 有一个约 6.8s 的偶发慢测试超 5s 默认 timeout，**是既有环境问题，不要修**）。本包只增不减。

## Review Focus

规格是愿景文档，它没说的地方不等于可以实现坏。以下 5 类最可能踩到使用者，按可能性排序；每一类都已挂到具体任务的测试里：

1. **左栏 3 个输入工具会不会把已有能力弄丢** —— 点「涂抹」找不到「橡皮」、点「智能选择」找不到「魔棒」，就是能力丢失。期望 3 个入口的子菜单里 6 个工具全可点（Task 2）。
2. **精修模式下画布 chrome 只隐藏一部分** —— 左上画布名区/左 dock/右上工具条漏一个就回到原缺陷。期望三者同进同出、判据是同一个纯函数（Task 9）。
3. **右栏对照预览跟着工具箱滚走** —— 规格 P0-7 要求固定。期望预览与 dock 都在滚动容器之外，`.refine-side__body` 内只有一个滚动区（Task 8）。
4. **`busy` 期间点「返回画布」把正在跑的生成杀掉** —— 规格 P0-14 要求纯退出且生成中置灰（Task 9）。
5. **dock 在 400px 栏宽里横向溢出** —— `.bottom-toolbar-container` 有 `min-width: min(600px, 100vw - 32px)`（`styles/neo-node.css:1051`）。期望 `RefineDock` 覆写为 `min-width: 0; width: 100%`（Task 7）。

---

### Task 1: 分支、文档落位、工具条纯模型与状态归属

**Files:**
- Create: `apps/web/src/components/canvas/refine/refineToolRailModel.ts`
- Create: `apps/web/src/components/canvas/refine/refineToolRailModel.test.ts`
- Modify: `apps/web/src/stores/canvasEditor.ts`
- 落位（不改内容）：`docs/superpowers/specs/2026-09-21-refine-studio-layout-rework-design.md`、`docs/superpowers/plans/2026-09-21-refine-studio-layout-rework.md`

**Interfaces:**
- Consumes: 无（首个任务）
- Produces:
  - `REFINE_INPUT_GROUPS: RefineInputGroup[]`（3 组，恰好覆盖全部 6 个 `RefineMaskTool`）
  - `REFINE_VIEW_TOOLS`、`REFINE_COMPARE_OPTIONS`、`REFINE_FIT_OPTIONS`、`RefineFitOptionId`
  - `groupForTool(tool): RefineInputGroupId`、`toolLabel(tool): string`、`inputToolActive(tool, groupId): boolean`
  - `toolParamKind(tool): RefineToolParamKind`、`compareModeLabel(mode): string`、`refineWorkspaceLabel({compareOpen, compareMode}): string`
  - store 新增：`refineCompareMode: Ref<CompareMode>`、`refineWipeRatio: Ref<number>`、`setRefineCompareMode(mode)`、`setRefineWipeRatio(ratio)`

- [ ] **Step 1: 建分支**

```bash
cd /Users/4seven/workspace/lnkpi
git log --oneline -1
git status --short
git fetch origin main
git switch -c feature/refine-studio-layout-rework origin/main
```

若 `git switch` 报「local changes would be overwritten」，**停下来报告，不要 stash、不要 checkout 丢弃**（工作区有另一会话的未提交改动）。

- [ ] **Step 2: 把规格与计划放进本分支并提交**

```bash
cd /Users/4seven/workspace/lnkpi
git add docs/superpowers/specs/2026-09-21-refine-studio-layout-rework-design.md \
        docs/superpowers/plans/2026-09-21-refine-studio-layout-rework.md
git commit -m "docs(spec+plan): refine studio layout rework — locked decisions + implementation plan"
```

- [ ] **Step 3: 写失败测试**

创建 `apps/web/src/components/canvas/refine/refineToolRailModel.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  REFINE_COMPARE_OPTIONS, REFINE_FIT_OPTIONS, REFINE_INPUT_GROUPS, REFINE_VIEW_TOOLS,
  compareModeLabel, groupForTool, inputToolActive, refineWorkspaceLabel, toolLabel, toolParamKind,
} from './refineToolRailModel'
import { useCanvasEditorStore, type RefineMaskTool } from '@/stores/canvasEditor'

const ALL_TOOLS: RefineMaskTool[] = ['brush', 'eraser', 'rect', 'wand', 'polygon', 'point']

describe('refineToolRailModel', () => {
  it('三个输入组恰好覆盖全部 6 个蒙版工具，一个不漏一个不重', () => {
    const covered = REFINE_INPUT_GROUPS.flatMap((g) => g.variants.map((v) => v.tool))
    expect([...covered].sort()).toEqual([...ALL_TOOLS].sort())
  })

  it('每组第一个变体是该组默认工具', () => {
    expect(REFINE_INPUT_GROUPS.map((g) => g.variants[0]!.tool)).toEqual(['point', 'rect', 'brush'])
  })

  it('groupForTool 把每个工具映射回它的组', () => {
    expect(groupForTool('point')).toBe('smart')
    expect(groupForTool('wand')).toBe('smart')
    expect(groupForTool('rect')).toBe('marquee')
    expect(groupForTool('polygon')).toBe('marquee')
    expect(groupForTool('brush')).toBe('paint')
    expect(groupForTool('eraser')).toBe('paint')
  })

  it('inputToolActive 只在自己的组内为真', () => {
    expect(inputToolActive('wand', 'smart')).toBe(true)
    expect(inputToolActive('wand', 'paint')).toBe(false)
  })

  it('两个选区命令分别只在智能选择组与涂抹组', () => {
    const byId = Object.fromEntries(REFINE_INPUT_GROUPS.map((g) => [g.id, g.commands.map((c) => c.id)]))
    expect(byId.smart).toEqual(['invert'])
    expect(byId.marquee).toEqual([])
    expect(byId.paint).toEqual(['clear'])
  })

  it('模式条参数矩阵：粗细 / 容差 / 多边形提示 / 无', () => {
    expect(toolParamKind('brush')).toBe('brush')
    expect(toolParamKind('eraser')).toBe('brush')
    expect(toolParamKind('wand')).toBe('wand')
    expect(toolParamKind('polygon')).toBe('polygon-hint')
    expect(toolParamKind('rect')).toBe('none')
    expect(toolParamKind('point')).toBe('none')
  })

  it('工具短名与查看组选项文案', () => {
    expect(toolLabel('point')).toBe('点选主体')
    expect(toolLabel('wand')).toBe('魔棒')
    expect(toolLabel('eraser')).toBe('橡皮')
    expect(REFINE_VIEW_TOOLS.map((t) => t.label)).toEqual(['对照', '适配'])
    expect(REFINE_COMPARE_OPTIONS.map((o) => o.label)).toEqual(['左右对照', '滑竿对照'])
    expect(REFINE_COMPARE_OPTIONS[0]!.mode).toBe('split')
    expect(REFINE_FIT_OPTIONS.map((o) => o.label)).toEqual(['适应窗口', '原始比例 1:1'])
  })

  it('模式条标题：对照打开显示对照方式，否则显示工作图', () => {
    expect(refineWorkspaceLabel({ compareOpen: false, compareMode: 'split' })).toBe('工作图')
    expect(refineWorkspaceLabel({ compareOpen: true, compareMode: 'split' })).toBe('对照 · 左右对照')
    expect(refineWorkspaceLabel({ compareOpen: true, compareMode: 'wipe' })).toBe('对照 · 滑竿对照')
    expect(compareModeLabel('wipe')).toBe('滑竿对照')
  })
})

describe('canvasEditor · 对照模式归属', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('默认左右 / 0.5，并可写入', () => {
    const store = useCanvasEditorStore()
    expect(store.refineCompareMode).toBe('split')
    expect(store.refineWipeRatio).toBe(0.5)
    store.setRefineCompareMode('wipe')
    store.setRefineWipeRatio(0.25)
    expect(store.refineCompareMode).toBe('wipe')
    expect(store.refineWipeRatio).toBe(0.25)
  })

  it('滑竿比例被钳制在 [0, 1]', () => {
    const store = useCanvasEditorStore()
    store.setRefineWipeRatio(9)
    expect(store.refineWipeRatio).toBe(1)
    store.setRefineWipeRatio(-3)
    expect(store.refineWipeRatio).toBe(0)
  })

  it('关闭编辑器时对照模式与比例复位', () => {
    const store = useCanvasEditorStore()
    store.setRefineCompareMode('wipe')
    store.setRefineWipeRatio(0.25)
    store.closeImageEditor()
    expect(store.refineCompareMode).toBe('split')
    expect(store.refineWipeRatio).toBe(0.5)
  })
})
```

- [ ] **Step 4: 跑测试确认失败**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/refineToolRailModel.test.ts
```

Expected: FAIL —— `Failed to resolve import "./refineToolRailModel"`（模块尚不存在）。

- [ ] **Step 5: 实现纯模型**

创建 `apps/web/src/components/canvas/refine/refineToolRailModel.ts`：

```ts
import type { CompareMode } from '@/utils/refineChrome'
import type { RefineMaskTool } from '@/stores/canvasEditor'

/**
 * 画布左栏工具条的分组模型。
 * 判据（spec §3.2）：产出「中间态」（选区 / 蒙版 / 视图）→ 画布左栏；产出「最终产物」→ 工具箱。
 */
export type RefineInputGroupId = 'smart' | 'marquee' | 'paint'
export type RefineToolCommand = 'invert' | 'clear'
export type RefineViewToolId = 'compare' | 'fit'
/** 模式条要为当前工具显示哪一套参数 */
export type RefineToolParamKind = 'brush' | 'wand' | 'polygon-hint' | 'none'

export interface RefineToolVariant { tool: RefineMaskTool; label: string }
export interface RefineInputGroup {
  id: RefineInputGroupId
  label: string
  variants: RefineToolVariant[]
  commands: { id: RefineToolCommand; label: string }[]
}

/** 3 个输入工具，各自的二级菜单容纳全部 6 个蒙版工具。 */
export const REFINE_INPUT_GROUPS: RefineInputGroup[] = [
  {
    id: 'smart',
    label: '智能选择',
    variants: [{ tool: 'point', label: '点选主体' }, { tool: 'wand', label: '魔棒' }],
    commands: [{ id: 'invert', label: '反选' }],
  },
  {
    id: 'marquee',
    label: '框选',
    variants: [{ tool: 'rect', label: '矩形' }, { tool: 'polygon', label: '多边形' }],
    commands: [],
  },
  {
    id: 'paint',
    label: '涂抹',
    variants: [{ tool: 'brush', label: '画笔' }, { tool: 'eraser', label: '橡皮' }],
    commands: [{ id: 'clear', label: '清除选区' }],
  },
]

export const REFINE_VIEW_TOOLS: { id: RefineViewToolId; label: string }[] = [
  { id: 'compare', label: '对照' },
  { id: 'fit', label: '适配' },
]

export const REFINE_COMPARE_OPTIONS: { mode: CompareMode; label: string; hint: string }[] = [
  { mode: 'split', label: '左右对照', hint: '并排两图 · 同步缩放平移' },
  { mode: 'wipe', label: '滑竿对照', hint: '同屏叠图 · 拖分割线看差异' },
]

export const REFINE_FIT_OPTIONS = [
  { id: 'fit-window', label: '适应窗口', hint: '整图铺满可视区' },
  { id: 'actual-size', label: '原始比例 1:1', hint: '按像素 1:1 显示' },
] as const
export type RefineFitOptionId = (typeof REFINE_FIT_OPTIONS)[number]['id']

const GROUP_OF_TOOL: Record<RefineMaskTool, RefineInputGroupId> = {
  point: 'smart', wand: 'smart', rect: 'marquee', polygon: 'marquee', brush: 'paint', eraser: 'paint',
}

const LABEL_OF_TOOL: Record<RefineMaskTool, string> = {
  point: '点选主体', wand: '魔棒', rect: '矩形', polygon: '多边形', brush: '画笔', eraser: '橡皮',
}

const PARAM_OF_TOOL: Record<RefineMaskTool, RefineToolParamKind> = {
  brush: 'brush', eraser: 'brush', wand: 'wand', polygon: 'polygon-hint', rect: 'none', point: 'none',
}

export function groupForTool(tool: RefineMaskTool): RefineInputGroupId { return GROUP_OF_TOOL[tool] }
export function toolLabel(tool: RefineMaskTool): string { return LABEL_OF_TOOL[tool] }
export function inputToolActive(tool: RefineMaskTool, groupId: RefineInputGroupId): boolean {
  return GROUP_OF_TOOL[tool] === groupId
}
export function toolParamKind(tool: RefineMaskTool): RefineToolParamKind { return PARAM_OF_TOOL[tool] }
export function compareModeLabel(mode: CompareMode): string {
  return mode === 'wipe' ? '滑竿对照' : '左右对照'
}
export function refineWorkspaceLabel(input: { compareOpen: boolean; compareMode: CompareMode }): string {
  return input.compareOpen ? `对照 · ${compareModeLabel(input.compareMode)}` : '工作图'
}
```

- [ ] **Step 6: 给 store 加对照模式与滑竿比例**

修改 `apps/web/src/stores/canvasEditor.ts`：

(a) 导入补上（加在既有的 `clampWandTolerance` 那行之后）：

```ts
import { clampWipeRatio, type CompareMode } from '@/utils/refineChrome'
```

(b) 在 `const compareLightboxOpen = ref(false)` 之后新增：

```ts
  /** 精修对照方式。左栏工具条与右栏对照带都读它，所以归属 store（spec P1-7）。 */
  const refineCompareMode = ref<CompareMode>('split')
  /** 滑竿对照的分割线位置，0..1 */
  const refineWipeRatio = ref(0.5)
```

(c) 在复位函数内（`compareLightboxOpen.value = false` 那一组）补两行：

```ts
    refineCompareMode.value = 'split'
    refineWipeRatio.value = 0.5
```

(d) 在 `setCompareLightboxOpen` 附近新增两个 setter：

```ts
  function setRefineCompareMode(mode: CompareMode) {
    refineCompareMode.value = mode
  }

  function setRefineWipeRatio(ratio: number) {
    refineWipeRatio.value = clampWipeRatio(ratio)
  }
```

(e) 在 return 对象里补：

```ts
    refineCompareMode,
    refineWipeRatio,
    setRefineCompareMode,
    setRefineWipeRatio,
```

- [ ] **Step 7: 跑测试确认通过**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/refineToolRailModel.test.ts
```

Expected: PASS（2 个 describe，11 个用例）。

- [ ] **Step 8: 类型检查并提交**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm --filter @lnkpi/web exec vue-tsc -b
git add apps/web/src/components/canvas/refine/refineToolRailModel.ts \
        apps/web/src/components/canvas/refine/refineToolRailModel.test.ts \
        apps/web/src/stores/canvasEditor.ts
git commit -m "feat(refine): tool rail grouping model + hoist compare mode into store"
```

---

### Task 2: 画布左栏工具条 `RefineToolRail.vue`

**Files:**
- Create: `apps/web/src/components/canvas/refine/RefineToolRail.vue`
- Create: `apps/web/src/components/canvas/refine/RefineToolRail.test.ts`

**Interfaces:**
- Consumes: Task 1 全部导出；store 的 `refineTool` / `setRefineTool` / `refineCompareMode` / `setRefineCompareMode` / `compareLightboxOpen` / `setCompareLightboxOpen` / `getRefineMask()`
- Produces: `RefineToolRail` 组件
  - props：`{ hasAfter?: boolean }`（默认 `true`）
  - emits：`fit: []`、`actualSize: []`（模板里 `@actual-size`）
  - `data-testid`：`refine-rail`、`rail-input-{smart|marquee|paint}`、`rail-variant-{tool}`、`rail-command-{invert|clear}`、`rail-view-compare`、`rail-view-fit`、`rail-compare-option-{split|wipe}`、`rail-fit-option-{fit-window|actual-size}`

- [ ] **Step 1: 写失败测试**

创建 `apps/web/src/components/canvas/refine/RefineToolRail.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import RefineToolRail from './RefineToolRail.vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'

const mountRail = (props: Record<string, unknown> = {}) =>
  mount(RefineToolRail, { props, global: { plugins: [createPinia()] } })

describe('RefineToolRail', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('渲染 3 个输入工具与 2 个查看工具', () => {
    const w = mountRail()
    for (const id of ['smart', 'marquee', 'paint']) {
      expect(w.find(`[data-testid="rail-input-${id}"]`).exists()).toBe(true)
    }
    expect(w.find('[data-testid="rail-view-compare"]').exists()).toBe(true)
    expect(w.find('[data-testid="rail-view-fit"]').exists()).toBe(true)
    expect(w.find('[data-testid="refine-rail"]').attributes('aria-label')).toBe('画布工具')
  })

  it('子菜单默认关闭；点「涂抹」展开后 6 个工具都能点到', async () => {
    const store = useCanvasEditorStore()
    const w = mountRail()
    expect(w.find('[data-testid="rail-variant-eraser"]').exists()).toBe(false)

    await w.find('[data-testid="rail-input-paint"]').trigger('click')
    expect(w.find('[data-testid="rail-variant-brush"]').exists()).toBe(true)
    expect(w.find('[data-testid="rail-variant-eraser"]').exists()).toBe(true)

    await w.find('[data-testid="rail-variant-eraser"]').trigger('click')
    expect(store.refineTool).toBe('eraser')
    expect(w.find('[data-testid="rail-variant-eraser"]').exists()).toBe(false)
  })

  it('「反选」只在智能选择组、「清除选区」只在涂抹组', async () => {
    const w = mountRail()
    await w.find('[data-testid="rail-input-smart"]').trigger('click')
    expect(w.find('[data-testid="rail-command-invert"]').exists()).toBe(true)
    expect(w.find('[data-testid="rail-command-clear"]').exists()).toBe(false)

    await w.find('[data-testid="rail-input-paint"]').trigger('click')
    expect(w.find('[data-testid="rail-command-clear"]').exists()).toBe(true)
    expect(w.find('[data-testid="rail-command-invert"]').exists()).toBe(false)
  })

  it('当前工具高亮在它所属的输入组上', () => {
    const store = useCanvasEditorStore()
    store.setRefineTool('polygon')
    const w = mountRail()
    expect(w.find('[data-testid="rail-input-marquee"]').classes()).toContain('is-active')
    expect(w.find('[data-testid="rail-input-smart"]').classes()).not.toContain('is-active')
  })

  it('对照：默认左右对照；选滑竿后写入 store 并打开全屏对照', async () => {
    const store = useCanvasEditorStore()
    const w = mountRail()
    expect(store.refineCompareMode).toBe('split')

    await w.find('[data-testid="rail-view-compare"]').trigger('click')
    const split = w.find('[data-testid="rail-compare-option-split"]')
    const wipe = w.find('[data-testid="rail-compare-option-wipe"]')
    expect(split.exists()).toBe(true)
    expect(wipe.exists()).toBe(true)
    expect(split.classes()).toContain('is-on')
    expect(wipe.classes()).not.toContain('is-on')

    await wipe.trigger('click')
    expect(store.refineCompareMode).toBe('wipe')
    expect(store.compareLightboxOpen).toBe(true)
  })

  it('对照：没有「处理后」版本时两项置灰且点不动', async () => {
    const store = useCanvasEditorStore()
    const w = mountRail({ hasAfter: false })
    await w.find('[data-testid="rail-view-compare"]').trigger('click')
    expect(w.find('[data-testid="rail-compare-option-split"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="rail-compare-option-wipe"]').attributes('disabled')).toBeDefined()
    await w.find('[data-testid="rail-compare-option-split"]').trigger('click')
    expect(store.compareLightboxOpen).toBe(false)
  })

  it('适配：二级菜单两项分别 emit fit / actualSize', async () => {
    const w = mountRail()
    await w.find('[data-testid="rail-view-fit"]').trigger('click')
    await w.find('[data-testid="rail-fit-option-fit-window"]').trigger('click')
    expect(w.emitted('fit')).toHaveLength(1)

    await w.find('[data-testid="rail-view-fit"]').trigger('click')
    await w.find('[data-testid="rail-fit-option-actual-size"]').trigger('click')
    expect(w.emitted('actualSize')).toHaveLength(1)
  })

  it('左栏不存在「细节放大」入口', () => {
    expect(mountRail().text()).not.toContain('细节放大')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/RefineToolRail.test.ts
```

Expected: FAIL —— `Failed to resolve import "./RefineToolRail.vue"`。

- [ ] **Step 3: 实现组件**

创建 `apps/web/src/components/canvas/refine/RefineToolRail.vue`：

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import type { RefineMaskTool } from '@/stores/canvasEditor'
import {
  REFINE_COMPARE_OPTIONS, REFINE_FIT_OPTIONS, REFINE_INPUT_GROUPS, REFINE_VIEW_TOOLS,
  groupForTool, inputToolActive,
  type RefineFitOptionId, type RefineInputGroupId, type RefineToolCommand,
} from './refineToolRailModel'

const props = withDefaults(defineProps<{
  /** 是否已有「处理后」版本；没有则对照两项置灰（spec P0-4） */
  hasAfter?: boolean
}>(), { hasAfter: true })

const emit = defineEmits<{
  fit: []
  /** 原始比例 1:1 —— 模板里写 @actual-size */
  actualSize: []
}>()

const editor = useCanvasEditorStore()
const railRef = ref<HTMLElement | null>(null)

/** 同一时刻只允许一个二级菜单展开 */
type OpenMenu = { kind: 'input'; id: RefineInputGroupId } | { kind: 'view'; id: 'compare' | 'fit' } | null
const openMenu = ref<OpenMenu>(null)

function onDocPointerDown(event: PointerEvent) {
  const el = railRef.value
  if (!el) return
  if (el.contains(event.target as Node)) return
  openMenu.value = null
}

onMounted(() => document.addEventListener('pointerdown', onDocPointerDown, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointerDown, true))

const GLYPH: Record<RefineInputGroupId, string> = { smart: '◉', marquee: '▢', paint: '✎' }

const activeGroup = computed(() => groupForTool(editor.refineTool))

function toggleInputGroup(id: RefineInputGroupId) {
  openMenu.value = openMenu.value?.kind === 'input' && openMenu.value.id === id ? null : { kind: 'input', id }
}
function pickTool(tool: RefineMaskTool) {
  editor.setRefineTool(tool)
  openMenu.value = null
}
function runCommand(id: RefineToolCommand) {
  const mask = editor.getRefineMask()
  if (id === 'invert') mask?.invert()
  else mask?.clear()
  openMenu.value = null
}
function toggleView(id: 'compare' | 'fit') {
  openMenu.value = openMenu.value?.kind === 'view' && openMenu.value.id === id ? null : { kind: 'view', id }
}
function pickCompareMode(mode: (typeof REFINE_COMPARE_OPTIONS)[number]['mode']) {
  if (!props.hasAfter) return
  editor.setRefineCompareMode(mode)
  editor.setCompareLightboxOpen(true)
  openMenu.value = null
}
function pickFit(id: RefineFitOptionId) {
  if (id === 'fit-window') emit('fit')
  else emit('actualSize')
  openMenu.value = null
}
const isInputOpen = (id: RefineInputGroupId) => openMenu.value?.kind === 'input' && openMenu.value.id === id
const isViewOpen = (id: 'compare' | 'fit') => openMenu.value?.kind === 'view' && openMenu.value.id === id
</script>

<template>
  <nav ref="railRef" class="refine-rail" data-testid="refine-rail" aria-label="画布工具">
    <!-- 输入组：往图上放东西，只产出选区 / 蒙版 -->
    <div v-for="group in REFINE_INPUT_GROUPS" :key="group.id" class="refine-rail__slot">
      <button
        type="button"
        class="refine-rail__btn"
        :class="{ 'is-active': inputToolActive(editor.refineTool, group.id) }"
        :data-testid="`rail-input-${group.id}`"
        :aria-label="group.label"
        :title="group.label"
        :aria-expanded="isInputOpen(group.id)"
        @click="toggleInputGroup(group.id)"
      >
        <span class="refine-rail__glyph">{{ GLYPH[group.id] }}</span>
        <span class="refine-rail__name">{{ group.label }}</span>
      </button>

      <div v-if="isInputOpen(group.id)" class="refine-rail__fly" role="menu">
        <div class="refine-rail__fly-title">{{ group.label }}</div>
        <button
          v-for="variant in group.variants"
          :key="variant.tool"
          type="button"
          role="menuitemradio"
          class="refine-rail__opt"
          :class="{ 'is-on': editor.refineTool === variant.tool }"
          :data-testid="`rail-variant-${variant.tool}`"
          @click="pickTool(variant.tool)"
        >
          <span class="refine-rail__opt-name">{{ variant.label }}</span>
          <span class="refine-rail__radio" />
        </button>
        <template v-if="group.commands.length">
          <div class="refine-rail__fly-div" />
          <button
            v-for="cmd in group.commands"
            :key="cmd.id"
            type="button"
            class="refine-rail__cmd"
            :data-testid="`rail-command-${cmd.id}`"
            @click="runCommand(cmd.id)"
          >
            {{ cmd.label }}
          </button>
        </template>
      </div>
    </div>

    <div class="refine-rail__hr" />
    <div class="refine-rail__seplabel">查看</div>

    <!-- 查看组：只看不改，不写图片数据、不产生版本 -->
    <div class="refine-rail__slot">
      <button
        type="button"
        class="refine-rail__btn"
        :class="{ 'is-active': editor.compareLightboxOpen }"
        data-testid="rail-view-compare"
        :aria-label="REFINE_VIEW_TOOLS[0]!.label"
        :title="REFINE_VIEW_TOOLS[0]!.label"
        :aria-expanded="isViewOpen('compare')"
        @click="toggleView('compare')"
      >
        <span class="refine-rail__glyph">⇆</span>
        <span class="refine-rail__name">{{ REFINE_VIEW_TOOLS[0]!.label }}</span>
      </button>

      <div v-if="isViewOpen('compare')" class="refine-rail__fly" role="menu">
        <div class="refine-rail__fly-title">对照方式（二选一）</div>
        <button
          v-for="option in REFINE_COMPARE_OPTIONS"
          :key="option.mode"
          type="button"
          role="menuitemradio"
          class="refine-rail__opt"
          :class="{ 'is-on': editor.refineCompareMode === option.mode }"
          :data-testid="`rail-compare-option-${option.mode}`"
          :disabled="!hasAfter"
          @click="pickCompareMode(option.mode)"
        >
          <span class="refine-rail__opt-tx">
            <b>{{ option.label }}<span v-if="option.mode === 'split'" class="refine-rail__pin">默认</span></b>
            <em>{{ option.hint }}</em>
          </span>
          <span class="refine-rail__radio" />
        </button>
        <div class="refine-rail__fly-div" />
        <div class="refine-rail__fly-note">
          对照需要「处理后」的版本，未产出时两项置灰。<br>选中后画布顶部出模式条，<b>Esc</b> 回到工作图。
        </div>
      </div>
    </div>

    <div class="refine-rail__slot">
      <button
        type="button"
        class="refine-rail__btn"
        data-testid="rail-view-fit"
        :aria-label="REFINE_VIEW_TOOLS[1]!.label"
        :title="REFINE_VIEW_TOOLS[1]!.label"
        :aria-expanded="isViewOpen('fit')"
        @click="toggleView('fit')"
      >
        <span class="refine-rail__glyph">⛶</span>
        <span class="refine-rail__name">{{ REFINE_VIEW_TOOLS[1]!.label }}</span>
      </button>

      <div v-if="isViewOpen('fit')" class="refine-rail__fly" role="menu">
        <div class="refine-rail__fly-title">视图</div>
        <button
          v-for="option in REFINE_FIT_OPTIONS"
          :key="option.id"
          type="button"
          class="refine-rail__opt"
          :data-testid="`rail-fit-option-${option.id}`"
          @click="pickFit(option.id)"
        >
          <span class="refine-rail__opt-tx"><b>{{ option.label }}</b><em>{{ option.hint }}</em></span>
        </button>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.refine-rail {
  display: flex; width: 56px; flex: 0 0 56px; flex-direction: column;
  align-items: center; justify-content: center; gap: 2px; padding: 8px 0;
  background: rgba(20, 20, 22, 0.72); border-right: 1px solid var(--neo-border);
}
.refine-rail__slot { position: relative; }
.refine-rail__btn {
  display: flex; width: 44px; flex-direction: column; align-items: center; gap: 2px;
  padding: 6px 0 5px; border: none; border-radius: 10px; background: transparent;
  color: var(--neo-text-muted); font-size: 10px; line-height: 1.1; cursor: pointer;
}
.refine-rail__btn:hover { background: var(--neo-hover-bg); color: var(--neo-text-secondary); }
.refine-rail__btn.is-active { background: rgba(0, 89, 179, 0.18); color: #7cc0ff; }
.refine-rail__glyph { font-size: 15px; line-height: 1; }
.refine-rail__name { font-size: 10px; white-space: nowrap; }
.refine-rail__hr { width: 24px; height: 1px; margin: 6px 0 4px; background: var(--neo-border); }
.refine-rail__seplabel { margin-bottom: 2px; color: var(--neo-text-muted); font-size: 9.5px; letter-spacing: .06em; }
.refine-rail__fly {
  position: absolute; top: -6px; left: calc(100% + 8px); z-index: 2; min-width: 196px; padding: 8px;
  border: 1px solid var(--neo-glass-border, var(--neo-border)); border-radius: 14px;
  background: var(--neo-surface, #17181d); box-shadow: 0 12px 32px rgba(0, 0, 0, .36);
}
.refine-rail__fly-title { padding: 2px 6px 6px; color: var(--neo-text-muted); font-size: 10.5px; }
.refine-rail__opt {
  display: flex; width: 100%; align-items: center; gap: 8px; padding: 6px;
  border: none; border-radius: 9px; background: transparent; color: inherit; text-align: left; cursor: pointer;
}
.refine-rail__opt:hover { background: var(--neo-hover-bg); }
.refine-rail__opt.is-on { background: rgba(0, 89, 179, .16); }
.refine-rail__opt:disabled { opacity: .45; cursor: not-allowed; }
.refine-rail__opt-tx { display: flex; min-width: 0; flex: 1; flex-direction: column; }
.refine-rail__opt-tx b { font-size: 12px; font-weight: 600; }
.refine-rail__opt-tx em { color: var(--neo-text-muted); font-size: 10.5px; font-style: normal; }
.refine-rail__opt-name { flex: 1; font-size: 12.5px; }
.refine-rail__radio { width: 12px; height: 12px; flex: 0 0 12px; border: 1.5px solid var(--neo-text-muted); border-radius: 50%; }
.refine-rail__opt.is-on .refine-rail__radio { border-color: #4a9eff; background: radial-gradient(circle, #4a9eff 0 3.5px, transparent 4px); }
.refine-rail__pin { margin-left: 5px; padding: 0 5px; border-radius: 5px; background: rgba(74, 158, 255, .2); color: #7cc0ff; font-size: 9.5px; font-weight: 500; }
.refine-rail__fly-div { height: 1px; margin: 6px 4px; background: var(--neo-border); }
.refine-rail__cmd { display: block; width: 100%; padding: 5px 6px; border: none; border-radius: 9px; background: transparent; color: var(--neo-text-secondary); font-size: 12px; text-align: left; cursor: pointer; }
.refine-rail__cmd:hover { background: var(--neo-hover-bg); }
.refine-rail__fly-note { padding: 2px 6px 0; color: var(--neo-text-muted); font-size: 10px; line-height: 1.5; }
</style>
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/RefineToolRail.test.ts
```

Expected: PASS（8 个用例）。

- [ ] **Step 5: 类型检查并提交**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm --filter @lnkpi/web exec vue-tsc -b
git add apps/web/src/components/canvas/refine/RefineToolRail.vue \
        apps/web/src/components/canvas/refine/RefineToolRail.test.ts
git commit -m "feat(refine): canvas-left tool rail with submenus for 6 mask tools + compare/fit"
```

---

### Task 3: 画布顶部模式条 `RefineModeBar.vue`

**Files:**
- Create: `apps/web/src/components/canvas/refine/RefineModeBar.vue`
- Create: `apps/web/src/components/canvas/refine/RefineModeBar.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `toolLabel` / `toolParamKind` / `refineWorkspaceLabel`；store 的 `compareLightboxOpen` / `refineCompareMode` / `refineTool` / `refineBrushSize` / `refineBrushColor` / `refineWandTolerance` / `setRefineWandTolerance`
- Produces: `RefineModeBar`（无 props、无 emits）
  - `data-testid`：`refine-modebar`、`modebar-workspace`、`modebar-tool`、`modebar-param-brush`、`modebar-param-wand`、`modebar-hint-polygon`、`modebar-esc`

- [ ] **Step 1: 写失败测试**

创建 `apps/web/src/components/canvas/refine/RefineModeBar.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import RefineModeBar from './RefineModeBar.vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'

const mountBar = () => mount(RefineModeBar, { global: { plugins: [createPinia()] } })

describe('RefineModeBar', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('工作图态：标题「工作图」，Esc 提示是退出精修', () => {
    const w = mountBar()
    expect(w.find('[data-testid="modebar-workspace"]').text()).toBe('工作图')
    expect(w.find('[data-testid="modebar-esc"]').text()).toContain('退出精修')
  })

  it('对照态：标题带对照方式，Esc 提示是回到工作图', () => {
    const store = useCanvasEditorStore()
    store.setRefineCompareMode('wipe')
    store.setCompareLightboxOpen(true)
    const w = mountBar()
    expect(w.find('[data-testid="modebar-workspace"]').text()).toBe('对照 · 滑竿对照')
    expect(w.find('[data-testid="modebar-esc"]').text()).toContain('回到工作图')
  })

  it('画笔/橡皮显示粗细 + 颜色，不显示容差', () => {
    const store = useCanvasEditorStore()
    store.setRefineTool('brush')
    const w = mountBar()
    expect(w.find('[data-testid="modebar-param-brush"]').exists()).toBe(true)
    expect(w.find('[data-testid="modebar-param-wand"]').exists()).toBe(false)
    expect(w.find('[data-testid="modebar-tool"]').text()).toBe('画笔')
  })

  it('魔棒只显示容差', () => {
    const store = useCanvasEditorStore()
    store.setRefineTool('wand')
    const w = mountBar()
    expect(w.find('[data-testid="modebar-param-wand"]').exists()).toBe(true)
    expect(w.find('[data-testid="modebar-param-brush"]').exists()).toBe(false)
    expect(w.find('[data-testid="modebar-tool"]').text()).toBe('魔棒')
  })

  it('多边形只给文字提示；矩形与点选无参数', () => {
    const store = useCanvasEditorStore()
    store.setRefineTool('polygon')
    const w = mountBar()
    expect(w.find('[data-testid="modebar-hint-polygon"]').exists()).toBe(true)
  })

  it('矩形与点选不出现任何参数控件', () => {
    const store = useCanvasEditorStore()
    store.setRefineTool('rect')
    const w = mountBar()
    expect(w.find('[data-testid="modebar-tool"]').text()).toBe('矩形')
    expect(w.find('[data-testid="modebar-param-brush"]').exists()).toBe(false)
    expect(w.find('[data-testid="modebar-param-wand"]').exists()).toBe(false)
    expect(w.find('[data-testid="modebar-hint-polygon"]').exists()).toBe(false)
  })

  it('拖粗细滑杆写回 store', async () => {
    const store = useCanvasEditorStore()
    store.setRefineTool('brush')
    const w = mountBar()
    await w.find('[data-testid="modebar-param-brush"] input[type="range"]').setValue('48')
    expect(store.refineBrushSize).toBe(48)
  })

  it('对照态下不显示工具参数（对照不写图片数据）', () => {
    const store = useCanvasEditorStore()
    store.setRefineTool('brush')
    store.setCompareLightboxOpen(true)
    const w = mountBar()
    expect(w.find('[data-testid="modebar-param-brush"]').exists()).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/RefineModeBar.test.ts
```

Expected: FAIL —— `Failed to resolve import "./RefineModeBar.vue"`。

- [ ] **Step 3: 实现组件**

创建 `apps/web/src/components/canvas/refine/RefineModeBar.vue`：

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import { refineWorkspaceLabel, toolLabel, toolParamKind } from './refineToolRailModel'

const editor = useCanvasEditorStore()
const paramKind = computed(() => toolParamKind(editor.refineTool))
const escHint = computed(() => (editor.compareLightboxOpen ? 'Esc 回到工作图' : 'Esc 退出精修'))

function onBrushSize(e: Event) { editor.refineBrushSize = Number((e.target as HTMLInputElement).value) }
function onBrushColor(e: Event) { editor.refineBrushColor = (e.target as HTMLInputElement).value }
function onWandTolerance(e: Event) { editor.setRefineWandTolerance(Number((e.target as HTMLInputElement).value)) }
</script>

<template>
  <div class="refine-modebar" data-testid="refine-modebar">
    <span class="refine-modebar__ws" data-testid="modebar-workspace">
      {{ refineWorkspaceLabel({ compareOpen: editor.compareLightboxOpen, compareMode: editor.refineCompareMode }) }}
    </span>

    <template v-if="!editor.compareLightboxOpen">
      <span class="refine-modebar__sep" />
      <span class="refine-modebar__tool" data-testid="modebar-tool">{{ toolLabel(editor.refineTool) }}</span>

      <label v-if="paramKind === 'brush'" class="refine-modebar__slider" data-testid="modebar-param-brush" title="笔刷粗细">
        <input type="range" min="4" max="80" :value="editor.refineBrushSize" @input="onBrushSize">
        <span>{{ editor.refineBrushSize }}</span>
        <input type="color" :value="editor.refineBrushColor" title="选区颜色" @input="onBrushColor">
      </label>

      <label v-else-if="paramKind === 'wand'" class="refine-modebar__slider" data-testid="modebar-param-wand" title="魔棒容差">
        <input type="range" min="0" max="48" step="1" :value="editor.refineWandTolerance" @input="onWandTolerance">
        <span>{{ editor.refineWandTolerance }}</span>
      </label>

      <span v-else-if="paramKind === 'polygon-hint'" class="refine-modebar__hint" data-testid="modebar-hint-polygon">
        单击落点 · 双击闭合
      </span>
    </template>

    <span class="refine-modebar__esc" data-testid="modebar-esc">{{ escHint }}</span>
  </div>
</template>

<style scoped>
.refine-modebar {
  display: flex; height: 32px; flex: 0 0 32px; align-items: center; gap: 10px; padding: 0 12px;
  border-bottom: 1px solid var(--neo-border); color: var(--neo-text-secondary); font-size: 12px;
}
.refine-modebar__ws { font-weight: 650; }
.refine-modebar__sep { width: 1px; height: 14px; background: var(--neo-border); }
.refine-modebar__tool { color: var(--neo-text-primary); }
.refine-modebar__slider { display: inline-flex; align-items: center; gap: 6px; }
.refine-modebar__slider input[type='range'] { width: 96px; }
.refine-modebar__slider input[type='color'] { width: 22px; height: 18px; padding: 0; border: none; background: none; }
.refine-modebar__hint { color: var(--neo-text-muted); }
.refine-modebar__esc { margin-left: auto; color: var(--neo-text-muted); font-size: 11px; }
</style>
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/RefineModeBar.test.ts
```

Expected: PASS（8 个用例）。

- [ ] **Step 5: 类型检查并提交**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm --filter @lnkpi/web exec vue-tsc -b
git add apps/web/src/components/canvas/refine/RefineModeBar.vue \
        apps/web/src/components/canvas/refine/RefineModeBar.test.ts
git commit -m "feat(refine): canvas-top mode bar carrying current mode + tool params"
```

---

### Task 4: 精修视口改造为「左栏 + 模式条 + 工作图」

**Files:**
- Modify: `apps/web/src/components/canvas/refine/RefineWorkViewport.vue`（当前 304 行）
- Create: `apps/web/src/components/canvas/refine/RefineWorkViewport.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `RefineToolRail`（emits `fit` / `actualSize`）、Task 3 的 `RefineModeBar`
- Produces: `RefineWorkViewport` 的 props（`url` / `width?` / `height?` / `insetRight`）**不变**；**不再有自身 header bar**（`适应窗口` / `1:1` 两个按钮移除，能力由左栏「适配」承担）

- [ ] **Step 1: 写失败测试**

创建 `apps/web/src/components/canvas/refine/RefineWorkViewport.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import RefineWorkViewport from './RefineWorkViewport.vue'

/** MaskEditor / ImageLoupe 依赖真实 canvas 与 mediapipe，jsdom 下换成轻量替身。 */
const mountViewport = () =>
  mount(RefineWorkViewport, {
    props: { url: 'blob:before', width: 100, height: 100, insetRight: 400 },
    global: {
      plugins: [createPinia()],
      stubs: {
        MaskEditor: { template: '<div class="mask-editor-stub" />' },
        ImageLoupe: { template: '<div class="loupe-stub"><slot /></div>' },
      },
    },
  })

describe('RefineWorkViewport 布局', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('左栏工具条与模式条都在视口内', () => {
    const w = mountViewport()
    expect(w.find('.refine-work__rail [data-testid="refine-rail"]').exists()).toBe(true)
    expect(w.find('.refine-work__col [data-testid="refine-modebar"]').exists()).toBe(true)
  })

  it('不再有自身 header bar（工作图 / 适应窗口 / 1:1 三件套已移走）', () => {
    const w = mountViewport()
    expect(w.find('.refine-work__bar').exists()).toBe(false)
    expect(w.find('.refine-work__btn').exists()).toBe(false)
  })

  it('stage 仍在，蒙版编辑器与工作图都已挂载', () => {
    const w = mountViewport()
    expect(w.find('.refine-work__stage').exists()).toBe(true)
    expect(w.find('.mask-editor-stub').exists()).toBe(true)
    expect(w.find('img.refine-work__img').attributes('src')).toBe('blob:before')
  })

  it('insetRight 决定 section 的 right 值', () => {
    expect(mountViewport().find('.refine-work').attributes('style')).toContain('right: 400px')
  })

  it('左栏「适配 → 适应窗口」把缩放归位（scale(1)、无平移）', async () => {
    const w = mountViewport()
    await w.find('[data-testid="rail-view-fit"]').trigger('click')
    await w.find('[data-testid="rail-fit-option-fit-window"]').trigger('click')
    const style = w.find('.refine-work__world').attributes('style') ?? ''
    expect(style).toContain('scale(1)')
    expect(style).toContain('translate(0px, 0px)')
  })

  it('左栏「适配 → 原始比例 1:1」改变缩放（与归位态不同）', async () => {
    const w = mountViewport()
    await w.find('[data-testid="rail-view-fit"]').trigger('click')
    await w.find('[data-testid="rail-fit-option-actual-size"]').trigger('click')
    const style = w.find('.refine-work__world').attributes('style') ?? ''
    expect(style).not.toContain('scale(1)')
  })
})
```

> **若最后一条不稳定**（jsdom 无 `ResizeObserver` 时 `film.width` 为 0，`oneToOneScale` 会退化成 1，导致断言失败）：把 `oneToOneScale` 的算法从组件里提取成 `refineWorkLayout.ts` 的导出函数 `oneToOneScaleOf(imgW: number, filmW: number): number`，给**它**写纯函数测试（`oneToOneScaleOf(4000, 500) === 8`、`oneToOneScaleOf(100, 500) === 1`），并把本用例改成只断言「点了 1:1 不抛错且 `world` 仍在」。不要为了凑绿测试去改实现语义。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/RefineWorkViewport.test.ts
```

Expected: FAIL —— `.refine-work__rail` 不存在。

- [ ] **Step 3: 改造模板与样式**

修改 `apps/web/src/components/canvas/refine/RefineWorkViewport.vue`：

(a) `<script setup>` 的 import 区加两行：

```ts
import RefineModeBar from './RefineModeBar.vue'
import RefineToolRail from './RefineToolRail.vue'
```

(b) 把**整个 `<template>`** 替换为（stage 内部结构一字不动，只改外层）：

```vue
<template>
  <section class="refine-work" :style="{ right: `${insetRight}px` }">
    <!-- 左栏：输入工具（产出选区 / 蒙版）+ 查看工具（只看不改） -->
    <div class="refine-work__rail">
      <RefineToolRail @fit="resetView" @actual-size="zoomOneToOne" />
    </div>

    <div class="refine-work__col">
      <RefineModeBar />
      <div
        ref="stageRef"
        class="refine-work__stage"
        :class="{ 'is-pan': spaceDown }"
        title="滚轮缩放 · 空格拖动平移"
        @wheel.prevent="onWheel"
        @pointerdown="onPointerDown"
      >
        <div class="refine-work__world" :style="worldStyle">
          <div class="refine-work__film" :style="filmStyle">
            <ImageLoupe :src="url" :active="editor.refineLoupeOn" :shape="editor.refineLoupeShape" :zoom="editor.refineLoupeZoom">
              <img class="refine-work__img" :src="url" alt="" draggable="false">
              <MaskEditor
                ref="maskRef"
                surface="node"
                :url="url"
                :width="imgW || undefined"
                :height="imgH || undefined"
                :tool="editor.refineTool"
                :brush-size="editor.refineBrushSize"
                :color="editor.refineBrushColor"
                :wand-tolerance="editor.refineWandTolerance"
                :mask-op="editor.refineMaskOp"
                :disabled="editor.refineBusy || spaceDown"
                @coverage="(p) => { editor.refineCoverage = p.ratio }"
                @point-select="dispatchRefinePointSelect"
              />
            </ImageLoupe>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
```

(c) 样式：`.refine-work` 由 `flex-direction: column` 改为横向 flex，删掉 `.refine-work__bar` / `.refine-work__hint` / `.refine-work__btn` 三条规则，新增两条：

```css
.refine-work { /* 其余属性保持原样，只把 flex-direction: column 删掉 */ display: flex; }

.refine-work__rail { position: relative; z-index: 1; }

.refine-work__col { display: flex; min-width: 0; flex: 1; flex-direction: column; }
```

`.refine-work__stage` / `__world` / `__film` / `__img` 与 `:deep(.image-loupe-host)` / `:deep(.mask-editor--node)` **原样保留**。

(d) 删掉不再被模板引用的 `resetView` 之外的孤儿：`resetView` 与 `zoomOneToOne` 仍被 rail 事件使用，**保留**；无其它删除。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/RefineWorkViewport.test.ts
```

Expected: PASS（6 个用例）。

- [ ] **Step 5: 类型检查并提交**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm --filter @lnkpi/web exec vue-tsc -b
git add apps/web/src/components/canvas/refine/RefineWorkViewport.vue \
        apps/web/src/components/canvas/refine/RefineWorkViewport.test.ts
git commit -m "refactor(refine): viewport hosts tool rail + mode bar, drops its own view header"
```

---

### Task 5: 右栏固定对照预览带 `RefineCompareBand.vue`（并摘掉模式按钮与放大镜）

**Files:**
- Create: `apps/web/src/components/canvas/refine/RefineCompareBand.vue`
- Create: `apps/web/src/components/canvas/refine/RefineCompareBand.test.ts`
- Modify: `apps/web/src/components/canvas/refine/RefineSidePanel.vue`

**Interfaces:**
- Consumes: `CompareView.vue`（props `beforeUrl` / `afterUrl?` / `mode?` / `wipeRatio?`；emits `update:wipeRatio` / `update:showingOriginal`）、store 的 `compareLightboxOpen` / `setCompareLightboxOpen` / `refineWipeRatio` / `setRefineWipeRatio`
- Produces: `RefineCompareBand` 组件，props `{ beforeUrl: string; afterUrl?: string }`
  - `data-testid`：`refine-compare-band`、`compare-band-maximize`

- [ ] **Step 1: 写失败测试**

创建 `apps/web/src/components/canvas/refine/RefineCompareBand.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import RefineCompareBand from './RefineCompareBand.vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'

const mountBand = (props: { beforeUrl: string; afterUrl?: string } = { beforeUrl: 'blob:before' }) =>
  mount(RefineCompareBand, { props, global: { plugins: [createPinia()] } })

describe('RefineCompareBand', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('顶部固定带：标题 + 默认态说明 + 去全屏按钮', () => {
    const w = mountBand()
    expect(w.find('[data-testid="refine-compare-band"]').exists()).toBe(true)
    expect(w.text()).toContain('对照预览')
    expect(w.text()).toContain('默认左右')
    expect(w.find('[data-testid="compare-band-maximize"]').exists()).toBe(true)
  })

  it('去全屏按钮切换 store 的 compareLightboxOpen', async () => {
    const store = useCanvasEditorStore()
    const w = mountBand()
    await w.find('[data-testid="compare-band-maximize"]').trigger('click')
    expect(store.compareLightboxOpen).toBe(true)
    await w.find('[data-testid="compare-band-maximize"]').trigger('click')
    expect(store.compareLightboxOpen).toBe(false)
  })

  it('不再有左右 / 滑竿两枚模式按钮（默认态即唯一态）', () => {
    const w = mountBand()
    expect(w.find('[title="左右对照"]').exists()).toBe(false)
    expect(w.find('[title="重叠滑竿"]').exists()).toBe(false)
  })

  it('不再有放大镜按钮及其子控件', () => {
    const w = mountBand()
    expect(w.find('[title="放大镜"]').exists()).toBe(false)
    expect(w.find('[title="圆形放大区"]').exists()).toBe(false)
    expect(w.find('[title="矩形放大区"]').exists()).toBe(false)
    expect(w.find('[title="放大镜倍数"]').exists()).toBe(false)
  })

  it('预览本体锁定左右对照：即使 store 里是对滑竿，CompareView 仍收到 split', () => {
    const store = useCanvasEditorStore()
    store.setRefineCompareMode('wipe')
    const w = mountBand({ beforeUrl: 'blob:before', afterUrl: 'blob:after' })
    const compareView = w.findComponent({ name: 'CompareView' })
    expect(compareView.exists()).toBe(true)
    expect(compareView.props('mode')).toBe('split')
    expect(compareView.props('beforeUrl')).toBe('blob:before')
    expect(compareView.props('afterUrl')).toBe('blob:after')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/RefineCompareBand.test.ts
```

Expected: FAIL —— `Failed to resolve import "./RefineCompareBand.vue"`。

- [ ] **Step 3: 实现组件**

创建 `apps/web/src/components/canvas/refine/RefineCompareBand.vue`：

```vue
<script setup lang="ts">
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import CompareView from './CompareView.vue'

defineProps<{ beforeUrl: string; afterUrl?: string }>()

const editor = useCanvasEditorStore()
</script>

<template>
  <!-- 右栏顶部固定带：不随工具箱滚动（spec P0-7）。锁定左右对照，不做模式切换（P0-6）。 -->
  <section class="compare-band" data-testid="refine-compare-band">
    <div class="compare-band__head">
      <span class="compare-band__title">对照预览</span>
      <span class="compare-band__pin">固定 · 默认左右</span>
      <button
        type="button"
        class="compare-band__max"
        data-testid="compare-band-maximize"
        :class="{ 'is-active': editor.compareLightboxOpen }"
        :title="editor.compareLightboxOpen ? '回到工作图' : '最大化对照'"
        aria-label="最大化对照"
        @click="editor.setCompareLightboxOpen(!editor.compareLightboxOpen)"
      >
        <svg v-if="!editor.compareLightboxOpen" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.75">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 4H5v4M15 4h4v4M5 15v4h4M19 15v4h-4" />
        </svg>
        <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.75">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 9H5V5M15 9h4V5M5 15v4h4M19 15v4h-4" />
        </svg>
      </button>
    </div>

    <CompareView
      :before-url="beforeUrl"
      :after-url="afterUrl"
      mode="split"
      :wipe-ratio="editor.refineWipeRatio"
      @update:wipe-ratio="editor.setRefineWipeRatio($event)"
    />
  </section>
</template>

<style scoped>
.compare-band { flex: 0 0 auto; padding: 9px 12px 10px; border-bottom: 1px solid var(--neo-border); }
.compare-band__head { display: flex; align-items: center; gap: 7px; height: 24px; margin-bottom: 7px; }
.compare-band__title { color: var(--neo-text-primary); font-size: 12px; font-weight: 650; }
.compare-band__pin { color: var(--neo-text-muted); font-size: 10.5px; }
.compare-band__max {
  display: flex; width: 24px; height: 24px; margin-left: auto; align-items: center; justify-content: center;
  border: 1px solid var(--neo-border); border-radius: 7px; background: transparent;
  color: var(--neo-text-secondary); cursor: pointer;
}
.compare-band__max:hover { background: var(--neo-hover-bg); }
.compare-band__max.is-active { background: rgba(0, 89, 179, .18); color: #7cc0ff; }
</style>
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/RefineCompareBand.test.ts
```

Expected: PASS（5 个用例）。

> 若 `findComponent({ name: 'CompareView' })` 取不到（`<script setup>` 组件名推断在测试环境未必生效），**不要改实现**：退化为断言 `.compare-view__panes` 存在，并在 PR Test plan 里注明「mode=split 由 Task 8 目视清单第 3 条覆盖」。

- [ ] **Step 5: 从右栏摘掉模式按钮、放大镜，并把对照状态改读 store**

修改 `apps/web/src/components/canvas/refine/RefineSidePanel.vue`：

(a) 删除 `.refine-side__toolbar` 内的**第一个 icon-row**（`title="左右对照"`、`title="重叠滑竿"`、`title="最大化对照"`、`<span class="refine-side__divider" />`、`title="放大镜"` 及其后 `v-if="loupeMenuOpen"` 整段 `<template>`）。删除后如果 `.refine-side__toolbar` 只剩「画笔」与「魔棒/多边形/点选」两排，**先原样保留**（Task 8 整块搬走）。

(b) 局部 ref 改读 store：

```ts
// 原：const compareMode = ref<CompareMode>('split')  → 改为只读引用 store
const compareMode = computed(() => editor.refineCompareMode)
// 原：const wipeRatio = ref(0.5) → 改为
const wipeRatio = computed(() => editor.refineWipeRatio)
```

(c) `CompareLightbox` 的两个双向绑定改为写 store：

```vue
@update:mode="editor.setRefineCompareMode($event)"
@update:wipe-ratio="editor.setRefineWipeRatio($event)"
```

(d) 删除孤儿：`loupeSubcontrolsVisible` 从 `@/utils/refineChrome` 的 import 列表里去掉；删 `const loupeMenuOpen = computed(...)`；删 `onLoupeZoomInput`（确认无其它引用后）。

(e) **不要删** `editor.refineLoupeOn` / `refineLoupeShape` / `refineLoupeZoom` 与 `ImageLoupe.vue`（spec P0-5、Global Constraints）。

- [ ] **Step 6: 全量跑 web 测试与类型检查**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm --filter @lnkpi/web exec vitest run
pnpm --filter @lnkpi/web exec vue-tsc -b
```

Expected: 全绿（754 + 本包新增）。若 `vue-tsc` 报 `compareMode` 只读被赋值，说明还有漏改的 `compareMode = ...`，全部改为 `editor.setRefineCompareMode(...)`。

- [ ] **Step 7: 提交**

```bash
cd /Users/4seven/workspace/lnkpi
git add apps/web/src/components/canvas/refine/RefineCompareBand.vue \
        apps/web/src/components/canvas/refine/RefineCompareBand.test.ts \
        apps/web/src/components/canvas/refine/RefineSidePanel.vue
git commit -m "feat(refine): fixed compare band, drop mode buttons + loupe from side panel"
```

---

### Task 6: 右栏工具箱 `RefineToolbox.vue`（快速预设 + 版本历史）

**Files:**
- Create: `apps/web/src/components/canvas/refine/RefineToolbox.vue`
- Create: `apps/web/src/components/canvas/refine/RefineToolbox.test.ts`

**Interfaces:**
- Consumes: `VersionStrip.vue`（props `versions` / `currentVersionId?` / `disabled?`；emits `select` / `revert`）
- Produces: `RefineToolbox` 组件
  - props：`{ versions: ImageVersionEntry[]; currentVersionId?: string; busy?: boolean }`
  - emits：`applyStainPreset: []`、`selectVersion: [versionId: string]`、`revertVersion: [versionId: string]`
  - `data-testid`：`refine-toolbox`、`toolbox-scroll`、`toolbox-preset-stain`

- [ ] **Step 1: 写失败测试**

创建 `apps/web/src/components/canvas/refine/RefineToolbox.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RefineToolbox from './RefineToolbox.vue'

const mountBox = (props: Record<string, unknown> = {}) =>
  mount(RefineToolbox, { props: { versions: [], ...props } })

describe('RefineToolbox', () => {
  it('两组标题：快速预设 + 版本历史，自己是唯一滚动区', () => {
    const w = mountBox()
    expect(w.find('[data-testid="refine-toolbox"]').exists()).toBe(true)
    expect(w.text()).toContain('快速预设')
    expect(w.text()).toContain('版本历史')
    const scroll = w.find('[data-testid="toolbox-scroll"]')
    expect(scroll.exists()).toBe(true)
    expect(scroll.classes()).toContain('refine-toolbox__scroll')
  })

  it('「清除瑕疵」点击后 emit applyStainPreset', async () => {
    const w = mountBox()
    await w.find('[data-testid="toolbox-preset-stain"]').trigger('click')
    expect(w.emitted('applyStainPreset')).toHaveLength(1)
  })

  it('busy 时「清除瑕疵」禁用', () => {
    expect(mountBox({ busy: true }).find('[data-testid="toolbox-preset-stain"]').attributes('disabled')).toBeDefined()
  })

  it('版本历史把 select / revert 透传上来', () => {
    const w = mountBox({ versions: [{ id: 'v1', url: 'blob:v1' }], currentVersionId: 'v1' })
    const strip = w.findComponent({ name: 'VersionStrip' })
    expect(strip.exists()).toBe(true)
    strip.vm.$emit('select', 'v1')
    strip.vm.$emit('revert', 'v1')
    expect(w.emitted('selectVersion')).toEqual([['v1']])
    expect(w.emitted('revertVersion')).toEqual([['v1']])
  })

  it('不预置任何空的能力组标题（M2 工具到位时再加）', () => {
    const text = mountBox().text()
    for (const label of ['抠素材', '构图', '改内容', '提画质']) expect(text).not.toContain(label)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/RefineToolbox.test.ts
```

Expected: FAIL —— `Failed to resolve import "./RefineToolbox.vue"`。

- [ ] **Step 3: 实现组件**

创建 `apps/web/src/components/canvas/refine/RefineToolbox.vue`：

```vue
<script setup lang="ts">
import type { ImageVersionEntry } from '@lnkpi/shared'
import VersionStrip from './VersionStrip.vue'

withDefaults(defineProps<{
  versions: ImageVersionEntry[]
  currentVersionId?: string
  busy?: boolean
}>(), { busy: false })

const emit = defineEmits<{
  applyStainPreset: []
  selectVersion: [versionId: string]
  revertVersion: [versionId: string]
}>()
</script>

<template>
  <!-- 右栏唯一的滚动区（spec P0-1）。工具箱承载「用什么手段改」，dock 承载「这一轮改什么」。 -->
  <section class="refine-toolbox" data-testid="refine-toolbox">
    <div class="refine-toolbox__scroll" data-testid="toolbox-scroll">
      <div class="refine-toolbox__group">
        <div class="refine-toolbox__glabel">快速预设</div>
        <button
          type="button"
          class="refine-toolbox__item"
          data-testid="toolbox-preset-stain"
          :disabled="busy"
          @click="emit('applyStainPreset')"
        >
          清除瑕疵
        </button>
      </div>

      <div class="refine-toolbox__group">
        <div class="refine-toolbox__glabel">版本历史</div>
        <VersionStrip
          :versions="versions"
          :current-version-id="currentVersionId"
          :disabled="busy"
          @select="emit('selectVersion', $event)"
          @revert="emit('revertVersion', $event)"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.refine-toolbox { display: flex; min-height: 0; flex: 1; flex-direction: column; }
.refine-toolbox__scroll { min-height: 0; flex: 1; overflow-y: auto; padding: 10px 12px 12px; }
.refine-toolbox__group + .refine-toolbox__group { margin-top: 14px; }
.refine-toolbox__glabel { margin-bottom: 6px; color: var(--neo-text-muted); font-size: 10.5px; letter-spacing: .04em; }
.refine-toolbox__item {
  display: block; width: 100%; padding: 7px 10px; border: 1px solid var(--neo-border);
  border-radius: 10px; background: transparent; color: var(--neo-text-primary);
  font-size: 12.5px; text-align: left; cursor: pointer;
}
.refine-toolbox__item:hover:not(:disabled) { background: var(--neo-hover-bg); }
.refine-toolbox__item:disabled { opacity: .5; cursor: not-allowed; }
</style>
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/RefineToolbox.test.ts
```

Expected: PASS（5 个用例）。

- [ ] **Step 5: 类型检查并提交**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm --filter @lnkpi/web exec vue-tsc -b
git add apps/web/src/components/canvas/refine/RefineToolbox.vue \
        apps/web/src/components/canvas/refine/RefineToolbox.test.ts
git commit -m "feat(refine): toolbox section as the only scroll region (presets + version history)"
```

---

### Task 7: 右栏 dock `RefineDock.vue`（与图片节点 dock 同构）

**Files:**
- Create: `apps/web/src/components/canvas/refine/RefineDock.vue`
- Create: `apps/web/src/components/canvas/refine/RefineDock.test.ts`

**Interfaces:**
- Consumes: `DockToolbarShell`（props `type` / `showClose`；emits `close`；slot `header-end` + 默认 slot）、`DockRefStrip`（props `refs` / `showAddUpload?`；emits `reorder` / `remove` / `mention` / `addUpload`）、`DockPromptSection`（props `modelValue` / `mentions?` / `placeholder?`；emits `update:modelValue` / `submit`；暴露 `insertRefMention` / `focus`）、`DockMicButton`（props `listening` / `disabled`；emits `toggle`）、`DockCreditBadge`（props `credits`）、`GuidePickerPopover`（`mode="edit_intent"`）、`useSpeechRecognition`
- Produces: `RefineDock` 组件
  - props：`{ prompt; credits; beforeUrl; modelLabel; busy?; disabled?; canApply?; errorMessage?; coverageKind?; mediaLabel?; width?; height?; activeEditIntentId?; refRoleHints? }`
  - emits：`update:prompt`、`run`、`apply`、`retry`、`close`、`selectEditIntent`、`clearEditIntent`
  - `data-testid`：`refine-dock`、`dock-model-chip`、`dock-size-chip`、`dock-run`、`dock-apply`、`dock-edit-intent`

- [ ] **Step 1: 写失败测试**

创建 `apps/web/src/components/canvas/refine/RefineDock.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RefineDock from './RefineDock.vue'

const mountDock = (props: Record<string, unknown> = {}) =>
  mount(RefineDock, {
    props: { prompt: '', credits: 10, beforeUrl: 'blob:before', modelLabel: 'gpt-image-1', width: 1280, height: 720, ...props },
    global: { stubs: { GuidePickerPopover: { template: '<div class="guide-picker-stub" />' } } },
  })

describe('RefineDock', () => {
  it('与图片节点 dock 同构：header 类型图标 + 「精修」 + 关闭', () => {
    const w = mountDock()
    expect(w.find('.bottom-toolbar-container').exists()).toBe(true)
    expect(w.find('.bottom-toolbar-type-icon').exists()).toBe(true)
    expect(w.text()).toContain('精修')
    expect(w.find('.bottom-toolbar-close').exists()).toBe(true)
  })

  it('参考条只有原图一个 chip，且不给上传入口（精修通道暂不接受参考图）', () => {
    const strip = mountDock().findComponent({ name: 'DockRefStrip' })
    expect(strip.exists()).toBe(true)
    expect((strip.props('refs') as unknown[]).length).toBe(1)
    expect(strip.props('showAddUpload')).toBeFalsy()
  })

  it('模型与尺寸是只读状态位，不是可点控件', () => {
    const w = mountDock()
    expect(w.find('[data-testid="dock-model-chip"]').text()).toContain('gpt-image-1')
    expect(w.find('[data-testid="dock-size-chip"]').text()).toContain('1280×720')
    expect(w.find('[data-testid="dock-size-chip"]').element.tagName).not.toBe('BUTTON')
  })

  it('尺寸位带比例（由宽高推出）', () => {
    expect(mountDock({ width: 1920, height: 1080 }).find('[data-testid="dock-size-chip"]').text()).toContain('16:9')
  })

  it('提示词区双向绑定，回车 submit 触发 run', () => {
    const w = mountDock()
    const section = w.findComponent({ name: 'DockPromptSection' })
    section.vm.$emit('update:modelValue', '把背景换成雪山')
    expect(w.emitted('update:prompt')).toEqual([['把背景换成雪山']])
    section.vm.$emit('submit')
    expect(w.emitted('run')).toHaveLength(1)
  })

  it('精修按钮：可点时 emit run，busy 时禁用', async () => {
    const w = mountDock({ prompt: 'x' })
    await w.find('[data-testid="dock-run"]').trigger('click')
    expect(w.emitted('run')).toHaveLength(1)
    expect(mountDock({ prompt: 'x', busy: true }).find('[data-testid="dock-run"]').attributes('disabled')).toBeDefined()
  })

  it('应用到节点只在 canApply 时出现', () => {
    expect(mountDock({ canApply: false }).find('[data-testid="dock-apply"]').exists()).toBe(false)
    expect(mountDock({ canApply: true }).find('[data-testid="dock-apply"]').exists()).toBe(true)
  })

  it('编辑意图挂在 header-end（与图片节点 dock 的「场景模板」同位）', () => {
    const w = mountDock()
    expect(w.find('.bottom-toolbar-header-end [data-testid="dock-edit-intent"]').exists()).toBe(true)
  })

  it('选区为空时提示先圈选', () => {
    expect(mountDock({ coverageKind: 'empty' }).text()).toContain('请先圈选要改的区域')
  })

  it('有错误时显示错误并可重试', async () => {
    const w = mountDock({ errorMessage: '精修失败，请重试' })
    expect(w.text()).toContain('精修失败，请重试')
    await w.find('.refine-dock__retry').trigger('click')
    expect(w.emitted('retry')).toHaveLength(1)
  })

  it('关闭按钮 emit close', async () => {
    const w = mountDock()
    await w.find('.bottom-toolbar-close').trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/RefineDock.test.ts
```

Expected: FAIL —— `Failed to resolve import "./RefineDock.vue"`。

- [ ] **Step 3: 实现组件**

创建 `apps/web/src/components/canvas/refine/RefineDock.vue`（完整代码）：

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import type { NodeRef } from '@/composables/useNodeRefs'
import { useSpeechRecognition } from '@/composables/useSpeechRecognition'
import DockToolbarShell from '@/components/canvas/dock-studio/shared/DockToolbarShell.vue'
import DockRefStrip from '@/components/canvas/dock-studio/shared/DockRefStrip.vue'
import DockPromptSection from '@/components/canvas/dock-studio/shared/DockPromptSection.vue'
import DockMicButton from '@/components/canvas/dock-studio/shared/DockMicButton.vue'
import DockCreditBadge from '@/components/canvas/dock-studio/shared/DockCreditBadge.vue'
import GuidePickerPopover from '@/components/canvas/dock-studio/shared/GuidePickerPopover.vue'

const props = withDefaults(defineProps<{
  prompt: string
  credits: number
  beforeUrl: string
  /** 该精修通道实际使用的模型（服务端写死，所以是只读状态位） */
  modelLabel: string
  busy?: boolean
  disabled?: boolean
  canApply?: boolean
  errorMessage?: string
  coverageKind?: 'ok' | 'empty' | 'full'
  width?: number
  height?: number
  activeEditIntentId?: string | null
  refRoleHints?: string
}>(), {
  busy: false, disabled: false, canApply: false, coverageKind: 'ok',
  activeEditIntentId: null, refRoleHints: '',
})

const emit = defineEmits<{
  'update:prompt': [value: string]
  run: []
  apply: []
  retry: []
  close: []
  selectEditIntent: [id: string]
  clearEditIntent: []
}>()

const speech = useSpeechRecognition()
const promptSectionRef = ref<InstanceType<typeof DockPromptSection> | null>(null)
const editIntentAnchorRef = ref<HTMLElement | null>(null)
const editIntentPickerOpen = ref(false)

/**
 * 精修通道 POST /studio/image/edit 只接受 prompt / imageUrl / maskUrl，
 * 不接受模型、尺寸与参考图（spec §6.1）。所以这里如实呈现为只读状态位，
 * 不做「点了也没用」的控件。
 */
function aspectLabel(w: number, h: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const g = gcd(w, h) || 1
  const rw = Math.round(w / g)
  const rh = Math.round(h / g)
  return rw > 64 || rh > 64 ? `${(w / h).toFixed(2)}:1` : `${rw}:${rh}`
}

const sizeLabel = computed(() => {
  const w = Number(props.width) || 0
  const h = Number(props.height) || 0
  if (!w || !h) return '原始尺寸'
  return `${w}×${h} · ${aspectLabel(w, h)}`
})

const workRefs = computed<NodeRef[]>(() => [{
  refId: 'refine-work-image',
  refKey: 'I1',
  mediaType: 'image',
  sourceKind: 'local',
  label: '原图',
  preview: props.beforeUrl,
  payload: { url: props.beforeUrl },
}])

const runDisabled = computed(() => props.busy || props.disabled)

function toggleVoice() {
  if (speech.listening.value) { speech.stop(); return }
  speech.start((text, isFinal) => {
    if (!isFinal) return
    emit('update:prompt', props.prompt ? `${props.prompt} ${text}` : text)
  })
}
</script>

<template>
  <div class="refine-dock" data-testid="refine-dock">
    <DockToolbarShell type="image" :show-close="true" @close="emit('close')">
      <template #header-end>
        <div class="relative">
          <button
            ref="editIntentAnchorRef"
            type="button"
            class="refine-dock__intent"
            :class="{ 'is-active': activeEditIntentId }"
            data-testid="dock-edit-intent"
            :disabled="runDisabled"
            aria-label="编辑意图"
            :aria-expanded="editIntentPickerOpen"
            @click="editIntentPickerOpen = !editIntentPickerOpen"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" />
              <rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" />
            </svg>
            <span>编辑意图</span>
          </button>
          <GuidePickerPopover
            mode="edit_intent"
            :active-id="activeEditIntentId"
            :open="editIntentPickerOpen"
            :anchor-el="editIntentAnchorRef"
            placement="below-end"
            portal
            @select="emit('selectEditIntent', $event); editIntentPickerOpen = false"
            @clear="emit('clearEditIntent'); editIntentPickerOpen = false"
            @close="editIntentPickerOpen = false"
          />
        </div>
      </template>

      <!-- 参考条：只读展示这张工作图。精修通道暂不接受附加参考图，所以不给 + 上传。 -->
      <DockRefStrip :refs="workRefs" @mention="promptSectionRef?.insertRefMention($event)" />

      <DockPromptSection
        ref="promptSectionRef"
        :model-value="prompt"
        placeholder="改这里：……"
        @update:model-value="emit('update:prompt', $event)"
        @submit="emit('run')"
      />

      <p v-if="refRoleHints" class="refine-dock__hint">参考图：{{ refRoleHints }}</p>
      <p v-if="coverageKind === 'empty'" class="refine-dock__hint">请先圈选要改的区域</p>
      <p v-else-if="coverageKind === 'full'" class="refine-dock__hint refine-dock__hint--warn">
        这会改整张图，更像重新生成；可用底部生成栏
      </p>

      <div v-if="errorMessage" class="refine-dock__error" role="alert">
        <span>{{ errorMessage }}</span>
        <button type="button" class="refine-dock__retry" :disabled="busy" @click="emit('retry')">重试</button>
      </div>

      <div class="bottom-toolbar-actions refine-dock__actions">
        <span class="refine-dock__chip" data-testid="dock-model-chip" :title="`精修通道模型：${modelLabel}`">
          <span class="refine-dock__chip-k">模型</span>{{ modelLabel }}
        </span>
        <span class="refine-dock__chip" data-testid="dock-size-chip" title="输出尺寸跟随原图">
          <span class="refine-dock__chip-k">尺寸</span>{{ sizeLabel }}
        </span>

        <div class="ml-auto flex items-center gap-2">
          <DockMicButton :listening="speech.listening.value" :disabled="runDisabled" @toggle="toggleVoice" />
          <DockCreditBadge :credits="credits" />
          <button type="button" class="refine-dock__primary" data-testid="dock-run" :disabled="runDisabled" @click="emit('run')">
            精修
          </button>
          <button type="button" class="refine-dock__ghost" disabled title="抠图将走专用通道，尚未接入">抠图</button>
          <button v-if="canApply" type="button" class="refine-dock__ghost" data-testid="dock-apply" :disabled="busy" @click="emit('apply')">
            应用到节点
          </button>
        </div>
      </div>
    </DockToolbarShell>
  </div>
</template>

<style scoped>
/* 精修右栏只有 400px，必须解除横版底栏的 600px 最小宽（styles/neo-node.css:1051） */
.refine-dock :deep(.bottom-toolbar-container) { min-width: 0; width: 100%; }
/* 横版底栏的 -32px/-40px 出血光晕在竖版里会溢出 */
.refine-dock :deep(.bottom-toolbar-container)::after { display: none; }

.refine-dock__intent {
  display: inline-flex; height: 24px; align-items: center; gap: 4px; padding: 0 8px;
  border: 1px solid var(--neo-border); border-radius: 8px; background: transparent;
  color: var(--neo-text-secondary); font-size: 11px; cursor: pointer;
}
.refine-dock__intent.is-active { background: rgba(0, 89, 179, .18); color: #7cc0ff; }
.refine-dock__intent:disabled { opacity: .5; cursor: not-allowed; }

.refine-dock__chip {
  display: inline-flex; height: 24px; align-items: center; gap: 4px; padding: 0 8px;
  border: 1px dashed var(--neo-border); border-radius: 8px;
  color: var(--neo-text-secondary); font-size: 11px;
}
.refine-dock__chip-k { color: var(--neo-text-muted); }

.refine-dock__hint { margin: 0 12px 6px; color: var(--neo-text-muted); font-size: 11px; }
.refine-dock__hint--warn { color: #e6a23c; }

.refine-dock__error { display: flex; margin: 0 12px 6px; align-items: center; gap: 8px; color: #f56c6c; font-size: 11px; }
.refine-dock__retry { border: 1px solid currentColor; border-radius: 6px; background: transparent; color: inherit; font-size: 11px; padding: 1px 6px; cursor: pointer; }

.refine-dock__actions { flex-wrap: wrap; }

.refine-dock__primary,
.refine-dock__ghost { height: 28px; padding: 0 12px; border-radius: 8px; font-size: 12px; cursor: pointer; }
.refine-dock__primary { border: none; background: var(--neo-hi-bg, #17181d); color: #fff; font-weight: 600; }
.refine-dock__primary:disabled { opacity: .45; cursor: not-allowed; }
.refine-dock__ghost { border: 1px solid var(--neo-border); background: transparent; color: var(--neo-text-secondary); }
.refine-dock__ghost:disabled { opacity: .5; cursor: not-allowed; }
</style>
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/RefineDock.test.ts
```

Expected: PASS（11 个用例）。

- [ ] **Step 5: 核对 600px 覆写真的落盘**

```bash
cd /Users/4seven/workspace/lnkpi
grep -n "min-width: 0" apps/web/src/components/canvas/refine/RefineDock.vue
```

Expected: 命中 `.refine-dock :deep(.bottom-toolbar-container)` 内的 `min-width: 0;`。把该行输出贴进 PR 的 Test plan。

- [ ] **Step 6: 类型检查并提交**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm --filter @lnkpi/web exec vue-tsc -b
git add apps/web/src/components/canvas/refine/RefineDock.vue \
        apps/web/src/components/canvas/refine/RefineDock.test.ts
git commit -m "feat(refine): dock aligned with image node dock (model/size as read-only status chips)"
```

---

### Task 8: 右栏三段容器重装

**Files:**
- Modify: `apps/web/src/components/canvas/refine/RefineSidePanel.vue`
- Create: `apps/web/src/components/canvas/refine/RefineSidePanel.test.ts`

**Interfaces:**
- Consumes: Task 5 的 `RefineCompareBand`、Task 6 的 `RefineToolbox`、Task 7 的 `RefineDock`
- Produces: `RefineSidePanel` 的 **props / emits 签名完全不变**（`RefineWorkbench.vue` 无需改动）

- [ ] **Step 1: 写失败测试**

创建 `apps/web/src/components/canvas/refine/RefineSidePanel.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import RefineSidePanel from './RefineSidePanel.vue'

const baseProps = {
  nodeId: 'n1', beforeUrl: 'blob:before', versions: [], sessionId: 's1',
  panelWidth: 400, collapsed: false, isNarrow: false, insetRight: 400,
}

const mountPanel = (overrides: Record<string, unknown> = {}) =>
  mount(RefineSidePanel, {
    props: { ...baseProps, ...overrides },
    global: {
      plugins: [createPinia()],
      stubs: { GuidePickerPopover: { template: '<div />' }, VersionStrip: { name: 'VersionStrip', template: '<div />' } },
    },
  })

describe('RefineSidePanel 三段式', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('段落顺序：head → 对照带 → 工具箱 → dock', () => {
    const w = mountPanel()
    const order = Array.from(w.element.querySelectorAll(
      '.refine-side__head, [data-testid="refine-compare-band"], [data-testid="refine-toolbox"], [data-testid="refine-dock"]',
    )).map((el) => el.getAttribute('data-testid') ?? 'head')
    expect(order).toEqual(['head', 'refine-compare-band', 'refine-toolbox', 'refine-dock'])
  })

  it('对照带与 dock 在滚动容器之外，整栏只有一个滚动区', () => {
    const w = mountPanel()
    const body = w.find('.refine-side__body')
    expect(body.exists()).toBe(true)
    expect(body.find('[data-testid="refine-toolbox"]').exists()).toBe(true)
    expect(body.find('[data-testid="refine-compare-band"]').exists()).toBe(false)
    expect(body.find('[data-testid="refine-dock"]').exists()).toBe(false)
    expect(w.element.querySelectorAll('[data-testid="toolbox-scroll"]').length).toBe(1)
  })

  it('不再有旧的三排图标工具条', () => {
    const w = mountPanel()
    expect(w.find('.refine-side__toolbar').exists()).toBe(false)
    expect(w.find('[title="点选主体"]').exists()).toBe(false)
    expect(w.find('[title="魔棒"]').exists()).toBe(false)
  })

  it('不再有对照模式按钮 / 放大镜 / 细节放大', () => {
    const w = mountPanel()
    expect(w.find('[title="左右对照"]').exists()).toBe(false)
    expect(w.find('[title="重叠滑竿"]').exists()).toBe(false)
    expect(w.find('[title="放大镜"]').exists()).toBe(false)
    expect(w.text()).not.toContain('细节放大')
  })

  it('收起态：只剩头部，对照带与 dock 都不渲染', () => {
    const w = mountPanel({ collapsed: true, insetRight: 44 })
    expect(w.find('.refine-side').classes()).toContain('is-collapsed')
    expect(w.find('[data-testid="refine-compare-band"]').exists()).toBe(false)
    expect(w.find('[data-testid="refine-toolbox"]').exists()).toBe(false)
    expect(w.find('[data-testid="refine-dock"]').exists()).toBe(false)
  })

  it('右栏头部的收起钮仍在', () => {
    expect(mountPanel().find('.refine-side__collapse').exists()).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/RefineSidePanel.test.ts
```

Expected: FAIL —— 找不到 `[data-testid="refine-compare-band"]`。

- [ ] **Step 3: 重装模板**

修改 `apps/web/src/components/canvas/refine/RefineSidePanel.vue`：`<aside class="refine-side">` 内部结构改为（**头部一字不动**，只替换头部之后的全部内容）：

```vue
      <header class="refine-side__head"> ... 现有内容保持原样 ... </header>

      <RefineCompareBand
        v-if="!collapsed"
        :before-url="compareBeforeUrl"
        :after-url="afterUrl"
      />

      <div v-show="!collapsed" class="refine-side__body">
        <RefineToolbox
          :versions="versions"
          :current-version-id="currentVersionId"
          :busy="busy"
          @apply-stain-preset="applyStainPreset"
          @select-version="onSelectVersion"
          @revert-version="onRevert"
        />
      </div>

      <RefineDock
        v-if="!collapsed"
        :prompt="prompt"
        :credits="credits"
        :before-url="beforeUrl"
        :model-label="editModelLabel"
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
        @run="runRefine"
        @apply="onApply"
        @retry="runRefine"
        @close="onBackOrCancel"
        @select-edit-intent="applyEditIntent"
        @clear-edit-intent="clearEditIntent"
      />
```

配套三件事：

(a) **删除**模板里现在多余的整块：`.refine-side__toolbar`（含剩余两排图标）、`.refine-dock__chips`、两条 `.refine-dock__hint`、`.refine-dock__prompt`、`.refine-dock__actions`、`VersionStrip` 那一段。`<CompareLightbox ... />`（在 `</aside>` 之后、`</Teleport>` 之外）**保留不动**。

(b) 加 import 与常量：

```ts
import RefineCompareBand from './RefineCompareBand.vue'
import RefineDock from './RefineDock.vue'
import RefineToolbox from './RefineToolbox.vue'
```

```ts
/** 精修通道模型由服务端写死（studio.service.ts 的 P1_IMAGE_EDIT_MODEL_KEY），前端只做展示。 */
const editModelLabel = computed(() => 'gpt-image-1')
```

(c) **样式**：`.refine-side__body` 从原来的「有自己 padding / overflow」改为「不滚动的薄壳」，把滚动交给工具箱：

```css
.refine-side__body {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;      /* 滚动在 .refine-toolbox__scroll 里，整栏只有一个滚动区 */
}
```

删除已无引用的规则：`.refine-side__toolbar`、`.refine-side__icon-row`、`.refine-side__divider`、`.refine-side__slider`、`.refine-side__color`、`.refine-dock__chips`、`.refine-dock__chip*`、`.refine-dock__prompt`、`.refine-dock__tools`、`.refine-dock__tool*`、`.refine-dock__hint*`、`.refine-dock__error`、`.refine-dock__retry`、`.refine-dock__actions`、`.refine-dock__primary`、`.refine-dock__apply`。**保留** `.refine-side`、`.refine-side.is-collapsed`、`.refine-side__head`、`.refine-side__collapse`、`.refine-side__title`、`.refine-side__icon-btn`、`.refine-side__body`。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/RefineSidePanel.test.ts
```

Expected: PASS（6 个用例）。

- [ ] **Step 5: 全量 web 测试 + 类型检查**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm --filter @lnkpi/web exec vitest run
pnpm --filter @lnkpi/web exec vue-tsc -b
```

Expected: 全绿。`vue-tsc` 若报「声明未使用」（`STORAGE` 之类残留），逐个删掉，不要用 `// @ts-ignore` 压。

- [ ] **Step 6: 提交**

```bash
cd /Users/4seven/workspace/lnkpi
git add apps/web/src/components/canvas/refine/RefineSidePanel.vue \
        apps/web/src/components/canvas/refine/RefineSidePanel.test.ts
git commit -m "refactor(refine): side panel becomes head + compare band + toolbox + dock"
```

---

### Task 9: 画布 chrome 让位 + 「← 返回画布」

**Files:**
- Create: `apps/web/src/utils/canvasChromeVisibility.ts`
- Create: `apps/web/src/utils/canvasChromeVisibility.test.ts`
- Create: `apps/web/src/components/canvas/RefineCanvasBack.vue`
- Create: `apps/web/src/components/canvas/RefineCanvasBack.test.ts`
- Modify: `apps/web/src/pages/CanvasPage.vue`

**Interfaces:**
- Consumes: `CanvasPage.vue` 既有的 `refinePanelNode`（`:760`）、`gridSlicePanelNode`、`closeRefineWorkbench`（`:2962`）、`canvasEditor.refineBusy`
- Produces:
  - `shouldHideCanvasChrome(input: { refineOpen: boolean; gridSliceOpen: boolean }): boolean`
  - `RefineCanvasBack` 组件，props `{ disabled?: boolean }`，emits `back: []`；`data-testid="refine-canvas-back"`

- [ ] **Step 1: 写失败测试**

创建 `apps/web/src/utils/canvasChromeVisibility.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { shouldHideCanvasChrome } from './canvasChromeVisibility'

describe('shouldHideCanvasChrome', () => {
  it('普通画布：chrome 全部显示', () => {
    expect(shouldHideCanvasChrome({ refineOpen: false, gridSliceOpen: false })).toBe(false)
  })

  it('精修工作台打开：画布级 chrome 全部让位', () => {
    expect(shouldHideCanvasChrome({ refineOpen: true, gridSliceOpen: false })).toBe(true)
  })

  it('宫格切分工作台打开：同样让位', () => {
    expect(shouldHideCanvasChrome({ refineOpen: false, gridSliceOpen: true })).toBe(true)
  })

  it('两个都开（不应发生）也仍然让位', () => {
    expect(shouldHideCanvasChrome({ refineOpen: true, gridSliceOpen: true })).toBe(true)
  })
})
```

创建 `apps/web/src/components/canvas/RefineCanvasBack.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RefineCanvasBack from './RefineCanvasBack.vue'

describe('RefineCanvasBack', () => {
  it('文案是「返回画布」，是精修模式下唯一保留的画布级控件', () => {
    const w = mount(RefineCanvasBack)
    expect(w.find('[data-testid="refine-canvas-back"]').exists()).toBe(true)
    expect(w.text()).toContain('返回画布')
  })

  it('可点时 emit back', async () => {
    const w = mount(RefineCanvasBack)
    await w.find('[data-testid="refine-canvas-back"]').trigger('click')
    expect(w.emitted('back')).toHaveLength(1)
  })

  it('disabled 时按钮禁用且不 emit（防误杀正在跑的生成）', async () => {
    const w = mount(RefineCanvasBack, { props: { disabled: true } })
    const btn = w.find('[data-testid="refine-canvas-back"]')
    expect(btn.attributes('disabled')).toBeDefined()
    await btn.trigger('click')
    expect(w.emitted('back')).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm --filter @lnkpi/web exec vitest run src/utils/canvasChromeVisibility.test.ts src/components/canvas/RefineCanvasBack.test.ts
```

Expected: FAIL —— 两个模块都 `Failed to resolve import`。

- [ ] **Step 3: 实现纯函数与组件**

创建 `apps/web/src/utils/canvasChromeVisibility.ts`：

```ts
/**
 * 画布级 chrome（画布名区、左 dock、右上工具条）在「单图工作台」打开时应全部让位。
 * 抽成纯函数是为了让三处挂载点共用同一个判据，避免以后新增 chrome 又漏一个。
 */
export function shouldHideCanvasChrome(input: {
  refineOpen: boolean
  gridSliceOpen: boolean
}): boolean {
  return input.refineOpen || input.gridSliceOpen
}
```

创建 `apps/web/src/components/canvas/RefineCanvasBack.vue`：

```vue
<script setup lang="ts">
defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{ back: [] }>()

function onClick() {
  emit('back')
}
</script>

<template>
  <!-- 精修模式下唯一保留的画布级控件（spec P0-13）。纯退出，生成中置灰（P0-14）。 -->
  <button
    type="button"
    class="neo-chrome pointer-events-auto flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs transition"
    data-testid="refine-canvas-back"
    title="返回画布"
    :disabled="disabled"
    @click="onClick"
  >
    <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
    </svg>
    <span>返回画布</span>
  </button>
</template>

<style scoped>
button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
```

> 注意：`disabled` 的原生行为会吞掉 `click` 事件，所以测试里 `emitted('back')` 为 `undefined` 是**正确**语义，不要为了让它 emit 而改成 `aria-disabled`。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm --filter @lnkpi/web exec vitest run src/utils/canvasChromeVisibility.test.ts src/components/canvas/RefineCanvasBack.test.ts
```

Expected: PASS（4 + 3 = 7 个用例）。

- [ ] **Step 5: 接进 `CanvasPage.vue`**

(a) import 区加：

```ts
import RefineCanvasBack from '@/components/canvas/RefineCanvasBack.vue'
import { shouldHideCanvasChrome } from '@/utils/canvasChromeVisibility'
```

(b) 在 `refinePanelNode` 定义（约 `:760`）**之后**加 computed：

```ts
/** 精修 / 宫格切分工作台打开时，画布级 chrome 全部让位（spec §7） */
const canvasChromeHidden = computed(() =>
  shouldHideCanvasChrome({
    refineOpen: !!refinePanelNode.value,
    gridSliceOpen: !!gridSlicePanelNode.value,
  }),
)
```

(c) 把现有标签加上 `v-if`（**保持各自的既有 props 与事件一字不动**）：

```vue
<CanvasFloatingChrome
  v-if="!canvasChromeHidden"
  :title="sessionTitle"
  ... 现有 props 与事件 ... />

<NodePanelDock
  v-if="!canvasChromeHidden"
  ... 现有事件 ... />

<div v-if="!canvasChromeHidden" class="pointer-events-none absolute right-3 top-3 z-[50] flex items-center gap-2">
  ... 现有四个标签 ... </div>
```

(d) 在 `CanvasFloatingChrome` 那一行**之后**插入返回按钮（复用同一个 `left-3 top-3` 位置，因为 chrome 被隐藏了不会打架）：

```vue
<RefineCanvasBack
  v-if="refinePanelNode"
  class="absolute left-3 top-3 z-[50]"
  :disabled="canvasEditor.refineBusy"
  @back="closeRefineWorkbench"
/>
```

> 注意：`RefineCanvasBack` 的根元素是两个 `class` 合并（`neo-chrome ...` + 父级传入的 `absolute left-3 top-3 z-[50]`）。若位置不生效，把 `absolute left-3 top-3 z-[50]` 直接写进组件模板的 class 列表并去掉父级传入的 class。

- [ ] **Step 6: 全量 web 测试 + 类型检查 + 构建**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm --filter @lnkpi/web exec vitest run
pnpm --filter @lnkpi/web exec vue-tsc -b
pnpm --filter @lnkpi/web exec vite build
```

Expected: 测试全绿、类型零错误、构建成功。

- [ ] **Step 7: 提交**

```bash
cd /Users/4seven/workspace/lnkpi
git add apps/web/src/utils/canvasChromeVisibility.ts \
        apps/web/src/utils/canvasChromeVisibility.test.ts \
        apps/web/src/components/canvas/RefineCanvasBack.vue \
        apps/web/src/components/canvas/RefineCanvasBack.test.ts \
        apps/web/src/pages/CanvasPage.vue
git commit -m "feat(refine): hide canvas chrome in refine mode, add back-to-canvas control"
```

---

### Task 10: 整包验证与 PR

**Files:**
- 不新增源码；只跑验证、写 PR 描述

**Interfaces:**
- Consumes: Task 1-9 全部产出
- Produces: 一个 CI 全绿的 PR

- [ ] **Step 1: 跑本仓四条本地验证**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm install --frozen-lockfile
pnpm --filter @lnkpi/server exec prisma generate
pnpm build
pnpm --filter @lnkpi/agent test
```

Expected: 四条全过。`pnpm build` 之后 `apps/web/vite.config.js` 会变脏 —— **不要提交它**。

- [ ] **Step 2: 跑全量 web 测试并记录数字**

```bash
cd /Users/4seven/workspace/lnkpi
pnpm --filter @lnkpi/web test 2>&1 | tail -20
```

Expected: 通过数 ≥ 754 + 本包新增。把「754 → N」写进 PR。

- [ ] **Step 3: 逐条走 spec §10.3 的目视验收清单（10 条）**

本地起 dev server：

```bash
cd /Users/4seven/workspace/lnkpi
pnpm dev:web
```

逐条对照 `docs/superpowers/specs/2026-09-21-refine-studio-layout-rework-design.md` §10.3，把每条的实际结果写进 PR 的 Test plan（对/不对/为何）。**任何一条不通过都不要开 PR，先修。**

- [ ] **Step 4: 检查提交历史干净**

```bash
cd /Users/4seven/workspace/lnkpi
git status --short
git log --oneline origin/main..HEAD
```

Expected: `git log` 只有本包的提交；`git status` 里**不应出现**本包改动的文件（品牌改动仍在，属正常）。若 `apps/web/vite.config.js` 出现在待提交里，`git checkout -- apps/web/vite.config.js` 把它还原。

- [ ] **Step 5: push 并开 PR**

```bash
cd /Users/4seven/workspace/lnkpi
git push -u origin feature/refine-studio-layout-rework
gh pr create --base main --title "refactor(refine): 精修工作室布局重组（右栏三段式 + 画布左栏工具条 + chrome 让位）" --body "$(cat <<'EOF'
## Summary

按 `docs/superpowers/specs/2026-09-21-refine-studio-layout-rework-design.md`（钉死版）实现精修工作室布局重组。纯 `apps/web`，无后端契约变更。

- **画布接管操作与视图**：新增左缘竖排工具条（输入组 `智能选择`/`框选`/`涂抹` + 查看组 `对照`/`适配`），右栏原三排图标工具条整组下线。工具参数（粗细/颜色、容差）迁到画布顶部模式条。
- **右栏三段式**：固定对照预览（≈146px，不随工具箱滚动）+ 唯一滚动的工具箱（快速预设 / 版本历史）+ 常驻 dock。
- **对照区精简**：删左右/滑竿两枚模式按钮与放大镜及其子控件，只留 `⛶ 最大化对照`；默认态即唯一态（左右对照）。
- **精修模式 chrome 让位**：画布名区（含保存/分镜板/发布作品）、左 dock 整条、右上工具条三块全部隐藏，原位补一枚「← 返回画布」（生成中置灰）。
- **dock 与图片节点 dock 同构**：header（类型图标 + 精修 + 编辑意图 + 关闭）→ 参考条 → 提示词区 → 底排动作。

### 一处对规格的如实偏离（已在 spec §6.1 记录）

`POST /studio/image/edit` 只接受 `prompt / imageUrl / maskUrl`，**不接受模型、尺寸与参考图**。所以 dock 里的「模型 / 尺寸」做成**只读状态位**、参考条只展示原图 chip 且不给 `+` 上传按钮 —— 不做点了没用的控件。要变成可操作控件需要独立的「精修通道参数化」包（后端 DTO + provider 透传 + 积分）。

## Test plan

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm --filter @lnkpi/server exec prisma generate`
- [ ] `pnpm build`
- [ ] `pnpm --filter @lnkpi/agent test`
- [ ] `pnpm --filter @lnkpi/web test`（754 → N，全绿）
- [ ] `pnpm --filter @lnkpi/web exec vue-tsc -b` 零错误
- [ ] spec §10.3 目视验收 10 条（逐条结果见下方评论）
EOF
)"
```

- [ ] **Step 6: 盯 CI 直到全绿，然后 Squash Merge**

```bash
cd /Users/4seven/workspace/lnkpi
gh pr checks --watch
gh pr merge --squash --delete-branch
```

CI 若红，修完再推；**不要为了过 CI 关掉任何检查**。合并后确认 `deploy.yml`（CVM）与 Vercel 均 success。

---

## Self-Review

**1. Spec coverage**

| Spec 条目 | 落点 |
|---|---|
| P0-1 右栏三段式 | Task 5 / 6 / 7 / 8 |
| P0-2 画布接管操作与视图 | Task 2 / 4 |
| P0-3 左栏输入 3 + 查看 2 | Task 1（模型）+ Task 2 |
| P0-4「对照」二级菜单、左右为默认、无版本置灰 | Task 2 |
| P0-5 细节放大 / 放大镜 UI 下线、底层保留 | Task 2（左栏无该项）+ Task 5（右栏删除）+ Constraint |
| P0-6 对照区不做模式切换 | Task 5 |
| P0-7 对照预览固定不滚 | Task 8（断言在 body 之外） |
| P0-8 dock 同构 | Task 7 |
| P0-9 工具参数进模式条 | Task 3 + Task 4 |
| P0-10/11/12 chrome 三块隐藏 | Task 9 |
| P0-13 返回画布 | Task 9 |
| P0-14 两个出口分工 | Task 9（disabled）+ Task 8（头部保留） |
| P0-15「编辑意图」沿用 | Task 7 |
| P1-1 3 组子菜单容纳 6 工具 | Task 1（覆盖性断言）+ Task 2 |
| P1-2 反选 / 清除选区归组 | Task 1 + Task 2 |
| P1-3「适配」二级菜单含 1:1 | Task 1 + Task 2 + Task 4 |
| P1-4 模式条参数矩阵 | Task 1 + Task 3 |
| P1-5 对照模式条文案 | Task 1 + Task 3 |
| P1-6 Esc 分级 | 既有 `RefineWorkbench.onClose`（已在 M1 实现）—— Task 8 不破坏它 |
| P1-7 compareMode/wipeRatio 进 store | Task 1 + Task 5 |
| P1-8 工具箱两组、不造假组标题 | Task 6 |
| P1-9 dock 模型/尺寸/附件只读 | Task 7 |
| P1-10 右栏 `⛶` 沿用当前 compareMode | Task 5（`CompareView` 固定 split，全屏由 `CompareLightbox` 用 store 的 mode） |
| §6.2 600px 覆写 | Task 7 |
| §7 裁决表 | Task 9 |
| §10 验收 | Task 10 |

无遗漏。**§2.2 的四项明确不做**（扩图 / 放大 2X 下线 / 抠图裁剪 / 批量确认），不在本计划里。

**2. Placeholder scan**：无「TBD / 稍后补 / 类似 Task N / 加适当的错误处理」。每个代码步骤都给了可直接落盘的完整实现。

**3. Type consistency**：`RefineMaskTool` 六值在 Task 1 的 `Record<RefineMaskTool, ...>` 三张表里各出现一次；`RefineInputGroupId` 三值在 `GLYPH`（Task 2）与 `GROUP_OF_TOOL`（Task 1）一致；事件名在组件声明处用 camelCase（`actualSize` / `selectVersion` / `selectEditIntent`），模板里写 kebab（`@actual-size` / `@select-version` / `@select-edit-intent`），测试断言用 camelCase（`emitted('actualSize')`）—— 三处已逐一核对。

**4. Review Focus**：5 条全部有对应测试 —— ①Task 1 覆盖性断言 + Task 2 三点可点；②Task 9 `canvasChromeVisibility` 4 例；③Task 8「对照带在 body 之外 + 只有一个滚动区」；④Task 9 `disabled` 不 emit；⑤Task 7 Step 5 的 `min-width: 0` 落盘核对。

