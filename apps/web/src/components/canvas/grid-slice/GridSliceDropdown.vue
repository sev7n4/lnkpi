<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

const GRID_SLICE_SQUARE_PRESETS = [2, 3, 4, 5, 6, 7] as const

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
  'quick-slice': [n: number]
  'open-custom': []
}>()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)

const blocked = computed(() => props.disabled || props.loading)

const triggerLabel = computed(() => (props.loading ? '裁剪中…' : '宫格裁剪 ▾'))

const triggerTitle = computed(() => {
  if (props.loading) return '裁剪中…'
  if (props.disabled) return props.disabledTitle || '当前图片不可裁剪'
  return '宫格裁剪'
})

function close() {
  open.value = false
}

function toggle() {
  if (blocked.value) return
  open.value = !open.value
}

function pickPreset(n: number) {
  if (blocked.value) return
  close()
  emit('quick-slice', n)
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
    <div
      v-if="open && !blocked"
      class="neo-chrome grid-slice-menu absolute left-0 top-full z-[2] mt-1 min-w-[7.5rem] rounded-xl py-1"
      role="menu"
      @click.stop
    >
      <button
        v-for="n in GRID_SLICE_SQUARE_PRESETS"
        :key="n"
        type="button"
        class="grid-slice-item"
        role="menuitem"
        @click="pickPreset(n)"
      >
        {{ n }}×{{ n }}
      </button>
      <button type="button" class="grid-slice-item custom" role="menuitem" @click="pickCustom">
        自定义…
      </button>
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
