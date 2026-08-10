<script setup lang="ts">
/** 画布引用靶心箭 — Agent dock 🎯 与节点标题栏快捷入口共用 */
withDefaults(
  defineProps<{
    size?: number
    /** Pick 模式激活 / 按钮 is-active 时为 true */
    filled?: boolean
  }>(),
  { size: 16, filled: false },
)
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <!-- 靶环 -->
    <circle
      cx="12"
      cy="12"
      r="8.5"
      stroke="currentColor"
      stroke-width="1.75"
      :fill="filled ? 'currentColor' : 'none'"
      :opacity="filled ? 0.12 : 1"
    />
    <circle
      cx="12"
      cy="12"
      r="4.5"
      stroke="currentColor"
      stroke-width="1.75"
      :fill="filled ? 'currentColor' : 'none'"
      :opacity="filled ? 0.22 : 1"
    />
    <circle
      cx="12"
      cy="12"
      r="1.5"
      fill="currentColor"
      stroke="none"
    />
    <!-- 箭矢（右上 → 靶心） -->
    <path
      d="M19.5 4.5 L12.8 11.2"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
    />
    <path
      d="M19.5 4.5 L19.5 7.8 L16.2 4.5 Z"
      :fill="filled ? 'currentColor' : 'none'"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linejoin="round"
    />
    <!-- 箭羽 -->
    <path
      d="M19.5 4.5 L17.6 6.4 M19.5 4.5 L21.4 6.4"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
    />
  </svg>
</template>
