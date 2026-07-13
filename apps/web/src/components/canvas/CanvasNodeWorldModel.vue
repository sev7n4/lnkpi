<script setup lang="ts">
import NeoBaseNode from '@/components/canvas/NeoBaseNode.vue'

defineProps<{
  selected?: boolean
  data: { title?: string; status?: string; prompt?: string; label?: string }
}>()
</script>

<template>
  <NeoBaseNode node-type="worldModel" :selected="selected" :data="data" :status="data.status">
    <div class="neo-gen-card">
      <div class="neo-node-placeholder">
        <div class="neo-placeholder-content">
          <svg class="neo-placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="9" />
            <ellipse cx="12" cy="12" rx="9" ry="3" />
            <path d="M12 3a15 15 0 0 0 0 18" />
            <path d="M12 3a15 15 0 0 1 0 18" />
          </svg>
          <span class="neo-placeholder-text">{{ data.title || '3D 世界' }}</span>
          <span v-if="data.prompt" class="line-clamp-2 max-w-[220px] text-[11px] text-white/40">{{ data.prompt }}</span>
        </div>
      </div>
    </div>
  </NeoBaseNode>
</template>
