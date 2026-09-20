<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

const GRID_PICKER_MAX = 7 // 与 packages/shared/src/gridSlice.ts 的 MAX_GRID 对齐

const props = withDefaults(
  defineProps<{
    disabled?: boolean
    loading?: boolean
    disabledTitle?: string
  }>(),
  {
    disabled: false,
    loading: false,
    disabledTitle: '',
  },
)

const emit = defineEmits<{
  slice: [cols: number, rows: number]
  'open-custom': []
}>()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const hover = ref<{ cols: number; rows: number } | null>(null)
const lastTapped = ref<string | null>(null)

const blocked = computed(() => props.disabled || props.loading)

const triggerLabel = computed(() => (props.loading ? '裁剪中…' : '宫格裁剪 ▾'))

const triggerTitle = computed(() => {
  if (props.loading) return '裁剪中…'
  if (props.disabled) return props.disabledTitle || '当前图片不可裁剪'
  return '宫格裁剪'
})

const label = computed(() =>
  hover.value ? `${hover.value.cols} × ${hover.value.rows} · 共 ${hover.value.cols * hover.value.rows} 张` : '悬停选择切分规格',
)

function close() {
  open.value = false
  // 重置选择态，避免重开后残留高亮 / 触摸两次点选跨次不一致
  hover.value = null
  lastTapped.value = null
}

function toggle() {
  if (blocked.value) return
  open.value = !open.value
}

function isPreset(c: number, r: number) {
  return (c === 2 && r === 2) || (c === 3 && r === 3)
}

function onCellEnter(cols: number, rows: number, pointerType: string) {
  if (pointerType === 'touch') return
  hover.value = { cols, rows }
}

function onCellClick(cols: number, rows: number, pointerType: string | undefined) {
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

function pickCustom() {
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
      :disabled="blocked"
      :title="triggerTitle"
      :aria-expanded="open"
      aria-haspopup="menu"
      @click.stop="toggle"
    >
      {{ triggerLabel }}
    </button>
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
  </div>
</template>

<style scoped>
.toolbar-action {
  border-radius: 0.5rem;
  padding: 0.25rem 0.625rem;
  font-size: 11px;
  line-height: 1.25;
  color: var(--neo-text);
  transition: background 0.15s ease, opacity 0.15s ease;
  white-space: nowrap;
}
.toolbar-action:hover:not(:disabled) {
  background: color-mix(in srgb, var(--neo-text) 8%, transparent);
}
.toolbar-action:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.grid-slice-menu {
  min-width: 100%;
}
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
.grid-slice-item {
  display: block;
  width: 100%;
  padding: 0.3rem 0.7rem;
  text-align: left;
  font-size: 11px;
  line-height: 1.25;
  color: var(--neo-text);
  transition: background 0.15s ease;
}
.grid-slice-item:hover {
  background: color-mix(in srgb, var(--neo-text) 8%, transparent);
}
.grid-slice-item.custom {
  margin-top: 0.15rem;
  border-top: 1px solid color-mix(in srgb, var(--neo-text) 12%, transparent);
  padding-top: 0.4rem;
}
</style>
