<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { membershipApi } from '@/services/users-api'
import { api } from '@/services/api'
import type { User } from '@lnkpi/shared'

const router = useRouter()
const auth = useAuthStore()
const profile = ref<User | null>(null)
const transactions = ref<Array<{ id: string; amount: number; reason: string; createdAt: string }>>([])

onMounted(async () => {
  if (!auth.isLoggedIn) {
    auth.openLogin()
    return
  }
  try {
    const { data } = await api.get<{ data: User }>('/auth/profile')
    profile.value = data.data
    auth.user = data.data
    const tx = await membershipApi.transactions()
    transactions.value = tx.data.data
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
      <div class="mt-6 grid grid-cols-2 gap-4">
        <div class="rounded-xl bg-[#242424] p-4">
          <p class="text-xs text-white/40">积分余额</p>
          <p class="text-2xl font-semibold text-[#818cf8]">{{ profile.points ?? 0 }}</p>
        </div>
        <div class="rounded-xl bg-[#242424] p-4">
          <p class="text-xs text-white/40">会员等级</p>
          <p class="text-lg font-medium">
            {{ profile.membership === 'pro' ? '专业版' : profile.membership === 'studio' ? '工作室版' : '免费版' }}
          </p>
        </div>
      </div>
    </div>

    <h2 class="mb-4 text-lg font-medium">积分账单</h2>
    <div class="space-y-2">
      <div
        v-for="tx in transactions"
        :key="tx.id"
        class="flex items-center justify-between rounded-xl border border-white/8 bg-[#1a1a1a] px-4 py-3 text-sm"
      >
        <span class="text-white/70">{{ tx.reason }}</span>
        <span :class="tx.amount >= 0 ? 'text-green-400' : 'text-red-400'">
          {{ tx.amount >= 0 ? '+' : '' }}{{ tx.amount }}
        </span>
      </div>
      <p v-if="!transactions.length" class="py-8 text-center text-white/30">暂无账单记录</p>
    </div>
  </div>
</template>
