<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { getAbsolutePosition, getNodeSize, type FlowNode } from '@/composables/useCanvasGrouping'
import GridSliceDropdown from '@/components/canvas/grid-slice/GridSliceDropdown.vue'

/**
 * 挂载方式：节点坐标系（与 NodeEditorToolbarOverlay 同模式）。
 * 随 VueFlow viewport 缩放/平移，避免屏幕坐标贴 bbox 在缩放时错位。
 */
interface ActionBarNode {
  id: string
  type?: string | null
  data?: Record<string, unknown>
}

const props = defineProps<{
  node: ActionBarNode
  imageUpscale: boolean
  loading?: boolean
  gridSlice?: boolean
  gridSliceLoading?: boolean
  gridSliceDisabled?: boolean
  gridSliceDisabledTitle?: string
  /** 文件组（下载/存库）是否渲染：节点有可访问的 url 时为真 */
  hasUrl?: boolean
  /** 视口缩放；不传时回退到组件自身 useVueFlow viewport（CanvasPage 无响应式 zoom 源） */
  zoom?: number
  /** 放大积分角标文案；M1 不传（积分体系接入后填入，M3 落地），仅预留样式 */
  creditHint?: string
}>()

const emit = defineEmits<{
  upscale: []
  edit: []
  slice: [cols: number, rows: number]
  'open-custom': []
  download: []
  'save-asset': []
}>()

const { viewport, nodes: flowNodes, findNode } = useVueFlow()

const flowPos = ref<{ x: number; y: number } | null>(null)

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
    width: 'max-content',
    transform: 'translate(-50%, 0)',
  }
})

const labelsHidden = computed(() => (props.zoom ?? viewport.value.zoom) < 0.5)

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
          class="neo-chrome flex items-center gap-0.5 rounded-xl px-1.5 py-1"
          :class="{ 'labels-hidden': labelsHidden }"
          @click.stop
        >
          <!-- 切分组 -->
          <GridSliceDropdown
            v-if="gridSlice"
            :disabled="gridSliceDisabled"
            :loading="gridSliceLoading"
            :disabled-title="gridSliceDisabledTitle"
            @slice="(c: number, r: number) => emit('slice', c, r)"
            @open-custom="emit('open-custom')"
          />
          <span v-if="gridSlice" class="mx-1 h-4 w-px bg-current opacity-10" aria-hidden="true" />

          <!-- AI 一键组：抠图位预留（matting-ready，M2 点亮，注释标记，不渲染死按钮） -->
          <button
            type="button"
            class="toolbar-action accent"
            :disabled="upscaleDisabled"
            :title="upscaleTitle"
            @click="onUpscale"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M15 3h6v6" />
              <path d="M9 21H3v-6" />
              <path d="M21 3l-7 7" />
              <path d="M3 21l7-7" />
            </svg>
            <span class="label">放大</span>
            <span v-if="creditHint" class="credit-chip">{{ creditHint }}</span>
          </button>
          <button
            type="button"
            class="toolbar-action"
            title="编辑图像"
            @click="emit('edit')"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            <span class="label">编辑</span>
          </button>

          <span class="mx-1 h-4 w-px bg-current opacity-10" aria-hidden="true" />

          <!-- 文件组：纯图标 + tooltip -->
          <button
            v-if="hasUrl"
            type="button"
            class="toolbar-action icon-only"
            title="下载图片"
            aria-label="下载图片"
            data-action="download"
            @click="emit('download')"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="M7 10l5 5 5-5" />
              <path d="M12 15V3" />
            </svg>
          </button>
          <button
            v-if="hasUrl"
            type="button"
            class="toolbar-action icon-only"
            title="存入资产库"
            aria-label="存入资产库"
            data-action="save-asset"
            @click="emit('save-asset')"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M12 8v8" />
              <path d="M8 12h8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toolbar-action {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  border-radius: 0.5rem;
  padding: 0.25rem 0.625rem;
  font-size: 11px;
  line-height: 1.25;
  color: var(--neo-text);
  transition: background 0.15s ease, opacity 0.15s ease;
  white-space: nowrap;
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
/* 文件组：纯图标按钮，缩小左右内边距 */
.toolbar-action.icon-only {
  padding: 0.25rem 0.4rem;
}
/* 视口缩放 < 0.5 时隐藏文字标签，仅留图标（缩放是 transform，@media 不适用） */
.labels-hidden .label {
  display: none;
}
/* 放大积分角标：M1 不渲染（creditHint 未传），仅预留样式 */
.credit-chip {
  margin-left: 0.25rem;
  padding: 0 0.3rem;
  font-size: 10px;
  line-height: 1.4;
  border-radius: 9999px;
  background: color-mix(in srgb, var(--neo-accent, #5b8def) 18%, transparent);
  color: var(--neo-accent, #5b8def);
}
</style>
