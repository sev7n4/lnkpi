<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useClickOutside } from '@/composables/useClickOutside'
import { BRAND_LOGO_URL } from '@/constants/brand'

const { compact = false } = defineProps<{
  compact?: boolean
}>()

const emit = defineEmits<{
  'open-membership': []
}>()

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
  void router.push({ path: '/profile', query: { tab: 'account' } })
}

function openMembership() {
  closeMenu()
  emit('open-membership')
}

function logout() {
  closeMenu()
  auth.logout()
}

const membershipLabel = (value?: string) =>
  value === 'pro' ? '专业版' : value === 'studio' ? '工作室版' : '免费版'
</script>

<template>
  <div ref="menuRef" class="account-user-menu relative">
    <button
      type="button"
      class="avatar-only neo-chrome flex items-center justify-center rounded-full p-0 transition"
      :class="compact ? 'h-8 w-8' : 'h-9 w-9'"
      :title="auth.user?.nickname"
      @click.stop="menuOpen = !menuOpen"
    >
      <img
        :src="BRAND_LOGO_URL"
        alt="用户"
        class="h-full w-full rounded-full object-contain p-0.5"
        draggable="false"
      >
    </button>
    <div
      v-if="menuOpen"
      class="neo-popover absolute right-0 top-full z-10 mt-1.5 w-[200px] overflow-hidden rounded-xl"
      @click.stop
    >
      <div class="user-card-head" :class="compact ? 'px-2.5 py-2.5' : 'px-3 py-3'">
        <div class="flex items-center gap-2.5">
          <div
            class="avatar-badge flex shrink-0 items-center justify-center overflow-hidden rounded-full"
            :class="compact ? 'h-8 w-8' : 'h-9 w-9'"
          >
            <img
              :src="BRAND_LOGO_URL"
              alt="用户"
              class="h-full w-full object-contain p-0.5"
              draggable="false"
            >
          </div>
          <div class="min-w-0">
            <p class="truncate text-[13px] font-medium text-white">{{ auth.user?.nickname }}</p>
            <p class="text-[10px] text-white/70">{{ membershipLabel(auth.user?.membership) }}</p>
          </div>
        </div>
        <button
          type="button"
          class="mt-2.5 flex w-full items-center justify-between rounded-lg bg-white/12 text-[11px] text-white transition hover:bg-white/20"
          :class="compact ? 'px-2 py-1' : 'px-2.5 py-1.5'"
          @click="openMembership"
        >
          <span class="flex items-center gap-1">
            <svg class="h-3 w-3 text-[var(--neo-warm)]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13 2 4.5 13.5h5.6L11 22l8.5-11.5h-5.6L13 2z" />
            </svg>
            {{ auth.user?.points ?? 0 }} 积分
          </span>
          <span class="opacity-75">充值 ›</span>
        </button>
      </div>
      <div class="py-1">
        <button
          type="button"
          class="neo-popover-item flex w-full px-3 text-left text-xs"
          :class="compact ? 'py-1.5' : 'py-2'"
          @click="openProfile"
        >
          个人资料
        </button>
        <button
          type="button"
          class="neo-popover-item flex w-full px-3 text-left text-xs"
          :class="compact ? 'py-1.5' : 'py-2'"
          @click="logout"
        >
          退出登录
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.avatar-badge {
  background: var(--neo-brand-gradient);
  box-shadow: 0 2px 8px rgba(109, 93, 252, 0.4);
}

.avatar-only {
  overflow: hidden;
}

.user-card-head {
  background: var(--neo-brand-gradient);
}
</style>
