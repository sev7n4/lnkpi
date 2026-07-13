<script setup lang="ts">
import NeoBaseNode from '@/components/canvas/NeoBaseNode.vue'
import { computed } from 'vue'
import { resolveMediaUrl } from '@/services/api-base'

const props = defineProps<{
  selected?: boolean
  data: { url?: string; status: string; prompt?: string; label?: string }
}>()

const displayUrl = computed(() => resolveMediaUrl(String(props.data.url ?? '')))
</script>

<template>
  <NeoBaseNode node-type="audio" :selected="selected" :data="data" :status="data.status">
    <div class="neo-audio-card">
      <audio v-if="data.url" :src="displayUrl" controls class="w-full" />
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
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
          <span class="neo-placeholder-text">
            {{ data.status === 'generating' ? '生成中...' : '等待生成' }}
          </span>
        </div>
      </div>
      <p v-if="data.prompt" class="line-clamp-2 text-[11px] text-white/45">{{ data.prompt }}</p>
    </div>
  </NeoBaseNode>
</template>
