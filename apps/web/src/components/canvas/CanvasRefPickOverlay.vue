<script setup lang="ts">
defineProps<{
  pickedCount: number
}>()

const emit = defineEmits<{
  done: []
}>()
</script>

<template>
  <div class="canvas-ref-pick-overlay" aria-live="polite">
    <div class="canvas-ref-pick-vignette" />
    <div class="canvas-ref-pick-bar neo-glass-lite pointer-events-auto">
      <span class="canvas-ref-pick-bar__hint">
        点选节点加入引用
        <span v-if="pickedCount > 0" class="canvas-ref-pick-bar__count">· 已选 {{ pickedCount }}</span>
      </span>
      <button type="button" class="canvas-ref-pick-bar__done neo-ctl rounded-lg px-2.5 py-1 text-[11px] font-medium" @click="emit('done')">
        完成
      </button>
      <span class="canvas-ref-pick-bar__esc text-[10px] text-[var(--neo-text-muted)]">Esc</span>
    </div>
  </div>
</template>

<style scoped>
.canvas-ref-pick-overlay {
  position: absolute;
  inset: 0;
  z-index: 45;
  pointer-events: none;
}

.canvas-ref-pick-vignette {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.22);
  pointer-events: none;
}

.canvas-ref-pick-bar {
  position: absolute;
  top: 12px;
  left: 50%;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(420px, calc(100% - 24px));
  padding: 8px 12px;
  border-radius: 999px;
  transform: translateX(-50%);
}

.canvas-ref-pick-bar__hint {
  font-size: 12px;
  font-weight: 500;
  color: var(--neo-text-primary);
  white-space: nowrap;
}

.canvas-ref-pick-bar__count {
  color: var(--neo-hi-text);
}

.canvas-ref-pick-bar__done {
  flex-shrink: 0;
  background: var(--neo-hi-bg);
  color: var(--neo-hi-text);
  box-shadow: var(--neo-hi-shadow);
}

.canvas-ref-pick-bar__esc {
  flex-shrink: 0;
}
</style>
