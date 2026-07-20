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
    :class="{ 'is-generating': generating }"
    :disabled="disabled"
    :title="generating ? '点击取消生成' : '生成'"
    :aria-label="generating ? '取消生成' : '生成'"
    @click.stop="emit('generate')"
  >
    <!-- Stop square while generating — clearer cancel affordance than a spinner-only control -->
    <svg
      v-if="generating"
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
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
      aria-hidden="true"
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
  pointer-events: auto;
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

.dock-generate-btn.is-generating {
  background: #111;
  color: #fff;
  opacity: 1 !important;
  pointer-events: auto !important;
  cursor: pointer;
}

.dock-generate-btn.is-generating:hover:not(:disabled) {
  background: #333;
}
</style>
