<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import type { DockNodeType } from '@/components/canvas/NodePanelDock.vue'
import { CANVAS_DOCK_MENU_ITEMS } from '@/components/canvas/canvasDockMenu'
import DockTypeIcon from '@/components/canvas/dock-studio/shared/DockTypeIcon.vue'

const props = defineProps<{
  x: number
  y: number
  allowedTypes?: DockNodeType[]
}>()

const emit = defineEmits<{
  select: [type: DockNodeType]
  close: []
}>()

const items = computed(() => {
  if (!props.allowedTypes?.length) return CANVAS_DOCK_MENU_ITEMS
  const allowed = new Set(props.allowedTypes)
  return CANVAS_DOCK_MENU_ITEMS.filter((item) => allowed.has(item.type))
})

const style = computed(() => {
  const maxW = 268
  const maxH = 420
  const margin = 12
  let left = props.x
  let top = props.y
  if (typeof window !== 'undefined') {
    if (left + maxW + margin > window.innerWidth) left = window.innerWidth - maxW - margin
    if (top + maxH + margin > window.innerHeight) top = window.innerHeight - maxH - margin
    left = Math.max(margin, left)
    top = Math.max(margin, top)
  }
  return { left: `${left}px`, top: `${top}px` }
})

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => document.addEventListener('keydown', onDocumentKeydown))
onUnmounted(() => document.removeEventListener('keydown', onDocumentKeydown))
</script>

<template>
  <Teleport to="body">
    <div class="connect-node-picker-layer fixed inset-0 z-[120]" @click="emit('close')">
      <div
        class="connect-node-picker pointer-events-auto fixed w-[268px] max-h-[min(420px,70vh)] overflow-y-auto rounded-2xl border border-white/10 bg-[rgba(36,36,36,0.92)] p-2 shadow-2xl backdrop-blur-xl"
        :style="style"
        @click.stop
      >
        <p class="mb-2 px-2 text-[10px] uppercase tracking-wider text-white/30">选择节点类型</p>
        <button
          v-for="item in items"
          :key="item.type"
          type="button"
          class="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/5"
          @click="emit('select', item.type)"
        >
          <span
            class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
            :class="item.tone"
          >
            <DockTypeIcon :type="item.type" :size="14" />
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
    </div>
  </Teleport>
</template>

<style scoped>
.connect-node-picker {
  box-shadow:
    0 12px 48px rgba(0, 0, 0, 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}
</style>
