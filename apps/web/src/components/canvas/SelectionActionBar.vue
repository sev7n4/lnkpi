<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { getAbsolutePosition, getNodeSize, type FlowNode } from '@/composables/useCanvasGrouping'

/**
 * 挂载方式：节点坐标系（与 NodeEditorToolbarOverlay 同模式）。
 * 随 VueFlow viewport 缩放/平移，避免屏幕坐标贴 bbox 在缩放时错位。
 */
const props = defineProps<{
  node: FlowNode
  imageUpscale: boolean
  loading?: boolean
}>()

const emit = defineEmits<{
  upscale: []
  edit: []
}>()

const { viewport, nodes: flowNodes, findNode } = useVueFlow()

const flowPos = ref<{ x: number; y: number } | null>(null)
const barWidth = 168

function updatePosition() {
  const allNodes = flowNodes.value as unknown as FlowNode[]
  const flowNode = findNode(props.node.id) as FlowNode | undefined
  const type = String(props.node.type ?? '')
  const sizeNode = flowNode ?? ({ ...props.node, type } as FlowNode)
  const abs = getAbsolutePosition(sizeNode, allNodes)
  const { w } = getNodeSize(sizeNode)
  flowPos.value = {
    x: abs.x + w / 2,
    y: abs.y - 44,
  }
}

let raf = 0
function scheduleUpdate() {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(updatePosition)
}

watch(
  () => props.node?.id,
  () => {
    updatePosition()
  },
  { immediate: true },
)
watch(viewport, scheduleUpdate, { deep: true })
watch(flowNodes, scheduleUpdate, { deep: true })

onMounted(() => {
  scheduleUpdate()
  window.addEventListener('resize', scheduleUpdate)
})

onUnmounted(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('resize', scheduleUpdate)
})

const transformStyle = computed(() => ({
  transform: `translate(${viewport.value.x}px, ${viewport.value.y}px) scale(${viewport.value.zoom})`,
  transformOrigin: '0 0',
}))

const barStyle = computed(() => {
  if (!flowPos.value) return { display: 'none' }
  return {
    left: `${flowPos.value.x}px`,
    top: `${flowPos.value.y}px`,
    width: `${barWidth}px`,
    transform: 'translate(-50%, 0)',
  }
})

const upscaleDisabled = computed(() => !props.imageUpscale || Boolean(props.loading))
const upscaleTitle = computed(() => {
  if (props.loading) return '放大中…'
  if (!props.imageUpscale) return '当前环境未启用图像放大'
  return '放大 2×'
})

function onUpscale() {
  if (upscaleDisabled.value) return
  emit('upscale')
}
</script>

<template>
  <div
    v-if="flowPos"
    class="selection-action-bar-layer pointer-events-none absolute inset-0 z-[46] overflow-visible"
  >
    <div class="origin-top-left" :style="transformStyle">
      <div class="pointer-events-auto absolute" :style="barStyle">
        <div
          class="neo-chrome flex items-center justify-center gap-1 rounded-xl px-1.5 py-1"
          @click.stop
        >
          <button
            type="button"
            class="toolbar-action accent"
            :disabled="upscaleDisabled"
            :title="upscaleTitle"
            @click="onUpscale"
          >
            {{ loading ? '放大中…' : '放大' }}
          </button>
          <button
            type="button"
            class="toolbar-action"
            title="编辑图像"
            @click="emit('edit')"
          >
            编辑
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toolbar-action {
  border-radius: 0.5rem;
  padding: 0.25rem 0.625rem;
  font-size: 11px;
  line-height: 1.25;
  color: var(--neo-text);
  transition: background 0.15s ease, opacity 0.15s ease;
}
.toolbar-action:hover:not(:disabled) {
  background: color-mix(in srgb, var(--neo-text) 8%, transparent);
}
.toolbar-action.accent {
  color: var(--neo-accent, #5b8def);
  font-weight: 600;
}
.toolbar-action:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
</style>
