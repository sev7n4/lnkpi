import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { User } from '@lnkpi/shared'
import { api } from '@/services/api'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const token = ref<string | null>(localStorage.getItem('token'))
  const showLoginDialog = ref(false)

  const isLoggedIn = computed(() => !!token.value && !!user.value)

  async function sendCode(phone: string) {
    await api.post('/auth/send-code', { phone })
  }

  async function login(phone: string, code: string) {
    const { data } = await api.post<{ data: { token: string; user: User } }>('/auth/login', {
      phone,
      code,
    })
    token.value = data.data.token
    user.value = data.data.user
    localStorage.setItem('token', data.data.token)
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
    login,
    logout,
    openLogin,
  }
})
