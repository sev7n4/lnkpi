<script setup lang="ts">
import { computed } from 'vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import { maskCoverageMessage } from '@/utils/maskCoverage'

/**
 * 局部重绘面板（refine-inpaint 模式，2026-09-24 用户拍板补设计）：
 * 按其他产出型工具规范注册（workbenchToolRegistry → rail 模式入口 + panel + RefineDock）。
 * 与 select 模式共享蒙版通道（MaskEditor 在 inpaint 模式常显，RefineWorkViewport v-show），
 * 面板收敛为「画笔优先」：画笔/橡皮 + 大小 + 清空 + 覆盖读数；
 * prompt / 模型 / 尺寸 / 生成 / 应用归 RefineDock（注册表 dock: RefineDock, panel 落点）。
 * 进模式时默认画笔（由 RefineToolRail 的 toggleInpaint 置位）。
 */
const props = defineProps<{
  busy?: boolean
}>()

const editor = useCanvasEditorStore()

const coverageKind = computed(() => maskCoverageMessage(editor.refineCoverage))

const coverageText = computed(() => {
  if (props.busy) return '生成中…'
  if (coverageKind.value === 'empty') return '尚未涂抹：在图上刷出要重绘的区域'
  if (coverageKind.value === 'full') return '全图蒙版：将重绘整张图'
  return '已圈出重绘区域，在下方输入描述后生成'
})

function pickTool(tool: 'brush' | 'eraser') {
  editor.setRefineTool(tool)
}
</script>

<template>
  <div class="inpaint-panel" data-testid="inpaint-panel">
    <div class="inpaint-panel__head">
      <span class="inpaint-panel__title">局部重绘</span>
      <span class="inpaint-panel__sub">涂抹区域 · 描述改动 · 只重画圈出的部分</span>
    </div>

    <!-- 工具行：画笔 / 橡皮（与 store.refineTool 共享，MaskEditor 实时生效） -->
    <div class="inpaint-panel__tools">
      <button
        type="button"
        class="inpaint-panel__tool"
        :class="{ 'is-on': editor.refineTool === 'brush' }"
        data-testid="inpaint-tool-brush"
        :disabled="busy"
        @click="pickTool('brush')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M5 19.5l3.8-.7L19.2 8.4a1.7 1.7 0 0 0 0-2.4l-1.2-1.2a1.7 1.7 0 0 0-2.4 0L5.7 15.2z" /><path d="M14.8 6.6l2.6 2.6" />
        </svg>
        画笔
      </button>
      <button
        type="button"
        class="inpaint-panel__tool"
        :class="{ 'is-on': editor.refineTool === 'eraser' }"
        data-testid="inpaint-tool-eraser"
        :disabled="busy"
        @click="pickTool('eraser')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M20 20H8.5l-4.2-4.2a1.5 1.5 0 0 1 0-2.1L13.7 4.3a1.5 1.5 0 0 1 2.1 0l4.9 4.9a1.5 1.5 0 0 1 0 2.1L13 19" />
        </svg>
        橡皮
      </button>
      <button
        type="button"
        class="inpaint-panel__tool"
        data-testid="inpaint-clear"
        :disabled="busy"
        @click="editor.getRefineMask()?.clear()"
      >
        清空
      </button>
    </div>

    <!-- 笔刷大小 -->
    <label class="inpaint-panel__size">
      <span>笔刷大小</span>
      <input
        v-model.number="editor.refineBrushSize"
        type="range"
        min="4"
        max="120"
        step="1"
        data-testid="inpaint-brush-size"
        :disabled="busy"
      >
      <b>{{ editor.refineBrushSize }}</b>
    </label>

    <!-- 覆盖读数 + 引导 -->
    <div class="inpaint-panel__coverage" :class="{ 'is-empty': coverageKind === 'empty' }" data-testid="inpaint-coverage">
      {{ coverageText }}
    </div>

    <div class="inpaint-panel__hint">
      撤销 / 重做在左栏工具条（⌘Z / ⇧⌘Z）；需要智能点选或形状选区时切到「选区」模式，蒙版会带回来。
    </div>
  </div>
</template>

<style scoped>
.inpaint-panel {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.inpaint-panel__head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.inpaint-panel__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--neo-text-primary, var(--neo-text));
}
.inpaint-panel__sub {
  font-size: 11px;
  color: var(--neo-text-muted, var(--neo-text));
  opacity: 0.75;
}
.inpaint-panel__tools {
  display: flex;
  gap: 0.35rem;
}
.inpaint-panel__tool {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--neo-border, transparent);
  border-radius: 0.5rem;
  background: transparent;
  color: var(--neo-text);
  font-size: 11.5px;
  line-height: 1.2;
  white-space: nowrap;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.inpaint-panel__tool:hover:not(:disabled) {
  background: color-mix(in srgb, var(--neo-text) 8%, transparent);
}
.inpaint-panel__tool.is-on {
  background: color-mix(in srgb, var(--neo-text) 14%, transparent);
  color: var(--neo-text-primary, var(--neo-text));
  border-color: color-mix(in srgb, var(--neo-text) 24%, transparent);
}
.inpaint-panel__tool:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.inpaint-panel__size {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 11.5px;
  color: var(--neo-text);
}
.inpaint-panel__size input[type='range'] {
  flex: 1;
  accent-color: var(--neo-text);
  cursor: pointer;
}
.inpaint-panel__size b {
  min-width: 2ch;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.inpaint-panel__coverage {
  padding: 0.45rem 0.6rem;
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--neo-text) 6%, transparent);
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--neo-text);
}
.inpaint-panel__coverage.is-empty {
  opacity: 0.75;
}
.inpaint-panel__hint {
  font-size: 10.5px;
  line-height: 1.55;
  color: var(--neo-text-muted, var(--neo-text));
  opacity: 0.7;
}
</style>
