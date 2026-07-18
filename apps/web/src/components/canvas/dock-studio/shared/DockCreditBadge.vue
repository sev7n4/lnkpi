<script setup lang="ts">
defineProps<{
  credits: number
}>()
</script>

<template>
  <span class="dock-credit-badge" :title="`预估消耗积分 ${credits}`">
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10" />
      <path d="M9.5 9.5c.5-1 1.5-1.5 2.5-1.5s2 .6 2 1.75c0 2.25-4.5 1.25-4.5 3.5 0 1.1 1 1.75 2.5 1.75s1.9-.4 2.4-1.25" />
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
  color: rgba(255, 255, 255, 0.45);
  user-select: none;
}
</style>
