<script setup lang="ts">
defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{ back: [] }>()

function onClick() {
  emit('back')
}
</script>

<template>
  <!-- 精修模式下唯一保留的画布级控件（spec P0-13）。纯退出，生成中置灰（P0-14）。
       follow-up #1：只留 ← 图标（文字进 title / aria-label），同时减小与左栏工具条的争用面。 -->
  <button
    type="button"
    class="neo-chrome pointer-events-auto flex h-9 w-9 items-center justify-center rounded-xl transition"
    data-testid="refine-canvas-back"
    title="返回画布"
    aria-label="返回画布"
    :disabled="disabled"
    @click="onClick"
  >
    <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
    </svg>
  </button>
</template>

<style scoped>
button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
