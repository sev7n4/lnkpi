<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { canvasApi } from '@/services/canvas-api'

export interface StoryboardShot {
  id: string
  title: string
  prompt?: string
  status?: string
  coverUrl?: string
  order?: number
}

const props = defineProps<{
  modelValue: boolean
  shots: StoryboardShot[]
  sessionId: string
}>()

const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  select: [id: string]
  updated: [shots: StoryboardShot[]]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const localShots = ref<StoryboardShot[]>([])
const saving = ref(false)
const optimizingId = ref<string | null>(null)
const message = ref('')

watch(
  () => props.shots,
  (next) => {
    localShots.value = [...next].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  },
  { immediate: true, deep: true },
)

async function saveShot(shot: StoryboardShot) {
  saving.value = true
  message.value = ''
  try {
    await canvasApi.editShot(shot.id, {
      title: shot.title,
      prompt: shot.prompt,
    })
    message.value = '已保存'
    emit('updated', [...localShots.value])
  } catch {
    message.value = '保存失败'
  } finally {
    saving.value = false
  }
}

async function moveShot(index: number, direction: -1 | 1) {
  const target = index + direction
  if (target < 0 || target >= localShots.value.length) return
  const next = [...localShots.value]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  localShots.value = next.map((s, i) => ({ ...s, order: i }))
  saving.value = true
  message.value = ''
  try {
    await canvasApi.reorderShots(
      props.sessionId,
      localShots.value.map((s) => s.id),
    )
    message.value = '顺序已更新'
    emit('updated', [...localShots.value])
  } catch {
    message.value = '排序失败'
  } finally {
    saving.value = false
  }
}

async function optimizePrompt(shot: StoryboardShot) {
  if (!shot.prompt?.trim()) return
  optimizingId.value = shot.id
  try {
    const { data } = await canvasApi.optimizePrompt(shot.prompt, 'cinematic')
    shot.prompt = data.data.optimized
    await saveShot(shot)
  } catch {
    message.value = '优化失败'
  } finally {
    optimizingId.value = null
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="分镜面板"
    width="760px"
    class="storyboard-dialog"
    destroy-on-close
  >
    <p v-if="message" class="mb-3 text-xs text-[#818cf8]">{{ message }}</p>

    <div v-if="localShots.length" class="space-y-4">
      <article
        v-for="(shot, index) in localShots"
        :key="shot.id"
        class="overflow-hidden rounded-xl border border-white/10 bg-[#1a1a1a]"
      >
        <div class="grid gap-0 md:grid-cols-[200px_1fr]">
          <button
            type="button"
            class="relative aspect-video bg-[#242424] text-left md:aspect-auto md:min-h-[140px]"
            @click="emit('select', shot.id)"
          >
            <img
              v-if="shot.coverUrl"
              :src="shot.coverUrl"
              class="h-full w-full object-cover"
              alt=""
            />
            <div v-else class="flex h-full min-h-[100px] items-center justify-center text-xs text-white/30">
              暂无封面
            </div>
            <span class="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-[10px] text-white/80">
              #{{ index + 1 }}
            </span>
          </button>

          <div class="space-y-2 p-4">
            <div class="flex items-center gap-2">
              <el-input v-model="shot.title" size="small" placeholder="分镜标题" />
              <span
                class="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
                :class="{
                  'bg-yellow-600/20 text-yellow-400': shot.status === 'generating',
                  'bg-green-600/20 text-green-400': shot.status === 'generated' || shot.status === 'completed',
                  'bg-white/5 text-white/40': !shot.status || shot.status === 'draft',
                }"
              >
                {{ shot.status === 'generating' ? '生成中' : (shot.status === 'generated' || shot.status === 'completed') ? '已完成' : '草稿' }}
              </span>
            </div>

            <el-input
              v-model="shot.prompt"
              type="textarea"
              :rows="2"
              placeholder="分镜提示词"
            />

            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="btn-ghost px-2 py-1 text-[10px]"
                :disabled="index === 0 || saving"
                @click="moveShot(index, -1)"
              >
                ↑ 上移
              </button>
              <button
                type="button"
                class="btn-ghost px-2 py-1 text-[10px]"
                :disabled="index === localShots.length - 1 || saving"
                @click="moveShot(index, 1)"
              >
                ↓ 下移
              </button>
              <button
                type="button"
                class="btn-ghost px-2 py-1 text-[10px]"
                :disabled="!shot.prompt?.trim() || optimizingId === shot.id"
                @click="optimizePrompt(shot)"
              >
                {{ optimizingId === shot.id ? '优化中...' : '优化提示词' }}
              </button>
              <button
                type="button"
                class="btn-primary ml-auto px-3 py-1 text-[10px]"
                :disabled="saving"
                @click="saveShot(shot)"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      </article>
    </div>
    <el-empty v-else description="暂无分镜，可通过 Agent 或底部生成栏创建" />
  </el-dialog>
</template>

<style>
.storyboard-dialog .el-dialog {
  background: #1a1a1a;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.storyboard-dialog .el-dialog__title {
  color: #fff;
}
</style>
