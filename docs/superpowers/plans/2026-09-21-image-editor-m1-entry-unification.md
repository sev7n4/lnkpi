# 图片编辑统一设计 M1 实施计划：入口统一 + 宫格选择器 + Workbench 收敛

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 spec 的 M1 里程碑——统一图片类操作入口（节点 hover/选中条/灯箱/右键菜单），将宫格裁剪下拉改为 7×7 悬浮格子选择器（支持非正方形），冻结 Refine floating chrome，抽取 `useWorkbenchPanel` 收敛双工作台重复逻辑。

**Architecture:** 纯前端重构，零后端改动。事件契约从 `quick-slice(n)`（正方形）升级为 `slice(cols, rows)`；`runGridSlice` 元数据 `{cols, rows}` 本就独立（`packages/shared/src/gridSlice.ts`，`MAX_GRID=7`），服务端零改动。所有新状态走现有 `useCanvasEditorStore`，不新增全局状态。

**Tech Stack:** Vue 3 + TS + Pinia + Vitest + @vue/test-utils（无新依赖）

**Spec:** `docs/superpowers/specs/2026-09-21-image-editor-unified-design.md`

## Global Constraints

- 分支：`feature/image-editor-m1-entry-unification`，禁止直接 push main；Squash Merge。
- 测试命令：`cd apps/web && pnpm vitest run <file>`；提交前必跑本地验证四条（见 Task 8）。
- 网格上限必须复用 `@lnkpi/shared` 的语义：选择器 7×7 对应 `gridSlice.ts` 内 `MAX_GRID = 7`（不导出，选择器本地常量 `GRID_PICKER_MAX = 7` 并注释来源）。
- 禁止引入新 npm 依赖；禁止改动 `packages/shared` 行为。
- spec 微调（已识别）：节点 hover 保留 3 个按钮（预览/替换/ⓘ），非 spec 的 2 个——「替换图片」的上传机制内聚于 `CanvasNodeImage` 的 `useNodeMediaUpload`，外移需新增 store 信号、收益不抵成本。其余按 spec 执行。
- 明文 HTTP 兼容：新代码不得引入 `crypto.randomUUID`/`navigator.clipboard` 直接调用。

## Review Focus

1. **非正方形切分落位**：选择器选 3×2 后，`layoutSliceChildPositions` 以 cols 排布——预期 6 个子节点按 3 列 2 行网格落位，不重叠。测试：Task 1 组件级 + Task 8 手动验收。
2. **触屏设备无 hover**：第一次点击只高亮、第二次点击同一格才切分——预期移动端不会误切。测试：Task 1 组件测试 `touch-two-tap`。
3. **灯箱编辑按钮的空 nodeId**：从资产面板/任务历史打开的预览无 nodeId——预期编辑按钮隐藏、存资产库隐藏，点击不抛错。测试：Task 5。
4. **refineBusy 期间切换节点**：精修进行中从灯箱对另一节点点编辑——预期被 `openImageEditor` 的 nodeId 守卫忽略（现有行为，测试锁定）。测试：Task 5。
5. **floating chrome 移除后的 localStorage/持久化残留**：`refinePanelWidth` 等曾持久化的键不再被读取——预期无控制台报错、无幽灵 UI。测试：Task 6 store 测试 + Task 8 手动验收。

---

### Task 1: GridSliceDropdown 改造为 7×7 格子选择器

**Files:**
- Modify: `apps/web/src/components/canvas/grid-slice/GridSliceDropdown.vue`
- Test: `apps/web/src/components/canvas/grid-slice/GridSliceDropdown.test.ts`（重写）

**Interfaces:**
- Consumes: 无（叶子组件）
- Produces: emit `slice: [cols: number, rows: number]`（1..7）、emit `open-custom: []`；props `disabled/loading/disabledTitle` 不变。后续 Task 2 依赖。

- [ ] **Step 1: 重写测试（先红）**

```ts
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import GridSliceDropdown from './GridSliceDropdown.vue'

async function openMenu() {
  const wrapper = mount(GridSliceDropdown)
  await wrapper.get('button').trigger('click')
  return wrapper
}

describe('GridSliceDropdown (grid picker)', () => {
  it('renders trigger and a 7x7 cell matrix after open', async () => {
    const wrapper = await openMenu()
    expect(wrapper.get('button').text()).toContain('宫格裁剪')
    expect(wrapper.findAll('[data-cell]')).toHaveLength(49)
    wrapper.unmount()
  })

  it('highlights top-left sub-rect on hover and shows live label', async () => {
    const wrapper = await openMenu()
    const cell = wrapper.get('[data-cell="3-2"]')
    await cell.trigger('pointerenter', { pointerType: 'mouse' })
    expect(wrapper.text()).toContain('3 × 2 · 共 6 张')
    expect(wrapper.findAll('[data-cell][data-active="true"]')).toHaveLength(6)
    wrapper.unmount()
  })

  it('emits slice(cols, rows) on cell click', async () => {
    const wrapper = await openMenu()
    await wrapper.get('[data-cell="3-2"]').trigger('pointerenter', { pointerType: 'mouse' })
    await wrapper.get('[data-cell="3-2"]').trigger('click')
    expect(wrapper.emitted('slice')).toEqual([[3, 2]])
    wrapper.unmount()
  })

  it('touch: first tap highlights, second tap on same cell slices', async () => {
    const wrapper = await openMenu()
    const cell = wrapper.get('[data-cell="2-2"]')
    await cell.trigger('click') // touch 无 hover，第一次点选
    expect(wrapper.emitted('slice')).toBeUndefined()
    expect(wrapper.text()).toContain('2 × 2 · 共 4 张')
    await cell.trigger('click') // 第二次确认
    expect(wrapper.emitted('slice')).toEqual([[2, 2]])
    wrapper.unmount()
  })

  it('keeps 精确输入… emitting open-custom', async () => {
    const wrapper = await openMenu()
    const custom = wrapper.findAll('button').find((b) => b.text().includes('精确输入'))
    expect(custom).toBeTruthy()
    await custom!.trigger('click')
    expect(wrapper.emitted('open-custom')).toHaveLength(1)
    wrapper.unmount()
  })

  it('does not open when disabled or loading', async () => {
    const wrapper = mount(GridSliceDropdown, { props: { disabled: true } })
    await wrapper.get('button').trigger('click')
    expect(wrapper.find('[data-cell]').exists()).toBe(false)
    await wrapper.setProps({ disabled: false, loading: true })
    await wrapper.get('button').trigger('click')
    expect(wrapper.find('[data-cell]').exists()).toBe(false)
    wrapper.unmount()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/web && pnpm vitest run src/components/canvas/grid-slice/GridSliceDropdown.test.ts`
Expected: FAIL（无 `data-cell`、无 `slice` 事件）

- [ ] **Step 3: 重写组件**

`GridSliceDropdown.vue` script 关键变更（保留 trigger/disabled/loading/outside-close/Esc 逻辑，删除 `GRID_SLICE_SQUARE_PRESETS` 与 `pickPreset`）：

```ts
const GRID_PICKER_MAX = 7 // 与 packages/shared/src/gridSlice.ts 的 MAX_GRID 对齐
const hover = ref<{ cols: number; rows: number } | null>(null)
const lastTapped = ref<string | null>(null)

const emit = defineEmits<{
  slice: [cols: number, rows: number]
  'open-custom': []
}>()

const label = computed(() =>
  hover.value ? `${hover.value.cols} × ${hover.value.rows} · 共 ${hover.value.cols * hover.value.rows} 张` : '悬停选择切分规格',
)

function isPreset(c: number, r: number) {
  return (c === 2 && r === 2) || (c === 3 && r === 3)
}

function onCellEnter(cols: number, rows: number, pointerType: string) {
  if (pointerType === 'touch') return
  hover.value = { cols, rows }
}

function onCellClick(cols: number, rows: number, pointerType: string | undefined) {
  const key = `${cols}-${rows}`
  if (pointerType === 'touch' && lastTapped.value !== key) {
    lastTapped.value = key
    hover.value = { cols, rows }
    return
  }
  if (blocked.value) return
  close()
  emit('slice', cols, rows)
}
```

template 菜单体（整体替换原预设按钮列表；`@pointerdown.stop` 保留防冒泡；Vue 双循环用 `<template v-for>` 嵌套）：

```html
<div v-if="open && !blocked" class="neo-chrome grid-slice-menu absolute left-0 top-full z-[2] mt-1 rounded-xl p-2" role="menu" @click.stop>
  <div class="grid" style="grid-template-columns: repeat(7, 22px); gap: 3px">
    <template v-for="r in GRID_PICKER_MAX" :key="`row-${r}`">
      <button
        v-for="c in GRID_PICKER_MAX"
        :key="`cell-${c}-${r}`"
        type="button"
        class="grid-cell"
        :data-cell="`${c}-${r}`"
        :data-active="hover && c <= hover.cols && r <= hover.rows ? 'true' : 'false'"
        :class="{ preset: isPreset(c, r) }"
        @pointerenter="onCellEnter(c, r, $event.pointerType)"
        @click="onCellClick(c, r, $event.pointerType)"
      />
    </template>
  </div>
  <p class="grid-slice-label">{{ label }}</p>
  <button type="button" class="grid-slice-item custom" role="menuitem" @click="pickCustom">精确输入…</button>
</div>
```

style（追加到现有 scoped style，删除 `.grid-slice-item` 的菜单列表样式以外保留 custom 项）：

```css
.grid-cell {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--neo-text) 18%, transparent);
  background: transparent;
  padding: 0;
}
.grid-cell[data-active='true'] {
  background: color-mix(in srgb, var(--neo-accent, #5b8def) 28%, transparent);
  border-color: var(--neo-accent, #5b8def);
}
.grid-cell.preset {
  border-style: dashed;
}
.grid-slice-label {
  margin: 6px 2px 2px;
  font-size: 11px;
  color: var(--neo-text);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/web && pnpm vitest run src/components/canvas/grid-slice/GridSliceDropdown.test.ts`
Expected: PASS（6 个用例全绿）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/canvas/grid-slice/GridSliceDropdown.vue apps/web/src/components/canvas/grid-slice/GridSliceDropdown.test.ts
git commit -m "feat(grid-slice): replace preset menu with 7x7 hover grid picker supporting non-square slices"
```

---

### Task 2: 事件契约切换 slice(cols, rows)

**Files:**
- Modify: `apps/web/src/components/canvas/SelectionActionBar.vue:21-26`（emits）、`:110-117`（GridSliceDropdown 绑定）
- Modify: `apps/web/src/pages/CanvasPage.vue`（`handleGridSliceQuick` 改名 + 模板绑定）
- Test: `apps/web/src/components/canvas/SelectionActionBar.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的 `slice: [cols, rows]`
- Produces: `SelectionActionBar` emit `slice: [cols, rows]`；`CanvasPage.handleGridSliceSlice(cols, rows)`

- [ ] **Step 1: 新建 SelectionActionBar 测试（先红）**

```ts
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'

vi.mock('@vue-flow/core', () => ({
  useVueFlow: () => ({
    viewport: ref({ x: 0, y: 0, zoom: 1 }),
    nodes: ref([]),
    findNode: () => undefined,
  }),
}))
vi.mock('@/composables/useCanvasGrouping', () => ({
  getAbsolutePosition: () => ({ x: 100, y: 100 }),
  getNodeSize: () => ({ w: 200, h: 200 }),
}))

import SelectionActionBar from './SelectionActionBar.vue'

describe('SelectionActionBar', () => {
  it('forwards grid picker slice(cols, rows)', async () => {
    const wrapper = mount(SelectionActionBar, {
      props: { node: { id: 'n1', type: 'image' }, imageUpscale: true, gridSlice: true },
      global: { stubs: { teleport: true } },
    })
    await wrapper.get('button').trigger('click')
    await wrapper.get('[data-cell="3-2"]').trigger('pointerenter', { pointerType: 'mouse' })
    await wrapper.get('[data-cell="3-2"]').trigger('click')
    expect(wrapper.emitted('slice')).toEqual([[3, 2]])
    wrapper.unmount()
  })
})
```

Run: `cd apps/web && pnpm vitest run src/components/canvas/SelectionActionBar.test.ts`
Expected: FAIL（无 `slice` 事件）

- [ ] **Step 2: 修改 emits 与绑定**

`SelectionActionBar.vue`：

```ts
const emit = defineEmits<{
  upscale: []
  edit: []
  slice: [cols: number, rows: number]
  'open-custom': []
}>()
```

template 中 `<GridSliceDropdown ... @quick-slice="emit('quick-slice', $event)"` 改为 `@slice="emit('slice', $event[0], $event[1])"`（Vue 原生 emit 多参写法：`@slice="(c: number, r: number) => emit('slice', c, r)"`）。

- [ ] **Step 3: CanvasPage 接线**

`CanvasPage.vue` 删除：

```ts
async function handleGridSliceQuick(n: number) {
  const node = selectionGridSliceNode.value
  if (!node || gridSliceEntryDisabled.value) return
  await executeGridSlice(node, n, n)
}
```

新增：

```ts
async function handleGridSliceSlice(cols: number, rows: number) {
  const node = selectionGridSliceNode.value
  if (!node || gridSliceEntryDisabled.value) return
  await executeGridSlice(node, cols, rows)
}
```

模板 `@quick-slice="handleGridSliceQuick"` 改为 `@slice="handleGridSliceSlice"`。

- [ ] **Step 4: 运行确认通过 + 全量 grid-slice 相关测试**

Run: `cd apps/web && pnpm vitest run src/components/canvas/SelectionActionBar.test.ts src/components/canvas/grid-slice/ src/composables/useGridSlice.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/canvas/SelectionActionBar.vue apps/web/src/components/canvas/SelectionActionBar.test.ts apps/web/src/pages/CanvasPage.vue
git commit -m "feat(grid-slice): switch selection bar contract to slice(cols, rows)"
```

---

### Task 3: CanvasNodeImage hover 收敛（6 → 3）

**Files:**
- Modify: `apps/web/src/components/canvas/CanvasNodeImage.vue:159-234`（按钮区）、`:79-134`（死代码清理）

**Interfaces:**
- Consumes: 现有 `openPreview`、`openPicker`、`openMediaInspector`
- Produces: hover 按钮仅剩 预览 / 替换 / ⓘ；`openEdit`、`download`、`saveToLibrary` 函数删除（编辑走选中条/灯箱/右键，下载与存资产库走 Task 4 的右键菜单与 Task 5 的灯箱）。

- [ ] **Step 1: 删除按钮与函数**

template 中删除三块：`neo-node-download-btn` 整个 button（`:186-199`）、`neo-node-save-btn` 整个 button（`:200-211`）、右下角「编辑」chip（`:212-221`）。

script 中删除：`openEdit` 函数（`:79-87`）、`download` 函数（`:99-106`）、`saveToLibrary` 函数（`:108-120`）、`downloadTitle` computed（`:53-57`）。

清理不再使用的 import：`downloadMediaFile, isUpstreamMediaUrl, mediaDownloadName, UPSTREAM_MEDIA_DOWNLOAD_HINT`（若仅剩此文件使用处）、`saveAssetToLibrary`、`useRoute`（若 `sessionId` 仅被删除的函数引用——注意 `NodeTaskCornerActions` 仍需要 `sessionId`，保留）。删除 `CX_IMAGE_EDIT_ENABLED` import。

- [ ] **Step 2: 手动验证（dev 环境）**

Run: `cd apps/web && pnpm dev`，打开 `/workflow`，选中一张已完成图片节点：
Expected: hover 仅显示 预览/替换/ⓘ 三个按钮；双击开灯箱；单击出现选中操作条（编辑入口）。

- [ ] **Step 3: 全量测试回归**

Run: `cd apps/web && pnpm vitest run`
Expected: 全绿（本任务无测试变更，确认无破坏）

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/canvas/CanvasNodeImage.vue
git commit -m "refactor(node): reduce image node hover buttons to preview/replace/inspect"
```

---

### Task 4: 下载/存资产库承接——选中条图标化（快捷位）+ 右键菜单（全量位）

> spec 3.2.1 修订（2026-09-21 复审）：hover 收敛后「下载/存资产库」不能只剩隐藏入口（右键/灯箱），
> 必须补快捷位。选中条升级为 spec 3.2.1 的三组六单元图标条；本任务同时落地右键全量位。
> 注意：一键抠图按钮 M1 不渲染（引擎未就绪），仅预留注释标记，M2 点亮，避免灰色死按钮。

**Files:**
- Modify: `apps/web/src/components/canvas/SelectionActionBar.vue`（图标化改造 + 下载/存库按钮）
- Modify: `apps/web/src/components/canvas/SelectionActionBar.test.ts`（Task 2 新建的文件追加用例）
- Modify: `apps/web/src/components/canvas/CanvasContextMenu.vue`
- Modify: `apps/web/src/pages/CanvasPage.vue`（`handleContextAction` 增加两个 case + 选中条接线）
- Test: `apps/web/src/components/canvas/CanvasContextMenu.test.ts`（新建）

**Interfaces:**
- Consumes: props `hasUrl/mediaKind`（已存在）；CanvasPage 已有 `findNodeById`、`sessionId`；`downloadMediaFile/mediaDownloadName`（`@/composables/useCanvasMedia`）、`saveAssetToLibrary`（`@/composables/useAssetLibrary`）、`resolveMediaUrl`（`@/services/api-base`）
- Produces: 右键 action 字符串 `'download-image'`、`'save-asset'`；`SelectionActionBar` 新增 emits `download: []`、`'save-asset': []` 与 props `hasUrl: boolean`；CanvasPage 抽出 `downloadNodeImage(nodeId)` / `saveNodeAsset(nodeId)` 两个复用函数（右键与选中条共同调用）

- [ ] **Step 1: 新建测试（先红）**

```ts
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CanvasContextMenu from './CanvasContextMenu.vue'

describe('CanvasContextMenu image actions', () => {
  it('shows 下载/存入资产库 for image node with url', async () => {
    const wrapper = mount(CanvasContextMenu, {
      props: { x: 0, y: 0, nodeId: 'n1', nodeType: 'image', hasUrl: true, mediaKind: 'image' },
    })
    const download = wrapper.findAll('button').find((b) => b.text() === '下载图片')
    const save = wrapper.findAll('button').find((b) => b.text() === '存入资产库')
    expect(download).toBeTruthy()
    expect(save).toBeTruthy()
    await download!.trigger('click')
    expect(wrapper.emitted('action')).toEqual([['download-image', undefined]])
    wrapper.unmount()
  })

  it('hides image actions without url', () => {
    const wrapper = mount(CanvasContextMenu, {
      props: { x: 0, y: 0, nodeId: 'n1', nodeType: 'image', hasUrl: false, mediaKind: 'image' },
    })
    expect(wrapper.findAll('button').some((b) => b.text() === '下载图片')).toBe(false)
    wrapper.unmount()
  })
})
```

Run: `cd apps/web && pnpm vitest run src/components/canvas/CanvasContextMenu.test.ts`
Expected: FAIL

- [ ] **Step 2: 实现菜单项**

`CanvasContextMenu.vue` script 新增：

```ts
const showImageFileActions = computed(
  () => Boolean(props.hasUrl) && props.mediaKind === 'image',
)
```

template 在「编辑图像」之后新增：

```html
<button v-if="showImageFileActions" class="neo-popover-item block w-full px-4 py-2 text-left text-xs" @click="run('download-image')">下载图片</button>
<button v-if="showImageFileActions" class="neo-popover-item block w-full px-4 py-2 text-left text-xs" @click="run('save-asset')">存入资产库</button>
```

- [ ] **Step 3: CanvasPage 抽出复用函数并接右键**

先抽出两个共享函数（右键菜单与选中条共同调用，避免逻辑复制）：

```ts
function downloadNodeImage(nodeId: string) {
  const node = findNodeById(nodeId)
  const url = String((node?.data as Record<string, unknown> | undefined)?.url ?? '').trim()
  if (url) {
    void downloadMediaFile(resolveMediaUrl(url), mediaDownloadName(url, 'image'), { sessionId: sessionId.value })
  }
}

function saveNodeAsset(nodeId: string) {
  const node = findNodeById(nodeId)
  const data = (node?.data ?? {}) as Record<string, unknown>
  const url = String(data.url ?? '').trim()
  if (url) {
    void saveAssetToLibrary({
      kind: 'image',
      url: resolveMediaUrl(url),
      label: typeof data.label === 'string' ? data.label : undefined,
      prompt: typeof data.prompt === 'string' ? data.prompt : undefined,
      sourceNodeId: nodeId,
      sessionId: sessionId.value,
      generationRecordId: typeof data.generationRecordId === 'string' ? data.generationRecordId : undefined,
    })
  }
}
```

`handleContextAction` 中 `upscale-image` case 之后新增（imports：`downloadMediaFile/mediaDownloadName` 从 `@/composables/useCanvasMedia`、`saveAssetToLibrary` 从 `@/composables/useAssetLibrary`、`resolveMediaUrl` 从 `@/services/api-base`——若 CanvasPage 未引入则补）：

```ts
if (action === 'download-image' && menu.nodeId) {
  downloadNodeImage(menu.nodeId)
  return
}

if (action === 'save-asset' && menu.nodeId) {
  saveNodeAsset(menu.nodeId)
  return
}
```

注意 `resolveMediaUrl` 从 `@/services/api-base` 导入；若 CanvasPage 未引入则补。

- [ ] **Step 4: 选中条测试（先红）**

`SelectionActionBar.test.ts`（Task 2 新建的文件）追加：

```ts
it('emits download and save-asset, hides them without url', async () => {
  const wrapper = mount(SelectionActionBar, {
    props: { node: { id: 'n1', type: 'image' }, imageUpscale: true, gridSlice: true, hasUrl: true },
    global: { stubs: { teleport: true } },
  })
  await wrapper.get('[data-action="download"]').trigger('click')
  await wrapper.get('[data-action="save-asset"]').trigger('click')
  expect(wrapper.emitted('download')).toBeTruthy()
  expect(wrapper.emitted('save-asset')).toBeTruthy()
  await wrapper.setProps({ hasUrl: false })
  expect(wrapper.find('[data-action="download"]').exists()).toBe(false)
  wrapper.unmount()
})
```

Run: `cd apps/web && pnpm vitest run src/components/canvas/SelectionActionBar.test.ts`
Expected: FAIL（无 download/save-asset 按钮）

- [ ] **Step 5: 选中条图标化实现（spec 3.2.1 三组六单元）**

`SelectionActionBar.vue` 改造：

1. props 新增 `hasUrl?: boolean`；emits 新增 `download: []`、`'save-asset': []`。
2. template 改为三组结构（图标用内联 SVG，14px stroke 图标，与项目现有内联 SVG 组件做法一致，不引新依赖）：

```html
<div class="neo-chrome flex items-center gap-0.5 rounded-xl px-1.5 py-1" @click.stop>
  <!-- 切分组 -->
  <GridSliceDropdown v-if="gridSlice" ... />
  <span v-if="gridSlice" class="mx-1 h-4 w-px bg-current opacity-10" aria-hidden="true" />
  <!-- AI 一键组：抠图位预留（M2 点亮，注释标记，不渲染死按钮） -->
  <button type="button" class="toolbar-action accent" :disabled="upscaleDisabled" :title="upscaleTitle" @click="onUpscale">
    <svg><!-- ⤢ 放大图标 --></svg><span class="label">放大</span>
    <span v-if="creditHint" class="credit-chip">{{ creditHint }}</span>
  </button>
  <button type="button" class="toolbar-action" title="编辑图像" @click="emit('edit')">
    <svg><!-- ✎ 编辑图标 --></svg><span class="label">编辑</span>
  </button>
  <span class="mx-1 h-4 w-px bg-current opacity-10" aria-hidden="true" />
  <!-- 文件组：纯图标 + tooltip -->
  <button v-if="hasUrl" type="button" class="toolbar-action icon-only" title="下载图片" data-action="download" @click="emit('download')">
    <svg><!-- ⬇ 图标 --></svg>
  </button>
  <button v-if="hasUrl" type="button" class="toolbar-action icon-only" title="存入资产库" data-action="save-asset" @click="emit('save-asset')">
    <svg><!-- ⊕ 图标 --></svg>
  </button>
</div>
```

3. 样式：`.icon-only { padding: 0.25rem 0.4rem }`；`.label` 在容器缩放 <0.5 时隐藏——通过 props 传入 `zoom`（CanvasPage 已有 viewport）绑定 class `text-hidden`，`@media` 不适用（缩放是 transform），用 `:class="{ 'labels-hidden': zoom < 0.5 }"` + `.labels-hidden .label { display: none }`。
4. 积分角标 `creditHint`：M1 阶段暂传 `undefined`（放大积分数值接积分体系后填入，M3 落地），仅预留样式。
5. CanvasPage 模板 `<SelectionActionBar ...>` 追加 `:has-url="..."`、`@download="selectionActionNodeId && downloadNodeImage(selectionActionNodeId)"`、`@save-asset="selectionActionNodeId && saveNodeAsset(selectionActionNodeId)"`（`selectionActionNodeId` 即现有传入选中条的节点 id 来源，实现时以真实变量名为准）。

- [ ] **Step 6: 运行确认通过**

Run: `cd apps/web && pnpm vitest run src/components/canvas/SelectionActionBar.test.ts src/components/canvas/CanvasContextMenu.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/canvas/SelectionActionBar.vue apps/web/src/components/canvas/SelectionActionBar.test.ts apps/web/src/components/canvas/CanvasContextMenu.vue apps/web/src/components/canvas/CanvasContextMenu.test.ts apps/web/src/pages/CanvasPage.vue
git commit -m "feat(canvas): icon-based selection bar with download/save shortcuts + context menu actions"
```

---

### Task 5: 灯箱升级为查看 hub（编辑 + 存资产库）

**Files:**
- Modify: `apps/web/src/stores/canvasEditor.ts`（`MediaPreviewTarget` 加 `nodeId?: string`）
- Modify: `apps/web/src/components/canvas/CanvasNodeImage.vue:89-97`（`openPreview` 传 nodeId）
- Modify: `apps/web/src/components/canvas/MediaPreviewOverlay.vue`
- Test: `apps/web/src/stores/canvasEditor.refine.test.ts`（追加用例）、`apps/web/src/components/canvas/MediaPreviewOverlay.test.ts`（新建）

**Interfaces:**
- Consumes: `ImageEditTarget { nodeId, url, prompt? }`（已存在）
- Produces: `MediaPreviewTarget.nodeId?: string`；灯箱 emit-free，直接调 store 的 `openImageEditor` / `closeMediaPreview`。

- [ ] **Step 1: store 类型 + 用例（先红）**

`MediaPreviewTarget` 增加一行 `nodeId?: string`。

`canvasEditor.refine.test.ts` 追加：

```ts
it('opens editor from preview target carrying nodeId, guarded by refineBusy', () => {
  const editor = useCanvasEditorStore()
  editor.openMediaPreview({ url: 'https://cdn/a.png', kind: 'image', nodeId: 'n1' })
  editor.openImageEditor({ nodeId: 'n1', url: 'https://cdn/a.png' })
  expect(editor.imageTarget?.nodeId).toBe('n1')
  editor.closeImageEditor()
  expect(editor.imageTarget).toBeNull()
})
```

Run: `cd apps/web && pnpm vitest run src/stores/canvasEditor.refine.test.ts`
Expected: PASS（类型改动本身不破坏；此用例锁定 Task 4 行为）。若 TS 报 `nodeId` 不存在于类型，说明 Step 未完成——先加类型再跑。

- [ ] **Step 2: CanvasNodeImage.openPreview 传 nodeId**

```ts
function openPreview() {
  if (!displayUrl.value) return
  editor.openMediaPreview({
    url: displayUrl.value,
    kind: 'image',
    label: props.data.label ?? props.data.prompt,
    generationRecordId: props.data.generationRecordId,
    nodeId: props.id,
  })
}
```

- [ ] **Step 3: 灯箱组件改造**

`MediaPreviewOverlay.vue` script 新增（顶部操作栏已引 store 与 inspector）：

```ts
import { saveAssetToLibrary } from '@/composables/useAssetLibrary'

const canEdit = computed(() => target.value?.kind === 'image' && Boolean(target.value?.nodeId))

function openEditorFromPreview() {
  const t = target.value
  if (!t?.nodeId || t.kind !== 'image') return
  editor.closeMediaPreview()
  editor.openImageEditor({ nodeId: t.nodeId, url: t.url })
}

async function savePreviewToLibrary() {
  const t = target.value
  if (!t?.nodeId) return
  await saveAssetToLibrary({
    kind: t.kind === 'video' ? 'video' : 'image',
    url: t.url,
    label: t.label,
    sourceNodeId: t.nodeId,
    generationRecordId: t.generationRecordId,
  })
}
```

顶部操作栏最前（「更多信息」按钮之前）新增两个按钮，样式复用 `preview-ctl`：

```html
<button v-if="canEdit" type="button" class="preview-ctl preview-ctl-text preview-ctl-accent" @click.stop="openEditorFromPreview">编辑</button>
<button v-if="target?.nodeId" type="button" class="preview-ctl preview-ctl-text" @click.stop="savePreviewToLibrary">存入资产库</button>
```

style 追加 `.preview-ctl-accent { color: #7cc4ff; font-weight: 500; }`。

- [ ] **Step 4: 组件测试（新建）**

```ts
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const editor = {
  previewTarget: null as null | Record<string, unknown>,
  closeMediaPreview: vi.fn(),
  openImageEditor: vi.fn(),
}
vi.mock('@/stores/canvasEditor', () => ({
  useCanvasEditorStore: () => editor,
}))
vi.mock('@/composables/useMediaInspector', () => ({ useMediaInspector: () => ({ openInspector: vi.fn() }) }))
vi.mock('vue-router', () => ({ useRoute: () => ({ params: {} }) }))

import MediaPreviewOverlay from './MediaPreviewOverlay.vue'

describe('MediaPreviewOverlay hub actions', () => {
  it('hides edit/save without nodeId', async () => {
    editor.previewTarget = { url: 'https://cdn/a.png', kind: 'image' }
    const wrapper = mount(MediaPreviewOverlay, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).not.toContain('编辑')
    wrapper.unmount()
  })

  it('edit button closes preview and opens editor with nodeId', async () => {
    editor.previewTarget = { url: 'https://cdn/a.png', kind: 'image', nodeId: 'n1' }
    const wrapper = mount(MediaPreviewOverlay, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    const editBtn = wrapper.findAll('button').find((b) => b.text() === '编辑')!
    await editBtn.trigger('click')
    expect(editor.closeMediaPreview).toHaveBeenCalled()
    expect(editor.openImageEditor).toHaveBeenCalledWith({ nodeId: 'n1', url: 'https://cdn/a.png' })
    wrapper.unmount()
  })
})
```

Run: `cd apps/web && pnpm vitest run src/components/canvas/MediaPreviewOverlay.test.ts src/stores/canvasEditor.refine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/canvasEditor.ts apps/web/src/stores/canvasEditor.refine.test.ts apps/web/src/components/canvas/CanvasNodeImage.vue apps/web/src/components/canvas/MediaPreviewOverlay.vue apps/web/src/components/canvas/MediaPreviewOverlay.test.ts
git commit -m "feat(preview): promote media preview overlay to view hub with edit/save actions"
```

---

### Task 6: 冻结 Refine floating chrome

**Files:**
- Modify: `apps/web/src/stores/canvasEditor.ts`（删除 `refineChrome`、`setRefineChrome`、`refinePanelWidth`、`refinePanelCollapsed` 及 `resetRefineChromeState` 对应清理）
- Modify: `apps/web/src/components/canvas/refine/RefineSidePanel.vue`（删除 floating 分支）
- Modify: `apps/web/src/components/canvas/refine/refineChrome.ts`（删 `RefineChromeMode`）
- Test: `apps/web/src/stores/canvasEditor.refine.test.ts`（更新）

**Interfaces:**
- Produces: `RefineSidePanel` 仅 docked 布局；store 不再导出 `refineChrome/refinePanelWidth/refinePanelCollapsed`。Task 7 消费此状态收敛。

- [ ] **Step 1: 全局搜索引用面**

Run: `cd apps/web && grep -rn "refineChrome\|refinePanelWidth\|refinePanelCollapsed\|setRefineChrome" src/ --include='*.vue' --include='*.ts' | grep -v test`
Expected: 引用集中于 `canvasEditor.ts`、`RefineSidePanel.vue`、`refineChrome.ts`、`refineWorkLayout.ts`（仅类型入参）。逐一处理：

- `canvasEditor.ts`：删状态与函数；`resetRefineChromeState()` 删去对应行（保留 loupe/mask 等重置）。
- `RefineSidePanel.vue`：删 `floating` computed、`floatPos`、`dragging/dragOffset/resizing` 变量及其 mousemove/mouseup 监听、`panelStyle` 的 floating 分支（保留 docked/narrow 两支）；删除对应模板头部拖拽把手节点。
- `refineWorkLayout.ts`：`refineWorkInsetRight` 的 `chrome` 入参删除（调用方 GridSliceWorkbench 传 `{ innerWidth, collapsed, panelWidth }`）。
- `refineChrome.ts`：删 `RefineChromeMode` 类型。

- [ ] **Step 2: 更新 store 测试**

`canvasEditor.refine.test.ts` 中所有 `setRefineChrome` / `refineChrome` / `refinePanelWidth` 相关断言删除；追加锁定：

```ts
it('no longer exposes floating chrome state', () => {
  const editor = useCanvasEditorStore()
  expect('refineChrome' in editor).toBe(false)
  expect('refinePanelWidth' in editor).toBe(false)
  expect('refinePanelCollapsed' in editor).toBe(false)
})
```

- [ ] **Step 3: 运行确认通过**

Run: `cd apps/web && pnpm vitest run src/stores/ src/components/canvas/refine/`
Expected: PASS。再跑 `npx vue-tsc -b --noEmit`（或 `pnpm --filter @lnkpi/web exec vue-tsc -b`）确认无类型残留。
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/stores/canvasEditor.ts apps/web/src/stores/canvasEditor.refine.test.ts apps/web/src/components/canvas/refine/ apps/web/src/components/canvas/grid-slice/GridSliceWorkbench.vue
git commit -m "refactor(refine): freeze floating chrome, docked-only layout"
```

---

### Task 7: 抽取 useWorkbenchPanel 收敛双工作台

**Files:**
- Create: `apps/web/src/components/canvas/workbench/useWorkbenchPanel.ts`
- Modify: `apps/web/src/components/canvas/grid-slice/GridSliceWorkbench.vue`
- Modify: `apps/web/src/components/canvas/refine/RefineSidePanel.vue`
- Test: `apps/web/src/components/canvas/workbench/useWorkbenchPanel.test.ts`（新建）

**Interfaces:**
- Produces:

```ts
export function useWorkbenchPanel(options: {
  defaultWidth: number
  busy: () => boolean
  onClose: () => void
}): {
  panelWidth: Ref<number>
  collapsed: Ref<boolean>
  isNarrow: Ref<boolean>
  insetRight: ComputedRef<number>
  setPanelWidth: (w: number) => void
  setCollapsed: (v: boolean) => void
}
```

（内部封装：`syncNarrow` resize 监听、Escape→busy 守卫→onClose、`refineWorkInsetRight` docked 计算，挂载/卸载生命周期。）

- [ ] **Step 1: 写 composable 测试（先红）**

```ts
import { describe, expect, it, vi } from 'vitest'
import { useWorkbenchPanel } from './useWorkbenchPanel'

describe('useWorkbenchPanel', () => {
  it('clamps panel width into [360, 560] and syncs narrow below 640px', () => {
    vi.stubGlobal('innerWidth', 500)
    const { panelWidth, isNarrow, setPanelWidth, setCollapsed } = useWorkbenchPanel({
      defaultWidth: 400,
      busy: () => false,
      onClose: vi.fn(),
    })
    expect(isNarrow.value).toBe(true)
    setPanelWidth(999)
    expect(panelWidth.value).toBeLessThanOrEqual(560)
    setCollapsed(true)
    expect(panelWidth.value).toBe(400) // narrow 下折叠被禁止时的兜底
    vi.unstubAllGlobals()
  })

  it('escape triggers onClose unless busy', () => {
    let busy = false
    const onClose = vi.fn()
    useWorkbenchPanel({ defaultWidth: 400, busy: () => busy, onClose })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    busy = true
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
```

Run: `cd apps/web && pnpm vitest run src/components/canvas/workbench/useWorkbenchPanel.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 2: 实现 composable**

```ts
import { computed, onBeforeUnmount, onMounted, ref, type ComputedRef, type Ref } from 'vue'
import { refineWorkInsetRight } from '@/components/canvas/refine/refineWorkLayout'

const MIN_W = 360
const MAX_W = 560

export function useWorkbenchPanel(options: {
  defaultWidth: number
  busy: () => boolean
  onClose: () => void
}): {
  panelWidth: Ref<number>
  collapsed: Ref<boolean>
  isNarrow: Ref<boolean>
  insetRight: ComputedRef<number>
  setPanelWidth: (w: number) => void
  setCollapsed: (v: boolean) => void
} {
  const panelWidth = ref(Math.min(MAX_W, Math.max(MIN_W, options.defaultWidth)))
  const collapsed = ref(false)
  const isNarrow = ref(false)

  const insetRight = computed(() =>
    refineWorkInsetRight({
      innerWidth: typeof window !== 'undefined' ? window.innerWidth : 1280,
      collapsed: collapsed.value,
      panelWidth: panelWidth.value,
    }),
  )

  function syncNarrow() {
    isNarrow.value = typeof window !== 'undefined' && window.innerWidth < 640
    if (isNarrow.value) collapsed.value = false
  }

  function setPanelWidth(w: number) {
    panelWidth.value = Math.min(MAX_W, Math.max(MIN_W, w))
  }

  function setCollapsed(v: boolean) {
    if (isNarrow.value && v) return
    collapsed.value = v
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || options.busy()) return
    event.preventDefault()
    options.onClose()
  }

  onMounted(() => {
    syncNarrow()
    window.addEventListener('resize', syncNarrow)
    window.addEventListener('keydown', onKeydown)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('resize', syncNarrow)
    window.removeEventListener('keydown', onKeydown)
  })

  return { panelWidth, collapsed, isNarrow, insetRight, setPanelWidth, setCollapsed }
}
```

同时把 `refineWorkLayout.ts` 的 `refineWorkInsetRight` 签名收敛为 `{ innerWidth, collapsed, panelWidth }`（Task 6 已删 chrome 入参）。

- [ ] **Step 3: 双工作台接入**

- `GridSliceWorkbench.vue`：删除本地 `panelWidth/collapsed/isNarrow/syncNarrow/insetRight/onKeydown` 及生命周期监听，改用 `const wb = useWorkbenchPanel({ defaultWidth: PANEL_DEFAULT_W, busy: () => props.busy, onClose })`，模板 `:collapsed="wb.collapsed.value"` 等替换（setup 解构即可）。
- `RefineSidePanel.vue`：同样替换 `panelWidth/collapsed/isNarrow` 逻辑；`REFINE_MIN_W/MAX_W` 常量删除（边界移入 composable）；宽度过 store 的 watch 保留但改用 `wb.setPanelWidth`。

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/web && pnpm vitest run src/components/canvas/workbench/ src/components/canvas/grid-slice/ src/stores/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/canvas/workbench/ apps/web/src/components/canvas/grid-slice/GridSliceWorkbench.vue apps/web/src/components/canvas/refine/RefineSidePanel.vue
git commit -m "refactor(workbench): extract shared useWorkbenchPanel for refine and grid-slice"
```

---

### Task 8: 收尾验证与 PR

**Files:** 无新改动

- [ ] **Step 1: 本地验证四条（AGENTS.md 规定）**

```bash
pnpm install --frozen-lockfile
pnpm --filter @lnkpi/server exec prisma generate
pnpm build
pnpm --filter @lnkpi/agent test
```

Expected: 全部通过（注意本地若有 `packages/shared/dist.bak/` 等残留先移走，避免 vitest 假失败）。

- [ ] **Step 2: 手动验收清单**

1. 单击图片节点 → 操作条 → 宫格裁剪 → 悬停 3×2 显示「3 × 2 · 共 6 张」→ 单击 → 6 子节点 3 列 2 行落位。
2. 触屏模拟（DevTools）→ 第一次点选高亮、第二次确认。
3. 双击节点 → 灯箱出现「编辑」→ 点击进入精修 → 关闭。
4. 资产面板打开预览 → 无「编辑」按钮。
5. 右键图片节点 → 下载图片/存入资产库生效。
6. 单击选中条 → 图标三组布局正确；点击下载/存库图标生效；节点无 url 时两个图标不渲染；缩放 <0.5 时文字标签隐藏、图标仍可点。
7. hover 节点 → 仅 预览/替换/ⓘ 三按钮，原下载/存库/编辑 chip 不再出现。
8. 精修面板仅 docked；Esc 关闭工作台；busy 时 Esc 无效。
9. 控制台无报错（含 localStorage 残留相关）。

- [ ] **Step 3: push + PR**

```bash
git push -u origin feature/image-editor-m1-entry-unification
```

PR 标题：`feat: image editor M1 — unified entry points, grid slice picker, workbench consolidation`

PR Summary 引用 spec `docs/superpowers/specs/2026-09-21-image-editor-unified-design.md` §3；Test plan 勾选本地验证四条 + 上述手动清单。CI（ci.yml）全绿后 Squash Merge。

---

## Self-Review 记录

- **Spec 覆盖**：M1 范围 = spec §3.2 入口动线（Task 3/4/5）、§3.4 宫格选择器（Task 1/2）、§4.2 chrome 冻结（Task 6）+ WorkbenchShell 抽取（Task 7）。spec 中「hover 收敛为 2」按 Global Constraints 微调为 3（替换按钮保留），已在 Review Focus 提示验收。
- **占位符扫描**：无 TBD/TODO；所有代码步骤给出实际代码。
- **类型一致性**：`slice: [cols, rows]` 在 Task 1（组件 emit）→ Task 2（ActionBar 转发 + CanvasPage handler）签名一致；`useWorkbenchPanel` 签名在 Task 7 定义与测试一致。
- **Review Focus 对应测试**：触屏两段确认→Task 1；空 nodeId→Task 5；refineBusy 守卫→Task 5；非正方形落位与残留→Task 1/6 测试 + Task 8 手动清单。
