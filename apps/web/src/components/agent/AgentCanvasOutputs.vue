<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { LinkedCanvasOutput } from '@lnkpi/shared'
import { ElMessage } from 'element-plus'
import DockTypeIcon from '@/components/canvas/dock-studio/shared/DockTypeIcon.vue'
import CanvasLocateButton from '@/components/shared/CanvasLocateButton.vue'
import {
  locatableNodeIds,
  shouldCollapseOutputs,
  visibleOutputCount,
} from '@/components/agent/agentCanvasOutputs'

const props = defineProps<{
  outputs: LinkedCanvasOutput[]
}>()

const emit = defineEmits<{
  focusNode: [nodeId: string]
  focusAll: [nodeIds: string[]]
}>()

const LOCATE_HINT_KEY = 'lnkpi:agentLocateHintShown'

const expanded = ref(false)
const pulseNodeIds = ref<Set<string>>(new Set())
const prevStatuses = ref<Map<string, LinkedCanvasOutput['status']>>(new Map())

const showCollapse = computed(() => shouldCollapseOutputs(props.outputs.length))
const visibleCount = computed(() => visibleOutputCount(props.outputs.length, expanded.value))
const visibleOutputs = computed(() =>
  showCollapse.value && !expanded.value
    ? props.outputs.slice(0, visibleCount.value)
    : props.outputs,
)
const locatableIds = computed(() => locatableNodeIds(props.outputs))
const showFocusAll = computed(() => locatableIds.value.length >= 2)

watch(
  () => props.outputs,
  (outputs) => {
    const nextPulse = new Set<string>()
    for (const out of outputs) {
      const prev = prevStatuses.value.get(out.nodeId)
      if (
        (out.status === 'done' || out.status === 'failed')
        && prev !== out.status
        && prev !== undefined
      ) {
        nextPulse.add(out.nodeId)
      }
      prevStatuses.value.set(out.nodeId, out.status)
    }
    if (nextPulse.size) {
      pulseNodeIds.value = new Set([...pulseNodeIds.value, ...nextPulse])
      for (const nodeId of nextPulse) {
        window.setTimeout(() => {
          const next = new Set(pulseNodeIds.value)
          next.delete(nodeId)
          pulseNodeIds.value = next
        }, 2000)
      }
    }
  },
  { deep: true, immediate: true },
)

function statusIcon(status: LinkedCanvasOutput['status']): string {
  switch (status) {
    case 'done':
      return '✓'
    case 'failed':
      return '✗'
    case 'running':
      return '⏳'
    default:
      return '○'
  }
}

function maybeShowLocateHint() {
  if (localStorage.getItem(LOCATE_HINT_KEY)) return
  localStorage.setItem(LOCATE_HINT_KEY, '1')
  ElMessage.info('点击图钉可在画布中找到对应节点')
}

function onLocate(nodeId: string) {
  maybeShowLocateHint()
  emit('focusNode', nodeId)
}

function onFocusAll() {
  if (!locatableIds.value.length) return
  maybeShowLocateHint()
  emit('focusAll', locatableIds.value)
}

function isPulsing(nodeId: string): boolean {
  return pulseNodeIds.value.has(nodeId)
}
</script>

<template>
  <div v-if="outputs.length" class="agent-canvas-outputs mt-1.5 border-t border-[var(--agent-assistant-border)] pt-1.5">
    <div class="mb-1 flex items-center justify-between gap-2 text-[11px] text-[var(--neo-text-muted)]">
      <span>画布产出 · {{ outputs.length }}</span>
      <CanvasLocateButton
        v-if="showFocusAll"
        :size="12"
        label="全部"
        title="在画布中定位全部"
        @click="onFocusAll"
      />
    </div>
    <ul class="space-y-1">
      <li
        v-for="item in visibleOutputs"
        :key="item.nodeId"
        class="flex items-center gap-1.5 text-[11px] leading-snug"
      >
        <span
          class="w-3 shrink-0 text-center"
          :class="item.status === 'failed' ? 'text-red-400/90' : 'text-[var(--neo-text-muted)]'"
        >{{ statusIcon(item.status) }}</span>
        <DockTypeIcon :type="item.nodeType" :size="12" class="shrink-0 opacity-80" />
        <span
          class="min-w-0 flex-1 truncate"
          :class="item.status === 'failed' ? 'text-red-400/90' : 'text-[var(--neo-fg)]'"
        >{{ item.title }}</span>
        <CanvasLocateButton
          v-if="item.status === 'done' || item.status === 'failed'"
          :pulse="isPulsing(item.nodeId)"
          title="在画布中定位"
          @click="() => onLocate(item.nodeId)"
        />
        <span
          v-else-if="item.status === 'running'"
          class="shrink-0 text-[10px] text-[var(--neo-text-muted)] animate-pulse"
        >生成中…</span>
      </li>
    </ul>
    <button
      v-if="showCollapse && !expanded"
      type="button"
      class="mt-1 text-[10px] text-[var(--neo-text-secondary)] underline-offset-2 hover:text-[var(--neo-text-primary)] hover:underline"
      @click="expanded = true"
    >
      展开全部 {{ outputs.length }} 项
    </button>
  </div>
</template>
