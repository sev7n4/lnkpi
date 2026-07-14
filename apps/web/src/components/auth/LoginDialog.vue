<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import BrandLogo from '@/components/brand/BrandLogo.vue'

const auth = useAuthStore()
const phone = ref('')
const code = ref('')
const countdown = ref(0)
const loading = ref(false)
const error = ref('')
const authHint = ref('')

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
)

async function handleSendCode() {
  if (!phone.value || countdown.value > 0) return
  error.value = ''
  try {
    await auth.sendCode(phone.value)
    countdown.value = 60
    const timer = setInterval(() => {
      countdown.value--
      if (countdown.value <= 0) clearInterval(timer)
    }, 1000)
  } catch {
    error.value = '验证码发送失败'
  }
}

async function handleLogin() {
  if (!phone.value || !code.value) return
  loading.value = true
  error.value = ''
  try {
    await auth.login(phone.value, code.value)
    visible.value = false
  } catch {
    error.value = '登录失败，请检查验证码'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="欢迎登录" width="420px" align-center>
    <div class="mb-4 flex flex-col items-center gap-2">
      <BrandLogo size="lg" />
      <p class="text-sm text-white/60">继续你的创作之旅</p>
    </div>

    <div class="space-y-4">
      <div>
        <label class="mb-1.5 block text-xs text-white/50">手机号</label>
        <div class="flex gap-2">
          <span class="input-field flex w-16 items-center justify-center !px-2">+86</span>
          <input v-model="phone" class="input-field" placeholder="请输入手机号" type="tel" />
        </div>
      </div>

      <div>
        <label class="mb-1.5 block text-xs text-white/50">验证码</label>
        <div class="flex gap-2">
          <input v-model="code" class="input-field" placeholder="请输入验证码" />
          <button
            class="btn-ghost shrink-0 whitespace-nowrap"
            :disabled="countdown > 0"
            @click="handleSendCode"
          >
            {{ countdown > 0 ? `${countdown}s` : '发送验证码' }}
          </button>
        </div>
      </div>

      <p v-if="authHint" class="text-xs text-amber-400/90">{{ authHint }}</p>

      <p v-if="error" class="text-sm text-red-400">{{ error }}</p>

      <button class="btn-primary w-full" :disabled="loading" @click="handleLogin">
        {{ loading ? '登录中...' : '开始你的旅程' }}
      </button>

      <p class="text-center text-xs text-white/40">
        登录即表示同意《超创平台用户协议》与《隐私政策》
      </p>
    </div>
  </el-dialog>
</template>
