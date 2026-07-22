<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import type { Work } from '@lnkpi/shared'
import { api } from '@/services/api'
import WorkCard from '@/components/works/WorkCard.vue'

const router = useRouter()
const works = ref<Work[]>([])
const search = ref('')
const loading = ref(false)

async function fetchWorks() {
  loading.value = true
  try {
    const { data } = await api.get<{ data: { items: Work[] } }>('/works', {
      params: { search: search.value || undefined },
    })
    works.value = data.data.items
  } catch {
    works.value = []
  } finally {
    loading.value = false
  }
}

function viewWork(workId: string) {
  router.push(`/share/${workId}`)
}

function viewWatch(workId: string) {
  router.push(`/share/${workId}`)
}

function viewProcess(workId: string) {
  router.push(`/share/${workId}/process`)
}

function viewAuthor(authorId: string) {
  router.push(`/creator/${authorId}`)
}

function viewShare(workId: string) {
  router.push(`/share/${workId}`)
}

onMounted(fetchWorks)
</script>

<template>
  <div class="mx-auto max-w-7xl px-6 pb-20 pt-8">
    <div class="mb-8 text-center">
      <h1 class="font-display text-3xl font-semibold">超创站</h1>
      <p class="mt-2 text-white/60">发现社区优秀作品，探索 AI 创作无限可能</p>
    </div>

    <div class="mb-8 flex justify-center">
      <div class="flex w-full max-w-md gap-2">
        <input
          v-model="search"
          class="input-field"
          placeholder="搜索作品..."
          @keydown.enter="fetchWorks"
        />
        <button class="btn-primary" @click="fetchWorks">搜索</button>
      </div>
    </div>

    <div v-if="loading" class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <div v-for="i in 8" :key="i" class="aspect-video animate-pulse rounded-2xl bg-surface-card" />
    </div>

    <div v-else-if="works.length" class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <WorkCard
        v-for="work in works"
        :key="work.id"
        :work="work"
        @view-work="viewWork"
        @view-watch="viewWatch"
        @view-process="viewProcess"
        @view-author="viewAuthor"
        @view-share="viewShare"
      />
    </div>

    <div v-else class="py-20 text-center text-white/40">
      暂无作品，成为第一个创作者吧
    </div>
  </div>
</template>
