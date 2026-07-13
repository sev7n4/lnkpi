<script setup lang="ts">
import { computed, ref } from 'vue'

export interface CanvasAssetItem {
  id: string
  nodeId: string
  url: string
  label: string
  kind: 'image' | 'video' | 'audio' | 'other'
}

const props = defineProps<{
  assets: CanvasAssetItem[]
}>()

const emit = defineEmits<{
  apply: [asset: CanvasAssetItem]
  upload: []
}>()

const expanded = ref(true)
const search = ref('')

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.assets
  return props.assets.filter((a) => a.label.toLowerCase().includes(q) || a.kind.includes(q))
})

function onDragStart(event: DragEvent, asset: CanvasAssetItem) {
  event.dataTransfer?.setData('application/lnkpi-asset', JSON.stringify(asset))
  event.dataTransfer?.setData('text/plain', asset.url)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
}

function kindLabel(kind: string) {
  const map: Record<string, string> = {
    image: '图片',
    video: '视频',
    audio: '音频',
  }
  return map[kind] ?? '媒体'
}
</script>

<template>
  <div
    class="canvas-asset-panel pointer-events-none absolute left-3 z-[48] flex max-h-[min(420px,55vh)] flex-col"
    :class="expanded ? 'w-[220px]' : 'w-auto'"
    style="top: 56px"
  >
    <div class="pointer-events-auto flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[rgba(22,22,22,0.94)] shadow-xl backdrop-blur-xl">
      <div class="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <button
          type="button"
          class="flex flex-1 items-center gap-2 text-left text-xs font-medium text-white/80"
          @click="expanded = !expanded"
        >
          <svg class="h-3.5 w-3.5 text-[#818cf8]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          素材库
          <span class="text-[10px] font-normal text-white/35">{{ assets.length }}</span>
        </button>
        <button
          type="button"
          class="rounded-lg px-2 py-1 text-[10px] text-[#818cf8] hover:bg-white/5"
          title="上传素材"
          @click="emit('upload')"
        >
          上传
        </button>
      </div>

      <template v-if="expanded">
        <div class="px-2 pt-2">
          <input
            v-model="search"
            class="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] outline-none focus:border-[#6366f1]/40"
            placeholder="搜索素材..."
          >
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto p-2 space-y-1.5">
          <p v-if="!filtered.length" class="px-1 py-4 text-center text-[11px] text-white/30">
            拖入图片/视频或从节点生成后出现在此
          </p>
          <button
            v-for="asset in filtered"
            :key="asset.id"
            type="button"
            draggable="true"
            class="flex w-full items-center gap-2 rounded-lg border border-transparent p-1.5 text-left transition hover:border-white/10 hover:bg-white/[0.04]"
            @dragstart="onDragStart($event, asset)"
            @click="emit('apply', asset)"
          >
            <div class="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-white/5">
              <img v-if="asset.kind === 'image'" :src="asset.url" alt="" class="h-full w-full object-cover">
              <div v-else class="flex h-full w-full items-center justify-center text-[9px] text-white/40">
                {{ kindLabel(asset.kind) }}
              </div>
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-[11px] text-white/75">{{ asset.label }}</p>
              <p class="text-[9px] text-white/30">{{ kindLabel(asset.kind) }}</p>
            </div>
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
