<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useClickOutside } from '@/composables/useClickOutside'

defineProps<{
  title: string
  saving?: boolean
}>()

const emit = defineEmits<{
  'update:title': [value: string]
  save: []
  storyboard: []
  publish: []
}>()

const router = useRouter()
const menuOpen = ref(false)
const menuRef = ref<HTMLElement | null>(null)

function closeMenu() {
  menuOpen.value = false
}

useClickOutside(menuRef, closeMenu)
</script>

<template>
  <div class="canvas-floating-chrome pointer-events-none absolute left-[52px] top-3 z-[50] flex items-start gap-2">
    <button
      type="button"
      class="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-[rgba(22,22,22,0.88)] text-white/70 shadow-lg backdrop-blur-xl transition hover:bg-white/[0.06] hover:text-white"
      title="返回画布列表"
      @click="router.push('/workflow')"
    >
      <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
    </button>

    <div class="pointer-events-auto flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[rgba(22,22,22,0.88)] px-2 py-1 shadow-lg backdrop-blur-xl">
      <input
        :value="title"
        class="w-[110px] truncate bg-transparent px-1 py-1 text-sm font-medium text-white/90 outline-none transition-all duration-200 placeholder:text-white/30 focus:w-[200px]"
        placeholder="未命名画布"
        @input="emit('update:title', ($event.target as HTMLInputElement).value)"
      >
      <div ref="menuRef" class="relative">
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded-lg text-white/50 transition hover:bg-white/[0.06] hover:text-white/80"
          title="更多操作"
          @click.stop="menuOpen = !menuOpen"
        >
          <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        </button>
        <div
          v-if="menuOpen"
          class="absolute left-0 top-full z-10 mt-1.5 min-w-[140px] rounded-xl border border-white/10 bg-[#242424] py-1 shadow-2xl"
          @click.stop
        >
          <button
            type="button"
            class="flex w-full px-3 py-2 text-left text-xs text-white/70 hover:bg-white/5 hover:text-white"
            @click="emit('save'); closeMenu()"
          >
            {{ saving ? '保存中...' : '保存画布' }}
          </button>
          <button
            type="button"
            class="flex w-full px-3 py-2 text-left text-xs text-white/70 hover:bg-white/5 hover:text-white"
            @click="emit('storyboard'); closeMenu()"
          >
            分镜板
          </button>
          <button
            type="button"
            class="flex w-full px-3 py-2 text-left text-xs text-white/70 hover:bg-white/5 hover:text-white"
            @click="emit('publish'); closeMenu()"
          >
            发布作品
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
