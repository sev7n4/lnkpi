<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import type { UpstreamNodeContext } from '@/composables/useUpstreamNodeContext'
import type { CompositionTrack, CompositionTrackRecord } from '@/utils/compositionUpstream'
import {
  applyTrackOrder,
  compositionTracksToNodePatch,
  reorderTrackIds,
} from '@/utils/compositionUpstream'
import DockToolbarShell from '@/components/canvas/dock-studio/shared/DockToolbarShell.vue'
import CompositionTimelinePreview from '@/components/canvas/dock-studio/shared/CompositionTimelinePreview.vue'
import { isNodeGenerating } from '@/constants/dockStudio'
import { resolveMediaUrl } from '@/services/api-base'

const props = defineProps<{
  node: EditableFlowNode
  upstream: UpstreamNodeContext
  tracks: CompositionTrack[]
  generating?: boolean
  readonly?: boolean
}>()

const emit = defineEmits<{
  patch: [patch: Record<string, unknown>]
  export: []
  close: []
}>()

const title = ref('')

const locked = computed(
  () => !!props.readonly || isNodeGenerating(props.node.data?.status) || !!props.generating,
)

const orderedTracks = computed(() => {
  const trackOrder = props.node.data?.trackOrder as string[] | undefined
  return applyTrackOrder(props.tracks, trackOrder)
})

const videoTrackCount = computed(() => orderedTracks.value.filter((track) => track.type === 'video').length)
const audioTrackCount = computed(() => orderedTracks.value.filter((track) => track.type === 'audio').length)
const exportableTrackCount = computed(() => orderedTracks.value.filter((track) => track.url.trim()).length)
const exportedUrl = computed(() => {
  const url = String(props.node.data?.url ?? '').trim()
  return url ? resolveMediaUrl(url) : ''
})
const canExport = computed(() => !locked.value && exportableTrackCount.value > 0)

function syncFromNode() {
  title.value = String(props.node.data?.title ?? '视频合成')
}

watch(() => props.node, syncFromNode, { immediate: true, deep: true })

function onTitleInput(value: string) {
  title.value = value
  emit('patch', { title: value })
}

function moveTrack(index: number, delta: number) {
  const ids = orderedTracks.value.map((track) => track.nodeId)
  const nextOrder = reorderTrackIds(ids, index, index + delta)
  emit('patch', compositionTracksToNodePatch(applyTrackOrder(props.tracks, nextOrder)))
}

function updateDuration(index: number, value: string) {
  const sec = Number.parseFloat(value)
  if (!Number.isFinite(sec) || sec <= 0) return
  const tracks = orderedTracks.value.map((track, trackIndex) =>
    trackIndex === index ? { ...track, durationSec: sec } : track,
  )
  emit('patch', compositionTracksToNodePatch(tracks))
}

function readSavedTracks(): CompositionTrackRecord[] {
  const raw = props.node.data?.tracks
  return Array.isArray(raw) ? (raw as CompositionTrackRecord[]) : []
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
      <span>{{ orderedTracks.length }} 轨</span>
      <span>视频 {{ videoTrackCount }}</span>
      <span>音频 {{ audioTrackCount }}</span>
      <span v-if="readSavedTracks().length" class="text-emerald-300/70">已持久化 {{ readSavedTracks().length }} 轨</span>
      <span v-if="!orderedTracks.length" class="text-amber-300/80">请连接 video / audio / 媒体输入 节点</span>
    </div>

    <CompositionTimelinePreview :tracks="orderedTracks" :readonly="locked" />

    <div v-if="exportedUrl" class="export-preview">
      <p class="mb-2 text-[10px] text-emerald-300/80">已导出合成视频</p>
      <video :src="exportedUrl" class="w-full rounded-lg" controls />
    </div>

    <div class="composition-track-list">
      <div v-if="!orderedTracks.length" class="composition-empty">
        <p>暂无入边素材</p>
        <p class="text-white/35">支持 video、audio、媒体输入（视频/音频）连线</p>
      </div>
      <div v-for="(track, index) in orderedTracks" :key="track.nodeId" class="composition-track-row">
        <span class="composition-track-index">{{ index + 1 }}</span>
        <span class="composition-track-type" :class="track.type">{{ track.label }}</span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-[11px] text-white/80">{{ track.title }}</p>
          <p class="truncate text-[10px] text-white/35">{{ track.url || '尚无媒体 URL' }}</p>
        </div>
        <label class="duration-input">
          <span class="text-[10px] text-white/35">时长</span>
          <input
            type="number"
            min="1"
            step="0.5"
            class="input-field w-14 px-2 py-1 text-[10px]"
            :value="track.durationSec"
            :readonly="locked"
            @change="updateDuration(index, ($event.target as HTMLInputElement).value)"
          >
        </label>
        <div class="flex flex-col gap-1">
          <button
            type="button"
            class="order-btn"
            :disabled="locked || index === 0"
            title="上移"
            @click="moveTrack(index, -1)"
          >
            ↑
          </button>
          <button
            type="button"
            class="order-btn"
            :disabled="locked || index === orderedTracks.length - 1"
            title="下移"
            @click="moveTrack(index, 1)"
          >
            ↓
          </button>
        </div>
      </div>
    </div>

    <div class="bottom-toolbar-actions flex-wrap">
      <button
        type="button"
        class="rounded-lg border border-indigo-400/30 bg-indigo-500/15 px-3 py-1.5 text-xs text-indigo-100"
        :disabled="!canExport"
        :title="exportableTrackCount ? '使用 ffmpeg 合成并导出 MP4' : '请先连接带 URL 的素材轨'"
        @click="emit('export')"
      >
        {{ generating ? '合成中…' : '导出合成' }}
      </button>
      <a
        v-if="exportedUrl"
        :href="exportedUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70"
      >
        下载 MP4
      </a>
    </div>
  </DockToolbarShell>
</template>

<style scoped>
.export-preview {
  margin-bottom: 8px;
  padding: 8px;
  border-radius: 12px;
  border: 1px solid rgba(16, 185, 129, 0.2);
  background: rgba(16, 185, 129, 0.06);
}

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

.duration-input {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.order-btn {
  width: 22px;
  height: 18px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  font-size: 10px;
  color: rgba(255, 255, 255, 0.7);
}

.order-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
</style>
