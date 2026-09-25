<script setup lang="ts">
import { nextTick, ref, watch, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { persistMediaUrl } from '@/composables/useMediaUpload'
import { assetsApi, type UserAssetItem } from '@/services/assets-api'
import { sameOriginApiMediaUrl } from '@/services/media-url'

/**
 * 替换图选择器（2026-09-25 元素编辑/重绘芯片通用）：
 * 「+」入口 → 本地上传（persistMediaUrl 落库）或从资产库选一张图，
 * 作为该编辑项的替换对象参考图（生成时随 image/edit 传给模型做对象替换）。
 * 已选时显示小缩略，可 x 移除。
 * 弹层 Teleport 到 body（fixed，2026-09-25 用户反馈遮挡修复）：不受侧栏滚动容器 /
 * 浮层层叠裁剪；资产库网格全量加载、内部滚动（此前 slice 12 张不可滚，用户反馈）。
 */
defineProps<{
  modelValue?: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
}>()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const popRef = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
/** 弹层 fixed 定位（屏幕坐标）；below = 向下弹 */
const popPos = ref<{ left: number; top: number; below: boolean } | null>(null)

function placePop() {
  const el = rootRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const W = 216
  const H = 300
  const below = r.bottom + 8 + H <= window.innerHeight || r.top - 8 - H < 0
  popPos.value = {
    left: Math.min(Math.max(8, r.right - W), window.innerWidth - W - 8),
    top: below ? r.bottom + 6 : Math.max(8, r.top - 6 - H),
    below,
  }
}

async function toggleOpen() {
  open.value = !open.value
  if (open.value) {
    await nextTick()
    placePop()
    void loadAssets()
  }
}

// —— 资产库（我的图片） ——
const assets = ref<UserAssetItem[]>([])
const assetsLoading = ref(false)
const assetsLoaded = ref(false)

async function loadAssets() {
  if (assetsLoaded.value || assetsLoading.value) return
  assetsLoading.value = true
  try {
    const { data } = await assetsApi.listMine()
    assets.value = (data.data.items ?? []).filter((it) => it.kind === 'image')
    assetsLoaded.value = true
  } catch {
    /* 列表失败静默：入口仍有本地上传 */
  } finally {
    assetsLoading.value = false
  }
}

watch(open, (v) => {
  if (v) void loadAssets()
})

function onOutsidePointerDown(e: PointerEvent) {
  if (!open.value) return
  const t = e.target as Node
  if (rootRef.value && rootRef.value.contains(t)) return
  if (popRef.value && popRef.value.contains(t)) return
  open.value = false
}
onMounted(() => window.addEventListener('pointerdown', onOutsidePointerDown, true))
onUnmounted(() => window.removeEventListener('pointerdown', onOutsidePointerDown, true))

function pickLocal() {
  fileInput.value?.click()
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    ElMessage.warning('请选择图片文件')
    return
  }
  uploading.value = true
  const fallback = URL.createObjectURL(file)
  try {
    const url = await persistMediaUrl(file, fallback)
    if (url !== fallback) URL.revokeObjectURL(fallback)
    emit('update:modelValue', url)
    open.value = false
  } catch {
    URL.revokeObjectURL(fallback)
    ElMessage.error('上传失败，请重试')
  } finally {
    uploading.value = false
  }
}

function pickAsset(item: UserAssetItem) {
  emit('update:modelValue', item.url)
  open.value = false
}

function clearRef() {
  emit('update:modelValue', null)
}

function thumbUrl(url: string): string {
  return sameOriginApiMediaUrl(url)
}
</script>

<template>
  <span ref="rootRef" class="rip" @click.stop>
    <!-- 已选：显示替换图缩略 + x 移除 -->
    <span v-if="modelValue" class="rip__ref" title="替换图（点击 × 移除）">
      <img :src="thumbUrl(modelValue)" alt="替换图" class="rip__ref-img">
      <button
        type="button"
        class="rip__ref-clear"
        data-testid="rip-clear"
        aria-label="移除替换图"
        @click.stop="clearRef"
      >
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </span>

    <!-- 「+」入口 -->
    <button
      v-else
      type="button"
      class="rip__add"
      data-testid="rip-add"
      title="上传本地或从资产库选图，作为替换对象"
      aria-label="添加替换图"
      :disabled="uploading"
      @click.stop="toggleOpen"
    >
      <span v-if="uploading" class="rip__spin" aria-label="上传中" />
      <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>

    <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileChange">

    <!-- 弹层：本地上传 / 资产库（Teleport 到 body，全量资产可滚动） -->
    <Teleport to="body">
      <div
        v-if="open && popPos"
        ref="popRef"
        class="rip__pop"
        :class="{ 'is-above': !popPos.below }"
        :style="{ left: `${popPos.left}px`, top: `${popPos.top}px` }"
        data-testid="rip-pop"
        @pointerdown.stop
        @click.stop
      >
        <button type="button" class="rip__pop-item" data-testid="rip-local" @click="pickLocal">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 16V4m0 0-4 4m4-4 4 4" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
          上传本地图片
        </button>
        <div class="rip__pop-label">{{ assetsLoading ? '资产库加载中…' : '从资产库选择' }}</div>
        <div class="rip__pop-grid">
          <button
            v-for="a in assets"
            :key="a.id"
            type="button"
            class="rip__pop-cell"
            :title="a.label || '资产图片'"
            @click="pickAsset(a)"
          >
            <img :src="thumbUrl(a.url)" :alt="a.label || '资产图片'" loading="lazy">
          </button>
        </div>
        <p v-if="!assetsLoading && !assets.length" class="rip__pop-empty">资产库暂无图片</p>
      </div>
    </Teleport>
  </span>
</template>

<style scoped>
.rip { position: relative; display: inline-flex; align-items: center; }
.hidden { display: none; }

.rip__add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  color: var(--neo-text-muted);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.rip__add:hover:not(:disabled) {
  background: color-mix(in srgb, var(--neo-text) 10%, transparent);
  color: var(--neo-text);
}
.rip__add:disabled { cursor: not-allowed; opacity: 0.5; }

.rip__spin {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--neo-text) 25%, transparent);
  border-top-color: var(--neo-accent-text, #a89dff);
  animation: rip-spin 0.8s linear infinite;
}
@keyframes rip-spin { to { transform: rotate(360deg); } }

.rip__ref {
  position: relative;
  display: inline-flex;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  overflow: visible;
}
.rip__ref-img {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  object-fit: cover;
  border: 1px solid var(--neo-accent-text, #a89dff);
}
.rip__ref-clear {
  position: absolute;
  top: -5px;
  right: -5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #111;
  color: #fff;
  cursor: pointer;
  border: none;
}

.rip__pop {
  position: fixed;
  z-index: 4000;
  width: 216px;
  padding: 8px;
  border-radius: 10px;
  background: var(--neo-hi, #1c1c1e);
  border: 1px solid color-mix(in srgb, var(--neo-text) 14%, transparent);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rip__pop-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 7px;
  color: var(--neo-text);
  font-size: 12px;
  cursor: pointer;
}
.rip__pop-item:hover { background: color-mix(in srgb, var(--neo-text) 9%, transparent); }
.rip__pop-label {
  font-size: 10.5px;
  color: var(--neo-text-muted);
  padding: 0 2px;
}
.rip__pop-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  max-height: 220px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.rip__pop-cell {
  aspect-ratio: 1;
  border-radius: 6px;
  overflow: hidden;
  padding: 0;
  border: none;
  cursor: pointer;
  background: color-mix(in srgb, var(--neo-text) 6%, transparent);
}
.rip__pop-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
.rip__pop-cell:hover { outline: 1.5px solid var(--neo-accent-text, #a89dff); }
.rip__pop-empty {
  margin: 0;
  font-size: 10.5px;
  color: var(--neo-text-muted);
}
</style>
