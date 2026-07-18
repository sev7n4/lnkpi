<script setup lang="ts">
defineProps<{
  generating?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  generate: []
}>()
</script>

<template>
  <button
    type="button"
    class="dock-generate-btn"
    :disabled="disabled || generating"
    :title="generating ? '生成中...' : '生成'"
    aria-label="生成"
    @click="emit('generate')"
  >
    <svg
      v-if="generating"
      class="dock-generate-btn__spinner"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
    >
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
    <svg
      v-else
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  </button>
</template>

<style scoped>
.dock-generate-btn {
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: #fff;
  color: #111;
  cursor: pointer;
  transition:
    transform 0.15s ease,
    opacity 0.15s ease,
    background 0.15s ease;
}

.dock-generate-btn:hover:not(:disabled) {
  background: #f3f3f3;
  transform: scale(1.05);
}

.dock-generate-btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.dock-generate-btn__spinner {
  animation: dock-gen-spin 0.9s linear infinite;
}

@keyframes dock-gen-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
