<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import type { UpstreamNodeContext } from '@/composables/useUpstreamNodeContext'
import type { CompositionTrack } from '@/utils/compositionUpstream'
import DockToolbarShell from '@/components/canvas/dock-studio/shared/DockToolbarShell.vue'
import { isNodeGenerating } from '@/constants/dockStudio'

const props = defineProps<{
  node: EditableFlowNode
  upstream: UpstreamNodeContext
  tracks: CompositionTrack[]
  generating?: boolean
  readonly?: boolean
}>()

const emit = defineEmits<{
  patch: [patch: Record<string, unknown>]
  close: []
}>()

const title = ref('')

const locked = computed(
  () => !!props.readonly || isNodeGenerating(props.node.data?.status) || !!props.generating,
)

const videoTrackCount = computed(() => props.tracks.filter((track) => track.type === 'video').length)
const audioTrackCount = computed(() => props.tracks.filter((track) => track.type === 'audio').length)

function syncFromNode() {
  title.value = String(props.node.data?.title ?? '视频合成')
}

watch(() => props.node, syncFromNode, { immediate: true, deep: true })

function onTitleInput(value: string) {
  title.value = value
  emit('patch', { title: value })
}
</script>

<template>
  <DockToolbarShell
    type-label="视频合成"
    show-title
    :title="title"
    title-placeholder="合成项目名"
    :readonly="locked"
    @update:title="onTitleInput"
    @close="emit('close')"
  >
    <div class="mb-2 flex flex-wrap items-center gap-2 px-1 text-[10px] text-white/45">
      <span>{{ tracks.length }} 轨</span>
      <span>视频 {{ videoTrackCount }}</span>
      <span>音频 {{ audioTrackCount }}</span>
      <span v-if="!tracks.length" class="text-amber-300/80">请连接 video / audio 节点到本节点</span>
    </div>

    <div class="composition-track-list">
      <div v-if="!tracks.length" class="composition-empty">
        <p>暂无入边素材</p>
        <p class="text-white/35">从画布将视频或音频节点连线到「视频合成」节点</p>
      </div>
      <div v-for="(track, index) in tracks" :key="track.nodeId" class="composition-track-row">
        <span class="composition-track-index">{{ index + 1 }}</span>
        <span class="composition-track-type" :class="track.type">{{ track.label }}</span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-[11px] text-white/80">{{ track.title }}</p>
          <p class="truncate text-[10px] text-white/35">{{ track.url || '尚无媒体 URL' }}</p>
        </div>
      </div>
    </div>

    <div class="composition-timeline-placeholder">
      <span>时间轴预览</span>
      <span class="text-white/35">（C-3 开发中）</span>
    </div>

    <div class="bottom-toolbar-actions flex-wrap">
      <button
        type="button"
        class="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/40"
        disabled
        title="C-4 合成/export API 开发中"
      >
        导出合成（即将推出）
      </button>
    </div>
  </DockToolbarShell>
</template>

<style scoped>
.composition-track-list {
  max-height: 160px;
  margin-bottom: 8px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 4px;
}

.composition-empty {
  padding: 16px 12px;
  border-radius: 12px;
  border: 1px dashed rgba(255, 255, 255, 0.12);
  text-align: center;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
}

.composition-track-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.18);
}

.composition-track-index {
  width: 18px;
  text-align: center;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
}

.composition-track-type {
  flex-shrink: 0;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 10px;
}

.composition-track-type.video {
  background: rgba(99, 102, 241, 0.2);
  color: #a5b4fc;
}

.composition-track-type.audio {
  background: rgba(16, 185, 129, 0.18);
  color: #6ee7b7;
}

.composition-timeline-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 52px;
  margin-bottom: 4px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
}
</style>
