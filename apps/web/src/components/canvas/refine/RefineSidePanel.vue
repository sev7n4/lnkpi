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
import { STAIN_PRESET_PROMPT } from '@/utils/refineSession'
import { syncRefineUrls } from './syncRefineUrls'
import CompareLightbox from './CompareLightbox.vue'
import CompareView from './CompareView.vue'
import VersionStrip from './VersionStrip.vue'
import { exportMaskPng } from './maskExport'

const REFINE_MIN_W = 360
const REFINE_MAX_W = 560
const REFINE_DEFAULT_W = 400

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
const wipeDisabled = computed(() => !canApply.value)
const panelStyle = computed(() => {
  if (floating.value && !isNarrow.value) {
    return {
      left: `${floatPos.value.x}px`,
      top: `${floatPos.value.y}px`,
      width: `${panelWidth.value}px`,
      height: 'calc(100vh - 72px)',
    }
  }
  return {
    top: '0',
    right: '0',
    bottom: '0',
    width: isNarrow.value ? '100%' : `${panelWidth.value}px`,
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
  },
)

watch(canApply, (ok) => {
  if (!ok && compareMode.value === 'wipe') compareMode.value = 'split'
})

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

function onSelectVersion(versionId: string) {
  if (busy.value) return
  const version = props.versions.find((item) => item.id === versionId)
  if (version) compareBeforeUrl.value = version.url
}

function onRevert(payload: { versionId: string }) {
  if (busy.value) return
  emit('revert', payload)
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
      :class="{ 'is-floating': floating && !isNarrow }"
      :style="panelStyle"
      @click.stop
    >
      <div class="refine-resize" title="拖拉调整宽度" @mousedown="startResize" />
      <header
        class="refine-side__head"
        :class="{ 'cursor-move': floating && !isNarrow }"
        @mousedown="startDrag"
      >
        <div class="flex items-center gap-2">
          <span class="bottom-toolbar-type-icon" title="精修">
            <DockTypeIcon icon="image" :size="18" />
          </span>
          <span class="refine-side__title">精修</span>
        </div>
        <div class="flex items-center gap-1">
          <button
            v-if="!isNarrow"
            type="button"
            class="refine-side__icon"
            :title="floating ? '停靠回侧栏' : '切换为浮动窗口'"
            @click="toggleFloating"
          >
            {{ floating ? '停靠' : '浮动' }}
          </button>
          <button type="button" class="refine-dock__back" @click="onBackOrCancel">{{ backLabel }}</button>
        </div>
      </header>
      <div class="refine-side__body">
        <div class="refine-side__compare-head">
          <div class="flex gap-1">
            <button
              type="button"
              class="refine-dock__tool"
              :class="{ 'is-active': compareMode === 'split' }"
              @click="compareMode = 'split'"
            >
              左右
            </button>
            <button
              type="button"
              class="refine-dock__tool"
              :class="{ 'is-active': compareMode === 'wipe' }"
              :disabled="wipeDisabled"
              @click="compareMode = 'wipe'"
            >
              重叠
            </button>
          </div>
          <button type="button" class="refine-dock__tool" @click="editor.setCompareLightboxOpen(true)">
            最大化对照
          </button>
        </div>

        <CompareView
          :before-url="compareBeforeUrl"
          :after-url="afterUrl"
          :mode="compareMode"
          :wipe-ratio="wipeRatio"
          @update:wipe-ratio="wipeRatio = $event"
        />

        <div class="refine-dock__tools">
          <button type="button" class="refine-dock__tool" :class="{ 'is-active': editor.refineTool === 'brush' }" :disabled="busy" @click="editor.refineTool = 'brush'">画笔</button>
          <button type="button" class="refine-dock__tool" :class="{ 'is-active': editor.refineTool === 'eraser' }" :disabled="busy" @click="editor.refineTool = 'eraser'">橡皮</button>
          <button type="button" class="refine-dock__tool" :class="{ 'is-active': editor.refineTool === 'rect' }" :disabled="busy" @click="editor.refineTool = 'rect'">矩形</button>
          <label class="refine-dock__size">
            笔刷大小
            <input v-model.number="editor.refineBrushSize" type="range" min="4" max="80" :disabled="busy">
          </label>
          <button type="button" class="refine-dock__tool" :disabled="busy" @click="editor.getRefineMask()?.clear()">清除选区</button>
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

.refine-side.is-floating {
  z-index: 70;
  border: 1px solid var(--neo-border);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
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

.refine-side__compare-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
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
