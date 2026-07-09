<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'

defineProps<{
  data: { prompt: string }
}>()
</script>

<template>
  <div class="w-72 rounded-xl border border-brand-500/30 bg-surface-card p-4 shadow-lg shadow-brand-500/10">
    <Handle type="target" :position="Position.Left" class="!bg-brand-500" />
    <div class="mb-2 flex items-center gap-2">
      <span class="rounded bg-brand-600/30 px-2 py-0.5 text-[10px] text-brand-300">提示词</span>
    </div>
    <textarea
      :value="data.prompt"
      class="w-full resize-none rounded-lg border border-white/10 bg-white/5 p-2 text-xs text-white/80 outline-none"
      rows="4"
      placeholder="输入 AI 生成提示词..."
      @input="data.prompt = ($event.target as HTMLTextAreaElement).value"
    />
    <button class="btn-primary mt-3 w-full text-xs">生成</button>
    <Handle type="source" :position="Position.Right" class="!bg-brand-500" />
  </div>
</template>
