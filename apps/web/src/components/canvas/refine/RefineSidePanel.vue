<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ImageVersionEntry } from '@lnkpi/shared'
import DockCreditBadge from '@/components/canvas/dock-studio/shared/DockCreditBadge.vue'
import DockTypeIcon from '@/components/canvas/dock-studio/shared/DockTypeIcon.vue'
import { persistMediaUrl } from '@/composables/useMediaUpload'
import { estimateImageCredits } from '@/constants/credits'
import { studioApi } from '@/services/studio-api'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import { maskCoverageMessage } from '@/utils/maskCoverage'
import type { CompareMode } from '@/utils/refineChrome'
import { loupeSubcontrolsVisible, maskSubcontrolsVisible, nextCompareWorkspace, wipeCompareLocked } from '@/utils/refineChrome'
import { STAIN_PRESET_PROMPT } from '@/utils/refineSession'
import { syncRefineUrls } from './syncRefineUrls'
import CompareLightbox from './CompareLightbox.vue'
import CompareView from './CompareView.vue'
import VersionStrip from './VersionStrip.vue'
import { exportMaskPng } from './maskExport'

const REFINE_MIN_W = 360
const REFINE_MAX_W = 560
const REFINE_DEFAULT_W = 400
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
}>()

const emit = defineEmits<{
  close: []
  apply: [payload: { url: string; prompt: string; recordId?: string }]
  revert: [payload: { versionId: string }]
  busy: [value: boolean]
}>()

const editor = useCanvasEditorStore()
const promptRef = ref<HTMLTextAreaElement | null>(null)
const prompt = ref('')
const busy = ref(false)
const afterUrl = ref(props.beforeUrl)
const errorMessage = ref('')
const compareBeforeUrl = ref(props.beforeUrl)
const lastRecordId = ref<string | undefined>()
const compareMode = ref<CompareMode>('split')
const wipeRatio = ref(0.5)
const panelWidth = ref(REFINE_DEFAULT_W)
const floatPos = ref({ x: 0, y: 0 })
const isNarrow = ref(false)
let abortController: AbortController | null = null
let resizing = false
let dragging = false
let dragOffset = { x: 0, y: 0 }

const credits = computed(() => estimateImageCredits(1))
const coverageKind = computed(() => maskCoverageMessage(editor.refineCoverage))
const refineDisabled = computed(() => busy.value || coverageKind.value === 'empty')
const canApply = computed(() => !!afterUrl.value && afterUrl.value !== props.beforeUrl)
const backLabel = computed(() => (busy.value ? '取消精修' : '关闭'))
const floating = computed(() => editor.refineChrome === 'floating')
const collapsed = computed(() => editor.refinePanelCollapsed && !isNarrow.value)
const wipeLocked = computed(() => wipeCompareLocked(canApply.value))
const loupeMenuOpen = computed(() => loupeSubcontrolsVisible(editor.refineLoupeOn))
const maskMenuOpen = computed(() => maskSubcontrolsVisible(editor.refineMaskMenuOpen))
const panelStyle = computed(() => {
  const width = collapsed.value
    ? REFINE_COLLAPSED_W
    : isNarrow.value
      ? undefined
      : panelWidth.value
  if (floating.value && !isNarrow.value) {
    return {
      left: collapsed.value ? undefined : `${floatPos.value.x}px`,
      right: collapsed.value ? '0px' : undefined,
      top: collapsed.value ? '0px' : `${floatPos.value.y}px`,
      width: `${collapsed.value ? REFINE_COLLAPSED_W : panelWidth.value}px`,
      height: collapsed.value ? '100vh' : 'calc(100vh - 72px)',
    }
  }
  return {
    top: '0',
    right: '0',
    bottom: '0',
    width: isNarrow.value ? '100%' : `${width}px`,
  }
})

watch(busy, (value) => emit('busy', value), { immediate: true })

watch(panelWidth, (width) => {
  if (!editor.refinePanelCollapsed) editor.setRefinePanelWidth(width)
}, { immediate: true })

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
  prompt.value = STAIN_PRESET_PROMPT
}

function focusReplacePrompt() {
  promptRef.value?.focus()
}

function onLoupeZoomInput(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  editor.setRefineLoupeZoom(Number(target.value))
}

function onBrushColorInput(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  editor.setRefineBrushColor(target.value)
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

function toggleCompareWorkspace() {
  const next = nextCompareWorkspace(editor.compareLightboxOpen ? 'compare' : 'work')
  editor.setCompareLightboxOpen(next === 'compare')
}

function onBrushParentClick() {
  if (busy.value) return
  if (!editor.refineMaskMenuOpen) {
    editor.setRefineMaskMenuOpen(true)
    editor.refineTool = 'brush'
    return
  }
  if (editor.refineTool !== 'brush') {
    editor.refineTool = 'brush'
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

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function toggleFloating() {
  if (isNarrow.value) return
  if (editor.refineChrome === 'floating') {
    editor.setRefineChrome('docked')
    return
  }
  floatPos.value = {
    x: Math.max(16, window.innerWidth - panelWidth.value - 40),
    y: 56,
  }
  editor.setRefineChrome('floating')
}

function toggleCollapsed() {
  if (isNarrow.value) return
  editor.setRefinePanelCollapsed(!editor.refinePanelCollapsed)
}

function startResize(event: MouseEvent) {
  event.preventDefault()
  resizing = true
  window.addEventListener('mousemove', onResize)
  window.addEventListener('mouseup', stopResize)
}

function onResize(event: MouseEvent) {
  if (!resizing) return
  panelWidth.value = clamp(window.innerWidth - event.clientX, REFINE_MIN_W, REFINE_MAX_W)
}

function stopResize() {
  resizing = false
  window.removeEventListener('mousemove', onResize)
  window.removeEventListener('mouseup', stopResize)
}

function startDrag(event: MouseEvent) {
  if (editor.refineChrome !== 'floating') return
  if ((event.target as HTMLElement).closest('button')) return
  dragging = true
  dragOffset = { x: event.clientX - floatPos.value.x, y: event.clientY - floatPos.value.y }
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', stopDrag)
}

function onDrag(event: MouseEvent) {
  if (!dragging) return
  floatPos.value = {
    x: Math.max(8, event.clientX - dragOffset.x),
    y: Math.max(8, event.clientY - dragOffset.y),
  }
}

function stopDrag() {
  dragging = false
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', stopDrag)
}

function syncNarrow() {
  isNarrow.value = window.innerWidth < 640
  if (isNarrow.value && editor.refineChrome === 'floating') editor.setRefineChrome('docked')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (editor.compareLightboxOpen) {
    editor.setCompareLightboxOpen(false)
    event.preventDefault()
    return
  }
  if (!busy.value) emit('close')
}

async function runRefine() {
  if (refineDisabled.value) return
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
  syncNarrow()
  window.addEventListener('resize', syncNarrow)
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncNarrow)
  window.removeEventListener('keydown', onKeydown)
  stopResize()
  stopDrag()
})
</script>

<template>
  <Teleport to="body">
    <aside
      class="refine-side"
      :class="{ 'is-floating': floating && !isNarrow && !collapsed, 'is-collapsed': collapsed }"
      :style="panelStyle"
      @click.stop
    >
      <div v-if="!collapsed" class="refine-resize" title="拖拉调整宽度" @mousedown="startResize" />
      <header
        class="refine-side__head"
        :class="{ 'cursor-move': floating && !isNarrow && !collapsed }"
        @mousedown="startDrag"
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
          <button
            v-if="!isNarrow"
            type="button"
            class="refine-side__icon-btn"
            :title="floating ? '停靠回侧栏' : '切换为浮动窗口'"
            @click="toggleFloating"
          >
            <svg v-if="!floating" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.75">
              <path stroke-linecap="round" d="M20 9V5.5A1.5 1.5 0 0 0 18.5 4H5.5A1.5 1.5 0 0 0 4 5.5v10A1.5 1.5 0 0 0 5.5 17H9" />
              <rect x="12" y="12" width="9" height="8" rx="1.5" />
            </svg>
            <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.75">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path stroke-linecap="round" d="M15 4v16" />
            </svg>
          </button>
          <button type="button" class="refine-side__icon-btn" :title="backLabel" @click="onBackOrCancel">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.75">
              <path v-if="busy" stroke-linecap="round" d="M6 6l12 12M18 6 6 18" />
              <path v-else stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      </header>
      <div v-show="!collapsed" class="refine-side__body">
        <div class="refine-side__toolbar">
          <div class="refine-side__icon-row">
            <button type="button" class="refine-side__icon-btn" :class="{ 'is-active': compareMode === 'split' }" title="左右对照" @click="compareMode = 'split'">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75">
                <rect x="3" y="5" width="7" height="14" rx="1.5" />
                <rect x="14" y="5" width="7" height="14" rx="1.5" />
              </svg>
            </button>
            <button type="button" class="refine-side__icon-btn" :class="{ 'is-active': compareMode === 'wipe' }" title="重叠滑竿" :disabled="wipeLocked" @click="compareMode = 'wipe'">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75">
                <rect x="3" y="5" width="18" height="14" rx="1.5" />
                <path stroke-linecap="round" d="M12 5v14" />
              </svg>
            </button>
            <button
              type="button"
              class="refine-side__icon-btn"
              :class="{ 'is-active': editor.compareLightboxOpen }"
              :title="editor.compareLightboxOpen ? '回到工作图' : '最大化对照'"
              @click="toggleCompareWorkspace"
            >
              <svg v-if="!editor.compareLightboxOpen" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 4H5v4M15 4h4v4M5 15v4h4M19 15v4h-4" />
              </svg>
              <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 9H5V5M15 9h4V5M5 15v4h4M19 15v4h-4" />
              </svg>
            </button>
            <span class="refine-side__divider" />
            <button type="button" class="refine-side__icon-btn" :class="{ 'is-active': editor.refineLoupeOn }" title="放大镜" @click="editor.setRefineLoupe(!editor.refineLoupeOn)">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75">
                <circle cx="11" cy="11" r="6" />
                <path stroke-linecap="round" d="m20 20-3.5-3.5" />
              </svg>
            </button>
            <template v-if="loupeMenuOpen">
              <button type="button" class="refine-side__icon-btn" :class="{ 'is-active': editor.refineLoupeShape === 'circle' }" title="圆形放大区" @click="editor.setRefineLoupeShape('circle')">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75">
                  <circle cx="12" cy="12" r="7" />
                </svg>
              </button>
              <button type="button" class="refine-side__icon-btn" :class="{ 'is-active': editor.refineLoupeShape === 'rect' }" title="矩形放大区" @click="editor.setRefineLoupeShape('rect')">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75">
                  <rect x="5" y="6" width="14" height="12" rx="2" />
                </svg>
              </button>
              <label class="refine-side__slider" title="放大镜倍数">
                <input
                  type="range"
                  min="1.5"
                  max="6"
                  step="0.5"
                  :value="editor.refineLoupeZoom"
                  @input="onLoupeZoomInput"
                >
                <span>×{{ editor.refineLoupeZoom }}</span>
              </label>
            </template>
          </div>

          <CompareView
            :before-url="compareBeforeUrl"
            :after-url="afterUrl"
            :mode="compareMode"
            :wipe-ratio="wipeRatio"
            @update:wipe-ratio="wipeRatio = $event"
          />

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
              <button type="button" class="refine-side__icon-btn" :class="{ 'is-active': editor.refineTool === 'eraser' }" title="橡皮" :disabled="busy" @click="editor.refineTool = 'eraser'">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m7 17-3-3 8-8 6 6-8 8H7zM14 8l2 2" />
                </svg>
              </button>
              <button type="button" class="refine-side__icon-btn" :class="{ 'is-active': editor.refineTool === 'rect' }" title="矩形选区" :disabled="busy" @click="editor.refineTool = 'rect'">
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
        </div>

        <div class="refine-dock__chips">
          <button type="button" class="refine-dock__chip" :disabled="busy" @click="applyStainPreset">去除污渍瑕疵</button>
          <button type="button" class="refine-dock__chip" :disabled="busy" @click="focusReplacePrompt">替换选区内容</button>
        </div>

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
    @close="editor.setCompareLightboxOpen(false)"
    @update:mode="compareMode = $event"
    @update:wipe-ratio="wipeRatio = $event"
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

.refine-side.is-floating {
  z-index: 70;
  border: 1px solid var(--neo-border);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
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

.refine-resize {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 3;
  width: 6px;
  cursor: ew-resize;
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
.refine-dock__chip:hover,
.refine-dock__tool:hover {
  border-color: var(--neo-border-strong);
  color: var(--neo-text-primary);
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
