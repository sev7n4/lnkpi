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
    /** 整批阻断态：任一 pending_confirm、超过 24 上限、或纯缺提示词选区 */
    blocked?: 'pending_confirm' | 'limit_24' | 'missing_prompt'
    blockedCount?: number
    /** 缺提示词（无可尝试输入）节点数 */
    missingCount?: number
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
  blockedHint: [reason: 'pending_confirm' | 'limit_24' | 'missing_prompt']
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
const batchMissingCount = computed(() => props.selectionBatch?.missingCount ?? 0)
const batchRunning = computed(() => props.selectionBatch?.state === 'running' || props.selectionBatch?.state === 'stopping')
// 纯缺提示词选区：无可执行、无可重生成、无其他阻断 → 用「缺提示词」替代静默的「生成 · 0」
const showMissingButton = computed(() =>
  batchMissingCount.value > 0
  && batchRunCount.value === 0
  && batchRegenCount.value === 0
  && !batchBlocked.value,
)
const showGenerateButton = computed(() =>
  batchRunCount.value > 0
  || (batchRegenCount.value === 0 && !batchBlocked.value && !showMissingButton.value),
)
const showRegenButton = computed(() => batchRegenCount.value > 0 && !batchBlocked.value)

function onBlockedClick() {
  if (batchBlocked.value) emit('blockedHint', batchBlocked.value)
}

function onMissingClick() {
  emit('blockedHint', 'missing_prompt')
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

const missingTitle = '选区节点均未写提示词且无可用上游输出，点击定位第一个问题节点'

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
        aria-label="生成视频"
        title="用选中文本 + 图片生成视频"
        @click="emit('generateVideo')"
      >
        <svg viewBox="0 0 16 16" class="ico" aria-hidden="true">
          <rect x="1.5" y="2.5" width="13" height="11" rx="2.5" />
          <path d="M6.5 5.5v5l4.5-2.5z" fill="currentColor" stroke="none" />
        </svg>
      </button>
      <button
        v-if="batchBlocked"
        type="button"
        class="toolbar-action warn"
        data-testid="selection-batch-blocked"
        :aria-label="batchBlocked === 'pending_confirm' ? `待确认 ${batchBlockedCount} 个节点` : `超上限 ${batchBlockedCount} 个节点`"
        :title="blockedTitle"
        @click="onBlockedClick"
      >
        <svg v-if="batchBlocked === 'pending_confirm'" viewBox="0 0 16 16" class="ico" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 4.5v4" />
          <circle cx="8" cy="11.2" r="0.9" fill="currentColor" stroke="none" />
        </svg>
        <svg v-else viewBox="0 0 16 16" class="ico" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5" />
          <path d="M3.5 12.5 12.5 3.5" />
        </svg>
        <span class="badge">{{ batchBlockedCount }}</span>
      </button>
      <button
        v-if="showMissingButton"
        type="button"
        class="toolbar-action warn"
        data-testid="selection-batch-missing-prompt"
        :aria-label="`${batchMissingCount} 个节点未写提示词`"
        :title="missingTitle"
        @click="onMissingClick"
      >
        <svg viewBox="0 0 16 16" class="ico" aria-hidden="true">
          <rect x="3" y="1.5" width="10" height="13" rx="1.5" />
          <path d="M5.5 5h5M5.5 8h5M5.5 11h3" />
        </svg>
        <span class="badge">{{ batchMissingCount }}</span>
      </button>
      <button
        v-if="showGenerateButton"
        type="button"
        class="toolbar-action accent"
        data-testid="selection-batch-generate"
        :aria-label="batchRunning ? '停止全部' : `批量生成 ${batchRunCount} 个节点`"
        :title="batchRunning ? '停止全部' : `批量生成 ${batchRunCount} 个节点`"
        :disabled="!selectionBatch || (selectionBatch.state === 'idle' && selectionBatch.runCount === 0)"
        @click="onGenerateClick"
      >
        <svg v-if="!batchRunning" viewBox="0 0 16 16" class="ico" aria-hidden="true">
          <path d="M9 1 3 9h4l-1 6 6-8H8l1-6z" fill="currentColor" stroke="none" />
        </svg>
        <svg v-else viewBox="0 0 16 16" class="ico" aria-hidden="true">
          <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="currentColor" stroke="none" />
        </svg>
        <span v-if="!batchRunning" class="badge">{{ batchRunCount }}</span>
      </button>
      <button
        v-if="showRegenButton"
        type="button"
        class="toolbar-action accent"
        data-testid="selection-batch-regenerate"
        :aria-label="batchRunning ? '停止全部' : `重新生成 ${batchRegenCount} 个已完成节点`"
        :title="batchRunning ? '停止全部' : `覆盖式重新生成 ${batchRegenCount} 个已完成节点，将覆盖现有产物并可能消耗积分`"
        :disabled="!selectionBatch"
        @click="onRegenClick"
      >
        <svg v-if="!batchRunning" viewBox="0 0 16 16" class="ico" aria-hidden="true">
          <path d="M13.5 8a5.5 5.5 0 1 1-1.7-3.97" />
          <path d="M13.6 1.6v3h-3" />
        </svg>
        <svg v-else viewBox="0 0 16 16" class="ico" aria-hidden="true">
          <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="currentColor" stroke="none" />
        </svg>
        <span v-if="!batchRunning" class="badge">{{ batchRegenCount }}</span>
      </button>
      <button
        v-if="canUngroup"
        type="button"
        class="toolbar-action"
        aria-label="解组"
        title="解组"
        @click="emit('ungroup')"
      >
        <svg viewBox="0 0 16 16" class="ico" aria-hidden="true">
          <rect x="1.5" y="4" width="6" height="8" rx="1.5" stroke-dasharray="2 1.5" />
          <rect x="10" y="4" width="4.5" height="8" rx="1.5" />
        </svg>
      </button>
      <button
        v-if="!canUngroup && selectedIds.length >= 2"
        type="button"
        class="toolbar-action"
        aria-label="打组"
        title="打组"
        @click="emit('group')"
      >
        <svg viewBox="0 0 16 16" class="ico" aria-hidden="true">
          <rect x="1.5" y="1.5" width="6.5" height="6.5" rx="1.5" />
          <rect x="8" y="8" width="6.5" height="6.5" rx="1.5" />
        </svg>
      </button>
      <button
        v-if="selectedIds.length >= 2"
        type="button"
        class="toolbar-action"
        aria-label="新建副本"
        title="新建副本"
        @click="emit('duplicate')"
      >
        <svg viewBox="0 0 16 16" class="ico" aria-hidden="true">
          <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" />
          <path d="M10.5 2.5h-7a1 1 0 0 0-1 1v7" />
        </svg>
      </button>
      <button
        v-if="selectedIds.length >= 2"
        type="button"
        class="toolbar-action"
        aria-label="新建副本（含上游）"
        title="新建副本（含上游）"
        @click="emit('duplicateUpstream')"
      >
        <svg viewBox="0 0 16 16" class="ico" aria-hidden="true">
          <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" />
          <path d="M10.5 2.5h-7a1 1 0 0 0-1 1v7" />
          <circle cx="3" cy="3" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      </button>
      <button
        v-if="selectedIds.length >= 2"
        type="button"
        class="toolbar-action accent"
        aria-label="加入 Agent 引用"
        title="加入 Agent 引用"
        @click="emit('addAgentRef')"
      >
        <svg viewBox="0 0 16 16" class="ico" aria-hidden="true">
          <path d="M8 1.5 9.7 6.3 14.5 8 9.7 9.7 8 14.5 6.3 9.7 1.5 8 6.3 6.3z" fill="currentColor" stroke="none" />
        </svg>
      </button>
      <div
        v-if="selectedIds.length >= 2"
        class="relative"
        data-layout-menu
      >
        <button
          type="button"
          class="toolbar-action"
          aria-label="整理布局"
          title="整理布局"
          @click.stop="layoutMenuOpen = !layoutMenuOpen; exportMenuOpen = false"
        >
          <svg viewBox="0 0 16 16" class="ico" aria-hidden="true">
            <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" />
            <rect x="9" y="1.5" width="5.5" height="5.5" rx="1" />
            <rect x="1.5" y="9" width="5.5" height="5.5" rx="1" />
            <rect x="9" y="9" width="5.5" height="5.5" rx="1" />
          </svg>
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
          aria-label="导出工作流"
          title="导出工作流"
          @click.stop="exportMenuOpen = !exportMenuOpen; layoutMenuOpen = false"
        >
          <svg viewBox="0 0 16 16" class="ico" aria-hidden="true">
            <path d="M8 2v8M4.8 7 8 10.2 11.2 7" />
            <path d="M2 11.5v1.5a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5v-1.5" />
          </svg>
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
      <button
        type="button"
        class="toolbar-action danger"
        aria-label="删除"
        title="删除"
        @click="emit('delete')"
      >
        <svg viewBox="0 0 16 16" class="ico" aria-hidden="true">
          <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 10h6.6L12 4" />
          <path d="M6.7 6.5v5M9.3 6.5v5" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.toolbar-action {
  @apply relative rounded-lg px-2 py-1.5 transition;
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
.toolbar-action:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.ico {
  display: block;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 14px;
  padding: 0 3px;
  border-radius: 9999px;
  font-size: 9px;
  line-height: 14px;
  text-align: center;
  color: var(--neo-text-primary);
  background: var(--neo-hover-bg, rgba(128, 128, 128, 0.35));
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
