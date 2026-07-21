<script setup lang="ts">
defineProps<{
  edgeId: string | null
  x: number
  y: number
}>()

const emit = defineEmits<{
  delete: [edgeId: string]
}>()
</script>

<template>
  <button
    v-if="edgeId"
    type="button"
    class="edge-scissors neo-chrome pointer-events-auto absolute z-[45] flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full transition hover:!border-red-400/40 hover:!bg-red-500/20 hover:!text-red-400"
    :style="{ left: `${x}px`, top: `${y}px` }"
    title="删除连线"
    @click.stop="emit('delete', edgeId)"
  >
    <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <circle cx="6" cy="6" r="3" stroke-width="2" />
      <circle cx="6" cy="18" r="3" stroke-width="2" />
      <path stroke-linecap="round" stroke-width="2" d="M8.5 8.5l7 7M15.5 8.5l-7 7" />
    </svg>
  </button>
</template>
