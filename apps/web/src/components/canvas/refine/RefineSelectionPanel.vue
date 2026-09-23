<script setup lang="ts">
/**
 * 精修「选区」模式的右栏面板（spec 图 6）：① 选择方式 ② 工具（三组 7 枚）③ 参数 ④ 选区操作。
 * 不发 emit：全部直接读写 store（与 RefineToolRail 同范式，spec §5.2）。
 * 固定页脚（Esc 三态）在 RefineSidePanel，对全部模式生效，不在本组件。
 */
import { computed } from 'vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import type { RefineMaskTool } from '@/stores/canvasEditor'
import {
  REFINE_MASK_OP_OPTIONS,
  REFINE_SELECTION_COMMANDS,
  REFINE_SELECTION_GROUPS,
  REFINE_TOOL_SPECS,
  refineToolParamKind,
} from './refineSelectionModel'

withDefaults(defineProps<{ busy?: boolean }>(), { busy: false })

const editor = useCanvasEditorStore()
const paramKind = computed(() => refineToolParamKind(editor.refineTool))
const toolHint = computed(() => REFINE_TOOL_SPECS[editor.refineTool].hint)

function pickTool(tool: RefineMaskTool) {
  editor.setRefineTool(tool)
}
function runCommand(id: 'invert' | 'clear') {
  const mask = editor.getRefineMask()
  if (id === 'invert') mask?.invert()
  else mask?.clear()
}
function onBrushSize(e: Event) { editor.refineBrushSize = Number((e.target as HTMLInputElement).value) }
function onBrushColor(e: Event) { editor.refineBrushColor = (e.target as HTMLInputElement).value }
function onWandTolerance(e: Event) { editor.setRefineWandTolerance(Number((e.target as HTMLInputElement).value)) }
</script>

<template>
  <section class="refine-selection-panel" data-testid="refine-selection-panel">
    <div class="refine-selection-panel__group">
      <div class="refine-selection-panel__glabel">选择方式</div>
      <div class="refine-selection-panel__ops">
        <button
          v-for="opt in REFINE_MASK_OP_OPTIONS"
          :key="opt.op"
          type="button"
          class="refine-selection-panel__op"
          :class="{ 'is-on': editor.refineMaskOp === opt.op }"
          :data-testid="`refine-selection-op-${opt.op}`"
          :title="opt.hint"
          :aria-pressed="editor.refineMaskOp === opt.op"
          @click="editor.refineMaskOp = opt.op"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>

    <div v-for="group in REFINE_SELECTION_GROUPS" :key="group.id" class="refine-selection-panel__group">
      <div class="refine-selection-panel__glabel">{{ group.label }}</div>
      <div class="refine-selection-panel__tools">
        <button
          v-for="tool in group.tools"
          :key="tool"
          type="button"
          class="refine-selection-panel__tool"
          :class="{ 'is-on': editor.refineTool === tool }"
          :data-testid="`refine-selection-tool-${tool}`"
          :title="REFINE_TOOL_SPECS[tool].hint"
          :aria-label="REFINE_TOOL_SPECS[tool].label"
          :aria-pressed="editor.refineTool === tool"
          @click="pickTool(tool)"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path v-for="(d, i) in REFINE_TOOL_SPECS[tool].icon" :key="i" :d="d" />
          </svg>
          <span>{{ REFINE_TOOL_SPECS[tool].label }}</span>
        </button>
      </div>
    </div>

    <div class="refine-selection-panel__group">
      <div class="refine-selection-panel__glabel">参数 · {{ REFINE_TOOL_SPECS[editor.refineTool].label }}</div>
      <label v-if="paramKind === 'brush'" class="refine-selection-panel__param" data-testid="refine-selection-param-brush" title="笔刷粗细与选区颜色">
        <input type="range" min="4" max="80" :value="editor.refineBrushSize" @input="onBrushSize">
        <span>{{ editor.refineBrushSize }}</span>
        <input type="color" :value="editor.refineBrushColor" title="选区颜色" @input="onBrushColor">
      </label>
      <label v-else-if="paramKind === 'wand'" class="refine-selection-panel__param" data-testid="refine-selection-param-wand" title="魔棒容差">
        <input type="range" min="0" max="48" step="1" :value="editor.refineWandTolerance" @input="onWandTolerance">
        <span>{{ editor.refineWandTolerance }}</span>
      </label>
      <div v-else class="refine-selection-panel__param" data-testid="refine-selection-param-none" />
    </div>
    <p class="refine-selection-panel__hint" data-testid="refine-selection-param-hint">{{ toolHint }}</p>

    <div class="refine-selection-panel__group">
      <div class="refine-selection-panel__glabel">选区操作</div>
      <button
        v-for="cmd in REFINE_SELECTION_COMMANDS"
        :key="cmd.id"
        type="button"
        class="refine-selection-panel__cmd"
        :data-testid="`refine-selection-command-${cmd.id}`"
        :title="cmd.hint"
        @click="runCommand(cmd.id)"
      >
        {{ cmd.label }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.refine-selection-panel { display: flex; flex-direction: column; gap: 14px; padding: 12px; }
.refine-selection-panel__group { display: flex; flex-direction: column; gap: 6px; }
.refine-selection-panel__glabel { color: var(--neo-text-muted); font-size: 10.5px; letter-spacing: .04em; }
.refine-selection-panel__ops { display: flex; gap: 6px; }
.refine-selection-panel__op {
  flex: 1; padding: 6px 0; border: 1px solid var(--neo-border); border-radius: 9px;
  background: transparent; color: var(--neo-text-secondary); font-size: 12px; cursor: pointer;
}
.refine-selection-panel__op.is-on {
  border-color: color-mix(in srgb, var(--neo-hi-text) 30%, var(--neo-border));
  background: var(--neo-hi-bg); color: var(--neo-hi-text);
}
.refine-selection-panel__tools { display: flex; flex-wrap: wrap; gap: 6px; }
.refine-selection-panel__tool {
  display: flex; align-items: center; gap: 5px; padding: 5px 9px;
  border: 1px solid var(--neo-border); border-radius: 9px;
  background: transparent; color: var(--neo-text-secondary); font-size: 11.5px; cursor: pointer;
}
.refine-selection-panel__tool:hover { background: var(--neo-hover-bg); color: var(--neo-text-primary); }
.refine-selection-panel__tool.is-on {
  border-color: color-mix(in srgb, var(--neo-hi-text) 30%, var(--neo-border));
  background: var(--neo-hi-bg); color: var(--neo-hi-text);
}
.refine-selection-panel__param { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--neo-text-secondary); }
.refine-selection-panel__param input[type='range'] { width: 120px; }
.refine-selection-panel__param input[type='color'] { width: 22px; height: 18px; padding: 0; border: none; background: none; }
.refine-selection-panel__hint { margin: -8px 0 0; color: var(--neo-text-muted); font-size: 11px; line-height: 1.5; }
.refine-selection-panel__cmd {
  display: block; width: 100%; padding: 6px 10px; border: 1px solid var(--neo-border);
  border-radius: 9px; background: transparent; color: var(--neo-text-primary);
  font-size: 12.5px; text-align: left; cursor: pointer;
}
.refine-selection-panel__cmd:hover { background: var(--neo-hover-bg); }
</style>
