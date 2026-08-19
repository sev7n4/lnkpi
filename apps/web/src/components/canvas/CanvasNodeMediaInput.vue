<script setup lang="ts">
import NeoBaseNode from '@/components/canvas/NeoBaseNode.vue'
import { computed } from 'vue'
import { resolveMediaUrl } from '@/services/api-base'

const props = defineProps<{
  selected?: boolean
  data: {
    url?: string
    status?: string
    fileName?: string
    label?: string
    mimeType?: string
    mediaKind?: string
  }
}>()

const mediaKind = computed(() => {
  const kind = props.data.mediaKind
  if (kind === 'video' || kind === 'audio' || kind === 'image') return kind
  const mime = props.data.mimeType ?? ''
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'image'
})

const displayUrl = computed(() => resolveMediaUrl(String(props.data.url ?? '')))
</script>

<template>
  <NeoBaseNode node-type="mediaInput" :selected="selected" :data="data" :status="data.status">
    <div class="neo-gen-card">
      <div v-if="data.url" class="neo-gen-preview">
        <video v-if="mediaKind === 'video'" :src="displayUrl" class="h-full w-full object-cover" muted playsinline />
        <div v-else-if="mediaKind === 'audio'" class="flex h-full items-center justify-center p-2">
          <audio :src="displayUrl" controls class="w-full" />
        </div>
        <img v-else :src="displayUrl" alt="">
      </div>
      <div v-else class="neo-node-placeholder">
        <div class="neo-placeholder-content">
          <svg class="neo-placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span class="neo-placeholder-text">拖入或上传素材</span>
        </div>
      </div>
      <p v-if="data.fileName" class="truncate px-1 pt-1 text-[10px] text-white/40">{{ data.fileName }}</p>
    </div>
  </NeoBaseNode>
</template>
