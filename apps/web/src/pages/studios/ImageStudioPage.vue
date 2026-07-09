<script setup lang="ts">
import { onMounted, ref } from 'vue'
import StudioShell from '@/components/studio/StudioShell.vue'
import ModelSelector from '@/components/canvas/ModelSelector.vue'
import { studioApi, type GenerationRecord } from '@/services/studio-api'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const prompt = ref('')
const model = ref('flux-pro')
const loading = ref(false)
const records = ref<GenerationRecord[]>([])
const error = ref('')

async function loadRecords() {
  if (!auth.isLoggedIn) return
  const { data } = await studioApi.listGenerations('image')
  records.value = data.data
}

async function generate() {
  if (!prompt.value.trim()) return
  if (!auth.isLoggedIn) { auth.openLogin(); return }
  loading.value = true
  error.value = ''
  try {
    await studioApi.generateImage(prompt.value, model.value)
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
    <h1 class="mb-2 text-2xl font-semibold">图像工作室</h1>
    <p class="mb-6 text-sm text-white/50">独立图像生成，消耗 10 积分/次</p>

    <div class="mb-8 max-w-2xl rounded-2xl border border-white/8 bg-[#1a1a1a] p-4">
      <textarea v-model="prompt" class="input-field mb-3 min-h-[100px] w-full" placeholder="描述你想生成的图像..." />
      <div class="flex items-center justify-between gap-3">
        <ModelSelector v-model="model" type="image" />
        <button class="btn-primary px-6" :disabled="loading || !prompt.trim()" @click="generate">
          {{ loading ? '生成中...' : '生成图像' }}
        </button>
      </div>
      <p v-if="error" class="mt-2 text-sm text-red-400">{{ error }}</p>
    </div>

    <h2 class="mb-4 text-lg font-medium">最近生成</h2>
    <div class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
      <div v-for="item in records" :key="item.id" class="overflow-hidden rounded-xl border border-white/8 bg-[#1a1a1a]">
        <img v-if="item.url" :src="item.url" class="aspect-square object-cover" alt="" />
        <div class="p-3">
          <p class="line-clamp-2 text-xs text-white/60">{{ item.prompt }}</p>
        </div>
      </div>
    </div>
    <p v-if="!records.length" class="py-12 text-center text-white/30">登录后查看生成记录</p>
  </StudioShell>
</template>
