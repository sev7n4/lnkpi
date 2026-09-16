<script setup lang="ts">
import { computed } from 'vue'
import type { UsageOverviewResponse } from '@/services/users-api'

const props = defineProps<{
  overview: UsageOverviewResponse['overview']
}>()

function formatMetric(n: number) {
  return new Intl.NumberFormat('zh-CN').format(Math.round(n))
}

const cards = computed(() => [
  { label: '净消耗积分', value: formatMetric(props.overview.netConsumedTotal) },
  { label: '图片消耗', value: formatMetric(props.overview.byCategory.image) },
  { label: '视频消耗', value: formatMetric(props.overview.byCategory.video) },
  { label: '生成次数', value: formatMetric(props.overview.generationCount) },
  { label: '累计活跃', value: formatMetric(props.overview.activeDays) },
])
</script>

<template>
  <section class="text-white">
    <h2 class="mb-3 text-sm font-medium">用量总览</h2>
    <div class="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <div
        v-for="card in cards"
        :key="card.label"
        class="rounded-xl border border-white/8 bg-[#16161C] p-4"
      >
        <p class="text-xs text-white/45">{{ card.label }}</p>
        <p class="mt-2 text-2xl font-semibold tabular-nums">{{ card.value }}</p>
      </div>
    </div>
  </section>
</template>
