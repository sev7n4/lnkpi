<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
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

const emit = defineEmits<{
  add: [type: DockNodeType]
  'open-settings': []
  'asset-apply': [asset: CanvasAssetItem]
  'asset-add-to-agent': [asset: CanvasAssetItem]
  'history-locate': [payload: { recordId: string; nodeId?: string | null }]
  'history-retry': [nodeId: string]
}>()

const DOCK_PINNED_KEY = 'lnkpi:canvas-dock-pinned'

const showMenu = ref(false)
const showAssets = ref(false)
const showHistory = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const dockPinned = ref(true)
const dockRevealed = ref(true)
let dockHideTimer: number | null = null

const menuItems = CANVAS_DOCK_MENU_ITEMS

const popoverOpen = computed(() => showMenu.value || showAssets.value || showHistory.value)
const dockExpanded = computed(() => dockPinned.value || dockRevealed.value || popoverOpen.value)

onMounted(() => {
  try {
    const stored = localStorage.getItem(DOCK_PINNED_KEY)
    if (stored === '0') {
      dockPinned.value = false
      dockRevealed.value = false
    }
  } catch {
    /* ignore */
  }
})

watch(popoverOpen, (open) => {
  if (open) revealDock()
  else if (!dockPinned.value) scheduleHideDock()
})

function clearDockHideTimer() {
  if (dockHideTimer !== null) {
    window.clearTimeout(dockHideTimer)
    dockHideTimer = null
  }
}

function revealDock() {
  clearDockHideTimer()
  dockRevealed.value = true
}

function scheduleHideDock() {
  if (dockPinned.value || popoverOpen.value) return
  clearDockHideTimer()
  dockHideTimer = window.setTimeout(() => {
    dockRevealed.value = false
    dockHideTimer = null
  }, 320)
}

function toggleDockPinned() {
  dockPinned.value = !dockPinned.value
  try {
    localStorage.setItem(DOCK_PINNED_KEY, dockPinned.value ? '1' : '0')
  } catch {
    /* ignore */
  }
  if (dockPinned.value) {
    revealDock()
  } else {
    scheduleHideDock()
  }
}

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
  if (next) revealDock()
}

function toggleAssets() {
  const next = !showAssets.value
  closePopovers()
  showAssets.value = next
  if (next) revealDock()
}

function toggleHistory() {
  const next = !showHistory.value
  closePopovers()
  showHistory.value = next
  if (next) revealDock()
}

useClickOutside(rootRef, closePopovers)
</script>

<template>
  <!-- top-[60px]：让出上方返回首页/标题栏，避免遮挡 -->
  <div
    ref="rootRef"
    class="node-panel-dock pointer-events-none absolute left-3 top-[60px] z-[50]"
  >
    <!-- 自动隐藏：左侧热区（绝对定位，不参与布局，避免推开面板） -->
    <div
      v-if="!dockPinned"
      class="dock-auto-hide-zone pointer-events-auto"
      @mouseenter="revealDock"
    />

    <div
      class="dock-panel-wrap pointer-events-auto relative"
      :class="{ 'is-collapsed': !dockExpanded }"
      @mouseenter="revealDock"
      @mouseleave="scheduleHideDock"
    >
      <!-- 竖向面板：添加节点 + 资产库 + 任务 + 模型设置 + 常驻开关 -->
      <div
        class="vertical-capsule neo-glass-lite flex flex-col items-stretch gap-0.5 rounded-2xl p-1"
      >
        <button
          type="button"
          class="rail-btn"
          :class="showMenu ? 'is-active' : ''"
          title="添加节点"
          @click.stop="toggleMenu"
        >
          <span class="rail-circle rail-circle-prominent">
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
          <span class="rail-btn-label rail-btn-label-prominent">添加</span>
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
        </button>

        <button
          type="button"
          class="rail-btn"
          :class="showHistory ? 'is-active' : ''"
          title="任务"
          @click.stop="toggleHistory"
        >
          <span class="rail-circle">
            <svg class="h-[16px] w-[16px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.75"
                d="M9 5h11M9 12h11M9 19h11M5 5h.01M5 12h.01M5 19h.01"
              />
            </svg>
          </span>
          <span class="rail-btn-label">任务</span>
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

        <span class="mx-auto my-0.5 h-px w-8 bg-[var(--neo-border)]" />

        <button
          type="button"
          class="rail-btn dock-pin-toggle"
          :class="{ 'is-active': !dockPinned }"
          :title="dockPinned ? '菜单常驻（点击切换为隐藏）' : '菜单隐藏（移入左侧唤起，点击切换为常驻）'"
          :aria-pressed="!dockPinned"
          @click.stop="toggleDockPinned"
        >
          <span class="rail-circle">
            <svg
              v-if="dockPinned"
              class="h-[16px] w-[16px]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178Z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
            <svg
              v-else
              class="h-[16px] w-[16px]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
            </svg>
          </span>
          <span class="rail-btn-label">{{ dockPinned ? '常驻' : '隐藏' }}</span>
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
            class="neo-popover-item neo-popover-card-item flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left"
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
                <span v-if="item.badge" class="rounded bg-[var(--neo-active-bg)] px-1.5 py-0.5 text-[9px] text-[var(--neo-text-muted)]">
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
            @apply="emit('asset-apply', $event)"
            @add-to-agent="emit('asset-add-to-agent', $event)"
          />
        </div>
      </Transition>

      <Transition name="menu-pop">
        <div
          v-if="showHistory"
          class="history-popover neo-popover absolute left-[calc(100%+10px)] top-0 overflow-hidden rounded-2xl"
          @click.stop
        >
          <CanvasTaskHistoryPanel
            @locate="emit('history-locate', $event)"
            @retry="emit('history-retry', $event)"
          />
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.dock-auto-hide-zone {
  position: absolute;
  left: -12px;
  top: 0;
  width: 18px;
  min-height: 120px;
  height: 100%;
}

.dock-panel-wrap {
  transition:
    transform 0.28s cubic-bezier(0.32, 0.72, 0, 1),
    opacity 0.22s ease;
  transform: translateX(0);
  opacity: 1;
}

.dock-panel-wrap.is-collapsed {
  transform: translateX(calc(-100% - 8px));
  opacity: 0;
  pointer-events: none;
}

.rail-btn {
  @apply relative flex w-[52px] flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 transition;
  color: var(--neo-text-muted);
}
.rail-btn:hover {
  color: var(--neo-text-primary);
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
  border-color: color-mix(in srgb, var(--neo-hi-text) 30%, var(--neo-border));
  background: var(--neo-hi-bg);
  color: var(--neo-hi-text);
  box-shadow: var(--neo-hi-shadow);
}

/* 添加节点：常驻弱高亮（比点击激活略暗），提醒高频入口 */
.rail-circle-prominent {
  border-color: color-mix(in srgb, var(--neo-hi-text) 16%, var(--neo-border));
  background: color-mix(in srgb, var(--neo-hi-bg) 62%, var(--neo-hover-bg));
  color: var(--neo-hi-text);
  box-shadow: 0 1px 5px color-mix(in srgb, var(--neo-hi-text) 10%, transparent);
}
.rail-btn:hover .rail-circle-prominent {
  border-color: color-mix(in srgb, var(--neo-hi-text) 22%, var(--neo-border));
  background: color-mix(in srgb, var(--neo-hi-bg) 78%, var(--neo-hover-bg));
}

.rail-btn-label-prominent {
  color: var(--neo-text-primary);
}

.rail-btn-label {
  @apply text-[10px] leading-none;
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
