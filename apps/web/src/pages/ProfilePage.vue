<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MembershipModal from '@/components/membership/MembershipModal.vue'
import UsageDayTable from '@/components/usage/UsageDayTable.vue'
import UsageHeatmap from '@/components/usage/UsageHeatmap.vue'
import UsageOverviewCards from '@/components/usage/UsageOverviewCards.vue'
import UsageTrend from '@/components/usage/UsageTrend.vue'
import { useAuthStore } from '@/stores/auth'
import { membershipApi } from '@/services/users-api'
import { api } from '@/services/api'
import { copyTextToClipboard } from '@/utils/copyToClipboard'
import { BRAND_LOGO_URL } from '@/constants/brand'
import type { User } from '@lnkpi/shared'
import type { UsageDaysRangeKey, UsageDaysResponse, UsageOverviewResponse } from '@/services/users-api'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

type ProfileTab = 'account' | 'billing'

const activeTab = computed<ProfileTab>(() => {
  const raw = Array.isArray(route.query.tab) ? route.query.tab[0] : route.query.tab
  if (raw === 'billing' || raw === 'usage') return 'billing'
  return 'account'
})

function setTab(tab: ProfileTab) {
  void router.replace({ query: { ...route.query, tab } })
}

function closeProfile() {
  if (window.history.length > 1) router.back()
  else void router.replace('/workflow')
}

const profile = ref<User | null>(null)
const usage = ref<UsageOverviewResponse | null>(null)
const usageDays = ref<UsageDaysResponse | null>(null)
const usageRange = ref<UsageDaysRangeKey>('7d')
const usageError = ref('')
const daysError = ref('')
const usageLoading = ref(false)
const daysLoading = ref(false)
const showMembership = ref(false)
const inviteCopied = ref(false)

/** Independent generations; stale overview / days responses are discarded. */
let usageFetchGeneration = 0
let daysFetchGeneration = 0

function bumpUsageFetchGeneration() {
  usageFetchGeneration += 1
  return usageFetchGeneration
}

function bumpDaysFetchGeneration() {
  daysFetchGeneration += 1
  return daysFetchGeneration
}

const membershipLabel = computed(() => {
  const m = profile.value?.membership
  if (m === 'pro') return '专业版'
  if (m === 'studio') return '工作室版'
  return '免费版'
})

const isFreeMembership = computed(() => !profile.value?.membership || profile.value.membership === 'free')

async function copyInvite() {
  const code = profile.value?.inviteCode
  if (!code) return
  try {
    await copyTextToClipboard(code)
    inviteCopied.value = true
    setTimeout(() => {
      inviteCopied.value = false
    }, 1500)
  } catch {
    // ignore clipboard failures
  }
}

async function loadUsage() {
  const gen = bumpUsageFetchGeneration()
  usageLoading.value = true
  usageError.value = ''
  try {
    const response = await membershipApi.usage()
    if (gen !== usageFetchGeneration) return
    usage.value = response.data.data
  } catch {
    if (gen !== usageFetchGeneration) return
    usageError.value = '用量总览加载失败，请稍后重试'
  } finally {
    if (gen === usageFetchGeneration) {
      usageLoading.value = false
    }
  }
}

async function loadUsageDays() {
  const gen = bumpDaysFetchGeneration()
  daysLoading.value = true
  daysError.value = ''
  try {
    const response = await membershipApi.usageDays(usageRange.value)
    if (gen !== daysFetchGeneration) return
    usageDays.value = response.data.data
  } catch {
    if (gen !== daysFetchGeneration) return
    daysError.value = '用量趋势加载失败，请稍后重试'
  } finally {
    if (gen === daysFetchGeneration) {
      daysLoading.value = false
    }
  }
}

const daysViewLoading = computed(
  () => daysLoading.value || (!usageDays.value && !daysError.value),
)

const usageViewLoading = computed(
  () => usageLoading.value || (!usage.value && !usageError.value),
)

async function loadProfile() {
  try {
    const { data } = await api.get<{ data: User }>('/auth/profile')
    profile.value = data.data
    auth.user = data.data
  } catch {
    void router.push('/workflow')
  }
}

function loadBillingUsage() {
  void loadUsage()
  void loadUsageDays()
}

watch(activeTab, (tab) => {
  if (tab === 'billing') {
    loadBillingUsage()
  }
})

watch(usageRange, () => {
  void loadUsageDays()
})

onMounted(() => {
  if (!auth.isLoggedIn) {
    auth.openLogin()
    return
  }
  void loadProfile()
  if (activeTab.value === 'billing') {
    loadBillingUsage()
  }
})
</script>

<template>
  <div class="mx-auto max-w-6xl px-6 py-10">
    <div class="mb-6 flex items-center justify-between gap-4">
      <h1 class="text-2xl font-semibold">个人中心</h1>
      <button
        type="button"
        class="flex h-9 w-9 items-center justify-center rounded-full text-xl leading-none text-white/50 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
        aria-label="关闭"
        @click="closeProfile"
      >
        ×
      </button>
    </div>

    <div class="mb-6 inline-flex rounded-full border border-white/8 bg-[#16161C] p-1">
      <button
        v-for="tab in ([['account', '账户'], ['billing', '用量']] as const)"
        :key="tab[0]"
        type="button"
        class="rounded-full px-4 py-1.5 text-sm transition"
        :class="activeTab === tab[0] ? 'bg-white/12 text-white' : 'text-white/50 hover:text-white/80'"
        @click="setTab(tab[0])"
      >
        {{ tab[1] }}
      </button>
    </div>

    <div v-if="profile && activeTab === 'account'" class="max-w-3xl space-y-4">
      <section class="rounded-2xl border border-white/8 bg-[#16161C] p-6">
        <div class="flex items-center gap-4">
          <div class="profile-avatar flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full">
            <img
              :src="BRAND_LOGO_URL"
              alt="用户"
              class="h-full w-full object-contain p-0.5"
              draggable="false"
            >
          </div>
          <div class="min-w-0">
            <h2 class="truncate text-lg font-medium">{{ profile.nickname }}</h2>
            <p class="text-sm text-white/50">{{ profile.phone }}</p>
            <span class="mt-1 inline-block rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs text-white/60">
              {{ membershipLabel }}
            </span>
          </div>
        </div>
      </section>

      <section class="rounded-2xl border border-white/8 bg-[#16161C] p-6">
        <p class="text-sm text-white/45">创作能量</p>
        <p class="mt-2 text-3xl font-semibold tabular-nums text-[var(--neo-warm)]">{{ profile.points ?? 0 }}</p>
        <p v-if="isFreeMembership" class="mt-3 text-xs text-white/35">开通会员，获得更多积分与高级能力</p>
        <div class="mt-4 flex gap-3">
          <button type="button" class="flex-1 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black" @click="showMembership = true">
            充值
          </button>
          <button type="button" class="flex-1 rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/80" @click="showMembership = true">
            {{ isFreeMembership ? '升级会员' : '管理会员' }}
          </button>
        </div>
      </section>

      <section class="rounded-2xl border border-white/8 bg-[#16161C] p-6">
        <p class="text-sm text-white/45">我的邀请码</p>
        <div class="mt-2 flex items-center gap-3">
          <code class="text-lg tracking-widest text-white">{{ profile.inviteCode ?? '—' }}</code>
          <button
            type="button"
            class="shrink-0 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-40"
            :disabled="!profile.inviteCode"
            @click="copyInvite"
          >
            {{ inviteCopied ? '已复制' : '复制' }}
          </button>
        </div>
        <p class="mt-3 text-sm text-white/50">已邀请 {{ profile.inviteeCount ?? 0 }} 人</p>
      </section>
    </div>

    <div v-if="activeTab === 'billing'" class="space-y-4">
      <div v-if="usageError" class="rounded-2xl border border-red-400/15 p-6 text-sm text-red-300/80">
        {{ usageError }}
        <button type="button" class="ml-2 underline" @click="loadUsage">重新加载</button>
      </div>
      <UsageOverviewCards v-else-if="usage" :overview="usage.overview" />
      <div v-else class="h-28 animate-pulse rounded-2xl bg-white/5" />

      <UsageHeatmap
        v-if="usage && !usageError"
        :from="usage.heatmap.from"
        :to="usage.heatmap.to"
        :active-days="usage.heatmap.activeDays"
        :days="usage.heatmap.days"
      />
      <div v-else-if="usageViewLoading" class="h-48 animate-pulse rounded-2xl bg-white/5" />

      <div v-if="daysError" class="rounded-2xl border border-red-400/15 p-6 text-sm text-red-300/80">
        {{ daysError }}
        <button type="button" class="ml-2 underline" @click="loadUsageDays">重新加载</button>
      </div>
      <template v-else>
        <UsageTrend :range="usageRange" :days="usageDays?.days ?? []" :loading="daysViewLoading" @update:range="usageRange = $event" />
        <UsageDayTable :days="usageDays?.days ?? []" :loading="daysViewLoading" />
      </template>
    </div>

    <MembershipModal v-model="showMembership" />
  </div>
</template>

<style scoped>
.profile-avatar {
  background: var(--neo-brand-gradient);
}
</style>
