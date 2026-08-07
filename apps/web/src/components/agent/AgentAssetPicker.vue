<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { SidebarAttachment } from '@lnkpi/shared'
import { assetsApi, type UserAssetItem } from '@/services/assets-api'
import { resolveMediaUrl } from '@/services/api-base'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  pick: [attachment: SidebarAttachment]
}>()

const assets = ref<UserAssetItem[]>([])
const loading = ref(false)
const search = ref('')

const filteredAssets = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return assets.value
  return assets.value.filter((asset) => asset.label.toLowerCase().includes(query))
})

async function loadAssets() {
  loading.value = true
  try {
    const res = await assetsApi.listMine()
    assets.value = res.data?.data?.items ?? []
  } catch {
    assets.value = []
  } finally {
    loading.value = false
  }
}

function close() {
  emit('update:open', false)
}

function pick(asset: UserAssetItem) {
  emit('pick', {
    id: asset.id,
    mediaType: asset.kind,
    sourceKind: 'asset',
    label: asset.label,
    url: asset.url,
  })
  close()
}

watch(
  () => props.open,
  (open) => {
    if (open) void loadAssets()
  },
  { immediate: true },
)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="从资产库添加参考素材"
      @click.self="close"
    >
      <section class="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--neo-border)] bg-[var(--neo-popover-bg)] shadow-xl">
        <header class="flex items-center justify-between border-b border-[var(--neo-border)] px-4 py-3">
          <div>
            <h2 class="text-sm font-medium text-[var(--neo-text-primary)]">资产库</h2>
            <p class="mt-0.5 text-[11px] text-[var(--neo-text-muted)]">选择素材作为 Agent 参考</p>
          </div>
          <button type="button" class="agent-asset-close" aria-label="关闭资产库" @click="close">×</button>
        </header>

        <div class="border-b border-[var(--neo-border)] px-4 py-3">
          <input
            v-model="search"
            class="w-full rounded-lg border border-[var(--neo-border)] bg-[var(--neo-hover-bg)] px-3 py-2 text-xs outline-none focus:border-[var(--neo-accent-border)]"
            placeholder="搜索我的资产..."
          >
        </div>

        <div class="max-h-[min(420px,55vh)] overflow-y-auto p-3">
          <p v-if="loading" class="py-8 text-center text-xs text-[var(--neo-text-muted)]">加载中...</p>
          <p v-else-if="!filteredAssets.length" class="py-8 text-center text-xs text-[var(--neo-text-muted)]">
            {{ search ? '未找到匹配的资产' : '暂无可用资产' }}
          </p>
          <div v-else class="grid grid-cols-3 gap-2">
            <button
              v-for="asset in filteredAssets"
              :key="asset.id"
              type="button"
              data-testid="agent-asset-option"
              class="group overflow-hidden rounded-xl border border-[var(--neo-border)] bg-[var(--neo-hover-bg)] text-left transition hover:border-[var(--neo-accent-border)]"
              :title="`添加 ${asset.label} 为参考素材`"
              @click="pick(asset)"
            >
              <img
                v-if="asset.kind === 'image'"
                :src="resolveMediaUrl(asset.url)"
                :alt="asset.label"
                class="aspect-square w-full object-cover"
              >
              <div v-else class="flex aspect-square items-center justify-center text-xl text-[var(--neo-text-muted)]">
                {{ asset.kind === 'video' ? '▶' : '♫' }}
              </div>
              <p class="truncate px-2 py-1.5 text-[11px] text-[var(--neo-text-secondary)]">{{ asset.label }}</p>
            </button>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.agent-asset-close {
  display: flex;
  height: 28px;
  width: 28px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--neo-text-muted);
  font-size: 20px;
  line-height: 1;
}

.agent-asset-close:hover {
  background: var(--neo-hover-bg);
  color: var(--neo-text-primary);
}
</style>
