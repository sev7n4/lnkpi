<script setup lang="ts">
import { BRAND_LOGO_URL, BRAND_NAME } from '@/constants/brand'

withDefaults(
  defineProps<{
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
    showName?: boolean
    name?: string
  }>(),
  {
    size: 'md',
    showName: false,
    name: BRAND_NAME,
  },
)

const sizeClass: Record<string, string> = {
  xs: 'h-7 w-7',
  sm: 'h-9 w-9',
  md: 'h-11 w-11',
  lg: 'h-16 w-16',
  xl: 'h-24 w-24',
}
</script>

<template>
  <div class="brand-logo inline-flex items-center gap-2">
    <img
      :src="BRAND_LOGO_URL"
      :alt="name"
      class="brand-logo__img object-contain"
      :class="sizeClass[size]"
      draggable="false"
    >
    <span v-if="showName" class="font-display text-lg font-semibold tracking-tight text-white">{{ name }}</span>
  </div>
</template>

<style scoped>
.brand-logo__img {
  background: transparent;
  filter: drop-shadow(0 4px 14px rgba(99, 102, 241, 0.28));
}
</style>
