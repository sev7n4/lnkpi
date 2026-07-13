<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { getBezierPath, Position, useVueFlow } from '@vue-flow/core'
import { getSelectionFrame } from '@/composables/useCanvasGrouping'

const props = defineProps<{
  selectedIds: string[]
}>()

const emit = defineEmits<{
  connectTarget: [targetNodeId: string]
  connectBlank: [clientX: number, clientY: number]
}>()

const { viewport, nodes: flowNodes } = useVueFlow()

const dragging = ref(false)
const dragTarget = ref({ x: 0, y: 0 })

const visible = computed(() => props.selectedIds.length >= 2)

const frame = computed(() => getSelectionFrame(flowNodes.value, props.selectedIds))

const handleScreen = computed(() => {
  if (!frame.value) return null
  const zoom = viewport.value.zoom
  return {
    x: frame.value.connectX * zoom + viewport.value.x,
    y: frame.value.connectY * zoom + viewport.value.y,
  }
})

const previewPath = computed(() => {
  if (!dragging.value || !frame.value) return ''
  const zoom = viewport.value.zoom
  const sourceX = frame.value.connectX
  const sourceY = frame.value.connectY
  const target = {
    x: (dragTarget.value.x - viewport.value.x) / zoom,
    y: (dragTarget.value.y - viewport.value.y) / zoom,
  }
  const [d] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition: Position.Right,
    targetX: target.x,
    targetY: target.y,
    targetPosition: Position.Left,
  })
  return d
})

const previewLayerStyle = computed(() => ({
  transform: `translate(${viewport.value.x}px, ${viewport.value.y}px) scale(${viewport.value.zoom})`,
  transformOrigin: '0 0',
}))

function onHandleMouseDown(event: MouseEvent) {
  if (!handleScreen.value) return
  event.preventDefault()
  event.stopPropagation()
  dragging.value = true
  dragTarget.value = { x: event.clientX, y: event.clientY }
}

function onMouseMove(event: MouseEvent) {
  if (!dragging.value) return
  dragTarget.value = { x: event.clientX, y: event.clientY }
}

function onMouseUp(event: MouseEvent) {
  if (!dragging.value) return
  dragging.value = false
  const { clientX, clientY } = event

  const targetNode = document.elementFromPoint(clientX, clientY)?.closest('.vue-flow__node') as HTMLElement | null
  const targetId = targetNode?.dataset.id
  if (targetId && !props.selectedIds.includes(targetId)) {
    emit('connectTarget', targetId)
    return
  }

  const droppedOnHandle = document.elementFromPoint(clientX, clientY)?.closest('.vue-flow__handle')
  if (droppedOnHandle) {
    const nodeEl = droppedOnHandle.closest('.vue-flow__node') as HTMLElement | null
    const handleTargetId = nodeEl?.dataset.id
    if (handleTargetId && !props.selectedIds.includes(handleTargetId)) {
      emit('connectTarget', handleTargetId)
      return
    }
  }

  if (targetNode) return

  emit('connectBlank', clientX, clientY)
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') dragging.value = false
}

watch(() => props.selectedIds, () => {
  dragging.value = false
})

onMounted(() => {
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <template v-if="visible && handleScreen">
    <div
      class="neo-node-wrapper is-active show-handles multi-select-batch-handle pointer-events-none absolute z-[47]"
      :style="{
        left: `${handleScreen.x}px`,
        top: `${handleScreen.y}px`,
        transform: 'translate(-50%, -50%)',
      }"
    >
      <div
        class="vue-flow__handle vue-flow__handle-right neo-flow-handle multi-select-batch-handle__hit"
        :class="{ connecting: dragging, connectionindicator: dragging }"
        title="批量连线：拖到目标节点或空白处"
        @mousedown="onHandleMouseDown"
      >
        <div class="handle-hitbox" />
        <div class="handle-plus">
          <div class="handle-plus-inner" />
        </div>
      </div>
    </div>

    <svg
      v-if="dragging && previewPath"
      class="multi-select-connect-preview pointer-events-none absolute left-0 top-0 z-[46] h-full w-full overflow-visible"
      :style="previewLayerStyle"
    >
      <path
        :d="previewPath"
        fill="none"
        stroke="#7c3aed"
        stroke-width="2"
        stroke-linecap="round"
        class="connect-picker-line-path"
      />
    </svg>
  </template>
</template>

<style scoped>
.multi-select-batch-handle__hit {
  position: relative;
  right: auto;
  top: auto;
  left: auto;
  bottom: auto;
  transform: none;
  cursor: crosshair;
  pointer-events: auto;
}
</style>
