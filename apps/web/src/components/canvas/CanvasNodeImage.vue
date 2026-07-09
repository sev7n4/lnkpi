<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'

defineProps<{
  data: { url?: string; status: string }
}>()
</script>

<template>
  <div class="w-64 rounded-xl border border-white/10 bg-surface-card p-3 shadow-lg">
    <Handle type="target" :position="Position.Left" class="!bg-brand-500" />
    <div class="mb-2 flex items-center gap-2">
      <span class="rounded bg-emerald-600/30 px-2 py-0.5 text-[10px] text-emerald-300">图像</span>
    </div>
    <div class="aspect-square overflow-hidden rounded-lg bg-surface-elevated">
      <img v-if="data.url" :src="data.url" class="h-full w-full object-cover" />
      <div v-else class="flex h-full items-center justify-center text-xs text-white/30">
        {{ data.status === 'generating' ? '生成中...' : '等待生成' }}
      </div>
    </div>
    <Handle type="source" :position="Position.Right" class="!bg-brand-500" />
  </div>
</template>
