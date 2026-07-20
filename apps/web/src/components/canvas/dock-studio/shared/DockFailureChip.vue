<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { ErrorCode, GenerationDiagnostic, TaskKind } from '@lnkpi/shared'
import { resolveDockFailureChip } from '@/components/canvas/dock-studio/shared/dockFailureChip'
import { NODE_GENERATION_STATUS } from '@/constants/dockStudio'
import { canvasApi } from '@/services/canvas-api'
import { studioApi } from '@/services/studio-api'
import {
  buildCopyForNode,
  sharedDiagnosticCache,
} from '@/utils/generationDiagnostic'

const props = defineProps<{
  nodeId: string
  status?: unknown
  errorMessage?: string
  errorCode?: string
  taskKind?: TaskKind
  taskId?: string
  nodeLabel?: string
}>()

const route = useRoute()
const sessionId = computed(() => route.params.sessionId as string | undefined)
const copyLabel = ref('复制')

const view = computed(() =>
  resolveDockFailureChip({
    status: props.status,
    errorMessage: props.errorMessage,
  }),
)

const isFallbackPending = computed(
  () => props.status === NODE_GENERATION_STATUS.fallback_pending,
)

function buildFallbackDiagnostic(): GenerationDiagnostic {
  const code = (props.errorCode as ErrorCode | undefined) || 'unknown'
  const taskKind: TaskKind = props.taskKind || 'generation'
  return {
    userMessage: props.errorMessage || view.value.message || '生成失败',
    code: isFallbackPending.value ? 'fallback_pending' : code,
    taskKind,
    taskId: props.taskId || 'unknown',
    occurredAt: new Date().toISOString(),
    providerSnippet: null,
    hint: isFallbackPending.value
      ? '请确认是否使用平台回退继续，或取消本次生成。'
      : undefined,
  }
}

async function fetchDiagnostic(): Promise<GenerationDiagnostic> {
  const taskId = props.taskId
  const taskKind = props.taskKind
  if (!taskId || !taskKind) return buildFallbackDiagnostic()

  return sharedDiagnosticCache.get(taskKind, taskId, () =>
    taskKind === 'material'
      ? canvasApi.getMaterialDiagnostic(taskId)
      : studioApi.getGenerationDiagnostic(taskId),
  )
}

async function onCopy() {
  copyLabel.value = '复制中…'
  let payload: GenerationDiagnostic
  try {
    payload = await fetchDiagnostic()
  } catch {
    payload = buildFallbackDiagnostic()
  }
  const text = buildCopyForNode(payload, {
    nodeId: props.nodeId,
    nodeLabel: props.nodeLabel,
    sessionId: sessionId.value,
  })
  try {
    await navigator.clipboard.writeText(text)
    copyLabel.value = '已复制'
    setTimeout(() => {
      copyLabel.value = '复制'
    }, 1500)
  } catch {
    copyLabel.value = '复制失败'
    setTimeout(() => {
      copyLabel.value = '复制'
    }, 1500)
  }
}
</script>

<template>
  <div
    v-if="view.visible"
    class="dock-failure-chip"
    role="status"
  >
    <span class="dock-failure-chip__msg" :title="errorMessage || view.message">{{
      view.message
    }}</span>
    <button
      v-if="view.showCopy"
      type="button"
      class="dock-failure-chip__copy"
      @click.stop="onCopy"
    >
      {{ copyLabel }}
    </button>
  </div>
</template>
