<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import BrandLogo from '@/components/brand/BrandLogo.vue'
import { ICP_TEXT, PRIVACY_PATH, PRIVACY_TITLE, TERMS_PATH, TERMS_TITLE } from '@/constants/brand'

const emit = defineEmits<{
  'request-send-code': [phone: string]
}>()

type AuthMode = 'login' | 'register'

const auth = useAuthStore()
const mode = ref<AuthMode>('login')
const phone = ref('')
const code = ref('')
const inviteCode = ref('')
const countdown = ref(0)
const loading = ref(false)
const error = ref('')
const authHint = ref('')
const sending = ref(false)

let countdownTimer: ReturnType<typeof setInterval> | null = null

const phoneOk = computed(() => /^1\d{10}$/.test(phone.value.trim()))
const titleText = computed(() => (mode.value === 'register' ? '欢迎注册' : '欢迎登录'))
const submitLabel = computed(() => {
  if (loading.value) return mode.value === 'register' ? '注册中…' : '登录中…'
  return mode.value === 'register' ? '注册' : '开始你的旅程'
})
const agreementVerb = computed(() => (mode.value === 'register' ? '注册' : '登录'))

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

function setMode(next: AuthMode) {
  if (mode.value === next) return
  mode.value = next
  error.value = ''
}

function handleSendCode() {
  if (!phoneOk.value || countdown.value > 0 || sending.value) return
  error.value = ''
  sending.value = true
  emit('request-send-code', phone.value.trim())
}

function readApiMessage(err: unknown): string {
  const ax = err as {
    response?: { data?: { message?: string | string[]; error?: string } }
  }
  const raw = ax.response?.data?.message ?? ax.response?.data?.error
  if (Array.isArray(raw)) return raw.filter(Boolean).join('; ')
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  return ''
}

function mapAuthFormError(err: unknown, current: AuthMode): string {
  const ax = err as { code?: string; response?: { status?: number } }
  if (ax.code === 'ECONNABORTED' || ax.response?.status === 502) {
    return '登录超时，请重试（验证码仍为 123456）'
  }
  const apiMsg = readApiMessage(err)
  if (apiMsg) return apiMsg
  if (ax.response?.status === 409) return '账号已存在，请直接登录'
  return current === 'register' ? '注册失败，请检查验证码' : '登录失败，请检查验证码'
}

async function handleSubmit() {
  if (!phone.value || !code.value) return
  loading.value = true
  error.value = ''
  try {
    if (mode.value === 'register') {
      await auth.register(phone.value.trim(), code.value.trim(), inviteCode.value.trim() || undefined)
    } else {
      await auth.login(phone.value.trim(), code.value.trim())
    }
  } catch (err) {
    error.value = mapAuthFormError(err, mode.value)
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
      <h1 class="text-2xl font-semibold tracking-tight text-[var(--neo-text-primary)]">{{ titleText }}</h1>
      <p class="text-sm text-[var(--neo-text-secondary)]">继续你的创作之旅</p>
    </div>

    <div
      class="mx-auto flex w-full max-w-[220px] rounded-full border border-[var(--neo-border)] bg-[var(--neo-hover-bg)] p-1"
      role="tablist"
      aria-label="登录或注册"
    >
      <button
        type="button"
        role="tab"
        class="flex-1 rounded-full py-1.5 text-sm transition"
        :class="
          mode === 'login'
            ? 'bg-[var(--neo-surface-elevated)] font-medium text-[var(--neo-text-primary)]'
            : 'text-[var(--neo-text-muted)] hover:text-[var(--neo-text-secondary)]'
        "
        :aria-selected="mode === 'login'"
        @click="setMode('login')"
      >
        登录
      </button>
      <button
        type="button"
        role="tab"
        class="flex-1 rounded-full py-1.5 text-sm transition"
        :class="
          mode === 'register'
            ? 'bg-[var(--neo-surface-elevated)] font-medium text-[var(--neo-text-primary)]'
            : 'text-[var(--neo-text-muted)] hover:text-[var(--neo-text-secondary)]'
        "
        :aria-selected="mode === 'register'"
        @click="setMode('register')"
      >
        注册
      </button>
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

      <div v-if="mode === 'register'">
        <label class="mb-1.5 block text-xs text-[var(--neo-text-muted)]">邀请码</label>
        <input
          v-model="inviteCode"
          class="input-field"
          placeholder="请输入邀请码（可选）"
          maxlength="32"
          autocomplete="off"
        />
      </div>

      <p v-if="authHint" class="text-xs text-amber-400/90">{{ authHint }}</p>

      <p v-if="error" class="text-sm text-red-400">{{ error }}</p>

      <button
        type="button"
        class="btn-primary w-full"
        :disabled="loading || !phoneOk || !code"
        @click="handleSubmit"
      >
        {{ submitLabel }}
      </button>

      <p class="text-center text-xs text-[var(--neo-text-muted)]">
        {{ agreementVerb }}即表示同意
        <a
          :href="TERMS_PATH"
          target="_blank"
          rel="noopener noreferrer"
          class="underline decoration-[var(--neo-border-strong)] underline-offset-2 hover:text-[var(--neo-text-secondary)]"
        >《{{ TERMS_TITLE }}》</a>
        与
        <a
          :href="PRIVACY_PATH"
          target="_blank"
          rel="noopener noreferrer"
          class="underline decoration-[var(--neo-border-strong)] underline-offset-2 hover:text-[var(--neo-text-secondary)]"
        >《{{ PRIVACY_TITLE }}》</a>
      </p>

      <p class="text-center text-[11px] text-[var(--neo-text-muted)]">{{ ICP_TEXT }}</p>
    </div>
  </div>
</template>
