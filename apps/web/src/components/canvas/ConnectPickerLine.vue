<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useVueFlow, getBezierPath, Position } from '@vue-flow/core'

const props = defineProps<{
  sourceNodeId: string
  sourceHandleId?: string | null
  targetX: number
  targetY: number
}>()

const { findNode, viewport, screenToFlowCoordinate } = useVueFlow()

const oppositePosition: Record<string, Position> = {
  [Position.Left]: Position.Right,
  [Position.Right]: Position.Left,
  [Position.Top]: Position.Bottom,
  [Position.Bottom]: Position.Top,
}

const pathD = ref('')

function resolveHandleCenter(
  node: NonNullable<ReturnType<typeof findNode>>,
  handle: { x: number; y: number; width: number; height: number; position?: string },
) {
  const baseX = handle.x + node.computedPosition.x
  const baseY = handle.y + node.computedPosition.y
  const position = (handle.position as Position) ?? Position.Right

  switch (position) {
    case Position.Top:
      return { x: baseX + handle.width / 2, y: baseY, position }
    case Position.Right:
      return { x: baseX + handle.width, y: baseY + handle.height / 2, position }
    case Position.Bottom:
      return { x: baseX + handle.width / 2, y: baseY + handle.height, position }
    case Position.Left:
    default:
      return { x: baseX, y: baseY + handle.height / 2, position }
  }
}

function updatePath() {
  const node = findNode(props.sourceNodeId)
  const handles = node?.handleBounds?.source
  if (!node || !handles?.length) {
    pathD.value = ''
    return
  }

  const handle = (props.sourceHandleId
    ? handles.find((entry) => entry.id === props.sourceHandleId)
    : handles[0]) ?? handles[0]
  if (!handle) {
    pathD.value = ''
    return
  }

  const source = resolveHandleCenter(node, handle)
  const target = screenToFlowCoordinate({ x: props.targetX, y: props.targetY })
  const targetPosition = oppositePosition[source.position] ?? Position.Left

  const [d] = getBezierPath({
    sourceX: source.x,
    sourceY: source.y,
    sourcePosition: source.position,
    targetX: target.x,
    targetY: target.y,
    targetPosition,
  })
  pathD.value = d
}

let raf = 0
function scheduleUpdate() {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(updatePath)
}

watch(
  () => [props.sourceNodeId, props.sourceHandleId, props.targetX, props.targetY],
  scheduleUpdate,
)
watch(viewport, scheduleUpdate, { deep: true })

onMounted(scheduleUpdate)
onUnmounted(() => cancelAnimationFrame(raf))

const targetPoint = computed(() => screenToFlowCoordinate({ x: props.targetX, y: props.targetY }))

const layerStyle = computed(() => ({
  transform: `translate(${viewport.value.x}px, ${viewport.value.y}px) scale(${viewport.value.zoom})`,
  transformOrigin: '0 0',
}))
</script>

<template>
  <svg
    v-if="pathD"
    class="connect-picker-line pointer-events-none absolute left-0 top-0 z-[1000] h-full w-full overflow-visible"
    :style="layerStyle"
  >
    <path
      :d="pathD"
      fill="none"
      stroke="#7c3aed"
      stroke-width="2"
      stroke-linecap="round"
      class="connect-picker-line-path"
    />
    <circle
      :cx="targetPoint.x"
      :cy="targetPoint.y"
      r="4"
      fill="#7c3aed"
    />
  </svg>
</template>

<style scoped>
.connect-picker-line-path {
  stroke-dasharray: 5;
  animation: connect-picker-dash 0.5s linear infinite;
}

@keyframes connect-picker-dash {
  from {
    stroke-dashoffset: 10;
  }
}
</style>
