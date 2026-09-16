<script setup lang="ts">
import { computed, ref } from 'vue'
import { membershipApi } from '@/services/users-api'
import type { PointCategory, PointKind, PointTransactionItem, UsageDayPoint } from '@/services/users-api'

const props = defineProps<{
  days: UsageDayPoint[]
  loading?: boolean
}>()

const COLUMNS = ['日期', '生成次数', '积分消耗', '文本', '图片', '音频', '视频'] as const

const kindLabels: Record<PointKind, string> = {
  consume: '消耗',
  refund: '退款',
  grant: '获得',
}

const categoryLabels: Record<PointCategory, string> = {
  text: '文本',
  image: '图片',
  audio: '音频',
  video: '视频',
  other: '其他',
}

const rows = computed(() =>
  props.days
    .filter((day) => day.generationCount > 0)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date)),
)

const expandedDay = ref<string | null>(null)
const items = ref<PointTransactionItem[]>([])
const nextCursor = ref<string | null>(null)
const ledgerLoading = ref(false)
const ledgerLoadingMore = ref(false)
const loadError = ref('')

function formatCreatedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function shortGenerationId(id: string) {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id
}

function resetLedger() {
  items.value = []
  nextCursor.value = null
  loadError.value = ''
}

async function fetchLedger(day: string, cursor?: string) {
  if (cursor) ledgerLoadingMore.value = true
  else ledgerLoading.value = true
  try {
    const response = await membershipApi.transactions({
      day,
      limit: 50,
      ...(cursor ? { cursor } : {}),
    })
    if (expandedDay.value !== day) return
    const payload = response.data.data
    items.value = cursor ? [...items.value, ...payload.items] : payload.items
    nextCursor.value = payload.nextCursor
    loadError.value = ''
  } catch {
    if (expandedDay.value !== day) return
    loadError.value = '流水加载失败，请稍后重试'
  } finally {
    if (expandedDay.value === day) {
      ledgerLoading.value = false
      ledgerLoadingMore.value = false
    }
  }
}

async function toggleDay(day: string) {
  if (expandedDay.value === day) {
    expandedDay.value = null
    resetLedger()
    return
  }
  expandedDay.value = day
  resetLedger()
  await fetchLedger(day)
}

async function loadMore() {
  const day = expandedDay.value
  if (!day || !nextCursor.value || ledgerLoadingMore.value) return
  await fetchLedger(day, nextCursor.value)
}

function onRowKeydown(event: KeyboardEvent, day: string) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  void toggleDay(day)
}
</script>

<template>
  <section class="rounded-2xl border border-white/8 bg-[#16161C] p-5 text-white">
    <h2 class="mb-3 text-sm font-medium">用量明细</h2>

    <div v-if="loading" class="h-40 animate-pulse rounded-xl bg-white/5" />

    <p v-else-if="rows.length === 0" class="py-10 text-center text-sm text-white/45">
      还没有消耗。<router-link to="/workflow" class="text-white/80 underline underline-offset-2 hover:text-white">去创作</router-link>后，这里会按日汇总。
    </p>

    <div v-else class="overflow-x-auto">
      <table class="w-full min-w-[640px] border-collapse text-left text-sm">
        <thead>
          <tr class="text-xs text-white/45">
            <th v-for="column in COLUMNS" :key="column" class="px-3 py-2 font-medium">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="day in rows" :key="day.date">
            <tr
              :data-day="day.date"
              role="button"
              tabindex="0"
              class="cursor-pointer border-t border-white/8 text-white/80 transition hover:bg-white/[0.04]"
              :class="expandedDay === day.date ? 'bg-white/[0.04]' : undefined"
              @click="toggleDay(day.date)"
              @keydown="onRowKeydown($event, day.date)"
            >
              <td class="px-3 py-3 tabular-nums">{{ day.date }}</td>
              <td class="px-3 py-3 tabular-nums">{{ day.generationCount }}</td>
              <td class="px-3 py-3 tabular-nums">{{ day.netConsumed }}</td>
              <td class="px-3 py-3 tabular-nums">{{ day.byCategory.text }}</td>
              <td class="px-3 py-3 tabular-nums">{{ day.byCategory.image }}</td>
              <td class="px-3 py-3 tabular-nums">{{ day.byCategory.audio }}</td>
              <td class="px-3 py-3 tabular-nums">{{ day.byCategory.video }}</td>
            </tr>
            <tr v-if="expandedDay === day.date" data-expanded>
              <td colspan="7" class="bg-white/[0.02] px-3 pb-4 pt-1">
                <p v-if="ledgerLoading && !items.length" class="py-6 text-center text-xs text-white/35">
                  正在加载当天流水…
                </p>
                <div v-else class="space-y-3">
                  <div
                    v-for="tx in items"
                    :key="tx.id"
                    class="rounded-2xl border border-white/8 bg-[#1a1a1a] p-4"
                  >
                    <div class="flex items-start justify-between gap-4">
                      <div class="min-w-0">
                        <p class="truncate text-sm font-medium text-white/80">{{ tx.reason }}</p>
                        <div class="mt-2 flex flex-wrap items-center gap-2">
                          <span class="rounded-full bg-white/[0.06] px-2 py-1 text-[11px] text-white/55">
                            {{ kindLabels[tx.kind] }}
                          </span>
                          <span class="rounded-full bg-white/[0.06] px-2 py-1 text-[11px] text-white/55">
                            {{ categoryLabels[tx.category] }}
                          </span>
                          <span v-if="tx.model" class="text-[11px] text-white/35">{{ tx.model }}</span>
                        </div>
                      </div>
                      <span
                        class="shrink-0 text-base font-semibold"
                        :class="tx.amount >= 0 ? 'text-green-400' : 'text-red-400'"
                      >
                        {{ tx.amount >= 0 ? '+' : '' }}{{ tx.amount }}
                      </span>
                    </div>
                    <div class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-3">
                      <time class="text-xs text-white/30" :datetime="tx.createdAt">{{ formatCreatedAt(tx.createdAt) }}</time>
                      <div class="flex items-center gap-3">
                        <span
                          v-if="tx.generationId"
                          class="font-mono text-[11px] text-[#818cf8]/70"
                          :title="tx.generationId"
                        >
                          生成 ID · {{ shortGenerationId(tx.generationId) }}
                        </span>
                        <span class="text-xs text-white/35">余额 {{ tx.balanceAfter ?? '—' }}</span>
                      </div>
                    </div>
                  </div>
                  <p v-if="loadError" class="py-2 text-center text-xs text-red-300/70">{{ loadError }}</p>
                  <p
                    v-else-if="!ledgerLoading && !items.length"
                    class="rounded-2xl border border-white/8 bg-[#1a1a1a] py-8 text-center text-sm text-white/30"
                  >
                    这一天没有流水。
                  </p>
                  <div v-if="nextCursor" class="pt-1 text-center">
                    <button
                      type="button"
                      class="rounded-xl border border-white/10 px-5 py-2 text-xs text-white/50 transition hover:bg-white/[0.04] hover:text-white/80 disabled:opacity-40"
                      :disabled="ledgerLoadingMore"
                      @click.stop="loadMore"
                    >
                      {{ ledgerLoadingMore ? '加载中…' : '加载更多' }}
                    </button>
                  </div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </section>
</template>
