<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'

const emit = defineEmits<{
  click: []
}>()

const auth = useAuthStore()
</script>

<template>
  <button
    type="button"
    class="account-points-pill neo-chrome flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition"
    title="积分与会员"
    @click="emit('click')"
  >
    <svg class="points-coin h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.16" />
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6" />
      <path fill="currentColor" d="M12.8 6.2 8.6 12.4h2.7l-1 5.4 4.3-6.6h-2.7l.9-5z" />
    </svg>
    <span class="tabular-nums">{{ auth.user?.points ?? 0 }}</span>
    <span class="font-normal opacity-60">积分</span>
  </button>
</template>

<style scoped>
.account-points-pill {
  color: var(--neo-text-primary);
}

.points-coin {
  color: var(--neo-warm);
}
</style>
