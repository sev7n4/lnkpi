<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { WORK_CATEGORIES } from '@lnkpi/shared'
import { api } from '@/services/api'
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

interface PrimaryNodeOption {
  id: string
  type: 'image' | 'video'
  label: string
  preview: string
}

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const title = ref('')
const category = ref('精选作品')
const selectedSessionId = ref('')
const primaryNodeId = ref('')
const primaryNodes = ref<PrimaryNodeOption[]>([])
const loadingNodes = ref(false)
const loading = ref(false)
const error = ref('')
const success = ref(false)

const activeSessionId = computed(() => props.sessionId ?? selectedSessionId.value)
const canSubmit = computed(() => !!title.value.trim() && !!activeSessionId.value && !!primaryNodeId.value)

async function loadPrimaryNodes(sid: string) {
  if (!sid) {
    primaryNodes.value = []
    primaryNodeId.value = ''
    return
  }
  loadingNodes.value = true
  try {
    const { data } = await api.get<{ data: { canvasData?: { nodes?: Array<{ id: string; type?: string; data?: { url?: string; coverUrl?: string } }> } } }>(
      `/sessions/${sid}`,
    )
    primaryNodes.value = (data.data.canvasData?.nodes ?? [])
      .filter((n) => (n.type === 'image' || n.type === 'video') && n.data?.url)
      .map((n) => ({
        id: n.id,
        type: n.type as 'image' | 'video',
        label: `${n.id} · ${n.type === 'video' ? '视频' : '图片'}`,
        preview: n.data?.coverUrl || n.data?.url || '',
      }))
    if (!primaryNodes.value.some((n) => n.id === primaryNodeId.value)) {
      primaryNodeId.value = primaryNodes.value[0]?.id ?? ''
    }
  } catch {
    primaryNodes.value = []
    primaryNodeId.value = ''
  } finally {
    loadingNodes.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      title.value = props.defaultTitle ?? '未命名作品'
      category.value = '精选作品'
      selectedSessionId.value = props.sessionId ?? props.sessions?.[0]?.id ?? ''
      error.value = ''
      success.value = false
      void loadPrimaryNodes(activeSessionId.value)
    }
  },
)

watch(activeSessionId, (sid) => {
  if (props.modelValue) void loadPrimaryNodes(sid)
})

async function handlePublish() {
  const sid = activeSessionId.value
  if (!canSubmit.value || !sid) return
  loading.value = true
  error.value = ''
  try {
    await worksApi.publish({
      sessionId: sid,
      title: title.value.trim(),
      category: category.value,
      primaryNodeId: primaryNodeId.value,
    })
    success.value = true
    emit('published')
    setTimeout(() => { visible.value = false }, 1200)
  } catch {
    error.value = '发布失败，请确认已登录、已选择主成片且画布有效'
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
      <div>
        <label class="mb-1 block text-xs text-white/50">主成片节点 <span class="text-red-400">*</span></label>
        <div v-if="loadingNodes" class="py-4 text-center text-sm text-white/40">加载节点中…</div>
        <div v-else-if="!primaryNodes.length" class="rounded-lg border border-dashed border-white/10 p-4 text-sm text-white/40">
          当前画布没有可发布的图片/视频节点，请先生成或上传媒体
        </div>
        <el-radio-group v-else v-model="primaryNodeId" class="flex w-full flex-col gap-2">
          <el-radio
            v-for="node in primaryNodes"
            :key="node.id"
            :value="node.id"
            class="!mr-0 !h-auto w-full rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2"
          >
            <div class="flex items-center gap-3">
              <img :src="node.preview" :alt="node.label" class="h-10 w-16 rounded object-cover" />
              <span class="text-sm">{{ node.label }}</span>
            </div>
          </el-radio>
        </el-radio-group>
      </div>
      <p v-if="error" class="text-sm text-red-400">{{ error }}</p>
      <div class="flex justify-end gap-2 pt-2">
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="loading" :disabled="!canSubmit" native-type="submit">发布</el-button>
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
