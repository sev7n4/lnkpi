<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import BrandLogo from '@/components/brand/BrandLogo.vue'

const emit = defineEmits<{
  'request-send-code': [phone: string]
}>()

const auth = useAuthStore()
const phone = ref('')
const code = ref('')
const countdown = ref(0)
const loading = ref(false)
const error = ref('')
const authHint = ref('')
const sending = ref(false)

let countdownTimer: ReturnType<typeof setInterval> | null = null

const phoneOk = computed(() => /^1\d{10}$/.test(phone.value.trim()))

watch(
  () => auth.showLoginDialog,
  async (open) => {
    if (!open) {
      clearCountdown()
      countdown.value = 0
      sending.value = false
      return
    }
    error.value = ''
    authHint.value = ''
    try {
      const cfg = await auth.fetchAuthConfig()
      if (cfg.fixedCodeHint) {
        authHint.value = `临时验证码：${cfg.fixedCodeHint}（固定码模式，未发送真实短信）`
      }
    } catch {
      authHint.value = '若收不到短信，可尝试验证码 123456'
    }
  },
  { immediate: true },
)

function clearCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
}

function startCountdown(seconds = 60) {
  clearCountdown()
  countdown.value = seconds
  countdownTimer = setInterval(() => {
    countdown.value--
    if (countdown.value <= 0) clearCountdown()
  }, 1000)
}

function setSendError(message: string) {
  error.value = message
  sending.value = false
}

function cancelSending() {
  sending.value = false
}

function markSendSuccess() {
  sending.value = false
  startCountdown(60)
}

function handleSendCode() {
  if (!phoneOk.value || countdown.value > 0 || sending.value) return
  error.value = ''
  sending.value = true
  emit('request-send-code', phone.value.trim())
}

async function handleLogin() {
  if (!phone.value || !code.value) return
  loading.value = true
  error.value = ''
  try {
    await auth.login(phone.value.trim(), code.value.trim())
  } catch (err) {
    const ax = err as { code?: string; response?: { status?: number } }
    if (ax.code === 'ECONNABORTED' || ax.response?.status === 502) {
      error.value = '登录超时，请重试（验证码仍为 123456）'
    } else {
      error.value = '登录失败，请检查验证码'
    }
  } finally {
    loading.value = false
  }
}

onUnmounted(() => {
  clearCountdown()
})

defineExpose({
  startCountdown,
  markSendSuccess,
  setSendError,
  cancelSending,
})
</script>

<template>
  <div class="flex w-full flex-col gap-6">
    <div class="flex flex-col items-center gap-3 text-center">
      <BrandLogo size="lg" />
      <h1 class="text-2xl font-semibold tracking-tight text-[var(--neo-text-primary)]">欢迎回来</h1>
      <p class="text-sm text-[var(--neo-text-secondary)]">用手机号继续创作</p>
    </div>

    <div class="space-y-4">
      <div>
        <label class="mb-1.5 block text-xs text-[var(--neo-text-muted)]">手机号</label>
        <div class="flex gap-2">
          <span class="input-field flex w-16 items-center justify-center !px-2">+86</span>
          <input
            v-model="phone"
            class="input-field"
            placeholder="请输入手机号"
            type="tel"
            maxlength="11"
            autocomplete="tel"
          />
        </div>
      </div>

      <div>
        <label class="mb-1.5 block text-xs text-[var(--neo-text-muted)]">验证码</label>
        <div class="flex gap-2">
          <input
            v-model="code"
            class="input-field"
            placeholder="请输入验证码"
            inputmode="numeric"
            autocomplete="one-time-code"
          />
          <button
            type="button"
            class="btn-ghost shrink-0 whitespace-nowrap"
            :disabled="!phoneOk || countdown > 0 || sending"
            @click="handleSendCode"
          >
            {{ countdown > 0 ? `${countdown}s` : sending ? '发送中…' : '发送验证码' }}
          </button>
        </div>
      </div>

      <p v-if="authHint" class="text-xs text-amber-400/90">{{ authHint }}</p>

      <p v-if="error" class="text-sm text-red-400">{{ error }}</p>

      <button
        type="button"
        class="btn-primary w-full"
        :disabled="loading || !phoneOk || !code"
        @click="handleLogin"
      >
        {{ loading ? '登录中…' : '开始创作' }}
      </button>

      <p class="text-center text-xs text-[var(--neo-text-muted)]">
        登录即表示同意
        <a href="#" class="underline decoration-[var(--neo-border-strong)] underline-offset-2 hover:text-[var(--neo-text-secondary)]">《用户协议》</a>
        与
        <a href="#" class="underline decoration-[var(--neo-border-strong)] underline-offset-2 hover:text-[var(--neo-text-secondary)]">《隐私政策》</a>
      </p>
    </div>
  </div>
</template>
