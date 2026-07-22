<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { Work } from '@lnkpi/shared'
import { worksApi } from '@/services/works-api'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const work = ref<Work | null>(null)
const loading = ref(true)
const liking = ref(false)

const mediaUrl = computed(() => work.value?.playbackUrl || work.value?.coverUrl)
const isVideo = computed(() => work.value?.playbackKind === 'video')

onMounted(async () => {
  try {
    const { data } = await worksApi.get(route.params.id as string)
    work.value = data.data
  } finally {
    loading.value = false
  }
})

function viewProcess() {
  if (work.value) router.push(`/share/${work.value.id}/process`)
}

function viewCreator() {
  if (work.value?.authorId) router.push(`/creator/${work.value.authorId}`)
}

async function handleLike() {
  if (!work.value) return
  if (!auth.isLoggedIn) {
    auth.openLogin()
    return
  }
  liking.value = true
  try {
    const { data } = await worksApi.like(work.value.id)
    work.value = data.data
    ElMessage.success('已点赞')
  } catch {
    ElMessage.error('点赞失败')
  } finally {
    liking.value = false
  }
}

async function handleShare() {
  try {
    await navigator.clipboard.writeText(window.location.href)
    ElMessage.success('链接已复制')
  } catch {
    ElMessage.error('复制失败')
  }
}
</script>

<template>
  <div class="mx-auto max-w-4xl px-6 py-12">
    <div v-if="loading" class="aspect-video animate-pulse rounded-2xl bg-[#1a1a1a]" />

    <template v-else-if="work">
      <div class="overflow-hidden rounded-2xl border border-white/8 bg-[#1a1a1a]">
        <div class="bg-black">
          <video
            v-if="isVideo && mediaUrl"
            :src="mediaUrl"
            controls
            class="aspect-video w-full object-contain"
          />
          <img
            v-else-if="mediaUrl"
            :src="mediaUrl"
            :alt="work.title"
            class="aspect-video w-full object-contain"
          />
        </div>
        <div class="p-6">
          <h1 class="text-2xl font-semibold">{{ work.title }}</h1>
          <button
            class="mt-3 flex items-center gap-2 text-sm text-[#818cf8] hover:underline"
            @click="viewCreator"
          >
            <span
              v-if="work.authorAvatar"
              class="inline-block h-6 w-6 overflow-hidden rounded-full"
            >
              <img :src="work.authorAvatar" :alt="work.authorName" class="h-full w-full object-cover" />
            </span>
            <span
              v-else
              class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#6366f1]/30 text-xs"
            >
              {{ work.authorName[0] }}
            </span>
            @{{ work.authorName }}
          </button>
          <div class="mt-4 flex gap-4 text-sm text-white/40">
            <span>{{ work.likes }} 赞</span>
            <span>{{ work.views }} 浏览</span>
          </div>
          <div class="mt-6 flex flex-wrap gap-3">
            <button class="btn-primary" @click="handleLike" :disabled="liking">
              {{ liking ? '点赞中…' : '点赞' }}
            </button>
            <button class="btn-ghost" @click="handleShare">分享</button>
            <button
              v-if="work.sessionId"
              class="btn-ghost"
              @click="viewProcess"
            >
              查看制作过程
            </button>
            <button class="btn-ghost" @click="router.push('/workflow')">我也要创作</button>
          </div>
        </div>
      </div>
    </template>

    <p v-else class="py-16 text-center text-white/40">作品不存在</p>
  </div>
</template>
