<script setup lang="ts">
import { computed, ref } from 'vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import { maskCoverageMessage } from '@/utils/maskCoverage'
import ElementChipRow from './ElementChipRow.vue'

/**
 * 局部重绘面板（refine-inpaint 模式，2026-09-25 芯片化重做）：
 * 画笔涂抹松手自动成芯片（MaskEditor emitStrokes → store.addInpaintStrokeChip）；
 * 芯片条（ElementChipRow）：缩略 hover 放大、对象名、替换图（+ 本地/资产库）、
 * 修改内容、× 删除（同步擦主蒙版）；撤销 = 移除最后一枚（rail ⌘Z 已分流）。
 * prompt / 模型 / 尺寸 / 生成（含积分显示）归 RefineDock；生成蒙版 = 芯片碎片合并。
 */
const props = defineProps<{
  busy?: boolean
}>()

const editor = useCanvasEditorStore()

const coverageKind = computed(() => maskCoverageMessage(editor.refineCoverage))
const items = computed(() => editor.refineElementItems)

const coverageText = computed(() => {
  if (props.busy) return '生成中…'
  if (items.value.some((it) => it.recognizing)) return '替换图上传中…'
  if (items.value.length) return `已圈出 ${items.value.length} 处重绘区域，在下方输入描述后生成`
  if (coverageKind.value === 'empty') return '尚未涂抹：在图上刷出要重绘的区域，松手即成一处编辑'
  if (coverageKind.value === 'full') return '全图蒙版：将重绘整张图'
  return '已圈出重绘区域，在下方输入描述后生成'
})

const highlightedId = ref<string | null>(null)

function onRemove(id: string) {
  editor.removeInpaintChip(id)
  if (highlightedId.value === id) highlightedId.value = null
}
</script>

<template>
  <div class="inpaint-panel" data-testid="inpaint-panel">
    <div class="inpaint-panel__head">
      <span class="inpaint-panel__title">局部重绘</span>
      <span class="inpaint-panel__sub">涂抹区域 · 松手成一处编辑 · 只重画圈出的部分</span>
    </div>

    <!-- 工具行：画笔 / 矩形 + 大小（矩形/画笔松手都成芯片；芯片化后橡皮/清空由芯片 × / 撤销承担） -->
    <div class="inpaint-panel__tools">
      <button
        type="button"
        class="inpaint-panel__tool"
        :class="{ 'is-on': editor.refineTool === 'brush' }"
        data-testid="inpaint-tool-brush"
        :disabled="busy"
        @click="editor.setRefineTool('brush')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M5 19.5l3.8-.7L19.2 8.4a1.7 1.7 0 0 0 0-2.4l-1.2-1.2a1.7 1.7 0 0 0-2.4 0L5.7 15.2z" /><path d="M14.8 6.6l2.6 2.6" />
        </svg>
        画笔
      </button>
      <button
        type="button"
        class="inpaint-panel__tool"
        :class="{ 'is-on': editor.refineTool === 'rect' }"
        data-testid="inpaint-tool-rect"
        :disabled="busy"
        title="拖框圈出区域，松手成芯片，可 8 手柄调整"
        @click="editor.setRefineTool('rect')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" /><path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" /><path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" /><path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
        </svg>
        矩形
      </button>
      <label class="inpaint-panel__size">
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
    </div>

    <!-- 芯片条 -->
    <div v-if="items.length" class="inpaint-panel__list" data-testid="inpaint-chips">
      <ElementChipRow
        v-for="item in items"
        :key="item.id"
        :item="item"
        :highlighted="highlightedId === item.id"
        name-placeholder="区域名（可选）"
        @update:name="editor.updateRefineElementItem(item.id, { name: $event })"
        @update:modify="editor.updateRefineElementItem(item.id, { modify: $event })"
        @update:ref-url="editor.updateRefineElementItem(item.id, { refUrl: $event })"
        @remove="onRemove(item.id)"
        @highlight="highlightedId = $event ? item.id : null"
      />
      <button
        type="button"
        class="inpaint-panel__undo"
        data-testid="inpaint-undo-chip"
        :disabled="busy"
        title="撤销最后一处（⌘Z 同效）"
        @click="editor.undoInpaintChip()"
      >↺ 撤销上一处</button>
    </div>
    <div v-else class="inpaint-panel__coverage" :class="{ 'is-empty': coverageKind === 'empty' }" data-testid="inpaint-coverage">
      {{ coverageText }}
    </div>
    <div v-if="items.length" class="inpaint-panel__coverage" data-testid="inpaint-coverage-brief">
      {{ coverageText }}
    </div>

    <div class="inpaint-panel__hint">
      撤销 = 移除最后一处（⌘Z）；替换图「+」可上传本地或从资产库选图，生成时把该区域替换成图里的内容并自然融入。
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
  align-items: center;
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
  flex: 1;
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
.inpaint-panel__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 200px;
  overflow-y: auto;
}
.inpaint-panel__undo {
  align-self: flex-end;
  padding: 0.25rem 0.5rem;
  border-radius: 0.45rem;
  color: var(--neo-text-muted);
  font-size: 11px;
  cursor: pointer;
}
.inpaint-panel__undo:hover:not(:disabled) { background: color-mix(in srgb, var(--neo-text) 8%, transparent); }
.inpaint-panel__undo:disabled { cursor: not-allowed; opacity: 0.5; }
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
