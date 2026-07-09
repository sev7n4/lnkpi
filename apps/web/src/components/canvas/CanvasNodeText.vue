<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'

defineProps<{
  data: { content: string }
}>()
</script>

<template>
  <div class="w-56 rounded-xl border border-white/10 bg-surface-card p-3 shadow-lg">
    <Handle type="target" :position="Position.Left" class="!bg-brand-500" />
    <div class="mb-2 flex items-center gap-2">
      <span class="rounded bg-blue-600/30 px-2 py-0.5 text-[10px] text-blue-300">文本</span>
    </div>
    <p class="text-xs leading-relaxed text-white/70">{{ data.content }}</p>
    <Handle type="source" :position="Position.Right" class="!bg-brand-500" />
  </div>
</template>
