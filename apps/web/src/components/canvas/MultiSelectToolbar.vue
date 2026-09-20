<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from 'vue'

const props = defineProps<{
  selectedIds: string[]
  screenPosition: { x: number; y: number } | null
  canGenerateVideo?: boolean
  canUngroup?: boolean
  selectionBatch?: {
    runCount: number
    /** 已完成节点的可重新生成数量（planner regenerate 模式） */
    regenCount?: number
    state: 'idle' | 'running' | 'stopping' | 'done'
    /** 整批阻断态：任一 pending_confirm 或超过 24 上限 */
    blocked?: 'pending_confirm' | 'limit_24'
    blockedCount?: number
  }
}>()

const emit = defineEmits<{
  group: []
  ungroup: []
  delete: []
  layout: [mode: 'along_edges' | 'grid']
  generateVideo: []
  download: [mode: 'full_package' | 'lightweight' | 'media_list_only']
  addAgentRef: []
  duplicate: []
  duplicateUpstream: []
  generateSelection: []
  generateRegen: []
  stopSelection: []
  blockedHint: [reason: 'pending_confirm' | 'limit_24']
}>()

const exportMenuOpen = ref(false)
const layoutMenuOpen = ref(false)

function closeExportMenu() {
  exportMenuOpen.value = false
}

function closeLayoutMenu() {
  layoutMenuOpen.value = false
}

function onGenerateClick() {
  if (props.selectionBatch && props.selectionBatch.state === 'idle' && props.selectionBatch.runCount > 0) {
    emit('generateSelection')
  } else {
    emit('stopSelection')
  }
}

function onRegenClick() {
  if (props.selectionBatch && props.selectionBatch.state === 'idle') {
    emit('generateRegen')
  } else {
    emit('stopSelection')
  }
}

const batchBlocked = computed(() => props.selectionBatch?.blocked ?? null)
const batchBlockedCount = computed(() => props.selectionBatch?.blockedCount ?? 0)
const batchRunCount = computed(() => props.selectionBatch?.runCount ?? 0)
const batchRegenCount = computed(() => props.selectionBatch?.regenCount ?? 0)
const showGenerateButton = computed(() => batchRunCount.value > 0 || (batchRegenCount.value === 0 && !batchBlocked.value))
const showRegenButton = computed(() => batchRegenCount.value > 0 && !batchBlocked.value)
const batchRunning = computed(() => props.selectionBatch?.state === 'running' || props.selectionBatch?.state === 'stopping')

function onBlockedClick() {
  if (batchBlocked.value) emit('blockedHint', batchBlocked.value)
}

const blockedTitle = computed(() => {
  if (batchBlocked.value === 'pending_confirm') {
    return '选区包含待确认节点，点击定位；请先在侧栏确认生成'
  }
  if (batchBlocked.value === 'limit_24') {
    return '选区可执行节点超过 24 个上限，请减少选区后重试'
  }
  return ''
})

function onExport(mode: 'full_package' | 'lightweight' | 'media_list_only') {
  exportMenuOpen.value = false
  emit('download', mode)
}

function onLayout(mode: 'along_edges' | 'grid') {
  layoutMenuOpen.value = false
  emit('layout', mode)
}

function onDocClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (!target?.closest('[data-export-menu]')) {
    closeExportMenu()
  }
  if (!target?.closest('[data-layout-menu]')) {
    closeLayoutMenu()
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
        v-if="batchBlocked"
        type="button"
        class="toolbar-action warn"
        data-testid="selection-batch-blocked"
        :title="blockedTitle"
        @click="onBlockedClick"
      >
        {{ batchBlocked === 'pending_confirm' ? `待确认 · ${batchBlockedCount}` : `超上限 · ${batchBlockedCount}` }}
      </button>
      <button
        v-if="showGenerateButton"
        type="button"
        class="toolbar-action accent"
        data-testid="selection-batch-generate"
        :disabled="!selectionBatch || (selectionBatch.state === 'idle' && selectionBatch.runCount === 0)"
        @click="onGenerateClick"
      >
        {{ batchRunning ? '停止全部' : `生成 · ${selectionBatch?.runCount ?? 0}` }}
      </button>
      <button
        v-if="showRegenButton"
        type="button"
        class="toolbar-action accent"
        data-testid="selection-batch-regenerate"
        :disabled="!selectionBatch"
        :title="`覆盖式重新生成 ${batchRegenCount} 个已完成节点，将覆盖现有产物并可能消耗积分`"
        @click="onRegenClick"
      >
        {{ batchRunning ? '停止全部' : `重新生成 · ${batchRegenCount}` }}
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
      <div
        v-if="selectedIds.length >= 2"
        class="relative"
        data-layout-menu
      >
        <button
          type="button"
          class="toolbar-action"
          @click.stop="layoutMenuOpen = !layoutMenuOpen; exportMenuOpen = false"
        >
          整理布局
        </button>
        <div
          v-if="layoutMenuOpen"
          class="export-menu neo-chrome absolute left-0 top-full z-50 mt-1 min-w-[8.5rem] rounded-lg py-1"
        >
          <button
            type="button"
            class="export-menu-item"
            @click="onLayout('along_edges')"
          >
            顺着连线
          </button>
          <button
            type="button"
            class="export-menu-item"
            @click="onLayout('grid')"
          >
            自动网格
          </button>
        </div>
      </div>
      <div
        v-if="selectedIds.length >= 2"
        class="relative"
        data-export-menu
      >
        <button
          type="button"
          class="toolbar-action"
          @click.stop="exportMenuOpen = !exportMenuOpen; layoutMenuOpen = false"
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
.toolbar-action.warn {
  color: #fbbf24;
}
.toolbar-action.warn:hover {
  color: #fcd34d;
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
