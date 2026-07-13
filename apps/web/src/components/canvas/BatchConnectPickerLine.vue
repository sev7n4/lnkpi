<script setup lang="ts">
import { computed } from 'vue'
import { getBezierPath, Position, useVueFlow } from '@vue-flow/core'
import { getSelectionFrame } from '@/composables/useCanvasGrouping'

const props = defineProps<{
  selectedIds: string[]
  targetX: number
  targetY: number
}>()

const { viewport, nodes: flowNodes } = useVueFlow()

const frame = computed(() => getSelectionFrame(flowNodes.value, props.selectedIds))

const previewPath = computed(() => {
  if (!frame.value) return ''
  const zoom = viewport.value.zoom
  const target = {
    x: (props.targetX - viewport.value.x) / zoom,
    y: (props.targetY - viewport.value.y) / zoom,
  }
  const [d] = getBezierPath({
    sourceX: frame.value.connectX,
    sourceY: frame.value.connectY,
    sourcePosition: Position.Right,
    targetX: target.x,
    targetY: target.y,
    targetPosition: Position.Left,
  })
  return d
})

const layerStyle = computed(() => ({
  transform: `translate(${viewport.value.x}px, ${viewport.value.y}px) scale(${viewport.value.zoom})`,
  transformOrigin: '0 0',
}))
</script>

<template>
  <svg
    v-if="previewPath"
    class="batch-connect-picker-line pointer-events-none absolute left-0 top-0 z-[999] h-full w-full overflow-visible"
    :style="layerStyle"
  >
    <path
      :d="previewPath"
      fill="none"
      stroke="#818cf8"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-dasharray="6 4"
    />
  </svg>
</template>
