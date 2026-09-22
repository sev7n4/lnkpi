<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { getAbsolutePosition, getNodeSize, type FlowNode } from '@/composables/useCanvasGrouping'
import GridSliceDropdown from '@/components/canvas/grid-slice/GridSliceDropdown.vue'
import { buildSelectionTools, clampCounterScale, resolveBarPlacement, type SelectionToolDef } from './selectionToolModel'

/**
 * 挂载方式：节点坐标系（与 NodeEditorToolbarOverlay 同模式）。
 * 随 VueFlow viewport 缩放/平移；浮层本体做 counter-scale，
 * 使其在屏幕上保持恒定尺寸，不再被 viewport zoom 拉伸。
 */
interface ActionBarNode {
  id: string
  type?: string | null
  data?: Record<string, unknown>
}

const props = defineProps<{
  node: ActionBarNode
  gridSlice?: boolean
  gridSliceLoading?: boolean
  gridSliceDisabled?: boolean
  gridSliceDisabledTitle?: string
  /** 宫格切分原图像素尺寸；用于 64px 单格下限禁用判定 */
  gridSliceImage?: { width: number; height: number } | null
  /** 文件组（下载/存库）是否可用：节点有可访问的 url 时为真 */
  hasUrl?: boolean
  /** 视口缩放；不传时回退到组件自身 useVueFlow viewport（CanvasPage 无响应式 zoom 源） */
  zoom?: number
}>()

const emit = defineEmits<{
  edit: []
  slice: [cols: number, rows: number]
  'open-custom': []
  download: []
  'save-asset': []
}>()

const { viewport, nodes: flowNodes, findNode } = useVueFlow()

/** bar 与节点边缘的屏幕间距（px） */
const BAR_GAP_PX = 8
/**
 * bar 固定宽度（px）：与 MultiSelectToolbar（框选多节点菜单）的自然宽度 383px 对齐。
 * 固定宽度后按钮用 space-around 铺满，命中目标比 max-content 时的紧凑排布更大。
 */
const BAR_WIDTH_PX = 384

const tools = computed(() => buildSelectionTools({ hasUrl: Boolean(props.hasUrl) }))

function onToolClick(tool: SelectionToolDef) {
  if (tool.disabled) return
  if (tool.id === 'refine') emit('edit')
  else if (tool.id === 'download') emit('download')
  else if (tool.id === 'save-asset') emit('save-asset')
}

const flowPos = ref<{ x: number; y: number } | null>(null)
const placement = ref<'top' | 'bottom'>('top')
const barEl = ref<HTMLElement | null>(null)

function updatePosition() {
  const allNodes = flowNodes.value as unknown as FlowNode[]
  const flowNode = findNode(props.node.id) as FlowNode | undefined
  const type = String(props.node.type ?? '')
  const sizeNode = flowNode ?? ({ ...props.node, type } as FlowNode)
  const abs = getAbsolutePosition(sizeNode, allNodes)
  const { w, h } = getNodeSize(sizeNode)
  const zoom = props.zoom ?? viewport.value.zoom
  const cs = clampCounterScale(zoom)
  // bar 屏幕尺寸 = 布局尺寸（节点坐标系）× zoom × counter-scale
  const barW = (barEl.value?.offsetWidth ?? 0) * zoom * cs
  const barH = (barEl.value?.offsetHeight ?? 0) * zoom * cs
  const anchorX = viewport.value.x + (abs.x + w / 2) * zoom
  const nodeTopY = viewport.value.y + abs.y * zoom
  const barBox = {
    x: anchorX - barW / 2,
    y: nodeTopY - BAR_GAP_PX - barH,
    w: barW,
    h: barH,
  }
  placement.value = resolveBarPlacement(barBox, { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight })
  // 屏幕间距恒定 → 节点坐标系间距 = GAP / zoom
  const gapNode = BAR_GAP_PX / zoom
  flowPos.value = {
    x: abs.x + w / 2,
    y: placement.value === 'top' ? abs.y - gapNode : abs.y + h + gapNode,
  }
  if (!barEl.value) {
    // 首帧 bar 尚未渲染（尺寸为 0），下一帧补测并复核翻转
    scheduleUpdate()
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
watch(
  () => [props.gridSlice, props.hasUrl],
  () => {
    nextTick(scheduleUpdate)
  },
)

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
    width: `${BAR_WIDTH_PX}px`,
    transform: placement.value === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
  }
})

const counterScaleStyle = computed(() => ({
  transform: `scale(${clampCounterScale(effectiveZoom.value)})`,
  transformOrigin: placement.value === 'top' ? '50% 100%' : '50% 0%',
}))

/** 生效缩放：优先外部传入的 zoom prop（无响应式 viewport 源的宿主） */
const effectiveZoom = computed(() => props.zoom ?? viewport.value.zoom)

const TOOL_ICONS: Record<string, string> = {
  refine: '<path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />',
  matting: '<circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4L8.12 15.88" /><path d="M14.47 14.48L20 20" /><path d="M8.12 8.12L12 12" />',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M18 22V8a2 2 0 0 0-2-2H2" />',
  rotate: '<path d="M23 4v6h-6" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" />',
  'save-asset': '<rect x="3" y="3" width="18" height="18" rx="2" /><path d="M12 8v8" /><path d="M8 12h8" />',
}
</script>

<template>
  <div
    v-if="flowPos"
    class="selection-action-bar-layer pointer-events-none absolute inset-0 z-[46] overflow-visible"
  >
    <div class="origin-top-left" :style="transformStyle">
      <div ref="barEl" class="pointer-events-auto absolute" :style="barStyle">
        <div
          data-testid="bar-inner"
          class="neo-chrome flex items-center justify-around gap-0.5 rounded-xl px-1.5 py-1"
          :style="counterScaleStyle"
          @click.stop
        >
          <!-- 切分组 -->
          <GridSliceDropdown
            v-if="gridSlice"
            :disabled="gridSliceDisabled"
            :loading="gridSliceLoading"
            :disabled-title="gridSliceDisabledTitle"
            :image="gridSliceImage"
            @slice="(c: number, r: number) => emit('slice', c, r)"
            @open-custom="emit('open-custom')"
          />
          <span v-if="gridSlice" class="mx-1 h-4 w-px bg-current opacity-10" aria-hidden="true" />

          <!-- 快捷工具组（config 驱动）：精修可用，其余为禁用占位，后续翻标志点亮 -->
          <template v-for="(tool, index) in tools" :key="tool.id">
            <span
              v-if="index > 0 && tools[index - 1].group !== tool.group"
              class="mx-1 h-4 w-px bg-current opacity-10"
              aria-hidden="true"
            />
            <button
              type="button"
              class="toolbar-action"
              :class="{ 'icon-only': tool.group === 'file' }"
              :data-action="tool.id"
              :title="tool.disabled ? (tool.disabledReason ?? tool.title) : tool.title"
              :aria-label="tool.title"
              :disabled="tool.disabled"
              @click="onToolClick(tool)"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
                v-html="TOOL_ICONS[tool.icon]"
              />
              <span class="label">{{ tool.title }}</span>
            </button>
          </template>
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
  padding: 0.375rem 0.5rem;
  font-size: 11px;
  line-height: 1.25;
  color: var(--neo-text);
  transition: background 0.15s ease, opacity 0.15s ease;
  white-space: nowrap;
}
.toolbar-action:hover:not(:disabled) {
  background: color-mix(in srgb, var(--neo-text) 8%, transparent);
}
.toolbar-action:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
/* 文件组：纯图标按钮，缩小左右内边距 */
.toolbar-action.icon-only {
  padding: 0.375rem 0.4rem;
}
/* 与 MultiSelectToolbar（纯图标按钮排布）对齐：文字标签不占宽度，
   仅保留在 DOM / title 中（无障碍 + 测试可见性），按钮在固定 384px 内 space-around 铺开 */
.label {
  display: none;
}
</style>
