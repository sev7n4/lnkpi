<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import LoginVideoPanel from './LoginVideoPanel.vue'
import LoginFormPanel from './LoginFormPanel.vue'
import SliderCaptchaOverlay from './SliderCaptchaOverlay.vue'

const auth = useAuthStore()
const shellRef = ref<HTMLElement | null>(null)
const formRef = ref<InstanceType<typeof LoginFormPanel> | null>(null)
const showCaptcha = ref(false)
const pendingPhone = ref('')

const visible = computed({
  get: () => auth.showLoginDialog,
  set: (v: boolean) => {
    auth.showLoginDialog = v
  },
})

watch(
  () => auth.showLoginDialog,
  async (open) => {
    if (!open) {
      showCaptcha.value = false
      pendingPhone.value = ''
      auth.clearCaptchaPrefetch()
      return
    }
    auth.prefetchCaptchaChallenge()
    await nextTick()
    shellRef.value?.focus()
  },
)

function onEsc() {
  if (showCaptcha.value) {
    onCaptchaClose()
    return
  }
  visible.value = false
}

function onRequestSendCode(phone: string) {
  pendingPhone.value = phone
  showCaptcha.value = true
}

function onCaptchaClose() {
  showCaptcha.value = false
  formRef.value?.cancelSending()
}

async function onCaptchaVerified(ticket: string) {
  showCaptcha.value = false
  try {
    await auth.sendCode(pendingPhone.value, ticket)
    formRef.value?.markSendSuccess()
  } catch (err) {
    const ax = err as { code?: string; response?: { status?: number } }
    if (ax.code === 'ECONNABORTED' || ax.response?.status === 502) {
      formRef.value?.setSendError('网络超时，请稍后重试（跨境链路可能较慢）')
    } else {
      formRef.value?.setSendError('验证码发送失败')
    }
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="shellRef"
      class="fixed inset-0 z-[100] flex flex-col bg-black outline-none md:flex-row"
      role="dialog"
      aria-modal="true"
      aria-label="登录或注册"
      tabindex="-1"
      @keydown.esc.prevent="onEsc"
    >
      <div class="h-[28vh] w-full shrink-0 md:h-auto md:w-[65%] md:flex-none">
        <LoginVideoPanel />
      </div>
      <div
        class="relative flex flex-1 items-start justify-center overflow-y-auto bg-[var(--neo-bg)] px-6 py-10 md:w-[35%] md:items-center"
      >
        <button
          type="button"
          class="absolute right-5 top-5 z-[105] flex h-9 w-9 items-center justify-center rounded-full text-2xl leading-none text-[var(--neo-text-secondary)] transition hover:bg-[var(--neo-hover-bg)] hover:text-[var(--neo-text-primary)]"
          aria-label="关闭"
          @click="visible = false"
        >
          ×
        </button>
        <LoginFormPanel
          ref="formRef"
          class="w-full max-w-[360px]"
          @request-send-code="onRequestSendCode"
        />
        <SliderCaptchaOverlay
          v-if="showCaptcha"
          @verified="onCaptchaVerified"
          @close="onCaptchaClose"
        />
      </div>
    </div>
  </Teleport>
</template>
