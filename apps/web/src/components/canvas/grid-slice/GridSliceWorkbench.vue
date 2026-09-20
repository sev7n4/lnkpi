<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { refineWorkInsetRight } from '@/components/canvas/refine/refineWorkLayout'
import { clampGridDims } from '@/utils/gridSlice'
import GridSliceSidePanel from './GridSliceSidePanel.vue'
import GridSliceWorkViewport from './GridSliceWorkViewport.vue'

const PANEL_DEFAULT_W = 400

const props = withDefaults(
  defineProps<{
    url: string
    imageWidth?: number
    imageHeight?: number
    busy?: boolean
  }>(),
  { busy: false },
)

const emit = defineEmits<{
  confirm: [dims: { cols: number; rows: number }]
  close: []
}>()

const applied = ref(clampGridDims(3, 3))
const panelWidth = ref(PANEL_DEFAULT_W)
const collapsed = ref(false)
const isNarrow = ref(false)

const insetRight = computed(() =>
  refineWorkInsetRight({
    innerWidth: typeof window !== 'undefined' ? window.innerWidth : 1280,
    collapsed: collapsed.value,
    panelWidth: panelWidth.value,
  }),
)

function syncNarrow() {
  isNarrow.value = typeof window !== 'undefined' && window.innerWidth < 640
  if (isNarrow.value) collapsed.value = false
}

function onApplyGrid(dims: { cols: number; rows: number }) {
  applied.value = clampGridDims(dims.cols, dims.rows)
}

function onConfirm(dims: { cols: number; rows: number }) {
  if (props.busy) return
  emit('confirm', clampGridDims(dims.cols, dims.rows))
}

function onClose() {
  if (props.busy) return
  emit('close')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (props.busy) return
  event.preventDefault()
  emit('close')
}

onMounted(() => {
  syncNarrow()
  window.addEventListener('resize', syncNarrow)
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncNarrow)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="grid-slice-workbench">
    <GridSliceWorkViewport
      :url="url"
      :width="imageWidth"
      :height="imageHeight"
      :cols="applied.cols"
      :rows="applied.rows"
      :inset-right="insetRight"
    />
    <GridSliceSidePanel
      :image-width="imageWidth"
      :image-height="imageHeight"
      :cols="applied.cols"
      :rows="applied.rows"
      :busy="busy"
      :collapsed="collapsed"
      :is-narrow="isNarrow"
      :panel-width="panelWidth"
      @apply-grid="onApplyGrid"
      @confirm="onConfirm"
      @close="onClose"
      @update:collapsed="collapsed = $event"
      @update:panel-width="panelWidth = $event"
    />
  </div>
</template>
