<script setup lang="ts">
import { computed } from 'vue'
import type { MediaRefWarningLevel } from '@lnkpi/shared'
import { formatMediaBytes, formatMediaDimensions } from '@/utils/mediaInfoFormat'

const props = defineProps<{
  width?: number
  height?: number
  bytes?: number
  model?: string
  refWarning?: MediaRefWarningLevel
}>()

const parts = computed(() => {
  const line: string[] = []
  const dims = formatMediaDimensions(props.width, props.height)
  if (dims) line.push(dims)
  const size = formatMediaBytes(props.bytes)
  if (size) line.push(size)
  if (props.model?.trim()) line.push(props.model.trim())
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
