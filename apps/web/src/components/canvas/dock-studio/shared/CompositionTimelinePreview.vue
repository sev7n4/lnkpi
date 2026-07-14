<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CompositionTrack } from '@/utils/compositionUpstream'
import { computeTimelineLayout, totalTimelineDurationSec } from '@/utils/compositionUpstream'
import { resolveMediaUrl } from '@/services/api-base'

const props = defineProps<{
  tracks: CompositionTrack[]
  readonly?: boolean
}>()

const playhead = ref(0)

const layout = computed(() => computeTimelineLayout(props.tracks))
const totalDuration = computed(() => totalTimelineDurationSec(props.tracks))
const currentClip = computed(() => layout.value[playhead.value] ?? null)
const previewUrl = computed(() => {
  const url = currentClip.value?.url ?? ''
  return url ? resolveMediaUrl(url) : ''
})

watch(
  () => props.tracks.map((track) => track.nodeId).join(','),
  () => {
    playhead.value = 0
  },
)

function prevClip() {
  if (playhead.value > 0) playhead.value -= 1
}

function nextClip() {
  if (playhead.value < layout.value.length - 1) playhead.value += 1
}
</script>

<template>
  <div class="composition-timeline">
    <div class="composition-preview">
      <video
        v-if="currentClip?.type === 'video' && previewUrl"
        :key="previewUrl"
        :src="previewUrl"
        class="h-full w-full object-contain"
        controls
        muted
      />
      <audio
        v-else-if="currentClip?.type === 'audio' && previewUrl"
        :key="previewUrl"
        :src="previewUrl"
        class="w-full px-3"
        controls
      />
      <div v-else class="composition-preview-empty">
        {{ tracks.length ? '当前片段暂无可用媒体' : '连接 video / audio 后在此预览' }}
      </div>
    </div>

    <div class="composition-playhead-bar">
      <button type="button" class="timeline-btn" :disabled="readonly || playhead <= 0" @click="prevClip">
        上一段
      </button>
      <span class="text-[10px] text-white/50">
        {{ layout.length ? playhead + 1 : 0 }} / {{ layout.length }} · 总长 ~{{ totalDuration }}s
      </span>
      <button
        type="button"
        class="timeline-btn"
        :disabled="readonly || playhead >= layout.length - 1"
        @click="nextClip"
      >
        下一段
      </button>
    </div>

    <div class="composition-timeline-rail">
      <button
        v-for="(clip, index) in layout"
        :key="clip.nodeId"
        type="button"
        class="timeline-clip"
        :class="{ 'is-active': index === playhead, [clip.type]: true }"
        :disabled="readonly"
        @click="playhead = index"
      >
        <span class="timeline-clip-label">{{ clip.label }}</span>
        <span class="timeline-clip-title">{{ clip.title }}</span>
        <span class="timeline-clip-meta">{{ clip.durationSec }}s</span>
      </button>
      <p v-if="!layout.length" class="timeline-empty">时间轴为空</p>
    </div>
  </div>
</template>

<style scoped>
.composition-timeline {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
}

.composition-preview {
  min-height: 120px;
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.35);
}

.composition-preview-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  padding: 12px;
  text-align: center;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
}

.composition-playhead-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.timeline-btn {
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  padding: 4px 10px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.75);
}

.timeline-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.composition-timeline-rail {
  display: flex;
  gap: 8px;
  min-height: 72px;
  overflow-x: auto;
  padding: 8px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
}

.timeline-clip {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 108px;
  flex-shrink: 0;
  padding: 8px;
  border-radius: 10px;
  border: 2px solid transparent;
  text-align: left;
  background: rgba(0, 0, 0, 0.22);
}

.timeline-clip.is-active {
  border-color: rgba(99, 102, 241, 0.65);
}

.timeline-clip.video {
  box-shadow: inset 0 0 0 1px rgba(99, 102, 241, 0.15);
}

.timeline-clip.audio {
  box-shadow: inset 0 0 0 1px rgba(16, 185, 129, 0.15);
}

.timeline-clip-label {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.45);
}

.timeline-clip-title {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.85);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timeline-clip-meta {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
}

.timeline-empty {
  display: flex;
  align-items: center;
  padding: 0 8px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
}
</style>
