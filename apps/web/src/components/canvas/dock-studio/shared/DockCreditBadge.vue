<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  credits: number
}>()

/** 0 = 免费工具（裁剪 / 抠图 / 标注等纯本地处理）。 */
const isFree = computed(() => props.credits <= 0)
</script>

<template>
  <span v-if="isFree" class="dock-credit-badge dock-credit-badge--free" title="免费，不消耗积分">
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
    <span>免费</span>
  </span>
  <span v-else class="dock-credit-badge" :title="`预估消耗积分 ${credits}`">
    <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true" class="dock-credit-badge__bolt">
      <path d="M13 2 4.5 13.5h5.6L11 22l8.5-11.5h-5.6L13 2z" />
    </svg>
    <span>{{ credits }}积分</span>
  </span>
</template>

<style scoped>
.dock-credit-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  line-height: 1;
  color: var(--neo-text-muted);
  user-select: none;
  white-space: nowrap;
}

.dock-credit-badge__bolt {
  color: var(--neo-warm);
  opacity: 0.9;
}

.dock-credit-badge--free {
  color: var(--neo-text-muted);
  opacity: 0.9;
}
.dock-credit-badge--free svg {
  color: var(--neo-ok, #4ade80);
}
</style>
