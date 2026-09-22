<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  getEditIntent,
  IMAGE2_EDIT_SIZES,
  IMAGE_EDIT_MODEL_KEYS,
  IMAGE_EDIT_MODEL_PRICING,
  P1_IMAGE_EDIT_MODEL_KEY,
  resolveImageEditProfile,
} from '@lnkpi/shared'
import DockTypeIcon from '@/components/canvas/dock-studio/shared/DockTypeIcon.vue'
import { persistMediaUrl } from '@/composables/useMediaUpload'
import { estimateImageCredits } from '@/constants/credits'
import { studioApi } from '@/services/studio-api'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import { maskCoverageMessage } from '@/utils/maskCoverage'
import { STAIN_PRESET_PROMPT } from '@/utils/refineSession'
import { applyGuideEditIntent, editIntentDisabledReason } from './guideEditIntentApply'
import { baseCanvasFromMetadata, type RefineApplyPayload, type RefineCompareMetadata } from './compareViewModel'
import CompareLightbox from './CompareLightbox.vue'
import RefineCompareBand from './RefineCompareBand.vue'
import RefineDock from './RefineDock.vue'
import RefineOutpaintDock from './RefineOutpaintDock.vue'
import MattingDock from './MattingDock.vue'
import SessionFilmstrip from './SessionFilmstrip.vue'
import { compositeMattingPng } from './mattingComposite'
import { getWorkbenchTool, toolIdForRefineMode } from '@/components/canvas/workbench/workbenchToolRegistry'
import { countMaskPixelsFromImageData, exportMaskPng } from './maskExport'
import { loadMaskRgbaFromUrl, mergeMaskRgba, registerRefinePointSelectHandler } from './maskRemote'
import { parseFillHex } from './maskWand'
import { resetMediaPipeSegmentSession, segmentPointLocal } from './mediapipeSegment'
import {
  createPointSegmentSession,
  resetPointSegmentSession,
  resolvePointMaskRgba,
} from './pointSegmentSession'
import { computeOutpaintLayers } from './outpaintComposite'
import { hasOutpaintExtension, floorOutpaintRect } from './outpaintGeometry'
import { renderOutpaintPngs } from './outpaintRender'
import { OUTPAINT_FALLBACK_PROMPT } from './outpaintFallback'

const REFINE_COLLAPSED_W = 44

const props = defineProps<{
  nodeId: string
  beforeUrl: string
  sessionId: string
  generationRecordId?: string
  width?: number
  height?: number
  /** Shared workbench panel width (px) — owned by useWorkbenchPanel, passed down. */
  panelWidth: number
  /** Shared collapsed flag — owned by useWorkbenchPanel, passed down. */
  collapsed: boolean
  /** Shared narrow (<640px) flag — owned by useWorkbenchPanel, passed down. */
  isNarrow: boolean
  /** Shared right inset (px) — owned by useWorkbenchPanel, passed down to CompareLightbox. */
  insetRight: number
  /** 悬浮 dock 是否可用（由 WorkbenchShell 依窄屏判定下发，§6.3）。 */
  floatingAvailable?: boolean
}>()

const emit = defineEmits<{
  close: []
  apply: [payload: RefineApplyPayload]
  busy: [value: boolean]
  'update:collapsed': [value: boolean]
  /** 面板宽度调整：生产者由 RefineWorkbench 经 @update:panel-width="setPanelWidth($event)" 接线（Shell 的 resize handle）；保留 emit 供对齐。 */
  'update:panel-width': [value: number]
}>()

const editor = useCanvasEditorStore()
const prompt = ref('')
const activeGuideEditIntentId = ref<string | null>(null)
const guideCapabilities =
  resolveImageEditProfile().capabilities ?? {
    transparentBackground: false,
    qualityParam: true,
    maxRefImages: 4,
  }
/** Refine work image always counts as one ref; multi-ref upload is out of scope for P0 chips. */
const refineRefImageCount = 1
const activeEditIntent = computed(() =>
  activeGuideEditIntentId.value ? getEditIntent(activeGuideEditIntentId.value) ?? null : null,
)
const activeRefRoleHints = computed(() => {
  const roles = activeEditIntent.value?.refRoles
  if (!roles?.length) return ''
  return roles.map((r) => r.hint).join(' · ')
})
const busy = ref(false)
const segmentBusy = ref(false)
const errorMessage = ref('')
const compareBeforeUrl = ref(props.beforeUrl)
/** 处理后结果 url：统一取自 store 当前会话结果（胶片条选中即切换，Task 7）。 */
const afterUrl = computed(() => editor.currentRefineSessionResult?.url ?? undefined)
/** matting 服务不可用（503）标记：禁用 run-auto 并提示。 */
const mattingUnavailable = ref(false)
/** 当前是否有可用于「选区抠图」的选区蒙版。 */
const maskAvailable = computed(() => {
  const mask = editor.getRefineMask()
  const canvas = mask?.getCanvas()
  return !!canvas && editor.refineCoverage > 0
})
/** 当前激活工具是否为 matting 面板（动态 panel 下发 5 props / 监听 3 events）。 */
const isMattingPanel = computed(() => editor.refineMode === 'matting')
/** matting dock：注册表声明 panel。 */
const mattingDockInPanel = computed(
  () => editor.refineMode === 'matting' && activeTool.value?.dockPlacement === 'panel' && !!activeTool.value.dock,
)
/** 当前「处理后」版本的对照元数据（Task 8）：扩图成功时快照，普通精修 / 换图时清空。 */
const outpaintMeta = ref<RefineCompareMetadata | null>(null)
const compareBaseCanvas = computed(() => baseCanvasFromMetadata(outpaintMeta.value))
// 对照状态已提升到 store（Task 1）：侧栏只读取，写入交由 CompareLightbox / 对照带。
const compareMode = computed(() => editor.refineCompareMode)
const wipeRatio = computed(() => editor.refineWipeRatio)

let abortController: AbortController | null = null
const pointSession = createPointSegmentSession()

function resetPointFallbackState() {
  resetPointSegmentSession(pointSession)
  resetMediaPipeSegmentSession()
}

async function loadWorkImage(url: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = url
  await img.decode()
  return img
}

/** 精修通道模型 / 尺寸改为受控选择器（M2 T4）。默认值取 shared 白名单与定价表，不写死。 */
const modelKey = ref<string>(P1_IMAGE_EDIT_MODEL_KEY)
const sizeOverride = ref<string | 'auto'>('auto')
/** dock 的 mode：扩图模式下传 'outpaint' 以隐藏尺寸选择器（Task 7 接线）。 */
const dockMode = computed<'edit' | 'outpaint'>(() => (editor.refineMode === 'outpaint' ? 'outpaint' : 'edit'))
/** credits 按 shared 模型定价表动态计算（image2 = 10），模型不可识别时回落到默认估算。 */
const credits = computed(() => IMAGE_EDIT_MODEL_PRICING[modelKey.value] ?? estimateImageCredits(1))
const coverageKind = computed(() => maskCoverageMessage(editor.refineCoverage))
/** 当前激活的一级工具（注册表是唯一真相：未注册 → 无面板、无 dock）。 */
const activeTool = computed(() => getWorkbenchTool(toolIdForRefineMode(editor.refineMode)))
/** 扩图 dock 的落点：注册表声明 floating 且悬浮可用 → 悬浮；否则退化为面板底部。
 *  显示门控（2026-09-22 用户验收修订）：产生真实扩出后才出现（CTA 此前本就禁用，无常驻价值），
 *  且手柄拖拽进行中隐藏——常驻浮层会挡住画布拖拽操作。窄屏面板兜底落点不挡画布，不受门控。 */
const outpaintDockFloating = computed(
  () =>
    activeTool.value?.dockPlacement === 'floating' &&
    props.floatingAvailable !== false &&
    outpaintCanRun.value &&
    !editor.refineOutpaintDragging,
)
/** 通用编辑 dock（select 等）落点：注册表声明 panel（产出型工具必有 dock，§4.2）。matting 走独立 MattingDock。 */
const selectDockInPanel = computed(
  () => editor.refineMode !== 'matting' && activeTool.value?.dockPlacement === 'panel' && !!activeTool.value.dock,
)
/** 扩图 dock 的面板兜底落点：注册表声明 floating 但悬浮不可用（窄屏，§6.3）。 */
const outpaintDockInPanel = computed(
  () => activeTool.value?.dockPlacement === 'floating' && !!activeTool.value.dock && props.floatingAvailable === false,
)
/** 扩图是否已真实扩出（CTA 守卫，§6.3）。 */
const outpaintCanRun = computed(() => {
  const base = editor.refineOutpaintBase
  const rect = editor.refineOutpaintRect
  return !!base && !!rect && hasOutpaintExtension(base, rect)
})
/** 扩图模式是否已产生真实扩出（复用 outpaintCanRun，单一判据）。 */
const outpaintReady = computed(() => outpaintCanRun.value)
/** 扩图模式：需要一个已真实扩出的 rect（零扩展提交 = 空蒙版白扣积分）；普通模式保持原 coverage 校验。 */
const refineDisabled = computed(() => {
  if (busy.value) return true
  if (editor.refineMode === 'outpaint') return !outpaintReady.value
  return coverageKind.value === 'empty'
})
const canApply = computed(() => !!afterUrl.value)
const backLabel = computed(() => (busy.value ? '取消精修' : '关闭'))
const panelStyle = computed(() => {
  const width = props.collapsed
    ? REFINE_COLLAPSED_W
    : props.isNarrow
      ? undefined
      : props.panelWidth
  return {
    top: '0',
    right: '0',
    bottom: '0',
    width: props.isNarrow ? '100%' : `${width}px`,
  }
})

watch(busy, (value) => emit('busy', value), { immediate: true })

watch(
  () => props.beforeUrl,
  (url) => {
    // afterUrl 现已由 store 当前会话结果派生（换图时 store 会清空结果），
    // 这里只需同步对照基准图并清掉扩图元数据 / 点选兜底状态。
    compareBeforeUrl.value = url
    outpaintMeta.value = null
    resetPointFallbackState()
  },
)

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: string; name?: string }
  return e.code === 'ERR_CANCELED' || e.name === 'CanceledError' || e.name === 'AbortError'
}

function formatError(err: unknown, fallback: string): string {
  if (isAbortError(err)) return ''
  if (!err || typeof err !== 'object') return fallback
  const e = err as {
    message?: string
    response?: { data?: { message?: string | string[] } }
  }
  const msg = e.response?.data?.message
  if (typeof msg === 'string' && msg.trim()) return msg
  if (Array.isArray(msg) && msg[0]) return String(msg[0])
  if (typeof e.message === 'string' && e.message.trim()) return e.message
  return fallback
}

function applyStainPreset() {
  activeGuideEditIntentId.value = null
  prompt.value = STAIN_PRESET_PROMPT
}

function editIntentChipDisabled(intentId: string): boolean {
  return busy.value || !!editIntentDisabledReason(intentId, guideCapabilities)
}

function applyEditIntent(intentId: string) {
  if (editIntentChipDisabled(intentId)) return
  const result = applyGuideEditIntent({
    intentId,
    capabilities: guideCapabilities,
    refImageCount: refineRefImageCount,
    mode: 'fill',
  })
  if (!result.ok) {
    ElMessage.warning(result.reason)
    return
  }
  activeGuideEditIntentId.value = result.guideEditIntentId
  prompt.value = result.prompt
}

function clearEditIntent() {
  activeGuideEditIntentId.value = null
}

/** 会话胶片条选中：切换 store 当前结果，afterUrl 随之派生切换。 */
function onSelectSessionResult(id: string) {
  editor.selectRefineSessionResult(id)
}

function onBackOrCancel() {
  if (busy.value) {
    abortController?.abort()
    return
  }
  emit('close')
}

function onApply() {
  const result = editor.currentRefineSessionResult
  if (!result) return
  const payload: { url: string; prompt: string; recordId?: string } = {
    url: result.url,
    prompt: result.prompt,
  }
  if (result.recordId) payload.recordId = result.recordId
  emit('apply', payload)
}

function toggleCollapsed() {
  emit('update:collapsed', !props.collapsed)
}

async function onPointSelect({ x, y }: { x: number; y: number }) {
  if (busy.value || segmentBusy.value) return
  const mask = editor.getRefineMask()
  const canvas = mask?.getCanvas()
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  segmentBusy.value = true
  try {
    const remoteRgba = await resolvePointMaskRgba({
      session: pointSession,
      remoteSegment: async () => {
        const { data } = await studioApi.segmentImage({
          imageUrl: props.beforeUrl,
          x,
          y,
          label: 1,
        })
        return { maskUrl: data.data.maskUrl }
      },
      loadRemoteRgba: (maskUrl) => loadMaskRgbaFromUrl(maskUrl, canvas.width, canvas.height),
      localSegment: async () => {
        const img = await loadWorkImage(props.beforeUrl)
        return segmentPointLocal({
          image: img,
          imageKey: props.beforeUrl,
          x,
          y,
          width: canvas.width,
          height: canvas.height,
        })
      },
      onFallbackToast: () => {
        ElMessage.warning('云端点选暂不可用，已用本地点选')
      },
    })
    const base = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const merged = mergeMaskRgba({
      width: canvas.width,
      height: canvas.height,
      baseMaskRgba: base.data,
      remoteMaskRgba: remoteRgba,
      fillRgb: parseFillHex(editor.refineBrushColor),
      mode: editor.refineMaskOp === 'subtract' ? 'subtract' : 'add',
    })
    ctx.putImageData(new ImageData(new Uint8ClampedArray(merged), canvas.width, canvas.height), 0, 0)
    const counted = countMaskPixelsFromImageData(ctx.getImageData(0, 0, canvas.width, canvas.height))
    editor.refineCoverage = counted.ratio
  } catch (err) {
    const message = formatError(err, '点选失败，请重试')
    if (message) ElMessage.error(message)
  } finally {
    segmentBusy.value = false
  }
}

async function runRefine() {
  if (refineDisabled.value) return
  // 扩图模式走独立提交链路（合成两张 PNG → persist → imageEdit mode:outpaint）。
  if (editor.refineMode === 'outpaint') {
    await runOutpaint()
    return
  }
  if (activeGuideEditIntentId.value) {
    const gate = applyGuideEditIntent({
      intentId: activeGuideEditIntentId.value,
      capabilities: guideCapabilities,
      refImageCount: refineRefImageCount,
      mode: 'submit',
    })
    if (!gate.ok) {
      errorMessage.value = gate.reason
      return
    }
  }
  const mask = editor.getRefineMask()
  const canvas = mask?.getCanvas()
  if (!mask || !canvas) return

  errorMessage.value = ''
  abortController?.abort()
  abortController = new AbortController()
  const signal = abortController.signal
  busy.value = true

  try {
    const blob = await (mask.exportPng?.() ?? exportMaskPng(canvas))
    const file = new File([blob], 'mask.png', { type: 'image/png' })
    const fallbackUrl = URL.createObjectURL(file)
    let maskUrl: string
    try {
      maskUrl = await persistMediaUrl(file, fallbackUrl)
    } catch (err) {
      URL.revokeObjectURL(fallbackUrl)
      throw err
    }
    if (maskUrl !== fallbackUrl) URL.revokeObjectURL(fallbackUrl)

    const { data } = await studioApi.editImage(
      {
        prompt: prompt.value,
        imageUrl: props.beforeUrl,
        maskUrl,
        model: modelKey.value,
        size: sizeOverride.value,
        mode: dockMode.value,
        sessionId: props.sessionId,
        nodeId: props.nodeId,
        parentRecordId: props.generationRecordId,
      },
      signal,
    )
    const url = data.data.url
    if (url) {
      editor.pushRefineSessionResult({ url, recordId: data.data.id, prompt: prompt.value || '精修' })
    }
  } catch (err) {
    const message = formatError(err, '精修失败，请重试')
    if (message) errorMessage.value = message
  } finally {
    busy.value = false
    abortController = null
  }
}

/** mask canvas 选区（alpha 或 luma）转 compositeMattingPng 所需的「红通道=选区强度」RGBA。 */
function maskCanvasToCompositeRgba(data: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length)
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!
    const g = data[i + 1]!
    const b = data[i + 2]!
    const a = data[i + 3]!
    const selected = a > 127 || 0.299 * r + 0.587 * g + 0.114 * b > 127
    out[i] = selected ? 255 : 0
    out[i + 1] = 0
    out[i + 2] = 0
    out[i + 3] = 255
  }
  return out
}

/**
 * 一键抠图（matting-auto）：调 studioApi.mattingImage 由服务端 rembg 出透明 PNG。
 * 503 → 服务未启用（标记 mattingUnavailable 禁用 CTA）；其余异常 → 服务暂时不可用。
 * 任何异常都不让面板崩（Review Focus 3）。
 */
async function runMattingAuto() {
  if (editor.refineMode !== 'matting') return
  mattingUnavailable.value = false
  busy.value = true
  editor.setRefineBusy(true)
  try {
    const { data } = await studioApi.mattingImage({ imageUrl: props.beforeUrl })
    const url = data.data.url
    if (url) editor.pushRefineSessionResult({ url, prompt: '抠图' })
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status
    if (status === 503) {
      mattingUnavailable.value = true
      ElMessage.warning('抠图服务未启用')
    } else {
      ElMessage.warning('抠图服务暂时不可用')
    }
  } finally {
    busy.value = false
    editor.setRefineBusy(false)
  }
}

/**
 * 选区抠图（matting-mask）：本地用当前蒙版 + 原图合成透明 PNG，不依赖 rembg。
 * mask 取本地 canvas（与 onPointSelect 同源），转 RGBA 后 compositeMattingPng → persist → 入会话。
 */
async function runMattingMask() {
  if (editor.refineMode !== 'matting') return
  const mask = editor.getRefineMask()
  const canvas = mask?.getCanvas()
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const maskRgba = maskCanvasToCompositeRgba(imageData.data)
  busy.value = true
  editor.setRefineBusy(true)
  try {
    const img = await loadWorkImage(props.beforeUrl)
    const blob = await compositeMattingPng({ image: img, maskRgba })
    const file = new File([blob], 'matting.png', { type: 'image/png' })
    const fallbackUrl = URL.createObjectURL(file)
    let url: string
    try {
      url = await persistMediaUrl(file, fallbackUrl)
    } catch (e) {
      URL.revokeObjectURL(fallbackUrl)
      throw e
    }
    if (url !== fallbackUrl) URL.revokeObjectURL(fallbackUrl)
    editor.pushRefineSessionResult({ url, prompt: '选区抠图' })
  } catch (err) {
    const message = formatError(err, '选区抠图失败，请重试')
    if (message) ElMessage.error(message)
  } finally {
    busy.value = false
    editor.setRefineBusy(false)
  }
}

/** 尽量加载原图用于底图贴位；jsdom / 加载失败时不阻塞（扩出区仍可正确合成）。 */
async function loadBaseImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
    // jsdom 等无 onload 环境：已 complete 则返回，否则兜底 null。
    setTimeout(() => resolve(img.complete ? img : null), 0)
  })
}

/**
 * 扩图提交链路（Task 7 / Task 9）：基准取自 store 的 `refineOutpaintBase`，
 * 几何经 `floorOutpaintRect` 落像素（§7：权威草稿含小数，提交侧统一 floor）。
 * 合成底图 + 蒙版两张 PNG → persist 到服务端（失败回退 blob URL）→ imageEdit
 * （mode:'outpaint'、size:'auto'），并携带 outpaintFrom（原图尺寸）/ outpaintTo（新画布尺寸）。
 * 空 prompt 时兜底英文文案。
 */
async function runOutpaint() {
  const base = editor.refineOutpaintBase
  const raw = editor.refineOutpaintRect
  if (!base || !raw) return
  const baseW = base.width
  const baseH = base.height
  if (!baseW || !baseH) return
  const rect = floorOutpaintRect(raw)          // §7：提交侧统一落像素
  if (!hasOutpaintExtension({ width: baseW, height: baseH }, rect)) return

  errorMessage.value = ''
  abortController?.abort()
  abortController = new AbortController()
  const signal = abortController.signal
  busy.value = true

  try {
    const img = await loadBaseImage(props.beforeUrl)
    const { baseSpec, maskSpec } = computeOutpaintLayers({ width: baseW, height: baseH }, rect)
    const { baseBlob, maskBlob } = await renderOutpaintPngs(img, { baseSpec, maskSpec })

    const baseFile = new File([baseBlob], 'outpaint-base.png', { type: 'image/png' })
    const maskFile = new File([maskBlob], 'outpaint-mask.png', { type: 'image/png' })
    const baseFallback = URL.createObjectURL(baseFile)
    const maskFallback = URL.createObjectURL(maskFile)
    let baseUrl: string = baseFallback
    let maskUrl: string = maskFallback
    try {
      baseUrl = await persistMediaUrl(baseFile, baseFallback)
      maskUrl = await persistMediaUrl(maskFile, maskFallback)
    } finally {
      if (baseUrl !== baseFallback) URL.revokeObjectURL(baseFallback)
      if (maskUrl !== maskFallback) URL.revokeObjectURL(maskFallback)
    }

    const promptText = prompt.value.trim() ? prompt.value : OUTPAINT_FALLBACK_PROMPT
    const { data } = await studioApi.editImage(
      {
        prompt: promptText,
        imageUrl: baseUrl,
        maskUrl,
        model: modelKey.value,
        size: 'auto',
        mode: 'outpaint',
        outpaintFrom: { width: baseW, height: baseH },
        outpaintTo: { width: rect.width, height: rect.height },
        sessionId: props.sessionId,
        nodeId: props.nodeId,
        parentRecordId: props.generationRecordId,
      },
      signal,
    )
    const url = data.data.url
    if (url) {
      editor.pushRefineSessionResult({ url, recordId: data.data.id, prompt: prompt.value || OUTPAINT_FALLBACK_PROMPT })
      // Task 8：快照本次扩图的对照元数据（与服务端 metadata 契约同形），
      // 对照带据此进入「基准画布」模式——以新画布为基准、Before 居中贴图。
      outpaintMeta.value = {
        editMode: 'outpaint',
        outpaintFrom: { width: baseW, height: baseH },
        outpaintTo: { width: rect.width, height: rect.height },
      }
    }
  } catch (err) {
    const message = formatError(err, '扩图失败，请重试')
    if (message) errorMessage.value = message
  } finally {
    busy.value = false
    abortController = null
  }
}

onMounted(() => {
  registerRefinePointSelectHandler(onPointSelect)
})

onBeforeUnmount(() => {
  registerRefinePointSelectHandler(null)
  resetPointFallbackState()
})
</script>

<template>
  <Teleport to="body">
    <aside
      class="refine-side"
      :class="{ 'is-collapsed': collapsed }"
      :style="panelStyle"
      @click.stop
    >
      <header
        class="refine-side__head"
      >
        <div class="flex min-w-0 items-center gap-1">
          <button
            v-if="!isNarrow"
            type="button"
            class="refine-side__collapse"
            :title="collapsed ? '展开精修侧栏' : '收缩精修侧栏'"
            @click="toggleCollapsed"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75">
              <path v-if="collapsed" stroke-linecap="round" stroke-linejoin="round" d="M15 6 9 12l6 6" />
              <path v-else stroke-linecap="round" stroke-linejoin="round" d="M9 6l6 6-6 6" />
            </svg>
          </button>
          <span v-if="!collapsed" class="bottom-toolbar-type-icon" title="精修">
            <DockTypeIcon icon="image" :size="18" />
          </span>
          <span v-if="!collapsed" class="refine-side__title">精修</span>
        </div>
        <div v-if="!collapsed" class="flex items-center gap-1">
          <button type="button" class="refine-side__icon-btn" :title="backLabel" @click="onBackOrCancel">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.75">
              <path v-if="busy" stroke-linecap="round" d="M6 6l12 12M18 6 6 18" />
              <path v-else stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      </header>
      <RefineCompareBand
        v-if="!collapsed"
        :before-url="compareBeforeUrl"
        :after-url="afterUrl"
        :version-metadata="outpaintMeta"
      />

      <div v-if="!collapsed" class="refine-side__body">
        <div class="refine-side__scroll" data-testid="workbench-panel-scroll">
          <component
            :is="activeTool.panel"
            v-if="activeTool"
            :busy="busy"
            v-bind="isMattingPanel ? { beforeUrl: props.beforeUrl, mattingUnavailable, maskAvailable, canApply } : {}"
            @apply-stain-preset="applyStainPreset"
            @run-auto="runMattingAuto"
            @run-mask="runMattingMask"
            @apply="onApply"
          />
        </div>
        <!-- 会话胶片条（Task 7）：替换原 VersionStrip；选中切换 store 当前结果 → afterUrl 派生切换 -->
        <SessionFilmstrip
          class="refine-side__filmstrip"
          :results="editor.refineSessionResults"
          :current-id="editor.refineSessionCurrentId"
          :disabled="busy"
          @select="onSelectSessionResult"
        />
      </div>

      <!-- select：panel 落点 dock（注册表声明 dockPlacement: 'panel'） -->
      <RefineDock
        v-if="!collapsed && selectDockInPanel"
        :prompt="prompt"
        :credits="credits"
        :before-url="beforeUrl"
        :model-key="modelKey"
        :available-model-keys="IMAGE_EDIT_MODEL_KEYS"
        :sizes="IMAGE2_EDIT_SIZES"
        :size-override="sizeOverride"
        :mode="dockMode"
        :outpaint-ready="outpaintReady"
        :busy="busy"
        :disabled="refineDisabled"
        :can-apply="canApply"
        :error-message="errorMessage"
        :coverage-kind="coverageKind"
        :width="width"
        :height="height"
        :active-edit-intent-id="activeGuideEditIntentId"
        :ref-role-hints="activeRefRoleHints"
        @update:prompt="prompt = $event"
        @update:model-key="modelKey = $event"
        @update:size-override="sizeOverride = $event"
        @run="runRefine"
        @apply="onApply"
        @retry="runRefine"
        @select-edit-intent="applyEditIntent"
        @clear-edit-intent="clearEditIntent"
      />

      <!-- matting dock：注册表声明 panel；与 select 的 RefineDock 互斥（matting 走独立 dock）。 -->
      <MattingDock
        v-if="!collapsed && mattingDockInPanel"
        :matting-unavailable="mattingUnavailable"
        :busy="busy"
        @run-auto="runMattingAuto"
      />

      <!-- 扩图窄屏兜底 dock：注册表声明 floating 但悬浮不可用（窄屏，§6.3）→ 面板底部常驻。
           与悬浮 dock（③）互斥：悬浮可用时走 ③，否则落到此处（outpaintDockInPanel 收口）。 -->
      <RefineOutpaintDock
        v-if="!collapsed && outpaintDockInPanel"
        size="md"
        :prompt="prompt"
        :model-key="modelKey"
        :available-model-keys="IMAGE_EDIT_MODEL_KEYS"
        :credits="credits"
        :can-run="outpaintCanRun"
        :busy="busy"
        :can-apply="canApply"
        :error-message="errorMessage"
        @update:prompt="prompt = $event"
        @update:modelKey="modelKey = $event"
        @run="runRefine"
        @apply="onApply"
        @retry="runRefine"
        @exit="editor.setRefineMode('select')"
        @cancel="onBackOrCancel"
      />
    </aside>
  </Teleport>

  <!-- 扩图悬浮 dock：视口底部居中、尊重右栏内缩（§6.3）；窄屏时改走面板底部（outpaintDockInPanel） -->
  <Teleport v-if="!collapsed && outpaintDockFloating" to="body">
    <div
      class="refine-outpaint-floating"
      data-testid="outpaint-dock-floating"
      :style="{ right: `${insetRight}px` }"
    >
      <RefineOutpaintDock
        size="lg"
        :prompt="prompt"
        :model-key="modelKey"
        :available-model-keys="IMAGE_EDIT_MODEL_KEYS"
        :credits="credits"
        :can-run="outpaintCanRun"
        :busy="busy"
        :can-apply="canApply"
        :error-message="errorMessage"
        @update:prompt="prompt = $event"
        @update:modelKey="modelKey = $event"
        @run="runRefine"
        @apply="onApply"
        @retry="runRefine"
        @exit="editor.setRefineMode('select')"
        @cancel="onBackOrCancel"
      />
    </div>
  </Teleport>


  <CompareLightbox
    :open="editor.compareLightboxOpen"
    :before-url="compareBeforeUrl"
    :after-url="afterUrl"
    :base-canvas="compareBaseCanvas"
    :mode="compareMode"
    :wipe-ratio="wipeRatio"
    :inset-right="insetRight"
    @close="editor.setCompareLightboxOpen(false)"
    @update:mode="editor.setRefineCompareMode($event)"
    @update:wipe-ratio="editor.setRefineWipeRatio($event)"
  />
</template>

<style scoped>
.refine-side {
  position: fixed;
  z-index: 55;
  display: flex;
  min-height: 0;
  flex-direction: column;
  background: var(--neo-surface, #111);
  color: var(--neo-text-primary);
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.28);
}

.refine-side.is-collapsed {
  overflow: hidden;
}

.refine-side.is-collapsed .refine-side__head {
  flex-direction: column;
  justify-content: flex-start;
  padding: 8px 4px;
}

.refine-side__collapse {
  display: inline-flex;
  height: 28px;
  width: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--neo-text-muted);
  cursor: pointer;
}

.refine-side__collapse:hover {
  background: var(--neo-hover-bg);
  color: var(--neo-text-primary);
}

.refine-side__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--neo-border);
}

.refine-side__title {
  font-size: 13px;
  font-weight: 600;
}

.refine-side__body { display: flex; min-height: 0; flex: 1; flex-direction: column; overflow: hidden; }
/* 唯一滚动区（§4.3 布局铁律：dock 与版本条是 flex 兄弟，绝不覆盖滚动区） */
.refine-side__scroll { min-height: 0; flex: 1; overflow-y: auto; }
.refine-side__filmstrip { flex: 0 0 auto; padding: 8px 12px; border-top: 1px solid var(--neo-border); }

.refine-outpaint-floating {
  position: fixed;
  left: 56px;              /* 让出左栏 rail */
  bottom: 16px;
  z-index: 56;
  display: flex;
  justify-content: center;
  pointer-events: none;    /* 容器不吃事件，仅 dock 本身可点 */
}

.refine-side__icon-btn {
  display: inline-flex;
  height: 28px;
  width: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--neo-text-muted);
  cursor: pointer;
}

.refine-side__icon-btn:hover {
  background: var(--neo-hover-bg);
  color: var(--neo-text-primary);
}

.refine-side__icon-btn.is-active {
  border-color: var(--neo-border-strong);
  color: var(--neo-text-primary);
  background: var(--neo-hover-bg);
}

.refine-side__icon-btn.is-guide-active {
  border-color: color-mix(in srgb, rgb(232 121 249) 25%, transparent);
  background: color-mix(in srgb, rgb(217 70 239) 15%, transparent);
  color: rgb(240 171 252);
}

.refine-side__icon-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
</style>
