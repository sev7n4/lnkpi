<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { studioApi, type GenerationRecord } from '@/services/studio-api'
import DockTypeIcon from '@/components/canvas/dock-studio/shared/DockTypeIcon.vue'

const loading = ref(false)
const error = ref('')
const records = ref<GenerationRecord[]>([])
const filter = ref<'all' | 'text' | 'image' | 'video' | 'audio'>('all')

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

onMounted(load)
</script>

<template>
  <div class="canvas-task-history flex max-h-[min(520px,72vh)] w-[404px] flex-col">
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
          class="rounded-xl border border-[var(--neo-border)] bg-[var(--neo-hover-bg)] p-2.5"
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
        </div>
      </div>
    </div>
  </div>
</template>
