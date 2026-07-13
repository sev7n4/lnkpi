<script setup lang="ts">
import NeoBaseNode from '@/components/canvas/NeoBaseNode.vue'

defineProps<{
  selected?: boolean
  data: { title?: string; status?: string; clipCount?: number; label?: string }
}>()
</script>

<template>
  <NeoBaseNode
    node-type="videoComposition"
    :selected="selected"
    :data="data"
    :status="data.status"
    :height="200"
  >
    <div class="neo-gen-card">
      <div class="neo-node-placeholder">
        <div class="neo-placeholder-content">
          <svg class="neo-placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          <span class="neo-placeholder-text">{{ data.title || '多轨合成' }}</span>
          <span class="text-[11px] text-white/40">{{ data.clipCount ?? 0 }} 个片段</span>
        </div>
      </div>
    </div>
  </NeoBaseNode>
</template>
