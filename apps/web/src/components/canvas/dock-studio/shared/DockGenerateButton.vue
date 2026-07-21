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
  background: var(--neo-hi-bg);
  color: var(--neo-hi-text);
  cursor: pointer;
  pointer-events: auto;
  box-shadow: var(--neo-hi-shadow);
  transition:
    transform 0.15s ease,
    opacity 0.15s ease,
    filter 0.15s ease,
    box-shadow 0.15s ease;
}

.dock-generate-btn:hover:not(:disabled) {
  filter: brightness(1.06);
  transform: scale(1.05);
}

.dock-generate-btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.dock-generate-btn.is-generating {
  background: var(--neo-surface-elevated);
  color: var(--neo-text-primary);
  opacity: 1 !important;
  pointer-events: auto !important;
  cursor: pointer;
  box-shadow: 0 0 0 2px var(--neo-accent-border);
}

.dock-generate-btn.is-generating:hover:not(:disabled) {
  filter: brightness(1.15);
}
</style>
