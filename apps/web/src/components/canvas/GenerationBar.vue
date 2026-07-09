<script setup lang="ts">
import { ref } from 'vue'
import ModelSelector from '@/components/canvas/ModelSelector.vue'
import MentionInput, { type MentionOption } from '@/components/canvas/MentionInput.vue'
import { useSpeechRecognition } from '@/composables/useSpeechRecognition'

defineProps<{
  mentions?: MentionOption[]
}>()

const emit = defineEmits<{
  generate: [payload: {
    prompt: string
    mode: 'text' | 'image' | 'video'
    textModel: string
    imageModel: string
    videoModel: string
  }]
}>()

const prompt = ref('')
const textModel = ref('gpt-4o')
const imageModel = ref('flux-pro')
const videoModel = ref('kling-v1')
const activeTab = ref<'text' | 'image' | 'video'>('image')

const speech = useSpeechRecognition()

function handleSend() {
  if (!prompt.value.trim()) return
  emit('generate', {
    prompt: prompt.value,
    mode: activeTab.value,
    textModel: textModel.value,
    imageModel: imageModel.value,
    videoModel: videoModel.value,
  })
}

function toggleVoice() {
  if (speech.listening.value) {
    speech.stop()
    return
  }
  const started = speech.start((text, isFinal) => {
    if (isFinal) {
      prompt.value = prompt.value ? `${prompt.value} ${text}` : text
    }
  })
  if (!started) {
    prompt.value += prompt.value ? ' （当前浏览器不支持语音识别）' : '（当前浏览器不支持语音识别）'
  }
}
</script>

<template>
  <div class="border-t border-white/5 bg-[#1a1a1a]/95 backdrop-blur-xl">
    <div class="mx-auto max-w-4xl p-4">
      <div class="mb-3 flex items-center gap-2">
        <button
          v-for="tab in (['text', 'image', 'video'] as const)"
          :key="tab"
          class="rounded-lg px-3 py-1 text-xs transition"
          :class="activeTab === tab ? 'bg-[#6366f1]/30 text-[#818cf8]' : 'text-white/40 hover:text-white/70'"
          @click="activeTab = tab"
        >
          {{ tab === 'text' ? '文本' : tab === 'image' ? '图像' : '视频' }}
        </button>

        <div class="ml-auto flex items-center gap-2">
          <ModelSelector v-if="activeTab === 'text'" v-model="textModel" type="text" />
          <ModelSelector v-if="activeTab === 'image'" v-model="imageModel" type="image" />
          <ModelSelector v-if="activeTab === 'video'" v-model="videoModel" type="video" />
        </div>
      </div>

      <div class="flex items-end gap-3">
        <MentionInput
          v-model="prompt"
          :mentions="mentions ?? []"
          @submit="handleSend"
        />

        <button
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition"
          :class="speech.listening.value
            ? 'bg-red-500/20 text-red-400 animate-pulse'
            : speech.supported
              ? 'bg-white/5 text-white/60 hover:bg-white/10'
              : 'bg-white/5 text-white/30'"
          :title="speech.supported ? '语音输入' : '浏览器不支持语音识别'"
          @click="toggleVoice"
        >
          <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        </button>

        <button
          class="btn-primary h-10 px-6"
          :disabled="!prompt.trim()"
          @click="handleSend"
        >
          生成
        </button>
      </div>
    </div>
  </div>
</template>
