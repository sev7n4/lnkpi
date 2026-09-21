<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  getEditIntent,
  resolveImageEditProfile,
  type ImageVersionEntry,
} from '@lnkpi/shared'
import DockCreditBadge from '@/components/canvas/dock-studio/shared/DockCreditBadge.vue'
import DockTypeIcon from '@/components/canvas/dock-studio/shared/DockTypeIcon.vue'
import GuidePickerPopover from '@/components/canvas/dock-studio/shared/GuidePickerPopover.vue'
import { persistMediaUrl } from '@/composables/useMediaUpload'
import { estimateImageCredits } from '@/constants/credits'
import { studioApi } from '@/services/studio-api'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import { maskCoverageMessage } from '@/utils/maskCoverage'
import { maskSubcontrolsVisible } from '@/utils/refineChrome'
import { STAIN_PRESET_PROMPT } from '@/utils/refineSession'
import { applyGuideEditIntent, editIntentDisabledReason } from './guideEditIntentApply'
import { syncRefineUrls } from './syncRefineUrls'
import CompareLightbox from './CompareLightbox.vue'
import RefineCompareBand from './RefineCompareBand.vue'
import VersionStrip from './VersionStrip.vue'
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
const promptRef = ref<HTMLTextAreaElement | null>(null)
const editIntentAnchorRef = ref<HTMLElement | null>(null)
const prompt = ref('')
const activeGuideEditIntentId = ref<string | null>(null)
const editIntentPickerOpen = ref(false)
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
const coverageKind = computed(() => maskCoverageMessage(editor.refineCoverage))
const refineDisabled = computed(() => busy.value || coverageKind.value === 'empty')
const canApply = computed(() => !!afterUrl.value && afterUrl.value !== props.beforeUrl)
const backLabel = computed(() => (busy.value ? '取消精修' : '关闭'))
const maskMenuOpen = computed(() => maskSubcontrolsVisible(editor.refineMaskMenuOpen))
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
  editIntentPickerOpen.value = false
}

function onBrushColorInput(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  editor.setRefineBrushColor(target.value)
}

function onWandToleranceInput(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  editor.setRefineWandTolerance(Number(target.value))
}

function onSelectVersion(versionId: string) {
  if (busy.value) return
  const version = props.versions.find((item) => item.id === versionId)
  if (version) compareBeforeUrl.value = version.url
}

function onRevert(payload: { versionId: string }) {
  if (busy.value) return
  emit('revert', payload)
}

function onBrushParentClick() {
  if (busy.value) return
  if (!editor.refineMaskMenuOpen) {
    editor.setRefineMaskMenuOpen(true)
    editor.setRefineTool('brush')
    return
  }
  if (editor.refineTool !== 'brush') {
    editor.setRefineTool('brush')
    return
  }
  editor.setRefineMaskMenuOpen(false)
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
      <div v-show="!collapsed" class="refine-side__body">
        <RefineCompareBand :before-url="compareBeforeUrl" :after-url="afterUrl" />
        <div class="refine-side__toolbar">
          <div class="refine-side__icon-row">
            <button
              type="button"
              class="refine-side__icon-btn"
              :class="{ 'is-active': maskMenuOpen }"
              title="画笔"
              :disabled="busy"
              @click="onBrushParentClick"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 4 20 9 9 20H4v-5L15 4z" />
              </svg>
            </button>
            <template v-if="maskMenuOpen">
              <button type="button" class="refine-side__icon-btn" :class="{ 'is-active': editor.refineTool === 'eraser' }" title="橡皮" :disabled="busy" @click="editor.setRefineTool('eraser')">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m7 17-3-3 8-8 6 6-8 8H7zM14 8l2 2" />
                </svg>
              </button>
              <button type="button" class="refine-side__icon-btn" :class="{ 'is-active': editor.refineTool === 'rect' }" title="矩形选区" :disabled="busy" @click="editor.setRefineTool('rect')">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75">
                  <rect x="4" y="6" width="16" height="12" rx="1" stroke-dasharray="3 2" />
                </svg>
              </button>
              <label class="refine-side__color" title="选区颜色">
                <input
                  type="color"
                  :value="editor.refineBrushColor"
                  :disabled="busy"
                  @input="onBrushColorInput"
                >
              </label>
              <label class="refine-side__slider" title="笔刷粗细">
                <input v-model.number="editor.refineBrushSize" type="range" min="4" max="80" :disabled="busy">
                <span>{{ editor.refineBrushSize }}</span>
              </label>
              <button type="button" class="refine-side__icon-btn" title="清除选区" :disabled="busy" @click="editor.getRefineMask()?.clear()">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75">
                  <path stroke-linecap="round" d="M5 7h14M10 7V5h4v2M8 7l1 12h6l1-12" />
                </svg>
              </button>
            </template>
          </div>
          <div class="refine-side__icon-row">
            <button
              type="button"
              class="refine-side__icon-btn"
              :class="{ 'is-active': editor.refineTool === 'wand' }"
              :title="editor.refineMaskOp === 'subtract' ? '魔棒减选' : '魔棒'"
              :disabled="busy"
              @click="editor.setRefineTool('wand')"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75">
                <path stroke-linecap="round" d="M7 17 17 7" />
                <path d="M15.5 5.5 18.5 8.5 9 18H6v-3Z" />
              </svg>
            </button>
            <button
              type="button"
              class="refine-side__icon-btn"
              :class="{ 'is-active': editor.refineTool === 'polygon' }"
              :title="editor.refineMaskOp === 'subtract' ? '多边形减选' : '多边形选区'"
              :disabled="busy"
              @click="editor.setRefineTool('polygon')"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75">
                <path stroke-linejoin="round" d="M12 4 20 9.5 17 19H7L4 9.5Z" />
              </svg>
            </button>
            <button
              type="button"
              class="refine-side__icon-btn"
              :class="{ 'is-active': editor.refineTool === 'point' }"
              :title="editor.refineMaskOp === 'subtract' ? '点选减选' : '点选主体'"
              :disabled="busy || segmentBusy"
              @click="editor.setRefineTool('point')"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75">
                <circle cx="12" cy="12" r="3" />
                <path stroke-linecap="round" d="M12 2v4M12 18v4M2 12h4M18 12h4" />
              </svg>
            </button>
            <template v-if="editor.refineTool === 'wand'">
              <label class="refine-side__slider" title="魔棒容差">
                <input
                  type="range"
                  min="0"
                  max="48"
                  step="1"
                  :value="editor.refineWandTolerance"
                  :disabled="busy"
                  @input="onWandToleranceInput"
                >
                <span>{{ editor.refineWandTolerance }}</span>
              </label>
              <button type="button" class="refine-side__icon-btn" title="反向选区" :disabled="busy" @click="editor.getRefineMask()?.invert()">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75">
                  <circle cx="12" cy="12" r="7" />
                  <path d="M12 5a7 7 0 0 1 0 14Z" fill="currentColor" stroke="none" />
                </svg>
              </button>
            </template>
          </div>
        </div>

        <div class="refine-dock__chips">
          <button type="button" class="refine-dock__chip" :disabled="busy" @click="applyStainPreset">清除瑕疵</button>
          <div class="relative">
            <button
              ref="editIntentAnchorRef"
              type="button"
              class="refine-dock__chip refine-dock__chip--intent"
              :class="{ 'is-guide-active': activeGuideEditIntentId }"
              :disabled="busy"
              aria-label="编辑意图"
              title="编辑意图"
              :aria-expanded="editIntentPickerOpen"
              @click="editIntentPickerOpen = !editIntentPickerOpen"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <rect x="4" y="4" width="6" height="6" rx="1" />
                <rect x="14" y="4" width="6" height="6" rx="1" />
                <rect x="4" y="14" width="6" height="6" rx="1" />
                <rect x="14" y="14" width="6" height="6" rx="1" />
              </svg>
              <span>{{ activeEditIntent?.label ?? '编辑意图' }}</span>
              <span
                v-if="activeGuideEditIntentId"
                class="refine-dock__intent-dot"
                aria-hidden="true"
              />
            </button>
            <GuidePickerPopover
              mode="edit_intent"
              :active-id="activeGuideEditIntentId"
              :capabilities="guideCapabilities"
              :open="editIntentPickerOpen"
              :ref-image-count="refineRefImageCount"
              placement="below-end"
              portal
              :anchor-el="editIntentAnchorRef"
              @select="applyEditIntent"
              @clear="clearEditIntent"
              @close="editIntentPickerOpen = false"
            />
          </div>
        </div>

        <p v-if="activeRefRoleHints" class="refine-dock__hint">
          参考图：{{ activeRefRoleHints }}
        </p>

        <textarea
          ref="promptRef"
          v-model="prompt"
          class="refine-dock__prompt"
          placeholder="改这里：……"
          rows="2"
          :disabled="busy"
        />

        <p v-if="coverageKind === 'empty'" class="refine-dock__hint">请先圈选要改的区域</p>
        <p v-else-if="coverageKind === 'full'" class="refine-dock__hint refine-dock__hint--warn">
          这会改整张图，更像重新生成；可用底部生成栏
        </p>

        <div v-if="errorMessage" class="refine-dock__error" role="alert">
          <span>{{ errorMessage }}</span>
          <button type="button" class="refine-dock__retry" :disabled="busy" @click="runRefine">重试</button>
        </div>

        <div class="bottom-toolbar-actions refine-dock__actions">
          <DockCreditBadge :credits="credits" />
          <button type="button" class="refine-dock__primary" :disabled="refineDisabled" @click="runRefine">精修</button>
          <button type="button" class="refine-dock__apply" disabled title="抠图将走专用通道，尚未接入">抠图</button>
          <button v-if="canApply" type="button" class="refine-dock__apply" :disabled="busy" @click="onApply">应用到节点</button>
        </div>

        <VersionStrip
          :versions="versions"
          :current-version-id="currentVersionId"
          :disabled="busy"
          @select="onSelectVersion"
          @revert="onRevert"
        />
      </div>
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

.refine-side__icon,
.refine-dock__back {
  height: 26px;
  padding: 0 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--neo-text-muted);
  font-size: 12px;
  cursor: pointer;
}

.refine-side__icon:hover,
.refine-dock__back:hover {
  background: var(--neo-hover-bg);
  color: var(--neo-text-primary);
}

.refine-side__body {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
  padding: 10px 12px 16px;
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

.refine-side__toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.refine-side__icon-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.refine-side__divider {
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: var(--neo-border);
}

.refine-side__slider {
  display: inline-flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 6px;
  color: var(--neo-text-muted);
  font-size: 11px;
}

.refine-side__slider input {
  min-width: 0;
  flex: 1;
}

.refine-side__color {
  display: inline-flex;
  height: 28px;
  width: 28px;
  overflow: hidden;
  border: 1px solid var(--neo-border);
  border-radius: 8px;
}

.refine-side__color input {
  height: 36px;
  width: 36px;
  margin: -4px;
  cursor: pointer;
  border: none;
  background: none;
}

.refine-dock__tools,
.refine-dock__chips,
.refine-dock__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.refine-dock__tool,
.refine-dock__chip,
.refine-dock__retry,
.refine-dock__apply {
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--neo-border);
  border-radius: 999px;
  background: transparent;
  color: var(--neo-text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.refine-dock__tool.is-active,
.refine-dock__chip.is-active,
.refine-dock__chip:hover,
.refine-dock__tool:hover {
  border-color: var(--neo-border-strong);
  color: var(--neo-text-primary);
}

.refine-dock__chip--intent {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
}

.refine-dock__chip--intent > span:not(.refine-dock__intent-dot) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.refine-dock__chip.is-guide-active {
  border-color: color-mix(in srgb, rgb(232 121 249) 25%, transparent);
  background: color-mix(in srgb, rgb(217 70 239) 15%, transparent);
  color: rgb(240 171 252);
}

.refine-dock__intent-dot {
  position: absolute;
  top: 4px;
  right: 6px;
  height: 5px;
  width: 5px;
  border-radius: 999px;
  background: rgb(232 121 249);
}

.refine-dock__tool:disabled,
.refine-dock__chip:disabled,
.refine-dock__retry:disabled,
.refine-dock__apply:disabled,
.refine-dock__primary:disabled,
.refine-dock__prompt:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.refine-dock__size {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--neo-text-muted);
}

.refine-dock__prompt {
  width: 100%;
  min-height: 56px;
  resize: vertical;
  border: 1px solid var(--neo-border);
  border-radius: 12px;
  background: var(--neo-hover-bg);
  padding: 8px 10px;
  color: var(--neo-text-primary);
  font-size: 12px;
  outline: none;
}

.refine-dock__hint {
  margin: 0;
  font-size: 11px;
  color: var(--neo-text-muted);
}

.refine-dock__hint--warn {
  color: color-mix(in srgb, var(--neo-warm) 80%, white);
}

.refine-dock__error {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid rgba(248, 113, 113, 0.28);
  border-radius: 999px;
  background: rgba(248, 113, 113, 0.1);
  color: rgba(254, 226, 226, 0.92);
  font-size: 12px;
}

.refine-dock__error span {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.refine-dock__primary {
  height: 28px;
  padding: 0 14px;
  border: none;
  border-radius: 999px;
  background: var(--neo-hi-bg);
  color: var(--neo-hi-text);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.refine-dock__actions {
  justify-content: flex-end;
}
</style>
