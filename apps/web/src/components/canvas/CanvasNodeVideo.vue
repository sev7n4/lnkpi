<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'

defineProps<{
  data: { url?: string; status: string; duration?: number }
}>()
</script>

<template>
  <div class="w-72 rounded-xl border border-white/10 bg-surface-card p-3 shadow-lg">
    <Handle type="target" :position="Position.Left" class="!bg-brand-500" />
    <div class="mb-2 flex items-center gap-2">
      <span class="rounded bg-orange-600/30 px-2 py-0.5 text-[10px] text-orange-300">视频</span>
      <span v-if="data.duration" class="text-[10px] text-white/30">{{ data.duration }}s</span>
    </div>
    <div class="aspect-video overflow-hidden rounded-lg bg-surface-elevated">
      <video v-if="data.url" :src="data.url" class="h-full w-full object-cover" controls />
      <div v-else class="flex h-full items-center justify-center text-xs text-white/30">
        {{ data.status === 'generating' ? '视频生成中...' : '等待生成' }}
      </div>
    </div>
    <Handle type="source" :position="Position.Right" class="!bg-brand-500" />
  </div>
</template>
