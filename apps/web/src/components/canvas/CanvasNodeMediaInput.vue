<script setup lang="ts">
import NeoBaseNode from '@/components/canvas/NeoBaseNode.vue'
import MaskEditor from '@/components/canvas/refine/MaskEditor.vue'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { resolveMediaUrl } from '@/services/api-base'
import { useCanvasEditorStore } from '@/stores/canvasEditor'

const props = defineProps<{
  id: string
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

const editor = useCanvasEditorStore()
const maskRef = ref<InstanceType<typeof MaskEditor> | null>(null)

const mediaKind = computed(() => {
  const kind = props.data.mediaKind
  if (kind === 'video' || kind === 'audio' || kind === 'image') return kind
  const mime = props.data.mimeType ?? ''
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'image'
})

const displayUrl = computed(() => resolveMediaUrl(String(props.data.url ?? '')))
const refiningThisNode = computed(
  () => mediaKind.value === 'image' && editor.imageTarget?.nodeId === props.id,
)

watch(
  [refiningThisNode, maskRef],
  async () => {
    await nextTick()
    if (!refiningThisNode.value || !maskRef.value) return
    editor.registerRefineMask({
      exportPng: () => maskRef.value!.exportPng(),
      clear: () => maskRef.value!.clear(),
      getCanvas: () => maskRef.value!.getCanvas(),
    })
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (editor.imageTarget?.nodeId === props.id) editor.registerRefineMask(null)
})
</script>

<template>
  <NeoBaseNode node-type="mediaInput" :selected="selected" :data="data" :status="data.status">
    <div class="neo-gen-card">
      <div v-if="data.url" class="neo-gen-preview">
        <video v-if="mediaKind === 'video'" :src="displayUrl" class="h-full w-full object-cover" muted playsinline />
        <div v-else-if="mediaKind === 'audio'" class="flex h-full items-center justify-center p-2">
          <audio :src="displayUrl" controls class="w-full" />
        </div>
        <template v-else>
          <img :src="displayUrl" alt="">
          <MaskEditor
            v-if="refiningThisNode"
            ref="maskRef"
            surface="node"
            :url="displayUrl"
            :tool="editor.refineTool"
            :brush-size="editor.refineBrushSize"
            :disabled="editor.refineBusy"
            @coverage="(p) => { editor.refineCoverage = p.ratio }"
          />
        </template>
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
