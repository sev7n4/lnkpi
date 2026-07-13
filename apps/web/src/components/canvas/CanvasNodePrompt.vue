<script setup lang="ts">
import NeoBaseNode from '@/components/canvas/NeoBaseNode.vue'

defineProps<{
  selected?: boolean
  data: { prompt: string; status?: string; label?: string }
}>()
</script>

<template>
  <NeoBaseNode node-type="prompt" :selected="selected" :data="data" :status="data.status">
    <div class="neo-text-card">
      <p>{{ data.prompt || '点击下方 Dock Studio 编辑...' }}</p>
    </div>
  </NeoBaseNode>
</template>
