<script setup lang="ts">
import { computed, ref } from 'vue'
import type { UsageDayPoint, UsageDaysRangeKey } from '@/services/users-api'

type SeriesKey = 'generationCount' | 'netConsumed' | 'text' | 'image' | 'audio' | 'video'

const props = defineProps<{
  range: UsageDaysRangeKey
  days: UsageDayPoint[]
  loading?: boolean
}>()

const emit = defineEmits<{
  'update:range': [UsageDaysRangeKey]
}>()

const series = ref<SeriesKey>('generationCount')

const RANGES: { key: UsageDaysRangeKey; label: string }[] = [
  { key: '7d', label: '近 7 天' },
  { key: '30d', label: '近 30 天' },
  { key: 'month', label: '本月' },
]

const SERIES: { key: SeriesKey; label: string }[] = [
  { key: 'generationCount', label: '生成次数' },
  { key: 'netConsumed', label: '积分消耗' },
  { key: 'text', label: '文本' },
  { key: 'image', label: '图片' },
  { key: 'audio', label: '音频' },
  { key: 'video', label: '视频' },
]

function seriesValue(day: UsageDayPoint, key: SeriesKey): number {
  if (key === 'generationCount') return day.generationCount
  if (key === 'netConsumed') return day.netConsumed
  return day.byCategory[key]
}

const points = computed(() => {
  const values = props.days.map((day) => seriesValue(day, series.value))
  const max = Math.max(1, ...values)
  const n = values.length
  return props.days.map((day, i) => {
    const v = values[i]
    const x = n === 1 ? 320 : (i / (n - 1)) * 640
    const y = 200 - (v / max) * 180 - 10
    return { date: day.date, value: v, x, y }
  })
})

const polylinePoints = computed(() => points.value.map((p) => `${p.x},${p.y}`).join(' '))

function capsuleClass(selected: boolean) {
  return selected
    ? 'bg-white/12 text-white'
    : 'text-white/50 hover:text-white/80'
}
</script>

<template>
  <section class="rounded-2xl border border-white/8 bg-[#16161C] p-5 text-white">
    <header class="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div class="space-y-3">
        <h2 class="text-sm font-medium">用量趋势</h2>
        <div class="inline-flex rounded-full border border-white/8 p-1">
          <button
            v-for="item in RANGES"
            :key="item.key"
            type="button"
            :data-range="item.key"
            class="rounded-full px-3 py-1 text-xs transition"
            :class="capsuleClass(range === item.key)"
            @click="emit('update:range', item.key)"
          >
            {{ item.label }}
          </button>
        </div>
      </div>
      <div class="inline-flex flex-wrap rounded-full border border-white/8 p-1">
        <button
          v-for="item in SERIES"
          :key="item.key"
          type="button"
          class="rounded-full px-3 py-1 text-xs transition"
          :class="capsuleClass(series === item.key)"
          @click="series = item.key"
        >
          {{ item.label }}
        </button>
      </div>
    </header>

    <div v-if="loading" class="h-48 animate-pulse bg-white/5" />
    <svg v-else viewBox="0 0 640 200" class="h-48 w-full" aria-hidden="true">
      <polyline
        :points="polylinePoints"
        fill="none"
        stroke="rgba(255,255,255,0.8)"
      />
      <circle
        v-for="p in points"
        :key="p.date"
        :cx="p.x"
        :cy="p.y"
        r="3"
        fill="rgba(255,255,255,0.8)"
      >
        <title>{{ p.date }} · {{ p.value }}</title>
      </circle>
    </svg>
  </section>
</template>
