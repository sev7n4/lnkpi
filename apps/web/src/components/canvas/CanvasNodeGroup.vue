<script setup lang="ts">
import { Handle, Position, useNode } from '@vue-flow/core'
import { computed, inject, nextTick, ref } from 'vue'
import { CANVAS_NODE_RENAME_KEY } from '@/composables/canvasNodeActions'

const props = defineProps<{
  selected?: boolean
  data: { title?: string; childIds?: string[] }
}>()

const { id: nodeId } = useNode()
const renameNode = inject(CANVAS_NODE_RENAME_KEY, null)
const isHovered = ref(false)

const showHandles = computed(() => props.selected || isHovered.value)
const isRenaming = ref(false)
const renameDraft = ref('')
const renameInputRef = ref<HTMLInputElement | null>(null)

function startRename() {
  if (!renameNode) return
  isRenaming.value = true
  renameDraft.value = props.data.title || '未命名分组'
  void nextTick(() => renameInputRef.value?.select())
}

function commitRename() {
  if (!renameNode || !isRenaming.value) return
  const title = renameDraft.value.trim()
  if (title) renameNode(nodeId, title)
  isRenaming.value = false
}
</script>

<template>
  <div
    class="group-node-wrapper neo-node-wrapper"
    :class="{ 'is-active': selected, 'show-handles': showHandles }"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <div class="group-node-container h-full w-full">
      <div class="group-drag-handle" @dblclick.stop="startRename">
        <span class="rounded-lg bg-violet-600/25 px-2 py-0.5 text-[10px] font-medium text-violet-200">分组</span>
        <input
          v-if="isRenaming"
          ref="renameInputRef"
          v-model="renameDraft"
          class="mt-1 w-full rounded-md border border-indigo-500/50 bg-black/30 px-2 py-0.5 text-sm font-semibold text-white outline-none"
          placeholder="分组名称"
          @keydown.enter.stop="commitRename"
          @keydown.esc.stop="isRenaming = false"
          @blur="commitRename"
          @click.stop
          @mousedown.stop
        >
        <h4 v-else class="text-sm font-semibold text-white/85">{{ data.title || '未命名分组' }}</h4>
        <p class="mt-0.5 text-[11px] text-white/40">
          {{ (data.childIds?.length ?? 0) }} 个节点 · 拖此栏移动整组
        </p>
      </div>
    </div>
    <Handle id="target" type="target" :position="Position.Top" class="neo-flow-handle">
      <div class="handle-hitbox" />
      <div class="handle-plus"><div class="handle-plus-inner" /></div>
    </Handle>
    <Handle id="source" type="source" :position="Position.Bottom" class="neo-flow-handle">
      <div class="handle-hitbox" />
      <div class="handle-plus"><div class="handle-plus-inner" /></div>
    </Handle>
  </div>
</template>

<style scoped>
.group-node-wrapper {
  position: relative;
  overflow: visible;
  width: 100%;
  height: 100%;
}

.group-node-container {
  pointer-events: none;
}

.group-drag-handle {
  pointer-events: auto;
  cursor: grab;
  padding: 8px 10px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(24, 24, 27, 0.72);
  backdrop-filter: blur(8px);
}

.group-drag-handle:active {
  cursor: grabbing;
}
</style>
