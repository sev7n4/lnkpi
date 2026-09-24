<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { getAbsolutePosition, getNodeSize, type FlowNode } from '@/composables/useCanvasGrouping'
import { loadCropSourceImage } from './refine/cropExport'
import type { CropRect } from './refine/cropGeometry'
import {
  NODE_CROP_ASPECT_OPTIONS,
  fitDisplayCropRect,
  moveDisplayCropRect,
  nodeCropLockRatio,
  resizeDisplayCropRect,
  type NodeCropAspectId,
} from './nodeCropModel'

/**
 * 节点直裁覆盖层（竞品交互，2026-09-24 用户拍板）：
 * 单击图片节点 → 浮层「裁剪」→ 节点卡上直接覆盖裁剪框（三分网格 + 白色边角手柄 + 压暗），
 * 卡片上方浮出小确认卡：[✕] [🖼 原图比例 ▾] [确认]。
 * 裁剪框走节点卡显示坐标（cover 满铺，全卡皆图像）；确认时上抛 display rect，
 * 由宿主（CanvasPage）按 cover 映射回原图像素并导出下游节点。
 * 挂载方式与 SelectionActionBar 同构：节点坐标系 + viewport transform，卡片 counter-scale。
 */
const props = defineProps<{
  node: { id: string; type?: string | null; data?: Record<string, unknown> }
  /** 节点原图 url（加载自然尺寸，供「原图比例」与手柄锁定） */
  url: string
  busy?: boolean
}>()

const emit = defineEmits<{
  confirm: [rect: CropRect]
  cancel: []
}>()

const { viewport, nodes: flowNodes, findNode } = useVueFlow()

const CARD_GAP_PX = 8
const CARD_ESTIMATED_H = 40

const abs = ref<{ x: number; y: number } | null>(null)
const box = ref<{ w: number; h: number }>({ w: 0, h: 0 })
const rect = ref<CropRect>({ x: 0, y: 0, width: 0, height: 0 })
const aspect = ref<NodeCropAspectId>('original')
const natural = ref<{ w: number; h: number } | null>(null)
const menuOpen = ref(false)
const placement = ref<'top' | 'bottom'>('top')
const loadToken = ref(0)

const currentLabel = computed(
  () => NODE_CROP_ASPECT_OPTIONS.find((o) => o.id === aspect.value)?.label ?? '原图比例',
)
const lockRatio = computed(() => {
  const n = natural.value
  return nodeCropLockRatio(aspect.value, n?.w ?? 0, n?.h ?? 0)
})
/** 原图未就绪（加载失败 / 尺寸无效）时禁确认 */
const canConfirm = computed(() => !props.busy && !!natural.value)

function applyAspect(id: NodeCropAspectId) {
  aspect.value = id
  menuOpen.value = false
  const n = natural.value
  const ratio = nodeCropLockRatio(id, n?.w ?? 0, n?.h ?? 0)
  // 自由比例保留当前框；锁定比例重配为卡内最大居中框（竞品同款）
  if (ratio != null) rect.value = fitDisplayCropRect(box.value.w, box.value.h, ratio)
}

async function loadNatural() {
  const token = ++loadToken.value
  const url = props.url
  natural.value = null
  if (!url) return
  try {
    const img = await loadCropSourceImage(url)
    if (token !== loadToken.value) return
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      natural.value = { w: img.naturalWidth, h: img.naturalHeight }
      // 「原图比例」初始落点：卡内最大居中原图比框（卡比 == 图比时即全卡）
      if (aspect.value === 'original') {
        rect.value = fitDisplayCropRect(box.value.w, box.value.h, natural.value.w / natural.value.h)
      }
    }
  } catch {
    if (token === loadToken.value) natural.value = null
  }
}

function resetToFullBox() {
  rect.value = fitDisplayCropRect(box.value.w, box.value.h, null)
}

function updateGeometry() {
  const flowNode = findNode(props.node.id) as FlowNode | undefined
  const sizeNode = flowNode ?? ({ ...props.node, type: String(props.node.type ?? '') } as FlowNode)
  const allNodes = flowNodes.value as unknown as FlowNode[]
  const position = getAbsolutePosition(sizeNode, allNodes)
  const { w, h } = getNodeSize(sizeNode)
  abs.value = position
  box.value = { w, h }
  // 卡片翻转判定：节点上沿屏幕 y 是否贴住视口顶
  const nodeTopY = viewport.value.y + position.y * viewport.value.zoom
  placement.value = nodeTopY - CARD_GAP_PX - CARD_ESTIMATED_H <= 0 ? 'bottom' : 'top'
}

// —— 拖拽（move / 8 手柄） ——
const drag = ref<{ dir: string; lastX: number; lastY: number; zoom: number } | null>(null)

function onRectPointerDown(event: PointerEvent) {
  if (props.busy) return
  drag.value = { dir: 'move', lastX: event.clientX, lastY: event.clientY, zoom: viewport.value.zoom }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
}

function onHandlePointerDown(dir: string, event: PointerEvent) {
  if (props.busy) return
  event.stopPropagation()
  drag.value = { dir, lastX: event.clientX, lastY: event.clientY, zoom: viewport.value.zoom }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
}

function onDragMove(event: PointerEvent) {
  const d = drag.value
  if (!d) return
  const dx = (event.clientX - d.lastX) / d.zoom
  const dy = (event.clientY - d.lastY) / d.zoom
  d.lastX = event.clientX
  d.lastY = event.clientY
  if (d.dir === 'move') {
    rect.value = moveDisplayCropRect(rect.value, dx, dy, box.value.w, box.value.h)
  } else {
    rect.value = resizeDisplayCropRect(
      rect.value,
      d.dir,
      dx,
      dy,
      box.value.w,
      box.value.h,
      lockRatio.value,
    )
  }
}

function onDragEnd() {
  drag.value = null
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
}

function onConfirm() {
  if (!canConfirm.value) return
  emit('confirm', { ...rect.value })
}

function onCancel() {
  if (menuOpen.value) {
    menuOpen.value = false
    return
  }
  emit('cancel')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  onCancel()
}

const transformStyle = computed(() => ({
  transform: `translate(${viewport.value.x}px, ${viewport.value.y}px) scale(${viewport.value.zoom})`,
  transformOrigin: '0 0',
}))

const stageStyle = computed(() => {
  if (!abs.value) return { display: 'none' }
  return { left: `${abs.value.x}px`, top: `${abs.value.y}px`, width: `${box.value.w}px`, height: `${box.value.h}px` }
})

const cardStyle = computed(() => {
  if (!abs.value) return { display: 'none' }
  const gap = CARD_GAP_PX / viewport.value.zoom
  return {
    left: `${abs.value.x + box.value.w / 2}px`,
    top:
      placement.value === 'top'
        ? `${abs.value.y - gap}px`
        : `${abs.value.y + box.value.h + gap}px`,
    transform: placement.value === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
  }
})

const counterScaleStyle = computed(() => ({
  transform: `scale(${1 / viewport.value.zoom})`,
  transformOrigin: placement.value === 'top' ? '50% 100%' : '50% 0%',
}))

const rectStyle = computed(() => ({
  left: `${rect.value.x}px`,
  top: `${rect.value.y}px`,
  width: `${rect.value.width}px`,
  height: `${rect.value.height}px`,
}))

watch(
  () => props.node.id,
  () => {
    updateGeometry()
    resetToFullBox()
    aspect.value = 'original'
    menuOpen.value = false
    void loadNatural()
  },
  { immediate: true },
)

watch(() => props.url, () => void loadNatural())
watch(viewport, updateGeometry, { deep: true })
watch(flowNodes, updateGeometry, { deep: true })

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  onDragEnd()
})
</script>

<template>
  <div class="pointer-events-none absolute inset-0 z-[46] overflow-visible" data-testid="node-crop-overlay">
    <div class="origin-top-left" :style="transformStyle">
      <!-- 节点卡覆盖：裁剪框 + 网格 + 手柄 + 压暗 -->
      <div
        v-if="abs"
        class="pointer-events-auto absolute overflow-hidden rounded-lg"
        :style="stageStyle"
        data-testid="node-crop-stage"
        @pointerdown.stop
        @mousedown.stop
        @click.stop
      >
        <div
          class="node-crop-rect absolute"
          :style="rectStyle"
          data-testid="node-crop-rect"
          @pointerdown="onRectPointerDown"
        >
          <span class="node-crop-grid-line is-v" style="left: 33.333%" aria-hidden="true" />
          <span class="node-crop-grid-line is-v" style="left: 66.667%" aria-hidden="true" />
          <span class="node-crop-grid-line is-h" style="top: 33.333%" aria-hidden="true" />
          <span class="node-crop-grid-line is-h" style="top: 66.667%" aria-hidden="true" />

          <!-- 四角 L 形白括号手柄（竞品样式：粗白直角，微出血） -->
          <button
            v-for="dir in (['nw', 'ne', 'sw', 'se'] as const)"
            :key="`corner-${dir}`"
            type="button"
            class="node-crop-handle node-crop-handle--corner absolute"
            :class="`node-crop-handle--${dir}`"
            :data-handle="dir"
            :aria-label="`调整裁剪框 ${dir}`"
            @pointerdown="onHandlePointerDown(dir, $event)"
          />
          <!-- 四边中点白色小手柄 -->
          <button
            v-for="dir in (['n', 's', 'w', 'e'] as const)"
            :key="`edge-${dir}`"
            type="button"
            class="node-crop-handle node-crop-handle--edge absolute"
            :class="`node-crop-handle--${dir}`"
            :data-handle="dir"
            :aria-label="`调整裁剪框 ${dir}`"
            @pointerdown="onHandlePointerDown(dir, $event)"
          />
        </div>
      </div>

      <!-- 上沿小确认卡：[✕] [原图比例 ▾] [确认] -->
      <div v-if="abs" class="pointer-events-auto absolute" :style="cardStyle">
        <div
          class="neo-chrome flex items-center gap-0.5 rounded-xl px-1 py-1"
          :style="counterScaleStyle"
          data-testid="node-crop-card"
          @pointerdown.stop
          @mousedown.stop
          @click.stop
        >
          <button
            type="button"
            class="node-crop-card__btn"
            data-testid="node-crop-cancel"
            title="取消裁剪"
            aria-label="取消裁剪"
            @click="emit('cancel')"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
          <span class="node-crop-card__divider" aria-hidden="true" />
          <div class="relative">
            <button
              type="button"
              class="node-crop-card__btn node-crop-card__aspect"
              data-testid="node-crop-aspect-trigger"
              :aria-expanded="menuOpen"
              aria-haspopup="menu"
              title="裁剪比例"
              @click="menuOpen = !menuOpen"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18" opacity="0.6" />
              </svg>
              <span>{{ currentLabel }}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <div
              v-if="menuOpen"
              class="neo-chrome node-crop-menu absolute left-1/2 top-full z-[3] mt-1.5 -translate-x-1/2 rounded-xl p-1"
              role="menu"
              data-testid="node-crop-aspect-menu"
              @click.stop
            >
              <button
                v-for="opt in NODE_CROP_ASPECT_OPTIONS"
                :key="opt.id"
                type="button"
                role="menuitem"
                class="node-crop-menu__item"
                :class="{ 'is-on': aspect === opt.id }"
                :data-aspect="opt.id"
                @click="applyAspect(opt.id)"
              >{{ opt.label }}</button>
            </div>
          </div>
          <button
            type="button"
            class="node-crop-card__primary"
            data-testid="node-crop-confirm"
            :disabled="!canConfirm"
            :title="natural ? '应用裁剪（下游新节点）' : '原图加载失败，请重试'"
            @click="onConfirm"
          >{{ busy ? '裁剪中…' : '确认' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 裁剪框：白细边 + 压暗框外（阴影铺满 stage，由 overflow-hidden 裁掉出血） */
.node-crop-rect {
  border: 1px solid rgba(255, 255, 255, 0.92);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
  cursor: move;
  touch-action: none;
}

.node-crop-grid-line {
  position: absolute;
  background: rgba(255, 255, 255, 0.55);
  pointer-events: none;
}
.node-crop-grid-line.is-v {
  top: 0;
  bottom: 0;
  width: 1px;
}
.node-crop-grid-line.is-h {
  left: 0;
  right: 0;
  height: 1px;
}

.node-crop-handle {
  background: #fff;
  border: none;
  padding: 0;
  touch-action: none;
}
/* 四角：L 形白括号（微出血到框外，竞品同款粗直角） */
.node-crop-handle--corner {
  width: 18px;
  height: 18px;
  background: transparent;
}
.node-crop-handle--corner::before,
.node-crop-handle--corner::after {
  content: '';
  position: absolute;
  background: #fff;
  border-radius: 2px;
}
.node-crop-handle--corner::before {
  width: 18px;
  height: 3.5px;
}
.node-crop-handle--corner::after {
  width: 3.5px;
  height: 18px;
}
.node-crop-handle--nw { left: -3px; top: -3px; cursor: nwse-resize; }
.node-crop-handle--nw::before { left: 0; top: 0; }
.node-crop-handle--nw::after { left: 0; top: 0; }
.node-crop-handle--ne { right: -3px; top: -3px; cursor: nesw-resize; }
.node-crop-handle--ne::before { right: 0; top: 0; }
.node-crop-handle--ne::after { right: 0; top: 0; }
.node-crop-handle--sw { left: -3px; bottom: -3px; cursor: nesw-resize; }
.node-crop-handle--sw::before { left: 0; bottom: 0; }
.node-crop-handle--sw::after { left: 0; bottom: 0; }
.node-crop-handle--se { right: -3px; bottom: -3px; cursor: nwse-resize; }
.node-crop-handle--se::before { right: 0; bottom: 0; }
.node-crop-handle--se::after { right: 0; bottom: 0; }

/* 四边中点：白色小条 */
.node-crop-handle--edge {
  background: #fff;
  border-radius: 2px;
}
.node-crop-handle--n,
.node-crop-handle--s {
  width: 22px;
  height: 5px;
  cursor: ns-resize;
}
.node-crop-handle--n { left: 50%; top: -2.5px; transform: translateX(-50%); }
.node-crop-handle--s { left: 50%; bottom: -2.5px; transform: translateX(-50%); }
.node-crop-handle--w,
.node-crop-handle--e {
  width: 5px;
  height: 22px;
  cursor: ew-resize;
}
.node-crop-handle--w { top: 50%; left: -2.5px; transform: translateY(-50%); }
.node-crop-handle--e { top: 50%; right: -2.5px; transform: translateY(-50%); }

/* 确认卡 */
.node-crop-card__btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.4rem 0.55rem;
  border-radius: 0.5rem;
  color: var(--neo-text);
  font-size: 12px;
  line-height: 1.2;
  white-space: nowrap;
  transition: background 0.15s ease;
}
.node-crop-card__btn:hover {
  background: color-mix(in srgb, var(--neo-text) 8%, transparent);
}
.node-crop-card__divider {
  width: 1px;
  height: 16px;
  background: color-mix(in srgb, var(--neo-text) 14%, transparent);
}
.node-crop-card__primary {
  margin-left: 0.35rem;
  padding: 0.4rem 0.9rem;
  border-radius: 0.6rem;
  background: #fff;
  color: #111;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  transition: opacity 0.15s ease;
}
.node-crop-card__primary:hover:not(:disabled) {
  opacity: 0.88;
}
.node-crop-card__primary:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

/* 比例下拉菜单（counter-scale 后实底，同 GridSliceDropdown 处理） */
.node-crop-menu {
  min-width: 108px;
  background: var(--neo-chrome-bg);
  box-shadow: var(--neo-chrome-shadow);
  transform-origin: top center;
}
.node-crop-menu__item {
  display: block;
  width: 100%;
  padding: 0.35rem 0.7rem;
  text-align: left;
  font-size: 11.5px;
  line-height: 1.3;
  color: var(--neo-text);
  white-space: nowrap;
  transition: background 0.15s ease;
}
.node-crop-menu__item:hover {
  background: color-mix(in srgb, var(--neo-text) 8%, transparent);
}
.node-crop-menu__item.is-on {
  color: var(--neo-accent-text, #a89dff);
}
</style>
