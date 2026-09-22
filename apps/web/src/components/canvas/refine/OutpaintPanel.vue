<script setup lang="ts">
import { computed } from 'vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import {
  floorOutpaintRect,
  formatAspectLabel,
  hasOutpaintExtension,
  outpaintExtensionAmounts,
  type Size,
} from './outpaintGeometry'

const props = withDefaults(defineProps<{ busy?: boolean }>(), { busy: false })

const editor = useCanvasEditorStore()

/** 比例预设（§6.2）：null = 原图。点击 = 替换当前矩形，不做累积。 */
const ASPECT_PRESETS: { id: string; label: string; ratio: { w: number; h: number } | null }[] = [
  { id: 'base', label: '原图', ratio: null },
  { id: '1-1', label: '1:1', ratio: { w: 1, h: 1 } },
  { id: '4-3', label: '4:3', ratio: { w: 4, h: 3 } },
  { id: '3-4', label: '3:4', ratio: { w: 3, h: 4 } },
  { id: '16-9', label: '16:9', ratio: { w: 16, h: 9 } },
  { id: '9-16', label: '9:16', ratio: { w: 9, h: 16 } },
]

const base = computed<Size | null>(() => editor.refineOutpaintBase)
const rect = computed(() => (editor.refineOutpaintRect ? floorOutpaintRect(editor.refineOutpaintRect) : null))
const extended = computed(() => (!!base.value && !!rect.value ? hasOutpaintExtension(base.value, rect.value) : false))
const amounts = computed(() =>
  base.value && rect.value
    ? outpaintExtensionAmounts(base.value, rect.value)
    : { west: 0, east: 0, north: 0, south: 0 },
)
const aspectLabel = computed(() => (rect.value ? formatAspectLabel(rect.value.width, rect.value.height) : '—'))

/** 当前激活的 chip：原图 = 无扩展；比例 chip = 与当前画布比例一致（2% 容差由 formatAspectLabel 承担）。 */
const activePresetId = computed(() => {
  if (!extended.value) return 'base'
  const hit = ASPECT_PRESETS.find((p) => p.ratio && p.label === aspectLabel.value)
  return hit?.id ?? null
})

const disabled = computed(() => props.busy || !base.value)

function pickPreset(ratio: { w: number; h: number } | null) {
  if (disabled.value) return
  editor.applyOutpaintAspectPreset(ratio)
}

function onSizeCommit(axis: 'width' | 'height', raw: string) {
  if (disabled.value || !rect.value) return
  const parsed = Number.parseInt(raw, 10)
  const next = Number.isFinite(parsed) ? parsed : axis === 'width' ? rect.value.width : rect.value.height
  editor.applyOutpaintSize(
    axis === 'width' ? next : rect.value.width,
    axis === 'height' ? next : rect.value.height,
  )
}

function onReset() {
  if (disabled.value) return
  editor.resetOutpaintRect()
}

/** 扩展量的方向符号（只读展示）。 */
const EXT_ROWS: { key: 'west' | 'east' | 'north' | 'south'; arrow: string; label: string }[] = [
  { key: 'west', arrow: '←', label: '西' },
  { key: 'east', arrow: '→', label: '东' },
  { key: 'north', arrow: '↑', label: '北' },
  { key: 'south', arrow: '↓', label: '南' },
]
</script>

<template>
  <section class="outpaint-panel" data-testid="outpaint-panel">
    <div class="outpaint-panel__group">
      <div class="outpaint-panel__glabel">画布比例</div>
      <div class="outpaint-panel__chips">
        <button
          v-for="preset in ASPECT_PRESETS"
          :key="preset.id"
          type="button"
          class="outpaint-panel__chip"
          :class="{ 'is-active': activePresetId === preset.id }"
          :data-testid="`outpaint-aspect-${preset.id}`"
          :disabled="disabled"
          :title="preset.ratio ? `按 ${preset.label} 扩展（包含原图、对称均分）` : '恢复原图尺寸'"
          @click="pickPreset(preset.ratio)"
        >
          {{ preset.label }}
        </button>
      </div>
    </div>

    <div class="outpaint-panel__group">
      <div class="outpaint-panel__glabel">画布尺寸（px）</div>
      <div class="outpaint-panel__size">
        <input
          class="outpaint-panel__input"
          type="number"
          inputmode="numeric"
          data-testid="outpaint-width-input"
          :value="rect?.width ?? ''"
          :disabled="disabled"
          aria-label="画布宽度"
          @change="onSizeCommit('width', ($event.target as HTMLInputElement).value)"
        >
        <span class="outpaint-panel__times">×</span>
        <input
          class="outpaint-panel__input"
          type="number"
          inputmode="numeric"
          data-testid="outpaint-height-input"
          :value="rect?.height ?? ''"
          :disabled="disabled"
          aria-label="画布高度"
          @change="onSizeCommit('height', ($event.target as HTMLInputElement).value)"
        >
        <button
          type="button"
          class="outpaint-panel__reset"
          data-testid="outpaint-reset"
          :disabled="disabled"
          title="重置为原图尺寸"
          @click="onReset"
        >
          重置
        </button>
      </div>
    </div>

    <div class="outpaint-panel__group">
      <div class="outpaint-panel__glabel">扩展量</div>
      <div class="outpaint-panel__ext">
        <span
          v-for="row in EXT_ROWS"
          :key="row.key"
          class="outpaint-panel__ext-item"
          :data-testid="`outpaint-ext-${row.key}`"
        >
          <em>{{ row.arrow }} {{ row.label }}</em>{{ amounts[row.key] }}
        </span>
      </div>
    </div>

    <p v-if="!extended" class="outpaint-panel__hint" data-testid="outpaint-panel-hint">
      先拖动画布四周手柄扩展画布，扩出区域将由 AI 生成
    </p>
  </section>
</template>

<style scoped>
.outpaint-panel { display: flex; flex-direction: column; gap: 14px; padding: 12px; }
.outpaint-panel__glabel { margin-bottom: 6px; color: var(--neo-text-muted); font-size: 10.5px; letter-spacing: .04em; }
.outpaint-panel__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.outpaint-panel__chip {
  height: 28px; padding: 0 12px; border: 1px solid var(--neo-border); border-radius: 9px;
  background: transparent; color: var(--neo-text-secondary); font-size: 11.5px; cursor: pointer;
}
.outpaint-panel__chip:hover:not(:disabled) { background: var(--neo-hover-bg); }
.outpaint-panel__chip.is-active { border-color: rgba(74, 158, 255, .5); background: rgba(0, 89, 179, .16); color: #7cc0ff; }
.outpaint-panel__chip:disabled { opacity: .45; cursor: not-allowed; }
.outpaint-panel__size { display: flex; align-items: center; gap: 6px; }
.outpaint-panel__input {
  width: 78px; height: 28px; padding: 0 8px; border: 1px solid var(--neo-border); border-radius: 8px;
  background: transparent; color: var(--neo-text-primary); font-size: 12px;
}
.outpaint-panel__times { color: var(--neo-text-muted); font-size: 12px; }
.outpaint-panel__reset {
  margin-left: auto; height: 28px; padding: 0 10px; border: 1px solid var(--neo-border);
  border-radius: 8px; background: transparent; color: var(--neo-text-secondary); font-size: 11.5px; cursor: pointer;
}
.outpaint-panel__reset:hover:not(:disabled) { background: var(--neo-hover-bg); }
.outpaint-panel__reset:disabled { opacity: .45; cursor: not-allowed; }
.outpaint-panel__ext { display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 11.5px; color: var(--neo-text-primary); }
.outpaint-panel__ext-item em { margin-right: 4px; color: var(--neo-text-muted); font-style: normal; }
.outpaint-panel__hint { margin: 0; color: var(--neo-text-muted); font-size: 11px; line-height: 1.5; }
</style>
