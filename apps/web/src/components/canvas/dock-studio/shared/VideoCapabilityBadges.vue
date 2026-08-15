<script setup lang="ts">
import { computed } from 'vue'
import type { VideoModelCapabilities } from '@lnkpi/shared'

const props = defineProps<{
  capabilities: VideoModelCapabilities
}>()

const badges = computed(() => {
  const c = props.capabilities
  const items: string[] = []

  if (c.supportsFirstLastFrame) {
    items.push(c.firstLastFrameLabel)
  } else if (c.supportsKeyframes) {
    items.push(c.keyframesLabel)
  }

  if (c.supportsVideoRef || c.supportsAudioRef) {
    items.push('V·A 参考')
  }

  if (c.supports4K) {
    items.push('4K')
  }

  if (c.supportsReturnLastFrame) {
    items.push('连续镜')
  }

  return items
})
</script>

<template>
  <div v-if="badges.length" class="flex flex-wrap items-center gap-1">
    <span
      v-for="badge in badges"
      :key="badge"
      class="neo-chip rounded-md px-2 py-1 text-[10px]"
    >
      {{ badge }}
    </span>
  </div>
</template>
