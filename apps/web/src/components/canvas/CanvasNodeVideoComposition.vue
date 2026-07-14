<script setup lang="ts">
import { computed } from 'vue'
import NeoBaseNode from '@/components/canvas/NeoBaseNode.vue'

const props = defineProps<{
  selected?: boolean
  data: {
    title?: string
    status?: string
    clipCount?: number
    tracks?: Array<{ type?: string }>
    label?: string
  }
}>()

const videoCount = computed(
  () => props.data.tracks?.filter((track) => track.type === 'video').length ?? 0,
)
const audioCount = computed(
  () => props.data.tracks?.filter((track) => track.type === 'audio').length ?? 0,
)
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
          <span class="text-[11px] text-indigo-200/70">
            {{ data.clipCount ?? 0 }} 轨 · 视频 {{ videoCount }} · 音频 {{ audioCount }}
          </span>
        </div>
      </div>
    </div>
  </NeoBaseNode>
</template>
