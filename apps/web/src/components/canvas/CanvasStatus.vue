<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  nodeCount: number
  edgeCount: number
  groupCount: number
  generatingCount: number
  groups: Array<{ id: string; title: string; childCount: number }>
  compact?: boolean
}>()

const emit = defineEmits<{
  focusGroup: [id: string]
}>()

const showGroups = ref(false)
const hasGenerating = computed(() => props.generatingCount > 0)
</script>

<template>
  <div
    class="canvas-status rounded-xl border border-white/10 bg-[rgba(20,20,20,0.92)] shadow-xl backdrop-blur-md"
    :class="compact ? 'mb-0 px-2 py-1.5' : 'mb-2 px-3 py-2'"
  >
    <div
      class="flex flex-wrap items-center gap-y-0.5 text-white/50"
      :class="compact ? 'gap-x-2 text-[9px]' : 'gap-x-3 text-[10px]'"
    >
      <span>{{ nodeCount }} 节点</span>
      <span>{{ edgeCount }} 连线</span>
      <button
        type="button"
        class="transition hover:text-[#818cf8]"
        @click="showGroups = !showGroups"
      >
        {{ groupCount }} 分组
      </button>
      <span v-if="hasGenerating" class="flex items-center gap-1 text-amber-400">
        <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
        {{ generatingCount }} 生成中
      </span>
    </div>

    <div v-if="showGroups && groups.length" class="mt-2 max-h-[120px] overflow-y-auto border-t border-white/5 pt-2">
      <button
        v-for="g in groups"
        :key="g.id"
        type="button"
        class="mb-0.5 flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-[10px] text-white/60 hover:bg-white/5"
        @click="emit('focusGroup', g.id)"
      >
        <span>{{ g.title }}</span>
        <span class="text-white/30">{{ g.childCount }}</span>
      </button>
    </div>
  </div>
</template>
