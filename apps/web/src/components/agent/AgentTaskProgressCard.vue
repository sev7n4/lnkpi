<script setup lang="ts">
import type { AgentTaskProgressState } from './agentTaskProgress'
import CanvasLocatePinIcon from '@/components/shared/CanvasLocatePinIcon.vue'

defineProps<{
  progress: AgentTaskProgressState
}>()

const emit = defineEmits<{
  focusNode: [nodeId: string]
}>()

const statusLabel: Record<string, string> = {
  pending: '等待中',
  running: '进行中',
  retrying: '重试中',
  done: '完成',
  failed: '失败',
  needs_user: '需你处理',
  skipped: '已跳过',
}
</script>

<template>
  <div class="agent-task-card rounded-xl border border-[var(--neo-border)] bg-[var(--neo-panel)] p-3 text-xs">
    <div class="mb-2 font-medium text-[var(--neo-fg)]">
      {{ progress.finished ? '本轮执行结果' : '正在按方案拆解并出图' }}
    </div>
    <ul class="space-y-1.5">
      <li
        v-for="item in progress.items"
        :key="item.id"
        class="group flex cursor-pointer items-start gap-2 rounded-lg px-1.5 py-1 hover:bg-[var(--neo-hover)]"
        @click="item.nodeId && emit('focusNode', item.nodeId)"
      >
        <span class="mt-0.5 w-14 shrink-0 opacity-70">{{ statusLabel[item.status] || item.status }}</span>
        <span class="min-w-0 flex-1">
          <span class="font-medium">{{ item.title }}</span>
          <span v-if="item.status === 'retrying' && item.attempt" class="ml-1 opacity-60">
            {{ item.attempt }}/{{ item.maxAttempts || 2 }}
          </span>
          <div v-if="item.errorHint" class="mt-0.5 opacity-60">{{ item.errorHint }}</div>
          <div v-if="item.errorCode && !item.errorHint" class="mt-0.5 opacity-50">{{ item.errorCode }}</div>
        </span>
        <span v-if="item.nodeId" class="mt-0.5 shrink-0 opacity-0 transition group-hover:opacity-70">
          <CanvasLocatePinIcon :size="12" />
        </span>
      </li>
    </ul>
    <div v-if="progress.summary" class="mt-3 border-t border-[var(--neo-border)] pt-2 opacity-90">
      合计：成功 {{ progress.summary.success }}，失败 {{ progress.summary.failed }}，需你处理
      {{ progress.summary.needsUser }}，跳过 {{ progress.summary.skipped }}。
      <div v-for="(line, idx) in progress.summary.lines || []" :key="idx" class="mt-1 opacity-70">
        · {{ line.title }}：{{ line.hint || line.status }}
      </div>
    </div>
  </div>
</template>
