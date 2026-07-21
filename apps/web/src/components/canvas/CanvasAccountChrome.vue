<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useClickOutside } from '@/composables/useClickOutside'
import MembershipModal from '@/components/membership/MembershipModal.vue'
import { BRAND_LOGO_URL } from '@/constants/brand'

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

function openMembership() {
  closeMenu()
  showMembership.value = true
}

function logout() {
  closeMenu()
  auth.logout()
}

const membershipLabel = (value?: string) =>
  value === 'pro' ? '专业版' : value === 'studio' ? '工作室版' : '免费版'
</script>

<template>
  <div v-if="auth.isLoggedIn" class="canvas-account-chrome pointer-events-auto flex items-center gap-2">
    <!-- 积分 pill：品牌暖橙点缀色（能量值），带闪电图标 -->
    <button
      type="button"
      class="canvas-points-pill neo-chrome flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition"
      title="积分与会员"
      @click="showMembership = true"
    >
      <svg class="points-coin h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.16" />
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6" />
        <path fill="currentColor" d="M12.8 6.2 8.6 12.4h2.7l-1 5.4 4.3-6.6h-2.7l.9-5z" />
      </svg>
      <span class="tabular-nums">{{ auth.user?.points ?? 0 }}</span>
      <span class="font-normal opacity-60">积分</span>
    </button>

    <div ref="menuRef" class="canvas-user-menu relative">
      <!-- 只保留头像（品牌 logo，无动画特效），点击弹出个人信息卡片 -->
      <button
        type="button"
        class="avatar-only neo-chrome flex h-9 w-9 items-center justify-center rounded-full p-0 transition"
        :title="auth.user?.nickname"
        @click.stop="menuOpen = !menuOpen"
      >
        <img :src="BRAND_LOGO_URL" alt="用户" class="h-full w-full rounded-full object-contain p-0.5" draggable="false">
      </button>
      <div
        v-if="menuOpen"
        class="neo-popover absolute right-0 top-full z-10 mt-1.5 w-[200px] overflow-hidden rounded-xl"
        @click.stop
      >
        <!-- 用户卡片头部：品牌渐变底 -->
        <div class="user-card-head px-3 py-3">
          <div class="flex items-center gap-2.5">
            <div class="avatar-badge flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full">
              <img :src="BRAND_LOGO_URL" alt="用户" class="h-full w-full object-contain p-0.5" draggable="false">
            </div>
            <div class="min-w-0">
              <p class="truncate text-[13px] font-medium text-white">{{ auth.user?.nickname }}</p>
              <p class="text-[10px] text-white/70">{{ membershipLabel(auth.user?.membership) }}</p>
            </div>
          </div>
          <button
            type="button"
            class="mt-2.5 flex w-full items-center justify-between rounded-lg bg-white/12 px-2.5 py-1.5 text-[11px] text-white transition hover:bg-white/20"
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
          <button type="button" class="neo-popover-item flex w-full px-3 py-2 text-left text-xs" @click="openProfile">
            个人资料
          </button>
          <button type="button" class="neo-popover-item flex w-full px-3 py-2 text-left text-xs" @click="logout">
            退出登录
          </button>
        </div>
      </div>
    </div>

    <MembershipModal v-model="showMembership" />
  </div>
  <button
    v-else
    type="button"
    class="canvas-account-chrome neo-chrome pointer-events-auto rounded-xl px-3 py-1.5 text-xs transition"
    @click="auth.openLogin()"
  >
    登录
  </button>
</template>

<style scoped>
.avatar-badge {
  background: var(--neo-brand-gradient);
  box-shadow: 0 2px 8px rgba(109, 93, 252, 0.4);
}

.avatar-only {
  overflow: hidden;
}

.canvas-points-pill {
  color: var(--neo-text-primary);
}

/* SVG 直接着色，不依赖 Tailwind 任意值编译 */
.points-coin {
  color: var(--neo-warm);
}

.user-card-head {
  background: var(--neo-brand-gradient);
}
</style>
