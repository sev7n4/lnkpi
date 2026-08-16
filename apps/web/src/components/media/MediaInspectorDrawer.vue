<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { modelOptionName } from '@lnkpi/shared'
import type { GenerationDiagnostic, MediaInfo, ProbedMediaFile } from '@lnkpi/shared'
import MediaRefList from '@/components/media/MediaRefList.vue'
import CanvasLocatePinIcon from '@/components/shared/CanvasLocatePinIcon.vue'
import { useMediaInspector } from '@/composables/useMediaInspector'
import {
  downloadMediaFile,
  mediaDownloadName,
} from '@/composables/useCanvasMedia'
import { resolveMediaUrl } from '@/services/api-base'
import { studioApi } from '@/services/studio-api'
import { copyTextToClipboard } from '@/utils/copyToClipboard'
import {
  buildCopyForNode,
  buildFallbackDiagnostic,
  isFailedGenerationStatus,
  sharedDiagnosticCache,
} from '@/utils/generationDiagnostic'
import {
  formatMediaBytes,
  formatMediaDimensions,
  truncateUrl,
} from '@/utils/mediaInfoFormat'

const route = useRoute()
const sessionId = computed(() => route.params.sessionId as string | undefined)

const {
  open,
  loading,
  error,
  target,
  record,
  locateNodeHandler,
  closeInspector,
  probeMedia,
  locateCanvasNode,
} = useMediaInspector()

const lazyOutput = ref<ProbedMediaFile | undefined>()
const lazyLoading = ref(false)
const activeTab = ref<'info' | 'diagnostic'>('info')
const diagnostic = ref<GenerationDiagnostic | null>(null)
const diagnosticLoading = ref(false)
const diagnosticCopyLabel = ref('复制诊断')

watch(
  () => open.value,
  (isOpen) => {
    if (!isOpen) {
      activeTab.value = 'info'
      diagnostic.value = null
      diagnosticLoading.value = false
      diagnosticCopyLabel.value = '复制诊断'
    }
  },
)

watch(
  () => [open.value, record.value?.id, record.value?.mediaInfo?.output] as const,
  async ([isOpen, , output]) => {
    lazyOutput.value = undefined
    if (!isOpen || !record.value) return
    if (output?.probeStatus === 'ok') {
      lazyOutput.value = output
      return
    }
    const url = record.value.url || target.value?.url
    if (!url) return
    lazyLoading.value = true
    try {
      lazyOutput.value = await probeMedia(url)
    } catch {
      lazyOutput.value = {
        url,
        probeStatus: 'failed',
        probeError: '未能读取文件属性',
      }
    } finally {
      lazyLoading.value = false
    }
  },
  { immediate: true },
)

const parsedMeta = computed(() => {
  const raw = record.value?.metadata
  if (!raw) return {} as Record<string, unknown>
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
})

const mediaInfo = computed<MediaInfo | undefined>(() => {
  const fromRecord = record.value?.mediaInfo
  if (fromRecord?.output || fromRecord?.references?.length) return fromRecord
  if (lazyOutput.value) {
    return { output: lazyOutput.value, probedAt: new Date().toISOString() }
  }
  return fromRecord
})

const previewUrl = computed(() => {
  const url = record.value?.url || target.value?.url || mediaInfo.value?.output?.url
  return url ? resolveMediaUrl(url) : ''
})

const previewKind = computed(() => {
  if (target.value?.kind) return target.value.kind
  return record.value?.type === 'video' ? 'video' : 'image'
})

const title = computed(() => {
  if (target.value?.nodeLabel?.trim()) return target.value.nodeLabel.trim()
  if (record.value?.prompt?.trim()) return record.value.prompt.trim()
  return target.value?.nodeId ? `节点 ${target.value.nodeId}` : '媒体属性'
})

const createdAtText = computed(() => {
  const ts = record.value?.createdAt
  if (!ts) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString()
})

const outputFile = computed(() => mediaInfo.value?.output ?? lazyOutput.value)

const refPreflight = computed(() => record.value?.refPreflight)

const showDiagnosticTab = computed(() =>
  Boolean(record.value && isFailedGenerationStatus(record.value.status)),
)

const diagnosticMessage = computed(() => {
  if (diagnosticLoading.value) return '加载中…'
  return diagnostic.value?.userMessage || '暂无诊断信息'
})

const diagnosticHint = computed(() => {
  if (diagnosticLoading.value) return undefined
  return diagnostic.value?.hint
})

const modelLabel = computed(() => {
  const model = record.value?.model || String(parsedMeta.value.originalModel ?? '')
  if (!model) return null
  return modelOptionName(model) || model
})

const channelLabel = computed(() => {
  const source = parsedMeta.value.providerSource
  if (source === 'user') return 'BYOK'
  if (source === 'platform') return '平台'
  return null
})

const generationParams = computed(() => {
  const rows: Array<{ label: string; value: string }> = []
  if (modelLabel.value) rows.push({ label: '模型', value: modelLabel.value })
  if (channelLabel.value) rows.push({ label: '渠道', value: channelLabel.value })
  const aspectRatio = parsedMeta.value.aspectRatio
  if (typeof aspectRatio === 'string' && aspectRatio) {
    rows.push({ label: '比例', value: aspectRatio })
  }
  const resolution = parsedMeta.value.resolution
  if (typeof resolution === 'string' && resolution) {
    rows.push({ label: '分辨率', value: resolution })
  }
  const duration = parsedMeta.value.duration
  if (typeof duration === 'number' && Number.isFinite(duration)) {
    rows.push({ label: '时长', value: `${duration}s` })
  }
  const videoMode = parsedMeta.value.videoMode
  if (typeof videoMode === 'string' && videoMode) {
    rows.push({ label: '视频模式', value: videoMode })
  }
  const points = parsedMeta.value.pointsCharged ?? parsedMeta.value.cost
  if (typeof points === 'number' && Number.isFinite(points)) {
    rows.push({ label: '积分', value: String(points) })
  }
  return rows
})

const fileInfoRows = computed(() => {
  const file = outputFile.value
  if (!file) return []
  const rows: Array<{ label: string; value: string; copy?: string }> = []
  const dims = formatMediaDimensions(file.width, file.height)
  if (dims) rows.push({ label: '尺寸', value: dims })
  const size = formatMediaBytes(file.bytes)
  if (size) rows.push({ label: '体积', value: size })
  if (file.mimeType) rows.push({ label: '格式', value: file.mimeType })
  if (file.durationSec != null) rows.push({ label: '时长', value: `${file.durationSec}s` })
  if (file.url) {
    rows.push({
      label: 'URL',
      value: truncateUrl(file.url),
      copy: file.url,
    })
  }
  return rows
})

const referenceItems = computed(() => {
  const refs = mediaInfo.value?.references
  if (refs?.length) return refs
  if (refPreflight.value?.refs?.length) return refPreflight.value.refs
  return []
})

function formatMetaValue(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

const l2Rows = computed(() => {
  const meta = parsedMeta.value
  const rows: Array<{ label: string; value: string; multiline?: boolean }> = []
  const add = (label: string, raw: unknown, multiline = false) => {
    const value = formatMetaValue(raw)
    if (value) rows.push({ label, value, multiline })
  }
  add('Prompt', record.value?.prompt || meta.prompt, true)
  add('Seed', meta.seed)
  add('Negative', meta.negativePrompt, true)
  add('Generate audio', meta.generateAudio)
  add('refWire', meta.refWire)
  add('gatewayModelId', meta.gatewayModelId)
  add('scenario', meta.scenario)
  add('mergedText', meta.mergedText, true)
  return rows
})

const nativeParamsJson = computed(() => {
  const nativeParams = parsedMeta.value.nativeParams
  if (nativeParams === undefined || nativeParams === null) return null
  return formatMetaValue(nativeParams)
})

const hasL2 = computed(() => l2Rows.value.length > 0 || Boolean(nativeParamsJson.value))

const canLocate = computed(() =>
  Boolean(locateNodeHandler.value && (record.value?.id || target.value?.generationRecordId)),
)

const taskIdCopyLabel = ref('复制任务 ID')

async function loadDiagnostic() {
  const rec = record.value
  if (!rec) return
  diagnosticLoading.value = true
  diagnosticCopyLabel.value = '复制诊断'
  try {
    diagnostic.value = await sharedDiagnosticCache.get('generation', rec.id, () =>
      studioApi.getGenerationDiagnostic(rec.id),
    )
  } catch {
    diagnostic.value = buildFallbackDiagnostic(rec)
  } finally {
    diagnosticLoading.value = false
  }
}

async function switchToDiagnosticTab() {
  activeTab.value = 'diagnostic'
  if (!diagnostic.value && !diagnosticLoading.value) {
    await loadDiagnostic()
  }
}

watch(
  () => [open.value, record.value?.id, record.value?.status] as const,
  async ([isOpen, , status]) => {
    diagnostic.value = null
    if (!isOpen || !record.value || !status || !isFailedGenerationStatus(status)) return
    if (activeTab.value === 'diagnostic') {
      await loadDiagnostic()
    }
  },
)

async function copyTaskId() {
  const id = record.value?.id || target.value?.generationRecordId
  if (!id) return
  try {
    await copyTextToClipboard(id)
    taskIdCopyLabel.value = '已复制'
    setTimeout(() => {
      taskIdCopyLabel.value = '复制任务 ID'
    }, 1500)
  } catch {
    taskIdCopyLabel.value = '复制失败'
  }
}

async function copyDiagnostic() {
  const rec = record.value
  if (!rec) return
  const payload = diagnostic.value || buildFallbackDiagnostic(rec)
  const text = buildCopyForNode(payload, {
    nodeId: target.value?.nodeId ?? rec.nodeId ?? undefined,
    nodeLabel: target.value?.nodeLabel,
    sessionId: sessionId.value,
  })
  try {
    await copyTextToClipboard(text)
    diagnosticCopyLabel.value = '已复制'
    setTimeout(() => {
      diagnosticCopyLabel.value = '复制诊断'
    }, 1500)
  } catch {
    diagnosticCopyLabel.value = '复制失败'
  }
}

async function downloadOutput() {
  const url = record.value?.url || target.value?.url || outputFile.value?.url
  if (!url) return
  const kind = previewKind.value === 'video' ? 'video' : 'image'
  await downloadMediaFile(
    resolveMediaUrl(url),
    mediaDownloadName(url, kind, title.value),
    { sessionId: sessionId.value },
  )
}

async function copyValue(text: string) {
  try {
    await copyTextToClipboard(text)
  } catch {
    // ignore
  }
}
</script>

<template>
  <ElDrawer
    :model-value="open"
    direction="rtl"
    size="320px"
    :with-header="false"
    append-to-body
    class="media-inspector-drawer"
    @update:model-value="(v: boolean) => { if (!v) closeInspector() }"
  >
    <div class="media-inspector">
      <header class="media-inspector-header">
        <div class="media-inspector-heading">
          <h3 class="media-inspector-title">{{ title }}</h3>
          <p v-if="createdAtText" class="media-inspector-subtitle">{{ createdAtText }}</p>
        </div>
        <button type="button" class="media-inspector-close" aria-label="关闭" @click="closeInspector">
          ×
        </button>
      </header>

      <div v-if="showDiagnosticTab" class="media-inspector-tabs">
        <button
          type="button"
          class="media-inspector-tab"
          :class="{ 'is-active': activeTab === 'info' }"
          @click="activeTab = 'info'"
        >
          属性
        </button>
        <button
          type="button"
          class="media-inspector-tab"
          :class="{ 'is-active': activeTab === 'diagnostic' }"
          @click="switchToDiagnosticTab"
        >
          诊断
        </button>
      </div>

      <div v-if="loading" class="media-inspector-loading">加载中…</div>
      <div v-else-if="error" class="media-inspector-error">{{ error }}</div>
      <div v-else-if="activeTab === 'diagnostic'" class="media-inspector-body">
        <section class="media-inspector-section media-inspector-diagnostic">
          <p class="media-inspector-diag-msg">{{ diagnosticMessage }}</p>
          <p v-if="diagnosticHint" class="media-inspector-diag-hint">{{ diagnosticHint }}</p>
          <button
            type="button"
            class="media-inspector-action"
            :disabled="diagnosticLoading"
            @click="copyDiagnostic"
          >
            {{ diagnosticCopyLabel }}
          </button>
        </section>
      </div>
      <div v-else class="media-inspector-body">
        <section v-if="previewUrl" class="media-inspector-section">
          <div class="media-inspector-preview">
            <img v-if="previewKind === 'image'" :src="previewUrl" alt="" class="media-inspector-media">
            <video
              v-else
              :src="previewUrl"
              controls
              playsinline
              preload="metadata"
              class="media-inspector-media"
            />
          </div>
        </section>

        <ElAlert
          v-if="refPreflight && refPreflight.level !== 'none'"
          :type="refPreflight.level === 'error' ? 'error' : 'warning'"
          :closable="false"
          show-icon
          class="media-inspector-alert"
          :title="refPreflight.message"
        />

        <section class="media-inspector-section">
          <h4 class="media-inspector-section-title">文件信息</h4>
          <p v-if="lazyLoading" class="media-inspector-muted">正在读取文件属性…</p>
          <p
            v-else-if="outputFile?.probeStatus === 'failed'"
            class="media-inspector-muted"
          >
            未能读取文件属性
          </p>
          <dl v-else-if="fileInfoRows.length" class="media-inspector-dl">
            <template v-for="row in fileInfoRows" :key="row.label">
              <dt>{{ row.label }}</dt>
              <dd>
                <span>{{ row.value }}</span>
                <button
                  v-if="row.copy"
                  type="button"
                  class="media-inspector-copy-inline"
                  @click="copyValue(row.copy)"
                >
                  复制
                </button>
              </dd>
            </template>
          </dl>
          <p v-else class="media-inspector-muted">暂无文件属性</p>
        </section>

        <section v-if="generationParams.length" class="media-inspector-section">
          <h4 class="media-inspector-section-title">生成参数</h4>
          <dl class="media-inspector-dl">
            <template v-for="row in generationParams" :key="row.label">
              <dt>{{ row.label }}</dt>
              <dd>{{ row.value }}</dd>
            </template>
          </dl>
        </section>

        <section v-if="referenceItems.length" class="media-inspector-section">
          <h4 class="media-inspector-section-title">参考媒体</h4>
          <MediaRefList :refs="referenceItems" />
        </section>

        <section v-if="hasL2" class="media-inspector-section">
          <details class="media-inspector-l2">
            <summary class="media-inspector-section-title media-inspector-l2-summary">高级参数</summary>
            <dl v-if="l2Rows.length" class="media-inspector-dl media-inspector-l2-dl">
              <template v-for="row in l2Rows" :key="row.label">
                <dt>{{ row.label }}</dt>
                <dd :class="{ 'is-multiline': row.multiline }">{{ row.value }}</dd>
              </template>
            </dl>
            <details v-if="nativeParamsJson" class="media-inspector-native">
              <summary>nativeParams</summary>
              <pre class="media-inspector-pre">{{ nativeParamsJson }}</pre>
            </details>
          </details>
        </section>

        <section class="media-inspector-section media-inspector-actions">
          <button
            v-if="canLocate"
            type="button"
            class="media-inspector-action media-inspector-action-locate"
            @click="locateCanvasNode"
          >
            <CanvasLocatePinIcon :size="14" />
            定位画布节点
          </button>
          <button type="button" class="media-inspector-action" @click="copyTaskId">
            {{ taskIdCopyLabel }}
          </button>
          <button
            v-if="previewUrl"
            type="button"
            class="media-inspector-action"
            @click="downloadOutput"
          >
            下载
          </button>
        </section>
      </div>
    </div>
  </ElDrawer>
</template>

<style scoped>
.media-inspector {
  display: flex;
  flex-direction: column;
  height: 100%;
  color: var(--neo-text-primary);
}

.media-inspector-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 16px 16px 12px;
  border-bottom: 1px solid var(--neo-border);
}

.media-inspector-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.35;
}

.media-inspector-subtitle {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--neo-text-secondary);
}

.media-inspector-close {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--neo-text-secondary);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.media-inspector-close:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--neo-text-primary);
}

.media-inspector-tabs {
  display: flex;
  gap: 6px;
  padding: 10px 16px 0;
}

.media-inspector-tab {
  flex: 1;
  border: 1px solid var(--neo-border);
  border-radius: 8px;
  padding: 7px 10px;
  background: transparent;
  color: var(--neo-text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.media-inspector-tab.is-active {
  background: rgba(167, 139, 250, 0.12);
  border-color: rgba(167, 139, 250, 0.35);
  color: #ddd6fe;
}

.media-inspector-loading,
.media-inspector-error {
  padding: 16px;
  font-size: 13px;
}

.media-inspector-error {
  color: #fca5a5;
}

.media-inspector-body {
  flex: 1;
  overflow: auto;
  padding: 0 16px 16px;
}

.media-inspector-section {
  padding-top: 14px;
}

.media-inspector-section-title {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--neo-text-secondary);
}

.media-inspector-preview {
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid var(--neo-border);
  background: rgba(0, 0, 0, 0.25);
}

.media-inspector-media {
  display: block;
  width: 100%;
  max-height: 180px;
  object-fit: contain;
  background: #000;
}

.media-inspector-alert {
  margin-top: 12px;
}

.media-inspector-dl {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 6px 8px;
  margin: 0;
}

.media-inspector-dl dt {
  margin: 0;
  font-size: 11px;
  color: var(--neo-text-secondary);
}

.media-inspector-dl dd {
  margin: 0;
  font-size: 12px;
  word-break: break-all;
}

.media-inspector-dl dd.is-multiline {
  white-space: pre-wrap;
  line-height: 1.45;
}

.media-inspector-copy-inline {
  margin-left: 6px;
  border: none;
  background: none;
  color: #a78bfa;
  font-size: 11px;
  cursor: pointer;
  padding: 0;
}

.media-inspector-muted {
  margin: 0;
  font-size: 12px;
  color: var(--neo-text-secondary);
}

.media-inspector-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.media-inspector-action {
  width: 100%;
  border: 1px solid var(--neo-border);
  border-radius: 10px;
  padding: 9px 12px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--neo-text-primary);
  font-size: 12px;
  cursor: pointer;
}

.media-inspector-action:hover {
  background: rgba(255, 255, 255, 0.06);
}

.media-inspector-action:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.media-inspector-action-locate {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.media-inspector-l2 {
  border: 1px solid var(--neo-border);
  border-radius: 10px;
  padding: 8px 10px;
}

.media-inspector-l2-summary {
  cursor: pointer;
  list-style: none;
  margin-bottom: 0;
}

.media-inspector-l2-summary::-webkit-details-marker {
  display: none;
}

.media-inspector-l2-dl {
  margin-top: 10px;
}

.media-inspector-native {
  margin-top: 10px;
}

.media-inspector-native summary {
  cursor: pointer;
  font-size: 11px;
  color: var(--neo-text-secondary);
}

.media-inspector-pre {
  margin: 8px 0 0;
  padding: 8px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.25);
  font-size: 10px;
  line-height: 1.4;
  overflow: auto;
  max-height: 160px;
  white-space: pre-wrap;
  word-break: break-all;
}

.media-inspector-diagnostic {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.media-inspector-diag-msg {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.media-inspector-diag-hint {
  margin: 0;
  font-size: 11px;
  color: var(--neo-text-secondary);
  line-height: 1.45;
}
</style>

<style>
.media-inspector-drawer .el-drawer__body {
  padding: 0;
  background: var(--neo-popover-bg, #14141a);
}
</style>
