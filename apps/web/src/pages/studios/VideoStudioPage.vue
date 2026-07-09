<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import StudioShell from '@/components/studio/StudioShell.vue'
import ModelSelector from '@/components/canvas/ModelSelector.vue'
import { studioApi, type GenerationRecord } from '@/services/studio-api'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const prompt = ref('')
const model = ref('kling-v1')
const duration = ref(5)
const loading = ref(false)
const records = ref<GenerationRecord[]>([])
const error = ref('')
let pollTimer: ReturnType<typeof setInterval> | null = null

async function loadRecords() {
  if (!auth.isLoggedIn) return
  const { data } = await studioApi.listGenerations('video')
  records.value = data.data
}

async function generate() {
  if (!prompt.value.trim()) return
  if (!auth.isLoggedIn) { auth.openLogin(); return }
  loading.value = true
  error.value = ''
  try {
    await studioApi.generateVideo(prompt.value, model.value, duration.value)
    prompt.value = ''
    await loadRecords()
    startPoll()
  } catch {
    error.value = '生成失败或积分不足'
  } finally {
    loading.value = false
  }
}

function startPoll() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = setInterval(async () => {
    await loadRecords()
    if (!records.value.some((r) => r.status === 'generating')) {
      if (pollTimer) clearInterval(pollTimer)
    }
  }, 2000)
}

onMounted(loadRecords)
onUnmounted(() => { if (pollTimer) clearInterval(pollTimer) })
</script>

<template>
  <StudioShell>
    <h1 class="mb-2 text-2xl font-semibold">视频工作室</h1>
    <p class="mb-6 text-sm text-white/50">AI 视频生成，消耗 30 积分/次</p>

    <div class="mb-8 max-w-2xl rounded-2xl border border-white/8 bg-[#1a1a1a] p-4">
      <textarea v-model="prompt" class="input-field mb-3 min-h-[100px] w-full" placeholder="描述视频场景与运镜..." />
      <div class="mb-3 flex items-center gap-4">
        <label class="text-xs text-white/50">时长 {{ duration }}s</label>
        <input v-model.number="duration" type="range" min="3" max="10" class="flex-1" />
      </div>
      <div class="flex items-center justify-between gap-3">
        <ModelSelector v-model="model" type="video" />
        <button class="btn-primary px-6" :disabled="loading || !prompt.trim()" @click="generate">
          {{ loading ? '提交中...' : '生成视频' }}
        </button>
      </div>
      <p v-if="error" class="mt-2 text-sm text-red-400">{{ error }}</p>
    </div>

    <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      <div v-for="item in records" :key="item.id" class="overflow-hidden rounded-xl border border-white/8 bg-[#1a1a1a]">
        <div class="relative aspect-video bg-[#242424]">
          <img v-if="item.url && item.status === 'completed'" :src="item.url" class="h-full w-full object-cover" alt="" />
          <div v-else class="flex h-full items-center justify-center text-sm text-yellow-400">生成中...</div>
        </div>
        <div class="p-3">
          <p class="line-clamp-2 text-xs text-white/60">{{ item.prompt }}</p>
        </div>
      </div>
    </div>
  </StudioShell>
</template>
