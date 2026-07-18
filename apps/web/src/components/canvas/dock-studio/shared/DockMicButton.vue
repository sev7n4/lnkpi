<script setup lang="ts">
defineProps<{
  listening?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  toggle: []
}>()
</script>

<template>
  <button
    type="button"
    class="dock-mic-btn"
    :class="{ 'is-listening': listening }"
    title="语音输入"
    aria-label="语音输入"
    :disabled="disabled"
    @click="emit('toggle')"
  >
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="22" />
    </svg>
  </button>
</template>

<style scoped>
.dock-mic-btn {
  display: inline-flex;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: rgba(255, 255, 255, 0.55);
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.dock-mic-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
}

.dock-mic-btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.dock-mic-btn.is-listening {
  color: #f87171;
  animation: dock-mic-pulse 1.2s ease-in-out infinite;
}

@keyframes dock-mic-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}
</style>
