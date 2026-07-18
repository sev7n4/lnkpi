<script setup lang="ts">
import { computed, ref } from 'vue'
import type { NodeRef, RefMediaType } from '@/composables/useNodeRefs'
import DockTypeIcon from './DockTypeIcon.vue'
import DockRefPreview from './DockRefPreview.vue'
import { resolveMediaUrl } from '@/services/api-base'
import type { DockNodeIconKind } from './dockIcons'

const props = defineProps<{
  refItem: NodeRef
  draggable?: boolean
  dragging?: boolean
  dragOver?: boolean
}>()

const emit = defineEmits<{
  remove: []
}>()

const previewOpen = ref(false)
const previewPos = ref({ x: 0, y: 0 })

const MEDIA_ICON: Record<RefMediaType, DockNodeIconKind> = {
  text: 'text',
  image: 'image',
  video: 'video',
  audio: 'audio',
}

const thumbUrl = computed(() => {
  if (props.refItem.mediaType !== 'image' && props.refItem.mediaType !== 'video') return ''
  const raw = props.refItem.payload.url ?? props.refItem.preview
  return raw ? resolveMediaUrl(raw) : ''
})

function onRemoveClick(event: MouseEvent) {
  event.stopPropagation()
  emit('remove')
}

function onChipClick(event: MouseEvent) {
  if (props.refItem.stale) return
  previewPos.value = { x: event.clientX + 8, y: event.clientY + 8 }
  previewOpen.value = true
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
    :title="`${refItem.refKey} · ${refItem.label}`"
    role="button"
    tabindex="0"
    @click="onChipClick"
    @keydown.enter.prevent="onChipClick($event as unknown as MouseEvent)"
  >
    <span class="dock-ref-chip__key">{{ refItem.refKey }}</span>

    <img
      v-if="thumbUrl && refItem.mediaType === 'image'"
      :src="thumbUrl"
      alt=""
      class="dock-ref-chip__media"
      draggable="false"
    >
    <video
      v-else-if="thumbUrl && refItem.mediaType === 'video'"
      :src="thumbUrl"
      class="dock-ref-chip__media"
      muted
      playsinline
      preload="metadata"
      draggable="false"
    />
    <span v-else class="dock-ref-chip__icon" aria-hidden="true">
      <DockTypeIcon :icon="MEDIA_ICON[refItem.mediaType]" :size="14" />
    </span>

    <button
      type="button"
      class="dock-ref-chip__remove"
      aria-label="移除引用"
      @click="onRemoveClick"
    >
      <svg viewBox="0 0 24 24" width="8" height="8" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  </div>

  <DockRefPreview
    v-if="previewOpen"
    :ref-item="refItem"
    :x="previewPos.x"
    :y="previewPos.y"
    @close="previewOpen = false"
  />
</template>

<style scoped>
.dock-ref-chip {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.35);
  color: rgba(255, 255, 255, 0.75);
  cursor: pointer;
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
  color: rgba(255, 255, 255, 0.3);
  cursor: default;
}

.dock-ref-chip__key {
  position: absolute;
  top: 1px;
  left: 2px;
  z-index: 1;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 8px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.02em;
  color: rgba(255, 255, 255, 0.85);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  pointer-events: none;
}

.dock-ref-chip__media {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.dock-ref-chip.is-stale .dock-ref-chip__media {
  opacity: 0.4;
  filter: grayscale(1);
}

.dock-ref-chip__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0.75;
}

.dock-ref-chip__remove {
  position: absolute;
  top: 1px;
  right: 1px;
  z-index: 2;
  display: none;
  width: 14px;
  height: 14px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.65);
  color: rgba(255, 255, 255, 0.85);
}

.dock-ref-chip:hover .dock-ref-chip__remove {
  display: inline-flex;
}

.dock-ref-chip__remove:hover {
  background: rgba(239, 68, 68, 0.75);
}
</style>
