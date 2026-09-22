<script setup lang="ts">
/**
 * 精修（select）模式的右栏参数面板（§10「现状减 Toolbox」）。
 * 编辑意图 chips 与覆盖率提示留在 RefineDock（与生成动作强耦合，拆出无收益），
 * 故本面板只承载「快速预设」与模式说明，作为注册表里 refine-select 的 panel。
 */
withDefaults(defineProps<{ busy?: boolean }>(), { busy: false })

const emit = defineEmits<{ applyStainPreset: [] }>()
</script>

<template>
  <section class="refine-select-panel" data-testid="refine-select-panel">
    <div class="refine-select-panel__group">
      <div class="refine-select-panel__glabel">快速预设</div>
      <button
        type="button"
        class="refine-select-panel__item"
        data-testid="refine-select-preset-stain"
        :disabled="busy"
        @click="emit('applyStainPreset')"
      >
        清除瑕疵
      </button>
    </div>
    <p class="refine-select-panel__note">在画布上圈选要改的区域，然后在下方描述改动。</p>
  </section>
</template>

<style scoped>
.refine-select-panel { display: flex; flex-direction: column; gap: 14px; padding: 12px; }
.refine-select-panel__glabel { margin-bottom: 6px; color: var(--neo-text-muted); font-size: 10.5px; letter-spacing: .04em; }
.refine-select-panel__item {
  display: block; width: 100%; padding: 7px 10px; border: 1px solid var(--neo-border);
  border-radius: 10px; background: transparent; color: var(--neo-text-primary);
  font-size: 12.5px; text-align: left; cursor: pointer;
}
.refine-select-panel__item:hover:not(:disabled) { background: var(--neo-hover-bg); }
.refine-select-panel__item:disabled { opacity: .5; cursor: not-allowed; }
.refine-select-panel__note { margin: 0; color: var(--neo-text-muted); font-size: 11px; line-height: 1.5; }
</style>
