<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { clampGridDims } from '@/utils/gridSlice'

const GRID_SLICE_SQUARE_PRESETS = [2, 3, 4, 5, 6, 7] as const
const PANEL_MIN_W = 360
const PANEL_MAX_W = 560
const PANEL_COLLAPSED_W = 44

const props = withDefaults(
  defineProps<{
    imageWidth?: number
    imageHeight?: number
    cols: number
    rows: number
    busy?: boolean
    collapsed?: boolean
    isNarrow?: boolean
    panelWidth?: number
  }>(),
  {
    busy: false,
    collapsed: false,
    isNarrow: false,
    panelWidth: 400,
  },
)

const emit = defineEmits<{
  'apply-grid': [dims: { cols: number; rows: number }]
  confirm: [dims: { cols: number; rows: number }]
  close: []
  'update:collapsed': [value: boolean]
  'update:panelWidth': [value: number]
}>()

const draftCols = ref(props.cols)
const draftRows = ref(props.rows)
let resizing = false

const sizeLabel = computed(() => {
  const w = props.imageWidth
  const h = props.imageHeight
  if (typeof w === 'number' && w > 0 && typeof h === 'number' && h > 0) {
    return `${w} × ${h} px`
  }
  return ''
})

const cellCount = computed(() => props.cols * props.rows)
const confirmLabel = computed(() => `裁剪 ${cellCount.value} 张`)

const panelStyle = computed(() => {
  const width = props.collapsed
    ? PANEL_COLLAPSED_W
    : props.isNarrow
      ? undefined
      : props.panelWidth
  return {
    top: '0',
    right: '0',
    bottom: '0',
    width: props.isNarrow ? '100%' : `${width}px`,
  }
})

watch(
  () => [props.cols, props.rows] as const,
  ([cols, rows]) => {
    draftCols.value = cols
    draftRows.value = rows
  },
)

function pickPreset(n: number) {
  if (props.busy) return
  const dims = clampGridDims(n, n)
  draftCols.value = dims.cols
  draftRows.value = dims.rows
  emit('apply-grid', dims)
}

function applyDraft() {
  if (props.busy) return
  const dims = clampGridDims(Number(draftCols.value), Number(draftRows.value))
  draftCols.value = dims.cols
  draftRows.value = dims.rows
  emit('apply-grid', dims)
}

function confirm() {
  if (props.busy) return
  emit('confirm', { cols: props.cols, rows: props.rows })
}

function toggleCollapsed() {
  if (props.isNarrow) return
  emit('update:collapsed', !props.collapsed)
}

function startResize(event: MouseEvent) {
  event.preventDefault()
  resizing = true
  window.addEventListener('mousemove', onResize)
  window.addEventListener('mouseup', stopResize)
}

function onResize(event: MouseEvent) {
  if (!resizing) return
  const next = Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, window.innerWidth - event.clientX))
  emit('update:panelWidth', next)
}

function stopResize() {
  resizing = false
  window.removeEventListener('mousemove', onResize)
  window.removeEventListener('mouseup', stopResize)
}

onMounted(() => {
  window.addEventListener('mouseup', stopResize)
})

onBeforeUnmount(() => {
  stopResize()
})
</script>

<template>
  <Teleport to="body">
    <aside
      class="refine-side grid-slice-side"
      :class="{ 'is-collapsed': collapsed }"
      :style="panelStyle"
      @click.stop
    >
      <div v-if="!collapsed && !isNarrow" class="refine-resize" title="拖拉调整宽度" @mousedown="startResize" />
      <header class="refine-side__head">
        <div class="flex min-w-0 items-center gap-1">
          <button
            v-if="!isNarrow"
            type="button"
            class="refine-side__collapse"
            :title="collapsed ? '展开宫格侧栏' : '收缩宫格侧栏'"
            @click="toggleCollapsed"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75">
              <path v-if="collapsed" stroke-linecap="round" stroke-linejoin="round" d="M15 6 9 12l6 6" />
              <path v-else stroke-linecap="round" stroke-linejoin="round" d="M9 6l6 6-6 6" />
            </svg>
          </button>
          <span v-if="!collapsed" class="refine-side__title">宫格裁剪</span>
          <span v-if="!collapsed && sizeLabel" class="grid-slice-side__size">· {{ sizeLabel }}</span>
        </div>
        <button
          v-if="!collapsed"
          type="button"
          class="refine-side__icon-btn"
          title="关闭"
          :disabled="busy"
          @click="emit('close')"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.75">
            <path stroke-linecap="round" d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </header>
      <div v-show="!collapsed" class="refine-side__body">
        <div class="grid-slice-side__presets">
          <button
            v-for="n in GRID_SLICE_SQUARE_PRESETS"
            :key="n"
            type="button"
            class="refine-dock__chip"
            :class="{ 'is-active': cols === n && rows === n }"
            :disabled="busy"
            @click="pickPreset(n)"
          >
            {{ n }}×{{ n }}
          </button>
        </div>

        <div class="grid-slice-side__dims">
          <label class="grid-slice-side__field">
            列
            <input v-model.number="draftCols" type="number" min="1" max="7" :disabled="busy">
          </label>
          <label class="grid-slice-side__field">
            行
            <input v-model.number="draftRows" type="number" min="1" max="7" :disabled="busy">
          </label>
          <button type="button" class="refine-dock__apply" :disabled="busy" @click="applyDraft">
            应用划分
          </button>
        </div>

        <p class="refine-dock__hint">当前 {{ cols }} × {{ rows }} = {{ cellCount }} 格</p>

        <div class="bottom-toolbar-actions refine-dock__actions">
          <button type="button" class="refine-dock__apply" :disabled="busy" @click="emit('close')">
            取消
          </button>
          <button
            type="button"
            class="refine-dock__primary grid-slice-dock__primary"
            :disabled="busy"
            @click="confirm"
          >
            {{ confirmLabel }}
          </button>
        </div>
      </div>
    </aside>
  </Teleport>
</template>

<style scoped>
.grid-slice-side {
  position: fixed;
  z-index: 55;
  display: flex;
  min-height: 0;
  flex-direction: column;
  background: var(--neo-surface, #111);
  color: var(--neo-text-primary);
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.28);
}

.grid-slice-side.is-collapsed {
  overflow: hidden;
}

.grid-slice-side.is-collapsed .refine-side__head {
  flex-direction: column;
  justify-content: flex-start;
  padding: 8px 4px;
}

.refine-side__collapse {
  display: inline-flex;
  height: 28px;
  width: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--neo-text-muted);
  cursor: pointer;
}

.refine-side__collapse:hover {
  background: var(--neo-hover-bg);
  color: var(--neo-text-primary);
}

.refine-resize {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 3;
  width: 6px;
  cursor: ew-resize;
}

.refine-side__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--neo-border);
}

.refine-side__title {
  font-size: 13px;
  font-weight: 600;
}

.grid-slice-side__size {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--neo-text-muted);
  font-size: 12px;
  font-weight: 500;
}

.refine-side__icon-btn {
  display: inline-flex;
  height: 28px;
  width: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--neo-text-muted);
  cursor: pointer;
}

.refine-side__icon-btn:hover {
  background: var(--neo-hover-bg);
  color: var(--neo-text-primary);
}

.refine-side__icon-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.refine-side__body {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
  padding: 10px 12px 16px;
}

.grid-slice-side__presets,
.grid-slice-side__dims,
.refine-dock__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.refine-dock__chip,
.refine-dock__apply {
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--neo-border);
  border-radius: 999px;
  background: transparent;
  color: var(--neo-text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.refine-dock__chip.is-active,
.refine-dock__chip:hover,
.refine-dock__apply:hover {
  border-color: var(--neo-border-strong);
  color: var(--neo-text-primary);
}

.refine-dock__chip:disabled,
.refine-dock__apply:disabled,
.refine-dock__primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.grid-slice-side__field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--neo-text-muted);
}

.grid-slice-side__field input {
  width: 3.25rem;
  height: 26px;
  border: 1px solid var(--neo-border);
  border-radius: 8px;
  background: var(--neo-hover-bg);
  padding: 0 6px;
  color: var(--neo-text-primary);
  font-size: 12px;
}

.refine-dock__hint {
  margin: 0;
  font-size: 11px;
  color: var(--neo-text-muted);
}

.refine-dock__primary {
  height: 28px;
  padding: 0 14px;
  border: none;
  border-radius: 999px;
  background: var(--neo-hi-bg);
  color: var(--neo-hi-text);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.refine-dock__actions {
  justify-content: flex-end;
  margin-top: auto;
}
</style>
