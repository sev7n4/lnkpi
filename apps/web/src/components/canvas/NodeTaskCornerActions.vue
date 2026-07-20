<script setup lang="ts">
import { computed, inject } from 'vue'
import { useNodeId } from '@vue-flow/core'
import { resolveCornerAction, truncateError } from '@/components/canvas/nodeTaskChrome'
import { CANVAS_NODE_CANCEL_KEY, CANVAS_NODE_RETRY_KEY } from '@/composables/canvasNodeActions'
import { NODE_GENERATION_STATUS } from '@/constants/dockStudio'

const props = defineProps<{ status?: unknown; errorMessage?: string }>()
const nodeId = useNodeId()
const cancel = inject(CANVAS_NODE_CANCEL_KEY, null)
const retry = inject(CANVAS_NODE_RETRY_KEY, null)
const action = computed(() => resolveCornerAction(props.status))
const err = computed(() => truncateError(props.errorMessage))
const showError = computed(
  () =>
    Boolean(err.value) &&
    (props.status === NODE_GENERATION_STATUS.error ||
      props.status === NODE_GENERATION_STATUS.failed),
)

function onAction(e: Event) {
  e.stopPropagation()
  e.preventDefault()
  if (!nodeId) return
  if (action.value === 'cancel') cancel?.(nodeId)
  if (action.value === 'retry') void retry?.(nodeId)
}
</script>

<template>
  <div class="neo-task-corner nodrag nopan" @pointerdown.stop @mousedown.stop @click.stop>
    <p v-if="showError" class="neo-task-error">{{ err }}</p>
    <button
      v-if="action"
      type="button"
      class="neo-task-corner-btn"
      :class="action === 'retry' ? 'is-retry' : 'is-cancel'"
      @click="onAction"
    >
      {{ action === 'retry' ? '重试' : '取消' }}
    </button>
  </div>
</template>
