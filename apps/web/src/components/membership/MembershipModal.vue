<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { membershipApi, type MembershipPlan } from '@/services/users-api'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [v: boolean] }>()

const auth = useAuthStore()
const plans = ref<MembershipPlan[]>([])
const points = ref(0)
const membership = ref('free')
const loading = ref(false)
const message = ref('')

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

async function loadData() {
  if (!auth.isLoggedIn) return
  const [plansRes, pointsRes] = await Promise.all([
    membershipApi.getPlans(),
    membershipApi.getPoints(),
  ])
  plans.value = plansRes.data.data
  points.value = pointsRes.data.data.points
  membership.value = pointsRes.data.data.membership
}

watch(() => props.modelValue, (open) => {
  if (open) void loadData()
})

onMounted(() => {
  if (props.modelValue) void loadData()
})

async function claimDaily() {
  loading.value = true
  message.value = ''
  try {
    const { data } = await membershipApi.claimDaily()
    points.value = data.data.points
    auth.setPoints(data.data.points)
    message.value = `已领取 ${data.data.added} 积分`
  } catch {
    message.value = '领取失败'
  } finally {
    loading.value = false
  }
}

async function upgrade(plan: string) {
  loading.value = true
  message.value = ''
  try {
    const { data } = await membershipApi.upgrade(plan)
    points.value = data.data.points
    membership.value = data.data.membership
    if (auth.user) {
      auth.user.points = data.data.points
      auth.user.membership = data.data.membership
    }
    message.value = '升级成功（演示模式）'
  } catch {
    message.value = '升级失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="积分与会员" width="560px" class="membership-dialog">
    <div v-if="auth.isLoggedIn" class="space-y-4">
      <div class="rounded-xl border border-white/10 bg-[#242424] p-4">
        <p class="text-xs text-white/50">当前积分</p>
        <p class="text-3xl font-semibold text-[#818cf8]">{{ points }}</p>
        <p class="mt-1 text-xs text-white/40">
          会员：{{ membership === 'pro' ? '专业版' : membership === 'studio' ? '工作室版' : '免费版' }}
        </p>
        <el-button class="mt-3" size="small" :loading="loading" @click="claimDaily">
          领取每日积分 (+100)
        </el-button>
      </div>

      <div class="grid gap-3 sm:grid-cols-3">
        <div
          v-for="plan in plans"
          :key="plan.id"
          class="rounded-xl border p-4"
          :class="membership === plan.id ? 'border-[#6366f1]/50 bg-[#6366f1]/10' : 'border-white/10 bg-[#1a1a1a]'"
        >
          <h3 class="font-medium">{{ plan.name }}</h3>
          <p class="mt-1 text-lg">{{ plan.price ? `¥${plan.price}/月` : '免费' }}</p>
          <ul class="mt-2 space-y-1 text-[11px] text-white/50">
            <li v-for="f in plan.features" :key="f">· {{ f }}</li>
          </ul>
          <el-button
            v-if="plan.id !== 'free' && membership !== plan.id"
            class="mt-3 w-full"
            size="small"
            type="primary"
            :loading="loading"
            @click="upgrade(plan.id)"
          >
            升级
          </el-button>
        </div>
      </div>
      <p v-if="message" class="text-sm text-[#818cf8]">{{ message }}</p>
    </div>
    <p v-else class="py-8 text-center text-white/50">请先登录</p>
  </el-dialog>
</template>

<style>
.membership-dialog .el-dialog {
  background: #1a1a1a;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.membership-dialog .el-dialog__title {
  color: #fff;
}
</style>
