<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import type { MentionOption } from '@/components/canvas/MentionInput.vue'
import NodeEditorToolbar from '@/components/canvas/NodeEditorToolbar.vue'
import { getAbsolutePosition, getNodeSize, type FlowNode } from '@/composables/useCanvasGrouping'

const props = defineProps<{
  node: EditableFlowNode | null
  mentions?: MentionOption[]
  generating?: boolean
}>()

const emit = defineEmits<{
  patch: [patch: Record<string, unknown>]
  generate: []
  close: []
}>()

const { viewport, nodes: flowNodes, findNode } = useVueFlow()

const flowPos = ref<{ x: number; y: number } | null>(null)
const toolbarWidth = 460

function updatePosition() {
  if (!props.node) {
    flowPos.value = null
    return
  }
  const allNodes = flowNodes.value as unknown as FlowNode[]
  const flowNode = findNode(props.node.id) as FlowNode | undefined
  const type = String(props.node.type ?? '')
  const sizeNode = flowNode ?? ({ ...props.node, type } as FlowNode)
  const abs = getAbsolutePosition(sizeNode, allNodes)
  const { w, h } = getNodeSize(sizeNode)
  flowPos.value = {
    x: abs.x + w / 2,
    y: abs.y + h + 16,
  }
}

let raf = 0
function scheduleUpdate() {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(updatePosition)
}

watch(() => props.node?.id, scheduleUpdate, { immediate: true })
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

const toolbarStyle = computed(() => {
  if (!flowPos.value) return { display: 'none' }
  return {
    left: `${flowPos.value.x}px`,
    top: `${flowPos.value.y}px`,
    width: `${toolbarWidth}px`,
    transform: 'translate(-50%, 0)',
  }
})
</script>

<template>
  <!-- 与节点同坐标系：随缩放/平移，避免屏幕坐标错位 -->
  <div
    v-if="node && flowPos"
    class="node-editor-toolbar-layer pointer-events-none absolute inset-0 z-[1000] overflow-visible"
  >
    <div class="origin-top-left" :style="transformStyle">
      <div
        class="pointer-events-auto absolute"
        :style="toolbarStyle"
      >
        <NodeEditorToolbar
          :node="node"
          :mentions="mentions"
          :generating="generating"
          @patch="emit('patch', $event)"
          @generate="emit('generate')"
          @close="emit('close')"
        />
      </div>
    </div>
  </div>
</template>
