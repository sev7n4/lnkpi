<script setup lang="ts">
import { computed } from 'vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import { refineWorkspaceLabel, toolLabel, toolParamKind } from './refineToolRailModel'

const editor = useCanvasEditorStore()
const paramKind = computed(() => toolParamKind(editor.refineTool))
const escHint = computed(() => (editor.compareLightboxOpen ? 'Esc 回到工作图' : 'Esc 退出精修'))

function onBrushSize(e: Event) { editor.refineBrushSize = Number((e.target as HTMLInputElement).value) }
function onBrushColor(e: Event) { editor.refineBrushColor = (e.target as HTMLInputElement).value }
function onWandTolerance(e: Event) { editor.setRefineWandTolerance(Number((e.target as HTMLInputElement).value)) }
</script>

<template>
  <div class="refine-modebar" data-testid="refine-modebar">
    <span class="refine-modebar__ws" data-testid="modebar-workspace">
      {{ refineWorkspaceLabel({ compareOpen: editor.compareLightboxOpen, compareMode: editor.refineCompareMode }) }}
    </span>

    <template v-if="!editor.compareLightboxOpen">
      <span class="refine-modebar__sep" />
      <span class="refine-modebar__tool" data-testid="modebar-tool">{{ toolLabel(editor.refineTool) }}</span>

      <label v-if="paramKind === 'brush'" class="refine-modebar__slider" data-testid="modebar-param-brush" title="笔刷粗细">
        <input type="range" min="4" max="80" :value="editor.refineBrushSize" @input="onBrushSize">
        <span>{{ editor.refineBrushSize }}</span>
        <input type="color" :value="editor.refineBrushColor" title="选区颜色" @input="onBrushColor">
      </label>

      <label v-else-if="paramKind === 'wand'" class="refine-modebar__slider" data-testid="modebar-param-wand" title="魔棒容差">
        <input type="range" min="0" max="48" step="1" :value="editor.refineWandTolerance" @input="onWandTolerance">
        <span>{{ editor.refineWandTolerance }}</span>
      </label>

      <span v-else-if="paramKind === 'polygon-hint'" class="refine-modebar__hint" data-testid="modebar-hint-polygon">
        单击落点 · 双击闭合
      </span>
    </template>

    <span class="refine-modebar__esc" data-testid="modebar-esc">{{ escHint }}</span>
  </div>
</template>

<style scoped>
.refine-modebar {
  display: flex; height: 32px; flex: 0 0 32px; align-items: center; gap: 10px; padding: 0 12px;
  border-bottom: 1px solid var(--neo-border); color: var(--neo-text-secondary); font-size: 12px;
}
.refine-modebar__ws { font-weight: 650; }
.refine-modebar__sep { width: 1px; height: 14px; background: var(--neo-border); }
.refine-modebar__tool { color: var(--neo-text-primary); }
.refine-modebar__slider { display: inline-flex; align-items: center; gap: 6px; }
.refine-modebar__slider input[type='range'] { width: 96px; }
.refine-modebar__slider input[type='color'] { width: 22px; height: 18px; padding: 0; border: none; background: none; }
.refine-modebar__hint { color: var(--neo-text-muted); }
.refine-modebar__esc { margin-left: auto; color: var(--neo-text-muted); font-size: 11px; }
</style>
