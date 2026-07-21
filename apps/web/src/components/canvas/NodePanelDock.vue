<script setup lang="ts">
import { ref } from 'vue'
import { CANVAS_DOCK_MENU_ITEMS } from '@/components/canvas/canvasDockMenu'
import CanvasAssetPanel, { type CanvasAssetItem } from '@/components/canvas/CanvasAssetPanel.vue'
import CanvasTaskHistoryPanel from '@/components/canvas/CanvasTaskHistoryPanel.vue'
import DockTypeIcon from '@/components/canvas/dock-studio/shared/DockTypeIcon.vue'
import { useClickOutside } from '@/composables/useClickOutside'

export type DockNodeType =
  | 'text'
  | 'prompt'
  | 'image'
  | 'video'
  | 'audio'
  | 'sceneComposer'
  | 'mediaInput'
  | 'videoComposition'
  | 'worldModel'
  | 'group'
  | 'shot'

withDefaults(
  defineProps<{
    assets?: CanvasAssetItem[]
  }>(),
  { assets: () => [] },
)

const emit = defineEmits<{
  add: [type: DockNodeType]
  'open-settings': []
  'asset-apply': [asset: CanvasAssetItem]
  'asset-upload': []
}>()

const showMenu = ref(false)
const showAssets = ref(false)
const showHistory = ref(false)
const rootRef = ref<HTMLElement | null>(null)

const menuItems = CANVAS_DOCK_MENU_ITEMS

function add(type: DockNodeType) {
  emit('add', type)
  showMenu.value = false
}

function closePopovers() {
  showMenu.value = false
  showAssets.value = false
  showHistory.value = false
}

function toggleMenu() {
  const next = !showMenu.value
  closePopovers()
  showMenu.value = next
}

function toggleAssets() {
  const next = !showAssets.value
  closePopovers()
  showAssets.value = next
}

function toggleHistory() {
  const next = !showHistory.value
  closePopovers()
  showHistory.value = next
}

useClickOutside(rootRef, closePopovers)
</script>

<template>
  <!-- top-[60px]：让出上方返回首页/标题栏，避免遮挡 -->
  <div
    ref="rootRef"
    class="node-panel-dock pointer-events-none absolute left-3 top-[60px] z-[50]"
  >
    <div class="pointer-events-auto relative">
      <!-- 竖向面板：添加节点 + 资产库 + 任务历史 + 模型设置 -->
      <div
        class="vertical-capsule neo-chrome flex flex-col items-stretch gap-0.5 rounded-2xl p-1"
      >
        <button
          type="button"
          class="rail-btn"
          :class="showMenu ? 'is-active' : ''"
          title="添加节点"
          @click.stop="toggleMenu"
        >
          <span class="rail-circle rail-circle-primary">
            <svg
              class="h-[18px] w-[18px] transition-transform duration-200"
              :class="showMenu ? 'rotate-45' : ''"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.25" d="M12 4v16m8-8H4" />
            </svg>
          </span>
          <span class="rail-btn-label rail-btn-label-primary">添加</span>
        </button>

        <button
          type="button"
          class="rail-btn"
          :class="showAssets ? 'is-active' : ''"
          title="资产库"
          @click.stop="toggleAssets"
        >
          <span class="rail-circle">
            <svg class="h-[16px] w-[16px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.75"
                d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
              />
            </svg>
          </span>
          <span class="rail-btn-label">资产库</span>
          <span
            v-if="assets.length"
            class="absolute right-1 top-0 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-[var(--neo-accent)] px-0.5 text-[8px] font-semibold text-white"
          >
            {{ assets.length > 99 ? '99+' : assets.length }}
          </span>
        </button>

        <button
          type="button"
          class="rail-btn"
          :class="showHistory ? 'is-active' : ''"
          title="任务历史"
          @click.stop="toggleHistory"
        >
          <span class="rail-circle">
            <svg class="h-[16px] w-[16px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <circle cx="12" cy="12" r="9" stroke-width="1.75" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M12 7v5l3 2" />
            </svg>
          </span>
          <span class="rail-btn-label">历史</span>
        </button>

        <span class="mx-auto my-0.5 h-px w-8 bg-[var(--neo-border)]" />

        <button
          type="button"
          class="rail-btn"
          title="模型服务配置"
          @click.stop="emit('open-settings')"
        >
          <span class="rail-circle">
            <svg class="h-[16px] w-[16px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <circle cx="12" cy="12" r="3" stroke-width="1.75" />
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.75"
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
              />
            </svg>
          </span>
          <span class="rail-btn-label">设置</span>
        </button>
      </div>

      <Transition name="menu-pop">
        <div
          v-if="showMenu"
          class="add-menu-popover neo-popover absolute left-[calc(100%+10px)] top-0 max-h-[min(420px,70vh)] w-[268px] overflow-y-auto rounded-2xl p-2"
          @click.stop
        >
          <p class="popover-caption mb-2 px-2 text-[10px] uppercase tracking-wider">添加节点</p>
          <button
            v-for="item in menuItems"
            :key="item.type"
            type="button"
            class="neo-popover-item flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left"
            @click="add(item.type)"
          >
            <span
              class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
              :class="item.tone"
            >
              <DockTypeIcon :type="item.type" :size="14" />
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="popover-item-title text-[13px]">{{ item.label }}</span>
                <span v-if="item.badge" class="rounded bg-[var(--neo-accent-soft)] px-1.5 py-0.5 text-[9px] text-[var(--neo-accent-text)]">
                  {{ item.badge }}
                </span>
              </div>
              <p v-if="item.desc" class="popover-item-desc mt-0.5 text-[10px]">{{ item.desc }}</p>
            </div>
          </button>
        </div>
      </Transition>

      <Transition name="menu-pop">
        <div
          v-if="showAssets"
          class="asset-popover neo-popover absolute left-[calc(100%+10px)] top-0 overflow-hidden rounded-2xl"
          @click.stop
        >
          <CanvasAssetPanel
            :assets="assets"
            @apply="emit('asset-apply', $event)"
            @upload="emit('asset-upload')"
          />
        </div>
      </Transition>

      <Transition name="menu-pop">
        <div
          v-if="showHistory"
          class="history-popover neo-popover absolute left-[calc(100%+10px)] top-0 overflow-hidden rounded-2xl"
          @click.stop
        >
          <CanvasTaskHistoryPanel />
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.rail-btn {
  @apply relative flex w-[52px] flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 transition;
  color: var(--neo-text-muted);
}
.rail-btn:hover {
  background: var(--neo-hover-bg);
  color: var(--neo-accent-text);
}
.rail-btn.is-active {
  background: var(--neo-accent-soft);
  color: var(--neo-accent-text);
}

/* 统一大小的圆形图标底座 */
.rail-circle {
  @apply flex h-9 w-9 items-center justify-center rounded-full transition;
  border: 1px solid var(--neo-border);
  background: var(--neo-hover-bg);
}
.rail-btn:hover .rail-circle {
  border-color: var(--neo-border-strong);
  background: var(--neo-active-bg);
}
.rail-btn.is-active .rail-circle {
  border-color: var(--neo-accent-border);
  background: var(--neo-accent-soft);
}

/* 添加节点：品牌渐变凸显 */
.rail-circle-primary,
.rail-btn:hover .rail-circle-primary,
.rail-btn.is-active .rail-circle-primary {
  border-color: transparent;
  background: var(--neo-brand-gradient);
  color: #fff;
  box-shadow: 0 0 16px rgba(109, 93, 252, 0.45);
}
.rail-btn:hover .rail-circle-primary {
  box-shadow: 0 0 22px rgba(109, 93, 252, 0.6);
}

.rail-btn-label {
  @apply text-[10px] leading-none;
}

.rail-btn-label-primary {
  color: var(--neo-text-primary);
}

.popover-caption {
  color: var(--neo-text-muted);
}

.popover-item-title {
  color: var(--neo-text-primary);
}

.popover-item-desc {
  color: var(--neo-text-muted);
}

.menu-pop-enter-active,
.menu-pop-leave-active {
  transition: opacity 0.18s ease, transform 0.2s cubic-bezier(0.34, 1.2, 0.64, 1);
}
.menu-pop-enter-from,
.menu-pop-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}
</style>
