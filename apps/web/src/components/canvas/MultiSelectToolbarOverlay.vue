<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { getSelectionBounds } from '@/composables/useCanvasGrouping'
import MultiSelectToolbar from '@/components/canvas/MultiSelectToolbar.vue'

const props = defineProps<{
  selectedIds: string[]
  canGenerateVideo?: boolean
  canUngroup?: boolean
}>()

const emit = defineEmits<{
  group: []
  ungroup: []
  delete: []
  layout: []
  generateVideo: []
  download: []
}>()

const { viewport, nodes: flowNodes } = useVueFlow()
const screenPosition = ref<{ x: number; y: number } | null>(null)

function updatePosition() {
  if (props.selectedIds.length < 1) {
    screenPosition.value = null
    return
  }
  if (props.canUngroup && props.selectedIds.length === 1) {
    const bounds = getSelectionBounds(flowNodes.value, props.selectedIds)
    if (!bounds) {
      screenPosition.value = null
      return
    }
    const zoom = viewport.value.zoom
    screenPosition.value = {
      x: bounds.centerX * zoom + viewport.value.x,
      y: bounds.bottomY * zoom + viewport.value.y,
    }
    return
  }
  if (props.selectedIds.length < 2) {
    screenPosition.value = null
    return
  }
  const bounds = getSelectionBounds(flowNodes.value, props.selectedIds)
  if (!bounds) {
    screenPosition.value = null
    return
  }
  const zoom = viewport.value.zoom
  screenPosition.value = {
    x: bounds.centerX * zoom + viewport.value.x,
    y: bounds.bottomY * zoom + viewport.value.y,
  }
}

let raf = 0
function scheduleUpdate() {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(updatePosition)
}

watch(() => props.selectedIds, scheduleUpdate, { deep: true })
watch(() => props.canUngroup, scheduleUpdate)
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

const visible = computed(() => props.selectedIds.length >= 2 || !!props.canUngroup)
</script>

<template>
  <MultiSelectToolbar
    v-if="visible"
    :selected-ids="selectedIds"
    :can-generate-video="canGenerateVideo"
    :can-ungroup="canUngroup"
    :screen-position="screenPosition"
    @group="emit('group')"
    @ungroup="emit('ungroup')"
    @delete="emit('delete')"
    @layout="emit('layout')"
    @generate-video="emit('generateVideo')"
    @download="emit('download')"
  />
</template>
