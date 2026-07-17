<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { CANVAS_DOCK_MENU_ITEMS } from '@/components/canvas/canvasDockMenu'

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
}>()

const showMenu = ref(false)
const rootRef = ref<HTMLElement | null>(null)

const menuItems = CANVAS_DOCK_MENU_ITEMS

function add(type: DockNodeType) {
  emit('add', type)
  showMenu.value = false
}

function onDocumentClick(event: MouseEvent) {
  if (!rootRef.value?.contains(event.target as Node)) {
    showMenu.value = false
  }
}

onMounted(() => document.addEventListener('click', onDocumentClick))
onUnmounted(() => document.removeEventListener('click', onDocumentClick))
</script>

<template>
  <div
    ref="rootRef"
    class="node-panel-dock pointer-events-none absolute left-3 top-3 z-[50]"
  >
    <div class="pointer-events-auto relative">
      <!-- 竖向胶囊：添加节点 + 模型设置 -->
      <div
        class="vertical-capsule flex flex-col items-center gap-0.5 rounded-full border border-white/[0.08] bg-[rgba(22,22,22,0.94)] p-1 shadow-[0_8px_28px_rgba(0,0,0,0.42)] backdrop-blur-xl"
      >
        <button
          type="button"
          class="rail-btn text-[#818cf8]"
          :class="showMenu ? 'is-active' : ''"
          title="添加节点"
          @click.stop="showMenu = !showMenu"
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
    </div>
  </div>
</template>

<style scoped>
.rail-btn {
  @apply flex h-9 w-9 items-center justify-center rounded-full transition;
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
