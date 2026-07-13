<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

const props = defineProps<{
  startX: number
  startY: number
}>()

const emit = defineEmits<{
  end: [clientX: number, clientY: number]
  cancel: []
}>()

const endX = ref(props.startX)
const endY = ref(props.startY)

function onMove(event: MouseEvent) {
  endX.value = event.clientX
  endY.value = event.clientY
}

function onUp(event: MouseEvent) {
  emit('end', event.clientX, event.clientY)
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('cancel')
}

onMounted(() => {
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  window.addEventListener('keydown', onKey)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('mouseup', onUp)
  window.removeEventListener('keydown', onKey)
})

const pathD = () => {
  const sx = props.startX
  const sy = props.startY
  const ex = endX.value
  const ey = endY.value
  const cx = (sx + ex) / 2
  return `M ${sx} ${sy} C ${cx} ${sy}, ${cx} ${ey}, ${ex} ${ey}`
}
</script>

<template>
  <svg class="batch-connect-line pointer-events-none fixed inset-0 z-[200]" width="100%" height="100%">
    <path
      :d="pathD()"
      fill="none"
      stroke="#818cf8"
      stroke-width="2"
      stroke-dasharray="6 4"
    />
  </svg>
</template>
