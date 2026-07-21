<script setup lang="ts">
defineProps<{
  credits: number
}>()
</script>

<template>
  <span class="dock-credit-badge" :title="`预估消耗积分 ${credits}`">
    <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true" class="dock-credit-badge__bolt">
      <path d="M13 2 4.5 13.5h5.6L11 22l8.5-11.5h-5.6L13 2z" />
    </svg>
    <span>{{ credits }}</span>
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
}

.dock-credit-badge__bolt {
  color: var(--neo-warm);
  opacity: 0.9;
}
</style>
