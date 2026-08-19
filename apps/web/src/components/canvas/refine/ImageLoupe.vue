<script setup lang="ts">
import { computed, ref } from 'vue'
import type { RefineLoupeShape } from '@/stores/canvasEditor'
import { loupeBackground } from './refineWorkLayout'

const LENS = 140

const props = defineProps<{
  src: string
  active: boolean
  shape: RefineLoupeShape
  zoom?: number
}>()

const hostRef = ref<HTMLElement | null>(null)
const visible = ref(false)
const left = ref(0)
const top = ref(0)
const bg = ref({ backgroundSize: '0px 0px', backgroundPosition: '0px 0px' })

const lensStyle = computed(() => ({
  width: `${LENS}px`,
  height: `${LENS}px`,
  left: `${left.value}px`,
  top: `${top.value}px`,
  backgroundImage: `url(${props.src})`,
  backgroundRepeat: 'no-repeat',
  ...bg.value,
}))

function onMove(event: PointerEvent) {
  if (!props.active) return
  const img = hostRef.value?.querySelector('img')
  if (!img) return
  const rect = img.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  const pointerX = event.clientX - rect.left
  const pointerY = event.clientY - rect.top
  if (pointerX < 0 || pointerY < 0 || pointerX > rect.width || pointerY > rect.height) {
    visible.value = false
    return
  }
  const host = hostRef.value!.getBoundingClientRect()
  left.value = event.clientX - host.left - LENS / 2
  top.value = event.clientY - host.top - LENS / 2
  bg.value = loupeBackground({
    displayW: rect.width,
    displayH: rect.height,
    pointerX,
    pointerY,
    lens: LENS,
    zoom: props.zoom ?? 2.5,
  })
  visible.value = true
}

function onLeave() {
  visible.value = false
}
</script>

<template>
  <div
    ref="hostRef"
    class="image-loupe-host"
    @pointermove="onMove"
    @pointerleave="onLeave"
  >
    <slot />
    <div
      v-if="active && visible"
      class="image-loupe-lens"
      :class="shape === 'rect' ? 'is-rect' : 'is-circle'"
      :style="lensStyle"
    />
  </div>
</template>

<style scoped>
.image-loupe-host {
  position: relative;
  display: inline-flex;
  max-width: 100%;
  max-height: 100%;
  align-items: center;
  justify-content: center;
}

.image-loupe-lens {
  pointer-events: none;
  position: absolute;
  z-index: 5;
  border: 2px solid rgba(255, 255, 255, 0.85);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  background-color: #111;
}

.image-loupe-lens.is-circle {
  border-radius: 999px;
}

.image-loupe-lens.is-rect {
  border-radius: 8px;
}
</style>
