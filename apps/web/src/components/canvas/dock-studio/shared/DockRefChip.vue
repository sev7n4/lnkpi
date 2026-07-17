<script setup lang="ts">
import { computed } from 'vue'
import type { NodeRef, RefMediaType } from '@/composables/useNodeRefs'

const props = defineProps<{
  refItem: NodeRef
  draggable?: boolean
  dragging?: boolean
  dragOver?: boolean
}>()

const emit = defineEmits<{
  remove: []
}>()

const MEDIA_DOT: Record<RefMediaType, string> = {
  text: 'bg-sky-400',
  image: 'bg-emerald-400',
  video: 'bg-violet-400',
  audio: 'bg-amber-400',
}

const MEDIA_ICON: Record<RefMediaType, string> = {
  text: 'T',
  image: '🖼',
  video: '▶',
  audio: '♪',
}

const thumbUrl = computed(() => {
  if (props.refItem.mediaType !== 'image') return ''
  return props.refItem.payload.url ?? props.refItem.preview
})

function onRemoveClick(event: MouseEvent) {
  event.stopPropagation()
  emit('remove')
}
</script>

<template>
  <div
    class="dock-ref-chip"
    :class="{
      'is-stale': refItem.stale,
      'is-dragging': dragging,
      'is-drag-over': dragOver,
    }"
    :draggable="draggable"
    :title="refItem.label"
  >
    <span class="dock-ref-chip__key">{{ refItem.refKey }}</span>
    <span
      class="dock-ref-chip__dot"
      :class="MEDIA_DOT[refItem.mediaType]"
      aria-hidden="true"
    />
    <img
      v-if="thumbUrl"
      :src="thumbUrl"
      alt=""
      class="dock-ref-chip__thumb"
      draggable="false"
    >
    <span v-else class="dock-ref-chip__icon" aria-hidden="true">
      {{ MEDIA_ICON[refItem.mediaType] }}
    </span>
    <span class="dock-ref-chip__label">{{ refItem.label }}</span>
    <button
      type="button"
      class="dock-ref-chip__remove"
      aria-label="移除引用"
      @click="onRemoveClick"
    >
      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.dock-ref-chip {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 5px;
  height: 30px;
  max-width: 168px;
  padding: 0 6px 0 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  background: rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.82);
  cursor: grab;
  user-select: none;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    opacity 0.15s ease;
}

.dock-ref-chip:active {
  cursor: grabbing;
}

.dock-ref-chip.is-dragging {
  opacity: 0.45;
}

.dock-ref-chip.is-drag-over {
  border-color: rgba(129, 140, 248, 0.55);
  background: rgba(99, 102, 241, 0.12);
}

.dock-ref-chip.is-stale {
  border-style: dashed;
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.38);
  cursor: default;
}

.dock-ref-chip__key {
  flex-shrink: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: rgba(255, 255, 255, 0.55);
}

.dock-ref-chip.is-stale .dock-ref-chip__key {
  color: rgba(255, 255, 255, 0.28);
}

.dock-ref-chip__dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 999px;
}

.dock-ref-chip.is-stale .dock-ref-chip__dot {
  background: rgba(255, 255, 255, 0.22) !important;
}

.dock-ref-chip__thumb {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  object-fit: cover;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.dock-ref-chip.is-stale .dock-ref-chip__thumb {
  opacity: 0.45;
  filter: grayscale(1);
}

.dock-ref-chip__icon {
  flex-shrink: 0;
  width: 14px;
  font-size: 10px;
  line-height: 1;
  text-align: center;
  opacity: 0.75;
}

.dock-ref-chip__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
}

.dock-ref-chip__remove {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: -2px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: rgba(255, 255, 255, 0.35);
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.dock-ref-chip__remove:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.85);
}
</style>
