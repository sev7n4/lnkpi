import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { User } from '@lnkpi/shared'
import { api } from '@/services/api'

const AUTH_TIMEOUT_MS = 45_000

async function withAuthRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 600 * (i + 1)))
      }
    }
  }
  throw lastError
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const token = ref<string | null>(localStorage.getItem('token'))
  const showLoginDialog = ref(false)

  const isLoggedIn = computed(() => !!token.value && !!user.value)

  async function sendCode(phone: string) {
    await withAuthRetry(() =>
      api.post('/auth/send-code', { phone }, { timeout: AUTH_TIMEOUT_MS }),
    )
  }

  async function fetchAuthConfig() {
    const { data } = await withAuthRetry(() =>
      api.get<{
        data: { smsMode: string; fixedCodeHint: string | null; message: string | null }
      }>('/auth/config', { timeout: AUTH_TIMEOUT_MS }),
    )
    return data.data
  }

  async function login(phone: string, code: string) {
    const res = await withAuthRetry(() =>
      api.post<{ code?: number; data: { token: string; user: User } }>(
        '/auth/login',
        { phone, code },
        { timeout: AUTH_TIMEOUT_MS },
      ),
    )
    const payload = res.data?.data
    if (!payload?.token || !payload?.user) {
      throw new Error('登录响应格式异常')
    }
    token.value = payload.token
    user.value = payload.user
    localStorage.setItem('token', payload.token)
    showLoginDialog.value = false
  }

  function logout() {
    token.value = null
    user.value = null
    localStorage.removeItem('token')
  }

  function openLogin() {
    showLoginDialog.value = true
  }

  return {
    user,
    token,
    isLoggedIn,
    showLoginDialog,
    sendCode,
    fetchAuthConfig,
    login,
    logout,
    openLogin,
  }
})
