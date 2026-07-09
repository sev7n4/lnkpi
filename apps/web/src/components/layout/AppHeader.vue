<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import LoginDialog from '@/components/auth/LoginDialog.vue'
import MembershipModal from '@/components/membership/MembershipModal.vue'

const showMembership = ref(false)

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const tabs = [
  { label: '画布', path: '/workflow' },
  { label: '超创站', path: '/community' },
  { label: '短片', path: '/stories' },
  { label: '工作室', path: '/image-studio' },
]

const activeTab = computed(() => {
  if (route.path.startsWith('/community')) return '/community'
  if (route.path.startsWith('/stories')) return '/stories'
  if (route.path.startsWith('/text-studio') || route.path.startsWith('/image-studio')
    || route.path.startsWith('/video-studio') || route.path.startsWith('/audio-studio')
    || route.path.startsWith('/video-editor') || route.path.startsWith('/generation-records')) {
    return '/image-studio'
  }
  return '/workflow'
})

function navigate(path: string) {
  router.push(path)
}
</script>

<template>
  <header
    class="sticky top-0 z-50 border-b border-white/5 bg-[#141414]/95 backdrop-blur-xl"
    style="height: var(--neo-header-height)"
  >
    <div class="mx-auto flex h-full max-w-7xl items-center justify-between px-6">
      <div class="flex items-center gap-8">
        <button class="flex items-center gap-2" @click="navigate('/workflow')">
          <div
            class="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#6366f1] to-[#4f46e5] font-display text-sm font-bold"
          >
            超
          </div>
          <span class="font-display text-lg font-semibold tracking-tight">超创平台</span>
        </button>

        <nav class="hidden items-center gap-1 md:flex">
          <button
            v-for="tab in tabs"
            :key="tab.path"
            class="rounded-lg px-4 py-2 text-sm font-medium transition"
            :class="activeTab === tab.path ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white'"
            @click="navigate(tab.path)"
          >
            {{ tab.label }}
          </button>
        </nav>
      </div>

      <div class="flex items-center gap-3">
        <template v-if="auth.isLoggedIn">
          <button
            class="rounded-xl bg-[#6366f1]/20 px-3 py-1.5 text-xs text-[#818cf8] transition hover:bg-[#6366f1]/30"
            @click="showMembership = true"
          >
            {{ auth.user?.points ?? 0 }} 积分
          </button>
          <button
            class="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-1.5 transition hover:bg-white/10"
            @click="navigate('/profile')"
          >
            <div
              class="flex h-7 w-7 items-center justify-center rounded-full bg-[#6366f1] text-xs font-medium"
            >
              {{ auth.user?.nickname?.[0] ?? 'U' }}
            </div>
            <span class="text-sm text-white/80">{{ auth.user?.nickname }}</span>
          </button>
          <button class="btn-ghost text-xs" @click="auth.logout()">退出</button>
        </template>
        <button v-else class="btn-ghost" @click="auth.openLogin()">登录</button>
      </div>
    </div>
  </header>

  <LoginDialog />
  <MembershipModal v-model="showMembership" />
</template>
