<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import NeoBaseNode from '@/components/canvas/NeoBaseNode.vue'
import NodeTaskCornerActions from '@/components/canvas/NodeTaskCornerActions.vue'

const props = defineProps<{
  selected?: boolean
  data: {
    title?: string
    prompt?: string
    status?: string
    coverUrl?: string
    label?: string
    errorMessage?: string
    errorCode?: string
    generationStartedAt?: string
    generationRecordId?: string
    materialId?: string
  }
}>()

const route = useRoute()
const sessionId = computed(() => route.params.sessionId as string | undefined)
const taskId = computed(
  () =>
    (typeof props.data.generationRecordId === 'string' && props.data.generationRecordId) ||
    (typeof props.data.materialId === 'string' && props.data.materialId) ||
    undefined,
)
const taskKind = computed(() =>
  typeof props.data.generationRecordId === 'string' && props.data.generationRecordId
    ? ('generation' as const)
    : typeof props.data.materialId === 'string' && props.data.materialId
      ? ('material' as const)
      : undefined,
)
</script>

<template>
  <NeoBaseNode node-type="shot" :selected="selected" :data="data" :status="data.status">
    <div class="neo-gen-card">
      <div v-if="data.coverUrl" class="neo-gen-preview">
        <img :src="data.coverUrl" alt="">
      </div>
      <div
        v-else
        class="neo-node-placeholder"
        :class="{ 'is-generating': data.status === 'generating' }"
      >
        <div class="neo-placeholder-content">
          <svg class="neo-placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
          </svg>
          <span class="neo-placeholder-text">{{ data.title || '未命名分镜' }}</span>
          <span v-if="data.prompt" class="line-clamp-2 max-w-[220px] text-[11px] text-white/40">{{ data.prompt }}</span>
        </div>
      </div>
      <NodeTaskCornerActions
        :status="data.status"
        :started-at="typeof data.generationStartedAt === 'string' ? data.generationStartedAt : undefined"
        :error-message="data.errorMessage as string | undefined"
        :error-code="data.errorCode as string | undefined"
        :task-kind="taskKind"
        :task-id="taskId"
        :node-label="typeof data.label === 'string' ? data.label : undefined"
        :session-id="sessionId"
      />
    </div>
  </NeoBaseNode>
</template>
