<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { assetsApi } from '@/services/assets-api'
import { assetLibraryVersion, bumpAssetLibrary, saveAssetToLibrary } from '@/composables/useAssetLibrary'
import { fileToPersistedPayload } from '@/composables/useMediaUpload'
import { resolveMediaUrl } from '@/services/api-base'
import { useCanvasEditorStore } from '@/stores/canvasEditor'

export interface CanvasAssetItem {
  id: string
  nodeId: string
  url: string
  label: string
  kind: 'image' | 'video' | 'audio' | 'other'
  /** 资产产生时间（毫秒时间戳），用于时间线分组 */
  createdAt?: number
  /** user = 用户全局资产库；public = 平台发布的公共资产 */
  source?: 'user' | 'public'
}

const emit = defineEmits<{
  apply: [asset: CanvasAssetItem]
}>()

const editor = useCanvasEditorStore()

type AssetTab = 'user' | 'public'
type AssetKindFilter = 'all' | 'image' | 'video' | 'audio'

const tab = ref<AssetTab>('user')
const kindFilter = ref<AssetKindFilter>('all')
const search = ref('')

const userAssets = ref<CanvasAssetItem[]>([])
const userLoading = ref(false)
const publicAssets = ref<CanvasAssetItem[]>([])
const publicLoading = ref(false)
const publicLoaded = ref(false)
const uploading = ref(false)
const uploadProgress = ref(0)
const fileInput = ref<HTMLInputElement | null>(null)

const loggedIn = computed(() => Boolean(localStorage.getItem('token')))

const kindOptions: Array<{ value: AssetKindFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' },
]

async function loadUserAssets() {
  if (!loggedIn.value) {
    userAssets.value = []
    return
  }
  userLoading.value = true
  try {
    const res = await assetsApi.listMine()
    userAssets.value = (res.data?.data?.items ?? []).map((item) => ({
      id: item.id,
      nodeId: item.sourceNodeId ?? '',
      url: item.url,
      label: item.label,
      kind: item.kind,
      createdAt: Date.parse(item.createdAt) || undefined,
      source: 'user' as const,
    }))
  } catch {
    // 加载失败留空，切换 tab 或保存资产后会重试
  } finally {
    userLoading.value = false
  }
}

async function loadPublicAssets() {
  if (publicLoaded.value || publicLoading.value) return
  publicLoading.value = true
  try {
    const res = await assetsApi.listPublic()
    publicAssets.value = (res.data?.data?.items ?? []).map((item) => ({
      id: item.id,
      nodeId: '',
      url: item.url,
      label: item.label,
      kind: item.kind,
      createdAt: Date.parse(item.publishedAt) || undefined,
      source: 'public' as const,
    }))
    publicLoaded.value = true
  } catch {
    // 公共资产加载失败时留空，用户切换 tab 可重试
  } finally {
    publicLoading.value = false
  }
}

onMounted(() => {
  void loadUserAssets()
  void loadPublicAssets()
})

// 节点侧「存入资产库」成功后自动刷新
watch(assetLibraryVersion, () => {
  void loadUserAssets()
})

function switchTab(next: AssetTab) {
  tab.value = next
  if (next === 'public') void loadPublicAssets()
  if (next === 'user') void loadUserAssets()
}

const activeAssets = computed<CanvasAssetItem[]>(() =>
  tab.value === 'user' ? userAssets.value : publicAssets.value,
)

const filtered = computed(() => {
  let items = activeAssets.value
  if (kindFilter.value !== 'all') {
    items = items.filter((a) => a.kind === kindFilter.value)
  }
  const q = search.value.trim().toLowerCase()
  if (q) {
    items = items.filter((a) => a.label.toLowerCase().includes(q))
  }
  return items
})

interface TimelineGroup {
  label: string
  items: CanvasAssetItem[]
}

function dayLabel(ts: number) {
  const date = new Date(ts)
  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

const timeline = computed<TimelineGroup[]>(() => {
  const withTime = filtered.value
    .filter((a) => a.createdAt)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  const withoutTime = filtered.value.filter((a) => !a.createdAt)

  const groups: TimelineGroup[] = []
  const index = new Map<string, TimelineGroup>()
  for (const asset of withTime) {
    const label = dayLabel(asset.createdAt as number)
    let group = index.get(label)
    if (!group) {
      group = { label, items: [] }
      index.set(label, group)
      groups.push(group)
    }
    group.items.push(asset)
  }
  if (withoutTime.length) {
    groups.push({ label: '更早', items: withoutTime })
  }
  return groups
})

function displayUrl(asset: CanvasAssetItem) {
  return resolveMediaUrl(asset.url)
}

/** 点击 = 预览 */
function preview(asset: CanvasAssetItem) {
  if (asset.kind === 'other') return
  editor.openMediaPreview({
    url: displayUrl(asset),
    kind: asset.kind,
    label: asset.label,
  })
}

/** hover 操作：加载到当前画布（选中节点则作为引用，否则新建节点） */
function apply(asset: CanvasAssetItem) {
  emit('apply', asset)
}

async function removeAsset(asset: CanvasAssetItem) {
  try {
    await assetsApi.removeMine(asset.id)
    bumpAssetLibrary()
  } catch {
    ElMessage.error('删除失败，请稍后重试')
  }
}

async function renameAsset(asset: CanvasAssetItem) {
  if (asset.kind === 'other') return
  let value: string
  try {
    const result = await ElMessageBox.prompt('输入新的资产名称', '重命名', {
      inputValue: asset.label,
      inputPattern: /\S/,
      inputErrorMessage: '名称不能为空',
      confirmButtonText: '保存',
      cancelButtonText: '取消',
    })
    value = result.value.trim()
  } catch {
    return
  }
  if (!value || value === asset.label) return
  try {
    // POST /assets/mine 对同一 url 幂等 upsert，直接用于更新标签
    await assetsApi.saveMine({ kind: asset.kind, url: asset.url, label: value })
    bumpAssetLibrary()
  } catch {
    ElMessage.error('重命名失败，请稍后重试')
  }
}

function openUploadPicker() {
  if (!loggedIn.value) {
    ElMessage.warning('登录后才能上传到资产库')
    return
  }
  fileInput.value?.click()
}

async function onUploadChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploading.value = true
  uploadProgress.value = 0
  try {
    const payload = await fileToPersistedPayload(file, {
      onProgress: (p) => {
        uploadProgress.value = p
      },
    })
    if (payload.kind !== 'image' && payload.kind !== 'video' && payload.kind !== 'audio') {
      ElMessage.warning('仅支持图片、视频、音频文件')
      return
    }
    await saveAssetToLibrary({ kind: payload.kind, url: payload.url, label: payload.fileName })
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '上传失败')
  } finally {
    uploading.value = false
    uploadProgress.value = 0
  }
}

function onDragStart(event: DragEvent, asset: CanvasAssetItem) {
  event.dataTransfer?.setData('application/lnkpi-asset', JSON.stringify(asset))
  event.dataTransfer?.setData('text/plain', asset.url)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
}
</script>

<template>
  <div class="flex max-h-[min(480px,60vh)] w-[312px] flex-col">
    <!-- 我的资产（全局） / 公共资产 tab -->
    <div class="flex items-center gap-1 border-b border-[var(--neo-border)] px-3 pt-2.5 pb-2">
      <button
        type="button"
        class="rounded-lg px-2.5 py-1 text-[11px] font-medium transition"
        :class="tab === 'user' ? 'bg-[var(--neo-accent-soft)] text-[var(--neo-accent-text)]' : 'text-[var(--neo-text-muted)] hover:bg-[var(--neo-hover-bg)] hover:text-[var(--neo-text-secondary)]'"
        @click="switchTab('user')"
      >
        我的资产
        <span class="ml-0.5 text-[9px] font-normal opacity-60">{{ userAssets.length }}</span>
      </button>
      <button
        type="button"
        class="rounded-lg px-2.5 py-1 text-[11px] font-medium transition"
        :class="tab === 'public' ? 'bg-[var(--neo-accent-soft)] text-[var(--neo-accent-text)]' : 'text-[var(--neo-text-muted)] hover:bg-[var(--neo-hover-bg)] hover:text-[var(--neo-text-secondary)]'"
        @click="switchTab('public')"
      >
        公共资产
      </button>
      <span class="flex-1" />
      <button
        v-if="tab === 'user'"
        type="button"
        class="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-[var(--neo-accent-text)] hover:bg-[var(--neo-hover-bg)]"
        :disabled="uploading"
        title="上传素材到资产库"
        @click="openUploadPicker"
      >
        <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0-12l-4 4m4-4l4 4" />
        </svg>
        {{ uploading ? (uploadProgress > 0 ? `上传 ${uploadProgress}%` : '上传中...') : '上传' }}
      </button>
      <input
        ref="fileInput"
        type="file"
        accept="image/*,video/*,audio/*"
        class="hidden"
        @change="onUploadChange"
      >
    </div>

    <!-- 分类检索：类型 chips + 关键词搜索 -->
    <div class="flex items-center gap-1.5 px-3 pt-2">
      <button
        v-for="opt in kindOptions"
        :key="opt.value"
        type="button"
        class="rounded-full px-2 py-0.5 text-[10px] transition"
        :class="kindFilter === opt.value
          ? 'bg-[var(--neo-active-bg)] text-[var(--neo-text-primary)]'
          : 'text-[var(--neo-text-muted)] hover:bg-[var(--neo-hover-bg)] hover:text-[var(--neo-text-secondary)]'"
        @click="kindFilter = opt.value"
      >
        {{ opt.label }}
      </button>
    </div>
    <div class="px-3 pt-2">
      <input
        v-model="search"
        class="w-full rounded-lg border border-[var(--neo-border)] bg-[var(--neo-hover-bg)] px-2 py-1.5 text-[11px] outline-none focus:border-[var(--neo-accent-border)]"
        placeholder="搜索资产..."
      >
    </div>

    <!-- 历史时间线 + 网格 -->
    <div class="min-h-0 flex-1 overflow-y-auto px-3 py-2">
      <p v-if="tab === 'user' && !loggedIn" class="py-6 text-center text-[11px] text-[var(--neo-text-muted)]">
        登录后可使用全局资产库
      </p>
      <p v-else-if="(tab === 'user' && userLoading) || (tab === 'public' && publicLoading)" class="py-6 text-center text-[11px] text-[var(--neo-text-muted)]">
        加载中...
      </p>
      <p v-else-if="!timeline.length" class="py-6 text-center text-[11px] text-[var(--neo-text-muted)]">
        {{ tab === 'user' ? '在节点上点「存入资产库」或在此上传素材' : '暂无公共资产' }}
      </p>

      <div v-for="group in timeline" :key="group.label" class="mb-3 last:mb-1">
        <p class="mb-1.5 flex items-center gap-1.5 text-[10px] text-[var(--neo-text-muted)]">
          <span class="h-1 w-1 rounded-full bg-[var(--neo-accent)]" />
          {{ group.label }}
        </p>
        <div class="grid grid-cols-3 gap-1.5">
          <div
            v-for="asset in group.items"
            :key="asset.id"
            role="button"
            tabindex="0"
            draggable="true"
            class="group relative aspect-square cursor-zoom-in overflow-hidden rounded-lg border border-[var(--neo-border)] bg-[var(--neo-hover-bg)] transition hover:border-[var(--neo-accent-border)]"
            :title="`${asset.label}（点击预览 · 可拖到画布新建节点 / 拖到底部工具条作引用）`"
            @dragstart="onDragStart($event, asset)"
            @click="preview(asset)"
            @keydown.enter="preview(asset)"
          >
            <img
              v-if="asset.kind === 'image'"
              :src="displayUrl(asset)"
              alt=""
              loading="lazy"
              class="h-full w-full object-cover"
            >
            <video
              v-else-if="asset.kind === 'video'"
              :src="displayUrl(asset)"
              muted
              preload="metadata"
              class="h-full w-full object-cover"
            />
            <div v-else class="flex h-full w-full items-center justify-center text-[var(--neo-text-muted)]">
              <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19a3 3 0 11-6 0 3 3 0 016 0zm12-3a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>

            <!-- 类型角标 -->
            <span
              v-if="asset.kind !== 'image'"
              class="absolute left-1 top-1 rounded bg-black/60 px-1 py-px text-[8px] text-white/85"
            >
              {{ asset.kind === 'video' ? '视频' : '音频' }}
            </span>
            <span
              v-if="asset.source === 'public'"
              class="absolute right-1 top-1 rounded bg-[var(--neo-accent)] px-1 py-px text-[8px] text-white"
            >
              公共
            </span>

            <!-- hover 操作层：加载到画布 / 删除 -->
            <div
              class="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-black/85 to-transparent px-1 pb-1 pt-4 opacity-0 transition group-hover:opacity-100"
            >
              <button
                type="button"
                class="rounded-md bg-white/90 px-1.5 py-0.5 text-[9px] font-medium text-black transition hover:bg-white"
                title="加载到当前画布"
                @click.stop="apply(asset)"
              >
                加载到画布
              </button>
              <button
                v-if="asset.source === 'user'"
                type="button"
                class="flex h-4 w-4 items-center justify-center rounded-md bg-black/60 text-white/80 transition hover:bg-black/85 hover:text-white"
                title="重命名"
                @click.stop="renameAsset(asset)"
              >
                <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
                </svg>
              </button>
              <button
                v-if="asset.source === 'user'"
                type="button"
                class="flex h-4 w-4 items-center justify-center rounded-md bg-black/60 text-white/80 transition hover:bg-red-500/90 hover:text-white"
                title="从资产库删除"
                @click.stop="removeAsset(asset)"
              >
                <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
