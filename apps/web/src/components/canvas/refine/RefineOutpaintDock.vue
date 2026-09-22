<script setup lang="ts">
import { computed, ref } from 'vue'
import { IMAGE_EDIT_GATEWAY_MODEL_ID, P1_IMAGE_EDIT_MODEL_KEY } from '@lnkpi/shared'
import { useClickOutside } from '@/composables/useClickOutside'
import DockGenerateButton from '@/components/canvas/dock-studio/shared/DockGenerateButton.vue'
import DockCreditBadge from '@/components/canvas/dock-studio/shared/DockCreditBadge.vue'
import { OUTPAINT_FALLBACK_PROMPT } from './outpaintFallback'

const props = withDefaults(defineProps<{
  prompt: string
  modelKey: string
  availableModelKeys: readonly string[]
  credits: number
  /** 是否已产生真实扩出（四向扩展量不全为 0）。false = CTA 禁用 + 守卫文案（§6.3）。 */
  canRun: boolean
  busy?: boolean
  canApply?: boolean
  errorMessage?: string
}>(), { busy: false, canApply: false, errorMessage: '' })

const emit = defineEmits<{
  'update:prompt': [value: string]
  'update:modelKey': [value: string]
  run: []
  apply: []
  retry: []
  exit: []
  cancel: []
}>()

const promptOpen = ref(false)
const modelOpen = ref(false)
const rootRef = ref<HTMLElement | null>(null)
useClickOutside(rootRef, () => { modelOpen.value = false })

const interactionDisabled = computed(() => props.busy)
/** CTA 可用 = 已扩出且非 busy（§4.2 不变量 3：不可用 = disabled + 原因文案）。 */
const ctaDisabled = computed(() => props.busy || !props.canRun)
const guardText = computed(() => (props.busy ? '生成中…' : '先拖动画布四周手柄扩展'))

const modelLabel = computed(() =>
  props.modelKey === P1_IMAGE_EDIT_MODEL_KEY ? IMAGE_EDIT_GATEWAY_MODEL_ID : props.modelKey,
)

function onExit() {
  if (props.busy) emit('cancel')
  else emit('exit')
}

function selectModel(key: string) {
  emit('update:modelKey', key)
  modelOpen.value = false
}
</script>

<template>
  <div ref="rootRef" class="outpaint-dock" data-testid="outpaint-dock">
    <!-- × 是扩图层的退出控件：必须带文字标注自证作用域（§4.4） -->
    <button
      type="button"
      class="outpaint-dock__exit"
      data-testid="outpaint-dock-exit"
      :title="busy ? '取消扩图生成' : '退出扩图'"
      @click="onExit"
    >
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
      <span>{{ busy ? '取消' : '退出扩图' }}</span>
    </button>

    <div class="outpaint-dock__model">
      <button
        type="button"
        class="outpaint-dock__model-trigger"
        data-testid="outpaint-dock-model"
        :disabled="interactionDisabled"
        :aria-expanded="modelOpen"
        @click="modelOpen = !modelOpen"
      >
        {{ modelLabel }}
      </button>
      <div v-if="modelOpen" class="outpaint-dock__model-menu" @click.stop>
        <button
          v-for="k in availableModelKeys"
          :key="k"
          type="button"
          class="outpaint-dock__model-item"
          :class="{ 'is-active': k === modelKey }"
          :data-model-key="k"
          @click="selectModel(k)"
        >
          {{ k === P1_IMAGE_EDIT_MODEL_KEY ? IMAGE_EDIT_GATEWAY_MODEL_ID : k }}
        </button>
      </div>
    </div>

    <button
      type="button"
      class="outpaint-dock__icon-btn"
      data-testid="outpaint-dock-prompt-toggle"
      :class="{ 'is-active': promptOpen }"
      :disabled="interactionDisabled"
      title="补充提示词（可选）"
      aria-label="补充提示词"
      :aria-expanded="promptOpen"
      @click="promptOpen = !promptOpen"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
        <path d="M5 6.5h14M5 12h14M5 17.5h9" stroke-linecap="round" />
      </svg>
    </button>

    <p v-if="!canRun" class="outpaint-dock__guard" data-testid="outpaint-dock-guard">{{ guardText }}</p>
    <p v-if="errorMessage" class="outpaint-dock__error" role="alert">
      <span>{{ errorMessage }}</span>
      <button type="button" class="outpaint-dock__retry" data-testid="outpaint-dock-retry" :disabled="busy" @click="emit('retry')">
        重试
      </button>
    </p>

    <div class="outpaint-dock__spacer" />

    <button
      v-if="canApply"
      type="button"
      class="outpaint-dock__apply"
      data-testid="outpaint-dock-apply"
      :disabled="busy"
      @click="emit('apply')"
    >
      应用到节点
    </button>
    <DockCreditBadge :credits="credits" />
    <DockGenerateButton
      data-testid="outpaint-dock-cta"
      size="lg"
      label="扩图生成"
      :disabled="ctaDisabled"
      :generating="busy"
      :title="ctaDisabled ? guardText : '扩图生成'"
      @generate="emit('run')"
    />

    <div v-if="promptOpen" class="outpaint-dock__prompt" @click.stop>
      <textarea
        class="outpaint-dock__textarea"
        data-testid="outpaint-dock-prompt"
        :value="prompt"
        :placeholder="OUTPAINT_FALLBACK_PROMPT"
        :disabled="busy"
        rows="2"
        @input="emit('update:prompt', ($event.target as HTMLTextAreaElement).value)"
      />
    </div>
  </div>
</template>

<style scoped>
/* 单行动作条：默认态总高 ≤ 60px（含内边距），远在 §4.3 的 148px 预算内 */
.outpaint-dock {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--neo-border);
  border-radius: 14px;
  background: var(--neo-surface, #17181d);
  box-shadow: 0 12px 32px rgba(0, 0, 0, .36);
  pointer-events: auto;
}
.outpaint-dock__exit,
.outpaint-dock__icon-btn,
.outpaint-dock__model-trigger,
.outpaint-dock__apply {
  display: inline-flex; height: 28px; align-items: center; gap: 4px; padding: 0 8px;
  border: 1px solid var(--neo-border); border-radius: 8px; background: transparent;
  color: var(--neo-text-secondary); font-size: 11px; cursor: pointer;
}
.outpaint-dock__icon-btn { width: 28px; justify-content: center; padding: 0; }
.outpaint-dock__icon-btn.is-active { border-color: rgba(74, 158, 255, .5); color: #7cc0ff; }
.outpaint-dock__exit:disabled,
.outpaint-dock__icon-btn:disabled,
.outpaint-dock__model-trigger:disabled { opacity: .5; cursor: not-allowed; }
.outpaint-dock__model { position: relative; }
.outpaint-dock__model-menu {
  position: absolute; bottom: calc(100% + 6px); left: 0; z-index: 50; min-width: 160px;
  padding: 4px; border: 1px solid var(--neo-border); border-radius: 10px;
  background: var(--neo-surface, #111); box-shadow: 0 8px 24px rgba(0, 0, 0, .28);
}
.outpaint-dock__model-item {
  display: block; width: 100%; padding: 6px 8px; border: none; border-radius: 6px;
  background: transparent; color: var(--neo-text-secondary); font-size: 11px; text-align: left; cursor: pointer;
}
.outpaint-dock__model-item.is-active { background: var(--neo-hi-bg, #17181d); color: #fff; }
.outpaint-dock__guard { margin: 0; color: var(--neo-text-muted); font-size: 11px; white-space: nowrap; }
.outpaint-dock__error { display: flex; margin: 0; align-items: center; gap: 8px; color: #f56c6c; font-size: 11px; }
.outpaint-dock__retry { border: 1px solid currentColor; border-radius: 6px; background: transparent; color: inherit; font-size: 11px; padding: 1px 6px; cursor: pointer; }
.outpaint-dock__spacer { flex: 1; }
.outpaint-dock__prompt {
  position: absolute; bottom: calc(100% + 8px); left: 0; right: 0; z-index: 40;
  padding: 8px; border: 1px solid var(--neo-border); border-radius: 12px;
  background: var(--neo-surface, #17181d); box-shadow: 0 12px 32px rgba(0, 0, 0, .36);
}
.outpaint-dock__textarea {
  display: block; width: 100%; max-height: 84px; resize: none; padding: 6px 8px;
  border: 1px solid var(--neo-border); border-radius: 8px; background: transparent;
  color: var(--neo-text-primary); font-size: 12px; line-height: 1.4;
}
</style>
