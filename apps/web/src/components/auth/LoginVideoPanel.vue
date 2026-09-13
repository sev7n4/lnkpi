<script setup lang="ts">
const src = '/auth/login-loop.mp4'
const poster = '/auth/login-loop-poster.jpg'
</script>

<template>
  <div class="relative h-full w-full overflow-hidden bg-[var(--neo-bg)]">
    <video
      class="absolute inset-0 h-full w-full object-cover"
      :src="src"
      :poster="poster"
      autoplay
      muted
      loop
      playsinline
      preload="auto"
    />
    <div class="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent to-[var(--neo-bg)]/40" />
    <p class="absolute bottom-6 left-1/2 -translate-x-1/2 text-xs text-white/50">超创 · 创作瞬间</p>
  </div>
</template>
