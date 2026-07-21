<script setup lang="ts">
import { computed, ref } from 'vue'
import { useClickOutside } from '@/composables/useClickOutside'

export type ImageAspectRatio =
  | '1:1'
  | '16:9'
  | '9:16'
  | '4:3'
  | '3:4'
  | '3:2'
  | '2:3'
  | '21:9'

export type ImageResolution = '1K' | '2K' | '4K'
export type ImageCount = 1 | 2 | 4

const props = defineProps<{
  aspect: ImageAspectRatio
  resolution: ImageResolution
  count: ImageCount
}>()

const emit = defineEmits<{
  'update:aspect': [value: ImageAspectRatio]
  'update:resolution': [value: ImageResolution]
  'update:count': [value: ImageCount]
}>()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
useClickOutside(rootRef, () => {
  open.value = false
})

const aspectOptions: ImageAspectRatio[] = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9']
const resolutionOptions: ImageResolution[] = ['1K', '2K', '4K']
const countOptions: ImageCount[] = [1, 2, 4]

const summary = computed(() => `${props.aspect} · ${props.resolution} · x${props.count}`)

/** 比例小图标：按宽高比绘制小矩形 */
function aspectRect(value: ImageAspectRatio) {
  const [w, h] = value.split(':').map(Number)
  const max = 14
  const scale = max / Math.max(w, h)
  const rw = Math.max(4, Math.round(w * scale))
  const rh = Math.max(4, Math.round(h * scale))
  return {
    x: (18 - rw) / 2,
    y: (18 - rh) / 2,
    width: rw,
    height: rh,
  }
}
</script>

<template>
  <div ref="rootRef" class="relative">
    <button
      type="button"
      class="neo-ctl flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs"
      title="尺寸 / 分辨率 / 张数"
      @click="open = !open"
    >
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" class="opacity-60">
        <rect x="3" y="5" width="18" height="14" rx="2" />
      </svg>
      <span class="font-medium">{{ summary }}</span>
      <svg class="h-3 w-3 shrink-0 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <div
      v-if="open"
      class="neo-popover absolute bottom-full left-0 z-50 mb-1 w-[264px] rounded-xl p-3"
      @click.stop
    >
      <div class="mb-3">
        <p class="mb-1.5 text-[10px] text-[var(--neo-text-muted)]">画面比例</p>
        <div class="grid grid-cols-4 gap-1">
          <button
            v-for="opt in aspectOptions"
            :key="opt"
            type="button"
            class="neo-chip flex flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-[10px]"
            :class="aspect === opt ? 'is-on' : ''"
            @click="emit('update:aspect', opt)"
          >
            <svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect v-bind="aspectRect(opt)" rx="1.5" />
            </svg>
            {{ opt }}
          </button>
        </div>
      </div>

      <div class="mb-3">
        <p class="mb-1.5 text-[10px] text-[var(--neo-text-muted)]">分辨率</p>
        <div class="flex gap-1">
          <button
            v-for="opt in resolutionOptions"
            :key="opt"
            type="button"
            class="neo-chip flex-1 rounded-md px-2 py-1 text-[10px]"
            :class="resolution === opt ? 'is-on' : ''"
            @click="emit('update:resolution', opt)"
          >
            {{ opt }}
          </button>
        </div>
      </div>

      <div>
        <p class="mb-1.5 text-[10px] text-[var(--neo-text-muted)]">生成张数</p>
        <div class="flex gap-1">
          <button
            v-for="opt in countOptions"
            :key="opt"
            type="button"
            class="neo-chip flex-1 rounded-md px-2 py-1 text-[10px]"
            :class="count === opt ? 'is-on' : ''"
            @click="emit('update:count', opt)"
          >
            ×{{ opt }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
