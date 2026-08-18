<script setup lang="ts">
import { computed, ref } from 'vue'
import { CX_IMAGE_EDIT_ENABLED } from '@/utils/refineSession'

const { x, y, nodeId, nodeType, hasUrl } = defineProps<{
  x: number
  y: number
  nodeId?: string
  nodeType?: string
  hasUrl?: boolean
  multiSelectedCount?: number
}>()

const emit = defineEmits<{
  action: [action: string, payload?: string]
  close: []
}>()

const visible = ref(true)

const showUpstreamDuplicate = computed(
  () => nodeType !== 'group' && Boolean(nodeId),
)

const showEditImage = computed(
  () =>
    CX_IMAGE_EDIT_ENABLED &&
    Boolean(hasUrl) &&
    (nodeType === 'image' || nodeType === 'mediaInput'),
)

function run(action: string, payload?: string) {
  emit('action', action, payload)
  visible.value = false
  emit('close')
}
</script>

<template>
  <div
    v-if="visible && nodeId"
    class="neo-popover fixed z-[100] min-w-[160px] rounded-xl py-1"
    :style="{ left: `${x}px`, top: `${y}px` }"
    @click.stop
  >
    <button
      v-if="showEditImage"
      class="neo-popover-item block w-full px-4 py-2 text-left text-xs"
      @click="run('edit-image')"
    >
      编辑图像
    </button>

    <button
      v-if="nodeType === 'group'"
      class="neo-popover-item block w-full px-4 py-2 text-left text-xs"
      @click="run('ungroup')"
    >
      解组
    </button>

    <button
      v-if="nodeId && nodeType !== 'group'"
      class="neo-popover-item block w-full px-4 py-2 text-left text-xs"
      @click="run('add-agent-ref')"
    >
      加入 Agent 引用
    </button>

    <button
      v-if="nodeId && nodeType !== 'group'"
      class="neo-popover-item block w-full px-4 py-2 text-left text-xs"
      @click="run('duplicate')"
    >
      新建副本
    </button>
    <button
      v-if="showUpstreamDuplicate"
      class="neo-popover-item block w-full px-4 py-2 text-left text-xs"
      @click="run('duplicate-upstream')"
    >
      新建副本（含上游）
    </button>
    <button
      v-if="nodeId"
      class="neo-popover-item block w-full px-4 py-2 text-left text-xs !text-red-400 hover:!text-red-300"
      @click="run('delete')"
    >
      删除节点
    </button>
  </div>
</template>
