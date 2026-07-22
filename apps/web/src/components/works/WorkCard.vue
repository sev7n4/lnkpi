<script setup lang="ts">
import type { Work } from '@lnkpi/shared'

defineProps<{
  work: Work
}>()

defineEmits<{
  viewWork: [workId: string]
  viewWatch: [workId: string]
  viewProcess: [workId: string]
  viewAuthor: [authorId: string]
  viewShare: [workId: string]
}>()
</script>

<template>
  <article
    class="group cursor-pointer overflow-hidden rounded-2xl border border-white/[0.08] bg-[#1a1a1a] transition hover:border-[#6366f1]/30 hover:shadow-lg hover:shadow-[#6366f1]/5"
    @click="$emit('viewWork', work.id)"
  >
    <div class="relative aspect-video overflow-hidden bg-[#242424]">
      <img
        :src="work.coverUrl"
        :alt="work.title"
        class="h-full w-full object-cover transition duration-500 group-hover:scale-105"
      />
      <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />

      <div class="absolute left-3 top-3 flex gap-2">
        <span class="rounded-md bg-black/50 px-2 py-0.5 text-xs backdrop-blur-sm">
          {{ work.type === 'canvas' ? '画布' : '短片' }}
        </span>
      </div>

      <div class="absolute bottom-3 left-3 flex gap-2">
        <button
          class="rounded-lg bg-[#6366f1] px-3 py-1.5 text-xs font-medium backdrop-blur-sm transition hover:bg-[#5558e3]"
          @click.stop="$emit('viewWatch', work.id)"
        >
          立即观看
        </button>
        <button
          v-if="work.sessionId"
          class="rounded-lg bg-white/10 px-3 py-1.5 text-xs backdrop-blur-sm transition hover:bg-white/20"
          @click.stop="$emit('viewProcess', work.id)"
        >
          制作过程
        </button>
      </div>
      <button
        class="absolute bottom-3 right-3 rounded-lg bg-black/40 px-2 py-1 text-[10px] backdrop-blur-sm transition hover:bg-black/60"
        @click.stop="$emit('viewShare', work.id)"
      >
        分享
      </button>
    </div>

    <div class="p-4">
      <div class="mb-2 flex items-center gap-2">
        <button
          class="flex h-6 w-6 items-center justify-center rounded-full bg-[#6366f1]/30 text-[10px] hover:bg-[#6366f1]/50"
          @click.stop="$emit('viewAuthor', work.authorId)"
        >
          {{ work.authorName[0] }}
        </button>
        <button class="text-xs text-white/50 hover:text-[#818cf8]" @click.stop="$emit('viewAuthor', work.authorId)">
          @{{ work.authorName }}
        </button>
      </div>
      <h3 class="line-clamp-2 text-sm font-medium leading-snug">{{ work.title }}</h3>
      <div class="mt-3 flex items-center gap-4 text-xs text-white/40">
        <span>{{ work.likes }} 赞</span>
        <span>{{ work.views }} 浏览</span>
      </div>
    </div>
  </article>
</template>
