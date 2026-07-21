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
  <!-- left-3：工具竖排面板已下移到标题栏下方，返回按钮回到左上角原点不再被遮挡 -->
  <div class="canvas-floating-chrome pointer-events-none absolute left-3 top-3 z-[50] flex items-start gap-2">
    <button
      type="button"
      class="neo-chrome pointer-events-auto flex h-9 w-9 items-center justify-center rounded-xl transition"
      title="返回画布列表"
      @click="router.push('/workflow')"
    >
      <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
    </button>

    <div class="neo-chrome pointer-events-auto flex items-center gap-1.5 rounded-xl px-2 py-1">
      <input
        :value="title"
        class="chrome-title-input w-[110px] truncate bg-transparent px-1 py-1 text-sm font-medium outline-none transition-all duration-200 focus:w-[200px]"
        placeholder="未命名画布"
        @input="emit('update:title', ($event.target as HTMLInputElement).value)"
      >
      <div ref="menuRef" class="relative">
        <button
          type="button"
          class="chrome-more-btn flex h-7 w-7 items-center justify-center rounded-lg transition"
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
          class="neo-popover absolute left-0 top-full z-10 mt-1.5 min-w-[140px] rounded-xl py-1"
          @click.stop
        >
          <button
            type="button"
            class="neo-popover-item flex w-full px-3 py-2 text-left text-xs"
            @click="emit('save'); closeMenu()"
          >
            {{ saving ? '保存中...' : '保存画布' }}
          </button>
          <button
            type="button"
            class="neo-popover-item flex w-full px-3 py-2 text-left text-xs"
            @click="emit('storyboard'); closeMenu()"
          >
            分镜板
          </button>
          <button
            type="button"
            class="neo-popover-item flex w-full px-3 py-2 text-left text-xs"
            @click="emit('publish'); closeMenu()"
          >
            发布作品
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chrome-title-input {
  color: var(--neo-text-primary);
}

.chrome-title-input::placeholder {
  color: var(--neo-text-muted);
}

.chrome-more-btn {
  color: var(--neo-text-muted);
}

.chrome-more-btn:hover {
  background: var(--neo-hover-bg);
  color: var(--neo-text-secondary);
}
</style>
