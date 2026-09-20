<script setup lang="ts">
import { ref } from 'vue'
import { clampGridDims } from '@/utils/gridSlice'
import { useWorkbenchPanel } from '@/components/canvas/workbench/useWorkbenchPanel'
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

function onClose() {
  if (props.busy) return
  emit('close')
}

const { panelWidth, collapsed, isNarrow, insetRight, setPanelWidth, setCollapsed } = useWorkbenchPanel({
  defaultWidth: PANEL_DEFAULT_W,
  busy: () => props.busy,
  onClose,
})

function onApplyGrid(dims: { cols: number; rows: number }) {
  applied.value = clampGridDims(dims.cols, dims.rows)
}

function onConfirm(dims: { cols: number; rows: number }) {
  if (props.busy) return
  emit('confirm', clampGridDims(dims.cols, dims.rows))
}
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
      @update:collapsed="setCollapsed($event)"
      @update:panel-width="setPanelWidth($event)"
    />
  </div>
</template>
