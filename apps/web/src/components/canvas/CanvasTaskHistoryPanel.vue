<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { studioApi, type GenerationRecord } from '@/services/studio-api'
import DockTypeIcon from '@/components/canvas/dock-studio/shared/DockTypeIcon.vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'

const emit = defineEmits<{
  /** 请求定位到产生该记录的画布节点 */
  locate: [recordId: string]
}>()

const editor = useCanvasEditorStore()

const loading = ref(false)
const error = ref('')
const records = ref<GenerationRecord[]>([])
const filter = ref<'all' | 'text' | 'image' | 'video' | 'audio'>('all')
const detailRecord = ref<GenerationRecord | null>(null)

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'text', label: '文本' },
  { key: 'image', label: '生图' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
] as const

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

function statusMeta(status: string) {
  return STATUS_META[status] ?? { label: status, cls: 'bg-[var(--neo-active-bg)] text-[var(--neo-text-muted)]' }
}

function recordModel(record: GenerationRecord): string {
  if (record.model) return record.model
  try {
    const meta = JSON.parse(record.metadata ?? '{}') as {
      modelId?: string
      modelKey?: string
      originalModel?: string
    }
    return meta.originalModel ?? meta.modelId ?? meta.modelKey ?? '—'
  } catch {
    return '—'
  }
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

const filtered = computed(() => {
  if (filter.value === 'all') return records.value
  if (filter.value === 'text') {
    return records.value.filter((r) => r.type === 'text' || r.type === 'prompt')
  }
  return records.value.filter((r) => r.type === filter.value)
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const { data } = await studioApi.listGenerations()
    records.value = data.data
  } catch {
    error.value = '加载失败，请确认已登录'
  } finally {
    loading.value = false
  }
}

function openDetail(record: GenerationRecord) {
  detailRecord.value = record
}

function previewDetailMedia(record: GenerationRecord) {
  if (!record.url) return
  const kind = record.type === 'video' ? 'video' : record.type === 'audio' ? 'audio' : 'image'
  editor.openMediaPreview({ url: record.url, kind, label: record.prompt })
}

onMounted(load)
</script>

<template>
  <div class="canvas-task-history flex max-h-[min(520px,72vh)] w-[404px] flex-col">
    <!-- 详情视图 -->
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
              <p class="mb-0.5 text-[10px] text-[var(--neo-text-muted)]">模型</p>
              <p class="truncate text-[var(--neo-text-secondary)]" :title="recordModel(detailRecord)">{{ recordModel(detailRecord) }}</p>
            </div>
            <div class="col-span-2">
              <p class="mb-0.5 text-[10px] text-[var(--neo-text-muted)]">创建时间</p>
              <p class="tabular-nums text-[var(--neo-text-secondary)]">{{ formatFullTime(detailRecord.createdAt) }}</p>
            </div>
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

    <!-- 列表视图 -->
    <template v-else>
      <div class="flex items-center gap-2 border-b border-[var(--neo-border)] px-3 py-2.5">
        <span class="text-[13px] font-medium text-[var(--neo-text-primary)]">任务历史</span>
        <span class="text-[10px] text-[var(--neo-text-muted)]">最近 {{ records.length }} 条</span>
        <button
          type="button"
          class="ml-auto flex h-6 w-6 items-center justify-center rounded-lg text-[var(--neo-text-muted)] transition hover:bg-[var(--neo-active-bg)] hover:text-[var(--neo-text-primary)]"
          title="刷新"
          :disabled="loading"
          @click="load"
        >
          <svg class="h-3.5 w-3.5" :class="loading ? 'animate-spin' : ''" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h5M20 20v-5h-5M5.5 9A7.5 7.5 0 0 1 19 8.5M18.5 15A7.5 7.5 0 0 1 5 15.5" />
          </svg>
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
        <p v-else-if="!filtered.length" class="py-8 text-center text-[11px] text-[var(--neo-text-muted)]">暂无任务记录</p>
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
              <span class="text-[11px] text-[var(--neo-text-secondary)]">{{ TYPE_LABELS[record.type] ?? record.type }}</span>
              <span
                class="ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[9px]"
                :class="statusMeta(record.status).cls"
              >
                {{ statusMeta(record.status).label }}
              </span>
            </div>
            <img
              v-if="record.type === 'image' && record.url"
              :src="record.url"
              class="mt-1.5 h-16 w-full rounded-lg object-cover"
              alt=""
              loading="lazy"
            />
            <p class="mt-1.5 line-clamp-2 min-h-[26px] text-[10px] leading-relaxed text-[var(--neo-text-muted)]">
              {{ record.prompt || '—' }}
            </p>
            <div class="mt-1.5 flex items-center justify-between gap-2 text-[9px] text-[var(--neo-text-muted)]">
              <span class="truncate" :title="recordModel(record)">{{ recordModel(record) }}</span>
              <span class="shrink-0 tabular-nums">{{ formatTime(record.createdAt) }}</span>
            </div>

            <!-- hover 定位按钮 -->
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
