<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
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
import SessionCard from '@/components/workflow/SessionCard.vue'
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
const sessionSearch = ref('')
const showAllSessions = ref(false)
const manageSessions = ref(false)
const selectedSessionIds = ref<string[]>([])
const DEFAULT_VISIBLE_SESSIONS = 5

const filteredSessions = computed(() => {
  const q = sessionSearch.value.trim().toLowerCase()
  if (!q) return mySessions.value
  return mySessions.value.filter((s) => (s.title || '未命名画布').toLowerCase().includes(q))
})

const visibleSessions = computed(() => {
  if (showAllSessions.value || sessionSearch.value.trim()) return filteredSessions.value
  return filteredSessions.value.slice(0, DEFAULT_VISIBLE_SESSIONS)
})

const hasMoreSessions = computed(
  () => !sessionSearch.value.trim() && filteredSessions.value.length > DEFAULT_VISIBLE_SESSIONS,
)
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

function toggleMenu(sessionId: string) {
  openMenuId.value = openMenuId.value === sessionId ? null : sessionId
}

function closeMenu() {
  openMenuId.value = null
}

function toggleManageSessions() {
  manageSessions.value = !manageSessions.value
  selectedSessionIds.value = []
  closeMenu()
}

function toggleSessionSelect(sessionId: string) {
  const set = new Set(selectedSessionIds.value)
  if (set.has(sessionId)) set.delete(sessionId)
  else set.add(sessionId)
  selectedSessionIds.value = [...set]
}

async function batchDeleteSessions() {
  if (!selectedSessionIds.value.length) return
  try {
    await ElMessageBox.confirm(
      `确定删除选中的 ${selectedSessionIds.value.length} 个画布？此操作不可恢复。`,
      '批量删除',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  try {
    const { data } = await sessionsApi.removeMany(selectedSessionIds.value)
    await fetchMySessions()
    selectedSessionIds.value = []
    manageSessions.value = false
    ElMessage.success(`已删除 ${data.data.deleted} 个画布`)
  } catch {
    ElMessage.error('批量删除失败，请稍后重试')
  }
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!openMenuId.value) return
  const target = event.target as HTMLElement
  if (!target.closest('.session-card-menu-anchor')) closeMenu()
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
    router.push({
      path: `/workflow/${data.data.id}`,
      query: {
        openAgent: '1',
        ...(prompt.value.trim() ? { initialPrompt: prompt.value.trim() } : {}),
      },
    })
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
  <div class="mx-auto max-w-7xl px-4 pb-20 pt-6 sm:px-6 sm:pt-8">
    <section class="mb-10 text-center sm:mb-12">
      <div class="mb-4 flex justify-center">
        <BrandLogo size="xl" />
      </div>
      <h1 class="font-display text-2xl font-semibold sm:text-3xl md:text-4xl">
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
      <div class="mb-4 flex flex-wrap items-center gap-3">
        <h2 class="text-lg font-semibold text-[var(--neo-text-primary)]">我的画布</h2>
        <span v-if="mySessions.length" class="text-xs text-[var(--neo-text-muted)]">{{ filteredSessions.length }} 个</span>
        <span class="flex-1" />
        <input
          v-if="mySessions.length"
          v-model="sessionSearch"
          type="search"
          class="w-44 rounded-lg border border-[var(--neo-border)] bg-[var(--neo-hover-bg)] px-2.5 py-1.5 text-xs outline-none focus:border-[var(--neo-accent-border)]"
          placeholder="搜索画布..."
        >
        <button
          v-if="mySessions.length"
          type="button"
          class="rounded-lg px-2.5 py-1.5 text-xs transition"
          :class="manageSessions ? 'bg-[var(--neo-hi-bg)] text-[var(--neo-hi-text)]' : 'text-[var(--neo-text-muted)] hover:bg-[var(--neo-hover-bg)]'"
          @click="toggleManageSessions"
        >
          {{ manageSessions ? '完成' : '管理' }}
        </button>
        <button
          v-if="manageSessions && selectedSessionIds.length"
          type="button"
          class="rounded-lg bg-red-500/15 px-2.5 py-1.5 text-xs text-red-400 transition hover:bg-red-500/25"
          @click="batchDeleteSessions"
        >
          删除选中 ({{ selectedSessionIds.length }})
        </button>
      </div>
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <button
          v-if="!manageSessions"
          type="button"
          class="session-create-card flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed transition"
          @click="createCanvas"
        >
          <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M12 4v16m8-8H4" />
          </svg>
          <span class="text-xs font-medium">新建画布</span>
        </button>
        <SessionCard
          v-for="session in visibleSessions"
          :key="session.id"
          :session="session"
          :manage-mode="manageSessions"
          :selected="selectedSessionIds.includes(session.id)"
          :menu-open="openMenuId === session.id"
          class="session-card-menu-anchor"
          @open="openCanvas(session.id)"
          @toggle-menu="toggleMenu(session.id)"
          @rename="renameSession(session)"
          @duplicate="duplicateSession(session)"
          @delete="deleteSession(session)"
          @toggle-select="toggleSessionSelect(session.id)"
        />
      </div>
      <div v-if="hasMoreSessions" class="mt-4 text-center">
        <button
          type="button"
          class="rounded-lg px-4 py-2 text-xs text-[var(--neo-text-muted)] transition hover:bg-[var(--neo-hover-bg)] hover:text-[var(--neo-text-primary)]"
          @click="showAllSessions = !showAllSessions"
        >
          {{ showAllSessions ? '收起' : `查看更多（${filteredSessions.length - DEFAULT_VISIBLE_SESSIONS}）` }}
        </button>
      </div>
      <p v-if="sessionSearch && !filteredSessions.length" class="py-8 text-center text-sm text-[var(--neo-text-muted)]">
        没有匹配的画布
      </p>
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

<style scoped>
.session-create-card {
  border-color: var(--neo-border);
  background: color-mix(in srgb, var(--neo-hover-bg) 40%, transparent);
  color: var(--neo-text-muted);
}

.session-create-card:hover {
  border-color: color-mix(in srgb, var(--neo-hi-text) 35%, var(--neo-border));
  background: var(--neo-hover-bg);
  color: var(--neo-hi-text);
}
</style>
