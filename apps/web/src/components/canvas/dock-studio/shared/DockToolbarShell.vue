<script setup lang="ts">
import { computed } from 'vue'
import type { TaskKind } from '@lnkpi/shared'
import DockFailureChip from './DockFailureChip.vue'
import DockTypeIcon from './DockTypeIcon.vue'
import { DOCK_TYPE_LABELS, dockTypeToIcon } from './dockIcons'

const props = defineProps<{
  /** Node type key, e.g. text / image / video / audio */
  type?: string
  /** @deprecated Prefer `type` — kept for legacy panels */
  typeLabel?: string
  showTitle?: boolean
  title?: string
  titlePlaceholder?: string
  readonly?: boolean
  /** Selected node id — enables quiet failure chip under header */
  failureNodeId?: string
  failureStatus?: unknown
  failureMessage?: string
  failureErrorCode?: string
  failureTaskKind?: TaskKind
  failureTaskId?: string
  failureNodeLabel?: string
}>()

const emit = defineEmits<{
  close: []
  'update:title': [value: string]
}>()

const iconKind = computed(() => dockTypeToIcon(props.type ?? 'text'))
const tooltip = computed(() => {
  if (props.type && DOCK_TYPE_LABELS[props.type]) return DOCK_TYPE_LABELS[props.type]
  return props.typeLabel ?? '节点'
})

const showDefaultFailureChip = computed(() => Boolean(props.failureNodeId))
</script>

<template>
  <div
    class="bottom-toolbar-container"
    :class="{ 'is-dock-readonly': readonly }"
    @click.stop
  >
    <div class="bottom-toolbar-header">
      <div class="flex items-center gap-2">
        <span class="bottom-toolbar-type-icon" :title="tooltip">
          <DockTypeIcon :icon="iconKind" :size="18" />
        </span>
        <input
          v-if="showTitle"
          :value="title"
          class="bottom-toolbar-title-input"
          :placeholder="titlePlaceholder ?? '节点标题'"
          :readonly="readonly"
          @input="emit('update:title', ($event.target as HTMLInputElement).value)"
        >
      </div>
      <button type="button" class="bottom-toolbar-close" aria-label="关闭" @click="emit('close')">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
    <slot name="failure">
      <DockFailureChip
        v-if="showDefaultFailureChip && failureNodeId"
        :node-id="failureNodeId"
        :status="failureStatus"
        :error-message="failureMessage"
        :error-code="failureErrorCode"
        :task-kind="failureTaskKind"
        :task-id="failureTaskId"
        :node-label="failureNodeLabel"
      />
    </slot>
    <slot />
  </div>
</template>
