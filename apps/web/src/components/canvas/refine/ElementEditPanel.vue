<script setup lang="ts">
import { computed, markRaw, ref } from 'vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import { persistMediaUrl } from '@/composables/useMediaUpload'
import { studioApi } from '@/services/studio-api'
import { combineElementEditPrompt } from '@/components/canvas/elementEditModel'
import ElementChipRow from './ElementChipRow.vue'
import {
  CANVAS_GENERATE_CREDITS,
  decodeChannelModel,
  P1_IMAGE_EDIT_MODEL_KEY,
} from '@lnkpi/shared'
import { useModelProviderSettings } from '@/composables/useModelProviderSettings'

/**
 * 元素编辑面板（精修右栏，element 模式，2026-09-25 重做版）：
 *  - 焦点选择（默认）：直接点图上元素 → element-recognize（SAM 分割 + 识图命名）→ 芯片自动入列；
 *    （点选分派由 RefineSidePanel.onPointSelect 转发——单槽 handler 时序修复）
 *  - 矩形/画笔：画选区 →「+ 添加当前选区」→ 以选区中心再识别命名；
 *  - 芯片条（ElementChipRow）：缩略 hover 放大、对象名可编辑、【修改】输入、
 *    「+」替换图（本地/资产库，对象替换）、× 删除；撤销移除最后一枚；
 *  -【⚡生成】累积蒙版 + combined prompt + 替换参考图 → image/edit mode:'inpaint' → 会话胶片条。
 */
const editor = useCanvasEditorStore()
const { getConfig } = useModelProviderSettings()

/**
 * 元素编辑生成模型：dock 选中的 BYOK 渠道（channelId::modelName）优先——
 * 生成是用户归属成本，用户插了自己的 key 就不该烧平台 apimart；
 * 平台目录/未配置时回落白名单 image2。服务端按 decodeChannelModel 分流。
 */
const editModel = computed(() => {
  const dockModel = getConfig('image').model
  const decoded = dockModel ? decodeChannelModel(dockModel) : null
  return decoded && decoded.channelId !== 'platform' ? dockModel : P1_IMAGE_EDIT_MODEL_KEY
})

const emit = defineEmits<{
  busy: [value: boolean]
}>()

const busy = ref(false)
const errorMessage = ref('')

const items = computed(() => editor.refineElementItems)
const canAdd = computed(() => editor.refineMaskAvailable && !busy.value)
const canGenerate = computed(
  () => !busy.value && items.value.length > 0 && items.value.every((it) => !it.recognizing) && items.value.some((it) => it.modify.trim().length > 0) && !!editor.refineElementMaskCanvas,
)

const highlightedId = ref<string | null>(null)

const tool = computed(() => editor.refineTool)
function pickTool(t: 'point' | 'rect' | 'brush') {
  editor.setRefineTool(t)
}

/** piece 的选中区包围盒（像素）；用于区域识别取中心点。 */
function pieceBBox(piece: HTMLCanvasElement): { x: number; y: number; width: number; height: number } | null {
  const ctx = piece.getContext('2d')
  if (!ctx) return null
  const d = ctx.getImageData(0, 0, piece.width, piece.height).data
  let minX = piece.width
  let minY = piece.height
  let maxX = -1
  let maxY = -1
  for (let i = 0; i < piece.width * piece.height; i += 1) {
    const a = d[i * 4 + 3]!
    const r = d[i * 4]!
    const hit = a > 127 || r > 127
    if (!hit) continue
    const x = i % piece.width
    const y = Math.floor(i / piece.width)
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  if (maxX < 0) return null
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/** 当前选区加入（矩形/画笔路径）：登记芯片 → 以选区中心点识别命名。 */
async function addCurrentSelection() {
  const handle = editor.getRefineMask()
  const src = handle?.getCanvas()
  if (!src || !editor.refineMaskAvailable) return
  const copy = document.createElement('canvas')
  copy.width = src.width
  copy.height = src.height
  const ctx = copy.getContext('2d')
  if (!ctx) return
  ctx.drawImage(src, 0, 0)
  handle?.clear()
  const item = editor.addRefineElementItem(copy, '选区', '')
  if (!item) return
  // 以选区中心点识别命名（SAM 对中心点所在对象分割，多数情况与框选意图一致）
  const bbox = pieceBBox(copy)
  if (bbox) {
    item.recognizing = true
    try {
      const { data } = await studioApi.recognizeElement({
        imageUrl: editor.imageTarget?.url ?? '',
        x: Math.round(bbox.x + bbox.width / 2),
        y: Math.round(bbox.y + bbox.height / 2),
      })
      item.name = data.data.name || '选区'
      const maskImg = await loadImage(data.data.maskUrl)
      if (maskImg && item.piece.width === src.width && item.piece.height === src.height) {
        const sam = document.createElement('canvas')
        sam.width = src.width
        sam.height = src.height
        const sctx = sam.getContext('2d')
        if (sctx) {
          sctx.drawImage(maskImg, 0, 0, sam.width, sam.height)
          const d = sctx.getImageData(0, 0, sam.width, sam.height)
          const px = d.data
          for (let i = 0; i < px.length; i += 4) {
            const hit = px[i + 3]! > 127 || 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]! > 127
            if (hit) {
              px[i] = 255
              px[i + 1] = 255
              px[i + 2] = 255
              px[i + 3] = 255
            } else {
              px[i + 3] = 0
            }
          }
          sctx.putImageData(d, 0, 0)
          item.piece = markRaw(sam)
          try {
            item.thumb = sam.toDataURL('image/png')
          } catch {
            /* keep */
          }
        }
      }
    } catch {
      item.name = item.name === '选区' ? '选区' : item.name
    } finally {
      item.recognizing = false
    }
  }
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
    setTimeout(() => resolve(img.complete ? img : null), 0)
  })
}

/** 生成：累积蒙版 → PNG → persist → image/edit inpaint（combined prompt）→ 会话结果。 */
async function generate() {
  const maskCanvas = editor.refineElementMaskCanvas
  if (!canGenerate.value || !maskCanvas) return
  busy.value = true
  errorMessage.value = ''
  emit('busy', true)
  try {
    const blob = await new Promise<Blob>((resolve, reject) => {
      maskCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('蒙版导出失败'))), 'image/png')
    })
    const file = new File([blob], 'element-mask.png', { type: 'image/png' })
    const fallbackUrl = URL.createObjectURL(file)
    let maskUrl: string
    try {
      maskUrl = await persistMediaUrl(file, fallbackUrl)
    } catch (e) {
      URL.revokeObjectURL(fallbackUrl)
      throw e
    }
    if (maskUrl !== fallbackUrl) URL.revokeObjectURL(fallbackUrl)
    const prompt = combineElementEditPrompt(items.value) || '元素编辑'
    const refUrls = items.value
      .map((it) => it.refUrl?.trim())
      .filter((u): u is string => !!u)
    const { data } = await studioApi.editImage({
      prompt,
      imageUrl: editor.imageTarget?.url ?? '',
      maskUrl,
      model: editModel.value,
      size: 'auto',
      mode: 'inpaint',
      referenceImageUrls: refUrls.length ? refUrls : undefined,
      nodeId: editor.imageTarget?.nodeId,
    })
    const url = data.data.url
    if (url) {
      editor.pushRefineSessionResult({ url, recordId: data.data.id, prompt })
      editor.clearRefineElementItems()
    } else {
      errorMessage.value = '生成结果为空，请重试'
    }
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : '元素编辑失败，请重试'
  } finally {
    busy.value = false
    emit('busy', false)
  }
}
</script>

<template>
  <section class="element-panel" data-testid="element-edit-panel">
    <div class="element-panel__tools" data-testid="element-tools">
      <button
        type="button"
        class="element-panel__tool"
        :class="{ 'is-on': tool === 'point' }"
        data-testid="element-tool-point"
        title="焦点选择：点击元素，自动识别对象"
        @click="pickTool('point')"
      >◎ 焦点</button>
      <button
        type="button"
        class="element-panel__tool"
        :class="{ 'is-on': tool === 'rect' }"
        data-testid="element-tool-rect"
        title="矩形选区：拖框圈出元素"
        @click="pickTool('rect')"
      >⬚ 选区</button>
      <button
        type="button"
        class="element-panel__tool"
        :class="{ 'is-on': tool === 'brush' }"
        data-testid="element-tool-brush"
        title="画笔：涂抹元素区域"
        @click="pickTool('brush')"
      >✏️ 画笔</button>
    </div>

    <button
      type="button"
      class="element-panel__add"
      data-testid="element-add-selection"
      :disabled="!canAdd"
      :title="tool === 'point' ? '焦点工具下直接点击图中元素即可识别' : '把当前选区加入编辑内容'"
      @click="addCurrentSelection"
    >+ 添加当前选区</button>

    <div v-if="items.length" class="element-panel__list" data-testid="element-items">
      <ElementChipRow
        v-for="item in items"
        :key="item.id"
        :item="item"
        :highlighted="highlightedId === item.id"
        @update:name="editor.updateRefineElementItem(item.id, { name: $event })"
        @update:modify="editor.updateRefineElementItem(item.id, { modify: $event })"
        @update:ref-url="editor.updateRefineElementItem(item.id, { refUrl: $event })"
        @remove="editor.removeRefineElementItem(item.id)"
        @highlight="highlightedId = $event ? item.id : null"
      />
      <button
        type="button"
        class="element-panel__clear"
        data-testid="element-undo"
        :disabled="busy"
        title="撤销最后一枚芯片"
        @click="editor.removeLastRefineElementItem()"
      >↺ 撤销上一处</button>
    </div>
    <p v-else class="element-panel__hint" data-testid="element-empty-hint">
      {{ tool === 'point' ? '点击图中的元素（如眼睛、项链），自动识别对象' : '拖框或涂抹圈出元素，再点「添加当前选区」' }}
    </p>

    <p v-if="errorMessage" class="element-panel__error" data-testid="element-error">{{ errorMessage }}</p>

    <button
      type="button"
      class="element-panel__generate"
      data-testid="element-generate"
      :disabled="!canGenerate"
      :title="canGenerate ? '按编辑内容一次性生成' : '为至少一处元素填写修改内容'"
      @click="generate"
    >{{ busy ? '生成中…' : `⚡ 生成${items.length ? `（${items.length}处）` : ''} · ${CANVAS_GENERATE_CREDITS}积分` }}</button>
  </section>
</template>

<style scoped>
.element-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 2px;
}
.element-panel__hint {
  margin: 0;
  padding: 8px 10px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--neo-text) 5%, transparent);
  color: var(--neo-text-muted);
  font-size: 11.5px;
  line-height: 1.6;
}

.element-panel__tools {
  display: flex;
  gap: 4px;
}
.element-panel__tool {
  flex: 1;
  padding: 0.42rem 0.3rem;
  border: 1px solid var(--neo-border);
  border-radius: 0.5rem;
  background: transparent;
  color: var(--neo-text);
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}
.element-panel__tool:hover { background: var(--neo-hover-bg); }
.element-panel__tool.is-on {
  border-color: color-mix(in srgb, var(--neo-accent-text, #a89dff) 55%, var(--neo-border));
  color: var(--neo-accent-text, #a89dff);
}

.element-panel__add {
  padding: 0.5rem 0.8rem;
  border-radius: 0.55rem;
  background: #fff;
  color: #111;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.element-panel__add:hover:not(:disabled) { opacity: 0.88; }
.element-panel__add:disabled { cursor: not-allowed; opacity: 0.5; }

.element-panel__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.element-panel__row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.25rem 0.4rem;
  border-radius: 0.55rem;
  color: var(--neo-text);
  font-size: 12px;
}
.element-panel__row.is-busy { opacity: 0.7; }
.element-panel__row-name {
  min-width: 0;
  flex: 1;
  padding: 0.22rem 0.4rem;
  border: none;
  border-radius: 0.4rem;
  background: transparent;
  color: var(--neo-text);
  font-size: 12px;
  font-weight: 600;
}
.element-panel__row-name:hover { background: color-mix(in srgb, var(--neo-text) 7%, transparent); }
.element-panel__row-name:focus {
  outline: 1px solid color-mix(in srgb, var(--neo-text) 30%, transparent);
  background: color-mix(in srgb, var(--neo-text) 6%, transparent);
}
.element-panel__row-modify-btn {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.2rem;
  padding: 0.24rem 0.45rem;
  border-radius: 0.45rem;
  color: var(--neo-text-muted);
  font-size: 11.5px;
  cursor: pointer;
}
.element-panel__row-modify-btn:hover,
.element-panel__row-modify-btn.is-on {
  background: color-mix(in srgb, var(--neo-text) 10%, transparent);
  color: var(--neo-text);
}
.element-panel__row-modify {
  margin-left: 36px;
  width: calc(100% - 38px);
  padding: 0.32rem 0.45rem;
  border: none;
  border-radius: 0.45rem;
  background: color-mix(in srgb, var(--neo-text) 6%, transparent);
  color: var(--neo-text);
  font-size: 12px;
}
.element-panel__row-modify:focus { outline: 1px solid color-mix(in srgb, var(--neo-text) 30%, transparent); }
.element-panel__spin {
  flex: 0 0 11px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--neo-text) 25%, transparent);
  border-top-color: var(--neo-accent-text, #a89dff);
  animation: element-panel-spin 0.8s linear infinite;
}
@keyframes element-panel-spin {
  to { transform: rotate(360deg); }
}
.element-panel__thumb {
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  border-radius: 6px;
  background-color: color-mix(in srgb, var(--neo-text) 8%, transparent);
  background-size: cover;
  background-position: center;
}
.element-panel__thumb--empty {
  background-image: linear-gradient(45deg, color-mix(in srgb, var(--neo-text) 6%, transparent) 25%, transparent 25%, transparent 75%, color-mix(in srgb, var(--neo-text) 6%, transparent) 75%);
  background-size: 8px 8px;
}
.element-panel__clear {
  align-self: flex-end;
  padding: 0.25rem 0.5rem;
  border-radius: 0.45rem;
  color: var(--neo-text-muted);
  font-size: 11px;
  cursor: pointer;
}
.element-panel__clear:hover:not(:disabled) { background: color-mix(in srgb, var(--neo-text) 8%, transparent); }
.element-panel__clear:disabled { cursor: not-allowed; opacity: 0.5; }

.element-panel__error {
  margin: 0;
  color: #ff7a7a;
  font-size: 11.5px;
  line-height: 1.5;
}
.element-panel__generate {
  padding: 0.55rem 1rem;
  border-radius: 0.6rem;
  background: #fff;
  color: #111;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.element-panel__generate:hover:not(:disabled) { opacity: 0.88; }
.element-panel__generate:disabled { cursor: not-allowed; opacity: 0.5; }
</style>
