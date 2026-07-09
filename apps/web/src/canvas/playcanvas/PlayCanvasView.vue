<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { createPlayCanvasScene, type PlayCanvasNode } from './usePlayCanvas'

const props = defineProps<{
  nodes: PlayCanvasNode[]
}>()

const containerRef = ref<HTMLDivElement>()
const canvasRef = ref<HTMLCanvasElement>()
let scene: ReturnType<typeof createPlayCanvasScene> | null = null

onMounted(() => {
  if (!canvasRef.value) return
  scene = createPlayCanvasScene(canvasRef.value, props.nodes)
})

watch(
  () => props.nodes,
  (next) => scene?.syncNodes(next),
  { deep: true },
)

onUnmounted(() => {
  scene?.destroy()
  scene = null
})
</script>

<template>
  <div ref="containerRef" class="relative h-full w-full overflow-hidden">
    <canvas ref="canvasRef" class="h-full w-full" />
    <div class="pointer-events-none absolute left-3 top-3 rounded-lg bg-black/50 px-2 py-1 text-[10px] text-white/60">
      PlayCanvas POC · 拖拽旋转 · 滚轮缩放
    </div>
  </div>
</template>
