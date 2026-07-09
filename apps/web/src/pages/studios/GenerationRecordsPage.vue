<script setup lang="ts">
import { onMounted, ref } from 'vue'
import StudioShell from '@/components/studio/StudioShell.vue'
import { studioApi, type GenerationRecord } from '@/services/studio-api'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const filter = ref<'all' | 'image' | 'video' | 'audio'>('all')
const records = ref<GenerationRecord[]>([])

async function load() {
  if (!auth.isLoggedIn) return
  const type = filter.value === 'all' ? undefined : filter.value
  const { data } = await studioApi.listGenerations(type)
  records.value = data.data
}

onMounted(load)
</script>

<template>
  <StudioShell>
    <h1 class="mb-6 text-2xl font-semibold">生成记录</h1>

    <div class="mb-6 flex gap-2">
      <button
        v-for="t in (['all', 'image', 'video', 'audio'] as const)"
        :key="t"
        class="rounded-lg px-3 py-1.5 text-xs transition"
        :class="filter === t ? 'bg-[#6366f1]/30 text-[#818cf8]' : 'bg-white/5 text-white/60'"
        @click="filter = t; load()"
      >
        {{ t === 'all' ? '全部' : t === 'image' ? '图像' : t === 'video' ? '视频' : '音频' }}
      </button>
    </div>

    <div class="space-y-3">
      <div
        v-for="item in records"
        :key="item.id"
        class="flex items-center gap-4 rounded-xl border border-white/8 bg-[#1a1a1a] p-4"
      >
        <div class="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-[#242424]">
          <img v-if="item.type !== 'audio' && item.url" :src="item.url" class="h-full w-full object-cover" alt="" />
          <div v-else class="flex h-full items-center justify-center text-lg">🎵</div>
        </div>
        <div class="min-w-0 flex-1">
          <div class="mb-1 flex items-center gap-2">
            <span class="rounded bg-white/10 px-2 py-0.5 text-[10px] uppercase">{{ item.type }}</span>
            <span class="text-[10px] text-white/40">{{ item.status }}</span>
          </div>
          <p class="truncate text-sm">{{ item.prompt }}</p>
          <p class="text-[10px] text-white/30">{{ new Date(item.createdAt).toLocaleString() }}</p>
        </div>
      </div>
    </div>
    <p v-if="!records.length" class="py-16 text-center text-white/30">暂无记录</p>
  </StudioShell>
</template>
