<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  getEditIntent,
  IMAGE_EDIT_GATEWAY_MODEL_ID,
  resolveImageEditProfile,
  type ImageVersionEntry,
} from '@lnkpi/shared'
import DockTypeIcon from '@/components/canvas/dock-studio/shared/DockTypeIcon.vue'
import { persistMediaUrl } from '@/composables/useMediaUpload'
import { estimateImageCredits } from '@/constants/credits'
import { studioApi } from '@/services/studio-api'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import { maskCoverageMessage } from '@/utils/maskCoverage'
import { STAIN_PRESET_PROMPT } from '@/utils/refineSession'
import { applyGuideEditIntent, editIntentDisabledReason } from './guideEditIntentApply'
import { syncRefineUrls } from './syncRefineUrls'
import CompareLightbox from './CompareLightbox.vue'
import RefineCompareBand from './RefineCompareBand.vue'
import RefineDock from './RefineDock.vue'
import RefineToolbox from './RefineToolbox.vue'
import { countMaskPixelsFromImageData, exportMaskPng } from './maskExport'
import { loadMaskRgbaFromUrl, mergeMaskRgba, registerRefinePointSelectHandler } from './maskRemote'
import { parseFillHex } from './maskWand'
import { resetMediaPipeSegmentSession, segmentPointLocal } from './mediapipeSegment'
import {
  createPointSegmentSession,
  resetPointSegmentSession,
  resolvePointMaskRgba,
} from './pointSegmentSession'

const REFINE_COLLAPSED_W = 44

const props = defineProps<{
  nodeId: string
  beforeUrl: string
  versions: ImageVersionEntry[]
  currentVersionId?: string
  sessionId: string
  generationRecordId?: string
  width?: number
  height?: number
  /** Shared workbench panel width (px) — owned by useWorkbenchPanel, passed down. */
  panelWidth: number
  /** Shared collapsed flag — owned by useWorkbenchPanel, passed down. */
  collapsed: boolean
  /** Shared narrow (<640px) flag — owned by useWorkbenchPanel, passed down. */
  isNarrow: boolean
  /** Shared right inset (px) — owned by useWorkbenchPanel, passed down to CompareLightbox. */
  insetRight: number
}>()

const emit = defineEmits<{
  close: []
  apply: [payload: { url: string; prompt: string; recordId?: string }]
  revert: [payload: { versionId: string }]
  busy: [value: boolean]
  'update:collapsed': [value: boolean]
  /** 面板宽度调整预留（M2/M3）：当前 resize handle 已移除，暂无生产者；保留 emit + @update:panel-width 接线 */
  'update:panel-width': [value: number]
}>()

const editor = useCanvasEditorStore()
const prompt = ref('')
const activeGuideEditIntentId = ref<string | null>(null)
const guideCapabilities =
  resolveImageEditProfile().capabilities ?? {
    transparentBackground: false,
    qualityParam: true,
    maxRefImages: 4,
  }
/** Refine work image always counts as one ref; multi-ref upload is out of scope for P0 chips. */
const refineRefImageCount = 1
const activeEditIntent = computed(() =>
  activeGuideEditIntentId.value ? getEditIntent(activeGuideEditIntentId.value) ?? null : null,
)
const activeRefRoleHints = computed(() => {
  const roles = activeEditIntent.value?.refRoles
  if (!roles?.length) return ''
  return roles.map((r) => r.hint).join(' · ')
})
const busy = ref(false)
const segmentBusy = ref(false)
const afterUrl = ref(props.beforeUrl)
const errorMessage = ref('')
const compareBeforeUrl = ref(props.beforeUrl)
const lastRecordId = ref<string | undefined>()
// 对照状态已提升到 store（Task 1）：侧栏只读取，写入交由 CompareLightbox / 对照带。
const compareMode = computed(() => editor.refineCompareMode)
const wipeRatio = computed(() => editor.refineWipeRatio)

let abortController: AbortController | null = null
const pointSession = createPointSegmentSession()

function resetPointFallbackState() {
  resetPointSegmentSession(pointSession)
  resetMediaPipeSegmentSession()
}

async function loadWorkImage(url: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = url
  await img.decode()
  return img
}

const credits = computed(() => estimateImageCredits(1))
/** 精修通道模型由服务端写死（studio.service.ts 的 P1_IMAGE_EDIT_MODEL_KEY），前端只做展示。
 *  展示值直接取 shared 的网关模型 id，不写死，避免与真实通道漂移。 */
const editModelLabel = IMAGE_EDIT_GATEWAY_MODEL_ID
const coverageKind = computed(() => maskCoverageMessage(editor.refineCoverage))
const refineDisabled = computed(() => busy.value || coverageKind.value === 'empty')
const canApply = computed(() => !!afterUrl.value && afterUrl.value !== props.beforeUrl)
const backLabel = computed(() => (busy.value ? '取消精修' : '关闭'))
const panelStyle = computed(() => {
  const width = props.collapsed
    ? REFINE_COLLAPSED_W
    : props.isNarrow
      ? undefined
      : props.panelWidth
  return {
    top: '0',
    right: '0',
    bottom: '0',
    width: props.isNarrow ? '100%' : `${width}px`,
  }
})

watch(busy, (value) => emit('busy', value), { immediate: true })

watch(
  () => props.beforeUrl,
  (url) => {
    const next = syncRefineUrls({
      beforeUrl: url,
      afterUrl: afterUrl.value,
      compareBeforeUrl: compareBeforeUrl.value,
    })
    compareBeforeUrl.value = next.compareBeforeUrl
    afterUrl.value = next.afterUrl
    if (next.reset) lastRecordId.value = undefined
    resetPointFallbackState()
  },
)

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: string; name?: string }
  return e.code === 'ERR_CANCELED' || e.name === 'CanceledError' || e.name === 'AbortError'
}

function formatError(err: unknown, fallback: string): string {
  if (isAbortError(err)) return ''
  if (!err || typeof err !== 'object') return fallback
  const e = err as {
    message?: string
    response?: { data?: { message?: string | string[] } }
  }
  const msg = e.response?.data?.message
  if (typeof msg === 'string' && msg.trim()) return msg
  if (Array.isArray(msg) && msg[0]) return String(msg[0])
  if (typeof e.message === 'string' && e.message.trim()) return e.message
  return fallback
}

function applyStainPreset() {
  activeGuideEditIntentId.value = null
  prompt.value = STAIN_PRESET_PROMPT
}

function editIntentChipDisabled(intentId: string): boolean {
  return busy.value || !!editIntentDisabledReason(intentId, guideCapabilities)
}

function applyEditIntent(intentId: string) {
  if (editIntentChipDisabled(intentId)) return
  const result = applyGuideEditIntent({
    intentId,
    capabilities: guideCapabilities,
    refImageCount: refineRefImageCount,
    mode: 'fill',
  })
  if (!result.ok) {
    ElMessage.warning(result.reason)
    return
  }
  activeGuideEditIntentId.value = result.guideEditIntentId
  prompt.value = result.prompt
}

function clearEditIntent() {
  activeGuideEditIntentId.value = null
}

function onSelectVersion(versionId: string) {
  if (busy.value) return
  const version = props.versions.find((item) => item.id === versionId)
  if (version) compareBeforeUrl.value = version.url
}

function onRevert(versionId: string) {
  if (busy.value) return
  emit('revert', { versionId })
}

function onBackOrCancel() {
  if (busy.value) {
    abortController?.abort()
    return
  }
  emit('close')
}

function onApply() {
  if (!canApply.value) return
  const payload: { url: string; prompt: string; recordId?: string } = {
    url: afterUrl.value,
    prompt: prompt.value,
  }
  if (lastRecordId.value) payload.recordId = lastRecordId.value
  emit('apply', payload)
}

function toggleCollapsed() {
  emit('update:collapsed', !props.collapsed)
}

async function onPointSelect({ x, y }: { x: number; y: number }) {
  if (busy.value || segmentBusy.value) return
  const mask = editor.getRefineMask()
  const canvas = mask?.getCanvas()
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  segmentBusy.value = true
  try {
    const remoteRgba = await resolvePointMaskRgba({
      session: pointSession,
      remoteSegment: async () => {
        const { data } = await studioApi.segmentImage({
          imageUrl: props.beforeUrl,
          x,
          y,
          label: 1,
        })
        return { maskUrl: data.data.maskUrl }
      },
      loadRemoteRgba: (maskUrl) => loadMaskRgbaFromUrl(maskUrl, canvas.width, canvas.height),
      localSegment: async () => {
        const img = await loadWorkImage(props.beforeUrl)
        return segmentPointLocal({
          image: img,
          imageKey: props.beforeUrl,
          x,
          y,
          width: canvas.width,
          height: canvas.height,
        })
      },
      onFallbackToast: () => {
        ElMessage.warning('云端点选暂不可用，已用本地点选')
      },
    })
    const base = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const merged = mergeMaskRgba({
      width: canvas.width,
      height: canvas.height,
      baseMaskRgba: base.data,
      remoteMaskRgba: remoteRgba,
      fillRgb: parseFillHex(editor.refineBrushColor),
      mode: editor.refineMaskOp === 'subtract' ? 'subtract' : 'add',
    })
    ctx.putImageData(new ImageData(new Uint8ClampedArray(merged), canvas.width, canvas.height), 0, 0)
    const counted = countMaskPixelsFromImageData(ctx.getImageData(0, 0, canvas.width, canvas.height))
    editor.refineCoverage = counted.ratio
  } catch (err) {
    const message = formatError(err, '点选失败，请重试')
    if (message) ElMessage.error(message)
  } finally {
    segmentBusy.value = false
  }
}

async function runRefine() {
  if (refineDisabled.value) return
  if (activeGuideEditIntentId.value) {
    const gate = applyGuideEditIntent({
      intentId: activeGuideEditIntentId.value,
      capabilities: guideCapabilities,
      refImageCount: refineRefImageCount,
      mode: 'submit',
    })
    if (!gate.ok) {
      errorMessage.value = gate.reason
      return
    }
  }
  const mask = editor.getRefineMask()
  const canvas = mask?.getCanvas()
  if (!mask || !canvas) return

  errorMessage.value = ''
  abortController?.abort()
  abortController = new AbortController()
  const signal = abortController.signal
  busy.value = true

  try {
    const blob = await (mask.exportPng?.() ?? exportMaskPng(canvas))
    const file = new File([blob], 'mask.png', { type: 'image/png' })
    const fallbackUrl = URL.createObjectURL(file)
    let maskUrl: string
    try {
      maskUrl = await persistMediaUrl(file, fallbackUrl)
    } catch (err) {
      URL.revokeObjectURL(fallbackUrl)
      throw err
    }
    if (maskUrl !== fallbackUrl) URL.revokeObjectURL(fallbackUrl)

    const { data } = await studioApi.editImage(
      {
        prompt: prompt.value,
        imageUrl: props.beforeUrl,
        maskUrl,
        sessionId: props.sessionId,
        nodeId: props.nodeId,
        parentRecordId: props.generationRecordId,
        parentVersionId: props.currentVersionId,
      },
      signal,
    )
    const url = data.data.url
    if (url) {
      afterUrl.value = url
      lastRecordId.value = data.data.id
    }
  } catch (err) {
    const message = formatError(err, '精修失败，请重试')
    if (message) errorMessage.value = message
  } finally {
    busy.value = false
    abortController = null
  }
}

onMounted(() => {
  registerRefinePointSelectHandler(onPointSelect)
})

onBeforeUnmount(() => {
  registerRefinePointSelectHandler(null)
  resetPointFallbackState()
})
</script>

<template>
  <Teleport to="body">
    <aside
      class="refine-side"
      :class="{ 'is-collapsed': collapsed }"
      :style="panelStyle"
      @click.stop
    >
      <header
        class="refine-side__head"
      >
        <div class="flex min-w-0 items-center gap-1">
          <button
            v-if="!isNarrow"
            type="button"
            class="refine-side__collapse"
            :title="collapsed ? '展开精修侧栏' : '收缩精修侧栏'"
            @click="toggleCollapsed"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75">
              <path v-if="collapsed" stroke-linecap="round" stroke-linejoin="round" d="M15 6 9 12l6 6" />
              <path v-else stroke-linecap="round" stroke-linejoin="round" d="M9 6l6 6-6 6" />
            </svg>
          </button>
          <span v-if="!collapsed" class="bottom-toolbar-type-icon" title="精修">
            <DockTypeIcon icon="image" :size="18" />
          </span>
          <span v-if="!collapsed" class="refine-side__title">精修</span>
        </div>
        <div v-if="!collapsed" class="flex items-center gap-1">
          <button type="button" class="refine-side__icon-btn" :title="backLabel" @click="onBackOrCancel">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.75">
              <path v-if="busy" stroke-linecap="round" d="M6 6l12 12M18 6 6 18" />
              <path v-else stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      </header>
      <RefineCompareBand
        v-if="!collapsed"
        :before-url="compareBeforeUrl"
        :after-url="afterUrl"
      />

      <div v-if="!collapsed" class="refine-side__body">
        <RefineToolbox
          :versions="versions"
          :current-version-id="currentVersionId"
          :busy="busy"
          @apply-stain-preset="applyStainPreset"
          @select-version="onSelectVersion"
          @revert-version="onRevert"
        />
      </div>

      <RefineDock
        v-if="!collapsed"
        :prompt="prompt"
        :credits="credits"
        :before-url="beforeUrl"
        :model-label="editModelLabel"
        :busy="busy"
        :disabled="refineDisabled"
        :can-apply="canApply"
        :error-message="errorMessage"
        :coverage-kind="coverageKind"
        :width="width"
        :height="height"
        :active-edit-intent-id="activeGuideEditIntentId"
        :ref-role-hints="activeRefRoleHints"
        @update:prompt="prompt = $event"
        @run="runRefine"
        @apply="onApply"
        @retry="runRefine"
        @close="onBackOrCancel"
        @select-edit-intent="applyEditIntent"
        @clear-edit-intent="clearEditIntent"
      />
    </aside>
  </Teleport>

  <CompareLightbox
    :open="editor.compareLightboxOpen"
    :before-url="compareBeforeUrl"
    :after-url="afterUrl"
    :mode="compareMode"
    :wipe-ratio="wipeRatio"
    :inset-right="insetRight"
    @close="editor.setCompareLightboxOpen(false)"
    @update:mode="editor.setRefineCompareMode($event)"
    @update:wipe-ratio="editor.setRefineWipeRatio($event)"
  />
</template>

<style scoped>
.refine-side {
  position: fixed;
  z-index: 55;
  display: flex;
  min-height: 0;
  flex-direction: column;
  background: var(--neo-surface, #111);
  color: var(--neo-text-primary);
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.28);
}

.refine-side.is-collapsed {
  overflow: hidden;
}

.refine-side.is-collapsed .refine-side__head {
  flex-direction: column;
  justify-content: flex-start;
  padding: 8px 4px;
}

.refine-side__collapse {
  display: inline-flex;
  height: 28px;
  width: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--neo-text-muted);
  cursor: pointer;
}

.refine-side__collapse:hover {
  background: var(--neo-hover-bg);
  color: var(--neo-text-primary);
}

.refine-side__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--neo-border);
}

.refine-side__title {
  font-size: 13px;
  font-weight: 600;
}

.refine-side__body {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;      /* 滚动在 .refine-toolbox__scroll 里，整栏只有一个滚动区 */
}

.refine-side__icon-btn {
  display: inline-flex;
  height: 28px;
  width: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--neo-text-muted);
  cursor: pointer;
}

.refine-side__icon-btn:hover {
  background: var(--neo-hover-bg);
  color: var(--neo-text-primary);
}

.refine-side__icon-btn.is-active {
  border-color: var(--neo-border-strong);
  color: var(--neo-text-primary);
  background: var(--neo-hover-bg);
}

.refine-side__icon-btn.is-guide-active {
  border-color: color-mix(in srgb, rgb(232 121 249) 25%, transparent);
  background: color-mix(in srgb, rgb(217 70 239) 15%, transparent);
  color: rgb(240 171 252);
}

.refine-side__icon-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
</style>
