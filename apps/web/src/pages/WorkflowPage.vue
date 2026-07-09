<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import type { Work } from '@lnkpi/shared'
import { WORK_CATEGORIES } from '@lnkpi/shared'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { useSessionRedirect } from '@/composables/useSessionRedirect'
import WorkCard from '@/components/works/WorkCard.vue'
import CreativeLauncher from '@/components/workflow/CreativeLauncher.vue'
import CarouselBanner from '@/components/workflow/CarouselBanner.vue'
import CategoryTabs from '@/components/workflow/CategoryTabs.vue'

const router = useRouter()
const auth = useAuthStore()
useSessionRedirect()

const prompt = ref('')
const works = ref<Work[]>([])
const activeCategory = ref('全部')
const loading = ref(false)
const greeting = getGreeting()

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return '上午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

function getMockWorks(): Work[] {
  const covers = [
    'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&q=80',
    'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=800&q=80',
    'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?w=800&q=80',
    'https://images.unsplash.com/photo-1614728263932-097ed562d636?w=800&q=80',
    'https://images.unsplash.com/photo-1558591710-4b4a1ae0f04d?w=800&q=80',
    'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=800&q=80',
    'https://images.unsplash.com/photo-1557683316-973673baf926?w=800&q=80',
    'https://images.unsplash.com/photo-1614850523459-c2f4c699c52e?w=800&q=80',
  ]
  const titles = ['浮光·火星激战', '元启录', '万物生：问心', '末日乐园改编', '绝尘', '救赎：长河余烬', '断线', '风起陇西']
  const authors = ['创作者A', '创作者B', '创作者C', '创作者D', '创作者E', '创作者F', '创作者G', '创作者H']

  return titles.map((title, i) => ({
    id: String(i + 1),
    title,
    coverUrl: covers[i],
    type: (i % 3 === 0 ? 'shortfilm' : 'canvas') as Work['type'],
    authorId: String(i),
    authorName: authors[i],
    sessionId: `session-${i + 1}`,
    likes: Math.floor(Math.random() * 1000),
    views: Math.floor(Math.random() * 5000),
    createdAt: new Date().toISOString(),
  }))
}

async function fetchWorks() {
  loading.value = true
  try {
    const { data } = await api.get<{ data: { items: Work[] } }>('/works', {
      params: { category: activeCategory.value === '全部' ? undefined : activeCategory.value },
    })
    works.value = data.data.items
  } catch {
    works.value = getMockWorks()
  } finally {
    loading.value = false
  }
}

async function createCanvas() {
  if (!auth.isLoggedIn) {
    auth.openLogin()
    return
  }
  try {
    const { data } = await api.post<{ data: { id: string } }>('/sessions', {
      title: prompt.value || '未命名画布',
      prompt: prompt.value,
    })
    router.push(`/workflow/${data.data.id}`)
  } catch {
    router.push(`/workflow/demo-${Date.now()}`)
  }
}

function viewProcess(sessionId: string) {
  router.push(`/workflow/${sessionId}`)
}

function onCategoryChange(cat: string) {
  activeCategory.value = cat
  fetchWorks()
}

onMounted(fetchWorks)
</script>

<template>
  <div class="mx-auto max-w-7xl px-6 pb-20 pt-8">
    <section class="mb-12 text-center">
      <h1 class="font-display text-3xl font-semibold md:text-4xl">
        {{ greeting }}，今天要做点什么呢？
      </h1>

      <div class="mx-auto mt-8 max-w-2xl">
        <CreativeLauncher
          v-model="prompt"
          @create="createCanvas"
          @guide="createCanvas"
        />
      </div>
    </section>

    <section class="mb-10">
      <CarouselBanner />
    </section>

    <section>
      <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
        <CategoryTabs
          :categories="WORK_CATEGORIES"
          :model-value="activeCategory"
          @update:model-value="onCategoryChange"
        />
        <button class="btn-ghost text-sm">发布作品</button>
      </div>

      <div v-if="loading" class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <div v-for="i in 8" :key="i" class="aspect-video animate-pulse rounded-2xl bg-[#1a1a1a]" />
      </div>

      <div v-else class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <WorkCard
          v-for="work in works"
          :key="work.id"
          :work="work"
          @view-process="viewProcess"
        />
      </div>
    </section>
  </div>
</template>
