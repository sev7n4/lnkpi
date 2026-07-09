<script setup lang="ts">
import AppHeader from '@/components/layout/AppHeader.vue'
</script>

<template>
  <div class="min-h-screen bg-surface">
    <div class="pointer-events-none fixed inset-0 bg-hero-gradient" />
    <AppHeader />
    <main class="relative">
      <RouterView />
    </main>
  </div>
</template>
