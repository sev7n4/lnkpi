<script setup lang="ts">
import { computed, ref } from 'vue'
import { MiniMap } from '@vue-flow/minimap'
import { useVueFlow } from '@vue-flow/core'
import type { MinimapExpandedState } from '@/composables/useCanvasViewportSettings'

const props = defineProps<{
  expanded: MinimapExpandedState
  nodes: Array<{ id: string; type?: string; data: Record<string, unknown> }>
}>()

const emit = defineEmits<{
  'update:expanded': [state: MinimapExpandedState]
}>()

const { fitView } = useVueFlow()
const search = ref('')

const typeLabels: Record<string, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  audio: '音频',
  sceneComposer: '导演台',
  mediaInput: '媒体输入',
  videoComposition: '视频合成',
  worldModel: '3D World',
  shot: '分镜',
  group: '分组',
  prompt: '提示词',
}

const filteredNodes = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.nodes
  return props.nodes.filter((n) => {
    const data = n.data
    const label = String(data.title ?? data.prompt ?? data.content ?? n.id).toLowerCase()
    const type = String(n.type ?? '').toLowerCase()
    return label.includes(q) || type.includes(q)
  })
})

const groupedNodes = computed(() => {
  const map = new Map<string, typeof filteredNodes.value>()
  for (const node of filteredNodes.value) {
    const key = String(node.type ?? 'other')
    const bucket = map.get(key) ?? []
    bucket.push(node)
    map.set(key, bucket)
  }
  return [...map.entries()]
})

function focusNode(id: string) {
  void fitView({ nodes: [id], padding: 0.4, duration: 250, maxZoom: 1.1 })
}

function nodeLabel(node: { id: string; type?: string; data: Record<string, unknown> }) {
  const data = node.data
  return String(data.title ?? data.prompt ?? data.content ?? node.id).slice(0, 36)
}

function miniMapNodeColor(node: { type?: string }) {
  const map: Record<string, string> = {
    text: 'rgba(125, 211, 252, 0.75)',
    image: 'rgba(110, 231, 183, 0.75)',
    video: 'rgba(167, 139, 250, 0.75)',
    audio: 'rgba(34, 211, 238, 0.75)',
    shot: 'rgba(129, 140, 248, 0.8)',
    group: 'rgba(192, 132, 252, 0.5)',
    prompt: 'rgba(129, 140, 248, 0.55)',
  }
  return map[String(node.type ?? '')] ?? 'rgba(255, 255, 255, 0.35)'
}
</script>

<template>
  <!-- 隐藏态：不渲染面板，由左下缩放栏控制 -->
  <div
    v-if="expanded > 0"
    class="workflow-minimap-panel mb-2"
    :class="expanded === 2 ? 'is-list' : 'is-compact'"
  >
    <div class="panel-header">
      <span class="text-[10px] font-medium text-white/50">
        {{ expanded === 2 ? '节点列表' : '导航小地图' }}
      </span>
      <div class="flex gap-0.5">
        <button
          v-if="expanded === 1"
          type="button"
          class="header-btn text-[#818cf8]"
          title="展开节点列表"
          @click="emit('update:expanded', 2)"
        >
          列表
        </button>
        <button
          v-if="expanded === 2"
          type="button"
          class="header-btn"
          title="返回缩略图"
          @click="emit('update:expanded', 1)"
        >
          地图
        </button>
        <button type="button" class="header-btn" title="隐藏" @click="emit('update:expanded', 0)">×</button>
      </div>
    </div>

    <!-- 状态 1：缩略图 -->
    <div v-if="expanded === 1" class="minimap-body compact">
      <MiniMap
        :pannable="true"
        :zoomable="true"
        :node-color="miniMapNodeColor"
        mask-color="rgba(99, 102, 241, 0.15)"
        mask-stroke-color="rgba(129, 140, 248, 0.7)"
        :mask-stroke-width="1.5"
        class="neo-minimap"
      />
    </div>

    <!-- 状态 2：搜索 + 分组列表 -->
    <div v-else-if="expanded === 2" class="minimap-body list">
      <input
        v-model="search"
        class="mb-2 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs outline-none focus:border-[#6366f1]/40"
        placeholder="搜索节点..."
      >
      <div class="max-h-[280px] overflow-y-auto space-y-3">
        <div v-for="[type, items] in groupedNodes" :key="type">
          <p class="mb-1 text-[10px] uppercase tracking-wider text-white/30">
            {{ typeLabels[type] ?? type }} · {{ items.length }}
          </p>
          <button
            v-for="node in items"
            :key="node.id"
            type="button"
            class="mb-0.5 flex w-full rounded-lg px-2 py-1.5 text-left text-xs text-white/70 transition hover:bg-white/5"
            @click="focusNode(node.id)"
          >
            {{ nodeLabel(node) }}
          </button>
        </div>
        <p v-if="!filteredNodes.length" class="py-6 text-center text-xs text-white/30">无匹配节点</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.workflow-minimap-panel {
  @apply overflow-hidden rounded-xl border border-white/10 bg-[rgba(20,20,20,0.94)] shadow-xl backdrop-blur-md;
}

.workflow-minimap-panel.is-compact {
  width: 156px;
}

.workflow-minimap-panel.is-list {
  width: 156px;
}

.panel-header {
  @apply flex items-center justify-between border-b border-white/5 px-2 py-1.5;
}

.header-btn {
  @apply rounded-md px-2 py-0.5 text-[10px] text-white/40 hover:bg-white/5 hover:text-white/70;
}

.minimap-body.compact {
  height: 108px;
  background: rgba(255, 255, 255, 0.02);
}

.minimap-body.list {
  @apply p-2;
}

:deep(.neo-minimap) {
  width: 100% !important;
  height: 100% !important;
  margin: 0 !important;
  background: rgba(255, 255, 255, 0.03) !important;
  border: none !important;
  border-radius: 0 !important;
}

:deep(.neo-minimap .vue-flow__minimap-node) {
  fill-opacity: 1 !important;
  stroke: rgba(255, 255, 255, 0.35);
  stroke-width: 0.5px;
}

:deep(.neo-minimap .vue-flow__minimap-mask) {
  fill: rgba(99, 102, 241, 0.12);
  stroke: rgba(129, 140, 248, 0.65);
}
</style>
