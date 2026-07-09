<script setup lang="ts">
import { computed } from 'vue'

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
}>()

const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  select: [id: string]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const sortedShots = computed(() =>
  [...props.shots].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
)
</script>

<template>
  <el-dialog
    v-model="visible"
    title="分镜面板"
    width="720px"
    class="storyboard-dialog"
    destroy-on-close
  >
    <div v-if="sortedShots.length" class="grid grid-cols-2 gap-4 md:grid-cols-3">
      <button
        v-for="(shot, index) in sortedShots"
        :key="shot.id"
        type="button"
        class="group overflow-hidden rounded-xl border border-white/10 bg-[#1a1a1a] text-left transition hover:border-[#6366f1]/50"
        @click="emit('select', shot.id)"
      >
        <div class="relative aspect-video bg-[#242424]">
          <img
            v-if="shot.coverUrl"
            :src="shot.coverUrl"
            class="h-full w-full object-cover"
            alt=""
          />
          <div v-else class="flex h-full items-center justify-center text-xs text-white/30">
            暂无封面
          </div>
          <span class="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-[10px] text-white/80">
            #{{ index + 1 }}
          </span>
        </div>
        <div class="p-3">
          <div class="mb-1 flex items-center justify-between gap-2">
            <h4 class="truncate text-sm font-medium">{{ shot.title }}</h4>
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
          <p v-if="shot.prompt" class="line-clamp-2 text-xs text-white/45">{{ shot.prompt }}</p>
        </div>
      </button>
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
