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
      <!-- 积分总览：品牌渐变能量卡 -->
      <div class="membership-hero relative overflow-hidden rounded-xl p-4">
        <p class="text-xs text-white/75">当前积分</p>
        <p class="mt-0.5 flex items-baseline gap-1.5 text-3xl font-semibold text-white">
          <svg class="h-5 w-5 self-center text-[var(--neo-warm)]" viewBox="0 0 24 24" fill="currentColor">
            <path d="M13 2 4.5 13.5h5.6L11 22l8.5-11.5h-5.6L13 2z" />
          </svg>
          {{ points }}
        </p>
        <p class="mt-1 text-xs text-white/70">
          会员：{{ membership === 'pro' ? '专业版' : membership === 'studio' ? '工作室版' : '免费版' }}
        </p>
        <el-button class="membership-claim-btn mt-3" size="small" :loading="loading" @click="claimDaily">
          领取每日积分 (+100)
        </el-button>
      </div>

      <div class="grid gap-3 sm:grid-cols-3">
        <div
          v-for="plan in plans"
          :key="plan.id"
          class="membership-plan rounded-xl border p-4"
          :class="membership === plan.id ? 'is-current' : ''"
        >
          <h3 class="font-medium" style="color: var(--neo-text-primary)">{{ plan.name }}</h3>
          <p class="mt-1 text-lg" style="color: var(--neo-text-primary)">{{ plan.price ? `¥${plan.price}/月` : '免费' }}</p>
          <ul class="mt-2 space-y-1 text-[11px]" style="color: var(--neo-text-muted)">
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
      <p v-if="message" class="text-sm" style="color: var(--neo-accent-text)">{{ message }}</p>
    </div>
    <p v-else class="py-8 text-center" style="color: var(--neo-text-muted)">请先登录</p>
  </el-dialog>
</template>

<style>
.membership-dialog .el-dialog {
  background: var(--neo-surface-card);
  border: 1px solid var(--neo-border);
  border-radius: 16px;
}
.membership-dialog .el-dialog__title {
  color: var(--neo-text-primary);
}
.membership-hero {
  background: var(--neo-brand-gradient);
  box-shadow: 0 8px 24px rgba(109, 93, 252, 0.28);
}
.membership-hero::after {
  content: '';
  position: absolute;
  top: -40px;
  right: -20px;
  width: 140px;
  height: 140px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.22), transparent 70%);
  pointer-events: none;
}
.membership-claim-btn {
  --el-button-bg-color: rgba(255, 255, 255, 0.16);
  --el-button-border-color: rgba(255, 255, 255, 0.3);
  --el-button-text-color: #fff;
  --el-button-hover-bg-color: rgba(255, 255, 255, 0.26);
  --el-button-hover-border-color: rgba(255, 255, 255, 0.4);
  --el-button-hover-text-color: #fff;
}
.membership-plan {
  border-color: var(--neo-border);
  background: var(--neo-surface-elevated);
}
.membership-plan.is-current {
  border-color: var(--neo-accent-border);
  background: var(--neo-accent-soft);
}
.membership-dialog .el-button--primary {
  --el-button-bg-color: var(--neo-accent);
  --el-button-border-color: var(--neo-accent);
  --el-button-hover-bg-color: var(--neo-accent-hover);
  --el-button-hover-border-color: var(--neo-accent-hover);
}
</style>
