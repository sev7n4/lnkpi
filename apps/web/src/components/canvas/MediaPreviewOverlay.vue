<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import { downloadMediaFile, mediaDownloadName } from '@/composables/useCanvasMedia'

const editor = useCanvasEditorStore()
const target = computed(() => editor.previewTarget)

function close() {
  editor.closeMediaPreview()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && target.value) {
    event.stopPropagation()
    close()
  }
}

async function download() {
  if (!target.value) return
  await downloadMediaFile(
    target.value.url,
    mediaDownloadName(target.value.url, target.value.kind, target.value.label),
  )
}

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <Teleport to="body">
    <Transition name="preview-fade">
      <div
        v-if="target"
        class="media-preview-mask fixed inset-0 z-[120] flex items-center justify-center"
        @click.self="close"
      >
        <!-- 顶部操作栏 -->
        <div class="absolute right-4 top-4 z-10 flex items-center gap-2">
          <button
            type="button"
            class="preview-ctl"
            title="下载"
            @click.stop="download"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
          <button
            type="button"
            class="preview-ctl"
            title="关闭 (Esc)"
            @click.stop="close"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <!-- 媒体主体 -->
        <img
          v-if="target.kind === 'image'"
          :src="target.url"
          :alt="target.label ?? ''"
          class="preview-media select-none"
          draggable="false"
        >
        <video
          v-else-if="target.kind === 'video'"
          :src="target.url"
          controls
          autoplay
          class="preview-media"
        />
        <div v-else class="preview-audio-card">
          <svg class="mx-auto mb-4 h-10 w-10 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19a3 3 0 11-6 0 3 3 0 016 0zm12-3a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <audio :src="target.url" controls autoplay class="w-[320px]" />
        </div>

        <!-- 底部标题 -->
        <p
          v-if="target.label"
          class="absolute bottom-4 left-1/2 max-w-[70vw] -translate-x-1/2 truncate rounded-full bg-black/55 px-4 py-1.5 text-xs text-white/85 backdrop-blur-sm"
        >
          {{ target.label }}
        </p>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.media-preview-mask {
  background: rgba(8, 8, 12, 0.82);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.preview-media {
  max-width: min(90vw, 1400px);
  max-height: 86vh;
  border-radius: 12px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6);
}

.preview-audio-card {
  padding: 32px 40px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(24, 24, 30, 0.9);
  color: rgba(255, 255, 255, 0.85);
  text-align: center;
}

.preview-ctl {
  display: inline-flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 12px;
  background: rgba(20, 20, 26, 0.72);
  color: rgba(255, 255, 255, 0.85);
  transition: background 0.15s ease, color 0.15s ease;
}

.preview-ctl:hover {
  background: rgba(45, 45, 55, 0.9);
  color: #fff;
}

.preview-fade-enter-active,
.preview-fade-leave-active {
  transition: opacity 0.18s ease;
}

.preview-fade-enter-from,
.preview-fade-leave-to {
  opacity: 0;
}
</style>
