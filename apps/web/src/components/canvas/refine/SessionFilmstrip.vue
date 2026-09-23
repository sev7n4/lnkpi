<script setup lang="ts">
import type { RefineSessionResult } from '@/stores/canvasEditor'

const props = defineProps<{
  results: RefineSessionResult[]
  currentId: string | null
  disabled?: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
}>()

function onSelect(id: string) {
  if (props.disabled) return
  emit('select', id)
}
</script>

<template>
  <div class="session-filmstrip" data-testid="session-filmstrip">
    <button
      v-for="r in results"
      :key="r.id"
      type="button"
      class="filmstrip-item"
      :class="{ 'is-current': r.id === currentId }"
      :data-id="r.id"
      data-testid="filmstrip-item"
      :disabled="disabled"
      :title="r.prompt || r.id"
      @click="onSelect(r.id)"
    >
      <img class="filmstrip-thumb neo-checkerboard" :src="r.url" :alt="r.prompt || r.id" draggable="false" />
    </button>
  </div>
</template>

<style scoped>
.session-filmstrip {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  padding: 4px 0;
}

.filmstrip-item {
  flex: 0 0 auto;
  padding: 2px;
  border: 1px solid var(--neo-border);
  border-radius: 6px;
  background: none;
  cursor: pointer;
  line-height: 0;
}

.filmstrip-item.is-current {
  border-color: var(--neo-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--neo-accent) 30%, transparent);
}

.filmstrip-item:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.filmstrip-thumb {
  height: 44px;
  width: auto;
  border-radius: 4px;
  object-fit: cover;
  pointer-events: none;
}
</style>
