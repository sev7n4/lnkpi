<script setup lang="ts">
import { onMounted, ref } from 'vue'
import StudioShell from '@/components/studio/StudioShell.vue'
import ModelSelector from '@/components/canvas/ModelSelector.vue'
import { studioApi, type GenerationRecord } from '@/services/studio-api'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const prompt = ref('')
const model = ref('gpt-4o')
const loading = ref(false)
const records = ref<GenerationRecord[]>([])
const error = ref('')

function parseText(record: GenerationRecord) {
  if (!record.metadata) return record.prompt
  try {
    const m = JSON.parse(record.metadata) as { text?: string }
    return m.text ?? record.prompt
  } catch {
    return record.prompt
  }
}

async function loadRecords() {
  if (!auth.isLoggedIn) return
  const { data } = await studioApi.listGenerations('text')
  records.value = data.data
}

async function generate() {
  if (!prompt.value.trim()) return
  if (!auth.isLoggedIn) { auth.openLogin(); return }
  loading.value = true
  error.value = ''
  try {
    await studioApi.generateText(prompt.value, model.value)
    prompt.value = ''
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
    <h1 class="mb-2 text-2xl font-semibold">文本工作室</h1>
    <p class="mb-6 text-sm text-white/50">脚本 / 旁白 / 分镜描述，消耗 5 积分/次</p>

    <div class="mb-8 max-w-2xl rounded-2xl border border-white/8 bg-[#1a1a1a] p-4">
      <textarea v-model="prompt" class="input-field mb-3 min-h-[120px] w-full" placeholder="输入创作需求，如：写一个赛博朋克开场旁白..." />
      <div class="flex items-center justify-between gap-3">
        <ModelSelector v-model="model" type="text" />
        <button class="btn-primary px-6" :disabled="loading || !prompt.trim()" @click="generate">
          {{ loading ? '生成中...' : '生成文本' }}
        </button>
      </div>
      <p v-if="error" class="mt-2 text-sm text-red-400">{{ error }}</p>
    </div>

    <div class="space-y-4">
      <article
        v-for="item in records"
        :key="item.id"
        class="rounded-xl border border-white/8 bg-[#1a1a1a] p-4"
      >
        <p class="mb-2 text-xs text-white/40">{{ item.prompt }}</p>
        <pre class="whitespace-pre-wrap text-sm leading-relaxed text-white/80">{{ parseText(item) }}</pre>
      </article>
    </div>
  </StudioShell>
</template>
