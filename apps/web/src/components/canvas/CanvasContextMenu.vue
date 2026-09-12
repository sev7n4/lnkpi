<script setup lang="ts">
import { computed, ref } from 'vue'
import { CX_IMAGE_EDIT_ENABLED, canOpenRefineForNode } from '@/utils/refineSession'

const props = defineProps<{
  x: number
  y: number
  nodeId?: string
  nodeType?: string
  hasUrl?: boolean
  mediaKind?: string
  mimeType?: string
  multiSelectedCount?: number
  /** capabilities.imageUpscale；false 时「放大」disabled + tooltip */
  imageUpscale?: boolean
}>()

const emit = defineEmits<{
  action: [action: string, payload?: string]
  close: []
}>()

const visible = ref(true)

const showUpstreamDuplicate = computed(
  () => props.nodeType !== 'group' && Boolean(props.nodeId),
)

const showEditImage = computed(
  () =>
    CX_IMAGE_EDIT_ENABLED &&
    Boolean(props.hasUrl) &&
    canOpenRefineForNode({
      type: props.nodeType,
      mediaKind: props.mediaKind,
      mimeType: props.mimeType,
    }),
)

const showUpscale = computed(() => showEditImage.value)

const upscaleDisabled = computed(() => !props.imageUpscale)
const upscaleTitle = computed(() =>
  props.imageUpscale ? '放大 2×' : '当前环境未启用图像放大',
)

function run(action: string, payload?: string) {
  emit('action', action, payload)
  visible.value = false
  emit('close')
}

function runUpscale() {
  if (upscaleDisabled.value) return
  run('upscale-image')
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
      v-if="showUpscale"
      class="neo-popover-item block w-full px-4 py-2 text-left text-xs"
      :disabled="upscaleDisabled"
      :title="upscaleTitle"
      :class="{ 'opacity-45 cursor-not-allowed': upscaleDisabled }"
      @click="runUpscale"
    >
      放大
    </button>

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
