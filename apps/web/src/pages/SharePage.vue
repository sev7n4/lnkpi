<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Work } from '@lnkpi/shared'
import { worksApi } from '@/services/works-api'

const route = useRoute()
const router = useRouter()
const work = ref<Work | null>(null)
const loading = ref(true)

onMounted(async () => {
  try {
    const { data } = await worksApi.get(route.params.id as string)
    work.value = data.data
  } finally {
    loading.value = false
  }
})

function viewReplay() {
  if (work.value?.sessionId) router.push(`/replay/${work.value.sessionId}`)
}

function viewCreator() {
  if (work.value?.authorId) router.push(`/creator/${work.value.authorId}`)
}
</script>

<template>
  <div class="mx-auto max-w-4xl px-6 py-12">
    <div v-if="loading" class="aspect-video animate-pulse rounded-2xl bg-[#1a1a1a]" />

    <template v-else-if="work">
      <div class="overflow-hidden rounded-2xl border border-white/8 bg-[#1a1a1a]">
        <img :src="work.coverUrl" :alt="work.title" class="aspect-video w-full object-cover" />
        <div class="p-6">
          <h1 class="text-2xl font-semibold">{{ work.title }}</h1>
          <button class="mt-2 text-sm text-[#818cf8] hover:underline" @click="viewCreator">
            @{{ work.authorName }}
          </button>
          <div class="mt-4 flex gap-4 text-sm text-white/40">
            <span>{{ work.likes }} 赞</span>
            <span>{{ work.views }} 浏览</span>
          </div>
          <div class="mt-6 flex flex-wrap gap-3">
            <button
              v-if="work.sessionId"
              class="btn-primary"
              @click="viewReplay"
            >
              查看创作过程
            </button>
            <button class="btn-ghost" @click="router.push('/workflow')">我也要创作</button>
          </div>
        </div>
      </div>
    </template>

    <p v-else class="py-16 text-center text-white/40">作品不存在</p>
  </div>
</template>
