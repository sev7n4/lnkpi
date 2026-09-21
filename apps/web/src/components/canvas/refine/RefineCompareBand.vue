<script setup lang="ts">
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import CompareView from './CompareView.vue'

defineProps<{ beforeUrl: string; afterUrl?: string }>()

const editor = useCanvasEditorStore()
</script>

<template>
  <!-- 右栏顶部固定带：不随工具箱滚动（spec P0-7）。锁定左右对照，不做模式切换（P0-6）。 -->
  <section class="compare-band" data-testid="refine-compare-band">
    <div class="compare-band__head">
      <span class="compare-band__title">对照预览</span>
      <span class="compare-band__pin">固定 · 默认左右</span>
      <button
        type="button"
        class="compare-band__max"
        data-testid="compare-band-maximize"
        :class="{ 'is-active': editor.compareLightboxOpen }"
        :title="editor.compareLightboxOpen ? '回到工作图' : '最大化对照'"
        aria-label="最大化对照"
        @click="editor.setCompareLightboxOpen(!editor.compareLightboxOpen)"
      >
        <svg v-if="!editor.compareLightboxOpen" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.75">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 4H5v4M15 4h4v4M5 15v4h4M19 15v4h-4" />
        </svg>
        <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.75">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 9H5V5M15 9h4V5M5 15v4h4M19 15v4h-4" />
        </svg>
      </button>
    </div>

    <CompareView
      :before-url="beforeUrl"
      :after-url="afterUrl"
      mode="split"
      :wipe-ratio="editor.refineWipeRatio"
      @update:wipe-ratio="editor.setRefineWipeRatio($event)"
    />
  </section>
</template>

<style scoped>
.compare-band { flex: 0 0 auto; padding: 9px 12px 10px; border-bottom: 1px solid var(--neo-border); }
.compare-band__head { display: flex; align-items: center; gap: 7px; height: 24px; margin-bottom: 7px; }
.compare-band__title { color: var(--neo-text-primary); font-size: 12px; font-weight: 650; }
.compare-band__pin { color: var(--neo-text-muted); font-size: 10.5px; }
.compare-band__max {
  display: flex; width: 24px; height: 24px; margin-left: auto; align-items: center; justify-content: center;
  border: 1px solid var(--neo-border); border-radius: 7px; background: transparent;
  color: var(--neo-text-secondary); cursor: pointer;
}
.compare-band__max:hover { background: var(--neo-hover-bg); }
.compare-band__max.is-active { background: rgba(0, 89, 179, .18); color: #7cc0ff; }
</style>
