<script setup lang="ts">
import CanvasLocatePinIcon from '@/components/shared/CanvasLocatePinIcon.vue'

withDefaults(
  defineProps<{
    size?: number
    title?: string
    label?: string
    pulse?: boolean
  }>(),
  { size: 12, title: '在画布中定位' },
)

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()
</script>

<template>
  <button
    type="button"
    class="neo-locate-btn"
    :class="{ 'neo-locate-btn--pulse': pulse, 'neo-locate-btn--with-label': Boolean(label) }"
    :title="title"
    :aria-label="title"
    @click="emit('click', $event)"
  >
    <CanvasLocatePinIcon :size="size" />
    <span v-if="label" class="neo-locate-btn__label">{{ label }}</span>
  </button>
</template>

<style scoped>
.neo-locate-btn {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--neo-text-muted);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}

.neo-locate-btn--with-label {
  width: auto;
  min-width: 24px;
  padding: 0 8px;
  border-radius: 8px;
}

.neo-locate-btn__label {
  font-size: 10px;
  line-height: 1;
}

.neo-locate-btn:hover {
  color: var(--neo-hi-text);
  background: var(--neo-hover-bg);
  border-color: var(--neo-border);
}

.neo-locate-btn--pulse {
  animation: neo-locate-pulse 2s ease-out 1;
}

@keyframes neo-locate-pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--neo-hi-bg) 55%, transparent);
  }
  40% {
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--neo-hi-bg) 25%, transparent);
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}
</style>
