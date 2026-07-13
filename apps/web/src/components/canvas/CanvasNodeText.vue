<script setup lang="ts">
import NeoBaseNode from '@/components/canvas/NeoBaseNode.vue'

defineProps<{
  selected?: boolean
  data: { content: string; label?: string; status?: string }
}>()
</script>

<template>
  <NeoBaseNode node-type="text" :selected="selected" :data="data" :status="data.status">
    <div class="neo-text-card">
      <p>{{ data.content || '点击下方 Dock Studio 编辑...' }}</p>
    </div>
  </NeoBaseNode>
</template>
