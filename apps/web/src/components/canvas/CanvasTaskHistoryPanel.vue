<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { ErrorCode, GenerationDiagnostic } from '@lnkpi/shared'
import { modelOptionName } from '@lnkpi/shared'
import { studioApi, type GenerationRecord } from '@/services/studio-api'
import DockTypeIcon from '@/components/canvas/dock-studio/shared/DockTypeIcon.vue'
import NodeDiagnosticPopover from '@/components/canvas/NodeDiagnosticPopover.vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import { useProviderBootstrap } from '@/composables/useProviderBootstrap'
import { NODE_GENERATION_STATUS } from '@/constants/dockStudio'
import {
  buildCopyForNode,
  parseErrorCodeFromMetadata,
  sharedDiagnosticCache,
} from '@/utils/generationDiagnostic'

const emit = defineEmits<{
  locate: [recordId: string]
}>()

const route = useRoute()
const editor = useCanvasEditorStore()
const { allChannels } = useProviderBootstrap()

const sessionId = computed(() => route.params.sessionId as string | undefined)

const loading = ref(false)
const error = ref('')
const records = ref<GenerationRecord[]>([])
const lifecycle = ref<'todo' | 'doing' | 'done'>('doing')
const filter = ref<'all' | 'text' | 'image' | 'video' | 'audio'>('all')
const detailRecord = ref<GenerationRecord | null>(null)
const failurePopoverId = ref<string | null>(null)
const failureDiagLoading = ref(false)
const failureDiag = ref<GenerationDiagnostic | null>(null)
const failureCopyLabel = ref('复制诊断')

const LIFECYCLE_TABS = [
  { key: 'todo', label: '排队' },
  { key: 'doing', label: '进行中' },
  { key: 'done', label: '已完成' },
] as const

const TODO_STATUSES = new Set(['pending'])
const DOING_STATUSES = new Set(['generating', 'fallback_pending', 'processing', 'running'])

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'text', label: '文本' },
  { key: 'image', label: '生图' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
] as const

const EMPTY_BY_LIFECYCLE: Record<'todo' | 'doing' | 'done', string> = {
  todo: '暂无排队任务',
  doing: '暂无进行中的任务',
  done: '暂无已完成任务',
}

const POLL_MS = 4000
let pollTimer: ReturnType<typeof setInterval> | null = null

function lifecycleOf(status: string): 'todo' | 'doing' | 'done' {
  if (TODO_STATUSES.has(status)) return 'todo'
  if (DOING_STATUSES.has(status)) return 'doing'
  return 'done'
}

const TYPE_LABELS: Record<string, string> = {
  text: '文本',
  prompt: '提示词',
  image: '生图',
  video: '视频',
  audio: '音频',
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  completed: { label: '成功', cls: 'bg-emerald-500/15 text-emerald-300' },
  generating: { label: '生成中', cls: 'bg-indigo-500/15 text-indigo-300 animate-pulse' },
  pending: { label: '排队中', cls: 'bg-indigo-500/15 text-indigo-300 animate-pulse' },
  fallback_pending: { label: '待确认', cls: 'bg-amber-500/15 text-amber-300' },
  failed: { label: '失败', cls: 'bg-red-500/15 text-red-300' },
  error: { label: '失败', cls: 'bg-red-500/15 text-red-300' },
}

interface RecordMeta {
  aspectRatio?: string
  resolution?: string
  size?: string
  count?: number
  duration?: number
  crop?: string
  voice?: string
  speed?: number
  originalModel?: string
  channelId?: string
  userMessage?: string
  text?: string
  content?: string
  errorRaw?: string
  byokErrorRaw?: string
  failureClass?: string
}

function statusMeta(status: string) {
  return STATUS_META[status] ?? { label: status, cls: 'bg-[var(--neo-active-bg)] text-[var(--neo-text-muted)]' }
}

function parseRecordMeta(record: GenerationRecord): RecordMeta {
  try {
    return JSON.parse(record.metadata ?? '{}') as RecordMeta
  } catch {
    return {}
  }
}

function recordModelName(record: GenerationRecord): string {
  const meta = parseRecordMeta(record)
  const raw = record.model ?? meta.originalModel ?? ''
  return raw ? modelOptionName(raw) : '—'
}

function recordChannelName(record: GenerationRecord): string {
  const channelId = parseRecordMeta(record).channelId
  if (!channelId) return '—'
  const ch = allChannels.value.find((c) => c.id === channelId)
  return ch?.name || channelId.slice(0, 8)
}

function recordParamRows(record: GenerationRecord): Array<{ label: string; value: string }> {
  const meta = parseRecordMeta(record)
  const rows: Array<{ label: string; value: string }> = []
  const add = (label: string, v: unknown) => {
    if (v === undefined || v === null || v === '') return
    rows.push({ label, value: String(v) })
  }
  if (record.type === 'image') {
    add('比例', meta.aspectRatio)
    add('分辨率', meta.resolution)
    add('尺寸', meta.size)
    add('数量', meta.count)
  } else if (record.type === 'video') {
    add('时长', meta.duration != null ? `${meta.duration}s` : undefined)
    add('分辨率', meta.resolution)
    add('比例', meta.aspectRatio)
    add('裁剪', meta.crop)
  } else if (record.type === 'audio') {
    add('音色', meta.voice)
    add('语速', meta.speed)
  }
  return rows
}

function recordFailureMessage(record: GenerationRecord): string | null {
  if (
    record.status !== 'failed' &&
    record.status !== 'error' &&
    record.status !== NODE_GENERATION_STATUS.fallback_pending
  ) {
    return null
  }
  const meta = parseRecordMeta(record)
  if (meta.userMessage) return meta.userMessage
  const byok = meta.byokErrorRaw || meta.errorRaw
  if (record.status === NODE_GENERATION_STATUS.fallback_pending) {
    return byok ? `平台回退待确认：${byok.slice(0, 240)}` : '平台回退待确认'
  }
  if (byok) return byok.slice(0, 240)
  return '生成失败'
}

function isFailedStatus(status: string) {
  return (
    status === 'failed' ||
    status === 'error' ||
    status === NODE_GENERATION_STATUS.fallback_pending
  )
}

function recordTextSnippet(record: GenerationRecord): string {
  if (record.type === 'text' || record.type === 'prompt') {
    const meta = parseRecordMeta(record)
    return meta.text || meta.content || record.prompt || '—'
  }
  return record.prompt || '—'
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatFullTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const lifecycleCounts = computed(() => {
  const counts = { todo: 0, doing: 0, done: 0 }
  for (const r of records.value) {
    counts[lifecycleOf(r.status)] += 1
  }
  return counts
})

const filtered = computed(() => {
  const byLife = records.value.filter((r) => lifecycleOf(r.status) === lifecycle.value)
  if (filter.value === 'all') return byLife
  if (filter.value === 'text') {
    return byLife.filter((r) => r.type === 'text' || r.type === 'prompt')
  }
  return byLife.filter((r) => r.type === filter.value)
})

async function load(opts?: { silent?: boolean }) {
  if (!opts?.silent) loading.value = true
  error.value = ''
  try {
    const params = sessionId.value ? { sessionId: sessionId.value } : undefined
    const { data } = await studioApi.listGenerations(params)
    records.value = data.data
  } catch {
    if (!opts?.silent) error.value = '加载失败，请确认已登录'
  } finally {
    if (!opts?.silent) loading.value = false
  }
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(() => {
    if (lifecycle.value === 'done' && lifecycleCounts.value.todo + lifecycleCounts.value.doing === 0) {
      return
    }
    void load({ silent: true })
  }, POLL_MS)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function openDetail(record: GenerationRecord) {
  failurePopoverId.value = null
  detailRecord.value = record
}

function previewDetailMedia(record: GenerationRecord) {
  if (!record.url) return
  const kind = record.type === 'video' ? 'video' : record.type === 'audio' ? 'audio' : 'image'
  editor.openMediaPreview({ url: record.url, kind, label: record.prompt })
}

function buildFallbackDiagnostic(record: GenerationRecord): GenerationDiagnostic {
  const meta = parseRecordMeta(record)
  const isFallback = record.status === NODE_GENERATION_STATUS.fallback_pending
  const byok = meta.byokErrorRaw || meta.errorRaw || ''
  return {
    userMessage: meta.userMessage || recordFailureMessage(record) || '生成失败',
    code: isFallback
      ? 'fallback_pending'
      : ((parseErrorCodeFromMetadata(record.metadata) as ErrorCode | undefined) || 'unknown'),
    taskKind: 'generation',
    taskId: record.id,
    occurredAt: record.createdAt,
    channelId: meta.channelId ?? null,
    model: record.model ?? meta.originalModel ?? null,
    providerSnippet: byok ? byok.slice(0, 2048) : null,
    hint: isFallback ? '请确认是否使用平台回退继续，或取消本次生成。' : undefined,
  }
}

async function openFailurePopover(record: GenerationRecord, e: Event) {
  e.stopPropagation()
  if (failurePopoverId.value === record.id) {
    failurePopoverId.value = null
    return
  }
  failurePopoverId.value = record.id
  failureDiag.value = null
  failureDiagLoading.value = true
  failureCopyLabel.value = '复制诊断'
  try {
    failureDiag.value = await sharedDiagnosticCache.get('generation', record.id, () =>
      studioApi.getGenerationDiagnostic(record.id),
    )
  } catch {
    failureDiag.value = buildFallbackDiagnostic(record)
  } finally {
    failureDiagLoading.value = false
  }
}

function closeFailurePopover() {
  failurePopoverId.value = null
}

async function copyFailureDiagnostic(record: GenerationRecord) {
  const payload = failureDiag.value || buildFallbackDiagnostic(record)
  const text = buildCopyForNode(payload, {
    nodeId: record.nodeId ?? undefined,
    sessionId: sessionId.value,
  })
  try {
    await navigator.clipboard.writeText(text)
    failureCopyLabel.value = '已复制'
    setTimeout(() => {
      failureCopyLabel.value = '复制诊断'
    }, 1500)
  } catch {
    failureCopyLabel.value = '复制失败'
  }
}

const failurePopoverMessage = computed(() => {
  if (!failurePopoverId.value) return ''
  const record = records.value.find((r) => r.id === failurePopoverId.value)
  if (!record) return ''
  return failureDiag.value?.userMessage || recordFailureMessage(record) || '生成失败'
})

const failurePopoverHint = computed(() => {
  if (failureDiag.value?.hint) return failureDiag.value.hint
  const record = records.value.find((r) => r.id === failurePopoverId.value)
  if (record?.status === NODE_GENERATION_STATUS.fallback_pending) {
    return '请确认是否使用平台回退继续，或取消本次生成。'
  }
  return undefined
})

onMounted(() => {
  void load().then(() => {
    if (lifecycleCounts.value.doing === 0) {
      if (lifecycleCounts.value.todo > 0) lifecycle.value = 'todo'
      else if (lifecycleCounts.value.done > 0) lifecycle.value = 'done'
    }
    startPolling()
  })
})

onUnmounted(stopPolling)
</script>

<template>
  <div class="canvas-task-history flex max-h-[min(520px,72vh)] w-[404px] flex-col">
    <template v-if="detailRecord">
      <div class="flex items-center gap-2 border-b border-[var(--neo-border)] px-3 py-2.5">
        <button
          type="button"
          class="flex h-6 w-6 items-center justify-center rounded-lg text-[var(--neo-text-muted)] transition hover:bg-[var(--neo-active-bg)] hover:text-[var(--neo-text-primary)]"
          title="返回列表"
          @click="detailRecord = null"
        >
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span class="text-[13px] font-medium text-[var(--neo-text-primary)]">任务详情</span>
        <span
          class="ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[9px]"
          :class="statusMeta(detailRecord.status).cls"
        >
          {{ statusMeta(detailRecord.status).label }}
        </span>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div
          v-if="detailRecord.url && detailRecord.type === 'image'"
          class="mb-3 cursor-zoom-in overflow-hidden rounded-xl border border-[var(--neo-border)]"
          title="点击预览大图"
          @click="previewDetailMedia(detailRecord)"
        >
          <img :src="detailRecord.url" class="w-full object-cover" alt="" >
        </div>
        <video
          v-else-if="detailRecord.url && detailRecord.type === 'video'"
          :src="detailRecord.url"
          controls
          class="mb-3 w-full rounded-xl border border-[var(--neo-border)]"
        />
        <audio
          v-else-if="detailRecord.url && detailRecord.type === 'audio'"
          :src="detailRecord.url"
          controls
          class="mb-3 w-full"
        />

        <div class="space-y-2.5 text-[11px]">
          <div>
            <p class="mb-1 text-[10px] uppercase tracking-wider text-[var(--neo-text-muted)]">提示词</p>
            <p class="whitespace-pre-wrap break-words rounded-lg bg-[var(--neo-hover-bg)] p-2 leading-relaxed text-[var(--neo-text-secondary)]">
              {{ detailRecord.prompt || '—' }}
            </p>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div>
              <p class="mb-0.5 text-[10px] text-[var(--neo-text-muted)]">类型</p>
              <p class="text-[var(--neo-text-secondary)]">{{ TYPE_LABELS[detailRecord.type] ?? detailRecord.type }}</p>
            </div>
            <div>
              <p class="mb-0.5 text-[10px] text-[var(--neo-text-muted)]">节点</p>
              <p class="truncate font-mono text-[var(--neo-text-secondary)]">{{ detailRecord.nodeId || '—' }}</p>
            </div>
            <div class="col-span-2">
              <p class="mb-0.5 text-[10px] text-[var(--neo-text-muted)]">模型</p>
              <p class="truncate text-[var(--neo-text-secondary)]" :title="recordModelName(detailRecord)">
                {{ recordModelName(detailRecord) }}
              </p>
            </div>
            <div class="col-span-2">
              <p class="mb-0.5 text-[10px] text-[var(--neo-text-muted)]">渠道</p>
              <p class="truncate text-[var(--neo-text-secondary)]" :title="recordChannelName(detailRecord)">
                {{ recordChannelName(detailRecord) }}
              </p>
            </div>
            <div class="col-span-2">
              <p class="mb-0.5 text-[10px] text-[var(--neo-text-muted)]">创建时间</p>
              <p class="tabular-nums text-[var(--neo-text-secondary)]">{{ formatFullTime(detailRecord.createdAt) }}</p>
            </div>
          </div>

          <div v-if="recordParamRows(detailRecord).length">
            <p class="mb-1 text-[10px] uppercase tracking-wider text-[var(--neo-text-muted)]">参数</p>
            <div class="grid grid-cols-2 gap-2 rounded-lg bg-[var(--neo-hover-bg)] p-2">
              <div v-for="row in recordParamRows(detailRecord)" :key="row.label">
                <p class="text-[9px] text-[var(--neo-text-muted)]">{{ row.label }}</p>
                <p class="text-[var(--neo-text-secondary)]">{{ row.value }}</p>
              </div>
            </div>
          </div>

          <div v-if="recordFailureMessage(detailRecord)">
            <p class="mb-1 text-[10px] uppercase tracking-wider text-[var(--neo-text-muted)]">失败原因</p>
            <p class="whitespace-pre-wrap break-words rounded-lg bg-red-500/10 p-2 text-[11px] leading-relaxed text-red-300">
              {{ recordFailureMessage(detailRecord) }}
            </p>
          </div>
        </div>

        <button
          type="button"
          class="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--neo-hi-bg)] py-2 text-[11px] font-medium text-[var(--neo-hi-text)] transition hover:brightness-105"
          @click="emit('locate', detailRecord.id)"
        >
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3" />
            <path stroke-linecap="round" d="M12 2v4m0 12v4M2 12h4m12 0h4" />
          </svg>
          定位到画布节点
        </button>
      </div>
    </template>

    <template v-else>
      <div class="flex items-center gap-2 border-b border-[var(--neo-border)] px-3 py-2.5">
        <span class="text-[13px] font-medium text-[var(--neo-text-primary)]">任务</span>
        <span class="text-[10px] text-[var(--neo-text-muted)]">本会话 {{ records.length }} 条</span>
        <button
          type="button"
          class="ml-auto flex h-6 w-6 items-center justify-center rounded-lg text-[var(--neo-text-muted)] transition hover:bg-[var(--neo-active-bg)] hover:text-[var(--neo-text-primary)]"
          title="刷新"
          :disabled="loading"
          @click="load()"
        >
          <svg class="h-3.5 w-3.5" :class="loading ? 'animate-spin' : ''" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h5M20 20v-5h-5M5.5 9A7.5 7.5 0 0 1 19 8.5M18.5 15A7.5 7.5 0 0 1 5 15.5" />
          </svg>
        </button>
      </div>

      <div class="flex gap-1 border-b border-[var(--neo-border)] px-3 py-2">
        <button
          v-for="tab in LIFECYCLE_TABS"
          :key="tab.key"
          type="button"
          class="flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] transition"
          :class="lifecycle === tab.key ? 'bg-[var(--neo-accent-soft)] text-[var(--neo-accent-text)]' : 'text-[var(--neo-text-muted)] hover:bg-[var(--neo-hover-bg)] hover:text-[var(--neo-text-secondary)]'"
          @click="lifecycle = tab.key"
        >
          <span>{{ tab.label }}</span>
          <span
            class="min-w-[1.1rem] rounded-md px-1 text-center text-[9px] tabular-nums"
            :class="lifecycle === tab.key ? 'bg-[var(--neo-accent-border)]/30' : 'bg-[var(--neo-active-bg)]'"
          >
            {{ lifecycleCounts[tab.key] }}
          </span>
        </button>
      </div>

      <div class="flex gap-1 px-3 py-2">
        <button
          v-for="f in FILTERS"
          :key="f.key"
          type="button"
          class="rounded-full px-2.5 py-1 text-[10px] transition"
          :class="filter === f.key ? 'bg-[var(--neo-accent-soft)] text-[var(--neo-accent-text)]' : 'bg-[var(--neo-hover-bg)] text-[var(--neo-text-muted)] hover:bg-[var(--neo-active-bg)] hover:text-[var(--neo-text-secondary)]'"
          @click="filter = f.key"
        >
          {{ f.label }}
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <p v-if="error" class="py-8 text-center text-[11px] text-[var(--neo-text-muted)]">{{ error }}</p>
        <p v-else-if="loading && !records.length" class="py-8 text-center text-[11px] text-[var(--neo-text-muted)]">加载中...</p>
        <p v-else-if="!filtered.length" class="py-8 text-center text-[11px] text-[var(--neo-text-muted)]">{{ EMPTY_BY_LIFECYCLE[lifecycle] }}</p>
        <div v-else class="grid grid-cols-2 gap-2">
          <div
            v-for="record in filtered"
            :key="record.id"
            role="button"
            tabindex="0"
            class="history-card group relative cursor-pointer rounded-xl border border-[var(--neo-border)] bg-[var(--neo-hover-bg)] p-2.5 transition hover:border-[var(--neo-accent-border)]"
            title="点击查看详情"
            @click="openDetail(record)"
            @keydown.enter="openDetail(record)"
          >
            <div class="flex items-center gap-1.5">
              <span class="text-[var(--neo-text-muted)]"><DockTypeIcon :type="record.type" :size="13" /></span>
              <span class="truncate font-mono text-[11px] text-[var(--neo-text-secondary)]">{{ record.nodeId || '—' }}</span>
              <span
                class="ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[9px]"
                :class="statusMeta(record.status).cls"
              >
                {{ statusMeta(record.status).label }}
              </span>
              <button
                v-if="isFailedStatus(record.status)"
                type="button"
                class="relative z-10 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-red-500/20 text-[10px] font-bold text-red-300 hover:bg-red-500/30"
                title="查看错误"
                @click="openFailurePopover(record, $event)"
              >
                !
              </button>
            </div>

            <img
              v-if="record.type === 'image' && record.url"
              :src="record.url"
              class="mt-1.5 h-16 w-full rounded-lg object-cover"
              alt=""
              loading="lazy"
            >
            <video
              v-else-if="record.type === 'video' && record.url"
              :src="record.url"
              muted
              playsinline
              preload="metadata"
              class="mt-1.5 h-16 w-full rounded-lg object-cover"
            />
            <div
              v-else-if="record.type === 'audio'"
              class="mt-1.5 flex h-16 w-full items-center justify-center rounded-lg bg-[var(--neo-active-bg)] text-[10px] text-[var(--neo-text-muted)]"
            >
              音频
            </div>
            <p
              v-else-if="record.type === 'text' || record.type === 'prompt'"
              class="mt-1.5 line-clamp-3 min-h-[48px] rounded-lg bg-[var(--neo-active-bg)] p-1.5 text-[10px] leading-relaxed text-[var(--neo-text-muted)]"
            >
              {{ recordTextSnippet(record) }}
            </p>

            <div class="mt-1.5 flex items-center justify-end text-[9px] tabular-nums text-[var(--neo-text-muted)]">
              {{ formatTime(record.createdAt) }}
            </div>

            <div
              v-if="failurePopoverId === record.id"
              class="absolute left-2 right-2 top-10 z-20"
              @click.stop
            >
              <NodeDiagnosticPopover
                :user-message="failurePopoverMessage"
                :hint="failurePopoverHint"
                :loading="failureDiagLoading"
                :copy-label="failureCopyLabel"
                @copy="copyFailureDiagnostic(record)"
                @close="closeFailurePopover"
              />
            </div>

            <button
              type="button"
              class="absolute right-1.5 top-8 hidden h-6 w-6 items-center justify-center rounded-lg bg-black/60 text-white/85 transition hover:bg-black/85 hover:text-white group-hover:flex"
              title="定位到画布节点"
              @click.stop="emit('locate', record.id)"
            >
              <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3" />
                <path stroke-linecap="round" d="M12 2v4m0 12v4M2 12h4m12 0h4" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
