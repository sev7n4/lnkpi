<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { WORK_CATEGORIES } from '@lnkpi/shared'
import { worksApi } from '@/services/works-api'

const props = defineProps<{
  modelValue: boolean
  sessionId?: string
  sessions?: Array<{ id: string; title: string }>
  defaultTitle?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  published: []
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const title = ref('')
const category = ref('精选作品')
const selectedSessionId = ref('')
const loading = ref(false)
const error = ref('')
const success = ref(false)

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      title.value = props.defaultTitle ?? '未命名作品'
      category.value = '精选作品'
      selectedSessionId.value = props.sessionId ?? props.sessions?.[0]?.id ?? ''
      error.value = ''
      success.value = false
    }
  },
)

async function handlePublish() {
  const sid = props.sessionId ?? selectedSessionId.value
  if (!title.value.trim() || !sid) return
  loading.value = true
  error.value = ''
  try {
    await worksApi.publish({
      sessionId: sid,
      title: title.value.trim(),
      category: category.value,
    })
    success.value = true
    emit('published')
    setTimeout(() => { visible.value = false }, 1200)
  } catch {
    error.value = '发布失败，请确认已登录且画布有效'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="发布到超创站"
    width="480px"
    class="publish-dialog"
    destroy-on-close
  >
    <div v-if="success" class="py-8 text-center">
      <p class="text-lg text-[#818cf8]">发布成功 🎉</p>
      <p class="mt-2 text-sm text-white/50">作品已出现在社区作品流</p>
    </div>
    <form v-else class="space-y-4" @submit.prevent="handlePublish">
      <div v-if="!sessionId && sessions?.length">
        <label class="mb-1 block text-xs text-white/50">选择画布</label>
        <el-select v-model="selectedSessionId" class="w-full">
          <el-option
            v-for="s in sessions"
            :key="s.id"
            :label="s.title"
            :value="s.id"
          />
        </el-select>
      </div>
      <div>
        <label class="mb-1 block text-xs text-white/50">作品标题</label>
        <el-input v-model="title" placeholder="输入作品标题" />
      </div>
      <div>
        <label class="mb-1 block text-xs text-white/50">分类</label>
        <el-select v-model="category" class="w-full">
          <el-option
            v-for="cat in WORK_CATEGORIES.filter((c) => c !== '全部')"
            :key="cat"
            :label="cat"
            :value="cat"
          />
        </el-select>
      </div>
      <p v-if="error" class="text-sm text-red-400">{{ error }}</p>
      <div class="flex justify-end gap-2 pt-2">
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="loading" native-type="submit">发布</el-button>
      </div>
    </form>
  </el-dialog>
</template>

<style>
.publish-dialog .el-dialog {
  background: #1a1a1a;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.publish-dialog .el-dialog__title {
  color: #fff;
}
</style>
