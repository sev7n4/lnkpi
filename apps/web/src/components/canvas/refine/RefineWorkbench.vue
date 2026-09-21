<script setup lang="ts">
import { computed } from 'vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import { useWorkbenchPanel } from '@/components/canvas/workbench/useWorkbenchPanel'
import type { ImageVersionEntry } from '@lnkpi/shared'
import RefineWorkViewport from './RefineWorkViewport.vue'
import RefineSidePanel from './RefineSidePanel.vue'
import { useNaturalImageSize } from './useNaturalImageSize'

const props = defineProps<{
  nodeId: string
  beforeUrl: string
  versions: ImageVersionEntry[]
  currentVersionId?: string
  sessionId: string
  generationRecordId?: string
  url: string
  width?: number
  height?: number
}>()

const emit = defineEmits<{
  close: []
  apply: [payload: { url: string; prompt: string; recordId?: string }]
  revert: [payload: { versionId: string }]
  busy: [value: boolean]
}>()

const editor = useCanvasEditorStore()

/** 节点已产出「处理后」版本（edit 来源）时，左栏对照两项才可点（spec P0-4）。
 *  仅依据已下发的 versions，不重复版本派生逻辑。 */
const hasAfter = computed(() => props.versions.some((v) => v.source === 'edit'))

/** 尺寸兜底（follow-up #4）：mediaInfo 缺宽高时探测图片自然尺寸，dock 才能显示 宽×高 · 比例 */
const mediaSize = useNaturalImageSize({
  url: () => props.url,
  width: () => props.width,
  height: () => props.height,
})

/** Escape→close guard（分级，与对照同思路）：
 *  1) 扩图模式优先退出到 select（再按才继续）；2) 对照灯箱打开则先关；3) 关闭精修。
 *  busy 时 useWorkbenchPanel 已拦截 Esc，故此处无需再判。 */
function onClose() {
  if (editor.refineMode === 'outpaint') {
    editor.setRefineMode('select')
    return
  }
  if (editor.compareLightboxOpen) {
    editor.setCompareLightboxOpen(false)
    return
  }
  emit('close')
}

const { panelWidth, collapsed, isNarrow, insetRight, setPanelWidth, setCollapsed } = useWorkbenchPanel({
  defaultWidth: 400,
  busy: () => editor.refineBusy,
  onClose,
})
</script>

<template>
  <RefineWorkViewport
    v-show="!editor.compareLightboxOpen"
    :url="url"
    :width="width"
    :height="height"
    :inset-right="insetRight"
    :has-after="hasAfter"
  />
  <RefineSidePanel
    :node-id="nodeId"
    :before-url="beforeUrl"
    :versions="versions"
    :current-version-id="currentVersionId"
    :session-id="sessionId"
    :generation-record-id="generationRecordId"
    :width="mediaSize.width.value"
    :height="mediaSize.height.value"
    :panel-width="panelWidth"
    :collapsed="collapsed"
    :is-narrow="isNarrow"
    :inset-right="insetRight"
    @close="emit('close')"
    @apply="emit('apply', $event)"
    @revert="emit('revert', $event)"
    @busy="emit('busy', $event)"
    @update:collapsed="setCollapsed($event)"
    @update:panel-width="setPanelWidth($event)"
  />
</template>
