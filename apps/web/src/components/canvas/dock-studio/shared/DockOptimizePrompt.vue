<script setup lang="ts">
import { ref } from 'vue'
import { canvasApi } from '@/services/canvas-api'

const props = defineProps<{
  prompt: string
  optimizeStyle?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  optimized: [value: string]
}>()

const loading = ref(false)

async function optimize() {
  const text = props.prompt.trim()
  if (!text || loading.value) return
  loading.value = true
  try {
    const { data } = await canvasApi.optimizePrompt(text, props.optimizeStyle ?? 'cinematic')
    emit('optimized', data.data.optimized)
  } catch {
    // ignore — caller may show toast later
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <button
    type="button"
    class="neo-ctl rounded-lg px-2.5 py-1.5 text-[10px]"
    :disabled="disabled || !prompt.trim() || loading"
    @click="optimize"
  >
    {{ loading ? '优化中...' : '优化提示词' }}
  </button>
</template>
