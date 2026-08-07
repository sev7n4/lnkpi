<script setup lang="ts">
import { computed } from 'vue'
import type { NodeRef } from '@/composables/useNodeRefs'
import { resolveMediaUrl } from '@/services/api-base'

const props = defineProps<{
  refItem: NodeRef
  x: number
  y: number
}>()

const emit = defineEmits<{
  mouseenter: []
  mouseleave: []
}>()

const mediaUrl = computed(() => {
  const raw = props.refItem.payload.url ?? props.refItem.preview ?? ''
  return raw ? resolveMediaUrl(raw) : ''
})

const textContent = computed(() => {
  return props.refItem.payload.text ?? props.refItem.preview ?? ''
})

const style = computed(() => {
  const margin = 12
  let left = props.x
  let top = props.y
  if (typeof window !== 'undefined') {
    if (left + 360 > window.innerWidth - margin) left = window.innerWidth - 360 - margin
    if (top + 280 > window.innerHeight - margin) top = Math.max(margin, props.y - 280)
    left = Math.max(margin, left)
    top = Math.max(margin, top)
  }
  return { left: `${left}px`, top: `${top}px` }
})
</script>

<template>
  <Teleport to="body">
    <div
      class="agent-ref-hover-preview pointer-events-auto fixed z-[130] w-[340px] max-h-[min(420px,70vh)] overflow-hidden rounded-xl border border-white/12 bg-[rgba(24,24,24,0.96)] shadow-2xl backdrop-blur-xl"
      :style="style"
      @mouseenter="emit('mouseenter')"
      @mouseleave="emit('mouseleave')"
    >
      <div class="flex items-center border-b border-white/8 px-3 py-2">
        <span class="truncate text-xs text-white/70">{{ refItem.refKey }} · {{ refItem.label }}</span>
      </div>

      <div class="p-3">
        <p
          v-if="refItem.mediaType === 'text'"
          class="max-h-[280px] overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-white/80"
        >
          {{ textContent || '（空文本）' }}
        </p>

        <img
          v-else-if="refItem.mediaType === 'image' && mediaUrl"
          :src="mediaUrl"
          alt=""
          class="max-h-[300px] w-full rounded-lg object-contain"
        >

        <video
          v-else-if="refItem.mediaType === 'video' && mediaUrl"
          :src="mediaUrl"
          controls
          class="pointer-events-auto max-h-[300px] w-full rounded-lg"
        />

        <audio
          v-else-if="refItem.mediaType === 'audio' && mediaUrl"
          :src="mediaUrl"
          controls
          class="pointer-events-auto w-full"
        />

        <p v-else class="text-xs text-white/40">暂无可预览内容</p>
      </div>
    </div>
  </Teleport>
</template>
