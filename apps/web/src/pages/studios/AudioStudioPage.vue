<script setup lang="ts">
import { onMounted, ref } from 'vue'
import StudioShell from '@/components/studio/StudioShell.vue'
import { studioApi, type GenerationRecord } from '@/services/studio-api'
import { useAuthStore } from '@/stores/auth'

import { AUDIO_VOICE_OPTIONS, DEFAULT_AUDIO_VOICE } from '@/constants/dockAudio'

const auth = useAuthStore()
const text = ref('')
const voice = ref(DEFAULT_AUDIO_VOICE)
const loading = ref(false)
const records = ref<GenerationRecord[]>([])
const error = ref('')

const voices = AUDIO_VOICE_OPTIONS

async function loadRecords() {
  if (!auth.isLoggedIn) return
  const { data } = await studioApi.listGenerations('audio')
  records.value = data.data
}

async function generate() {
  if (!text.value.trim()) return
  if (!auth.isLoggedIn) { auth.openLogin(); return }
  loading.value = true
  error.value = ''
  try {
    await studioApi.generateAudio(text.value, { voice: voice.value })
    text.value = ''
    await loadRecords()
  } catch {
    error.value = '生成失败或积分不足'
  } finally {
    loading.value = false
  }
}

onMounted(loadRecords)
</script>

<template>
  <StudioShell>
    <h1 class="mb-2 text-2xl font-semibold">音频工作室</h1>
    <p class="mb-6 text-sm text-white/50">文本转语音 / 旁白生成，消耗 5 积分/次</p>

    <div class="mb-8 max-w-2xl rounded-2xl border border-white/8 bg-[#1a1a1a] p-4">
      <textarea v-model="text" class="input-field mb-3 min-h-[120px] w-full" placeholder="输入台词或旁白文本..." />
      <div class="mb-3 flex flex-wrap gap-2">
        <button
          v-for="v in voices"
          :key="v.id"
          class="rounded-lg px-3 py-1.5 text-xs transition"
          :class="voice === v.id ? 'bg-[#6366f1]/30 text-[#818cf8]' : 'bg-white/5 text-white/60'"
          @click="voice = v.id"
        >
          {{ v.label }}
        </button>
      </div>
      <button class="btn-primary px-6" :disabled="loading || !text.trim()" @click="generate">
        {{ loading ? '生成中...' : '生成音频' }}
      </button>
      <p v-if="error" class="mt-2 text-sm text-red-400">{{ error }}</p>
    </div>

    <div class="space-y-3">
      <div v-for="item in records" :key="item.id" class="rounded-xl border border-white/8 bg-[#1a1a1a] p-4">
        <p class="mb-2 text-sm">{{ item.prompt }}</p>
        <audio v-if="item.url" :src="item.url" controls class="w-full" />
      </div>
    </div>
  </StudioShell>
</template>
