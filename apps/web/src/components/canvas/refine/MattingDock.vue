<script setup lang="ts">
import { computed } from 'vue'
import DockGenerateButton from '@/components/canvas/dock-studio/shared/DockGenerateButton.vue'

/**
 * 精修（matting）模式的 dock（注册表 refine-matting 的 dock，dockPlacement: 'panel'）。
 * 同构于 RefineOutpaintDock：窄卡 + size="md" CTA。仅暴露「一键抠图」主动作（run-auto），
 * 其余动作（run-mask / apply）在 MattingPanel 内。mattingUnavailable 时 CTA 禁用且 title 提示服务未启用。
 */
const props = withDefaults(defineProps<{
  mattingUnavailable?: boolean
  busy?: boolean
  /** CTA 尺寸（§4.3）：panel 落点默认 md=32 */
  size?: 'sm' | 'md' | 'lg'
}>(), {
  mattingUnavailable: false,
  busy: false,
  size: 'md',
})

const emit = defineEmits<{ 'run-auto': [] }>()

const ctaDisabled = computed(() => props.busy || props.mattingUnavailable)
const ctaTitle = computed(() => (props.mattingUnavailable ? '抠图服务未启用' : '一键抠图'))
</script>

<template>
  <div class="matting-dock" data-testid="matting-dock">
    <DockGenerateButton
      data-testid="matting-dock-cta"
      :size="size"
      label="一键抠图"
      :disabled="ctaDisabled"
      :title="ctaTitle"
      :generating="busy"
      @generate="emit('run-auto')"
    />
  </div>
</template>

<style scoped>
.matting-dock {
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
</style>
