<script setup lang="ts">
import NeoBaseNode from '@/components/canvas/NeoBaseNode.vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import { resolveMediaUrl } from '@/services/api-base'
import { computed } from 'vue'

const props = defineProps<{
  id: string
  selected?: boolean
  data: { url?: string; status: string; prompt?: string; label?: string }
}>()

const editor = useCanvasEditorStore()
const displayUrl = computed(() => resolveMediaUrl(String(props.data.url ?? '')))

function openEdit() {
  if (!displayUrl.value) return
  editor.openImageEditor({
    nodeId: props.id,
    url: displayUrl.value,
    prompt: props.data.prompt,
  })
}
</script>

<template>
  <NeoBaseNode node-type="image" :selected="selected" :data="data" :status="data.status">
    <div class="neo-gen-card">
      <div v-if="data.url" class="neo-gen-preview">
        <img :src="displayUrl" alt="">
        <button
          type="button"
          class="absolute bottom-1.5 right-1.5 rounded-xl border-none bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm transition hover:bg-black/85"
          @click.stop="openEdit"
        >
          编辑
        </button>
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
          <svg class="neo-placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2.5" y="3" width="19" height="18" rx="3" />
            <circle cx="8" cy="9" r="2" />
            <path d="M21.5 15.5l-5-5L4 21" />
          </svg>
          <span class="neo-placeholder-text">
            {{ data.status === 'generating' ? '生成中...' : '等待生成' }}
          </span>
        </div>
      </div>
    </div>
  </NeoBaseNode>
</template>
