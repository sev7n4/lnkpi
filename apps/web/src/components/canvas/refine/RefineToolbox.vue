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

/**
 * 能力组框架（follow-up #6，按视觉稿 2026-09-21-studio-layout-wireframe §6）：
 * 只搭滚动区框架 + 图标占位，全部禁用 —— 各能力（引擎 / 后端通道 / 积分定价）归 M2 能力包，
 * 独立规格实现后逐个点亮。规格 §11 后续包已记录。
 */
interface ToolboxCapability { id: string; label: string; icon: string[] }
interface ToolboxCapabilityGroup { id: string; label: string; price: '免费' | '积分'; items: ToolboxCapability[] }

const CAPABILITY_GROUPS: ToolboxCapabilityGroup[] = [
  {
    id: 'matting', label: '抠素材', price: '免费',
    items: [
      { id: 'one-click-matting', label: '一键抠图', icon: ['M12 3.5v13', 'M7 11.5l5 5 5-5', 'M5 20.5h14'] },
      { id: 'subject', label: '抠主体', icon: ['M12 4.5a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4z', 'M5 20c.8-4 3.4-6 7-6s6.2 2 7 6'] },
      { id: 'erase-object', label: '擦除', icon: ['M5 15.2l7.4-7.4a1.6 1.6 0 0 1 2.3 0l3.9 3.9a1.6 1.6 0 0 1 0 2.3L13.5 19H8.6z', 'M5 19.5h14.5'] },
    ],
  },
  {
    id: 'compose', label: '构图', price: '免费',
    items: [
      { id: 'crop', label: '裁剪', icon: ['M7 3.5v13.5h13.5', 'M3.5 7h13.5v13.5'] },
      { id: 'grid-slice', label: '宫格切分', icon: ['M4 4h16v16H4z', 'M9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16'] },
      { id: 'rotate-flip', label: '旋转翻转', icon: ['M5.5 9a7.5 7.5 0 0 1 13-1.5', 'M18.5 3.5v4h-4', 'M18.5 15a7.5 7.5 0 0 1-13 1.5', 'M5.5 20.5v-4h4'] },
    ],
  },
  {
    id: 'content', label: '改内容', price: '积分',
    items: [
      { id: 'inpaint', label: '局部重绘', icon: ['M5 19.5l3.8-.7L19.2 8.4a1.7 1.7 0 0 0 0-2.4l-1.2-1.2a1.7 1.7 0 0 0-2.4 0L5.7 15.2z', 'M14.8 6.6l2.6 2.6'] },
      { id: 'erase-replace', label: '消除替换', icon: ['M7 8h10l4 4-4 4H7l-4-4z', 'M9.5 11.5h5'] },
    ],
  },
  {
    id: 'quality', label: '提画质', price: '积分',
    items: [
      { id: 'upscale', label: '超分', icon: ['M6 20.5v-9M2.5 15L6 11.5 9.5 15', 'M18 3.5v9M14.5 9L18 12.5 21.5 9'] },
      { id: 'outpaint', label: '扩图', icon: ['M9 4H5v4M15 4h4v4M5 15v4h4M19 15v4h-4', 'M12 9v6M9 12h6'] },
      { id: 'enhance', label: '增强', icon: ['M12 4l1.8 4.7L18.5 10.5l-4.7 1.8L12 17l-1.8-4.7L5.5 10.5l4.7-1.8z', 'M18.5 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z'] },
    ],
  },
]
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

      <!-- 能力组框架（follow-up #6）：占位禁用，M2 能力包逐个点亮 -->
      <div
        v-for="group in CAPABILITY_GROUPS"
        :key="group.id"
        class="refine-toolbox__group"
        :data-testid="`toolbox-group-${group.id}`"
      >
        <div class="refine-toolbox__glabel">
          {{ group.label }}<span class="refine-toolbox__price" :data-price="group.price">· {{ group.price }}</span>
        </div>
        <div class="refine-toolbox__chips">
          <button
            v-for="item in group.items"
            :key="item.id"
            type="button"
            class="refine-toolbox__chip"
            :data-testid="`toolbox-cap-${item.id}`"
            disabled
            :title="`${item.label}：M2 能力包，待独立规格实现`"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <path v-for="(d, i) in item.icon" :key="i" :d="d" />
            </svg>
            <span>{{ item.label }}</span>
          </button>
        </div>
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
.refine-toolbox__price { margin-left: 4px; }
.refine-toolbox__price[data-price='积分'] { color: #e6a23c; }
.refine-toolbox__item {
  display: block; width: 100%; padding: 7px 10px; border: 1px solid var(--neo-border);
  border-radius: 10px; background: transparent; color: var(--neo-text-primary);
  font-size: 12.5px; text-align: left; cursor: pointer;
}
.refine-toolbox__item:hover:not(:disabled) { background: var(--neo-hover-bg); }
.refine-toolbox__item:disabled { opacity: .5; cursor: not-allowed; }
.refine-toolbox__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.refine-toolbox__chip {
  display: inline-flex; height: 28px; align-items: center; gap: 5px; padding: 0 10px;
  border: 1px solid var(--neo-border); border-radius: 9px; background: transparent;
  color: var(--neo-text-secondary); font-size: 11.5px; cursor: not-allowed;
}
.refine-toolbox__chip:disabled { opacity: .55; }
</style>
