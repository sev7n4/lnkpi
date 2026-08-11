<script setup lang="ts">
import { ref } from 'vue'
import CanvasLocatePinIcon from '@/components/shared/CanvasLocatePinIcon.vue'
import type { TopoCardNode } from './types'

defineProps<{
  nodes: TopoCardNode[]
  etaMin?: number
  sceneCount?: number
  creditsHint?: string
  mermaid?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  focusNode: [nodeId: string]
}>()

const mermaidExpanded = ref(false)

function onRowClick(node: TopoCardNode) {
  if (node.node_id) {
    emit('focusNode', node.node_id)
  }
}
</script>

<template>
  <div class="agent-topo-card-list space-y-2" data-testid="topo-card-list">
    <div
      v-for="(node, index) in nodes"
      :key="node.key"
      class="group rounded-lg border border-[var(--neo-border)] bg-[var(--neo-panel)] p-2 text-xs"
      :class="node.node_id ? 'cursor-pointer hover:bg-[var(--neo-hover)]' : ''"
      :data-topo-key="node.key"
      @click="onRowClick(node)"
    >
      <div v-if="index > 0" class="mb-1.5 flex items-center gap-1 text-[10px] text-[var(--neo-muted)]">
        <span aria-hidden="true">↓</span>
        <span v-if="node.depends_on_labels?.length">
          依赖 {{ node.depends_on_labels.join('、') }}
        </span>
      </div>
      <div class="flex items-start gap-2">
        <span
          class="mt-0.5 shrink-0 rounded bg-[var(--neo-surface)] px-1.5 py-0.5 text-[10px] text-[var(--neo-muted)]"
          data-testid="topo-node-category"
        >
          {{ node.category }}
        </span>
        <span class="min-w-0 flex-1 font-medium text-[var(--neo-text)]">
          {{ node.title }}
        </span>
        <span
          v-if="node.node_id"
          class="mt-0.5 shrink-0 opacity-0 transition group-hover:opacity-70"
          data-testid="topo-locate-pin"
        >
          <CanvasLocatePinIcon :size="12" />
        </span>
      </div>
    </div>

    <p
      v-if="sceneCount != null || etaMin != null || creditsHint"
      class="rounded-lg border border-[var(--neo-border)] bg-[var(--neo-surface)] px-2 py-1.5 text-xs text-[var(--neo-muted)]"
      data-testid="topo-footer-callout"
    >
      <template v-if="sceneCount != null">预计 {{ sceneCount }} 张场景图</template>
      <template v-if="etaMin != null">
        <span v-if="sceneCount != null"> · </span>
        约 {{ etaMin }} 分钟
      </template>
      <template v-if="creditsHint">
        <span v-if="sceneCount != null || etaMin != null"> · </span>
        {{ creditsHint }}
      </template>
    </p>

    <details
      v-if="mermaid"
      class="rounded-lg border border-[var(--neo-border)] text-xs"
      data-testid="topo-mermaid-collapse"
      @toggle="mermaidExpanded = ($event.target as HTMLDetailsElement).open"
    >
      <summary class="cursor-pointer px-2 py-1.5 text-[var(--neo-muted)] hover:text-[var(--neo-text)]">
        查看技术拓扑
      </summary>
      <pre
        v-if="mermaidExpanded"
        class="overflow-x-auto border-t border-[var(--neo-border)] px-2 py-1.5 text-[10px] leading-relaxed text-[var(--neo-muted)]"
        data-testid="topo-mermaid-source"
      >{{ mermaid }}</pre>
    </details>
  </div>
</template>
