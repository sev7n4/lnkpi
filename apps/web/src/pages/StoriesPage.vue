<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { storiesApi, type Story } from '@/services/stories-api'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()
const stories = ref<Story[]>([])
const loading = ref(false)
const showCreate = ref(false)
const title = ref('')
const synopsis = ref('')
const episodes = ref(1)

async function load() {
  if (!auth.isLoggedIn) return
  loading.value = true
  try {
    const { data } = await storiesApi.list()
    stories.value = data.data
  } finally {
    loading.value = false
  }
}

async function createStory() {
  if (!title.value.trim()) return
  if (!auth.isLoggedIn) { auth.openLogin(); return }
  const { data } = await storiesApi.create({
    title: title.value,
    synopsis: synopsis.value,
    episodeCount: episodes.value,
  })
  showCreate.value = false
  router.push(`/workflow/${data.data.sessionId}`)
}

function openStory(story: Story) {
  if (story.sessionId) router.push(`/workflow/${story.sessionId}`)
}

onMounted(load)
</script>

<template>
  <div class="mx-auto max-w-7xl px-6 py-10">
    <div class="mb-8 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold">我的短片 / 漫剧</h1>
        <p class="mt-1 text-sm text-white/50">故事模式 — 创建多集漫剧项目并进入画布创作</p>
      </div>
      <button class="btn-primary" @click="auth.isLoggedIn ? (showCreate = true) : auth.openLogin()">
        + 新建故事
      </button>
    </div>

    <div v-if="loading" class="grid grid-cols-3 gap-4">
      <div v-for="i in 3" :key="i" class="aspect-[3/4] animate-pulse rounded-2xl bg-[#1a1a1a]" />
    </div>

    <div v-else class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <button
        v-for="story in stories"
        :key="story.id"
        type="button"
        class="overflow-hidden rounded-2xl border border-white/8 bg-[#1a1a1a] text-left transition hover:border-[#6366f1]/40"
        @click="openStory(story)"
      >
        <div class="aspect-[4/3] overflow-hidden bg-[#242424]">
          <img v-if="story.coverUrl" :src="story.coverUrl" class="h-full w-full object-cover" alt="" />
        </div>
        <div class="p-4">
          <h3 class="font-medium">{{ story.title }}</h3>
          <p class="mt-1 line-clamp-2 text-xs text-white/50">{{ story.synopsis || '暂无简介' }}</p>
          <p class="mt-2 text-[10px] text-white/30">{{ story.episodeCount }} 集 · {{ story.status }}</p>
        </div>
      </button>
    </div>

    <p v-if="!loading && !stories.length" class="py-20 text-center text-white/40">
      登录后创建你的第一个漫剧故事
    </p>

    <el-dialog v-model="showCreate" title="新建漫剧故事" width="480px" class="story-dialog">
      <div class="space-y-4">
        <div>
          <label class="mb-1 block text-xs text-white/50">故事标题</label>
          <el-input v-model="title" placeholder="例：末日乐园" />
        </div>
        <div>
          <label class="mb-1 block text-xs text-white/50">故事简介</label>
          <el-input v-model="synopsis" type="textarea" :rows="3" placeholder="简述世界观与主线..." />
        </div>
        <div>
          <label class="mb-1 block text-xs text-white/50">计划集数 {{ episodes }}</label>
          <input v-model.number="episodes" type="range" min="1" max="12" class="w-full" />
        </div>
        <div class="flex justify-end gap-2">
          <el-button @click="showCreate = false">取消</el-button>
          <el-button type="primary" @click="createStory">创建并进入画布</el-button>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<style>
.story-dialog .el-dialog {
  background: #1a1a1a;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.story-dialog .el-dialog__title { color: #fff; }
</style>
