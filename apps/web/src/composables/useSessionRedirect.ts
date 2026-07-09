import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/services/api'

export function useSessionRedirect() {
  const route = useRoute()
  const router = useRouter()
  const auth = useAuthStore()

  onMounted(async () => {
    const sessionId = route.query.sessionId as string | undefined
    if (!sessionId) return

    if (!auth.isLoggedIn) {
      auth.openLogin()
      return
    }

    try {
      await api.get(`/sessions/${sessionId}`)
      await router.replace(`/workflow/${sessionId}`)
    } catch {
      // session 不存在，留在启动器
    }
  })
}
