<script setup lang="ts">
import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import type { UpstreamNodeContext } from '@/composables/useUpstreamNodeContext'
import type { MentionOption } from '@/components/canvas/MentionInput.vue'
import DockStudioRouter from '@/components/canvas/dock-studio/DockStudioRouter.vue'
import { EDITABLE_NODE_TYPES } from '@/composables/useSelectedNodeEditor'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { isNodeGenerating } from '@/constants/dockStudio'
import type { CompositionTrack } from '@/utils/compositionUpstream'
import type { NodeRef } from '@/composables/useNodeRefs'

const props = withDefaults(defineProps<{
  node: EditableFlowNode | null
  upstream: UpstreamNodeContext
  refs?: NodeRef[]
  compositionTracks?: CompositionTrack[]
  mentions?: MentionOption[]
  generating?: boolean
  scale?: number
  /** 收缩态（节点编辑浮层激活时）：收起 dock 只留底部触发热区，悬停展开、划走收回（2026-09-25 用户拍板）。 */
  collapsed?: boolean
}>(), {
  generating: false,
  collapsed: false,
})

const emit = defineEmits<{
  patch: [patch: Record<string, unknown>]
  removeRef: [ref: NodeRef]
  generate: []
  close: []
  upload: [file: File]
  convert: [targetType: 'image' | 'video' | 'audio']
  save: []
  expand: []
  batchGenerate: []
  export: []
  continueShot: []
  refine: []
}>()

/** 悬停展开（仅收缩态有意义；生成中/锁定态不收缩） */
const hoverOpen = ref(false)

/** 收缩生效条件：宿主要求收缩 && 非生成中 && 未被悬停展开 */
const collapsedNow = computed(() => props.collapsed && !props.generating && !hoverOpen.value)

const visible = computed(() => {
  if (!props.node) return false
  return EDITABLE_NODE_TYPES.has(String(props.node.type ?? ''))
})

const dockScale = computed(() => {
  const value = props.scale ?? 1
  return Math.min(2, Math.max(0.8, value))
})

const dockStyle = computed(() => ({
  transform: `scale(${dockScale.value})`,
  transformOrigin: 'bottom center',
}))

const dockLocked = computed(() => {
  if (props.generating) return true
  const status = props.node?.data?.status
  return isNodeGenerating(status) || status === 'uploading'
})

function handleDockEscape(event: KeyboardEvent) {
  if (event.defaultPrevented) return
  if (event.key === 'Escape' && visible.value) emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', handleDockEscape)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleDockEscape)
})
</script>

<template>
  <Transition name="dock-studio">
    <div
      v-if="visible"
      class="dock-studio-toolbar pointer-events-none absolute inset-x-0 bottom-3 z-[45] flex justify-center px-4"
      :class="{ 'is-dock-locked': dockLocked }"
    >
      <!-- 收缩态：底部触发热区（悬停展开）+ 呼吸指示点 -->
      <div
        v-if="collapsedNow"
        class="dock-studio-hit pointer-events-auto absolute inset-x-0 -bottom-1 flex h-8 items-end justify-center"
        data-testid="dock-hit"
        @mouseenter="hoverOpen = true"
      >
        <span class="dock-studio-hit__pill" aria-hidden="true" />
      </div>
      <!-- 展开态（常态 / 收缩态被悬停展开）：划走（鼠标离开 dock 卡）自动收回 -->
      <div
        v-else
        class="pointer-events-none flex w-full justify-center"
        :style="dockStyle"
      >
        <div class="pointer-events-auto" data-testid="dock-body" @mouseleave="hoverOpen = false">
          <DockStudioRouter
            :node="node"
            :upstream="upstream"
            :refs="refs"
            :composition-tracks="compositionTracks"
            :mentions="mentions"
            :generating="generating"
            @patch="emit('patch', $event)"
            @remove-ref="emit('removeRef', $event)"
            @generate="emit('generate')"
            @close="emit('close')"
            @upload="emit('upload', $event)"
            @convert="emit('convert', $event)"
            @save="emit('save')"
            @expand="emit('expand')"
            @batch-generate="emit('batchGenerate')"
            @export="emit('export')"
            @continue-shot="emit('continueShot')"
            @refine="emit('refine')"
          />
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.dock-studio-enter-active,
.dock-studio-leave-active {
  transition: opacity 0.35s cubic-bezier(0.22, 1, 0.36, 1), transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}
.dock-studio-enter-from,
.dock-studio-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.96);
}

.dock-studio-hit__pill {
  width: 36px;
  height: 4px;
  margin-bottom: 4px;
  border-radius: 9999px;
  background: color-mix(in srgb, var(--neo-text) 28%, transparent);
  transition: background 0.2s ease, width 0.2s ease;
}
.dock-studio-hit:hover .dock-studio-hit__pill {
  width: 56px;
  background: color-mix(in srgb, var(--neo-text) 48%, transparent);
}
</style>
