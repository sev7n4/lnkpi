<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import StudioShell from '@/components/studio/StudioShell.vue'
import { studioApi, type GenerationRecord } from '@/services/studio-api'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const videos = ref<GenerationRecord[]>([])
const selectedIds = ref<string[]>([])
const playhead = ref(0)

const timelineClips = computed(() =>
  videos.value.filter((v) => selectedIds.value.includes(v.id) && v.status === 'completed'),
)

async function loadVideos() {
  if (!auth.isLoggedIn) return
  const { data } = await studioApi.listGenerations('video')
  videos.value = data.data.filter((v) => v.status === 'completed')
  selectedIds.value = videos.value.slice(0, 3).map((v) => v.id)
}

function toggleClip(id: string) {
  if (selectedIds.value.includes(id)) {
    selectedIds.value = selectedIds.value.filter((x) => x !== id)
  } else {
    selectedIds.value.push(id)
  }
}

onMounted(loadVideos)
</script>

<template>
  <StudioShell>
    <h1 class="mb-2 text-2xl font-semibold">视频编辑器</h1>
    <p class="mb-6 text-sm text-white/50">将视频工作室素材拖入时间轴进行简易剪辑（MVP）</p>

    <div class="mb-6 aspect-video overflow-hidden rounded-2xl border border-white/8 bg-[#0a0a0a]">
      <img
        v-if="timelineClips[playhead]?.url"
        :src="timelineClips[playhead]!.url!"
        class="h-full w-full object-contain"
        alt=""
      />
      <div v-else class="flex h-full items-center justify-center text-white/30">预览区 — 请添加片段</div>
    </div>

    <div class="mb-4 flex items-center gap-2">
      <button class="btn-ghost text-xs" :disabled="playhead <= 0" @click="playhead--">上一片段</button>
      <span class="text-xs text-white/50">{{ playhead + 1 }} / {{ timelineClips.length || 0 }}</span>
      <button class="btn-ghost text-xs" :disabled="playhead >= timelineClips.length - 1" @click="playhead++">下一片段</button>
    </div>

    <div class="mb-2 text-xs text-white/40">时间轴</div>
    <div class="mb-8 flex min-h-[80px] gap-2 overflow-x-auto rounded-xl border border-white/8 bg-[#1a1a1a] p-3">
      <div
        v-for="(clip, idx) in timelineClips"
        :key="clip.id"
        class="w-32 shrink-0 cursor-pointer overflow-hidden rounded-lg border-2 transition"
        :class="idx === playhead ? 'border-[#6366f1]' : 'border-transparent'"
        @click="playhead = idx"
      >
        <img v-if="clip.url" :src="clip.url" class="aspect-video object-cover" alt="" />
      </div>
      <p v-if="!timelineClips.length" class="flex items-center px-4 text-sm text-white/30">暂无片段</p>
    </div>

    <h2 class="mb-3 text-sm font-medium text-white/60">素材库（视频工作室）</h2>
    <div class="grid grid-cols-3 gap-3 md:grid-cols-4 lg:grid-cols-6">
      <button
        v-for="v in videos"
        :key="v.id"
        type="button"
        class="overflow-hidden rounded-lg border transition"
        :class="selectedIds.includes(v.id) ? 'border-[#6366f1]' : 'border-white/10 opacity-60 hover:opacity-100'"
        @click="toggleClip(v.id)"
      >
        <img v-if="v.url" :src="v.url" class="aspect-video object-cover" alt="" />
      </button>
    </div>
  </StudioShell>
</template>
