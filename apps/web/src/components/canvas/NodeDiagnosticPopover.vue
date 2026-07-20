<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

defineProps<{
  userMessage: string
  hint?: string
  loading?: boolean
  copyLabel?: string
}>()

const emit = defineEmits<{
  copy: []
  close: []
}>()

const root = ref<HTMLElement | null>(null)

function onDocPointerDown(e: PointerEvent) {
  const el = root.value
  if (!el) return
  if (e.target instanceof Node && el.contains(e.target)) return
  emit('close')
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown, true)
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true)
})
</script>

<template>
  <div
    ref="root"
    class="neo-task-diag-pop nodrag nopan"
    role="dialog"
    aria-label="诊断信息"
    @pointerdown.stop
    @mousedown.stop
    @click.stop
  >
    <p class="neo-task-diag-msg">{{ loading ? '加载中…' : userMessage }}</p>
    <p v-if="!loading && hint" class="neo-task-diag-hint">{{ hint }}</p>
    <button
      type="button"
      class="neo-task-diag-copy"
      :disabled="loading"
      @click.stop="emit('copy')"
    >
      {{ copyLabel || '复制诊断' }}
    </button>
  </div>
</template>
