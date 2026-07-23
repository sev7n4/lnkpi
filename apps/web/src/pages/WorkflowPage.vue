<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Work } from '@lnkpi/shared'
import { WORK_CATEGORIES } from '@lnkpi/shared'
import { api } from '@/services/api'
import { sessionsApi } from '@/services/sessions-api'
import { useAuthStore } from '@/stores/auth'
import { useSessionRedirect } from '@/composables/useSessionRedirect'
import WorkCard from '@/components/works/WorkCard.vue'
import CreativeLauncher from '@/components/workflow/CreativeLauncher.vue'
import CarouselBanner from '@/components/workflow/CarouselBanner.vue'
import CategoryTabs from '@/components/workflow/CategoryTabs.vue'
import PublishNeoTVDialog from '@/components/works/PublishNeoTVDialog.vue'
import BrandLogo from '@/components/brand/BrandLogo.vue'
import type { Session } from '@lnkpi/shared'

const router = useRouter()
const auth = useAuthStore()
useSessionRedirect()

const prompt = ref('')
const works = ref<Work[]>([])
const activeCategory = ref('全部')
const loading = ref(false)
const showPublish = ref(false)
const userSessions = ref<Session[]>([])
const mySessions = ref<Session[]>([])
const openMenuId = ref<string | null>(null)
const menuRefs = new Map<string, HTMLElement>()
const greeting = getGreeting()

function handlePublishLocateNode(payload: { sessionId: string; nodeId: string }) {
  showPublish.value = false
  void router.push({
    name: 'canvas',
    params: { sessionId: payload.sessionId },
    query: { focusNode: payload.nodeId },
  })
}
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

async function fetchMySessions() {
  if (!auth.isLoggedIn) {
    mySessions.value = []
    return
  }
  try {
    const { data } = await sessionsApi.list()
    mySessions.value = data.data
  } catch {
    mySessions.value = []
  }
}

function setMenuRef(id: string, el: HTMLElement | null) {
  if (el) menuRefs.set(id, el)
  else menuRefs.delete(id)
}

function toggleMenu(sessionId: string) {
  openMenuId.value = openMenuId.value === sessionId ? null : sessionId
}

function closeMenu() {
  openMenuId.value = null
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!openMenuId.value) return
  const el = menuRefs.get(openMenuId.value)
  if (el && !el.contains(event.target as Node)) closeMenu()
}

async function renameSession(session: Session) {
  closeMenu()
  let value: string
  try {
    const result = await ElMessageBox.prompt('输入新的画布名称', '重命名', {
      inputValue: session.title || '未命名画布',
      inputPattern: /\S/,
      inputErrorMessage: '名称不能为空',
      confirmButtonText: '保存',
      cancelButtonText: '取消',
    })
    value = result.value.trim()
  } catch {
    return
  }
  if (!value || value === session.title) return
  try {
    await sessionsApi.update(session.id, { title: value })
    await fetchMySessions()
    ElMessage.success('已重命名')
  } catch {
    ElMessage.error('重命名失败，请稍后重试')
  }
}

async function duplicateSession(session: Session) {
  closeMenu()
  try {
    const { data } = await sessionsApi.duplicate(session.id)
    await fetchMySessions()
    ElMessage.success('已复制副本')
    router.push(`/workflow/${data.data.id}`)
  } catch {
    ElMessage.error('复制失败，请稍后重试')
  }
}

async function deleteSession(session: Session) {
  closeMenu()
  try {
    await ElMessageBox.confirm(
      `确定删除「${session.title || '未命名画布'}」？此操作不可恢复。`,
      '删除画布',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
  } catch {
    return
  }
  try {
    await sessionsApi.remove(session.id)
    await fetchMySessions()
    ElMessage.success('已删除')
  } catch {
    ElMessage.error('删除失败，请稍后重试')
  }
}

function openCanvas(sessionId: string) {
  router.push(`/workflow/${sessionId}`)
}

function formatSessionTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return date.toLocaleDateString()
}

async function createCanvas() {
  if (!auth.isLoggedIn) {
    auth.openLogin()
    return
  }
  try {
    const { data } = await sessionsApi.create({
      title: prompt.value || '未命名画布',
      prompt: prompt.value,
    })
    router.push(`/workflow/${data.data.id}`)
  } catch {
    router.push(`/workflow/demo-${Date.now()}`)
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

function onCategoryChange(cat: string) {
  activeCategory.value = cat
  fetchWorks()
}

async function openPublish() {
  if (!auth.isLoggedIn) {
    auth.openLogin()
    return
  }
  try {
    const { data } = await sessionsApi.list()
    userSessions.value = data.data
    if (!userSessions.value.length) {
      await createCanvas()
      return
    }
    showPublish.value = true
  } catch {
    auth.openLogin()
  }
}

onMounted(() => {
  fetchWorks()
  void fetchMySessions()
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
})

watch(() => auth.isLoggedIn, () => {
  void fetchMySessions()
})
</script>

<template>
  <div class="mx-auto max-w-7xl px-6 pb-20 pt-8">
    <section class="mb-12 text-center">
      <div class="mb-4 flex justify-center">
        <BrandLogo size="xl" />
      </div>
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

    <!-- 我的画布：历史画布 + 新建入口 -->
    <section v-if="auth.isLoggedIn" class="mb-12">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-lg font-semibold text-white/90">我的画布</h2>
        <span v-if="mySessions.length" class="text-xs text-white/35">{{ mySessions.length }} 个画布</span>
      </div>
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <button
          type="button"
          class="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-white/[0.02] text-white/50 transition hover:border-[#6366f1]/50 hover:bg-[#6366f1]/5 hover:text-[#818cf8]"
          @click="createCanvas"
        >
          <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M12 4v16m8-8H4" />
          </svg>
          <span class="text-xs font-medium">新建画布</span>
        </button>
        <div
          v-for="session in mySessions.slice(0, 11)"
          :key="session.id"
          class="group relative flex aspect-[4/3] flex-col justify-between overflow-hidden rounded-2xl border border-white/[0.08] bg-[#1a1a1a] p-3 text-left transition hover:border-[#6366f1]/40 hover:bg-[#1f1f24]"
        >
          <div
            :ref="(el) => setMenuRef(session.id, el as HTMLElement | null)"
            class="absolute right-2 top-2 z-10"
          >
            <button
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded-lg bg-black/50 text-white/70 opacity-0 transition hover:bg-black/70 hover:text-white group-hover:opacity-100"
              :class="{ 'opacity-100': openMenuId === session.id }"
              title="更多操作"
              @click.stop="toggleMenu(session.id)"
            >
              <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="5" cy="12" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="19" cy="12" r="2" />
              </svg>
            </button>
            <div
              v-if="openMenuId === session.id"
              class="neo-popover absolute right-0 top-full mt-1 min-w-[120px] rounded-xl py-1"
              @click.stop
            >
              <button
                type="button"
                class="neo-popover-item flex w-full px-3 py-2 text-left text-xs"
                @click="renameSession(session)"
              >
                重命名
              </button>
              <button
                type="button"
                class="neo-popover-item flex w-full px-3 py-2 text-left text-xs"
                @click="duplicateSession(session)"
              >
                复制副本
              </button>
              <button
                type="button"
                class="neo-popover-item flex w-full px-3 py-2 text-left text-xs text-red-400"
                @click="deleteSession(session)"
              >
                删除
              </button>
            </div>
          </div>
          <button
            type="button"
            class="flex flex-1 flex-col justify-between text-left"
            @click="openCanvas(session.id)"
          >
            <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-[#6366f1]/15 text-[#818cf8]">
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 2h6m-3-3v6" />
              </svg>
            </div>
            <div class="min-w-0">
              <p class="truncate text-[13px] font-medium text-white/85 group-hover:text-white">
                {{ session.title || '未命名画布' }}
              </p>
              <p class="mt-0.5 text-[10px] text-white/35">{{ formatSessionTime(session.updatedAt) }}</p>
            </div>
          </button>
        </div>
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
        <button class="btn-ghost text-sm" @click="openPublish">发布作品</button>
      </div>

      <div v-if="loading" class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <div v-for="i in 8" :key="i" class="aspect-video animate-pulse rounded-2xl bg-[#1a1a1a]" />
      </div>

      <div v-else class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
    </section>

    <PublishNeoTVDialog
      v-model="showPublish"
      :sessions="userSessions"
      :default-title="prompt || userSessions[0]?.title"
      @published="fetchWorks"
      @locate-node="handlePublishLocateNode"
    />
  </div>
</template>
