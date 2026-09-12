<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

defineProps<{
  selectedIds: string[]
  screenPosition: { x: number; y: number } | null
  canGenerateVideo?: boolean
  canUngroup?: boolean
}>()

const emit = defineEmits<{
  group: []
  ungroup: []
  delete: []
  layout: []
  generateVideo: []
  download: [mode: 'full_package' | 'lightweight' | 'media_list_only']
  addAgentRef: []
  duplicate: []
  duplicateUpstream: []
}>()

const exportMenuOpen = ref(false)

function closeExportMenu() {
  exportMenuOpen.value = false
}

function onExport(mode: 'full_package' | 'lightweight' | 'media_list_only') {
  exportMenuOpen.value = false
  emit('download', mode)
}

function onDocClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (!target?.closest('[data-export-menu]')) {
    closeExportMenu()
  }
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
})
</script>

<template>
  <div
    v-if="screenPosition && (selectedIds.length >= 2 || (canUngroup && selectedIds.length >= 1))"
    class="multi-select-toolbar pointer-events-none absolute z-[46]"
    :style="{
      left: `${screenPosition.x}px`,
      top: `${screenPosition.y}px`,
      transform: 'translate(-50%, 0)',
    }"
  >
    <div
      class="neo-chrome pointer-events-auto flex items-center gap-1 rounded-xl px-1.5 py-1"
      @click.stop
    >
      <span class="px-2 text-[10px] text-[var(--neo-text-muted)]">已选 {{ selectedIds.length }}</span>
      <button
        v-if="canGenerateVideo"
        type="button"
        class="toolbar-action accent"
        @click="emit('generateVideo')"
      >
        生成视频
      </button>
      <button
        v-if="canUngroup"
        type="button"
        class="toolbar-action"
        @click="emit('ungroup')"
      >
        解组
      </button>
      <button
        v-if="!canUngroup && selectedIds.length >= 2"
        type="button"
        class="toolbar-action"
        @click="emit('group')"
      >
        打组
      </button>
      <button
        v-if="selectedIds.length >= 2"
        type="button"
        class="toolbar-action"
        @click="emit('duplicate')"
      >
        新建副本
      </button>
      <button
        v-if="selectedIds.length >= 2"
        type="button"
        class="toolbar-action"
        @click="emit('duplicateUpstream')"
      >
        新建副本（含上游）
      </button>
      <button
        v-if="selectedIds.length >= 2"
        type="button"
        class="toolbar-action accent"
        @click="emit('addAgentRef')"
      >
        加入 Agent 引用
      </button>
      <button
        v-if="selectedIds.length >= 2"
        type="button"
        class="toolbar-action"
        @click="emit('layout')"
      >
        整理布局
      </button>
      <div
        v-if="selectedIds.length >= 2"
        class="relative"
        data-export-menu
      >
        <button
          type="button"
          class="toolbar-action"
          @click.stop="exportMenuOpen = !exportMenuOpen"
        >
          导出工作流
        </button>
        <div
          v-if="exportMenuOpen"
          class="export-menu neo-chrome absolute left-0 top-full z-50 mt-1 min-w-[11rem] rounded-lg py-1"
        >
          <button
            type="button"
            class="export-menu-item"
            @click="onExport('full_package')"
          >
            导出工作流
          </button>
          <button
            type="button"
            class="export-menu-item"
            @click="onExport('lightweight')"
          >
            导出工作流（仅 JSON）
          </button>
          <button
            type="button"
            class="export-menu-item"
            @click="onExport('media_list_only')"
          >
            仅导出媒体清单
          </button>
        </div>
      </div>
      <button type="button" class="toolbar-action danger" @click="emit('delete')">删除</button>
    </div>
  </div>
</template>

<style scoped>
.toolbar-action {
  @apply rounded-lg px-2.5 py-1 text-xs transition;
  color: var(--neo-text-secondary);
}
.toolbar-action:hover {
  background: var(--neo-hover-bg);
  color: var(--neo-text-primary);
}
.toolbar-action.danger {
  color: #f87171;
}
.toolbar-action.danger:hover {
  color: #fca5a5;
}
.toolbar-action.accent {
  color: var(--neo-accent-text);
}
.export-menu {
  background: var(--neo-chrome-bg, rgba(20, 20, 24, 0.96));
  border: 1px solid var(--neo-border, rgba(255, 255, 255, 0.08));
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}
.export-menu-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.4rem 0.75rem;
  font-size: 12px;
  color: var(--neo-text-secondary);
  background: transparent;
}
.export-menu-item:hover {
  background: var(--neo-hover-bg);
  color: var(--neo-text-primary);
}
</style>
