<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { getAbsolutePosition, getNodeSize, type FlowNode } from '@/composables/useCanvasGrouping'
import { loadCropSourceImage } from './refine/cropExport'
import {
  fitRectToAspect,
  floorOutpaintRect,
  hasOutpaintExtension,
  initialOutpaintRect,
  resizeOutpaintRect,
  type HandleDir,
  type OutpaintRect,
  type Size,
} from './refine/outpaintGeometry'

/**
 * 节点直出扩图（轻量复刻竞品，2026-09-24 用户拍板）：
 * 单击图片节点 → 浮层「扩图」→ 节点外圈出现新画布框（8 手柄向外拖），
 * 参数小卡片挂在扩图框上/下沿；「比例」下拉**背向图片**弹出（卡片在下方向下弹、
 * 在上方向上弹），永不覆盖图片（用户微调要求 ①）；无张数选择，单次一张（要求 ②）。
 *
 * 几何：全部在原图像素空间（base = 原图自然尺寸），复用精修扩图的
 * resizeOutpaintRect（单边 ≥256 / 面积 ≤9 倍 / 恒包含原图）与 fitRectToAspect；
 * 显示层按 kx = 节点宽/原图宽、ky = 节点高/原图高 双轴映射。
 * 确认时上抛 floor 后的像素矩形，由宿主（CanvasPage）合成两张 PNG 走
 * image/edit mode:'outpaint' 生成链路。
 */
const props = defineProps<{
  node: { id: string; type?: string | null; data?: Record<string, unknown> }
  /** 节点原图 url（加载自然尺寸作为扩图基准） */
  url: string
  busy?: boolean
}>()

const emit = defineEmits<{
  confirm: [rect: OutpaintRect]
  cancel: []
}>()

const { viewport, nodes: flowNodes, findNode } = useVueFlow()

const CARD_GAP_PX = 8
const CARD_ESTIMATED_H = 40

const abs = ref<{ x: number; y: number } | null>(null)
const box = ref<{ w: number; h: number }>({ w: 0, h: 0 })
const base = ref<Size | null>(null)
const rect = ref<OutpaintRect | null>(null)
const aspect = ref<string>('original')
const menuOpen = ref(false)
/** 参数卡落点：'bottom' = 扩图框下方（优先，不压图片）；'top' = 上方 */
const cardBelow = ref(true)
const loadToken = ref(0)

const HANDLE_DIRS: HandleDir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

const ASPECT_OPTIONS: { id: string; label: string; ratio: { w: number; h: number } | null | undefined }[] = [
  { id: 'original', label: '原图比例', ratio: null },
  { id: 'custom', label: '自定义', ratio: undefined }, // undefined = 保留当前框（自由拖拽态）
  { id: '1:1', label: '1:1', ratio: { w: 1, h: 1 } },
  { id: '4:3', label: '4:3', ratio: { w: 4, h: 3 } },
  { id: '3:4', label: '3:4', ratio: { w: 3, h: 4 } },
  { id: '16:9', label: '16:9', ratio: { w: 16, h: 9 } },
  { id: '9:16', label: '9:16', ratio: { w: 9, h: 16 } },
]

const currentLabel = computed(
  () => ASPECT_OPTIONS.find((o) => o.id === aspect.value)?.label ?? '自定义',
)

/** 显示 ↔ 像素映射（节点 cover 满铺，双轴独立比例） */
const kx = computed(() => (base.value && box.value.w > 0 ? box.value.w / base.value.width : 1))
const ky = computed(() => (base.value && box.value.h > 0 ? box.value.h / base.value.height : 1))

const canConfirm = computed(() => {
  if (props.busy || !base.value || !rect.value) return false
  return hasOutpaintExtension(base.value, floorOutpaintRect(rect.value))
})

/** 扩图框 stage（节点坐标系）：负偏移把扩出区铺到节点外 */
const stageStyle = computed(() => {
  if (!abs.value || !rect.value) return { display: 'none' }
  return {
    left: `${abs.value.x - rect.value.x * kx.value}px`,
    top: `${abs.value.y - rect.value.y * ky.value}px`,
    width: `${rect.value.width * kx.value}px`,
    height: `${rect.value.height * ky.value}px`,
  }
})

/** 原图区域在 stage 内的落位（虚线描出「图内 / 扩出区」边界） */
const baseStyle = computed(() => {
  if (!rect.value) return { display: 'none' }
  return {
    left: `${rect.value.x * kx.value}px`,
    top: `${rect.value.y * ky.value}px`,
    width: `${box.value.w}px`,
    height: `${box.value.h}px`,
  }
})

const cardStyle = computed(() => {
  if (!abs.value || !rect.value) return { display: 'none' }
  const gap = CARD_GAP_PX / viewport.value.zoom
  const stageTop = abs.value.y - rect.value.y * ky.value
  const stageBottom = stageTop + rect.value.height * ky.value
  return {
    left: `${abs.value.x + box.value.w / 2}px`,
    top: cardBelow.value ? `${stageBottom + gap}px` : `${stageTop - gap}px`,
    transform: cardBelow.value ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
  }
})

/** 下拉弹出方向 = 背向图片：卡片在下方 → 向下弹；卡片在上方 → 向上弹 */
const menuClass = computed(() => (cardBelow.value ? 'is-below' : 'is-above'))

const counterScaleStyle = computed(() => ({
  transform: `scale(${1 / viewport.value.zoom})`,
  transformOrigin: cardBelow.value ? '50% 0%' : '50% 100%',
}))

function applyAspect(id: string) {
  aspect.value = id
  menuOpen.value = false
  const b = base.value
  if (!b) return
  const opt = ASPECT_OPTIONS.find((o) => o.id === id)
  if (!opt) return
  if (opt.ratio === undefined) return // 自定义：保留当前框
  // null（原图比例）= 重置回原图；其余 = 包含原图的最小该比例画布
  rect.value = fitRectToAspect(b, opt.ratio)
}

async function loadNatural() {
  const token = ++loadToken.value
  const url = props.url
  base.value = null
  rect.value = null
  if (!url) return
  try {
    const img = await loadCropSourceImage(url)
    if (token !== loadToken.value) return
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      base.value = { width: img.naturalWidth, height: img.naturalHeight }
      rect.value = initialOutpaintRect(base.value)
    }
  } catch {
    if (token === loadToken.value) {
      base.value = null
      rect.value = null
    }
  }
}

function updateGeometry() {
  const flowNode = findNode(props.node.id) as FlowNode | undefined
  const sizeNode = flowNode ?? ({ ...props.node, type: String(props.node.type ?? '') } as FlowNode)
  const allNodes = flowNodes.value as unknown as FlowNode[]
  const position = getAbsolutePosition(sizeNode, allNodes)
  const { w, h } = getNodeSize(sizeNode)
  abs.value = position
  box.value = { w, h }
  // 参数卡落点：扩图框下沿的屏幕 y + 卡高未出视口 → 下方；否则上方
  const r = rect.value
  if (r) {
    const zoom = viewport.value.zoom
    const stageBottomScreen = viewport.value.y + (position.y + (r.height - r.y) * ky.value) * zoom
    const stageTopScreen = viewport.value.y + (position.y - r.y * ky.value) * zoom
    cardBelow.value = stageBottomScreen + CARD_GAP_PX + CARD_ESTIMATED_H <= window.innerHeight || stageTopScreen < 0
  }
}

// —— 8 手柄向外拖拽（像素空间几何，显示增量双轴换算） ——
const drag = ref<{ dir: HandleDir; lastX: number; lastY: number; zoom: number } | null>(null)

function onHandlePointerDown(dir: HandleDir, event: PointerEvent) {
  if (props.busy || !rect.value) return
  event.stopPropagation()
  drag.value = { dir, lastX: event.clientX, lastY: event.clientY, zoom: viewport.value.zoom }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
}

function onDragMove(event: PointerEvent) {
  const d = drag.value
  const b = base.value
  if (!d || !b || !rect.value) return
  const dpx = (event.clientX - d.lastX) / d.zoom / kx.value
  const dpy = (event.clientY - d.lastY) / d.zoom / ky.value
  d.lastX = event.clientX
  d.lastY = event.clientY
  rect.value = resizeOutpaintRect(b, rect.value, { dx: dpx, dy: dpy }, d.dir)
  if (aspect.value !== 'custom') aspect.value = 'custom'
  updateGeometry()
}

function onDragEnd() {
  drag.value = null
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
}

function onConfirm() {
  if (!canConfirm.value || !rect.value) return
  emit('confirm', floorOutpaintRect(rect.value))
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

watch(
  () => props.node.id,
  () => {
    updateGeometry()
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
  <div class="pointer-events-none absolute inset-0 z-[46] overflow-visible" data-testid="node-outpaint-overlay">
    <div class="origin-top-left" :style="transformStyle">
      <!-- 扩图新画布框：覆盖节点 + 扩出区；框外压暗 -->
      <div
        v-if="abs && rect"
        class="node-outpaint-stage pointer-events-auto absolute"
        :style="stageStyle"
        data-testid="node-outpaint-stage"
        @pointerdown.stop
        @mousedown.stop
        @click.stop
      >
        <!-- 原图边界（虚线）：图内保留区 / 扩出生成区 -->
        <div class="node-outpaint-base" :style="baseStyle" data-testid="node-outpaint-base" />

        <!-- 8 手柄（与裁剪同款白色 L 角 + 边中点条） -->
        <button
          v-for="dir in HANDLE_DIRS"
          :key="dir"
          type="button"
          class="node-outpaint-handle absolute"
          :class="[`node-outpaint-handle--${dir}`, { 'is-corner': dir.length === 2 }]"
          :data-handle="dir"
          :aria-label="`扩展画布 ${dir}`"
          @pointerdown="onHandlePointerDown(dir, $event)"
        />
      </div>

      <!-- 参数小卡片：[✕] [比例 ▾] [确认] —— 挂扩图框上/下沿，弹层背向图片 -->
      <div v-if="abs && rect" class="pointer-events-auto absolute" :style="cardStyle">
        <div
          class="neo-chrome flex items-center gap-0.5 rounded-xl px-1 py-1"
          :style="counterScaleStyle"
          data-testid="node-outpaint-card"
          @pointerdown.stop
          @mousedown.stop
          @click.stop
        >
          <button
            type="button"
            class="node-outpaint-card__btn"
            data-testid="node-outpaint-cancel"
            title="取消扩图"
            aria-label="取消扩图"
            @click="emit('cancel')"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
          <span class="node-outpaint-card__divider" aria-hidden="true" />
          <div class="relative">
            <button
              type="button"
              class="node-outpaint-card__btn node-outpaint-card__aspect"
              data-testid="node-outpaint-aspect-trigger"
              :aria-expanded="menuOpen"
              aria-haspopup="menu"
              title="扩图画布比例"
              @click="menuOpen = !menuOpen"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <rect x="4" y="4" width="16" height="16" rx="1.5" stroke-dasharray="3 2.5" />
                <rect x="8.5" y="8.5" width="7" height="7" rx="1" />
              </svg>
              <span>{{ currentLabel }}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <div
              v-if="menuOpen"
              class="neo-chrome node-outpaint-menu absolute left-1/2 z-[3] -translate-x-1/2 rounded-xl p-1"
              :class="menuClass"
              role="menu"
              data-testid="node-outpaint-aspect-menu"
              @click.stop
            >
              <button
                v-for="opt in ASPECT_OPTIONS"
                :key="opt.id"
                type="button"
                role="menuitem"
                class="node-outpaint-menu__item"
                :class="{ 'is-on': aspect === opt.id }"
                :data-aspect="opt.id"
                @click="applyAspect(opt.id)"
              >{{ opt.label }}</button>
            </div>
          </div>
          <button
            type="button"
            class="node-outpaint-card__primary"
            data-testid="node-outpaint-confirm"
            :disabled="!canConfirm"
            :title="canConfirm ? '生成扩图（下游新节点）' : '先拖动手柄向外扩展画布'"
            @click="onConfirm"
          >{{ busy ? '扩图中…' : '确认' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 新画布框：白边 + 框外压暗；扩出区铺一层浅白提示可生成 */
.node-outpaint-stage {
  border: 1.5px solid rgba(255, 255, 255, 0.92);
  background: rgba(255, 255, 255, 0.08);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.4);
  touch-action: none;
}

.node-outpaint-base {
  position: absolute;
  border: 1px dashed rgba(255, 255, 255, 0.45);
  pointer-events: none;
}

.node-outpaint-handle {
  background: #fff;
  border: none;
  padding: 0;
  touch-action: none;
}
/* 四角：L 形白括号（微出血，与裁剪手柄同款） */
.node-outpaint-handle.is-corner {
  width: 18px;
  height: 18px;
  background: transparent;
}
.node-outpaint-handle.is-corner::before,
.node-outpaint-handle.is-corner::after {
  content: '';
  position: absolute;
  background: #fff;
  border-radius: 2px;
}
.node-outpaint-handle.is-corner::before {
  width: 18px;
  height: 3.5px;
}
.node-outpaint-handle.is-corner::after {
  width: 3.5px;
  height: 18px;
}
.node-outpaint-handle--nw { left: -3px; top: -3px; cursor: nwse-resize; }
.node-outpaint-handle--nw::before { left: 0; top: 0; }
.node-outpaint-handle--nw::after { left: 0; top: 0; }
.node-outpaint-handle--ne { right: -3px; top: -3px; cursor: nesw-resize; }
.node-outpaint-handle--ne::before { right: 0; top: 0; }
.node-outpaint-handle--ne::after { right: 0; top: 0; }
.node-outpaint-handle--sw { left: -3px; bottom: -3px; cursor: nesw-resize; }
.node-outpaint-handle--sw::before { left: 0; bottom: 0; }
.node-outpaint-handle--sw::after { left: 0; bottom: 0; }
.node-outpaint-handle--se { right: -3px; bottom: -3px; cursor: nwse-resize; }
.node-outpaint-handle--se::before { right: 0; bottom: 0; }
.node-outpaint-handle--se::after { right: 0; bottom: 0; }

/* 四边中点：白色小条 */
.node-outpaint-handle:not(.is-corner) {
  background: #fff;
  border-radius: 2px;
}
.node-outpaint-handle--n,
.node-outpaint-handle--s {
  width: 22px;
  height: 5px;
  cursor: ns-resize;
}
.node-outpaint-handle--n { left: 50%; top: -2.5px; transform: translateX(-50%); }
.node-outpaint-handle--s { left: 50%; bottom: -2.5px; transform: translateX(-50%); }
.node-outpaint-handle--w,
.node-outpaint-handle--e {
  width: 5px;
  height: 22px;
  cursor: ew-resize;
}
.node-outpaint-handle--w { top: 50%; left: -2.5px; transform: translateY(-50%); }
.node-outpaint-handle--e { top: 50%; right: -2.5px; transform: translateY(-50%); }

/* 参数卡（与裁剪确认卡同款） */
.node-outpaint-card__btn {
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
.node-outpaint-card__btn:hover {
  background: color-mix(in srgb, var(--neo-text) 8%, transparent);
}
.node-outpaint-card__divider {
  width: 1px;
  height: 16px;
  background: color-mix(in srgb, var(--neo-text) 14%, transparent);
}
.node-outpaint-card__primary {
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
.node-outpaint-card__primary:hover:not(:disabled) {
  opacity: 0.88;
}
.node-outpaint-card__primary:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

/* 比例下拉：卡片在下方 → 菜单从卡片下沿向下弹；在上方 → 向上弹（都不压图片） */
.node-outpaint-menu {
  min-width: 108px;
  background: var(--neo-chrome-bg);
  box-shadow: var(--neo-chrome-shadow);
}
.node-outpaint-menu.is-below {
  top: calc(100% + 6px);
  transform-origin: top center;
}
.node-outpaint-menu.is-above {
  bottom: calc(100% + 6px);
  transform-origin: bottom center;
}
.node-outpaint-menu__item {
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
.node-outpaint-menu__item:hover {
  background: color-mix(in srgb, var(--neo-text) 8%, transparent);
}
.node-outpaint-menu__item.is-on {
  color: var(--neo-accent-text, #a89dff);
}
</style>
