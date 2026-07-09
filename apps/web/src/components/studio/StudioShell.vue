<script setup lang="ts">
import { useRoute } from 'vue-router'

const links = [
  { label: '图像工作室', path: '/image-studio' },
  { label: '视频工作室', path: '/video-studio' },
  { label: '音频工作室', path: '/audio-studio' },
  { label: '视频编辑器', path: '/video-editor' },
  { label: '生成记录', path: '/generation-records' },
]

const route = useRoute()
</script>

<template>
  <div class="flex min-h-[calc(100vh-4rem)]">
    <aside class="w-[220px] shrink-0 border-r border-white/5 bg-[#1a1a1a] p-4">
      <h2 class="mb-4 text-xs font-medium uppercase tracking-wider text-white/40">创作工作室</h2>
      <nav class="space-y-1">
        <router-link
          v-for="link in links"
          :key="link.path"
          :to="link.path"
          class="block rounded-lg px-3 py-2 text-sm transition"
          :class="route.path === link.path
            ? 'bg-[#6366f1]/20 text-[#818cf8]'
            : 'text-white/60 hover:bg-white/5 hover:text-white'"
        >
          {{ link.label }}
        </router-link>
      </nav>
    </aside>
    <main class="min-w-0 flex-1 overflow-y-auto p-6">
      <slot />
    </main>
  </div>
</template>
