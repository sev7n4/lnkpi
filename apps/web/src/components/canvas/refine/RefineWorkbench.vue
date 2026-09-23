<script setup lang="ts">
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import WorkbenchShell from '@/components/canvas/workbench/WorkbenchShell.vue'
import type { RefineApplyPayload } from './compareViewModel'
import RefineWorkViewport from './RefineWorkViewport.vue'
import RefineSidePanel from './RefineSidePanel.vue'
import { useNaturalImageSize } from './useNaturalImageSize'

const props = defineProps<{
  nodeId: string
  beforeUrl: string
  sessionId: string
  generationRecordId?: string
  url: string
  width?: number
  height?: number
}>()

const emit = defineEmits<{
  close: []
  apply: [payload: RefineApplyPayload]
  busy: [value: boolean]
}>()

const editor = useCanvasEditorStore()

/** 尺寸兜底（follow-up #4）：mediaInfo 缺宽高时探测图片自然尺寸，dock 才能显示 宽×高 · 比例 */
const mediaSize = useNaturalImageSize({
  url: () => props.url,
  width: () => props.width,
  height: () => props.height,
})

/** Escape→close guard（分级，spec 图 3 下半段）：
 *  1) 非 select 模式（扩图 / 抠图）先回选区；2) 对照灯箱打开则先关；3) 关闭精修。
 *  busy 时 WorkbenchShell 的 useWorkbenchPanel 已拦截 Esc，故此处无需再判。 */
function onClose() {
  if (editor.refineMode !== 'select') {
    editor.setRefineMode('select')
    return
  }
  if (editor.compareLightboxOpen) {
    editor.setCompareLightboxOpen(false)
    return
  }
  emit('close')
}
</script>

<template>
  <WorkbenchShell
    :default-width="400"
    :busy="editor.refineBusy"
    @close="onClose"
  >
    <template #viewport="{ insetRight }">
      <RefineWorkViewport
        v-show="!editor.compareLightboxOpen"
        :url="url"
        :width="width"
        :height="height"
        :inset-right="insetRight"
        :has-after="!!editor.currentRefineSessionResult"
      />
    </template>

    <template #panel="{ panelWidth, collapsed, isNarrow, insetRight, floatingAvailable, setCollapsed, setPanelWidth }">
      <RefineSidePanel
        :node-id="nodeId"
        :before-url="beforeUrl"
        :session-id="sessionId"
        :generation-record-id="generationRecordId"
        :width="mediaSize.width.value"
        :height="mediaSize.height.value"
        :panel-width="panelWidth"
        :collapsed="collapsed"
        :is-narrow="isNarrow"
        :inset-right="insetRight"
        :floating-available="floatingAvailable"
        @close="emit('close')"
        @apply="emit('apply', $event)"
        @busy="emit('busy', $event)"
        @update:collapsed="setCollapsed($event)"
        @update:panel-width="setPanelWidth($event)"
      />
    </template>
  </WorkbenchShell>
</template>
