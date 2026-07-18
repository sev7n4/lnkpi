<script setup lang="ts">
import { ref } from 'vue'
import { CANVAS_DOCK_MENU_ITEMS } from '@/components/canvas/canvasDockMenu'
import CanvasAssetPanel, { type CanvasAssetItem } from '@/components/canvas/CanvasAssetPanel.vue'
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
const rootRef = ref<HTMLElement | null>(null)

const menuItems = CANVAS_DOCK_MENU_ITEMS

function add(type: DockNodeType) {
  emit('add', type)
  showMenu.value = false
}

function toggleMenu() {
  showMenu.value = !showMenu.value
  if (showMenu.value) showAssets.value = false
}

function toggleAssets() {
  showAssets.value = !showAssets.value
  if (showAssets.value) showMenu.value = false
}

useClickOutside(rootRef, () => {
  showMenu.value = false
  showAssets.value = false
})
</script>

<template>
  <div
    ref="rootRef"
    class="node-panel-dock pointer-events-none absolute left-3 top-3 z-[50]"
  >
    <div class="pointer-events-auto relative">
      <!-- 竖向胶囊：添加节点 + 素材库 + 模型设置 -->
      <div
        class="vertical-capsule flex flex-col items-center gap-0.5 rounded-full border border-white/[0.08] bg-[rgba(22,22,22,0.94)] p-1 shadow-[0_8px_28px_rgba(0,0,0,0.42)] backdrop-blur-xl"
      >
        <button
          type="button"
          class="rail-btn text-[#818cf8]"
          :class="showMenu ? 'is-active' : ''"
          title="添加节点"
          @click.stop="toggleMenu"
        >
          <svg
            class="h-[18px] w-[18px] transition-transform duration-200"
            :class="showMenu ? 'rotate-45' : ''"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
        </button>

        <button
          type="button"
          class="rail-btn text-white/55"
          :class="showAssets ? 'is-active' : ''"
          title="素材库"
          @click.stop="toggleAssets"
        >
          <svg class="h-[17px] w-[17px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span
            v-if="assets.length"
            class="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-[#6366f1] px-0.5 text-[8px] font-semibold text-white"
          >
            {{ assets.length > 99 ? '99+' : assets.length }}
          </span>
        </button>

        <span class="my-0.5 h-px w-5 bg-white/[0.08]" />

        <button
          type="button"
          class="rail-btn text-white/55"
          title="模型服务配置"
          @click.stop="emit('open-settings')"
        >
          <svg class="h-[17px] w-[17px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.75"
              d="M12 6V4m0 16v-2M6 12H4m16 0h-2M7.05 7.05l-1.4-1.4m12.7 12.7-1.4-1.4M7.05 16.95l-1.4 1.4m12.7-12.7-1.4 1.4"
            />
            <circle cx="12" cy="12" r="3" stroke-width="1.75" />
          </svg>
        </button>
      </div>

      <Transition name="menu-pop">
        <div
          v-if="showMenu"
          class="add-menu-popover absolute left-[calc(100%+10px)] top-0 max-h-[min(420px,70vh)] w-[268px] overflow-y-auto rounded-2xl border border-white/10 bg-[#242424] p-2 shadow-2xl"
          @click.stop
        >
          <p class="mb-2 px-2 text-[10px] uppercase tracking-wider text-white/30">添加节点</p>
          <button
            v-for="item in menuItems"
            :key="item.type"
            type="button"
            class="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/5"
            @click="add(item.type)"
          >
            <span
              class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-medium"
              :class="item.tone"
            >
              {{ item.label.slice(0, 1) }}
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="text-[13px] text-white/90">{{ item.label }}</span>
                <span v-if="item.badge" class="rounded bg-[#6366f1]/20 px-1.5 py-0.5 text-[9px] text-[#818cf8]">
                  {{ item.badge }}
                </span>
              </div>
              <p v-if="item.desc" class="mt-0.5 text-[10px] text-white/40">{{ item.desc }}</p>
            </div>
          </button>
        </div>
      </Transition>

      <Transition name="menu-pop">
        <div
          v-if="showAssets"
          class="asset-popover absolute left-[calc(100%+10px)] top-0 overflow-hidden rounded-2xl border border-white/10 bg-[#242424] shadow-2xl"
          @click.stop
        >
          <CanvasAssetPanel
            :assets="assets"
            @apply="emit('asset-apply', $event)"
            @upload="emit('asset-upload')"
          />
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.rail-btn {
  @apply relative flex h-9 w-9 items-center justify-center rounded-full transition;
}
.rail-btn:hover {
  @apply bg-white/[0.06] text-[#a5b4fc];
}
.rail-btn.is-active {
  @apply bg-[#6366f1]/15 text-[#a5b4fc];
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
