<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'

defineProps<{
  data: { title?: string; prompt?: string; status?: string; coverUrl?: string }
}>()
</script>

<template>
  <div class="w-80 rounded-xl border border-brand-500/40 bg-surface-card shadow-lg shadow-brand-500/10">
    <Handle type="target" :position="Position.Left" class="!bg-brand-500" />
    <div class="border-b border-white/5 p-3">
      <div class="mb-1 flex items-center gap-2">
        <span class="rounded bg-brand-600/30 px-2 py-0.5 text-[10px] text-brand-300">分镜</span>
        <span
          v-if="data.status"
          class="rounded px-1.5 py-0.5 text-[10px]"
          :class="{
            'bg-yellow-600/20 text-yellow-400': data.status === 'generating',
            'bg-green-600/20 text-green-400': data.status === 'generated',
            'bg-white/5 text-white/40': data.status === 'draft',
          }"
        >
          {{ data.status === 'generating' ? '生成中' : data.status === 'generated' ? '已完成' : '草稿' }}
        </span>
      </div>
      <h4 class="text-sm font-medium">{{ data.title || '未命名分镜' }}</h4>
      <p v-if="data.prompt" class="mt-1 line-clamp-2 text-xs text-white/50">{{ data.prompt }}</p>
    </div>
    <div v-if="data.coverUrl" class="aspect-video overflow-hidden">
      <img :src="data.coverUrl" class="h-full w-full object-cover" />
    </div>
    <div v-else class="flex aspect-video items-center justify-center bg-surface-elevated text-xs text-white/20">
      等待生成素材
    </div>
    <Handle type="source" :position="Position.Right" class="!bg-brand-500" />
  </div>
</template>
