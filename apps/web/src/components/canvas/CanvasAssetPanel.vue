<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { assetsApi } from '@/services/assets-api'

export interface CanvasAssetItem {
  id: string
  nodeId: string
  url: string
  label: string
  kind: 'image' | 'video' | 'audio' | 'other'
  /** 资产产生时间（毫秒时间戳），用于时间线分组 */
  createdAt?: number
  /** user = 画布同步的用户资产；public = 平台发布的公共资产 */
  source?: 'user' | 'public'
}

const props = defineProps<{
  assets: CanvasAssetItem[]
}>()

const emit = defineEmits<{
  apply: [asset: CanvasAssetItem]
  upload: []
}>()

type AssetTab = 'user' | 'public'
type AssetKindFilter = 'all' | 'image' | 'video' | 'audio'

const tab = ref<AssetTab>('user')
const kindFilter = ref<AssetKindFilter>('all')
const search = ref('')

const publicAssets = ref<CanvasAssetItem[]>([])
const publicLoading = ref(false)
const publicLoaded = ref(false)

const kindOptions: Array<{ value: AssetKindFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' },
]

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
  void loadPublicAssets()
})

function switchTab(next: AssetTab) {
  tab.value = next
  if (next === 'public') void loadPublicAssets()
}

const activeAssets = computed<CanvasAssetItem[]>(() =>
  tab.value === 'user' ? props.assets : publicAssets.value,
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

function onDragStart(event: DragEvent, asset: CanvasAssetItem) {
  event.dataTransfer?.setData('application/lnkpi-asset', JSON.stringify(asset))
  event.dataTransfer?.setData('text/plain', asset.url)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
}
</script>

<template>
  <div class="flex max-h-[min(480px,60vh)] w-[312px] flex-col">
    <!-- 用户资产 / 公共资产 tab -->
    <div class="flex items-center gap-1 border-b border-white/[0.06] px-3 pt-2.5 pb-2">
      <button
        type="button"
        class="rounded-lg px-2.5 py-1 text-[11px] font-medium transition"
        :class="tab === 'user' ? 'bg-[#6366f1]/20 text-[#a5b4fc]' : 'text-white/50 hover:bg-white/5 hover:text-white/75'"
        @click="switchTab('user')"
      >
        我的资产
        <span class="ml-0.5 text-[9px] font-normal opacity-60">{{ assets.length }}</span>
      </button>
      <button
        type="button"
        class="rounded-lg px-2.5 py-1 text-[11px] font-medium transition"
        :class="tab === 'public' ? 'bg-[#6366f1]/20 text-[#a5b4fc]' : 'text-white/50 hover:bg-white/5 hover:text-white/75'"
        @click="switchTab('public')"
      >
        公共资产
      </button>
      <span class="flex-1" />
      <button
        v-if="tab === 'user'"
        type="button"
        class="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-[#818cf8] hover:bg-white/5"
        title="上传素材"
        @click="emit('upload')"
      >
        <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0-12l-4 4m4-4l4 4" />
        </svg>
        上传
      </button>
    </div>

    <!-- 分类检索：类型 chips + 关键词搜索 -->
    <div class="flex items-center gap-1.5 px-3 pt-2">
      <button
        v-for="opt in kindOptions"
        :key="opt.value"
        type="button"
        class="rounded-full px-2 py-0.5 text-[10px] transition"
        :class="kindFilter === opt.value
          ? 'bg-white/10 text-white/90'
          : 'text-white/40 hover:bg-white/5 hover:text-white/70'"
        @click="kindFilter = opt.value"
      >
        {{ opt.label }}
      </button>
    </div>
    <div class="px-3 pt-2">
      <input
        v-model="search"
        class="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] outline-none focus:border-[#6366f1]/40"
        placeholder="搜索资产..."
      >
    </div>

    <!-- 历史时间线 + 网格 -->
    <div class="min-h-0 flex-1 overflow-y-auto px-3 py-2">
      <p v-if="tab === 'public' && publicLoading" class="py-6 text-center text-[11px] text-white/30">
        加载公共资产中...
      </p>
      <p v-else-if="!timeline.length" class="py-6 text-center text-[11px] text-white/30">
        {{ tab === 'user' ? '画布中生成或上传的素材会同步到这里' : '暂无公共资产' }}
      </p>

      <div v-for="group in timeline" :key="group.label" class="mb-3 last:mb-1">
        <p class="mb-1.5 flex items-center gap-1.5 text-[10px] text-white/35">
          <span class="h-1 w-1 rounded-full bg-[#6366f1]/70" />
          {{ group.label }}
        </p>
        <div class="grid grid-cols-3 gap-1.5">
          <button
            v-for="asset in group.items"
            :key="asset.id"
            type="button"
            draggable="true"
            class="group relative aspect-square overflow-hidden rounded-lg border border-white/[0.06] bg-white/5 transition hover:border-[#6366f1]/50"
            :title="asset.label"
            @dragstart="onDragStart($event, asset)"
            @click="emit('apply', asset)"
          >
            <img
              v-if="asset.kind === 'image'"
              :src="asset.url"
              alt=""
              loading="lazy"
              class="h-full w-full object-cover"
            >
            <video
              v-else-if="asset.kind === 'video'"
              :src="asset.url"
              muted
              preload="metadata"
              class="h-full w-full object-cover"
            />
            <div v-else class="flex h-full w-full items-center justify-center text-white/35">
              <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19a3 3 0 11-6 0 3 3 0 016 0zm12-3a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>

            <!-- 类型角标 -->
            <span
              v-if="asset.kind !== 'image'"
              class="absolute left-1 top-1 rounded bg-black/60 px-1 py-px text-[8px] text-white/80"
            >
              {{ asset.kind === 'video' ? '视频' : '音频' }}
            </span>
            <span
              v-if="asset.source === 'public'"
              class="absolute right-1 top-1 rounded bg-[#6366f1]/80 px-1 py-px text-[8px] text-white"
            >
              公共
            </span>

            <!-- hover 显示名称 -->
            <span
              class="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-1 pb-0.5 pt-3 text-left text-[9px] text-white/85 opacity-0 transition group-hover:opacity-100"
            >
              {{ asset.label }}
            </span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
