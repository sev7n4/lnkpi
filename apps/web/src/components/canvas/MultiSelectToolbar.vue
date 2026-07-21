<script setup lang="ts">
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
  download: []
}>()
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
        @click="emit('layout')"
      >
        整理布局
      </button>
      <button
        v-if="selectedIds.length >= 2"
        type="button"
        class="toolbar-action"
        @click="emit('download')"
      >
        打包下载
      </button>
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
</style>
