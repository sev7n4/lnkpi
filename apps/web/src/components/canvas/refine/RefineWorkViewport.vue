<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import { panFromDrag, panZoomFromWheel } from './compareLightboxTransform'
import MaskEditor from './MaskEditor.vue'
import ImageLoupe from './ImageLoupe.vue'
import RefineModeBar from './RefineModeBar.vue'
import RefineToolRail from './RefineToolRail.vue'
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
})

onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  onPanUp()
  editor.registerRefineMask(null)
})
</script>

<template>
  <section class="refine-work" :style="{ right: `${insetRight}px` }">
    <!-- 左栏：输入工具（产出选区 / 蒙版）+ 查看工具（只看不改） -->
    <div class="refine-work__rail">
      <RefineToolRail :has-after="props.hasAfter ?? true" @fit="resetView" @actual-size="zoomOneToOne" />
    </div>

    <div class="refine-work__col">
      <RefineModeBar />
      <div
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
              />
            </ImageLoupe>
          </div>
        </div>
      </div>
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
