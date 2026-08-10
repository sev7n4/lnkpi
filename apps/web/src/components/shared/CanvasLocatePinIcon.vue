<script setup lang="ts">
/** 画布节点定位（跳转/聚焦）— 与引用到 Agent 的 CanvasRefTargetIcon 区分 */
withDefaults(
  defineProps<{
    size?: number
    /** 列表行内等小尺寸场景 */
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
    <path
      d="M12 21.5s-6.5-4.74-6.5-11.5a6.5 6.5 0 1 1 13 0c0 6.76-6.5 11.5-6.5 11.5z"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linejoin="round"
      :fill="filled ? 'currentColor' : 'none'"
      :opacity="filled ? 0.18 : 1"
    />
    <circle
      cx="12"
      cy="10"
      r="2.25"
      :fill="filled ? 'currentColor' : 'currentColor'"
      stroke="none"
    />
  </svg>
</template>
