<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import { panFromDrag, panZoomFromWheel } from './compareLightboxTransform'
import MaskEditor from './MaskEditor.vue'
import ImageLoupe from './ImageLoupe.vue'
import RefineToolRail from './RefineToolRail.vue'
import RefineOutpaintCanvas from './RefineOutpaintCanvas.vue'
import { dispatchRefinePointSelect } from './maskRemote'
import { containRect, oneToOneScaleOf } from './refineWorkLayout'

const props = defineProps<{
  url: string
  width?: number
  height?: number
  /** Right inset (px) — owned by useWorkbenchPanel in the parent workbench. */
  insetRight: number
  /** 是否已有「处理后」版本；由 RefineWorkbench 依据节点 versions 计算后下发（spec P0-4）。 */
  hasAfter?: boolean
}>()

const editor = useCanvasEditorStore()
const stageRef = ref<HTMLElement | null>(null)
const maskRef = ref<InstanceType<typeof MaskEditor> | null>(null)
const stageW = ref(0)
const stageH = ref(0)
const imgW = ref(Number(props.width) || 0)
const imgH = ref(Number(props.height) || 0)
const scale = ref(1)
const panX = ref(0)
const panY = ref(0)
const spaceDown = ref(false)
let dragging = false
let lastX = 0
let lastY = 0
let ro: ResizeObserver | null = null

const film = computed(() => containRect(stageW.value, stageH.value, imgW.value || 1, imgH.value || 1))
const worldStyle = computed(() => ({
  transform: `translate(${panX.value}px, ${panY.value}px) scale(${scale.value})`,
}))
const filmStyle = computed(() => ({
  left: `${film.value.x}px`,
  top: `${film.value.y}px`,
  width: `${film.value.width}px`,
  height: `${film.value.height}px`,
}))

const oneToOneScale = computed(() => oneToOneScaleOf(imgW.value, film.value.width))

function measure() {
  const el = stageRef.value
  if (!el) return
  stageW.value = el.clientWidth
  stageH.value = el.clientHeight
}

function onWheel(event: WheelEvent) {
  event.preventDefault()
  const next = panZoomFromWheel({
    scale: scale.value,
    panX: panX.value,
    panY: panY.value,
    deltaY: event.deltaY,
  })
  scale.value = next.scale
  panX.value = next.panX
  panY.value = next.panY
}

function onPointerDown(event: PointerEvent) {
  if (event.button === 1 || spaceDown.value) {
    event.preventDefault()
    dragging = true
    lastX = event.clientX
    lastY = event.clientY
    window.addEventListener('pointermove', onPanMove)
    window.addEventListener('pointerup', onPanUp)
  }
}

function onPanMove(event: PointerEvent) {
  if (!dragging) return
  const next = panFromDrag({
    panX: panX.value,
    panY: panY.value,
    dx: event.clientX - lastX,
    dy: event.clientY - lastY,
  })
  panX.value = next.panX
  panY.value = next.panY
  lastX = event.clientX
  lastY = event.clientY
}

function onPanUp() {
  dragging = false
  window.removeEventListener('pointermove', onPanMove)
  window.removeEventListener('pointerup', onPanUp)
}

function onKeyDown(event: KeyboardEvent) {
  if (event.code !== 'Space' || event.repeat) return
  // 全屏对照打开时视口被 v-show 隐藏，空格语义归 CompareView（按住看原图），不再抢平移
  if (editor.compareLightboxOpen) return
  const tag = (event.target as HTMLElement | null)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  spaceDown.value = true
}

function onKeyUp(event: KeyboardEvent) {
  if (event.code === 'Space') spaceDown.value = false
}

function resetView() {
  scale.value = 1
  panX.value = 0
  panY.value = 0
}

function zoomOneToOne() {
  scale.value = oneToOneScale.value
  panX.value = 0
  panY.value = 0
}

/** 适配菜单的放大 / 缩小（follow-up #10）：transform-origin 是中心，直接乘层级即可 */
const ZOOM_MIN = 0.1
const ZOOM_MAX = 8
function zoomStep(factor: number) {
  scale.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale.value * factor))
}

/* 蒙版撤销 / 重做（follow-up #13）：rail 按钮 + ⌘Z / ⇧⌘Z 快捷键 */
const maskCanUndo = ref(false)
const maskCanRedo = ref(false)
function onMaskHistory(depth: { undo: number; redo: number }) {
  maskCanUndo.value = depth.undo > 0
  maskCanRedo.value = depth.redo > 0
}
function runUndo() { maskRef.value?.undo() }
function runRedo() { maskRef.value?.redo() }
function isEditableTarget(target: EventTarget | null): boolean {
  const tag = (target as HTMLElement | null)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return (target as HTMLElement | null)?.isContentEditable === true
}
function onHistoryKeydown(event: KeyboardEvent) {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return
  if (isEditableTarget(event.target)) return
  event.preventDefault()
  if (event.shiftKey) runRedo()
  else runUndo()
}

watch(
  () => [props.width, props.height] as const,
  ([w, h]) => {
    if (Number(w) > 1) imgW.value = Number(w)
    if (Number(h) > 1) imgH.value = Number(h)
  },
)

watch(
  () => props.url,
  () => {
    resetView()
    if (!(Number(props.width) > 1)) {
      const img = new Image()
      img.onload = () => {
        imgW.value = img.naturalWidth
        imgH.value = img.naturalHeight
      }
      img.src = props.url
    }
  },
  { immediate: true },
)

watch([maskRef], async () => {
  await nextTick()
  if (!maskRef.value) return
  editor.registerRefineMask({
    exportPng: () => maskRef.value!.exportPng(),
    clear: () => maskRef.value!.clear(),
    getCanvas: () => maskRef.value!.getCanvas(),
    invert: () => maskRef.value?.invert(),
  })
}, { immediate: true })

onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => measure())
    if (stageRef.value) ro.observe(stageRef.value)
  }
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('keydown', onHistoryKeydown)
})

onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('keydown', onHistoryKeydown)
  onPanUp()
  editor.registerRefineMask(null)
})
</script>

<template>
  <section class="refine-work" :style="{ right: `${insetRight}px` }">
    <!-- 左栏：输入工具（产出选区 / 蒙版）+ 查看工具（只看不改） -->
    <div class="refine-work__rail">
      <RefineToolRail
        :has-after="props.hasAfter ?? true"
        :can-undo="maskCanUndo"
        :can-redo="maskCanRedo"
        @fit="resetView"
        @actual-size="zoomOneToOne"
        @zoom-in="zoomStep(1.25)"
        @zoom-out="zoomStep(0.8)"
        @undo="runUndo"
        @redo="runRedo"
      />
    </div>

    <div class="refine-work__col">
      <!-- 普通工作图（蒙版精修）：非扩图模式显示 -->
      <div
        v-show="editor.refineMode !== 'outpaint'"
        ref="stageRef"
        class="refine-work__stage"
        :class="{ 'is-pan': spaceDown }"
        title="滚轮缩放 · 空格拖动平移"
        @wheel.prevent="onWheel"
        @pointerdown="onPointerDown"
      >
        <div class="refine-work__world" :style="worldStyle">
          <div class="refine-work__film" :style="filmStyle">
            <ImageLoupe :src="url" :active="editor.refineLoupeOn" :shape="editor.refineLoupeShape" :zoom="editor.refineLoupeZoom">
              <img class="refine-work__img" :src="url" alt="" draggable="false">
              <MaskEditor
                ref="maskRef"
                surface="node"
                :url="url"
                :width="imgW || undefined"
                :height="imgH || undefined"
                :tool="editor.refineTool"
                :brush-size="editor.refineBrushSize"
                :color="editor.refineBrushColor"
                :wand-tolerance="editor.refineWandTolerance"
                :mask-op="editor.refineMaskOp"
                :disabled="editor.refineBusy || spaceDown"
                @coverage="(p) => { editor.refineCoverage = p.ratio }"
                @point-select="dispatchRefinePointSelect"
                @history="onMaskHistory"
              />
            </ImageLoupe>
          </div>
        </div>
      </div>
      <!-- 扩图画布（Task 7）：扩图模式显示，v-show 切换。
           视口由画布自身测量——stage 在本模式下 display:none，其 clientWidth/Height 恒 0，
           不能作为视口来源（见 fix/outpaint-canvas-visibility 回归测试）。 -->
      <RefineOutpaintCanvas
        v-show="editor.refineMode === 'outpaint'"
        :base-url="url"
        :base-width="imgW || props.width || 0"
        :base-height="imgH || props.height || 0"
        :busy="editor.refineBusy"
      />
    </div>
  </section>
</template>

<style scoped>
.refine-work {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  min-width: 0;
  background: rgba(8, 8, 8, 0.72);
  backdrop-filter: blur(8px);
}

.refine-work__rail {
  position: relative;
  z-index: 1;
}

.refine-work__col {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.refine-work__stage {
  position: relative;
  min-height: 0;
  flex: 1;
  overflow: hidden;
  cursor: crosshair;
}

.refine-work__stage.is-pan {
  cursor: grab;
}

.refine-work__world {
  position: absolute;
  inset: 0;
  transform-origin: center center;
}

.refine-work__film {
  position: absolute;
  overflow: hidden;
}

.refine-work__film :deep(.image-loupe-host) {
  width: 100%;
  height: 100%;
}

.refine-work__img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
  user-select: none;
}

.refine-work__film :deep(.mask-editor--node) {
  z-index: 1;
}
</style>
