<script setup lang="ts">
import { computed } from 'vue'
import type { Session } from '@lnkpi/shared'
import { resolveMediaUrl } from '@/services/api-base'
import { formatSessionTime } from '@/utils/formatSessionTime'
import { extractSessionCover } from '@/utils/sessionCover'

const props = defineProps<{
  session: Session
  manageMode?: boolean
  selected?: boolean
  menuOpen?: boolean
}>()

const emit = defineEmits<{
  open: []
  toggleMenu: []
  rename: []
  duplicate: []
  delete: []
  toggleSelect: []
}>()

const cover = computed(() => extractSessionCover(props.session))
const coverUrl = computed(() => (cover.value ? resolveMediaUrl(cover.value.url) : ''))
</script>

<template>
  <div
    class="session-card group relative flex aspect-[4/3] flex-col overflow-hidden rounded-2xl border text-left transition"
    :class="selected ? 'session-card-selected' : ''"
  >
    <label
      v-if="manageMode"
      class="absolute left-2 top-2 z-20 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-white/20 bg-black/50"
      @click.stop
    >
      <input
        type="checkbox"
        class="h-3.5 w-3.5 accent-[var(--neo-accent)]"
        :checked="selected"
        @change="emit('toggleSelect')"
      >
    </label>

    <div
      class="session-card-menu-anchor absolute right-2 top-2 z-10"
      @click.stop
    >
      <button
        v-if="!manageMode"
        type="button"
        class="flex h-7 w-7 items-center justify-center rounded-lg bg-black/50 text-white/70 opacity-0 transition hover:bg-black/70 hover:text-white group-hover:opacity-100"
        :class="{ 'opacity-100': menuOpen }"
        title="更多操作"
        @click="emit('toggleMenu')"
      >
        <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      <div
        v-if="menuOpen"
        class="neo-popover absolute right-0 top-full mt-1 min-w-[120px] rounded-xl py-1"
      >
        <button type="button" class="neo-popover-item flex w-full px-3 py-2 text-left text-xs" @click="emit('rename')">
          重命名
        </button>
        <button type="button" class="neo-popover-item flex w-full px-3 py-2 text-left text-xs" @click="emit('duplicate')">
          复制副本
        </button>
        <button type="button" class="neo-popover-item flex w-full px-3 py-2 text-left text-xs text-red-400" @click="emit('delete')">
          删除
        </button>
      </div>
    </div>

    <button type="button" class="flex h-full w-full flex-col" @click="manageMode ? emit('toggleSelect') : emit('open')">
      <div class="relative min-h-0 flex-1 overflow-hidden bg-[var(--neo-hover-bg)]">
        <img
          v-if="cover?.kind === 'image' && coverUrl"
          :src="coverUrl"
          alt=""
          loading="lazy"
          class="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
        >
        <video
          v-else-if="cover?.kind === 'video' && coverUrl"
          :src="coverUrl"
          muted
          preload="metadata"
          class="h-full w-full object-cover"
        />
        <div v-else class="flex h-full w-full items-center justify-center text-[var(--neo-text-muted)]">
          <svg class="h-8 w-8 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 2h6m-3-3v6" />
          </svg>
        </div>
        <div class="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/70 to-transparent" />
      </div>
      <div class="relative z-[1] -mt-6 px-3 pb-2.5 pt-0">
        <p class="truncate text-[13px] font-medium text-white/90 group-hover:text-white">
          {{ session.title || '未命名画布' }}
        </p>
        <p class="mt-0.5 text-[10px] text-white/45">{{ formatSessionTime(session.updatedAt) }}</p>
      </div>
    </button>
  </div>
</template>

<style scoped>
.session-card {
  border-color: var(--neo-border);
  background: var(--neo-surface-card, #1a1a1a);
}

.session-card:hover {
  border-color: color-mix(in srgb, var(--neo-hi-text) 28%, var(--neo-border));
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
}

.session-card-selected {
  border-color: var(--neo-hi-text);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--neo-hi-text) 40%, transparent);
}
</style>
