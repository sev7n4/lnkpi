<script setup lang="ts">
import { computed } from 'vue'

/**
 * 精修（matting）模式的右栏面板（注册表 refine-matting 的 panel）。
 * 哑组件：不 import store，动作（run-auto / run-mask / apply）全部上抛给父级 RefineSidePanel（Task 7 接线）。
 * 预览层只放 before 图 + 棋盘格底（透明区辨识）；after 图层与结果胶片条由 Task 7 在面板外层 / 对照 band 处理。
 */
const props = withDefaults(defineProps<{
  beforeUrl: string
  busy?: boolean
  mattingUnavailable?: boolean
  maskAvailable?: boolean
  canApply?: boolean
}>(), {
  busy: false,
  mattingUnavailable: false,
  maskAvailable: false,
  canApply: false,
})

const emit = defineEmits<{
  'run-auto': []
  'run-mask': []
  apply: []
}>()

const runAutoDisabled = computed(() => props.busy || props.mattingUnavailable)
const runAutoTitle = computed(() => (props.mattingUnavailable ? '抠图服务未启用' : '一键抠图'))
const runMaskDisabled = computed(() => props.busy || !props.maskAvailable)
const applyDisabled = computed(() => props.busy || !props.canApply)
</script>

<template>
  <section class="matting-panel" data-testid="matting-panel">
    <div class="matting-preview checkerboard" data-testid="matting-preview">
      <img class="matting-preview__img" :src="beforeUrl" alt="抠图前原图" draggable="false" />
    </div>

    <div class="matting-actions">
      <button
        type="button"
        class="matting-actions__btn matting-actions__primary"
        data-testid="matting-run-auto"
        :disabled="runAutoDisabled"
        :title="runAutoTitle"
        aria-label="一键抠图"
        @click="emit('run-auto')"
      >一键抠图</button>

      <button
        type="button"
        class="matting-actions__btn"
        data-testid="matting-run-mask"
        :disabled="runMaskDisabled"
        title="用当前选区抠"
        @click="emit('run-mask')"
      >用当前选区抠</button>

      <button
        type="button"
        class="matting-actions__btn"
        data-testid="matting-apply"
        :disabled="applyDisabled"
        @click="emit('apply')"
      >应用到画布</button>
    </div>
  </section>
</template>

<style scoped>
.matting-panel { display: flex; flex-direction: column; gap: 12px; padding: 12px; }

.matting-preview {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  border: 1px solid var(--neo-border);
  border-radius: 12px;
  overflow: hidden;
}
/* 棋盘格透明底：CSS conic-gradient 8px 格（视觉辨识透明区） */
.matting-preview.checkerboard {
  background-image: repeating-conic-gradient(var(--neo-border) 0% 25%, transparent 0% 50%);
  background-size: 16px 16px;
  background-position: 0 0;
}
.matting-preview__img {
  position: relative;
  max-width: 100%;
  max-height: 220px;
  object-fit: contain;
  pointer-events: none;
}

.matting-actions { display: flex; flex-direction: column; gap: 8px; }
.matting-actions__btn {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--neo-border);
  border-radius: 10px;
  background: transparent;
  color: var(--neo-text-primary);
  font-size: 12.5px;
  text-align: center;
  cursor: pointer;
}
.matting-actions__btn:hover:not(:disabled) { background: var(--neo-hover-bg); }
.matting-actions__primary {
  border-color: color-mix(in srgb, var(--neo-hi-text, #4a9eff) 50%, var(--neo-border));
  color: var(--neo-hi-text, #7cc0ff);
}
.matting-actions__btn:disabled { opacity: .5; cursor: not-allowed; }
</style>
