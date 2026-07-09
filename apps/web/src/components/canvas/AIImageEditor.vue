<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { studioApi } from '@/services/studio-api'
import { useAuthStore } from '@/stores/auth'
import { useCanvasEditorStore } from '@/stores/canvasEditor'

const emit = defineEmits<{
  apply: [payload: { nodeId: string; url: string; prompt?: string }]
}>()

const editor = useCanvasEditorStore()
const auth = useAuthStore()

const visible = computed({
  get: () => !!editor.imageTarget,
  set: (v) => { if (!v) editor.closeImageEditor() },
})

const variationPrompt = ref('')
const brightness = ref(100)
const contrast = ref(100)
const loading = ref(false)
const previewUrl = ref('')

watch(
  () => editor.imageTarget,
  (t) => {
    if (t) {
      previewUrl.value = t.url
      variationPrompt.value = ''
      brightness.value = 100
      contrast.value = 100
    }
  },
  { immediate: true },
)

const filterStyle = computed(() => ({
  filter: `brightness(${brightness.value}%) contrast(${contrast.value}%)`,
}))

async function generateVariation() {
  if (!editor.imageTarget || !variationPrompt.value.trim()) return
  if (!auth.isLoggedIn) { auth.openLogin(); return }
  loading.value = true
  try {
    const { data } = await studioApi.generateImageVariation(
      variationPrompt.value,
      editor.imageTarget.prompt,
    )
    previewUrl.value = data.data.url ?? previewUrl.value
  } finally {
    loading.value = false
  }
}

function apply() {
  if (!editor.imageTarget) return
  emit('apply', {
    nodeId: editor.imageTarget.nodeId,
    url: previewUrl.value,
    prompt: editor.imageTarget.prompt,
  })
  editor.closeImageEditor()
}
</script>

<template>
  <el-dialog v-model="visible" title="AI 图像编辑" width="720px" class="image-editor-dialog" destroy-on-close>
    <div v-if="editor.imageTarget" class="grid gap-4 md:grid-cols-2">
      <div class="overflow-hidden rounded-xl border border-white/10 bg-black">
        <img
          :src="previewUrl"
          class="aspect-square w-full object-contain"
          :style="filterStyle"
          alt=""
        />
      </div>
      <div class="space-y-4">
        <div>
          <label class="mb-1 block text-xs text-white/50">变体描述</label>
          <el-input
            v-model="variationPrompt"
            type="textarea"
            :rows="3"
            placeholder="描述想要的变体效果..."
          />
          <el-button class="mt-2" size="small" type="primary" :loading="loading" @click="generateVariation">
            生成变体 (10积分)
          </el-button>
        </div>
        <div>
          <label class="mb-1 block text-xs text-white/50">亮度 {{ brightness }}%</label>
          <input v-model.number="brightness" type="range" min="50" max="150" class="w-full" />
        </div>
        <div>
          <label class="mb-1 block text-xs text-white/50">对比度 {{ contrast }}%</label>
          <input v-model.number="contrast" type="range" min="50" max="150" class="w-full" />
        </div>
        <el-button type="primary" class="w-full" @click="apply">应用到画布</el-button>
      </div>
    </div>
  </el-dialog>
</template>

<style>
.image-editor-dialog .el-dialog {
  background: #1a1a1a;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.image-editor-dialog .el-dialog__title { color: #fff; }
</style>
