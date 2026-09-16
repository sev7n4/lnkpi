<script setup lang="ts">
import { computed } from 'vue'
import type { UsageHeatmapDay } from '@/services/users-api'
import { buildHeatmapGrid, type HeatmapCell, type HeatmapLevel } from './usageHeatmapGrid'

const LEVEL_COLORS: Record<Exclude<HeatmapLevel, 0>, string> = {
  1: '#0e4429',
  2: '#006d32',
  3: '#26a641',
  4: '#39d353',
}

const props = defineProps<{
  from: string
  to: string
  activeDays: number
  days: UsageHeatmapDay[]
}>()

const grid = computed(() =>
  buildHeatmapGrid({ from: props.from, to: props.to, days: props.days }),
)

const columns = computed(() => {
  const rows = grid.value
  const weekCount = rows[0]?.length ?? 0
  const cols: HeatmapCell[][] = []
  for (let week = 0; week < weekCount; week++) {
    cols.push(rows.map((row) => row[week]))
  }
  return cols
})

function isEmptyCell(cell: HeatmapCell) {
  return !cell.inRange || cell.level === 0
}

function cellStyle(cell: HeatmapCell) {
  if (isEmptyCell(cell)) return undefined
  return { backgroundColor: LEVEL_COLORS[cell.level] }
}

function cellTitle(cell: HeatmapCell) {
  if (!cell.inRange) return undefined
  return `${cell.date} · 净消耗 ${cell.netConsumed} · 生成 ${cell.generationCount}`
}
</script>

<template>
  <section
    tabindex="0"
    class="rounded-2xl border border-white/8 bg-[#16161C] p-5 text-white outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
  >
    <header class="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div>
        <h2 class="text-sm font-medium">活跃度</h2>
        <p class="mt-1 text-xs text-white/40">{{ from }} – {{ to }}</p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <p class="text-xs text-white/50">{{ activeDays }} 个活跃日</p>
        <div class="flex items-center gap-1 text-[10px] text-white/40">
          <span>低</span>
          <span class="h-3 w-3 rounded-[3px] bg-white/[0.06]" />
          <span class="h-3 w-3 rounded-[3px]" style="background-color: #0e4429" />
          <span class="h-3 w-3 rounded-[3px]" style="background-color: #006d32" />
          <span class="h-3 w-3 rounded-[3px]" style="background-color: #26a641" />
          <span class="h-3 w-3 rounded-[3px]" style="background-color: #39d353" />
          <span>高</span>
        </div>
      </div>
    </header>

    <div class="overflow-x-auto">
      <div class="flex w-max min-w-full gap-2">
        <div
          class="grid shrink-0 grid-rows-7 gap-[3px] text-[10px] leading-3 text-white/35"
          aria-hidden="true"
        >
          <span class="flex h-3 items-center">周一</span>
          <span class="h-3" />
          <span class="flex h-3 items-center">周三</span>
          <span class="h-3" />
          <span class="flex h-3 items-center">周五</span>
          <span class="h-3" />
          <span class="h-3" />
        </div>
        <div
          class="grid gap-[3px]"
          :style="{
            gridTemplateRows: 'repeat(7, 1fr)',
            gridAutoFlow: 'column',
            gridAutoColumns: 'max-content',
          }"
        >
          <template v-for="(col, week) in columns" :key="week">
            <div
              v-for="cell in col"
              :key="cell.date"
              class="h-3 w-3 rounded-[3px]"
              :class="isEmptyCell(cell) ? 'bg-white/[0.06]' : undefined"
              :style="cellStyle(cell)"
              :title="cellTitle(cell)"
            />
          </template>
        </div>
      </div>
    </div>
  </section>
</template>
