<script setup lang="ts">
import { computed, ref } from 'vue'
import type { NodeRef, RefMediaType } from '@/composables/useNodeRefs'
import DockTypeIcon from './DockTypeIcon.vue'
import AgentRefHoverPreview from '@/components/agent/AgentRefHoverPreview.vue'
import { resolveMediaUrl } from '@/services/api-base'
import type { DockNodeIconKind } from './dockIcons'

const props = defineProps<{
  refItem: NodeRef
  draggable?: boolean
  dragging?: boolean
  dragOver?: boolean
  /** When true, click inserts @refKey into prompt (agent-aligned). */
  mentionable?: boolean
}>()

const emit = defineEmits<{
  mention: [refKey: string]
  remove: []
  dragstart: [event: DragEvent]
  dragover: [event: DragEvent]
  dragleave: []
  drop: [event: DragEvent]
  dragend: []
}>()

const previewOpen = ref(false)
const previewPos = ref({ x: 0, y: 0 })
const hoverTimer = ref<number | null>(null)
const isHoveringPreview = ref(false)

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

function clearHoverTimer() {
  if (hoverTimer.value !== null) {
    window.clearTimeout(hoverTimer.value)
    hoverTimer.value = null
  }
}

function onEnter(event: MouseEvent) {
  clearHoverTimer()
  previewPos.value = { x: event.clientX + 8, y: event.clientY + 8 }
  hoverTimer.value = window.setTimeout(() => {
    previewOpen.value = true
  }, 200)
}

function onLeave() {
  clearHoverTimer()
  hoverTimer.value = window.setTimeout(() => {
    if (!isHoveringPreview.value) previewOpen.value = false
  }, 80)
}

function onPreviewEnter() {
  clearHoverTimer()
  isHoveringPreview.value = true
}

function onPreviewLeave() {
  isHoveringPreview.value = false
  previewOpen.value = false
}

function onRemoveClick(event: MouseEvent) {
  event.stopPropagation()
  emit('remove')
}

function onClick() {
  if (props.refItem.stale) return
  if (props.mentionable !== false) {
    emit('mention', props.refItem.refKey)
  }
}
</script>

<template>
  <div
    class="dock-ref-chip"
    :class="{
      'is-stale': refItem.stale,
      'is-dragging': dragging,
      'is-drag-over': dragOver,
      'has-media': !!thumbUrl,
    }"
    :draggable="draggable"
    :title="`${refItem.refKey} · ${refItem.label}`"
    role="button"
    tabindex="0"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    @click="onClick"
    @keydown.enter.prevent="onClick"
    @dragstart="emit('dragstart', $event)"
    @dragover="emit('dragover', $event)"
    @dragleave="emit('dragleave')"
    @drop="emit('drop', $event)"
    @dragend="emit('dragend')"
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

  <AgentRefHoverPreview
    v-if="previewOpen"
    :ref-item="refItem"
    :x="previewPos.x"
    :y="previewPos.y"
    @mouseenter="onPreviewEnter"
    @mouseleave="onPreviewLeave"
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
  border: 1px solid var(--neo-border-strong);
  border-radius: 8px;
  background: var(--neo-hover-bg);
  color: var(--neo-text-secondary);
  cursor: pointer;
  user-select: none;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    opacity 0.15s ease;
}

.dock-ref-chip:active[draggable='true'] {
  cursor: grabbing;
}

.dock-ref-chip.is-dragging {
  opacity: 0.45;
}

.dock-ref-chip.is-drag-over {
  border-color: var(--neo-accent-border);
  background: var(--neo-accent-soft);
}

.dock-ref-chip.is-stale {
  border-style: dashed;
  border-color: var(--neo-border);
  background: var(--neo-hover-bg);
  color: var(--neo-text-muted);
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
  color: var(--neo-text-primary);
  pointer-events: none;
}

.dock-ref-chip.has-media .dock-ref-chip__key {
  color: rgba(255, 255, 255, 0.9);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
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
