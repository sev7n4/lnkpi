<script setup lang="ts">
import { computed } from 'vue'
import type { MediaRefWarningLevel } from '@lnkpi/shared'
import { formatMediaBytes, formatMediaDimensions } from '@/utils/mediaInfoFormat'

const props = defineProps<{
  kind?: 'image' | 'video'
  width?: number
  height?: number
  bytes?: number
  aspectRatio?: string
  resolution?: string
  refWarning?: MediaRefWarningLevel
}>()

const parts = computed(() => {
  const line: string[] = []
  const size = formatMediaBytes(props.bytes)
  if (props.kind === 'video') {
    if (props.resolution?.trim()) line.push(props.resolution.trim())
    if (props.aspectRatio?.trim()) line.push(props.aspectRatio.trim())
    if (size) line.push(size)
    return line
  }
  const dims = formatMediaDimensions(props.width, props.height)
  if (dims) line.push(dims)
  if (props.aspectRatio?.trim()) line.push(props.aspectRatio.trim())
  if (size) line.push(size)
  return line
})

const refWarningLabel = computed(() => {
  if (props.refWarning === 'error') return 'ref 过大'
  if (props.refWarning === 'warn') return 'ref 偏大'
  return null
})
</script>

<template>
  <div v-if="parts.length || refWarningLabel" class="neo-media-info-summary nodrag">
    <span v-if="parts.length" class="neo-media-info-summary-text">{{ parts.join(' · ') }}</span>
    <span
      v-if="refWarningLabel"
      class="neo-media-info-summary-warn"
      :class="refWarning === 'error' ? 'is-error' : 'is-warn'"
      :title="refWarningLabel"
    >
      ⚠ {{ refWarningLabel }}
    </span>
  </div>
</template>
