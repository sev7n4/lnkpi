# 精修「选区」统一 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按规格把精修左栏「选区」收敛为一个模式入口（三合一），工具/参数/命令全部迁入右栏面板，顶部模式条退役，补椭圆工具与作用于全部工具的加/减选开关。

**Architecture:** store（canvasEditor）仍是唯一真源；新增纯函数模型层 `refineSelectionModel.ts` 承载工具分组/规格/Esc 提示/op 联动；`RefineSelectionPanel.vue` 直接读写 store（不发 emit）；`RefineToolRail` 只剩三枚模式入口 + 查看/能力区；MaskEditor 补椭圆绘制并让形状尊重 `maskOp`。

**Tech Stack:** Vue 3 `<script setup>` + TS + Pinia + Vitest（jsdom）+ pnpm workspaces。

**Spec:** `docs/superpowers/specs/2026-09-23-refine-selection-unified-design.md`（先读规格再动手；图 1–6 与 §4 判据、§5 契约、§8 纯函数表是本计划的直接依据）

## Global Constraints

- 禁止直接 push main：本分支 `feature/refine-selection-unified`，完成后 PR + CI 全绿 + squash merge。
- 工作目录：worktree `/Users/4seven/workspace/lnkpi-worktrees/wb-select-impl`（分支已基于 main `5e5a0c93`）。
- **回归测试必须先红**：规格 §8 列出 3 条；本计划在对应任务里先让新断言在旧实现上失败（或用 `git show origin/main:<file>` 还原旧实现验证），再实现变绿。没有红过的回归测试不算完成。
- web 的 vitest 命令：`pnpm --filter @lnkpi/web exec vitest run <file>`；**不要与 server 的 vitest 并行跑**（资源竞争假失败）。
- 跑构建验证：`pnpm --filter @lnkpi/web build`（= `vue-tsc -b && vite build`）；注意它会重新生成 `apps/web/vite.config.js`（已跟踪的产物），提交前 `git checkout -- apps/web/vite.config.js` 还原，不要把它带进 commit。
- 测试运行环境是 jsdom：`clientWidth` 恒 0、无真实布局——椭圆绘制效果与面板布局的最终验收必须走真实浏览器（Task 9），组件单测只保证状态接线。
- `RefineMaskTool` 加 `'ellipse'` 后，store 与 MaskEditor **两处**联合类型都要加（MaskEditor.vue:9 有一份独立声明的 `MaskTool`），规格 §5.5 明确。
- 删除 `toggleRefineMode` 前先全仓 grep 确认无其他消费者（Task 1 里有该步骤，命中即停并回报）。
- 所有新文案使用简体中文，风格与现有 rail/面板一致（`：`/`·` 分隔，句末无句号）。

## Review Focus

1. **矩形在减选态下保持减选**（规格 §7.2 根因）：用户把开关拨到「减选」再点矩形，画出的矩形必须从选区里挖洞——旧实现会把它强行翻回加选。→ Task 1 Step 1 回归测试钉死（store 层）+ Task 4 纯函数钉死（绘制层）。
2. **形状绘制在减选态必须用 `destination-out`**：只改 store 不改 canvas 合成模式等于没修。→ Task 3 `shapeStyleForOp` 纯函数 + Task 4 接线。
3. **Esc 在抠图模式下先回选区而不是直接关精修**（旧 `onClose` 漏了 matting）。→ Task 8 回归测试钉死。
4. **扩图 rect 与选区蒙版两条通道不得互相污染**（规格 §4.0 约束）：本计划不动 `outpaintRect` 链路；评审时确认没有任何新代码让选区面板读写 `refineOutpaintRect`，也没有让扩图读写 `refineMaskOp`。
5. **画笔/橡皮的快捷形态语义**：点画笔→加选、点橡皮→减选，但这是「快捷方式」不是「绑定」——用户手动拨开关后，画笔要能以减选执行（MaskEditor `applyToolStyle` 以 `maskOp` 为准），不要在新面板里把开关写死成只读。

---

### Task 1: 模型层 `refineSelectionModel.ts` + store 类型扩展与 op 联动（回归先红 ①）

**Files:**
- Create: `apps/web/src/components/canvas/refine/refineSelectionModel.ts`
- Test: `apps/web/src/components/canvas/refine/refineSelectionModel.test.ts`
- Modify: `apps/web/src/stores/canvasEditor.ts:16`（类型）、`:174-178`（setRefineTool）、`:191-194`（删 toggleRefineMode）、`:323`（return 列表删 toggleRefineMode）
- Modify: `apps/web/src/stores/canvasEditor.refine.test.ts:121-137`（rect 断言改为保持原值）

**Interfaces:**
- Consumes: `RefineMaskOp / RefineMaskTool / RefineMode`（stores/canvasEditor，本任务给 `RefineMaskTool` 加 `'ellipse'`）
- Produces（后续任务依赖，签名逐字使用）:
  - `type RefineToolParamKind = 'brush' | 'wand' | 'none'`
  - `interface RefineToolSpec { tool: RefineMaskTool; label: string; icon: string[]; param: RefineToolParamKind; hint: string }`
  - `interface RefineSelectionGroup { id: 'smart' | 'shape' | 'paint'; label: string; tools: RefineMaskTool[] }`
  - `REFINE_SELECTION_GROUPS: RefineSelectionGroup[]`（smart: point/wand；shape: rect/ellipse/polygon；paint: brush/eraser）
  - `REFINE_TOOL_SPECS: Record<RefineMaskTool, RefineToolSpec>`（7 键，含 ellipse）
  - `REFINE_SELECTION_COMMANDS: { id: 'invert' | 'clear'; label: string; hint: string }[]`
  - `REFINE_MASK_OP_OPTIONS: { op: RefineMaskOp; label: string; hint: string }[]`
  - `refineToolParamKind(tool: RefineMaskTool): RefineToolParamKind`
  - `refineSelectionOpAfterToolPick(tool: RefineMaskTool, current: RefineMaskOp): RefineMaskOp`
  - `refineSelectionEscHint(input: { refineMode: RefineMode; compareLightboxOpen: boolean }): string`

- [ ] **Step 1: 先改 store 回归测试（此刻必须红）**

在 `apps/web/src/stores/canvasEditor.refine.test.ts` 找到 `it('tracks refineMaskOp from eraser/brush and keeps it when switching to wand/polygon', ...)`（约 :121-137），整块替换为：

```ts
  it('tracks refineMaskOp from eraser/brush and keeps it for wand/polygon/rect/point', () => {
    const editor = useCanvasEditorStore()
    expect(editor.refineMaskOp).toBe('add')
    editor.setRefineTool('eraser')
    expect(editor.refineMaskOp).toBe('subtract')
    editor.setRefineTool('wand')
    expect(editor.refineMaskOp).toBe('subtract')
    editor.setRefineTool('polygon')
    expect(editor.refineMaskOp).toBe('subtract')
    editor.setRefineTool('brush')
    expect(editor.refineMaskOp).toBe('add')
    // 规格修订：rect 不再硬编码 add——保持当前开关值
    editor.setRefineTool('rect')
    expect(editor.refineMaskOp).toBe('add')
    editor.setRefineTool('eraser')
    editor.setRefineTool('rect')
    expect(editor.refineMaskOp).toBe('subtract') // 回归先红 ①：旧实现会把这里翻回 'add'
  })
```

- [ ] **Step 2: 跑它，确认在旧实现上失败**

Run: `pnpm --filter @lnkpi/web exec vitest run src/stores/canvasEditor.refine.test.ts`
Expected: FAIL，失败点是 `expect(editor.refineMaskOp).toBe('subtract')` 实际为 `'add'`。**必须看到这个红**；若误绿，停下来查是否改错了用例。

- [ ] **Step 3: 写模型层测试（此刻红：模块不存在）**

创建 `apps/web/src/components/canvas/refine/refineSelectionModel.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  REFINE_MASK_OP_OPTIONS,
  REFINE_SELECTION_COMMANDS,
  REFINE_SELECTION_GROUPS,
  REFINE_TOOL_SPECS,
  refineSelectionEscHint,
  refineSelectionOpAfterToolPick,
  refineToolParamKind,
} from './refineSelectionModel'
import type { RefineMaskTool } from '@/stores/canvasEditor'

const ALL_TOOLS: RefineMaskTool[] = ['point', 'wand', 'rect', 'ellipse', 'polygon', 'brush', 'eraser']

describe('refineSelectionModel', () => {
  it('三组共 7 枚工具，恰好覆盖 RefineMaskTool 全集且不重复', () => {
    const tools = REFINE_SELECTION_GROUPS.flatMap((g) => g.tools)
    expect(tools).toHaveLength(7)
    expect([...tools].sort()).toEqual([...ALL_TOOLS].sort())
    expect(REFINE_SELECTION_GROUPS.map((g) => g.id)).toEqual(['smart', 'shape', 'paint'])
  })

  it('REFINE_TOOL_SPECS 覆盖全部 7 枚，椭圆是本期新增', () => {
    for (const tool of ALL_TOOLS) {
      expect(REFINE_TOOL_SPECS[tool].tool).toBe(tool)
      expect(REFINE_TOOL_SPECS[tool].hint.length).toBeGreaterThan(0) // 每枚工具恒有一行用法提示
    }
    expect(REFINE_TOOL_SPECS.ellipse.label).toBe('椭圆')
    expect(REFINE_TOOL_SPECS.ellipse.param).toBe('none')
  })

  it('refineToolParamKind：brush/eraser→brush、wand→wand、其余→none', () => {
    expect(refineToolParamKind('brush')).toBe('brush')
    expect(refineToolParamKind('eraser')).toBe('brush')
    expect(refineToolParamKind('wand')).toBe('wand')
    expect(refineToolParamKind('rect')).toBe('none')
    expect(refineToolParamKind('ellipse')).toBe('none')
    expect(refineToolParamKind('point')).toBe('none')
    expect(refineToolParamKind('polygon')).toBe('none')
  })

  it('refineSelectionOpAfterToolPick：brush→add、eraser→subtract、其余 5 项原值返回（回归：rect 传 subtract 保持 subtract）', () => {
    expect(refineSelectionOpAfterToolPick('brush', 'subtract')).toBe('add')
    expect(refineSelectionOpAfterToolPick('eraser', 'add')).toBe('subtract')
    expect(refineSelectionOpAfterToolPick('rect', 'subtract')).toBe('subtract')
    expect(refineSelectionOpAfterToolPick('ellipse', 'subtract')).toBe('subtract')
    expect(refineSelectionOpAfterToolPick('polygon', 'subtract')).toBe('subtract')
    expect(refineSelectionOpAfterToolPick('wand', 'add')).toBe('add')
    expect(refineSelectionOpAfterToolPick('point', 'add')).toBe('add')
  })

  it('选区命令与选择方式选项的声明式数据', () => {
    expect(REFINE_SELECTION_COMMANDS.map((c) => c.id)).toEqual(['invert', 'clear'])
    expect(REFINE_MASK_OP_OPTIONS.map((o) => o.op)).toEqual(['add', 'subtract'])
  })

  it('refineSelectionEscHint：模式优先于对照，三态一一对应', () => {
    expect(refineSelectionEscHint({ refineMode: 'outpaint', compareLightboxOpen: false })).toBe('Esc · 回到选区')
    expect(refineSelectionEscHint({ refineMode: 'matting', compareLightboxOpen: false })).toBe('Esc · 回到选区')
    // 模式优先：扩图/抠图下即使对照开着也先回选区
    expect(refineSelectionEscHint({ refineMode: 'outpaint', compareLightboxOpen: true })).toBe('Esc · 回到选区')
    expect(refineSelectionEscHint({ refineMode: 'select', compareLightboxOpen: true })).toBe('Esc · 回到工作图')
    expect(refineSelectionEscHint({ refineMode: 'select', compareLightboxOpen: false })).toBe('Esc · 关闭精修')
  })
})
```

- [ ] **Step 4: 跑模型测试确认红**

Run: `pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/refineSelectionModel.test.ts`
Expected: FAIL（`Cannot find module './refineSelectionModel'`）。

- [ ] **Step 5: 实现 `refineSelectionModel.ts`**

创建 `apps/web/src/components/canvas/refine/refineSelectionModel.ts`：

```ts
import type { RefineMaskOp, RefineMaskTool, RefineMode } from '@/stores/canvasEditor'

/** 参数区渲染哪种控件：'brush' 粗细+颜色 / 'wand' 容差 / 'none' 只显示提示行（spec §5.1） */
export type RefineToolParamKind = 'brush' | 'wand' | 'none'

export interface RefineToolSpec {
  tool: RefineMaskTool
  label: string
  /** SVG path d 数组，与 rail 现状同款渲染 */
  icon: string[]
  param: RefineToolParamKind
  /** 参数区常驻的一行用法说明（每枚工具恒有） */
  hint: string
}

export interface RefineSelectionGroup {
  id: 'smart' | 'shape' | 'paint'
  label: string
  tools: RefineMaskTool[]
}

/** 右栏面板「工具」分区的三组 7 枚（spec 图 6 ②） */
export const REFINE_SELECTION_GROUPS: RefineSelectionGroup[] = [
  { id: 'smart', label: '智能选择', tools: ['point', 'wand'] },
  { id: 'shape', label: '形状', tools: ['rect', 'ellipse', 'polygon'] },
  { id: 'paint', label: '涂抹', tools: ['brush', 'eraser'] },
]

const BRUSH_ICON = ['M5 19.5l3.8-.7L19.2 8.4a1.7 1.7 0 0 0 0-2.4l-1.2-1.2a1.7 1.7 0 0 0-2.4 0L5.7 15.2z', 'M14.8 6.6l2.6 2.6']
const ERASER_ICON = ['M5 15.2l7.4-7.4a1.6 1.6 0 0 1 2.3 0l3.9 3.9a1.6 1.6 0 0 1 0 2.3L13.5 19H8.6z', 'M5 19.5h14.5']

export const REFINE_TOOL_SPECS: Record<RefineMaskTool, RefineToolSpec> = {
  point: { tool: 'point', label: '点选主体', icon: ['M12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z', 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z'], param: 'none', hint: '点击图中的主体，自动圈出同类区域' },
  wand: { tool: 'wand', label: '魔棒', icon: ['M6 18.5 17 7.5', 'M15.5 4.5l4 4', 'M5 15.5l3.5 3.5', 'M17.5 6.5l1 1'], param: 'wand', hint: '点击一块颜色相近的区域，容差越大圈得越多' },
  rect: { tool: 'rect', label: '矩形', icon: ['M4 5.5h16v13H4z'], param: 'none', hint: '拖拽画出矩形选区' },
  ellipse: { tool: 'ellipse', label: '椭圆', icon: ['M4.5 12a7.5 6.5 0 1 0 15 0a7.5 6.5 0 1 0 -15 0z'], param: 'none', hint: '拖拽画出椭圆选区，按住 Shift 锁正圆' },
  polygon: { tool: 'polygon', label: '多边形', icon: ['M12 3.5l8.5 6.2-3.2 10H6.7L3.5 9.7z'], param: 'none', hint: '单击落点，双击或点回起点闭合' },
  brush: { tool: 'brush', label: '画笔', icon: BRUSH_ICON, param: 'brush', hint: '按住拖动涂抹选区' },
  eraser: { tool: 'eraser', label: '橡皮', icon: ERASER_ICON, param: 'brush', hint: '按住拖动擦除选区' },
}

export const REFINE_SELECTION_COMMANDS: { id: 'invert' | 'clear'; label: string; hint: string }[] = [
  { id: 'invert', label: '反选', hint: '选中区与未选中区互换' },
  { id: 'clear', label: '清除选区', hint: '清空当前蒙版' },
]

export const REFINE_MASK_OP_OPTIONS: { op: RefineMaskOp; label: string; hint: string }[] = [
  { op: 'add', label: '加选', hint: '把画出的区域并入选区' },
  { op: 'subtract', label: '减选', hint: '从选区里挖掉画出的区域' },
]

export function refineToolParamKind(tool: RefineMaskTool): RefineToolParamKind {
  return REFINE_TOOL_SPECS[tool].param
}

/** 工具与「选择方式」的联动判据（spec §4.3）：画笔/橡皮是加/减选的快捷形态，其余工具不动开关。 */
export function refineSelectionOpAfterToolPick(tool: RefineMaskTool, current: RefineMaskOp): RefineMaskOp {
  if (tool === 'brush') return 'add'
  if (tool === 'eraser') return 'subtract'
  return current
}

/** 固定页脚 Esc 三态文案（spec 图 3 下半段），模式优先于全屏对照。 */
export function refineSelectionEscHint(input: { refineMode: RefineMode; compareLightboxOpen: boolean }): string {
  if (input.refineMode !== 'select') return 'Esc · 回到选区'
  if (input.compareLightboxOpen) return 'Esc · 回到工作图'
  return 'Esc · 关闭精修'
}
```

- [ ] **Step 6: 改 store：类型 + setRefineTool + 删 toggleRefineMode**

`apps/web/src/stores/canvasEditor.ts` 三处：

```ts
// :16
export type RefineMaskTool = 'brush' | 'eraser' | 'rect' | 'wand' | 'polygon' | 'point' | 'ellipse'
```

```ts
// :174-178 整块替换（顶部补 import：import { refineSelectionOpAfterToolPick } from '@/components/canvas/refine/refineSelectionModel'）
  function setRefineTool(tool: RefineMaskTool) {
    refineTool.value = tool
    refineMaskOp.value = refineSelectionOpAfterToolPick(tool, refineMaskOp.value)
  }
```

```ts
// :191-194 整块删除（先全仓确认无其他消费者）
//   /** 在 select / outpaint 之间切换（rail 扩图按钮用）。 */
//   function toggleRefineMode() { ... }
```

同时在文件底部 return 对象里删掉 `toggleRefineMode,` 一行。

删除前执行（zsh 下反引号会炸，用 python）：

```bash
python3 -c "import subprocess; out = subprocess.run(['rg', '-n', 'toggleRefineMode', 'apps/web/src', 'packages'], capture_output=True, text=True).stdout; print(out)"
```

Expected: 仅 `stores/canvasEditor.ts` 与 `components/canvas/refine/RefineToolRail.vue`（Task 6 会改掉后者）。**若出现第三处消费者，停下来回报，不得硬删。**

- [ ] **Step 7: 跑 store + 模型测试确认全绿**

Run: `pnpm --filter @lnkpi/web exec vitest run src/stores/canvasEditor.refine.test.ts src/components/canvas/refine/refineSelectionModel.test.ts`
Expected: PASS（Step 1 的回归断言转绿）。

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/canvas/refine/refineSelectionModel.ts apps/web/src/components/canvas/refine/refineSelectionModel.test.ts apps/web/src/stores/canvasEditor.ts apps/web/src/stores/canvasEditor.refine.test.ts
git commit -m "feat(refine): 选区模型层 + store 补椭圆与 op 联动（rect 不再硬编码加选）"
```

---

### Task 2: `maskEllipse.ts` 椭圆几何纯函数

**Files:**
- Create: `apps/web/src/components/canvas/refine/maskEllipse.ts`
- Test: `apps/web/src/components/canvas/refine/maskEllipse.test.ts`

**Interfaces:**
- Produces: `ellipseFromDrag(input: { start: {x,y}; end: {x,y}; shiftKey?: boolean }): { cx: number; cy: number; rx: number; ry: number }`（Task 4 的 MaskEditor 消费）

- [ ] **Step 1: 写失败测试**

创建 `maskEllipse.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { ellipseFromDrag } from './maskEllipse'

describe('ellipseFromDrag', () => {
  it('中心为两点中点，半径为两点差绝对值的一半', () => {
    expect(ellipseFromDrag({ start: { x: 0, y: 0 }, end: { x: 10, y: 6 }, shiftKey: false }))
      .toEqual({ cx: 5, cy: 3, rx: 5, ry: 3 })
  })

  it('反向拖拽归一化为正值', () => {
    expect(ellipseFromDrag({ start: { x: 10, y: 6 }, end: { x: 0, y: 0 }, shiftKey: false }))
      .toEqual({ cx: 5, cy: 3, rx: 5, ry: 3 })
  })

  it('起点等于终点时半径为 0（与矩形同款 no-op 语义）', () => {
    expect(ellipseFromDrag({ start: { x: 4, y: 4 }, end: { x: 4, y: 4 }, shiftKey: false }))
      .toEqual({ cx: 4, cy: 4, rx: 0, ry: 0 })
  })

  it('shiftKey 锁正圆：rx = ry = max(rx, ry)', () => {
    expect(ellipseFromDrag({ start: { x: 0, y: 0 }, end: { x: 10, y: 4 }, shiftKey: true }))
      .toEqual({ cx: 5, cy: 2, rx: 5, ry: 5 })
  })
})
```

- [ ] **Step 2: 跑确认红**

Run: `pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/maskEllipse.test.ts`
Expected: FAIL（module not found）。

- [ ] **Step 3: 实现**

创建 `maskEllipse.ts`：

```ts
/** 拖拽椭圆的几何计算（spec §8）：中心=两点中点，半径=两点差绝对值的一半；Shift 锁正圆。 */
export interface EllipseDragInput {
  start: { x: number; y: number }
  end: { x: number; y: number }
  shiftKey?: boolean
}

export interface EllipseShape {
  cx: number
  cy: number
  rx: number
  ry: number
}

export function ellipseFromDrag(input: EllipseDragInput): EllipseShape {
  const cx = (input.start.x + input.end.x) / 2
  const cy = (input.start.y + input.end.y) / 2
  const rx = Math.abs(input.end.x - input.start.x) / 2
  const ry = Math.abs(input.end.y - input.start.y) / 2
  if (input.shiftKey) {
    const r = Math.max(rx, ry)
    return { cx, cy, rx: r, ry: r }
  }
  return { cx, cy, rx, ry }
}
```

- [ ] **Step 4: 跑确认绿**

Run: `pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/maskEllipse.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/canvas/refine/maskEllipse.ts apps/web/src/components/canvas/refine/maskEllipse.test.ts
git commit -m "feat(refine): 椭圆拖拽几何纯函数 ellipseFromDrag（Shift 锁正圆）"
```

---

### Task 3: `maskShape.ts` 形状绘制样式分支（回归先红 ② 的纯函数层）

**Files:**
- Create: `apps/web/src/components/canvas/refine/maskShape.ts`
- Test: `apps/web/src/components/canvas/refine/maskShape.test.ts`

**Interfaces:**
- Produces: `shapeStyleForOp(op: 'add' | 'subtract', color: string): { composite: GlobalCompositeOperation; fill: string; stroke: string }`（Task 4 消费）

- [ ] **Step 1: 旧实现的事实证据（回归先红 ② 的「红」）**

旧实现里形状分支**没有函数**、内联硬编码在 MaskEditor（`ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = props.color`，MaskEditor.vue:358-359）。跑：

```bash
git show origin/main:apps/web/src/components/canvas/refine/MaskEditor.vue | sed -n '355,364p'
```

Expected: 输出确认旧形状分支无视 `maskOp`、恒 `source-over`。把这段输出记入 commit message 之外的本任务记录（测试文件顶部注释）。

- [ ] **Step 2: 写失败测试**

创建 `maskShape.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { shapeStyleForOp } from './maskShape'

describe('shapeStyleForOp（回归先红 ②：旧实现形状分支恒 source-over，无视 maskOp）', () => {
  it('add：source-over + 选区色', () => {
    expect(shapeStyleForOp('add', '#22d3ee')).toEqual({
      composite: 'source-over',
      fill: '#22d3ee',
      stroke: '#22d3ee',
    })
  })

  it('subtract：destination-out + 不透明黑（挖洞）', () => {
    expect(shapeStyleForOp('subtract', '#22d3ee')).toEqual({
      composite: 'destination-out',
      fill: 'rgba(0,0,0,1)',
      stroke: 'rgba(0,0,0,1)',
    })
  })
})
```

- [ ] **Step 3: 跑确认红**

Run: `pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/maskShape.test.ts`
Expected: FAIL（module not found）。

- [ ] **Step 4: 实现**

创建 `maskShape.ts`：

```ts
/** 形状（矩形 / 椭圆）与画笔的绘制样式分支（spec §5.5）：subtract 挖洞用 destination-out + 不透明黑，add 用选区色。 */
export type MaskShapeOp = 'add' | 'subtract'

export interface MaskShapeStyle {
  composite: GlobalCompositeOperation
  fill: string
  stroke: string
}

export function shapeStyleForOp(op: MaskShapeOp, color: string): MaskShapeStyle {
  if (op === 'subtract') {
    return { composite: 'destination-out', fill: 'rgba(0,0,0,1)', stroke: 'rgba(0,0,0,1)' }
  }
  return { composite: 'source-over', fill: color, stroke: color }
}
```

- [ ] **Step 5: 跑确认绿**

Run: `pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/maskShape.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/canvas/refine/maskShape.ts apps/web/src/components/canvas/refine/maskShape.test.ts
git commit -m "feat(refine): 形状绘制样式纯函数 shapeStyleForOp（subtract 用 destination-out）"
```

---

### Task 4: MaskEditor 补椭圆绘制 + 形状/画笔尊重 maskOp

**Files:**
- Modify: `apps/web/src/components/canvas/refine/MaskEditor.vue`（:9 类型、:1-7 imports、:249-262 applyToolStyle、:322-327 onPointerDown、:355-364 onPointerMove）

**Interfaces:**
- Consumes: `ellipseFromDrag`（Task 2）、`shapeStyleForOp`（Task 3）、store 已有 `'ellipse'` 类型（Task 1）
- Produces: MaskEditor 新接受 `tool="ellipse"`（props 无变化，`tool` 类型放宽）；无新 emit/props。**不要**新增对 `refineOutpaintRect` 的任何读写（规格 §4.0 约束）。

- [ ] **Step 1: 类型与 import**

```ts
// :9
export type MaskTool = 'brush' | 'eraser' | 'rect' | 'ellipse' | 'wand' | 'polygon' | 'point'
```

import 区新增：

```ts
import { ellipseFromDrag } from './maskEllipse'
import { shapeStyleForOp } from './maskShape'
```

- [ ] **Step 2: applyToolStyle 让画笔尊重 maskOp（橡皮恒为挖洞快捷形态）**

```ts
function applyToolStyle(ctx: CanvasRenderingContext2D) {
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(1, props.brushSize)
  if (props.tool === 'eraser' || props.maskOp === 'subtract') {
    ctx.globalCompositeOperation = 'destination-out'
    ctx.strokeStyle = 'rgba(0,0,0,1)'
    ctx.fillStyle = 'rgba(0,0,0,1)'
  } else {
    ctx.globalCompositeOperation = 'source-over'
    ctx.strokeStyle = props.color
    ctx.fillStyle = props.color
  }
}
```

- [ ] **Step 3: onPointerDown 的矩形分支扩为 rect|ellipse**

把 `if (props.tool === 'rect') { ... }`（约 :322-327）替换为：

```ts
  if (props.tool === 'rect' || props.tool === 'ellipse') {
    pushMaskHistory(ctx)
    snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height)
    rectStart = pt
    return
  }
```

- [ ] **Step 4: onPointerMove 的形状分支：椭圆走 ellipseFromDrag + ctx.ellipse，样式走 shapeStyleForOp**

把 `if (props.tool === 'rect' && rectStart && snapshot) { ... }`（约 :355-364）替换为：

```ts
  if ((props.tool === 'rect' || props.tool === 'ellipse') && rectStart && snapshot) {
    ctx.putImageData(snapshot, 0, 0)
    const style = shapeStyleForOp(props.maskOp === 'subtract' ? 'subtract' : 'add', props.color)
    ctx.globalCompositeOperation = style.composite
    ctx.fillStyle = style.fill
    if (props.tool === 'rect') {
      const x = Math.min(rectStart.x, pt.x)
      const y = Math.min(rectStart.y, pt.y)
      ctx.fillRect(x, y, Math.abs(pt.x - rectStart.x), Math.abs(pt.y - rectStart.y))
    } else {
      const e = ellipseFromDrag({ start: rectStart, end: pt, shiftKey: event.shiftKey })
      ctx.beginPath()
      ctx.ellipse(e.cx, e.cy, e.rx, e.ry, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    return
  }
```

注意：`onPointerMove(event: PointerEvent)` 已持有原始事件，`event.shiftKey` 直接可用。

- [ ] **Step 5: 跑既有 refine 相关测试防回归（MaskEditor 无单测，靠周边绿）**

Run: `pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine src/stores/canvasEditor.refine.test.ts`
Expected: 全 PASS（此时 rail/viewport 旧测试仍引用旧结构，若 `RefineWorkViewport.test.ts` 因本任务无关原因挂掉，核对是否本任务引入；不是则留到 Task 7 处理）。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/canvas/refine/MaskEditor.vue
git commit -m "feat(refine): MaskEditor 支持椭圆拖拽绘制；形状与画笔尊重 maskOp（矩形可减选）"
```

---

### Task 5: `RefineSelectionPanel.vue`（重命名 + 重写）+ 注册表接线

**Files:**
- Rename+Rewrite: `apps/web/src/components/canvas/refine/RefineSelectPanel.vue` → `RefineSelectionPanel.vue`
- Create: `apps/web/src/components/canvas/refine/RefineSelectionPanel.test.ts`
- Modify: `apps/web/src/components/canvas/workbench/workbenchToolRegistry.ts:3,35`
- Modify: `apps/web/src/components/canvas/refine/RefineSidePanel.test.ts:103`（testid 改名）

**Interfaces:**
- Consumes: Task 1 的 `REFINE_SELECTION_GROUPS / REFINE_TOOL_SPECS / REFINE_SELECTION_COMMANDS / REFINE_MASK_OP_OPTIONS / refineToolParamKind`；store 的 `setRefineTool / getRefineMask / setRefineWandTolerance / refineMaskOp / refineBrushSize / refineBrushColor / refineWandTolerance / refineTool`
- Produces: 组件 `RefineSelectionPanel`，props `busy?: boolean`，**emits 无**；testid 契约（规格 §5.3 表）：`refine-selection-op-add / -subtract`、`refine-selection-tool-<tool>`（7 枚）、`refine-selection-param-brush / -wand / -none`、`refine-selection-param-hint`、`refine-selection-command-invert / -clear`

- [ ] **Step 1: git mv 保留历史**

```bash
git mv apps/web/src/components/canvas/refine/RefineSelectPanel.vue apps/web/src/components/canvas/refine/RefineSelectionPanel.vue
```

- [ ] **Step 2: 整文件重写 `RefineSelectionPanel.vue`**

```vue
<script setup lang="ts">
/**
 * 精修「选区」模式的右栏面板（spec 图 6）：① 选择方式 ② 工具（三组 7 枚）③ 参数 ④ 选区操作。
 * 不发 emit：全部直接读写 store（与 RefineToolRail 同范式，spec §5.2）。
 * 固定页脚（Esc 三态）在 RefineSidePanel，对全部模式生效，不在本组件。
 */
import { computed } from 'vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import type { RefineMaskTool } from '@/stores/canvasEditor'
import {
  REFINE_MASK_OP_OPTIONS,
  REFINE_SELECTION_COMMANDS,
  REFINE_SELECTION_GROUPS,
  REFINE_TOOL_SPECS,
  refineToolParamKind,
} from './refineSelectionModel'

withDefaults(defineProps<{ busy?: boolean }>(), { busy: false })

const editor = useCanvasEditorStore()
const paramKind = computed(() => refineToolParamKind(editor.refineTool))
const toolHint = computed(() => REFINE_TOOL_SPECS[editor.refineTool].hint)

function pickTool(tool: RefineMaskTool) {
  editor.setRefineTool(tool)
}
function runCommand(id: 'invert' | 'clear') {
  const mask = editor.getRefineMask()
  if (id === 'invert') mask?.invert()
  else mask?.clear()
}
function onBrushSize(e: Event) { editor.refineBrushSize = Number((e.target as HTMLInputElement).value) }
function onBrushColor(e: Event) { editor.refineBrushColor = (e.target as HTMLInputElement).value }
function onWandTolerance(e: Event) { editor.setRefineWandTolerance(Number((e.target as HTMLInputElement).value)) }
</script>

<template>
  <section class="refine-selection-panel" data-testid="refine-selection-panel">
    <div class="refine-selection-panel__group">
      <div class="refine-selection-panel__glabel">选择方式</div>
      <div class="refine-selection-panel__ops">
        <button
          v-for="opt in REFINE_MASK_OP_OPTIONS"
          :key="opt.op"
          type="button"
          class="refine-selection-panel__op"
          :class="{ 'is-on': editor.refineMaskOp === opt.op }"
          :data-testid="`refine-selection-op-${opt.op}`"
          :title="opt.hint"
          :aria-pressed="editor.refineMaskOp === opt.op"
          @click="editor.refineMaskOp = opt.op"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>

    <div v-for="group in REFINE_SELECTION_GROUPS" :key="group.id" class="refine-selection-panel__group">
      <div class="refine-selection-panel__glabel">{{ group.label }}</div>
      <div class="refine-selection-panel__tools">
        <button
          v-for="tool in group.tools"
          :key="tool"
          type="button"
          class="refine-selection-panel__tool"
          :class="{ 'is-on': editor.refineTool === tool }"
          :data-testid="`refine-selection-tool-${tool}`"
          :title="REFINE_TOOL_SPECS[tool].hint"
          :aria-label="REFINE_TOOL_SPECS[tool].label"
          :aria-pressed="editor.refineTool === tool"
          @click="pickTool(tool)"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path v-for="(d, i) in REFINE_TOOL_SPECS[tool].icon" :key="i" :d="d" />
          </svg>
          <span>{{ REFINE_TOOL_SPECS[tool].label }}</span>
        </button>
      </div>
    </div>

    <div class="refine-selection-panel__group">
      <div class="refine-selection-panel__glabel">参数 · {{ REFINE_TOOL_SPECS[editor.refineTool].label }}</div>
      <label v-if="paramKind === 'brush'" class="refine-selection-panel__param" data-testid="refine-selection-param-brush" title="笔刷粗细与选区颜色">
        <input type="range" min="4" max="80" :value="editor.refineBrushSize" @input="onBrushSize">
        <span>{{ editor.refineBrushSize }}</span>
        <input type="color" :value="editor.refineBrushColor" title="选区颜色" @input="onBrushColor">
      </label>
      <label v-else-if="paramKind === 'wand'" class="refine-selection-panel__param" data-testid="refine-selection-param-wand" title="魔棒容差">
        <input type="range" min="0" max="48" step="1" :value="editor.refineWandTolerance" @input="onWandTolerance">
        <span>{{ editor.refineWandTolerance }}</span>
      </label>
      <div v-else class="refine-selection-panel__param" data-testid="refine-selection-param-none" />
    </div>
    <p class="refine-selection-panel__hint" data-testid="refine-selection-param-hint">{{ toolHint }}</p>

    <div class="refine-selection-panel__group">
      <div class="refine-selection-panel__glabel">选区操作</div>
      <button
        v-for="cmd in REFINE_SELECTION_COMMANDS"
        :key="cmd.id"
        type="button"
        class="refine-selection-panel__cmd"
        :data-testid="`refine-selection-command-${cmd.id}`"
        :title="cmd.hint"
        @click="runCommand(cmd.id)"
      >
        {{ cmd.label }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.refine-selection-panel { display: flex; flex-direction: column; gap: 14px; padding: 12px; }
.refine-selection-panel__group { display: flex; flex-direction: column; gap: 6px; }
.refine-selection-panel__glabel { color: var(--neo-text-muted); font-size: 10.5px; letter-spacing: .04em; }
.refine-selection-panel__ops { display: flex; gap: 6px; }
.refine-selection-panel__op {
  flex: 1; padding: 6px 0; border: 1px solid var(--neo-border); border-radius: 9px;
  background: transparent; color: var(--neo-text-secondary); font-size: 12px; cursor: pointer;
}
.refine-selection-panel__op.is-on {
  border-color: color-mix(in srgb, var(--neo-hi-text) 30%, var(--neo-border));
  background: var(--neo-hi-bg); color: var(--neo-hi-text);
}
.refine-selection-panel__tools { display: flex; flex-wrap: wrap; gap: 6px; }
.refine-selection-panel__tool {
  display: flex; align-items: center; gap: 5px; padding: 5px 9px;
  border: 1px solid var(--neo-border); border-radius: 9px;
  background: transparent; color: var(--neo-text-secondary); font-size: 11.5px; cursor: pointer;
}
.refine-selection-panel__tool:hover { background: var(--neo-hover-bg); color: var(--neo-text-primary); }
.refine-selection-panel__tool.is-on {
  border-color: color-mix(in srgb, var(--neo-hi-text) 30%, var(--neo-border));
  background: var(--neo-hi-bg); color: var(--neo-hi-text);
}
.refine-selection-panel__param { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--neo-text-secondary); }
.refine-selection-panel__param input[type='range'] { width: 120px; }
.refine-selection-panel__param input[type='color'] { width: 22px; height: 18px; padding: 0; border: none; background: none; }
.refine-selection-panel__hint { margin: -8px 0 0; color: var(--neo-text-muted); font-size: 11px; line-height: 1.5; }
.refine-selection-panel__cmd {
  display: block; width: 100%; padding: 6px 10px; border: 1px solid var(--neo-border);
  border-radius: 9px; background: transparent; color: var(--neo-text-primary);
  font-size: 12.5px; text-align: left; cursor: pointer;
}
.refine-selection-panel__cmd:hover { background: var(--neo-hover-bg); }
</style>
```

- [ ] **Step 3: 注册表换组件**

`workbenchToolRegistry.ts`：

```ts
// :3
import RefineSelectionPanel from '@/components/canvas/refine/RefineSelectionPanel.vue'
// :35
    panel: RefineSelectionPanel,
```

- [ ] **Step 4: 写面板测试**

创建 `RefineSelectionPanel.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import RefineSelectionPanel from './RefineSelectionPanel.vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'

let pinia: Pinia
const mountPanel = (props: Record<string, unknown> = {}) =>
  mount(RefineSelectionPanel, { props, global: { plugins: [pinia] } })

describe('RefineSelectionPanel', () => {
  beforeEach(() => { pinia = createPinia(); setActivePinia(pinia) })

  it('渲染三组 7 枚工具、选择方式两开关、选区操作两命令', () => {
    const w = mountPanel()
    for (const tool of ['point', 'wand', 'rect', 'ellipse', 'polygon', 'brush', 'eraser']) {
      expect(w.find(`[data-testid="refine-selection-tool-${tool}"]`).exists()).toBe(true)
    }
    expect(w.find('[data-testid="refine-selection-op-add"]').exists()).toBe(true)
    expect(w.find('[data-testid="refine-selection-op-subtract"]').exists()).toBe(true)
    expect(w.find('[data-testid="refine-selection-command-invert"]').exists()).toBe(true)
    expect(w.find('[data-testid="refine-selection-command-clear"]').exists()).toBe(true)
  })

  it('点工具写 store，参数区随 param 三态切换', async () => {
    const editor = useCanvasEditorStore()
    const w = mountPanel()
    await w.find('[data-testid="refine-selection-tool-wand"]').trigger('click')
    expect(editor.refineTool).toBe('wand')
    expect(w.find('[data-testid="refine-selection-param-wand"]').exists()).toBe(true)
    await w.find('[data-testid="refine-selection-tool-rect"]').trigger('click')
    expect(w.find('[data-testid="refine-selection-param-none"]').exists()).toBe(true)
    await w.find('[data-testid="refine-selection-tool-brush"]').trigger('click')
    expect(w.find('[data-testid="refine-selection-param-brush"]').exists()).toBe(true)
  })

  it('工具与开关联动：画笔→加选、橡皮→减选、矩形保持当前开关', async () => {
    const editor = useCanvasEditorStore()
    const w = mountPanel()
    await w.find('[data-testid="refine-selection-op-subtract"]').trigger('click')
    await w.find('[data-testid="refine-selection-tool-rect"]').trigger('click')
    expect(editor.refineMaskOp).toBe('subtract')
    await w.find('[data-testid="refine-selection-tool-brush"]').trigger('click')
    expect(editor.refineMaskOp).toBe('add')
    await w.find('[data-testid="refine-selection-tool-eraser"]').trigger('click')
    expect(editor.refineMaskOp).toBe('subtract')
  })

  it('选择方式开关立即写 store', async () => {
    const editor = useCanvasEditorStore()
    const w = mountPanel()
    await w.find('[data-testid="refine-selection-op-subtract"]').trigger('click')
    expect(editor.refineMaskOp).toBe('subtract')
    expect(w.find('[data-testid="refine-selection-op-subtract"]').classes()).toContain('is-on')
  })

  it('反选 / 清除选区调 refineMask handle', async () => {
    const editor = useCanvasEditorStore()
    let inverted = 0
    let cleared = 0
    editor.registerRefineMask({
      exportPng: async () => new Blob(),
      clear: () => { cleared += 1 },
      getCanvas: () => null,
      invert: () => { inverted += 1 },
    })
    const w = mountPanel()
    await w.find('[data-testid="refine-selection-command-invert"]').trigger('click')
    await w.find('[data-testid="refine-selection-command-clear"]').trigger('click')
    expect(inverted).toBe(1)
    expect(cleared).toBe(1)
  })

  it('提示行随工具切换（椭圆的 Shift 提示）', async () => {
    const w = mountPanel()
    await w.find('[data-testid="refine-selection-tool-ellipse"]').trigger('click')
    expect(w.find('[data-testid="refine-selection-param-hint"]').text()).toContain('Shift')
  })
})
```

- [ ] **Step 5: 更新 RefineSidePanel.test.ts:103 的旧 testid**

`expect(q('[data-testid="refine-select-panel"]')).not.toBeNull()` → `expect(q('[data-testid="refine-selection-panel"]')).not.toBeNull()`

- [ ] **Step 6: 跑测试确认绿**

Run: `pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/RefineSelectionPanel.test.ts src/components/canvas/refine/RefineSidePanel.test.ts src/components/canvas/workbench/workbenchToolRegistry.test.ts`
Expected: PASS。若 `workbenchToolRegistry.test.ts` 或 `RefineSidePanel.test.ts` 还有引用旧组件名/旧 testid 的断言（vitest 会直接报编译错），按同样方式改名——组件只此一个，无其他消费者。

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/canvas/refine/RefineSelectionPanel.vue apps/web/src/components/canvas/refine/RefineSelectionPanel.test.ts apps/web/src/components/canvas/workbench/workbenchToolRegistry.ts apps/web/src/components/canvas/refine/RefineSidePanel.test.ts
git commit -m "feat(refine): 右栏「选区」面板重写（选择方式/工具/参数/选区操作，直读写 store）"
```

---

### Task 6: `RefineToolRail` 三合一改造 + `toolIcons` 新增两枚模式入口图标

**Files:**
- Modify: `apps/web/src/components/canvas/toolIcons.ts`（追加两常量）
- Modify: `apps/web/src/components/canvas/refine/RefineToolRail.vue`（大改：script 删 8 处 / template 删输入组块 / 增 select 按钮）
- Modify: `apps/web/src/components/canvas/refine/RefineToolRail.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `refineSelectionOpAfterToolPick`（不直接用，rail 不再 pickTool）；store `setRefineMode`
- Produces: testid `rail-mode-select`；`OpenMenu` 类型收敛为 `{ kind: 'view'; id: 'compare' | 'fit' } | null`；扩图/选区图标改 SVG（`TOOL_ICON_OUTPAINT` / `TOOL_ICON_SELECT`）

- [ ] **Step 1: toolIcons.ts 追加（与 TOOL_ICON_MATTING 同款：内联 SVG 片段 + v-html）**

```ts
/** 「选区」模式入口：四角框线（marquee corner brackets），表述「框出一片区域」（spec §5.1） */
export const TOOL_ICON_SELECT =
  '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" /><path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" /><path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" /><path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />'

/** 「扩图」模式入口：虚线外框 + 实线内框，表述「画布向外扩展」（spec §5.1） */
export const TOOL_ICON_OUTPAINT =
  '<rect x="4" y="4" width="16" height="16" rx="1.5" stroke-dasharray="3 2.5" /><rect x="8.5" y="8.5" width="7" height="7" rx="1" />'
```

- [ ] **Step 2: RefineToolRail.vue script 段改写**

import 区改为：

```ts
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import { TOOL_ICON_MATTING, TOOL_ICON_OUTPAINT, TOOL_ICON_SELECT } from '@/components/canvas/toolIcons'
import {
  REFINE_CAPABILITY_ITEMS, REFINE_COMPARE_OPTIONS, REFINE_FIT_OPTIONS, REFINE_VIEW_TOOLS, REFINE_ZOOM_ACTIONS,
  type RefineFitOptionId,
} from './refineToolRailModel'
```

删除：`type RefineMaskTool` import、`GLYPH`、`VARIANT_ICONS`、`toggleInputGroup`、`pickTool`、`runCommand`、`isInputOpen`。模式函数改为：

```ts
/** 模式入口统一式（spec 图 3 上半段）：setRefineMode(激活 ? 'select' : 目标模式) */
const outpaintActive = computed(() => editor.refineMode === 'outpaint')
function toggleOutpaint() {
  editor.setRefineMode(outpaintActive.value ? 'select' : 'outpaint')
}

const mattingActive = computed(() => editor.refineMode === 'matting')
function toggleMatting() {
  editor.setRefineMode(mattingActive.value ? 'select' : 'matting')
}

const selectActive = computed(() => editor.refineMode === 'select')
function pickSelect() {
  editor.setRefineMode('select') // 选区目标模式就是 select，恒幂等
}
```

`OpenMenu` 类型改为：

```ts
type OpenMenu = { kind: 'view'; id: 'compare' | 'fit' } | null
```

- [ ] **Step 3: template 改写**

扩图按钮 glyph 改 SVG（替换 `<span class="refine-rail__glyph">⤢</span>`）：

```html
        <span class="refine-rail__glyph">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="TOOL_ICON_OUTPAINT" />
        </span>
```

抠图按钮之后、`<div class="refine-rail__hr" />` 之前插入选区入口：

```html
    <!-- 选区模式入口（spec §4.2）：select 是基座模式，点击恒幂等 -->
    <div class="refine-rail__slot">
      <button
        type="button"
        class="refine-rail__btn"
        :class="{ 'is-active': selectActive }"
        data-testid="rail-mode-select"
        aria-label="选区"
        title="选区（智能 / 形状 / 涂抹三类工具在右侧面板）"
        :aria-pressed="selectActive"
        :disabled="editor.refineBusy"
        @click="pickSelect"
      >
        <span class="refine-rail__glyph">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="TOOL_ICON_SELECT" />
        </span>
        <span class="refine-rail__name">选区</span>
      </button>
    </div>
```

删除整个 `<!-- 输入组 -->` 的 `v-for="group in REFINE_INPUT_GROUPS"` 块（含 flyout）。

对照 flyout 提示文案（`refine-rail__fly-note`）改为：

```html
        <div class="refine-rail__fly-note">
          对照需要「处理后」的版本，未产出时两项置灰。<br>选中后打开全屏对照，<b>Esc</b> 或对照头部的返回按钮回到工作图。
        </div>
```

其余（查看组 / 细节放大 / 撤销重做 / 能力区）不动。确认没有残留 `REFINE_INPUT_GROUPS` / `inputToolActive` / `rail-input-` / `rail-variant-` / `rail-command-` 字样。

- [ ] **Step 4: 改测试**

`RefineToolRail.test.ts`：

删除这 4 个用例（输入组专属）：`渲染 3 个输入工具与 2 个查看工具`、`子菜单默认关闭；点「涂抹」展开后 6 个工具都能点到`、`「反选」只在智能选择组、「清除选区」只在涂抹组`、`当前工具高亮在它所属的输入组上`。其余用例（对照 / 适配 / 细节放大 / 撤销重做 / 能力区，以及 100 行之后的用例）保留原样。

新增 5 个用例：

```ts
  it('渲染三枚模式入口 + 两枚查看入口，不存在任何输入组与二级菜单', () => {
    const w = mountRail()
    for (const id of ['rail-mode-outpaint', 'rail-mode-matting', 'rail-mode-select']) {
      expect(w.find(`[data-testid="${id}"]`).exists()).toBe(true)
    }
    expect(w.find('[data-testid="rail-view-compare"]').exists()).toBe(true)
    expect(w.find('[data-testid="rail-view-fit"]').exists()).toBe(true)
    for (const id of ['smart', 'marquee', 'paint']) {
      expect(w.find(`[data-testid="rail-input-${id}"]`).exists()).toBe(false)
    }
    expect(w.find('[data-testid="rail-variant-eraser"]').exists()).toBe(false)
    expect(w.find('[data-testid="rail-command-invert"]').exists()).toBe(false)
  })

  it('select 是基座模式：默认激活，点已激活的选区按钮无变化', async () => {
    const editor = useCanvasEditorStore()
    const w = mountRail()
    expect(editor.refineMode).toBe('select')
    expect(w.find('[data-testid="rail-mode-select"]').classes()).toContain('is-active')
    await w.find('[data-testid="rail-mode-select"]').trigger('click')
    expect(editor.refineMode).toBe('select')
  })

  it('三模式互斥：点扩图进 outpaint，点选区回 select', async () => {
    const editor = useCanvasEditorStore()
    const w = mountRail()
    await w.find('[data-testid="rail-mode-outpaint"]').trigger('click')
    expect(editor.refineMode).toBe('outpaint')
    expect(w.find('[data-testid="rail-mode-outpaint"]').classes()).toContain('is-active')
    expect(w.find('[data-testid="rail-mode-select"]').classes()).not.toContain('is-active')
    await w.find('[data-testid="rail-mode-select"]').trigger('click')
    expect(editor.refineMode).toBe('select')
  })

  it('再点已激活的扩图回 select（toggle 语义保留）', async () => {
    const editor = useCanvasEditorStore()
    const w = mountRail()
    await w.find('[data-testid="rail-mode-outpaint"]').trigger('click')
    await w.find('[data-testid="rail-mode-outpaint"]').trigger('click')
    expect(editor.refineMode).toBe('select')
  })

  it('busy 时三枚模式入口全部禁用', () => {
    const editor = useCanvasEditorStore()
    editor.setRefineBusy(true)
    const w = mountRail()
    for (const id of ['rail-mode-outpaint', 'rail-mode-matting', 'rail-mode-select']) {
      expect(w.find(`[data-testid="${id}"]`).attributes('disabled')).toBeDefined()
    }
  })
```

- [ ] **Step 5: 跑测试**

Run: `pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/RefineToolRail.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/canvas/toolIcons.ts apps/web/src/components/canvas/refine/RefineToolRail.vue apps/web/src/components/canvas/refine/RefineToolRail.test.ts
git commit -m "feat(refine): rail 输入组三合一为「选区」模式入口，扩图/选区图标 SVG 化"
```

---

### Task 7: `refineToolRailModel.ts` 瘦身 + 模式条退役（删文件）

**Files:**
- Modify: `apps/web/src/components/canvas/refine/refineToolRailModel.ts`（删 13 项，见下）
- Modify: `apps/web/src/components/canvas/refine/refineToolRailModel.test.ts`
- Modify: `apps/web/src/components/canvas/refine/RefineWorkViewport.vue`（:7 import、:231 标签）
- Modify: `apps/web/src/components/canvas/refine/RefineWorkViewport.test.ts:25-29`
- Delete: `apps/web/src/components/canvas/refine/RefineModeBar.vue`、`RefineModeBar.test.ts`

**Interfaces:**
- Produces: `refineToolRailModel.ts` 只保留 `REFINE_VIEW_TOOLS / REFINE_COMPARE_OPTIONS / REFINE_FIT_OPTIONS（含类型）/ REFINE_ZOOM_ACTIONS（含类型）/ REFINE_CAPABILITY_GROUPS / REFINE_CAPABILITY_ITEMS / compareModeLabel`（规格 §5.1 保留项清单）

- [ ] **Step 1: 瘦身模型文件**

删除：`REFINE_INPUT_GROUPS`、`RefineInputGroupId`、`RefineInputGroup`、`RefineToolVariant`、`RefineToolCommand`、`RefineToolParamKind`（已迁至 refineSelectionModel）、`GROUP_OF_TOOL`、`LABEL_OF_TOOL`、`PARAM_OF_TOOL`、`groupForTool`、`toolLabel`、`inputToolActive`、`toolParamKind`、`refineWorkspaceLabel`，以及文件顶部不再使用的 `import type { RefineMaskTool }`。保留项一字不动。

- [ ] **Step 2: 瘦身模型测试**

`refineToolRailModel.test.ts`：删除引用已删导出的用例与 import（`groupForTool` / `inputToolActive` / `toolParamKind` / `toolLabel` / `refineWorkspaceLabel`，即 :5 的部分 import 与 :21-64 里对应 `it` 块）；保留 `compareModeLabel`、`REFINE_FIT_OPTIONS`、`REFINE_ZOOM_ACTIONS`、能力区等用例。

- [ ] **Step 3: viewport 删模式条**

`RefineWorkViewport.vue`：删 `import RefineModeBar from './RefineModeBar.vue'`（:7）与 `<RefineModeBar />`（:231）。

- [ ] **Step 4: 删模式条文件**

```bash
git rm apps/web/src/components/canvas/refine/RefineModeBar.vue apps/web/src/components/canvas/refine/RefineModeBar.test.ts
```

- [ ] **Step 5: 改 viewport 测试**

`RefineWorkViewport.test.ts` :25-29 的用例 `左栏工具条与模式条都在视口内` 整块替换为：

```ts
  it('左栏工具条在视口内；模式条已退役（spec §4.5 / 图 5 ②）', () => {
    const w = mountViewport()
    expect(w.find('.refine-work__rail [data-testid="refine-rail"]').exists()).toBe(true)
    expect(w.find('[data-testid="refine-modebar"]').exists()).toBe(false)
  })
```

- [ ] **Step 6: 全仓确认无残留引用后跑测试**

```bash
python3 -c "import subprocess; print(subprocess.run(['rg', '-n', 'RefineModeBar|refine-modebar|modebar-', 'apps/web/src'], capture_output=True, text=True).stdout)"
```
Expected: 仅 `RefineWorkViewport.test.ts` 里那条「不存在」断言。有其他命中则逐一清掉。

Run: `pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine`
Expected: 全 PASS。

- [ ] **Step 7: Commit**

```bash
git add -A apps/web/src/components/canvas/refine/refineToolRailModel.ts apps/web/src/components/canvas/refine/refineToolRailModel.test.ts apps/web/src/components/canvas/refine/RefineWorkViewport.vue apps/web/src/components/canvas/refine/RefineWorkViewport.test.ts
git commit -m "feat(refine): 模式条整条退役——RefineModeBar 删除，rail 模型瘦身"
```

---

### Task 8: RefineSidePanel 预设删除 + 固定页脚 + RefineWorkbench Esc 补抠图（回归先红 ③）

**Files:**
- Modify: `apps/web/src/components/canvas/refine/RefineSidePanel.vue`（:18、:226-229、:659、模板尾部加页脚）
- Modify: `apps/web/src/utils/refineSession.ts:3-4`（删 STAIN_PRESET_PROMPT）
- Modify: `apps/web/src/components/canvas/refine/RefineWorkbench.vue:37-47`
- Modify: `apps/web/src/components/canvas/refine/RefineWorkbench.test.ts`（新增抠图用例）
- Modify: `apps/web/src/components/canvas/refine/RefineSidePanel.test.ts`（删/改 stain 相关断言，若有）

**Interfaces:**
- Consumes: Task 1 的 `refineSelectionEscHint`
- Produces: testid `refine-panel-esc-hint`（面板固定页脚，全模式生效）

- [ ] **Step 1: 先写失败的 Esc 回归测试（回归先红 ③）**

`RefineWorkbench.test.ts` 在「Esc 分级退出：扩图模式…」用例后新增：

```ts
  it('Esc 分级退出：抠图模式先退回 select 且不关闭（回归：旧实现漏了抠图）', async () => {
    const editor = useCanvasEditorStore()
    editor.refineMode = 'matting'
    const w = mountWorkbench()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(editor.refineMode).toBe('select')
    expect(w.emitted('close')).toBeUndefined()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(w.emitted('close')).toHaveLength(1)
  })
```

Run: `pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/RefineWorkbench.test.ts`
Expected: 新用例 FAIL（旧 `onClose` 只处理 outpaint，matting 直接落到 emit('close')）。**必须看到红。**

- [ ] **Step 2: 修 RefineWorkbench.vue 的 Esc 链**

```ts
/** Escape→close guard（分级，spec 图 3 下半段）：
 *  1) 非 select 模式（扩图 / 抠图）先回选区；2) 对照灯箱打开则先关；3) 关闭精修。
 *  busy 时 WorkbenchShell 的 useWorkbenchPanel 已拦截 Esc，故此处无需再判。 */
function onClose() {
  if (editor.refineMode !== 'select') {
    editor.setRefineMode('select')
    return
  }
  if (editor.compareLightboxOpen) {
    editor.setCompareLightboxOpen(false)
    return
  }
  emit('close')
}
```

Run 同上测试 → PASS。

- [ ] **Step 3: RefineSidePanel 删预设链路 + 加固定页脚**

1. 删 `import { STAIN_PRESET_PROMPT } from '@/utils/refineSession'`（:18）。
2. 删 `applyStainPreset()` 函数（:226-229）。
3. 删模板里 `@apply-stain-preset="applyStainPreset"`（:659）。
4. script import 区补 `import { refineSelectionEscHint } from './refineSelectionModel'`，editor 声明附近补：

```ts
/** 面板固定页脚（spec §4.5 表）：Esc 三态文案，对全部模式生效。 */
const escHint = computed(() =>
  refineSelectionEscHint({ refineMode: editor.refineMode, compareLightboxOpen: editor.compareLightboxOpen }),
)
```

5. 模板：主 `<aside>`（非 Teleport 的那个，`</aside>` 在 :735）内、最后一个 dock 之后插入：

```html
      <!-- 固定页脚（spec 图 6 ⑤）：Esc 三态，模式优先于对照 -->
      <div class="refine-side__esc" data-testid="refine-panel-esc-hint">{{ escHint }}</div>
```

6. style 区补：

```css
.refine-side__esc { flex: 0 0 auto; padding: 8px 14px; border-top: 1px solid var(--neo-border); color: var(--neo-text-muted); font-size: 11px; }
```

7. `utils/refineSession.ts` 删除：

```ts
export const STAIN_PRESET_PROMPT =
  '去除选区内的污渍、瑕疵、多余物体，其余像素保持不变'
```

- [ ] **Step 4: 全仓确认无残留**

```bash
python3 -c "import subprocess; print(subprocess.run(['rg', '-n', 'STAIN_PRESET_PROMPT|applyStainPreset|refine-select-preset-stain', 'apps/web/src'], capture_output=True, text=True).stdout)"
```
Expected: 空输出。有命中则逐一清掉。

- [ ] **Step 5: 跑相关测试**

Run: `pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine src/utils 2>/dev/null || pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine`
Expected: 全 PASS。若 `RefineSidePanel.test.ts` 有断言 `refine-select-preset-stain` 的用例，删除该用例；可补一条：

```ts
  it('固定页脚显示 Esc 三态文案（模式优先于对照）', async () => {
    const editor = useCanvasEditorStore()
    const w = mountRefineSidePanel() // 沿用该测试文件既有的挂载方式
    expect(q('[data-testid="refine-panel-esc-hint"]')?.textContent).toContain('关闭精修')
    editor.refineMode = 'outpaint'
    await flushPromises()
    expect(q('[data-testid="refine-panel-esc-hint"]')?.textContent).toContain('回到选区')
  })
```

（`mountRefineSidePanel` / `q` 用该测试文件里已有的挂载辅助与查询函数名；若命名不同以现名为准，断言逻辑不变。）

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/canvas/refine/RefineSidePanel.vue apps/web/src/components/canvas/refine/RefineSidePanel.test.ts apps/web/src/utils/refineSession.ts apps/web/src/components/canvas/refine/RefineWorkbench.vue apps/web/src/components/canvas/refine/RefineWorkbench.test.ts
git commit -m "feat(refine): Esc 分级补抠图、面板固定页脚三态文案，「清除瑕疵」预设下线"
```

---

### Task 9: 全量验证 + 真实浏览器目视验收（jsdom 盲区）

**Files:**
- 无新增源码；临时 harness 页测完即删

- [ ] **Step 1: web 全量单测**

Run: `pnpm --filter @lnkpi/web exec vitest run`
Expected: 全 PASS，无失败。

- [ ] **Step 2: 类型 + 构建**

Run: `pnpm --filter @lnkpi/web build`
Expected: `vue-tsc -b && vite build` 成功。随后 `git checkout -- apps/web/vite.config.js` 还原被重新生成的产物文件。

- [ ] **Step 3: 回归先红三条总核对**

逐条确认（已有 commit 记录即为证）：

```bash
git log --oneline origin/main..HEAD
```

1. rect 在 subtract 下保持（Task 1 Step 2 红过）；
2. 形状 subtract 用 destination-out（Task 3 Step 1 留了旧实现事实证据 + Task 3 Step 3 红过）；
3. Esc 抠图先回 select（Task 8 Step 1 红过）。

- [ ] **Step 4: 真实浏览器验证——椭圆与面板布局**

按项目范式（jsdom 布局盲区）：`pnpm --filter @lnkpi/web exec vite --port 5199` 起本地 dev；在 `apps/web` 下建临时 harness 页（`src/__harness__/refine-selection.html` + 对应临时路由/入口，挂真实 `RefineSelectionPanel` 与真实 `MaskEditor`，画布尺寸给足真实 `clientWidth`——可用 `Object.defineProperty` 之外的真实布局容器），用 agent-browser 量取：

1. 点 `refine-selection-tool-ellipse`，在画布拖拽：`pointerdown → pointermove → pointerup` 后量 `canvas` 的 `getImageData` 内出现非透明像素，且 bbox 与拖拽范围吻合；Shift 拖拽时 bbox 为正方形。
2. 先把开关拨到 `refine-selection-op-subtract` 再画矩形：画完后蒙版像素数**减少**（destination-out 生效）。
3. 量 `RefineSelectionPanel`：7 枚工具不溢出面板宽度、参数区/页脚可见；rail 三枚模式入口不与「返回画布」chrome 重叠。

测完删除 harness 文件并确认 `git status` 干净。

- [ ] **Step 5: 推分支开 PR**

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy git push -u origin feature/refine-selection-unified
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy /usr/local/bin/gh pr create --title "feat(refine): 选区统一——入口三合一 + 工具参数进面板 + 模式条退役 + 补椭圆" --body "实现 docs/superpowers/specs/2026-09-23-refine-selection-unified-design.md（PR #403 已合并）。见实现计划 docs/superpowers/plans/2026-09-23-refine-selection-unified.md 与规格 §6.3 验收清单。"
```

等待 CI 6 项全绿后回报，等用户验收（不自行合并）。

- [ ] **Step 6: 更新实现计划勾选状态**

把本文件所有 `- [ ]` 按完成情况改为 `- [x]`，与代码同一 commit 或单独 docs commit 均可。
