<script setup lang="ts">
import NeoBaseNode from '@/components/canvas/NeoBaseNode.vue'
import { computed } from 'vue'
import { resolveMediaUrl } from '@/services/api-base'

const props = defineProps<{
  selected?: boolean
  data: { url?: string; status: string; duration?: number; label?: string }
}>()

const displayUrl = computed(() => resolveMediaUrl(String(props.data.url ?? '')))
</script>

<template>
  <NeoBaseNode node-type="video" :selected="selected" :data="data" :status="data.status">
    <div class="neo-gen-card">
      <div v-if="data.url" class="neo-gen-preview">
        <video :src="displayUrl" controls />
      </div>
      <div
        v-else
        class="neo-node-placeholder"
        :class="{
          'is-generating': data.status === 'generating',
          'is-failed': data.status === 'failed' || data.status === 'error',
        }"
      >
        <div class="neo-placeholder-content">
          <svg class="neo-placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
          <span class="neo-placeholder-text">
            {{ data.status === 'generating' ? '视频生成中...' : '等待生成' }}
          </span>
          <span v-if="data.duration" class="text-[11px] text-white/35">{{ data.duration }}s</span>
        </div>
      </div>
    </div>
  </NeoBaseNode>
</template>
