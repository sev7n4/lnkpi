<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ImageVersionEntry } from '@lnkpi/shared'
import DockCreditBadge from '@/components/canvas/dock-studio/shared/DockCreditBadge.vue'
import DockTypeIcon from '@/components/canvas/dock-studio/shared/DockTypeIcon.vue'
import { persistMediaUrl } from '@/composables/useMediaUpload'
import { estimateImageCredits } from '@/constants/credits'
import { studioApi } from '@/services/studio-api'
import { maskCoverageMessage } from '@/utils/maskCoverage'
import { STAIN_PRESET_PROMPT } from '@/utils/refineSession'
import { syncRefineUrls } from './syncRefineUrls'
import CompareView from './CompareView.vue'
import MaskEditor, { type MaskTool } from './MaskEditor.vue'
import VersionStrip from './VersionStrip.vue'
import { exportMaskPng } from './maskExport'

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

const maskRef = ref<InstanceType<typeof MaskEditor> | null>(null)
const promptRef = ref<HTMLTextAreaElement | null>(null)
const prompt = ref('')
const tool = ref<MaskTool>('brush')
const brushSize = ref(24)
const busy = ref(false)
const afterUrl = ref(props.beforeUrl)
const coverageRatio = ref(0)
const errorMessage = ref('')
const compareBeforeUrl = ref(props.beforeUrl)
const lastRecordId = ref<string | undefined>()
let abortController: AbortController | null = null

const credits = computed(() => estimateImageCredits(1))
const coverageKind = computed(() => maskCoverageMessage(coverageRatio.value))
const refineDisabled = computed(() => busy.value || coverageKind.value === 'empty')
const canApply = computed(() => !!afterUrl.value && afterUrl.value !== props.beforeUrl)
const backLabel = computed(() => (busy.value ? '取消精修' : '返回生成'))

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

function onCoverage(payload: { ratio: number }) {
  coverageRatio.value = payload.ratio
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

async function runRefine() {
  if (refineDisabled.value) return
  const canvas = maskRef.value?.getCanvas()
  if (!canvas) return

  errorMessage.value = ''
  abortController?.abort()
  abortController = new AbortController()
  const signal = abortController.signal
  busy.value = true

  try {
    const blob = await exportMaskPng(canvas)
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
</script>

<template>
  <div
    class="bottom-toolbar-container refine-dock"
    @click.stop
  >
    <div class="bottom-toolbar-header">
      <div class="flex items-center gap-2">
        <span class="bottom-toolbar-type-icon" title="精修">
          <DockTypeIcon icon="image" :size="18" />
        </span>
        <span class="refine-dock__title">精修</span>
      </div>
      <button
        type="button"
        class="refine-dock__back"
        @click="onBackOrCancel"
      >
        {{ backLabel }}
      </button>
    </div>

    <CompareView :before-url="compareBeforeUrl" :after-url="afterUrl">
      <template #before>
        <img
          v-if="compareBeforeUrl !== beforeUrl"
          class="refine-dock__compare-image"
          :src="compareBeforeUrl"
          alt=""
        >
        <MaskEditor
          v-show="compareBeforeUrl === beforeUrl"
          ref="maskRef"
          :url="beforeUrl"
          :width="width"
          :height="height"
          :tool="tool"
          :brush-size="brushSize"
          :disabled="busy"
          @coverage="onCoverage"
        />
      </template>
    </CompareView>

    <div class="refine-dock__tools">
      <button type="button" class="refine-dock__tool" :class="{ 'is-active': tool === 'brush' }" :disabled="busy" @click="tool = 'brush'">画笔</button>
      <button type="button" class="refine-dock__tool" :class="{ 'is-active': tool === 'eraser' }" :disabled="busy" @click="tool = 'eraser'">橡皮</button>
      <button type="button" class="refine-dock__tool" :class="{ 'is-active': tool === 'rect' }" :disabled="busy" @click="tool = 'rect'">矩形</button>
      <label class="refine-dock__size">
        笔刷大小
        <input v-model.number="brushSize" type="range" min="4" max="80" :disabled="busy">
      </label>
      <button type="button" class="refine-dock__tool" :disabled="busy" @click="maskRef?.clear()">清除选区</button>
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
      <button
        type="button"
        class="refine-dock__primary"
        :disabled="refineDisabled"
        @click="runRefine"
      >
        精修
      </button>
      <button
        v-if="canApply"
        type="button"
        class="refine-dock__apply"
        :disabled="busy"
        @click="onApply"
      >
        应用到节点
      </button>
    </div>

    <VersionStrip
      :versions="versions"
      :current-version-id="currentVersionId"
      :disabled="busy"
      @select="onSelectVersion"
      @revert="onRevert"
    />
  </div>
</template>

<style scoped>
.refine-dock {
  gap: 8px;
  max-width: min(1100px, calc(100vw - 32px));
}

.refine-dock__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--neo-text-primary);
}

.refine-dock__compare-image {
  display: block;
  max-width: 100%;
  max-height: 220px;
  object-fit: contain;
}

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

.refine-dock__back:hover {
  background: var(--neo-hover-bg);
  color: var(--neo-text-primary);
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
