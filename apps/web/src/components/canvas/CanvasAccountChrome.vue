<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useClickOutside } from '@/composables/useClickOutside'
import MembershipModal from '@/components/membership/MembershipModal.vue'

const showMembership = defineModel<boolean>('showMembership', { default: false })

const auth = useAuthStore()
const router = useRouter()
const menuOpen = ref(false)
const menuRef = ref<HTMLElement | null>(null)

function closeMenu() {
  menuOpen.value = false
}

useClickOutside(menuRef, closeMenu)

function openProfile() {
  closeMenu()
  void router.push('/profile')
}

function logout() {
  closeMenu()
  auth.logout()
}
</script>

<template>
  <div v-if="auth.isLoggedIn" class="canvas-account-chrome pointer-events-auto flex items-center gap-2">
    <button
      type="button"
      class="canvas-points-pill rounded-xl border border-white/[0.08] bg-[rgba(22,22,22,0.88)] px-3 py-1.5 text-xs text-[#818cf8] shadow-lg backdrop-blur-xl transition hover:bg-white/[0.06]"
      @click="showMembership = true"
    >
      {{ auth.user?.points ?? 0 }} 积分
    </button>

    <div ref="menuRef" class="canvas-user-menu relative">
      <button
        type="button"
        class="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-[rgba(22,22,22,0.88)] px-2 py-1 shadow-lg backdrop-blur-xl transition hover:bg-white/[0.06]"
        @click.stop="menuOpen = !menuOpen"
      >
        <div
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#6366f1] text-xs font-medium text-white"
        >
          {{ auth.user?.nickname?.[0] ?? 'U' }}
        </div>
        <span class="max-w-[88px] truncate text-sm text-white/80">{{ auth.user?.nickname }}</span>
        <svg
          class="h-3.5 w-3.5 shrink-0 text-white/40 transition"
          :class="menuOpen ? 'rotate-180' : ''"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div
        v-if="menuOpen"
        class="absolute right-0 top-full z-10 mt-1.5 min-w-[120px] rounded-xl border border-white/10 bg-[#242424] py-1 shadow-2xl"
        @click.stop
      >
        <button
          type="button"
          class="flex w-full px-3 py-2 text-left text-xs text-white/70 hover:bg-white/5 hover:text-white"
          @click="openProfile"
        >
          资料
        </button>
        <button
          type="button"
          class="flex w-full px-3 py-2 text-left text-xs text-white/70 hover:bg-white/5 hover:text-white"
          @click="logout"
        >
          退出
        </button>
      </div>
    </div>

    <MembershipModal v-model="showMembership" />
  </div>
  <button
    v-else
    type="button"
    class="canvas-account-chrome pointer-events-auto rounded-xl border border-white/[0.08] bg-[rgba(22,22,22,0.88)] px-3 py-1.5 text-xs text-white/70 shadow-lg backdrop-blur-xl transition hover:bg-white/[0.06] hover:text-white"
    @click="auth.openLogin()"
  >
    登录
  </button>
</template>
