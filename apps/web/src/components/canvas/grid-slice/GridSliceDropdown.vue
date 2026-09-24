<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  canSliceAtCell,
  gridSlicePresetOptions,
  resolveDropdownPlacement,
} from '@/utils/gridSlice'

const GRID_PICKER_MAX = 7 // 与 packages/shared/src/gridSlice.ts 的 MAX_GRID 对齐
/** 右面板（标题 + 7×7 格阵 + 预览入口）估算高度，用于弹出方向判定 */
const MENU_ESTIMATED_HEIGHT = 260

const props = withDefaults(
  defineProps<{
    disabled?: boolean
    loading?: boolean
    disabledTitle?: string
    /** 原图像素尺寸；缺省时不做 64px 下限拦截 */
    image?: { width: number; height: number } | null
  }>(),
  {
    disabled: false,
    loading: false,
    disabledTitle: '',
    image: null,
  },
)

const emit = defineEmits<{
  slice: [cols: number, rows: number]
  'open-custom': []
}>()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const placement = ref<'bottom' | 'top'>('bottom')
const hover = ref<{ cols: number; rows: number } | null>(null)
const lastTapped = ref<string | null>(null)

const blocked = computed(() => props.disabled || props.loading)

const presetOptions = computed(() => gridSlicePresetOptions())

const GRID_SLICE_LOADING_TEXT = '切分中 · 大图约需数十秒'

const triggerLabel = computed(() =>
  props.loading ? GRID_SLICE_LOADING_TEXT : '宫格切分 ▾',
)

const triggerTitle = computed(() => {
  if (props.loading) return GRID_SLICE_LOADING_TEXT
  if (props.disabled) return props.disabledTitle || '当前图片不可切分'
  return '宫格切分'
})

const readout = computed(() => (hover.value ? `${hover.value.cols} x ${hover.value.rows}` : '—'))

const disabledHint = computed(() => `单格不足 ${64}px，无法切分`)

function presetCols(n: number) {
  return Math.sqrt(n)
}

function isPresetDisabled(n: number) {
  if (!props.image) return false
  const c = presetCols(n)
  return !canSliceAtCell(props.image, c, c)
}

function isCellDisabled(cols: number, rows: number) {
  if (!props.image) return false
  return !canSliceAtCell(props.image, cols, rows)
}

function updatePlacement() {
  const root = rootRef.value
  if (!root) return
  const rect = root.getBoundingClientRect()
  placement.value = resolveDropdownPlacement(
    window.innerHeight - rect.bottom,
    rect.top,
    MENU_ESTIMATED_HEIGHT,
  )
}

function close() {
  open.value = false
  // 重置选择态，避免重开后残留高亮 / 触摸两次点选跨次不一致
  hover.value = null
  lastTapped.value = null
}

function toggle() {
  if (blocked.value) return
  open.value = !open.value
  if (open.value) updatePlacement()
}

function pickPreset(n: number) {
  if (blocked.value || isPresetDisabled(n)) return
  const c = presetCols(n)
  close()
  emit('slice', c, c)
}

function openCustomPanel() {
  // 双面板常显（2026-09-24 用户反馈「选自定义看不到宫格」）：右面板随菜单常驻，
  // 此入口仅作视觉锚点，不再承担展开职责。
}

function onCellEnter(cols: number, rows: number, pointerType: string) {
  if (pointerType === 'touch') return
  hover.value = { cols, rows }
}

function onCellClick(cols: number, rows: number, pointerType: string | undefined) {
  if (isCellDisabled(cols, rows)) return
  const key = `${cols}-${rows}`
  // touch 无 pointerenter：无 hover 且无 pointerType 时，首次点击视为触摸点选
  const isTouch = pointerType === 'touch' || (pointerType === undefined && !hover.value)
  if (isTouch && lastTapped.value !== key) {
    lastTapped.value = key
    hover.value = { cols, rows }
    return
  }
  if (blocked.value) return
  close()
  emit('slice', cols, rows)
}

function pickPreview() {
  if (blocked.value) return
  close()
  emit('open-custom')
}

function onDocumentPointerDown(event: PointerEvent) {
  const root = rootRef.value
  if (!root || !open.value) return
  if (event.target instanceof Node && root.contains(event.target)) return
  close()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="rootRef" class="grid-slice-dropdown relative">
    <button
      type="button"
      class="toolbar-action"
      :class="{ 'is-loading': loading }"
      :disabled="blocked"
      :title="triggerTitle"
      :aria-label="triggerTitle"
      :aria-expanded="open"
      aria-haspopup="menu"
      @click.stop="toggle"
    >
      <!-- 与 bar 内其他按钮统一为纯图标样式（2026-09-22 用户验收）；文字保留在 DOM/title，
           loading 时恢复可见（「切分中」是必要的进行中反馈，图标无法表达） -->
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
      <span class="label">{{ triggerLabel }}</span>
    </button>
    <div
      v-if="open && !blocked"
      class="neo-chrome grid-slice-menu grid-slice-solid absolute left-0 z-[2] flex rounded-xl p-2"
      :class="placement === 'top' ? 'bottom-full mb-1' : 'top-full mt-1'"
      role="menu"
      @click.stop
    >
      <!-- 左面板：预设文字列表 -->
      <div class="grid-slice-panel" data-panel="presets">
        <button
          v-for="opt in presetOptions"
          :key="opt.n"
          type="button"
          class="grid-slice-item"
          role="menuitem"
          :data-preset="opt.n"
          :disabled="isPresetDisabled(opt.n)"
          :title="isPresetDisabled(opt.n) ? disabledHint : opt.label"
          @click="pickPreset(opt.n)"
        >
          {{ opt.label }}
        </button>
        <button
          type="button"
          class="grid-slice-item custom"
          role="menuitem"
          data-testid="custom-toggle"
          :data-active="'true'"
          @click="openCustomPanel"
        >
          自定义 ›
        </button>
      </div>
      <!-- 右面板：自定义 7×7 格阵 + 实时读数（常显，竞品同款双面板） -->
      <div class="grid-slice-panel grid-slice-panel-custom" data-panel="custom">
        <div class="grid-slice-panel-head">
          <span class="grid-slice-panel-title">自定义宫格</span>
          <span class="grid-slice-readout" data-testid="readout">{{ readout }}</span>
        </div>
        <div class="grid" style="grid-template-columns: repeat(7, 22px); gap: 3px">
          <template v-for="r in GRID_PICKER_MAX" :key="`row-${r}`">
            <button
              v-for="c in GRID_PICKER_MAX"
              :key="`cell-${c}-${r}`"
              type="button"
              class="grid-cell"
              :data-cell="`${c}-${r}`"
              :data-active="hover && c <= hover.cols && r <= hover.rows ? 'true' : 'false'"
              :disabled="isCellDisabled(c, r)"
              :title="isCellDisabled(c, r) ? disabledHint : `${c} x ${r}`"
              @pointerenter="onCellEnter(c, r, $event.pointerType)"
              @click="onCellClick(c, r, $event.pointerType)"
            />
          </template>
        </div>
        <button
          type="button"
          class="grid-slice-item preview"
          data-testid="preview-entry"
          @click="pickPreview"
        >
          预览切分效果…
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toolbar-action {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  border-radius: 0.5rem;
  padding: 0.375rem 0.5rem;
  font-size: 11px;
  line-height: 1.25;
  color: var(--neo-text);
  transition: background 0.15s ease, opacity 0.15s ease;
  white-space: nowrap;
}
/* 图标 + 文字常显（2026-09-24 用户要求：上沿菜单按钮统一图标+文字）；loading 时文案换为进度提示 */
.toolbar-action .label { display: inline; }
.toolbar-action.is-loading .label { display: inline; }
.toolbar-action:hover:not(:disabled) {
  background: color-mix(in srgb, var(--neo-text) 8%, transparent);
}
.toolbar-action:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
/* 实底背景：随浮层 counter-scale 后保持恒定尺寸，杜绝图片透出混叠 */
.grid-slice-solid {
  min-width: 200px;
  background: var(--neo-chrome-bg);
  box-shadow: var(--neo-chrome-shadow);
}
.grid-slice-panel {
  display: flex;
  flex-direction: column;
  min-width: 132px;
}
.grid-slice-panel-custom {
  margin-left: 0.5rem;
  padding-left: 0.6rem;
  border-left: 1px solid color-mix(in srgb, var(--neo-text) 12%, transparent);
}
.grid-slice-panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  margin: 2px 2px 6px;
}
.grid-slice-panel-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--neo-text);
}
.grid-slice-readout {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--neo-text);
  opacity: 0.75;
}
/* 竞品同款中性灰格子（2026-09-24 用户反馈：紫色高亮 + 描边空格与整体不符）：
   填充式灰块、无描边；hover 区域提亮，不再使用 accent 紫 */
.grid-cell {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  border: none;
  background: color-mix(in srgb, var(--neo-text) 15%, transparent);
  padding: 0;
  transition: background 0.12s ease;
}
.grid-cell[data-active='true'] {
  background: color-mix(in srgb, var(--neo-text) 42%, transparent);
}
.grid-cell:hover:not(:disabled) {
  background: color-mix(in srgb, var(--neo-text) 42%, transparent);
}
.grid-cell:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}
.grid-slice-item {
  display: block;
  width: 100%;
  padding: 0.3rem 0.7rem;
  text-align: left;
  font-size: 11px;
  line-height: 1.25;
  color: var(--neo-text);
  transition: background 0.15s ease;
  white-space: nowrap;
}
.grid-slice-item:hover:not(:disabled) {
  background: color-mix(in srgb, var(--neo-text) 8%, transparent);
}
.grid-slice-item:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
.grid-slice-item.custom {
  margin-top: 0.15rem;
  border-top: 1px solid color-mix(in srgb, var(--neo-text) 12%, transparent);
  padding-top: 0.4rem;
}
.grid-slice-item.custom[data-active='true'] {
  background: color-mix(in srgb, var(--neo-text) 10%, transparent);
}
.grid-slice-item.preview {
  margin-top: 0.4rem;
  border-top: 1px solid color-mix(in srgb, var(--neo-text) 12%, transparent);
  padding-top: 0.4rem;
  color: color-mix(in srgb, var(--neo-text) 72%, transparent);
}
</style>
