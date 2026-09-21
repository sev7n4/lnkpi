<script setup lang="ts">
import type { ImageVersionEntry } from '@lnkpi/shared'
import VersionStrip from './VersionStrip.vue'

withDefaults(defineProps<{
  versions: ImageVersionEntry[]
  currentVersionId?: string
  busy?: boolean
}>(), { busy: false })

const emit = defineEmits<{
  applyStainPreset: []
  selectVersion: [versionId: string]
  revertVersion: [versionId: string]
}>()

// R15: VersionStrip 的 revert 载荷是 { versionId }，必须解包后再上行，
// 否则下游拿到的 versionId 是 "[object Object]"。
function onRevertVersion(payload: { versionId: string }) {
  emit('revertVersion', payload.versionId)
}
</script>

<template>
  <!-- 右栏唯一的滚动区（spec P0-1）。工具箱承载「用什么手段改」，dock 承载「这一轮改什么」。 -->
  <section class="refine-toolbox" data-testid="refine-toolbox">
    <div class="refine-toolbox__scroll" data-testid="toolbox-scroll">
      <div class="refine-toolbox__group">
        <div class="refine-toolbox__glabel">快速预设</div>
        <button
          type="button"
          class="refine-toolbox__item"
          data-testid="toolbox-preset-stain"
          :disabled="busy"
          @click="emit('applyStainPreset')"
        >
          清除瑕疵
        </button>
      </div>

      <div class="refine-toolbox__group">
        <div class="refine-toolbox__glabel">版本历史</div>
        <VersionStrip
          :versions="versions"
          :current-version-id="currentVersionId"
          :disabled="busy"
          @select="emit('selectVersion', $event)"
          @revert="onRevertVersion"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.refine-toolbox { display: flex; min-height: 0; flex: 1; flex-direction: column; }
.refine-toolbox__scroll { min-height: 0; flex: 1; overflow-y: auto; padding: 10px 12px 12px; }
.refine-toolbox__group + .refine-toolbox__group { margin-top: 14px; }
.refine-toolbox__glabel { margin-bottom: 6px; color: var(--neo-text-muted); font-size: 10.5px; letter-spacing: .04em; }
.refine-toolbox__item {
  display: block; width: 100%; padding: 7px 10px; border: 1px solid var(--neo-border);
  border-radius: 10px; background: transparent; color: var(--neo-text-primary);
  font-size: 12.5px; text-align: left; cursor: pointer;
}
.refine-toolbox__item:hover:not(:disabled) { background: var(--neo-hover-bg); }
.refine-toolbox__item:disabled { opacity: .5; cursor: not-allowed; }
</style>
