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
