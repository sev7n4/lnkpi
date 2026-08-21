<script setup lang="ts">
import { computed, inject, nextTick, ref } from 'vue'
import { Handle, Position, useNode } from '@vue-flow/core'
import {
  getNeoNodeMeta,
  resolveNeoNodeStatus,
  resolveNeoNodeTitle,
  type NeoNodeStatus,
} from '@/components/canvas/neoNodeMeta'
import { CANVAS_NODE_ADD_AGENT_KEY, CANVAS_NODE_LOCATE_FLASH_KEY, CANVAS_NODE_RENAME_KEY, CANVAS_REF_PICK_ACTIVE_KEY, CANVAS_REF_PICK_NODE_IDS_KEY, CANVAS_REF_PICK_REJECT_KEY } from '@/composables/canvasNodeActions'
import CanvasRefTargetIcon from '@/components/shared/CanvasRefTargetIcon.vue'

const props = withDefaults(
  defineProps<{
    selected?: boolean
    nodeType: string
    data?: Record<string, unknown>
    title?: string
    status?: NeoNodeStatus | string
    width?: number | string
    height?: number | string
    hideTargetHandle?: boolean
    hideSourceHandle?: boolean
    targetPosition?: Position
    sourcePosition?: Position
  }>(),
  {
    selected: false,
    hideTargetHandle: false,
    hideSourceHandle: false,
    targetPosition: Position.Left,
    sourcePosition: Position.Right,
  },
)

const meta = computed(() => getNeoNodeMeta(props.nodeType))
const displayTitle = computed(() => props.title ?? resolveNeoNodeTitle(props.nodeType, props.data))
const nodeStatus = computed(() => {
  if (props.status) return resolveNeoNodeStatus(String(props.status))
  return resolveNeoNodeStatus(String(props.data?.status ?? ''))
})

const shellStyle = computed(() => {
  const width = props.width ?? meta.value.defaultWidth
  const height = props.height ?? meta.value.defaultHeight
  return {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
  }
})

const { id: nodeId } = useNode()
const renameNode = inject(CANVAS_NODE_RENAME_KEY, null)
const addToAgent = inject(CANVAS_NODE_ADD_AGENT_KEY, null)
const pickActive = inject(CANVAS_REF_PICK_ACTIVE_KEY, ref(false))
const pickedNodeIds = inject(CANVAS_REF_PICK_NODE_IDS_KEY, ref(new Set<string>()))
const pickRejectNodeId = inject(CANVAS_REF_PICK_REJECT_KEY, ref<string | null>(null))
const isPickMarked = computed(() => pickedNodeIds.value.has(nodeId))
const isPickReject = computed(() => pickRejectNodeId.value === nodeId)
const locateFlashNodeIds = inject(CANVAS_NODE_LOCATE_FLASH_KEY, ref(new Set<string>()))
const isLocateFlashing = computed(() => locateFlashNodeIds.value.has(nodeId))
const isHovered = ref(false)
let hoverLeaveTimer: ReturnType<typeof setTimeout> | null = null

function setHovered(next: boolean) {
  if (hoverLeaveTimer) {
    clearTimeout(hoverLeaveTimer)
    hoverLeaveTimer = null
  }
  if (next) {
    isHovered.value = true
    return
  }
  hoverLeaveTimer = setTimeout(() => {
    isHovered.value = false
    hoverLeaveTimer = null
  }, 80)
}

const showHandles = computed(() => props.selected || isHovered.value)
const isRenaming = ref(false)
const renameDraft = ref('')
const renameInputRef = ref<HTMLInputElement | null>(null)

function startRename() {
  if (!renameNode) return
  isRenaming.value = true
  renameDraft.value = displayTitle.value
  void nextTick(() => renameInputRef.value?.select())
}

function commitRename() {
  if (!renameNode || !isRenaming.value) return
  const title = renameDraft.value.trim()
  if (title) renameNode(nodeId, title)
  isRenaming.value = false
}

function cancelRename() {
  isRenaming.value = false
}

function onAddToAgent(event: MouseEvent) {
  event.stopPropagation()
  addToAgent?.(nodeId)
}
</script>

<template>
  <div
    class="neo-node-wrapper"
    :class="{
      'is-active': selected,
      'show-handles': showHandles,
      'is-hovered': isHovered,
      'is-ref-pick-active': pickActive,
      'is-ref-pick-marked': isPickMarked,
      'is-ref-pick-reject': isPickReject,
    }"
    @mouseenter="setHovered(true)"
    @mouseleave="setHovered(false)"
  >
    <div
      class="neo-node-external-title"
      @dblclick.stop="startRename"
      @mouseenter="setHovered(true)"
      @mouseleave="setHovered(false)"
    >
      <div class="neo-node-icon" :class="meta.variant">
        <svg v-if="meta.icon === 'prompt'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
        <svg v-else-if="meta.icon === 'text'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <svg v-else-if="meta.icon === 'image'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2.5" y="3" width="19" height="18" rx="3" />
          <circle cx="8" cy="9" r="2" />
          <path d="M21.5 15.5l-5-5L4 21" />
        </svg>
        <svg v-else-if="meta.icon === 'video'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="23 7 16 12 23 17 23 7" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
        <svg v-else-if="meta.icon === 'audio'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
        <svg v-else-if="meta.icon === 'input'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="4" />
        </svg>
      </div>
      <input
        v-if="isRenaming"
        ref="renameInputRef"
        v-model="renameDraft"
        class="neo-node-rename-input"
        @keydown.enter.stop="commitRename"
        @keydown.esc.stop="cancelRename"
        @blur="commitRename"
        @click.stop
        @mousedown.stop
      >
      <span v-else class="neo-node-title min-w-0 flex-1 truncate">{{ displayTitle }}</span>
      <span class="neo-node-status shrink-0" :class="nodeStatus" />
      <button
        v-if="addToAgent"
        type="button"
        class="neo-node-agent-add neo-node-agent-add--title shrink-0"
        title="加入 Agent 引用"
        aria-label="加入 Agent 引用"
        @click="onAddToAgent"
        @mousedown.stop
      >
        <CanvasRefTargetIcon :size="13" />
      </button>
    </div>

    <div
      class="neo-node"
      :class="[meta.variant, { selected, 'neo-node-locate-flash': isLocateFlashing }]"
      :style="shellStyle"
    >
      <div class="neo-node-content">
        <slot />
      </div>
    </div>

    <div
      v-if="$slots.footer"
      class="neo-node-external-footer"
      @mouseenter="setHovered(true)"
      @mouseleave="setHovered(false)"
    >
      <slot name="footer" />
    </div>

    <Handle
      v-if="!hideTargetHandle"
      id="target"
      type="target"
      :position="targetPosition"
      class="neo-flow-handle"
    >
      <div class="handle-hitbox" />
      <div class="handle-plus">
        <div class="handle-plus-inner" />
      </div>
    </Handle>
    <Handle
      v-if="!hideSourceHandle"
      id="source"
      type="source"
      :position="sourcePosition"
      class="neo-flow-handle"
    >
      <div class="handle-hitbox" />
      <div class="handle-plus">
        <div class="handle-plus-inner" />
      </div>
    </Handle>
  </div>
</template>
