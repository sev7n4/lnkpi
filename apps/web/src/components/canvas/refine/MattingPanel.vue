<script setup lang="ts">
import { computed } from 'vue'
import DockCreditBadge from '@/components/canvas/dock-studio/shared/DockCreditBadge.vue'

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
/** 无选区时保持可点（点击后就地提示先在图上圈选），只挡 busy；title 说明原因。 */
const runMaskDisabled = computed(() => props.busy)
const runMaskTitle = computed(() =>
  props.maskAvailable ? '按当前选区抠图，生成透明 PNG' : '还没有选区：直接在图上涂抹或框选（左侧 rail 可换工具），再点本按钮执行',
)
const applyDisabled = computed(() => props.busy || !props.canApply)
</script>

<template>
  <section class="matting-panel" data-testid="matting-panel">
    <div class="matting-preview checkerboard" data-testid="matting-preview">
      <img class="matting-preview__img" :src="beforeUrl" alt="抠图前原图" draggable="false" />
    </div>

    <div class="matting-actions">
      <!-- 无选区时的常驻引导（2026-09-25 修正：抠图模式下可直接在图上圈选，不再跳选区面板） -->
      <p v-if="!maskAvailable" class="matting-actions__hint" data-testid="matting-mask-hint">
        还没有选区 — 直接在图上涂抹或框选，然后点「选区抠图」；或用「一键抠图」全图自动抠
      </p>

      <div class="matting-actions__row">
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
          :title="runMaskTitle"
          @click="emit('run-mask')"
        >选区抠图</button>

        <DockCreditBadge :credits="0" />
      </div>

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
/* 棋盘格透明底：统一走全局 token（--neo-checker-a/b），与节点卡 / 胶片条 / 大图预览一致 */
.matting-preview.checkerboard {
  background-image: repeating-conic-gradient(var(--neo-checker-a) 0% 25%, var(--neo-checker-b) 0% 50%);
  background-size: 24px 24px;
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
.matting-actions__row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.matting-actions__hint {
  margin: 0;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--neo-hover-bg);
  color: var(--neo-text-secondary);
  font-size: 11.5px;
  line-height: 1.5;
}
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
  /* 注意：不能用 --neo-hi-text——它是「白色高亮底上的深色文字」（深色主题下近黑），
     放在透明深色底上文字会隐形（2026-09-23 用户实测）。文字/描边统一用品牌强调色。 */
  border-color: color-mix(in srgb, var(--neo-accent-text, #a89dff) 55%, var(--neo-border));
  color: var(--neo-accent-text, #a89dff);
}
.matting-actions__btn:disabled { opacity: .5; cursor: not-allowed; }
</style>
