<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import LoginVideoPanel from './LoginVideoPanel.vue'
import LoginFormPanel from './LoginFormPanel.vue'

const auth = useAuthStore()
const shellRef = ref<HTMLElement | null>(null)
const formRef = ref<InstanceType<typeof LoginFormPanel> | null>(null)

const visible = computed({
  get: () => auth.showLoginDialog,
  set: (v: boolean) => {
    auth.showLoginDialog = v
  },
})

watch(
  () => auth.showLoginDialog,
  async (open) => {
    if (!open) return
    await nextTick()
    shellRef.value?.focus()
  },
)

function onEsc() {
  // Task 5: if captcha overlay open, close it first
  visible.value = false
}

async function onRequestSendCode(phone: string) {
  try {
    await auth.sendCode(phone)
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
      aria-label="登录"
      tabindex="-1"
      @keydown.esc.prevent="onEsc"
    >
      <div class="h-[28vh] w-full shrink-0 md:h-auto md:w-[55vw]">
        <LoginVideoPanel />
      </div>
      <div
        class="relative flex flex-1 items-start justify-center overflow-y-auto bg-[var(--neo-bg)] px-6 py-10 md:items-center"
      >
        <button
          type="button"
          class="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full text-2xl leading-none text-[var(--neo-text-secondary)] transition hover:bg-[var(--neo-hover-bg)] hover:text-[var(--neo-text-primary)]"
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
      </div>
    </div>
  </Teleport>
</template>
