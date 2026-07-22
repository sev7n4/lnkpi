<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Work } from '@lnkpi/shared'
import { usersApi } from '@/services/users-api'
import WorkCard from '@/components/works/WorkCard.vue'

const route = useRoute()
const router = useRouter()
const creatorId = computed(() => route.params.id as string)

const profile = ref<{
  user: { id: string; nickname: string; workCount: number; membership: string }
  works: Work[]
} | null>(null)
const loading = ref(true)

onMounted(async () => {
  try {
    const { data } = await usersApi.getCreator(creatorId.value)
    profile.value = data.data
  } finally {
    loading.value = false
  }
})

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
</script>

<template>
  <div class="mx-auto max-w-7xl px-6 py-10">
    <div v-if="loading" class="animate-pulse space-y-6">
      <div class="h-24 rounded-2xl bg-[#1a1a1a]" />
      <div class="grid grid-cols-4 gap-4">
        <div v-for="i in 4" :key="i" class="aspect-video rounded-2xl bg-[#1a1a1a]" />
      </div>
    </div>

    <template v-else-if="profile">
      <header class="mb-10 flex items-center gap-5 rounded-2xl border border-white/8 bg-[#1a1a1a] p-6">
        <div class="flex h-16 w-16 items-center justify-center rounded-full bg-[#6366f1]/30 text-2xl font-semibold">
          {{ profile.user.nickname[0] }}
        </div>
        <div>
          <h1 class="text-2xl font-semibold">{{ profile.user.nickname }}</h1>
          <p class="mt-1 text-sm text-white/50">
            {{ profile.user.workCount }} 作品 ·
            {{ profile.user.membership === 'pro' ? '专业版' : profile.user.membership === 'studio' ? '工作室版' : '免费版' }}
          </p>
        </div>
      </header>

      <h2 class="mb-4 text-lg font-medium">全部作品</h2>
      <div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <WorkCard
          v-for="work in profile.works"
          :key="work.id"
          :work="{ ...work, authorId: profile.user.id, authorName: profile.user.nickname }"
          @view-work="viewWork"
          @view-watch="viewWatch"
          @view-process="viewProcess"
          @view-author="viewAuthor"
          @view-share="viewShare"
        />
      </div>
      <p v-if="!profile.works.length" class="py-16 text-center text-white/40">暂无发布作品</p>
    </template>

    <p v-else class="py-16 text-center text-white/40">创作者不存在</p>
  </div>
</template>
