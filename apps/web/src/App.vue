<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppHeader from '@/components/layout/AppHeader.vue'

const route = useRoute()
const isImmersiveCanvas = computed(() => route.name === 'canvas')
</script>

<template>
  <div class="min-h-screen bg-surface">
    <div v-if="!isImmersiveCanvas" class="pointer-events-none fixed inset-0 bg-hero-gradient" />
    <AppHeader v-if="!isImmersiveCanvas" />
    <main class="relative" :class="isImmersiveCanvas ? 'h-screen overflow-hidden' : ''">
      <RouterView />
    </main>
  </div>
</template>
