<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { containRect } from '@/components/canvas/refine/refineWorkLayout'

const props = defineProps<{
  url: string
  width?: number
  height?: number
  cols: number
  rows: number
  insetRight: number
}>()

const stageRef = ref<HTMLElement | null>(null)
const stageW = ref(0)
const stageH = ref(0)
const imgW = ref(Number(props.width) || 0)
const imgH = ref(Number(props.height) || 0)
let ro: ResizeObserver | null = null

const cellCount = computed(() => Math.max(1, props.cols * props.rows))

const film = computed(() => containRect(stageW.value, stageH.value, imgW.value || 1, imgH.value || 1))
const filmStyle = computed(() => ({
  left: `${film.value.x}px`,
  top: `${film.value.y}px`,
  width: `${film.value.width}px`,
  height: `${film.value.height}px`,
}))

const overlayStyle = computed(() => ({
  gridTemplateColumns: `repeat(${props.cols}, 1fr)`,
  gridTemplateRows: `repeat(${props.rows}, 1fr)`,
}))

function measure() {
  const el = stageRef.value
  if (!el) return
  stageW.value = el.clientWidth
  stageH.value = el.clientHeight
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
    if (Number(props.width) > 1 && Number(props.height) > 1) return
    const img = new Image()
    img.onload = () => {
      if (!(Number(props.width) > 1)) imgW.value = img.naturalWidth
      if (!(Number(props.height) > 1)) imgH.value = img.naturalHeight
    }
    img.src = props.url
  },
  { immediate: true },
)

onMounted(async () => {
  await nextTick()
  measure()
  if (typeof ResizeObserver === 'undefined') return
  ro = new ResizeObserver(() => measure())
  if (stageRef.value) ro.observe(stageRef.value)
})

onBeforeUnmount(() => {
  ro?.disconnect()
})
</script>

<template>
  <section class="refine-work grid-slice-work" :style="{ right: `${insetRight}px` }">
    <header class="refine-work__bar">
      <span>工作图</span>
      <span class="refine-work__hint">均分预览 · 行主序编号</span>
    </header>
    <div ref="stageRef" class="refine-work__stage">
      <div class="refine-work__film" :style="filmStyle">
        <img class="refine-work__img" :src="url" alt="" draggable="false">
        <div class="grid-slice-overlay" :style="overlayStyle">
          <span
            v-for="i in cellCount"
            :key="i"
            class="grid-slice-cell"
            data-cell-index
          >{{ i }}</span>
        </div>
      </div>
    </div>
    <footer class="grid-slice-work__footer">共 {{ cellCount }} 格</footer>
  </section>
</template>

<style scoped>
.grid-slice-work {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  min-width: 0;
  flex-direction: column;
  background: rgba(8, 8, 8, 0.72);
  backdrop-filter: blur(8px);
}

.refine-work__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  color: var(--neo-text-secondary);
  font-size: 12px;
}

.refine-work__hint {
  flex: 1;
  color: var(--neo-text-muted);
  font-size: 11px;
}

.refine-work__stage {
  position: relative;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.refine-work__film {
  position: absolute;
  overflow: hidden;
}

.refine-work__img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
  user-select: none;
}

.grid-slice-overlay {
  position: absolute;
  inset: 0;
  display: grid;
  pointer-events: none;
}

.grid-slice-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--neo-text) 42%, transparent);
  color: color-mix(in srgb, var(--neo-text) 88%, white);
  font-size: 13px;
  font-weight: 600;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.65);
}

.grid-slice-work__footer {
  padding: 8px 12px;
  color: var(--neo-text-muted);
  font-size: 11px;
}
</style>
