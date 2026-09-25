<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import { persistMediaUrl } from '@/composables/useMediaUpload'
import { loadCropSourceImage, renderCropBlob } from './cropExport'
import DockCreditBadge from '@/components/canvas/dock-studio/shared/DockCreditBadge.vue'
import {
  CROP_FINE_MAX,
  CROP_FINE_MIN,
  clampCropRect,
  formatCropReadout,
  type CropAspectId,
} from './cropGeometry'
import { parseSizeInput } from './outpaintGeometry'

/**
 * 裁剪模式右栏面板（注册表 refine-crop 的 panel）。
 * 直读 store 范式（#404 §5.2）：不发 emit 管状态；仅「应用到画布」上抛给父级 onApply（与 matting 同链路）。
 * 本地产出链路（与 runMattingMask 同构，纯浏览器端 0 积分）：
 *   loadCropSourceImage → renderCropBlob → persistMediaUrl → pushRefineSessionResult({ prompt: '裁剪' })。
 */
const props = withDefaults(defineProps<{ busy?: boolean }>(), { busy: false })

const emit = defineEmits<{ apply: [] }>()

const editor = useCanvasEditorStore()
const localBusy = ref(false)
const busy = computed(() => props.busy || localBusy.value || editor.refineBusy)

const rect = computed(() => editor.refineCropRect)
const rotation = computed(() => editor.refineCropRotationDeg)
const aspect = computed(() => editor.refineCropAspect)
const readout = computed(() => (rect.value ? formatCropReadout(rect.value) : '—'))
const rotationLabel = computed(() => {
  const deg = rotation.value
  if (deg === 0) return '0°'
  return deg > 0 ? `+${deg}°` : `${deg}°`
})

const ASPECT_PRESETS: { id: CropAspectId; label: string }[] = [
  { id: 'free', label: '自由' },
  { id: '1:1', label: '1:1' },
  { id: '4:3', label: '4:3' },
  { id: '3:4', label: '3:4' },
  { id: '16:9', label: '16:9' },
  { id: '9:16', label: '9:16' },
]

function pickPreset(id: CropAspectId) {
  if (busy.value) return
  editor.applyCropAspectPreset(id)
}

// —— 目标尺寸输入（2026-09-25：填写如 1024x768 → 锁定该宽高比） ——
const sizeDraft = ref('')
const sizeHint = ref('')
const isCustomRatio = computed(() => editor.refineCropAspect === 'free' && editor.refineCropCustomRatio != null)

function applyTargetSize() {
  if (busy.value) return
  const parsed = parseSizeInput(sizeDraft.value)
  if (!parsed) {
    sizeHint.value = '格式：宽x高，如 1024x768'
    return
  }
  editor.applyCropCustomRatio(parsed.width, parsed.height)
  sizeHint.value = ''
}

function rotateStep(step: 1 | -1) {
  if (busy.value) return
  editor.applyCropRotation(editor.refineCropTurns + step, editor.refineCropFine)
}

function onFineChange(event: Event) {
  if (busy.value) return
  const raw = Number((event.target as HTMLInputElement).value)
  editor.applyCropRotation(editor.refineCropTurns, Number.isFinite(raw) ? raw : 0)
}

function resetRotation() {
  if (busy.value) return
  editor.applyCropRotation(0, 0)
}

const canCrop = computed(() => !busy.value && !!editor.refineCropBase && !!rect.value)

function formatError(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

async function runCrop() {
  if (!canCrop.value) return
  const url = editor.imageTarget?.url
  const r = editor.refineCropRect
  if (!url || !r) return
  localBusy.value = true
  editor.setRefineBusy(true)
  try {
    const img = await loadCropSourceImage(url)
    // 防御：以真实像素尺寸再钳一次（base 与 natural 理论一致，浮点/回填时序可能有毫级差）
    const safeRect = clampCropRect(r, img.naturalWidth, img.naturalHeight, rotation.value)
    const blob = await renderCropBlob(img, { rect: safeRect, rotationDeg: rotation.value })
    const file = new File([blob], 'crop.png', { type: 'image/png' })
    const fallbackUrl = URL.createObjectURL(file)
    let persisted: string
    try {
      persisted = await persistMediaUrl(file, fallbackUrl)
    } catch (e) {
      URL.revokeObjectURL(fallbackUrl)
      throw e
    }
    if (persisted !== fallbackUrl) URL.revokeObjectURL(fallbackUrl)
    editor.pushRefineSessionResult({ url: persisted, prompt: '裁剪' })
    ElMessage.success('已生成裁剪结果')
  } catch (err) {
    ElMessage.error(formatError(err, '裁剪失败，请重试'))
  } finally {
    localBusy.value = false
    editor.setRefineBusy(false)
  }
}

const canApply = computed(() => !!editor.currentRefineSessionResult && !busy.value)
</script>

<template>
  <section class="crop-panel" data-testid="crop-panel">
    <div class="crop-panel__block">
      <div class="crop-panel__head">
        <span>裁剪框</span>
        <b data-testid="crop-panel-readout">{{ readout }} px</b>
      </div>

      <div class="crop-panel__label">比例</div>
      <div class="crop-panel__chips">
        <button
          v-for="preset in ASPECT_PRESETS"
          :key="preset.id"
          type="button"
          class="crop-panel__chip"
          :class="{ 'is-on': aspect === preset.id && !isCustomRatio }"
          :data-testid="`crop-aspect-${preset.id.replace(':', '-')}`"
          :disabled="busy"
          @click="pickPreset(preset.id)"
        >{{ preset.label }}</button>
      </div>
      <div class="crop-panel__size">
        <span>目标尺寸</span>
        <input
          v-model="sizeDraft"
          type="text"
          class="crop-panel__size-input"
          placeholder="1024x768"
          data-testid="crop-size-input"
          aria-label="裁剪目标尺寸，如 1024x768"
          :disabled="busy"
          @keydown.enter.prevent="applyTargetSize"
        >
        <button
          type="button"
          class="crop-panel__chip"
          data-testid="crop-size-apply"
          :disabled="busy"
          @click="applyTargetSize"
        >应用</button>
        <b v-if="isCustomRatio" data-testid="crop-size-custom">自定义比例</b>
      </div>
      <p v-if="sizeHint" class="crop-panel__size-hint" data-testid="crop-size-hint">{{ sizeHint }}</p>

      <div class="crop-panel__label">旋转</div>
      <div class="crop-panel__row">
        <button
          type="button"
          class="crop-panel__chip"
          data-testid="crop-rotate-left"
          :disabled="busy"
          aria-label="逆时针旋转 90°"
          @click="rotateStep(-1)"
        >↺ 90°</button>
        <button
          type="button"
          class="crop-panel__chip"
          data-testid="crop-rotate-right"
          :disabled="busy"
          aria-label="顺时针旋转 90°"
          @click="rotateStep(1)"
        >↻ 90°</button>
        <button
          type="button"
          class="crop-panel__chip"
          data-testid="crop-rotation-reset"
          :disabled="busy || rotation === 0"
          @click="resetRotation"
        >复位</button>
      </div>
      <div class="crop-panel__fine">
        <span>微调</span>
        <input
          type="range"
          data-testid="crop-fine-slider"
          :min="CROP_FINE_MIN"
          :max="CROP_FINE_MAX"
          :step="1"
          :value="editor.refineCropFine"
          :disabled="busy"
          @change="onFineChange"
        >
        <b data-testid="crop-rotation-readout">{{ rotationLabel }}</b>
      </div>
      <p class="crop-panel__hint">旋转会自动收拢裁剪框到图像内；拖画布上的框可微调构图。</p>
    </div>

    <div class="crop-panel__actions">
      <button
        type="button"
        class="crop-panel__btn crop-panel__primary"
        data-testid="crop-run"
        :disabled="!canCrop"
        @click="runCrop"
      >生成裁剪</button>
      <button
        type="button"
        class="crop-panel__btn"
        data-testid="crop-apply"
        :disabled="!canApply"
        @click="emit('apply')"
      >应用到画布</button>
      <DockCreditBadge :credits="0" />
    </div>
  </section>
</template>

<style scoped>
.crop-panel { display: flex; flex-direction: column; gap: 12px; padding: 12px; }

.crop-panel__block { display: flex; flex-direction: column; gap: 8px; }
.crop-panel__head {
  display: flex; align-items: center; justify-content: space-between;
  color: var(--neo-text-secondary); font-size: 12px;
}
.crop-panel__head b { color: var(--neo-text-primary); font-size: 12.5px; }

.crop-panel__label { color: var(--neo-text-muted); font-size: 11px; }
.crop-panel__chips, .crop-panel__row { display: flex; flex-wrap: wrap; gap: 6px; }

.crop-panel__size { display: flex; align-items: center; gap: 6px; color: var(--neo-text-muted); font-size: 11px; }
.crop-panel__size-input {
  width: 84px;
  padding: 4px 8px;
  border: 1px solid var(--neo-border);
  border-radius: 8px;
  background: transparent;
  color: var(--neo-text-primary);
  font-size: 11.5px;
}
.crop-panel__size-input:focus { outline: 1px solid color-mix(in srgb, var(--neo-accent-text, #a89dff) 55%, var(--neo-border)); }
.crop-panel__size b { color: var(--neo-accent-text, #a89dff); font-size: 10.5px; font-weight: 600; }
.crop-panel__size-hint { margin: 0; color: #f56c6c; font-size: 10.5px; }

.crop-panel__chip {
  padding: 5px 10px;
  border: 1px solid var(--neo-border);
  border-radius: 9px;
  background: transparent;
  color: var(--neo-text-secondary);
  font-size: 11.5px;
  cursor: pointer;
}
.crop-panel__chip:hover:not(:disabled) { background: var(--neo-hover-bg); color: var(--neo-text-primary); }
.crop-panel__chip.is-on {
  border-color: color-mix(in srgb, var(--neo-accent-text, #a89dff) 55%, var(--neo-border));
  color: var(--neo-accent-text, #a89dff);
}
.crop-panel__chip:disabled { opacity: .5; cursor: not-allowed; }

.crop-panel__fine { display: flex; align-items: center; gap: 8px; color: var(--neo-text-muted); font-size: 11px; }
.crop-panel__fine input[type='range'] { min-width: 0; flex: 1; }
.crop-panel__fine b { min-width: 38px; color: var(--neo-text-primary); font-size: 11.5px; text-align: right; }

.crop-panel__hint { margin: 0; color: var(--neo-text-muted); font-size: 10.5px; line-height: 1.5; }

.crop-panel__actions { display: flex; flex-direction: column; gap: 8px; }
.crop-panel__btn {
  display: block; width: 100%; padding: 8px 10px;
  border: 1px solid var(--neo-border); border-radius: 10px;
  background: transparent; color: var(--neo-text-primary);
  font-size: 12.5px; text-align: center; cursor: pointer;
}
.crop-panel__btn:hover:not(:disabled) { background: var(--neo-hover-bg); }
.crop-panel__primary {
  border-color: color-mix(in srgb, var(--neo-accent-text, #a89dff) 55%, var(--neo-border));
  color: var(--neo-accent-text, #a89dff);
}
.crop-panel__btn:disabled { opacity: .5; cursor: not-allowed; }
</style>
