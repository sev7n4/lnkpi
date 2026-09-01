<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import MembershipModal from '@/components/membership/MembershipModal.vue'
import { useAuthStore } from '@/stores/auth'
import { membershipApi } from '@/services/users-api'
import { api } from '@/services/api'
import type { User } from '@lnkpi/shared'
import type {
  PointCategory,
  PointKind,
  PointTransactionItem,
  PointsRangeKey,
  PointsSummary,
} from '@/services/users-api'

const router = useRouter()
const auth = useAuthStore()
const profile = ref<User | null>(null)
const range = ref<PointsRangeKey>('month')
const summary = ref<PointsSummary | null>(null)
const transactions = ref<PointTransactionItem[]>([])
const filterCategory = ref<PointCategory>()
const filterKind = ref<PointKind>()
const nextCursor = ref<string | null>(null)
const isLoading = ref(false)
const isLoadingMore = ref(false)
const loadError = ref('')
const showMembership = ref(false)

const membershipLabel = computed(() => {
  const m = profile.value?.membership
  if (m === 'pro') return '专业版'
  if (m === 'studio') return '工作室版'
  return '免费版'
})

const isFreeMembership = computed(() => !profile.value?.membership || profile.value.membership === 'free')

/** Monotonic generation; stale responses are discarded when range/filters change. */
let fetchGeneration = 0

function bumpFetchGeneration() {
  fetchGeneration += 1
  return fetchGeneration
}

const rangeOptions: Array<{ value: PointsRangeKey; label: string }> = [
  { value: '7d', label: '近 7 天' },
  { value: 'month', label: '本月' },
  { value: 'all', label: '全部' },
]

const categoryOptions: Array<{
  value: Exclude<PointCategory, 'other'>
  label: string
  accent: string
}> = [
  { value: 'text', label: '文本', accent: 'text-sky-300' },
  { value: 'image', label: '图片', accent: 'text-violet-300' },
  { value: 'audio', label: '音频', accent: 'text-amber-300' },
  { value: 'video', label: '视频', accent: 'text-pink-300' },
]

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

function toggleCategory(category: PointCategory) {
  filterCategory.value = filterCategory.value === category ? undefined : category
}

function toggleKind(kind: PointKind) {
  filterKind.value = filterKind.value === kind ? undefined : kind
}

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

async function reload() {
  const gen = bumpFetchGeneration()
  isLoading.value = true
  isLoadingMore.value = false
  loadError.value = ''
  try {
    const [summaryResponse, transactionsResponse] = await Promise.all([
      membershipApi.pointsSummary(range.value),
      membershipApi.transactions({
        range: range.value,
        category: filterCategory.value,
        kind: filterKind.value,
      }),
    ])
    if (gen !== fetchGeneration) return
    summary.value = summaryResponse.data.data
    transactions.value = transactionsResponse.data.data.items
    nextCursor.value = transactionsResponse.data.data.nextCursor
  } catch {
    if (gen !== fetchGeneration) return
    loadError.value = '积分账单加载失败，请稍后重试'
  } finally {
    if (gen === fetchGeneration) {
      isLoading.value = false
    }
  }
}

async function loadMore() {
  if (!nextCursor.value || isLoadingMore.value) return
  const gen = fetchGeneration
  isLoadingMore.value = true
  try {
    const response = await membershipApi.transactions({
      range: range.value,
      category: filterCategory.value,
      kind: filterKind.value,
      cursor: nextCursor.value,
    })
    if (gen !== fetchGeneration) return
    transactions.value.push(...response.data.data.items)
    nextCursor.value = response.data.data.nextCursor
  } catch {
    if (gen !== fetchGeneration) return
    loadError.value = '更多账单加载失败，请稍后重试'
  } finally {
    if (gen === fetchGeneration) {
      isLoadingMore.value = false
    }
  }
}

watch([range, filterCategory, filterKind], () => {
  void reload()
})

onMounted(async () => {
  if (!auth.isLoggedIn) {
    auth.openLogin()
    return
  }
  try {
    const { data } = await api.get<{ data: User }>('/auth/profile')
    profile.value = data.data
    auth.user = data.data
    await reload()
  } catch {
    router.push('/workflow')
  }
})
</script>

<template>
  <div class="mx-auto max-w-3xl px-6 py-10">
    <h1 class="mb-8 text-2xl font-semibold">个人中心</h1>

    <div v-if="profile" class="mb-8 rounded-2xl border border-white/8 bg-[#1a1a1a] p-6">
      <div class="flex items-center gap-4">
        <div class="flex h-14 w-14 items-center justify-center rounded-full bg-[#6366f1]/30 text-xl font-semibold">
          {{ profile.nickname[0] }}
        </div>
        <div>
          <h2 class="text-lg font-medium">{{ profile.nickname }}</h2>
          <p class="text-sm text-white/50">{{ profile.phone }}</p>
        </div>
      </div>
      <div class="mt-6 rounded-xl border border-white/8 bg-[#242424] p-5">
        <div class="flex items-end justify-between gap-4">
          <div>
            <p class="text-xs text-white/40">可用总积分</p>
            <p class="text-3xl font-semibold text-[#818cf8]">{{ profile.points ?? 0 }}</p>
          </div>
          <span class="rounded-full bg-white/[0.06] px-3 py-1 text-xs text-white/60">{{ membershipLabel }}</span>
        </div>
        <p v-if="isFreeMembership" class="mt-3 text-xs text-white/35">开通会员，获得更多积分与高级能力</p>
        <div class="mt-4 flex gap-3">
          <button type="button" class="flex-1 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black" @click="showMembership = true">
            充值
          </button>
          <button type="button" class="flex-1 rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/80" @click="showMembership = true">
            {{ isFreeMembership ? '升级会员' : '管理会员' }}
          </button>
        </div>
      </div>

      <MembershipModal v-model="showMembership" />
    </div>

    <section class="mb-6 rounded-2xl border border-white/8 bg-[#1a1a1a] p-5">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 class="text-lg font-medium">积分账单</h2>
          <p class="mt-1 text-xs text-white/40">查看积分消耗、退款与获得记录</p>
        </div>
        <div class="flex rounded-xl bg-[#242424] p-1">
          <button
            v-for="option in rangeOptions"
            :key="option.value"
            type="button"
            class="rounded-lg px-3 py-2 text-xs transition"
            :class="range === option.value ? 'bg-[#6366f1] text-white' : 'text-white/50 hover:text-white/80'"
            @click="range = option.value"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <div v-if="summary" class="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <button
          v-for="category in categoryOptions"
          :key="category.value"
          type="button"
          class="rounded-xl border p-4 text-left transition hover:bg-white/[0.04]"
          :class="
            filterCategory === category.value
              ? 'border-[#818cf8]/60 bg-[#6366f1]/10'
              : 'border-white/8 bg-[#242424]'
          "
          @click="toggleCategory(category.value)"
        >
          <p class="text-xs text-white/45">{{ category.label }}消耗</p>
          <p class="mt-2 text-xl font-semibold" :class="category.accent">
            {{ summary.byCategory[category.value] }}
          </p>
        </button>
      </div>

      <div v-if="summary" class="mt-3 grid grid-cols-2 gap-3" :class="{ 'sm:grid-cols-3': summary.otherNetConsumed > 0 }">
        <button
          type="button"
          class="rounded-xl border p-4 text-left transition"
          :class="
            filterKind === 'refund'
              ? 'border-emerald-400/40 bg-emerald-400/10'
              : 'border-white/8 bg-white/[0.025] hover:bg-white/[0.04]'
          "
          @click="toggleKind('refund')"
        >
          <p class="text-xs text-white/45">退款积分</p>
          <p class="mt-1 text-lg font-semibold text-emerald-400">+{{ summary.refundTotal }}</p>
        </button>
        <button
          type="button"
          class="rounded-xl border p-4 text-left transition"
          :class="
            filterKind === 'grant'
              ? 'border-indigo-400/40 bg-indigo-400/10'
              : 'border-white/8 bg-white/[0.025] hover:bg-white/[0.04]'
          "
          @click="toggleKind('grant')"
        >
          <p class="text-xs text-white/45">获得积分</p>
          <p class="mt-1 text-lg font-semibold text-indigo-300">+{{ summary.grantTotal }}</p>
        </button>
        <button
          v-if="summary.otherNetConsumed > 0"
          type="button"
          class="rounded-xl border p-4 text-left transition"
          :class="
            filterCategory === 'other'
              ? 'border-white/30 bg-white/[0.08]'
              : 'border-white/8 bg-white/[0.025] hover:bg-white/[0.04]'
          "
          @click="toggleCategory('other')"
        >
          <p class="text-xs text-white/45">其他消耗</p>
          <p class="mt-1 text-lg font-semibold text-white/70">{{ summary.otherNetConsumed }}</p>
        </button>
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-2 border-t border-white/8 pt-4">
        <span class="mr-1 text-xs text-white/35">记录类型</span>
        <button
          v-for="kind in (['consume', 'refund', 'grant'] as PointKind[])"
          :key="kind"
          type="button"
          class="rounded-full border px-3 py-1 text-xs transition"
          :class="
            filterKind === kind
              ? 'border-[#818cf8]/60 bg-[#6366f1]/15 text-[#a5b4fc]'
              : 'border-white/10 text-white/45 hover:text-white/70'
          "
          @click="toggleKind(kind)"
        >
          {{ kindLabels[kind] }}
        </button>
        <button
          v-if="filterCategory || filterKind"
          type="button"
          class="ml-auto text-xs text-white/40 transition hover:text-white/70"
          @click="filterCategory = undefined; filterKind = undefined"
        >
          清除筛选
        </button>
      </div>
    </section>

    <div v-if="isLoading" class="rounded-2xl border border-white/8 bg-[#1a1a1a] py-12 text-center text-sm text-white/35">
      正在加载积分账单…
    </div>
    <div
      v-else-if="loadError && !transactions.length"
      class="rounded-2xl border border-red-400/15 bg-red-400/[0.04] py-10 text-center"
    >
      <p class="text-sm text-red-300/80">{{ loadError }}</p>
      <button type="button" class="mt-3 text-xs text-white/50 underline hover:text-white/80" @click="reload">
        重新加载
      </button>
    </div>
    <div v-else class="space-y-3">
      <div
        v-for="tx in transactions"
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
          <span class="shrink-0 text-base font-semibold" :class="tx.amount >= 0 ? 'text-green-400' : 'text-red-400'">
            {{ tx.amount >= 0 ? '+' : '' }}{{ tx.amount }}
          </span>
        </div>
        <div class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-3">
          <time class="text-xs text-white/30" :datetime="tx.createdAt">{{ formatCreatedAt(tx.createdAt) }}</time>
          <span v-if="tx.generationId" class="font-mono text-[11px] text-[#818cf8]/70" :title="tx.generationId">
            生成 ID · {{ shortGenerationId(tx.generationId) }}
          </span>
        </div>
      </div>
      <p v-if="loadError" class="py-2 text-center text-xs text-red-300/70">{{ loadError }}</p>
      <div v-if="nextCursor" class="pt-2 text-center">
        <button
          type="button"
          class="rounded-xl border border-white/10 px-5 py-2 text-xs text-white/50 transition hover:bg-white/[0.04] hover:text-white/80 disabled:opacity-40"
          :disabled="isLoadingMore"
          @click="loadMore"
        >
          {{ isLoadingMore ? '加载中…' : '加载更多' }}
        </button>
      </div>
      <p v-if="!transactions.length" class="rounded-2xl border border-white/8 bg-[#1a1a1a] py-12 text-center text-white/30">
        暂无该时间范围的账单记录
      </p>
    </div>
  </div>
</template>
